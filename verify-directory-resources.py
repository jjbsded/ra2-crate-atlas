"""Synthetic, relocatable discovery tests; no particular Mod installation."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import realmap_mod as mod
from ra2mod import mix_id


def mix(items):
    index, body = [], b''
    for name, data in items.items():
        index.append(struct.pack('<III', mix_id(name), len(body), len(data)))
        body += data
    return struct.pack('<HI', len(items), len(body))+b''.join(index)+body


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=mod.ROOT/'output')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, data):
        target = self.root/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def test_priority_includes_and_live_changes(self):
        self.write('ra2md.mix', mix({'localmd.mix': mix({'rulesmd.ini': b'[BASE]\nValue=base'})}))
        self.write('expandmd01.mix', mix({'rulesmd.ini': b'[ONE]\nValue=one'}))
        self.write('expandmd99.mix', mix({'rulesmd.ini': b'[TWO]\nValue=two'}))
        first = mod.discover(self.root)
        self.assertTrue(first['sources']['rulesmd.ini'].endswith('expandmd99.mix::rulesmd.ini'))
        self.assertEqual(mod.ModResources(self.root, None).rules, {'TWO': {'VALUE': 'two'}})
        self.write('rulesmd.ini', b'[#include]\n0=Rules/units.ini\n[TOP]\nValue=loose')
        self.write('Rules/units.ini', b'[UNITS]\nImage=NEWIMAGE')
        self.write('artmd.ini', b'[NEWIMAGE]\nVoxel=no')
        resource = mod.ModResources(self.root, None)
        self.assertEqual(resource.rules['UNITS']['IMAGE'], 'NEWIMAGE')
        self.assertNotIn('TWO', resource.rules)
        self.assertNotEqual(first['fingerprint'], resource.discovery['fingerprint'])
        self.assertEqual(resource.art['NEWIMAGE']['VOXEL'], 'no')

    def test_arbitrary_package_missing_art_and_corrupt_archive(self):
        self.write('my-assets.mix', mix({'rules.ini': b'[GENERAL]\nCrateMinimum=3'}))
        self.write('expand99.mix', b'broken')
        found = mod.discover(self.root)
        self.assertEqual(found['engineVersion'], 'ra2')
        for name in ('art.ini', 'expand99.mix', 'my-assets.mix'):
            self.assertTrue(any(name in issue for issue in found['issues']))
        self.assertEqual(mod.ModResources(self.root, None).rules['GENERAL']['CRATEMINIMUM'], '3')

    def test_nested_original_resources(self):
        self.write('RA2.MIX', mix({'local.mix': mix({'rules.ini': b'[GENERAL]\nValue=original',
                                                  'art.ini': b'[IMAGE]\nVoxel=no'}),
                                   'cache.mix': mix({'isotem.pal': b'palette'})}))
        resource = mod.ModResources(self.root, None)
        self.assertEqual(resource.version, 'ra2')
        self.assertEqual(resource.get(['cache.mix'], 'isotem.pal'), b'palette')

    def test_settings_migration_and_failed_save(self):
        game = self.root/'game'; game.mkdir()
        (game/'rulesmd.ini').write_bytes(b'[GENERAL]\nValue=present')
        self.write('profiles/local.json', json.dumps({'root': str(game), 'search_order': ['obsolete.mix'],
                                                    'expected_sha256': {'unknown.dll': 'bad'}}).encode())
        with patch.object(mod, 'ROOT', self.root):
            self.assertTrue(mod.status()['ready'])
            self.assertFalse((self.root/'profiles/local.json').exists())
            saved = mod.profile_path().read_bytes()
            self.assertEqual(json.loads(saved), {'root': str(game)})
            with self.assertRaises(ValueError):
                mod.configure(str(self.root/'missing'))
            self.assertEqual(saved, mod.profile_path().read_bytes())
            mod.configure('')
            self.assertFalse(mod.status()['configured'])

    def test_report_keeps_root_and_rejects_changed_assets(self):
        self.write('rulesmd.ini', b'[GENERAL]\nValue=present')
        found = mod.discover(self.root)
        meta = dict(resourceRoot=str(self.root), resourceFingerprint=found['fingerprint'])
        with patch.object(mod, 'selected_root', return_value='another-directory'):
            self.assertEqual(mod.root_for_report(meta), str(self.root))
        self.write('unrelated.log', b'new log')
        self.assertEqual(mod.root_for_report(meta), str(self.root))
        self.write('artmd.ini', b'[IMAGE]\nVoxel=yes')
        with self.assertRaisesRegex(ValueError, '已变化'):
            mod.root_for_report(meta)


if __name__ == '__main__':
    unittest.main()
