"""Generate independent native baselines for custom maps used by Toy-live QA."""
from pathlib import Path
import json
import runtime_bootstrap
from map_test_fixtures import fixture
from realmap_parser import parse_map
from realmap import ensure_tools, run, TOOLS, clearance_risks
from realmap_exact import calculate, read_search
from realmap_approx import prepare
from region_navigation import build

out=Path(__file__).resolve().parent/'output/toy-live-qa/fixtures'
out.mkdir(parents=True,exist_ok=True)
ensure_tools()
cases=[('flat',fixture()),('objects',fixture(objects=True)),('water',fixture(water=True,island=True)),
 ('rule-override',fixture(extra='[General]\nCliffBackImpassability=0\n[Clear]\nTrack=0\n')),
 ('new-unit',fixture(extra='[VehicleTypes]\n999=NEWUNIT\n[NEWUNIT]\nImage=HTNK\n[Units]\n0=Neutral,NEWUNIT,256,20,20,0,None\n')),
 ('unknown-new-unit',fixture(extra='[VehicleTypes]\n999=NEWUNIT\n[NEWUNIT]\nImage=NOTINSTOCK\n[Units]\n0=Neutral,NEWUNIT,256,20,20,0,None\n')),
 ('unknown',fixture(extra='[Structures]\n0=Neutral,UNKNOWNOBJ,256,20,20,0,None\n')),
 ('coincident-unknown',fixture(extra='[Structures]\n0=Neutral,UNKNOWNOBJ,256,20,20,0,None\n[Units]\n0=Neutral,HTNK,256,20,20,0,None\n'))]
for name,data in cases:
 for minerals in (True,False):
  folder=out/(name+('-ore' if minerals else '-clear'));folder.mkdir(exist_ok=True)
  (folder/'source.map').write_bytes(data)
  unknown='unknown' in name
  cells,res,theater,tmps,meta=parse_map(data,folder,'yr',visual_only=unknown,minerals_enabled=minerals)
  if unknown:prepare(cells,res,theater,meta)
  grid=bytearray(262144);statuses={}
  for (x,y),c in cells.items():
   k=y*512+x;grid[k]=((int(c['track'])|(int(c['float'])<<1)) if c['candidate'] else 0)|(4 if c['primary'] else 0)|(8 if c['land']==2 else 0);statuses[k]=c['status']
  (folder/'grid.bin').write_bytes(grid);maximum=sum(meta['size'][2:])-1
  run([TOOLS/'map-search.exe',folder/'grid.bin',folder/'search.bin',maximum,min(maximum+1,32)])
  probability=calculate(read_search(folder/'search.bin',maximum**2),statuses,maximum**2)
  for (x,y),c in cells.items():c.update(probability['cells'].get(y*512+x,dict(probability=0,multiplier=0,oneAttemptProbability=0,terms=[])))
  probability.pop('cells');meta['filename']=name+'.map'
  report=dict(metadata=meta,cells=list(cells.values()),probability=probability)
  report['regionNavigation']=build(report,theater['effectiveRules'])
  (folder/'result.json').write_text(json.dumps(report,ensure_ascii=False),'utf8')
print('Generated',len(cases)*2,'native custom fixtures in',out)
# A display-only mixed fixture: one stock tile absent from the shared atlas,
# a known hut, an unknown building, and a tree with an unavailable Image.
import gzip,struct
from map_test_fixtures import pack
from realmap_format import ini,decode_pack
base=Path(__file__).resolve().parent
materials=base/'output/toy/live/materials.json.gz'
if materials.is_file():
 folder=base/'output/toy-live-mixed-qa';folder.mkdir(exist_ok=True)
 data=fixture(extra='[Structures]\n0=Neutral,CABHUT,256,22,20,0,None\n1=Neutral,UNKNOWNOBJ,256,20,20,0,None\n[Terrain]\n20019=TREE01\n[TREE01]\nImage=UNAVAILABLETREE\n')
 raw=bytearray(decode_pack(ini(data),'IsoMapPack5',folder));stock=json.loads(gzip.decompress((materials.parent/'stock-yr.json.gz').read_bytes()));lib=json.loads(gzip.decompress(materials.read_bytes()));t=stock['theaters']['TEMPERATE'];scope=lib['scopes']['yr/TEMPERATE']
 i,f,j,_=next((i,f,j,p) for i,f in enumerate(t['definitions']) for j,p in enumerate(t['tiles'].get(f) or []) if p and f+'/'+str(j) not in scope['tiles'] and p[0] in (0,7))
 for at in range(0,len(raw)-4,11):
  if struct.unpack_from('<hh',raw,at)==(21,20):struct.pack_into('<I',raw,at+4,i);raw[at+8]=j
 text=data.decode();start=text.index('[IsoMapPack5]');end=text.index('[OverlayPack]');text=text[:start]+pack('IsoMapPack5',raw)+text[end:]
 (folder/'mixed.map').write_text(text,'utf8');print('Mixed display fixture:',f,j)
