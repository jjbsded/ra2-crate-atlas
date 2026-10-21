"""No-mineral layouts must equal an independently cleared map, in both games."""
import json
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageChops
from realmap import ROOT, analyze, resources, sha
from realmap_3d import patch
from realmap_refresh import refresh_result
import server
from map_test_fixtures import fixture, pack


def main():
    folder = ROOT/'output/mineral-verification'
    folder.mkdir(parents=True, exist_ok=True)
    reports = {}
    for version in ('ra2', 'yr'):
        res = resources(version)
        names = list(res.rules['OVERLAYTYPES'].values())
        raw = fixture(objects=True).decode()
        overlays = bytearray([255]*262144)
        overlays[20+512*21] = names.index('GASAND')
        overlays[21+512*20] = names.index('TIB01')
        overlays[22+512*21] = names.index('GEM01')

        def with_overlays(values):
            return re.sub(r'\[OverlayPack\]\n.*?(?=\[)', lambda _: pack('OverlayPack', values),
                          raw, flags=re.S).encode()

        original = with_overlays(overlays)
        # Reference input clears exactly the two resource locations, not a
        # second use of the option/implementation under test.
        overlays[21+512*20] = overlays[22+512*21] = 255
        cleared = with_overlays(overlays)
        on = analyze(original, folder/f'{version}-on', version)
        off = analyze(original, folder/f'{version}-off', version, minerals_enabled=False)
        reference = analyze(cleared, folder/f'{version}-reference', version)
        assert off['probability'] == reference['probability']
        assert off['cells'] == reference['cells']
        assert off['markers'] == reference['markers']
        assert off['potentialMarkers'] == reference['potentialMarkers']
        assert off['metadata']['sourceSha256'] == on['metadata']['sourceSha256'] == sha(original)
        assert off['metadata']['mineralsEnabled'] is False
        assert off['metadata']['removedMineralCount'] == 2
        assert (folder/f'{version}-off/source.map').read_bytes() == original
        lookup_on = {(c['x'],c['y']):c for c in on['cells']}
        lookup_off = {(c['x'],c['y']):c for c in off['cells']}
        for p in ((21,20),(22,21)):
            assert lookup_on[p]['status'] == 'retry' and lookup_on[p]['probability'] == 0
            assert lookup_off[p]['status'] == 'crate' and lookup_off[p]['probability'] > 0
        assert lookup_on[20,21]['overlayName'] == lookup_off[20,21]['overlayName'] == 'GASAND'
        assert lookup_off[19,19]['terrain'] == 'TIBTRE01'  # drill remains
        assert any(c['probability'] != lookup_off[p]['probability'] for p,c in lookup_on.items()
                   if c['probability'] > 0), 'Retry changes must affect other cells too.'
        for key in ('image', 'objectImage'):
            filename = off['rendering'][key]
            a = Image.open(folder/f'{version}-off'/filename).convert('RGBA')
            b = Image.open(folder/f'{version}-reference'/reference['rendering'][key]).convert('RGBA')
            assert ImageChops.difference(a,b).getbbox() is None, key
        before_refresh = {key: (folder/f'{version}-off'/off['rendering'][key]).read_bytes()
                          for key in ('image', 'objectImage')}
        refresh_result(folder/f'{version}-off/result.json')
        refreshed = json.loads((folder/f'{version}-off/result.json').read_text('utf8'))
        assert refreshed['probability'] == off['probability'] and refreshed['cells'] == off['cells']
        for key, pixels in before_refresh.items():
            assert (folder/f'{version}-off'/refreshed['rendering'][key]).read_bytes() == pixels
        selected = patch(f'/output/mineral-verification/{version}-off/result.json',21,20,4)
        assert selected['metadata']['mineralsEnabled'] is False
        assert not any(d['name'] in ('TIB01','GEM01') for c in selected['cells'] for d in c['decorations'])
        assert any(d['name'] == 'TIBTRE01' for c in selected['cells'] for d in c['decorations'])
        for c in selected['cells']:
            source = lookup_off[c['x'],c['y']]
            assert c['probability'] == source['probability']
            assert c['land'] == source['land'] and c['marked'] == source['marked']
        reports[version] = {'cells':len(off['cells']), 'removed':2, 'changedProbability':True}
        print(f'PASS: {version} exact probabilities, search, risks, 2D/3D artwork equal cleared-map oracle.', flush=True)

    # Exercise the real HTTP job protocol and persisted reverse link.
    http = server.LocalServer(('127.0.0.1',0), server.Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True);thread.start()
    base = f'http://127.0.0.1:{http.server_port}'
    def request(path, body=None):
        payload = json.dumps(body).encode() if body is not None else None
        with urlopen(Request(base+path, data=payload, headers={'Content-Type':'application/json'}), timeout=60) as response:
            return json.load(response)
    try:
        source = '/output/mineral-verification/yr-on/result.json'
        job = request('/api/maps/minerals', {'result':source, 'enabled':False})
        deadline = time.monotonic()+120
        variant = job.get('url')
        while not variant:
            result = request('/api/maps/job/'+job['id'])
            assert not result.get('error'), result
            if result.get('done'):
                variant = result['url']
                break
            assert time.monotonic()<deadline
            time.sleep(.2)
        downloaded = request(variant)
        assert downloaded['probability'] == reference['probability']
        assert request('/api/maps/minerals', {'result':source,'enabled':False})['url'] == variant
        server.MAPS = server.MapJobs()  # Fresh service simulates a process restart.
        assert request('/api/maps/minerals', {'result':variant,'enabled':True})['url'] == source
        assert request('/api/maps/minerals', {'result':variant,'enabled':False})['url'] == variant
        for invalid in ({'result':'/output/../server.py','enabled':False}, {'result':source,'enabled':'no'}):
            try:request('/api/maps/minerals', invalid)
            except HTTPError as error:assert error.code == 400
            else:raise AssertionError('Invalid scenario input accepted')
        print('PASS: HTTP job, completed cache, restart-safe reverse link and invalid requests.',flush=True)
    finally:
        http.shutdown();http.server_close()
    (folder/'verification.json').write_text(json.dumps({'result':'PASS','versions':reports},indent=2),'utf8')


if __name__ == '__main__':
    main()
