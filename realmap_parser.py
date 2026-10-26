"""Reconstruct static cells and map rules; never compile, solve or render."""
from collections import Counter
import re
import struct
from realmap_format import decode_pack, ini, ini_integer, number, sha, yes
from realmap_resources import resources
from realmap_bridges import initialize as initialize_bridges, elevated, above_ground

LANDS = ['Clear', 'Road', 'Water', 'Rock', 'Wall', 'Tiberium', 'Beach', 'Rough', 'Ice', 'Railroad', 'Tunnel']
TRANSLATION = [0, 8, 8, 8, 8, 10, 9, 3, 3, 2, 6, 1, 1, 0, 7, 3]
CLIFF = [(0, -1), (-1, 0), (2, 2), (1, 1), (-1, 1), (1, -1)]


def is_tree(kind, cfg):
    """Identify vegetation conservatively; resource generators are not scenery.

    TerrainClass also contains ice, boxes, traffic lights and ore drills. Stock
    tree images and descriptive rules names support aliases in directory mods;
    an ambiguous custom object stays, rather than silently losing occupation.
    """
    if any(yes(cfg.get(key, 'no')) for key in ('SPAWNSTIBERIUM', 'ISVEINHOLE', 'WATERBOUND')):
        return False
    if kind.upper().startswith(('TIBTRE', 'VEINTREE')):
        return False
    image = cfg.get('IMAGE', kind).upper()
    if re.fullmatch(r'TREE\d+', image):
        return True
    name = cfg.get('NAME', '')
    return bool(re.search(r'\b(tree|trees|palm|palms)\b|树|樹', name, re.I))


def object_records(m, on_error=None):
    result = []
    for section in ('STRUCTURES', 'INFANTRY', 'UNITS', 'AIRCRAFT'):
        for key, value in m.get(section, {}).items():
            f = [v.strip() for v in value.split(',')]
            if len(f) < 5:
                continue
            try:
                int(f[3]); int(f[4])
            except ValueError:
                if on_error is None:
                    raise
                continue  # The map parser already reports this invalid position.
            facing_index = 7 if section == 'INFANTRY' else 5
            result.append(dict(id=section+'/'+key, category=section, type=f[1].upper(), house=f[0].upper(),
                health=ini_integer(f[2]), x=ini_integer(f[3]), y=ini_integer(f[4]),
                facing=ini_integer(f[facing_index] if len(f)>facing_index else '0') % 256,
                subcell=ini_integer(f[5]) if section == 'INFANTRY' and len(f)>5 else 0,
                mission=f[6] if section != 'STRUCTURES' and len(f)>6 else '',
                aboveGround=above_ground(section, f),
                upgrades=f[12:15] if section == 'STRUCTURES' else []))
    return result


def clipped_rect(size, local):
    _, _, w, h = size
    l, t, vw, vh = local
    right, bottom = min(l + vw, w), min(t + vh, h)
    l, t = max(l, 0), max(t, 0)
    vw, vh = max(0, right - l), max(0, bottom - t)
    l, t = max(l, 2), max(t, 2)
    return [l, t, min(vw, w - l - 2), min(vh, h - t - 6)]


def usable(c, width, rect):
    l, t, vw, vh = rect
    x, y, k = c['x'], c['y'], c['level']
    if c['slope'] and x+y < k+width+2*t+4:
        k += 1
    return x+y > k+width+2*t and x+y <= k+width+2*(t+vh)+2 and x-y < 2*(l+vw)-width and y-x < width-2*l


def project_match(cells, c):
    x, y, level = c['x'], c['y'], c['level']
    # The native 8-lepton ray only visits these six diagonal cells before
    # returning to itself. Within distance d, its comparison can succeed iff
    # height difference >= 2*d-1. Collapse 16/32 identical-cell iterations,
    # preserving the native strict integer boundary (including bridge +4).
    for distance in range(6, 0, -1):
        other = cells.get((x+distance, y+distance))
        diff = (other['level'] if other else 0) - level
        if c.get('bridgeProjection') and other and elevated(other):
            diff += 4
        if diff >= 2*distance-1:
            return False
    return True


