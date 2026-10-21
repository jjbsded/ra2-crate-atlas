"""Check the files Git will publish, without staging or changing the index."""
import ast
from pathlib import Path
import runpy
import subprocess

ROOT = Path(__file__).resolve().parent
files = {s.decode('utf8') for s in subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).split(b'\0') if s}
builder = runpy.run_path(str(ROOT/'build-portable.py'))
expected = set(builder['APPLICATION_MODULES']) | set(builder['EXTRA_FILES']) | set(builder['DATA_FILES'])
expected.update(p.relative_to(ROOT).as_posix() for p in builder['frontend_files']())
assert not expected-files, 'Git ignores release inputs: '+str(sorted(expected-files))
for name in files:
    assert not name.startswith(('data/', 'profiles/', 'assets/')), 'Personal or large resources staged: '+name
    if name.startswith('output/'):
        assert name in expected, 'Analysis output staged: '+name
    path = ROOT/name
    assert path.is_file() and path.stat().st_size < 50*1024*1024, name
    if path.suffix != '.py':
        continue
    for node in ast.walk(ast.parse(path.read_text('utf8'))):
        imports = [entry.name.split('.')[0]+'.py' for entry in node.names] if isinstance(node, ast.Import) else \
                  [(node.module or '').split('.')[0]+'.py'] if isinstance(node, ast.ImportFrom) else \
                  [node.value] if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.endswith('.py') else []
        for dependency in imports:
            if len(dependency) < 200 and (ROOT/dependency).is_file():
                assert dependency in files, f'{name} depends on ignored file {dependency}'
print(f'PASS {len(files)} source files: release inputs and test dependencies included; local outputs/settings excluded')
