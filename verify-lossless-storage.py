"""Byte/pixel parity, legacy URLs and idle optimization with real HTTP requests."""
import gzip
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import sys
import unittest
from unittest.mock import patch
import runtime_bootstrap
from PIL import Image
import map_images
import map_results
import map_storage as storage

OUT = runtime_bootstrap.ROOT/'output/lossless-verification'
OUT.mkdir(parents=True, exist_ok=True)
REAL_MAP = '--real-map' in sys.argv
if REAL_MAP:
    sys.argv.remove('--real-map')


class StorageChecks(unittest.TestCase):
    @unittest.skipUnless(REAL_MAP, 'Pass --real-map for full renderer parity')
    def test_real_map_probabilities_png_webp_and_cached_copy(self):
        from official_maps import select
        from realmap import analyze
        from official_precomputed import RESULT_FIELDS
        import official_render_cache
        raw, filename, _ = select('f1d9bb89e2eb07cdb7af', 'yr')
        def png_layers(ground, scene, folder, version):
            ground.save(folder/'ground.png'); scene.save(folder/'objects.png')
            return 'ground.png', 'objects.png'
        with tempfile.TemporaryDirectory(dir=OUT) as temp:
            folder = Path(temp); old = folder/'png'; new = folder/'webp'
            with patch.object(map_images, 'save_layers', png_layers):
                before = analyze(raw, old, 'yr', filename, use_precomputed=False)
            after = analyze(raw, new, 'yr', filename, use_precomputed=False)
            self.assertEqual(before['cells'], after['cells'])
            for key in RESULT_FIELDS:
                self.assertEqual(before[key], after[key])
            for field in ('image', 'objectImage'):
                with Image.open(old/before['rendering'][field]) as a, Image.open(new/after['rendering'][field]) as b:
                    self.assertEqual(a.size, b.size); self.assertEqual(a.tobytes(), b.tobytes())
            self.assertEqual(after['rendering']['image'], after['rendering']['objectImage'])
            original_bytes = {p.name: p.read_bytes() for p in new.iterdir() if p.name in storage.COMPRESSED_DOWNLOADS}
            raw_size = sum(p.stat().st_size for p in old.iterdir() if p.is_file())
            storage.write_report(new/'result.json', after); storage.compress_downloads(new)
            for name, data in original_bytes.items():
                self.assertEqual(storage.read_bytes(new/name), data)
            with patch.object(official_render_cache, 'index_path', lambda _: folder/'index.json'):
                url = '/'+new.relative_to(runtime_bootstrap.ROOT).as_posix()+'/result.json'
                official_render_cache.remember('test', new, url)
                fast_size = sum(p.stat().st_size for p in new.iterdir() if p.is_file())
                map_images.optimize(new, lambda: official_render_cache.remember('test', new, url))
                cloned = official_render_cache.reuse('test', folder/'copy', filename, lambda *_: None)
                self.assertIsNotNone(cloned)
                self.assertEqual(cloned['cells'], before['cells'])
            for field in ('image', 'objectImage'):
                with Image.open(old/before['rendering'][field]) as a, Image.open(new/after['rendering'][field]) as b:
                    self.assertEqual(a.tobytes(), b.tobytes())
            result = dict(pixels='identical', cells='identical', probabilities='identical', downloads='byte-identical',
                          beforeBytes=raw_size, fastBytes=fast_size,
                          idleBytes=sum(p.stat().st_size for p in new.iterdir() if p.is_file()))
            (OUT/'real-map-parity.json').write_text(json.dumps(result, indent=2), 'utf8')
            print(json.dumps(result), flush=True)

    def test_atomic_report_storage_legacy_and_cache_invalidation(self):
        with tempfile.TemporaryDirectory(dir=OUT) as temp:
            path = Path(temp)/'result.json'
            report = {'cells': [{'x': 1, 'y': 2, 'level': 0}], 'exact': '9'*10000}
            storage.write_report(path, report, compressed=False)
            self.assertEqual(map_results.load_report(path)[0], report)
            report['cells'][0]['level'] = 4
            stored = storage.write_report(path, report)
            self.assertFalse(path.exists()); self.assertTrue(stored.is_file())
            self.assertEqual(map_results.load_report(path)[1][1, 2]['level'], 4)
            url = '/'+path.relative_to(runtime_bootstrap.ROOT).as_posix()
            self.assertEqual(map_results.result_path(url), stored.resolve())
            report['cells'][0]['level'] = 5
            storage.write_report(path, report)
            self.assertEqual(map_results.load_report(path)[1][1, 2]['level'], 5)
            stored.write_bytes(b'bad gzip')
            with self.assertRaisesRegex(ValueError, 'damaged'):
                map_results.load_report(path)
            storage.write_report(path, report, compressed=False)
            self.assertFalse(stored.exists())
            self.assertEqual(map_results.load_report(path)[0], report)

    def test_http_stable_json_csv_and_head(self):
        import server
        with tempfile.TemporaryDirectory(dir=OUT) as temp:
            root = Path(temp); folder = root/'output/map-test'; folder.mkdir(parents=True)
            report = {'cells': [], 'metadata': {'filename': 'test.map'}, 'exact': '123456789'*1000}
            storage.write_report(folder/'result.json', report)
            csv = '\ufeffx,y,概率\r\n1,2,0.0001\r\n'.encode('utf8')
            (folder/'cells.csv').write_bytes(csv); storage.compress_downloads(folder)
            (folder/'legacy.json').write_bytes(b'{"legacy":true}')
            with patch.object(server, 'ROOT', root):
                httpd = server.LocalServer(('127.0.0.1', 0), server.Handler)
                worker = threading.Thread(target=httpd.serve_forever, daemon=True); worker.start()
                try:
                    for name, expected in [('result.json', storage.read_bytes(folder/'result.json')), ('cells.csv', csv)]:
                        for encoding, compressed in [('gzip', True), ('gzip;q=0, *;q=1', False), ('identity', False), ('*', True)]:
                            for method in ('GET', 'HEAD'):
                                conn = http.client.HTTPConnection(*httpd.server_address)
                                conn.request(method, '/output/map-test/'+name, headers={'Accept-Encoding': encoding})
                                response = conn.getresponse(); data = response.read()
                                self.assertEqual(response.status, 200)
                                self.assertEqual(response.getheader('Content-Encoding'), 'gzip' if compressed else None)
                                if method == 'HEAD':
                                    self.assertFalse(data)
                                else:
                                    self.assertEqual(len(data), int(response.getheader('Content-Length')))
                                    self.assertEqual(gzip.decompress(data) if compressed else data, expected)
                                conn.close()
                    conn = http.client.HTTPConnection(*httpd.server_address)
                    conn.request('GET', '/output/map-test/legacy.json'); self.assertEqual(conn.getresponse().read(), b'{"legacy":true}'); conn.close()
                finally:
                    httpd.shutdown(); httpd.server_close(); worker.join(2)

    def test_pixels_aliases_transparency_large_dimensions_and_idle(self):
        with tempfile.TemporaryDirectory(dir=OUT) as temp:
            folder = Path(temp)
            image = Image.frombytes('RGBA', (96, 64), bytes((i*19+i//8)%256 for i in range(96*64*4)))
            ground, other = map_images.save_layers(image, image.copy(), folder, 1)
            self.assertEqual(ground, other)
            self.assertEqual(Image.open(folder/ground).tobytes(), image.tobytes())
            transparent = Image.new('RGBA', (1, 1), (20, 30, 40, 0))
            different = Image.new('RGBA', (1, 1), (60, 70, 80, 0))
            a, b = map_images.save_layers(transparent, different, folder, 2)
            self.assertNotEqual(a, b)
            self.assertEqual(Image.open(folder/a).tobytes(), transparent.tobytes())
            wide = Image.new('RGBA', (16384, 1), (1, 2, 3, 4))
            name = map_images.save_image(wide, folder/'wide')
            self.assertTrue(name.endswith('.png'))
            self.assertEqual(Image.open(folder/name).tobytes(), wide.tobytes())
            storage.write_report(folder/'result.json', dict(rendering=dict(image=ground, objectImage=other)))
            committed = threading.Event(); idle = threading.Event()
            optimizer = map_images.IdleOptimizer(idle.is_set)
            optimizer.submit(folder, committed.set)
            self.assertFalse(committed.wait(.1))
            idle.set(); self.assertTrue(committed.wait(5))
            with optimizer._lock:
                worker = optimizer._thread
            if worker:
                worker.join(5)
            after = (folder/ground).read_bytes()
            self.assertEqual(Image.open(folder/ground).tobytes(), image.tobytes())
            map_images.optimize(folder, lambda: self.fail('Already optimized file was republished'))
            self.assertEqual((folder/ground).read_bytes(), after)


if __name__ == '__main__':
    unittest.main()
