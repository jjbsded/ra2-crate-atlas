"""Original TMP/SHP renderer; geometry is independent of crate probability.

Pixel contours come from the actual TMP transparent footprint, not a guessed
flat diamond. A terrain ownership buffer removes hidden surfaces before export.
Sprites remain beneath the viewer's information layers. See RENDERING.md.
"""
import json
import math

import numpy as np
from PIL import Image
from realmap_bridges import HIGH_NAMES, sprite_frame

VERSION = 13
# Compatibility exports; shared sprite code lives below both renderers.
from realmap_sprites import palette, sprite_spec, shadow_frame, SHADOW_ALPHA


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


def bridge_terrain_mask(im, x, y, level, stencil, *, pixel_heights=None, ground_level=None):
    """Low bridges/objects retain their editor stencil; high decks use TMP Z.

    Bridge SHPs span neighboring cells, including transparent Overlay owners.
    Later water/ground must not erase them. Keep this color mask separate from
    the terrain ownership buffer used for cell picking and probability overlays.
    """
    alpha = np.asarray(im.getchannel('A')).copy()
    h, w = alpha.shape
    height, width = stencil.shape
    left, top, right, bottom = max(0, x), max(0, y), min(width, x+w), min(height, y+h)
    if left < right and top < bottom:
        part = alpha[top-y:bottom-y, left-x:right-x]
        refs = stencil[top:bottom, left:right]
        high = (refs & 128) != 0
        depth = refs & 127
        # With no usable TMP Z, retain the former conservative editor rule.
        blocked = np.where(high, depth-1, depth) > min(level+1, 127)
        if pixel_heights is not None:
            heights = pixel_heights[top-y:bottom-y, left-x:right-x]
            actual = ground_level*15 + heights
            blocked[high] = (actual < depth.astype(np.int16)*15)[high]
        part[blocked] = 0
    return Image.fromarray(alpha)


def mark_sprite_stencil(im, x, y, threshold, stencil):
    height, width = stencil.shape
    left, top = max(0, x), max(0, y)
    right, bottom = min(width, x+im.width), min(height, y+im.height)
    if left < right and top < bottom:
        alpha = np.asarray(im.getchannel('A'))
        part = stencil[top:bottom, left:right]
        part[alpha[top-y:bottom-y, left-x:right-x] != 0] = min(threshold, 127)


def mark_bridge_stencil(im, x, y, level, stencil, *, high=False):
    if not high:
        mark_sprite_stencil(im, x, y, level+3, stencil)
        return
    # The high bit distinguishes the actual +4 deck from the low-bridge and
    # object stencil ranks, without allocating another full-map depth buffer.
    height, width = stencil.shape
    left, top = max(0, x), max(0, y)
    right, bottom = min(width, x+im.width), min(height, y+im.height)
    if left < right and top < bottom:
        alpha = np.asarray(im.getchannel('A'))
        part = stencil[top:bottom, left:right]
        part[alpha[top-y:bottom-y, left-x:right-x] != 0] = 128 | min(level+4, 127)


