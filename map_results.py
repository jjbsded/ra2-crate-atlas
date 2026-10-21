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

ROOT = Path(__file__).resolve().parent
_contexts = OrderedDict()
_context_lock = threading.Lock()


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
    for name in names:
        try:
            path = local_path(Path(root).resolve(), name, entries=entries)
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
    key = (str(Path(root).resolve()), found['fingerprint'],
           str(path.parent.resolve()), meta['sourceSha256'], meta['theater'])
    with _context_lock:
        entry = _contexts.get(key)
        if entry is None or _dependency_stamp(root, entry[2]) != entry[3]:
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
        return res, dict(entry[1])


def result_path(value):
    if not isinstance(value, str) or not re.fullmatch(r'/output/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+){0,2}/result\.json', value):
        raise ValueError('需要本工具生成的地图分析结果')
    path = (ROOT/value.lstrip('/')).resolve()
    if not path.is_relative_to((ROOT/'output').resolve()) or not path.is_file():
        raise ValueError('地图分析结果不存在，请重新分析地图')
    return path


@lru_cache(maxsize=2)
def read_report(path, size, modified):
    report = json.loads(Path(path).read_text('utf8'))
    return report, {(c['x'], c['y']): c for c in report.get('cells', [])}


def load_report(path):
    path = Path(path)
    stat = path.stat()
    return read_report(str(path.resolve()), stat.st_size, stat.st_mtime_ns)


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
    rules = {k: dict(v) for k, v in res.rules.items()}
    if data is not None:
        for key, value in ini(data).items():
            if not key.endswith('PACK') and key != 'ISOMAPPACK5':
                rules.setdefault(key, {}).update(value)
    theater['effectiveRules'] = rules
    return res, theater
