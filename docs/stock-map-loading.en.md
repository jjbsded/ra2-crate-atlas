**English** | [简体中文](stock-map-loading.md)

# Official-map loading boundaries

These rules resolved the last ten previously unsupported official map files. They apply to bundled RA2 1.006 / YR 1.001 resources and initial file state, without advancing triggers, missions or ore growth. Source map bytes remain unchanged.

## Ore on ordinary ramps

Five affected RA2 files were the freeway map, the Large Ore Field Land Rush variant, Heartland Battle / Megawealth and the critical-point map. The native Overlay::Mark functions (YR `5FC570`, RA2 `5DA970`) allow slopes 0–4. Ore adjacency recalculation (YR `4818E0`, RA2 `476BA0`) changes density frames without deleting ore on those ramps.

YR `Scenario_Load 686B20` increments `IKnowWhatImDoing` during loading. OverlayPack creates overlays first; OverlayDataPack then assigns density through `5FD2E0`. These cells therefore retain mineral overlays, and nonempty Overlay makes final crate placement retry.

Preset ore on `SlopeIndex > 4` remains outside the exact loading model: Mark rejects it and the entire later loading sequence is not modeled. The partial-analysis path reports the unsupported state and its approximation. Ordinary-ramp support must not be generalized to all slopes.

Rendering also resolves `TIB2_* → Image=TIBxx` through the referenced art section, including theater suffix and palette. Looking up only `TIB2_*` incorrectly requested nonexistent `tibxx.shp` instead of existing `tibxx.tem` and equivalent assets. Main map, minimap, exports and 3D share this resolver.

## A bridge at the Paris map boundary

RA2 `mp33u4.map` and YR `xmp33u4.map` have BRIDGE1 at `(18,71)`. Deck cells `(18,69)` through `(18,72)` exist. The third forward cell `(18,68)` receives only projection flag `0x1000`, not deck flag `0x100`.

Native initialization writes that projection bit into the invalid-cell sentinel when the coordinate is absent. It neither creates an extra deck nor changes existing deck occupancy. The model allows this projection-only boundary case; an actual deck extending outside the map remains unsupported.

## Stock-registered but entirely undefined YR buildings

- `c1a02md.map`: CALA02 at `(107,118)`.
- `c3y03md.map`: CALOND02 at `(141,75)` and `(106,136)`.

These types are in BuildingTypes but have no definitions in stock rules, art or the map. They cannot be treated as unregistered types or assumed nonoccupying solely because health is zero.

YR BuildingType constructor `45DD90` clears FoundationData at offset `0xDFC`. With no rule section, the ReadINI chain `45FE50 → 712170 → 5F92D0 → 410A60` fails before reading a foundation. `45EC20` returns only the `(32767,32767)` terminator for the empty foundation. Map registration `5683C0` consequently inserts no cell Content, independently of health.

The tool preserves these object records with empty foundations and no artwork, recorded in `metadata.emptyFoundationObjects` and the object audit. The exception is limited to YR buildings registered by stock rules but entirely undefined across rules / art / map. Other missing definitions are not granted an empty foundation; they use the documented unsupported / approximate handling.

## Conflicting Sight entries

`c3y02md.map` contains both `Sight=6` and `Sight=7` in `[CAMEX01]`. Sight does not affect this static probability, occupancy or rendering model, so analysis continues while `metadata.irrelevantDuplicateKeys` preserves the section, line numbers and values. This does not assert which value the game chooses.

Strict INI parsing still rejects conflicting keys in general. Sight is the specific map-analysis exception. Strength, foundation, movement and crate-rule conflicts, and duplicate sections, are not silently accepted.

## Verification

- `verify-remaining-maps.py`: full probability and rendering analysis for the ten maps; no missing overlay / building / unit artwork, original objects retained, invalid core inputs still rejected.
- `verify-map-loading-native.py`: 3,840 boundary-bridge comparisons and 27 ore-slope / adjacency cases per game; YR missing-section return chain, empty foundations at two health values, and a nonempty 1×1 positive control.
- Historical `verify-realmap.py`: all 39,601 Heck Freezes Over origins, 114 independent rational distributions and six-theater regressions.
- `verify-official-maps.py`: hashes for 248 original files, catalog merging and selection validation.

Native tests execute instructions from fixed-hash game binaries in isolated Unicorn memory, without starting the game or modifying game files. Scripts identify fixture replacements for INI lookup, allocation, general object services and redraw. These checks are not a complete match or a dynamic route-accessibility test. Binary fingerprints are listed in [bridge research](bridge-crates.en.md).