def render(cells, res, theater, tmps, folder, meta, progress):
    from realmap_sprites import tile_parts, shp_frame
    from realmap_format import yes
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
    # Same-level terrain must not erase sprite pixels extending beyond the
    # anchor cell. Higher foreground terrain still wins the depth comparison.
    # This is solely the object scene; picking/ground/probability stay untouched.
    object_stencil = np.zeros((height, width), dtype=np.uint8)
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
            mark_sprite_stencil(im, x, y, level+2, object_stencil)
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
    tile_heights = {}
    has_high_bridges = any(c['overlayName'] in HIGH_NAMES for c in ordered)
    records = []
    bounds = camera_rect(meta, [-minx, -miny])
    def bridge_overlay(cell):
        name = cell['overlayName'] or ''
        return name in HIGH_NAMES or name.startswith(('LOBRDG', 'LOBRDB'))
    bridge_stencil = (np.zeros((height, width), dtype=np.uint8)
                      if any(bridge_overlay(c) for c in ordered) else None)
    for ident, c in enumerate(ordered, 1):
        draw_objects(c['x']+c['y'])
        key = c['file'], c['subTile']
        if key not in tiles:
            if c.get('terrainError'):
                # Saved height survives, but this is explicitly unknown ground.
                im = Image.new('RGBA', (60, 30))
                from PIL import ImageDraw
                pen = ImageDraw.Draw(im)
                pen.polygon([(30, 0), (59, 15), (30, 29), (0, 15)], fill='#654757', outline='#d59ab6')
                pen.line([(17, 15), (30, 8), (43, 15), (30, 22), (17, 15)], fill='#e4b4c9')
                parts = [(im, 0, 0)]
            else:
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
        if has_high_bridges and key not in tile_heights:
            from terrain_depth import tile_pixel_heights
            tile_heights[key] = ([None]*len(parts) if c.get('terrainError') else
                                tile_pixel_heights(tmps[c['file']], c['subTile'], parts))
        cx, cy = 30*(c['x']-c['y'])-minx, 15*(c['x']+c['y']-c['level'])-miny
        records.append((ident, c, cx, cy, mask, dx, dy, full))
        for i, (im, px, py) in enumerate(parts):
            at = (cx-30+px, cy-15+py)
            owner.paste(ident if not i or c['slope'] else 0, (*at, at[0]+im.width, at[1]+im.height), im.getchannel('A'))
            alpha = im.getchannel('A')
            level = c['level']
            if i and py < 0 and py+im.height <= 15:
                level += int((py-15)/-30)
            if bridge_stencil is not None:
                # Editor DirectXTerrain also raises the comparison height of
                # short cliff extras whose artwork is entirely above the tile.
                alpha = bridge_terrain_mask(im, *at, level, bridge_stencil,
                    pixel_heights=tile_heights[key][i] if has_high_bridges else None,
                    ground_level=c['level'])
                im = im.copy()
                im.putalpha(alpha)
            bodies.paste(0, (*at, at[0]+im.width, at[1]+im.height), alpha)
            object_alpha = bridge_terrain_mask(im, *at, level, object_stencil)
            object_bodies.paste(0, (*at, at[0]+im.width, at[1]+im.height), object_alpha)
            drawn = im if factor == 1 else im.resize((max(1, round(im.width*factor)), max(1, round(im.height*factor))))
            canvas.paste(drawn, (round(at[0]*factor), round(at[1]*factor)), drawn)
            scene_alpha = object_alpha if factor == 1 else object_alpha.resize(drawn.size)
            scene.paste(drawn, (round(at[0]*factor), round(at[1]*factor)), scene_alpha)
        # Match FA2SPHE's bridge ordering: draw the next diagonal cell's bridge
        # before foreground banks/abutments. Drawing at the owner's normal
        # depth makes the end of the SHP float over the adjoining bank.
        sprite_cells = []
        ahead = cells.get((c['x']+1, c['y']+1))
        if ahead and bridge_overlay(ahead):
            sprite_cells.append((ahead, True))
        if not bridge_overlay(c) or (c['x']-1, c['y']-1) not in cells:
            sprite_cells.append((c, True))
        # Both can coexist; an ore overlay must not replace the terrain object.
        sprite_cells.append((c, False))
        for sc, is_overlay in sprite_cells:
            kind = sc['overlayName'] if is_overlay else sc['terrain']
            frame = sprite_frame(sc) if is_overlay else 0
            if not kind:
                continue
            skey = kind, is_overlay, frame
            if skey not in sprites:
                try:
                    raw, pal, offset, spec = sprite_spec(kind, is_overlay, frame, res, theater)
                    cfg = theater['effectiveRules'].get(kind, {})
                    mask, shadow_spec = shadow_frame(raw, frame, cfg, res.art.get(cfg.get('IMAGE', kind).upper(), {}))
                    # High decks sit above the ground receiver. Their artwork
                    # must block ground shadows from neighboring bridge spans,
                    # even when their Overlay rules use the default DrawFlat.
                    solid = (not is_overlay or kind in HIGH_NAMES
                             or any(yes(cfg.get(k, 'no')) for k in ('WALL', 'CRATE', 'ISAROCK'))
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
                if is_overlay and sc.get('bridge') and sc['bridge']['kind'] == 'low':
                    sc['bridge']['emptySprite'] = im.getbbox() is None
                sx = 30*(sc['x']-sc['y'])-minx
                sy = 15*(sc['x']+sc['y']-sc['level'])-miny
                x, y = sx-im.width//2, sy-im.height//2+offset
                if is_overlay and bridge_overlay(sc):
                    mark_bridge_stencil(im, x, y, sc['level'], bridge_stencil,
                                        high=sc['overlayName'] in HIGH_NAMES)
                drawn = im if factor == 1 else im.resize((max(1, round(im.width*factor)), max(1, round(im.height*factor))))
                canvas.paste(drawn, (round(x*factor), round(y*factor)), drawn)
                scene.paste(drawn, (round(x*factor), round(y*factor)), drawn)
                bodies.paste(255 if solid else 0, (x, y, x+im.width, y+im.height), im.getchannel('A'))
                object_bodies.paste(255 if solid else 0, (x, y, x+im.width, y+im.height), im.getchannel('A'))
                if shadow is not None:
                    shadows.append((shadow, x, y, sc['level']))
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
    from map_images import save_layers
    filename, scene_filename = save_layers(canvas, scene, folder, VERSION)
    (folder/'object-audit.json').write_text(json.dumps(object_info, ensure_ascii=False, indent=2), 'utf8')
    object_info.pop('records')
    shadow_info = dict(objects=shadow_count, pixels=shadow_pixels, alpha=SHADOW_ALPHA,
                       source='original paired SHP frames', receiver='same-level ground, clipped by terrain and solid objects')
    (folder/'render-audit.json').write_text(json.dumps(dict(version=VERSION, sprites=audit, fullyHidden=hidden, partiallyHidden=partial, shadows=shadow_info), ensure_ascii=False, indent=2), 'utf8')
    return dict(version=VERSION, width=width, height=height, origin=[-minx, -miny], image=filename, objectImage=scene_filename, objects=object_info, shadows=shadow_info,
                cameraRect=bounds, rasterScale=factor, missingSprites=sorted(missing),
                fullyHidden=hidden, partiallyHidden=partial,
                objectStyle='original sprites below information; unrendered objects have occupancy badges')


def refresh_sprite_issues(meta, rendering):
    """Render upgrades must not retain obsolete missing-art warnings."""
    prefix = '地形物／覆盖物贴图未能绘制：'
    if 'loadIssues' in meta:
        meta['loadIssues'] = [issue for issue in meta['loadIssues']
                              if not issue.get('message', '').startswith(prefix)]
        meta['loadIssues'].extend(dict(message=prefix+kind, count=1, cells=[])
                                 for kind in rendering.get('missingSprites', []))


def refresh_result(path):
    """Legacy entry; new callers import realmap_refresh.refresh_result."""
    from realmap_refresh import refresh_result as refresh
    return refresh(path)


if __name__ == '__main__':
    import sys
    for filename in sys.argv[1:]:
        print(filename, refresh_result(filename), flush=True)
