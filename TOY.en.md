**English** | [简体中文](TOY.md)

# Toy

Toy is one maintained product: precomputed official maps and browser-local custom map analysis in the same package. The former precomputed-only edition is retired. The former live-analysis experiment is now simply Toy. Internal names such as `toy-live/`, `build-toy-live.py` and `liveAnalysisExperiment` remain for code/data compatibility, not as separate product editions.

## Run

Double-click `D:/Ra2/Work/启动箱子Toy.cmd`, or `启动Toy网页版.cmd` in the source project. Both select the same latest package through the `toy` key in `output/latest-release.json`. To distribute, fully extract the release ZIP and double-click `Start Toy.cmd`: it uses Windows PowerShell/.NET and needs no Python, Node.js or game installation. Alternatively deploy to Toy or an HTTPS static host. Opening HTML with file:// is unsupported.

Official Battle/Team Alliance maps include 131 menu entries, 147 version variants and 294 ore/tree layouts with exact probability data. Local `.map`, `.yrm` and `.mpr` imports up to 16 MB run in a browser worker, stay on your device, support cancellation and cache both layouts. Choose the correct game version. Regions persist by map content; reselect custom files after reload.

Official artwork uses native-resolution lossless atlases. Custom maps reuse bundled assets; missing tiles, facings or damage states use reported simplified fallbacks. Lighting and house-color fixes are included. Grid and occupancy start off. The blocking-risk switch also controls potential risks after clearing objects. The 1x layer has its own switch, separate from labels, and follows the probability master. Canvas resolution follows DPI changes; magnification preserves pixel edges while overview reduction still requires sampling.

Scope is stock resources and simple embedded rules. Triggers, scripts, moving units, ore growth and Mod DLLs are not simulated. Unknown data produces approximate-result warnings; those results do not validate post-placement blocking. Static lighting does not simulate every local light, weather effect or animated part. Workers, BigInt, Web Crypto and gzip decoding are required; 3D requires WebGL.

## Build

```powershell
.\run-python.cmd -B build-toy.py --output output/toy-build/base --mode standard --mode teamgame --jobs 3
.\run-python.cmd -B build-toy-original.py --source output/toy-build/base --output output/toy-build/artwork --jobs 3
.\run-python.cmd -B build-toy-live.py --source output/toy-build/artwork --output output/toy
.\run-python.cmd -B verify-toy.py output/toy --mode standard --mode teamgame
```

The first two commands are internal data/artwork stages: no release ZIP or Windows launcher. Only the final command publishes Toy, enforcing a **50,000,000-byte ZIP limit**. Rebuild affected caches after analysis/render changes; never spoof fingerprints. For frontend-only changes, refresh the internal artwork stage with `build-toy.py --refresh-ui`, then rebuild the final Toy. Never refresh the final package directly with the internal-stage builder.

See [lighting integration](docs/voxel-lighting.md), [mechanism research](docs/random-crate-generation.en.md) and [the seven-requirement review](docs/review-seven-requirements-20261103.md). Historical releases are archives, not maintained products.
