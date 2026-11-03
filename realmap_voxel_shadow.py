"""Static RA2/YR section-footprint shadows; body rasterization stays in the DLL.

Project only ShadowIndex (default 0), using the section's bottom face and HVA
transform, 8.8 fixed-point stepping and a two-pixel stamp. This avoids treating
rotors and elevated turret components as independent ground casters.
Algorithm reference: CNCMaps 56712d7, VxlRenderer.DrawShadow (GPLv3).
"""
import math
import struct
import numpy as np
from PIL import Image

MODEL = 'ra2-section-footprint-v1'


def footprint(vxl, hva, facing, offsets=(0,0,0), angle=0, section=0, scale_factor=1.0):
    if section is None or section < 0:
        return None, 0, 0
    if len(vxl) < 802 or not vxl.startswith(b'Voxel Animation'):
        raise ValueError('Invalid shadow VXL header')
    count, tailers, size = struct.unpack_from('<3I', vxl, 20)
    body = 802+count*28
    if not 0 < count <= 512 or count != tailers or body+size+count*92 > len(vxl):
        raise ValueError('Invalid shadow VXL sections')
    # Invalid custom indices must never select an unrelated rotor/section.
    if section >= count:
        return None, 0, 0
    tail = body+size+section*92
    start,stop,data,multiplier = struct.unpack_from('<3If', vxl, tail)
    bounds = np.array(struct.unpack_from('<6f', vxl, tail+64), dtype=np.float32).reshape(2,3)
    nx,ny,nz,_ = struct.unpack_from('<4B', vxl, tail+88)
    if not nx*ny*nz or not np.isfinite(bounds).all() or np.any(bounds[1] < bounds[0]):
        raise ValueError('Invalid shadow VXL dimensions')
    if max(start,stop)+nx*ny*4 > size or data > size:
        raise ValueError('Invalid shadow VXL span tables')
    first = np.frombuffer(vxl, dtype='<i4', count=nx*ny, offset=body+start)
    last = np.frombuffer(vxl, dtype='<i4', count=nx*ny, offset=body+stop)
    occupied = (first >= 0) & (last >= first)
    if np.any((first == -1) != (last == -1)) or np.any(last[occupied]+data >= size):
        raise ValueError('Invalid shadow VXL span bounds')
    columns = np.flatnonzero(occupied)
    if not len(columns):
        return None, 0, 0
    if len(hva) < 24:
        raise ValueError('Invalid shadow HVA header')
    frames,sections = struct.unpack_from('<2I', hva, 16)
    if not frames or sections != count or 24+sections*16+sections*48 > len(hva):
        raise ValueError('Invalid shadow HVA sections')
    matrix = np.array(struct.unpack_from('<12f', hva, 24+sections*16+section*48), dtype=np.float32).reshape(3,4)
    if not np.isfinite(matrix).all() or not math.isfinite(multiplier):
        raise ValueError('Invalid shadow transform')
    scale = (bounds[1]-bounds[0])/np.array([nx,ny,nz], dtype=np.float32)
    translation = matrix[:,3]*scale*multiplier
    span = bounds[1]-bounds[0]
    corners = np.array([[0,0,0],[span[0],0,0],[0,span[1],0],[span[0],span[1],0]], dtype=np.float32)
    points = (corners+bounds[0]) @ matrix[:,:3].T + translation
    points += np.asarray(offsets, dtype=np.float32)*(30*math.sqrt(2)/256)
    # Vanilla ConsideredAircraft uses a half-size shadow, including on landing.
    if scale_factor not in (0.5, 1.0):
        raise ValueError('Unsupported voxel shadow scale')
    points *= scale_factor
    # Barrel elevation uses the same 0..64 quarter-turn units as the bridge.
    fire = angle*math.pi/128
    c,s = math.cos(fire),math.sin(fire)
    px,py,pz = points.T
    px,pz = c*px+s*pz, -s*px+c*pz
    theta = math.pi/4-((facing+8)%32)*math.tau/32
    c,s = math.cos(theta),math.sin(theta)
    screen = np.stack((c*px-s*py+3, -.5*(s*px+c*py)-math.sqrt(3)/2*pz), axis=1).astype(np.float32)
    center = (screen.min(axis=0)+screen.max(axis=0))*.5
    base = np.trunc((screen[0]+128-center)*256).astype(np.int64)
    steps = np.trunc(np.stack(((screen[1]-screen[0])/nx,(screen[2]-screen[0])/ny))*256).astype(np.int64)
    xy = np.stack((columns%nx,columns//nx),axis=1)
    pixels = ((base+xy@steps) & 65535)//256-128+np.trunc(center).astype(np.int64)
    lo,hi = pixels.min(axis=0),pixels.max(axis=0)+[2,1]
    if np.any(hi-lo > 2048):
        raise ValueError('Shadow footprint exceeds bounds')
    mask = np.zeros((int(hi[1]-lo[1]),int(hi[0]-lo[0])), dtype=np.uint8)
    xx,yy = (pixels-lo).T
    mask[yy,xx] = mask[yy,xx+1] = 128
    return Image.fromarray(mask),int(lo[0]),int(lo[1])
