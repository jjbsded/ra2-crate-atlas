"""Apply a bounded in-memory simulation delta before rebuilding map attributes.

Original source.map remains byte-identical. Simulation objects and rubble are
never serialized into a game map; the exported artifact is only the delta.
"""
from copy import deepcopy
import hashlib
import json
import re

SECTIONS = ('STRUCTURES', 'UNITS', 'INFANTRY', 'AIRCRAFT')
HOUSE = 'CRATE_ATLAS_SIMULATION'
CELL_FIELDS = ('x', 'y', 'level', 'slope', 'tileIndex', 'subTile', 'file', 'rawLand',
               'overlay', 'overlayName', 'overlayData', 'usable', 'bridge', 'bridgeProjection', 'terrainError', 'overlayError')


def recipe(content, rules):
    keys = {'MAP', 'BASIC', 'LIGHTING', 'TERRAIN', *SECTIONS}
    keys.update(k for k in content if k in rules)
    for section in SECTIONS:
        keys.update(v.split(',')[0].strip().upper() for v in content.get(section, {}).values())
    return {k: dict(v) for k, v in content.items() if k in keys}


def validate(plan, data, version):
    if not isinstance(plan, dict) or plan.get('schema') != 1:
        raise ValueError('模拟增量格式无效')
    if plan.get('map') != dict(sha256=hashlib.sha256(data).hexdigest(), version=version):
        raise ValueError('模拟方案与原地图或游戏版本不匹配')
    if not isinstance(plan.get('objects'), dict) or not isinstance(plan.get('overlays'), dict) or not isinstance(plan.get('placements'), list):
        raise ValueError('模拟增量字段无效')
    if len(plan['placements']) > 20000 or len(plan['objects']) > 100000 or len(plan['overlays']) > 262144:
        raise ValueError('模拟方案超过对象数量限制')
    return deepcopy(plan)


