**English** | [简体中文](ARCHITECTURE.md)

# Architecture and maintenance boundaries

Crate Atlas combines a local Python HTTP service with plain JavaScript pages. There is no frontend build step. Launchers, existing result URLs and region-storage keys remain stable; modules are separated by responsibility.

## Analysis and results

| Module | Responsibility |
| --- | --- |
| `server.py` | HTTP parameters, origin checks, static files, preferences, resource settings and video export |
| `map_jobs.py` | Submission, serial execution, progress snapshots and ore/tree-layout reuse; no HTTP or 3D dependency |
| `map_results.py` | Result paths, source-map hashes, bounded shared report cache and resource consistency |
| `map_storage.py` | Atomic plain/gzip report publication, compressed CSV storage and compatible logical URLs |
| `map_images.py` | Pixel-exact WebP, identical-layer reuse and bounded idle recompression |
| `official_precomputed.py` | Validate model/resource signatures and restore lossless official gameplay data |
| `official_render_cache.py` | Validate and reuse complete local render results without sharing mutable output files |
| `realmap.py` | Analysis orchestration and CLI: parsing, approximation, native search, probability, rendering, output |
| `realmap_format.py` | INI / numeric syntax and bounded LCW / LZO decoding; no model or rendering dependency |
| `realmap_resources.py`, `realmap_mod.py` | Stock MIX, rules / art, theaters / palettes, optional directory discovery |
| `realmap_parser.py` | Map / object records, overrides and static cells; no subprocesses or drawing |
| `realmap_exact.py`, `realmap-search.c` | Exact probability aggregation and native ordered search |
| `realmap_sprites.py` | Shared TMP / SHP decoding, palettes, overlay resolution and original shadow frames |
| `realmap_approx.py`, `realmap_bridges.py` | Unknown-content assumptions and bridge-layer rules |
| `realmap_render.py`, `realmap_objects.py`, `realmap_voxel.py` | Ground, buildings and units; do not decide probabilities |
| `realmap_3d.py`, `terrain_depth.py` | Local 3D patches from analyzed results and original artwork |
| `realmap_refresh.py` | Explicit rerender / preview upgrades, preserving the report's ore/tree layout |
| `original_resources.py`, `resource_context/` | Stock validation, low-level directory reads and provenance |
| `i18n_settings.py` | Windows display-language detection and atomic installation-local language preference |

`map_jobs` and `map_results` load only the standard library and lightweight resource entry points at import time. Ore/tree switching, report reads and 2D refresh must not import the entire 3D renderer just for shared utilities. Dependencies flow from orchestration to parser, resource and format layers. Native-tool validation / compilation occurs when entering probability calculation. `parse_map()` works without a compiler, Pillow, NumPy or the solver.

Stock and directory resources share cell parsing and sprite decoding. `realmap.py` retains old function imports for compatibility. New code should import the owning module directly. The dependency-cycle check includes function-local imports, excluding only the explicit delayed compatibility forwarders `realmap_mod.preview` and `realmap_render.refresh_result`. Business modules must remain acyclic. Shared sprite functions belong in `realmap_sprites`, not reverse imports of the renderer.

The job manager retains at most 64 polling records, never evicting active / queued jobs. Eviction does not delete disk results. One analysis runs at a time. A foreground request can await an already-running matching preload; incompatible requests return busy. Identical in-flight layouts reuse jobs; readers get locked state snapshots.

Bundled official data uses checksum-verified XZ with bounded decoding; incompatible or damaged entries fall back to live calculation. A separate local cache validates rendered files before reuse. Explicit recalculation bypasses both. Desktop reports and CSVs use gzip behind the original URLs, while CLI output remains plain JSON/CSV. WebP preserves every pixel, shares identical ground/object layers and retains PNG for oversized images. A single bounded idle worker checks decoded pixels before replacing an image; publication and rendered-cache checksums share a lock, while encoding happens outside it.

The report cache holds two reports and coordinate indexes, invalidated by path, size and nanosecond modification time. Consumers treat shared reports as immutable. `mineral-variants.json` links layouts, checked against map / rule / resource fingerprints and renderer version before reuse. Invalid links allow recalculation. Optional game paths stay in `data/game-directory.json`; no named Mod profile or artwork enters builds.

Directory rule contexts have a separate locked two-entry LRU. Every request checks source-map / archive fingerprints, rules, art, theaters, loose configurations, nested includes and newly available optional files. Directory listings are reused only within one validation. Loose files are checked by content hash, detecting edits that preserve size and timestamp. Returned resource-read caches and effective rules are isolated from cached templates; mutable dictionaries do not leak across requests or accumulate indefinitely.

3D transparent-edge completion finds the nearest opaque pixels to the left / right on each scanline, then compares distances across rows. It preserves the exhaustive algorithm's distances and tie ordering without scanning all opaque pixels for every sample. Random masks and real patches compare output against the exhaustive reference.

