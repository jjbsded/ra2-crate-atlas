"""Build a static Toy edition. Python/game resources are build-time only."""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import multiprocessing
from pathlib import Path
import re
import shutil
import zipfile
from toy_codec import columns, compact_report, compact_search, dumps, expand_search, probability_recipe, selections, zipped

ROOT = Path(__file__).resolve().parent
_artwork_lock = None
_artwork_cache = None
FRONTEND = '''app.js asset-data.js i18n-en.js i18n.js model.js timing.js scene.js
probability-index.js probability.js probability-display.js occupancy-overlay.js
minimap.js transfer-origins.js player-starts.js map-artwork.js map-renderer.js map-image-export.js
selection-keyboard.js official-map-names.js official-maps-ui.js region-statistics.js region-auto.js region-statistics-ui.js
map-results.js map-details.js map-exports.js mineral-layouts.js local-api.js realmap-ui.js
realmap-ui.css page-navigation.css official-maps.css region-statistics.css terrain3d.js terrain3d.css'''.split()


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def source_fingerprint():
    files = sorted(set(ROOT.glob('realmap*.py')) | {
        ROOT/'terrain_depth.py', ROOT/'original_resources.py', ROOT/'official_maps.py',
        ROOT/'output/realmap-tools/map-search.exe'})
    return hashlib.sha256(b''.join(p.name.encode()+p.read_bytes() for p in files)).hexdigest()


def analyze_cached(entry, version, minerals, cache, fingerprint, quiet=False):
    from official_maps import select
    from realmap import analyze
    raw, filename, official = select(entry['id'], version)
    key = hashlib.sha256(raw+version.encode()+str(minerals).encode()+fingerprint.encode()).hexdigest()[:24]
    folder = cache/key
    report_path = folder/'result.json'
    if not report_path.exists():
        if not quiet:
            print(f'Computing {entry["label"]} / {version} / ore={minerals}', flush=True)
        report = analyze(raw, folder, version, filename,
                         (lambda *args: None) if quiet else lambda text, percent: print(f'  {percent}% {text}', flush=True),
                         minerals_enabled=minerals)
        if not report.get('probability') or report['metadata'].get('approximate'):
            raise ValueError('Toy official maps must have exact static results: '+entry['label'])
        report['metadata'].update(officialMap=official, displayName=official['label'])
        dump(report_path, report)
    report = json.loads(report_path.read_text('utf-8'))
    if not report.get('probability') or report['metadata'].get('approximate') or report['metadata'].get('previewOnly'):
        raise ValueError('Cached Toy map is not exact: '+entry['label']+' / '+version)
    if report['metadata']['sourceSha256'] != hashlib.sha256(raw).hexdigest() or report['metadata']['version'] != version:
        raise ValueError('Cached analysis does not match the selected official map: '+str(folder))
    report['metadata'].update(officialMap=official, displayName=official['label'])
    return folder, report


def _precompute_one(task):
    entry, version, cache, fingerprint = task
    from official_maps import select
    raw, _, _ = select(entry['id'], version)
    for minerals in [True, False]:
        key = hashlib.sha256(raw+version.encode()+str(minerals).encode()+fingerprint.encode()).hexdigest()[:24]
        if (cache/key/'result.json').is_file():
            # Packaging validates the full cached report before using it.
            continue
        analyze_cached(entry, version, minerals, cache, fingerprint, quiet=True)
    return entry['label'], version


def precompute(entries, cache, fingerprint, jobs):
    # The same file may occur in both modes. Never let two workers write its
    # cache concurrently. Reuse remains tied to file bytes and game version.
    unique = {}
    for entry in entries:
        for version, variant in entry['variants'].items():
            unique.setdefault((version, variant['sha256']), (entry, version, cache, fingerprint))
    tasks = list(unique.values())
    if jobs == 1:
        results = map(_precompute_one, tasks)
        for index, (label, version) in enumerate(results, 1):
            print(f'Analysis [{index}/{len(tasks)}] {label} / {version}', flush=True)
    else:
        with ProcessPoolExecutor(max_workers=jobs) as pool:
            futures = [pool.submit(_precompute_one, task) for task in tasks]
            for index, future in enumerate(as_completed(futures), 1):
                label, version = future.result()
                print(f'Analysis [{index}/{len(tasks)}] {label} / {version}', flush=True)


