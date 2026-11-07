"""Shared report access, source validation and resource provenance.

Consumers treat cached reports as read-only. This module has no dependency on
the HTTP server or either renderer; heavy resource imports are deferred.
"""
from functools import lru_cache
from collections import OrderedDict
from copy import copy
import hashlib
import json
from pathlib import Path
import re
import threading
from map_storage import storage_path, read_json, singleflight

ROOT = Path(__file__).resolve().parent
_contexts = OrderedDict()
_context_lock = threading.Lock()
_effective_rules = OrderedDict()
_published_lock = threading.Lock()
_published_report = None  # Latest completed report, shared read-only by its consumers.


def _dependency_names(res):
    """Include absent optional files: appearing later can change the context."""
    ctx = res.context
    names = {ctx.config.get('rules', 'rulesmd.ini'), ctx.config.get('art')}
    names.update(ctx.config.get('csf', []))
    if ctx.config.get('ares_stringtables'):
        names.update(f'stringtable{i:02}.csf' for i in range(100))
    names.update(entry.value for doc in ctx.documents.values() for entry in doc.rows('#include'))
    names.update(info['name'] for _, info in ctx.resources.cache.values())
    return sorted(name for name in names if name)


def _dependency_stamp(root, names):
    from ra2mod import local_path, Slice
    entries, stamps = {}, []
    root = Path(root).resolve()
    for name in names:
        try:
            path = local_path(root, name, entries=entries)
            # Hash loose definitions, even if their size/mtime were preserved.
            # Packed members are covered by discovery's archive fingerprint.
            source = Slice(path, 0, path.stat().st_size, str(path)) if path.is_file() else None
            stamps.append((name, hashlib.sha256(source.read()).hexdigest() if source else None))
        except (OSError, ValueError) as error:
            stamps.append((name, type(error).__name__, str(error)))
    return tuple(stamps)


def _directory_context(meta, path):
    from realmap_mod import ModResources, discovery_for_report
    found = discovery_for_report(meta)  # Revalidate archives even on cache hits.
    root = found['config']['root']
    # Generated render folders of the same map share one rules context. A
    # map-local include still makes its directory part of resource identity.
    content = source_ini(source_bytes({'metadata': meta}, path))
    local_scope = str(path.parent.resolve()) if '#INCLUDE' in content else None
    key = (str(Path(root).resolve()), found['fingerprint'],
           local_scope, meta['sourceSha256'], meta['theater'])
    with _context_lock:
        entry = _contexts.get(key)
        reused = entry is not None and _dependency_stamp(root, entry[2]) == entry[3]
        if not reused:
            res = ModResources(root, path.parent/'source.map')
            theater = res.theater(meta['theater'])
            names = _dependency_names(res)
            entry = (res, theater, names, _dependency_stamp(root, names))
            _contexts[key] = entry
        _contexts.move_to_end(key)
        while len(_contexts) > 2:
            _contexts.popitem(last=False)
        # Per-request readers can cache sprites without retaining an unbounded
        # image collection in the context cache or sharing mutable dictionaries.
        res = copy(entry[0]); res.context = copy(res.context)
        reader = copy(res.context.resources)
        for attr in ('cache', 'mix_cache', 'archive_info'):
            setattr(reader, attr, dict(getattr(reader, attr)))
        res.context.resources = reader
        res.context_reused = reused
        return res, dict(entry[1])


def remember_analysis_context(meta, path, res):
    """Publish a completed analysis's already-read resources for its first viewer."""
    if meta.get('version') != 'directory' or meta.get('simulationPlan'):
        return
    from realmap_mod import discovery_for_report
    root = res.discovery['config']['root']
    content = source_ini(source_bytes({'metadata':meta}, path))
    # Map-local include provenance is still handled by the ordinary loader.
    if '#INCLUDE' in content:
        return False
    try:
        discovery_for_report(meta)
    except (OSError, ValueError):
        return False  # Inputs changed while rendering; never seed stale data.
    local_scope = None
    key = (str(Path(root).resolve()), res.discovery['fingerprint'], local_scope,
           meta['sourceSha256'], meta['theater'])
    names = _dependency_names(res)
    stamps = _dependency_stamp(root, names)
    loaded = {name.casefold():info for _,info in res.context.resources.cache.values() for name in [info['name']]}
    for row in stamps:
        if len(row) != 2:
            return False
        name, current = row
        if current is not None:
            observed = loaded.get(name.casefold())
            if observed is None or observed['sha256'] != current:
                return False  # Detect loose-file edits with preserved size/mtime.
    entry = res, res.theater(meta['theater']), names, stamps
    with _context_lock:
        _contexts[key] = entry
        _contexts.move_to_end(key)
        while len(_contexts) > 2:
            _contexts.popitem(last=False)
    return True


