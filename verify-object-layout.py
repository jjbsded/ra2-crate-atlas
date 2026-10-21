"""Synthetic SHPs exercise layout conventions without bundling Mod assets."""
from pathlib import Path
import struct
import tempfile
import unittest

import numpy as np
from PIL import Image
from realmap import ROOT, parse_map
from realmap_objects import ObjectPainter, visual_foundation, turret_offset
from realmap_render import render, mark_sprite_stencil, bridge_terrain_mask
from map_test_fixtures import fixture


def shape(count=1, size=(9, 11), box=(2, 3, 2, 2)):
    # Each frame has its own palette index, and a nonzero crop origin.
    x, y, w, h = box
    header = struct.pack('<4H', 0, *size, count)
    headers, data = bytearray(), bytearray()
    for frame in range(count):
        headers += struct.pack('<4H4I', x, y, w, h, 0, 0, 0, 8+24*count+len(data))
        data += bytes([frame % 253+2])*(w*h)
    return header+headers+data


class Resources:
    def __init__(self, art=None, files=None, fallback=None):
        self.art = art or {}
        self.files = files or {}
        self.fallback = fallback

    def get(self, mixes, name):
        if name in self.files:
            return self.files[name]
        if self.fallback:
            return self.fallback.get(mixes, name)
        if name.endswith('.pal'):
            return bytes(v for i in range(256) for v in (i % 64, 0, 63))
        raise ValueError('Missing '+name)


def obj(category='UNITS', **extra):
    return dict(id='fixture', category=category, type='TEST', house='NEUTRAL',
        facing=0, health=256, mission='Guard', upgrades=[], x=20, y=20, subcell=0,
        aboveGround=False, **extra)


class ObjectLayoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'output')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def painter(self, art=None, cfg=None, files=None, objects=None):
        resources = Resources({'TEST': art or {}}, files or {'test.shp': shape(256)})
        theater = dict(effectiveRules={'TEST': cfg or {}}, mapObjects=objects or [],
            tilemix=[], ext='tem', stem='temperat', name='TEMPERATE')
        return ObjectPainter(resources, theater, self.folder)

    def test_direction_frames_and_full_canvas_anchor(self):
        for facings, frames in [(8, [1, 3, 5, 7]), (16, [2, 6, 10, 14]),
                                (32, [4, 12, 20, 28]), (1, [0, 0, 0, 0])]:
            painter = self.painter({'FACINGS':str(facings), 'STARTSTANDFRAME':'7',
                'STANDINGFRAMES':'2', 'STARTWALKFRAME':'99', 'WALKFRAMES':'1'})
            for raw, direction in zip((0, 64, 128, 192), frames):
                record = obj(); record['facing'] = raw
                part = painter.parts(record)[0]
                self.assertEqual(part['frame'], 7+2*direction)
                self.assertEqual((part['x'], part['y']), (-4, -5))
                self.assertEqual(part['image'].getbbox(), (2, 3, 4, 5))
        # Walk-only shapes use the same facing convention.
        part = self.painter({'FACINGS':'8', 'STARTWALKFRAME':'9', 'WALKFRAMES':'3'}).parts(obj())[0]
        self.assertEqual(part['frame'], 12)

    def test_embedded_and_separate_shp_turrets(self):
        art = {'FACINGS':'16', 'WALKFRAMES':'10', 'STARTWALKFRAME':'40',
               'STANDINGFRAMES':'10', 'STARTSTANDFRAME':'0'}
        painter = self.painter(art, {'TURRET':'yes'})
        parts = painter.parts(obj())
        self.assertEqual([p['frame'] for p in parts], [20, 164])
        self.assertEqual([p['file'] for p in parts], ['test.shp', 'test.shp'])
        painter = self.painter(art, {'TURRET':'yes'},
            {'test.shp':shape(256), 'testtur.shp':shape(32, (15, 17))})
        parts = painter.parts(obj())
        self.assertEqual([p['frame'] for p in parts], [20, 4])
        self.assertEqual((parts[1]['x'], parts[1]['y']), (-7, -8))
        self.assertIsNone(parts[1]['shadow'])
        # An absent turret cannot replace the successfully decoded body.
        painter = self.painter(art, {'TURRET':'yes'}, {'test.shp':shape(32)})
        self.assertEqual(len(painter.parts(obj())), 1)
        self.assertTrue(painter.warnings)

    def test_turret_offsets_rotate_and_height_projects_up(self):
        east = turret_offset({'TURRETOFFSET':'256,0,0'}, 64, 32)
        west = turret_offset({'TURRETOFFSET':'256,0,0'}, 192, 32)
        self.assertEqual(east, (30, 15))
        self.assertEqual(west, (-30, -15))
        self.assertEqual(turret_offset({'TURRETOFFSET':'0,0,256'}, 0, 8), (0, -36))

    def test_on_bridge_requires_a_real_high_deck(self):
        for category in ('UNITS', 'INFANTRY'):
            record = obj(category); record['aboveGround'] = True
            for bridge, expected in [(None, (555, 3)), ({'kind':'low'}, (555, 3)),
                                     ({'kind':'high'}, (495, 7))]:
                painter = self.painter(objects=[record])
                events, audit = painter.prepare({(20,20):dict(level=3,bridge=bridge)}, [0,0])
                self.assertEqual((events[0][3], events[0][4]), expected)
                self.assertEqual(audit['records'][0]['onBridgeDeck'], expected[1] == 7)
            record['aboveGround'] = False
            events, _ = self.painter(objects=[record]).prepare(
                {(20,20):dict(level=3,bridge={'kind':'high'})}, [0,0])
            self.assertEqual(events[0][3:5], (555, 3))

    def test_unit_feet_survive_ground_but_not_raised_foreground(self):
        stencil = np.zeros((20, 20), dtype=np.uint8)
        sprite = Image.new('RGBA', (5, 5), (255, 0, 0, 255))
        sprite.putpixel((0, 0), (0, 0, 0, 0))
        mark_sprite_stencil(sprite, 5, 5, 4+2, stencil)
        ground = Image.new('RGBA', (20, 20), (0, 255, 0, 255))
        for level in (0, 4):
            mask = bridge_terrain_mask(ground, 0, 0, level, stencil)
            self.assertEqual(mask.getpixel((6, 6)), 0)
            self.assertEqual(mask.getpixel((5, 5)), 255)
        self.assertEqual(bridge_terrain_mask(ground, 0, 0, 5, stencil).getpixel((6, 6)), 255)

    def test_custom_footprint_keeps_holes_and_sorts_in_front(self):
        art = {'FOUNDATION':'Custom', 'FOUNDATION.X':'3', 'FOUNDATION.Y':'3',
               'FOUNDATION.0':'0,0', 'FOUNDATION.1':'2,2'}
        self.assertEqual(visual_foundation(art), [(0,0), (2,2)])
        building = obj('STRUCTURES')
        plane = obj('AIRCRAFT'); plane.update(id='plane', x=22, y=22)
        painter = self.painter(art, objects=[building, plane])
        events, _ = painter.prepare({(20,20):dict(level=0), (22,22):dict(level=0)}, [0,0])
        self.assertAlmostEqual(events[0][0], 44.6)
        self.assertGreater(events[1][0], events[0][0])
        # An actual terrain raster used to erase this building's lower pixels.
        cells, original, theater, tmps, meta = parse_map(fixture(), self.folder, 'yr')
        theater['effectiveRules']['TEST'] = {}
        theater['mapObjects'] = [building]
        art['SHADOW'] = 'no'
        resources = Resources({**original.art, 'TEST':art},
            {'test.shp':shape(1, (120,240), (50,130,20,50))}, original)
        output = render(cells, resources, theater, tmps, self.folder, meta, lambda *a:None)
        p = ObjectPainter(resources, theater, self.folder).parts(building)[0]
        ox, oy = output['origin']
        with Image.open(self.folder/output['objectImage']) as image:
            self.assertEqual(image.getpixel((ox, oy+600+30)), p['image'].getpixel((60,165))[:3])


if __name__ == '__main__':
    unittest.main()