def publish(path, payload):
    path.parent.mkdir(exist_ok=True, parents=True)
    with _artwork_lock if _artwork_lock is not None else nullcontext():
        if not path.exists():
            with path.open('xb') as stream:
                stream.write(payload)


def shared(output, prefix, payload, suffix):
    name = prefix+'-'+hashlib.sha256(payload).hexdigest()[:24]+suffix
    publish(output/'shared'/name, payload)
    return '../../../shared/'+name


def package_report(folder, report, target, max_image, fingerprint, artwork, quality, table, table_url, art_style):
    from PIL import Image
    target.mkdir(parents=True)
    artwork.mkdir(exist_ok=True)
    report = deepcopy(report)
    from region_navigation import for_report
    report['regionNavigation'] = for_report(report, folder/'result.json')
    if art_style == 'tiles':
        from toy_artwork import scene
        report['rendering']['simplified'] = scene(report, folder)
        report['rendering'].pop('image', None)
        report['rendering'].pop('objectImage', None)
    images = {}
    for field in ([] if art_style == 'tiles' else ['image', 'objectImage']):
        source = report['rendering'].get(field)
        if not source:
            continue
        path = folder/source
        digest = hashlib.sha256(path.read_bytes()+f'webp{quality}/{max_image}'.encode()).hexdigest()
        if digest not in images:
            name = 'art-'+digest[:16]+'.webp'
            destination = artwork/name
            with _artwork_lock if _artwork_lock is not None else nullcontext():
                exists = destination.exists()
            if not exists:
                payload = None
                if _artwork_cache and (_artwork_cache/name).is_file():
                    try:
                        payload = (_artwork_cache/name).read_bytes()
                        with Image.open(io.BytesIO(payload)) as cached:
                            cached.load()
                            if max(cached.size)>max_image:
                                payload = None
                    except (OSError, ValueError):
                        payload = None
                if payload is None:
                    with Image.open(path) as image:
                        image.thumbnail((max_image, max_image), Image.Resampling.LANCZOS)
                        buffer = io.BytesIO()
                        image.save(buffer, 'WEBP', quality=quality, method=5)
                        payload = buffer.getvalue()
                # Encode in parallel, then publish under one process-shared lock.
                # No worker replaces another worker's completed Windows file.
                with _artwork_lock if _artwork_lock is not None else nullcontext():
                    if not destination.exists():
                        with destination.open('xb') as stream:
                            stream.write(payload)
            images[digest] = name
        report['rendering'][field] = '../../../art/'+images[digest]
    # All integer fractions, geometry and transfer records stay unchanged.
    # Original MIX/map files, native tools and development audits are excluded.
    for key in ['resourceFingerprint', 'resourceRoot', 'resourceFiles', 'mineralPreviousResult']:
        report['metadata'].pop(key, None)
    for key in ['audit', 'objectAudit']:
        report['rendering'].pop(key, None)
    search_raw = (folder/'search.bin').read_bytes()
    compact = compact_search(search_raw, report['probability']['sampleCount'])
    assert expand_search(compact) == search_raw
    search_url = shared(artwork.parent, 'search', gzip.compress(compact, mtime=0), '.bin.gz')
    recipe_key = hashlib.sha256(dumps(report['probability'])+search_raw).hexdigest()
    recipe_path = folder.parent.parent/'toy-transport-cache'/(recipe_key+'.json.gz')
    if recipe_path.exists():
        recipe = json.loads(gzip.decompress(recipe_path.read_bytes()))
    else:
        recipe = probability_recipe(report, selections(search_raw, report['probability']['sampleCount']))
        publish(recipe_path, zipped(recipe))
    report['precomputed'] = {'search': search_url, 'modelSourceSha256': fingerprint}
    report = compact_report(report, recipe, table, table_url)
    raw = dumps(report)
    (target/'result.json.gz').write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    return {'cells': table['count'], 'jsonBytes': len(raw),
            'downloadBytes': sum(p.stat().st_size for p in target.iterdir())+sum((artwork/name).stat().st_size for name in images.values())}


