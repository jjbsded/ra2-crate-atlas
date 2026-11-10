**English** | [简体中文](ARCHITECTURE.md)

# Architecture and maintenance boundaries

Current probability model: **up to 1000 finite retries integrated with exact mathematical weights, reporting final creation success or failure**. Candidate searches remain incremental. See [the model contract](docs/probability-model.md).

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

`map_jobs` and `map_results` load only the standard library and lightweight resource entry points at import time. Ore/tree switching, report reads and 2D refresh must not import the entire 3D renderer just for shared utilities. Dependencies flow from orchestration to parser, resource and format layers. Native-tool validation / compilation occurs when entering probability calculation. `parse_map()` works without a compiler, Pillow, NumPy or the solver. It can read incremental thread options without loading numerical dependencies; those are imported when a probability store is created.

Stock and directory resources share cell parsing and sprite decoding. `realmap.py` retains old function imports for compatibility. New code should import the owning module directly. The dependency-cycle check includes function-local imports, excluding the explicit delayed compatibility forwarders `realmap_mod.preview` and `realmap_render.refresh_result`, plus simulation application’s delayed reuse of the parser’s pure `is_tree` predicate. Business modules must remain acyclic. Shared sprite functions belong in `realmap_sprites`, not reverse imports of the renderer.

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
| `map-import-version.js` | Separate user resource preference from the current map's displayed version; filename hints and explicit/automatic choice boundaries |
| `map-details.js` | Cell details, transfer explanations, warnings, risk lists and result-quality controls |
| `transfer-columns.js` | Solid links from raised missing-terrain origins to level-zero bases, exposed sides and cached depth clipping; terrain-hidden strokes and tuning UI disabled |
| `transfer-overlay.js` | Prepared source geometry, spatial queries and full-DPI viewport raster reuse for source surfaces, columns and conditional probability labels |
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

`risk-pagination.js` assigns rows to both risk-coordinate lists using the remaining sidebar height and reserves the largest pager. Short lists stay unpaged; when every page number fits on one line, the jump input is omitted. Only the current page owns DOM buttons, and a coordinate index reveals selected cells directly. Resize/disclosure work is coalesced per frame and pauses while details are hidden; tight layouts reduce detail spacing without changing disclosure preferences. `map-details.js` compares fixed-size numeric snapshots rather than repeatedly joining all coordinates, including in-place edits and uncomputed versus empty results. `verify-risk-pagination-ui.cjs` covers Full/Toy, two lists of 20,000 cells, controls, selection, disclosure, resizing, English and mobile layouts without changing probability data.

