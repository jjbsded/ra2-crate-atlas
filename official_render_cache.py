"""Validated disk reuse of immutable stock reports, with per-request metadata."""
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import shutil
from time import perf_counter
from runtime_bootstrap import ROOT
from map_results import result_path
from map_storage import read_json, synchronized


@lru_cache(maxsize=1)
def renderer_fingerprint():
    files = sorted(ROOT.glob('realmap*.py')) + [ROOT/'terrain_depth.py', ROOT/'runtime/voxel/provenance.json',
                                               ROOT/'voxel-worker.cs', ROOT/'official_render_cache.py', ROOT/'map_images.py']
    return hashlib.sha256(b''.join(p.name.encode()+p.read_text('utf8').encode('utf8') for p in files)).hexdigest()


def key(raw, version, enabled, paths):
    if version not in ('ra2', 'yr'):
        return None
    from official_precomputed import layout_key, manifest, digest, canonical
    import original_resources
    if tuple(str(Path(p).resolve()) for p in paths or ()) != original_resources.resolve(version):
        return None
    value = dict(sourceSha256=digest(raw), version=version, mineralsEnabled=enabled)
    try:
        index = manifest()
        if layout_key(value) not in index['layouts']:
            return None
    except (OSError, ValueError, KeyError):
        return None
    return digest(canonical([value, index['modelSha256'], renderer_fingerprint()]))


def index_path(identity):
    return ROOT/'output/official-render-cache'/(identity+'.json')


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


@synchronized
def reuse(identity, folder, filename, progress):
    if not identity:
        return None
    started = perf_counter()
    try:
        entry = json.loads(index_path(identity).read_text('utf8'))
        if not isinstance(entry, dict) or entry.get('identity') != identity or not isinstance(entry.get('files'), dict):
            return None
        source = result_path(entry['url']).parent
        files = []
        for name, expected in entry['files'].items():
            path = (source/name).resolve()
            if Path(name).is_absolute() or not path.is_relative_to(source.resolve()) or not (folder/name).resolve().is_relative_to(folder.resolve()) or not path.is_file() or checksum(path) != expected:
                return None
            files.append((name, path))
        if not {'source.map', 'search.bin'} <= set(entry['files']) or not {'result.json', 'result.json.gz'} & set(entry['files']):
            return None
        report = read_json(source/'result.json')
        if not isinstance(report, dict) or not isinstance(report.get('metadata'), dict) or report['metadata'].get('approximate') or not report.get('probability'):
            return None
        progress('复用已校验的官方地图画面与概率', 85)
        folder.mkdir(parents=True, exist_ok=True)
        for name, path in files:
            if name in ('result.json', 'result.json.gz'):
                continue
            target = folder/name
            target.parent.mkdir(parents=True, exist_ok=True)
            # Keep new results independent: subsequent rendering or metadata
            # updates must never mutate an older report through a hard link.
            shutil.copy2(path, target)
        meta = report['metadata']
        meta.pop('mineralPreviousResult', None)
        meta['filename'] = Path(filename.replace('\\', '/')).name[:160]
        meta['calculationSource'] = dict(kind='local-cache')
        meta['elapsedSeconds'] = round(perf_counter()-started, 3)
        return report
    except (OSError, ValueError, TypeError, KeyError):
        return None


@synchronized
def remember(identity, folder, url):
    if not identity:
        return
    try:
        report = read_json(folder/'result.json')
        if report['metadata'].get('approximate') or not report.get('probability'):
            return
        files = {p.relative_to(folder).as_posix(): checksum(p) for p in folder.rglob('*')
                 if p.is_file() and p.name not in ('mineral-variants.json',) and p.suffix != '.tmp'}
        target = index_path(identity); target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix('.tmp'); temp.write_text(json.dumps(dict(identity=identity, url=url, files=files)), 'utf8')
        os.replace(temp, target)
    except (OSError, ValueError, TypeError, KeyError):
        pass  # A cache failure must not discard a completed map.
