**English** | [简体中文](TOY.md)

# Toy low-resolution simplified edition (not the full application)

This is a low-resolution simplified edition, not the full application. The separate static build contains the probability demo and a precomputed official-map atlas. Battle and Team Alliance are the default modes. Deployment uses only HTML, CSS, JavaScript, compressed data and images. It requires no Python, Node.js, FFmpeg, game directory or analysis server.

## Preview locally

With a build available, run **启动Toy网页版.cmd** in the project directory, or:

```powershell
python -B serve-toy.py --open
```

The default URL is `http://127.0.0.1:8787/toy/crate-atlas/index.html`. This server deliberately implements no analysis APIs. Its subpath exercises Toy-style deployment. Add `--port 8788` if needed, and press Ctrl+C to stop it. The per-cell artwork build is `output/toy-official-3d`; the launcher prefers it, then falls back to `output/toy-official-50mb`, `output/toy-official-all` or `output/toy-web`. Its adjacent ZIP is a web deployment package, not a Windows portable installation. Use `--root <directory>` to preview another build. Any ordinary static server can host it. Opening through `file://` is unsupported.

## Included content

The default selection includes all 106 official Battle entries and all 25 Team Alliance entries: 131 menu entries, 147 map/version combinations and 139 distinct original files. Each combination has ore-and-tree-enabled and ore-and-tree-disabled results, giving 294 layouts. Megawealth, Naval War, cooperative and other modes are excluded.

The catalog uses the desktop tool’s original map names and supports English/Chinese, full Pinyin and Pinyin-initial search, plus version, mode, player-count and theater filters. English names also work in the Chinese interface: `Heck Freezes Over`, `bingtianxuedi` and `btxd` find the same map. The small search index covers official map names without bundling a general Pinyin dictionary. Shared entries retain separately computed game versions. Files used in both modes share an analysis cache but retain their mode-specific labels. Identical artwork is shared across maps, versions and ore/tree layouts. Opening the site downloads only the catalog and current map.

The edition retains transfer-origin overlays and percentages, 12 initial empty regions, all region tools/statistics/sorting/thumbnails, local autosave and backups, the minimap, player starts, viewport PNG and full-map JPEG export. Region storage uses the same original-map SHA-256 identity as the desktop tool. Export/import backups before changing browser or site address.

On phones, tap to select, drag to pan and pinch to zoom. Region editing has explicit Brush/Pan touch modes; two fingers always navigate and cancel unfinished strokes. Display settings start collapsed. Phones do not preload the other ore/tree layout; desktops may do so while idle.

The default artwork uses shared materials assembled cell by cell at the original 60×30 pitch, heights and slopes. Cliffs use block faces, with simple deterministic ground/water textures. Oil derricks, repair huts and hospitals have dedicated symbols; ordinary buildings, civilians and animals use generic symbols. A collapsible map legend explains them. High bridges retain deck elevation and railings on both sides. No map-sized bitmap or traced game-sprite outline is needed. Zooming, minimaps, region thumbnails and image exports share the same renderer. The shapes are illustrative: passability, picking, occlusion markers and probabilities still use the original map data.

Every region tool has an icon. Connected fill merges the clicked cell’s edge-connected component with the same source region and land/sea type into the active region; diagonal-only contact and isolated parts do not connect. Remove mode, temporary Shift inversion and undo/redo work as with brushes; dragging does not fill. With overlapping regions, the active region takes priority, followed by the topmost region under the click.

Choose **Empty** as the current region to erase every membership under a brush, box selection or fill, including overlapping regions, regardless of Add / Remove or Shift. The picker and Ctrl + left-click can sample an unassigned cell to select Empty and restore the previous tool. Empty is an erase state and does not add a statistics row; autosave, backups and undo/redo still apply.

Select a cell and choose **3D view** to generate a local scene from the currently loaded report: 21×21 cells by default, up to 31×31. Heights, slopes, elevated bridge decks and ground underneath, related high cells and rule markers use the same data as the main map. Probability starts off and can be enabled. Artwork uses simplified cell materials and object symbols, without detailed original-art relief or full pathfinding. Phones support one-finger rotation, two-finger pan/zoom and tap selection; collapsible controls/details preserve the landscape viewport. WebGL is required. Three.js and its MIT license are bundled and loaded on demand, without API or CDN requests. Static meshes are batched by material while retaining cell picking, and GPU resources are released on close.

Custom-map import, Mod directories, detailed original-art 3D and MP4 export remain desktop features. The web results describe initial static layouts, not a running match or crate spawn frequency.

## Automatic regions and probability labels

Both editions share the region editor and automatic partitioner. Maps without saved regions are partitioned on first load and saved. Existing selections, intentional clears and restored backups are preserved. Open Automatic partition in the region editor to rerun with new parameters. Repartitioning preserves colors, replaces memberships and supports undo/redo. The first regions use actual starting-slot numbers: Player 1, Player 2, etc.

Defaults are 0 for each continuous sea crossing, exclusive-land distance exemption enabled, straight-line radius 40 and path distance 70, measured in game cells. Edge steps cost 1; diagonals cost √2 without corner cutting. Normal infantry terrain access is used, clearing trees and destructible buildings; units, unknown objects and indestructible buildings remain blockers. Debris and later triggers are not simulated. Each sea crossing includes both continuous shore sections and resets on reaching non-shore land. Walking along a shore is allowed; intact bridges can connect land with the sea limit at zero. High-bridge decks and the ground below are separate route layers, joined only through matching adjacent surface heights. Players expand simultaneously by route distance; ties favor the lower player number. Rival territory blocks that coordinate on both layers. Rocks, ore drills and other blockers remain; diagonals cannot borrow wet or blocked corners. Blocked starts are reported, never relocated across barriers. Existing regions stay unchanged until rerunning the partition; undo is available.

