"""Small original SHP sprites and cameos for placement tools, lossless PNG."""
from pathlib import Path
import hashlib,json,importlib
import numpy as np
from realmap_resources import resources,THEATERS,readmix
from realmap_sprites import sprite_spec,shp_frame,palette
from realmap_format import yes

ROOT=Path(__file__).resolve().parent
def build_tool_icons(result,out,color_map=None):
 """Only UI thumbnails are cropped; source SHP dimensions/frames stay audited."""
 import struct,colorsys
 res=resources('yr');result['toolIcons']={}
 remap_file=out/'tool-remap.json'
 if color_map:
  from realmap_format import ini
  raw_map=color_map.read_bytes();content=ini(raw_map,strict=True,irrelevant_duplicates=[])
  houses=[(house,content.get(house.upper(),{})) for house in content.get('HOUSES',{}).values() if content.get(house.upper(),{}).get('COUNTRY','').upper()=='AMERICANS']
  assert len(houses)==1,'Expected one American house in the reference map'
  house,cfg=houses[0];name=cfg.get('COLOR',content.get('AMERICANS',{}).get('COLOR',res.rules['AMERICANS'].get('COLOR')))
  value={**res.rules.get('COLORS',{}),**content.get('COLORS',{})}[name.upper()]
  reference=dict(house=house,country='Americans',color=name,hsv=value,map=dict(file=color_map.name,sha256=hashlib.sha256(raw_map).hexdigest()))
  remap_file.write_text(json.dumps(reference,ensure_ascii=False,indent=2)+'\n','utf8')
 reference=json.loads(remap_file.read_text('utf8'))
 specifications=[('normal','mouse.shp','mousepal.pal',313),
                 ('chrono','cleg.shp','unittem.pal',3),
                 ('restore','healall.shp','anim.pal',12)]
 mixes=['conqmd.mix','conquer.mix','cachemd.mix','cache.mix']
 for tool,name,palname,frame in specifications:
  archive=next(m for m in mixes if name in res.mix(m));raw=res.mix(archive)[name]
  palette_archive=next(m for m in mixes if palname in res.mix(m));palraw=res.mix(palette_archive)[palname]
  colors=palette(palraw)
  if tool=='chrono':
   hsv=[int(v)/255 for v in reference['hsv'].split(',')];assert len(hsv)==3
   for index in range(16,32):
    shade=max(colors[index])/255;colors[index]=tuple(round(v*255) for v in colorsys.hsv_to_rgb(hsv[0],hsv[1],min(1,hsv[2]*shade)))
  im=shp_frame(raw,frame,colors);box=im.getbbox();assert box
  crop=im.crop(box);filename='tool-'+tool+'.png';crop.save(out/filename,optimize=True)
  result['toolIcons'][tool]=dict(file=filename,sha256=hashlib.sha256((out/filename).read_bytes()).hexdigest(),width=crop.width,height=crop.height,
   source=dict(archive=archive,file=name,sha256=hashlib.sha256(raw).hexdigest(),
    frame=frame,canvas=list(struct.unpack_from('<4H',raw)[1:3]),crop=list(box),
    palette=palname,paletteArchive=palette_archive,paletteSha256=hashlib.sha256(palraw).hexdigest()))
  if tool=='chrono':result['toolIcons'][tool]['source']['remap']={**reference,'indices':[16,31]}

