"""Stock object frames for custom maps: shared indices, palettes and recipes.

Unlike screenshots of official layouts, these templates are independent of a
map's owners. Only static display frames are exported; no MIX or Mod is shipped.
"""
from pathlib import Path
import gzip, hashlib, json, struct
import numpy as np
from PIL import Image
from realmap_resources import resources, THEATERS
from realmap_objects import ObjectPainter, deployed_voxel_type
from realmap_format import yes
from toy_live_materials import object_key, VISUAL
from toy_build_inputs import artwork_fingerprint
from toy_object_components import Components


def dumps(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':')).encode()


def frame_stamp():
    return artwork_fingerprint(('toy_live_objects.py', 'toy_live_materials.py', 'toy_object_components.py'))


def build(output, cache):
    output, cache = Path(output), Path(cache)
    output.mkdir(exist_ok=True); cache.mkdir(parents=True, exist_ok=True)
    pixels = cache/'pixels'; pixels.mkdir(exist_ok=True)
    palettes, palette_ids, sizes, scopes, missing, renderers = [], {}, {}, {}, [], {}
    index_colors = [(i, 0, 0) for i in range(256)]
    saved = cache/'frames.json.gz'; stamp = cache/'frames.stamp'; digest = frame_stamp()
    cached = saved.is_file() and stamp.is_file() and stamp.read_text('utf8') == digest
    components = Components()
    if cached:
        data = json.loads(gzip.decompress(saved.read_bytes()))
        palettes, sizes, scopes = data['palettes'], data['sizes'], data['scopes']
        components = Components(data['components'])

    class IndexedPainter(ObjectPainter):
        def colors(self, art, house, default='unit', remap=True):
            return self.indexed_colors(art, default, remap, False)

        def voxel_colors(self, art, obj):
            return self.indexed_colors(art, 'unit', True, True)

        def indexed_colors(self, art, default, remap, voxel):
            colors, _ = super().colors(art, '', default, remap=False)
            record = [colors, bool(remap and not yes(art.get('TERRAINPALETTE', 'no'))), voxel]
            key = dumps(record)
            if key not in palette_ids:
                palette_ids[key] = len(palettes); palettes.append(record)
            return index_colors, palette_ids[key]

        def voxel_parts(self, obj, cfg, image, art, turret=None):
            vpl = hashlib.sha256(self.get('voxels.vpl')).hexdigest()
            self.voxels = renderers.get(vpl)
            result = super().voxel_parts(obj, cfg, image, art, turret=turret)
            renderers[vpl] = self.voxels
            components.voxels(obj, cfg, image, art, turret, result, part_ref)
            return result

    def part_ref(part):
        im = part['image']; box = im.getbbox()
        if not box: return None
        a = np.asarray(im.crop(box)); opacity = np.unique(a[:, :, 3][a[:, :, 3] > 0])
        assert len(opacity) == 1, 'Indexed object opacity must be uniform'
        indices = a[:, :, 0].copy(); indices[a[:, :, 3] == 0] = 0
        assert np.all(indices[a[:, :, 3] > 0] > 0), 'Palette index zero is transparent'
        h, w = indices.shape; key = hashlib.sha256(struct.pack('<II', w, h)+indices.tobytes()).hexdigest()[:32]
        if key not in sizes:
            sizes[key] = [w, h]
            if not (pixels/(key+'.png')).exists(): Image.fromarray(indices).save(pixels/(key+'.png'))
        return [key, part['x']+box[0], part['y']+box[1], part['palette'], int(opacity[0])]

    def shadow_ref(part, all_shapes=False):
        # Only VXL shadows are added here; paired SHP shadows use the existing
        # official capture path. One binary footprint is shared by all owners.
        mask=part.get('shadow')
        if not (all_shapes or part.get('shadowModel')) or mask is None or not (box:=mask.getbbox()):return None
        a=(np.asarray(mask.crop(box))>0).astype(np.uint8);h,w=a.shape
        key=hashlib.sha256(struct.pack('<II',w,h)+a.tobytes()).hexdigest()[:32]
        if key not in sizes:
            sizes[key]=[w,h]
            if not (pixels/(key+'.png')).exists():Image.fromarray(a).save(pixels/(key+'.png'))
        palette=[[(0,0,0)]*256,False,False];token=dumps(palette)
        if token not in palette_ids:palette_ids[token]=len(palettes);palettes.append(palette)
        return [key,part.get('shadowX',part['x'])+box[0],part.get('shadowY',part['y'])+box[1],palette_ids[token],128,1]

    try:
        for version in (() if cached else ('ra2', 'yr')):
            res = resources(version)
            for climate in THEATERS:
                if version == 'ra2' and climate not in ('TEMPERATE', 'SNOW', 'URBAN'): continue
                theater = res.theater(climate); theater['effectiveRules'] = res.rules
                painter = IndexedPainter(res, theater, cache); target = scopes.setdefault(version+'/'+climate, {})
                components.scope(version+'/'+climate, painter)
                for category, list_name in [('STRUCTURES', 'BUILDINGTYPES'), ('INFANTRY', 'INFANTRYTYPES'), ('UNITS', 'VEHICLETYPES'), ('AIRCRAFT', 'AIRCRAFTTYPES')]:
                    for kind in dict.fromkeys(v.upper() for v in res.rules[list_name].values()):
                        cfg, image, art = painter.art_for(kind)
                        if not art or image in ('NONE', '<NONE>'): continue
                        faces = range(0, 256, 32 if category == 'INFANTRY' else 8)
                        if category == 'STRUCTURES' and not yes(cfg.get('TURRET', 'no')): faces = [0]
                        healths = (256, 64, 0) if category == 'STRUCTURES' else (256,)
                        missions = ['Guard']
                        if category == 'INFANTRY' and 'DEPLOYED' in res.art.get(art.get('SEQUENCE', '').upper(), {}): missions.append('Unload')
                        if deployed_voxel_type(category, cfg, image): missions.append('Unload')
                        failed = False
                        for health in healths:
                            for mission in missions:
                                for facing in faces:
                                    rec = dict(type=kind, category=category, facing=facing, health=health, mission=mission, house='', upgrades=[])
                                    key = object_key(rec, res.rules, res.art, template=True)
                                    if key in target: continue
                                    try:
                                        parts = painter.parts(rec)
                                        target[key] = [ref for part in parts if (ref := part_ref(part))]
                                        target[key] += [ref for part in parts if (ref := shadow_ref(part))]
                                        components.shp_turret(rec, cfg, parts, part_ref, shadow_ref)
                                        if category != 'STRUCTURES' or yes(cfg.get('CAPTURABLE','no')) or yes(cfg.get('BRIDGEREPAIRHUT','no')) or int(cfg.get('TECHLEVEL','-1')) >= 0:
                                            components.body(painter, rec, cfg, image, art, parts, part_ref, shadow_ref)
                                    except (ValueError, OSError, IndexError, struct.error) as error:
                                        missing.append([version, climate, kind, str(error)])
                                        failed = True; break
                                if failed: break
                            if failed: break
                        painter.cache.clear()
                print('Stock object templates:', version, climate, len(target), 'states;', len(sizes), 'shared frames', flush=True)
    finally:
        for renderer in renderers.values(): renderer.close()

    if not cached:
        saved.write_bytes(gzip.compress(dumps(dict(palettes=palettes, sizes=sizes, scopes=scopes, components=components.data)),9,mtime=0))
        stamp.write_text(digest,'utf8'); (cache/'missing.json').write_bytes(dumps(missing))
    # Some buildings never use owner-color indices. Reuse their existing RGBA
    # atlas entries for every owner, but prove this from the native pixels first.
    original = json.loads(gzip.decompress((output.parent/'materials.json.gz').read_bytes()))
    invariant, checks = {}, {}
    def color_invariant(parts):
        for name, _, _, palette, _, *flags in parts:
            if not palettes[palette][1]: continue
            if name not in checks:
                with Image.open(pixels/(name+'.png')) as im:
                    a = np.asarray(im); checks[name] = not np.any((a >= 16) & (a < 32))
            if not checks[name]: return False
        return True
    for scope, values in original['scopes'].items():
        target = invariant.setdefault(scope, {})
        for key, ref in values['objects'].items():
            if type(ref) is not int: continue
            fields = json.loads(key); fields[2] = ''
            if len(fields) > 7: continue  # Lit voxels must use their exact map intensity.
            if fields[0] != 'INFANTRY': fields[4] = fields[4]//8*8
            canonical = dumps(fields).decode(); parts = scopes.get(scope, {}).get(canonical)
            if parts is not None and color_invariant(parts): target[canonical] = ref
    # Official atlases already cover ordinary civilian scenery. Supplement all
    # stock units and playable/tech buildings, rather than duplicate every
    # civilian building's healthy/damaged/rubble frames in six climates.
    from toy_live_materials import visual
    allowed = {}
    for version in ('ra2','yr'):
        allowed[version] = {dumps(visual(cfg,kind)) for kind,cfg in resources(version).rules.items()
                            if yes(cfg.get('CAPTURABLE','no')) or yes(cfg.get('BRIDGEREPAIRHUT','no'))
                            or cfg.get('TECHLEVEL','-1').lstrip('-').isdigit() and int(cfg.get('TECHLEVEL','-1')) >= 0}
    used = set()
    for scope, target in scopes.items():
        for key in list(target):
            fields = json.loads(key)
            if fields[0] == 'STRUCTURES' and dumps(fields[1]) not in allowed[scope.split('/')[0]]:
                del target[key]
            else: used.update(p[0] for p in target[key])
    for refs in components.references():
        used.update(p[0] for p in refs)
    sizes = {key:size for key,size in sizes.items() if key in used}

    # Native palette indices compress much better than owner-colored RGBA.
    # Small grayscale pages stay lossless and bound per-map decode memory.
    assets, pages, ids = [], [], {}; edge = 512; sheet = Image.new('L', (edge, edge)); x = y = row = 0; used = False
    def finish():
        nonlocal sheet, x, y, row, used
        if not used: return
        import io
        im = sheet.crop((0, 0, edge, y+row)); buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
        raw = buf.getvalue(); name = 'objects-'+hashlib.sha256(raw).hexdigest()[:20]+'.png'
        (output/name).write_bytes(raw); pages.append(dict(file=name, width=im.width, height=im.height, bytes=len(raw)))
        sheet = Image.new('L', (edge, edge)); x = y = row = 0; used = False
    for key in sorted(sizes, key=lambda k: (-sizes[k][1], -sizes[k][0], k)):
        w, h = sizes[key]; assert w <= edge and h <= edge, (key, w, h)
        if x+w > edge: x = 0; y += row; row = 0
        if y+h > edge: finish()
        with Image.open(pixels/(key+'.png')) as im: sheet.paste(im, (x,y))
        ids[key] = len(assets); assets.append([len(pages),x,y,w,h]); x += w; row = max(row,h); used = True
    finish()
    refs, ref_ids = [], {}
    def intern(parts):
        value = [[ids[p[0]], *p[1:]] for p in parts]; sig = dumps(value)
        if sig not in ref_ids: ref_ids[sig] = len(refs); refs.append(value)
        return ref_ids[sig]
    for target in scopes.values():
        for key, parts in target.items():
            target[key] = intern(parts)
    payload = dict(version=1, atlases=pages, assets=assets, palettes=palettes, refs=refs, scopes=scopes, invariant=invariant,
                   visualFields=VISUAL, components=components.pack(intern))
    data = gzip.compress(dumps(payload),9,mtime=0); (output/'index.json.gz').write_bytes(data)
    keep = {p['file'] for p in pages}; resolved = output.resolve()
    for path in output.glob('objects-*.png'):
        if path.name not in keep:
            assert path.resolve().is_relative_to(resolved)
            path.unlink()
    print('Stock object library:', len(data)+sum(p['bytes'] for p in pages), 'bytes;', len(pages), 'pages;', len(missing), 'unavailable stock states', flush=True)
    return payload
