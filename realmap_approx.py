"""Explicit user-selected heuristic: unknown landing cells fail and redraw.

Search ordering and finite retries use the existing integer solver. Precision
of that arithmetic does not establish accuracy of the assumed game state.
"""
from realmap_parser import CLIFF, LANDS, land_after, project_match
from realmap_bridges import elevated
from realmap_format import number, yes
from realmap_resources import resources


POLICY = 'unknown-landing-retry-v1'


def prepare(cells, res, theater, meta, reason=None):
    rules = theater['effectiveRules']
    base_version = 'ra2' if meta.get('engineVersion', meta['version']) == 'ra2' else 'yr'
    stock = resources(base_version).rules
    fallbacks = set()
    def numeric(section, key, default):
        try:
            return number(rules.get(section, {}).get(key, str(default)))
        except (ValueError, TypeError):
            fallbacks.add(f'[{section}] {key} 无法解释，使用 {default}')
            return default
    cliff = numeric('GENERAL', 'CLIFFBACKIMPASSABILITY', 2)
    if cliff not in (0, 1, 2):
        fallbacks.add('未知 CliffBackImpassability，使用原版模式 2')
        cliff = 2
    meta['cliffBackImpassability'] = int(cliff)
    unknown_cells = []
    for p, c in cells.items():
        causes = []
        if c.get('unknownObjects'):
            causes.append('不明物体：'+', '.join(sorted(set(c['unknownObjects']))))
        if c.get('terrainError') or c['rawLand'] is None:
            causes.append('未知地形：按普通平地参与搜索')
        cfg = rules.get(c['overlayName'], {}) if c['overlayName'] else None
        if c['overlay'] != 255 and not cfg:
            causes.append('未知覆盖物')
        raw = c['rawLand'] if c['rawLand'] is not None else 0
        c['higher'] = [[q[0], q[1], cells[q]['level']] for dx, dy in CLIFF
                       if (q := (p[0]+dx, p[1]+dy)) in cells and cells[q]['level'] >= c['level']+4]
        try:
            c['land'] = land_after(raw, c['slope'], cfg, c['higher'], int(cliff))
        except (ValueError, IndexError):
            c['land'] = raw
            causes.append('未知覆盖物地面规则：按原始地面参与搜索')
        if c['land'] == 10 or c['overlayName'] and 'TUNNEL' in c['overlayName']:
            causes.append('隧道规则未验证：按普通地面参与搜索')
            c['land'] = 0
        if cfg and yes(cfg.get('TIBERIUM', 'no')) and c['slope'] > 4:
            causes.append('复杂坡面预置矿石的加载规则未验证')
        if c['bridge'] and c['slope'] > 4:
            causes.append('复杂坡面桥梁的加载规则未验证')
        land = LANDS[c['land']].upper()
        for name in ('TRACK', 'FOOT', 'FLOAT'):
            default = number(stock[land].get(name, '0'))
            c[name.lower()] = numeric(land, name, default) != 0
        if elevated(c):
            c['track'] = c['foot'] = c['float'] = True
        c['wall'] = bool(cfg and yes(cfg.get('WALL', 'no')))
        # Keep known blockers, including another object on this same cell.
        # Unknown objects do not become blockers that redirect to a neighbor:
        # they remain candidates and fail only when selected for placement.
        c['occupiedGround'] = c.get('knownOccupiedGround', c['occupiedGround'])
        c['occupiedDeck'] = c.get('knownOccupiedDeck', c['occupiedDeck'])
        c['occupied'] = c['occupiedDeck'] if elevated(c) else c['occupiedGround']
        c['primary'] = project_match(cells, c)
        c['candidate'] = c['usable'] and not c['occupied'] and not c['wall']
        c['assumedRetry'] = bool(causes)
        c['retryAssumptions'] = causes
        c['ghostReason'] = 'terrain' if c['terrain'] else 'slope' if c['slope'] > 4 else None
        c['status'] = 'retry' if causes or c['overlay'] != 255 else 'ghost' if c['ghostReason'] else 'crate'
        c.update(postLand=None, rockTransition=False)
        if causes:
            unknown_cells.append([c['x'], c['y']])
    assumptions = [
        '不明物体所在格按可读地形参与附近搜索；选中该格时假定放箱失败并重抽，不生成实体箱。已知障碍、边界和地形通行条件仍生效。',
        '未知建筑有可读基础时使用该范围，否则仅计地图记录的原点一格；真实占地可能更大。',
        '未知地形按普通平地参与搜索，并在选中时重抽；无法定位的损坏对象记录和无法读取的覆盖物图层仍按告警省略。',
        '已知规则沿用原版搜索／放箱框架；未解析的 include、隧道行为及 Mod 扩展可能影响任意格子。未验证禁行风险。'
    ] + sorted(fallbacks)
    meta.update(previewOnly=False, partialAnalysis=True, approximate=True, probabilityQuality='approximate',
                approximation=dict(policy=POLICY, baseVersion=base_version, retryCells=unknown_cells,
                    retryCellCount=len(unknown_cells), assumptions=assumptions))
    if reason:
        meta['analysisError'] = reason
    meta['warnings'].insert(0, f'近似概率，不保证准确：{len(unknown_cells)} 格按不明内容重抽假设处理；其余可读内容继续计算。')
    if reason:
        meta['warnings'].append('切换近似计算的原因：'+reason)
    meta['warnings'].extend(assumptions)