def _package_one(task):
    entry, version, cache, fingerprint, output, max_image, quality, art_style = task
    urls, summary = {}, []
    _, clear = analyze_cached(entry, version, False, cache, fingerprint, quiet=True)
    table = dict(count=len(clear['cells']), columns=columns(clear['cells']))
    table_url = shared(output, 'cells', zipped(table), '.json.gz')
    for minerals in [False, True]:
        folder, report = analyze_cached(entry, version, minerals, cache, fingerprint, quiet=True)
        assert [(c['x'],c['y']) for c in clear['cells']] == [(c['x'],c['y']) for c in report['cells']]
        relative = f'data/{entry["id"]}-{version}/{"ore" if minerals else "clear"}'
        stats = package_report(folder, report, output/relative, max_image, fingerprint, output/'art', quality, table, table_url, art_style)
        urls['ore' if minerals else 'clear'] = relative+'/result.json.gz'
        summary.append(dict(id=entry['id'], version=version, minerals=minerals, **stats))
    return dict(id=entry['id'], version=version, file=report['metadata']['filename'], reports=urls, summary=summary)


def _init_packaging(lock, art_cache):
    global _artwork_lock, _artwork_cache
    _artwork_lock, _artwork_cache = lock, art_cache


def _refresh_navigation(task):
    path, folder = task
    from region_navigation import for_report
    original = json.loads((folder/'result.json').read_text('utf-8'))
    report = json.loads(gzip.decompress(path.read_bytes()))
    report['regionNavigation'] = for_report(original, folder/'result.json')
    path.write_bytes(zipped(report))


def _refresh_artwork(task):
    path, folder = task
    from toy_artwork import scene
    original = json.loads((folder/'result.json').read_text('utf-8'))
    report = json.loads(gzip.decompress(path.read_bytes()))
    report['rendering']['simplified'] = scene(original, folder)
    path.write_bytes(zipped(report))


def refresh_artwork(output, cache, jobs):
    from official_maps import select
    manifest = json.loads((output/'build-manifest.json').read_text('utf-8'))
    if manifest['modelSourceSha256'] != source_fingerprint() or manifest.get('artworkStyle') != 'tiles':
        raise ValueError('Use a matching tile-material build')
    catalog = json.loads((output/'catalog.json').read_text('utf-8'))
    tasks=[]
    for entry in catalog['maps']:
        for version, variant in entry['variants'].items():
            raw, _, _ = select(entry['id'], version)
            for layout, relative in variant['reports'].items():
                key=hashlib.sha256(raw+version.encode()+str(layout=='ore').encode()+manifest['modelSourceSha256'].encode()).hexdigest()[:24]
                tasks.append((output/relative, cache/key))
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        for i,_ in enumerate(pool.map(_refresh_artwork,tasks),1):
            if i%50==0:
                print(f'Artwork [{i}/{len(tasks)}]',flush=True)
    frontend(output)
    manifest['artworkUpdatedAt']=datetime.now(timezone.utc).isoformat()
    finalize(output,manifest)


def refresh_navigation(output, cache, jobs):
    from official_maps import select
    manifest = json.loads((output/'build-manifest.json').read_text('utf-8'))
    if manifest['modelSourceSha256'] != source_fingerprint():
        raise ValueError('Analysis code changed; create a full build instead')
    catalog = json.loads((output/'catalog.json').read_text('utf-8'))
    tasks = []
    for entry in catalog['maps']:
        for version, variant in entry['variants'].items():
            raw, _, _ = select(entry['id'], version)
            for layout, relative in variant['reports'].items():
                key = hashlib.sha256(raw+version.encode()+str(layout=='ore').encode()+manifest['modelSourceSha256'].encode()).hexdigest()[:24]
                tasks.append((output/relative, cache/key))
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        for i,_ in enumerate(pool.map(_refresh_navigation,tasks),1):
            if i%25==0:
                print(f'Navigation [{i}/{len(tasks)}]',flush=True)
    frontend(output)
    manifest['regionNavigationVersion']=2
    finalize(output,manifest)


