"""Native/full vs composable Toy: pixels, anchors, shadows and map aliases.

Build the object library into an isolated site first; this check never packages
or changes an installed release. Its companion .cjs checks the browser resolver.
"""
import argparse
import hashlib
import json
from pathlib import Path
import runtime_bootstrap
from PIL import Image
from realmap_resources import resources
from realmap_objects import ObjectPainter
from realmap_parser import map_rules, parse_map
from realmap_format import ini
from toy_live_materials import object_key
from map_test_fixtures import fixture

ROOT = Path(__file__).resolve().parent


def definitions(res):
    def clone(kind, **changes):
        return {**res.rules[kind], 'IMAGE': res.rules[kind].get('IMAGE', kind), **changes}
    cases = [
        ('CLONE', 'UNITS', clone('HTNK', TURRET='true', PRIMARY='DifferentWeapon')),
        ('BODY', 'UNITS', clone('HTNK', TURRET='no')),
        ('BARE', 'UNITS', {'IMAGE':'HTNK'}),
        ('SHADOWLESS', 'UNITS', clone('HTNK', NOSHADOW='yes')),
        ('SPIDER', 'UNITS', clone('DRON')),
        ('SOLDIER', 'INFANTRY', clone('E1')),
        ('TOWER', 'STRUCTURES', clone('NALASR')),
        ('PLINTH', 'STRUCTURES', clone('GTGCAN', TURRET='false')),
        ('BAREPLINTH', 'STRUCTURES', {'IMAGE':'NALASR'}),
        ('MIXSAM', 'STRUCTURES', clone('NALASR', TURRETANIM='SAM', TURRETANIMX='-7', TURRETANIMY='19')),
        ('MIXCANNON', 'STRUCTURES', clone('NALASR', TURRETANIM='GTGCANTUR', TURRETANIMX='5', TURRETANIMY='-9')),
        ('MIXFLAK', 'STRUCTURES', clone('GTGCAN', TURRETANIM='FLAKTUR', TURRETANIMX='$B', TURRETANIMY='12h')),
        ('ADDEDTOWER', 'STRUCTURES', clone('GAPOWR', TURRET='yes', TURRETANIM='SAM', TURRETANIMISVOXEL='1', TURRETANIMY='-13')),
        ('NOSHADOWTOWER', 'STRUCTURES', clone('NALASR', TURRETANIM='GTGCANTUR', NOSHADOW='1')),
        ('EXPLICITBARREL', 'STRUCTURES', clone('NALASR', TURRETANIM='FLAKTUR', VOXELBARRELFILE='GTGCANBARL')),
    ]
    if res.version == 'yr':
        cases += [('DEPLOY', 'UNITS', clone('SCHP')), ('DEPLOYBASE', 'UNITS', clone('SCHP', TURRET='no')),
                  ('MIXGAT', 'STRUCTURES', clone('NALASR', TURRETANIM='YAGGUN'))]
    return cases


