"""Fill missing wall/fence frames and verified urban trees in shared materials.

Official maps do not exercise every four-way connection or damage stage.
This supplement decodes the original SHPs instead of inventing junction art.
"""
from pathlib import Path
import gzip
import hashlib
import io
import json
import struct
from PIL import Image
from realmap_format import yes
from realmap_resources import resources, THEATERS
from realmap_sprites import sprite_spec, shp_frame, shadow_frame
from toy_live_materials import SPRITE
from toy_build_inputs import artwork_fingerprint


def source_stamp():
    return artwork_fingerprint(('toy_live_walls.py', 'toy_live_materials.py'))


def visible_frames(raw, cfg, art):
    """Exclude a verified paired shadow half, including empty shadow frames."""
    count = struct.unpack_from('<4H', raw)[3]
    if count % 2 == 0:
        states = [shadow_frame(raw, f, {**cfg, 'NOSHADOW':'no'}, {**art, 'NOSHADOW':'no'})[1]['shadowStatus']
                  for f in range(count//2)]
        if all(s in ('original SHP', 'empty') for s in states):
            return range(count//2)
    return range(count)


def build(directory):
    directory = Path(directory); target = directory/'materials.json.gz'; art_dir = directory.parent/'art'
    payload = json.loads(gzip.decompress(target.read_bytes())); digest = source_stamp()
    previous = payload.pop('wallSupplement', None)
    if previous and previous['sourceSha256'] == digest and all((art_dir/name).is_file() and
            hashlib.sha256((art_dir/name).read_bytes()).hexdigest() == checksum for name,checksum in previous['files'].items()):
        return previous
    if previous:
        # Only build-owned appended records are removed; base IDs stay stable.
        for scope, keys in previous['entries'].items():
            for key in keys:
                del payload['scopes'][scope]['sprites'][key]
        for scope in previous['createdScopes']:
            assert not any(payload['scopes'][scope].values())
            del payload['scopes'][scope]
        for name, count in previous['baseCounts'].items():
            del payload[name][count:]
    base_counts = {k:len(payload[k]) for k in ('atlases','assets','refs')}
    entries, created, images, recipes, inventory = {}, [], {}, [], {}
    for version in ('ra2','yr'):
        res = resources(version)
        walls = [k.upper() for k in res.rules['OVERLAYTYPES'].values() if yes(res.rules.get(k.upper(),{}).get('WALL','no'))]
        for climate in THEATERS:
            if version == 'ra2' and climate not in ('TEMPERATE','SNOW','URBAN'):
                continue
            scope = version+'/'+climate
            if scope not in payload['scopes']:
                payload['scopes'][scope] = dict(tiles={},sprites={},objects={},terrainVariants={}); created.append(scope)
            sprites = payload['scopes'][scope]['sprites']; theater = res.theater(climate); theater['effectiveRules'] = res.rules
            inventory[scope] = {}
            kinds = [(kind, True) for kind in walls]
            if climate == 'URBAN':
                kinds += [(f'TREE{n}', False) for n in range(29, 36) if f'TREE{n}' in res.rules]
            for kind, overlay in kinds:
                cfg = res.rules[kind]; art = res.art.get(cfg.get('IMAGE',kind).upper(),{})
                raw, colors, dy, _ = sprite_spec(kind, overlay, 0, res, theater)
                frames = visible_frames(raw, cfg, art) if overlay else range(1)
                inventory[scope][kind] = len(frames)
                signature = [cfg.get(k,kind if k=='IMAGE' else '').upper() for k in SPRITE]
                for frame in frames:
                    key = json.dumps([int(overlay),signature[0],frame,signature,''],separators=(',',':'))
                    if key in sprites:
                        continue
                    im = shp_frame(raw,frame,colors); box = im.getbbox()
                    if box is None:
                        recipes.append((scope,key,None)); continue
                    cropped = im.crop(box)
                    token = hashlib.sha256(struct.pack('<II',*cropped.size)+cropped.tobytes()).hexdigest()
                    images.setdefault(token,cropped)
                    recipes.append((scope,key,(token,box[0]-im.width//2,box[1]-im.height//2+dy)))
    # Pack only missing pixels; share exact duplicates across wall types/climates.
    edge = 512; atlas = Image.new('RGBA',(edge,edge)); x = y = row = 0; packed = {}; files = {}
    def finish():
        nonlocal atlas,x,y,row
        if not x and not y and not row:
            return
        im = atlas.crop((0,0,edge,y+row)); buffer = io.BytesIO(); im.save(buffer,'PNG',optimize=True)
        raw, extension = buffer.getvalue(), '.png'
        webp = io.BytesIO(); im.save(webp,'WEBP',lossless=True,method=6,exact=True)
        if len(webp.getvalue()) < len(raw):
            raw, extension = webp.getvalue(), '.webp'
        # Compression must preserve even transparent RGB and every alpha byte.
        with Image.open(io.BytesIO(raw)) as decoded:
            assert decoded.convert('RGBA').tobytes() == im.tobytes()
        checksum = hashlib.sha256(raw).hexdigest(); name = 'walls-'+checksum[:20]+extension
        art_dir.mkdir(parents=True,exist_ok=True); (art_dir/name).write_bytes(raw); files[name] = checksum
        payload['atlases'].append(dict(file=name,width=im.width,height=im.height,bytes=len(raw)))
        atlas = Image.new('RGBA',(edge,edge)); x = y = row = 0
    for token,im in sorted(images.items(),key=lambda v:(-v[1].height,-v[1].width,v[0])):
        w,h = im.size; assert w<=edge and h<=edge
        if x+w>edge:
            x=0; y+=row; row=0
        if y+h>edge:
            finish()
        packed[token]=len(payload['assets']); payload['assets'].append([len(payload['atlases']),x,y,w,h])
        atlas.paste(im,(x,y)); x+=w; row=max(row,h)
    finish()
    ref_ids = {}
    for scope,key,record in recipes:
        entries.setdefault(scope,[]).append(key)
        if record is None:
            payload['scopes'][scope]['sprites'][key]=None; continue
        value=(packed[record[0]],*record[1:])
        if value not in ref_ids:
            ref_ids[value]=len(payload['refs']); payload['refs'].append(value)
        payload['scopes'][scope]['sprites'][key]=ref_ids[value]
    info = dict(version=1,sourceSha256=digest,baseCounts=base_counts,entries=entries,createdScopes=created,
                files=files,inventory=inventory,addedStates=len(recipes),uniqueImages=len(images))
    payload['wallSupplement']=info
    target.write_bytes(gzip.compress(json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode(),9,mtime=0))
    resolved = art_dir.resolve()
    for path in [*art_dir.glob('walls-*.png'), *art_dir.glob('walls-*.webp')]:
        if path.name not in files:
            assert path.resolve().is_relative_to(resolved)
            path.unlink()
    print('Sprite supplement:',len(recipes),'missing states;',len(images),'shared images;',sum((art_dir/n).stat().st_size for n in files),'lossless bytes',flush=True)
    return info
