"""Resident edit sessions. No report generation or disk persistence per edit."""
import atexit
import base64
from copy import copy, deepcopy
import hashlib
import numpy as np
import re
from collections import OrderedDict
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Condition, Lock
from time import perf_counter
from uuid import uuid4

from incremental_probability import Store
from map_results import load_report, resource_context, result_path, source_bytes
from realmap import TOOLS, ensure_tools, run
from realmap_exact import read_search
from realmap_parser import object_records, parse_map, rebuild_layout
from realmap_simulation import HOUSE, apply, changed_points
from simulation_visual import Scene


def noop(*_args):
    pass


def flags(cell):
    movement = int(cell['track']) | (int(cell['float']) << 1) if cell['candidate'] else 0
    return movement | (4 if cell['primary'] else 0) | (8 if cell['land'] == 2 else 0)


STATUS = {'crate': 1, 'ghost': 2}
ZERO = dict(probability=0, multiplier=0, oneAttemptProbability=0, terms=[])


def fork_store(value):
    """Copy mutable incidence/index containers; exact integer values are immutable."""
    other = copy(value)
    other.records, other.radii = list(value.records), bytearray(value.radii)
    other.radius_grid = np.frombuffer(other.radii, np.uint8).reshape(value.maximum, value.maximum)
    other.block_radius = value.block_radius.copy()
    other.terms = type(value.terms)(value.terms.default_factory, ((k,v.copy()) for k,v in value.terms.items()))
    for name in ('ghost', 'terminal', 'counts', 'aggregate_terminal', 'aggregate_ghost'):
        item = getattr(value, name)
        setattr(other, name, None if item is None else item.copy())
    other.kernel = dict(value.kernel)
    for name in ('distributions', 'signatures', 'cellResults', 'usedDistributions'):
        if name in other.kernel:
            other.kernel[name] = other.kernel[name].copy()
    other.maximum_heap = list(value.maximum_heap)
    other.dirty = None if value.dirty is None else set(value.dirty)
    other.aggregate_summary = None if value.aggregate_summary is None else dict(value.aggregate_summary)
    return other


class ExpiredSession(ValueError):
    code = 'LIVE_SESSION_EXPIRED'

    def __init__(self, message, reason='unknown-or-server-restarted'):
        super().__init__(message)
        self.reason = reason


class CancelledOpen(ValueError):
    code = 'LIVE_OPEN_CANCELLED'


