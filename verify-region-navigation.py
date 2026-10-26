"""Rule-based routing masks preserve probabilities and separate bridge layers."""
import base64
from copy import deepcopy
from region_navigation import build, GROUND, WATER, SHORE, DECK


def check():
    rules={'CLEAR':{'FOOT':'1'},'ROAD':{'FOOT':'1'},'WATER':{'FOOT':'0'},'ROCK':{'FOOT':'0'},'WALL':{'FOOT':'0'},'BEACH':{'FOOT':'1'},
           'HOUSE':{'STRENGTH':'100'},'IMMUNEHOUSE':{'STRENGTH':'100','IMMUNE':'yes'},
           'WALLTYPE':{'WALL':'yes','LAND':'Wall','STRENGTH':'100'},'BRIDGE1':{'LAND':'Road'},'TREE':{'NAME':'Tree'},'ROCK01':{'NAME':'Rock'},'TIBTRE01':{'SPAWNSTIBERIUM':'yes'},'TRFF01':{'NAME':'Light','TEMPERATEOCCUPATIONBITS':'0','SNOWOCCUPATIONBITS':'7'}}
    base=dict(x=1,y=1,level=0,slope=0,rawLand=0,land=0,overlayName=None,objectsGround=[],objectsDeck=[],removable=[],occupiedGround=False,occupiedDeck=False,probability=.3,terms=[[0,1]],bridge=None)
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
    report=dict(metadata={'cliffBackImpassability':2},cells=cells,probability={'keep':'unchanged'})
    original=deepcopy(report);flags=base64.b64decode(build(report,rules)['flags'])
    assert flags[0]&GROUND and flags[1]&GROUND
    assert not flags[2]&GROUND and not flags[3]&GROUND
    assert flags[4]&DECK and not flags[4]&GROUND
    assert flags[5]&GROUND and not flags[5]&DECK
    assert flags[6]&WATER and flags[6]&DECK and not flags[6]&GROUND
    assert flags[7]&GROUND and not flags[8]&GROUND and flags[9]&SHORE
    assert all(not flags[i]&GROUND for i in (10,11,12,14)), 'Rocks, drills and unknown scenery are not trees'
    assert flags[13]&GROUND, 'Non-occupying scenery may remain passable'
    snow=deepcopy(report);snow['metadata']['theater']='SNOW'
    assert not base64.b64decode(build(snow,rules)['flags'])[13]&GROUND, 'Use the correct theater occupation mask'
    assert report==original
    print('PASS routing rules: trees/destructible buildings, immune/unknown/unit blockers, walls and ground/deck masks; original report unchanged')


if __name__=='__main__':
    check()
