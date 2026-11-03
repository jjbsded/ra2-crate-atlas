"""Cross-language checks for custom-map intensity keys and owner-color order."""
from pathlib import Path
import base64
import colorsys
import gzip
import json
import struct
import subprocess
import runtime_bootstrap
from map_test_fixtures import fixture, pack
from realmap_format import ini, decode_pack
from realmap_parser import parse_map
from realmap_resources import resources
from realmap_objects import ObjectPainter
from realmap_palette_lighting import light_palette
from toy_live_materials import object_key

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'output/voxel-brightness-verification-20261103'
OUT.mkdir(parents=True, exist_ok=True)
stock = ROOT/'output/toy-live-lighting-20261103/live/stock-yr.json.gz'
cases = []
units = ('[Units]\n0=Americans,BFRT,256,20,20,64,Guard\n'
         '1=Americans,BFRT,256,21,20,64,Guard\n2=Americans,BFRT,256,22,20,64,Guard\n'
         '[Aircraft]\n0=Americans,ORCA,256,20,22,64,Guard\n'
         '[Structures]\n0=Americans,GTGCAN,256,22,22,64,None\n'
         '[Infantry]\n0=Americans,E1,256,24,20,0,Guard,64\n')
for n, (ambient, extra) in enumerate((('1','.2'),('.65','.2'),('1.8','.45'),('-2','.2'),('nan','.2'))):
    raw = fixture(extra=units+f'[Lighting]\nAmbient={ambient}\nGround=.05\nLevel=.032\n'
                  f'[AudioVisual]\nExtraUnitLight={extra}\nExtraAircraftLight=.4\n')
    folder = OUT/f'case-{n}'; folder.mkdir(exist_ok=True)
    data = bytearray(decode_pack(ini(raw), 'IsoMapPack5', folder))
    for at in range(0, len(data)-4, 11):
        x,y = struct.unpack_from('<hh', data, at)
        if y == 20 and x in (21,22): data[at+9] = (x-20)*4
    text = raw.decode(); start = text.index('[IsoMapPack5]'); end = text.index('[OverlayPack]')
    raw = (text[:start]+pack('IsoMapPack5', data)+text[end:]).encode()
    cells,res,theater,_,_ = parse_map(raw, folder, 'yr')
    content = ini(raw); rules = dict(theater['effectiveRules'])
    for house,cfg in theater['mapHouses'].items(): rules[house] = {**rules.get(house, {}), **cfg}
    expected = {r['category']+'/'+r['type']+'/'+str(r['x'])+'/'+str(r['y']):
                object_key(r, rules, res.art, lighting=content['LIGHTING'], level=cells[r['x'],r['y']]['level'])
                for r in theater['mapObjects']}
    # JS exposes map-order objects with aligned coordinates, independent of the
    # native parser's different section traversal order.
    cases.append(dict(bytes=base64.b64encode(raw).decode(), expected=expected))

palette_cases = []
res = resources('yr'); theater = res.theater('URBAN'); theater['effectiveRules'] = res.rules
painter = ObjectPainter(res, theater, OUT)
colors,_ = painter.colors({}, '', remap=False)
for owner in ('','0,0,131','104,241,195','0,255,255','85,255,255','170,255,255'):
    remapped = list(colors)
    if owner:
        h,s,v = [int(c)/255 for c in owner.split(',')]
        for i in range(16,32): remapped[i] = tuple(round(c*255) for c in colorsys.hsv_to_rgb(h,s,min(1,v*max(colors[i])/255)))
    for step in range(63):
        palette_cases.append(dict(record=[colors,True,True], color=owner, step=step, expected=light_palette(remapped,step)))
payload = OUT/'browser-cases.json'
payload.write_text(json.dumps(dict(maps=cases,palettes=palette_cases), separators=(',',':')), 'utf8')
script = r"""
const fs=require('fs'),zlib=require('zlib'),assert=require('assert/strict');
const parser=require('./toy-live/parser.js');require('./toy-live/objects.js');
const cases=JSON.parse(fs.readFileSync(process.argv[1])),stock=JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[2])));
let objects=0;
for(const c of cases.maps){const p=parser.parse(new Uint8Array(Buffer.from(c.bytes,'base64')),stock,'yr');
 for(let i=0;i<p.visualObjects.length;i++){const o=p.visualObjects[i],[x,y]=p.objects[i],k=o.category+'/'+o.type+'/'+x+'/'+y;assert.equal(o.key,c.expected[k],k);objects++;}}
for(const c of cases.palettes)assert.deepEqual(CrateLiveObjects.colors(c.record,c.color,c.step),c.expected,`${c.color} row ${c.step}`);
console.log(JSON.stringify({status:'PASS',mapObjects:objects,paletteCases:cases.palettes.length,allIntensityRows:63}));
"""
node = ROOT.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'
run = subprocess.run([str(node), '-e', script, str(payload), str(stock)], cwd=ROOT, text=True,
                     capture_output=True, timeout=60, creationflags=0x08000000)
print(run.stdout, end='')
if run.returncode: raise RuntimeError(run.stderr)
(OUT/'browser-parity.json').write_text(run.stdout, 'utf8')