def build(game,tool_color_map=None):
 out=ROOT/'simulation-assets';out.mkdir(exist_ok=True);result=dict(version=1,scopes={},icons={},localizedIcons={'en':{}},labels={},menuIcons={})
 strings=importlib.import_module('build-map-catalog')
 def save(im,x=0,y=0):
  box=im.getbbox()
  if not box:return None
  crop=im.crop(box);token=hashlib.sha256(crop.tobytes()+str(crop.size).encode()).hexdigest()[:24]+'.png'
  crop.save(out/token,optimize=True);return dict(file=token,x=x+box[0],y=y+box[1],width=crop.width,height=crop.height)
 for version in ('ra2','yr'):
  res=resources(version);icons={};english={};result['icons'][version]=icons;result['localizedIcons']['en'][version]=english
  # Cameos live in the language archives, outside ra2.mix / ra2md.mix.
  languages=[readmix(mix_filepath=str(game/name)) for name in (('langmd.mix','language.mix') if version=='yr' else ('language.mix',))]
  nested=[readmix(mix_data=a[name]) for a in languages for name in ('cameomd.mix','cameo.mix') if name in a]
  loose=[readmix(mix_filepath=str(game/name)) for name in (('cameomd.mix','cameo.mix') if version=='yr' else ('cameo.mix',)) if (game/name).is_file()]
  cameos=loose+nested
  chinese={};english_names={}
  names=('ra2md.csf','ra2.csf') if version=='yr' else ('ra2.csf',)
  for name in reversed(names):
   path=game/name
   if path.is_file():chinese.update(strings.parse_csf(path.read_bytes())['labels'])
   for archive in reversed(languages):
    if name in archive:english_names.update(strings.parse_csf(archive[name])['labels'])
  labels={};result['labels'][version]=labels
  colors=palette(res.get(['cachemd.mix','cache.mix'],'cameo.pal'))
  for kind in ['MTNK','E2','HYD','YHVR',*res.rules['BUILDINGTYPES'].values()]:
   kind=kind.upper();cfg=res.rules.get(kind,{});art=res.art.get(cfg.get('IMAGE',kind).upper(),{});name=art.get('CAMEO','').lower()
   label=cfg.get('UINAME','').casefold()
   def localized(table):
    value=table.get(label)
    return value[0]['strings'][0]['text'] if value and value[0]['strings'] else cfg.get('NAME',kind)
   labels[kind]={'zh-CN':strings.simplified(localized(chinese)),'en':localized(english_names)}
   if not name:continue
   filename=name if '.' in name else name+'.shp'
   data=next((archive[filename] for archive in cameos if filename in archive),None)
   if data:icons[kind]=save(shp_frame(data,0,colors))
   data=next((archive[filename] for archive in nested if filename in archive),None)
   if data:english[kind]=save(shp_frame(data,0,colors))
  assert icons.get('MTNK') and icons.get('E2'), 'Original unit cameos unavailable'
  for climate in THEATERS:
   if version=='ra2' and climate not in ('TEMPERATE','SNOW','URBAN'):continue
   t=res.theater(climate);t['effectiveRules']=res.rules;candidates=[]
   for kind in res.rules['TERRAINTYPES'].values():
    kind=kind.upper()
    if not kind.startswith('TREE'):continue
    try:
     raw,pal,dy,spec=sprite_spec(kind,False,0,res,t);im=shp_frame(raw,0,pal);area=int(np.count_nonzero(np.asarray(im)[:,:,3]));box=im.getbbox()
     if area and box:candidates.append((area,box[3]-box[1],kind,im,dy,spec))
    except (ValueError,IndexError):pass
   assert candidates,(version,climate)
   fallback=min(candidates,key=lambda v:v[:3])
   selected=next((v for v in candidates if v[2]=='TREE16'),fallback)
   area,height,tree,im,dy,spec=selected
   sprites={}
   for _,_,kind,image,offset,_ in (fallback,selected):
    sprites[kind]={'0':save(image,-image.width//2,-image.height//2+offset)}
   if version=='yr' and climate=='URBAN':
    result['menuIcons']['tree']=save(im)
   for kind,frames in [('GAWALL',range(16)),('TIB01',range(12))]:
    sprites[kind]={}
    for frame in frames:
     raw,pal,dy,_=sprite_spec(kind,True,frame,res,t);im=shp_frame(raw,frame,pal)
     if version=='yr' and climate=='URBAN' and kind=='TIB01' and frame==11:
      result['menuIcons']['ore']=save(im)
     if kind=='TIB01':
      pixels=np.array(im);v=pixels[:,:,:3].max(axis=2).astype(np.uint16);pixels[:,:,0]=v*35//255;pixels[:,:,1]=v;pixels[:,:,2]=v*70//255;from PIL import Image;im=Image.fromarray(pixels)
     sprites[kind][str(frame)]=save(im,-im.width//2,-im.height//2+dy)
   allow={file:yes(t['config'][section].get('ALLOWTIBERIUM','no')) for section,file,_ in t['definitions']}
   result['scopes'][version+'/'+climate]=dict(tree=tree,legacyTrees=[fallback[2]] if tree!=fallback[2] else [],sprites=sprites,allowOre=allow,selection=dict(policy='prefer-TREE16-otherwise-smallest',fallback=fallback[2],opaquePixels=area,height=height,candidates=[dict(type=v[2],pixels=v[0],height=v[1]) for v in sorted(candidates,key=lambda v:v[:3])]))
 build_tool_icons(result,out,tool_color_map)
 (out/'catalog.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),'utf8')
 print('Simulation assets',len(list(out.iterdir())),'files',sum(p.stat().st_size for p in out.iterdir()),'bytes')
 print({k:v['tree'] for k,v in result['scopes'].items()})
if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--game',type=Path);parser.add_argument('--tools-only',action='store_true');parser.add_argument('--tool-color-map',type=Path)
 args=parser.parse_args()
 if args.tools_only:
  out=ROOT/'simulation-assets';catalog=out/'catalog.json';result=json.loads(catalog.read_text('utf8'));build_tool_icons(result,out,args.tool_color_map);catalog.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),'utf8')
 else:
  if args.game is None:parser.error('--game is required unless --tools-only is set')
  build(args.game,args.tool_color_map)
