"""Native cache parity, provenance rejection, recovery and full renderer checks."""
import argparse
import csv
from copy import deepcopy
import json
from pathlib import Path
import shutil
import tempfile
import time
from unittest.mock import patch
import official_precomputed as cache
from official_maps import select
from realmap import analyze, compute_analysis
from realmap_parser import parse_map
from toy_codec import expand_search

ROOT = Path(__file__).resolve().parent
QA = ROOT/'output/official-precomputed-qa'
QA.mkdir(parents=True, exist_ok=True)
assert QA.resolve().is_relative_to((ROOT/'output').resolve())


def verify_render_cache():
    import official_render_cache as images
    from map_jobs import MapJobs
    import original_resources
    raw, filename, official = select('f1d9bb89e2eb07cdb7af', 'yr')
    paths = original_resources.resolve('yr')
    identity = images.key(raw, 'yr', True, paths)
    assert identity and identity != images.key(raw, 'yr', False, paths)
    assert images.key(raw, 'directory', True, paths) is None
    assert images.key(raw+b'\n;modified', 'yr', True, paths) is None
    assert images.key(raw, 'yr', True, ('untrusted.mix',)) is None
    with tempfile.TemporaryDirectory(dir=QA) as temp:
        base = Path(temp); source = base/'source'; source.mkdir()
        report = dict(metadata=dict(filename=filename, cellCount=1, mineralsEnabled=True,
                                    mineralPreviousResult='/output/old/result.json'), probability={'valid': True})
        for name, data in [('result.json', cache.canonical(report)), ('source.map', raw), ('search.bin', b'sources'), ('ground.png', b'image')]:
            (source/name).write_bytes(data)
        source_url = '/'+source.relative_to(ROOT).as_posix()+'/result.json'
        with patch.object(images, 'index_path', lambda value: base/(value+'.json')):
            images.remember(identity, source, source_url)
            index = images.index_path(identity); original_index = index.read_bytes()
            clone = base/'clone'
            restored = images.reuse(identity, clone, 'renamed.map', lambda *_: None)
            assert restored['metadata']['filename'] == 'renamed.map'
            assert restored['metadata']['calculationSource']['kind'] == 'local-cache'
            assert 'mineralPreviousResult' not in restored['metadata']
            (clone/'ground.png').write_bytes(b'updated')
            assert (source/'ground.png').read_bytes() == b'image', 'Copies must not alias older reports'
            assert json.loads((source/'result.json').read_bytes()) == report
            # Persisted cache remains usable across fresh service instances.
            for _ in range(2):
                jobs = MapJobs(); jobs._jobs['cachetest'] = {}
                with patch('map_jobs.ROOT', base), patch('realmap.analyze', side_effect=AssertionError('Unexpected native analysis')):
                    jobs._run('cachetest', raw, 'yr', filename, paths, official, True, None, None, False)
                assert jobs.status('cachetest')['done'], jobs.status('cachetest')
                index.write_bytes(original_index)
            jobs = MapJobs(); jobs._jobs['forced'] = {}
            with patch('map_jobs.ROOT', base), patch('realmap.analyze', return_value=deepcopy(report)) as analyze, patch.object(images, 'reuse', side_effect=AssertionError('Forced request used cache')):
                jobs._run('forced', raw, 'yr', filename, paths, None, True, None, None, True)
                assert analyze.call_args.kwargs['use_precomputed'] is False
                assert jobs.status('forced')['done']
            for broken in ([], {}, {**json.loads(original_index), 'identity': 'wrong'}, {**json.loads(original_index), 'files': []}):
                index.write_bytes(cache.canonical(broken))
                assert images.reuse(identity, base/'bad', filename, lambda *_: None) is None
            index.write_bytes(original_index)
            (source/'ground.png').write_bytes(b'corrupt')
            assert images.reuse(identity, base/'bad', filename, lambda *_: None) is None
    print('PASS persistent render reuse, isolated copies, corruption recovery and service-level forced bypass')


