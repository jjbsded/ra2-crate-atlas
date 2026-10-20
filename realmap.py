"""Read-only original RA2/YR map analysis for the local crate probability tool.

Model: static file state, empty manager slot, independent uniform coordinate
draws, one uniformly distributed logic-frame residue shared by all retries.
Unsupported engine states are errors, never silently labelled exact.
"""
import base64
from collections import Counter
import contextlib
import csv
from functools import lru_cache
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
import os
import shutil
import runtime_bootstrap

from PIL import Image, ImageDraw
from realmap_exact import calculate, read_search

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parent.parent
TOOLS = ROOT / 'output' / 'realmap-tools'
GCC = os.environ.get('CRATE_CC') or shutil.which('gcc')
import ra2mix
import lzokay

LANDS = ['Clear', 'Road', 'Water', 'Rock', 'Wall', 'Tiberium', 'Beach', 'Rough', 'Ice', 'Railroad', 'Tunnel']
TRANSLATION = [0, 8, 8, 8, 8, 10, 9, 3, 3, 2, 6, 1, 1, 0, 7, 3]
CLIFF = [(0, -1), (-1, 0), (2, 2), (1, 1), (-1, 1), (1, -1)]
THEATERS = {
    'SNOW': ('snow', 'sno', ['isosnomd.mix', 'isosnow.mix']),
    'TEMPERATE': ('temperat', 'tem', ['isotemmd.mix', 'isotemp.mix']),
    'URBAN': ('urban', 'urb', ['isourbmd.mix', 'isourb.mix']),
    'NEWURBAN': ('urbann', 'ubn', ['isoubnmd.mix', 'isoubn.mix']),
    'DESERT': ('desert', 'des', ['isodesmd.mix', 'isodes.mix']),
    'LUNAR': ('lunar', 'lun', ['isolunmd.mix', 'isolun.mix']),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ini(data, strict=False):
    if isinstance(data, bytes):
        for encoding in ('utf-8-sig', 'cp936', 'cp1252'):
            try:
                data = data.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError('地图编码无法识别')
    result, current = {}, None
    for number, raw in enumerate(data.splitlines(), 1):
        line = raw.split(';', 1)[0].strip()
        if line.startswith('[') and line.endswith(']'):
            name = line[1:-1].strip().upper()
            if strict and name in result:
                raise ValueError(f'第 {number} 行有重复节 [{name}]，请先明确来源')
            current = result.setdefault(name, {})
        elif '=' in line and current is not None:
            key, value = line.split('=', 1)
            key = key.strip().upper()
            if strict and key in current:
                raise ValueError(f'第 {number} 行有重复键 {key}，无法无歧义计算')
            current[key] = value.strip()
    return result


def yes(value):
    return str(value).lower() in ('yes', 'true', '1')


def ini_integer(value):
    # YR 0x5276D0: $prefix / h suffix hex, otherwise C atoi (including "o" -> 0).
    value = str(value).strip()
    if value.startswith('$'):
        return int(value[1:], 16)
    if value.lower().endswith('h'):
        return int(value[:-1], 16)
    match = re.match(r'[+-]?\d+', value)
    return int(match[0]) if match else 0


def number(value):
    n = float(value.rstrip('%'))
    if not math.isfinite(n):
        raise ValueError('地形通行倍率不是有限数值')
    return n


def readmix(**kwargs):
    with contextlib.redirect_stdout(io.StringIO()):
        return ra2mix.read(**kwargs)


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


def decode_lcw(data, expected):
    """Bounded Westwood Format80 decoder, including overlapping copies."""
    pos, out = 0, bytearray()
    relative = bool(data and data[0] == 0)
    if relative:
        pos = 1
    def byte():
        nonlocal pos
        if pos >= len(data):
            raise ValueError('LCW 输入截断')
        result = data[pos]; pos += 1
        return result
    def word():
        return byte() | byte() << 8
    while pos < len(data):
        command = byte()
        if command == 0x80:
            break
        if command < 0x80:
            length = (command >> 4) + 3
            start = len(out) - (((command & 15) << 8) | byte())
        elif command < 0xC0:
            length = command & 63
            if len(out)+length > expected or pos+length > len(data):
                raise ValueError('LCW 字面数据越界')
            out.extend(data[pos:pos+length]); pos += length
            continue
        elif command == 0xFE:
            length, value = word(), byte()
            if len(out)+length > expected:
                raise ValueError('LCW 填充越界')
            out.extend([value]*length)
            continue
        else:
            length = word() if command == 0xFF else (command & 63)+3
            offset = word()
            start = len(out)-offset if relative else offset
        if start < 0 or start >= len(out) or len(out)+length > expected:
            raise ValueError('LCW 回溯越界')
        for i in range(length):
            out.append(out[start+i])
    if len(out) != expected or pos != len(data):
        raise ValueError('LCW 解码长度不符')
    return bytes(out)


def decode_pack(m, name, folder, required=True):
    cfg = m.get(name.upper())
    if not cfg:
        if required:
            raise ValueError(f'缺少 [{name}]')
        return None
    if any(not k.isdigit() for k in cfg):
        raise ValueError(f'[{name}] 中有非数字块键')
    try:
        packed = base64.b64decode(''.join(cfg[k] for k in sorted(cfg, key=int)), validate=True)
    except Exception as e:
        raise ValueError(f'[{name}] 的 Base64 无效') from e
    pos = total = 0
    while pos < len(packed):
        if pos + 4 > len(packed):
            raise ValueError(f'[{name}] 压缩头不完整')
        size, expanded = struct.unpack_from('<HH', packed, pos)
        if not size or not expanded or expanded > 8192 or pos + size + 4 > len(packed):
            raise ValueError(f'[{name}] 压缩块长度无效')
        total += expanded
        pos += size + 4
    if not 0 < total <= 4000000:
        raise ValueError(f'[{name}] 解压尺寸超限')
    raw = bytearray()
    pos = 0
    while pos < len(packed):
        size, expanded = struct.unpack_from('<HH', packed, pos)
        payload = packed[pos+4:pos+4+size]
        try:
            block = decode_lcw(payload, expanded) if name.startswith('Overlay') else lzokay.decompress(payload, expanded)
        except Exception as error:
            raise ValueError(f'[{name}] 压缩数据损坏：{error}') from error
        if len(block) != expanded:
            raise ValueError(f'[{name}] 块输出长度不符')
        raw.extend(block)
        pos += size+4
    if len(raw) != total:
        raise ValueError(f'[{name}] 解压长度不一致')
    (folder / (name + '.bin')).write_bytes(raw)
    return bytes(raw)


class Resources:
    def __init__(self, version, mix_paths):
        self.version = version
        self.mix_paths = mix_paths
        self.archives = [readmix(mix_filepath=mix_paths[0])]
        if version == 'yr':
            self.archives.insert(0, readmix(mix_filepath=mix_paths[1]))
        self.mix_cache = {}
        suffix = 'md' if version == 'yr' else ''
        local = self.mix('local' + suffix + '.mix')
        self.rules_bytes = local['rules' + suffix + '.ini']
        self.rules = ini(self.rules_bytes)
        self.art = ini(local['art' + suffix + '.ini'])

    def mix(self, name):
        if name not in self.mix_cache:
            data = next((m[name] for m in self.archives if name in m), None)
            self.mix_cache[name] = readmix(mix_data=data) if data else {}
        return self.mix_cache[name]

    def get(self, names, filename):
        for name in names:
            mix = self.mix(name)
            if filename in mix:
                return mix[filename]
        raise ValueError(f'原版资源中找不到 {filename}')

    def theater(self, name):
        if name not in THEATERS or self.version == 'ra2' and name in ('NEWURBAN', 'DESERT', 'LUNAR'):
            raise ValueError(f'所选游戏版本不支持气候 {name}')
        stem, ext, tilemix = THEATERS[name]
        suffix = 'md' if self.version == 'yr' else ''
        cfgbytes = self.get(['local'+suffix+'.mix'], stem+suffix+'.ini')
        cfg = ini(cfgbytes)
        definitions = []
        for key in sorted((k for k in cfg if re.fullmatch(r'TILESET\d+', k)), key=lambda k: int(k[7:])):
            section = cfg[key]
            for n in range(1, ini_integer(section.get('TILESINSET', 0)) + 1):
                definitions.append((key, section['FILENAME'].lower()+f'{n:02d}.'+ext, section.get('SETNAME', key)))
        return dict(name=name, stem=stem, ext=ext, tilemix=tilemix, config=cfg, definitions=definitions,
                    configSha256=sha(cfgbytes), palette=self.get(['cachemd.mix', 'cache.mix'], 'iso'+ext+'.pal'))


@lru_cache(maxsize=2)
def _resources(version, mix_paths):
    return Resources(version, mix_paths)


def resources(version, mix_paths=None):
    from original_resources import resolve
    return _resources(version, tuple(mix_paths) if mix_paths else resolve(version))


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
    for step in range(1, 224):
        xx, yy = x*256+1664-8*step, y*256+1664-8*step
        q = (int(xx/256), int(yy/256))
        other = cells.get(q)
        diff = (other['level'] if other else 0) - level
        if int((xx-diff*128)/256) <= x and int((yy-diff*128)/256) <= y or q == (x, y):
            return q == (x, y)
    raise ValueError('投影迭代未收敛')


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


def parse_map(data, folder, version, progress=lambda *args: None, mix_paths=None, resource_context=None, visual_only=False):
    if not data or len(data) > 16*1024*1024 or b'\x00' in data:
        raise ValueError('请选择 16 MB 以内的文本 .map／.yrm／.mpr 地图')
    m = ini(data, True)
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
    rules, additions = (res.rules, []) if visual_only else map_rules(m, res, warnings)
    if m.get('AIRCRAFT') and version != 'yr':
        raise ValueError('RA2 预置飞机的加载状态尚未核对；当前仅支持 YR 的初始地面飞机占用')
    cliff_mode = int(rules['GENERAL'].get('CLIFFBACKIMPASSABILITY', '0'))
    if not visual_only and cliff_mode not in (0, 1, 2):
        raise ValueError('未知 CliffBackImpassability')
    crate_rules = rules.get('CRATERULES', {})
    crate_minimum = ini_integer(crate_rules.get('CRATEMINIMUM', '1'))
    crate_maximum = ini_integer(crate_rules.get('CRATEMAXIMUM', '255'))
    if crate_maximum == 0:
        warnings.append('地图规则设置 CrateMaximum=0，常规随机箱数量受限。此图展示“有空闲箱子槽且执行一次随机放箱调用”的条件落点概率，不表示对局会自动刷箱。')
    crate_names = [crate_rules.get('CRATEIMG', 'CRATE'), crate_rules.get('WATERCRATEIMG', 'WCRATE')]
    for name in crate_names:
        cfg = rules.get(name.upper())
        if not visual_only and (not cfg or not yes(cfg.get('CRATE', 'no')) or yes(cfg.get('WALL', 'no'))):
            raise ValueError('当前不支持被改为非普通 Overlay 的箱子类型')
    if not visual_only:
        ensure_tools()
    progress('解压 IsoMapPack5、OverlayPack 与 OverlayDataPack', 22)
    raw = decode_pack(m, 'IsoMapPack5', folder)
    overlay = decode_pack(m, 'OverlayPack', folder, False)
    overlay_data = decode_pack(m, 'OverlayDataPack', folder, False)
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
    for y in range(1, w+h):
        for x in range(1, w+h):
            if not inside(x, y):
                continue
            tile, sub, level, ice = records.get((x, y), (65535, 0, 0, 0))
            ti = 0 if tile >= 65535 else tile
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
            ov = overlay[x+y*512]
            if ov != 255 and ov >= len(overlays):
                raise ValueError(f'未知 Overlay {ov}')
            ovname = overlays[ov] if ov != 255 else None
            # A bridge is a layered runtime object, not just Water or Road.
            if not visual_only and ('bridge' in setlabel.lower() or land == 10 or ovname and any(s in ovname for s in ('BRIDGE', 'BRDG', 'TUNNEL'))):
                raise ValueError(f'({x},{y}) 含桥梁或隧道；分层通行尚未验证，已停止精确计算')
            cfg = rules.get(ovname, {}) if ovname else None
            if not visual_only and cfg and yes(cfg.get('TIBERIUM', 'no')) and slope:
                raise ValueError(f'({x},{y}) 在斜坡预放矿石；加载期矿石重算顺序尚未验证')
            cells[x, y] = dict(x=x, y=y, level=level, slope=slope, tileIndex=tile, subTile=sub,
                file=filename, rawLand=land, overlay=ov, overlayName=ovname, overlayData=overlay_data[x+y*512],
                objects=[], removable=[], terrain=None, occupied=False, higher=[], usable=False)
            if cfg and yes(cfg.get('TIBERIUM', 'no')):
                cells[x, y]['removable'].append(dict(category='mineral', type=ovname))
    progress('重建格子属性、占用和高度投影', 35)
    for key, kind in m.get('TERRAIN', {}).items():
        p = int(key) % 1000, int(key) // 1000
        if p not in cells:
            raise ValueError(f'Terrain 坐标不在地图内：{p}')
        kind = kind.upper()
        if not visual_only and kind not in rules:
            raise ValueError('未找到 Terrain 类型 '+kind)
        cfg = rules.get(kind, {})
        art = res.art.get(cfg.get('IMAGE', kind).upper(), {})
        if not visual_only and art.get('FOUNDATION', '1x1').lower() != '1x1':
            raise ValueError('尚未验证非 1×1 Terrain 基础：'+kind)
        bits = int(cfg.get('SNOWOCCUPATIONBITS' if theater['name'] == 'SNOW' else 'TEMPERATEOCCUPATIONBITS', '7'))
        c = cells[p]
        c['terrain'] = kind
        c['occupied'] |= bool(bits & 7)
        c['objects'].append(kind)
        c['removable'].append(dict(category='terrain', type=kind))
    for section in ('STRUCTURES', 'UNITS', 'INFANTRY', 'AIRCRAFT'):
        for record in m.get(section, {}).values():
            fields = record.split(',')
            if len(fields) < 5:
                raise ValueError(f'[{section}] 对象记录不完整')
            kind = fields[1].upper()
            p = int(fields[3]), int(fields[4])
            if (not visual_only and kind not in rules) or p not in cells:
                raise ValueError(f'[{section}] 未知对象或无效坐标：{kind} {p}')
            cfg = rules.get(kind, {})
            art = res.art.get(cfg.get('IMAGE', kind).upper(), {})
            if not visual_only and section == 'STRUCTURES' and not art:
                raise ValueError('建筑缺少有效的原版 art 基础定义：'+kind)
            foundation = art.get('FOUNDATION', '1x1') if section == 'STRUCTURES' else '1x1'
            match = re.fullmatch(r'(\d+)x(\d+)', foundation, re.I)
            if visual_only and not match:
                match = re.fullmatch(r'(\d+)x(\d+)', art.get('FOUNDATION.X', '1')+'x'+art.get('FOUNDATION.Y', '1'))
            if not match or not all(1 <= int(n) <= 10 for n in match.groups()):
                raise ValueError('未验证的建筑基础：'+kind+'/'+foundation)
            if not visual_only and (yes(cfg.get('GATE', 'no')) or yes(cfg.get('ISVEINHOLE', 'no'))):
                raise ValueError('尚未验证闸门／特殊对象的占用：'+kind)
            for dx in range(int(match[1])):
                for dy in range(int(match[2])):
                    q = p[0]+dx, p[1]+dy
                    if q not in cells:
                        if visual_only:
                            continue
                        raise ValueError('建筑基础超出地图：'+kind)
                    cells[q]['occupied'] = True
                    cells[q]['objects'].append(kind)
                    cells[q]['removable'].append(dict(category='building' if section == 'STRUCTURES' else 'unit', type=kind))
    if m.get('AIRCRAFT'):
        warnings.append(f'已按 YR 地图加载时的地面位置计入 {len(m["AIRCRAFT"])} 架预置飞机（1×1 占用）；未推进巡逻、起飞或触发任务。')
    for p, c in cells.items():
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
        c['wall'] = bool(cfg and yes(cfg.get('WALL', 'no')))
        c['primary'] = project_match(cells, c)
        c['candidate'] = c['usable'] and not c['occupied'] and not c['wall']
        c['status'] = 'retry' if c['overlay'] != 255 else 'ghost' if c['slope'] > 4 else 'crate'
        crate_cfg = rules[crate_names[int(c['land'] == 2)].upper()]
        c['postLand'] = land_after(c['rawLand'], c['slope'], crate_cfg, c['higher'], cliff_mode)
        post_cost = rules[LANDS[c['postLand']].upper()]
        c['rockTransition'] = (c['land'] != 3 and c['postLand'] == 3 and c['status'] == 'crate'
                               and (c['track'] or c['foot']) and number(post_cost.get('TRACK', '0')) == 0
                               and number(post_cost.get('FOOT', '0')) == 0)
    if m.get('TRIGGERS') or m.get('EVENTS') or m.get('ACTIONS'):
        warnings.append('仅计算地图文件的静态对象状态；未运行地图触发、脚本或开局事件。')
    warnings.extend(['分析下一次放箱调用，假定有空闲箱子槽；未加入游戏自动出生单位、移动单位或后续矿石生长。',
                     '使用原版 MIX 资源；不自动加载 loose INI、Ares／Phobos、expand 包或房间规则。',
                     'Rock 标记描述落箱后属性改变，不把普通孤立高原或单纯寻路不通标为异常。'])
    theater['effectiveRules'] = rules
    from realmap_objects import records as object_records
    theater['mapObjects'] = object_records(m)
    theater['mapHouses'] = {o['house']: m[o['house']] for o in theater['mapObjects'] if o['house'] in m}
    return cells, res, theater, tmp_cache, dict(size=size, localSize=local, visibleRect=rect,
        theater=theater['name'], version=version, cliffBackImpassability=cliff_mode,
        decodedRecords=len(records), cellCount=len(cells), warnings=warnings,
        sourceSha256=sha(data), rulesSha256=sha(res.rules_bytes), theaterSha256=theater['configSha256'],
        mapTypeAdditions=additions, initialAircraftCount=len(m.get('AIRCRAFT', {})),
        crateLimits=dict(minimum=crate_minimum, maximum=crate_maximum),
        name=m.get('BASIC', {}).get('NAME', '导入地图'), waypoints=m.get('WAYPOINTS', {}))


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
        candidate = c['usable'] and not (cfg and yes(cfg.get('WALL', 'no')))
        key = p[1]*512+p[0]
        grid[key] = ((int(track) | (int(floating) << 1)) if candidate else 0) | (4 if c['primary'] else 0) | (8 if land == 2 else 0)
        post = land_after(c['rawLand'], c['slope'], rules[crate_names[int(land == 2)].upper()], c['higher'], meta['cliffBackImpassability'])
        post_cost = rules[LANDS[post].upper()]
        transition = bool(candidate and overlay_name is None and c['slope'] <= 4 and land != 3 and post == 3
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


def analyze(data, folder, version='yr', filename='map.yrm', progress=lambda *args: None, mix_paths=None):
    if version == 'directory':
        from realmap_mod import preview
        return preview(data, folder, filename, progress)
    start = time.perf_counter()
    folder.mkdir(parents=True, exist_ok=True)
    cells, res, theater, tmps, meta = parse_map(data, folder, version, progress, mix_paths)
    meta['resourceFiles'] = [Path(p).name for p in res.mix_paths]
    (folder/'source.map').write_bytes(data)
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
    potential, clearance = clearance_risks(cells, folder, meta, theater['effectiveRules'], progress)
    rendering = render_ground(cells, res, theater, tmps, folder, meta, progress)
    meta['elapsedSeconds'] = round(time.perf_counter()-start, 3)
    report = dict(schemaVersion=2, model=('original-YR-1.001' if version == 'yr' else 'original-RA2-1.006')+'-static-next-crate', metadata=meta, rendering=rendering,
                  probability=probability, markers=markers, zeroProbabilityRockCandidates=shadowed,
                  potentialMarkers=potential, clearance=clearance, cells=list(cells.values()))
    (folder/'result.json').write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    with (folder/'cells.csv').open('w', encoding='utf-8-sig', newline='') as output:
        names = ['x', 'y', 'level', 'slope', 'rawLand', 'land', 'postLand', 'overlayName', 'terrain', 'occupied',
                 'usable', 'primary', 'probability', 'multiplier', 'rockTransition', 'marked', 'potentialMarked', 'removable', 'clearance']
        writer = csv.DictWriter(output, fieldnames=names, extrasaction='ignore'); writer.writeheader()
        writer.writerows({**c, 'removable': json.dumps(c['removable'], ensure_ascii=False),
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