`VoxelRenderer` owns subprocesses, reader threads and pipes, including startup failure and repeated `close()`. Both pipe directions use UTF-8 independently of the Windows console code page. Read failures propagate immediately. Precompiled worker validity uses a SHA-256 of source text with normalized newlines; clone / extraction timestamps do not force recompilation.

## Browser

| Module | Responsibility |
| --- | --- |
| `realmap-ui.js` | Page assembly, view state, selection and coordinated controls |
| `map-details.js` | Cell details, transfer explanations, warnings, risk lists and result-quality controls |
| `map-exports.js` | JSON / CSV / fractions, downloads and image buttons using current-result snapshots |
| `local-api.js` | Service diagnostics and cancelable shared job polling |
| `map-results.js` | Report loading, parallel image decoding, per-layout source indexes, stale-load rejection |
| `mineral-layouts.js` | Two-layout browser cache and background / foreground request coalescing |
| `probability-display.js` | Single conversion path from exact fractions to display multipliers, thresholds and labels |
| `map-renderer.js`, `minimap.js`, `map-image-export.js` | Shared drawing rules for map, navigator and exports |
| `region-statistics.js`, `region-statistics-ui.js` | Region data, exact statistics, editing and autosave |
| `terrain3d.js` | 3D lifecycle, camera, interaction and markers |
| `cliff-demo.*` | Teaching scenes using the same viewer with an injected static loader |
| `i18n.js`, `i18n-en.js` | Language selection, explicit UI translations and diagnostic-only message formatting |

A result is fully prepared before committing it to the current view. A new foreground load cancels old requests and rejects late responses with a version token. Failure preserves the displayed map. Background preparation never changes the view. Switching layouts reuses decoded images, exact-display caches and source indexes; switching maps releases old references. Drawing reads cached exact numerators instead of rebuilding large integers per cell.

Details receive the report, display model and locate callback through parameters; they do not control cameras or start analysis. Export serialization works without the DOM and leaves the original report unchanged. Pixel coordinates and temporary BigInts are not added to JSON.

A full-map image freezes its report, index, display settings and region geometry / colors / transparency / clipping at export start. Region snapshots share immutable `Path2D` objects and the regular drawing function. Later edits, map changes or closing region mode cannot alter that export.

The height demo reads bundled `examples/cliff-demo.json` without a map job, game directory or network. `build-cliff-demo.py` builds it from stock YR `xmp32s8.map`. Its isolated-high-cell scene shares backend `relation_data` / `land_after`, leaving probabilities empty. Selection, textures, rotation, placement preview and resource cleanup share the map inspector implementation.

## Localization

`language-settings.js` is a static fallback for file-opened demos. Over HTTP, the server generates the same URL with the Windows display language and saved preference, using `Cache-Control: no-store`. Supported values are `zh-CN` and `en`. The browser resolves the saved choice before system / browser detection. A same-origin POST validates and atomically saves the selection; reloading uses it on all pages and after a server restart. Browser storage provides a direct-file fallback. Installation preferences are never build inputs.

The English catalog uses Chinese source text as keys. Dynamic UI templates have numbered placeholders. App modules call the translator explicitly; startup translates static HTML before custom map / region data is inserted. Only known diagnostic fields pass through legacy message matching. Names, filenames, paths, object IDs, map content and numeric probability arrays are never globally replaced. Official names are translated only for catalog display / search; catalog hashes and IDs stay stable. Export jobs capture the language before loading the shared model and renderer. Changing language is disabled while a foreground analysis, resource save or video export is in progress.

## Builds and verification

The Toy edition uses the explicit static data source in `toy/toy-platform.js`; it does not intercept global `fetch`. The shared result reader accepts JSON/binary readers, the ore/tree cache accepts a layout resolver, and the map selector accepts a catalog reader. Local installations keep their existing HTTP implementation. The shared map workspace retains rendering, origins, regions and exports, with a responsive touch viewport for the static edition.

Toy's `terrain3d-patch.js` injects a patch loader into the shared `terrain3d.js`, reading heights, slopes, risk flags and `higher` relationships directly from the decoded report, with a reverse index for affected lower cells. It reuses the 2D palette and object symbols, without Python APIs. High bridges retain separate decks and two-sided geometric rails. Three.js loads locally on demand. Static simplified meshes are batched by material with per-face cell mappings for picking; textures and geometries are released on close/recenter. `verify-toy-3d.cjs` covers paired layouts, six climates, bridge layers, touch, no API calls and resource disposal.