class LiveSession:
    def __init__(self, path, revision=0, *, inputs=None):
        if inputs is None:
            report, display_cells = load_report(path)
            inputs = report, display_cells, source_bytes(report, path), resource_context(report, path)[0]
        report, self.display_cells, data, self.res = inputs
        self.report = report
        self.meta = meta = report['metadata']
        self.sent_probability = report['probability']
        if meta.get('previewOnly') or meta.get('mineralsEnabled') is False:
            raise ValueError('The live editor requires an editable analysis')
        if report['probability'].get('model') != 'finite-retry-v2':
            raise ValueError('Reanalyze this map to enable live editing')
        initial = meta.get('simulationPlan')
        with TemporaryDirectory(prefix='crate-live-') as temporary:
            folder = Path(temporary)
            cells, _, theater, tmps, _ = parse_map(
                data, folder, meta.get('engineVersion', meta['version']), resource_context=self.res,
                visual_only=bool(meta.get('approximate')))
            # Keep the shared parser cache's mutable cursors out of this session.
            self.prepared = theater['_layoutPrepared'] = dict(theater['_layoutPrepared'], liveEditor=True)
            if meta.get('approximate'):
                from realmap_approx import prepare
                # These are original source cells. A persisted report's plan
                # has not been applied yet; tagging the original checkpoint
                # with it would make the following rebuild incorrectly no-op.
                prepare(cells, self.res, theater, dict(meta, warnings=[], simulationPlan=None))
            self.original_cells, self.original_theater = cells, theater
            if initial:
                cells, _, theater, _, parsed = rebuild_layout(self.prepared, self.res, initial, noop, incremental=True)
                if meta.get('approximate'):
                    prepare(cells, self.res, theater, dict(parsed, engineVersion=meta.get('engineVersion')))
            if self.display_cells.keys() != cells.keys():
                raise ValueError('Map layout changed since analysis')
            grid, statuses = bytearray(262144), bytearray(262144)
            for (x, y), cell in cells.items():
                key = y*512+x
                grid[key], statuses[key] = flags(cell), STATUS.get(cell['status'], 0)
            maximum = sum(meta['size'][2:])-1
            search = path.parent/'search.bin'
            saved_grid = path.parent/'search-grid.bin'
            if not search.is_file() or not saved_grid.is_file() or saved_grid.read_bytes() != grid:
                ensure_tools()
                source, search = folder/'grid.bin', folder/'search.bin'
                source.write_bytes(grid)
                run([TOOLS/'map-search.exe', source, search, maximum, min(maximum+1, 32)], 180)
            self.store = Store(maximum, grid, statuses, read_search(search, maximum**2))
            baseline_probability = self.store.calculate()
            if any(baseline_probability['cells'].get(y*512+x, ZERO)['terms'] != c['terms']
                   for (x,y), c in self.display_cells.items()):
                raise ValueError('Map probabilities changed since analysis')
        self.token = uuid4().hex
        self.plan = initial or dict(schema=1, map=dict(sha256=meta['sourceSha256'], version=meta['version']),
                         objects={}, overlays={}, placements=[])
        self.scene_plan = self.plan
        self.tank_shortcut = not initial or (not initial.get('objects') and not initial.get('overlays')
                and all(o.get('category') == 'UNITS' and o.get('type') == 'MTNK' for o in initial.get('placements', ())))
        self.scene = Scene(cells, self.res, theater, tmps, path, meta, report['rendering'])
        if initial and self.tank_shortcut:
            # A persisted report already contains its placed tanks. The fast
            # index must compose them over the original objects, not draw those
            # same tanks a second time over the report's initial event list.
            self.scene.original_events = self.scene.index_events(self.scene.object_events(self.original_cells, self.original_theater))
        self.warm_tank(cells, theater)
        self.grid, self.statuses = grid, statuses
        self.layout_version = self.art_version = revision
        self.latest_scene = revision, self.plan, cells, theater
        self.markers = {tuple(p) for p in report['markers']}
        self.shadowed = {tuple(p) for p in report['zeroProbabilityRockCandidates']}
        self.lock, self.art_lock = Lock(), Lock()
        self.ready = Condition()

    def fork(self, revision, res):
        """Fork an immutable baseline, retaining exact search and native art data."""
        other = copy(self)
        other.token, other.res = uuid4().hex, res
        other.prepared = dict(self.prepared)
        other.original_theater = dict(self.original_theater, _layoutPrepared=other.prepared)
        other.plan = deepcopy(self.plan)
        other.scene_plan = other.plan
        other.latest_scene = revision, other.plan, self.latest_scene[2], dict(self.latest_scene[3], _layoutPrepared=other.prepared)
        other.grid, other.statuses = bytearray(self.grid), bytearray(self.statuses)
        other.store = fork_store(self.store)
        other.scene = self.scene.fork(res)
        other.markers, other.shadowed = set(self.markers), set(self.shadowed)
        other.layout_version = other.art_version = revision
        other.lock, other.art_lock, other.ready = Lock(), Lock(), Condition()
        return other

    def warm_tank(self, cells, theater):
        """Prepare the default placement's native sprite before the first stroke."""
        point = next((p for p,c in cells.items() if c['usable'] and c['level']==0 and not c['bridge']), None)
        if point is None or 'MTNK' not in theater['effectiveRules']:
            return
        original_rules = theater['effectiveRules']
        rules = dict(original_rules, COLORS=dict(original_rules.get('COLORS', {})))
        content = {}
        placement = dict(id='sim-warm', category='UNITS', type='MTNK', x=point[0], y=point[1],
                         facing=64, subcell=0, onBridge=False)
        apply(dict(objects={}, overlays={}, placements=[placement]), content,
              {point:dict(cells[point])}, rules, self.res.art)
        context = dict(theater, effectiveRules=rules, mapObjects=object_records(content),
                       mapHouses={**theater['mapHouses'], HOUSE:content[HOUSE]})
        self.scene.object_events(cells, context)

    def rebuild(self, plan):
        """Only known 1×1 ground vehicles on untouched clear cells use this shortcut."""
        from realmap_format import yes
        previous = self.plan
        dirty = changed_points(self.prepared, plan, previous)
        if self.tank_shortcut and not any(p['objects'] or p['overlays'] for p in (previous, plan)):
            items = previous['placements'] + plan['placements']
            rules = self.original_theater['effectiveRules']
            cfg = rules.get('MTNK', {})
            art = self.res.art.get(cfg.get('IMAGE','MTNK').upper(), {})
            clean = cfg and art and not yes(cfg.get('ISVEINHOLE','no'))
            safe = all(item.get('category')=='UNITS' and item.get('type')=='MTNK' and item.get('onBridge') is False
                       and type(item.get('x')) is int and type(item.get('y')) is int for item in items)
            if clean and safe:
                targets = [(item['x'],item['y']) for item in plan['placements']]
                coordinates = {(item['x'],item['y']) for item in items}
                if len(set(targets)) == len(targets) and all(
                    (cell := self.original_cells.get(p)) and cell['usable'] and cell['overlay']==255 and
                    not cell['bridge'] and not cell['objects'] and not cell.get('assumedRetry') and
                    cell['status']=='crate' and cell['candidate'] for p in coordinates
                ):
                    theater = dict(self.original_theater)
                    rules = theater['effectiveRules'] = dict(rules, COLORS=dict(rules.get('COLORS', {})))
                    content = {}
                    # Use the ordinary simulation validator and unit INI encoder.
                    apply(plan, content, {p:dict(self.original_cells[p]) for p in coordinates}, rules, self.res.art)
                    original_objects = theater['mapObjects']
                    units = object_records(content)
                    theater['_liveTanks'] = units
                    theater['mapObjects'] = ([o for o in original_objects if o['category']!='AIRCRAFT'] + units +
                                              [o for o in original_objects if o['category']=='AIRCRAFT'])
                    theater['mapHouses'] = {**theater['mapHouses'], **{o['house']:content[o['house']] for o in units}}
                    theater['_layoutDirty'] = dirty
                    cells = dict(self.latest_scene[2])
                    occupied = set(targets)
                    for p in dirty:
                        base = self.original_cells[p]
                        if p not in occupied:
                            cells[p] = base
                            continue
                        cells[p] = dict(base, occupied=True, occupiedGround=True, candidate=False,
                                        objects=['MTNK'], objectsGround=['MTNK'],
                                        removable=[dict(category='unit', type='MTNK')])
                        if self.meta.get('approximate'):
                            cells[p]['knownOccupiedGround'] = True
                    self.prepared['previous'] = plan, cells
                    return cells, theater
        cells, _, theater, _, meta = rebuild_layout(self.prepared, self.res, plan, noop, incremental=True)
        if self.meta.get('approximate'):
            from realmap_approx import prepare
            meta['engineVersion'] = self.meta.get('engineVersion', self.meta['version'])
            prepare(cells, self.res, theater, meta)
        return cells, theater

    def full_search(self):
        ensure_tools()
        with TemporaryDirectory(prefix='crate-search-') as temporary:
            source, result = (Path(temporary)/name for name in ('grid.bin','search.bin'))
            source.write_bytes(self.grid)
            maximum = self.store.maximum
            run([TOOLS/'map-search.exe', source, result, maximum, min(maximum+1,32)],180)
            return list(read_search(result, maximum**2))

    def edit(self, payload):
        started = perf_counter()
        revision = payload['revision']
        if type(payload.get('planEcho', True)) is not bool or type(payload.get('compact', False)) is not bool:
            raise ValueError('Invalid live response flags')
        with self.lock:
            if type(revision) is not int or revision <= self.layout_version or payload['from'] != self.layout_version:
                raise ValueError('Invalid live edit revision')
            delta = payload['delta']
            plan = dict(self.plan)
            for name in ('objects', 'overlays'):
                table = plan[name] = dict(self.plan[name])
                for key, value in delta[name].items():
                    if value is None:
                        table.pop(key, None)
                    else:
                        table[key] = value
            placements = {item['id']: item for item in self.plan['placements']}
            for key, value in delta['placements'].items():
                if value is None:
                    placements.pop(key, None)
                elif value['id'] == key:
                    placements[key] = value
                else:
                    raise ValueError('Invalid live object ID')
            order = delta.get('order')
            if len(placements)>20000 or len(plan['objects'])>100000 or len(plan['overlays'])>262144:
                raise ValueError('Live simulation plan exceeds the object limit')
            if order is not None and (len(order) != len(placements) or set(order) != placements.keys()):
                raise ValueError('Invalid live object order')
            plan['placements'] = list(placements.values()) if order is None else [placements[key] for key in order]
            cells, theater = self.rebuild(plan)
            layout_ms = (perf_counter()-started)*1000
            with self.ready:
                self.latest_scene = revision, plan, cells, theater
                self.ready.notify_all()
            dirty = theater['_layoutDirty']
            for x, y in dirty:
                index = y*512+x
                cell = cells[x,y]
                self.grid[index], self.statuses[index] = flags(cell), STATUS.get(cell['status'], 0)
            solve_started = perf_counter()
            _, stats = self.store.update(self.grid, self.statuses, self.full_search, changed_keys=(y*512+x for x,y in dirty))
            touched = self.store.dirty.copy()
            dependency_ms=(perf_counter()-solve_started)*1000
            aggregate_started=perf_counter()
            changed = dirty | {(k & 511, k >> 9) for k in touched}
            computed = self.store.calculate(result_keys=(y*512+x for x,y in changed))
            aggregate_ms=(perf_counter()-aggregate_started)*1000
            solve_ms = (perf_counter()-solve_started)*1000
            kernel = self.store.kernel
            maximum_numerator = kernel['maximumNumerator']
            results = computed.pop('cells')
            changes = []
            for p in sorted(changed):
                if p not in cells:
                    continue
                x,y = p
                cell = {**cells[p], **results.get(y*512+x, ZERO)}
                cell['marked'] = bool(cell['rockTransition'] and cell['terms'])
                cell['potentialMarked'] = bool(self.display_cells[p].get('potentialMarked') and not cell['marked'])
                if self.display_cells[p].get('clearance') is not None:
                    cell['clearance'] = self.display_cells[p]['clearance']
                changes.append(cell)
                self.markers.discard(p)
                self.shadowed.discard(p)
                if cell['marked']:
                    self.markers.add(p)
                elif cell['rockTransition'] and cell['candidate'] and (cell['track'] or cell['float']):
                    self.shadowed.add(p)
            compact = payload.get('compact', False)
            previous = self.sent_probability
            sets = [[['probability', k], v] for k,v in computed.items()
                    if k != 'exact' and (not compact or previous.get(k) != v)]
            if kernel['coefficientsReused']:
                sets.extend([['probability','exact',key],computed['exact'][key]]
                            for key in ('failureNumerator','ghostNumerator','exhaustedNumerator')
                            if not compact or previous.get('exact', {}).get(key) != computed['exact'][key])
            else:
                sets.append([['probability','exact'],computed['exact']])
            sets.extend([
                [['markers'], sorted(self.markers)],
                [['zeroProbabilityRockCandidates'], sorted(self.shadowed)],
            ])
            if payload.get('planEcho', True):
                sets.append([['metadata','simulationPlan'], plan])
            self.plan, self.layout_version, self.sent_probability = plan, revision, computed
            return dict(probabilityPatch=1, live=True, reweighted=not kernel['coefficientsReused'], baseRevision=payload['baseRevision'],
                        probabilityRevision=f'{self.token}-{revision}', revision=revision,
                        maximumNumerator=str(maximum_numerator),
                        sourceSha256=self.meta['sourceSha256'], version=self.meta['version'],
                        cellCount=len(cells), cells=changes, sets=sets, removed=[],
                        timing=dict(layoutMs=layout_ms, solveMs=solve_ms, dependencyMs=dependency_ms, aggregateMs=aggregate_ms,
                                    aggregateMode=kernel['aggregateMode'], evaluatedDistributions=kernel['evaluatedDistributions'],
                                    examinedOrigins=stats['examinedOrigins'], coefficientsReused=kernel['coefficientsReused'], totalMs=(perf_counter()-started)*1000,
                                    searched=stats['searchedOrigins'], destinations=len(touched)))

    def sources(self, payload):
        """Read current native candidates on demand, without rendering a report."""
        with self.lock:
            if type(payload.get('revision')) is not int or payload['revision'] != self.layout_version:
                raise ValueError('Live source revision changed')
            return dict(revision=self.layout_version,
                        search=base64.b64encode(self.store.export()).decode('ascii'))

    def resume(self, state):
        """Rebuild acknowledged checkpoints without rendering a full report.

        Probability and artwork can acknowledge different revisions. Replaying
        a partial artwork plan and then its complete predecessor marks their
        union dirty, including an edit that was already undone by the client.
        """
        if not isinstance(state, dict):
            raise ValueError('Invalid live resume checkpoint')
        probability, painted = state.get('probability'), state.get('painted')
        if any(type(n) is not int or not 0 <= n <= 2**53-1 for n in (probability, painted)):
            raise ValueError('Invalid live resume revision')

        def seed(plan):
            if (not isinstance(plan, dict) or plan.get('schema') != 1 or plan.get('map') != self.plan['map']
                    or any(not isinstance(plan.get(k), dict) for k in ('objects', 'overlays'))
                    or not isinstance(plan.get('placements'), list)):
                raise ValueError('Invalid live resume plan')
            if plan == self.plan:
                return
            delta = {}
            for name in ('objects', 'overlays', 'placements'):
                a, b = self.plan[name], plan[name]
                if name == 'placements':
                    a, b = ({item['id']: item for item in entries} for entries in (a, b))
                delta[name] = {k:b.get(k) for k in a.keys() | b.keys() if a.get(k) != b.get(k)}
            delta['order'] = [item['id'] for item in plan['placements']]
            self.edit(dict(**{'from':self.layout_version}, revision=self.layout_version+1,
                           delta=delta, baseRevision='resume', planEcho=False, compact=True))

        def seed_art(plan, version):
            seed(plan)
            _, _, cells, theater = self.latest_scene
            self.scene.update(cells, theater, changed_points(self.prepared, self.plan, self.scene_plan), version)
            self.scene_plan, self.art_version = self.plan, version

        seed_art(state.get('paintPlan'), painted)
        self.scene.tile_revisions.clear()
        partial = state.get('partial')
        if partial is not None:
            version = partial.get('revision') if isinstance(partial, dict) else None
            if type(version) is not int or not painted < version <= 2**53-1:
                raise ValueError('Invalid partial artwork revision')
            seed_art(partial.get('plan'), version)
            seed_art(state['paintPlan'], version)
        seed(state.get('plan'))
        self.art_version = painted
        self.layout_version = probability
        self.latest_scene = probability, self.plan, *self.latest_scene[2:]

    def paint(self, payload):
        if type(payload.get('planEcho', True)) is not bool:
            raise ValueError('Invalid live plan echo flag')
        with self.art_lock:
            with self.ready:
                target = payload.get('target', 0)
                if type(target) is not int or target < 0:
                    raise ValueError('Invalid live artwork target')
                if not self.ready.wait_for(lambda: self.latest_scene[0] >= target, timeout=2):
                    raise ValueError('Live layout was not prepared')
                revision, plan, cells, theater = self.latest_scene
            base = payload['from']
            if type(base) is not int or not 0 <= base <= revision:
                raise ValueError('Invalid live artwork base')
            limit = payload.get('limit')
            offset = payload.get('offset', 0) if payload.get('revision') == revision else 0
            focus = payload.get('focus')
            if (limit is not None and (type(limit) is not int or not 1 <= limit <= 16)
                    or type(offset) is not int or offset < 0
                    or focus is not None and (not isinstance(focus, list) or len(focus) != 2
                        or any(type(n) is not int or abs(n) > 65536 for n in focus))):
                raise ValueError('Invalid live artwork batch')
            known_ground = payload.get('knownGrounds', [])
            if (not isinstance(known_ground, list) or len(known_ground) > 64 or
                    any(not isinstance(k, str) or len(k) > 96 for k in known_ground)):
                raise ValueError('Invalid artwork ground checkpoint')
            update_started = perf_counter()
            if revision != self.art_version:
                dirty = changed_points(self.prepared, plan, self.scene_plan)
                self.scene.update(cells, theater, dirty, revision)
                self.scene_plan, self.art_version = plan, revision
            update_ms = (perf_counter()-update_started)*1000
            result = self.scene.paint(theater, base, limit=limit, offset=offset, focus=focus,
                                      known_ground=known_ground)
            response = dict(result, sceneUpdateMs=round(update_ms, 3), revision=revision)
            if payload.get('planEcho', True):
                response['plan'] = plan
            return response

    def close(self):
        with self.art_lock:
            self.scene.close()