def result_path(value):
    if not isinstance(value, str) or not re.fullmatch(r'/output/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+){0,2}/result\.json', value):
        raise ValueError('需要本工具生成的地图分析结果')
    path = storage_path((ROOT/value.lstrip('/')).resolve()).resolve()
    if not path.is_relative_to((ROOT/'output').resolve()) or not path.is_file():
        raise ValueError('地图分析结果不存在，请重新分析地图')
    return path


@singleflight
@lru_cache(maxsize=2)
def read_report(path, size, modified):
    report = read_json(path)
    return report, {(c['x'], c['y']): c for c in report.get('cells', [])}


def load_report(path):
    path = storage_path(path)
    stat = path.stat()
    key = str(path.resolve()), stat.st_size, stat.st_mtime_ns
    with _published_lock:
        if _published_report is not None and _published_report[0] == key:
            return _published_report[1]
    return read_report(*key)


def remember_report(path, report):
    global _published_report
    path = storage_path(path)
    stat = path.stat()
    key = str(path.resolve()), stat.st_size, stat.st_mtime_ns
    value = report, {(c['x'],c['y']):c for c in report.get('cells', [])}
    with _published_lock:
        _published_report = key, value


def source_bytes(report, path, *, required=True):
    try:
        data = (path.parent/'source.map').read_bytes()
    except OSError as error:
        if not required:
            return None
        raise ValueError('原地图记录缺失或无法读取，请重新导入地图') from error
    if hashlib.sha256(data).hexdigest() != report['metadata']['sourceSha256']:
        raise ValueError('原地图记录已变化，请重新导入地图')
    return data


@lru_cache(maxsize=2)
def source_ini(data):
    from realmap_format import ini
    return ini(data)


def resource_context(report, path):
    from realmap_format import ini, sha
    from realmap_resources import resources
    path = Path(path)
    meta = report['metadata']
    directory = meta['version'] in ('directory', 'shikong')
    data = source_bytes(report, path, required=directory)
    if directory:
        res, theater = _directory_context(meta, path)
        if meta.get('artSha256') and res.art_hash != meta['artSha256']:
            raise ValueError('当前 art 定义与该分析结果不一致，请重新分析地图')
    else:
        res = resources(meta['version'])
        theater = res.theater(meta['theater'])
    if theater['configSha256'] != meta['theaterSha256'] or sha(res.rules_bytes) != meta['rulesSha256']:
        raise ValueError('当前资源与该分析结果不一致，请重新分析地图')
    identity = (meta['rulesSha256'], meta['sourceSha256'])
    with _context_lock:
        rules = _effective_rules.get(identity)
        if rules is None:
            rules = dict(res.rules)
            if data is not None:
                for key, value in source_ini(data).items():
                    if not key.endswith('PACK') and key != 'ISOMAPPACK5':
                        rules[key] = {**rules.get(key, {}), **value}
            _effective_rules[identity] = rules
        _effective_rules.move_to_end(identity)
        while len(_effective_rules) > 2: _effective_rules.popitem(last=False)
    theater['effectiveRules'] = {key:dict(section) for key,section in rules.items()}
    theater['mapLighting'] = source_ini(data).get('LIGHTING', {}) if data is not None else {}
    return res, theater

def simulation_source(report, path, *, context=None):
    from realmap_simulation import recipe, CELL_FIELDS
    from realmap_format import ini, yes
    from realmap_parser import map_rules, tolerant_rules, land_after
    meta = report['metadata']
    if meta.get('version') not in ('ra2', 'yr', 'directory', 'shikong') or meta.get('previewOnly'):
        raise ValueError('当前结果没有可编辑的地图布局，请重新分析地图')
    if meta.get('mineralsEnabled') is False or meta.get('simulationPlan'):
        raise ValueError('请从默认布局载入模拟编辑源地图')
    content = source_ini(source_bytes(report, path))
    res, theater = context if context is not None else resource_context(report, path)
    rules = tolerant_rules(content, res) if meta.get('approximate') else map_rules(content, res, [])[0]
    return dict(schema=1, sourceSha256=meta['sourceSha256'], version=meta['version'],
                map=recipe(content, rules), rules=rules, art=res.art, approximate=bool(meta.get('approximate')),
                allowOre={file:yes(theater['config'][section].get('ALLOWTIBERIUM','no')) for section,file,_ in theater['definitions']},
                cells=[{**{k: c.get(k) for k in CELL_FIELDS},'tileLand':land_after(c['rawLand'],c['slope'],None,c.get('higher',[]),meta.get('cliffBackImpassability',2))} for c in report['cells']])
