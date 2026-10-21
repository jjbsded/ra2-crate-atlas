"""Bounded, read-only terrain patches for the local 3D inspector.

The result remains authoritative for gameplay. Meshes reconstruct the original
2D TMP artwork; they are not engine collision geometry or a new pathfinder.
"""
import base64
import io
import threading

import runtime_bootstrap
import numpy as np
from PIL import Image

from runtime_bootstrap import ROOT
from realmap_parser import CLIFF
from realmap_format import sha, yes
from realmap_sprites import tile_parts, shp_frame, palette, sprite_spec
from map_results import result_path, load_report, resource_context
from realmap_bridges import HIGH_NAMES, sprite_frame
from terrain_depth import relief_mesh

LOCK = threading.Lock()
VERSION = 5
# Top/right/bottom/left height deltas, as documented by FA2SPHE's RampTypes.
# These are visual vertex offsets only; Cell.Level still drives the cliff test.
RAMPS = [(0,0,0,0), (0,1,1,0), (0,0,1,1), (1,0,0,1), (1,1,0,0),
         (0,0,1,0), (0,0,0,1), (1,0,0,0), (0,1,0,0), (0,1,1,1),
         (1,0,1,1), (1,1,0,1), (1,1,1,0), (0,1,2,1), (1,0,1,2),
         (2,1,0,1), (1,2,1,0), (0,1,0,1), (1,0,1,0), (0,1,0,1), (1,0,1,0)]


def data_url(image):
    buf = io.BytesIO()
    image.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode('ascii')


def corner_heights(slope):
    return RAMPS[slope] if 0 <= slope < len(RAMPS) else RAMPS[0]


def surface_height(corners, u, v):
    # Bilinear visual reconstruction also handles twisted ramp vertices.
    a,b,c,d = corners
    return a*(1-u)*(1-v)+b*u*(1-v)+c*u*v+d*(1-u)*v


def composite(parts):
    left = min(x for im,x,y in parts); top = min(y for im,x,y in parts)
    right = max(x+im.width for im,x,y in parts); bottom = max(y+im.height for im,x,y in parts)
    image = Image.new('RGBA', (right-left, bottom-top))
    for im,x,y in parts:
        image.alpha_composite(im, (x-left,y-top))
    return image,left,top


def sample_filled(image, px, py):
    """Nearest original texel, extending only transparent edges; no color noise."""
    arr = np.asarray(image)
    xx = np.clip(np.floor(px).astype(int),0,image.width-1)
    yy = np.clip(np.floor(py).astype(int),0,image.height-1)
    out = arr[yy,xx].copy()
    invalid = out[:,:,3] == 0
    ys,xs = np.nonzero(arr[:,:,3])
    if len(xs) and invalid.any():
        qx, qy = px[invalid], py[invalid]
        distance = np.full(len(qx), np.inf)
        nearest_x = np.zeros(len(qx), dtype=int); nearest_y = nearest_x.copy()
        # Within one scanline the nearest opaque texel must be immediately
        # left/right of the sample. Search all samples together, then minimize
        # over scanlines, instead of comparing every sample to EVERY texel.
        # Left-first ties and strict '<' retain the original row-major argmin.
        for row in np.unique(ys):
            columns = xs[ys == row]
            index = np.searchsorted(columns, qx)
            left = columns[np.maximum(index-1, 0)]
            right = columns[np.minimum(index, len(columns)-1)]
            dx_left, dx_right = (left-qx)**2, (right-qx)**2
            choose_left = dx_left <= dx_right
            squared = np.where(choose_left, dx_left, dx_right)+(row-qy)**2
            closer = squared < distance
            distance[closer] = squared[closer]
            nearest_x[closer] = np.where(choose_left, left, right)[closer]
            nearest_y[closer] = row
        out[invalid] = arr[nearest_y, nearest_x]
    return Image.fromarray(out)


def top_texture(parts, corners):
    im,x,y = composite(parts)
    v,u = np.mgrid[0:64,0:64]/64+1/128
    h = surface_height(corners,u,v)
    return sample_filled(im,30+30*(u-v)-x,15*(u+v)-15*h-y)


def wall_texture(parts):
    # Keep each TMP sub-block's own rock/snow/shore artwork. Transparent pixels
    # are edge-extended instead of substituting one repeated global cliff tile.
    im,_,_ = composite(parts[1:])
    v,u = np.mgrid[0:96,0:64]
    return sample_filled(im,(u+.5)*im.width/64,(v+.5)*im.height/96)


