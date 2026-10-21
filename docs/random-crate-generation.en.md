**English** | [简体中文](random-crate-generation.md)

# Random crate coordinates, nearby search and failed placement

This English reference organizes the mechanism findings, formulas and evidence from the Chinese research log by topic. The Chinese version also preserves the chronological experiment notes and local evidence filenames. Historical “not yet supported” notes describe their original development stage; consult [current analysis scope](../REAL-MAPS.en.md), [bridge research](bridge-crates.en.md) and [official-map loading](stock-map-loading.en.md) for the shipped tool.

The conclusions distinguish original binary inspection, isolated instruction tests, static models and actual game observations. Exact arithmetic means exact within the stated model, not a live-match frequency measurement or a complete game simulator.

## 1. Placement is a sequence of different checks

Stock RA2 / YR does not uniformly pick from a list of all empty map cells. It draws an origin, searches nearby for a candidate, and only then attempts to place an Overlay. An origin outside usable bounds can transfer to an edge cell. A tank can reject a candidate during search. A traversable existing crate / ore / rubble Overlay can pass search but reject final placement, starting a new origin draw.

The outer function tries at most 1,000 times with the same logical frame. It does not inspect a particular player's fog, shroud or current camera. Nearby search is bounded and does not prove a route from a player unit to the destination.

| Situation | Nearby search | Final placement / consequence |
| --- | --- | --- |
| Ordinary usable empty compatible cell | Can be a candidate | Can receive a crate |
| Real cell outside usable bounds | Rejected as destination; its land still selects search speed | Nearby search can find another cell |
| Coordinate with no actual map cell | Sentinel is normally Clear, so Track search | Cannot place outside usable bounds |
| Tank, infantry or building occupation | Relevant occupation byte rejects candidate | Search may move outward |
| Traversable ore, existing crate or rubble Overlay | May pass if other conditions permit | Nonempty Overlay rejects Put; draw a new origin |
| Wall Overlay | Rejected during movement test | Search may move outward |
| Tree / light / drill Terrain | Uses actual OccupationBits, not sprite dimensions | Can reject search; Terrain can also affect construction |
| Ordinary ramp, index 0–4 | Subject to normal local checks | Overlay Mark can accept it |
| Some complex ramps, index >4 | Can pass search | Mark fails but Put may report success: no entity, no retry |
| Locally valid isolated plateau | Connectivity is not checked | May receive a crate despite lacking a route |
| Rough below relevant high terrain | Can initially pass | Crate recalculation can turn it into Rock |

## 2. Initial random coordinates

For normal `[Map] Size=0,0,W,H`, creation initializes coordinate bounds to `(1,1,W+H−1,W+H−1)`. Placement performs two bounded calls:

```text
x = 1 + RandomRanged(0, W+H−2)
y = 1 + RandomRanged(0, W+H−2)
```

Both endpoints are inclusive. A 64×64 map therefore has `127²=16,129` sampled coordinate pairs. This is Cell-coordinate space, not a 64×64 Cartesian screen grid.

Actual cells satisfy:

```text
x+y > W
x−y < W
y−x < W
x+y ≤ W+2H
```

Initial sampling does not first impose these inequalities or LocalSize. That is why outside origins can contribute probability to edge destinations. The extrema are real cells: `(1,W)`, `(W,1)`, `(W+H−1,H)`, `(H,W+H−1)`. There is no extra sampled row at zero or `W+H`.

The teaching demo has W=8, H=6: X/Y each 1–13, 169 origins, 90 actual cells. The outside region is more than a single ring. Search can inspect origin ± radius beyond the initial range; the internal 512×512 pointer table is neither a promise of real terrain in every slot nor the sampling domain. Red rectangular outlines enclose projected diamonds; exact legality follows cell centers and the inequalities.

