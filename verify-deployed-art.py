"""Verify map-driven static deployment without changing gameplay records."""
from pathlib import Path
import argparse, copy, importlib.util, json
import runtime_bootstrap
from PIL import Image, ImageDraw
from realmap_resources import resources
from realmap_objects import ObjectPainter, deployed_voxel_type, deployment_mission
from toy_live_materials import object_key

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT/'output/deployed-art-20261103')
args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
results = []; previews = []
for version, climates in [('ra2', ('TEMPERATE','SNOW','URBAN')), ('yr', ('TEMPERATE','SNOW','URBAN','NEWURBAN','DESERT','LUNAR'))]:
    res = resources(version)
    for climate in climates:
        theater = res.theater(climate); theater['effectiveRules'] = res.rules
        painter = ObjectPainter(res, theater, args.output)
        try:
            for kind, start, stride in [('E1',292,1), ('GGI',315,1), ('DESO',298,0), ('SCHP',None,None)]:
                if kind not in res.rules: continue
                category = 'UNITS' if kind == 'SCHP' else 'INFANTRY'
                for facing in range(0,256,8 if category == 'UNITS' else 32):
                    rec = dict(type=kind, category=category, health=256, facing=facing, house='AMERICANS', mission='Guard', upgrades=[])
                    deployed = {**rec, 'mission':'Unload'}; unchanged = copy.deepcopy(deployed)
                    normal, parts = painter.parts(rec), painter.parts(deployed)
                    assert deployed == unchanged
                    assert object_key(rec,res.rules,res.art) != object_key(deployed,res.rules,res.art)
                    if category == 'INFANTRY':
                        assert parts[0]['frame'] == start+((7-facing//32)%8)*stride, (version,climate,kind,parts[0]['frame'])
                        assert normal[0]['frame'] == (7-facing//32)%8
                    else:
                        assert [p['file'] for p in normal] == ['schp.vxl']
                        assert [p['file'] for p in parts] == ['schd.vxl','schdtur.vxl']
                        assert normal[0]['shadowSection'] == 2 and parts[0]['shadowSection'] == 0
                        assert parts[0]['shadowScale'] == .5 and parts[1]['shadow'] is None
                        assert all(p['lighting']=='ra2-native-vpl-v2' and p['paletteLightStep']==37 for p in parts)
                    assert any(a['image'].tobytes()!=b['image'].tobytes() for a,b in zip(normal,parts)), (kind,'unchanged pose')
                    mixed = painter.parts({**deployed,'mission':'  uNlOaD  '})
                    assert [(p['file'],p['frame'],p['image'].tobytes()) for p in mixed] == [(p['file'],p['frame'],p['image'].tobytes()) for p in parts]
                    results.append([version,climate,kind,facing])
                    if version=='yr' and climate=='TEMPERATE' and facing==64:
                        previews.append((kind,normal,parts))
            if version=='yr':
                assert deployed_voxel_type('UNITS',res.rules['SCHD'],'SCHD') == ''
                assert deployed_voxel_type('UNITS',{'ISSIMPLEDEPLOYER':'yes','UNLOADINGCLASS':'SCHD'},'HTNK') == ''
                cfg = {**res.rules['SCHP'],'IMAGE':'SCHP'}
                assert deployed_voxel_type('UNITS',cfg,'SCHP') == 'SCHD'
                assert deployment_mission('UNITS',cfg,'SCHP','Guard') == ''
                assert deployment_mission('UNITS',{**cfg,'ISSIMPLEDEPLOYER':'no'},'SCHP','Unload') == ''
        finally:
            if painter.voxels: painter.voxels.close()
sheet=Image.new('RGB',(720,400),(111,119,108)); draw=ImageDraw.Draw(sheet)
for i,(kind,normal,deployed) in enumerate(previews):
    for j,parts in enumerate((normal,deployed)):
        x,y=i*180+90,j*190+95
        draw.text((i*180+8,j*190+8),kind+(' Guard' if j==0 else ' Unload'),fill='white')
        for p in parts:
            if p.get('shadow') is not None: sheet.paste((0,0,0),(x+p.get('shadowX',p['x']),y+p.get('shadowY',p['y'])),p['shadow'])
        for p in parts: sheet.paste(p['image'],(x+p['x'],y+p['y']),p['image'])
sheet.save(args.output/'poses.png')
(args.output/'native-states.json').write_text(json.dumps(dict(status='PASS',states=len(results),records=results),indent=2),'utf8')
print('PASS',len(results),'deployed states: frames, model, direction, shadows, lighting and unchanged records')
