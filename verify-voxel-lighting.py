"""Lighting math, malformed spans, and real DLL / map rendering comparisons.

Run with --integration to retain stock vehicle contact sheets and map evidence.
"""
from contextlib import ExitStack
import json
import hashlib
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import realmap_voxel as bridge
import realmap_voxel_lighting as light
from realmap_voxel_normals import NORMALS
from realmap_render import VERSION as RENDER_VERSION

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'output/voxel-lighting-verification'
INTEGRATION = '--integration' in sys.argv
if INTEGRATION:
    sys.argv.remove('--integration')


def voxel(pairs=((100, 0), (100, 253), (0, 254), (100, 255)), mode=4):
    run = bytes([0, len(pairs)]) + bytes(v for pair in pairs for v in pair) + bytes([len(pairs)])
    body = struct.pack('<2i', 0, len(run)-1) + run
    header = b'Voxel Animation\0' + struct.pack('<4I', 1, 1, 1, len(body)) + bytes(770)
    section = b'body'+bytes(24)
    tail = struct.pack('<3If', 0, 4, 8, 1) + struct.pack('<12f', 1,0,0,0,0,1,0,0,0,0,1,0)
    tail += struct.pack('<6f4B', 0,0,0,1,1,len(pairs),1,1,len(pairs),mode)
    return header + section + body + tail


def legacy(stack):
    stack.enter_context(patch.object(bridge, 'identity_vpl', lambda raw: raw))
    stack.enter_context(patch.object(bridge, 'shade_vxl', lambda raw, face, tables: raw))


