"""Resource naming regressions; no game/Mod art is included in these fixtures."""
from types import SimpleNamespace
import unittest

from realmap_render import sprite_spec, refresh_sprite_issues


class SpriteResolutionTests(unittest.TestCase):
    def resolve(self, files, art=None, climate='URBAN', ext='urb'):
        requests = []
        def get(mixes, name):
            requests.append(name)
            if name.endswith('.pal'):
                return bytes(768)
            if name in files:
                return name.encode('ascii')
            raise ValueError('Missing '+name)
        # Exercise both Rules.Image and Art.Image; never special-case a type.
        res = SimpleNamespace(art={'WALLART': {'IMAGE':'xawall', 'NEWTHEATER':'yes', **(art or {})}}, get=get)
        theater = dict(name=climate, ext=ext, stem='urban', tilemix=[],
            effectiveRules={'WALLTYPE': {'IMAGE':'WALLART', 'WALL':'yes'}})
        result = sprite_spec('WALLTYPE', True, 13, res, theater)
        self.assertEqual(result[3]['frame'], 13)
        self.assertEqual(result[3]['palette'], 'unit'+ext+'.pal')
        self.assertEqual(result[2], -12)
        return result[0].decode(), requests

    def test_current_climate_wins_over_generic_and_original(self):
        name, requests = self.resolve({'xuwall.shp', 'xgwall.shp', 'xawall.shp'})
        self.assertEqual(name, 'xuwall.shp')
        self.assertNotIn('xgwall.shp', requests)

    def test_generic_wins_over_original(self):
        name, requests = self.resolve({'xgwall.shp', 'xawall.shp'})
        self.assertEqual(name, 'xgwall.shp')
        self.assertNotIn('xawall.shp', requests)

    def test_original_filename_fallback_across_all_climates(self):
        for climate, ext in [('TEMPERATE','tem'), ('SNOW','sno'), ('URBAN','urb'),
                             ('NEWURBAN','ubn'), ('DESERT','des'), ('LUNAR','lun')]:
            with self.subTest(climate=climate):
                name, requests = self.resolve({'xawall.shp'}, climate=climate, ext=ext)
                self.assertEqual(name, 'xawall.shp')
                self.assertEqual(requests.count('xawall.shp'), 1)

    def test_plain_and_theater_suffix_preserved(self):
        self.assertEqual(self.resolve({'xawall.shp'}, {'NEWTHEATER':'no'})[0], 'xawall.shp')
        self.assertEqual(self.resolve({'xawall.urb'}, {'THEATER':'yes'})[0], 'xawall.urb')

    def test_non_placeholder_letter_is_not_rewritten(self):
        name, requests = self.resolve({'xwall.shp', 'xuall.shp', 'xgall.shp'}, {'IMAGE':'xwall'})
        self.assertEqual(name, 'xwall.shp')
        self.assertNotIn('xuall.shp', requests)
        self.assertNotIn('xgall.shp', requests)

    def test_missing_resource_still_reports_attempted_names(self):
        with self.assertRaisesRegex(ValueError, 'xuwall.shp, xgwall.shp, xawall.shp'):
            self.resolve(set())

    def test_render_upgrade_replaces_only_sprite_warnings(self):
        other = dict(message='缺少外部 INI', count=2, cells=[[4,5]])
        meta = {'loadIssues':[other, dict(message='地形物／覆盖物贴图未能绘制：OLD')]}
        refresh_sprite_issues(meta, {'missingSprites':['NEW']})
        self.assertEqual(meta['loadIssues'][0], other)
        self.assertEqual(meta['loadIssues'][1]['message'], '地形物／覆盖物贴图未能绘制：NEW')
        refresh_sprite_issues(meta, {'missingSprites':[]})
        self.assertEqual(meta['loadIssues'], [other])


if __name__ == '__main__':
    unittest.main()