The bounded RNG uses synchronized scenario state (`Scenario +0x218`), not wall-clock randomness. Two `RandomRanged` calls do not necessarily consume exactly two underlying draws, because bounded rejection may draw again. The state has 250 entries; later crate-lifetime setup also consumes random numbers. The tool's uniform independent-origin model is not a reconstruction of that state. With complete frame and RNG state, an individual native call has a deterministic outcome.

Evidence: initialization YR `56631C–566338`, RA2 `548BEC–548C08`; sampling YR `56BD8B–56BDD3`, RA2 `54E45B–54E4A3`; full-map legality YR `568300`; bounded RNG YR `65C7E0`, RA2 `6388A0`.

## 3. Search speed and the invalid-cell sentinel

The **origin's** runtime land chooses speed: Water (2) → Float (5), all others → Track (1). Search requests a 1×1 cell with Normal movement zone, zone ID −1, occupancy enabled, `disallowOverlay=false`, `requireBurrowable=false`, `allowBridge=true`, `closeTo=Empty`. YR additionally passes `buildable=false`; the corresponding RA2 entry lacks that final parameter.

There is no separate fixed-probability coin toss for a sea crate. The final destination's land independently chooses land-crate versus water-crate artwork. Standard Water permits Float and rejects Track; other land types follow their speed tables. High bridges have special movement / occupancy behavior; neither “water origins always end on pure water” nor “allowed bridge means a crate on its deck” is generally valid.

An actual Water cell outside LocalSize keeps its Water type and starts Float search. A coordinate without a real Cell uses the default Clear sentinel and Track; it does not inherit nearby coastline terrain or change speed midway through search. Therefore a missing-cell origin surrounded only by standard open water can fail to find any Track destination, while a later reroll landing on actual Water can start Float search.

YR initializes sentinel `ABDC50` through `565060 → 47BBF0`; the constructor zeroes land at offset `0xEC`. RA2 uses `A6F9F8`, `547930 → 470F10`. Placement indexes `y*512+x`, substitutes the sentinel for an invalid / null cell pointer and updates its coordinates. YR `56BE07 / 56BE0C` and RA2 `54E4D7 / 54E4DC` show the fallback and Water comparison. Final land / water selection is YR `4A1944–4A1952`, RA2 `493B24–493B32`.

This describes stock initialization. A plugin that modifies the sentinel, creates extra cells or changes sampling requires separate analysis. The UI's borrowed-height drawing of void origins is visual only; it does not alter these rules.

## 4. Nearby search order and limits

1. Start at radius 0.
2. For each square ring, walk X offsets and test top / bottom alternately, then walk interior Y offsets and test left / right, avoiding repeated corners.
3. Check usable bounds and movement / occupation. Retain native duplicate records at r=0.
4. Maintain projection-primary and secondary candidates, with a 24-record cap and native stopping conditions.
5. A ring with suitable primary candidates can end the search. If only projection-mismatched candidates exist, expansion can continue; reaching the cap also stops it.
6. Prefer the primary group; otherwise use secondary. Default selection is `CurrentFrame % count`, not an additional RNG call.

Flat, bridgeless examples usually reduce to selecting from the first nonempty ring. Heights and bridge flags can change projection grouping and must not be dropped for real maps. YR projection helper `6D6410` does not inspect player exploration.

Radius is strictly less than `min(W+H,32)`: ordinary maps search 0–31, excluding ring 32. This is Chebyshev distance in game coordinates, not screen distance or straight-line distance. Zone ID −1 removes a requirement for the origin and candidate to share a movement-connected area. No player's full route is tested.

Main search addresses: YR `56DC20`, RA2 `5502E0`; modulo selection near YR `56E6A8`, RA2 `550BDC`. See [bridge research](bridge-crates.en.md) for projection-ray reduction and alternate occupancy.

## 5. Usability, visibility and occupancy

Search calls `IsWithinUsableArea(cell,true)`; final placement checks the coordinate variant. YR addresses `578540 / 578460` read map dimensions, runtime VisibleRect, level and slope. They do not read player ShroudCounter, Visibility or Foggedness, and receive no player argument.

