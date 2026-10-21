"""Map analysis orchestration and CLI; legacy imports remain compatible.

Format, resource and static-cell implementations live in dedicated modules.
Only this layer starts native probability search and assembles saved reports.
"""
import csv
import json
from pathlib import Path
import os
import shutil
import struct
import subprocess
import time
from runtime_bootstrap import ROOT
from realmap_exact import calculate, read_search
from realmap_bridges import elevated

# Compatibility exports for existing scripts. New internal consumers import
# the owning module directly instead of depending on this orchestration layer.
from realmap_format import sha, ini, yes, ini_integer, number, decode_lcw, decode_pack, lzokay
from realmap_resources import Resources, THEATERS, readmix, resources, _resources
from realmap_parser import (LANDS, TRANSLATION, CLIFF, clipped_rect, usable,
                            project_match, land_after, map_rules, parse_map)
from realmap_sprites import tile_parts, shp_frame

WORK = ROOT.parent.parent
TOOLS = ROOT/'output/realmap-tools'
GCC = os.environ.get('CRATE_CC') or shutil.which('gcc')


def run(args, timeout=120):
    result = subprocess.run([str(a) for a in args], capture_output=True, timeout=timeout,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError((result.stderr or result.stdout).decode('utf-8', 'replace')[-1800:])


def ensure_tools():
    TOOLS.mkdir(parents=True, exist_ok=True)
    for source, target, command in [
        ('realmap-search.c', 'map-search.exe', lambda s, t: [GCC, '-O3', '-std=c11', s, '-o', t]),
    ]:
        src, dst = ROOT / source, TOOLS / target
        stamp = dst.with_suffix('.sha256')
        digest = sha(src.read_bytes())
        if not dst.exists() or not stamp.exists() or stamp.read_text() != digest:
            if not GCC:
                raise ValueError('地图搜索程序缺失或源码版本不符。请使用完整便携包，或设置 CRATE_CC 指向 GCC。')
            run(command(src, dst))
            stamp.write_text(digest)


def render_ground(cells, res, theater, tmps, folder, meta, progress):
    from realmap_render import render
    return render(cells, res, theater, tmps, folder, meta, progress)


def clearance_risks(cells, folder, meta, rules, progress=lambda *args: None):
    """Search a separate, fully cleared layout; never change current probabilities.

    Clear supported buildings, ground units/infantry, Terrain and Tiberium.
    Keep other overlays, TMP, heights, slopes and rules. This is a conditional
    layout, not a simulation of destruction, debris or arbitrary game history.
    """
    grid = bytearray(262144)
    candidates = {}
    crate_rules = rules.get('CRATERULES', {})
    crate_names = [crate_rules.get('CRATEIMG', 'CRATE'), crate_rules.get('WATERCRATEIMG', 'WCRATE')]
    for p, c in cells.items():
        removed = c['removable']
        mineral = any(o['category'] == 'mineral' for o in removed)
        overlay_name = None if mineral else c['overlayName']
        cfg = rules.get(overlay_name, {}) if overlay_name else None
        land = land_after(c['rawLand'], c['slope'], cfg, c['higher'], meta['cliffBackImpassability'])
        cost = rules[LANDS[land].upper()]
        track, floating, foot = (number(cost.get(k, '0')) != 0 for k in ('TRACK', 'FLOAT', 'FOOT'))
        if elevated(c):
            track = floating = foot = True
        candidate = c['usable'] and not (cfg and yes(cfg.get('WALL', 'no')))
        key = p[1]*512+p[0]
        grid[key] = ((int(track) | (int(floating) << 1)) if candidate else 0) | (4 if c['primary'] else 0) | (8 if land == 2 else 0)
        post = land_after(c['rawLand'], c['slope'], rules[crate_names[int(land == 2)].upper()], c['higher'], meta['cliffBackImpassability'])
        post_cost = rules[LANDS[post].upper()]
        transition = bool(not elevated(c) and candidate and overlay_name is None and c['slope'] <= 4 and land != 3 and post == 3
                          and (track or foot) and number(post_cost.get('TRACK', '0')) == 0
                          and number(post_cost.get('FOOT', '0')) == 0)
        c['potentialMarked'] = False
        if removed or transition:
            c['clearance'] = dict(land=land, postLand=post, rockTransition=transition, supported=False)
        if transition:
            candidates[key] = c
    if candidates:
        progress('检查完全移除建筑、矿物、树木和单位后的潜在禁行格', 84)
        maximum = sum(meta['size'][2:])-1
        (folder/'clearance-grid.bin').write_bytes(grid)
        run([TOOLS/'map-search.exe', folder/'clearance-grid.bin', folder/'clearance-search.bin', maximum, min(maximum+1, 32)], 180)
        for origin, selected in enumerate(read_search(folder/'clearance-search.bin', maximum**2)):
            for index, key in enumerate(selected):
                c = candidates.get(key)
                if c is not None and not c['clearance']['supported']:
                    c['potentialMarked'] = not c['marked']
                    c['clearance'].update(supported=True, witness=dict(origin=[origin % maximum+1, origin//maximum+1],
                        candidateIndex=index, candidateCount=len(selected)))
    markers = [[c['x'], c['y']] for c in cells.values() if c['potentialMarked']]
    return markers, dict(model='all-supported-objects-cleared', probabilityComputed=False,
        description='假设地图预置建筑、矿物、树木／地形物及地面单位／步兵全部完全移除，且不留下废墟或新覆盖物；保持地形、高度、其他 Overlay 和规则不变。斜纹格在此布局有随机落箱路径，随后变为禁行；不表示当前出箱概率，也不推演实际拆除过程。',
        removedCellCount=sum(bool(c['removable']) for c in cells.values()))


def finish_preview(cells, res, theater, tmps, meta, folder, filename, progress, start, reason=None):
    """Publish useful geometry without giving unknown gameplay states a number."""
    meta.update(filename=Path(filename.replace('\\', '/')).name[:160], previewOnly=True,
                partialAnalysis=bool(reason or meta.get('loadIssues')), resourceFiles=[str(p) for p in res.mix_paths])
    if reason:
        meta['analysisError'] = reason
        meta['warnings'].insert(0, '部分加载：'+reason+'。已保留可读取的地形和对象；缺失规则可能影响全图的附近搜索及重抽，未计算概率或禁行风险。')
    for c in cells.values():
        c.update(probability=None, multiplier=None, oneAttemptProbability=None, terms=[], marked=False, potentialMarked=False)
    rendering = render_ground(cells, res, theater, tmps, folder, meta, progress)
    for missing in rendering.get('missingSprites', []):
        meta['loadIssues'].append(dict(message='地形物／覆盖物贴图未能绘制：'+missing, count=1, cells=[]))
    meta['partialAnalysis'] = bool(reason or meta['loadIssues'])
    meta['elapsedSeconds'] = round(time.perf_counter()-start, 3)
    report = dict(schemaVersion=3, model='partial-map-preview' if reason else 'mod-visual-preview',
        metadata=meta, rendering=rendering, probability=None, markers=[], zeroProbabilityRockCandidates=[],
        potentialMarkers=[], clearance=None, cells=list(cells.values()))
    (folder/'result.json').write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')), 'utf8')
    return report


def partial_preview(data, folder, version, filename, progress, mix_paths=None, minerals_enabled=True, reason=None):
    start = time.perf_counter()
    folder.mkdir(parents=True, exist_ok=True)
    progress('部分内容尚不支持，继续读取可用地形与对象', 10)
    cells, res, theater, tmps, meta = parse_map(data, folder, version, progress, mix_paths,
        visual_only=True, minerals_enabled=minerals_enabled)
    (folder/'source.map').write_bytes(data)
    from realmap_approx import prepare
    prepare(cells, res, theater, meta, reason)
    return finish_analysis(cells, res, theater, tmps, meta, folder, filename, progress, start)


def analyze_directory(data, folder, filename, progress, minerals_enabled=True, resource_root=None):
    from realmap_mod import ModResources, selected_root
    from realmap_approx import prepare
    root = resource_root or selected_root()
    if not root:
        raise ValueError('请在“游戏目录（可选）”中设置地图对应的游戏目录')
    start = time.perf_counter()
    folder.mkdir(parents=True, exist_ok=True)
    source = folder/'source.map'; source.write_bytes(data)
    progress('从所选游戏目录发现规则、art 和资源包', 5)
    res = ModResources(root, source)
    cells, res, theater, tmps, meta = parse_map(data, folder, res.version, progress,
        resource_context=res, visual_only=True, minerals_enabled=minerals_enabled)
    found = res.discovery
    meta.update(filename=Path(filename.replace('\\','/')).name[:160], resourceProfile='directory',
                previewOnly=True, version='directory', engineVersion=res.version, resourceFiles=list(res.mix_paths),
                resourceRoot=found['config']['root'], resourceFingerprint=found['fingerprint'],
                resourceSources=found['sources'], artSha256=res.art_hash)
    meta['warnings'] = ['目录资源：按可读规则套用原版搜索／放箱框架，未验证扩展 DLL 行为，概率仅供参考。',
                        '动画显示静态帧，未运行触发、任务或扩展 DLL。',
                        *found['assumptions'], *found['issues'], *meta['warnings']]
    for message in found['issues']:
        meta['loadIssues'].append(dict(message=message, count=1, cells=[]))
    for entry in res.context.issues:
        code = entry['code']
        if code == 'unresolved-include-or-root':
            message = '外部 INI 未找到或无法读取：'+entry.get('name', '未知')+'；仅使用成功加载的定义。'
        elif code in ('include-limit', 'include-cycle', 'ambiguous-include-list', 'unsupported-inheritance-or-list-syntax'):
            message = '规则解析采用近似处理：'+code+'；仅使用成功加载的定义。'
        else:
            continue
        meta['warnings'].append(message)
        meta['loadIssues'].append(dict(message=message, count=1, cells=[]))
    prepare(cells, res, theater, meta)
    report = finish_analysis(cells, res, theater, tmps, meta, folder, filename, progress, start)
    (folder/'resource-audit.json').write_text(json.dumps(dict(discovery=res.context.identity,
        sources=res.context.sources, issues=res.context.issues), ensure_ascii=False, indent=2), 'utf8')
    return report


def analyze(data, folder, version='yr', filename='map.yrm', progress=lambda *args: None, mix_paths=None, minerals_enabled=True, resource_root=None):
    if version in ('directory', 'shikong'):
        return analyze_directory(data, folder, filename, progress, minerals_enabled=minerals_enabled, resource_root=resource_root)
    start = time.perf_counter()
    folder.mkdir(parents=True, exist_ok=True)
    try:
        cells, res, theater, tmps, meta = parse_map(data, folder, version, progress, mix_paths, minerals_enabled=minerals_enabled)
    except (ValueError, OSError, struct.error) as error:
        # The preview repeats validation of the map core and compressed terrain.
        # Corrupt/non-map input still fails; unsupported model data can load.
        return partial_preview(data, folder, version, filename, progress, mix_paths,
                               minerals_enabled=minerals_enabled, reason=str(error))
    meta['resourceFiles'] = [Path(p).name for p in res.mix_paths]
    (folder/'source.map').write_bytes(data)
    return finish_analysis(cells, res, theater, tmps, meta, folder, filename, progress, start)


def finish_analysis(cells, res, theater, tmps, meta, folder, filename, progress, start):
    version = meta['version']
    approximate = bool(meta.get('approximate'))
    ensure_tools()
    meta.setdefault('resourceFiles', [str(p) for p in res.mix_paths])
    meta['filename'] = Path(filename.replace('\\', '/')).name[:160]
    grid = bytearray(262144)
    statuses = {}
    for p, c in cells.items():
        key = p[1]*512+p[0]
        grid[key] = ((int(c['track']) | (int(c['float']) << 1)) if c['candidate'] else 0) | (4 if c['primary'] else 0) | (8 if c['land'] == 2 else 0)
        statuses[key] = c['status']
    (folder / 'search-grid.bin').write_bytes(grid)
    maximum = sum(meta['size'][2:])-1
    progress(f'穷举 {maximum**2:,} 个初始坐标的原生顺序搜索', 48)
    run([TOOLS / 'map-search.exe', folder / 'search-grid.bin', folder / 'search.bin', maximum, min(maximum+1, 32)], 180)
    probability = calculate(read_search(folder/'search.bin', maximum**2), statuses, maximum**2, progress=progress)
    result_cells = probability.pop('cells')
    markers = []
    shadowed = []
    for p, c in cells.items():
        c.update(result_cells.get(p[1]*512+p[0], dict(probability=0, multiplier=0, oneAttemptProbability=0, terms=[])))
        c['marked'] = bool(c['rockTransition'] and c['terms'])
        if c['marked']:
            markers.append([p[0], p[1]])
        elif c['rockTransition'] and c['candidate'] and (c['track'] or c['float']):
            shadowed.append([p[0], p[1]])
    if approximate:
        potential, clearance = [], dict(model='unverified', probabilityComputed=False,
            description='近似计算仅估计落箱概率，尚未验证放箱后／清空对象后的禁行风险。')
        for c in cells.values():
            c['potentialMarked'] = False
    else:
        potential, clearance = clearance_risks(cells, folder, meta, theater['effectiveRules'], progress)
    rendering = render_ground(cells, res, theater, tmps, folder, meta, progress)
    if approximate:
        for missing in rendering.get('missingSprites', []):
            meta['loadIssues'].append(dict(message='地形物／覆盖物贴图未能绘制：'+missing, count=1, cells=[]))
    meta['elapsedSeconds'] = round(time.perf_counter()-start, 3)
    report = dict(schemaVersion=3 if approximate else 2, model='approximate-unknown-retry' if approximate else ('original-YR-1.001' if version == 'yr' else 'original-RA2-1.006')+'-static-next-crate', metadata=meta, rendering=rendering,
                  probability=probability, markers=markers, zeroProbabilityRockCandidates=shadowed,
                  potentialMarkers=potential, clearance=clearance, cells=list(cells.values()))
    (folder/'result.json').write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    with (folder/'cells.csv').open('w', encoding='utf-8-sig', newline='') as output:
        names = ['x', 'y', 'level', 'slope', 'rawLand', 'land', 'postLand', 'overlayName', 'terrain', 'occupied',
                 'occupiedGround', 'occupiedDeck', 'status', 'ghostReason',
                 'usable', 'primary', 'probability', 'multiplier', 'rockTransition', 'marked', 'potentialMarked', 'removable', 'clearance',
                 'approximate', 'assumedRetry', 'retryAssumptions']
        writer = csv.DictWriter(output, fieldnames=names, extrasaction='ignore'); writer.writeheader()
        writer.writerows({**c, 'approximate': approximate, 'retryAssumptions': json.dumps(c.get('retryAssumptions', []), ensure_ascii=False), 'removable': json.dumps(c['removable'], ensure_ascii=False),
                          'clearance': json.dumps(c.get('clearance'), ensure_ascii=False)} for c in cells.values())
    with (folder/'rock-cells.csv').open('w', encoding='utf-8-sig', newline='') as output:
        writer = csv.writer(output); writer.writerow(['X', 'Y', 'Level', 'Before', 'After', 'Probability', 'Multiplier', 'HigherNeighbors'])
        for p in markers:
            c = cells[tuple(p)]
            writer.writerow([*p, c['level'], LANDS[c['land']], LANDS[c['postLand']], c['probability'], c['multiplier'], json.dumps(c['higher'])])
    with (folder/'potential-rock-cells.csv').open('w', encoding='utf-8-sig', newline='') as output:
        writer = csv.writer(output)
        writer.writerow(['X', 'Y', 'Level', 'AfterClearance', 'AfterCrate', 'CurrentProbability', 'RemovedObjects', 'Witness', 'HigherNeighbors', 'Scenario'])
        for p in potential:
            c = cells[tuple(p)]; risk = c['clearance']
            writer.writerow([*p, c['level'], LANDS[risk['land']], LANDS[risk['postLand']], c['probability'],
                             json.dumps(c['removable'], ensure_ascii=False), json.dumps(risk['witness']), json.dumps(c['higher']), clearance['description']])
    return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('map', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--version', choices=['yr', 'ra2', 'directory'], default='yr')
    parser.add_argument('--ra2-mix', type=Path)
    parser.add_argument('--yr-mix', type=Path)
    args = parser.parse_args()
    mix_paths = None
    if args.ra2_mix or args.yr_mix:
        if not args.ra2_mix or args.version == 'yr' and not args.yr_mix:
            parser.error('RA2 需要 --ra2-mix；YR 同时需要 --ra2-mix 与 --yr-mix')
        mix_paths = (str(args.ra2_mix.resolve()),) + ((str(args.yr_mix.resolve()),) if args.version == 'yr' else ())
    report = analyze(args.map.read_bytes(), args.output, args.version, args.map.name, lambda text, pct: print(pct, text, flush=True), mix_paths)
    print(json.dumps(dict(metadata=report['metadata'], markers=report['markers'], probability={k:v for k,v in report['probability'].items() if k != 'exact'} if report['probability'] else None), ensure_ascii=False, indent=2))
