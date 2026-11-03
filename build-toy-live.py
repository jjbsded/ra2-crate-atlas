"""Publish the sole Toy product, with official results and local map analysis."""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import re
import runtime_bootstrap
from realmap_resources import resources, THEATERS
from realmap_parser import TRANSLATION
import toy_live_materials
import toy_live_search
import toy_live_objects
from toy_original import capture_stamp
from realmap_voxel_lighting import MODEL
from toy_artwork import unit_visual_symbols

ROOT = Path(__file__).resolve().parent


def stock(output):
    summary = {}
    for version in ('ra2', 'yr'):
        res = resources(version)
        data = dict(version=version, visualFields=toy_live_materials.VISUAL, unitSymbols=unit_visual_symbols(res.rules, res.art), rules=res.rules, art=res.art,
                    rulesSha256=hashlib.sha256(res.rules_bytes).hexdigest(), theaters={})
        for name in THEATERS:
            if version == 'ra2' and name not in ('SNOW', 'TEMPERATE', 'URBAN'):
                continue
            theater = res.theater(name)
            files = {}
            definitions = []
            for _, filename, _ in theater['definitions']:
                if filename not in files:
                    try:
                        raw = res.get(theater['tilemix'], filename)
                        nx, ny, width, height = struct.unpack_from('<4I', raw)
                        assert (width, height) == (60, 30) and nx*ny <= 10000
                        parts = []
                        for sub in range(nx*ny):
                            offset, = struct.unpack_from('<I', raw, 16+4*sub)
                            parts.append([TRANSLATION[raw[offset+41]], raw[offset+42]] if offset and offset+952 <= len(raw) else None)
                        files[filename] = parts
                    except (ValueError, AssertionError, IndexError, struct.error):
                        files[filename] = None
                definitions.append(filename)
            data['theaters'][name] = dict(definitions=definitions, tiles=files, sha256=theater['configSha256'])
        payload=gzip.compress(json.dumps(data,separators=(',', ':'),ensure_ascii=False).encode(),9,mtime=0)
        (output/f'stock-{version}.json.gz').write_bytes(payload)
        summary[version] = len(payload)
    return summary


