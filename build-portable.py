"""Build an offline Windows x64 folder from the installed, verified runtimes."""
from pathlib import Path
import argparse
import ast
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
import runtime_bootstrap

ROOT = Path(__file__).resolve().parent
APPLICATION_MODULES = (
    'server.py', 'map_jobs.py', 'map_results.py', 'region_navigation.py',
    'realmap_format.py', 'realmap_resources.py', 'realmap_parser.py', 'realmap_sprites.py',
    'realmap.py', 'realmap_bridges.py', 'realmap_exact.py', 'realmap_render.py', 'realmap_refresh.py',
    'realmap_3d.py', 'terrain_depth.py', 'realmap_objects.py', 'realmap_voxel.py',
    'realmap_mod.py', 'realmap_approx.py', 'original_resources.py',
    'official_maps.py', 'directory_picker.py', 'runtime_bootstrap.py', 'i18n_settings.py',
    'official_precomputed.py', 'official_render_cache.py', 'toy_codec.py',
    'map_storage.py', 'map_images.py',
)
EXTRA_FILES = ('voxel-worker.cs', 'realmap-search.c', 'requirements.txt', 'export.cjs')
DATA_FILES = (
    'examples/mp32s8.map', 'examples/xmp32s8.map', 'examples/cliff-demo.json',
    'docs/random-crate-generation.md', 'docs/bridge-crates.md', 'docs/stock-map-loading.md',
    'docs/random-crate-generation.en.md', 'docs/bridge-crates.en.md', 'docs/stock-map-loading.en.md',
    'resource_context/ra2map.py', 'resource_context/ra2mod.py',
    'lib/three-r160.min.js', 'lib/three-LICENSE.txt',
    'official-maps/catalog.json', 'official-maps/maps.zip',
    'runtime/voxel/CncVxlRenderText.dll', 'runtime/voxel/msvcp140.dll',
    'runtime/voxel/vcruntime140.dll', 'runtime/voxel/provenance.json',
    'runtime/voxel/FA2SPHE-project-LICENSE.txt', 'runtime/voxel/FA2SPHE-project-readme.txt',
    'output/realmap-tools/map-search.exe', 'output/realmap-tools/map-search.sha256',
    'output/realmap-tools/voxel-worker.exe', 'output/realmap-tools/voxel-worker.sha256',
)


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require_file(path):
    if not path.is_file() or not path.stat().st_size:
        raise ValueError('发布包缺少文件：'+str(path))


def frontend_files():
    # The Toy launcher needs a separately generated static map package. Do not
    # expose a non-working entry in the ordinary Windows portable installation.
    source_only = {'启动Toy网页版.cmd', '启动Toy现场计算实验版.cmd'}
    return sorted({p for pattern in ('*.js', '*.html', '*.css', '*.md', '*.cmd')
                   for p in ROOT.glob(pattern) if p.name not in source_only})


def validate_sources():
    """Fail before creating output if a refactor added an unpackaged module."""
    for name in (*APPLICATION_MODULES, *EXTRA_FILES):
        if not (ROOT/name).is_file():
            raise ValueError('发布包缺少源文件：'+name)
    for name in APPLICATION_MODULES:
        for node in ast.walk(ast.parse((ROOT/name).read_text('utf8'))):
            imports = [entry.name for entry in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) else []
            for module in imports:
                dependency = (module or '').split('.')[0]+'.py'
                if (ROOT/dependency).is_file() and dependency not in APPLICATION_MODULES:
                    raise ValueError(f'发布清单遗漏本地模块：{name} → {dependency}')
    for name in DATA_FILES:
        require_file(ROOT/name)
    precomputed_files()
    class Dependencies(HTMLParser):
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            name = attrs.get('src') if tag == 'script' else attrs.get('href') if tag == 'link' else None
            if name and not re.match(r'(?:https?:|data:|//)', name):
                require_file(ROOT/name.split('?')[0])
    for name in ('maps.html', 'index.html', 'cliff-demo.html'):
        require_file(ROOT/name)
        Dependencies().feed((ROOT/name).read_text('utf8'))
    tools = ROOT/'output/realmap-tools'
    voxel_digest = hashlib.sha256((ROOT/'voxel-worker.cs').read_text('utf8').encode('utf8')).hexdigest()
    for name, digest in (('map-search', checksum(ROOT/'realmap-search.c')), ('voxel-worker', voxel_digest)):
        if (tools/(name+'.sha256')).read_text('utf8').strip() != digest:
            raise ValueError('预编译程序与源码不匹配，请先重新编译：'+name)


