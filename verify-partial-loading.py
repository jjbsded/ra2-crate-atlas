"""Exercise real decode/render paths: local failures preserve usable map content."""
import base64
from pathlib import Path
import struct
import tempfile
import unittest

from realmap import ROOT, analyze, lzokay, read_search
from realmap_3d import build_patch


def fixture(extra='', tile=0):
    raw = struct.pack('<hhIBBB', 8, 8, tile, 0, 3, 0)
    packed = lzokay.compress(raw)
    encoded = base64.b64encode(struct.pack('<HH', len(packed), len(raw))+packed).decode()
    return (f'[Map]\nSize=0,0,8,12\nLocalSize=0,0,8,12\nTheater=TEMPERATE\n'
            f'[IsoMapPack5]\n1={encoded}\n'+extra).encode()


class PartialLoadingChecks(unittest.TestCase):
    def setUp(self):
        (ROOT/'output').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'output')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def read(self, data, version='yr'):
        result = analyze(data, self.folder, version, 'fixture.map')
        self.assertEqual((self.folder/'source.map').read_bytes(), data)
        return result

    def assert_partial(self, report):
        self.assertTrue(report['metadata']['partialAnalysis'])
        self.assertTrue(report['metadata']['approximate'])
        self.assertFalse(report['metadata']['previewOnly'])
        p = report['probability']
        exact = p['exact']; coefficients = [int(c['numerator']) for c in exact['coefficients']]
        mass = sum(count*coefficients[i] for c in report['cells'] for i, count in c['terms'])
        self.assertEqual(mass+int(exact['ghostNumerator'])+int(exact['failureNumerator']), int(exact['denominator']))
        self.assertTrue(any(c['probability'] > 0 for c in report['cells']))
        self.assertEqual(report['markers'], [])
        self.assertTrue((self.folder/report['rendering']['image']).is_file())

    def test_missing_art_keeps_known_objects_and_map(self):
        report = self.read(fixture('[VehicleTypes]\n9900=A12DROP\n[A12DROP]\nImage=TYSJ\n'
            '[Units]\n0=Neutral,HTNK,256,8,8,0,Guard\n1=Neutral,A12DROP,256,9,8,0,Guard\n'))
        self.assert_partial(report)
        self.assertIn('TYSJ', report['metadata']['analysisError'])
        self.assertGreater(report['rendering']['objects']['total'], 0)
        self.assertTrue(any('A12DROP' in c['objects'] and c.get('occupancyUnknown') for c in report['cells']))
        unknown = next(c for c in report['cells'] if 'A12DROP' in c['objects'])
        self.assertTrue(unknown['assumedRetry'] and unknown['candidate'])
        self.assertEqual(unknown['status'], 'retry')
        self.assertEqual(unknown['probability'], 0)
        maximum = sum(report['metadata']['size'][2:])-1
        selections = list(read_search(self.folder/'search.bin', maximum**2))
        origin = (unknown['y']-1)*maximum+unknown['x']-1
        self.assertTrue(selections[origin])
        self.assertEqual(set(selections[origin]), {unknown['y']*512+unknown['x']})

    def test_missing_tile_preserves_height_and_other_tiles_in_2d_and_3d(self):
        report = self.read(fixture(tile=65000))
        self.assert_partial(report)
        lookup = {(c['x'], c['y']):c for c in report['cells']}
        c = lookup[8, 8]
        self.assertEqual(c['level'], 3)
        self.assertIsNone(c['rawLand'])
        self.assertIn('TileIndex=65000', c['terrainError'])
        self.assertFalse(lookup[9, 8].get('terrainError'))
        patch = build_patch(report, lookup, self.folder/'result.json', 8, 8, 4)
        self.assertFalse(patch['metadata']['predictionEnabled'])
        self.assertTrue(patch['metadata']['missing'])
        self.assertTrue(any(c['texture'] for c in patch['cells']))

    def test_known_blocker_on_unknown_cell_still_blocks_search(self):
        report = self.read(fixture('[VehicleTypes]\n9900=MYSTERY\n[MYSTERY]\nImage=NOART\n'
            '[Units]\n0=Neutral,HTNK,256,9,8,0,Guard\n1=Neutral,MYSTERY,256,9,8,0,Guard\n'))
        self.assert_partial(report)
        c = next(c for c in report['cells'] if (c['x'], c['y']) == (9, 8))
        self.assertTrue(c['assumedRetry'])
        self.assertTrue(c['occupied'])
        self.assertFalse(c['candidate'])

    def test_invalid_object_does_not_drop_good_objects(self):
        report = self.read(fixture('[Units]\n0=Neutral,HTNK,256,8,8,0,Guard\n1=Neutral,HTNK,256,no,8\n2=broken\n'))
        self.assert_partial(report)
        self.assertEqual(report['rendering']['objects']['total'], 1)
        self.assertEqual(len(report['metadata']['loadIssues']), 2)

    def test_invalid_overlay_keeps_terrain(self):
        report = self.read(fixture('[OverlayPack]\n1=invalid!\n'))
        self.assert_partial(report)
        self.assertTrue(any('OverlayPack' in i['message'] for i in report['metadata']['loadIssues']))
        self.assertTrue(all(not c.get('terrainError') for c in report['cells']))

    def test_unsupported_ra2_aircraft_can_preview(self):
        report = self.read(fixture('[Aircraft]\n0=Neutral,ORCA,256,8,8,0,Guard\n'), 'ra2')
        self.assert_partial(report)
        self.assertEqual(report['metadata']['version'], 'ra2')

    def test_corrupt_core_still_reports_failure(self):
        for data in (b'not a map', fixture().replace(b'Size=0,0,8,12', b'Size=0,0,0,0'),
                     b'[Map]\nSize=0,0,8,12\nLocalSize=0,0,8,12\nTheater=TEMPERATE\n[IsoMapPack5]\n1=invalid!'):
            with self.assertRaises(ValueError):
                analyze(data, self.folder)

    def test_supported_map_still_has_exact_probabilities(self):
        report = self.read(fixture())
        self.assertFalse(report['metadata'].get('previewOnly'))
        self.assertIsNotNone(report['probability']['exact'])
        self.assertTrue(any(c['probability'] > 0 for c in report['cells']))


if __name__ == '__main__':
    unittest.main()
