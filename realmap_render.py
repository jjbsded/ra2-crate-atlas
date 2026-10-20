"""Original TMP/SHP renderer; geometry is independent of crate probability.

Pixel contours come from the actual TMP transparent footprint, not a guessed
flat diamond. A terrain ownership buffer removes hidden surfaces before export.
Sprites remain beneath the viewer's information layers. See RENDERING.md.
"""
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image

VERSION = 4
SHADOW_ALPHA = 128  # WAE ObjectRenderer.DrawShadow: Color(255,255,255,128).


def palette(raw):
    return [tuple((v << 2) | (v >> 4) for v in raw[i:i+3]) for i in range(0, 768, 3)]


def simplify(points, tolerance=1.0):
    """RDP on two arcs of a closed pixel-boundary ring; keep corners/subpixels."""
    def arc(p):
        if len(p) < 3:
            return p
        a, b = p[0], p[-1]
        dx, dy = b[0]-a[0], b[1]-a[1]
        norm = math.hypot(dx, dy)
        distances = [abs(dx*(q[1]-a[1])-dy*(q[0]-a[0]))/norm if norm else math.dist(a, q) for q in p[1:-1]]
        n = max(range(len(distances)), key=distances.__getitem__)
        if distances[n] <= tolerance:
            return [a, b]
        i = n+1
        return arc(p[:i+1])[:-1]+arc(p[i:])
    split = max(range(len(points)), key=lambda i: math.dist(points[0], points[i]))
    if split == 0:
        return points
    return arc(points[:split+1])[:-1]+arc(points[split:]+[points[0]])[:-1]


def contours(mask, dx=0, dy=0):
    """Trace all exterior/hole rings of a small binary footprint (pixel edges)."""
    padded = np.pad(mask, 1)
    edges = {}
    # Clockwise exterior / counter-clockwise holes, suitable for evenodd fill.
    for neighbor, start, end in [
        (padded[:-2, 1:-1], (0, 0), (1, 0)),
        (padded[1:-1, 2:], (1, 0), (1, 1)),
        (padded[2:, 1:-1], (1, 1), (0, 1)),
        (padded[1:-1, :-2], (0, 1), (0, 0)),
    ]:
        ys, xs = np.nonzero(mask & ~neighbor)
        for x, y in zip(xs.tolist(), ys.tolist()):
            a, b = (x+start[0], y+start[1]), (x+end[0], y+end[1])
            edges.setdefault(a, []).append(b)
    rings = []
    while edges:
        first = next(iter(edges)); point = first; ring = []
        while True:
            ring.append(point)
            choices = edges[point]
            nxt = choices.pop()
            if not choices:
                del edges[point]
            point = nxt
            if point == first:
                break
        if len(ring) >= 4:
            rings.append([[x+dx, y+dy] for x, y in simplify(ring)])
    return rings


def camera_rect(meta, origin):
    # Original YR 0x6D8640, subtract/add half viewport from center limits.
    l, t, w, h = meta['visibleRect']; width = meta['size'][2]
    x = 30*(2*l-width)+origin[0]
    y = 15*(width+2*t-5)+origin[1]
    return [x, y, 60*w, 30*h+135]


