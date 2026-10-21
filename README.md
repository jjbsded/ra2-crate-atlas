**English** | [简体中文](README.zh-CN.md)

# Crate Atlas — Red Alert 2 / Yuri's Revenge

Explore where random crates can appear on real maps, compare regions and inspect the game's placement rules. Crate Atlas runs locally on **Windows 10 / 11, 64-bit**, without starting the game.

## Download and run

**[Download the Windows portable package](https://github.com/jjbsded/ra2-crate-atlas/releases/latest)**, extract the entire ZIP, and run **Start Crate Atlas.cmd**. The Chinese launcher `启动工具.cmd` opens the same tool. No Python, Node.js or game installation is required: the package includes its runtimes, official maps and hash-verified stock resources. An optional game directory enables other installations or Mods; no specific Mod configuration or artwork is bundled.

The repository is **private**. Sign in to a GitHub account with repository access to see or download releases. Choose the **Windows-x64.zip release asset**, not GitHub's automatically generated “Source code” ZIP. Each release includes a SHA-256 file. See [portable use and migration](PORTABLE.en.md) before upgrading.

## English and Chinese

On first launch, the tool follows the **Windows display language**: Chinese selects Simplified Chinese; other languages select English. Switch using **中文 / English** at the top of any page. Subsequent launches remember that choice. UI text, explanations, map / video annotations and diagnostics follow the language; user-entered names, paths and numerical results are preserved. Official maps are searchable by both English and Chinese names.

The choice is saved locally in `data/ui-language.json`, excluded from Git and release builds. Opening the demo directly as a file uses the browser's language and browser storage instead. All guides below have a language switch at the top.

## What you can do

- **Analyze real maps.** Open `.map`, `.yrm` or `.mpr` files, or choose from 248 original official multiplayer files, organized into 256 mode-specific choices. Search and filter by game version, mode, maximum players and theater. Entries shared between RA2 and YR merge only when their crate-relevant static content matches; the original files and selectable analysis rules are retained.
- **Read probabilities.** The stock static model computes exact probabilities for the next placement call, including up to 1,000 attempts. Final percentages use two significant digits. Relative multipliers use the ordinary, no-incoming-transfer cell as the **1× baseline**, not the map-wide average.
- **Inspect transfer origins.** Select a destination to highlight origins that can reach it through nearby search, including projection priority. Percentages mean “chance of reaching this destination with this origin fixed,” averaged over frames and excluding retries. Direct rerolls are not transfer origins. Click the same cell again to deselect; dragging does not deselect.
- **Compare ore layouts.** **Ore: On / Off** removes or restores preset ore / gems and recalculates land properties, search, retries and risk markers. The other layout preloads when idle; both are cached. Main map, navigator, regions, 3D and exports use the same layout. View, selection and region undo history survive a switch. Drills and later ore growth are not removed or simulated.
- **See passability risks.** Pink marks cells that can receive a crate and then become impassable to ordinary infantry / tracked vehicles. Hatching marks additional potential risks after completely clearing buildings, minerals, trees and units without rubble. These markers do not claim a complete reachable route.
- **View original artwork.** Terrain, heights, buildings, infantry, vehicles and aircraft use original resources, static facings and house colors. Artwork and occupancy have separate switches. Probability labels stay on top.
- **Inspect nearby terrain in 3D.** Select a cell and open **3D view**. Rotate, zoom and pan; inspect high cells and the height-difference test area, and compare before / after placement. Default patch: 21×21; choices: 9, 13, 17, 21 or 31 cells per side. Probability colors / labels start off independently. Original theater textures, ramps, cliff relief, bridges, minerals and trees load locally. Buildings / units and complete pathfinding are outside the terrain inspector's scope.
- **Use the navigator.** Drag, minimize or close it; reopening restores its initial position. Click / drag the minimap to locate the viewport. Eight-way buttons and arrow keys move the selected cell; adjacent arrows combine within a short delay. Export the current view as PNG or the entire map as a high-resolution JPEG with readable multipliers.
- **Learn the mechanism.** The probability demo offers step-by-step playback and MP4 export. **Height demo** opens a standalone scene with an isolated high cell and a real-map excerpt, without importing a map or configuring resources.
- **Load directory resources.** Rules, art, loose files, expansion MIX archives and includes are discovered from the selected directory. Approximate probabilities remain available when parts are unknown: uncertain objects assume final-placement failure and retry, with visible warnings that accuracy is not guaranteed.

Analysis describes the map's **initial static state**, not a running match, executed triggers, spawn frequency or arbitrary Mod engine extensions. Mode labels identify map variants; they do not simulate a mode's opening units or later gameplay. See [real-map scope](REAL-MAPS.en.md), [bridge behavior](docs/bridge-crates.en.md) and [official-map loading](docs/stock-map-loading.en.md).

The catalog includes Battle, Megawealth, Land Rush, Meat Grinder, Naval War, Team Alliance and cooperative maps. It excludes campaigns, unlisted distribution files and registry references absent from the original archives. All **248 included map files** can be analyzed under the static model, including ordinary ramp ore, boundary bridges, objects above / below high bridges, initially closed gates and cooperative empty-foundation building records. English map names are display translations; catalog provenance retains the original registry / string-table names and filenames.

## Region statistics

Open **Region statistics** after loading a map. It starts with 12 empty regions and a 2:1 elliptical brush that matches the game projection. Names and colors are editable; new colors maximize perceptual separation from existing ones. The probability layer and labels switch off on entering editing; the nearby **Probability: On / Off / Mixed** button stays synchronized with the original controls.

- Screen-aligned rectangle selection and game-coordinate parallelogram selection preview while dragging and commit on release, using cell centers. Rectangle, parallelogram, circle and ellipse brushes have adjustable sizes. Erase removes cells from the current region only.
- Right-drag or Alt + left-drag pans; the wheel zooms; Esc cancels a stroke. **Pick region** or Ctrl + left-click selects the region under a cell, then restores the last non-picker tool. Blank cells do not change the current region. With overlaps, the current region wins if present, otherwise the top region does. Hold Shift to temporarily reverse paint / erase, including during a stroke.
- Overlap is off by default. Painting transfers membership to the active region. Turning overlap off keeps the active region first, then creation order. Undo keeps 20 edits; use Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z. New edits clear the redo branch.
- Region transparency defaults to 50%, is adjustable and saved. Only usable cells with at least partial camera coverage are selectable; the upper restricted band and cells outside camera bounds are excluded, including when restoring backups. Ordinary zero-probability cells remain selectable.
- The sortable list shows total and area-average multipliers for land crates, water crates and both. Averages include selected zero-probability cells and use the corresponding category's cell count; an empty category shows `—`. Statistics share the map's 1× baseline and ignore display filters. Each row has a tight terrain crop and a minimap location marker; click to locate.
- **Player starts** is on by default. Numbered circles 1–8 represent map waypoints 0–7, not current units or player factions. The switch applies to the main map, minimap, region thumbnails and exports; known single-player maps omit these markers.

Selections autosave in this browser by the original map's SHA-256 and survive reanalysis or resource changes. Before changing browser, address / port or clearing site data, **Export regions**, then **Restore backup** on the same map. Damaged records and cross-tab conflicts are reported. Approximate results remain clearly labeled in regional comparisons.

## Source and development

Git contains application code, example maps, research documentation, tests and required small local components. Large original archives and full runtimes are release assets. Results, screenshots, videos, caches, local settings and Mod resources are excluded.

```powershell
gh repo clone jjbsded/ra2-crate-atlas
cd ra2-crate-atlas
python -m pip install -r requirements.txt
python -B server.py --open
```

Use Python 3.11+. Provide stock `ra2.mix` and `ra2md.mix` under `assets/original` (fixed hashes are checked), or use a prepared portable environment. Video export additionally requires Node.js, `@napi-rs/canvas` and FFmpeg. Default port: 8767; override with `--port 8777`. `--page demo` opens the probability demo. `index.html` also supports direct file opening for the offline interactive demo.

The height demo is served at `http://127.0.0.1:8767/cliff-demo.html`. Rebuild its data with `python -B build-cliff-demo.py`. It reuses the terrain viewer but does not calculate probabilities or complete routes for the isolated-high-cell teaching layout.

Representative checks (see [architecture](ARCHITECTURE.en.md) for the full boundary / cache suite):

```powershell
node verify-i18n.cjs
python -B verify-i18n.py
node verify-exact.cjs
node verify-random-frame.cjs
node verify-timing.cjs
node verify-terrain3d.cjs
node verify-map-presentation.cjs
python -B verify-official-maps.py
python -B verify-module-boundaries.py
python -B verify-cliff-demo.py
python -B verify-portable.py
python -B verify-source-package.py
```

Canvas tests need `NODE_PATH` pointing to `runtime/node/node_modules`. For actual-map region checks, run `node verify-regions.cjs output/<analysis>/result.json`.

Build a portable package with verified local runtimes:

```powershell
.\runtime\python\python.exe -B build-portable.py --output ..\CrateAtlas-Windows-x64 --node .\runtime\node\node.exe --node-license .\runtime\node\LICENSE --ffmpeg .\runtime\ffmpeg\ffmpeg.exe --version v0.3.0
```

The output folder and corresponding ZIP must not already exist. The builder validates module coverage, browser dependencies, stock archives, native-source digests, voxel provenance, Canvas and FFmpeg before copying files. It creates a file manifest and ZIP checksum. Extract to a separate test directory, then run `python -B verify-portable-install.py --root <extracted-folder>`. Do not repackage that test directory: verification creates analysis and video outputs.

To rebuild the official catalog from an original Windows game installation:

```powershell
python -B build-map-catalog.py --game "D:\Games\Red Alert II"
```

The builder reads `MULTI.MIX`, `multimd.mix`, official PKT registrations and CSF strings; map bytes are preserved. Catalog metadata records source hashes, merge evidence and omitted references. Shared-version comparison includes terrain, levels, ramps, overlays, occupancy, cleared-object state and crate-related rules; preview images, lighting, AI and editor metadata do not affect merging. Unresolved comparisons keep separate version labels.

## Guides

| Guide | Contents |
| --- | --- |
| [Portable use and migration](PORTABLE.en.md) | Setup, language, optional resources, saved data, upgrades and troubleshooting |
| [Real-map analysis](REAL-MAPS.en.md) | Exact probability model, support boundaries, overlays and exports |
| [Rendering](RENDERING.en.md) | Original artwork, object placement, 3D reconstruction and caches |
| [Architecture](ARCHITECTURE.en.md) | Module responsibilities, dependencies, jobs and regression checks |
| [Crate mechanism research](docs/random-crate-generation.en.md) | Random origins, nearby search, retries, slopes and height changes |
| [Bridge research](docs/bridge-crates.en.md) | Deck / ground occupancy, placement, collection and bridge art |
| [Official-map loading](docs/stock-map-loading.en.md) | Ramp ore, boundary bridges and exceptional stock records |
| [Third-party notices](third-party-notices.md) | Component provenance, licenses and original asset rights |

Original game assets, Mod assets and third-party components retain their respective rights and licenses.