Runtime `VisibleRect=(L,T,VW,VH)` first intersects LocalSize with map bounds, then applies in order:

```text
L=max(L,2)       T=max(T,2)
VW=min(VW,W−L−2)
VH=min(VH,H−T−6)
```

For a cell, begin with `k=Level`; when `SlopeIndex!=0` and `x+y < k+W+2T+4`, increment k. Then check:

```text
x+y > k+W+2T
x+y ≤ k+W+2(T+VH)+2
x−y < 2(L+VW)−W
y−x < W−2L
```

Flat formulas use k=0. These are not universally valid without the height / ramp adjustment. The camera's minimum center Y is `screenH/2 +15*(W+2T−5)`, extending 75 projected pixels above the flat usability threshold. This is a formula offset, not a guarantee of a fixed number of unusable rows. Cell shapes, level, slopes, viewport and fog affect the visible band.

Visible but unusable top-band cells remain actual cells with their own land types. They can be origins but not destinations. YR passability recalculation `483C80` writes Passability=7 outside usable bounds, without changing LandType into Water / Clear. Unit mouse actions (`700600`, test at `700AF6`) and common construction (`47C620`, test at `47C880`) also use these bounds. Final crate placement temporarily sets `IKnowWhatImDoing=0`; permissive map-loading behavior is not permission for natural placement.

The synthetic 8×6 demo directly uses LocalSize `(1,1,6,3)` for legibility instead of applying engine minimum margins. It is a teaching geometry, not a tiny file that would load with those exact runtime bounds in stock gameplay. Real-map analysis reconstructs the native clipping.

`IsClearToMove` reads the relevant ordinary / bridge occupation byte. Infantry and vehicle ignores are false, so a nonzero relevant byte rejects the candidate regardless of house, stealth or player visibility. Wall overlays and nonzero `GroundType[Land].Cost[Speed]` are checked separately. Buildable=no is not a universal crate veto: movement and placement tests have their own conditions.

## 6. Overlay rejection, rubble, ramps and no-entity termination

Nearby search passes `disallowOverlay=false`. Thus nonempty Overlay alone is not a blanket search rejection. Final crate Put requires `OverlayTypeIndex==-1` after usable-bound checks. Existing crate, ore or traversable rubble may be selected at radius zero, then make Put return false. The caller draws a fresh X/Y pair; it does not resume the previous search at radius one or blacklist the failed cell.

Destroyed-building rubble is an Overlay rather than the former standing foundation. It may be traversable under its land rules, yet still blocks final crate placement. Placing a unit on ore / rubble can change the **search** outcome by making that cell occupied, causing outward search; it does not turn the underlying Overlay into empty ground. Other traversable rubble at the same candidate radius can still be selected if it passes all checks, and then fail final placement. Equal radius alone does not guarantee equal selection weight: native order, duplicates, cap and projection grouping also matter.

Trigger-created crates use a different entry chain from the outer random retry loop. A unit can affect any nearby-search call actually made by that entry, but a failed direct Put does not acquire the random function's 1,000 fresh-origin attempts. Distinguish the caller, search return coordinate and final Put result when interpreting trigger tests.

Walls reject during candidate movement. Terrain uses actual OccupationBits; tree, light and drill sprites are not occupancy footprints. Drill defaults and theater art can differ. A visual object is neither automatically blocking nor automatically harmless.

Overlay Mark (YR `5FC570`, RA2 `5DA970`) accepts ordinary slope indices 0–4. Some more complex slopes pass candidate movement but reject actual Overlay marking. Failure is not always propagated back through construction / Unlimbo to crate Put: Put can report success and terminate the outer loop without producing a crate entity. Empty-overlay Terrain construction failures can similarly matter beneath high bridges.

Do not treat this as a retry or normalize it away. Crate-manager lifecycle / later replenishment is separate; a successful-return slot does not prove an entity exists or promise an immediate new origin draw on the next frame. Static reports preserve three terminal outcomes: entity placement, success without entity, and exhausted retries.

