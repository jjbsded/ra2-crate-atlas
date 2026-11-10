"""Rule-based routing masks preserve probabilities and separate bridge layers."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
from region_navigation import build, GROUND, WATER, SHORE, DECK


def check():
    rules={'CLEAR':{'FOOT':'1'},'ROAD':{'FOOT':'1'},'WATER':{'FOOT':'0'},'ROCK':{'FOOT':'0'},'WALL':{'FOOT':'0'},'BEACH':{'FOOT':'1'},
           'HOUSE':{'STRENGTH':'100'},'IMMUNEHOUSE':{'STRENGTH':'100','IMMUNE':'yes'},
           'WALLTYPE':{'WALL':'yes','LAND':'Wall','STRENGTH':'100'},'FENCE01':{'LAND':'Rock','LEGALTARGET':'true'},'FENCE12':{'LAND':'Rock','LEGALTARGET':'false'},'BRIDGE1':{'LAND':'Road'},'TREE':{'NAME':'Tree'},'IMMUNETREE':{'NAME':'Tree','IMMUNE':'yes'},'ROCK01':{'NAME':'Rock'},'TIBTRE01':{'SPAWNSTIBERIUM':'yes'},'TRFF01':{'NAME':'Light','TEMPERATEOCCUPATIONBITS':'0','SNOWOCCUPATIONBITS':'7'}}
    base=dict(x=1,y=1,level=0,slope=0,rawLand=0,land=0,overlayName=None,higher=[],objectsGround=[],objectsDeck=[],removable=[],occupiedGround=False,occupiedDeck=False,probability=.3,terms=[[0,1]],bridge=None)
    cells=[]
    def add(**changes):
        cell=deepcopy(base);cell.update(changes);cells.append(cell)
    add(objectsGround=['TREE'],removable=[dict(type='TREE',category='terrain')],occupiedGround=True)
    add(objectsGround=['HOUSE'],removable=[dict(type='HOUSE',category='building')],occupiedGround=True)
    add(objectsGround=['IMMUNEHOUSE'],removable=[dict(type='IMMUNEHOUSE',category='building')],occupiedGround=True)
    add(objectsGround=['TANK'],removable=[dict(type='TANK',category='unit')],occupiedGround=True)
    add(objectsGround=['TANK'],removable=[dict(type='TANK',category='unit')],occupiedGround=True,bridge=dict(kind='high',deckLevel=4))
    add(objectsDeck=['TANK'],removable=[dict(type='TANK',category='unit')],occupiedDeck=True,bridge=dict(kind='high',deckLevel=4))
    add(rawLand=2,overlayName='BRIDGE1',bridge=dict(kind='high',deckLevel=4))
    add(wall=True,overlayName='WALLTYPE')
    add(assumedRetry=True)
    add(rawLand=6)
    for kind in ('ROCK01', 'TIBTRE01', 'UNKNOWN'):
        add(objectsGround=[kind],removable=[dict(type=kind,category='terrain')],occupiedGround=True)
    add(objectsGround=['TRFF01'],removable=[dict(type='TRFF01',category='terrain')],occupiedGround=False)
    add(occupancyUnknown=True)
    add(objectsGround=['IMMUNETREE'],removable=[dict(type='IMMUNETREE',category='terrain')],occupiedGround=True)
    add(overlayName='FENCE01')
    add(overlayName='FENCE12')
    report=dict(metadata={'cliffBackImpassability':2},cells=cells,probability={'keep':'unchanged'})
    original=deepcopy(report);flags=base64.b64decode(build(report,rules)['flags'])
    assert flags[0]&GROUND and flags[1]&GROUND
    assert not flags[2]&GROUND and flags[3]&GROUND
    assert flags[4]&DECK and flags[4]&GROUND
    assert flags[5]&GROUND and flags[5]&DECK
    assert flags[6]&WATER and flags[6]&DECK and not flags[6]&GROUND
    assert flags[7]&GROUND and not flags[8]&GROUND and flags[9]&SHORE
    assert all(not flags[i]&GROUND for i in (10,11,12,14,15)), 'Rocks, drills, immune trees and unknown scenery remain blocked'
    assert flags[13]&GROUND, 'Non-occupying scenery may remain passable'
    assert flags[16]&GROUND and not flags[17]&GROUND, 'Only destructible fences are cleared'
    # Fill must use the effective land type, including cliff-back conversion;
    # Rough is intentionally exempt from conversion and remains walkable.
    height_rules=deepcopy(rules);height_rules['ROUGH']={'FOOT':'1'}
    height_cells=[]
    for raw in (0,2,6,7):
        c=deepcopy(base);c.update(rawLand=raw,higher=[1]);height_cells.append(c)
    height_report=dict(metadata=report['metadata'],cells=height_cells)
    height_flags=base64.b64decode(build(height_report,height_rules)['flags'])
    assert all(not mask&(GROUND|WATER) for mask in height_flags[:3])
    assert height_flags[3]&GROUND, 'Higher neighbors turn Clear/Water/Beach into Rock, not Rough'
    snow=deepcopy(report);snow['metadata']['theater']='SNOW'
    assert not base64.b64decode(build(snow,rules)['flags'])[13]&GROUND, 'Use the correct theater occupation mask'
    assert report==original
    # Actual corridor connectivity, not merely a passable bit on a unit cell.
    cases=[]
    for terrain in ('land','bridge','water'):
        empty=[]
        for x in range(1,6):
            c=deepcopy(base);c.update(x=x,y=1)
            if terrain=='water' or terrain=='bridge' and 1<x<5:c.update(rawLand=2,land=2)
            if terrain=='bridge':
                if 1<x<5:c.update(overlayName='BRIDGE1',bridge=dict(kind='high',deckLevel=4))
                else:c['level']=4
            empty.append(c)
        units=deepcopy(empty)
        for c,kind in zip(units,['MCV','TANK','SOLDIER','AIRCRAFT','SHIP']):
            layer='Deck' if terrain=='bridge' and c['bridge'] else 'Ground'
            c['objects'+layer]=[kind];c['occupied'+layer]=True
            c['removable']=[dict(category='unit',type=kind)]
        a=dict(metadata=report['metadata'],cells=empty)
        b=dict(metadata=report['metadata'],cells=units)
        original_units=deepcopy(b)
        assert build(a,rules)==build(b,rules),terrain
        assert b==original_units,'Routing must not change occupation or crate probability'
        cases.append(dict(terrain=terrain,empty=a,units=b,rules=rules,navigation=build(b,rules)))
    mixed=deepcopy(report);mixed['cells'][2]['objectsGround'].append('TANK')
    mixed['cells'][2]['removable'].append(dict(type='TANK',category='unit'))
    assert not base64.b64decode(build(mixed,rules)['flags'])[2]&GROUND,'A unit must not hide an immune building'
    rules['CABHUT']={'STRENGTH':'100','IMMUNE':'yes'}
    for kind, category, reachable in [('HOUSE','building',5),('IMMUNEHOUSE','building',2),('CABHUT','building',2),('TIBTRE01','terrain',2),('TREE','terrain',5),('IMMUNETREE','terrain',2),('ROCK01','terrain',2),('WALLTYPE','overlay',5),('FENCE01','overlay',5),('FENCE12','overlay',2)]:
        empty=[]
        for x in range(1,6):
            c=deepcopy(base);c['x']=x
            if x==3:
                if category=='overlay':
                    c['overlayName']=kind
                else:
                    c.update(objectsGround=[kind],removable=[dict(type=kind,category=category)],occupiedGround=True)
            empty.append(c)
        units=deepcopy(empty)
        for c in units:
            c['objectsGround'].append('TANK');c['removable'].append(dict(type='TANK',category='unit'));c['occupiedGround']=True
        a=dict(metadata=report['metadata'],cells=empty);b=dict(metadata=report['metadata'],cells=units)
        cases.append(dict(terrain=kind,empty=a,units=b,rules=rules,navigation=build(b,rules),reachable=reachable))
    root=Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(dir=root/'output') as temp:
        path=Path(temp)/'cases.json';path.write_text(json.dumps(cases),'utf8')
        result=subprocess.run([str(root.parents[1]/'portable/CrateAtlas-Windows-x64/runtime/node/node.exe'),str(root/'verify-region-navigation.cjs'),str(path)],capture_output=True,text=True,creationflags=0x08000000)
        print(result.stdout);assert result.returncode==0,result.stderr
    print('PASS routing rules: ignore units; preserve immune/unknown blockers, walls and ground/deck masks; original report unchanged')


if __name__=='__main__':
    check()
