"""Verify an extracted release without developer PATH, packages or game settings.

This writes analysis/video output only into the specified extracted test folder.
Do not repack that folder as a release after verification.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def clean_environment():
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(('PYTHON', 'NODE', 'CODEX_', 'CRATE_'))}
    env.pop('FFMPEG_PATH', None)
    windows = env.get('SystemRoot', 'C:/Windows')
    env['PATH'] = windows+';'+str(Path(windows)/'System32')
    env['PYTHONIOENCODING'] = 'utf-8'
    return env


def probe(root):
    sys.path.insert(0, str(root))
    import base64
    import struct
    import runtime_bootstrap
    import PIL, numpy, ra2mix, blowfish, lzokay
    from realmap_resources import resources
    for module in (PIL, numpy, ra2mix, blowfish, lzokay):
        assert Path(module.__file__).resolve().is_relative_to(root), module.__file__
    assert runtime_bootstrap.ROOT == root
    for theater in ('TEMPERATE', 'SNOW', 'URBAN', 'NEWURBAN', 'DESERT', 'LUNAR'):
        assert resources('yr').theater(theater)['definitions'], theater
    def pack(name, data):
        chunks = []
        for offset in range(0, len(data), 8192):
            block = data[offset:offset+8192]; compressed = lzokay.compress(block)
            chunks.append(struct.pack('<HH', len(compressed), len(block))+compressed)
        text = base64.b64encode(b''.join(chunks)).decode()
        return '['+name+']\n'+''.join(f'{i//70+1}={text[i:i+70]}\n' for i in range(0, len(text), 70))
    tiles = b''.join(struct.pack('<hhIBBB', x, y, 0, 0, 0, 0)
                     for y in range(1, 40) for x in range(1, 40)
                     if 20 < x+y <= 60 and abs(x-y) < 20)+b'\0'*4
    # Empty overlay defaults are supported; the object fixture uses clear land.
    fixture = '[Map]\nTheater=TEMPERATE\nSize=0,0,20,20\nLocalSize=0,0,20,20\n'+pack('IsoMapPack5', tiles)
    fixture += ('[Structures]\n0=Neutral,GAPILL,256,20,20,0,None\n'
                '[Infantry]\n0=Neutral,E1,256,22,20,0,Guard,64,None,0,-1,0,0,1\n'
                '[Units]\n0=Neutral,HTNK,256,20,22,128,Guard,None,0,-1,0,0,1,0\n'
                '[Aircraft]\n0=Neutral,BEAG,256,22,22,192,Guard,None,0,-1,0,0,1,0\n')
    (root/'output/portable-smoke').mkdir(parents=True, exist_ok=True)
    (root/'output/portable-smoke/objects.map').write_text(fixture, 'utf8')
    print('PASS bundled Python dependencies and six climates', flush=True)


def verify(root):
    assert (root/'portable-build.json').is_file(), 'Specify an extracted portable release'
    manifest = json.loads((root/'release-files.json').read_text('utf8'))
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    assert actual == set(manifest)|{'release-files.json'}, 'Use a fresh extraction without personal settings or output'
    for name, record in manifest.items():
        path = (root/name).resolve()
        assert path.is_relative_to(root) and path.stat().st_size == record['size'], name
        with path.open('rb') as stream:
            assert hashlib.file_digest(stream, 'sha256').hexdigest() == record['sha256'], name
    assert not any((root/name).exists() for name in ('data', 'profiles', '.git'))
    print(f'PASS release integrity: {len(manifest)} files', flush=True)
    python = root/'runtime/python/python.exe'; env = clean_environment()
    def run(args, timeout=90):
        result = subprocess.run([str(a) for a in args], cwd=root, env=env, timeout=timeout,
                                capture_output=True, text=True, encoding='utf8', errors='replace',
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        assert result.returncode == 0, (result.stdout+result.stderr)[-3000:]
        return result.stdout
    print(run([python, '-s', '-B', Path(__file__).resolve(), '--root', root, '--probe']), end='', flush=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    command = [str(python), '-s', '-B', 'server.py', '--port', str(port)]
    log = root/'output/portable-smoke/server.log'
    with log.open('w', encoding='utf8') as stream:
        process = subprocess.Popen(command, cwd=root, env=env, stdout=stream, stderr=stream,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        base = f'http://127.0.0.1:{port}'
        def request(path, data=None, raw=False):
            headers = {}
            if isinstance(data, dict):
                headers['Content-Type'] = 'application/json'; data = json.dumps(data).encode()
            with urlopen(Request(base+path, data=data, headers=headers), timeout=90) as response:
                payload = response.read()
            return payload if raw else json.loads(payload)
        def complete(job, prefix='/api/maps/job/'):
            deadline = time.monotonic()+180
            while 'url' not in job:
                assert not job.get('error'), job
                assert time.monotonic() < deadline, job
                time.sleep(.2); job = request(prefix+job['id']) | {'id': job['id']}
            return job['url']
        try:
            deadline = time.monotonic()+30
            while True:
                assert process.poll() is None, log.read_text('utf8')
                try:
                    health = request('/api/maps/health'); break
                except OSError:
                    assert time.monotonic() < deadline, 'Service did not start'
                    time.sleep(.1)
            assert health['instance']
            assert 'Existing crate demo:' in run(command)
            with urlopen(base+'/', timeout=10) as response:
                assert response.url.endswith('/maps.html')
            status = request('/api/resources')
            assert status['ready'] == {'ra2': True, 'yr': True} and not status['mod']['configured'], status
            demo = request('/examples/cliff-demo.json')
            assert len(demo['single']['cells']) == 81
            for page in ('/index.html', '/maps.html', '/cliff-demo.html', '/terrain3d.js', '/lib/three-r160.min.js',
                         '/i18n.js', '/i18n-en.js', '/README.md', '/README.zh-CN.md', '/PORTABLE.en.md'):
                assert len(request(page, raw=True)) > 100
            preference = request('/language-settings.js', raw=True).decode('utf8')
            assert 'CrateLanguageSettings' in preference
            assert request('/api/preferences/language', {'language':'en'}) == {'language':'en'}
            assert '"saved": "en"' in request('/language-settings.js', raw=True).decode('utf8')
            assert b'Random crate' in request('/research?language=en', raw=True)
            catalog = request('/api/maps/catalog'); reports = []
            for version, name in (('ra2', 'mp32s8.map'), ('yr', 'xmp32s8.map')):
                entry = next(e for e in catalog['maps'] if e['variants'].get(version, {}).get('file') == name)
                url = complete(request('/api/maps/official?'+urlencode({'id':entry['id'], 'version':version}), b''))
                report = request(url); reports.append((url, report))
                assert report['probability']['positiveCellCount'] > 0
                assert not report['metadata'].get('approximate') and not report['rendering']['missingSprites']
                print(f'PASS {version} official map: {report["metadata"]["cellCount"]} cells', flush=True)
            url, report = reports[-1]
            variant = complete(request('/api/maps/minerals', {'result':url, 'enabled':False}))
            assert request(variant)['metadata']['mineralsEnabled'] is False
            assert complete(request('/api/maps/minerals', {'result':variant, 'enabled':True})) == url
            patch = request('/api/maps/terrain3d?'+urlencode({'result':variant, 'x':99, 'y':105, 'radius':10}))
            assert patch['metadata']['mineralsEnabled'] is False and patch['textures'] and not patch['metadata']['missing']
            objects = complete(request('/api/maps/analyze?version=yr&filename=portable-objects.map',
                                       (root/'output/portable-smoke/objects.map').read_bytes()))
            rendered = request(objects)['rendering']['objects']
            assert rendered['total'] == 4 and not rendered['missing'], rendered
            assert set(rendered['categories']) == {'STRUCTURES', 'INFANTRY', 'UNITS', 'AIRCRAFT'}, rendered
            video = complete(request('/api/export', {'language':'en', 'options': {'preset':'empty'}, 'timing': {'speed':10}}), '/api/job/')
            assert len(request(video, raw=True)) > 1000
            subtitles = request(video.replace('.mp4', '.srt'), raw=True).decode('utf8')
            assert 'placement' in subtitles.lower() and not any('\u3400' <= c <= '\u9fff' for c in subtitles)
            run([root/'runtime/ffmpeg/ffmpeg.exe', '-v', 'error', '-i', root/video.lstrip('/'), '-f', 'null', '-'])
            print('PASS minerals/cache, 3D, SHP buildings/infantry, VXL vehicles/aircraft and MP4 decode', flush=True)
            result = {'result':'PASS', 'build':json.loads((root/'portable-build.json').read_text('utf8')),
                      'maps':[p for p, _ in reports], 'objects':objects, 'video':video, 'mineralVariant':variant}
            (root/'output/portable-smoke/verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf8')
        finally:
            process.terminate(); process.wait(timeout=10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--probe', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(); root = args.root.resolve()
    probe(root) if args.probe else verify(root)
