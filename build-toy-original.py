"""Restore original per-cell artwork in a verified static Toy build.

Reuses exact precomputed results unchanged. Captures the desktop painter in
build workers, packs shared lossless atlases, and publishes map-local indexes.
"""
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import argparse, gzip, hashlib, importlib.util, json, shutil, struct
import runtime_bootstrap
from PIL import Image
from toy_original import capture, capture_stamp, dumps, VERSION
from toy_atlas_codec import ordered, encode, decode
from realmap_voxel_lighting import MODEL
from realmap_voxel_shadow import MODEL as SHADOW_MODEL
from realmap_render import VERSION as RENDER_VERSION

ROOT=Path(__file__).resolve().parent

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def worker(task):
    path,cache,stamp=task; target=cache/'maps'/(path.parent.name+'.json.gz')
    tag=target.with_suffix('.stamp')
    if not target.is_file() or not tag.is_file() or tag.read_text('utf8')!=stamp:
        capture(path,cache);tag.write_text(stamp,'utf8')
    return str(target)

def delta(values): return [v-(values[i-1] if i else 0) for i,v in enumerate(values)]

def pack_pair(ore,clear,rects,atlases):
    names=sorted(set(ore['assets'])|set(clear['assets']));ids={k:i for i,k in enumerate(names)}
    commands=[];lookup={};layers=[]
    for scene in (clear,ore):
        for key in ('ground','objectsLayer'):
            sequence=[]
            for cmd in scene[key]:
                sig=tuple(cmd)
                if sig not in lookup:lookup[sig]=len(commands);commands.append(cmd)
                sequence.append(lookup[sig])
            layers.append(delta(sequence))
    columns=[delta([ids[c[0]] for c in commands]),delta([c[1] for c in commands]),delta([c[2] for c in commands])]
    def parts(refs):return [[ids[a],x,y] for a,x,y in refs]
    used=sorted({rects[n][0] for n in names});local={v:i for i,v in enumerate(used)}
    return dict(version=1,size=ore['size'],rasterScale=ore['rasterScale'],
        atlases=[atlases[i] for i in used],assets=[[local[rects[n][0]],*rects[n][1:]] for n in names],
        commands=columns,layers=layers,tiles={k:parts(v) for k,v in ore['tiles'].items()},
        terrainVariants=ore.get('terrainVariants',{}),
        sprites={k:None if v is None else [ids[v[0]],*v[1:]] for k,v in ore['sprites'].items()},
        objects=[[*v[:-1],parts(v[-1])] for v in ore['objects']])

def pixel_digest(image):
    return hashlib.sha256(struct.pack('<II',*image.size)+image.tobytes()).digest()


def reusable_atlases(folder):
    pages = {}
    if folder:
        for path in sorted(folder.glob('*.webp')):
            with Image.open(path) as image:
                pages[pixel_digest(image.convert('RGBA'))] = path
    return pages


def atlas_job(task, reusable=None):
    index,placements,size,cache,out=task
    image=Image.new('RGBA',size)
    for key,x,y,w,h in placements:
        with Image.open(cache/'pixels'/(key+'.png')) as source:image.paste(source,(x,y))
    existing = (reusable or {}).get(pixel_digest(image))
    if existing:
        target = out/'art'/existing.name
        if target.resolve() != existing.resolve():shutil.copy2(existing,target)
        return index,dict(file=target.name,width=size[0],height=size[1],bytes=target.stat().st_size)
    import io
    buf=io.BytesIO();image.save(buf,'WEBP',lossless=True,quality=100,method=6,exact=True)
    payload=buf.getvalue();decoded=Image.open(io.BytesIO(payload)).convert('RGBA')
    assert decoded.tobytes()==image.tobytes(),'Atlas compression changed pixels'
    name='atlas-'+hashlib.sha256(payload).hexdigest()[:20]+'.webp';(out/'art'/name).write_bytes(payload)
    return index,dict(file=name,width=size[0],height=size[1],bytes=len(payload))