def sprite_spec(kind, overlay, frame, res, theater):
    from realmap import yes, ini_integer
    cfg = theater['effectiveRules'].get(kind, {})
    art = res.art.get(kind, {})
    name = art.get('IMAGE', cfg.get('IMAGE', kind)).lower()
    ext, stem = theater['ext'], theater['stem']
    is_theater = yes(art.get('THEATER', 'no'))
    filename = name+('.'+ext if is_theater else '.shp')
    mixes = [stem+'md.mix', stem+'.mix', ext+'.mix', 'conqmd.mix', 'conquer.mix', 'genermd.mix', 'generic.mix']
    if yes(art.get('NEWTHEATER', 'no')):
        letter = dict(TEMPERATE='t', SNOW='a', URBAN='u', NEWURBAN='n', DESERT='d', LUNAR='l')[theater['name']]
        names = [name[:1]+letter+name[2:]+'.shp', name[:1]+'g'+name[2:]+'.shp']
        for filename in names:
            try:
                raw = res.get(mixes, filename)
                break
            except ValueError:
                pass
        else:
            raise ValueError('No original theater sprite for '+kind)
    else:
        raw = res.get(mixes, filename)
    palname = 'iso'+ext+'.pal'
    offset = 0
    if overlay:
        if yes(cfg.get('WALL', 'no')) or yes(cfg.get('ISVEINHOLEMONSTER', 'no')):
            palname = 'unit'+ext+'.pal'
        elif yes(cfg.get('TIBERIUM', 'no')) or yes(cfg.get('ISVEINS', 'no')):
            palname = stem+'.pal'
        if any(yes(cfg.get(k, 'no')) for k in ('TIBERIUM', 'WALL', 'ISVEINS', 'CRATE')):
            offset -= 12
        if cfg.get('LAND', '').upper() == 'TIBERIUM':
            offset -= 1
        if yes(cfg.get('ISVEINS', 'no')):
            offset -= 1
    elif yes(cfg.get('SPAWNSTIBERIUM', 'no')):
        palname = 'unit'+ext+'.pal'
        offset = -15
    else:
        offset = ini_integer(cfg.get('YDRAWFUDGE', '0'))
    if art.get('PALETTE'):
        palname = art['PALETTE'].lower().replace('~~~', ext)
        if not palname.endswith('.pal'):
            palname += ext+'.pal'
    colors = palette(res.get(['cachemd.mix', 'cache.mix'], palname))
    return raw, colors, offset, dict(file=filename, frame=frame, palette=palname, yOffset=offset)


def shadow_frame(raw, frame, cfg, art):
    """Original paired SHP mask; empty frames stay empty (ore/gems, etc.)."""
    from realmap import shp_frame, yes
    count = struct.unpack_from('<4H', raw)[3]
    if yes(cfg.get('NOSHADOW', 'no')) or yes(art.get('NOSHADOW', 'no')):
        return None, dict(shadowFrame=None, shadowStatus='NoShadow')
    if count < 2 or count % 2 or not 0 <= frame < count//2:
        return None, dict(shadowFrame=None, shadowStatus='no paired shadow')
    index = count//2+frame
    im = shp_frame(raw, index, [(v, v, v) for v in range(256)])
    pixels = np.asarray(im)
    nonzero = pixels[:, :, 3] != 0
    if not nonzero.any():
        return None, dict(shadowFrame=index, shadowStatus='empty')
    # All stock shadow silhouettes use index 1. Do not mistake ordinary art in
    # an unpaired SHP for a shadow merely because it has an even frame count.
    if np.any(pixels[:, :, 0][nonzero] != 1):
        return None, dict(shadowFrame=index, shadowStatus='not a shadow mask')
    mask = im.getchannel('A').point(lambda value: SHADOW_ALPHA if value else 0)
    return mask, dict(shadowFrame=index, shadowStatus='original SHP', shadowAlpha=SHADOW_ALPHA,
                      shadowPixels=int(nonzero.sum()), shadowBounds=list(mask.getbbox()))


def apply_shadow(canvas, mask, x, y, level, owners, levels, bodies, factor=1):
    """Receive shadows on ground at the caster's level, beneath solid sprites.

    Use final terrain ownership: later flat cells must not erase half a shadow,
    while foreground cliffs and raised ground must still hide it. Shadow pixels
    never change cell ownership, geometry, picking, probability or occupancy.
    """
    height, width = owners.shape
    left, top = max(0, x), max(0, y)
    right, bottom = min(width, x+mask.width), min(height, y+mask.height)
    if left >= right or top >= bottom:
        return 0
    alpha = np.asarray(mask.crop((left-x, top-y, right-x, bottom-y))).copy()
    terrain = owners[top:bottom, left:right]
    solid = np.asarray(bodies.crop((left, top, right, bottom)))
    allowed = (terrain != 0) & (levels[terrain] == level) & (solid == 0)
    alpha[~allowed] = 0
    count = int(np.count_nonzero(alpha))
    if not count:
        return 0
    im = Image.fromarray(alpha)
    if factor != 1:
        im = im.resize((max(1, round(im.width*factor)), max(1, round(im.height*factor))))
    canvas.paste((0, 0, 0), (round(left*factor), round(top*factor),
                           round(left*factor)+im.width, round(top*factor)+im.height), im)
    return count


