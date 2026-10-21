"""Offline official multiplayer catalog. Map bytes are selected by catalog ID."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent
DATA = ROOT/'official-maps'
VERSIONS = {'ra2': '原版', 'yr': '尤里'}
MODES = {'standard': '作战', 'megawealth': '巨富', 'duel': '抢地盘',
         'meatgrind': '生死斗', 'navalwar': '海战', 'teamgame': '小队联盟', 'cooperative': '合作'}


def display_name(name):
    # Player counts belong in the separate metadata line, not in search names.
    return re.sub(r'\s*[（(]\s*\d+\s*(?:[-－–~～]\s*\d+)?\s*[）)]\s*$', '', name).strip()


def group_maps(sources):
    groups = {}
    for source in sources:
        for mode in source['modes']:
            if mode not in MODES:
                continue
            # Unsupported model inputs must never be guessed equivalent.
            fingerprint = source.get('crateFingerprint') or source['version']+':'+source['file']
            group = (source['name'].casefold(), mode, fingerprint)
            groups.setdefault(group, []).append(source)
    entries = []
    for (name, mode, fingerprint), members in groups.items():
        # Do not merge two distinct same-version variants into one selectable map.
        by_version = {}
        for source in members:
            by_version.setdefault(source['version'], []).append(source)
        for i in range(max(map(len, by_version.values()))):
            variants = {v: items[i] for v, items in by_version.items() if i < len(items)}
            representative = variants.get('yr') or variants['ra2']
            version_tag = '' if len(variants) == 2 else '['+VERSIONS[next(iter(variants))]+']'
            identity = '|'.join([name, mode, fingerprint]+[v+':'+s['file'] for v,s in sorted(variants.items())])
            entries.append(dict(id=hashlib.sha256(identity.encode()).hexdigest()[:20],
                name=representative['name'], label=representative['name']+version_tag+'['+MODES[mode]+']',
                mode=mode, modeName=MODES[mode], variants=variants,
                shared=len(variants)==2, players=representative['players'],
                size=representative['size'], theater=representative['theater']))
    return sorted(entries, key=lambda e:(e['name'], list(MODES).index(e['mode']), e['label'],e['id']))


@lru_cache(maxsize=2)
def _catalog(path, size, modified):
    data = json.loads(Path(path).read_text('utf8'))
    if data.get('schemaVersion') != 1:
        raise ValueError('官方地图目录版本不受支持，请更新工具')
    return data


def catalog():
    path = DATA/'catalog.json'
    try:
        stat = path.stat()
        return _catalog(str(path), stat.st_size, stat.st_mtime_ns)
    except OSError as error:
        raise ValueError('官方地图包缺失，请完整解压工具包') from error


def select(map_id, version):
    if version not in VERSIONS:
        raise ValueError('官方地图只支持原版或尤里的复仇')
    entry = next((e for e in catalog()['maps'] if e['id'] == map_id), None)
    if entry is None or version not in entry['variants']:
        raise ValueError('地图或版本不在官方地图目录中，请重新选择')
    source = entry['variants'][version]
    if source.get('unsupportedReason'):
        raise ValueError('此官方地图暂不支持精确概率：'+source['unsupportedReason'])
    try:
        with zipfile.ZipFile(DATA/'maps.zip') as archive:
            member = archive.getinfo(source['path'])
            if not 0 < member.file_size <= 16*1024*1024:
                raise ValueError('官方地图尺寸无效')
            raw = archive.read(member)
    except (OSError, KeyError, zipfile.BadZipFile) as error:
        raise ValueError('官方地图包缺失或损坏，请完整解压工具包') from error
    if hashlib.sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('官方地图校验失败，请重新完整解压工具包')
    return raw, source['file'], dict(id=entry['id'], label=entry['label'], name=entry['name'],
        mode=entry['mode'], modeName=entry['modeName'], version=version, shared=entry['shared'],
        sourceArchive=source['archive'], sourceSha256=source['sha256'])
