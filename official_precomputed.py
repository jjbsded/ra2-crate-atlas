"""Optional stock gameplay cache; never supplies rendering or Mod resources."""
from functools import lru_cache
import ast
import gzip
import hashlib
import json
import lzma
import math
import os
import struct
import zlib
from pathlib import Path
from runtime_bootstrap import ROOT

DATA = ROOT/'official-precomputed'
CELL_FIELDS = ('x', 'y', 'terms', 'oneAttemptProbability', 'marked', 'potentialMarked', 'clearance')
RESULT_FIELDS = ('probability', 'markers', 'zeroProbabilityRockCandidates', 'potentialMarkers', 'clearance')
MODEL_FILES = ('realmap_parser.py', 'realmap_format.py', 'realmap_resources.py', 'realmap_bridges.py',
               'realmap_exact.py', 'realmap-search.c', 'original_resources.py', 'official_precomputed.py', 'toy_codec.py')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf8')


@lru_cache(maxsize=1)
def model_fingerprint():
    # Render/UI changes do not invalidate gameplay results. The orchestration
    # module contributes only the two functions that calculate gameplay.
    # Git checkout and archive extraction may normalize LF/CRLF. Those changes
    # do not alter the model and must not invalidate a bundled calculation.
    data = b''.join(name.encode()+(ROOT/name).read_text('utf8').encode('utf8') for name in MODEL_FILES)
    # Read source without importing the orchestration layer back into its cache.
    tree = ast.parse((ROOT/'realmap.py').read_text('utf8'))
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    data += b''.join(ast.dump(functions[name], include_attributes=False).encode('utf8')
                     for name in ('compute_analysis', 'clearance_risks'))
    return digest(data)


def layout_key(meta):
    return f"{meta['sourceSha256']}-{meta['version']}-{'ore' if meta['mineralsEnabled'] else 'clear'}"


def signature(cells, res, meta):
    return dict(inputSha256=digest(canonical(list(cells.values()))),
                rulesSha256=meta['rulesSha256'], theaterSha256=meta['theaterSha256'],
                artSha256=digest(canonical(res.art)), treesEnabled=meta.get('treesEnabled', True),
                terrainRemovalVersion=meta.get('terrainRemovalVersion'))


@lru_cache(maxsize=2)
def _manifest(path, size, modified):
    return json.loads(Path(path).read_text('utf8'))


def manifest(directory=None):
    path = Path(directory or DATA)/'manifest.json'
    stat = path.stat()
    value = _manifest(str(path.resolve()), stat.st_size, stat.st_mtime_ns)
    if not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('modelSha256') != model_fingerprint() or not isinstance(value.get('layouts'), dict):
        raise ValueError('Precomputed model does not match this installation')
    return value


def checked_blob(directory, name, expected):
    directory = Path(directory).resolve()
    path = (directory/name).resolve()
    if not path.is_relative_to(directory) or path.stat().st_size > 20_000_000:
        raise ValueError('Invalid precomputed path or size')
    raw = path.read_bytes()
    if digest(raw) != expected:
        raise ValueError('Precomputed checksum mismatch')
    if path.suffix == '.xz':
        decoder = lzma.LZMADecompressor(memlimit=128*1024*1024)
        decoded = decoder.decompress(raw, max_length=64_000_001)
        if not decoder.eof or decoder.unused_data:
            raise ValueError('Invalid or oversized precomputed XZ stream')
    elif path.suffix == '.gz':
        import io
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            decoded = stream.read(64_000_001)
    else:
        raise ValueError('Unsupported precomputed compression')
    if len(decoded) > 64_000_000:
        raise ValueError('Precomputed data exceeds decode limit')
    return decoded


def restore(cells, res, meta, folder, progress, *, directory=None):
    if meta['version'] not in ('ra2', 'yr') or meta.get('approximate') or meta.get('previewOnly'):
        return None
    directory = Path(directory or DATA)
    try:
        index = manifest(directory)
        entry = index['layouts'].get(layout_key(meta))
        if entry is None:
            return None
        if entry['signature'] != signature(cells, res, meta):
            raise ValueError('Precomputed map/rules/art/terrain mismatch')
        progress('读取并校验官方预计算概率与来源', 48)
        from toy_codec import expand_report, expand_search, selections
        payload = json.loads(checked_blob(directory, entry['report'], entry['reportSha256']))
        report = expand_report(payload['report'], payload['table'])
        search = expand_search(checked_blob(directory, entry['search'], entry['searchSha256']))
        count = (sum(meta['size'][2:])-1)**2
        if report['probability']['sampleCount'] != count or len(report['cells']) != len(cells):
            raise ValueError('Precomputed grid size mismatch')
        for _ in selections(search, count):
            pass
        for cell, stored in zip(cells.values(), report['cells'], strict=True):
            if (cell['x'], cell['y']) != (stored['x'], stored['y']):
                raise ValueError('Precomputed cell order mismatch')
            if set(stored)-set(CELL_FIELDS)-{'probability', 'multiplier'}:
                raise ValueError('Unexpected precomputed cell fields')
            if not all(math.isfinite(stored[k]) and stored[k] >= 0 for k in ('probability', 'multiplier')):
                raise ValueError('Invalid precomputed probability')
        result = {k: report[k] for k in RESULT_FIELDS}
        temp = Path(folder)/'search-precomputed.tmp'
        temp.write_bytes(search)
        os.replace(temp, Path(folder)/'search.bin')
        # Do not mutate parsed cells until the whole entry has been validated.
        for cell, stored in zip(cells.values(), report['cells'], strict=True):
            cell.update({k: v for k, v in stored.items() if k not in ('x', 'y')})
        meta['calculationSource'] = dict(kind='official-precomputed', modelSha256=index['modelSha256'])
        return result
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError, ArithmeticError, AssertionError, EOFError, struct.error, zlib.error, lzma.LZMAError) as error:
        meta['calculationSource'] = dict(kind='live', reason='cache-unavailable', detail=str(error))
        progress('官方预计算不可用，正在现场计算', 47)
        return None