## 7. Cliffs and post-placement land changes

A search-compatible cell need not be reachable. Cliff assets include non-Rock surfaces; isolated Clear / Rough plateaus can receive crates. Static decoding of YR Heck Freezes Over identified 27 ordinary isolated cells in five components; these are not the post-placement anomaly and are not marked just because they are isolated.

The separate anomaly is a **change of runtime land during placement**. With stock `CliffBackImpassability=2`, the relevant low-cell offsets are:

```text
(0,−1), (−1,0), (2,2), (1,1), (−1,1), (1,−1)
```

A checked neighbor at least four Cell.Level units higher triggers the cliff-back branch. This is a fixed, asymmetric local test, including a two-cell diagonal offset; it is not a one-cell-wide band or a flood fill behind every cliff. The apparent purpose, inferred from the code and game projection, is to prevent movement into low cells visually behind high terrain; no original designer comment establishing intent was found.

Without an overriding Overlay, the branch applies this Rock rewrite to Clear / Water / Beach / Ice, leaving Rough and other types outside that specific set. A bypassed type is not automatically a valid crate destination: its movement speed, bounds, occupation, slope, projection and Overlay still matter. Rock is already blocked under stock Foot / Track rules; other bypassed land types require their own checks.

Stock CRATE declares Land=Clear. `OverlayTypeClass` constructor `5FE271` defaults `NoUseTileLandType=true`, even when omitted from INI. Successful placement reaches `5FD200 → CellClass::RecalcAttributes(47D2B0)`, uses the crate's land source and enters the Overlay branch. A qualifying high neighbor can then write Rock at `47D53E`. The crate is not removed and placement is not retroactively rejected because walking in afterward becomes impossible.

### The observed point (99,105)

The YR 1.001 observation on 2026-10-13 used the inspector's “native random algorithm, specified first origin” mode. Search, retries and Put ran natively afterward. It was **not** a claim that unassisted natural RNG happened to draw that point.

| Recorded state | Observation |
| --- | --- |
| Before, frame 5782 | Rough=7, Overlay=−1, Level=2, slope 0, no unit occupancy |
| Placement, frame 5786 | Actual destination `(99,105)`, CRATE=179, Put=true |
| After, frame 5788 | Rock=3, CRATE still present |
| First snapshot without crate, frame 11004 | Rock=3, Overlay=−1 |
| Later read-only check, frames 36235–36236 | Still Rock with empty Overlay |

The source TMP is `dlat13.sno`, tile 709 / sub-tile 0, Rough. Neighbor `(98,106)` at level 6 matches offset `(−1,+1)` and the four-level threshold. Stock Foot / Track speeds on Rock are zero. Native crate removal `4A1AA0` clears Overlay / powerup and requests redraw but does not restore Rough through land recalculation. The snapshots agree.

The exact disappearance time and cause were not established: there was no corresponding recorded pickup / tool-cleanup event, expiry was not fully hooked and snapshots were not continuous. Do not present it as proven expiry or collection. Repeating within the same already-modified game does not restore the first-trial state.

An earlier inspector bug also affected a particular tank: an incorrect void declaration for CollectCrate failed to preserve the AL return consumed by native movement callers. Fixing the hook restored movement and pickup. Evidence from that instrumentation bug was excluded from map passability conclusions.

### Current risk versus Rough exceptions

The stock map's static scan found 22 geometric Rough transition candidates, but only 13 had a random placement path in the current layout. Nine projection-rejected / zero-probability candidates are not current-risk markers. The 13 coordinates and exact source hash are listed in [real-map regression](../REAL-MAPS.en.md#heck-freezes-over-regression). Only `(99,105)` has the described game snapshot evidence; the other markers are static predictions.

The 3D viewer distinguishes solid pink current risks, hatched pink risks after clearing, and amber dotted Rough exceptions with zero current placement probability. Unclassified / missing probabilities are not silently zero. Blue marks only the height-test relation, not complete passability. Patch geometry and detailed cliff relief are visual reconstructions; the model uses original integer levels.

