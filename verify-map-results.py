"""Report caching, provenance and renderer-independent imports."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from map_results import ROOT, load_report, result_path, source_bytes


class ResultChecks(unittest.TestCase):
    def test_directory_context_cache_preserves_provenance_and_isolation(self):
        import map_results
        from realmap_format import sha
        from realmap_mod import ModResources
        with tempfile.TemporaryDirectory(prefix='context-check-', dir=ROOT/'output') as name:
            folder = Path(name); root = folder/'game'; root.mkdir()
            (root/'parts').mkdir()
            (root/'rulesmd.ini').write_text('[General]\nCrateMinimum=5\n[#include]\n0=parts/rules.ini\n1=parts/optional.ini\n')
            included = root/'parts/rules.ini'
            included.write_text('[General]\nCrateMaximum=9\n')
            (root/'artmd.ini').write_text('[TEST]\nImage=TEST\n')
            (root/'snowmd.ini').write_text('[General]\nName=Snow\n')
            (root/'isosno.pal').write_bytes(bytes(768))
            data = b'[Basic]\nName=Cache\n[Map]\nTheater=SNOW\nSize=0,0,8,8\nLocalSize=1,1,6,6\n'
            (folder/'source.map').write_bytes(data); path = folder/'result.json'
            original = ModResources(root, folder/'source.map')
            meta = dict(version='directory', sourceSha256=sha(data), resourceRoot=str(root),
                        resourceFingerprint=original.discovery['fingerprint'],
                        theater='SNOW', theaterSha256=original.theater('SNOW')['configSha256'],
                        rulesSha256=sha(original.rules_bytes), artSha256=original.art_hash)
            report = dict(metadata=meta)
            map_results._contexts.clear()
            with patch('realmap_mod.ModResources', wraps=ModResources) as constructor:
                with ThreadPoolExecutor(max_workers=4) as pool:
                    prepared = list(pool.map(lambda _: map_results.resource_context(report, path), range(4)))
                a, ta = prepared[0]
                a.context.resources.cache['transient'] = ('test', {})
                ta['effectiveRules']['GENERAL']['CRATEMAXIMUM'] = '100'
                b, tb = map_results.resource_context(report, path)
                self.assertEqual(constructor.call_count, 1)
                self.assertNotIn('transient', b.context.resources.cache)
                self.assertEqual(tb['effectiveRules']['GENERAL']['CRATEMAXIMUM'], '9')
                for field in ('artSha256', 'rulesSha256', 'theaterSha256', 'sourceSha256', 'resourceFingerprint'):
                    with self.assertRaises(ValueError, msg=field):
                        map_results.resource_context(dict(metadata={**meta, field: 'changed'}), path)
                # Nested loose definitions are outside the root archive manifest.
                # Detect their contents even when mtime and size are unchanged.
                stat = included.stat(); included.write_text('[General]\nCrateMaximum=8\n')
                os.utime(included, ns=(stat.st_atime_ns, stat.st_mtime_ns))
                with self.assertRaisesRegex(ValueError, '不一致'):
                    map_results.resource_context(report, path)
                included.write_text('[General]\nCrateMaximum=9\n')
                map_results.resource_context(report, path)
                (root/'parts/optional.ini').write_text('[General]\nCrateMaximum=7\n')
                with self.assertRaisesRegex(ValueError, '不一致'):
                    map_results.resource_context(report, path)
                (root/'parts/optional.ini').unlink()
                for i in range(3):
                    other = folder/str(i); other.mkdir(); (other/'source.map').write_bytes(data)
                    map_results.resource_context(report, other/'result.json')
                self.assertEqual(len(map_results._contexts), 2)
            map_results._contexts.clear()

    def test_import_has_no_renderer_or_game_asset_side_effect(self):
        subprocess.run([sys.executable, '-B', '-c',
                        "import sys, map_results, map_jobs; assert 'realmap_3d' not in sys.modules; assert 'realmap' not in sys.modules; assert 'PIL' not in sys.modules"],
                       cwd=ROOT, check=True)

    def test_cache_reload_lookup_and_source_integrity(self):
        with tempfile.TemporaryDirectory(prefix='report-check-', dir=ROOT/'output') as name:
            folder = Path(name)
            path = folder/'result.json'
            report = {'metadata': {'sourceSha256': hashlib.sha256(b'source').hexdigest()},
                      'cells': [{'x': 2, 'y': 3, 'level': 1}]}
            path.write_text(json.dumps(report), 'utf8')
            url = '/output/'+folder.name+'/result.json'
            self.assertEqual(result_path(url), path.resolve())
            one = load_report(path)
            self.assertIs(one, load_report(path))
            self.assertIs(one[0]['cells'][0], one[1][2, 3])
            before = path.stat().st_mtime_ns
            report['cells'][0]['level'] = 2
            path.write_text(json.dumps(report), 'utf8')
            os.utime(path, ns=(before+1000000, before+1000000))
            self.assertEqual(load_report(path)[1][2, 3]['level'], 2)
            self.assertEqual(one[1][2, 3]['level'], 1)
            self.assertIsNone(source_bytes(report, path, required=False))
            with self.assertRaisesRegex(ValueError, '缺失'):
                source_bytes(report, path)
            (folder/'source.map').write_bytes(b'source')
            self.assertEqual(source_bytes(report, path), b'source')
            (folder/'source.map').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, '已变化'):
                source_bytes(report, path, required=False)
            for bad in ('/output/../server.py', '/data/result.json', None):
                with self.assertRaises(ValueError):
                    result_path(bad)


if __name__ == '__main__':
    unittest.main()