Error isolation uses readable capabilities rather than whole-map quality labels. Native approximation and the Toy parser retain per-cell `riskKnown`, `postLand` and `overlayUnknown`, with `riskPredictionVersion` distinguishing legacy reports. Clearance retains an unknown-cell count. Missing unit artwork preserves known occupancy; current/cleared risks, 3D crate prediction and height relationships use separate prerequisites. `map-results.js` attempts one cancellable legacy recovery and loads image layers independently; `map-artwork.js.fallback` draws readable cells through spatial buckets. Toy 3D can use simplified materials without an atlas. Contracts and fault-injection checks are documented in [loading boundaries](docs/stock-map-loading.en.md#error-isolation-and-recovery).

`transfer-origins.js` retains failed destinations in its reverse index and exposes `outgoing(cell)` through original-record offsets, without duplicating the candidate table. Successful contribution conservation is unchanged; failed destinations contribute zero entities. Conditional labels remain candidate hits divided by candidate count. `selection-probability.js` draws temporary destination labels and two terrain-following strokes. `sea-land-connections.js` asynchronously checks common-edge ground/water heights and base terrain costs, ignoring objects and overlays, and caches a viewport spatial index. Object-only simulation reuses it. Its land-coordinate list shares the sidebar pagination budget. Debug controls reuse draft-preserving numeric inputs. See `verify-selection-contacts.cjs` (25,600 contacts) and `verify-selection-contacts-ui.cjs` (Full/Toy, zero origins, independent layers, Buff and 20,000-coordinate pagination).

Selection badge position/alpha are pure helpers in `selection-probability.js`. Both destination-label lines reserve stroked bounds; the badge uses padded candidates in up to four rings. Pointer distance changes final alpha without affecting placement. The controller coalesces redraws only when alpha changes and converts distances to CSS pixels; the renderer returns badge bounds/alpha without mutating the map report. Green selection arms precede label families; cached risk glyphs are redrawn only where they intersect those arms. Confirmed outline/contact colors, alpha and widths are now fixed defaults, and the temporary panel contains only badge settings. `verify-selection-badge.cjs` and its browser counterpart cover opacity pixels, draft preservation, avoidance and layer order.

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

Static transport is independent of the analysis model: `toy_codec.py` emits shared cell columns, layout differences, fixed candidate-coefficient recipes and origin dictionaries. `toy/static-codec.js` restores the original report schema in a Worker or the direct fallback. BigInt restores exact integers; nearest-even IEEE 754 rounding restores floating-point probabilities. Shared rendering and statistics interfaces stay unchanged. Content hashes deduplicate assets and the builder enforces a ZIP budget; only artwork is reduced lossily. Python and JavaScript verification independently compare every restored cell and original search byte.

`region_navigation.py` reads validated rules and emits a routing mask in original report cell order. The desktop API serves it at `/api/maps/region-navigation`; Toy packages the same mask at build time without changing the probability fingerprint. Shared async `region-auto.js` uses separate deck/ground nodes, matching ramp edges, diagonals without corner cutting, and nondominated path/continuous-crossing states. It yields and supports cancellation; map changes, edits or cross-tab updates discard stale jobs. Region documents retain parameters and a once-only marker, with backward-compatible storage and one-step undo. Probability labels are independent of fill raster caches; exports freeze their text, color, size and center.

Standalone-land generation revisits every original landmass, including those containing player starts. After player/corner claims it splits only through unclaimed coordinates, including vacant diagonal clearance cells. Each remainder independently passes the area or exact combined-multiplier threshold; player-owned cells cannot connect remainders or contribute their area/probability. Player/team expansion, exclusive-land ownership and corner-claim precedence remain unchanged. `verify-region-auto.cjs` covers a claimed middle splitting a landmass, strict 35-cell/50x boundaries, owned-probability exclusion and diagonal isolation.

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

The module-boundary check records five deferred browser relationships: simulation factories read artwork, region, resource and transfer APIs after all scripts load, and the Buff expectation UI reads the viewer when a task starts. Other provider ordering remains strict.

## Refactoring progress (2026-11-07)

Region statistics now share one data-layer implementation: `statisticsSteps` yields every 128 members, `statistics` consumes it synchronously, and `patchStatisticsSteps` updates membership-only differences. The refresh coordinator retains the existing terrain/probability identity checks before choosing a patch. Published results are immutable, including cancellation partway through a task.

`region-thumbnails.js` owns locator layout, raster caching, Canvas retention and the latest-only background queue. The workspace injects map/document/geometry/settings and region drawing. The queue retains its 5 ms budget and stroke deferral; leaving or changing maps cancels pending work. Unchanged cached images keep their DOM nodes. Existing appearance, invalidation inputs and `CrateRegionStatisticsUI.thumbnailLayout` compatibility are preserved.

Toy high-resolution thumbnails and arbitrary preview rectangles use `toy-live/raster.js` off-thread with the same source-pixel composition and resampling order. The thumbnail owner has bounded pixel caching and idle disposal. `toy-live/report-transfer.js` splits large cell DTOs into short messages while retaining the legacy protocol. Display tables are cooperatively prepared before `map-results.js` commits a report; cancelled preparations cannot publish partial results.

Full may lazily use `probability_kernel_worker.py` and `exact-kernel-worker.cjs` for the shared exact V8 integer kernel, retaining the independent Python fallback. Pipe waits, process memory and cleanup are bounded; `probability_kernel_cache.py` still owns history. Native image publication prefetches at most one batch during decoding, adapting batches between 8 and 16 tiles. See [performance measurements and limits](docs/bulk-edit-performance.md).

`verify-region-statistics-work.cjs` checks exact sums, large integers, 25 incremental transitions and cancellation. `verify-region-thumbnails.cjs` checks raster/cache reuse, partial publication, superseding requests, strokes, resizing and document changes. Existing workspace, locator, table and marker regressions remain in place. Subsequent candidates are simulation sessions/publication, regional title rendering, and resource identity/cache validation.

### Simulation sessions and asynchronous publication

`simulation-session.js` owns transient map identity/generation, edit and publication revisions, the active ticket, merge timer and resident handle. UI pending/ready/waiting flags derive from one state. A new map invalidates old tickets even if revision numbers match; ordered edit deltas retain their existing format.

`simulation-publication.js` writes session state and coordinates shared source preparation, warmup leases, independent live probability/artwork channels, source reads, recovery, report fallback and layout switching. The UI supplies view/plan/commit/notification ports and owns controls, strokes and rendering feedback. Report commits retain generation, revision, visibility, stroke and busy guards; old finalizers only clear their own tickets. Delays, payloads, probability kernels and saved documents are unchanged. Reload/page close and late warmups release their owned handles/leases.

The session test covers state transitions and 40 ordered delta roundtrips. Controlled publication tests cover serialized Toy work, rapid edits, map replacement, hidden layouts, failure/retry, patch fallback and late warmups. Native Full/Toy tests exercise tank rows, atomic undo/redo, structure/bridge removal, cached layouts and persisted delta restoration.

### Whole-field Buff workflow

`buff-expectation.js` separates dependency scanning from result composition; synchronous and asynchronous callers use the same scenario logic. `buff-weight-kernel.js` uses bounded conditional moments for floating-point retry weights, with the original CRT/finite-limit calculation as a fallback. The actual map retains its exact integer probabilities. The coordinator only dispatches grouped weight jobs through `buff-kernel-pool.js` and `buff-kernel-worker.js`; helpers never rebuild or clone the whole map search.

Weight projections expand on demand within a byte-bounded LRU. `buff-field-cache.js` holds completed immutable numerical fields only. Layout replacement, latest-task cancellation, worker failure, teardown, and display-only reuse have separate regression coverage. See [Buff performance notes](docs/buff-expectation-performance.md) for the mathematical bounds, ownership, memory budgets, and measurements.

### Numeric input contract

`numeric-input.js` preserves drafts without rewriting or rounding while typing. Debug settings validate numerical usability and required semantics, with no arbitrary bounds in controls, configuration, or rendering consumers. Final alpha/RGB validity is separate from raw effect coefficients. Business validation happens on commit; background refreshes preserve the focused draft. See `AGENTS.md` and `docs/simulation-mode.md`.

See [bulk edit performance](docs/bulk-edit-performance.md) for exact quotient acceleration, region geometry and historical tile reuse, lossless encoding threads, and the Toy pixel-compositing worker lifecycle and regression coverage.

Simulation history copies editable containers and shares unchanged internal records; public plan reads remain independent deep copies. Small erasures query footprint indexes, restoration follows intersecting original foundations, and edit counts are cached per plan. Toy full-image export streams final-pixel tiles from an independent worker, retaining the original pixel readback and global sampling phase without sharing edit or thumbnail task ownership.

Origin-layer performance: `transfer-overlay.js` prepares projection, conditional labels and spatial buckets once per selection. Moving views reuse full-DPI viewport pixels; exposed strips repaint locally, with background work split into 256-pixel parts (16 million physical pixels maximum). Stationary frames retain vector sampling. Source geometry / visibility is shared across draw buffers; solid columns skip dash-phase grouping and allocate no hidden-stroke buffer. `transfer-origins.js` keeps exact numerators and lazily evaluates unused final contribution ratios; its bounded recent-selection cache does not change any probability. Pointer hits resolve retained spatial geometry through the current lookup before reading probability/details, preventing stale-record errors after simulation edits. Source queries yield the first selected-cell frame and discard superseded requests.