def render(cells, res, theater, tmps, folder, meta, progress):
    from realmap import tile_parts, shp_frame, yes
    colors = palette(theater['palette'])
    ordered = sorted(cells.values(), key=lambda c: (c['x']+c['y'], c['x']))
    minx = min(30*(c['x']-c['y'])-30 for c in ordered)-90
    miny = min(15*(c['x']+c['y']-c['level'])-15 for c in ordered)-180
    maxx = max(30*(c['x']-c['y'])+30 for c in ordered)+90
    maxy = max(15*(c['x']+c['y']-c['level'])+15 for c in ordered)+90
    width, height = maxx-minx, maxy-miny
    factor = min(1, 9000/max(width, height))
    canvas = Image.new('RGB', (round(width*factor), round(height*factor)), '#18232b')
    from realmap_objects import ObjectPainter
    painter = ObjectPainter(res, theater, folder)
    progress('绘制建筑、步兵、车辆和飞机', 86)
    object_events, object_info = painter.prepare(cells, [-minx, -miny])
    if painter.voxels is not None:
        painter.voxels.close()
    scene = canvas.copy()
    object_bodies = Image.new('L', (width, height))
    object_shadows = []
    event_index = 0
    def draw_objects(before=float('inf')):
        nonlocal event_index
        while event_index < len(object_events) and object_events[event_index][0] < before:
            depth, _, cx, cy, level, part = object_events[event_index]
            event_index += 1
            im = part['image']; x, y = round(cx+part['x']), round(cy+part['y'])
            drawn = im if factor == 1 else im.resize((max(1, round(im.width*factor)), max(1, round(im.height*factor))))
            scene.paste(drawn, (round(x*factor), round(y*factor)), drawn)
            object_bodies.paste(255, (x,y,x+im.width,y+im.height), im.getchannel('A'))
            if part['shadow'] is not None:
                object_shadows.append((part['shadow'], round(cx+part.get('shadowX', part['x'])),
                    round(cy+part.get('shadowY', part['y'])), level))
    # One logical pixel per original game pixel even when the color raster scales.
    # Integer owner 0 means a vertical cliff face / no selectable ground surface.
    owner = Image.new('I', (width, height), 0)
    bodies = Image.new('L', (width, height))
    shadows = []
    levels = np.array([-32768]+[c['level'] for c in ordered], dtype=np.int16)
    tiles, sprites, missing, audit = {}, {}, set(), {}
    records = []
    bounds = camera_rect(meta, [-minx, -miny])
    for ident, c in enumerate(ordered, 1):
        draw_objects(c['x']+c['y'])
        key = c['file'], c['subTile']
        if key not in tiles:
            parts = tile_parts(tmps[c['file']], c['subTile'], colors)
            ground_parts = parts if c['slope'] else parts[:1]
            bx = min(dx for im, dx, dy in ground_parts)
            by = min(dy for im, dx, dy in ground_parts)
            bw = max(dx+im.width for im, dx, dy in ground_parts)-bx
            bh = max(dy+im.height for im, dx, dy in ground_parts)-by
            mask = Image.new('L', (bw, bh))
            for im, dx, dy in ground_parts:
                mask.paste(255, (dx-bx, dy-by), im.getchannel('A'))
            array = np.asarray(mask) != 0
            full = contours(array, bx-30, by-15) if c['slope'] else [[[0, -15], [30, 0], [0, 15], [-30, 0]]]
            tiles[key] = (parts, array, bx-30, by-15, full)
        parts, mask, dx, dy, full = tiles[key]
        cx, cy = 30*(c['x']-c['y'])-minx, 15*(c['x']+c['y']-c['level'])-miny
        records.append((ident, c, cx, cy, mask, dx, dy, full))
        for i, (im, px, py) in enumerate(parts):
            at = (cx-30+px, cy-15+py)
            owner.paste(ident if not i or c['slope'] else 0, (*at, at[0]+im.width, at[1]+im.height), im.getchannel('A'))
            bodies.paste(0, (*at, at[0]+im.width, at[1]+im.height), im.getchannel('A'))
            object_bodies.paste(0, (*at, at[0]+im.width, at[1]+im.height), im.getchannel('A'))
            drawn = im if factor == 1 else im.resize((max(1, round(im.width*factor)), max(1, round(im.height*factor))))
            canvas.paste(drawn, (round(at[0]*factor), round(at[1]*factor)), drawn)
            scene.paste(drawn, (round(at[0]*factor), round(at[1]*factor)), drawn)
        # Both can coexist; an ore overlay must not replace the terrain object.
        for kind, is_overlay, frame in [(c['overlayName'], True, c['overlayData']), (c['terrain'], False, 0)]:
            if not kind:
                continue
            skey = kind, is_overlay, frame
            if skey not in sprites:
                try:
                    raw, pal, offset, spec = sprite_spec(kind, is_overlay, frame, res, theater)
                    cfg = theater['effectiveRules'].get(kind, {})
                    mask, shadow_spec = shadow_frame(raw, frame, cfg, res.art.get(kind, {}))
                    solid = (not is_overlay or any(yes(cfg.get(k, 'no')) for k in ('WALL', 'CRATE', 'ISAROCK'))
                             or not yes(cfg.get('DRAWFLAT', 'yes')))
                    sprites[skey] = (shp_frame(raw, frame, pal), offset, mask, solid)
                    spec.update(shadow_spec)
                    audit[f'{kind}/{frame}'] = spec
                except (ValueError, IndexError, KeyError) as error:
                    sprites[skey] = None
                    missing.add(kind)
            sprite = sprites[skey]
            if sprite:
                im, offset, shadow, solid = sprite
                x, y = cx-im.width//2, cy-im.height//2+offset
                drawn = im if factor == 1 else im.resize((max(1, round(im.width*factor)), max(1, round(im.height*factor))))
                canvas.paste(drawn, (round(x*factor), round(y*factor)), drawn)
                scene.paste(drawn, (round(x*factor), round(y*factor)), drawn)
                bodies.paste(255 if solid else 0, (x, y, x+im.width, y+im.height), im.getchannel('A'))
                object_bodies.paste(255 if solid else 0, (x, y, x+im.width, y+im.height), im.getchannel('A'))
                if shadow is not None:
                    shadows.append((shadow, x, y, c['level']))
    draw_objects()
    progress('裁切坡面与前景悬崖的遮挡关系', 88)
    owners = np.asarray(owner)
    # Composite after the terrain is complete, masking all visible solid bodies.
    # Flat ore is part of the receiving ground; trees/rocks/walls are above it.
    shadow_count = shadow_pixels = 0
    for mask, x, y, level in shadows:
        pixels = apply_shadow(canvas, mask, x, y, level, owners, levels, bodies, factor)
        shadow_count += pixels > 0
        shadow_pixels += pixels
    for mask, x, y, level in shadows+object_shadows:
        apply_shadow(scene, mask, x, y, level, owners, levels, object_bodies, factor)
    hidden = partial = 0
    for ident, c, cx, cy, mask, dx, dy, full in records:
        h, w = mask.shape
        visible = owners[cy+dy:cy+dy+h, cx+dx:cx+dx+w] == ident
        count = int(visible.sum()); total = int(mask.sum())
        c['surface'] = full
        c['visibleSurface'] = full if count and count == total else contours(visible, dx, dy)
        c['surfaceVisibility'] = round(count/total, 5) if total else 0
        hidden += count == 0
        partial += 0 < count < total
        yy, xx = np.nonzero(visible)
        if count:
            # A centroid can lie in a hole or an occluded gap; use its closest
            # remaining surface pixel so text/hit targets stay on the terrain.
            nearest = np.argmin((xx-xx.mean())**2+(yy-yy.mean())**2)
            c['labelOffset'] = [int(xx[nearest])+dx+.5, int(yy[nearest])+dy+.5]
        else:
            c['labelOffset'] = [0, 0]
        # Classify the whole cell at the usable boundary, but split at the camera
        # rectangle in the viewer. No geometric test can change probability.
        yy_full, xx_full = np.nonzero(mask)
        camera_pixels = ((cx+dx+xx_full+.5 >= bounds[0]) & (cx+dx+xx_full+.5 < bounds[0]+bounds[2]) &
                         (cy+dy+yy_full+.5 >= bounds[1]) & (cy+dy+yy_full+.5 < bounds[1]+bounds[3]))
        c['cameraCoverage'] = round(float(camera_pixels.mean()), 5) if total else 0
        c['visibleBand'] = (bool(camera_pixels.any()) and not c['usable'] and
                            cy <= 15*(meta['size'][2]+2*meta['visibleRect'][1]+1)-miny)
    progress('保存真实地形与表面轮廓', 91)
    filename = f'ground-v{VERSION}.png'
    canvas.save(folder/filename)
    scene_filename = f'objects-v{VERSION}.png'
    scene.save(folder/scene_filename)
    (folder/'object-audit.json').write_text(json.dumps(object_info, ensure_ascii=False, indent=2), 'utf8')
    object_info.pop('records')
    shadow_info = dict(objects=shadow_count, pixels=shadow_pixels, alpha=SHADOW_ALPHA,
                       source='original paired SHP frames', receiver='same-level ground, clipped by terrain and solid objects')
    (folder/'render-audit.json').write_text(json.dumps(dict(version=VERSION, sprites=audit, fullyHidden=hidden, partiallyHidden=partial, shadows=shadow_info), ensure_ascii=False, indent=2), 'utf8')
    return dict(version=VERSION, width=width, height=height, origin=[-minx, -miny], image=filename, objectImage=scene_filename, objects=object_info, shadows=shadow_info,
                cameraRect=bounds, rasterScale=factor, missingSprites=sorted(missing),
                fullyHidden=hidden, partiallyHidden=partial,
                objectStyle='original sprites below information; unrendered objects have occupancy badges')