class LightingChecks(unittest.TestCase):
    def test_reference_axes_and_facing(self):
        # Actual engine outputs: bridge 24 = map direction 0. Face 26 / normal 6
        # lies on a page boundary where ordinary math sqrt incorrectly gives 16.
        self.assertEqual(light.lighting_pages(1, 24)[:16].tolist(),
                         [0,3,12,6,0,0,20,4,0,0,25,3,0,2,15,4])
        self.assertEqual(light.lighting_pages(1, 26)[6], 17)
        self.assertLess(NORMALS[4][241][0], 0)
        for mode, facing in ((0,0),(5,0),(1,-1),(1,32),(1,.5)):
            with self.assertRaises(ValueError): light.lighting_pages(mode,facing)

    def test_all_modes_against_native_oracle_digest(self):
        # Golden digest recorded from game functions, not the lookup generator.
        # Regenerate independently with generate-voxel-light-tables.py --check.
        rows=[]
        for mode, normals in NORMALS.items():
            for facing in range(32):
                actual = light.lighting_pages(mode, facing)
                rows.append(actual[:len(normals)].tobytes())
                self.assertTrue(np.all(actual[len(normals):253]==0))
                self.assertEqual(actual[253:].tolist(), [16,16,16])
                self.assertFalse(actual.flags.writeable)
        self.assertEqual(hashlib.sha256(b''.join(rows)).hexdigest(),
                         'f33cc716b0ea4942f7083d1273608d9cf736753f7f23cff6a20ae9d88c5c3576')

    def test_palette_and_span_validation(self):
        vpl = struct.pack('<4I',16,31,32,0)+bytes(768)+bytes(i+1 for i in range(32) for _ in range(256))
        tables = light.vpl_tables(vpl)
        raw = voxel()
        baked = light.shade_vxl(raw,24,tables)
        base = 802+28+8+2
        expected = bytearray(raw)
        for i, color in enumerate((int(tables[light.lighting_pages(4,24)[0],100]),17,0,17)):
            expected[base+2*i:base+2*i+2] = bytes([color,0])
        self.assertEqual(baked,bytes(expected))
        self.assertEqual(raw,voxel(), 'Source VXL must not be mutated')
        identity = light.vpl_tables(light.identity_vpl(vpl))
        self.assertTrue(np.all(identity == np.arange(256)))
        for bad in (b'',vpl[:783],vpl[:-1]):
            with self.assertRaises(ValueError): light.vpl_tables(bad)
        for bad in (b'',raw[:-1],voxel(mode=0)):
            with self.assertRaises(ValueError): light.shade_vxl(bad,24,tables)
        for offset, data in ((802+28,b'\xff\xff\xff\x7f'), (base-1,b'\xff'),(base+8,b'\x00')):
            bad=bytearray(raw);bad[offset:offset+len(data)]=data
            with self.assertRaises(ValueError): light.shade_vxl(bytes(bad),24,tables)

    @unittest.skipUnless(INTEGRATION, 'Pass --integration for bundled DLL and stock maps')
    def test_stock_models_and_map_invariants(self):
        from map_test_fixtures import fixture
        from realmap import analyze
        from realmap_objects import ObjectPainter
        from realmap_resources import resources
        from official_precomputed import RESULT_FIELDS
        from map_storage import read_json, write_report
        from realmap_refresh import refresh_result
        OUT.mkdir(parents=True,exist_ok=True)
        res=resources('yr');theater=res.theater('TEMPERATE');theater['effectiveRules']=res.rules
        kinds=('MTNK','HTNK','AMCV','SAPC','V3','YTNK','ZEP','DISK','SHAD','SCHP','ORCA')
        renders={};stats=[]
        for label in ('before','after'):
            folder=OUT/label;folder.mkdir(exist_ok=True)
            with ExitStack() as stack:
                if label=='before': legacy(stack)
                painter=ObjectPainter(res,theater,folder)
                try:
                    for kind in kinds:
                        for facing in range(0,256,8):
                            obj=dict(type=kind,house='AMERICANS',category='AIRCRAFT' if kind=='ORCA' else 'UNITS',
                                     facing=facing,health=256,mission='Guard',upgrades=[])
                            parts=painter.parts(obj)
                            tile=Image.new('RGBA',(128,112),(105,115,110,255))
                            for part in parts:
                                tile.alpha_composite(part['image'],(64+part['x'],65+part['y']))
                            renders[label,kind,facing]=(tile,parts)
                finally:
                    if painter.voxels:painter.voxels.close()
        changed=0
        for kind in kinds:
            for facing in range(0,256,8):
                old,op=renders['before',kind,facing];new,np_=renders['after',kind,facing]
                self.assertEqual(len(op),len(np_))
                for a,b in zip(op,np_):
                    for key in ('x','y','shadowX','shadowY','frame','file'):
                        self.assertEqual(a[key],b[key])
                    self.assertEqual(a['image'].size,b['image'].size)
                    self.assertEqual(a['image'].getchannel('A').tobytes(),b['image'].getchannel('A').tobytes())
                    self.assertEqual(a['shadow'].tobytes() if a['shadow'] else None,b['shadow'].tobytes() if b['shadow'] else None)
                if old.tobytes()!=new.tobytes():changed+=1
        self.assertEqual(changed,len(kinds)*32)
        # Eight directions per vehicle; pairs are old/new at identical magnification.
        sheet=Image.new('RGB',(1152,80+len(kinds)*250),(25,30,37));draw=ImageDraw.Draw(sheet)
        font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
        draw.text((18,14),'Vehicle lighting | upper row: before | lower row: after | 2x nearest-neighbour',font=font,fill='white')
        for row,kind in enumerate(kinds):
            y=65+row*250;draw.text((12,y+92),kind,font=font,fill='white')
            for col,facing in enumerate(range(0,256,32)):
                for j,label in enumerate(('before','after')):
                    tile=renders[label,kind,facing][0].crop((32,32,96,88)).resize((128,112),Image.Resampling.NEAREST)
                    sheet.paste(tile,(124+col*128,y+j*116))
        sheet.save(OUT/'comparison.png')
        rows='[Basic]\nName=Voxel lighting check\n[Units]\n'
        # This map fixture is shared with RA2; YR-only units above are covered
        # by the stock-frame comparison, not injected into an RA2 map.
        for i,kind in enumerate(('MTNK','HTNK','AMCV','SAPC','V3')):
            rows+=f'{i}=Americans,{kind},256,{15+i*2},20,{i*32},Guard,None,0,-1,0,0,1,0\n'
        rows+='[Structures]\n0=Americans,GAPOWR,256,20,25,0,None,1,0,1,0,0,None,None,None,0,0\n'
        rows+='[Infantry]\n0=Americans,E1,256,22,25,0,Guard,0,None,0,-1,0,0,1\n'
        for version,theater_name in (('ra2','TEMPERATE'),('yr','SNOW')):
            data=fixture(theater=theater_name,extra=rows)
            folder=OUT/(version+'-before')
            with ExitStack() as stack:
                legacy(stack)
                before=analyze(data,folder,version,filename='lighting.map',use_precomputed=False)
            after=analyze(data,OUT/(version+'-after'),version,filename='lighting.map',use_precomputed=False)
            self.assertEqual(before['cells'],after['cells'])
            for key in RESULT_FIELDS:self.assertEqual(before[key],after[key])
            a=Image.open(folder/before['rendering']['image'])
            b=Image.open(OUT/(version+'-after')/after['rendering']['image'])
            self.assertEqual(a.tobytes(),b.tobytes())
            self.assertFalse(after['rendering']['objects']['missing'])
            stats.append(dict(version=version,theater=theater_name,probability='unchanged',ground='pixel-identical',
                              objects=after['rendering']['objects']['total']))
            # Upgrade a saved old report without touching its probability data.
            before['rendering']['version']=13
            upgrade=OUT/(version+'-upgraded');upgrade.mkdir(exist_ok=True)
            (upgrade/'source.map').write_bytes(data)
            write_report(upgrade/'result.json',before)
            refresh_result(upgrade/'result.json')
            refreshed=read_json(upgrade/'result.json')
            self.assertEqual(refreshed['rendering']['version'],RENDER_VERSION)
            self.assertEqual(refreshed['cells'],before['cells'])
            for key in RESULT_FIELDS:self.assertEqual(refreshed[key],before[key])
            upgraded=Image.open(upgrade/refreshed['rendering']['objectImage'])
            current=Image.open(OUT/(version+'-after')/after['rendering']['objectImage'])
            self.assertEqual(upgraded.tobytes(),current.tobytes())
        (OUT/'verification.json').write_text(json.dumps(dict(result='PASS',model=light.MODEL,
            changedFacings=changed,geometry='unchanged',alpha='unchanged',shadows='pixel-identical',maps=stats),indent=2),'utf8')


if __name__=='__main__':unittest.main()
