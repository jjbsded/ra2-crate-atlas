"""Build-only identities for baked artwork; never shipped to Toy browsers."""
import hashlib
from pathlib import Path
import original_resources

ROOT = Path(__file__).resolve().parent


def artwork_fingerprint(extra=()):
    # Include indirect painter dependencies and actual worker binaries. A
    # changed normal table or VPL must not silently reuse old baked colors.
    names = {p.name for p in ROOT.glob('realmap*.py')} | {
        'toy_build_inputs.py', 'terrain_depth.py', 'map_results.py', 'map_images.py',
        'original_resources.py', 'voxel-worker.cs',
        'assets/urban-trees/sprites.zip', 'assets/urban-trees/provenance.json',
        'output/realmap-tools/voxel-worker.exe',
        'output/realmap-tools/voxel-worker.sha256',
    } | set(extra)
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT/'runtime/voxel').glob('*.dll'))
    digest = hashlib.sha256(b'toy-baked-artwork-v2')
    for name in sorted(names):
        path = ROOT/name
        raw = path.read_text('utf8').encode('utf8') if path.suffix in ('.py', '.cs', '.sha256') else path.read_bytes()
        digest.update(name.encode('utf8')+b'\0'+hashlib.sha256(raw).digest())
    # Stock archives contain every VPL, palette, model and texture. resolve()
    # verifies their content against the pinned identities before reuse.
    original_resources.resolve('yr')
    for role, (name, size, checksum) in sorted(original_resources.FILES.items()):
        digest.update(f'{role}:{name}:{size}:{checksum}'.encode('ascii'))
    return digest.hexdigest()