def package_entries(entries, cache, fingerprint, output, max_image, jobs, art_cache=None, quality=55, art_style='tiles'):
    tasks = [({'id':entry['id'], 'label':entry['label']}, version, cache, fingerprint, output, max_image, quality, art_style)
             for entry in entries for version in entry['variants']]
    if jobs == 1:
        _init_packaging(None, art_cache)
        yield from map(_package_one, tasks)
    else:
        context = multiprocessing.get_context('spawn')
        with ProcessPoolExecutor(max_workers=jobs, mp_context=context, initializer=_init_packaging, initargs=(context.Lock(),art_cache)) as pool:
            futures = [pool.submit(_package_one, task) for task in tasks]
            for future in as_completed(futures):
                yield future.result()


def page(source, demo=False):
    text = source.read_text('utf-8')
    title = '概率演示 · 低清简化版（非完整版）' if demo else '官方地图概率图集 · 低清简化版（非完整版）'
    text = re.sub(r'<title>.*?</title>', '<title>'+title+'</title>', text)
    text = re.sub(r'<script src="language-settings\.js[^\"]*"></script>', '', text)
    text = text.replace('<script src="i18n.js', '<script src="toy-boot.js"></script><script src="i18n.js', 1)
    text = text.replace('</head>', '<link rel="stylesheet" href="toy.css?v='+hashlib.sha256((ROOT/'toy/toy.css').read_bytes()).hexdigest()[:12]+'"></head>')
    text = text.replace('<body>', '<body class="toy">')
    text = re.sub(r'href="/research[^\"]*"', 'href="about.html"', text)
    text = re.sub(r'<a\b[^>]*href="cliff-demo\.html"[^>]*>.*?</a>', '', text)
    if not demo:
        text = text.replace('href="index.html"', 'href="demo.html"')
        text = re.sub(r'<script src="resource-ui\.js[^\"]*"></script>', '', text)
        text = text.replace('<script src="realmap-ui.js', '<script src="terrain-symbols.js"></script><script src="terrain-artwork.js"></script><script src="terrain3d-patch.js"></script><script src="static-codec.js"></script><script src="toy-platform.js"></script><script src="realmap-ui.js', 1)
    else:
        text = text.replace('href="maps.html"', 'href="index.html"')
    text = text.replace('</body>', '<script src="toy-page.js?v='+hashlib.sha256((ROOT/'toy/toy-page.js').read_bytes()).hexdigest()[:12]+'"></script></body>')
    return text