### Clearing trees and other terrain disturbances

TREE11 at `(100,58)` prevents initial placement. Its underlying level-2 Rough cell has a level-6 neighbor `(101,57)`. Native tree removal reaches `71C930`, removes the base object at `71CA10`, then recalculates at `71CA2A`. Without Overlay, Rough stays Rough; a later crate can enter the Overlay branch and make Rock. Merely playing a fallen-tree animation does not establish that occupancy was removed.

An in-memory map copy removing only that TREE11 was fully reparsed and all 39,601 origins enumerated. The cell gains probability about `0.010687711345%`; current markers rise from 13 to 14. At radius zero both duplicate candidates are itself. This is a static comparison, not a new in-game tree-destruction experiment, and the probability does not apply to an arbitrary later battlefield.

The potential-risk layer instead tests one explicit layout with all removable buildings, minerals, Terrain objects and units completely cleared without rubble, leaving terrain / heights / other overlays. It checks existence of placement paths, not precise probabilities or every partial-clearing combination. The original map retains its probabilities, 13 solid markers and one additional hatched marker.

| Disturbance | Land-recalculation implication |
| --- | --- |
| Successful crate Overlay | `5FD200 → 47D2B0`; Overlay branch can make Rock |
| Complete tree removal | `71CA2A → 47D2B0`; bare Rough remains Rough |
| Crater / scorch Smudge | `6B4BE0 → 6B6080` writes Smudge at `+0x48`, data at `+0x11F`; no Overlay / Land write or this recalculation |
| Building rubble Overlay | `44203A → 47D2B0`; can enter the same height branch |
| New ore Overlay | `48728C → 5FC380`; successful creation requires its own growth / slope / rule checks |
| More ore on existing Overlay | Quantity / redraw update is not necessarily Overlay recreation |
| Ore exhausted / removed | `480BDC → 47D2B0`; bare Rough can remain / become Rough again |
| Simple redraw or ordinary crate removal | Does not by itself imply land restoration |

An explosion may separately destroy a tree, wall or building; that is not an effect of its scorch graphic. Radiation, Mod pollution and custom logic were not covered. Ask separately whether recalculation occurs, which land source it uses and whether the height test matches. Automatically guessed decompiler names such as CreateCrater are not evidence of terrain deformation.

## 8. Complete call flow

```text
Require a free crate-manager slot
For up to 1,000 attempts, sharing the current logical frame:
    draw X and Y
    read actual origin land or the stock invalid-cell sentinel
    choose Float for Water, otherwise Track
    run bounded nearby search with native order / projection groups
    if no valid result: retry with a fresh origin
    if final usable-bound / empty-Overlay test fails: retry
    attempt Overlay creation and crate bookkeeping
    if Put returns success: end this call
    otherwise: retry
Return failure after exhaustion
```

“Put returns success” and “a crate entity exists” are separate observations on the identified constructor / slope paths. This explanatory pseudocode is not recovered Westwood source code.

## 9. Why the distribution is uneven; historical Phobos comparison

Many origins can map to one destination. Outside origins can concentrate near edges; obstacles, water, existing overlays, height, frame and retry limits all affect the result. No universal “edge multiplier” applies to every map.

