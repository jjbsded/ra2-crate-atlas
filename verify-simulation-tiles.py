"""Lossless tile transport, immutable-ground acknowledgements and bounded replay."""
from collections import OrderedDict
from io import BytesIO
import base64
from unittest.mock import patch
import runtime_bootstrap
from PIL import Image
import simulation_visual as V


def decode(src):
    return Image.open(BytesIO(base64.b64decode(src.split(',', 1)[1]))).convert('RGBA')


scene = V.Scene.__new__(V.Scene)
scene.width, scene.height = 100*V.TILE, V.TILE
scene.tile_revisions = {(0, 0): 1}
scene.events, scene.sprite_tiles = {}, {}
scene.ground_epoch = 'test-scene'
scene.ground_encodings, scene.painted_tiles = OrderedDict(), OrderedDict()
ground = Image.new('RGBA', (256, 256), (199, 175, 141, 255))
objects = ground.copy()
objects.putpixel((120, 135), (72, 255, 104, 255))
calls = []


def replay(tile, box, events):
    calls.append(tile)
    return ground, objects


scene.flat_replay = replay
first = scene.paint({}, 0)
tile = first['patches'][0]
assert decode(tile['ground']).tobytes() == ground.tobytes()
assert decode(tile['objects']).tobytes() == objects.tobytes()
key = tile['groundKey']
again = scene.paint({}, 0, known_ground=[key])
assert len(calls) == 1 and again['tileReused'] == 1
assert again['rasterMs'] == again['encodeMs'] == 0
assert 'ground' not in again['patches'][0]
assert again['groundReused'] == 1
# A changed object invalidates only that tile's object image; its flat ground
# remains the same checkpoint. Old clients still receive a complete packet.
objects.putpixel((120, 135), (0, 40, 220, 255))
scene.tile_revisions[(0, 0)] = 2
edited = scene.paint({}, 1, known_ground=[key])
assert len(calls) == 2 and edited['groundReused'] == 1
assert edited['patches'][0]['groundKey'] == key
assert 'ground' not in edited['patches'][0]
assert decode(edited['patches'][0]['objects']).tobytes() == objects.tobytes()
legacy = scene.paint({}, 1)
assert legacy['patches'][0]['ground'] == tile['ground']
assert decode(tile['objects']).tobytes() != objects.tobytes()
assert scene.paint({}, 2)['patches'] == []
# Preserve RGB even under fully transparent pixels (exports and comparisons).
alpha = Image.new('RGBA', (16, 16), (81, 32, 159, 0))
alpha.putpixel((7, 7), (240, 180, 35, 127))
assert decode(V.encode(alpha)).tobytes() == alpha.tobytes()
with patch('PIL.features.check', return_value=False):
    png = V.encode(alpha)
assert png.startswith('data:image/png;') and decode(png).tobytes() == alpha.tobytes()
for x in range(1, 99):
    scene.tile_revisions = {(x, 0): 3}
    scene.paint({}, 2)
assert len(scene.ground_encodings) == 64 and len(scene.painted_tiles) == 96
print('PASS exact RGBA transport, immutable grounds, tile revision reuse, old clients and bounded LRUs')
