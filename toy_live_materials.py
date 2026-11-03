"""Index reusable sprites already in the Toy atlases; never add artwork."""
from pathlib import Path
import gzip,json,hashlib
from toy_atlas_codec import decode
from realmap_format import ini,yes,ini_integer
from realmap_resources import resources
from realmap_parser import map_rules
from realmap_objects import deployment_mission

SPRITE=('IMAGE','WALL','TIBERIUM','ISVEINS','CRATE','ISVEINHOLEMONSTER','LAND','SPAWNSTIBERIUM','YDRAWFUDGE')
VISUAL=('IMAGE','ALTERNATEARCTICART','TURRET','TURRETANIM','TURRETANIMISVOXEL','TURRETANIMX','TURRETANIMY','TURRETANIMZADJUST','TURRETANIM.IDLEFRAMES','TURRETOFFSET','WALKRATE','DRAWFLAT','VOXELBARRELFILE','FIREANGLE','NOSHADOW','CONSIDEREDAIRCRAFT','ISSIMPLEDEPLOYER','UNLOADINGCLASS')
def visual(cfg,kind):return [cfg.get(k,kind if k=='IMAGE' else '').upper() for k in VISUAL]
def object_key(rec,rules,art,*,lighting=None,level=0,template=False):
 cfg=rules.get(rec['type'],{});image=cfg.get('IMAGE',rec['type']).upper();a=art.get(image,{})
 category=rec['category'];face=rec['facing']%256
 if category=='STRUCTURES' and not yes(cfg.get('TURRET','no')):face=0
 elif category=='INFANTRY':face=face//32
 # Keep raw voxel/turret directions: an unavailable view is a missing asset.
 health=0 if rec['health']==0 else 1 if rec['health']<128 else 2
 if category!='STRUCTURES':health=2
 mission=deployment_mission(category,cfg,image,rec['mission'])
 house=rules.get(rec['house'],{}).get('COLOR','').upper();color=rules.get('COLORS',{}).get(house,'')
 upgrades=[v.upper() for v in rec['upgrades'] if v.upper() not in ('NONE','<NONE>','0','')]
 fields=[category,visual(cfg,rec['type']),color,health,face,mission,upgrades]
 from realmap_palette_lighting import voxel_object,light_step
 if not template and voxel_object(category,cfg,a):fields.append(light_step(rules,lighting or {},category,level))
 return json.dumps(fields,separators=(',',':'))

def build(source,out,cache):
 catalog=json.loads((source/'catalog.json').read_text('utf8'));manifest=json.loads((source/'build-manifest.json').read_text('utf8'))
 from official_maps import select
 pages=[];assets=[];pageids={};assetids={};scopes={};indexes={};seen=set();conflicts=set()
 def merge(target,k,v,scope):
  token=(scope,id(target),k)
  if k in target and target[k]!=v:target[k]=False;conflicts.add(token)
  else:target[k]=v
 for entry in catalog['maps']:
  for version,variant in entry['variants'].items():
   raw,_,_=select(entry['id'],version)
   key=hashlib.sha256(raw+version.encode()+b'True'+manifest['modelSourceSha256'].encode()).hexdigest()[:24]
   if key in seen:continue
   seen.add(key);folder=cache/key;report=json.loads((folder/'result.json').read_text('utf8'));m=report['metadata'];scope=version+'/'+m['theater'];r=resources(version)
   value=json.loads(gzip.decompress((source/variant['reports']['ore']).read_bytes()))
   index=(source/variant['reports']['ore']).parent/value['rendering']['original']['index'];index=index.resolve()
   if index not in indexes:indexes[index]=decode(index.read_bytes())
   data=indexes[index];local=[]
   for a in data['assets']:
    page=data['atlases'][a[0]];file=page['file']
    if file not in pageids:pageids[file]=len(pages);pages.append(page)
    sig=(pageids[file],*a[1:])
    if sig not in assetids:assetids[sig]=len(assets);assets.append(sig)
    local.append(assetids[sig])
   ref=lambda v:[local[v[0]],*v[1:]] if v else v
   dest=scopes.setdefault(scope,dict(tiles={},sprites={},objects={},terrainVariants={}))
   for name,definition in data.get('terrainVariants',{}).items():
    assert name not in dest['terrainVariants'] or dest['terrainVariants'][name]==definition
    dest['terrainVariants'][name]=definition
   for k,v in data['tiles'].items():merge(dest['tiles'],k,[ref(part) for part in v],scope)
   content=ini(raw);rules,_=map_rules(content,r,[])
   for k,v in data['sprites'].items():
    overlay,kind,frame=k.split('/');cfg=rules.get(kind,{})
    signature=[cfg.get(field,kind if field=='IMAGE' else '').upper() for field in SPRITE]
    material=json.dumps([int(overlay),signature[0],int(frame),signature,kind if kind in ('BRIDGE1','BRIDGE2','BRIDGEB1','BRIDGEB2') else ''],separators=(',',':'))
    merge(dest['sprites'],material,ref(v),scope)
   records=[rec for rec in json.loads((folder/'object-audit.json').read_text('utf8'))['records'] if rec.get('parts')]
   assert len(records)==len(data['objects']),(key,len(records),len(data['objects']))
   rules={**rules,**{v['house']:{**rules.get(v['house'],{}),**content.get(v['house'],{})} for v in records}}
   levels={(c['x'],c['y']):c['level'] for c in report['cells']}
   for rec,draw in zip(records,data['objects']):
    assert draw[:2]==[rec['x'],rec['y']]
    k=object_key(rec,rules,r.art,lighting=content.get('LIGHTING',{}),level=levels[(rec['x'],rec['y'])])
    merge(dest['objects'],k,[ref(part) for part in draw[-1]],scope)
 # Raw type names for scenery/overlays must not accidentally reuse an altered Image.
 refs=[];refids={};used=set()
 for scope in scopes.values():
  for name in ('tiles','sprites','objects'):
   for k,v in scope[name].items():
    if v is False or v is None:continue
    rows=[v] if name=='sprites' else v
    used.update(r[0] for r in rows)
    signature=json.dumps(v,separators=(',',':'))
    if signature not in refids:refids[signature]=len(refs);refs.append(v)
    scope[name][k]=refids[signature]
 ids={old:new for new,old in enumerate(sorted(used))};assets=[assets[i] for i in sorted(used)]
 for value in refs:
  for ref in value if not value or isinstance(value[0],list) else [value]:ref[0]=ids[ref[0]]
 payload=dict(version=1,visualFields=VISUAL,atlases=pages,assets=assets,refs=refs,scopes=scopes)
 data=gzip.compress(json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode(),9,mtime=0)
 (out/'materials.json.gz').write_bytes(data)
 print('Shared material index:',len(data),'bytes;',len(pages),'existing atlas pages;',sum(len(v['tiles']) for v in scopes.values()),'tile variants;',len(conflicts),'ambiguous entries skipped',flush=True)
 return payload