def build(args):
    builder=module('toy_builder',ROOT/'build-toy.py')
    source=args.source.resolve();out=args.output.resolve();cache=args.art_cache.resolve()
    source_manifest=json.loads((source/'build-manifest.json').read_text('utf8'))
    assert source_manifest['modelSourceSha256']==builder.source_fingerprint(),'Precomputed model differs; rebuild base Toy first'
    for name, checksum in source_manifest['files'].items():
        path=(source/name).resolve()
        assert path.is_relative_to(source) and hashlib.sha256(path.read_bytes()).hexdigest()==checksum, 'Source package changed: '+name
    if out==source or out.is_relative_to(source) or source.is_relative_to(out):raise ValueError('Use a separate, non-nested output directory')
    if cache.is_relative_to(out):raise ValueError('Artwork build cache must stay outside the upload package')
    if not out.exists():shutil.copytree(source,out)
    elif not (out/'build-manifest.json').is_file():raise ValueError('Output is not a Toy build')
    elif json.loads((out/'build-manifest.json').read_text('utf8')).get('modelSourceSha256')!=source_manifest['modelSourceSha256']:
        raise ValueError('Output contains a different analysis; choose a new output directory')
    catalog=json.loads((source/'catalog.json').read_text('utf8'))
    if args.map_id:
        catalog['maps']=[e for e in catalog['maps'] if e['id'] in args.map_id]
        if not catalog['maps']:raise ValueError('No matching map IDs')
        catalog['default']=catalog['maps'][0]['id'];catalog['scope']['completeModes']=False
        source_manifest['maps']=[r for r in source_manifest['maps'] if r['id'] in args.map_id]
    from official_maps import select
    tasks={};variants=[]
    stamp=capture_stamp()
    for entry in catalog['maps']:
        for version,variant in entry['variants'].items():
            raw,_,_=select(entry['id'],version);pair=[]
            for enabled in (True,False):
                key=hashlib.sha256(raw+version.encode()+str(enabled).encode()+source_manifest['modelSourceSha256'].encode()).hexdigest()[:24]
                path=args.cache/key/'result.json'
                if not path.is_file():raise FileNotFoundError(path)
                tasks[key]=(path,cache,stamp);pair.append(key)
            variants.append((variant,pair))
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        pending=[pool.submit(worker,v) for v in tasks.values()]
        for i,f in enumerate(as_completed(pending),1):
            f.result()
            print(f'Capture {i}/{len(tasks)}',flush=True)
    # Co-locate sprites by their map usage. Small immutable pages cap decode
    # memory and are shared across climates/versions/layouts wherever identical.
    inventory={};usage={};climates={}
    for i,key in enumerate(tasks):
        value=json.loads(gzip.decompress((cache/'maps'/(key+'.json.gz')).read_bytes()))
        climate=next(iter(value['tiles'])).split('/')[0].rsplit('.',1)[-1]
        for name,size in value['assets'].items():inventory[name]=size;usage.setdefault(name,[]).append(i);climates.setdefault(name,set()).add(climate)
    names=sorted(inventory,key=lambda n:(tuple(sorted(climates[n])),-len(usage[n]),tuple(usage[n]),-inventory[n][1],-inventory[n][0],n))
    pages=[];placements=[];x=y=row=0;edge=512;previous=None
    def finish():
        nonlocal placements,x,y,row
        if placements:pages.append((placements,(edge,min(edge,y+row+1))))
        placements=[];x=y=row=0
    for name in names:
        w,h=inventory[name]
        group=tuple(sorted(climates[name]))
        if group!=previous:finish();previous=group
        if w+2>edge or h+2>edge:
            finish();pages.append(([(name,1,1,w,h)],(w+2,h+2)));continue
        if x+w+2>edge:x=0;y+=row;row=0
        if y+h+2>edge:finish()
        placements.append((name,x+1,y+1,w,h));x+=w+2;row=max(row,h+2)
    finish();(out/'art').mkdir(exist_ok=True)
    rects={name:[i,x,y,w,h] for i,(page,size) in enumerate(pages) for name,x,y,w,h in page}
    atlases=[None]*len(pages)
    reusable=reusable_atlases(args.reuse_atlases.resolve() if args.reuse_atlases else out/'art')
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        pending=[pool.submit(atlas_job,(i,page,size,cache,out),reusable) for i,(page,size) in enumerate(pages)]
        for i,f in enumerate(as_completed(pending),1):
            index,info=f.result();atlases[index]=info
            if i%10==0:print(f'Atlases {i}/{len(pages)}',flush=True)
    built={};mapstats=[]
    for variant,pair in variants:
        if tuple(pair) not in built:
            ore,clear=[json.loads(gzip.decompress((cache/'maps'/(key+'.json.gz')).read_bytes())) for key in pair]
            value=ordered(pack_pair(ore,clear,rects,atlases))
            payload=encode(value)
            assert decode(payload)==value, 'Atlas index round-trip changed commands'
            name='map-art-'+hashlib.sha256(payload).hexdigest()[:20]+'.bin.gz';(out/'art'/name).write_bytes(payload)
            built[tuple(pair)]=name
            mapstats.append(dict(file=name,indexBytes=len(payload),atlases=len(value['atlases']),downloadBytes=sum(a['bytes'] for a in value['atlases']),decodedBytes=sum(a['width']*a['height']*4 for a in value['atlases'])))
        for state,url in variant['reports'].items():
            path=out/url;value=json.loads(gzip.decompress(path.read_bytes()))
            value['rendering'].pop('simplified',None)
            value['rendering']['version']=RENDER_VERSION
            value['rendering']['original']=dict(version=1,index='../../../art/'+built[tuple(pair)],layout=state)
            path.write_bytes(gzip.compress(dumps(value),compresslevel=9,mtime=0))
    catalog['artwork']=dict(style='original',compact=True,lossless=True,sharedAtlases=True)
    keep={v['file'] for v in atlases}|set(built.values())
    art_root=(out/'art').resolve()
    for path in art_root.iterdir():
        if path.is_file() and path.name not in keep and path.suffix in ('.webp','.gz'):
            assert path.resolve().is_relative_to(art_root)
            path.unlink()
    builder.dump(out/'catalog.json',catalog)
    builder.frontend(out)
    manifest={**source_manifest,'artworkStyle':'original','originalArtVersion':VERSION,'zipBudgetBytes':50000000,'atlasCount':len(atlases),'maxImageEdge':max(max(v['width'],v['height']) for v in atlases)}
    manifest.update(voxelLightingModel=MODEL,artworkSourceSha256=stamp)
    manifest.update(renderVersion=RENDER_VERSION,voxelShadowModel=SHADOW_MODEL,terrainVariantModel='ra2-tmp-lattice-v1')
    from realmap_palette_lighting import MODEL as PALETTE_LIGHTING
    manifest['voxelPaletteLightingModel']=PALETTE_LIGHTING
    (cache/'build-stats.json').write_text(json.dumps(dict(atlases=atlases,maps=mapstats,images=len(names)),indent=2),'utf8')
    builder.finalize(out,manifest)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--cache',type=Path,default=ROOT/'output/toy-cache');p.add_argument('--art-cache',type=Path,default=ROOT/'output/toy-original-cache')
    p.add_argument('--jobs',type=int,choices=range(1,5),default=3)
    p.add_argument('--reuse-atlases',type=Path,help='Reuse encoded pages only when their decoded pixels and dimensions match exactly')
    p.add_argument('--map-id',action='append',help='Only restore these map IDs for a local smoke build')
    build(p.parse_args())
