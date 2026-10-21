"""Decode TMP tile pixels and SHP frames without importing map analysis."""
import struct
import runtime_bootstrap
from PIL import Image


def tile_parts(raw, sub, colors):
    offset, = struct.unpack_from('<I', raw, 16+sub*4)
    xx, yy, _, _, _, ex, ey, ew, eh, flags = struct.unpack_from('<10i', raw, offset)
    tile = Image.new('RGBA', (60, 30))
    pixels, n = raw[offset+52:offset+952], 0
    for y in range(30):
        width = 4*(y+1 if y < 15 else 29-y)
        for x in range((60-width)//2, (60+width)//2):
            tile.putpixel((x, y), colors[pixels[n]]+(255 if pixels[n] else 0,)); n += 1
    result = [(tile, 0, 0)]
    if flags & 1:
        if not 0 < ew <= 1024 or not 0 < eh <= 1024:
            raise ValueError('TMP 扩展图像尺寸无效')
        pos = offset+952+(900 if flags & 2 else 0)
        indices = raw[pos:pos+ew*eh]
        if len(indices) != ew*eh:
            raise ValueError('TMP 扩展图像不完整')
        im = Image.new('RGBA', (ew, eh)); im.putdata([colors[v]+(255 if v else 0,) for v in indices])
        result.append((im, ex-xx, ey-yy))
    return result


def shp_frame(raw, frame, colors):
    """TS SHP format 0/1/2/3, bounded per-row zero-run decoding."""
    _, width, height, count = struct.unpack_from('<4H', raw)
    if not 0 <= frame < count or width > 2048 or height > 2048:
        raise ValueError('SHP frame invalid')
    x, y, w, h, mode, _, _, pos = struct.unpack_from('<4H4I', raw, 8+24*frame)
    im = Image.new('RGBA', (width, height))
    if not w or not h or not pos:
        return im
    if x+w > width or y+h > height:
        raise ValueError('SHP bounds invalid')
    indices = []
    for row in range(h):
        if mode in (2, 3):
            length, = struct.unpack_from('<H', raw, pos)
            end = pos+length
            pos += 2
        else:
            end = pos+w
        line = []
        while pos < end:
            v = raw[pos]; pos += 1
            if mode == 3 and v == 0:
                n = raw[pos]; pos += 1
                line.extend([0]*n)
            else:
                line.append(v)
        # Original SHPs contain zero-run padding past the cropped row width.
        if len(line) < w or any(line[w:]) or pos != end:
            raise ValueError('SHP row invalid')
        indices.extend(line[:w])
    sprite = Image.new('RGBA', (w, h)); sprite.putdata([colors[v]+(255 if v else 0,) for v in indices])
    im.paste(sprite, (x, y))
    return im


SHADOW_ALPHA = 128  # WAE ObjectRenderer.DrawShadow: Color(255,255,255,128).


def palette(raw):
    return [tuple((v << 2) | (v >> 4) for v in raw[i:i+3]) for i in range(0, 768, 3)]


def sprite_spec(kind, overlay, frame, res, theater):
    from realmap_format import yes, ini_integer
    cfg = theater['effectiveRules'].get(kind, {})
    image = cfg.get('IMAGE', kind).upper()
    art = res.art.get(image, {})
    name = art.get('IMAGE', image).lower()
    ext, stem = theater['ext'], theater['stem']
    is_theater = yes(art.get('THEATER', 'no')) or kind in ('BRIDGE1', 'BRIDGE2', 'BRIDGEB1', 'BRIDGEB2')
    filename = name+('.'+ext if is_theater else '.shp')
    mixes = [stem+'md.mix', stem+'.mix', ext+'.mix', *theater['tilemix'], 'conqmd.mix', 'conquer.mix', 'genermd.mix', 'generic.mix']
    if yes(art.get('NEWTHEATER', 'no')):
        letter = dict(TEMPERATE='t', SNOW='a', URBAN='u', NEWURBAN='n', DESERT='d', LUNAR='l')[theater['name']]
        # A/T in the second position is a theater placeholder, not an arbitrary
        # letter to replace. Ares permits custom faction prefixes too. Otherwise
        # the editor first tries the unchanged image (e.g. non-theater wall art).
        placeholder = len(name) >= 2 and name[0].isascii() and name[0].isalpha() and name[1] in 'at'
        current = name[:1]+letter+name[2:]+'.shp' if placeholder else filename
        generic = name[:1]+'g'+name[2:]+'.shp' if len(name) >= 2 else filename
        # Preserve the original-name fallback when both variants are absent.
        names = list(dict.fromkeys([current, generic, filename]))
        for filename in names:
            try:
                raw = res.get(mixes, filename)
                break
            except ValueError:
                pass
        else:
            raise ValueError('缺少贴图 '+kind+'：'+', '.join(names))
    else:
        raw = res.get(mixes, filename)
    palname = 'iso'+ext+'.pal'
    offset = 0
    if overlay:
        if kind in ('BRIDGE1', 'BRIDGE2', 'BRIDGEB1', 'BRIDGEB2'):
            offset -= 31 if 9 <= frame <= 17 else 16
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
    import numpy as np
    from realmap_format import yes
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
