"""Transactional per-origin search records and reversible integer incidence.

The dependency envelope is the OLD search's stopping square, not a fixed 3x3
neighborhood. This includes cells rejected during the search and preserves
duplicate r=0 entries, order, primary filtering and the 24-candidate cap.
"""
from collections import Counter, OrderedDict, defaultdict
from contextlib import contextmanager, closing
from functools import lru_cache
import hashlib
import heapq
import json
import math
from pathlib import Path
import sqlite3
import struct
import threading
import time
import uuid

from runtime_bootstrap import ROOT

SCHEMA = 3
_local = threading.local()
_memory = OrderedDict()
_lock = threading.RLock()


@contextmanager
def session(force=False, publish=None, defer_render=False):
    previous = getattr(_local, 'options', None)
    _local.options = dict(force=force, publish=publish, defer_render=defer_render)
    try:
        yield
    finally:
        _local.options = previous


def defer_render_requested():
    return bool((getattr(_local, 'options', None) or {}).get('defer_render'))


def force_requested():
    return bool((getattr(_local, 'options', None) or {}).get('force'))


def publish_probability(cells, computed, metadata):
    options = getattr(_local, 'options', None)
    if options and options.get('publish'):
        options['publish'](dict(metadata=metadata, cells=list(cells.values()), **computed))


@lru_cache(maxsize=1)
def model_stamp():
    return hashlib.sha256(b''.join((ROOT/name).read_bytes() for name in
        ('incremental_probability.py', 'realmap_exact.py', 'realmap-search.c'))).hexdigest()


def search_one(grid, sx, sy, maximum):
    picked = []; primary = 0
    movement = 2 if grid[sy*512+sx] & 8 else 1
    def consider(x, y):
        nonlocal primary
        if len(picked) == 24 or not 0 <= x < 512 or not 0 <= y < 512:
            return
        key = y*512+x
        if grid[key] & movement:
            picked.append(key)
            primary += bool(grid[key] & 4)
    for radius in range(min(maximum+1, 32)):
        for d in range(-radius, radius+1):
            if len(picked) == 24:
                break
            consider(sx+d, sy-radius); consider(sx+d, sy+radius)
        for d in range(1-radius, radius):
            if len(picked) == 24:
                break
            consider(sx-radius, sy+d); consider(sx+radius, sy+d)
        if len(picked) == 24 or primary:
            break
    return tuple(key for key in picked if not primary or grid[key] & 4), radius


def stopping_radius(grid, selected, origin, maximum):
    if not selected or len(selected) < 24 and not any(grid[k] & 4 for k in selected):
        return min(maximum+1, 32)-1
    x, y = origin % maximum+1, origin//maximum+1
    return max(max(abs((key & 511)-x), abs((key >> 9)-y)) for key in selected)


