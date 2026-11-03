"""Visual TMP variants, independent of the map's gameplay tile/subtile IDs.

RA2/YR uses a small coordinate lattice to select the letter-suffixed TMPs.
The 8x8 lattice is randomized by the game per session. Ours is fixed, balanced
and adjacency-constrained so reopening/exporting a map never changes its art.
See docs/terrain-shadows.md for sources and the deliberately excluded states.
"""
import struct

PATTERN4 = (0,1,2,3, 3,2,1,0, 2,3,0,1, 1,0,3,2)
LATTICE8 = (4,0,1,3,1,0,3,7, 2,5,7,4,5,4,5,6,
            7,3,1,2,6,7,2,4, 6,5,0,7,5,3,6,5,
            1,2,6,2,1,7,2,0, 3,7,4,3,0,4,3,7,
            5,0,2,6,1,2,1,0, 1,3,4,0,5,6,4,6)


def variant_index(x, y, count, width=1, height=1, sub=0):
    # Use the same origin for every subtile, including subtile zero.
    x = int((x-sub % width)/width)
    y = int((y-sub//width)/height)
    return (LATTICE8[(x & 7)+(y & 7)*8] if count > 4 else
            PATTERN4[(x & 3)+(y & 3)*4]) % count


def geometry(raw):
    """A variant may change colors, never ownership, slopes, depth or damage."""
    w,h,tw,th = struct.unpack_from('<4I', raw)
    if not 0 < w*h <= 4096 or (tw,th) != (60,30):
        raise ValueError('Invalid TMP variant dimensions')
    shape = [w,h,tw,th]
    for sub in range(w*h):
        pos, = struct.unpack_from('<I', raw, 16+sub*4)
        if pos == 0:
            shape.append(None); continue
        xx,yy,_,_,_,ex,ey,ew,eh,flags = struct.unpack_from('<10i', raw, pos)
        if flags & 4:
            raise ValueError('Damaged TMP data is not a random variant')
        if pos+952 > len(raw):
            raise ValueError('Truncated TMP variant')
        base = bytes(bool(v) for v in raw[pos+52:pos+952])
        z = raw[pos+952:pos+1852] if flags & 2 else b''
        extra = extra_z = b''
        if flags & 1:
            if not 0 < ew <= 1024 or not 0 < eh <= 1024:
                raise ValueError('Invalid TMP extra bounds')
            p = pos+952+(900 if flags & 2 else 0)
            if p+ew*eh > len(raw):
                raise ValueError('Truncated TMP extra pixels')
            extra = bytes(bool(v) for v in raw[p:p+ew*eh])
            extra_z = raw[p+ew*eh:p+2*ew*eh] if flags & 2 else b''
        shape.append((xx,yy,ex,ey,ew,eh,flags,raw[pos+40:pos+43],base,z,extra,extra_z))
    return tuple(shape)


class TerrainVariants:
    def __init__(self, res, theater, raws=None):
        self.res, self.theater = res, theater
        self.raws = raws if raws is not None else {}
        self.definitions = {}
        general = theater.get('config', {}).get('GENERAL', {})
        excluded = {str(general.get(k,'')) for k in ('BRIDGESET','TRAINBRIDGESET','WOODBRIDGESET')}
        self.bridges = {name for key,name,_ in theater.get('definitions', [])
                        if str(int(key[7:])) in excluded}

    def choices(self, name):
        if name in self.definitions:
            return self.definitions[name]
        if name not in self.raws:
            self.raws[name] = self.res.get(self.theater['tilemix'], name)
        base = self.raws[name]
        w,h = struct.unpack_from('<2I', base)
        names = [name]
        try:
            shape = geometry(base)
        except (ValueError, struct.error):
            shape = None
        if shape is not None and name not in self.bridges:
            stem,ext = name.rsplit('.',1)
            for letter in 'abcdefghijklmnopqrstuvwxyz':
                candidate = stem+letter+'.'+ext
                try:
                    raw = self.res.get(self.theater['tilemix'], candidate)
                except ValueError:
                    break
                try:
                    if geometry(raw) != shape:
                        break
                except (ValueError, struct.error):
                    break
                names.append(candidate)
                self.raws[candidate] = raw
        self.definitions[name] = [w,h,names]
        return self.definitions[name]

    def file(self, cell):
        name = cell['file']
        if cell.get('terrainError'):
            return name
        w,h,names = self.choices(name)
        return names[variant_index(cell['x'],cell['y'],len(names),w,h,cell['subTile'])]

    def metadata(self):
        return {k:v for k,v in self.definitions.items() if len(v[2]) > 1}
