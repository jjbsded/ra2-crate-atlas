"""Recalculate Toy probability data from verified ordered searches and cells.

Artwork/layout provenance is retained. This does not decode or execute the old
probability formula; only column data and ordered candidate records are reused.
"""
from copy import deepcopy
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile

from realmap_exact import MODEL, calculate
from toy_codec import (columns, compact_report, dumps, expand_columns, expand_report,
                       expand_search, probability_recipe, selections, zipped)


def fingerprint():
    root = Path(__file__).resolve().parent
    return hashlib.sha256(b''.join((root/name).read_bytes() for name in
        ('finite-retry.js', 'realmap_exact.py', 'toy_codec.py', 'toy/static-codec.js', 'toy-live/solver.js'))).hexdigest()


def share_cells(output, manifest):
    """Reuse each map's clear-layout columns; preserve encoded values exactly."""
    output=Path(output).resolve();old_tables=set();referenced=set();changed=0
    for group in sorted((output/'data').iterdir()):
        paths=sorted(group.glob('*/result.json.gz'))
        if not paths:continue
        base_report=group/'clear/result.json.gz'
        if base_report not in paths:base_report=paths[0]
        base_value=json.loads(gzip.decompress(base_report.read_bytes()))
        base_path=(base_report.parent/base_value['_static']['base']).resolve()
        assert base_path.is_relative_to(output/'shared')
        base=json.loads(gzip.decompress(base_path.read_bytes()))
        # Use the stored table as base; reports may already contain overrides.
        for path in paths:
            value=json.loads(gzip.decompress(path.read_bytes()));transport=value['_static']
            old_path=(path.parent/transport['base']).resolve()
            assert old_path.is_relative_to(output/'shared')
            old_tables.add(old_path);table=json.loads(gzip.decompress(old_path.read_bytes()))
            assert table['count']==base['count']
            cols=dict(table['columns'])
            for key,col in transport['columns'].items():
                if col is None:cols.pop(key,None)
                else:cols[key]=col
            overrides={key:col for key,col in cols.items() if col!=base['columns'].get(key)}
            overrides.update({key:None for key in base['columns'].keys()-cols.keys()})
            check=dict(base['columns'])
            for key,col in overrides.items():
                if col is None:check.pop(key,None)
                else:check[key]=col
            assert check==cols, 'Shared columns changed decoded cell values'
            transport.update(base=Path(os.path.relpath(base_path,path.parent)).as_posix(),columns=overrides)
            packed=zipped(value)
            if packed!=path.read_bytes():path.write_bytes(packed);changed+=1
            referenced.add(base_path)
    for path in old_tables-referenced:
        assert path.is_relative_to(output/'shared') and path.name.startswith('cells-')
        path.unlink()
    manifest['probabilityColumnsShared']=True
    return changed


def _refresh_report(task):
    path, output, stamp = task
    report = json.loads(gzip.decompress(path.read_bytes()))
    transport = report.pop('_static')
    base_path = (path.parent/transport['base']).resolve()
    assert base_path.is_relative_to(output)
    table = json.loads(gzip.decompress(base_path.read_bytes()))
    cols = dict(table['columns'])
    for field, col in transport['columns'].items():
        if col is None:
            cols.pop(field, None)
        else:
            cols[field] = col
    cells = expand_columns(dict(count=table['count'], columns=cols))
    search_path = (path.parent/report['precomputed']['search']).resolve()
    assert search_path.is_relative_to(output)
    search = expand_search(gzip.decompress(search_path.read_bytes()))
    count = report['probability']['sampleCount']
    result = calculate(selections(search, count), {c['y']*512+c['x']: c['status'] for c in cells}, count)
    calculated = result.pop('cells')
    for cell in cells:
        cell.update(calculated.get(cell['y']*512+cell['x'], dict(probability=0, multiplier=0, oneAttemptProbability=0, terms=[])))
    report['probability'] = result
    report['cells'] = cells
    report['precomputed']['probabilityModel'] = MODEL
    report['precomputed']['probabilitySourceSha256'] = stamp
    table = dict(count=len(cells), columns=columns(cells))
    packed_table = zipped(table)
    table_name = 'cells-'+hashlib.sha256(packed_table).hexdigest()[:24]+'.json.gz'
    # A new table may have the same name as a still-readable source table.
    # Atomic replacement prevents parallel readers seeing a truncated stream.
    with tempfile.NamedTemporaryFile(dir=output/'shared', suffix='.tmp', delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(packed_table)
    try:
        os.replace(temporary, output/'shared'/table_name)
    finally:
        temporary.unlink(missing_ok=True)
    recipe = probability_recipe(report, selections(search, count))
    compact = compact_report(report, recipe, table, '../../../shared/'+table_name)
    assert expand_report(compact, table) == report, 'Lossless finite-retry round trip failed'
    path.write_bytes(zipped(compact))
    return base_path


def refresh(output, manifest, jobs=1):
    output = Path(output).resolve()
    if type(jobs) is not int or jobs < 1:
        raise ValueError('Refresh jobs must be a positive integer')
    # Validate all source inputs before writing any derived report.
    for name, digest in manifest['files'].items():
        path = (output/name).resolve()
        assert path.is_relative_to(output) and hashlib.sha256(path.read_bytes()).hexdigest() == digest, name
    paths = sorted((output/'data').rglob('result.json.gz'))
    old_tables, stamp = set(), fingerprint()
    tasks = [(path, output, stamp) for path in paths]
    def collect(results):
        for index, base_path in enumerate(results, 1):
            old_tables.add(base_path)
            if index % 25 == 0 or index == len(paths):
                print(f'Probability data {index}/{len(paths)}', flush=True)
    if jobs == 1:
        collect(map(_refresh_report, tasks))
    else:
        with ProcessPoolExecutor(max_workers=jobs) as pool:
            futures = [pool.submit(_refresh_report, task) for task in tasks]
            collect(f.result() for f in as_completed(futures))
    # Deliberately retain modelSourceSha256/artworkSourceSha256: they describe
    # the reused baked layout and pixels, not this new probability computation.
    manifest.update(probabilityModel=MODEL, probabilitySourceSha256=stamp,
                    probabilityUpdatedAt=datetime.now(timezone.utc).isoformat(), transportCodec=3)
    share_cells(output, manifest)
    referenced = {(p.parent/json.loads(gzip.decompress(p.read_bytes()))['_static']['base']).resolve() for p in paths}
    for path in old_tables - referenced:
        assert path.is_relative_to(output/'shared') and path.name.startswith('cells-')
        path.unlink(missing_ok=True)
    return len(paths)