Region route labels retain source-specific distance/sea states, while coordinate ownership and diagonal clearance use player/team groups. Teammates never block one another or reset distances to a group centroid. Documents persist pending `autoOptions.teams` separately from `appliedTeams`; successful partitioning commits applied teams and memberships together. Cancel/failure preserves markers; undo and backups include both. Optional `regionStyles` in `player-starts.js` unify main-map, minimap, thumbnail and export rendering, and are omitted outside region mode. Names and probabilities are measured separately at a 0.7 font ratio, vertically centered by glyph bounds. Exports retain label and player-style snapshots.

`build-toy.py` computes exact reports at build time and preserves integer fractions, geometry and origins. By default, `toy_artwork.py` adds semantic object descriptors and `toy/terrain-artwork.js` assembles shared colors, simple textures and symbols per cell. Spatial buckets bound drawing work; the existing view cache avoids repainting terrain while editing regions. `map-artwork.js` gives original images and procedural artwork one coordinate contract across thumbnails, minimaps, origin restoration and exports. Optional raster mode still deduplicates WebP images. `serve-toy.py` exposes only static files under a subpath; browser tests forbid analysis API requests. The source-only Toy launcher is excluded from ordinary Windows portable packages. See [TOY.en.md](TOY.en.md).

Static transport is independent of the analysis model: `toy_codec.py` emits shared cell columns, layout differences, finite-retry arithmetic recipes and origin dictionaries. `toy/static-codec.js` restores the original report schema in a Worker or the direct fallback. BigInt restores exact integers; nearest-even IEEE 754 rounding restores floating-point probabilities. Shared rendering and statistics interfaces stay unchanged. Content hashes deduplicate assets and the builder enforces a ZIP budget; only artwork is reduced lossily. Python and JavaScript verification independently compare every restored cell and original search byte.

`region_navigation.py` reads validated rules and emits a routing mask in original report cell order. The desktop API serves it at `/api/maps/region-navigation`; Toy packages the same mask at build time without changing the probability fingerprint. Shared async `region-auto.js` uses separate deck/ground nodes, matching ramp edges, diagonals without corner cutting, and nondominated path/continuous-crossing states. It yields and supports cancellation; map changes, edits or cross-tab updates discard stale jobs. Region documents retain parameters and a once-only marker, with backward-compatible storage and one-step undo. Probability labels are independent of fill raster caches; exports freeze their text, color, size and center.

`build-portable.py::APPLICATION_MODULES` explicitly lists Python runtime modules. Before creating output, the builder checks local imports and fails on unpackaged dependencies. Add split modules there. JS / HTML / CSS remain directly loaded; update references and cache versions as needed. Original archives use a separate hash whitelist.

`DATA_FILES` lists release data explicitly; local example / configuration directories are never recursively copied. Preflight also checks HTML references, both native-tool source digests, voxel provenance, Canvas and FFmpeg. The package records its version and per-file hashes; the ZIP has a separate checksum. Portable Python does not load development fallback dependencies. Startup checks the installation and code fingerprint before reusing an existing service.

`verify-source-package.py` checks tracked application / test dependencies. `map_test_fixtures.py` creates synthetic fixtures without old research outputs. `verify-portable-install.py` tests a fresh extraction with development environment variables removed: package dependencies, both games, ore-free layouts, 3D, four object categories and video export. Verification writes results; never rebuild the release ZIP from that test directory.

| Check | Coverage |
| --- | --- |
| `verify-i18n.cjs`, `verify-i18n.py` | Language detection / persistence, translation templates, unchanged model data and packaging |
| `verify-map-jobs.py` | Serial jobs, busy responses, snapshots, recovery and bounded history |
| `verify-map-results.py` | Cache limits / isolation, resource binding, include / missing-file invalidation, import boundaries |
| `verify-map-results.cjs` | Parallel decoding, source reuse, stale requests, polling and cancellation |
| `verify-mineral-cache.py` / `.cjs` | HTTP cache protocol, background coalescing, reload and recovery |
| `verify-minerals.py` | Both games compared with independently cleared maps, probabilities and 2D / 3D |
| `verify-portable.py`, `verify-release-resources.py` | Module coverage, existing-build protection, Mod resource exclusion |
| `verify-voxel-lifecycle.py` | Process / pipe / reader cleanup and repeated close |
| `verify-module-boundaries.py` | Cycles including lazy imports, duplicate frontend definitions, load order, isolated parsing, compatibility |
| `verify-map-presentation.cjs` | Exact / approximate / preview transitions, warnings, risks, exports and report immutability |
| `verify-region-workspace.cjs` | Real editing controls and Canvas snapshots surviving later edits / map changes |
| `verify-realmap-3d.py` | Nearest-pixel reference comparison, terrain geometry and optional map / bridge regressions |
| `verify-cliff-demo.py` | Six asymmetric high-cell offsets, Rough transition, source and texture completeness, entry links |

The parser, resource, details and export splits preserve the existing launcher, result format, probability core and region-storage keys.