def apply(plan, content, cells, rules, art, *, dirty=None):
    """Only alter decoded cells and local INI dictionaries, never caller bytes."""
    from realmap_format import yes, ini_integer
    overlays = [v.upper() for k, v in sorted(rules['OVERLAYTYPES'].items(), key=lambda pair: int(pair[0]))]
    rubble = []
    for identifier, mode in plan['objects'].items():
        if not isinstance(identifier, str) or '/' not in identifier or mode not in ('remove', 'rubble', 'delete'):
            raise ValueError('模拟对象变更无效')
        section, entry = identifier.split('/', 1)
        if section not in (*SECTIONS, 'TERRAIN') or entry not in content.get(section, {}):
            raise ValueError('模拟对象不存在于原地图')
        line = content[section][entry]
        fields = line.split(',')
        kind = (line if section == 'TERRAIN' else fields[1]).strip().upper()
        cfg = rules.get(kind, {})
        if mode == 'delete' and section not in ('UNITS', 'INFANTRY', 'AIRCRAFT'):
            raise ValueError('仅单位允许直接删除')
        if mode != 'delete' and (yes(cfg.get('IMMUNE', 'no')) or ini_integer(cfg.get('STRENGTH', '1')) <= 0):
            raise ValueError('不可摧毁无敌对象：'+kind)
        if mode == 'rubble':
            if section != 'STRUCTURES' or not yes(cfg.get('LEAVERUBBLE', 'no')):
                raise ValueError('该对象不会留下建筑废墟')
            fields[2] = '0'
            rubble.append((entry, ','.join(fields)))
        del content[section][entry]
    for point, pair in plan['overlays'].items():
        if not isinstance(point, str) or not re.fullmatch(r'\d{1,3},\d{1,3}', point) or not isinstance(pair, list) or len(pair) != 2 or any(type(n) is not int or not 0 <= n <= 255 for n in pair):
            raise ValueError('模拟覆盖物变更无效')
        p = tuple(map(int, point.split(',')))
        if p not in cells or pair[0] != 255 and pair[0] >= len(overlays):
            raise ValueError('模拟覆盖物超出地图或类型范围')
        if dirty is not None and p not in dirty:
            continue
        c = cells[p]
        c.update(overlay=pair[0], overlayData=pair[1], overlayName=overlays[pair[0]] if pair[0] != 255 else None)
    for entry, line in rubble:
        fields = line.split(','); kind = fields[1].strip().upper(); cfg = rules[kind]
        base = int(fields[3]), int(fields[4])
        for dx, dy in foundation(art.get(cfg.get('IMAGE', kind).upper(), {})):
            c = cells.get((base[0]+dx, base[1]+dy))
            if c and (dirty is None or (base[0]+dx, base[1]+dy) in dirty):
                c.update(overlay=overlays.index('RUBBLE_OVERLAY'), overlayName='RUBBLE_OVERLAY', overlayData=0)
    seen = set()
    colors = rules.setdefault('COLORS', {})
    for item in plan['placements']:
        if not isinstance(item, dict):
            raise ValueError('放置对象格式无效')
        identifier, section, kind = item.get('id'), item.get('category'), item.get('type')
        if not isinstance(identifier, str) or not re.fullmatch(r'sim-[a-z0-9-]{1,64}', identifier) or identifier in seen or section not in ('STRUCTURES', 'UNITS', 'INFANTRY', 'TERRAIN', 'OVERLAY') or kind not in rules:
            raise ValueError('放置对象类型或编号无效')
        if section == 'UNITS' and kind not in ('MTNK','HYD','YHVR') or section == 'INFANTRY' and kind != 'E2':
            raise ValueError('不支持的模拟单位')
        for name in ('x', 'y', 'facing', 'subcell'):
            if type(item.get(name)) is not int:
                raise ValueError('放置坐标或方向无效')
        x, y, facing, subcell = (item[k] for k in ('x', 'y', 'facing', 'subcell'))
        if (x, y) not in cells or not 0 <= facing <= 255 or not 0 <= subcell <= 2 or type(item.get('onBridge')) is not bool:
            raise ValueError('放置坐标、方向或层级无效')
        seen.add(identifier)
        house = HOUSE
        color = item.get('regionColor')
        if color is not None:
            if (section != 'STRUCTURES' and kind not in ('MTNK', 'E2', 'HYD', 'YHVR') or not isinstance(color, str)
                    or not re.fullmatch(r'[0-9a-f]{6}', color)):
                raise ValueError('Invalid simulation region color')
            house += '_' + color.upper()
            content[house] = {'COLOR': house}
            colors[house] = 'stripe-3-region-' + color
        if section=='OVERLAY':
            if kind not in overlays or kind!='GAWALL' and not (re.fullmatch(r'(TIB|GOLD)\d+',kind) and yes(rules[kind].get('TIBERIUM','no'))):
                raise ValueError('不支持的模拟覆盖物')
            if dirty is None or (x,y) in dirty:
                cells[x,y].update(overlay=overlays.index(kind),overlayName=kind,overlayData=11 if yes(rules[kind].get('TIBERIUM','no')) else 0,simulationOverlay=identifier)
            continue
        if section=='TERRAIN':
            from realmap_parser import is_tree
            if not is_tree(kind,rules[kind]):raise ValueError('只允许放置树木地形物')
            content.setdefault('TERRAIN',{})[str(y*1000+x)]=kind
            continue
        if section == 'STRUCTURES':
            cfg = rules[kind]
            if (kind != 'NACNST' and (ini_integer(cfg.get('TECHLEVEL', '-1')) < 0 or not cfg.get('BUILDCAT'))
                    or not cfg.get('OWNER') or yes(cfg.get('WALL', 'no')) or cfg.get('POWERSUPBUILDING')):
                raise ValueError('只允许放置军事建筑')
            fields = [house, kind, '256', str(x), str(y), str(facing), 'None', '1', '0', '1', '0', '0', 'None', 'None', 'None', '0', '0']
        elif section == 'INFANTRY':
            fields = [house, kind, '256', str(x), str(y), str((3,4,2)[subcell]), 'Guard', str(facing), 'None', '0', '-1', '0', str(int(item['onBridge']))]
        else:
            fields = [house, kind, '256', str(x), str(y), str(facing), 'Guard', 'None', '0', '-1', '0', str(int(item['onBridge'])), '1', '0']
        content.setdefault(section, {})[identifier] = ','.join(fields)
    content[HOUSE] = {'COLOR': 'CRATE_ATLAS_SIMULATION_COLOR'}
    colors['CRATE_ATLAS_SIMULATION_COLOR'] = 'stripe-3-yellow-black-fixed'
    # Wall artwork uses the same four-neighbour topology as the editor model.
    wall_points={tuple(map(int,p.split(','))) for p in plan['overlays']}
    wall_points.update((o['x'],o['y']) for o in plan['placements'] if o['category']=='OVERLAY')
    wall_points.update((x+dx,y+dy) for x,y in list(wall_points) for dx,dy in ((0,-1),(1,0),(0,1),(-1,0)))
    for p in wall_points & cells.keys() if dirty is None else wall_points & dirty:
        c=cells[p]
        if not yes(rules.get(c.get('overlayName'),{}).get('WALL','no')):continue
        mask=sum(bit for dx,dy,bit in ((0,-1,1),(1,0,2),(0,1,4),(-1,0,8)) if cells.get((p[0]+dx,p[1]+dy),{}).get('overlay')==c['overlay'])
        c['overlayData']=(c['overlayData']&~15)|mask
    # Mineral-removal provenance must reflect the resulting overlay, not the original.
    for p in cells if dirty is None else dirty:
        c = cells[p]
        c['removable'] = [o for o in c['removable'] if o['category'] != 'mineral']
        if yes(rules.get(c['overlayName'], {}).get('TIBERIUM', 'no')):
            c['removable'].append(dict(category='mineral', type=c['overlayName']))
    return rubble