def refresh_result(path):
    """Explicit render-only upgrade of a saved report; never recompute probability.

    For legacy results use matching original source bytes, including map overrides.
    Future results preserve source.map beside the report for repeatable rendering.
    """
    from realmap import ROOT, parse_map, sha
    path = Path(path)
    result = json.loads(path.read_text('utf8'))
    meta = result['metadata']
    choices = [path.parent/'source.map', ROOT.parents[1]/'scripts/crate_generation_research/heck-analysis'/meta['filename']]
    source = next((p for p in choices if p.is_file() and sha(p.read_bytes()) == meta['sourceSha256']), None)
    if source is None:
        raise ValueError('旧报告缺少哈希匹配的地图原文件；请重新导入地图以升级绘图。')
    if meta.get('previewOnly'):
        from realmap_mod import preview
        return preview(source.read_bytes(), path.parent, meta['filename'], lambda *a:None)['rendering']
    _, res, theater, tmps, _ = parse_map(source.read_bytes(), path.parent, meta['version'], lambda *a: None)
    cells = {(c['x'], c['y']): c for c in result['cells']}
    result['rendering'] = render(cells, res, theater, tmps, path.parent, meta, lambda *a: None)
    path.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), 'utf8')
    return result['rendering']


if __name__ == '__main__':
    import sys
    for filename in sys.argv[1:]:
        print(filename, refresh_result(filename), flush=True)