def main(directory, render=False):
    with tempfile.TemporaryDirectory(dir=QA) as temp:
        normalized = Path(temp)
        expected_model = cache.model_fingerprint()
        for name in (*cache.MODEL_FILES, 'realmap.py'):
            (normalized/name).write_bytes((ROOT/name).read_text('utf8').replace('\n', '\r\n').encode('utf8'))
        with patch.object(cache, 'ROOT', normalized):
            cache.model_fingerprint.cache_clear()
            assert cache.model_fingerprint() == expected_model, 'Line endings changed model identity'
        cache.model_fingerprint.cache_clear()
    raw, filename, _ = select('f1d9bb89e2eb07cdb7af', 'yr')
    for enabled in (True, False):
        with tempfile.TemporaryDirectory(dir=QA) as temp:
            folder = Path(temp)
            cells, res, theater, _, meta = parse_map(raw, folder, 'yr', minerals_enabled=enabled)
            untouched = deepcopy(cells)
            native = compute_analysis(cells, folder, meta, theater, lambda *_: None)
            search = (folder/'search.bin').read_bytes()
            restored = cache.restore(untouched, res, meta, folder, lambda *_: None, directory=directory)
            assert restored == native and untouched == cells
            assert search == (folder/'search.bin').read_bytes()
            assert meta['calculationSource']['kind'] == 'official-precomputed'
    print('PASS native probabilities, clearance, cells and ordered sources in both layouts')
    with tempfile.TemporaryDirectory(dir=QA) as temp:
        folder = Path(temp)
        cells, res, _, _, meta = parse_map(raw, folder, 'yr')
        before = deepcopy(cells)
        for key, value in [('sourceSha256', '0'*64), ('version', 'directory'), ('rulesSha256', 'changed'),
                           ('theaterSha256', 'changed'), ('treesEnabled', False), ('approximate', True)]:
            changed = {**meta, key: value}
            assert cache.restore(cells, res, changed, folder, lambda *_: None, directory=directory) is None, key
            assert cells == before
        art = dict(res.art)
        with patch.object(res, 'art', {**art, 'TEST_CHANGED': {'FOUNDATION': '3x3'}}):
            assert cache.restore(cells, res, dict(meta), folder, lambda *_: None, directory=directory) is None
        broken = folder/'cache'; broken.mkdir()
        index = deepcopy(cache.manifest(directory)); entry = index['layouts'][cache.layout_key(meta)]
        index['layouts'] = {cache.layout_key(meta): entry}
        for kind in ('report', 'search'):
            shutil.copy2(directory/entry[kind], broken/entry[kind])
        path = broken/'manifest.json'; path.write_bytes(cache.canonical(index))
        (broken/entry['report']).write_bytes(b'damaged')
        assert cache.restore(cells, res, dict(meta), folder, lambda *_: None, directory=broken) is None
        assert cells == before
        index['modelSha256'] = 'wrong-version'; path.write_bytes(cache.canonical(index))
        assert cache.restore(cells, res, dict(meta), folder, lambda *_: None, directory=broken) is None
        for invalid_manifest in ([], None, {'schemaVersion': 1, 'layouts': []}):
            path.write_bytes(cache.canonical(invalid_manifest))
            assert cache.restore(cells, res, dict(meta), folder, lambda *_: None, directory=broken) is None
        assert cache.restore(cells, res, dict(meta), folder, lambda *_: None, directory=folder/'missing') is None
    for raw_bad in (b'CSP2', b'CSP2'+b'\xff'*8):
        try:
            expand_search(raw_bad)
        except ValueError:
            pass
        else:
            raise AssertionError('Corrupt anchored sources accepted')
    print('PASS map/version/rules/art/terrain/model invalidation; missing/corrupt data leave cells untouched')
    with patch.object(cache, 'DATA', directory):
        verify_render_cache()
    if render:
        fast, live = QA/'cached', QA/'live'
        with patch.object(cache, 'DATA', directory):
            start = time.monotonic(); a = analyze(raw, fast, 'yr', filename); fast_seconds = time.monotonic()-start
            with patch.object(cache, 'restore', side_effect=AssertionError('Forced recompute used cache')):
                start = time.monotonic(); b = analyze(raw, live, 'yr', filename, use_precomputed=False); live_seconds = time.monotonic()-start
        assert a['cells'] == b['cells']
        assert all(a[k] == b[k] for k in cache.RESULT_FIELDS)
        assert a['rendering'] == b['rendering']
        for key in ('image', 'objectImage'):
            if a['rendering'].get(key):
                assert (fast/a['rendering'][key]).read_bytes() == (live/b['rendering'][key]).read_bytes()
        for name in ('search.bin', 'source.map'):
            assert (fast/name).read_bytes() == (live/name).read_bytes(), name
        def csv_values(path):
            def value(text):
                try:
                    return json.loads(text)
                except ValueError:
                    return text
            with path.open(encoding='utf-8-sig', newline='') as stream:
                return [[value(text) for text in row] for row in csv.reader(stream)]
        for name in ('cells.csv', 'rock-cells.csv', 'potential-rock-cells.csv'):
            assert csv_values(fast/name) == csv_values(live/name), name
        assert a['metadata']['calculationSource']['kind'] == 'official-precomputed'
        assert b['metadata']['calculationSource']['reason'] == 'forced'
        print(f'PASS full renderer, exports and forced bypass: cached={fast_seconds:.3f}s live={live_seconds:.3f}s')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=cache.DATA)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args()
    main(args.data.resolve(), args.render)
