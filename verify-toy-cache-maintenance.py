"""Parallel refresh stays byte-identical; directory validation never makes ZIPs."""
from copy import deepcopy
import gzip
import hashlib
import importlib
import json
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
from unittest.mock import patch

import toy_probability_refresh as refresh
from realmap_exact import calculate
from toy_codec import columns, compact_report, compact_search, probability_recipe, zipped

ROOT = Path(__file__).resolve().parent
QA = ROOT/'output/toy-cache-maintenance-qa'
QA.mkdir(exist_ok=True)


def fixture(out):
    (out/'shared').mkdir(parents=True)
    cells = [dict(x=x, y=y, status='crate' if x < 3 else 'blocked') for x in range(1, 4) for y in range(1, 4)]
    picks = [(c['y']*512+c['x'],) for c in cells]
    result = calculate(picks, {c['y']*512+c['x']: c['status'] for c in cells}, 9)
    values = result.pop('cells')
    for c in cells:
        c.update(values.get(c['y']*512+c['x'], dict(terms=[], probability=0, multiplier=0, oneAttemptProbability=0)))
    table = dict(count=len(cells), columns=columns(cells))
    packed = zipped(table)
    table_name = 'cells-'+hashlib.sha256(packed).hexdigest()[:24]+'.json.gz'
    (out/'shared'/table_name).write_bytes(packed)
    raw = b''.join(struct.pack('<II', 1, row[0]) for row in picks)
    (out/'shared/search.bin.gz').write_bytes(gzip.compress(compact_search(raw, 9), mtime=0))
    for layout in ('ore', 'clear'):
        folder = out/'data/fixture-yr'/layout
        folder.mkdir(parents=True)
        report = dict(metadata={'fixture': True}, probability=deepcopy(result), cells=deepcopy(cells),
                      precomputed={'search': '../../../shared/search.bin.gz'}, rendering={})
        compact = compact_report(report, probability_recipe(report, picks), table, '../../../shared/'+table_name)
        (folder/'result.json.gz').write_bytes(zipped(compact))
    return dict(edition='toy', transportCodec=3,
                maps=[dict(id='fixture', version='yr', minerals=v) for v in (True, False)],
                files={p.relative_to(out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in out.rglob('*') if p.is_file()})


class Maintenance(unittest.TestCase):
    def test_parallel_same_shared_source_is_byte_identical(self):
        with tempfile.TemporaryDirectory(dir=QA) as temp:
            base = Path(temp).resolve()
            assert base.is_relative_to(QA.resolve())
            serial, parallel = base/'serial', base/'parallel'
            manifest = fixture(serial)
            shutil.copytree(serial, parallel)
            self.assertEqual(refresh.refresh(serial, deepcopy(manifest)), 2)
            self.assertEqual(refresh.refresh(parallel, deepcopy(manifest), jobs=2), 2)
            files = lambda folder: {p.relative_to(folder): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
            self.assertEqual(files(serial), files(parallel))
            self.assertFalse(list(parallel.rglob('*.tmp')))

    def test_corruption_fails_before_report_writes(self):
        with tempfile.TemporaryDirectory(dir=QA) as temp:
            out = Path(temp).resolve()
            assert out.is_relative_to(QA.resolve())
            manifest = fixture(out)
            reports = {p: p.read_bytes() for p in (out/'data').rglob('result.json.gz')}
            next((out/'shared').glob('cells-*')).write_bytes(b'broken')
            with self.assertRaises(AssertionError):
                refresh.refresh(out, manifest, jobs=2)
            self.assertTrue(all(p.read_bytes() == value for p, value in reports.items()))

    def test_finalize_directory_preserves_existing_archive(self):
        with tempfile.TemporaryDirectory(dir=QA) as temp:
            base = Path(temp).resolve()
            assert base.is_relative_to(QA.resolve())
            out, archive = base/'toy', base/'toy.zip'
            manifest = fixture(out)
            archive.write_bytes(b'preserve previous archive')
            with patch('zipfile.ZipFile', side_effect=AssertionError('Archive writer called')):
                importlib.import_module('build-toy').finalize(out, manifest, archive, make_archive=False)
            self.assertEqual(archive.read_bytes(), b'preserve previous archive')
            self.assertFalse(manifest['internalBuild'])
            self.assertEqual(json.loads((out/'build-manifest.json').read_text('utf8'))['files'], manifest['files'])


if __name__ == '__main__':
    unittest.main()
