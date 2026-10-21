"""Verify catalog coverage, lossless selection, and crate-relevant equivalence."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import official_maps as maps

spec = importlib.util.spec_from_file_location('map_catalog_builder', Path(__file__).with_name('build-map-catalog.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
OUT = maps.ROOT/'output/catalog-verification'
OUT.mkdir(parents=True, exist_ok=True)


class OfficialMapChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = maps.catalog()
        cls.sources = {s['path']: s for e in cls.catalog['maps'] for s in e['variants'].values()}

    def test_coverage_and_original_bytes(self):
        self.assertEqual(self.catalog['counts']['versions'], {'ra2': 87, 'yr': 161})
        self.assertEqual(len(self.sources), 248)
        self.assertEqual(self.catalog['counts']['supportedFiles'], 248)
        self.assertTrue(all(not source['unsupportedReason'] for source in self.sources.values()))
        ids = [e['id'] for e in self.catalog['maps']]
        self.assertEqual(len(ids), len(set(ids)))
        with zipfile.ZipFile(maps.DATA/'maps.zip') as archive:
            self.assertEqual(set(archive.namelist()), set(self.sources))
            for path, source in self.sources.items():
                self.assertEqual(hashlib.sha256(archive.read(path)).hexdigest(), source['sha256'], path)
        for entry in self.catalog['maps']:
            if entry['shared']:
                self.assertEqual(set(entry['variants']), {'ra2', 'yr'})
                self.assertEqual(len({s['crateFingerprint'] for s in entry['variants'].values()}), 1)
                self.assertTrue(all(s['crateFingerprint'] for s in entry['variants'].values()))

    def test_ice_variants_and_original_version_selection(self):
        ice = [e for e in self.catalog['maps'] if e['name'] == '冰天雪地']
        self.assertEqual({e['label'] for e in ice}, {
            '冰天雪地[作战]', '冰天雪地[原版][巨富]', '冰天雪地[尤里][巨富]',
            '冰天雪地[抢地盘]', '冰天雪地[生死斗]'})
        shared = next(e for e in ice if e['mode'] == 'standard')
        ra2, ra2_file, info = maps.select(shared['id'], 'ra2')
        yr, yr_file, _ = maps.select(shared['id'], 'yr')
        self.assertEqual((ra2_file, yr_file), ('mp32s8.map', 'xmp32s8.map'))
        self.assertNotEqual(ra2, yr, 'equivalent maps must retain both original files')
        self.assertEqual(info['label'], '冰天雪地[作战]')
        self.assertEqual(info['sourceSha256'], hashlib.sha256(ra2).hexdigest())

    def test_only_known_supported_selection(self):
        supported = next(e for e in self.catalog['maps'] if e['shared'])
        for bad_id in ('', '../examples/mp32s8.map', 'x'*20):
            with self.assertRaises(ValueError):
                maps.select(bad_id, 'ra2')
        with self.assertRaises(ValueError):
            maps.select(supported['id'], 'shikong')
        # All bundled maps are now supported. Keep the API's refusal path
        # covered with an explicit unsupported catalog fixture.
        catalog = deepcopy(self.catalog)
        entry = catalog['maps'][0]
        version = next(iter(entry['variants']))
        entry['variants'][version]['unsupportedReason'] = '测试：未知扩展地形'
        with patch.object(maps, 'catalog', return_value=catalog):
            with self.assertRaisesRegex(ValueError, '暂不支持'):
                maps.select(entry['id'], version)

    def test_relocation_and_corrupt_bundle(self):
        entry = next(e for e in self.catalog['maps'] if e['shared'])
        source = entry['variants']['ra2']
        with zipfile.ZipFile(maps.DATA/'maps.zip') as archive:
            raw = archive.read(source['path'])
        with tempfile.TemporaryDirectory(dir=OUT) as temporary:
            folder = Path(temporary).resolve()
            self.assertTrue(folder.is_relative_to(OUT.resolve()))
            (folder/'catalog.json').write_text(json.dumps(self.catalog), 'utf8')
            with zipfile.ZipFile(folder/'maps.zip', 'w') as archive:
                archive.writestr(source['path'], raw)
            with patch.object(maps, 'DATA', folder):
                self.assertEqual(maps.select(entry['id'], 'ra2')[0], raw)
                with zipfile.ZipFile(folder/'maps.zip', 'w') as archive:
                    archive.writestr(source['path'], raw+b'\n')
                with self.assertRaisesRegex(ValueError, '校验失败'):
                    maps.select(entry['id'], 'ra2')

    def test_no_cross_mode_or_unverified_merges(self):
        ra2 = deepcopy(next(s for s in self.sources.values() if s['crateFingerprint']))
        ra2.update(version='ra2', name='测试地图', modes=['standard', 'megawealth'], file='a.map')
        yr = deepcopy(ra2)
        yr.update(version='yr', file='b.map')
        entries = maps.group_maps([ra2, yr])
        self.assertEqual({e['label'] for e in entries}, {'测试地图[作战]', '测试地图[巨富]'})
        yr['crateFingerprint'] = 'different'
        self.assertEqual(len(maps.group_maps([ra2, yr])), 4)
        ra2['crateFingerprint'] = yr['crateFingerprint'] = None
        self.assertTrue(all(not e['shared'] for e in maps.group_maps([ra2, yr])))
        duplicate = deepcopy(ra2)
        duplicate.update(file='c.map', crateFingerprint='same')
        ra2['crateFingerprint'] = 'same'
        self.assertEqual(len(maps.group_maps([ra2, duplicate])), 4)

    def test_fingerprint_tracks_physical_changes_not_ai_or_preview(self):
        from realmap import ini, parse_map
        source = next(s for s in self.sources.values() if s['file'] == 'mp32s8.map')
        with zipfile.ZipFile(maps.DATA/'maps.zip') as archive:
            raw = archive.read(source['path'])
        folder = OUT/'fingerprint'
        folder.mkdir(exist_ok=True)
        cells, _, theater, _, meta = parse_map(raw, folder, 'ra2')
        rules, map_ini = theater['effectiveRules'], ini(raw)
        fingerprint = lambda: builder.crate_fingerprint(cells, meta, rules, map_ini)
        baseline = fingerprint()
        self.assertEqual(baseline, source['crateFingerprint'])
        map_ini['AITRIGGERTYPESENABLE'] = {'ANY': 'yes'}
        map_ini['HEADER'] = {'VERSION': '4'}
        map_ini['PREVIEWPACK'] = {'1': 'not relevant'}
        self.assertEqual(fingerprint(), baseline)
        cell = next(c for c in cells.values() if c['candidate'] and c['status'] == 'crate')
        for field, value in [('occupied', True), ('level', cell['level']+1), ('slope', 1),
                             ('rawLand', 1), ('overlayData', cell['overlayData']+1)]:
            old = cell[field]
            if old == value:
                value += 1
            cell[field] = value
            self.assertNotEqual(fingerprint(), baseline, field)
            cell[field] = old
        map_ini.setdefault('GENERAL', {})['WATERCRATECHANCE'] = '0.8'
        self.assertNotEqual(fingerprint(), baseline)

    def test_player_count_is_not_part_of_name(self):
        self.assertEqual(maps.display_name('冰天雪地（2-8）'), '冰天雪地')
        self.assertEqual(maps.display_name('拯救行动 (2)'), '拯救行动')
        self.assertEqual(maps.display_name('测试（特别版）'), '测试（特别版）')


if __name__ == '__main__':
    unittest.main()
