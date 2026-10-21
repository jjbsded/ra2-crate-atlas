"""Bridge raster regressions against the shipped SHP pixels, not golden images."""
import zipfile
import numpy as np
from PIL import Image

from realmap import ROOT, parse_map, shp_frame, tile_parts
from realmap_render import (render, sprite_spec, palette, mark_bridge_stencil,
                            bridge_terrain_mask)


# A later flat water tile must preserve the deck; sufficiently raised terrain
# must still cover it. Transparent sprite pixels must not protect any terrain.
stencil = np.zeros((12, 12), dtype=np.uint8)
bridge = Image.new('RGBA', (4, 4), (100, 100, 100, 255))
bridge.putpixel((0, 0), (0, 0, 0, 0))
mark_bridge_stencil(bridge, 3, 3, 2, stencil)
ground = Image.new('RGBA', (12, 12), (0, 0, 255, 255))
for level in (0, 2, 3):
    mask = bridge_terrain_mask(ground, 0, 0, level, stencil)
    assert mask.getpixel((4, 4)) == 0
    assert mask.getpixel((3, 3)) == 255
assert bridge_terrain_mask(ground, 0, 0, 4, stencil).getpixel((4, 4)) == 255
# Clipped edge sprites must not wrap their masks onto the opposite edge.
mark_bridge_stencil(bridge, -2, -2, 2, stencil)
assert stencil[0, 0] == 5 and stencil[-1, -1] == 0

out = ROOT/'output/bridge-render-verification'
with zipfile.ZipFile(ROOT/'official-maps/maps.zip') as archive:
    for version, prefix in [('ra2', ''), ('yr', 'x')]:
        for stem, owner, targets in [
            ('mp26s6', (84, 88), [(84, 87), (84, 88), (84, 89)]),
            ('mp30s6', (143, 130), [(142, 130), (143, 130), (144, 130)]),
        ]:
            name = prefix+stem+'.map'
            folder = out/(version+'-'+stem)
            folder.mkdir(parents=True, exist_ok=True)
            cells, res, theater, tmps, meta = parse_map(
                archive.read(version+'/'+name), folder, version)
            result = render(cells, res, theater, tmps, folder, meta, lambda *args: None)
            assert not result['missingSprites']
            assert not result['objects']['missing']
            ox, oy = result['origin']
            def center(c):
                return 30*(c['x']-c['y'])+ox, 15*(c['x']+c['y']-c['level'])+oy
            c = cells[owner]
            assert c['overlayData'] == 1
            raw, pal, offset, _ = sprite_spec(c['overlayName'], True, 1, res, theater)
            sprite = shp_frame(raw, 1, pal)
            sx, sy = center(c)
            sx -= sprite.width//2
            sy += offset-sprite.height//2
            for filename in (result['image'], result['objectImage']):
                with Image.open(folder/filename) as image:
                    for target in targets:
                        q = cells[target]
                        assert q['rawLand'] == 2
                        x, y = center(q)
                        expected = sprite.getpixel((x-sx, y-sy))
                        assert expected[3] == 255
                        assert image.getpixel((x, y)) == expected[:3], (version, name, target, filename)
                    if stem == 'mp30s6':
                        # This isolated placeholder really has no neighboring
                        # visible bridge sprite. Do not invent frame 1 for it.
                        q = cells[90, 60]
                        assert q['bridge']['emptySprite'] and q['overlayData'] == 0
                        tile = tile_parts(tmps[q['file']], q['subTile'],
                                          palette(theater['palette']))[0][0]
                        assert image.getpixel(center(q)) == tile.getpixel((30, 15))[:3]
            print('PASS', version, name, 'three-cell deck, both image layers', flush=True)
print('PASS: bridge masks preserve flat water and allow raised foreground terrain', flush=True)
