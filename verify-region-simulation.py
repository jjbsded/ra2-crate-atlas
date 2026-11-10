"""Real native edit sessions publish current routing, without full-map reanalysis."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import struct
import subprocess
import tempfile
from map_test_fixtures import pack
from realmap_resources import resources
from realmap import analyze
from map_results import simulation_source
from region_navigation import build
from simulation_live import LiveSession

root=Path(__file__).resolve().parent
out=root/'output/region-simulation-qa';out.mkdir(exist_ok=True)
(out/'temp').mkdir(exist_ok=True);tempfile.tempdir=str(out/'temp')
res=resources('yr');theater=res.theater('TEMPERATE')
water=next(i for i,d in enumerate(theater['definitions']) if d[1].startswith('water01.'))
raw=bytearray();overlay=bytearray([255]*262144)
for y in range(1,40):
    for x in range(1,40):
        if x+y>20 and x+y<=60 and abs(x-y)<20:
            land=(12<=x<=16 or 21<=x<=25) and 18<=y<=22
            raw+=struct.pack('<hhIBBB',x,y,0 if land else water,0,4 if land else 0,0)
overlay[19+512*20]=25
text='[Map]\nTheater=TEMPERATE\nSize=0,0,20,20\nLocalSize=0,0,20,20\n[Waypoints]\n0=20014\n[Terrain]\n19014=TIBTRE01\n[Structures]\n0=Neutral,CABHUT,256,14,21,0,None\n[CABHUT]\nImmune=yes\n'
text+=pack('IsoMapPack5',raw+b'\0'*4)+pack('OverlayPack',overlay)+pack('OverlayDataPack',bytes(262144))
source=text.encode();(out/'source.yrm').write_bytes(source)
report=analyze(source,out,'yr','region-simulation.yrm',use_precomputed=False)
(out/'source.json').write_text(json.dumps(simulation_source(report,out/'result.json')),'utf8')
node=str(root.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe')
subprocess.run([node,'verify-region-simulation.cjs','plans',str(out/'source.json'),str(out/'plans.json')],check=True)
steps=json.loads((out/'plans.json').read_text('utf8'));session=LiveSession(out/'result.json');cases=[];timings=[]
try:
    initial=deepcopy(session.navigation.value)
    for revision,step in enumerate(steps):
        if revision:
            before,after=session.plan,step['plan'];delta={}
            for field in ('objects','overlays','placements'):
                a,b=before[field],after[field]
                if field=='placements':a,b=({v['id']:v for v in seq} for seq in (a,b))
                delta[field]={k:b.get(k) for k in a.keys()|b.keys() if a.get(k)!=b.get(k)}
            delta['order']=[o['id'] for o in after['placements']]
            packet=session.edit({'from':session.layout_version,'revision':revision,'delta':delta,'baseRevision':'qa','compact':True})
            nav=[v for p,v in packet['sets'] if p==['regionNavigation']]
            assert bool(nav) != bool(step['expected'].get('unchanged')),step['name']
            timings.append(dict(name=step['name'],navigationMs=packet['timing']['navigationMs']))
        cells=[session.latest_scene[2][p] for p in session.display_cells]
        oracle=build(dict(cells=cells,metadata=session.meta),session.latest_scene[3]['effectiveRules'])
        assert session.navigation.value==oracle,step['name']
        cases.append(dict(name=step['name'],cells=cells,navigation=oracle,rules=session.latest_scene[3]['effectiveRules'],expected=step['expected']))
    assert initial==session.navigation.value,'Restoration/unit edits return to the immutable initial routing checkpoint'
    fork=session.navigation.fork();frozen=deepcopy(session.navigation.value)
    blocked=deepcopy(cells[0]);blocked.update(occupiedGround=True,objectsGround=['CABHUT'],removable=[dict(type='CABHUT',category='building')])
    fork.update([blocked],session.meta,session.latest_scene[3]['effectiveRules'])
    assert fork.value!=frozen,'The fork actually changed a routing flag'
    assert session.navigation.value==frozen,'Forks cannot mutate another session or an earlier view'
    resumed=session.fork(0,session.res)
    try:
        combined=deepcopy(steps[4]['plan']);combined['overlays']=deepcopy(steps[1]['plan']['overlays'])
        resumed.resume(dict(probability=1,painted=0,plan=combined,paintPlan=steps[0]['plan']))
        assert resumed.sent_navigation is None
        expected=build(dict(cells=[resumed.latest_scene[2][p] for p in resumed.display_cells],metadata=resumed.meta),resumed.latest_scene[3]['effectiveRules'])
        assert resumed.navigation.value==expected
        tank=dict(id='sim-resumed-route',type='MTNK',category='UNITS',x=13,y=20,facing=64,subcell=0,onBridge=False)
        packet=resumed.edit({'from':1,'revision':2,'baseRevision':'resumed','delta':dict(objects={},overlays={},placements={tank['id']:tank})})
        assert [v for p,v in packet['sets'] if p==['regionNavigation']]==[expected],'Resuming must resync routes even if the next edit only adds a unit'
        assert session.navigation.value==frozen
    finally:resumed.close()
finally:session.close()
(out/'cases.json').write_text(json.dumps(cases,separators=(',',':')),'utf8')
(out/'timings.json').write_text(json.dumps(timings,indent=2),'utf8')
subprocess.run([node,'verify-region-simulation.cjs',str(out/'cases.json')],check=True)
print('PASS native incremental routing checkpoints and immutable forks',json.dumps(timings))
