"""Behavior checks for terrain extraction; optional saved-report integration."""
import argparse
import base64
import io
import json
import struct
from pathlib import Path
import unittest
import zipfile

import numpy as np
from PIL import Image
from realmap_3d import (CLIFF, ROOT, RAMPS, corner_heights, relation_data, result_path,
                       surface_height, top_texture, patch, overlay_pixels, build_patch, sample_filled,
                       add_bridge_layers)
from terrain_depth import relief_mesh, tile_surfaces, fit_relief_surfaces


class TerrainChecks(unittest.TestCase):
    def test_sort_depth_fits_flat_caps_without_flattening_walls(self):
        raw = bytearray(128)
        struct.pack_into('<4I',raw,0,2,1,60,30)
        struct.pack_into('<2I',raw,16,24,76)
        struct.pack_into('<2i',raw,24,0,0)
        struct.pack_into('<2i',raw,76,30,15)
        raw[24+40]=0;raw[76+40]=4
        self.assertEqual(tile_surfaces(raw,0),{(0,0):0,(1,0):4})
        self.assertEqual(tile_surfaces(raw,1),{(-1,0):-4,(0,0):0})
        raw[76+42]=1
        self.assertIsNone(tile_surfaces(raw,0),'A ramp stamp cannot be fitted to horizontal planes')
        raw[76+42]=0
        # A clipped sort position above a flat road must not grow a fin.
        # A visible cap in the next block returns to that plane, while the
        # vertical face below the edge retains its reconstructed height.
        for planes,u,h,v,expected in [
            ({(0,0):0},.4,1.43,.6,1/30),
            ({(0,0):0,(1,0):4},.75,3,.25,4),
            ({(0,0):0,(1,0):4},.75,2,.75,2),
        ]:
            u,h,v = np.array([u]),np.array([h]),np.array([v])
            a,b,c = fit_relief_surfaces(u,h,v,planes)
            np.testing.assert_allclose(b,expected)
            np.testing.assert_allclose(a-c,u-v,atol=1e-6)
            np.testing.assert_allclose(a+c-b,u+v-h,atol=1e-6)
        # Corrupt/unsupported header geometry leaves the depth-only fallback.
        struct.pack_into('<i',raw,76,31)
        self.assertIsNone(tile_surfaces(raw,0))

    def test_high_bridge_art_outside_movement_flags_is_retained(self):
        from realmap_bridges import initialize,sprite_frame
        from realmap_resources import resources
        res=resources('yr');theater=res.theater('URBAN');theater['effectiveRules']=res.rules
        for name,index,frame in [('BRIDGE1',24,0),('BRIDGE2',25,9),('BRIDGEB1',237,0),('BRIDGEB2',238,9)]:
            lookup={(x,y):dict(x=x,y=y,level=0,slope=0,overlay=255,overlayName=None,overlayData=0)
                    for x in range(16,25) for y in range(16,25)}
            source=lookup[20,20];source.update(overlay=index,overlayName=name,overlayData=frame)
            initialize(lookup)
            before=repr(lookup)
            records=[dict(c,corners=RAMPS[0],decorations=[]) for c in lookup.values()]
            images=[]
            def put(image):images.append(image);return len(images)-1
            missing=set();add_bridge_layers(records,lookup,res,theater,put,missing)
            self.assertFalse(missing)
            from realmap_sprites import sprite_spec,shp_frame
            raw,pal,offset,_=sprite_spec(name,True,sprite_frame(source),res,theater)
            sprite=shp_frame(raw,sprite_frame(source),pal)
            outside=0
            for c in records:
                expected=overlay_pixels(sprite,offset,source,c,4,RAMPS[0])
                expected[expected[:,:,3]==0]=0
                layers=[d for d in c['decorations'] if d.get('bridge')=='high']
                if expected[:,:,3].any():
                    self.assertEqual(len(layers),1,(name,c['x'],c['y']))
                    np.testing.assert_array_equal(np.asarray(images[layers[0]['texture']]),expected)
                    outside+=not bool(c['bridge'])
                else:self.assertFalse(layers)
            self.assertGreater(outside,0,'Rail art must extend past the movement footprint')
            self.assertEqual(repr(lookup),before,'Art footprint must not extend gameplay bridge flags')

    def test_nearest_texel_matches_exhaustive_search(self):
        rng = np.random.default_rng(713)
        for density in (0, .02, .4, 1):
            pixels = rng.integers(0, 256, (19, 37, 4), dtype=np.uint8)
            pixels[:, :, 3] = (rng.random((19, 37)) < density)*255
            # Fractional positions, exact ties and samples beyond image edges.
            px = np.concatenate([rng.uniform(-15, 52, (32, 20)), np.full((32, 1), 14.5)], axis=1)
            py = np.concatenate([rng.uniform(-15, 34, (32, 20)), np.full((32, 1), 8.5)], axis=1)
            expected = pixels[np.clip(np.floor(py).astype(int), 0, 18),
                              np.clip(np.floor(px).astype(int), 0, 36)].copy()
            ys, xs = np.nonzero(pixels[:, :, 3])
            if len(xs):
                for y, x in zip(*np.nonzero(expected[:, :, 3] == 0)):
                    nearest = np.argmin((xs-px[y, x])**2+(ys-py[y, x])**2)
                    expected[y, x] = pixels[ys[nearest], xs[nearest]]
            np.testing.assert_array_equal(np.asarray(sample_filled(Image.fromarray(pixels), px, py)), expected)

    def test_relief_preserves_projection_silhouette_and_depth(self):
        # A flat diamond plus a two-level wall with a missing corner pixel.
        raw=bytearray(20+1852+2*30*30)
        struct.pack_into('<I',raw,16,20)
        struct.pack_into('<10i',raw,20,0,0,1852,952,2752,0,-30,30,30,3)
        base=np.zeros((30,60,4),dtype=np.uint8);at=20+952
        for y in range(30):
            width=4*(y+1 if y<15 else 29-y)
            base[y,(60-width)//2:(60+width)//2]=(240,240,240,255)
            raw[at:at+width]=bytes([29-y])*width;at+=width
        wall=np.full((30,30,4),(80,90,100,255),dtype=np.uint8);wall[0,0]=0
        raw[20+2752:]=bytes([29])*(30*30)
        parts=[(Image.fromarray(base),0,0),(Image.fromarray(wall),0,-30)]
        mesh,image=relief_mesh(raw,0,parts)
        vertices=np.frombuffer(base64.b64decode(mesh['vertices']),dtype='<f4').reshape(-1,5)
        indices=np.frombuffer(base64.b64decode(mesh['indices']),dtype='<u4')
        u,h,v,tu,tv=vertices.T
        # From the game camera every mesh vertex projects back to its original
        # TMP texel; missing pixels stay missing and shared edges have one vertex.
        np.testing.assert_allclose(30+30*(u-v),tu*60,atol=1e-5)
        np.testing.assert_allclose(15*(u+v-h),(1-tv)*60-30,atol=1e-5)
        self.assertEqual(mesh['triangles'],2*(900+899))
        self.assertEqual(image.getpixel((0,0))[3],0)
        self.assertEqual(len(indices),mesh['triangles']*3)
        self.assertLess(int(indices.max()),len(vertices))
        self.assertTrue(np.isfinite(vertices).all())
        self.assertGreater(float(h.max()),2)
        # Interior flat pixels remain flat; Z is never added to Cell.Level.
        interior=(tu>.4)&(tu<.6)&(tv>.1)&(tv<.4)
        self.assertTrue(interior.any())
        np.testing.assert_allclose(h[interior],0,atol=1e-6)
        struct.pack_into('<i',raw,20+36,1)  # no Z data
        self.assertIsNone(relief_mesh(raw,0,parts))
        struct.pack_into('<i',raw,20+36,3)
        struct.pack_into('<i',raw,20+16,len(raw))  # invalid extension offset
        self.assertIsNone(relief_mesh(raw,0,parts))

    def test_asymmetric_six_positions_and_four_level_threshold(self):
        high=dict(x=20,y=20,level=6)
        lookup={(20,20):high}
        for dx in range(-3,4):
            for dy in range(-3,4):
                lookup.setdefault((20+dx,20+dy),dict(x=20+dx,y=20+dy,level=2))
        _,affected=relation_data(high,lookup,True)
        self.assertEqual({(x,y) for x,y,l in affected},{(20-dx,20-dy) for dx,dy in CLIFF})
        self.assertIn([18,18,2],affected)  # second ring, not a one-cell halo
        low=lookup[20,21];self.assertEqual(relation_data(low,lookup,True)[0],[[20,20,6]])
        low['level']=3;self.assertEqual(relation_data(low,lookup,True)[0],[])
        self.assertEqual(relation_data(high,lookup,False),([],[]))

    def test_ramp_vertices_keep_real_level_and_texture_orientation(self):
        for i,corners in enumerate(RAMPS):
            for uv,h in zip(((0,0),(1,0),(1,1),(0,1)),corners):
                self.assertEqual(surface_height(corner_heights(i),*uv),h)
        # Synthetic isometric art: red on the screen-right, blue on the left.
        im=Image.new('RGBA',(60,30));a=np.array(im)
        for y in range(30):
            for x in range(60):
                if abs((x+.5-30)/30)+abs((y+.5-15)/15)<=1:
                    a[y,x]=(220,20,20,255) if x>=30 else (20,20,220,255)
        square=np.asarray(top_texture([(Image.fromarray(a),0,0)],RAMPS[0]))
        self.assertGreater(square[12,50,0],square[12,50,2])
        self.assertGreater(square[50,12,2],square[50,12,0])
        self.assertTrue(np.all(square[:,:,3]==255))

    def test_local_result_boundary_and_request_bounds(self):
        for value in ('/etc/passwd','/output/../server.py','/output/map-123456789abc/../result.json',
                      'https://example.com/result.json','/output/map-123456789abc/result.json?x=1'):
            with self.assertRaises(ValueError):result_path(value)
        for x,y,r in ((0,1,6),(1,512,6),(1,1,99),(True,1,6)):
            with self.assertRaises(ValueError):patch('/output/map-000000000000/result.json',x,y,r)

    def test_sprite_anchor_and_neighbor_sampling(self):
        y,x=np.mgrid[:180,:180]
        pixels=np.zeros((180,180,4),dtype=np.uint8)
        pixels[:,:,0]=x;pixels[:,:,1]=y;pixels[:,:,3]=255
        image=Image.fromarray(pixels);source=dict(x=20,y=20,level=2)
        for target,level,expected in [
            (dict(x=20,y=20),2,(90,90,0,255)),
            (dict(x=21,y=20),2,(120,105,0,255)),
            (dict(x=20,y=21),2,(60,105,0,255)),
            (dict(x=20,y=20),6,(90,30,0,255)),
            (dict(x=30,y=30),2,(0,0,0,0)),
        ]:
            self.assertEqual(tuple(overlay_pixels(image,0,source,target,level,RAMPS[0])[32,32]),expected)


def bridge_integration():
    from realmap import parse_map,shp_frame
    from realmap_render import sprite_spec
    def image(data, decoration):
        return Image.open(io.BytesIO(base64.b64decode(data['textures'][decoration['texture']].split(',')[1])))
    with zipfile.ZipFile(ROOT/'official-maps/maps.zip') as archive:
        for version,prefix in [('ra2',''),('yr','x')]:
            for stem,owner,targets,edge_center,kind in [
                ('mp26s6',(84,88),[(84,87),(84,88),(84,89)],(84,83),'low'),
                ('mp30s6',(143,130),[(142,130),(143,130),(144,130)],(138,130),'low'),
                ('mp18s3',(82,85),[(80,85),(81,85),(82,85),(83,85)],(76,85),'high'),
            ]:
                folder=ROOT/'output/bridge-3d-verification'/f'{version}-{stem}'
                folder.mkdir(parents=True,exist_ok=True)
                data=archive.read(f'{version}/{prefix}{stem}.map')
                (folder/'source.map').write_bytes(data)
                cells,res,theater,_,meta=parse_map(data,folder,version)
                report=dict(metadata=meta,cells=list(cells.values()))
                before=json.dumps(report,sort_keys=True)
                full=build_patch(report,cells,folder/'result.json',*targets[0],4)
                assert not full['metadata']['missing']
                selected={(c['x'],c['y']):c for c in full['cells']}
                def layer(c):return next(d for d in c['decorations'] if d.get('bridge')==kind)
                for target in targets:
                    c=selected[target];d=layer(c)
                    assert d['flat'] and d['level']==cells[target]['level']+(4 if kind=='high' else 0)
                    assert image(full,d).getpixel((32,32))[3]==255,(version,stem,target)
                    if kind=='low':
                        source=cells[owner]
                        raw,pal,offset,_=sprite_spec(source['overlayName'],True,1,res,theater)
                        sprite=shp_frame(raw,1,pal)
                        dx,dy=target[0]-owner[0],target[1]-owner[1]
                        expected=sprite.getpixel((sprite.width//2+30*(dx-dy),
                                                  sprite.height//2-offset+15*(dx+dy)))
                        assert image(full,d).getpixel((32,32))==expected
                # Visible edge cell keeps the same artwork when its owner is
                # outside the requested patch, including elevated bridge owners.
                edge=build_patch(report,cells,folder/'result.json',*edge_center,4)
                assert owner not in {(c['x'],c['y']) for c in edge['cells']}
                edge_cell=next(c for c in edge['cells'] if (c['x'],c['y'])==targets[0])
                assert layer(edge_cell)['texture']==layer(selected[targets[0]])['texture']
                if stem=='mp30s6':
                    isolated=build_patch(report,cells,folder/'result.json',90,60,4)
                    c=next(c for c in isolated['cells'] if (c['x'],c['y'])==(90,60))
                    assert not any(d.get('bridge') for d in c['decorations'])
                assert json.dumps(report,sort_keys=True)==before,'3D must not modify the saved model'
                print('PASS',version,stem,kind,'deck, outside-patch owner, immutable report',flush=True)

def integration(path,radius=10):
    path=path.resolve();before=path.read_bytes();report=json.loads(before);meta=report['metadata']
    selected=next((c for c in report['cells'] if c.get('marked')),report['cells'][len(report['cells'])//2])
    url='/'+path.relative_to(ROOT).as_posix()
    data=patch(url,selected['x'],selected['y']) if radius==10 else patch(url,selected['x'],selected['y'],radius)
    cells={(c['x'],c['y']):c for c in data['cells']};lookup={(c['x'],c['y']):c for c in report['cells']}
    expected={p for p in lookup if abs(p[0]-selected['x'])<=radius and abs(p[1]-selected['y'])<=radius}
    assert data['center']==[selected['x'],selected['y']] and data['radius']==radius and set(cells)==expected
    assert data['metadata']['sourceSha256']==meta['sourceSha256']
    for p,c in cells.items():
        assert c['higher']==relation_data(lookup[p],lookup,data['metadata']['predictionEnabled'])[0]
        assert c['level']==lookup[p]['level'] and c['file']==lookup[p]['file']
        for field in ('marked','potentialMarked','probability','primary','clearance'):
            assert c[field]==lookup[p].get(field),f'3D must preserve main-map {field}'
        if c['texture']:
            im=Image.open(io.BytesIO(base64.b64decode(data['textures'][c['texture']].split(',')[1])))
            assert im.size==(64,64) and im.getbbox()
        if c.get('relief'):
            mesh=data['reliefs'][c['relief']]
            v=np.frombuffer(base64.b64decode(mesh['vertices']),dtype='<f4').reshape(-1,5)
            idx=np.frombuffer(base64.b64decode(mesh['indices']),dtype='<u4')
            assert len(v)==mesh['vertexCount'] and np.isfinite(v).all()
            assert len(idx)==3*mesh['triangles'] and idx.max()<len(v)
            assert mesh['texture'] in data['textures']
    assert path.read_bytes()==before,'3D extraction must not modify probability output'
    if meta.get('previewOnly'):
        assert not data['metadata']['predictionEnabled'] and not any(c['canPlace'] or c['higher'] for c in cells.values())
    print(json.dumps(dict(map=meta.get('filename'),cells=len(cells),textures=len(data['textures']),tiles=data['metadata']['uniqueTiles'],missing=data['metadata']['missing']),ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--result',type=Path,action='append',default=[])
    parser.add_argument('--bridges',action='store_true');args=parser.parse_args()
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(TerrainChecks))
    if not result.wasSuccessful():raise SystemExit(1)
    for path in args.result:
        integration(path)
        integration(path,15)
    if args.bridges:bridge_integration()
