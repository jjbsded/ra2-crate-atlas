"""Original rubble art is painted before units standing on any foundation cell."""
from pathlib import Path
import tempfile
from realmap_resources import resources
from realmap_parser import object_records
from realmap_objects import ObjectPainter

res=resources('yr');theater=res.theater('TEMPERATE');theater['effectiveRules']=res.rules
content={'STRUCTURES':{'rubble':'Americans,CAOILD,0,20,20,0,None,1,0,1,0,0,None,None,None,0,0'},'UNITS':{},'AIRCRAFT':{}}
for dx,dy in ((0,0),(1,0),(0,1),(1,1)):
    content['UNITS'][f'{dx}-{dy}']=f'Americans,MTNK,256,{20+dx},{20+dy},0,Guard,None,0,-1,0,0,1,0'
content['AIRCRAFT']['air']='Americans,ORCA,256,20,20,0,Guard,None,0,-1,0,0,1,0'
theater['mapObjects']=object_records(content)
with tempfile.TemporaryDirectory() as tmp:
    painter=ObjectPainter(res,theater,Path(tmp))
    try:
        events,info=painter.prepare({(20+x,20+y):{'x':20+x,'y':20+y,'level':0} for x in range(2) for y in range(2)},[0,0])
        assert not info['missing'],info['missing']
        rubble=[r for r in info['records'] if r['type']=='CAOILD'][0]
        mobiles=[r for r in info['records'] if r['category'] in ('UNITS','AIRCRAFT')]
        assert len(mobiles)==5
        assert all(r['renderDepth']>rubble['renderDepth'] for r in mobiles)
        assert all(not r['onBridgeDeck'] for r in mobiles)
    finally:
        if painter.voxels:painter.voxels.close()
print('PASS native oil rubble remains beneath four foundation-cell vehicles and a grounded aircraft')
