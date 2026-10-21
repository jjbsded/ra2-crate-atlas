"""Visual TMP relief meshes; never used for gameplay heights or collision.

TMP Z bytes describe painted-pixel ordering, not an original solid model.
Treat them as planar depth to unproject the artwork from the game camera.
This preserves its silhouette and supplies a useful, approximate rock relief.
"""
import base64
import struct

import numpy as np
from PIL import Image


def relief_mesh(raw, sub, parts):
    """Return a shared local mesh and its original RGBA texture, or no mesh.

    Only extended, flat cliff art is passed here by the caller. Missing depth
    data falls back to the regular terrain surface instead of inventing relief.
    """
    offset, = struct.unpack_from('<I', raw, 16+sub*4)
    xx,yy,extra,zoff,ezoff,ex,ey,ew,eh,flags = struct.unpack_from('<10i',raw,offset)
    if flags & 3 != 3 or len(parts) != 2:
        return None
    if zoff < 52 or ezoff < 52 or offset+zoff+900 > len(raw) or offset+ezoff+ew*eh > len(raw):
        return None
    left=min(0,ex-xx);top=min(0,ey-yy)
    right=max(60,ex-xx+ew);bottom=max(30,ey-yy+eh)
    # Bound both memory and triangle count for malformed/custom TMPs.
    if not 0 < ew <= 256 or not 0 < eh <= 256 or (right-left)*(bottom-top)>32768:
        return None
    depth=np.full((bottom-top,right-left),np.nan,dtype=np.float32)
    image=Image.new('RGBA',(right-left,bottom-top))
    base=np.full((30,60),np.nan,dtype=np.float32)
    values=np.frombuffer(raw,dtype=np.uint8,count=900,offset=offset+zoff)
    at=0
    for y in range(30):
        width=4*(y+1 if y<15 else 29-y)
        base[y,(60-width)//2:(60+width)//2]=values[at:at+width]
        at+=width
    extra_depth=np.frombuffer(raw,dtype=np.uint8,count=ew*eh,offset=offset+ezoff).reshape(eh,ew)
    for (im,x,y),z in zip(parts,(base,extra_depth)):
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
    vertices=np.column_stack(((s+d)/2,(15*s-cy-top)/15,(s-d)/2,cx/w,1-cy/h)).astype('<f4')
    ids=np.full((h+1,w+1),-1,dtype=np.int32)
    ids[valid]=np.arange(len(vertices))
    py,px=np.nonzero(opaque)
    a=ids[py,px];b=ids[py,px+1];c=ids[py+1,px];d=ids[py+1,px+1]
    indices=np.column_stack((a,c,b,b,c,d)).astype('<u4')
    return dict(vertices=base64.b64encode(vertices.tobytes()).decode('ascii'),
                indices=base64.b64encode(indices.tobytes()).decode('ascii'),
                vertexCount=len(vertices),triangles=int(opaque.sum()*2)),image
