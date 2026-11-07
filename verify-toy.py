"""Verify static package boundaries and compare every exact cell to its source."""
import argparse
import base64
import gzip
import hashlib
from html.parser import HTMLParser
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
import zipfile
from toy_codec import expand_report, expand_search


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for name in ['src', 'href']:
            if name in attrs:
                self.refs.append(attrs[name])


def verify(root, cache, modes=None, cases_path=None):
    catalog = json.loads((root/'catalog.json').read_text('utf-8'))
    manifest = json.loads((root/'build-manifest.json').read_text('utf-8'))
    if modes:
        from official_maps import catalog as original_catalog
        expected = {entry['id'] for entry in original_catalog()['maps'] if entry['mode'] in modes}
        assert {entry['id'] for entry in catalog['maps']} == expected, 'Official mode selection is incomplete or contains unwanted maps'
        assert all(entry['mode'] in modes for entry in catalog['maps'])
    assert len((root/'index.html').read_bytes()) <= 1024*1024
    actual_files = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name != 'build-manifest.json'}
    assert actual_files == set(manifest['files'])
    for name, digest in manifest['files'].items():
        path = root/name
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, name
        assert path.suffix.lower() not in {'.exe', '.dll', '.mix', '.map', '.yrm', '.mpr', '.py', '.cjs'}, name
    from PIL import Image
    for image in (root/'art').glob('*.webp'):
        with Image.open(image) as decoded:
            decoded.load()
            assert max(decoded.size)<=manifest['maxImageEdge'], image.name
    for html in root.glob('*.html'):
        parser = References(); parser.feed(html.read_text('utf-8'))
        for value in parser.refs:
            if not value or value.startswith('#'):
                continue
            route = urlsplit(value)
            assert not route.scheme and not value.startswith('/'), (html.name, value)
            target = html.parent/unquote(route.path)
            assert target.is_file(), (html.name, value)
    from official_maps import select
    reports = 0
    cases = []
    sizes = []
    for entry_index, entry in enumerate(catalog['maps'], 1):
        entry_bytes = 0
        entry_art = set()
        for version, variant in entry['variants'].items():
            assert set(variant['reports']) == {'ore', 'clear'}
            raw, _, _ = select(entry['id'], version)
            for layout, relative in variant['reports'].items():
                path = root/relative
                report = json.loads(gzip.decompress(path.read_bytes()))
                shared_files = set()
                if report.get('_static'):
                    base = (path.parent/report['_static']['base']).resolve()
                    assert base.is_relative_to(root.resolve()) and base.is_file()
                    shared_files.add(base)
                    report = expand_report(report, json.loads(gzip.decompress(base.read_bytes())))
                meta = report['metadata']
                if manifest.get('regionNavigationVersion'):
                    navigation=report['regionNavigation']
                    assert navigation['version']==2 and navigation['count']==len(report['cells'])
                    assert len(base64.b64decode(navigation['flags'],validate=True))==len(report['cells'])
                assert meta['officialMap']['id'] == entry['id']
                assert meta['version'] == version and meta['mineralsEnabled'] == (layout == 'ore')
                assert meta['treesEnabled'] == (layout == 'ore') and meta['terrainRemovalVersion'] == 1
                if layout == 'clear':
                    assert not any(re.fullmatch(r'TREE\d+', c.get('terrain') or '') for c in report['cells'])
                assert not meta.get('previewOnly') and not meta.get('approximate')
                assert not any(key in meta for key in ['resourceRoot', 'resourceFiles', 'mineralPreviousResult'])
                key = hashlib.sha256(raw+version.encode()+str(layout == 'ore').encode()+manifest['modelSourceSha256'].encode()).hexdigest()[:24]
                original_folder = cache/key
                original = json.loads((original_folder/'result.json').read_text('utf-8'))
                original_path=original_folder/'result.json'
                if manifest.get('probabilityModel')=='finite-retry-v2' and original['probability'].get('model')!='finite-retry-v2':
                    # The layout/art source retains its provenance. Verify the
                    # new probability model from that source's original search.
                    from realmap_exact import calculate, read_search
                    count=original['probability']['sampleCount']
                    value=calculate(read_search(original_folder/'search.bin',count),{c['y']*512+c['x']:c['status'] for c in original['cells']},count)
                    results=value.pop('cells');original['probability']=value
                    for cell in original['cells']:
                        cell.update(results.get(cell['y']*512+cell['x'],dict(probability=0,multiplier=0,oneAttemptProbability=0,terms=[])))
                    if cases_path:
                        import shutil
                        expected=cases_path.parent/'current-model'/key;expected.mkdir(parents=True,exist_ok=True)
                        original_path=expected/'result.json';original_path.write_text(json.dumps(original,separators=(',',':')),'utf8')
                        shutil.copy2(original_folder/'search.bin',expected/'search.bin')
                cases.append(dict(report=str(path.resolve()), original=str(original_path.resolve())))
                if manifest.get('artworkStyle') == 'tiles':
                    simplified=report['rendering']['simplified']
                    assert simplified['version']==1 and simplified['style']=='cell-materials'
                    assert not report['rendering'].get('image') and not report['rendering'].get('objectImage')
                    assert all(len(obj)==7 and obj[3] in {'building','repair','oil','hospital','armory','lab','tech','civilian','animal','soldier','vehicle','aircraft'} for obj in simplified['objects'])
                elif manifest.get('artworkStyle') == 'original':
                    descriptor=report['rendering']['original']
                    assert descriptor['version']==1 and descriptor['layout']==layout
                    assert not report['rendering'].get('simplified')
                    index=(path.parent/descriptor['index']).resolve()
                    assert index.is_relative_to(root.resolve()) and index.is_file()
                    from toy_atlas_codec import decode as decode_artwork
                    art=decode_artwork(index.read_bytes())
                    assert art['version']==1 and len(art['layers'])==4
                    for atlas in art['atlases']:
                        source=(index.parent/atlas['file']).resolve()
                        assert source.is_relative_to(root.resolve()) and source.is_file()
                        assert source.stat().st_size==atlas['bytes']
                        entry_art.add(source)
                    entry_art.add(index)
                for field in ['probability', 'cells', 'markers', 'potentialMarkers', 'clearance']:
                    assert report[field] == original[field], (relative, field)
                search = (path.parent/report['precomputed']['search']).resolve()
                assert search.is_relative_to(root.resolve()) and search.is_file()
                assert expand_search(gzip.decompress(search.read_bytes())) == (original_folder/'search.bin').read_bytes()
                shared_files.add(search)
                entry_bytes += path.stat().st_size+sum(p.stat().st_size for p in shared_files)
                for field in ['image', 'objectImage']:
                    if name := report['rendering'].get(field):
                        image = (path.parent/name).resolve()
                        assert image.is_relative_to(root.resolve()) and image.is_file()
                        entry_art.add(image)
                reports += 1
        art_bytes = sum(path.stat().st_size for path in entry_art)
        sizes.append(dict(label=entry['label'], variants=len(entry['variants']), dataBytes=entry_bytes,
                          artworkBytes=art_bytes, standaloneBytes=entry_bytes+art_bytes))
        if len(catalog['maps']) > 50 and entry_index % 25 == 0:
            print(f'Verified [{entry_index}/{len(catalog["maps"])}] menu entries', flush=True)
    assert reports == len(manifest['maps'])
    if cases_path:
        cases_path.parent.mkdir(exist_ok=True,parents=True)
        cases_path.write_text(json.dumps(cases),encoding='utf-8')
    archive_path = Path(str(root)+'.zip')
    assert archive_path.with_suffix('.zip.sha256').read_text('utf-8').split()[0] == hashlib.sha256(archive_path.read_bytes()).hexdigest()
    if manifest.get('zipBudgetBytes'):
        assert archive_path.stat().st_size<=manifest['zipBudgetBytes']
    with zipfile.ZipFile(archive_path) as archive:
        assert set(archive.namelist()) == actual_files | {'build-manifest.json'}
        assert archive.testzip() is None
    result = dict(status='PASS', entries=len(catalog['maps']), reports=reports,
                  files=len(actual_files)+1, zipBytes=archive_path.stat().st_size,
                  exact_cells_and_search_unchanged=True)
    all_files = [path for path in root.rglob('*') if path.is_file()]
    result['storage'] = dict(unpackedBytes=sum(path.stat().st_size for path in all_files),
        artworkBytes=sum(path.stat().st_size for path in all_files if path.suffix=='.webp'),
        dataBytes=sum(path.stat().st_size for path in all_files if path.suffix=='.gz'),
        maps=sizes)
    print(json.dumps({key:value for key,value in result.items() if key!='storage'}))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--cache', type=Path, default=Path(__file__).resolve().parent/'output/toy-cache')
    parser.add_argument('--mode', action='append', help='Require the complete official catalog for these modes')
    parser.add_argument('--report', type=Path, help='Write verification and per-map storage measurements as JSON')
    parser.add_argument('--cases', type=Path, help='Write cross-language comparison inputs for verify-toy-codec.cjs')
    args = parser.parse_args()
    result = verify(args.root, args.cache, args.mode, args.cases)
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
