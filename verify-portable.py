"""Package preflight must preserve previous builds, including dotted names."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-portable.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
OUT = (Path(__file__).resolve().parent/'output/portable-verification').resolve()
OUT.relative_to(Path(__file__).resolve().parent)
OUT.mkdir(parents=True, exist_ok=True)


class PackageChecks(unittest.TestCase):
    def test_server_does_not_reuse_a_different_installation(self):
        import server
        for identity, reuse in ((server.INSTANCE_ID, True), ('another-version', False)):
            payload = io.BytesIO(json.dumps({'feature':'real-maps-v1', 'instance':identity}).encode())
            with patch.object(server, 'LocalServer', side_effect=OSError()), \
                 patch('urllib.request.urlopen', return_value=payload), \
                 patch('sys.argv', ['server.py']), patch('builtins.print'):
                if reuse:
                    server.main()
                else:
                    with self.assertRaisesRegex(RuntimeError, '旧版本'):
                        server.main()

    def test_preflight_rejects_missing_frontend_and_worker(self):
        original = builder.require_file
        for missing in ('cliff-demo.js', 'output/realmap-tools/voxel-worker.exe'):
            def require(path):
                if path == builder.ROOT/missing:
                    raise ValueError('missing '+missing)
                original(path)
            with patch.object(builder, 'require_file', require):
                with self.assertRaisesRegex(ValueError, missing.replace('.', r'\.')):
                    builder.validate_sources()

    def test_launchers_select_the_named_page(self):
        for name, page in (('启动工具.cmd', 'maps'), ('启动演示.cmd', 'demo')):
            text = (builder.ROOT/name).read_text('utf8')
            commands = [s for s in text.splitlines() if 'server.py' in s]
            self.assertEqual(len(commands), 1)
            self.assertTrue(all('--page '+page in s for s in commands))
            self.assertIn('run-python.cmd', text)
            self.assertNotIn('codex', text.casefold())
        self.assertIn(builder.ROOT/'run-python.cmd', builder.frontend_files())

    def test_runtime_dependency_closure(self):
        builder.validate_sources()
        modules = tuple(name for name in builder.APPLICATION_MODULES if name != 'map_results.py')
        with patch.object(builder, 'APPLICATION_MODULES', modules):
            with self.assertRaisesRegex(ValueError, 'map_results.py'):
                builder.validate_sources()

    def test_existing_zip_is_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory(dir=OUT) as temporary:
            self.assertTrue(Path(temporary).resolve().is_relative_to(OUT))
            for name in ('CrateAtlas', 'CrateAtlas.v0.2.0'):
                target = Path(temporary)/name
                archive = target.with_name(target.name+'.zip')
                archive.write_bytes(b'previous build')
                with self.assertRaisesRegex(ValueError, 'ZIP'):
                    builder.build(target, None, None, None)
                self.assertEqual(archive.read_bytes(), b'previous build')
                self.assertFalse(target.exists())

    def test_existing_folder_is_preserved(self):
        with tempfile.TemporaryDirectory(dir=OUT) as temporary:
            self.assertTrue(Path(temporary).resolve().is_relative_to(OUT))
            target = Path(temporary)/'CrateAtlas'
            target.mkdir()
            saved = target/'user-file.txt'
            saved.write_bytes(b'keep this')
            with self.assertRaises(ValueError):
                builder.build(target, None, None, None)
            self.assertEqual(saved.read_bytes(), b'keep this')
            self.assertFalse(target.with_name(target.name+'.zip').exists())

    def test_both_archive_formats_preserve_existing_7z(self):
        with tempfile.TemporaryDirectory(dir=OUT) as temporary:
            target = Path(temporary)/'CrateAtlas.test'
            archive = target.with_name(target.name+'.7z')
            archive.write_bytes(b'keep this archive')
            with self.assertRaises(ValueError):
                builder.archive_files(target)
            self.assertEqual(archive.read_bytes(), b'keep this archive')

    def test_archive_only_zip_needs_no_extra_tool(self):
        with tempfile.TemporaryDirectory(dir=OUT) as temporary:
            target = Path(temporary)/'CrateAtlas.test'
            archives, tool = builder.archive_files(target, 'zip')
            self.assertIsNone(tool)
            self.assertEqual(archives, [target.with_name(target.name+'.zip')])


if __name__ == '__main__':
    unittest.main()
