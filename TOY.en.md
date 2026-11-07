**English** | [简体中文](TOY.md)

# Toy

Current probability model: **up to 1000 finite retries integrated with exact mathematical weights, reporting final creation success or failure**. Candidate searches remain incremental. See [the model contract](docs/probability-model.md).

Toy is one maintained product: precomputed official maps and browser-local custom map analysis in the same package. The former precomputed-only edition is retired. The former live-analysis experiment is now simply Toy. Internal names such as `toy-live/`, `build-toy-live.py` and `liveAnalysisExperiment` remain for code/data compatibility, not as separate product editions.

## Run

[Download v0.6.0 Toy ZIP](https://github.com/jjbsded/ra2-crate-atlas/releases/download/v0.6.0/CrateAtlas-v0.6.0-Toy-Web.zip) · [Release notes and checksums](https://github.com/jjbsded/ra2-crate-atlas/releases/tag/v0.6.0).

Double-click `D:/Ra2/Work/启动箱子Toy.cmd`, or `启动Toy网页版.cmd` in the source project. Both select the same latest package through the `toy` key in `output/latest-release.json`. To distribute, fully extract the release ZIP and double-click `Start Toy.cmd`: it uses Windows PowerShell/.NET and needs no Python, Node.js or game installation. Alternatively deploy to Toy or an HTTPS static host. Opening HTML with file:// is unsupported.

Official Battle/Team Alliance maps include 131 menu entries, 147 version variants and 294 ore/tree layouts with exact probability data. Local `.map`, `.yrm` and `.mpr` imports up to 16 MB run in a browser worker, stay on your device, support cancellation and cache simulated layouts. Choose the correct game version. Regions persist by map content; reselect custom files after reload.

Simulation supports placement, normal/chrono destruction, restoration brushes, bulk clearing, undo/redo and cached delta import/export. Recalculate the original or edited layout independently. Simulated objects use 3-pixel fixed-brightness yellow/black diagonal stripes only in their faction-color pixels. See [simulation details](docs/simulation-mode.md).

Official artwork uses native-resolution lossless atlases. Custom maps reuse bundled assets; missing tiles, facings or damage states use reported simplified fallbacks. Lighting and house-color fixes are included. Grid and occupancy start off. The blocking-risk switch also controls potential risks after clearing objects. The 1x layer has its own switch, separate from labels, and follows the probability master. Canvas resolution follows DPI changes; magnification preserves pixel edges while overview reduction still requires sampling.

Scope is stock resources and simple embedded rules. Triggers, scripts, moving units, ore growth and Mod DLLs are not simulated. Unknown data produces approximate-result warnings; those results do not validate post-placement blocking. Static lighting does not simulate every local light, weather effect or animated part. Workers, BigInt, Web Crypto and gzip decoding are required; 3D requires WebGL.

## Build

The current local simulation build is `output/CrateAtlas-Toy-Simulation-20261104.zip`, with simulation editing and 3-pixel fixed-brightness yellow/black diagonal stripes. It retains the turret/wall fixes below; the GitHub v0.6.0 download has not been updated. The builder enforces a 50,000,000-byte ZIP limit; verification is recorded in `output/simulation-20261104/toy-package.json`.

The local 2026-11-04 Toy package includes component assembly for embedded map rules: Image aliases, independent turret removal, and existing building turret swaps/offsets. It is `output/CrateAtlas-Toy-20261104.zip`, at 49,369,265 bytes (49.37 MB). These changes are not in the GitHub v0.6.0 download above. See [scope and verification](docs/toy-turret-components.md); unbaked geometry such as new FireAngle values remains unsupported.

This local package also fills missing stock wall/fence connectivity and damage frames, including T-junctions and four-way intersections absent from the official-map sample. GAPILL retains its base artwork when a map sets Turret=yes without TurretAnim.

```powershell
.\run-python.cmd -B build-toy.py --output output/toy-build/base --mode standard --mode teamgame --jobs 3
.\run-python.cmd -B build-toy-original.py --source output/toy-build/base --output output/toy-build/artwork --jobs 3
.\run-python.cmd -B build-toy-live.py --source output/toy-build/artwork --output output/toy
.\run-python.cmd -B verify-toy.py output/toy --mode standard --mode teamgame
```

The first two commands are internal data/artwork stages: no release ZIP or Windows launcher. Only build-toy-live.py publishes Toy, enforcing a **50,000,000-byte ZIP limit**. Rebuild affected caches after analysis/render changes; never spoof fingerprints. For frontend-only changes, refresh the internal artwork stage with `build-toy.py --refresh-ui`, then rebuild the final Toy. Never refresh the final package directly with the internal-stage builder.

See [lighting integration](docs/voxel-lighting.md), [mechanism research](docs/random-crate-generation.en.md) and [the seven-requirement review](docs/review-seven-requirements-20261103.md). Historical releases are archives, not maintained products.
