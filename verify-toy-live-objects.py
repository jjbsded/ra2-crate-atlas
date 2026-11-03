"""Compare supplemental stock object pixels and placement with the native painter."""
from pathlib import Path
import argparse, colorsys, gzip, json
import runtime_bootstrap
import numpy as np
from PIL import Image
from realmap_resources import resources
from realmap_objects import ObjectPainter
from toy_live_materials import object_key
from realmap_palette_lighting import light_palette

root = Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=root/'output/toy')
parser.add_argument('--output',type=Path,default=root/'output/toy-live-object-qa')
args=parser.parse_args()
folder = args.root/'live/objects'
lib = json.loads(gzip.decompress((folder/'index.json.gz').read_bytes()))
work = args.output; work.mkdir(parents=True,exist_ok=True)
atlases = {}; tested = 0
for version, climate in [('ra2','TEMPERATE'),('yr','SNOW'),('yr','URBAN'),('yr','DESERT')]:
    res = resources(version); theater = res.theater(climate)
    theater['effectiveRules'] = {**res.rules, 'QAOWNER':{'COLOR':'QACOLOR'}, 'COLORS':{**res.rules['COLORS'],'QACOLOR':'104,241,195'}}
    painter = ObjectPainter(res, theater, work)
    try:
        ordinary = [('CAOILD','STRUCTURES',256,0),('CAAIRP','STRUCTURES',256,0),('YAPSYT','STRUCTURES',256,0),('GAGAP','STRUCTURES',64,0),('ATESLA','STRUCTURES',256,0),('GAPOWR','STRUCTURES',64,0),('NAHAND','STRUCTURES',256,0),('NALASR','STRUCTURES',256,73),('ENGINEER','INFANTRY',256,73),('GHOST','INFANTRY',256,192),('HTNK','UNITS',256,73),('ORCA','AIRCRAFT',256,161),('YTNK','UNITS',256,64),('SHAD','UNITS',256,64),('SCHP','UNITS',256,64),('ZEP','UNITS',256,64),('DISK','UNITS',256,64)]
        deployed = [(k,'UNITS' if k=='SCHP' else 'INFANTRY',256,f,'Unload') for k in ('E1','GGI','DESO','SCHP') for f in range(0,256,8 if k=='SCHP' else 32)]
        for kind, category, health, facing, mission in [(*v,'Guard') for v in ordinary]+deployed:
            if kind not in res.rules: continue
            record = dict(type=kind,category=category,health=health,facing=facing,mission=mission,house='QAOWNER',upgrades=[])
            key = json.loads(object_key(record,res.rules,res.art,template=True)); key[2] = ''
            if category != 'INFANTRY': key[4] = key[4]//8*8
            parts = lib['refs'][lib['scopes'][version+'/'+climate][json.dumps(key,separators=(',',':'))]]
            drawn=painter.parts(record)
            native = [p for p in drawn if p['image'].getbbox()]
            for part in drawn:
                if part.get('shadowModel') and part.get('shadow') is not None:
                    image=Image.new('RGBA',part['shadow'].size);image.putalpha(part['shadow'])
                    if image.getbbox():native.append(dict(image=image,x=part['shadowX'],y=part['shadowY'],file=part['file']+' shadow'))
            assert len(parts)==len(native), (version,climate,kind,len(parts),len(native))
            for ref, part in zip(parts,native):
                asset,x,y,palette,opacity,*flags = ref; page,sx,sy,w,h = lib['assets'][asset]
                if page not in atlases:
                    with Image.open(folder/lib['atlases'][page]['file']) as im: atlases[page] = np.asarray(im).copy()
                indices = atlases[page][sy:sy+h,sx:sx+w]
                colors, remap, voxel = lib['palettes'][palette]; colors = [tuple(c) for c in colors]
                if remap:
                    for i in range(16,32): colors[i] = tuple(round(v*255) for v in colorsys.hsv_to_rgb(104/255,241/255,min(1,195/255*max(colors[i])/255)))
                if voxel: colors = light_palette(colors, painter.voxel_brightness(record))
                actual = np.zeros((h,w,4),dtype=np.uint8); actual[:,:,:3] = np.asarray(colors,dtype=np.uint8)[indices]; actual[:,:,3] = np.where(indices,opacity,0)
                bounds = part['image'].getbbox(); expected = np.asarray(part['image'].crop(bounds)).copy()
                actual[actual[:,:,3]==0]=0; expected[expected[:,:,3]==0]=0
                assert (x,y)==(part['x']+bounds[0],part['y']+bounds[1]), (kind,'anchor')
                assert actual.shape==expected.shape and np.array_equal(actual,expected), (version,climate,kind,part['file'],'pixels')
            tested += 1
    finally:
        if painter.voxels: painter.voxels.close()
print('PASS',tested,'stock states: lossless pixels, owner recoloring, anchors, facing and damaged buildings')
cases=[]
for record in lib['palettes']:
    for color in ('','0,0,131','131,55,131','104,241,195','0,255,255','85,255,255','170,255,255'):
        colors,remap,voxel=record; expected=[list(c) for c in colors]
        if remap and color:
            h,s,v=[int(c)/255 for c in color.split(',')]
            for i in range(16,32): expected[i]=[round(c*255) for c in colorsys.hsv_to_rgb(h,s,min(1,v*max(colors[i])/255))]
        for step in (0, 20, 31, 37, 50, 62):
            cases.append(dict(record=record,color=color,step=step,expected=light_palette(expected,step) if voxel else expected))
(work/'palettes.json').write_text(json.dumps(cases,separators=(',',':')),'utf8')
