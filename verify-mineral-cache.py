"""Exercise mineral cache concurrency and restart links through the HTTP API."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import threading
import time
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
from realmap import sha


def main():
    output = server.ROOT/'output'
    folder = Path(tempfile.mkdtemp(prefix='mineral-cache-', dir=output))
    source = f'/output/{folder.name}/result.json'
    raw = b'[Map]\nSize=0,0,20,20\n'
    report = {'metadata': {'sourceSha256': sha(raw), 'filename': 'cache-test.map',
                          'version': 'yr', 'mineralsEnabled': True, 'cellCount': 1,
                          'rulesSha256': 'rules-a', 'resourceFingerprint': 'resources-a'},
              'rendering': {'version': 10}}
    (folder/'source.map').write_bytes(raw)
    (folder/'result.json').write_text(json.dumps(report), 'utf8')
    calls, generated = [], []
    entered, release = threading.Event(), threading.Event()

    def analyze(data, destination, version, filename, progress, mix_paths, **options):
        calls.append(options['minerals_enabled'])
        destination.mkdir(parents=True)
        generated.append(destination)
        if len(calls) == 1:
            entered.set()
            assert release.wait(10), 'Test did not release the background job'
        result = copy.deepcopy(report)
        result['metadata']['mineralsEnabled'] = options['minerals_enabled']
        (destination/'source.map').write_bytes(data)
        (destination/'result.json').write_text(json.dumps(result), 'utf8')
        return result

    class QuietHandler(server.Handler):
        def log_message(self, *args):
            pass

    http = server.LocalServer(('127.0.0.1', 0), QuietHandler)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{http.server_port}'

    def request(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        with urlopen(Request(base+path, data=data, headers={'Content-Type': 'application/json'}), timeout=10) as response:
            return json.load(response)

    def complete(job):
        deadline = time.monotonic()+10
        while time.monotonic() < deadline:
            status = request('/api/maps/job/'+job['id'])
            assert not status.get('error'), status
            if status.get('done'):
                return status['url']
            time.sleep(.02)
        raise AssertionError('Job did not complete')

    try:
        with patch('realmap.analyze', analyze), patch.object(server.resource_store, 'resolve', return_value=[]):
            payload = {'result': source, 'enabled': False}
            background = request('/api/maps/minerals', {**payload, 'background': True})
            assert entered.wait(5)
            assert request('/api/maps/minerals', payload) == background, 'Foreground must join the preload'
            # Importing a new map while preloading queues instead of returning 409.
            foreground = request('/api/maps/heck?version=yr', {})
            assert request('/api/maps/job/'+foreground['id'])['message'] == '等待后台预加载完成'
            assert len(calls) == 1, 'Native analyses must remain serial'
            release.set()
            variant = complete(background)
            complete(foreground)
            assert calls == [False, True]
            server.MAPS = server.MapJobs()  # Fresh service simulates a process restart.
            assert request('/api/maps/minerals', payload)['url'] == variant, 'Forward link survives restart'
            assert request('/api/maps/minerals', {'result': variant, 'enabled': True})['url'] == source
            assert len(calls) == 2, 'Both disk caches must avoid reanalysis'
            print('PASS: in-flight reuse, nonblocking queued import, serial execution, restart-safe pair cache.')

            variant_path = server.ROOT/variant.lstrip('/')
            cached = json.loads(variant_path.read_text('utf8'))
            cached['rendering']['version'] = 9
            variant_path.write_text(json.dumps(cached), 'utf8')
            replacement = request('/api/maps/minerals', payload)
            assert 'id' in replacement, 'Older rendering must not be reused'
            complete(replacement)
            cached = json.loads((folder/'mineral-variants.json').read_text('utf8'))
            current_path = server.ROOT/cached['false'].lstrip('/')
            current = json.loads(current_path.read_text('utf8'))
            current['metadata']['resourceFingerprint'] = 'changed'
            current_path.write_text(json.dumps(current), 'utf8')
            replacement = request('/api/maps/minerals', payload)
            assert 'id' in replacement, 'Different resource fingerprints must not be reused'
            complete(replacement)
            for invalid in ('yes', 1, None):
                try:
                    request('/api/maps/minerals', {**payload, 'background': invalid})
                except HTTPError as error:
                    assert error.code == 400
                else:
                    raise AssertionError('Invalid preload flag accepted')
            (folder/'source.map').unlink()
            try:
                request('/api/maps/minerals', payload)
            except HTTPError as error:
                assert error.code == 400
                assert '请重新导入地图' in json.load(error)['error']
            else:
                raise AssertionError('Missing source was not reported')
            print('PASS: rendering/resource cache invalidation and strict preload request validation.')
    finally:
        release.set()
        http.shutdown()
        http.server_close()
        for target in [folder, *generated]:
            target = target.resolve()
            assert target.is_relative_to(output.resolve()) and target != output.resolve()
            shutil.rmtree(target)


if __name__ == '__main__':
    main()
