**English** | [简体中文](RENDERING.md)

# Real-map rendering

Rendering and picking geometry are separate from random origins, search order, usable-cell tests, exact probabilities and post-placement Rock detection. A drawing upgrade must not change those model results.

## Palettes and anchors

Palette and anchor conventions were checked against the local World-Altering Editor's actual IL, not estimated from screenshots. The historical `wae-palette-selection`, `wae-rendering` and `wae-anchors` IL archives are local research evidence, not release inputs.

| Object | Snow palette | Full SHP canvas top-left relative to cell center |
| --- | --- | --- |
| TMP, ordinary trees, rocks | isosno.pal | Trees: `(-W/2, -H/2 + YDrawFudge)` |
| Gold TIB01, gems GEM01 | snow.pal | `(-W/2, -H/2 - 12)` |
| Ore drills TIBTRE01–03 | unitsno.pal | `(-W/2, -H/2 - 15)` |
| Walls | unitsno.pal | `(-W/2, -H/2 - 12)` |

Other theaters use their corresponding stock palettes. Decoding already preserves each frame's crop origin; do not bottom-align it again. The old `cy + 15 - H` tree anchor differed by `H/2 - 15` pixels, varying with canvas height; a fixed two-cell shift is not a valid correction. Minerals use the density frame from OverlayDataPack. Terrain and Overlay on the same cell are drawn separately.

Six-bit palette channels expand as `(v << 2) | (v >> 4)`; index zero is transparent. Colors and frames are static; game lighting and animation at a particular moment are not reproduced.

## Original shadows

Paired SHP shadows use frame `totalFrames / 2 + bodyFrame`, the same canvas / crop / anchor, and opacity `128/255`. Trees usually have two frames; a 22-frame drill uses body 0 and shadow 11. Shadow pixels use palette index 1 as a black mask, not a unit-palette color.

Receivers derive from final TMP surface ownership. Shadows can cross same-level neighbors and cover flat minerals, but foreground cliffs, different levels and solid sprite bodies occlude them. Artwork and shadows stay below grid / coordinates / probability. Empty shadow frames, unpaired images and `NoShadow=yes` get no invented shadows.

This reproduces original static masks, not real-time light sources or animated deformations. The recorded Heck Freezes Over render has 402 terrain objects with visible shadows. `render-audit.json` records source frames, pixel counts, canvas bounds and opacity. Historical shadow checks covered real tree / drill / crate / rock frames, empty mineral shadows, NoShadow, terrain / object clipping, bounds and unchanged geometry / probability / risk data.

## Ramps and occlusion

TMP base and extended alpha are preserved. Slopes use their actual opaque contours, including raised ramp artwork, instead of an unconditional flat diamond. Painter ordering produces a native-resolution terrain-ownership buffer. Flat-cell selectable surfaces exclude vertical cliffs; ramp surfaces include the ramp extension. Foreground opaque TMP pixels remove hidden portions. Grid, probability fill and picking share the remaining visible contours, simplified within roughly one original pixel; flat cells retain shared corners to avoid doubled edges.

This is static surface occlusion, not the full game's object Z-buffer. Buildings / vehicles have separate artwork and occupancy layers. Unsupported states never silently become exact results. Bridges are drawn from ISO and ordinary theater archives, with original image offsets and variation frames. High-bridge sprites / units rise four levels; transparent low-bridge frames remain transparent. The 3D view stitches artwork across cells and retains ground beneath a separate high deck.

## Camera bounds and the upper restricted band

`VisibleRect=(L,T,VW,VH)` supplies usable-cell parameters; it is not itself the camera drawing rectangle. From archived YR `0x6D8640`, subtracting / adding viewport half-extents to camera-center limits gives these world-projection bounds:

```text
left   = 30 × (2L - W)
right  = left + 60 × VW
top    = 15 × (W + 2T - 5)
bottom = top + 30 × VH + 135
```

Add the drawing origin for display. The top extends 75 pixels above the flat-cell usability comparison; the bottom retains its own camera margin. These bounds do not describe player fog. Blue outlines camera limits, the outside is dimmed, and amber marks camera-visible but unusable cells. Camera clipping can split cells fractionally; usable / restricted classification remains a whole-cell test with native level and upper-ramp adjustments.

Clipping never changes probabilities. The recorded 358 partially camera-visible cells in Heck Freezes Over have zero exact probability because of native candidate rules, not because rendering zeroed them.

Void transfer origins with no actual terrain borrow the nearest real edge cell's height for drawing (Euclidean map-coordinate distance; higher cell wins ties). Fill, outline and percentage share that anchor. The cache is per result; pan, zoom and selection do not change it. Actual terrain origins keep their own levels / ramps. This changes no search record or probability.

## Auditing and refreshing results