def validate_runtimes(node, ffmpeg, node_license):
    for path in (node, ffmpeg, node_license, ROOT/'runtime/ffmpeg/build-version.txt'):
        require_file(path)
    deps = next((p for p in (node.parent/'node_modules/@napi-rs', node.parent.parent/'node_modules/@napi-rs') if p.is_dir()), None)
    if deps is None:
        raise ValueError('Node 旁缺少 @napi-rs/canvas 依赖')
    for name in ('canvas', 'canvas-win32-x64-msvc'):
        require_file(deps/name/'package.json')
    env = {k: v for k, v in os.environ.items() if k not in ('NODE_PATH', 'NODE_OPTIONS', 'CODEX_NODE_MODULES')}
    def run(command):
        result = subprocess.run(command, capture_output=True, text=True, encoding='utf8', errors='replace',
                                timeout=30, env=env, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise ValueError('运行环境检查失败：'+(result.stderr or result.stdout)[-1000:])
        return result.stdout
    run([str(node), '-e', 'const c=require(process.argv[1]); if(!c.createCanvas(2,2).toBuffer("image/png").length) process.exit(1)', str(deps/'canvas')])
    ffmpeg_version = run([str(ffmpeg), '-version'])
    recorded = (ROOT/'runtime/ffmpeg/build-version.txt').read_text('utf8')
    if ffmpeg_version.splitlines()[0] != recorded.splitlines()[0]:
        raise ValueError('FFmpeg 与随包版本记录不一致')
    provenance = json.loads((ROOT/'runtime/voxel/provenance.json').read_text('utf8'))
    for name, item in provenance['components'].items():
        if checksum(ROOT/'runtime/voxel'/name) != item['sha256']:
            raise ValueError('体素组件校验失败：'+name)
    return deps, {'node': run([str(node), '--version']).strip(), 'ffmpeg': ffmpeg_version.splitlines()[0]}


def copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    else:
        shutil.copy2(source, target)



def copy_stock_resources(target):
    # Validate and copy only the stock allowlist. Extra files in the local
    # assets directory must never leak Mod content into a release.
    from original_resources import resolve
    for source in resolve('yr'):
        source = Path(source)
        copy(source, target/'assets/original'/source.name)


def precomputed_files():
    """Only manifest-listed, verified gameplay data enters a release."""
    from official_precomputed import DATA, manifest, checked_blob
    index = manifest()
    if not index['layouts']:
        raise ValueError('官方预计算数据为空，请先构建')
    names = {'manifest.json'}
    for entry in index['layouts'].values():
        for kind in ('report', 'search'):
            name = entry[kind]
            if name not in names:
                checked_blob(DATA, name, entry[kind+'Sha256'])
                names.add(name)
    return [DATA/name for name in sorted(names)]


def archive_files(target, archive_format='both', seven_zip=None):
    formats = ('zip', '7z') if archive_format == 'both' else (archive_format,)
    if not set(formats) <= {'zip', '7z'}:
        raise ValueError('Archive format must be zip, 7z or both')
    paths = [target.with_name(target.name+'.'+suffix) for suffix in formats]
    if any(path.exists() for path in paths):
        raise ValueError('输出 ZIP 或 7z 已存在；请为每次构建选择新名称')
    tool = None
    if '7z' in formats:
        tool = seven_zip or shutil.which('7z') or Path(os.environ.get('ProgramFiles', 'C:/Program Files'))/'7-Zip/7z.exe'
        require_file(Path(tool))
    return paths, tool


def package_archives(target, archives, seven_zip):
    for archive in archives:
        if archive.suffix == '.zip':
            with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                for path in target.rglob('*'):
                    if path.is_file():
                        z.write(path, str(Path(target.name)/path.relative_to(target)))
        else:
            subprocess.run([str(seven_zip), 'a', '-t7z', '-m0=LZMA2', '-mx=7', '-md=32m', '-mmt=2',
                            '-ms=on', '-bd', '-bb0', str(archive), target.name], cwd=target.parent,
                           check=True, timeout=7200, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            subprocess.run([str(seven_zip), 't', '-bd', str(archive)], check=True, timeout=600,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        archive.with_suffix(archive.suffix+'.sha256').write_text(checksum(archive)+'  '+archive.name+'\n', 'utf8')


def build(target, node, ffmpeg, node_license, version='unreleased', archive_format='both', seven_zip=None):
    target = target.resolve()
    if target.exists():
        raise ValueError('输出目录已存在；请为每次构建选择新名称')
    archives, seven_zip = archive_files(target, archive_format, seven_zip)
    validate_sources()
    deps, runtime_versions = validate_runtimes(node, ffmpeg, node_license)
    from original_resources import resolve
    resolve('yr')  # Refuse to create a package without validated stock assets.
    target.mkdir(parents=True)
    for source in frontend_files():
        copy(source, target/source.name)
    for name in (*APPLICATION_MODULES, *EXTRA_FILES):
        copy(ROOT/name, target/name)
    for name in DATA_FILES:
        copy(ROOT/name, target/name)
    copy_stock_resources(target)
    for source in precomputed_files():
        copy(source, target/'official-precomputed'/source.name)
    # Optional directory settings and Mod profiles/assets are never packaged.
    python_root = Path(sys.base_prefix)
    py = target/'runtime/python'
    for source in python_root.iterdir():
        if source.is_file() and source.suffix.lower() in ('.exe','.dll','.txt'):
            copy(source, py/source.name)
    copy(python_root/'DLLs', py/'DLLs')
    shutil.copytree(python_root/'Lib', py/'Lib', ignore=shutil.ignore_patterns(
        'site-packages','__pycache__','*.pyc','test','tests','idlelib','tkinter','turtledemo','ensurepip'))
    packages = {'Pillow': ['PIL'], 'numpy': ['numpy','numpy.libs'],
                'ra2mix': ['ra2mix'], 'blowfish': ['blowfish.py'], 'lzokay': ['lzokay']}
    versions = {}
    for distribution, names in packages.items():
        dist = importlib.metadata.distribution(distribution)
        base = Path(dist.locate_file(''))
        for name in names:
            copy(base/name, py/'Lib/site-packages'/name)
        copy(Path(dist._path), py/'Lib/site-packages'/Path(dist._path).name)
        versions[distribution] = dist.version
    copy(node, target/'runtime/node/node.exe')
    for name in ('canvas','canvas-win32-x64-msvc'):
        copy(deps/name, target/'runtime/node/node_modules/@napi-rs'/name)
    copy(node_license, target/'runtime/node/LICENSE')
    copy(ffmpeg, target/'runtime/ffmpeg/ffmpeg.exe')
    copy(ROOT/'runtime/ffmpeg/build-version.txt', target/'runtime/ffmpeg/build-version.txt')
    # This installed FFmpeg is a GPLv3 build; preserve the same complete GPL text.
    gpl = next(Path(importlib.metadata.distribution('ra2mix')._path).rglob('LICENSE'))
    copy(gpl, target/'runtime/ffmpeg/COPYING.GPLv3')
    copy(ROOT/'third-party-notices.md', target/'runtime/THIRD-PARTY-NOTICES.md')
    (target/'portable-build.json').write_text(json.dumps({'version':version, 'builtAt':datetime.now(timezone.utc).isoformat(),
        'platform':'Windows x64','python':sys.version, **runtime_versions,
        'packages':versions,'resourcesIncluded':True,'voxelRendererIncluded':True},indent=2),encoding='utf-8')
    manifest = {p.relative_to(target).as_posix(): {'size':p.stat().st_size, 'sha256':checksum(p)}
                for p in sorted(target.rglob('*')) if p.is_file()}
    (target/'release-files.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), 'utf8')
    package_archives(target, archives, seven_zip)
    print(json.dumps({'folder':str(target),'archives':[dict(path=str(p),bytes=p.stat().st_size) for p in archives]}),flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--node',type=Path,required=True)
    parser.add_argument('--ffmpeg',type=Path,required=True)
    parser.add_argument('--node-license',type=Path,required=True)
    parser.add_argument('--version', default='unreleased')
    parser.add_argument('--archive-format', choices=('zip', '7z', 'both'), default='both')
    parser.add_argument('--seven-zip', type=Path)
    args = parser.parse_args()
    build(args.output,args.node,args.ffmpeg,args.node_license,args.version,args.archive_format,args.seven_zip)