def native_part(part, shadow=False):
    image = part.get('shadow') if shadow else part['image']
    if image is None or not (box := image.getbbox()):
        return None
    if shadow:
        rgba = Image.new('RGBA', image.size); rgba.putalpha(image); image = rgba
    image = image.crop(box)
    data = bytearray(image.tobytes())
    for at in range(0, len(data), 4):
        if data[at+3] == 0:
            data[at:at+3] = b'\0\0\0'
    x = part.get('shadowX', part['x']) if shadow else part['x']
    y = part.get('shadowY', part['y']) if shadow else part['y']
    return dict(file=part['file'], x=x+box[0], y=y+box[1], width=image.width, height=image.height,
                shadow=shadow, sha256=hashlib.sha256(data).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'output/toy-components-20261104')
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    cases, rejected = [], []
    faces = sorted(set(range(0,256,8)) | {7,31,73,159,255})
    for version, climates in [('ra2', ('TEMPERATE','SNOW','URBAN')), ('yr', ('TEMPERATE','SNOW','URBAN','NEWURBAN','DESERT','LUNAR'))]:
        res = resources(version); definitions_here = definitions(res)
        content = {'QAOWNER':{'COLOR':'QACOLOR'}, 'COLORS':{**res.rules['COLORS'], 'QACOLOR':'104,241,195'}}
        for i,(kind,category,cfg) in enumerate(definitions_here):
            table = {'UNITS':'VEHICLETYPES','INFANTRY':'INFANTRYTYPES','STRUCTURES':'BUILDINGTYPES'}[category]
            content.setdefault(table,{})[str(9000+i)] = kind; content[kind] = cfg
        rules, additions = map_rules(content, res, [])
        rules['QAOWNER'] = content['QAOWNER']
        assert len(additions) == len(definitions_here)
        for climate in climates:
            theater = res.theater(climate); theater['effectiveRules'] = rules
            theater['mapLighting'] = {'AMBIENT':'.72', 'GROUND':'.05', 'LEVEL':'.032'}
            painter = ObjectPainter(res, theater, args.output)
            painter.cells = {(20,20):{'level':4}}
            try:
                for kind,category,cfg in definitions_here:
                    for health in ((256,64,0) if category=='STRUCTURES' else (256,)):
                        for mission in (('Guard','Unload') if kind in ('SOLDIER','DEPLOY','DEPLOYBASE') else ('Guard',)):
                            for face in (range(0,256,32) if category=='INFANTRY' else faces):
                                rec=dict(type=kind,category=category,facing=face,health=health,mission=mission,house='QAOWNER',upgrades=[],x=20,y=20)
                                parts=painter.parts(rec)
                                expected=[value for shadow in (False,True) for p in parts if (value:=native_part(p,shadow))]
                                meta=dict(type=kind, category=category, key=object_key(rec,rules,res.art,lighting=theater['mapLighting'],level=4))
                                cases.append(dict(scope=version+'/'+climate, meta=meta, expected=expected))
                for name,changes in [('ANGLE',{'FIREANGLE':'19'}), ('MISSING',{'TURRETANIM':'NOT_IN_STOCK'}),
                                     ('UNBAKEDBARREL',{'VOXELBARRELFILE':'HTNK'})]:
                    rules[name]={**rules['MIXSAM'],**changes}
                    rec=dict(type=name,category='STRUCTURES',facing=64,health=256,mission='Guard',house='QAOWNER',upgrades=[])
                    rejected.append(dict(scope=version+'/'+climate,meta=dict(type=name,category='STRUCTURES',key=object_key(rec,rules,res.art))))
                # Same visual signature, different implicit <type>barl models.
                for kind in ('GTGCAN','BARRELTWIN'):
                    painter.rules[kind] = {**rules['MIXSAM']}
                    rec=dict(type=kind,category='STRUCTURES',facing=64,health=256,mission='Guard',house='QAOWNER',upgrades=[],x=20,y=20)
                    parts=painter.parts(rec)
                    meta=dict(type=kind,category='STRUCTURES',key=object_key(rec,painter.rules,res.art,lighting=theater['mapLighting'],level=4))
                    expected=[value for shadow in (False,True) for p in parts if (value:=native_part(p,shadow))]
                    cases.append(dict(scope=version+'/'+climate,meta=meta,expected=expected))
            finally:
                if painter.voxels:painter.voxels.close()
            print('Native component expectations:',version,climate,len(cases),flush=True)
    (args.output/'native-expectations.json').write_text(json.dumps(dict(cases=cases,rejected=rejected),separators=(',',':')),'utf8')
    # A real map with declared new types exercises the actual parser/UI path.
    res=resources('yr'); rows={}; text='[QAOWNER]\nColor=QACOLOR\n[Colors]\nQACOLOR=104,241,195\n[Lighting]\nAmbient=.72\n'
    for i,(kind,category,cfg) in enumerate(definitions(res)):
        table={'UNITS':'VehicleTypes','INFANTRY':'InfantryTypes','STRUCTURES':'BuildingTypes'}[category]
        rows.setdefault(table,[]).append(f'{9000+i}={kind}')
        x,y=16+(i%6)*4,16+(i//6)*4
        value=f'QAOWNER,{kind},256,{x},{y},'+('0,Unload,64' if category=='INFANTRY' else '73,'+('Unload' if kind.startswith('DEPLOY') else 'Guard'))
        rows.setdefault(category,[]).append(f'{i}={value}')
        text+=f'[{kind}]\n'+''.join(f'{k}={v}\n' for k,v in cfg.items())
    text+=''.join(f'[{section}]\n'+'\n'.join(values)+'\n' for section,values in rows.items())
    raw=fixture(extra=text,width=30,height=25); (args.output/'combinations.yrm').write_bytes(raw)
    cells,res,theater,_,_=parse_map(raw,args.output,'yr')
    rules=theater['effectiveRules']; rules={**rules,**theater['mapHouses']}
    map_keys={r['type']:object_key(r,rules,res.art,lighting=ini(raw).get('LIGHTING',{}),level=cells[r['x'],r['y']]['level']) for r in theater['mapObjects']}
    (args.output/'cases.json').write_text(json.dumps(dict(cases=cases,rejected=rejected,mapKeys=map_keys),separators=(',',':')),'utf8')
    print('PASS native setup:',len(cases),'states;',len(rejected),'unsupported cases;',len(map_keys),'map objects',flush=True)


if __name__=='__main__':main()
