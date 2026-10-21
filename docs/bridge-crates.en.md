**English** | [简体中文](bridge-crates.md)

# Bridges and random crates

The tool supports ordinary low bridges, high bridges and preset objects above / below high bridges in the initial layouts of stock RA2 and YR maps. Candidate passability, projection priority and final Overlay rejection are separate stages. A walkable bridge does not guarantee a crate can spawn there, and bridge cells do not all transfer their probability to neighbors.

## Low bridges

Most low-bridge cells have `LOBRDGxx` or wooden `LOBRDBxx` overlays. Ordinary segments use `Land=Road` and `NoUseTileLandType=yes`. Some ends, such as LOBRDG27/28, use `NoUseTileLandType=no` and retain TMP land. Do not force all segments to Road or categorically disable Float. Low bridges use the ground occupancy layer and terrain speed, without high-bridge alternate occupancy.

A traversable bridge overlay may pass nearby search, but final crate Put requires empty Overlay. Selecting a nonempty bridge cell therefore fails and draws a fresh origin. That is a retry, not a local transfer to the nearest free neighbor.

## High bridges: ground and deck

Overlay indices 24, 25, 237 and 238 create high-bridge flags. Each owner marks four deck cells: itself, one and two steps forward, and one backward. Only the owner has the bridge Overlay; other marked cells can still have empty Overlay. Ground TMP remains unchanged and deck height is ground level +4.

The crate candidate call uses `IsClearToMove` with level `-1`, checking alternate occupancy on high bridges. Occupancy and wall rejection happen before the bridge exception that can override zero terrain speed, including Float. This explains the candidate check, not whether a boat has a navigable route onto a deck.

Search speed is chosen from the **origin's ground land**: Water → Float, otherwise Track. Bridge projection flag `0x1000` also affects the terrain ray's effective height (+4), changing primary / secondary candidate classification. Deck flag `0x100` and projection flag `0x1000` must remain distinct.

Preset vehicle field 11 and infantry field 12 carry OnBridge. When the cell actually has a high bridge, these objects occupy the deck layer and draw four levels higher; otherwise they stay on the ground. Buildings and Terrain objects use the ground layer. Thus a ground object and a deck object at the same coordinates need not block the same candidate occupancy check.

High-deck cells without the owner Overlay can permit crate placement. The crate is drawn at **ground height beneath the bridge**, not automatically raised to the deck. A ground Terrain object can still make the Overlay constructor's `GetTerrain(false)` check reject creation while Put reports success, yielding a no-entity termination rather than retry. Ground / deck occupancy and Overlay construction must both be modeled.

## Collection

YR's crate pickup check is coordinate-based and does not compare the unit's Z with the crate's draw height. A unit reaching the same map coordinates on the deck or ground can trigger collection. The art appearing below a bridge therefore does not prove the crate is uncollectable. Conversely, coordinate pickup does not prove every unit can reach that coordinate; routing, bridge destruction / repair and dynamic movement were not simulated.

## Bridge artwork

Bridge SHPs can live in ISO or ordinary theater archives. Rendering uses the proper theater extension and palette, original offsets (including the high-bridge -16 and additional -15 conventions), and the native coordinate-dependent variation for frames 9–17 on a 4×4 pattern. OnBridge unit artwork rises 60 projected pixels, corresponding to four levels.

FA2SPHE's ordering provides the basis for drawing bridges behind the appropriate diagonal terrain. Low bridges retain the bridge level +3 versus ground level +1 stencil. Since render version 11, high decks compare their actual level +4 against individual terrain-pixel heights decoded from TMP Z data. A descending pier face no longer inherits its entire image's raised occlusion height and erases the deck. Foreground pixels at or above the deck can still occlude it. Missing or invalid depth retains the original conservative fallback. This is static painter rendering, not the game's complete per-pixel depth buffer.

Since render version 12, opaque high-deck artwork also occludes ground shadows. The default DrawFlat rule no longer lets neighboring spans' shadows darken the deck during final compositing. Original shadows remain visible on the ground beneath the bridge. Continuous-span tests cover both orientations and road/wood bridges in RA2 and YR.