def face_texture(c,n,edge,source,parts):
    """Unproject the face from its actual artwork, often owned by the LOW cell.

    Cliff multi-block TMPs split caps and vertical art into different cells.
    Sampling only the high cell would stretch its snowy cap over the whole wall.
    """
    corners=((0,0),(1,0),(1,1),(0,1));dx,dy=n['x']-c['x'],n['y']-c['y']
    a,b=corners[edge],corners[(edge+1)%4]
    t,s=np.mgrid[0:96,0:64];s=(s+.5)/64;t=(t+.5)/96
    u=a[0]+(b[0]-a[0])*s;v=a[1]+(b[1]-a[1])*s
    high=c['level']+surface_height(corner_heights(c['slope']),u,v)
    low=n['level']+surface_height(corner_heights(n['slope']),u-dx,v-dy)
    level=high*(1-t)+np.minimum(low,high)*t
    u+=c['x']-source['x'];v+=c['y']-source['y']
    im,left,top=composite(parts)
    return sample_filled(im,30+30*(u-v)-left,15*(u+v)-15*(level-source['level'])-top)


def relation_data(c, lookup, enabled):
    if not enabled:
        return [],[]
    x,y = c['x'],c['y']
    higher = [[d['x'],d['y'],d['level']] for dx,dy in CLIFF
              if (d:=lookup.get((x+dx,y+dy))) and d['level'] >= c['level']+4]
    affected = [[d['x'],d['y'],d['level']] for dx,dy in CLIFF
                if (d:=lookup.get((x-dx,y-dy))) and c['level'] >= d['level']+4]
    return higher,affected


def bridge_kind(name):
    if name in HIGH_NAMES:
        return 'high'
    if (name or '').startswith(('LOBRDG', 'LOBRDB')):
        return 'low'
    return None


