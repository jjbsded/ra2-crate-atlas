"""Exact resume checkpoints: aligned, artwork ahead, probability ahead, partial undo."""
from copy import deepcopy
from pathlib import Path
import base64
from io import BytesIO
import runtime_bootstrap
from PIL import Image
from simulation_live import LiveSession, prepared_session, close_all

path=Path('output/CrateAtlas-Windows-x64-Simulation-20261104/output/map-22309489b5d3/result.json.gz')
a=LiveSession(path)
try:
    points=[p for p,c in a.original_cells.items() if c['usable'] and c['level']==0 and c['overlay']==255 and not c['bridge'] and not c['objects'] and c['status']=='crate' and c['candidate']]
    empty=deepcopy(a.plan)
    def plan(count):
        value=deepcopy(empty)
        value['placements']=[dict(id=f'sim-resume-{i}',category='UNITS',type='MTNK',x=p[0],y=p[1],facing=64,subcell=0,onBridge=False,regionColor='42c9b0') for i,p in enumerate(points[:count])]
        return value
    one,two=plan(1),plan(2)
    def seed(s,p,version):
        before=s.plan
        delta={k:{key:target.get(key) for key in old.keys()|target.keys() if old.get(key)!=target.get(key)} for k in ('objects','overlays') for old,target in [(before[k],p[k])]}
        old={o['id']:o for o in before['placements']};target={o['id']:o for o in p['placements']}
        delta['placements']={k:target.get(k) for k in old.keys()|target.keys() if old.get(k)!=target.get(k)};delta['order']=list(target)
        return s.edit({'from':s.layout_version,'revision':version,'delta':delta,'baseRevision':'test','compact':True})
    def decoded(packet):
        return {tuple(t['box']):tuple(Image.open(BytesIO(base64.b64decode(t[name].split(',',1)[1]))).convert('RGBA').tobytes() for name in ('ground','objects')) for t in packet['patches']}
    seed(a,two,1);expected=deepcopy(a.store.calculate());expected_images=decoded(a.paint({'from':0,'target':1}))
    for name,state in [('aligned',dict(probability=1,painted=1,plan=one,paintPlan=one)),('art-ahead',dict(probability=0,painted=1,plan=empty,paintPlan=one)),('probability-ahead',dict(probability=1,painted=0,plan=one,paintPlan=empty)),('partial',dict(probability=0,painted=0,plan=empty,paintPlan=empty,partial=dict(revision=1,plan=one)))]:
        b=prepared_session(path,0)[0]
        try:
            b.resume(state);seed(b,two,2)
            assert b.store.calculate()==expected,name
            actual=decoded(b.paint({'from':state['painted'],'target':2}))
            for key,pixels in actual.items():assert pixels==expected_images[key],(name,key)
            print('PASS resume exact probability and native pixels',name,len(actual))
        finally:b.close()
    # A partially installed tank that is undone before probability acceptance
    # must still produce clearing tiles even though the final plan is empty.
    b=prepared_session(path,0)[0]
    try:
        b.resume(dict(probability=0,painted=0,plan=empty,paintPlan=empty,partial=dict(revision=1,plan=one)));seed(b,empty,2)
        packet=b.paint({'from':0,'target':2});assert packet['patches'],'A partial undone edit must repaint its old tile'
        c=prepared_session(path,0)[0]
        try:
            c.scene.tile_revisions={key:2 for key in b.scene.tile_revisions}
            expected_clear=decoded(c.paint({'from':0,'target':0}))
            assert decoded(packet)==expected_clear
        finally:c.close()
        print('PASS partial artwork undo clears old pixels')
    finally:b.close()
finally:a.close()

fixture=Path('output/live-recovery-qa/rebased-path.txt')
if fixture.is_file() and fixture.read_text('utf8').strip():
    b=prepared_session(Path(fixture.read_text('utf8').strip()),0)[0]
    c=prepared_session(path,0)[0]
    try:
        assert b.tank_shortcut,'Loading a tank-only report retains the fast path'
        value=deepcopy(b.plan);occupied={(o['x'],o['y']) for o in value['placements']}
        point=next(p for p in points if p not in occupied)
        value['placements'].append(dict(id='sim-rebased-extra',category='UNITS',type='MTNK',x=point[0],y=point[1],facing=64,subcell=0,onBridge=False,regionColor='42c9b0'))
        seed(b,value,1);seed(c,value,1)
        assert '_liveTanks' in b.latest_scene[3]
        assert b.store.calculate()==c.store.calculate()
        actual=decoded(b.paint({'from':0,'target':1}));expected=decoded(c.paint({'from':0,'target':1}))
        for key,pixels in actual.items():assert pixels==expected[key],key
        print('PASS persisted tank report retains native fast path and exact single-draw pixels')
    finally:b.close();c.close()
