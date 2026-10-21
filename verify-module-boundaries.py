"""Exercise low-level parsing without loading analysis or drawing machinery."""
import subprocess
import sys
import unittest
import ast
import runpy
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class ModuleChecks(unittest.TestCase):
    def test_browser_scripts_load_before_their_consumers(self):
        scripts = re.findall(r'<script src="([^"?]+)', (ROOT/'maps.html').read_text('utf8'))
        providers, references = {}, {}
        for name in scripts:
            code = (ROOT/name).read_text('utf8')
            for symbol in re.findall(r'(?:root|window|globalThis)\.(Crate\w+)\s*=', code):
                self.assertNotIn(symbol, providers, 'Duplicate browser module: '+symbol)
                providers[symbol] = name
            references[name] = set(re.findall(r'\bCrate\w+\b', code))
        # A strictly earlier provider for every edge also rules out cycles.
        for name, symbols in references.items():
            for symbol in symbols:
                provider = providers.get(symbol)
                if provider and provider != name:
                    self.assertLess(scripts.index(provider), scripts.index(name),
                                    f'{name} requires {provider} ({symbol})')

    def test_production_dependency_graph_has_no_cycles(self):
        modules = {Path(name).stem for name in runpy.run_path(str(ROOT/'build-portable.py'))['APPLICATION_MODULES']}
        # Only these two documented legacy entry points may point back up a
        # layer. All other imports, INCLUDING deferred function imports, count.
        legacy = {('realmap_mod', 'preview'), ('realmap_render', 'refresh_result')}
        graph = {}
        for module in modules:
            edges = set()
            class Imports(ast.NodeVisitor):
                def visit_FunctionDef(self, node):
                    if (module, node.name) not in legacy:
                        self.generic_visit(node)
                def visit_Import(self, node):
                    edges.update(n.name.split('.')[0] for n in node.names)
                def visit_ImportFrom(self, node):
                    edges.add((node.module or '').split('.')[0])
            Imports().visit(ast.parse((ROOT/(module+'.py')).read_text('utf8')))
            graph[module] = edges & modules
        finished = set()
        def visit(module, stack):
            self.assertNotIn(module, stack, 'Circular dependency: '+' -> '.join([*stack, module]))
            if module in finished:
                return
            for dependency in graph[module]:
                visit(dependency, [*stack, module])
            finished.add(module)
        for module in graph:
            visit(module, [])

    def test_parser_without_analysis_renderer_or_compiler(self):
        code = '''
import sys, tempfile
from pathlib import Path
from unittest.mock import patch
from realmap_parser import parse_map
from runtime_bootstrap import ROOT
with tempfile.TemporaryDirectory(dir=ROOT/'output') as temp:
    with patch('subprocess.run', side_effect=AssertionError('parsing invoked an external tool')):
        cells, res, theater, tmps, meta = parse_map(
            (ROOT/'examples/xmp32s8.map').read_bytes(), Path(temp), 'yr')
    assert len(cells) == 19690
    assert cells[99, 105]['rawLand'] == 7
    assert cells[99, 105]['rockTransition']
    assert meta['sourceSha256'] and theater['effectiveRules'] and tmps
for name in ('realmap', 'realmap_exact', 'realmap_render', 'realmap_objects',
             'realmap_3d', 'realmap_sprites', 'PIL.Image', 'numpy'):
    assert name not in sys.modules, name
'''
        result = subprocess.run([sys.executable, '-B', '-c', code], cwd=ROOT,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_resource_and_sprite_imports_do_not_load_analysis(self):
        code = '''
import sys
import realmap_resources, realmap_mod, realmap_sprites
assert 'realmap' not in sys.modules
assert 'realmap_parser' not in sys.modules
assert 'realmap_exact' not in sys.modules
'''
        result = subprocess.run([sys.executable, '-B', '-c', code], cwd=ROOT,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_legacy_imports_remain_compatible(self):
        import realmap
        import realmap_format as formats
        import realmap_parser as parser
        import realmap_resources as resources
        import realmap_sprites as sprites
        from realmap_objects import records
        for module, names in ((formats, ('ini', 'decode_pack', 'decode_lcw')),
                              (parser, ('parse_map', 'map_rules', 'land_after')),
                              (resources, ('Resources', 'resources')),
                              (sprites, ('tile_parts', 'shp_frame'))):
            for name in names:
                self.assertIs(getattr(realmap, name), getattr(module, name))
        self.assertIs(records, parser.object_records)
        import realmap_render
        for name in ('palette', 'sprite_spec', 'shadow_frame', 'SHADOW_ALPHA'):
            self.assertIs(getattr(realmap_render, name), getattr(sprites, name))

    def test_3d_does_not_import_2d_renderer(self):
        subprocess.run([sys.executable, '-B', '-c',
                        "import sys, realmap_3d; assert 'realmap_render' not in sys.modules; assert 'realmap_objects' not in sys.modules"],
                       cwd=ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