class Store:
    def __init__(self, maximum, grid, statuses, records, radii=None):
        # Parsing reads force_requested() without opening a probability store.
        # Keep numerical dependencies out of that lightweight path.
        global np, evaluate_aggregates, terminal_signature, IDS
        import numpy as np
        from realmap_exact import evaluate_aggregates, terminal_signature, IDS
        self.maximum = maximum
        origin_indices=np.arange(maximum**2)
        self.origin_x,self.origin_y=origin_indices%maximum+1,origin_indices//maximum+1
        self.grid, self.statuses = bytes(grid), bytes(statuses)
        self.records = list(records)
        if not 1 <= maximum <= 510 or len(self.records) != maximum**2 or len(grid) != 262144 or len(statuses) != 262144:
            raise ValueError('Invalid incremental probability dimensions')
        if any(len(row) > 24 or any(not 0 <= key < 262144 for key in row) for row in self.records):
            raise ValueError('Invalid incremental candidate record')
        self.radii = bytearray(radii if radii is not None else
            (stopping_radius(grid, row, i, maximum) for i, row in enumerate(self.records)))
        if len(self.radii) != maximum**2 or any(r >= min(maximum+1, 32) for r in self.radii):
            raise ValueError('Invalid incremental dependency envelope')
        # A block bounds the OLD stopping squares of its origins. Its maximum
        # radius is conservative, then the ordinary per-origin test is exact.
        self.block_size = 16
        self.block_width = (maximum+self.block_size-1)//self.block_size
        blocks = np.arange(self.block_width**2)
        self.block_left = (blocks % self.block_width)*self.block_size+1
        self.block_top = (blocks // self.block_width)*self.block_size+1
        self.block_right = np.minimum(maximum, self.block_left+self.block_size-1)
        self.block_bottom = np.minimum(maximum, self.block_top+self.block_size-1)
        self.block_radius = np.empty(len(blocks), dtype=np.uint8)
        self.radius_grid = np.frombuffer(self.radii, np.uint8).reshape(maximum, maximum)
        self.refresh_envelopes(blocks)
        self.terms = defaultdict(Counter); self.ghost = Counter(); self.terminal = Counter()
        self.counts = Counter(); self.kernel = {}; self.revision = None; self.stamp = None
        self.binary = None
        self.dirty = None
        self.aggregate_summary = None
        self.aggregate_terminal = self.aggregate_ghost = None
        self.maximum_heap = []
        for row in self.records:
            self.contribute(row, statuses, 1)

    def refresh_envelopes(self, blocks):
        for block in blocks:
            l, t = self.block_left[block]-1, self.block_top[block]-1
            self.block_radius[block] = self.radius_grid[t:self.block_bottom[block], l:self.block_right[block]].max()

    def affected_envelopes(self, changes):
        blocks = set()
        for key in changes:
            x, y = key % 512, key // 512
            radius = self.block_radius
            blocks.update(np.flatnonzero((self.block_left-radius <= x) & (self.block_right+radius >= x) &
                                         (self.block_top-radius <= y) & (self.block_bottom+radius >= y)).tolist())
        found = []
        examined = 0
        for block in blocks:
            l, t = self.block_left[block]-1, self.block_top[block]-1
            r, b = self.block_right[block], self.block_bottom[block]
            radius = self.radius_grid[t:b, l:r]
            x, y = np.arange(l+1, r+1)[None, :], np.arange(t+1, b+1)[:, None]
            mask = np.zeros(radius.shape, dtype=np.bool_)
            for key in changes:
                mask |= (np.abs(x-(key % 512)) <= radius) & (np.abs(y-(key // 512)) <= radius)
            ys, xs = np.nonzero(mask)
            found.extend(((ys+t)*self.maximum+xs+l).tolist())
            examined += radius.size
        return np.array(sorted(found), dtype=np.int64), examined

    def contribute(self, row, statuses, sign, touched=None):
        n = len(row); self.counts[n] += sign
        if not n:
            return
        for residue, key in enumerate(row):
            pair = n, residue
            status = statuses[key]
            if status in (1,2):
                self.terminal[pair] += sign
                if not self.terminal[pair]: del self.terminal[pair]
            if status == 1:
                terms = self.terms[key]; terms[pair] += sign
                if not terms[pair]:
                    del terms[pair]
                if not terms:
                    del self.terms[key]
                if touched is not None:
                    touched.add(key)
            elif status == 2:
                self.ghost[pair] += sign
                if not self.ghost[pair]:
                    del self.ghost[pair]

    def update(self, grid, statuses, full_search=None, changed_keys=None):
        start = time.perf_counter(); maximum = self.maximum
        if changed_keys is None:
            changes = np.flatnonzero((np.frombuffer(self.grid, np.uint8) != np.frombuffer(grid, np.uint8)) |
                                    (np.frombuffer(self.statuses, np.uint8) != np.frombuffer(statuses, np.uint8)))
        else:
            changes=np.fromiter((k for k in changed_keys if self.grid[k]!=grid[k] or self.statuses[k]!=statuses[k]),dtype=np.int64)
        x,y=self.origin_x,self.origin_y;r=np.frombuffer(self.radii,np.uint8)
        if len(changes)<=8:
            affected, examined = self.affected_envelopes(changes)
            dependency_mode='blocked-envelopes'
        else:
            # Larger edits share one summed-area table, preserving the exact
            # old search envelopes without revisiting each changed square.
            changed=np.zeros((513,513),dtype=np.int32)
            changed[changes//512+1,changes%512+1]=1
            changed=changed.cumsum(axis=0).cumsum(axis=1)
            left,top=np.maximum(0,x-r),np.maximum(0,y-r)
            right,bottom=np.minimum(512,x+r+1),np.minimum(512,y+r+1)
            affected=np.flatnonzero(changed[bottom,right]-changed[top,right]-changed[bottom,left]+changed[top,left])
            dependency_mode='summed-area';examined=maximum**2
        # For broad clears, C's full scan is faster than thousands of Python
        # ring walks. Still replace only affected incidence, never approximate.
        rebuilt = list(full_search()) if len(affected) > 512 and full_search else None
        touched = set(); changed_rows = []; searched = 0
        for origin in affected.tolist():
            old = self.records[origin]
            # Status changes also affect incidence even when the candidate list
            # stays identical. Conservative re-search of the envelope is cheap.
            if rebuilt is None:
                new, radius = search_one(grid, origin % maximum+1, origin//maximum+1, maximum)
            else:
                new = tuple(rebuilt[origin]); radius = stopping_radius(grid, new, origin, maximum)
            searched += 1
            if old != new or any(self.statuses[key] != statuses[key] for key in old):
                self.contribute(old, self.statuses, -1, touched)
                self.contribute(new, statuses, 1, touched)
            if old != new or radius != self.radii[origin]:
                self.records[origin] = new; self.radii[origin] = radius
                changed_rows.append(origin)
        self.grid, self.statuses = bytes(grid), bytes(statuses)
        if changed_rows:
            self.binary = None
            self.refresh_envelopes({(i//maximum//self.block_size)*self.block_width+(i%maximum//self.block_size) for i in changed_rows})
        if self.dirty is not None:
            self.dirty.update(touched)
        return changed_rows, dict(changedInputCells=len(changes), searchedOrigins=maximum**2 if rebuilt is not None else searched,
            affectedOrigins=searched, bulkSearch=rebuilt is not None,
            changedSearchRecords=len(changed_rows), touchedDestinations=len(touched),
            totalOrigins=maximum**2, dependencyMode=dependency_mode, examinedOrigins=examined, dependencySeconds=time.perf_counter()-start)

    def local_aggregates(self, result_keys=None):
        """Redistribute a fixed exact kernel without rescanning global totals.

        The full evaluator remains authoritative for changed terminal/ghost
        functions and large edits. A zero exact numerator delta additionally
        proves that the cached success/failure summary is still conserved.
        """
        cache = self.kernel
        if (self.aggregate_summary is None or self.dirty is None or len(self.dirty) > 512 or
                len(cache.get('distributions', {})) > 4096 or self.ghost != self.aggregate_ghost):
            return None
        if self.terminal != self.aggregate_terminal:
            # A row with equal deltas at every residue is a constant function.
            # Fully terminating candidate lists commonly move between counts
            # this way. Other changes retain the canonical exact-period test.
            changed_counts = {n for n,r in self.terminal.keys() | self.aggregate_terminal.keys()
                              if self.terminal.get((n,r), 0) != self.aggregate_terminal.get((n,r), 0)}
            constant = 0
            for n in changed_counts:
                delta = self.terminal.get((n,0), 0)-self.aggregate_terminal.get((n,0), 0)
                if any(self.terminal.get((n,r), 0)-self.aggregate_terminal.get((n,r), 0) != delta for r in range(1,n)):
                    if terminal_signature(self.terminal) != cache['weightKey'][2]:
                        return None
                    break
                constant += delta
            else:
                if constant:
                    return None
        distributions, signatures = cache['distributions'], cache['signatures']
        values, denominator = cache['kernel']['values'], cache['kernel']['denominator']
        pending, created, difference = [], {}, 0
        for key in self.dirty:
            before = signatures.get(key)
            hits = self.terms.get(key)
            after = tuple(sorted(hits.items())) if hits else None
            if before == after:
                continue
            if before is not None:
                difference -= distributions[before][0]
            if after is not None:
                value = distributions.get(after) or created.get(after)
                if value is None:
                    numerator = sum(count*values[pair] for pair, count in after)
                    value = created[after] = (numerator, dict(probability=numerator/denominator,
                        multiplier=numerator*self.maximum**2/denominator,
                        terms=[[IDS[pair], count] for pair, count in after],
                        oneAttemptProbability=sum(count/pair[0] for pair, count in after)/self.maximum**2))
                difference += value[0]
            pending.append((key, before, after))
        if difference:
            return None
        distributions.update(created)
        used, cells = cache['usedDistributions'], cache['cellResults']
        for key, before, after in pending:
            if before is not None:
                used[before] -= 1
                if not used[before]:
                    del used[before]
            if after is None:
                signatures.pop(key, None)
                cells.pop(key, None)
            else:
                if not used[after]:
                    heapq.heappush(self.maximum_heap, (-distributions[after][0], after))
                used[after] += 1
                signatures[key] = after
                cells[key] = dict(distributions[after][1])
        if len(self.maximum_heap) > 2*len(used)+64:
            self.maximum_heap = [(-distributions[s][0], s) for s in used]
            heapq.heapify(self.maximum_heap)
        while self.maximum_heap and self.maximum_heap[0][1] not in used:
            heapq.heappop(self.maximum_heap)
        maximum = -self.maximum_heap[0][0] if self.maximum_heap else 0
        counts = sorted(n for n, count in self.counts.items() if n and count)
        selected = dict(cells) if result_keys is None else {key:cells[key] for key in result_keys if key in cells}
        result = dict(self.aggregate_summary, exact=dict(self.aggregate_summary['exact']), cells=selected,
                      period=math.lcm(*counts), candidateCounts=counts, noCandidateOrigins=self.counts[0],
                      positiveCellCount=len(cells), sharedDistributionCount=len(used),
                      maxMultiplier=distributions[self.maximum_heap[0][1]][1]['multiplier'] if self.maximum_heap else 0)
        cache.update(coefficientsReused=True, evaluatedDestinations=len(self.dirty), maximumNumerator=maximum,
                     aggregateMode='delta', evaluatedDistributions=len(pending))
        return result

    def calculate(self, progress=lambda *args: None, *, result_keys=None):
        result_keys = None if result_keys is None else frozenset(result_keys)
        result = self.local_aggregates(result_keys)
        if result is None:
            result = evaluate_aggregates(self.terms, self.ghost, self.counts, self.maximum**2,
                self.counts[0], progress=progress, cache=self.kernel, dirty=self.dirty, terminal=self.terminal)
            distributions, used = self.kernel['distributions'], self.kernel['usedDistributions']
            self.maximum_heap = [(-distributions[s][0], s) for s in used]
            heapq.heapify(self.maximum_heap)
            self.kernel.update(maximumNumerator=-self.maximum_heap[0][0] if self.maximum_heap else 0,
                               aggregateMode='full-summary', evaluatedDistributions=len(used))
            if result_keys is not None:
                result['cells'] = {key:result['cells'][key] for key in result_keys if key in result['cells']}
        else:
            progress('正在计算生成概率', 64)
        self.aggregate_summary = {k:v for k,v in result.items() if k != 'cells'}
        self.aggregate_terminal, self.aggregate_ghost = self.terminal.copy(), self.ghost.copy()
        self.dirty = set()
        return result

    def export(self):
        if self.binary is None:
            self.binary = b''.join(struct.pack('<'+'I'*(len(row)+1), len(row), *row) for row in self.records)
        return self.binary

    def checksum(self):
        return hashlib.sha256(self.grid+self.statuses+self.radii+self.export()).hexdigest()

    @classmethod
    def load(cls, path, identity):
        with closing(sqlite3.connect(path)) as db:
            header = db.execute('SELECT identity, maximum, grid, statuses, revision, checksum FROM state').fetchone()
            if not header or header[0] != identity:
                raise ValueError('Incremental cache identity changed')
            rows = db.execute('SELECT origin, radius, picks FROM origins ORDER BY origin').fetchall()
        if [row[0] for row in rows] != list(range(header[1]**2)):
            raise ValueError('Incomplete incremental cache')
        records = [struct.unpack('<'+'I'*(len(row[2])//4), row[2]) for row in rows]
        value = cls(header[1], header[2], header[3], records, bytes(row[1] for row in rows))
        if value.checksum() != header[5]:
            raise ValueError('Incremental cache checksum mismatch')
        value.revision = header[4]; value.stamp = file_stamp(path)
        return value

    def save(self, path, identity, changed=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path, timeout=10)) as db:
            db.execute('PRAGMA synchronous=NORMAL')
            db.execute('CREATE TABLE IF NOT EXISTS state (identity TEXT, maximum INTEGER, grid BLOB, statuses BLOB, revision TEXT, checksum TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS origins (origin INTEGER PRIMARY KEY, radius INTEGER NOT NULL, picks BLOB NOT NULL)')
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT identity, revision FROM state').fetchone()
            # Another process may have committed while we calculated. Replace
            # the full snapshot in that case; never apply a delta to its base.
            if changed is None or old != (identity, self.revision):
                changed = range(self.maximum**2); db.execute('DELETE FROM origins')
            db.executemany('INSERT OR REPLACE INTO origins VALUES (?, ?, ?)',
                ((i, self.radii[i], struct.pack('<'+'I'*len(self.records[i]), *self.records[i])) for i in changed))
            revision = uuid.uuid4().hex
            db.execute('DELETE FROM state')
            db.execute('INSERT INTO state VALUES (?, ?, ?, ?, ?, ?)',
                       (identity, self.maximum, self.grid, self.statuses, revision, self.checksum()))
            db.commit()
        self.revision = revision; self.stamp = file_stamp(path)


def file_stamp(path):
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def cached(grid, statuses, maximum, folder, meta, full_search, progress, *, kind='current'):
    options = getattr(_local, 'options', None)
    if options is None:
        return None
    identity = json.dumps([SCHEMA, model_stamp(), maximum, kind,
        *[meta.get(k) for k in ('sourceSha256','version','rulesSha256','theaterSha256','artSha256',
                              'resourceFingerprint','approximate','mineralsEnabled')]], separators=(',', ':'))
    key = hashlib.sha256(identity.encode()).hexdigest()
    path = ROOT/'output/incremental-probability'/(key+'.sqlite')
    status_bytes = bytearray(262144)
    for position, value in statuses.items():
        status_bytes[position] = {'crate':1, 'ghost':2}.get(value, 0)
    started = time.perf_counter()
    with _lock:
        value = _memory.pop(key, None); source = 'memory'
        if value is not None and (not path.is_file() or value.stamp != file_stamp(path)):
            value = None
        if options['force']:
            value = None; source = 'forced-full'
        if value is None and path.is_file() and not options['force']:
            try:
                value = Store.load(path, identity); source = 'disk'
            except (sqlite3.Error, ValueError, OSError, struct.error):
                # This is disposable derived data, never an imported map.
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
        if value is None:
            records = full_search()
            value = Store(maximum, grid, status_bytes, records)
            rows = None
            stats = dict(changedInputCells=0, searchedOrigins=maximum**2, changedSearchRecords=maximum**2,
                         touchedDestinations=len(value.terms), totalOrigins=maximum**2)
            source = 'forced-full' if options['force'] else 'built'
        else:
            rows, stats = value.update(grid, status_bytes, full_search)
        try:
            result = value.calculate(progress) if kind == 'current' else None
            persisted = True
            if rows is None or stats['changedInputCells']:
                try:
                    value.save(path, identity, rows)
                except (OSError, sqlite3.Error):
                    persisted = False
            (folder/('search.bin' if kind == 'current' else 'clearance-search.bin')).write_bytes(value.export())
            _memory[key] = value
            while len(_memory) > 4:
                _memory.popitem(last=False)
        except Exception:
            _memory.pop(key, None)
            raise
        stats.update(source=source, persisted=persisted, coefficientsReused=bool(value.kernel.get('coefficientsReused')),
                     evaluatedDestinations=value.kernel.get('evaluatedDestinations', 0),
                     seconds=time.perf_counter()-started, storageBytes=path.stat().st_size if path.is_file() else 0)
        # Bound persistent snapshots as well: two maps, each with current and
        # fully cleared searches. Check only this dedicated cache directory.
        for old in sorted(path.parent.glob('*.sqlite'), key=lambda p:p.stat().st_mtime_ns, reverse=True)[4:]:
            if old != path:
                try:
                    old.unlink()
                except OSError:
                    pass
        return result, stats
