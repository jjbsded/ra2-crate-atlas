"""Build verified, rendering-independent stock caches with the desktop engine."""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import lzma
import json
from pathlib import Path
import tempfile
import time
import runtime_bootstrap
from official_maps import catalog, select
from official_precomputed import CELL_FIELDS, RESULT_FIELDS, canonical, digest, layout_key, model_fingerprint, signature
from realmap import compute_analysis, ensure_tools
from realmap_parser import parse_map
from toy_codec import columns, compact_report, compact_search, expand_report, expand_search, probability_recipe, selections
from toy_live_search import pack, unpack

ROOT = Path(__file__).resolve().parent


def calculate(task):
    map_id, version, enabled, work, destination = task
    raw, name, _ = select(map_id, version)
    with tempfile.TemporaryDirectory(prefix='layout-', dir=work) as temp:
        folder = Path(temp)
        cells, res, theater, _, meta = parse_map(raw, folder, version, minerals_enabled=enabled)
        stamp = signature(cells, res, meta)
        result = compute_analysis(cells, folder, meta, theater, lambda *_: None)
        search = (folder/'search.bin').read_bytes()
        recipe = probability_recipe(dict(**result, cells=list(cells.values())), selections(search, result['probability']['sampleCount']))
        encoded = pack(*unpack(compact_search(search, result['probability']['sampleCount'])))
        assert expand_search(encoded) == search, 'Ordered source records changed'
        data = dict(**result, cells=[{k: c[k] for k in CELL_FIELDS if k in c} for c in cells.values()])
        table = dict(count=len(cells), columns=columns(data['cells']))
        compact = compact_report(data, recipe, table, '')
        restored = expand_report(compact, table)
        assert all(restored[k] == result[k] for k in RESULT_FIELDS)
        for expected, actual in zip(cells.values(), restored['cells'], strict=True):
            assert all(actual[k] == expected[k] for k in actual), (name, expected['x'], expected['y'])
        report_raw = canonical(dict(table=table, report=compact))
        report_bytes = lzma.compress(report_raw, preset=6)
        search_bytes = lzma.compress(encoded, preset=6)
        assert lzma.decompress(report_bytes) == report_raw and lzma.decompress(search_bytes) == encoded
        # Content names deduplicate both layouts/maps without retaining textures.
        entry = dict(signature=stamp)
        for kind, data, ext in [('report', report_bytes, '.json.xz'), ('search', search_bytes, '.bin.xz')]:
            checksum = digest(data); file = kind+'-'+checksum+ext
            entry[kind] = file; entry[kind+'Sha256'] = checksum
            path = destination/file
            # Identical bytes may be published concurrently by map variants.
            try:
                with path.open('xb') as stream:
                    stream.write(data)
            except FileExistsError:
                pass
        return layout_key(meta), entry


def build(output, jobs=2, map_ids=None):
    if output.exists():
        raise ValueError('Choose a new precomputed directory; existing builds are preserved')
    ensure_tools()
    entries = [e for e in catalog()['maps'] if e['mode'] in ('standard', 'teamgame') and (not map_ids or e['id'] in map_ids)]
    if not entries:
        raise ValueError('No selected official maps')
    output.mkdir(parents=True)
    work = ROOT/'output/precomputed-build'; work.mkdir(parents=True, exist_ok=True)
    tasks = {}
    for entry in entries:
        for version, source in entry['variants'].items():
            for enabled in (True, False):
                tasks.setdefault((source['sha256'], version, enabled), (entry['id'], version, enabled, work, output))
    started = time.monotonic(); layouts = {}
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(calculate, task) for task in tasks.values()]
        for future in as_completed(futures):
            key, item = future.result(); layouts[key] = item
            print(f'{len(layouts)}/{len(tasks)} {key[:16]}', flush=True)
    index = dict(schemaVersion=1, modelSha256=model_fingerprint(), modes=['standard', 'teamgame'],
                 menuEntries=len(entries), requestedLayouts=sum(len(e['variants'])*2 for e in entries), layouts=layouts)
    # Publish the manifest last; incomplete builds cannot be selected at runtime.
    (output/'manifest.json').write_bytes(canonical(index))
    print(json.dumps(dict(output=str(output), bytes=sum(p.stat().st_size for p in output.iterdir()),
                          layouts=len(layouts), seconds=round(time.monotonic()-started, 2))), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'official-precomputed')
    parser.add_argument('--jobs', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--map-id', action='append')
    args = parser.parse_args()
    build(args.output.resolve(), args.jobs, args.map_id)