New analyses preserve the uploaded bytes as `source.map`. `python realmap_render.py output/<result>/result.json` upgrades drawing only with a matching source hash; reimport old reports lacking the source. A same-named but modified map is not an acceptable substitute. `render-audit.json` records files, frames, palettes, offsets and clipping counts. Current synthetic and native rendering checks are described in [architecture](ARCHITECTURE.en.md); older `verify-realmap-render` / shadow reports referenced in research notes are local historical evidence.

# Static object layer, version 4

`realmap_objects.py` preserves map object identity, house, health, facing and infantry subcell independently of the probability cells. Frame conventions and anchors were checked against the local FA2SPHE HE_1.5.3 `Body.LoadObjects.cpp` and `RendererTypes.cpp`. The implementation uses the existing SHP decoder; the bundled voxel library in `runtime/voxel` is called through a separate bounded x86 worker, with cached frames keyed by VXL/HVA bytes, facing and offsets. House colors tint the unit palette's remap ramp; no game lighting simulation is claimed.

The renderer composites a second scene alongside the unchanged original terrain. Terrain and objects use painter ordering, original paired SHP / voxel shadows are clipped against same-level ground and visible solid bodies. Ground ownership and picking polygons exclude objects deliberately. This static painter implementation is not the game's per-pixel Z-buffer. The same two scene rasters feed the main view, minimap and full-map image export, beneath probability text.

Directory resources use the local ra2yr-map read-only MIX/INI parser (preserved in `resource_context/`), including resource provenance, bounded includes and nested archive reads. Only the selected directory is saved; no named Mod profile or Mod artwork is bundled. Readable rules support approximate probabilities with explicit warnings; unknown objects use the documented retry assumption.

### Object layout, renderer version 9

Custom foundations read `Foundation.X/Y` and the enumerated `Foundation.N` cells for visual depth sorting and aircraft roof ordering. This does not change their separately assessed probability/occupancy support. OnBridge raises a sprite and its shadow receiver only when its cell actually has a high bridge; low bridges and stray OnBridge fields on land keep ground height.

SHP vehicles rotate their direction index by `Facings/8`, following FA2SPHE's frame-list rotation. Infantry sequences and voxels retain their own conventions. SHP turrets use 32 direction frames from `<image>tur.shp`, or from the body SHP after `Facings × WalkFrames` (independent of `StartWalkFrame`). Body and turret retain their own full-canvas anchors and crop origins; `TurretOffset` and `UseTurretShadow` apply generically. No unit-specific frame numbers or pixel offsets are substituted.

An object-only depth stencil prevents later same-level ground tiles from erasing feet and other opaque sprite pixels outside the anchor cell. Higher foreground terrain can still occlude them. Ground rasters, surface ownership, picking and probability overlays are unaffected. This remains a static preview rather than the full engine's per-pixel Z-buffer and animation system.

`python verify-object-layout.py` uses generated SHPs (no Mod data) to check facing layouts, both turret layouts, original canvas/crop positioning, offsets, valid/stray bridge flags, custom foundation ordering and foreground occlusion.

Renderer version 10 also corrects `NewTheater` terrain/overlay names. Only an A/T in the second character of an alphabetic-prefix image is treated as a climate placeholder; other names are tried unchanged first. For eligible names the search is current climate, generic climate, then the declared filename. Both Rules.Image and Art.Image are resolved before this search. This follows the editor's Ares-compatible overlay fallback and is shared by 2D and 3D; wall connection/damage frames, palettes, occupation and probabilities are unchanged. `python verify-sprite-resolution.py` checks precedence, all six climates, non-placeholder names, aliases, suffixes and genuinely missing resources using synthetic names only.

## 3D terrain inspection

The “3D view” button loads a bounded patch around the selected cell through
`realmap_3d.py`. It reads the existing result without rerunning or modifying the
probability calculation. The frontend is `terrain3d.js` with locally bundled
Three.js r160; the portable build includes both the extractor and library.
The initial range is 21×21 cells; 31×31 is the largest selectable patch.
“Probability: Off” starts off whenever the inspector is opened. Enabling it displays
surface colors and multiplier labels from the main map's exact display model,
with the same palette, filter, threshold, transparency and 1× label settings.
Its on/off state is independent of the main map and survives a range change.
Labels appear at readable zoom levels and use depth testing; geometry and
shared label textures are built once per patch and reused during selection and
rotation. No probability is recomputed or renormalized to the patch.

Original TMP sub-blocks are unprojected onto their own surfaces, preserving
palette colors and theater-specific roads, snow, sand and rock. Ramp corner
heights use the top/right/bottom/left offsets documented in FA2SPHE HE_1.5.3
`FA2sp/Ext/CMapData/Body.h::RampTypes`; bilinear interpolation is a visual
reconstruction, not engine collision geometry. Multi-block cliff artwork is
often stored on the lower neighboring cell. Vertical faces first sample that
cell's actual extended image, then the upper cell, with nearby original cliff
art as a fallback.

