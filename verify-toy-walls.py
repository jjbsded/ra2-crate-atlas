"""Verify all stock wall states and non-turret pillbox facing invariance."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
from unittest.mock import patch
import runtime_bootstrap
from PIL import Image
from realmap_resources import resources
from realmap_objects import ObjectPainter
from realmap_sprites import sprite_spec, shp_frame
from toy_live_materials import SPRITE, object_key
from toy_live_walls import visible_frames, build
from map_test_fixtures import fixture, pack

ROOT=Path(__file__).resolve().parent


def rgba(image):
    data=bytearray(image.convert('RGBA').tobytes())
    for i in range(0,len(data),4):
        if not data[i+3]: data[i:i+3]=b'\0\0\0'
    return bytes(data)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'output/toy-walls-20261104')
    parser.add_argument('--site',type=Path)
    parser.add_argument('--baseline',type=Path,default=ROOT/'output/CrateAtlas-v0.6.0-Toy-Web')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True);site=args.site or args.output/'site'
    load=lambda p:json.loads(gzip.decompress(p.read_bytes()))
    materials=load(site/'live/materials.json.gz');objects=load(site/'live/objects/index.json.gz')
    released=load(ROOT/'output/CrateAtlas-v0.6.0-Toy-Web/live/objects/index.json.gz')
    pages={};states=empty=pillboxes=flagged_pillboxes=0;cases=[]
    for scope,walls in materials['wallSupplement']['inventory'].items():
        version,climate=scope.split('/');res=resources(version);theater=res.theater(climate);theater['effectiveRules']=res.rules
        for kind,count in walls.items():
            cfg=res.rules[kind];art=res.art.get(cfg.get('IMAGE',kind).upper(),{})
            overlay=not kind.startswith('TREE')
            raw,colors,dy,_=sprite_spec(kind,overlay,0,res,theater)
            assert (len(visible_frames(raw,cfg,art)) if overlay else 1)==count
            signature=[cfg.get(k,kind if k=='IMAGE' else '').upper() for k in SPRITE]
            for frame in range(count):
                key=json.dumps([int(overlay),signature[0],frame,signature,''],separators=(',',':'))
                assert key in materials['scopes'][scope]['sprites'],(scope,kind,frame)
                value=materials['scopes'][scope]['sprites'][key];native=shp_frame(raw,frame,colors);box=native.getbbox()
                if box is None:
                    assert value is None;empty+=1;continue
                assert type(value) is int,(scope,kind,frame,value)
                asset,x,y=materials['refs'][value];page,sx,sy,w,h=materials['assets'][asset]
                if page not in pages:
                    with Image.open(site/'art'/materials['atlases'][page]['file']) as image:pages[page]=image.convert('RGBA')
                assert (x,y)==(box[0]-native.width//2,box[1]-native.height//2+dy)
                assert rgba(pages[page].crop((sx,sy,sx+w,sy+h)))==rgba(native.crop(box)),(scope,kind,frame,'pixels')
                states+=1
        painter=ObjectPainter(res,theater,args.output)
        for health in (256,64,0):
            base=dict(type='GAPILL',category='STRUCTURES',facing=0,health=health,mission='Guard',house='',upgrades=[])
            canonical=object_key(base,res.rules,res.art,template=True)
            assert canonical in released['scopes'][scope],(scope,health,'released GAPILL missing')
            assert canonical in objects['scopes'][scope]
            native=painter.parts(base)
            for face in range(256):
                rec={**base,'facing':face}
                assert object_key(rec,res.rules,res.art,template=True)==canonical
                actual=painter.parts(rec)
                assert [(p['file'],p['frame'],rgba(p['image'])) for p in actual]==[(p['file'],p['frame'],rgba(p['image'])) for p in native]
                pillboxes+=1
                if scope=='yr/TEMPERATE':cases.append(dict(type='GAPILL',category='STRUCTURES',key=object_key(rec,res.rules,res.art)))
        # sov01umd.map sets Turret=yes on GAPILL without a TurretAnim. Full
        # rendering still has just the fixed base, regardless of facing.
        painter.rules['GAPILL']={**res.rules['GAPILL'],'TURRET':'yes','MAXDEBRIS':'0','MINDEBRIS':'0'}
        painter.cache.clear()
        for health in (256,64,0):
            base=dict(type='GAPILL',category='STRUCTURES',facing=0,health=health,mission='Guard',house='',upgrades=[])
            native=painter.parts(base)
            for face in range(256):
                rec={**base,'facing':face};actual=painter.parts(rec)
                assert [(p['file'],p['frame'],rgba(p['image'])) for p in actual]==[(p['file'],p['frame'],rgba(p['image'])) for p in native]
                flagged_pillboxes+=1
                if scope=='yr/TEMPERATE':cases.append(dict(type='GAPILL',category='STRUCTURES',key=object_key(rec,painter.rules,res.art)))
    # The supplemental build must preserve every pre-existing material ID.
    old=load(args.baseline/'live/materials.json.gz')
    base_counts=old.get('wallSupplement',{}).get('baseCounts',{k:len(old[k]) for k in ('atlases','assets','refs')})
    for field,count in base_counts.items():assert materials[field][:count]==old[field][:count]
    for scope,value in old['scopes'].items():
        for category in ('tiles','sprites','objects','terrainVariants'):
            owned=set(old.get('wallSupplement',{}).get('entries',{}).get(scope,[])) if category=='sprites' else set()
            assert all(materials['scopes'][scope][category].get(k)==v for k,v in value[category].items() if k not in owned)
    before=(site/'live/materials.json.gz').read_bytes();build(site/'live');assert before==(site/'live/materials.json.gz').read_bytes()
    with patch('toy_live_walls.source_stamp',return_value='test-source-invalidation'):
        build(site/'live')
    build(site/'live');assert before==(site/'live/materials.json.gz').read_bytes(),'Rebuild changed existing IDs or duplicated supplemental records'
    # Actual map fixtures: 256 pillbox directions for parser tests; all 16
    # connectivity masks per wall type for browser import/3D/export tests.
    all_faces='[Structures]\n'+''.join(f'{f}=Americans,GAPILL,256,20,20,{f},None\n' for f in range(256))
    (args.output/'pillbox-directions.yrm').write_bytes(fixture(extra=all_faces))
    (args.output/'pillbox-turret-flag.yrm').write_bytes(fixture(extra=all_faces+'[GAPILL]\nTurret=yes\nMaxDebris=0\nMinDebris=0\n'))
    res=resources('yr');names=[v.upper() for v in res.rules['OVERLAYTYPES'].values()];walls=materials['wallSupplement']['inventory']['yr/TEMPERATE']
    overlays=bytearray([255]*262144);frames=bytearray(262144)
    for row,kind in enumerate(walls):
        for frame in range(16):
            position=18+frame+512*(30+row);overlays[position]=names.index(kind);frames[position]=frame
    base=fixture(width=30,height=30).decode();base=base[:base.index('[OverlayPack]')]+pack('OverlayPack',overlays)+pack('OverlayDataPack',frames)
    base+='[Structures]\n'+''.join(f'{i}=Americans,GAPILL,256,{19+2*i},20,{f},None\n' for i,f in enumerate((0,1,31,64,127,128,192,255)))
    (args.output/'walls-pillboxes.yrm').write_text(base,'utf8')
    (args.output/'pillbox-cases.json').write_text(json.dumps(cases,separators=(',',':')),'utf8')
    result=dict(status='PASS',wallFrames=states,emptyFrames=empty,pillboxStates=pillboxes,pillboxTurretFlagStates=flagged_pillboxes,addedStates=materials['wallSupplement']['addedStates'],
                sharedImages=materials['wallSupplement']['uniqueImages'],originalMaterialIdsUnchanged=True,idempotent=True,mapWalls=16*len(walls),mapPillboxes=8)
    (args.output/'native.json').write_text(json.dumps(result,indent=2),'utf8');print(json.dumps(result),flush=True)


if __name__=='__main__':main()
