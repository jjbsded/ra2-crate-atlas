"""Regression checks for missing unit brightness and per-cell palette caches."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import runtime_bootstrap
import numpy as np
from realmap_palette_lighting import light_step, light_palette

ROOT = Path(__file__).resolve().parent


class PaletteLightingChecks(unittest.TestCase):
    def test_known_intensity_rows_and_overrides(self):
        rules = {'AUDIOVISUAL': {'EXTRAUNITLIGHT': '.2', 'EXTRAAIRCRAFTLIGHT': '.4'}}
        self.assertEqual(light_step(rules, {}, 'UNITS'), 37)
        self.assertEqual(light_step(rules, {}, 'STRUCTURES'), 31)
        self.assertEqual(light_step(rules, {}, 'AIRCRAFT'), 43)
        self.assertEqual(light_step(rules, {'AMBIENT': '.6', 'GROUND': '.1', 'LEVEL': '.05'}, 'UNITS', 6), 31)
        self.assertEqual(light_step(rules, {'AMBIENT': '-3'}, 'UNITS'), 0)
        self.assertEqual(light_step(rules, {'AMBIENT': '4'}, 'UNITS'), 62)
        self.assertEqual(light_step(rules, {'AMBIENT': 'nan'}, 'UNITS'), 37)

    def test_special_colors_and_clipping(self):
        colors = [(100, 200, 250)] * 256
        bright = light_palette(colors, 37)
        self.assertEqual(bright[100], (119, 238, 255))
        self.assertEqual(bright[16], (119, 238, 255))
        self.assertEqual(bright[240:255], colors[240:255])
        self.assertEqual(bright[0], colors[0])
        self.assertEqual(light_palette(colors, 0)[100], (0, 0, 0))
        self.assertEqual(colors[100], (100, 200, 250))

    def test_real_models_brightness_preserves_alpha_shadow_and_cache(self):
        from realmap_resources import resources
        from realmap_objects import ObjectPainter
        res = resources('yr'); theater = res.theater('URBAN')
        theater.update(effectiveRules=res.rules, mapLighting={'AMBIENT':'1', 'LEVEL':'.032'})
        with tempfile.TemporaryDirectory(dir=ROOT/'output') as temp:
            painter = ObjectPainter(res, theater, Path(temp))
            painter.cells = {(20,20): {'level':0}, (21,20): {'level':8}}
            try:
                for kind in ('MTNK', 'HTNK', 'AMCV', 'V3', 'ORCA'):
                    obj = dict(type=kind, category='AIRCRAFT' if kind=='ORCA' else 'UNITS',
                               house='AMERICANS', facing=64, health=256, mission='Guard', upgrades=[], x=20, y=20)
                    with patch.object(painter, 'voxel_brightness', return_value=31):
                        old = painter.parts(obj)
                    new = painter.parts(obj)
                    high = painter.parts({**obj, 'x':21})
                    self.assertIs(new, painter.parts(obj))
                    self.assertIsNot(new, high)
                    changed = 0
                    for a,b,c in zip(old,new,high):
                        for field in ('x','y','shadowX','shadowY'):
                            self.assertEqual(a[field], b[field])
                        self.assertEqual(a['image'].getchannel('A').tobytes(), b['image'].getchannel('A').tobytes())
                        if a['shadow'] is not None: self.assertEqual(a['shadow'].tobytes(), b['shadow'].tobytes())
                        aa,bb = np.asarray(a['image']),np.asarray(b['image'])
                        self.assertTrue(np.all(bb[:,:,:3] >= aa[:,:,:3]))
                        changed += np.count_nonzero(np.any(aa[:,:,:3] != bb[:,:,:3], axis=2) & (aa[:,:,3]>0))
                        self.assertGreater(c['paletteLightStep'], b['paletteLightStep'])
                    self.assertGreater(changed, 20, kind)
            finally:
                if painter.voxels: painter.voxels.close()


if __name__ == '__main__': unittest.main()
