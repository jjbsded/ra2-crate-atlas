"""Discover directory resources at runtime; persist only the selected root."""
from functools import lru_cache
import json
from pathlib import Path
import re
import sys

from runtime_bootstrap import ROOT
from realmap_resources import Resources, THEATERS
from realmap_format import sha

sys.path.insert(0, str(ROOT/'resource_context'))
from ra2mod import Context, Resources as DirectoryResources

DIRECTORY_VERSIONS = ('directory', 'shikong')  # Compatibility with old reports only.
DISCOVERY_VERSION = 1


def profile_path():
    """Settings path; this file contains only the selected directory."""
    return ROOT/'data/game-directory.json'


def selected_root():
    path = profile_path()
    legacy = ROOT/'profiles/local.json'
    # Retain ONLY the old directory, never its fixed archive order or hashes.
    if not path.exists() and legacy.is_file():
        value = json.loads(legacy.read_text('utf-8-sig')).get('root', '')
        if not isinstance(value, str):
            raise ValueError('游戏目录应为文本')
        _save_root(value)
        legacy.unlink()
    if not path.is_file():
        return ''
    value = json.loads(path.read_text('utf-8-sig')).get('root', '')
    if not isinstance(value, str):
        raise ValueError('游戏目录应为文本')
    return value.strip()


def _save_root(value):
    path = profile_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps({'root': value}, ensure_ascii=False, indent=2), 'utf8')
    temp.replace(path)


def directory_manifest(root):
    root = Path(root).expanduser().resolve()
    if not root.is_dir():
        raise ValueError('游戏目录不存在；请选择包含 rules/art 或 MIX 资源包的游戏根目录')
    rows = []
    for p in root.iterdir():
        if p.is_file() and p.suffix.lower() in ('.mix', '.ini', '.shp', '.vxl', '.hva', '.pal',
                                               '.tem', '.sno', '.urb', '.ubn', '.des', '.lun', '.dll'):
            stat = p.stat()
            rows.append((p.name, stat.st_size, stat.st_mtime_ns))
        if len(rows) > 10000:
            raise ValueError('游戏根目录文件过多，请选择具体游戏目录')
    return str(root), tuple(sorted(rows, key=lambda row: row[0].lower()))


def archive_priority(name):
    name = name.lower()
    for rank, pattern in enumerate((r'expandmd(\d+)\.mix', r'expand(\d+)\.mix',
                                    r'ecachemd(\d+)\.mix', r'ecache(\d+)\.mix')):
        match = re.fullmatch(pattern, name)
        if match:
            return rank, -int(match[1]), name
    normal = ('langmd.mix', 'language.mix', 'ra2md.mix', 'ra2.mix',
              'localmd.mix', 'local.mix', 'cachemd.mix', 'cache.mix',
              'conqmd.mix', 'conquer.mix', 'genermd.mix', 'genericmd.mix', 'generic.mix',
              'isogenmd.mix', 'isogen.mix', 'cameomd.mix', 'cameo.mix')
    return (4, normal.index(name), name) if name in normal else (5, 0, name)


def discover(root):
    return _discover(*directory_manifest(root))


@lru_cache(maxsize=4)
def _discover(root, manifest):
    reader = DirectoryResources(root, [])
    mounts, issues, unknown = [], [], []
    nested = ['localmd.mix', 'local.mix', 'cachemd.mix', 'cache.mix',
              'conqmd.mix', 'conquer.mix', 'genermd.mix', 'genericmd.mix', 'generic.mix',
              'isogenmd.mix', 'isogen.mix', 'cameomd.mix', 'cameo.mix']
    for stem, ext, tilemix in THEATERS.values():
        nested.extend([*tilemix, stem+'md.mix', stem+'.mix', ext+'.mix'])
    nested = list(dict.fromkeys(nested))
    archives = [name for name, _, _ in manifest if name.lower().endswith('.mix')
                and not re.match(r'^(?:mov(?:ies|md)?|theme(?:md)?|audio(?:md)?|maps(?:md)?|multi(?:md)?)\d*\.mix$', name, re.I)]

    def mount(name, depth=0):
        if len(mounts) >= 512:
            raise ValueError('资源包数量超过自动发现上限 512')
        try:
            mix = reader.open_mount(name)
        except (OSError, ValueError) as error:
            issues.append(f'资源包无法读取，已跳过 {name}：{error}')
            return
        mounts.append(name)
        if depth < 2:
            for child in nested:
                if mix.member(child):
                    mount(name+'::'+child, depth+1)

    for name in sorted(archives, key=archive_priority):
        mount(name)
        if archive_priority(name)[0] == 5 and name.lower() not in nested:
            unknown.append(name)
    reader.mounts = [reader.open_mount(name) for name in mounts]
    engine = next((version for version, name in (('yr', 'rulesmd.ini'), ('ra2', 'rules.ini'))
                   if reader.candidates(name)), None)
    if not engine:
        raise ValueError('目录中未找到 rulesmd.ini / rules.ini（含 MIX 内部）；请选游戏根目录，而非地图文件夹')
    suffix = 'md' if engine == 'yr' else ''
    rules, art = 'rules'+suffix+'.ini', 'art'+suffix+'.ini'
    sources = {name: (items[0][0].label if (items := reader.candidates(name)) else None)
               for name in (rules, art)}
    if not sources[art]:
        issues.append(f'未找到 {art}；缺失定义的对象按未知物体处理，概率不保证准确')
    if unknown:
        issues.append('非常规命名的 MIX 作为末级候选读取，游戏是否加载及其优先级无法确认：'+', '.join(unknown))
    assumptions = ['自动发现顺序：散装文件优先；数字扩展包倒序；标准资源包；其他 MIX 作为末级候选。'
                   '同名文件只选首份，支持显式 #include；自定义启动器注入和扩展 DLL 的加载行为未验证。']
    config = dict(schema_version=1, root=root, include_mode='ares', search_order=mounts,
                  order_basis=dict(status='automatic-approximation', assumptions=assumptions),
                  rules=rules, art=art, csf=['ra2'+suffix+'.csf'], ares_stringtables=True)
    fingerprint = sha(json.dumps([DISCOVERY_VERSION, root, manifest, mounts], sort_keys=True).encode())
    return dict(config=config, engineVersion=engine, fingerprint=fingerprint,
                sources=sources, issues=issues, assumptions=assumptions, archiveCount=len(archives))