def land_after(raw_land, slope, overlay_cfg, higher, cliff_mode):
    land = raw_land
    overlay_branch = False
    if overlay_cfg is not None:
        name = overlay_cfg.get('LAND', 'Clear').title()
        if name not in LANDS:
            raise ValueError('未知 LandType '+name)
        land = LANDS.index(name)
        if yes(overlay_cfg.get('TIBERIUM', 'no')) and land == 0:
            land = 5
        overlay_branch = land in (4, 9) or yes(overlay_cfg.get('NOUSETILELANDTYPE', 'yes'))
        if not overlay_branch:
            land = raw_land
    if cliff_mode == 2 and higher and (overlay_branch or land in (0, 2, 6, 8)):
        land = 3
    return land


def map_rules(m, res, warnings):
    """Map-local Techno declarations use names, not INI list keys as indices.

    New rules are self-contained definitions. Image selects original art; it
    does NOT inherit that image's weapons, movement rules or other properties.
    Indexed Overlay/Terrain extensions and external includes remain unsupported.
    """
    if '#INCLUDE' in m:
        raise ValueError('地图引用外部 include 文件；请提供完整资源环境，不能仅凭地图解析')
    if m.get('TUBES'):
        raise ValueError('地图含隧道路径 [Tubes]；分层通行尚未支持')
    lists = ('OVERLAYTYPES', 'TERRAINTYPES', 'BUILDINGTYPES', 'VEHICLETYPES', 'INFANTRYTYPES', 'AIRCRAFTTYPES')
    rules = {k: dict(v) for k, v in res.rules.items()}
    overrides = []
    for key in rules.keys() & m.keys():
        if key not in lists:
            rules[key].update(m[key]); overrides.append(key)
    additions = []
    for section in lists:
        original = {v.upper() for v in res.rules.get(section, {}).values()}
        for key, value in m.get(section, {}).items():
            kind = value.upper()
            if not key.isdigit() or not re.fullmatch(r'[A-Z0-9_.-]+', kind):
                raise ValueError(f'[{section}] {key}={value} 不是支持的简单类型声明')
            if kind in original:
                continue
            if section in ('OVERLAYTYPES', 'TERRAINTYPES'):
                raise ValueError(f'[{section}] 新增 {kind}：扩展地形物／覆盖物类型的索引与加载尚未支持')
            if not m.get(kind):
                raise ValueError(f'[{section}] 新增 {kind} 缺少地图内定义 [{kind}]')
            if kind in res.rules:
                raise ValueError(f'[{section}] {kind} 与其他原版定义冲突')
            if any(a['type'] == kind and a['list'] != section for a in additions):
                raise ValueError(f'{kind} 被声明为多种单位类型')
            cfg = dict(m[kind])
            image = cfg.get('IMAGE', kind).upper()
            if image not in res.art:
                raise ValueError(f'新增 {kind} 的 Image={image} 缺少原版 art 定义，可能依赖外部模组资产')
            rules[kind] = cfg
            if not any(a['type'] == kind for a in additions):
                additions.append(dict(type=kind, list=section, image=image))
    if overrides:
        warnings.append('已合并地图中的原版规则覆盖节：'+', '.join(sorted(overrides)))
    if additions:
        warnings.append('已加载地图内新增类型（使用原版 Image，不继承同图像类型的规则）：'+', '.join(a['type'] for a in additions))
    return rules, additions


