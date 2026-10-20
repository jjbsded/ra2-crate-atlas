"""Build an offline Windows x64 folder from the installed, verified runtimes."""
from pathlib import Path
import argparse
import importlib.metadata
import json
import shutil
import sys
import zipfile
import runtime_bootstrap

ROOT = Path(__file__).resolve().parent


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


def build(target, node, ffmpeg, node_license):
    from original_resources import resolve
    resolve('yr')  # Refuse to create a package without validated stock assets.
    voxel = ROOT/'runtime/voxel'
    for name in ('CncVxlRenderText.dll','msvcp140.dll','vcruntime140.dll'):
        if not (voxel/name).is_file():
            raise ValueError('便携包缺少体素组件：'+name)
    if target.exists():
        raise ValueError('输出目录已存在；请为每次构建选择新目录')
    target.mkdir(parents=True)
    for pattern in ('*.js', '*.html', '*.css', '*.md', '*.cmd'):
        for source in ROOT.glob(pattern):
            copy(source, target/source.name)
    for name in ('server.py','realmap.py','realmap_exact.py','realmap_render.py',
                 'realmap_objects.py','realmap_voxel.py','realmap_mod.py','voxel-worker.cs',
                 'original_resources.py','runtime_bootstrap.py','realmap-search.c','requirements.txt','export.cjs'):
        copy(ROOT/name, target/name)
    for name in ('examples','docs','resource_context'):
        copy(ROOT/name, target/name)
    copy_stock_resources(target)
    copy(voxel, target/'runtime/voxel')
    # Directory settings and Mod profiles/assets are not packaged.
    for name in ('map-search.exe','map-search.sha256'):
        copy(ROOT/'output/realmap-tools'/name, target/'output/realmap-tools'/name)
    worker = ROOT/'output/realmap-tools/voxel-worker.exe'
    if worker.is_file():
        copy(worker, target/'output/realmap-tools'/worker.name)
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
    deps = next((p for p in (node.parent/'node_modules/@napi-rs', node.parent.parent/'node_modules/@napi-rs') if p.is_dir()), None)
    if deps is None:
        raise ValueError('Node 旁缺少 @napi-rs/canvas 依赖')
    for name in ('canvas','canvas-win32-x64-msvc'):
        copy(deps/name, target/'runtime/node/node_modules/@napi-rs'/name)
    copy(node_license, target/'runtime/node/LICENSE')
    copy(ffmpeg, target/'runtime/ffmpeg/ffmpeg.exe')
    copy(ROOT/'runtime/ffmpeg/build-version.txt', target/'runtime/ffmpeg/build-version.txt')
    # This installed FFmpeg is a GPLv3 build; preserve the same complete GPL text.
    gpl = next(Path(importlib.metadata.distribution('ra2mix')._path).rglob('LICENSE'))
    copy(gpl, target/'runtime/ffmpeg/COPYING.GPLv3')
    copy(ROOT/'third-party-notices.md', target/'runtime/THIRD-PARTY-NOTICES.md')
    (target/'portable-build.json').write_text(json.dumps({'platform':'Windows x64','python':sys.version,
        'packages':versions,'resourcesIncluded':True,'voxelRendererIncluded':True,'sourceRoot':ROOT.name},indent=2),encoding='utf-8')
    archive = target.with_suffix('.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in target.rglob('*'):
            if p.is_file():
                z.write(p, str(Path(target.name)/p.relative_to(target)))
    print(json.dumps({'folder':str(target),'zip':str(archive),'bytes':archive.stat().st_size}),flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--node',type=Path,required=True)
    parser.add_argument('--ffmpeg',type=Path,required=True)
    parser.add_argument('--node-license',type=Path,required=True)
    args = parser.parse_args()
    build(args.output,args.node,args.ffmpeg,args.node_license)