def overlay_pixels(image, offset, source, target, level, corners):
    """Unproject a sprite into a target cell, retaining its original world anchor.

    Target may be a neighbor of source. Transparent frames never acquire pixels
    by edge extension, unlike opaque terrain texture reconstruction.
    """
    v,u = np.mgrid[0:64,0:64]/64+1/128
    dx,dy = target['x']-source['x'],target['y']-source['y']
    h = level-source['level']+surface_height(corners,u,v)
    px = np.floor(image.width//2+30*(dx-dy+u-v)).astype(int)
    py = np.floor(image.height//2-offset+15*(dx+dy+u+v-1-h)).astype(int)
    pixels = np.zeros((64,64,4), dtype=np.uint8)
    valid = (px>=0)&(px<image.width)&(py>=0)&(py<image.height)
    pixels[valid] = np.asarray(image)[py[valid],px[valid]]
    return pixels


def add_bridge_layers(records, lookup, res, theater, put_texture, missing):
    """Split original cross-cell bridge art across world-fixed surface meshes.

    Search the full report, including owners outside the requested patch. Actual
    SHP bounds determine intersections, rather than assuming a one-cell sprite.
    High deck art is sampled at its +4 level, leaving ground/water underneath.
    """
    region = {(c['x'],c['y']):c for c in records}
    xmin,ymin = min(p[0] for p in region),min(p[1] for p in region)
    xmax,ymax = max(p[0] for p in region),max(p[1] for p in region)
    sprites,sprite_errors,layers = {},{},{}
    sources = (c for c in lookup.values() if bridge_kind(c.get('overlayName')))
    for source in sorted(sources, key=lambda c:(c['x']+c['y'],c['x'])):
        name = source.get('overlayName'); kind = bridge_kind(name)
        if not kind: continue
        frame = sprite_frame(source); key = name,frame
        if key not in sprites:
            try:
                raw,pal,offset,_ = sprite_spec(name,True,frame,res,theater)
                sprites[key] = shp_frame(raw,frame,pal),offset
            except (ValueError,IndexError,KeyError,OSError) as error:
                sprites[key] = None
                sprite_errors[key] = str(error)
        if sprites[key] is None:
            if xmin-4<=source['x']<=xmax+4 and ymin-4<=source['y']<=ymax+4:
                missing.add(f'{name}/{frame}：{sprite_errors[key]}')
            continue
        image,offset = sprites[key]; bbox = image.getbbox()
        if not bbox: continue
        deck = 4 if kind=='high' else 0
        level = source['level']+deck
        cross = (('x',source['x']) if name.endswith('2') else ('y',source['y'])) if kind=='high' else None
        # Inverse the original isometric projection at the bridge's own level.
        xs = [(p-image.width//2)/60 for p in (bbox[0],bbox[2])]
        ys = [(p+offset-image.height//2+15*deck)/30 for p in (bbox[1],bbox[3])]
        left = max(xmin, int(np.floor(source['x']+min(xs)+min(ys)+.5)))
        right = min(xmax, int(np.floor(source['x']+max(xs)+max(ys)+.5)))
        top = max(ymin, int(np.floor(source['y']-max(xs)+min(ys)+.5)))
        bottom = min(ymax, int(np.floor(source['y']-min(xs)+max(ys)+.5)))
        for cy in range(top,bottom+1):
            for cx in range(left,right+1):
                c = region.get((cx,cy))
                if not c: continue
                if kind=='high':
                    # Engine deck flags cover movement cells, not the SHP's
                    # complete silhouette. Rail pixels extend beyond them.
                    # Keep the full original footprint at its owner's deck
                    # height, while higher terrain still hides that surface.
                    if c['level']>level: continue
                    corners = RAMPS[0]
                else:
                    if c['level']!=level: continue
                    corners = c['corners']
                pixels = overlay_pixels(image,offset,source,c,level,corners)
                visible = pixels[:,:,3]!=0
                if not visible.any(): continue
                layer = layers.setdefault((cx,cy,kind,level,cross),
                    dict(pixels=np.zeros((64,64,4),dtype=np.uint8),sources=[]))
                layer['pixels'][visible] = pixels[visible]
                layer['sources'].append(dict(x=source['x'],y=source['y'],name=name,frame=frame))
    for (cx,cy,kind,level,cross),layer in layers.items():
        region[cx,cy]['decorations'].append(dict(
            texture=put_texture(Image.fromarray(layer['pixels'])),flat=True,
            bridge=kind,level=level,sources=layer['sources'],
            **(dict(span=dict(axis=cross[0],origin=cross[1],minimum=-2,maximum=2)) if cross else {})))


def build_patch(report, lookup, path, x, y, radius):
    if (x,y) not in lookup:
        raise ValueError('选中的格子不在地图内')
    meta = report['metadata']; enabled = not meta.get('previewOnly') and not meta.get('approximate') and meta.get('cliffBackImpassability') == 2
    nearby = [c for (cx,cy),c in lookup.items() if abs(cx-x)<=radius and abs(cy-y)<=radius]
    res,theater = resource_context(report,path)
    colors = palette(theater['palette'])
    textures,tiles,raws,sprites,missing,parts_cache = {},{},{},{},set(),{}
    reliefs = {}
    def put_texture(image):
        url = data_url(image); ident = sha(url.encode())[:16]
        textures[ident] = url
        return ident
    records = []
    for c in nearby:
        name,sub = c['file'],c['subTile']; key = (name,sub)
        if key not in tiles:
            try:
                if c.get('terrainError'):
                    raise ValueError(c['terrainError'])
                if name not in raws: raws[name] = res.get(theater['tilemix'],name)
                parts = tile_parts(raws[name],sub,colors)
                parts_cache[key]=parts
                corners = corner_heights(c['slope'])
                # Flat cliff extensions belong to vertical faces; ramp extensions
                # are part of the sloping surface, not a vertical wall texture.
                tiles[key] = dict(top=put_texture(top_texture(parts if c['slope'] else parts[:1],corners)),
                                  wall=put_texture(wall_texture(parts)) if len(parts)>1 and not c['slope'] else None)
                if not c['slope'] and len(parts)>1:
                    detail=relief_mesh(raws[name],sub,parts)
                    if detail:
                        mesh,image=detail
                        ident=f'{name}/{sub}'
                        reliefs[ident]=dict(mesh,texture=put_texture(image))
                        tiles[key]['relief']=ident
            except (ValueError,IndexError,KeyError,OSError) as error:
                missing.add(f'{name}/{sub}：{error}');tiles[key] = dict(top=None,wall=None)
        higher,affected = relation_data(c,lookup,enabled)
        records.append({k:c.get(k) for k in ('x','y','level','slope','rawLand','land','postLand','marked',
                        'potentialMarked','status','probability','overlay','occupied','usable','terrain','overlayName','primary','clearance','bridge')}
                       | dict(file=name,subTile=sub,texture=tiles[key]['top'],wallTexture=tiles[key]['wall'],relief=tiles[key].get('relief'),
                              corners=corner_heights(c['slope']),higher=higher,affected=affected,
                              walls=[None]*4,canPlace=bool(enabled and c.get('status')=='crate' and c.get('probability',0)
                                            and c['overlay']==255 and not c['occupied']),decorations=[]))
        out = records[-1]
        for kind,is_overlay,frame in ((c.get('terrain'),False,0),(c.get('overlayName'),True,c.get('overlayData',0))):
            if not kind: continue
            # Bridge art is distributed across neighboring cells below, with
            # a separate elevated surface for high bridges.
            if is_overlay and bridge_kind(kind):
                continue
            skey = (kind,is_overlay,frame,c['slope'])
            if skey not in sprites:
                try:
                    raw,pal,offset,spec = sprite_spec(kind,is_overlay,frame,res,theater)
                    im = shp_frame(raw,frame,pal)
                    cfg = theater['effectiveRules'].get(kind,{})
                    flat = is_overlay and yes(cfg.get('DRAWFLAT','yes')) and not any(yes(cfg.get(k,'no')) for k in ('WALL','CRATE','ISAROCK'))
                    if flat:
                        # Place mineral/flat overlays in the same original pixel
                        # coordinates before unprojecting onto the slope.
                        # Unlike opaque TMP surfaces, sprite transparency remains.
                        pixels = overlay_pixels(im,offset,c,c,c['level'],corner_heights(c['slope']))
                        sprite=dict(texture=put_texture(Image.fromarray(pixels)),flat=True)
                    else:
                        bbox=im.getbbox()
                        if not bbox: sprites[skey]=None;continue
                        cropped=im.crop(bbox)
                        sprite=dict(texture=put_texture(cropped),flat=False,width=cropped.width,height=cropped.height,
                                    offset=[bbox[0]+cropped.width/2-im.width/2, bbox[1]+cropped.height/2-im.height/2+offset])
                    sprites[skey]=sprite
                except (ValueError,IndexError,KeyError,OSError) as error:
                    missing.add(f'{kind}：{error}');sprites[skey]=None
            if sprites[skey]: out['decorations'].append(dict(sprites[skey],name=kind))
    add_bridge_layers(records,lookup,res,theater,put_texture,missing)
    # A reconstructed edge without its own artwork can borrow the nearest real
    # cliff sub-block locally, never a hardcoded snow texture across theaters.
    walls=[c for c in records if c['wallTexture']]
    # Occluded faces have no complete painted image. Fill them with a nearby
    # full-height rock image, not an edge-extended cap (which creates streaks).
    tall_walls=[c for c in walls if c.get('relief') and
                parts_cache[(c['file'],c['subTile'])][-1][0].height>=40]
    for c in records:
        if not c['wallTexture'] and walls:
            nearest=min(walls,key=lambda w:(w['x']-c['x'])**2+(w['y']-c['y'])**2)
            if max(abs(nearest['x']-c['x']),abs(nearest['y']-c['y']))<=3:
                c['wallTexture']=nearest['wallTexture']
        if tall_walls:
            nearest=min(tall_walls,key=lambda w:(w['x']-c['x'])**2+(w['y']-c['y'])**2)
            if max(abs(nearest['x']-c['x']),abs(nearest['y']-c['y']))<=3:
                c['wallFillTexture']=nearest['wallTexture']
    region={(c['x'],c['y']):c for c in records}
    corners=((0,0),(1,0),(1,1),(0,1))
    for c in records:
        for edge,(dx,dy) in enumerate(((0,-1),(1,0),(0,1),(-1,0))):
            n=region.get((c['x']+dx,c['y']+dy))
            if not n:continue
            a,b=corners[edge],corners[(edge+1)%4]
            differences=[c['level']+surface_height(c['corners'],u,v)-n['level']-surface_height(n['corners'],u-dx,v-dy) for u,v in (a,b)]
            if max(differences)<=0:continue
            for source in (n,c):
                parts=parts_cache.get((source['file'],source['subTile']))
                if parts and len(parts)>1 and not source['slope']:
                    c['walls'][edge]=put_texture(face_texture(c,n,edge,source,parts));break
    return dict(version=VERSION,center=[x,y],radius=radius,cells=records,textures=textures,reliefs=reliefs,
                bounds=[min(c['x'] for c in records),min(c['y'] for c in records),max(c['x'] for c in records),max(c['y'] for c in records)],
                metadata=dict(filename=meta.get('filename','地图'),theater=meta['theater'],version=meta['version'],
                              sourceSha256=meta['sourceSha256'],predictionEnabled=enabled,previewOnly=bool(meta.get('previewOnly')),
                              partialAnalysis=bool(meta.get('partialAnalysis')), approximate=bool(meta.get('approximate')),
                              mineralsEnabled=meta.get('mineralsEnabled',True),
                              cliffBackImpassability=meta.get('cliffBackImpassability'),uniqueTiles=len(tiles),missing=sorted(missing),
                              bridgeNote=('高桥按桥面高度显示原始贴图，桥下地形保留；禁行标记与放箱预览仍对应地面层。桥墩、栏杆未重建为立体模型。'
                                          if any(c.get('bridge') and c['bridge']['kind']=='high' for c in nearby)
                                          else '低桥按相邻桥段的原始贴图跨格拼接，栏杆未重建为立体模型。'
                                          if any(d.get('bridge') for c in records for d in c['decorations']) else '')))


def patch(value,x,y,radius=10):
    if type(x) is not int or type(y) is not int or not 1<=x<=511 or not 1<=y<=511:
        raise ValueError('3D 中心坐标必须是 1～511 的整数')
    if type(radius) is not int or radius not in (4,6,8,10,15):
        raise ValueError('3D 范围只支持 9×9、13×13、17×17、21×21 或 31×31 格')
    path=result_path(value)
    # Serialize resource access; reports are reused without touching probability.
    with LOCK:
        report,lookup=load_report(path)
        return build_patch(report,lookup,path,x,y,radius)
