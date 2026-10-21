"""Teaching fixtures preserve the six asymmetric positions and stock-only assets."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(); self.ids = []; self.links = []; self.scripts = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'a':
            self.links.append(attrs)
        if tag in ('script', 'link'):
            name = attrs.get('src') or attrs.get('href')
            if name:
                assert (ROOT/name.split('?')[0]).is_file(), name
                if tag == 'script':
                    self.scripts.append(name.split('?')[0])


class DemoChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = json.loads((ROOT/'examples/cliff-demo.json').read_text('utf8'))

    def test_six_asymmetric_cells_and_rough_transition(self):
        from realmap_3d import relation_data
        from realmap_parser import land_after
        from realmap_resources import resources
        scene = self.bundle['single']; cells = scene['cells']
        lookup = {(c['x'], c['y']): c for c in cells}
        self.assertEqual(len(cells), 81)
        self.assertEqual([p for p, c in lookup.items() if c['level'] == 6], [(98, 106)])
        expected = {(98, 107), (99, 106), (96, 104), (97, 105), (99, 105), (97, 107)}
        self.assertEqual({p for p, c in lookup.items() if c['higher']}, expected)
        self.assertEqual({(x, y) for x, y, _ in lookup[98, 106]['affected']}, expected)
        for c in cells:
            higher, affected = relation_data(c, lookup, True)
            self.assertEqual(c['higher'], higher); self.assertEqual(c['affected'], affected)
            self.assertEqual(c['land'], land_after(c['rawLand'], 0, None, higher, 2))
            self.assertEqual(c['postLand'], land_after(c['rawLand'], 0, resources('yr').rules['CRATE'], higher, 2))
            self.assertIsNone(c['probability'], 'A geometric example must not invent random-crate probabilities.')
        rough = lookup[99, 105]
        self.assertEqual((rough['land'], rough['postLand'], rough['canPlace'], rough['marked']), (7, 3, True, True))
        self.assertTrue(all(lookup[p]['land'] == 3 and not lookup[p]['canPlace'] for p in expected-{(99, 105)}))
        outside = lookup[102, 102]
        self.assertEqual((outside['land'], outside['postLand'], outside['marked']), (0, 0, False))

    def test_fixture_provenance_and_texture_closure(self):
        bundle = self.bundle
        self.assertEqual(bundle['sourceSha256'], hashlib.sha256((ROOT/bundle['source']).read_bytes()).hexdigest())
        self.assertEqual(bundle['real']['metadata']['version'], 'yr')
        self.assertFalse(bundle['real']['metadata']['missing'])
        textures = bundle['real']['textures']
        self.assertTrue(all(value.startswith('data:image/png;base64,') for value in textures.values()))
        for scene in (bundle['real'], bundle['single']):
            for cell in scene['cells']:
                for name in (cell.get('texture'), cell.get('wallTexture'), *cell['walls']):
                    if name:
                        self.assertIn(name, textures)
                for decoration in cell['decorations']:
                    self.assertIn(decoration['texture'], textures)

    def test_persistent_entries_and_offline_page_dependencies(self):
        for name in ('maps.html', 'index.html'):
            page = Page((ROOT/name).read_text('utf8'))
            links = [link for link in page.links if link.get('href') == 'cliff-demo.html']
            self.assertEqual(len(links), 1)
            self.assertEqual(links[0].get('target'), '_blank')
            self.assertIn('noopener', links[0].get('rel', ''))
        page = Page((ROOT/'cliff-demo.html').read_text('utf8'))
        self.assertEqual(len(page.ids), len(set(page.ids)))
        self.assertLess(page.scripts.index('terrain3d.js'), page.scripts.index('cliff-demo.js'))


if __name__ == '__main__':
    unittest.main()