def frontend(output):
    for name in FRONTEND:
        shutil.copy2(ROOT/name, output/name)
    for name in ['toy-boot.js', 'toy-platform.js', 'toy-page.js', 'toy.css', 'data-worker.js', 'static-codec.js', 'terrain-symbols.js', 'terrain-artwork.js', 'terrain3d-patch.js', 'about.html']:
        shutil.copy2(ROOT/'toy'/name, output/name)
    (output/'lib').mkdir(exist_ok=True)
    for name in ['three-r160.min.js', 'three-LICENSE.txt']:
        shutil.copy2(ROOT/'lib'/name, output/'lib'/name)
    codec_version = hashlib.sha256((output/'static-codec.js').read_bytes()).hexdigest()[:16]
    worker = output/'data-worker.js'
    worker.write_text(worker.read_text('utf-8').replace("static-codec.js'", "static-codec.js?v="+codec_version+"'"), 'utf-8')
    # Updating an existing Toy must not keep the previous map list from cache.
    revision = hashlib.sha256((output/'catalog.json').read_bytes())
    for report in sorted((output/'data').rglob('result.json.gz')):
        revision.update(report.relative_to(output).as_posix().encode())
        revision.update(report.read_bytes())
    stamp = revision.hexdigest()[:16]
    with (output/'toy-boot.js').open('a', encoding='utf-8') as boot:
        boot.write('\nwindow.CrateWebConfig.catalogVersion='+json.dumps(stamp)+';\n')
        boot.write('window.CrateWebConfig.workerVersion='+json.dumps(hashlib.sha256(worker.read_bytes()).hexdigest()[:16])+';\n')
    def asset_version(match):
        path = output/match.group(2)
        if not path.is_file():
            return match.group(0)
        version = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        return match.group(1)+'="'+match.group(2)+'?v='+version+'"'
    for name, source, demo in [('index.html','maps.html',False),('maps.html','maps.html',False),('demo.html','index.html',True)]:
        text = re.sub(r'(src|href)="([^"?]+\.(?:js|css))(?:\?[^\"]*)?"', asset_version, page(ROOT/source, demo))
        (output/name).write_text(text, 'utf-8')
    (output/'docs').mkdir(exist_ok=True)
    for name in ['random-crate-generation.md', 'random-crate-generation.en.md']:
        shutil.copy2(ROOT/'docs'/name, output/'docs'/name)