Player teams can be A, B, C, D, Neutral or Empty. Valid slots default to independent Neutral players. Matching letters share a region such as Team A, expanding from every member's actual start without blocking teammates. Distances are never measured from a team centroid. Empty slots neither seed nor own territory; other players may reach their locations, and player-free land can still receive area-based regions. Settings are saved per map and applied by rerunning the partition. Undo/redo restore both memberships and applied teams.

A connected land component exclusive to one player or team may ignore straight-line/path caps, but never sea limits. Remaining land with no active player start over 35 non-shore cells, excluding decks over water, receives other regions by decreasing remaining area. Remaining connected water areas larger than 35 cells are then assigned in descending area order as Water + region number, such as Water 7. Coast does not count; land or assigned cells cannot connect pools, and bridge decks remain separate from water below. Player sea-crossing caps do not limit these standalone water areas. Regions may exceed the initial 12, with at least 2 unused regions reserved for manual editing after partitioning. Other cells stay unassigned. Saved partitions are preserved until you choose Repartition automatically; undo/redo and backups retain new regions and water names.

Center labels include the region name, for example “Team A:16%”. Percentages sum each region's final cell probabilities using the original single-call denominator, without renormalization. Table totals/averages remain multipliers. Names and colons use 70% of the probability font size; the two runs are vertically centered by glyph bounds and centered together on the region. Labels scale with map zoom and use the region color: all labels have black inner / white outer outlines. Ore/tree changes and exports update totals. Show region probability totals can hide the labels. In region mode, player pins connect to a square in their region color, with a team letter when assigned. Empty slots fade and receive a translucent red X. The main map, minimap, region thumbnails and exports share these styles; leaving region mode restores normal markers.

## Build

Build-time dependencies are the desktop development environment, official catalog and verified stock resources. Those runtimes and original archives are excluded from the static package.

```powershell
python -B build-toy.py --output output/toy-web-new --jobs 2
```

The output directory and adjacent ZIP must not exist. `toy/maps.json` selects the default modes. Repeat `--mode standard --mode teamgame` to select modes, or `--map-id <catalog-id>` to build a subset. `--jobs` allows 1–4 analysis/packaging processes (default 1); analysis caches are deduplicated and shared artwork writes use a process lock. `--art-cache <previous-build/art>` reuses content-addressed images after validating their decoding. `output/toy-cache` caches exact analyses by source bytes, game version, ore/tree layout and analysis-code fingerprint. UI-only updates reuse those analyses:

```powershell
python -B build-toy.py --refresh-ui --output output/toy-web
```

Use `--refresh-navigation --jobs 4` to add routing data and update the UI in an existing build with the same analysis fingerprint, without recomputing probabilities or artwork.

Refreshing refuses stale analyses after model-code changes. The default `--artwork-style tiles` generates per-cell materials; `--refresh-artwork --jobs 4` updates only object descriptors and UI in an existing tile build. The legacy compressed-bitmap approach remains available with `--artwork-style raster --max-image-edge 640 --image-quality 55`; only this mode uses `--art-cache`. Statistical precision is unchanged. ZIPs must fit within 50,000,000 bytes by default, with a build error if exceeded. Use `--zip-budget-mb` for another limit. A higher-resolution self-hosted bitmap build can use `--artwork-style raster --max-image-edge 2560 --image-quality 85 --zip-budget-mb 1000`.

`toy_codec.py` and `toy/static-codec.js` implement lossless transport: shared ore-and-tree-free cell columns plus ore/tree-layout differences; finite-retry arithmetic recipes reconstructed with BigInt for exact integers; correctly rounded IEEE 754 probabilities; and dictionary-coded origin lists. Content-addressed shared assets use gzip. Decoding runs in a Worker, with the same decoder used directly if Workers are unavailable. A current browser supporting `DecompressionStream`, WebP and BigInt is required.

## Verify

```powershell
python -B verify-toy.py output/toy-official-3d --mode standard --mode teamgame --cases output/toy-codec-qa/cases.json
node verify-toy-codec.cjs --cases output/toy-codec-qa/cases.json
node verify-region-auto.cjs
python -B verify-region-navigation.py
node verify-toy.cjs --unit-only
# With serve-toy.py --port 8788 running, and Playwright / Edge installed:
node verify-toy.cjs
node verify-toy-3d.cjs
```

Use `TOY_URL` to override the preview URL and `TOY_BROWSER` for the Playwright browser channel. Python verifies package hashes, relative references, file boundaries and every cell’s exact probabilities, risk data, geometry and binary origins against the original cached reports. Node independently runs the browser decoder against every original report, including exact floating-point equality. Browser checks cover desktop/mobile touch, region undo/redo/persistence, ore/tree layouts, origins, downloads, search and language persistence, with no analysis API requests. Evidence is saved under `output/toy-qa`.

## Publication scope

This work builds and validates locally. Toy publication still requires creator access, platform-preview checks for its app container, account upload limits and review of artwork usage. The ZIP excludes original MIX archives, original map files, specific Mod resources, personal settings and native analysis programs. It contains derived official-map imagery. Technical verification does not substitute for platform review or rights clearance. EA has not endorsed and does not support this product.
