"""Visual TMP relief meshes; never used for gameplay heights or collision.

TMP Z bytes describe painted-pixel ordering, not an original solid model.
Treat them as planar depth to unproject the artwork from the game camera.
This preserves its silhouette and supplies a useful, approximate rock relief.
"""
import base64
import struct

import numpy as np
from PIL import Image


def tile_depths(raw, sub, parts):
    """Original per-pixel TMP Z values, aligned with tile_parts (or None).

    Validate optional depth independently of color data: a custom tile can still
    be drawn when its Z payload is absent or corrupt. Transparent pixels have no
    depth and must never create protection outside the painted silhouette.
    """
    result = [None] * len(parts)
    try:
        offset, = struct.unpack_from('<I', raw, 16+sub*4)
        _, _, _, zoff, ezoff, _, _, ew, eh, flags = struct.unpack_from('<10i', raw, offset)
        if not flags & 2:
            return result
        if zoff >= 52 and offset+zoff+900 <= len(raw):
            base = np.zeros((30, 60), dtype=np.int16)
            values = np.frombuffer(raw, dtype=np.uint8, count=900, offset=offset+zoff)
            at = 0
            for y in range(30):
                width = 4*(y+1 if y < 15 else 29-y)
                base[y, (60-width)//2:(60+width)//2] = values[at:at+width]
                at += width
            result[0] = base
        if (flags & 1 and len(parts) == 2 and parts[1][0].size == (ew, eh)
                and ezoff >= 52 and offset+ezoff+ew*eh <= len(raw)):
            result[1] = np.frombuffer(raw, dtype=np.uint8, count=ew*eh,
                                      offset=offset+ezoff).reshape(eh, ew).astype(np.int16)
        for i, (im, _, _) in enumerate(parts):
            z = result[i]
            if z is not None and (z.shape != (im.height, im.width) or
                    np.any(z[np.asarray(im.getchannel('A')) != 0] > 60)):
                result[i] = None
    except (ValueError, IndexError, struct.error):
        return [None] * len(parts)
    return result


def tile_pixel_heights(raw, sub, parts):
    """Height above the tile's saved level, in 1/15-level units.

    Flat pixels have Z=29-row. Extra pixels use their signed image offset, so
    a pier's road, parapet and descending face no longer share one height.
    These heights affect artwork only, never cell heights or passability.
    """
    return [None if z is None else 29-z-(np.arange(im.height, dtype=np.int16)[:, None]+dy)
            for z, (im, _, dy) in zip(tile_depths(raw, sub, parts), parts)]


def tile_surfaces(raw, sub):
    """Flat planes declared by the TMP's sub-block positions and heights.

    Z bytes are clipped to each block's sorting footprint. Header planes let
    artwork extending past that footprint return to its actual flat cap rather
    than turning a clipped sorting coordinate into a raised triangular fin.
    """
    try:
        width, height, tw, th = struct.unpack_from('<4I', raw)
        if not (0 < width <= 64 and 0 < height <= 64 and (tw, th) == (60, 30)
                and 0 <= sub < width*height and 16+width*height*4 <= len(raw)):
            return None
        planes = {}; anchor = None
        for i in range(width*height):
            offset, = struct.unpack_from('<I', raw, 16+i*4)
            if not offset:
                continue
            if offset+52 > len(raw):
                return None
            # Mixed ramp stamps need their actual corner surfaces rather than
            # a set of horizontal planes; retain depth relief for those files.
            if raw[offset+42]:
                return None
            x,y = struct.unpack_from('<2i', raw, offset)
            if x % 30 or y % 15 or (x//30+y//15) % 2:
                return None
            p = ((x//30+y//15)//2, (y//15-x//30)//2)
            level = raw[offset+40]
            if p in planes and planes[p] != level:
                return None
            planes[p] = level
            if i == sub:
                anchor = (*p, level)
        if anchor is None:
            return None
        ax,ay,az = anchor
        return {(x-ax,y-ay):z-az for (x,y),z in planes.items()}
    except (ValueError, IndexError, struct.error):
        return None


def fit_relief_surfaces(u, h, v, planes):
    """Fit visible flat caps along the game-camera ray; keep wall relief.

    Moving along that ray preserves every original projected pixel. Lower
    ground behind a vertical face cannot flatten the face. Only a visible cap
    in front, or an impossible height above the TMP's highest plane, corrects
    the sort-derived mesh. Gameplay levels never enter or leave this function.
    """
    if not planes:
        return u,h,v
    q,d = u+v-h,u-v
    target = h.copy()
    ceiling = max(planes.values())
    # Half a projected pixel accounts for shared pixel-corner centering.
    target = np.minimum(target, ceiling+1/30)
    for level in sorted(set(planes.values())):
        pu,pv = (q+level+d)/2,(q+level-d)/2
        hit = np.zeros(len(u), dtype=bool)
        for eps in (-1e-6,1e-6):
            gx,gy = np.floor(pu+eps).astype(int),np.floor(pv+eps).astype(int)
            hit |= np.fromiter((planes.get((x,y)) == level for x,y in zip(gx.tolist(),gy.tolist())),
                               dtype=bool,count=len(u))
        target[hit & (level >= target)] = level
    s = q+target
    return (s+d)/2,target,(s-d)/2


def relief_mesh(raw, sub, parts):
    """Return a shared local mesh and its original RGBA texture, or no mesh.

    Only extended, flat cliff art is passed here by the caller. Missing depth
    data falls back to the regular terrain surface instead of inventing relief.
    """
    offset, = struct.unpack_from('<I', raw, 16+sub*4)
    xx,yy,extra,zoff,ezoff,ex,ey,ew,eh,flags = struct.unpack_from('<10i',raw,offset)
    if flags & 3 != 3 or len(parts) != 2:
        return None
    depths = tile_depths(raw, sub, parts)
    if any(z is None for z in depths):
        return None
    left=min(0,ex-xx);top=min(0,ey-yy)
    right=max(60,ex-xx+ew);bottom=max(30,ey-yy+eh)
    # Bound both memory and triangle count for malformed/custom TMPs.
    if not 0 < ew <= 256 or not 0 < eh <= 256 or (right-left)*(bottom-top)>32768:
        return None
    depth=np.full((bottom-top,right-left),np.nan,dtype=np.float32)
    image=Image.new('RGBA',(right-left,bottom-top))
    for (im,x,y),z in zip(parts,depths):
        image.alpha_composite(im,(x-left,y-top))
        opaque=np.asarray(im)[:,:,3]!=0
        region=depth[y-top:y-top+im.height,x-left:x-left+im.width]
        region[opaque]=z[opaque]
    opaque=np.asarray(image)[:,:,3]!=0
    if not opaque.any() or not np.isfinite(depth[opaque]).all() or np.any(depth[opaque]>60):
        return None
    # Pixel corners share averaged depths. Each painted pixel retains its own
    # two triangles, including the one-pixel rock tips and irregular silhouette.
    h,w=depth.shape
    total=np.zeros((h+1,w+1),dtype=np.float32)
    count=np.zeros((h+1,w+1),dtype=np.float32)
    safe=np.where(opaque,depth,0)
    for dy,dx in ((0,0),(1,0),(0,1),(1,1)):
        total[dy:dy+h,dx:dx+w]+=safe
        count[dy:dy+h,dx:dx+w]+=opaque
    valid=count>0
    z=total[valid]/count[valid]
    cy,cx=np.nonzero(valid)
    # Flat TMP pixels carry Z=29-row. Half-pixel centering gives exactly zero
    # relief inside a flat diamond; original projected X/Y stay unchanged.
    s=(29.5-z)/15
    d=(cx+left-30)/30
    u,alt,v = fit_relief_surfaces((s+d)/2,(15*s-cy-top)/15,(s-d)/2,tile_surfaces(raw,sub))
    vertices=np.column_stack((u,alt,v,cx/w,1-cy/h)).astype('<f4')
    ids=np.full((h+1,w+1),-1,dtype=np.int32)
    ids[valid]=np.arange(len(vertices))
    py,px=np.nonzero(opaque)
    a=ids[py,px];b=ids[py,px+1];c=ids[py+1,px];d=ids[py+1,px+1]
    indices=np.column_stack((a,c,b,b,c,d)).astype('<u4')
    return dict(vertices=base64.b64encode(vertices.tobytes()).decode('ascii'),
                indices=base64.b64encode(indices.tobytes()).decode('ascii'),
                vertexCount=len(vertices),triangles=int(opaque.sum()*2)),image