def foundation(art):
    value = re.fullmatch(r'(\d+)x(\d+)', art.get('FOUNDATION', '1x1'), re.I)
    if not value or any(not 1 <= int(v) <= 10 for v in value.groups()):
        raise ValueError('模拟建筑需要受支持的规则占地')
    return [(x, y) for x in range(int(value[1])) for y in range(int(value[2]))]


def changed_points(prepared, plan, previous):
    """Occupancy footprints plus bridge flags and reverse height-projection rays.

    No fixed 3x3 assumption: this only bounds layout rebuilding. Search retains
    its own stop-square dependency index, including distant rejected origins.
    """
    cells, rules, art = prepared['cells'], prepared['rules'], prepared['art']
    empty = dict(objects={}, overlays={}, placements=[])
    plan, previous = plan or empty, previous or empty
    points, bridge_points = set(), set()
    def footprint(section, kind, x, y):
        cfg = rules.get(kind, {})
        a = art.get(cfg.get('IMAGE', kind).upper(), {})
        shape = [(0, 0)]
        if section == 'STRUCTURES':
            match = re.fullmatch(r'(\d+)x(\d+)', a.get('FOUNDATION', '1x1'), re.I)
            if not match:
                match = re.fullmatch(r'(\d+)x(\d+)', a.get('FOUNDATION.X','1')+'x'+a.get('FOUNDATION.Y','1'))
            if match and all(1 <= int(n) <= 10 for n in match.groups()):
                shape = [(dx,dy) for dx in range(int(match[1])) for dy in range(int(match[2]))]
        points.update((x+dx,y+dy) for dx,dy in shape)
    try:
        old, new = previous['objects'], plan['objects']
        for name in old.keys() | new.keys():
            if old.get(name) == new.get(name): continue
            section, entry = name.split('/',1); line = prepared['m'][section][entry]
            if section == 'TERRAIN':
                footprint(section, line.upper(), int(entry)%1000, int(entry)//1000)
            else:
                fields = line.split(','); footprint(section, fields[1].upper(), int(fields[3]), int(fields[4]))
        old, new = ({p['id']:p for p in value['placements']} for value in (previous,plan))
        for name in old.keys() | new.keys():
            if old.get(name) == new.get(name): continue
            for item in (old.get(name),new.get(name)):
                if item:
                    footprint(item['category'],item['type'],item['x'],item['y'])
                    if item['category']=='OVERLAY':points.update((item['x']+dx,item['y']+dy) for dx,dy in ((0,-1),(1,0),(0,1),(-1,0)))
        from realmap_bridges import HIGH
        old, new = previous['overlays'], plan['overlays']
        for name in old.keys() | new.keys():
            if old.get(name) == new.get(name): continue
            p = tuple(map(int,name.split(','))); points.add(p)
            points.update((p[0]+dx,p[1]+dy) for dx,dy in ((0,-1),(1,0),(0,1),(-1,0)))
            for value in (old.get(name),new.get(name)):
                index = value[0] if value else cells[p]['overlay']
                if index in HIGH:
                    dx,dy = HIGH[index][1]
                    bridge_points.update((p[0]+step*dx,p[1]+step*dy) for step in (-1,0,1,2,3))
                else: bridge_points.add(p)
        points.update(bridge_points)
        for x,y in bridge_points:
            points.update((x-d,y-d) for d in range(1,7))
        return points & cells.keys()
    except (KeyError,TypeError,ValueError,IndexError):
        # Full validation in apply() still rejects invalid plans. Never make
        # malformed imports bypass validation by returning an empty dirty set.
        return set(cells)
