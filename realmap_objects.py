"""Static map objects, kept separate from occupancy and probability.

Frame conventions are checked against FA2SPHE HE_1.5.3 LoadObjects /
RendererTypes. No map scripts or gameplay simulation are executed here.
"""
import colorsys
import re
import struct
from collections import Counter

from PIL import Image


def records(m):
    from realmap import ini_integer
    result = []
    for section in ('STRUCTURES', 'INFANTRY', 'UNITS', 'AIRCRAFT'):
        for key, value in m.get(section, {}).items():
            f = [v.strip() for v in value.split(',')]
            if len(f) < 5:
                continue
            facing_index = 7 if section == 'INFANTRY' else 5
            result.append(dict(id=section+'/'+key, category=section, type=f[1].upper(), house=f[0].upper(),
                health=ini_integer(f[2]), x=ini_integer(f[3]), y=ini_integer(f[4]),
                facing=ini_integer(f[facing_index] if len(f)>facing_index else '0') % 256,
                subcell=ini_integer(f[5]) if section == 'INFANTRY' and len(f)>5 else 0,
                mission=f[6] if section != 'STRUCTURES' and len(f)>6 else '',
                upgrades=f[12:15] if section == 'STRUCTURES' else []))
    return result


class ObjectPainter:
    def __init__(self, res, theater, folder):
        self.res, self.theater, self.folder = res, theater, folder
        self.rules = {**theater['effectiveRules']}
        for house, cfg in theater.get('mapHouses', {}).items():
            self.rules[house] = {**self.rules.get(house, {}), **cfg}
        self.art = res.art
        self.cache, self.files, self.palettes = {}, {}, {}
        self.audit, self.missing, self.warnings = [], [], set()
        self.voxels = None
        self.voxel_error = None
        ext, stem = theater['ext'], theater['stem']
        self.mixes = theater['tilemix']+['isogenmd.mix', 'isogen.mix', stem+'md.mix', stem+'.mix', ext+'.mix', 'conqmd.mix', 'conquer.mix',
                      'genermd.mix', 'generic.mix', 'cameomd.mix', 'cameo.mix', 'localmd.mix', 'local.mix', 'cachemd.mix', 'cache.mix']

    def get(self, name):
        name = name.lower()
        if name not in self.files:
            self.files[name] = self.res.get(self.mixes, name)
        return self.files[name]

    def art_for(self, kind):
        cfg = self.rules.get(kind.upper(), {})
        image = cfg.get('IMAGE', kind).upper()
        return cfg, image, self.art.get(image, {})

    def colors(self, art, house, default='unit', remap=True):
        from realmap import yes, ini_integer
        from realmap_render import palette
        name = art.get('PALETTE', default).lower().replace('~~~', self.theater['ext'])
        if yes(art.get('TERRAINPALETTE', 'no')):
            name, remap = 'iso', False
        if not name.endswith('.pal'):
            name += self.theater['ext']+'.pal'
        color_name = self.rules.get(house, {}).get('COLOR', '')
        color = self.rules.get('COLORS', {}).get(color_name.upper())
        key = name, color if remap else None
        if key not in self.palettes:
            raw = self.res.get(['cachemd.mix', 'cache.mix'], name)
            colors = palette(raw)
            if remap and color:
                hsv = [ini_integer(v)/255 for v in color.split(',')[:3]]
                if len(hsv) == 3:
                    # Keep the palette's 16-step remap shading; house hue/saturation
                    # supplies the tint. This is a static, unlit preview palette.
                    for i in range(16, 32):
                        shade = max(colors[i])/255
                        colors[i] = tuple(round(v*255) for v in colorsys.hsv_to_rgb(hsv[0], hsv[1], min(1, hsv[2]*shade)))
            self.palettes[key] = colors
        return self.palettes[key], name

    def shape(self, image, art, building=False):
        from realmap import yes
        name = art.get('IMAGE', image).lower()
        letter = dict(TEMPERATE='t', SNOW='a', URBAN='u', NEWURBAN='n', DESERT='d', LUNAR='l')[self.theater['name']]
        names = []
        if building or yes(art.get('NEWTHEATER', 'no')):
            names += [name[:1]+letter+name[2:]+'.shp', name[:1]+'g'+name[2:]+'.shp']
        if yes(art.get('THEATER', 'no')):
            names.append(name+'.'+self.theater['ext'])
        names.append(name+'.shp')
        if building:
            names += [name[:1]+t+name[2:]+'.shp' for t in 'tanudl']
        for filename in dict.fromkeys(names):
            try:
                return self.get(filename), filename
            except ValueError:
                pass
        if building:
            for filename in dict.fromkeys(names):
                try:
                    raw = self.res.get(['isotemmd.mix','isotemp.mix','isosnomd.mix','isosnow.mix',
                        'isourbmd.mix','isourb.mix','isoubnmd.mix','isoubn.mix','isodesmd.mix','isodes.mix','isolunmd.mix','isolun.mix'], filename)
                    self.warnings.add('使用可用气候替代贴图：'+filename)
                    return raw, filename
                except ValueError:
                    pass
        raise ValueError('缺少贴图 '+ '/'.join(names))

    def shp(self, image, art, cfg, house, frame=0, building=False, dx=0, dy=0, remap=True):
        from realmap import shp_frame, yes
        from realmap_render import shadow_frame
        raw, filename = self.shape(image, art, building)
        count = struct.unpack_from('<4H', raw)[3]
        if not 0 <= frame < count:
            self.warnings.add(f'{filename} 帧 {frame} 越界，使用静态首帧')
            frame = 0
        colors, palname = self.colors(art, house, remap=remap and yes(art.get('REMAPABLE', 'yes')))
        im = shp_frame(raw, frame, colors)
        shadow, _ = shadow_frame(raw, frame, cfg, art)
        if not yes(art.get('SHADOW', 'yes')):
            shadow = None
        opacity = max(0, min(255, round(255*(1-float(art.get('TRANSLUCENCY', '0'))/100))))
        if opacity < 255:
            im.putalpha(im.getchannel('A').point(lambda a: a*opacity//255))
        return dict(image=im, shadow=shadow, x=-im.width//2+dx, y=-im.height//2+dy,
                    file=filename, frame=frame, palette=palname)

    def parts(self, obj):
        from realmap import yes, ini_integer
        cfg, image, art = self.art_for(obj['type'])
        if image in ('NONE', '<NONE>'):
            return []
        house, category = obj['house'], obj['category']
        key = obj['type'], house, category, obj['facing'], obj['health'], obj['mission'], tuple(obj['upgrades'])
        if key in self.cache:
            return self.cache[key]
        parts = []
        if category == 'STRUCTURES':
            damaged = obj['health'] < 128
            frame = ini_integer(art.get('LOOPSTART', '0')) + int(damaged)
            if obj['health'] == 0:
                frame = 3
            if art.get('BIBSHAPE'):
                bid = art['BIBSHAPE'].upper()
                try:
                    parts.append(self.shp(bid, self.art.get(bid, {}), cfg, house, building=True, dy=-15))
                except ValueError as error:
                    self.warnings.add(str(error))
            parts.append(self.shp(image, art, cfg, house, frame, True, dy=-15))
            for k in ('IDLEANIM', 'ACTIVEANIM', 'ACTIVEANIMTWO', 'ACTIVEANIMTHREE', 'ACTIVEANIMFOUR',
                      'SUPERANIM', 'SUPERANIMTWO', 'SUPERANIMTHREE', 'SUPERANIMFOUR'):
                aid = art.get(k+'DAMAGED' if damaged and art.get(k+'DAMAGED') else k, '').upper()
                if not aid or obj['health'] == 0:
                    continue
                a = self.art.get(aid, {})
                try:
                    parts.append(self.shp(aid, a, cfg, house, ini_integer(a.get('LOOPSTART', '0')), True,
                        ini_integer(art.get(k+'X', '0'))+ini_integer(a.get('XDRAWOFFSET', '0')),
                        -15+ini_integer(art.get(k+'Y', '0'))+ini_integer(a.get('YDRAWOFFSET', '0'))))
                except ValueError as error:
                    self.warnings.add(str(error))
            if yes(cfg.get('TURRET', 'no')) and cfg.get('TURRETANIM'):
                turret = cfg['TURRETANIM'].upper()
                if yes(cfg.get('TURRETANIMISVOXEL', 'no')):
                    try:
                        parts += self.voxel_parts(obj, cfg, image, art, turret=turret)
                    except (ValueError, OSError) as error:
                        self.warnings.add(obj['type']+' 炮塔：'+str(error))
                else:
                    a = self.art.get(turret, {})
                    facings = max(1, ini_integer(a.get('FACINGS', '32')))
                    facing = (facings+7*facings//8-obj['facing']*facings//256) % facings
                    parts.append(self.shp(turret, a, cfg, house, ini_integer(a.get('LOOPSTART', '0'))+facing*max(1,ini_integer(cfg.get('TURRETANIM.IDLEFRAMES','1'))), True,
                        ini_integer(cfg.get('TURRETANIMX', '0')), -15+ini_integer(cfg.get('TURRETANIMY', '0'))))
            for upgrade in obj['upgrades']:
                if upgrade.upper() in ('NONE', '<NONE>', '0', ''):
                    continue
                _, uid, ua = self.art_for(upgrade.upper())
                try:
                    parts.append(self.shp(uid, ua, cfg, house, building=True, dy=-15))
                except ValueError as error:
                    self.warnings.add(str(error))
        elif category == 'INFANTRY':
            if yes(cfg.get('ALTERNATEARCTICART', 'no')) and self.theater['name'] == 'SNOW':
                image += 'A'
                art = self.art.get(image, art)
            seq = self.art.get(art.get('SEQUENCE', '').upper(), {})
            seqkey = 'DEPLOYED' if obj['mission'].upper() == 'UNLOAD' and 'DEPLOYED' in seq else 'GUARD'
            f = [ini_integer(v) for v in seq.get(seqkey, '0,1,1').split(',')]
            frame = f[0] + ((7-obj['facing']//32) % 8)*(f[2] if len(f)>2 else 1)
            parts.append(self.shp(image, art, cfg, house, frame))
        elif yes(art.get('VOXEL', 'no')):
            parts = self.voxel_parts(obj, cfg, image, art)
        else:
            facings = max(1, ini_integer(art.get('FACINGS', '8')))
            facing = (obj['facing']*facings//256) % facings
            standing = 'STANDINGFRAMES' in art
            frame = ini_integer(art.get('STARTSTANDFRAME' if standing else 'STARTWALKFRAME', '0'))
            frame += facing*max(1, ini_integer(art.get('STANDINGFRAMES' if standing else 'WALKFRAMES', '1')))
            parts.append(self.shp(image, art, cfg, house, frame))
        self.cache[key] = parts
        return parts

    def voxel_parts(self, obj, cfg, image, art, turret=None):
        from realmap_voxel import VoxelRenderer
        from realmap import yes, ini_integer
        if self.voxel_error:
            raise ValueError(self.voxel_error)
        if self.voxels is None:
            try:
                self.voxels = VoxelRenderer(self.folder, self.get('voxels.vpl'))
            except (ValueError, OSError) as error:
                self.voxel_error = str(error)
                raise
        colors, palname = self.colors(art, obj['house'])
        offset = [ini_integer(v) for v in art.get('TURRETOFFSET', '0,0,0').split(',')]
        offset = (offset+[0,0,0])[:3]
        names = [(image, [0,0,0], 0)]
        if turret:
            barrel = cfg.get('VOXELBARRELFILE', turret[:-3]+'barl' if turret.lower().endswith('tur') else obj['type']+'barl')
            fire_angle = ini_integer(cfg.get('FIREANGLE', '10'))
            names = [(turret, [0,0,0], 0 if 'tur' in turret.lower() else fire_angle), (barrel, [0,0,0], fire_angle)]
        if turret is None and yes(cfg.get('TURRET', 'no')):
            names += [(image+'tur', offset, 0), (image+'barl', offset, ini_integer(cfg.get('FIREANGLE', '10')))]
        parts = []
        for i, (name, offsets, angle) in enumerate(names):
            try:
                vxl, hva = self.get(name+'.vxl'), self.get(name+'.hva')
            except ValueError:
                if i == 0:
                    raise
                continue  # Several stock turrets have no separate barrel.
            facing = (obj['facing']//8-8) % 32
            if turret:
                facing = (obj['facing']//8-8) % 32
            im, shadow, x, y, sx, sy = self.voxels.draw(vxl, hva, facing, offsets, angle, colors)
            dx = ini_integer(cfg.get('TURRETANIMX', '0')) if turret else 0
            dy = ini_integer(cfg.get('TURRETANIMY', '0'))-15 if turret else 0
            parts.append(dict(image=im, shadow=None if yes(cfg.get('NOSHADOW', 'no')) else shadow,
                x=x+dx, y=y+dy, shadowX=sx+dx, shadowY=sy+dy, file=name.lower()+'.vxl', frame=facing, palette=palname))
        barrel_in_front = 32 <= obj['facing'] < 160 or yes(art.get('BARRELOVERTURRET', 'no'))
        if not barrel_in_front and len(parts) >= (2 if turret else 3):
            parts[-2], parts[-1] = parts[-1], parts[-2]
        return parts

    def prepare(self, cells, origin):
        events, counts = [], Counter()
        hidden = []
        roofs = {}
        for obj in self.theater.get('mapObjects', []):
            if obj['category'] != 'STRUCTURES':
                continue
            _, _, art = self.art_for(obj['type'])
            f = re.fullmatch(r'(\d+)x(\d+)', art.get('FOUNDATION', '1x1'), re.I)
            if f:
                w,h = map(int, f.groups())
                for dx in range(min(w,32)):
                    for dy in range(min(h,32)):
                        p = obj['x']+dx, obj['y']+dy
                        roofs[p] = max(roofs.get(p,0), obj['x']+obj['y']+w+h-2+.7)
        for obj in self.theater.get('mapObjects', []):
            c = cells.get((obj['x'], obj['y']))
            if c is None:
                continue
            try:
                parts = self.parts(obj)
                if not parts:
                    hidden.append(dict(id=obj['id'],type=obj['type'],reason='Image=None'))
                    continue
                cfg, aid, art = self.art_for(obj['type'])
                x = 30*(obj['x']-obj['y'])+origin[0]
                y = 15*(obj['x']+obj['y']-c['level'])+origin[1]
                depth = obj['x']+obj['y']+.6
                if obj['category'] == 'AIRCRAFT':
                    depth = max(depth, roofs.get((obj['x'],obj['y']), 0)+.1)
                if obj['category'] == 'INFANTRY':
                    dx, dy = {2:(15,0), 3:(-15,0), 4:(0,7)}.get(obj['subcell'], (0,0))
                    x += dx; y += dy; depth += dy/15
                if obj['category'] == 'STRUCTURES':
                    f = re.fullmatch(r'(\d+)x(\d+)', art.get('FOUNDATION', '1x1'), re.I)
                    if f:
                        depth += int(f[1])+int(f[2])-2
                for part in parts:
                    events.append((depth, obj['x'], x, y, c['level'], part))
                self.audit.append({**obj, 'parts': [{k:v for k,v in part.items() if k not in ('image','shadow')} for part in parts]})
                counts[obj['category']] += 1
            except (ValueError, OSError, IndexError, struct.error) as error:
                self.missing.append(dict(id=obj['id'], type=obj['type'], reason=str(error)))
        return sorted(events, key=lambda e:e[:2]), dict(total=sum(counts.values()), categories=dict(counts),
            requested=len(self.theater.get('mapObjects', [])), missing=self.missing,
            hidden=hidden, warnings=sorted(self.warnings), records=self.audit)