def parse_map(data, folder, version, progress=lambda *args: None, mix_paths=None, resource_context=None, visual_only=False, minerals_enabled=True):
    if not data or len(data) > 16*1024*1024 or b'\x00' in data:
        raise ValueError('请选择 16 MB 以内的文本 .map／.yrm／.mpr 地图')
    irrelevant_duplicates = []
    m = ini(data, True, irrelevant_duplicates=irrelevant_duplicates)
    if 'MAP' not in m:
        raise ValueError('缺少 [Map]，不支持 MIX 或存档文件')
    if any(k not in m['MAP'] for k in ('SIZE', 'LOCALSIZE', 'THEATER')):
        raise ValueError('[Map] 必须包含 Size、LocalSize 和 Theater')
    size = list(map(int, m['MAP']['SIZE'].split(',')))
    local = list(map(int, m['MAP']['LOCALSIZE'].split(',')))
    if len(size) != 4 or len(local) != 4 or size[:2] != [0, 0] or not all(8 <= n <= 256 for n in size[2:]) or sum(size[2:]) > 511:
        raise ValueError('需要原版 Size=0,0,W,H，W/H 为 8～256 且 W+H≤511')
    if local[2] <= 0 or local[3] <= 0:
        raise ValueError('LocalSize 无效')
    rect = clipped_rect(size, local)
    if rect[2] <= 0 or rect[3] <= 0:
        raise ValueError('引擎裁剪后无有效可用区域')
    progress('读取原版规则、地形与调色盘', 12)
    res = resource_context or resources(version, mix_paths)
    theater = res.theater(m['MAP'].get('THEATER', '').upper())
    warnings = []
    if irrelevant_duplicates:
        warnings.append('地图中 Sight（视野范围）存在不同的重复值；该字段不参与静态箱子概率和贴图计算，已保留歧义记录，未判定游戏实际采用哪个值。')
    issues, issue_index = [], {}
    def issue(message, point=None):
        entry = issue_index.get(message)
        if entry is None:
            entry = dict(message=message, count=0, cells=[]); issues.append(entry); issue_index[message] = entry
        entry['count'] += 1
        if point is not None:
            entry['cells'].append(list(point))
    if visual_only:
        # The explicit Mod context has already resolved its rules/includes.
        # Stock fallback only merges local sections for drawing; it never
        # interprets new indexed lists or claims this is a gameplay model.
        rules = {k: dict(v) for k, v in res.rules.items()}
        if resource_context is None:
            for key, values in m.items():
                if key in rules or any(key == v.upper() for section in
                    ('BUILDINGTYPES', 'VEHICLETYPES', 'INFANTRYTYPES', 'AIRCRAFTTYPES')
                    for v in m.get(section, {}).values()):
                    if not key.endswith('TYPES'):
                        rules.setdefault(key, {}).update(values)
            if '#INCLUDE' in m:
                issue('外部 include 未加载；仅展示当前资源中能够解析的内容。')
        additions = []
    else:
        rules, additions = map_rules(m, res, warnings)
    if not visual_only and m.get('AIRCRAFT') and version != 'yr':
        raise ValueError('RA2 预置飞机的加载状态尚未核对；当前仅支持 YR 的初始地面飞机占用')
    cliff_mode = None if visual_only else int(rules['GENERAL'].get('CLIFFBACKIMPASSABILITY', '0'))
    if not visual_only and cliff_mode not in (0, 1, 2):
        raise ValueError('未知 CliffBackImpassability')
    crate_rules = rules.get('CRATERULES', {})
    crate_minimum = None if visual_only else ini_integer(crate_rules.get('CRATEMINIMUM', '1'))
    crate_maximum = None if visual_only else ini_integer(crate_rules.get('CRATEMAXIMUM', '255'))
    if crate_maximum == 0:
        warnings.append('地图规则设置 CrateMaximum=0，常规随机箱数量受限。此图展示“有空闲箱子槽且执行一次随机放箱调用”的条件落点概率，不表示对局会自动刷箱。')
    crate_names = [crate_rules.get('CRATEIMG', 'CRATE'), crate_rules.get('WATERCRATEIMG', 'WCRATE')]
    for name in crate_names:
        cfg = rules.get(name.upper())
        if not visual_only and (not cfg or not yes(cfg.get('CRATE', 'no')) or yes(cfg.get('WALL', 'no'))):
            raise ValueError('当前不支持被改为非普通 Overlay 的箱子类型')
    progress('解压 IsoMapPack5、OverlayPack 与 OverlayDataPack', 22)
    raw = decode_pack(m, 'IsoMapPack5', folder)
    def optional_pack(name):
        try:
            value = decode_pack(m, name, folder, False)
            if value is not None and len(value) != 262144:
                raise ValueError(name+' 数据必须为 512×512')
            return value
        except ValueError as error:
            if not visual_only:
                raise
            issue(str(error)+'；该覆盖物图层无法读取，未显示。')
            return None
    overlay = optional_pack('OverlayPack')
    overlay_data = optional_pack('OverlayDataPack')
    if overlay is None:
        overlay = bytes([255]) * 262144
    if overlay_data is None:
        overlay_data = bytes(262144)
    if len(overlay) != 262144 or len(overlay_data) != 262144:
        raise ValueError('Overlay 数据必须为 512×512')
    if len(raw) % 11 == 4 and raw[-4:] == b'\0'*4:
        raw = raw[:-4]
    if len(raw) % 11:
        raise ValueError('IsoMapPack5 记录长度不符')
    records = {}
    w, h = size[2:]
    def inside(x, y):
        return x+y > w and x+y <= w+2*h and x-y < w and y-x < w
    for x, y, tile, sub, level, ice in struct.iter_unpack('<hhIBBB', raw):
        if not inside(x, y) or not 0 < x < 512 or not 0 < y < 512:
            raise ValueError(f'地形记录 ({x},{y}) 超出 Size；未猜测加载行为')
        if (x, y) in records or level > 14:
            raise ValueError(f'地形坐标重复或高度无效：{x},{y}')
        records[x, y] = (tile, sub, level, ice)
    overlays = [v.upper() for k, v in sorted(rules['OVERLAYTYPES'].items(), key=lambda kv: int(kv[0]))]
    cells, tmp_cache = {}, {}
    removed_minerals = removed_trees = 0
    for y in range(1, w+h):
        for x in range(1, w+h):
            if not inside(x, y):
                continue
            tile, sub, level, ice = records.get((x, y), (65535, 0, 0, 0))
            ti = 0 if tile >= 65535 else tile
            terrain_error = None
            filename = f'unresolved-tile-{tile}'
            try:
                if ti >= len(theater['definitions']):
                    raise ValueError(f'未找到 TileIndex={tile}，可能依赖扩展地形包')
                setname, filename, setlabel = theater['definitions'][ti]
                if filename not in tmp_cache:
                    tmp_cache[filename] = res.get(theater['tilemix'], filename)
                tmp = tmp_cache[filename]
                nx, ny, tw, th = struct.unpack_from('<4I', tmp)
                if (tw, th) != (60, 30) or sub >= nx*ny:
                    raise ValueError(f'无效 TMP 子格 {filename}/{sub}')
                offset, = struct.unpack_from('<I', tmp, 16+sub*4)
                if not offset or offset+952 > len(tmp) or tmp[offset+41] >= len(TRANSLATION):
                    raise ValueError(f'缺失 TMP 子格 {filename}/{sub}')
                land, slope = TRANSLATION[tmp[offset+41]], tmp[offset+42]
            except (ValueError, OSError, struct.error) as error:
                if not visual_only:
                    raise
                terrain_error = str(error)
                issue(terrain_error, (x, y))
                land, slope = None, 0  # Flat placeholder, never inferred terrain.
            ov = overlay[x+y*512]
            if ov != 255 and ov >= len(overlays):
                if not visual_only:
                    raise ValueError(f'未知 Overlay {ov}')
                issue(f'未知 Overlay {ov}，无法显示该覆盖物。', (x, y))
            ovname = overlays[ov] if ov < len(overlays) and ov != 255 else None
            if not visual_only and (land == 10 or ovname and 'TUNNEL' in ovname):
                raise ValueError(f'({x},{y}) 含隧道；隧道路径尚未支持')
            cfg = rules.get(ovname, {}) if ovname else None
            if not minerals_enabled and cfg and yes(cfg.get('TIBERIUM', 'no')):
                # Clear resources before rebuilding land and nearby-search state.
                ov, ovname, cfg = 255, None, None
                removed_minerals += 1
            if not visual_only and cfg and yes(cfg.get('TIBERIUM', 'no')) and slope > 4:
                raise ValueError(f'({x},{y}) 在复杂坡面预放矿石；覆盖物加载失败后的状态尚未支持')
            cells[x, y] = dict(x=x, y=y, level=level, slope=slope, tileIndex=tile, subTile=sub,
                file=filename, rawLand=land, overlay=ov, overlayName=ovname, overlayData=overlay_data[x+y*512] if ov != 255 else 0,
                objects=[], objectsGround=[], objectsDeck=[], removable=[], terrain=None,
                occupied=False, occupiedGround=False, occupiedDeck=False, higher=[], usable=False)
            if terrain_error:
                cells[x, y]['terrainError'] = terrain_error
            if visual_only:
                cells[x, y].update(knownOccupiedGround=False, knownOccupiedDeck=False, unknownObjects=[])
            if cfg and yes(cfg.get('TIBERIUM', 'no')):
                cells[x, y]['removable'].append(dict(category='mineral', type=ovname))
    initialize_bridges(cells, strict=not visual_only)
    progress('重建格子属性、占用和高度投影', 35)
    for key, kind in m.get('TERRAIN', {}).items():
        try:
            p = int(key) % 1000, int(key) // 1000
        except ValueError:
            if not visual_only:
                raise
            issue(f'Terrain 坐标无效：{key}；跳过此对象。'); continue
        if p not in cells:
            if visual_only:
                issue(f'Terrain 坐标不在地图内：{p}；跳过此对象。'); continue
            raise ValueError(f'Terrain 坐标不在地图内：{p}')
        kind = kind.upper()
        cfg = rules.get(kind, {})
        if not minerals_enabled and is_tree(kind, cfg):
            removed_trees += 1
            continue
        if not visual_only and kind not in rules:
            raise ValueError('未找到 Terrain 类型 '+kind)
        art = res.art.get(cfg.get('IMAGE', kind).upper(), {})
        if not visual_only and art.get('FOUNDATION', '1x1').lower() != '1x1':
            raise ValueError('尚未验证非 1×1 Terrain 基础：'+kind)
        bits = (ini_integer if visual_only else int)(cfg.get('SNOWOCCUPATIONBITS' if theater['name'] == 'SNOW' else 'TEMPERATEOCCUPATIONBITS', '7'))
        if visual_only and (not cfg or not art):
            issue('地形物缺少规则或 art 定义：'+kind, p)
            cells[p]['occupancyUnknown'] = True
        c = cells[p]
        c['terrain'] = kind
        c['occupied'] |= bool(bits & 7)
        c['occupiedGround'] |= bool(bits & 7)
        if visual_only:
            if not cfg or not art:
                c['unknownObjects'].append(kind)
            else:
                c['knownOccupiedGround'] |= bool(bits & 7)
        c['objects'].append(kind)
        c['objectsGround'].append(kind)
        c['removable'].append(dict(category='terrain', type=kind))
    empty_foundation_objects = []
    registered_buildings = {v.upper() for v in res.rules.get('BUILDINGTYPES', {}).values()}
    for section in ('STRUCTURES', 'UNITS', 'INFANTRY', 'AIRCRAFT'):
        for record_key, record in m.get(section, {}).items():
            fields = record.split(',')
            if len(fields) < 5:
                if visual_only:
                    issue(f'[{section}] {record_key} 对象记录不完整；跳过此对象。'); continue
                raise ValueError(f'[{section}] 对象记录不完整')
            kind = fields[1].upper()
            try:
                p = int(fields[3]), int(fields[4])
            except ValueError:
                if not visual_only:
                    raise
                issue(f'[{section}] {record_key} 对象坐标无效；跳过此对象。'); continue
            # YR's registered, entirely undefined building types keep their
            # constructor's null FoundationData (an empty sentinel list).
            # They contribute no cell occupation, not a guessed 1x1 footprint.
            # This is independent of the record's health; keep the source and
            # audit it. A map/rules/art definition requires the normal path.
            if (version == 'yr' and (not visual_only or resource_context is None) and section == 'STRUCTURES' and kind in registered_buildings
                    and kind not in rules and kind not in m and kind not in res.art):
                if p not in cells:
                    if visual_only:
                        issue(f'[{section}] 对象坐标不在地图内：{kind} {p}'); continue
                    raise ValueError(f'[{section}] 对象坐标不在地图内：{kind} {p}')
                empty_foundation_objects.append(dict(id=section+'/'+record_key, type=kind,
                    x=p[0], y=p[1], health=ini_integer(fields[2]), reason='registered-empty-foundation'))
                continue
            if not visual_only and kind not in rules:
                raise ValueError(f'[{section}] 缺少类型规则定义：{kind} {p}；未猜测引擎默认对象状态')
            if p not in cells:
                if visual_only:
                    issue(f'[{section}] 对象坐标不在地图内：{kind} {p}'); continue
                raise ValueError(f'[{section}] 对象坐标不在地图内：{kind} {p}')
            cfg = rules.get(kind, {})
            art = res.art.get(cfg.get('IMAGE', kind).upper(), {})
            if not visual_only and section == 'STRUCTURES' and not art:
                raise ValueError('建筑缺少有效的原版 art 基础定义：'+kind)
            foundation = art.get('FOUNDATION', '1x1') if section == 'STRUCTURES' else '1x1'
            unknown_object = not cfg or not art or (version == 'ra2' and section == 'AIRCRAFT')
            if visual_only and (not cfg or not art):
                issue(f'{kind} 缺少规则或 Image={cfg.get("IMAGE", kind)} 的 art 定义；保留对象位置，占用未验证。', p)
                cells[p]['occupancyUnknown'] = True
            match = re.fullmatch(r'(\d+)x(\d+)', foundation, re.I)
            if visual_only and not match:
                unknown_object = True
                match = re.fullmatch(r'(\d+)x(\d+)', art.get('FOUNDATION.X', '1')+'x'+art.get('FOUNDATION.Y', '1'))
            if not match or not all(1 <= int(n) <= 10 for n in match.groups()):
                if visual_only:
                    issue('无法解析建筑基础：'+kind+'/'+foundation+'；仅保留对象位置。', p)
                    cells[p]['occupancyUnknown'] = True
                    unknown_object = True
                    match = re.fullmatch(r'(\d+)x(\d+)', '1x1')
                else:
                    raise ValueError('未验证的建筑基础：'+kind+'/'+foundation)
            if not visual_only and yes(cfg.get('ISVEINHOLE', 'no')):
                raise ValueError('尚未验证特殊对象的占用：'+kind)
            for dx in range(int(match[1])):
                for dy in range(int(match[2])):
                    q = p[0]+dx, p[1]+dy
                    if q not in cells:
                        if visual_only:
                            continue
                        raise ValueError('建筑基础超出地图：'+kind)
                    c = cells[q]
                    layer = 'Deck' if elevated(c) and above_ground(section, fields) else 'Ground'
                    c['occupied'+layer] = True
                    if visual_only:
                        if unknown_object:
                            c['unknownObjects'].append(kind)
                            c['occupancyUnknown'] = True
                        else:
                            c['knownOccupied'+layer] = True
                    c['objects'+layer].append(kind)
                    c['objects'].append(kind)
                    c['removable'].append(dict(category='building' if section == 'STRUCTURES' else 'unit', type=kind))
    if not visual_only and m.get('AIRCRAFT'):
        warnings.append(f'已按 YR 地图加载时的地面位置计入 {len(m["AIRCRAFT"])} 架预置飞机（1×1 占用）；未推进巡逻、起飞或触发任务。')
    if empty_foundation_objects:
        warnings.append(f'地图有 {len(empty_foundation_objects)} 条已登记、但完全没有 rules/art 定义的尤复建筑记录；按引擎默认空基础处理，不占格、无贴图。原记录已保留，不根据生命值猜测删除。')
    for p, c in cells.items():
        c['occupied'] = c['occupiedDeck'] if elevated(c) else c['occupiedGround']
        if visual_only:
            c.update(land=c['rawLand'], postLand=None, usable=usable(c, w, rect), track=False,
                     foot=False, float=False, wall=False, primary=False, candidate=False,
                     status='preview', rockTransition=False)
            continue
        c['higher'] = [[q[0], q[1], cells[q]['level']] for dx, dy in CLIFF
                       if (q := (p[0]+dx, p[1]+dy)) in cells and cells[q]['level'] >= c['level']+4]
        cfg = rules.get(c['overlayName'], {}) if c['overlayName'] else None
        c['land'] = land_after(c['rawLand'], c['slope'], cfg, c['higher'], cliff_mode)
        c['usable'] = usable(c, w, rect)
        c['track'] = number(rules[LANDS[c['land']].upper()].get('TRACK', '0')) != 0
        c['foot'] = number(rules[LANDS[c['land']].upper()].get('FOOT', '0')) != 0
        c['float'] = number(rules[LANDS[c['land']].upper()].get('FLOAT', '0')) != 0
        if elevated(c):
            # IsClearToMove(level=-1) uses AltOccupation and accepts a high
            # bridge even when this speed's ground-land multiplier is zero.
            c['track'] = c['foot'] = c['float'] = True
        c['wall'] = bool(cfg and yes(cfg.get('WALL', 'no')))
        c['primary'] = project_match(cells, c)
        c['candidate'] = c['usable'] and not c['occupied'] and not c['wall']
        # Overlay's constructor refuses a ground-layer Terrain object even
        # when the random search selected the otherwise-empty bridge deck.
        # CreateCrate still reports success: no entity and no retry.
        c['ghostReason'] = 'terrain' if c['terrain'] else 'slope' if c['slope'] > 4 else None
        c['status'] = 'retry' if c['overlay'] != 255 else 'ghost' if c['ghostReason'] else 'crate'
        crate_cfg = rules[crate_names[int(c['land'] == 2)].upper()]
        c['postLand'] = land_after(c['rawLand'], c['slope'], crate_cfg, c['higher'], cliff_mode)
        post_cost = rules[LANDS[c['postLand']].upper()]
        c['rockTransition'] = (not elevated(c) and c['land'] != 3 and c['postLand'] == 3 and c['status'] == 'crate'
                               and (c['track'] or c['foot']) and number(post_cost.get('TRACK', '0')) == 0
                               and number(post_cost.get('FOOT', '0')) == 0)
    if m.get('TRIGGERS') or m.get('EVENTS') or m.get('ACTIONS'):
        warnings.append('仅计算地图文件的静态对象状态；未运行地图触发、脚本或开局事件。')
    bridge_counts = Counter(c['bridge']['kind'] for c in cells.values() if c['bridge'])
    if bridge_counts and not visual_only:
        warnings.append('已分别计入高桥的桥面与桥下占用；放箱搜索检查桥面层，桥下对象不会误算成桥面阻挡。箱子覆盖物绘制在桥下地面，同坐标的桥面／桥下单位均可触发拾取，前提是实际路线可达；未模拟炸桥、修桥或单位移动。')
    if not visual_only and any(yes(rules.get(kind, {}).get('GATE', 'no')) for c in cells.values() for kind in c['objects']):
        warnings.append('闸门按地图初始关闭状态的建筑基础占用计算；不推进开门、关门或通行请求。')
    if not minerals_enabled:
        warnings.append(f'矿石/树木：关。已移除地图预置的矿石／宝石（{removed_minerals} 格）和树木（{removed_trees} 棵）；保留矿石钻井、建筑、单位和其他地形物，不模拟后续生长。')
    if not visual_only:
        warnings.extend(['分析下一次放箱调用，假定有空闲箱子槽；未加入游戏自动出生单位、移动单位或后续矿石生长。',
                     '使用原版 MIX 资源；不自动加载 loose INI、Ares／Phobos、expand 包或房间规则。',
                     'Rock 标记描述落箱后属性改变，不把普通孤立高原或单纯寻路不通标为异常。'])
    theater['effectiveRules'] = rules
    theater['mapObjects'] = object_records(m, on_error=issue if visual_only else None)
    theater['emptyFoundationObjectIds'] = [o['id'] for o in empty_foundation_objects]
    theater['mapHouses'] = {o['house']: m[o['house']] for o in theater['mapObjects'] if o['house'] in m}
    return cells, res, theater, tmp_cache, dict(size=size, localSize=local, visibleRect=rect,
        theater=theater['name'], version=version, cliffBackImpassability=cliff_mode, bridgeModelVersion=2,
        mapLoadingModelVersion=1,
        mineralsEnabled=bool(minerals_enabled), treesEnabled=bool(minerals_enabled), terrainRemovalVersion=1,
        removedMineralCount=removed_minerals, removedTreeCount=removed_trees,
        decodedRecords=len(records), cellCount=len(cells), warnings=warnings, loadIssues=issues,
        sourceSha256=sha(data), rulesSha256=sha(res.rules_bytes), theaterSha256=theater['configSha256'],
        mapTypeAdditions=additions, initialAircraftCount=len(m.get('AIRCRAFT', {})),
        irrelevantDuplicateKeys=irrelevant_duplicates, emptyFoundationObjects=empty_foundation_objects,
        crateLimits=dict(minimum=crate_minimum, maximum=crate_maximum),
        name=m.get('BASIC', {}).get('NAME', '导入地图'), waypoints=m.get('WAYPOINTS', {}),
        multiplayerOnly=m.get('BASIC', {}).get('MULTIPLAYERONLY', 'yes').lower() in ('yes', 'true', '1'))
