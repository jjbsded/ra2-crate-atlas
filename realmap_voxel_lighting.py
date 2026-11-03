"""Static RA2/YR normal -> VPL lighting, before the geometry-only DLL pass.

Use native-game diffuse/specular pages after its light and camera transforms.
The bridge's geometry-only pass must not apply the older editor lighting again.
This covers standing voxels, not map tint, local lamps or Phobos overrides.
"""
from functools import lru_cache
import struct

import numpy as np
from realmap_voxel_light_tables import NATIVE_PAGES

MODEL = 'ra2-native-vpl-v2'


def vpl_tables(raw):
    if len(raw) < 784:
        raise ValueError('Invalid voxel lighting palette: truncated VPL')
    count = struct.unpack_from('<I', raw, 8)[0]
    if not 32 <= count <= 256 or len(raw) < 784 + count*256:
        raise ValueError('Invalid voxel lighting palette: missing VPL pages')
    return np.frombuffer(raw, dtype=np.uint8, count=count*256, offset=784).reshape(count, 256)


def identity_vpl(raw):
    """Keep the original header/palette, but disable the DLL's second shading."""
    tables = vpl_tables(raw)
    return raw[:784] + bytes(range(256))*len(tables)


@lru_cache(maxsize=128)
def lighting_pages(mode, facing):
    """facing is the bridge's 0..31 facing, NOT the map's 0..255 direction.

    The native game rotates the elevated world light by the inverse isometric
    camera/unit matrix. A horizontal light rotated by heading alone is wrong.
    The small lookup preserves native fast-trig/sqrt and x87 rounding at VPL
    boundaries. See docs/vehicle-brightness-native.md for reproduction.
    """
    if mode not in NATIVE_PAGES or not isinstance(facing, (int, np.integer)) or not 0 <= facing < 32:
        raise ValueError('Invalid voxel normals mode or facing')
    row = NATIVE_PAGES[mode][facing]
    pages = np.zeros(256, dtype=np.uint8)
    pages[:len(row)] = np.frombuffer(row, dtype=np.uint8)
    # Engine-reserved normals are unshaded, regardless of the facing.
    pages[253:] = 16
    pages.flags.writeable = False
    return pages


def shade_vxl(raw, facing, tables):
    """Shade a private copy; preserve section layout, positions and HVA bytes.

    Span addresses are checked before touching compressed color/normal pairs.
    Original palette index zero remains empty even in a custom VPL. Reset
    consumed normals to zero so the DLL cannot re-light or read reserved normals
    past a short table. The identity VPL then passes the shaded colors through.
    """
    if len(raw) < 802 or not raw.startswith(b'Voxel Animation'):
        raise ValueError('Invalid VXL header')
    sections, tailers, body_size = struct.unpack_from('<3I', raw, 20)
    body = 802 + sections*28
    end = body + body_size
    if not 1 <= sections <= 512 or sections != tailers or end + sections*92 > len(raw):
        raise ValueError('Invalid VXL section bounds')
    result = bytearray(raw)
    visited = {}
    for section in range(sections):
        tail = end + section*92
        start, stop, data = struct.unpack_from('<3I', raw, tail)
        nx, ny, nz, mode = struct.unpack_from('<4B', raw, tail+88)
        columns = nx*ny
        if start + columns*4 > body_size or stop + columns*4 > body_size or data > body_size:
            raise ValueError('Invalid VXL span tables')
        pages = lighting_pages(mode, facing)
        for column in range(columns):
            first = struct.unpack_from('<i', raw, body+start+column*4)[0]
            last = struct.unpack_from('<i', raw, body+stop+column*4)[0]
            if first == -1 and last == -1:
                continue
            if first < 0 or last < first or data+last >= body_size:
                raise ValueError('Invalid VXL span bounds')
            pos, limit, z = body+data+first, body+data+last+1, 0
            while pos < limit:
                if pos+2 > limit:
                    raise ValueError('Truncated VXL span')
                skip, count = raw[pos:pos+2]
                z += skip+count
                pos += 2
                if pos+2*count+1 > limit or z > nz or raw[pos+2*count] != count:
                    raise ValueError('Invalid VXL span run')
                for offset in range(pos, pos+2*count, 2):
                    color, normal = raw[offset:offset+2]
                    shaded = int(tables[pages[normal], color]) if color else 0
                    if offset in visited and visited[offset] != shaded:
                        raise ValueError('Conflicting shared VXL span')
                    visited[offset] = shaded
                    result[offset], result[offset+1] = shaded, 0
                pos += 2*count+1
    return bytes(result)