def finalize(output, manifest):
    if any(output.rglob('*.tmp')):
        raise ValueError('Incomplete artwork remains in the build directory')
    if manifest.get('transportCodec') == 1:
        for row in manifest['maps']:
            path = output/f'data/{row["id"]}-{row["version"]}/{"ore" if row["minerals"] else "clear"}/result.json.gz'
            report = json.loads(gzip.decompress(path.read_bytes()))
            references = [report['_static']['base'], report['precomputed']['search']]
            references.extend(report['rendering'].get(field) for field in ('image','objectImage') if report['rendering'].get(field))
            row['downloadBytes'] = sum(file.stat().st_size for file in {path.resolve(),*((path.parent/name).resolve() for name in references)})
    manifest['files'] = {str(p.relative_to(output)).replace('\\', '/'):hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'build-manifest.json'}
    dump(output/'build-manifest.json', manifest)
    archive = Path(str(output)+'.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
        for path in sorted(output.rglob('*')):
            if path.is_file():
                zipped.write(path, str(path.relative_to(output)).replace('\\', '/'))
    archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n', encoding='utf-8')
    if manifest.get('zipBudgetBytes') and archive.stat().st_size > manifest['zipBudgetBytes']:
        raise ValueError(f'ZIP exceeds budget: {archive.stat().st_size} > {manifest["zipBudgetBytes"]}. Reduce --max-image-edge or --image-quality.')
    print(json.dumps(dict(output=str(output), zip=str(archive), bytes=archive.stat().st_size,
                          reports=len(manifest['maps'])), ensure_ascii=False), flush=True)


def build(output, cache, ids=None, max_image=640, modes=None, jobs=1, art_cache=None, quality=55, budget=50000000, art_style='tiles'):
    from official_maps import catalog
    if output.exists() or Path(str(output)+'.zip').exists():
        raise ValueError('Output/ZIP already exists. Choose a new directory: '+str(output))
    config = json.loads((ROOT/'toy/maps.json').read_text('utf-8'))
    official = catalog()
    selected_modes = modes if modes is not None else config.get('modes')
    selected = ids or ([e['id'] for e in official['maps'] if e['mode'] in selected_modes] if selected_modes else config['ids'])
    entries = [deepcopy(next(e for e in official['maps'] if e['id'] == key)) for key in selected]
    fingerprint = source_fingerprint()
    precompute(entries, cache, fingerprint, jobs)
    output.mkdir(parents=True)
    summary = []
    variant_count = sum(len(e['variants']) for e in entries)
    file_count = len({(v,s['sha256']) for e in entries for v,s in e['variants'].items()})
    packaged_variants = 0
    lookup = {entry['id']:entry for entry in entries}
    for result in package_entries(entries, cache, fingerprint, output, max_image, jobs, art_cache, quality, art_style):
        entry = lookup[result['id']]
        packaged_variants += 1
        print(f'Packaging [{packaged_variants}/{variant_count}] {entry["label"]} / {result["version"]}', flush=True)
        variant = entry['variants'][result['version']]
        variant.clear()
        variant.update(file=result['file'], reports=result['reports'])
        summary.extend(result['summary'])
    data = dict(schemaVersion=1, precomputed=True, maps=entries,
                default=config['default'] if config['default'] in selected else selected[0],
                modes=[m for m in official['modes'] if any(e['mode'] == m['id'] for e in entries)],
                scope={'modes': list(selected_modes or []), 'completeModes': bool(selected_modes and not ids)},
                counts={'files': file_count, 'variants': variant_count, 'entries': len(entries)},
                artwork={'style': art_style, 'maxEdge': max_image if art_style=='raster' else None, 'quality': quality if art_style=='raster' else None, 'compact': True})
    dump(output/'catalog.json', data)
    frontend(output)
    manifest = dict(schemaVersion=1, builtAt=datetime.now(timezone.utc).isoformat(),
                    modelSourceSha256=fingerprint, maps=summary, maxImageEdge=max_image,
                    imageQuality=quality, artworkStyle=art_style, transportCodec=1, regionNavigationVersion=2, zipBudgetBytes=budget)
    finalize(output, manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT/'output/toy-cache')
    parser.add_argument('--map-id', action='append', help='Build a subset of catalog IDs')
    parser.add_argument('--mode', action='append', choices=['standard','teamgame','megawealth','duel','meatgrind','navalwar','cooperative'], help='Include every official map for this mode; repeat for multiple modes')
    parser.add_argument('--jobs', type=int, default=1, choices=range(1,5), help='Parallel analysis/packaging workers (1-4); shared artwork writes are locked')
    parser.add_argument('--art-cache', type=Path, help='Reuse verified content-addressed artwork from an earlier build')
    parser.add_argument('--max-image-edge', type=int, default=640)
    parser.add_argument('--image-quality', type=int, default=55, choices=range(20,96))
    parser.add_argument('--artwork-style', choices=['tiles','raster'], default='tiles', help='Shared procedural cell materials (default), or legacy compressed full-map images')
    parser.add_argument('--zip-budget-mb', type=float, default=50, help='Fail builds above this decimal MB limit (default: 50)')
    parser.add_argument('--refresh-ui', action='store_true', help='Refresh only frontend files in an existing build')
    parser.add_argument('--refresh-navigation', action='store_true', help='Add current auxiliary region routes and UI without recomputing probabilities/artwork')
    parser.add_argument('--refresh-artwork', action='store_true', help='Update only procedural object descriptors and frontend in a tile-material build')
    args = parser.parse_args()
    if not 256 <= args.max_image_edge <= 4096:
        parser.error('--max-image-edge must be between 256 and 4096')
    if args.zip_budget_mb is not None and args.zip_budget_mb<=0:
        parser.error('--zip-budget-mb must be positive')
    if args.refresh_artwork:
        refresh_artwork(args.output.resolve(),args.cache.resolve(),args.jobs)
    elif args.refresh_navigation:
        refresh_navigation(args.output.resolve(),args.cache.resolve(),args.jobs)
    elif args.refresh_ui:
        output = args.output.resolve()
        manifest = json.loads((output/'build-manifest.json').read_text('utf-8'))
        if manifest['modelSourceSha256'] != source_fingerprint():
            parser.error('Analysis code changed; create a new full build instead')
        frontend(output)
        manifest['uiUpdatedAt'] = datetime.now(timezone.utc).isoformat()
        finalize(output, manifest)
    else:
        build(args.output.resolve(), args.cache.resolve(), args.map_id, args.max_image_edge, args.mode, args.jobs, args.art_cache.resolve() if args.art_cache else None, args.image_quality, round(args.zip_budget_mb*1000000) if args.zip_budget_mb else None, args.artwork_style)