def status():
    value = ''
    try:
        value = selected_root()
        if not value:
            return dict(ready=False, configured=False, root='', reason='未设置游戏目录；原版与尤复可直接使用')
        found = discover(value)
        engine = '尤里的复仇' if found['engineVersion']=='yr' else '红色警戒 2'
        return dict(ready=True, configured=True, root=found['config']['root'], engineVersion=found['engineVersion'],
                    sources=found['sources'], warnings=found['issues'], archiveCount=found['archiveCount'],
                    reason=f'目录资源已就绪 · 自动识别为{engine}资源 · {found["archiveCount"]} 个 MIX · 近似概率，不保证准确')
    except (OSError, ValueError, TypeError, AttributeError) as error:
        return dict(ready=False, configured=bool(value), root=value, reason='目录资源无法读取：'+str(error))


def configure(root):
    if not isinstance(root, str):
        raise ValueError('游戏目录应为文本')
    value = str(Path(root.strip()).expanduser().resolve()) if root.strip() else ''
    if value:
        discover(value)  # Validate before replacing the previous setting.
    _save_root(value)
    legacy = ROOT/'profiles/local.json'
    if legacy.is_file():
        legacy.unlink()
    return status()


def discovery_for_report(meta):
    root = meta.get('resourceRoot') or selected_root()
    if not root:
        raise ValueError('该结果需要游戏目录资源，请设置目录并重新分析地图')
    found = discover(root)
    if meta.get('resourceFingerprint') and found['fingerprint'] != meta['resourceFingerprint']:
        raise ValueError('该结果对应的游戏资源已变化，请使用所选目录重新分析地图')
    return found


def root_for_report(meta):
    return discovery_for_report(meta)['config']['root']


class ModResources(Resources):
    def __init__(self, root, source):
        # Compatibility with callers passing a settings file; ignore its other keys.
        root = Path(root)
        if root.is_file() and root.suffix.lower() == '.json':
            root = Path(json.loads(root.read_text('utf-8-sig'))['root'])
        self.discovery = discover(root)
        self.context = Context(self.discovery['config'], source)
        self.rules = self.flatten('rules')
        self.art = self.flatten('art')
        self.rules_bytes = json.dumps(self.rules, sort_keys=True).encode()
        self.mix_paths = tuple(self.context.config['search_order'])
        self.version = self.discovery['engineVersion']
        self.art_hash = sha(json.dumps(self.art, sort_keys=True).encode())

    def flatten(self, domain):
        result = {}
        for layer in self.context.layers[domain]:
            doc = self.context.documents[layer['source']]
            for entry in doc.entries:
                name, key = entry.section.upper(), entry.key.upper()
                if name == '#INCLUDE' or name.endswith('PACK') or name in ('ISOMAPPACK5','PREVIEWPACK'):
                    continue
                section = result.setdefault(name, {})
                if key == '+':
                    key = str(max((int(k) for k in section if k.isdigit()), default=-1)+1)
                section[key] = entry.value
        return result

    def get(self, names, filename):
        found = self.context.resources.get(filename, required=False)
        if found:
            return found[0]
        raise ValueError('所选游戏目录中找不到 '+filename)


def preview(data, folder, filename, progress, minerals_enabled=True, resource_root=None):
    """Compatibility entry; new analysis callers use realmap.analyze."""
    from realmap import analyze_directory
    return analyze_directory(data, folder, filename, progress, minerals_enabled, resource_root)