The 3D extractor samples a bridge sprite across its actual neighboring cells, including owners outside the patch. Low decks follow ground; high decks get separate surfaces at `deckLevel`, preserving water / TMP below. Geometry stays fixed during rotation. The decorations switch controls bridges too. Rails and piers remain painted artwork, not modeled volumes; cliff markers and crate previews inspect ground land.

Patch format 5 retains rail pixels outside the movement footprint and folds side artwork at the deck edge. Extending the visible artwork does not extend gameplay bridge flags or change cell heights.

### Transparent frames versus missing spans

In Bering Strait, `(84,87)` has a transparent frame 0 of LOBRDG03. The visible bridge surface is supplied by the neighboring `(84,88)` segment's frame 1 spanning across cells. The former renderer let later ground erase this shared sprite, leaving disconnected slats. The fix corrects painter ordering / occlusion; it does not replace transparent frames with invented artwork.

At `(90,60)` in Siberian Wastes, LOBRDG13 frame 0 is genuinely transparent and isolated. Water can therefore remain visible even though the cell has bridge-overlay rules and cannot accept a crate. Details distinguish its transparent own frame from neighboring coverage.

`verify-bridge-render.py` checks three-cell spans in both orientations, ground with / without buildings, the isolated transparent water cell, flat-ground protection, higher-ground occlusion and image clipping. Main view, minimap and full-map export share the rasters. Drawing stencils do not alter probability data or selectable terrain surfaces.

## Native verification and limits

`verify-bridge-native.py` executes original x86 instructions in isolated Unicorn memory, replacing only unrelated redraw invalidation. It does not patch disk binaries or create a game process. Per game: 3,844 bridge-flag cells, 1,936 projection cases and 432 movement combinations; 12,424 comparisons across both games.

`verify-bridge-layers-native.py` additionally checks YR instructions for 30 occupancy-layer combinations, 12 Overlay drawing-height combinations, 64 pickup / removal combinations and 4 Terrain-construction conditions. Ground heights, infantry subcells, ownership and redraw services use fixtures. Pickup stops after native removal clears Overlay, before random rewards. This is not an in-game routing test.

| Mechanism | YR 1.001 | RA2 1.006 |
| --- | --- | --- |
| High-bridge flags | `47E040 / 47E470` | `4732D0 / 473700` |
| Nearby search | `56DC20` | `5502E0` |
| Candidate movement / occupation | `4834A0` | `478760` |
| Projection group | `6D6410` | `6A6A50` |
| Final empty-Overlay test | `4A18F0` | `493AD0` |
| Overlay Mark | `5FC570` | `5DA970` |
| Vehicle / infantry OnBridge loading | `743270 / 51FB00` | — |
| Vehicle / infantry / building occupation | `7441B0 / 5217C0 / 453D60` | — |
| Overlay draw position / variation | `480110 / 47F6A0` | — |
| Crate pickup | `481A00` | — |
| Terrain prevents Overlay construction | `5FC497 → 47C550` | — |

“—” means no corresponding original-instruction test for that game in this study; YR addresses are not RA2 evidence.

Verified binary SHA-256:

- YR: `3e81a61775d2745d1dabe397325ef663cd994ffc194da4e998e3bf5d2d308600`
- RA2: `5b61b2fd86bb59a2dfbb898e3bd6113381f4609618a8bbd63ac81b8c2205202e`

The current RA2 file differs in whole-file hash from the early study. An additional byte comparison matched 4,648 recorded bytes covering candidate movement, search, Put and Overlay Mark.

Projection rays, originally stepped in 8 leptons, reduce to equivalent comparisons at six diagonal cells: a cell at distance `d` intersects when its effective height difference is at least `2*d−1`. Native projection tests and the full historical Heck Freezes Over search regression agree.

Gates use initially closed foundation occupancy. Identical duplicate INI values are allowed; irrelevant Sight conflicts are warned, while other conflicting keys and duplicate sections remain rejected. All 248 bundled official map files analyze under the static model. [Loading rules](stock-map-loading.en.md) cover ramp ore, projection-only boundary cells and empty foundations. Preset bridges on complex slopes remain outside the exact model. Destruction, repair, movement, actual pickup routes and tunnels are not simulated.
