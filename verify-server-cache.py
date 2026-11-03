"""UI upgrades bypass stale browser caches; large map images stay cacheable."""
import html
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

import server


class CacheChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root/'maps.html').write_text('<script src="app.js?v=old&amp;x=1"></script><link href="app.css?v=old" rel="stylesheet">', 'utf8')
        (self.root/'app.js').write_text('window.version="new";', 'utf8')
        (self.root/'app.css').write_text('body{color:green}', 'utf8')
        (self.root/'output').mkdir()
        (self.root/'output/map.png').write_bytes(b'unchanged map pixels')
        # Retained ZIP timestamps must not make upgraded code look unchanged.
        for name in ('maps.html', 'app.js', 'app.css'):
            os.utime(self.root/name, (1700000000, 1700000000))
        self.root_patch = patch.object(server, 'ROOT', self.root)
        self.root_patch.start()
        class QuietHandler(server.Handler):
            def log_message(self, *args):
                pass
        self.http = server.LocalServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown()
        self.thread.join(3)
        self.http.server_close()
        self.root_patch.stop()
        self.temp.cleanup()

    def test_old_conditional_requests_receive_current_ui_not_304(self):
        for name in ('maps.html', 'app.js?v=old', 'app.css?v=old'):
            with self.subTest(name=name):
                request = Request(self.base+'/'+name, headers={'If-Modified-Since': 'Tue, 01 Jan 2030 00:00:00 GMT', 'If-None-Match': '"old-ui"'})
                with urlopen(request) as response:
                    data = response.read()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    self.assertEqual(int(response.headers['Content-Length']), len(data))
                with urlopen(Request(self.base+'/'+name, method='HEAD')) as response:
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    self.assertEqual(int(response.headers['Content-Length']), len(data))
                    self.assertEqual(response.read(), b'')

    def test_first_upgrade_changes_script_and_style_urls(self):
        with urlopen(self.base+'/maps.html') as response:
            page = html.unescape(response.read().decode())
        self.assertIn('app.js?v=old&x=1&build='+server.INSTANCE_ID[:20], page)
        self.assertIn('app.css?v=old&build='+server.INSTANCE_ID[:20], page)
        self.assertEqual(server.frontend_html(server.frontend_html(b'<script src="app.js?build=old"></script>')).count(b'build='), 1)

    def test_external_urls_and_map_assets_are_not_rewritten(self):
        page = b'<script src="https://example.org/a.js"></script><link href="//example.org/a.css"><img src="output/map.png">'
        self.assertEqual(server.frontend_html(page), page)
        with urlopen(self.base+'/output/map.png') as response:
            modified = response.headers['Last-Modified']
            self.assertNotEqual(response.headers.get('Cache-Control'), 'no-store')
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.base+'/output/map.png', headers={'If-Modified-Since': modified}))
        self.assertEqual(caught.exception.code, 304)

    def test_every_launch_gets_a_fresh_document_url(self):
        first = urlsplit(server.browser_page_url(self.base, 'maps'))
        second = urlsplit(server.browser_page_url(self.base, 'maps'))
        self.assertEqual(first.path, '/maps.html')
        self.assertEqual(parse_qs(first.query)['build'], [server.INSTANCE_ID[:20]])
        self.assertNotEqual(parse_qs(first.query)['launch'], parse_qs(second.query)['launch'])
        self.assertEqual(urlsplit(server.browser_page_url(self.base, 'demo')).path, '/index.html')

    def test_reused_service_still_opens_a_fresh_url(self):
        with patch('sys.argv', ['server.py', '--port', str(self.http.server_port), '--open', '--page', 'maps']), \
                patch.object(server, 'bind_or_reuse', return_value=None), \
                patch.object(server.webbrowser, 'open') as opened:
            server.main()
            first = opened.call_args.args[0]
            server.main()
            second = opened.call_args.args[0]
        self.assertNotEqual(first, second)
        self.assertIn('build=', first)
        self.assertIn('launch=', first)


if __name__ == '__main__':
    unittest.main()