def build(args):
    source=args.source.resolve();out=args.output.resolve()
    source_manifest=json.loads((source/'build-manifest.json').read_text('utf8'))
    if source_manifest.get('artworkStyle')!='original' or source_manifest.get('liveAnalysisExperiment'):
        raise ValueError('Use the internal original-art build stage as the source')
    if source_manifest.get('voxelLightingModel')!=MODEL or source_manifest.get('artworkSourceSha256')!=capture_stamp():
        raise ValueError('Rebuild the internal artwork stage with the current painter before publishing Toy')
    for name,checksum in source_manifest['files'].items():
        path=(source/name).resolve()
        assert path.is_relative_to(source) and hashlib.sha256(path.read_bytes()).hexdigest()==checksum,'Source package changed: '+name
    if out==source or out.is_relative_to(source) or source.is_relative_to(out):
        raise ValueError('Use a separate non-nested output directory')
    if not out.exists():shutil.copytree(source,out)
    elif not (out/'build-manifest.json').is_file():raise ValueError('Output is not a Toy build')
    else:
        previous=json.loads((out/'build-manifest.json').read_text('utf8'))
        if any(previous.get(key)!=source_manifest.get(key) for key in ('modelSourceSha256','artworkSourceSha256')):
            raise ValueError('Output contains an older base/atlas set; choose a new output directory')
    # Refresh shared UI even when reusing the final output directory. Analysis
    # data and anchored searches below have their own cache/rebuild rules.
    for path in source.iterdir():
        if path.is_file() and path.suffix in ('.html', '.js', '.css'):
            shutil.copy2(path,out/path.name)
    directory=out/'live';directory.mkdir(exist_ok=True)
    sizes=stock(directory)
    def cached_step(module, target, callback):
        stamp=out.with_name(out.name+'-'+target+'.stamp')
        digest=hashlib.sha256(Path(module.__file__).read_bytes()+(source/'build-manifest.json').read_bytes()).hexdigest()
        if not stamp.is_file() or stamp.read_text('utf8')!=digest or not (directory/'materials.json.gz').is_file():
            callback();stamp.write_text(digest,'utf8')
    cached_step(toy_live_materials,'materials',lambda:toy_live_materials.build(source,directory,args.cache.resolve()))
    cached_step(toy_live_search,'search',lambda:toy_live_search.build(source,out))
    objects=directory/'objects';objects.mkdir(exist_ok=True)
    object_stamp=out.with_name(out.name+'-objects.stamp')
    object_digest=hashlib.sha256(Path(toy_live_objects.__file__).read_bytes()+toy_live_objects.frame_stamp().encode()+(directory/'materials.json.gz').read_bytes()).hexdigest()
    if not (objects/'index.json.gz').is_file() or not object_stamp.is_file() or object_stamp.read_text('utf8')!=object_digest:
        toy_live_objects.build(objects,args.object_cache.resolve());object_stamp.write_text(object_digest,'utf8')
    for path in (ROOT/'toy-live').iterdir():
        if path.is_file():shutil.copy2(path,directory/path.name)
    (out/'about.html').write_text((directory/'guide.html').read_text('utf8').replace('href="../','href="'),'utf8')
    # Adapt the shared full-edition UI for browser-local Toy analysis.
    html=(source/'maps.html').read_text('utf8')
    html=html.replace('<script src="realmap-ui.js', '<script src="live/mixed-painter.js"></script><script src="live/objects.js"></script><script src="live/artwork.js"></script><script src="live/platform.js"></script><script src="realmap-ui.js',1)
    html=html.replace('</body>','<script src="live/page.js"></script></body>')
    (out/'maps.html').write_text(html,'utf8')
    ui=(source/'realmap-ui.js').read_text('utf8')
    old="if(!official)throw Error(_t('此地图版本不在当前预计算列表中。'));"
    assert old in ui
    ui=ui.replace(old,"if(file&&platform.upload){await loadResult(await platform.upload(file,$('version').value,state.data?.metadata.mineralsEnabled!==false,status=>{message(status.message);$('progress').value=status.progress;}),true);return;}"+old)
    ui=ui.replace("platform?_t('预计算地图已加载')", "platform?(data.metadata.liveComputed?_t('本地计算完成 / Local analysis complete'):_t('预计算地图已加载'))")
    (out/'realmap-ui.js').write_text(ui,'utf8')
    reader=(source/'map-results.js').read_text('utf8').replace('if(data.rendering.original){', 'if(data.metadata.liveComputed){({im,objectImage}=await root.CrateLiveArtwork.create(data,{signal}));}else if(data.rendering.original){',1)
    (out/'map-results.js').write_text(reader,'utf8')
    shutil.copy2(ROOT/'map-details.js',out/'map-details.js')
    shutil.copy2(ROOT/'i18n-en.js',out/'i18n-en.js')
    original=(source/'original-artwork.js').read_text('utf8').replace('root.CrateToyOriginal={create,get,sprite,canvas,', 'root.CrateToyOriginal={create,get,sprite,canvas,page,makeSource,register:(report,scene)=>scenes.set(report,scene),')
    original=original.replace('function paint(ctx,indices){for', 'function paint(ctx,indices){if(scene.paint){scene.paint(ctx,indices,sequence);return;}for')
    (out/'original-artwork.js').write_text(original,'utf8')
    (out/'static-codec.js').write_text((source/'static-codec.js').read_text('utf8')+'\n'+(directory/'search-codec.js').read_text('utf8'),'utf8')
    # Version every changed import, including worker dependencies. The site can
    # be replaced at the same Toy URL without mixing old code and new encoding.
    def version(path):return hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    worker=(source/'data-worker.js').read_text('utf8').replace("'static-codec.js'", "'static-codec.js?v="+version(out/'static-codec.js')+"'")
    (out/'data-worker.js').write_text(worker,'utf8')
    worker=(directory/'worker.js').read_text('utf8')
    stock_versions=json.dumps({v:version(directory/f'stock-{v}.json.gz') for v in ('ra2','yr')})
    worker=worker.replace("'stock-'+version+'.json.gz'","'stock-'+version+'.json.gz?v='+"+stock_versions+"[version]")
    worker=re.sub(r"'([^']+\.js)'",lambda m:"'"+m[1]+'?v='+version(directory/m[1])+"'",worker)
    (directory/'worker.js').write_text(worker,'utf8')
    boot=(source/'toy-boot.js').read_text('utf8')
    revision=hashlib.sha256(b''.join(p.read_bytes() for p in sorted(directory.rglob('*')) if p.is_file())).hexdigest()[:12]
    boot+='\nObject.assign(CrateWebConfig,'+json.dumps(dict(workerVersion=version(out/'data-worker.js'),catalogVersion=revision,liveVersion=revision))+');\n'
    (out/'toy-boot.js').write_text(boot,'utf8')
    def asset_version(match):
        path=out/match[2]
        return match[1]+'="'+match[2]+'?v='+version(path)+'"' if path.is_file() else match[0]
    html=re.sub(r'(src|href)="([^"?]+\.(?:js|css))(?:\?[^\"]*)?"',asset_version,html)
    (out/'maps.html').write_text(html,'utf8')
    (out/'index.html').write_text(html,'utf8')
    demo=(source/'demo.html').read_text('utf8').replace('</body>','<script src="live/demo-page.js"></script></body>')
    (out/'demo.html').write_text(re.sub(r'(src|href)="([^"?]+\.(?:js|css))(?:\?[^\"]*)?"',asset_version,demo),'utf8')
    manifest=json.loads((source/'build-manifest.json').read_text('utf8'))
    manifest['edition']='toy'
    manifest['localAnalysis']=True
    # Retained as a data-format compatibility flag, not a product edition.
    manifest['liveAnalysisExperiment']=1
    manifest['liveObjectSourceSha256']=toy_live_objects.frame_stamp()
    # Full self-contained fork, including stock rule/terrain metadata. No MIX,
    # native interpreter or analysis service is included in the upload ZIP.
    manifest['zipBudgetBytes']=50000000
    spec=importlib.util.spec_from_file_location('builder',ROOT/'build-toy.py')
    builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    for name in ('Start Toy.cmd', 'serve-toy.ps1'):
        shutil.copy2(ROOT/'toy'/name, out/name)
    builder.finalize(out,manifest,args.archive)
    print('Stock metadata compressed bytes:',sizes)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=ROOT/'output/toy-build/artwork')
    parser.add_argument('--output',type=Path,default=ROOT/'output/toy')
    parser.add_argument('--archive',type=Path,help='Optional ZIP path outside the site directory')
    parser.add_argument('--cache',type=Path,default=ROOT/'output/toy-cache')
    parser.add_argument('--object-cache',type=Path,default=ROOT/'output/toy-live-object-cache')
    build(parser.parse_args())
