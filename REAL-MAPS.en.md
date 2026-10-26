**English** | [简体中文](REAL-MAPS.md)

# Real-map crate probabilities and passability changes

Run **Start Crate Atlas.cmd** and open the map page. No game connection or inspector process is needed; the original map is never changed. The top language selector controls the interface and export annotations; see [language settings](PORTABLE.en.md#language).

## Using the map view

1. Select bundled YR 1.001 / RA2 1.006, or an optional game directory. Open or drag in a text `.map`, `.yrm` or `.mpr`, or choose **Official maps**. MIX archives, saved games and preview images are not map inputs.
2. Zoom with the wheel, pan with either mouse button, and click a cell for details. Click it again to deselect; a drag does not deselect. Risk-coordinate buttons and X/Y **Go to** locate cells directly.
3. Probability and risk layers are independent. Defaults: warm palette, 45% transparency, no coordinates and no labels for exact 1× cells. Baseline cells fade further using the square root of overall transparency: 45% becomes 67.1%. Text appears only at readable zoom levels. Water / land filters and thresholds do not renormalize probabilities.
4. Red outlines the map; blue outlines the camera display bounds. Amber indicates visible but unusable cells, including the upper restricted band. Usability, camera visibility, player fog and route reachability are different concepts. Pink marks post-placement passability changes. **3D view** shows related high cells and height-test areas.
5. **Export view PNG** captures the current 1600×1050 output, including navigator state. **Export full-map JPEG** draws the whole map independently of pan / zoom, with multiplier labels even if the on-screen labels are off. Exact 1× labels, palette, transparency, filters, thresholds and other layers follow current settings. JSON, all-cell CSV, current-risk CSV, potential-risk CSV and the selected cell's reduced exact fraction are also available. MP4 export belongs to the small mechanism demo.

Green rounded occupancy markers show preset building foundations, ground vehicles or infantry, using logical foundations rather than sprite dimensions. Fill opacity is 16%, border opacity 50%, independent of probability settings. Terrain objects, ore, walls and other zero-probability causes do not automatically turn green. Markers follow slopes, foreground occlusion and camera clipping; labels and selection stay above them.

Multipliers use one decimal place. Percentages use **two significant digits**, for example `0.0097%`, `0.10%` and `96%`; zero is `0%`. Exact integer comparisons, thresholds and exported fractions do not depend on display rounding. Zero-probability cells have no probability fill.

## Calculation scope

The model describes the **next random-placement function call on the map file's initial static state**, assuming a free crate-manager slot. It excludes automatically spawned opening units, later movement / construction, ore growth, executed triggers and terrain already changed by crates in a live game. Preset objects and overlays participate in the initial occupancy / passability checks.

**Ore/Trees: Off** removes preset ore / gems and trees and rebuilds the appropriate land, search, retry and risk states. Ore drills, buildings, units, rocks, traffic lights and other scenery remain. Stock trees and Mod scenery identified by tree images or descriptive names are recognized; ambiguous custom scenery is retained. A floating loading message appears; the view, region statistics and 3D switch together when ready. The other layout preloads when idle. In-flight requests are shared, failures preserve the current layout, and browser memory holds only the current map's two layouts and decoded images. Disk links in `mineral-variants.json` survive server restarts and are checked against map / rule / resource fingerprints, renderer version and tree-removal model; older ore-only results cannot satisfy the combined Off state. A new map releases the old browser cache; backend analyses run serially.

Bundled stock resources live in `assets/original` and use fixed SHA-256 validation. Map overrides merge with the selected game's stock rules and are recorded. Bundled mode does not automatically load loose INIs, game-mode rules, expansion archives or Ares / Phobos. The optional directory mode discovers those readable resources separately and labels its results approximate. Map and resource hashes are recorded in each result.

Preserved stock mechanisms:

- X and Y independently sample `1…W+H−1`, including origins outside the map. Missing map cells use the Clear sentinel and Track search; actual Water origins use Float even when outside usable bounds.
- Initial land properties combine TMP, Overlay, `NoUseTileLandType` defaults and cliff-back recalculation. Raw TMP land is not assumed to be the runtime value.
- LocalSize is intersected with map bounds and engine margins; cell tests include level and upper-ramp adjustments.
- Walls, units, infantry, foundations and Terrain occupation affect nearby search. Traversable ore / existing-crate overlays may enter candidates but fail final placement because Overlay is nonempty, causing a fresh origin draw.
- Trees, lights and ore drills use theater-specific `OccupationBits`, a subcell mask rather than sprite area or a count of occupied cells.
- Native ring order, duplicate records at radius zero, the 24-record cap, radii `0…min(W+H,32)−1`, projection-primary / secondary groups and stopping rules are retained.
- One logical frame is shared across all up to 1,000 attempts. Selection uses `frame % candidateCount`.
- Some empty-overlay slopes with index >4 pass search but reject Overlay marking while Put reports success. This terminates the call **without a crate entity**; it is not a reroll, and its probability is not redistributed to real crates.
- Land is recalculated after placement. A transition to Rock does not retroactively make that placement's probability zero.

### Unknown content and directory resources

Unsupported rules or unknown objects produce an **approximate result with an accuracy warning**, wherever meaningful parsing remains possible. An uncertain cell participates in search using readable terrain, then assumes placement failure / reroll if selected. It is not simply removed from candidates to transfer its mass to neighboring cells. Known occupancy, terrain and usable bounds still apply; known obstacles can exclude a cell containing an unknown object.

Unknown buildings use a readable foundation if available, otherwise their origin cell only. Unknown terrain preserves height, gets a purple-gray placeholder and assumes ordinary flat terrain with retry on selection. Unlocatable damaged object records and damaged overlay layers are omitted with warnings. These assumptions may affect the whole map. Main view, statistics, 3D probabilities and exports share the same approximate result. Unverified post-placement risk predictions are suppressed.

JSON records `metadata.approximate=true`, `probabilityQuality=approximate`, the assumptions and retry coordinates in `approximation`, and cell-level `assumedRetry` / `retryAssumptions`. CSV also identifies approximate data. Exact fractions describe arithmetic **inside the assumed model**, not proof of game accuracy. Old preview-only reports can be reanalyzed with **Calculate using retry assumptions**.

Saving the correct game directory reanalyzes the map. Auto mode prefers it; official-map choices still use their corresponding bundled version. The resource dialog reports actual rules / art sources. Missing includes and unverified extensions remain visible warnings. Missing artwork alone does not abort a whole map.

Invalid core structure still stops loading: invalid Size, missing / damaged IsoMapPack5, duplicate sections, unsupported conflicting keys, duplicate or out-of-range terrain. Ordinary ramp ore (1–4), projection-only boundary bridge cells, preset deck / ground occupancy and initially closed gates are supported. Completely undefined but stock-registered YR buildings use native empty foundations; irrelevant Sight conflicts are recorded. All 248 bundled official maps are supported under these static rules. See [loading details](docs/stock-map-loading.en.md) and [bridges](docs/bridge-crates.en.md).

There is no complete pathfinding, connectivity or visual-accessibility classifier. Ordinary isolated plateaus are **not** flagged merely because a player cannot reach them.

## Exact probabilities and optimization

Origins are independent uniform samples. Logical frames are equally weighted over the joint candidate-count residue period. All retries within a call share the frame. This is a defined static distribution, not a seeded game RNG replay or a claim about live spawn timing.

Let `N` be the origin count, `L=1000`, and `P` the least common multiple of nonempty candidate counts. At fixed frame `f`, `T(f)` counts origins that terminate the call, including entity placement and success-without-entity; `F(f)=N−T(f)`. `n(c,f)` counts single-attempt origins that actually place a crate in cell `c`.

```text
D = P × N^L
G(T) = [N^L − (N−T)^L] / T      exact integer for T>0; use 0 when T=0
A(c) = Σ_f n(c,f) × G(T(f))
P(c) = A(c) / D
raw multiplier = N × P(c)       retained as the data field multiplier
B = Σ_f G(T(f))
display relative multiplier = A(c) / B
display baseline probability = B / D
retry exhaustion = Σ_f F(f)^L / D
no-entity termination = Σ_f ghostHits(f) × G(T(f)) / D
```

The invariant `Σ_c A(c) + ghostNumerator + failureNumerator == D` must hold. Tiny positive failure probabilities can underflow in floating-point fields; the full integer result remains intact. A cell receiving only its own origin once per frame has relative multiplier 1×.

Two exact optimizations avoid sampling. First, C builds ordered candidate geometry once per origin and aggregates `(candidate count n, residue r, destination c)`. Second, retry weights depend only on `T(f)`: a smaller weight period is combined with each candidate count through greatest-common-divisor relationships. Heck Freezes Over has joint period 360,360 but weight period 2,520. Large cases use Chinese-remainder grouping and integer distribution convolution. With at most 24 candidates, conditioning on powers of 2 and 3 leaves factors 5, 7, 11, 13, 17, 19 and 23 conditionally separable. Tests include period 5,354,228,880 without enumerating it in full.

Apply each frame's retry weight **before** averaging. Averaging single-attempt success rates first is generally incorrect. Normalizing to 1× does not permit dropping frame-dependent retry weights.

JSON shares large coefficients rather than copying thousands of digits to every cell:

```python
import json
from fractions import Fraction
r = json.load(open('result.json', encoding='utf-8'))
e = r['probability']['exact']
c = next(c for c in r['cells'] if (c['x'], c['y']) == (99, 105))
n = sum(count * int(e['coefficients'][i]['numerator']) for i, count in c['terms'])
p = Fraction(n, int(e['denominator']))
raw_multiplier = p * r['probability']['sampleCount']
first_n = e['coefficients'][0]['n']
b = sum(int(t['numerator']) for t in e['coefficients'] if t['n'] == first_n)
relative_multiplier = Fraction(n, b) if b else Fraction(0)
```

Thresholds use integer cross multiplication; baseline checks use `A(c)==B`, never the rounded `1.0×` label. `probability-display.js` is shared by maps, demo and video. Browser JSON / CSV add `relativeMultiplier` and `isBaseline`, retaining the original `multiplier`. Display metadata and selected-cell fraction exports describe the baseline; disk reports retain their original calculation fields.

Identical destination / retry-weight distributions also share large-integer sums and browser display values. Full origin search and finite retries remain intact. Field-by-field comparisons on Heck Freezes Over and RoomEscape preserved coefficients, denominators, per-cell fractions and success / failure rates. Recorded aggregation-only timings improved by roughly 40–50%; this is not a whole-program performance guarantee.

## Heck Freezes Over regression

YR `xmp32s8.map` SHA-256: `1098b6556114e5a6da206efc9090852cca4c96c2b683a399cd05aae75a416fa7`.

- 19,690 actual cells and 39,601 origins; all ordered candidates match the independent native-order reference.
- 7,318 exact baseline cells: raw multiplier about 1.20886049×. The maximum changes from raw 248.20498× to relative 205.32145×.
- 10,711 cells have entity-placement probability. The model gives about 96.2% entity placement and 3.8% no-entity termination, not measured live frequencies.
- 13 current Rough → Rock risk cells; 9 geometric candidates without a placement path are excluded. The 27 previously identified ordinary isolated plateau cells retain probabilities and no anomaly markers.
- `(99,105)` is about relative 3.2×, raw 3.8×, probability 0.00969255%; Rough becomes Rock due to `(98,106)` at level 6 versus target level 2. This point has before / after game snapshots; the other coordinates are static predictions.

Current-risk coordinates: `(102,43) (89,47) (99,59) (102,59) (126,77) (126,78) (127,79) (129,83) (131,86) (131,87) (99,105) (64,131) (100,148)`.

Historical local timings were roughly 4–5 s cold / 3 s with resource caches. A flat 150×150 fixture with 44,850 cells and 89,401 origins took about 6 s. Hardware, objects, terrain and frame-weight distributions matter; these are not promised timings.

## Current and potential blocking

Solid pink means a crate can appear now, then change this cell to land ordinary infantry and tracked vehicles cannot enter. It does not guarantee a route before placement. Hatched pink means an additional such cell exists in a hypothetical layout with **all** buildings, minerals, trees / Terrain objects and units completely removed, without rubble; other terrain, heights and overlays stay unchanged.

At `(100,58)`, TREE11 initially prevents placement. Removing it leaves Rough; placement then makes Rock due to `(101,57)` four levels higher. An independently parsed copy with just that tree removed changes current-risk markers from 13 to 14. The original result keeps 13 solid markers and one potential marker.

The cleared layout does not enumerate arbitrary partial removals, destruction effects, fallen trees, rubble or ore growth. It proves a placement path exists without calculating exact post-clearance probabilities. Existing probabilities and original map bytes remain unchanged.

Schema 2 records `potentialMarkers`, global clearance assumptions, and per-cell `removable`, `potentialMarked`, `clearance`, post-placement land and a reproducible origin / candidate-index witness. Missing fields in old reports prompt reanalysis rather than silently meaning zero risks. CSV exports distinguish current and potential risks. Both markers have independent switches and follow visible surfaces / camera clipping, ignoring probability filters.

Crater / scorch Smudges do not follow the crate land-recalculation path. Tree removal recalculates, but without Overlay it does not itself turn Rough into Rock. Some successfully placed rubble overlays can enter the same branch. These removal conclusions are binary / static comparisons, not newly recorded in-game destruction experiments. See [mechanism research](docs/random-crate-generation.en.md).

## Artwork, navigation and exports

Simple map-added BuildingTypes / VehicleTypes / InfantryTypes / AircraftTypes can reuse stock art. `Image` selects artwork; it does not inherit the rules of a same-named unit. Missing / unsupported definitions enter the documented approximation path. Preset YR aircraft use initial grounded occupancy without advancing missions or takeoff. RoomEscape's `CrateMaximum=0` is reported: conditional placement probability does not imply automatic spawning.

The navigator defaults on, with white viewport, yellow selection and pink risks. Click / drag the thumbnail to pan without changing zoom or selection. Drag its title to move; minimize leaves restore and close buttons. Reopening returns it to the initial top-right position. Fullscreen and PNG preserve navigator state. Arrow keys and the eight-way controls move selection; simultaneous diagonals tolerate a short keypress delay.

Full-map export uses a separate canvas, normally 1.5× the native terrain size. Large maps reduce the additional enlargement but never go below native cell detail. Multiplier text uses 12–16 px semibold type and a dark outline; JPEG quality is 95%. Read at 100% zoom. The export excludes the navigator, temporary selection highlight and UI buttons; it includes enabled region overlays. Progress reports dimensions, size and label count without changing the live view.

Building artwork and occupancy are separate switches, shared by main view, minimap and exports. Static building bodies, damage frames, foundations and common attached animations are supported. Infantry use Guard / deployed frames, facing, subcell and house remap. Vehicles / aircraft support SHP or VXL/HVA, common turrets, barrels and shadows. Dynamic missions, animation, combat, lighting, arbitrary engine extensions and exact per-pixel game Z-buffer behavior are not simulated.

Directory discovery picks the highest-priority file rather than merging duplicate candidates: loose files first, numbered expansions descending, standard archives and nested includes; unknown archive names are last-resort candidates with warnings. Only the selected root is saved. Result fingerprints keep 3D and ore/tree switching bound to the same resources. Missing art is listed in the interface and `object-audit.json`; explicit `Image=None` and empty voxel parts remain transparent. Ground and object rasters are separate `ground-v4.png` / `objects-v4.png`; artwork switches never change occupancy, picking or probabilities.

For an existing report, `python realmap_render.py output/<result>/result.json` upgrades drawing only when the preserved `source.map` hash matches. Otherwise reimport the original map. [Rendering details](RENDERING.en.md) describe palettes, anchors, slopes and shadows.

## Verification and CLI

Historical research checks covered 114 small distributions against independent `Fraction` sums, CRT against full-period enumeration, all three map Pack decoders against CNCMaps, all Heck Freezes Over cell / candidate states, 26 SHP frames against an editor decoder, and 9,126 origins across six theaters. Clearance checks independently removed objects and compared 39,601 origin candidate lists. Early conservative failures for ordinary ramp ore were subsequently resolved; old research output is not the current support list. Some historical scripts / evidence archives named in the Chinese research record are local research material, not distributed release inputs.

Current reproducible checks and synthetic fixtures are listed in [architecture](ARCHITECTURE.en.md). They do not connect to or modify a game process and are not an in-game test of every cell on every map.

```powershell
python realmap.py 'D:\path\example.yrm' --version yr --output output\my-map
```

Source runs require Python 3.11+ and `requirements.txt`. LCW / LZO decoding is bounds-checked. The C search tool recompiles only if its source digest changes; portable builds include it. Use `CRATE_CC` / GCC for modified source and `--ra2-mix` / `--yr-mix` for explicit research archives. Module responsibilities are in [architecture](ARCHITECTURE.en.md).