The Phobos develop source inspected on **2026-10-12** replaced YR sampling at `56BD8B` in [Hooks.Crates.cpp](https://github.com/Phobos-developers/Phobos/blob/develop/src/Misc/Hooks.Crates.cpp). It sampled a projected usable rectangle, converted to Cell coordinates, rejected absent / unusable initial cells before nearby search, optionally rejected initial water, and skipped rounds with no result. It returned to native placement at `56BE7B` or retry counting at `56BE91`.

```text
XP ∈ [2L−W, 2L−W+2VW]
YP ∈ [2T+W, 2T+W+2VH+2]
x = trunc((XP+YP)/2)
y = trunc((YP−XP)/2)
```

Bounds are inclusive; truncation follows C++ integer division toward zero. This reduces the outside-origin edge effect, as described in the project's [fix notes](https://github.com/Phobos-developers/Phobos/blob/develop/docs/Fixed-or-Improved-Logics.md). Nearby search and final Overlay checks still prevent a claim of uniformly distributed final empty cells. This is a dated source comparison, not verification of any locally installed DLL or current upstream revision. A DLL's presence in a directory does not prove it was loaded. The tool's directory approximation does not reproduce arbitrary plugin sampling.

## 10. Demonstrations, exact formulas and current implementation

A historical 64×64 flat-land, no-bridge fixture with LocalSize `(3,5,58,52)` and frame 600 enumerated 16,129 origins: 6,095 stayed, 9,834 moved, 200 found no candidate. These figures explain one geometry; they are not measured probabilities for every official map. The recommended teaching sequence is origin domain, outside transfer, tank versus Overlay failure, fog versus bounds, edge concentration, then version differences.

The interactive demo uses real stock terrain / water / object sprites beneath all grid, search, boundary and text annotations. It has 11 examples across land, coast, ocean and a central island. Animation supplies its first / second origins intentionally; it does not replay game RNG or add newly animated crates to the probability layout. Playback time does not advance the mechanism's fixed frame.

At a **fixed** frame with N origins, n(c) successful origins for c, S total successful origins, F=N−S and retry limit L:

```text
P(c) = n(c)/S × (1−(F/N)^L)     S>0; otherwise 0
P(exhaustion) = (F/N)^L
D=N^L
G=(N^L−F^L)/S                  exact integer for S>0
numerator(c)=n(c)×G
```

The early demo displayed raw multiplier `N*P(c)`, with 1/N as the single-draw baseline. That is historical: the current UI uses the no-incoming-transfer final-probability baseline described in [real-map formulas](../REAL-MAPS.en.md#exact-probabilities-and-optimization). Ordinary cells therefore display 1× without dropping retry weights.

`probability-index.js` reuses reference Track / Float masks and Chebyshev distance propagation to find the first nonempty ring. Propagation is not pathfinding and is not stopped by intervening water / obstacles. The ring still uses native order, radius-zero duplicates, cap, frame modulo and final Overlay rejection. Cached candidate segments avoid rescanning geometry for another frame. The reference loop stays in `model.js` for independent comparison. Worst-case geometric work drops from O(N·R²) to initial O(N·R), then O(N) frame mapping, with O(N) space; BigInt cost depends on digit count.

Current demo heatmaps average exact **random frame residues**. Let P be the LCM of candidate counts, enumerate frames 0…P−1 and apply finite retries before averaging:

```text
P(c) = (1/P) × Σ_f [n(c,f)/S(f) × (1−((N−S(f))/N)^L)]
```

Terms with S=0 contribute zero. Land / coast use P=42, ocean / island P=6. Changing the teaching frame affects animation, not this heatmap. Averaging success first, or resampling the frame on each retry, gives a different model. Historical coast tests measured a maximum per-cell difference around 0.0000553 between averaging orders, covered by regressions.

Real maps generalize S to termination count T, including no-entity outcomes, and aggregate shared coefficients / weight periods with CRT for large cycles. Exact entity + no-entity + exhausted mass is conserved. Current browser / video code shares display conversion, integer thresholds, palettes and language. Warm / cool palettes map the whole layout maximum to deepest color; multicolor uses a fixed scale. Filters never reset that scale or renormalize probabilities.

Historical checks included 49,399 origin / frame comparisons, radius 31 versus 32, 24-record truncation, 30 exact distributions, and 16,224 random-frame comparisons. Recorded tiny-demo cold runtimes of fractions of a millisecond (fixed frame) or roughly 1.9–2.6 ms (frame average) were local measurements, not large-map guarantees. Current runnable tests are listed in [architecture](../ARCHITECTURE.en.md).

## 11. Evidence and version boundaries

Early study binaries:

| Binary | SHA-256 |
| --- | --- |
| RA2 game.exe | `73288c03b58d370be268ca6d156b4e33bfdb2066dc980359467d8852ff3b00df` |
| YR gamemd.exe | `3e81a61775d2745d1dabe397325ef663cd994ffc194da4e998e3bf5d2d308600` |

Later bridge tests used the separate RA2 fingerprint recorded in [bridge research](bridge-crates.en.md), with byte comparisons of shared functions. Addresses below are virtual image addresses with base `0x400000`, not file offsets. Other patch versions require fresh fingerprint / instruction checks.

| Evidence | RA2 | YR |
| --- | --- | --- |
| E01 slot, two draws, retry cap | `54E410` | `56BD40` |
| E02 nearby search, ring / cap / modulo | `5502E0` | `56DC20` |
| E03 1×1 movement call / Overlay parameter | `550CF0` | `56E7C0` |
| E04 occupation, wall, land speed | `478760` | `4834A0` |
| E05 placement / Overlay / timer | `4939A0 / 493AD0` | `4A17C0 / 4A18F0` |
| E06 map initialization / bounds | `548BCB / 55A660` | `565C10 / 568300 / 578460 / 578540` |
| E07 bounded scenario RNG | `6388A0` | `65C7E0` |
| E08 initial / pickup / expiry replenishment | `65E9C1 / 477070 / 54E360` | code near `68695C / 481D86 / 56BBE0` |
| E09 full decompilation archive | Machine-code inspection | Local gamemd.exe.c archive |
| E10 Phobos sampling hook | Not applicable | Dated upstream source comparison |
| E11 class / parameter interpretation | Checked against code | YRpp MapClass / CellClass |
| E12 sentinel initialization / constructor | `547930 / 470F10` | `565060 / 47BBF0` |
| E13 Terrain occupation / drill defaults | `6E38F0 / 6E5260` | `71C110 / 71DA80` |
| E14 Mark / constructor / Unlimbo | `5DA970 / 5DA7D0 / 5D3890` | `5FC570 / 5FC380 / 5F4EC0` |
| E15 LocalSize / camera margins | `549AE0 / 6A8C80` | `567230 / 6D8640 / 483C80` |
| E16 height transition / recalculation | `4C8730 / 472540` | `73F0A0 / 4D9C60 / 47D2B0` |

Symbol references include [MapClass](https://github.com/Phobos-developers/YRpp/blob/phobos-dev/MapClass.h), [CellClass](https://github.com/Phobos-developers/YRpp/blob/phobos-dev/CellClass.h), [GeneralDefinitions](https://github.com/Phobos-developers/YRpp/blob/phobos-dev/GeneralDefinitions.h), [TacticalClass](https://github.com/Phobos-developers/YRpp/blob/phobos-dev/TacticalClass.h) and [ObjectClass](https://github.com/Phobos-developers/YRpp/blob/phobos-dev/ObjectClass.h). Local bytes, arguments, vtables, fields and call relationships control the conclusion when guessed names disagree.

The local reconstruction has an empty `CrateClass::FindPlacement()` stub and misnamed decompiled functions (including placement labeled as building-collapse timing / crater creation). These were not treated as original implementation. Older YRpp calls nearby search `Pathfinding_Find`, newer branches `NearByLocation`; neither name proves route finding.

The initial study validated 50 key addresses against binaries and produced offline diagrams without game modification or injected experiments. Later sections explicitly identify the recorded `(99,105)` game observation and the corrected inspector ABI issue. Native Unicorn tests remain isolated-instruction tests, not live matches. Historical disassemblies, snapshots, evidence manifests and research outputs are local evidence and are not all bundled in source / releases. To distinguish local transfer from reroll in a new game experiment, record origin, search return coordinate, Put return and retry count; a final crate screenshot alone cannot establish the path taken.
