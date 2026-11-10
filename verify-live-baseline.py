"""Baseline reuse, resource invalidation, editor isolation and shared worker lifetime."""
from copy import copy, deepcopy
from pathlib import Path
import os
from tempfile import TemporaryDirectory
from threading import Thread
from time import sleep
from unittest.mock import patch
import runtime_bootstrap
import simulation_live as L
from simulation_visual import SharedVoxelFrames

path=Path(os.environ.get('LIVE_RESULT','output/CrateAtlas-Windows-x64-Simulation-20261104/output/map-22309489b5d3/result.json.gz'))
a,_=L.prepared_session(path,0)
try:
    before=a.store.checksum();plan=deepcopy(a.plan)
    point=next(p for p,c in a.original_cells.items() if c['usable'] and c['level']==0 and c['overlay']==255 and not c['bridge'] and not c['objects'] and c['status']=='crate' and c['candidate'])
    plan['placements']=[dict(id='sim-isolation',category='UNITS',type='MTNK',x=point[0],y=point[1],facing=64,subcell=0,onBridge=False,regionColor='ff00ff')]
    with patch.object(L,'parse_map',side_effect=AssertionError('Decoded map rebuilt')),patch.object(L,'Scene',side_effect=AssertionError('Art scene rebuilt')):
        b,timing=L.prepared_session(path,0)
    try:
        assert timing['baselineReused']
        b.resume(dict(probability=1,painted=0,plan=plan,paintPlan=a.plan))
        assert b.store.checksum()!=before and a.store.checksum()==before and not a.plan['placements']
        b.paint({'from':0,'target':1})
        assert not a.scene.tile_revisions and not a.scene.tank_records
        # A terminal-function change takes the full exact reweighting branch.
        # Clearing its mutable kernel must not clear another editor's kernel.
        rules=a.original_theater['effectiveRules']
        ore=next(p for p,c in a.original_cells.items() if rules.get(c.get('overlayName'),{}).get('TIBERIUM','no').lower() in ('yes','true','1'))
        key=','.join(map(str,ore));b.edit({'from':1,'revision':2,'delta':{'objects':{},'overlays':{key:[255,0]},'placements':{}},'baseRevision':'test'})
        oracle=L.Store(b.store.maximum,b.grid,b.statuses,b.full_search()).calculate()
        assert b.store.calculate()==oracle and a.store.checksum()==before
        assert a.store.calculate()==L._baseline[1].store.calculate()
        b.paint({'from':1,'target':2})
        # Replacing the cache must not close pixels or native worker used by a fork.
        L.close_all();b.paint({'from':0,'target':2})
    finally:b.close()
    print('PASS warm open skips reconstruction; local edits and full exact reweighting stay isolated')
finally:a.close()

report,_=L.load_report(path);inputs=report,{},L.source_bytes(report,path),L.resource_context(report,path)[0]
with TemporaryDirectory() as folder:
    checkpoint=Path(folder)/'result.json.gz';checkpoint.write_bytes(b'first')
    key=L.baseline_key(checkpoint,inputs);checkpoint.write_bytes(b'changed')
    assert key!=L.baseline_key(checkpoint,inputs)
    res=copy(inputs[3]);res.rules_bytes+=b'changed';assert L.baseline_key(checkpoint,inputs)!=L.baseline_key(checkpoint,(*inputs[:3],res))
    res=copy(inputs[3]);res.art_hash='changed';assert L.baseline_key(checkpoint,inputs)!=L.baseline_key(checkpoint,(*inputs[:3],res))
    res=copy(inputs[3]);res.discovery=dict(getattr(res,'discovery',{}),fingerprint='changed');assert L.baseline_key(checkpoint,inputs)!=L.baseline_key(checkpoint,(*inputs[:3],res))
with patch.object(L,'resource_context',side_effect=ValueError('Resource changed')):
    try:L.prepared_session(path,0)
    except ValueError as error:assert str(error)=='Resource changed'
    else:raise AssertionError('Cached data cannot bypass resource validation')
print('PASS report/rules/art/archive changes invalidate reuse; resource checks remain mandatory')

class Worker:
    closed=0
    def draw(self,value):self.value=value;sleep(.002);assert self.value==value;return value
    def close(self):self.closed+=1
worker=Worker();first=SharedVoxelFrames(worker);second=first.fork();results=[]
threads=[Thread(target=lambda value:results.append(second.draw(value)),args=(i,)) for i in range(20)]
for thread in threads:thread.start()
first.close()
for thread in threads:thread.join()
assert sorted(results)==list(range(20)) and not worker.closed
second.close();second.close();assert worker.closed==1
print('PASS concurrent frame requests are serialized; worker closes exactly after its last reader')
