# Bundled runtime components

This local portable build preserves Python's LICENSE.txt and each Python
distribution's *.dist-info license files. Application sources and the C scanner
source are included. Stock game archives are copied from the user’s local installation into assets/original, with fixed source SHA-256 verification.

- Python 3.12: Python Software Foundation license; https://www.python.org/
- Pillow 12.3.0: license in pillow-12.3.0.dist-info; https://python-pillow.org/
- NumPy 2.3.5 and its bundled numerical libraries: licenses in numpy-2.3.5.dist-info and numpy; https://numpy.org/
- ra2mix 1.0.4: GPLv3, full source and LICENSE included; https://github.com/endless-creation/ra2mix
- blowfish 0.6.1: source and distribution license included; https://pypi.org/project/blowfish/
- lzokay 2.1.0: distribution license included; https://pypi.org/project/lzokay/
- Node.js 24.19.0: full version-specific LICENSE included in runtime/node/LICENSE; https://nodejs.org/
- @napi-rs/canvas and Windows x64 native module: package licenses included; https://github.com/Brooooooklyn/canvas
- Three.js 0.160.0: MIT, vendored as `lib/three-r160.min.js`; full license in `lib/three-LICENSE.txt`. Upstream: https://github.com/mrdoob/three.js/tree/r160. Loaded locally, without a CDN dependency.
- FFmpeg: GPLv3 build copied from the locally installed binary, complete GPL text in runtime/ffmpeg/COPYING.GPLv3. Build version/configuration in runtime/ffmpeg/build-version.txt. Project/source: https://ffmpeg.org/ and https://www.gyan.dev/ffmpeg/builds/

Original graphics, example maps and game data retain their respective owners'
rights. This folder is a local tool bundle, not a transfer of those rights.
`examples/cliff-demo.json` contains a small original YR snow-terrain excerpt
and its textures for the offline height-difference demonstration. Its source
map hash is recorded in the file; it contains no Mod assets or configuration.
The offline official multiplayer catalog in `official-maps` preserves 248 map
files from the user's original `MULTI.MIX` and `multimd.mix`, without rewriting
their bytes. Names and mode registrations come from the official PKT and CSF
resources; Traditional Chinese names are displayed in Simplified Chinese.
Archive, registry, string-table and individual map SHA-256 hashes, as well as
omitted registry references, are recorded in `official-maps/catalog.json`.
Object rendering integration (2026-10-14): `resource_context/ra2map.py` and
`resource_context/ra2mod.py` are copies of the user's local ra2yr-map v0.9
read-only parsing tools, with their original source headers preserved.
FA2SPHE source was inspected for frame/anchor conventions; the editor executable
is not embedded. This local bundle includes the existing CncVxlRenderText.dll
and its x86 Microsoft Visual C++ runtime dependencies in runtime/voxel, so
rendering does not depend on an editor installation. Component hashes and
local provenance are in runtime/voxel/provenance.json. Upstream FA2SPHE
readme and license are retained there as project notices, without attributing
that license to independently provided Microsoft or game components.
Mod graphics remain in the optional user-selected game directory.