“Detailed cliffs” is on by default. `terrain_depth.py` reads each flat TMP's base and
extended Z bytes and unprojects its painted pixels into a shared indexed mesh.
The original alpha silhouette, cliff tips and texture coordinates are retained
at pixel resolution; meshes and materials are shared by repeated sub-blocks.
These depth bytes describe rendering order, not an original solid model: the
result is a visual relief reconstruction. From the original camera, every
vertex projects back to the original texel. Slightly recessed ground and wall
backings close surfaces not painted for that camera. Missing or invalid depth
data falls back to the existing simplified terrain; slopes keep their actual
ramp corner reconstruction. The checkbox switches locally without reloading
the patch. Mesh picking, overlays and relations continue to refer to the
original cell and its integer level; relief heights never enter probability or
passability calculations. The depth layout follows the primary
[CNCMaps TMP reader](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.FileFormats/TmpFile.cs)
and [TMP renderer](https://github.com/zzattack/ccmaps-net/blob/main/CNCMaps.Engine/Rendering/TmpRenderer.cs).

Cut boundaries use a neutral material. Mineral overlays
follow the surface; trees and solid terrain objects use original static SHP
billboards. Buildings and units are not part of this terrain inspector.
Cliff faces toward the original +X/+Z game camera preserve the artwork's
original brightness with an unlit textured material, avoiding a second layer
of shading over the painted cliff art. Rear faces and cut boundaries retain
their existing Lambert lighting. This choice follows world orientation and
does not move with the inspection camera.

Cliff relations use the full saved map, including neighbors outside the patch,
the six original offsets and an integer Cell.Level difference of at least 4.
They are shown only when the original-model result enables
CliffBackImpassability=2. Rough exceptions remain distinct from existing Rock.
Risk colors reuse the saved main-map flags: solid pink for `marked`, hatched
pink for `potentialMarked`. Remaining Rough cells with a cliff relation and
zero probability use amber dots and a dashed border; they are not random-crate
anomalies. Missing/other probabilities are never silently classified as zero.
Legend counts apply to the displayed patch, and selection details explain
projection rejection and clearance support when that evidence is available.
Mod previews show only geometry and original artwork, with no new passability
or crate claims. The 3D mesh does not reproduce the exact original 2D silhouette,
hidden backs of sprites or a complete movement/pathfinding model.

Bridge SHPs are sampled across their actual neighboring cells, including sprite
owners outside the selected patch. Low decks follow the ground; high decks use
separate surfaces at the saved `deckLevel`, with water/ground retained below.
Bridge geometry stays fixed when the camera rotates, and the decorations toggle
also hides bridges. Railings and piers remain painted artwork, not reconstructed
volumes. Cliff markers and crate previews still inspect the ground layer.

## Region editing and rendering caches

The main view caches terrain, probability fill, occupancy and grid as a static layer. Regions, probability text, transfer origins and selection retain their original drawing order. An overview caches the full raster within a pixel budget so panning reuses it; close zoom caches only the viewport. Filters, zoom, palette, layer toggles and map changes invalidate the relevant cache. Minimap backgrounds and color legends also have independent caches.

Region revision numbers separately cache statistics, thumbnails and terrain paths. Unchanged regions are not rescanned; rename / sort do not recompute probability. Main-map and minimap region rasters share a bounded 16-million-pixel LRU; the main base layer has an 8-million-pixel budget. Small regions cache their whole extent, large regions only the visible part. Probability labels remain above region fill.

Brushes and picking first narrow candidates using projected / game-coordinate indexes, then use the unchanged exact hit tests. Ordering, membership, zero-probability area counts and the probability model remain unchanged. Region eligibility requires `usable && cameraCoverage > 0` and excludes `visibleBand`. Old reports without coverage use projected-center / camera-rectangle comparison. This restricts membership, not the map's general spatial index. Ellipse brushes multiply projected Y by two for point-to-segment distances; click, continuous drag and cursor preview share the 2:1 aspect.

`player-starts.js` decodes metadata waypoints 0–7 as `Y*1000+X`, requires a real cell, uses its level and displays 1–8. Other waypoints, negatives and missing cells are omitted. New reports record `multiplayerOnly`; known single-player maps omit start markers. Main markers sit above regions and below probability text, slightly offset with a leader line; minimap / region thumbnails show smaller matching numbers at the actual position.

`node verify-regions.cjs <result.json>` checks the 12 defaults, color separation, migration, indexed / exhaustive selection and probability conservation. `verify-map-view-cache.cjs` compares cached / direct pixels and labels, including invalidation after pan / zoom / filters / layers. Image checks and `benchmark-map-view.cjs` require `@napi-rs/canvas` (portable `NODE_PATH=runtime/node/node_modules`). Offscreen Canvas timing is not browser presentation FPS.

## Language and exported annotations

Canvas text uses the same explicit translation catalog as the controls. Full-map JPEG and demo MP4 capture the chosen language; probabilities, geometry, image assets and source identifiers stay unchanged. Layouts constrain long captions and reserve separate spaces for legends. User-entered map / region names are never translated. See [localization boundaries](ARCHITECTURE.en.md#localization).
