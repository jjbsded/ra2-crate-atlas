"""Language preferences persist independently of the browser and build inputs."""
import json
from pathlib import Path
import tempfile
import re
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import i18n_settings as settings
import server


class Languages(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'data/ui-language.json'
        self.files = patch.object(settings, 'SETTINGS', self.path)
        self.system = patch.object(settings, 'system_language', return_value='en')
        self.files.start()
        self.system.start()

    def tearDown(self):
        self.system.stop()
        self.files.stop()
        self.temp.cleanup()

    def test_persistence_and_corruption(self):
        self.assertEqual(settings.settings(), {'system': 'en', 'saved': None})
        settings.save('zh-CN')
        self.assertEqual(settings.language(), 'zh-CN')
        self.assertEqual(json.loads(self.path.read_text('utf8')), {'language': 'zh-CN'})
        self.assertFalse(self.path.with_suffix('.tmp').exists())
        with self.assertRaises(ValueError):
            settings.save('fr')
        self.assertEqual(settings.language(), 'zh-CN')
        for bad in ('{', '[]', 'null', '{"language":"unsupported"}'):
            self.path.write_text(bad, 'utf8')
            self.assertEqual(settings.language(), 'en')

    def test_http_and_restart(self):
        for iteration in range(2):
            http = server.LocalServer(('127.0.0.1', 0), server.Handler)
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            origin = f'http://127.0.0.1:{http.server_port}'
            try:
                with urlopen(origin+'/language-settings.js') as response:
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    config = json.loads(response.read().decode().split('=', 1)[1].rstrip(';'))
                    self.assertEqual(config['saved'], 'zh-CN' if iteration else 'en')
                if iteration:
                    continue
                def request(body, request_origin=origin):
                    return urlopen(Request(origin+'/api/preferences/language', data=body,
                        headers={'Content-Type': 'application/json', 'Origin': request_origin}))
                with request(b'{"language":"zh-CN"}') as response:
                    self.assertEqual(json.load(response), {'language': 'zh-CN'})
                for body in (b'{', b'[]', b'{}', b'{"language":42}', b'{"language":"fr"}', b'x'*129):
                    with self.assertRaises(HTTPError) as error:
                        request(body)
                    self.assertEqual(error.exception.code, 400)
                with self.assertRaises(HTTPError) as error:
                    request(b'{"language":"en"}', 'https://unrelated.example')
                self.assertEqual(error.exception.code, 403)
                self.assertEqual(settings.language(), 'zh-CN')
                with urlopen(origin+'/research?language=en') as response:
                    self.assertIn(b'Random crate', response.read())
            finally:
                http.shutdown()
                http.server_close()
                thread.join(3)

    def test_first_automatic_choice_is_saved(self):
        self.assertEqual(settings.settings(initialize=True)['saved'], 'en')
        with patch.object(settings, 'system_language', return_value='zh-CN'):
            self.assertEqual(settings.settings(initialize=True), {'system': 'zh-CN', 'saved': 'en'})

    def test_documentation_pairs_and_links(self):
        root = Path(__file__).resolve().parent
        pairs = [('README.zh-CN.md', 'README.md'), ('third-party-notices.zh-CN.md', 'third-party-notices.md')]
        pairs += [(name+'.md', name+'.en.md') for name in ('PORTABLE', 'REAL-MAPS', 'RENDERING', 'ARCHITECTURE',
                  'docs/bridge-crates', 'docs/stock-map-loading', 'docs/random-crate-generation')]
        for chinese, english in pairs:
            for name, other in ((chinese, english), (english, chinese)):
                text = (root/name).read_text('utf8')
                self.assertIn(Path(other).name, text.splitlines()[0], name)
            for link in re.findall(r'\]\(([^)]+)\)', (root/english).read_text('utf8')):
                if '://' in link or link.startswith('#'):
                    continue
                target = (root/english).parent/link.split('#')[0]
                self.assertTrue(target.is_file(), f'{english}: {link}')


if __name__ == '__main__':
    unittest.main()
