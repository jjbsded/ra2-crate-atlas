"""Bridge raster regressions against the shipped SHP pixels, not golden images."""
import zipfile
import copy
import struct
import tempfile
import numpy as np
from PIL import Image

from realmap import ROOT, parse_map, shp_frame, tile_parts
from realmap_render import (render, sprite_spec, palette, mark_bridge_stencil,
                            bridge_terrain_mask)
from realmap_bridges import sprite_frame
from terrain_depth import tile_pixel_heights, tile_depths, relief_mesh
from map_test_fixtures import fixture
from unittest.mock import patch


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


def high_bridge_depth_checks():
    """One original pier and an isolated deck: test pixels, not a named map fix."""
    for version, climate in ((v,t) for v in ('ra2','yr') for t in ('URBAN','SNOW','TEMPERATE')):
        with tempfile.TemporaryDirectory(dir=ROOT/'output') as temp:
            from pathlib import Path
            folder = Path(temp)
            base, res, theater, tmps, meta = parse_map(fixture(climate, water=True), folder, version)
            file = 'ovrps12.'+theater['ext']
            raw = res.get(theater['tilemix'], file)
            tmps[file] = raw
            parts = tile_parts(raw, 8, palette(theater['palette']))
            heights = tile_pixel_heights(raw, 8, parts)
            assert all(h is not None for h in heights)
            for part, h in zip(parts, heights):
                if part[1:] == (0, 0):
                    assert np.all(h[np.asarray(part[0])[:, :, 3] != 0] == 0)
            # Missing/corrupt optional Z leaves the color usable and falls back.
            off, = struct.unpack_from('<I', raw, 16+8*4)
            broken = bytearray(raw)
            struct.pack_into('<i', broken, off+16, len(raw))
            assert tile_depths(broken, 8, parts)[1] is None
            assert relief_mesh(broken, 8, parts) is None
            for name, frame in (('BRIDGE1', 0), ('BRIDGE2', 9), ('BRIDGEB1', 0), ('BRIDGEB2', 9)):
                cells = copy.deepcopy(base)
                c = cells[20,20]
                c.update(overlayName=name, overlayData=frame)
                br, pal, offset, _ = sprite_spec(name, True, sprite_frame(c), res, theater)
                sprite = shp_frame(br, sprite_frame(c), pal)
                # Exercise both bridge orientations without assuming their SHP
                # silhouettes intersect the same neighbor. This placement is a
                # synthetic fixture, independent of a map/asset-name exception.
                im,dx,dy = parts[1]
                placements = []
                for px in range(18,23):
                    for py in range(18,23):
                        if px+py < 39 or (px,py)==(20,20):
                            continue
                        deck = Image.new('RGBA',im.size)
                        rx,ry = 30*(px-py)-30+dx,15*(px+py)-15+dy
                        deck.paste(sprite,(-sprite.width//2-rx,600-sprite.height//2+offset-ry))
                        shared = (np.asarray(im)[:,:,3]!=0)&(np.asarray(deck)[:,:,3]!=0)
                        placements.append((int((shared & (heights[1]<60)).sum()),px,py))
                _,px,py = max(placements)
                pier = cells[px,py]
                pier.update(file=file, subTile=8, level=0)
                result = render(cells,res,theater,tmps,folder,meta,lambda *a:None)
                ox,oy = result['origin']
                sx,sy = ox-sprite.width//2, oy+600-sprite.height//2+offset
                x,y = ox+30*(px-py)-30+dx, oy+15*(px+py)-15+dy
                # Build an independent bridge bitmap in the pier's pixel window.
                deck = Image.new('RGBA',im.size)
                deck.paste(sprite,(sx-x,sy-y))
                expected = np.asarray(deck)
                shared = (np.asarray(im)[:,:,3]!=0)&(expected[:,:,3]!=0)
                behind = shared & (heights[1] < 60)
                front = shared & (heights[1] >= 60)
                assert behind.any(), (climate,name,'no undercut pixels exercised')
                for filename in (result['image'],result['objectImage']):
                    with Image.open(folder/filename) as painted:
                        actual = np.asarray(painted.crop((x,y,x+im.width,y+im.height)))
                    assert np.array_equal(actual[behind],expected[:,:,:3][behind]), (climate,name,filename)
                    # A parapet at/above deck level still wins; the fix must not
                    # simply draw every high bridge above all terrain.
                    if front.any():
                        assert np.array_equal(actual[front],np.asarray(im)[:,:,:3][front]), (climate,name,'foreground')
            print('PASS',version,climate,'road/wood decks, both directions, original pier depth',flush=True)

    # The high-bit encoding and 1/15-level comparisons must also clip safely.
    stencil = np.zeros((6,6),dtype=np.uint8)
    im = Image.new('RGBA',(4,4),(255,255,255,255))
    mark_bridge_stencil(im,-2,-2,2,stencil,high=True)
    heights = np.full((6,6),89,dtype=np.int16)
    mask = bridge_terrain_mask(Image.new('RGBA',(6,6),(0,0,0,255)),0,0,0,stencil,
                              pixel_heights=heights,ground_level=0)
    assert mask.getpixel((0,0)) == 0 and mask.getpixel((5,5)) == 255
    heights[:] = 90
    assert bridge_terrain_mask(Image.new('RGBA',(6,6),(0,0,0,255)),0,0,0,stencil,
                              pixel_heights=heights,ground_level=0).getpixel((0,0)) == 255
    assert bridge_terrain_mask(im,0,0,2,stencil).getpixel((0,0)) == 0


def high_bridge_shadow_checks():
    """Neighboring span shadows land below, while the painted deck stays lit."""
    for version in ('ra2','yr'):
        with tempfile.TemporaryDirectory(dir=ROOT/'output') as temp:
            from pathlib import Path
            folder = Path(temp)
            base,res,theater,tmps,meta = parse_map(fixture('URBAN',water=True),folder,version)
            for name,frame in (('BRIDGE1',0),('BRIDGE2',9),('BRIDGEB1',0),('BRIDGEB2',9)):
                cells = copy.deepcopy(base)
                sources = []
                for step in range(16,25):
                    p = (step,20) if frame == 0 else (20,step)
                    c = cells[p]
                    c.update(overlayName=name,overlayData=frame)
                    sources.append(c)
                with patch('realmap_render.shadow_frame',return_value=(None,{})):
                    reference = render(cells,res,theater,tmps,folder,meta,lambda *a:None)
                unshadowed = {key:np.asarray(Image.open(folder/reference[key])).copy()
                              for key in ('image','objectImage')}
                result = render(cells,res,theater,tmps,folder,meta,lambda *a:None)
                ox,oy = result['origin']
                bodies = Image.new('L',(result['width'],result['height']))
                for c in sources:
                    raw,pal,offset,_ = sprite_spec(name,True,sprite_frame(c),res,theater)
                    sprite = shp_frame(raw,sprite_frame(c),pal)
                    x = ox+30*(c['x']-c['y'])-sprite.width//2
                    y = oy+15*(c['x']+c['y']-c['level'])-sprite.height//2+offset
                    bodies.paste(255,(x,y,x+sprite.width,y+sprite.height),sprite.getchannel('A'))
                deck = np.asarray(bodies)!=0
                assert result['shadows']['pixels']>0, 'Ground shadows must remain visible'
                for key in ('image','objectImage'):
                    actual = np.asarray(Image.open(folder/result[key]))
                    assert np.array_equal(actual[deck],unshadowed[key][deck]), (version,name,key,'shadow above deck')
                    assert np.any(actual[~deck]<unshadowed[key][~deck]), (version,name,'missing ground shadow')
                    assert np.all(actual<=unshadowed[key]), (version,name,'shadow changes colors/position')
                print('PASS',version,name,'continuous spans: deck clear, ground shadow retained',flush=True)


high_bridge_depth_checks()
high_bridge_shadow_checks()

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