_sessions = OrderedDict()
_lock = Lock()
_baseline_lock = Lock()
_baseline = None  # One immutable map baseline, shared by at most two live editors.
_expired = OrderedDict()
_released_leases = OrderedDict()


def lease_value(payload):
    value = payload.get('lease')
    if value is not None and (not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', value)):
        raise ValueError('Invalid live opening lease')
    return value


def baseline_key(path, inputs):
    report, _, data, res = inputs
    rendering = report['rendering']
    paths = [path, path.parent/'search.bin', path.parent/'search-grid.bin']
    if rendering.get('image'):
        paths.append(path.parent/rendering['image'])
    stamps = []
    for item in paths:
        try:
            stat = item.stat();stamps.append((str(item.resolve()), stat.st_size, stat.st_mtime_ns))
        except OSError:
            stamps.append((str(item.resolve()), None))
    return (tuple(stamps), hashlib.sha256(data).digest(), hashlib.sha256(res.rules_bytes).digest(),
            getattr(res, 'art_hash', None), getattr(res, 'discovery', {}).get('fingerprint'))


def prepared_session(path, revision):
    """Revalidate inputs on every open, then fork already verified native inputs."""
    global _baseline
    start = perf_counter()
    report, cells = load_report(path)
    loaded = perf_counter()
    data = source_bytes(report, path)
    sourced = perf_counter()
    res = resource_context(report, path)[0]
    inputs = report, cells, data, res
    key = baseline_key(path, inputs)
    timing = dict(validationMs=(perf_counter()-start)*1000)
    timing.update(loadReportMs=(loaded-start)*1000, sourceMs=(sourced-loaded)*1000,
                  resourceMs=(perf_counter()-sourced)*1000)
    timing['contextReused'] = bool(getattr(inputs[3], 'context_reused', False))
    waiting = perf_counter()
    with _baseline_lock:
        timing['waitMs'] = (perf_counter()-waiting)*1000
        reused = _baseline is not None and _baseline[0] == key
        built = perf_counter()
        if not reused:
            template = LiveSession(path, inputs=inputs)
            old = _baseline
            _baseline = key, template
            if old is not None:
                old[1].close()
        timing['baselineMs'] = (perf_counter()-built)*1000
        forked = perf_counter()
        session = _baseline[1].fork(revision, inputs[3])
        timing.update(forkMs=(perf_counter()-forked)*1000, baselineReused=reused)
    return session, timing


def retire_locked(token, reason):
    """Caller holds the registry lock. In-flight requests retain their inputs."""
    session = _sessions.pop(token, None)
    if session is None:
        return None
    _expired[token] = reason
    while len(_expired) > 32:
        _expired.popitem(last=False)
    session.retired = True
    return session if not getattr(session, 'requests', 0) else None


def release_session(payload):
    lease = lease_value(payload)
    with _lock:
        if lease is not None:
            _released_leases[lease] = True
            while len(_released_leases) > 128:
                _released_leases.popitem(last=False)
        tokens = [token for token,s in _sessions.items() if token == payload.get('session') or
                  lease is not None and getattr(s, 'lease', None) == lease]
        sessions = [s for token in tokens if (s := retire_locked(token, 'released-by-client')) is not None]
    for session in sessions:
        session.close()
    return dict(released=True)


def open_session(payload):
    started = perf_counter()
    lease = lease_value(payload)
    include_source = payload.get('includeSource', False)
    if type(include_source) is not bool:
        raise ValueError('Invalid live bootstrap flag')
    with _lock:
        if lease is not None and lease in _released_leases:
            raise CancelledOpen('Live opening was cancelled')
    revision = payload.get('revision', 0)
    if type(revision) is not int or revision < 0:
        raise ValueError('Invalid live base revision')
    session, timing = prepared_session(result_path(payload['result']), revision)
    try:
        resumed = perf_counter()
        if payload.get('resume') is not None:
            session.resume(payload['resume'])
        timing['resumeMs'] = (perf_counter()-resumed)*1000
        sourced = perf_counter()
        if include_source:
            from map_results import simulation_source
            source = simulation_source(session.report, session.scene.path, context=(session.res,session.original_theater))
        timing['sourceModelMs'] = (perf_counter()-sourced)*1000
    except Exception:
        session.close()
        raise
    session.lease = lease
    with _lock:
        cancelled = lease is not None and lease in _released_leases
        if not cancelled:
            _sessions[session.token] = session
        old = None
        if not cancelled and len(_sessions) > 2:
            # Opening read-only tabs must not evict the editor currently in use.
            # Keep the same memory bound, first replacing an unused warmup.
            idle = next((key for key,value in _sessions.items() if key != session.token
                         and not getattr(value, 'requests', 0)), next(iter(_sessions)))
            victim = next((key for key,value in _sessions.items()
                           if key != session.token and value.layout_version == 0
                           and value.latest_scene[0] == 0 and not getattr(value, 'requests', 0)), idle)
            old = retire_locked(victim, 'capacity-evicted')
    if cancelled:
        session.close()
        raise CancelledOpen('Live opening was cancelled')
    if old is not None:
        old.close()
    timing['totalMs'] = (perf_counter()-started)*1000
    result = dict(session=session.token, revision=session.layout_version, timing=timing)
    if include_source:
        result['source'] = source
    return result


def request(payload, action):
    with _lock:
        session = _sessions.get(payload.get('session'))
        if session is None:
            raise ExpiredSession('Live edit session expired', _expired.get(payload.get('session'), 'unknown-or-server-restarted'))
        _sessions.move_to_end(session.token)
        session.requests = getattr(session, 'requests', 0)+1
    try:
        return getattr(session, action)(payload)
    finally:
        with _lock:
            session.requests -= 1
            close = not session.requests and getattr(session, 'retired', False)
        if close:
            session.close()


@atexit.register
def close_all():
    global _baseline
    with _lock:
        sessions = [session for token in list(_sessions) if (session := retire_locked(token, 'server-stopped')) is not None]
    for session in sessions:
        session.close()
    with _baseline_lock:
        if _baseline is not None:
            _baseline[1].close()
            _baseline = None
