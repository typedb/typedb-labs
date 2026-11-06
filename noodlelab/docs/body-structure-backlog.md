# Body-structure backlog

Known geometry problems in the body structure, kept visible until fixed. The packaging check
(`web/src/scene/packaging.test.ts`) reports each one on every run and fails if one disappears without this
list being updated, or if a new one appears.

| # | Problem | Seen as | Cause | Fix (proposed) | Recorded |
|---|---|---|---|---|---|
| B1 | **Sills run into the wheel arches** | Rear drive shafts and, since C3c checks all four corners, every corner's tyre, wheel, disc, calliper, shield, knuckle, hub and tie rod or toe link (36 pairs) pass through `sill-l` / `sill-r` | The sills are simple Phase A boxes from x -1.52 to 1.48 m; since the wheelbase change (axles at 1.58 and -1.45 m) both ends reach into the arches | Shorten the sills to end clear of the tyres (about x -1.02 to 1.15 m) with closing plates, or rebuild them with the body-structure work | C3a, 30 Oct 2026 |
| B2 | **Chassis rails run through the suspension** | `front-rail-*` and `rear-rail-*` (simple boxes at y 0.51-0.61 m, 0.46-0.59 m from the centre line) pass through the upper arms, springs, dampers and rear drop links (14 pairs); since C3c step 2b also the front tie rods (2 pairs), whose rack sits at 0.505 m to keep the tie rods clear of the drive shafts at full lock and rebound. The rebuilt rails must pass above or inboard of the tie rods' swept volume (docs/c3c/suspension-architecture.md) | The rails were placed before the suspension had real geometry; real rails rise over the suspension towers, and the dampers' top mounts sit in towers beside them | Rebuild the rails with the suspension towers in the body-in-white | C3c, 30 Oct 2026 |
| B3 | **Cabin floor reaches into the rear wheel arches and over the rear suspension** | `cabin-floor` (flat at 0.38-0.40 m, to x -1.30 m, 0.71 m wide either side) meets the rear tyres, wheels, knuckles and toe links (8 pairs), and since C3c step 2 the rear subframe's toe-link brackets and the rear drop links (3 more); since C3c step 4 the rear brake lines where they rise into the rear wheelhouses | The floor was not cut back when the rear wheels became real models | Floor kicks up over the rear subframe at the rear seat crossmember, with wheel-arch inner panels | C3c, 30 Oct 2026 |
| B4 | **Rear doors reach into the rear tyres** | `door-structure-r*` and `door-trim-r*` meet `tyre-rl` / `tyre-rr` (4 pairs); in motion also `door-seal-r*` | The rear door's lower rear corner overlaps the wheel arch | Door shut line and arch shape in the exterior reconstruction | C3c, 30 Oct 2026 |

The drive-shaft clashes are the ones the packaging check can see (it checks drive-unit and battery parts
against their neighbours); the sill-tyre overlaps are recorded here from the bounding-box survey.
| B5 | **Front wheel arches too tight for steering and travel** | In motion only: at full lock and bump the front tyres reach `arch-liner-fl` / `-fr` (18 pose records in the C3c travel check); since C3c step 2b the top of the goose-neck knuckle (upper ball joint above the tyre, about 0.85 m high) reaches the liners' crown statically too; since C3c step 4 the rear brake lines, rising ahead of the rear wheels, graze the rear liners' front edge (x about -1.0 m) | The arch liners were sized for a static wheel | Size the arches from the wheel envelopes in docs/c3c/body-interfaces.md | C3c step 2 |
| B6 | **Rear seat sits over the rear suspension** | The rear upper arms' body pivots (x about -1.22 m, 0.62 m high, 0.47 m out) are inside `seat-rear` and `seat-back-rear` (4 static pairs, more in motion) | The simple rear seat was placed before the rear suspension had geometry | Move the rear seat forward of the rear suspension towers, or raise it on a heel kick-up. **Status (C3c step 2b):** no longer occurs. The rear upper arm now sits inside the wheel (pivots 0.57 m high), and the motion check finds no seat pair under 10 mm (closest: rear tyre to `seat-back-rear`, 13.9 mm at full bump). Kept here so the rebuilt seat keeps that margin. Since C3c step 4 the rear brake lines, which rise in the rear wheelhouses inboard of the tyres, pass through the seat cushion's and back's outer edges (the seat reaches into the wheelhouse) | C3c step 2 |
| B7 | **Placeholder doors and rear arch liners overlap the new structure** | The simple door layers (`door-structure-*`, `door-trim-r*`, `door-latch-r*`) cross the new sills, B- and C-pillars and rear wheelhouses, and the rear arch liners cross the wheelhouses and C-pillars (22 static pairs) | The doors and liners were sized for the milestone 2.1 body; the D1.2 structure follows the provisional D1.1 exterior | Rebuild the doors (closures) and arch liners against the new structure in D1.3, with B4 and B5 | D1.2 |

## Status after D1.2 (body structure, 1 November 2026)

- **Resolved:**
  - **B1:** the sills now run from x −1.00 to 1.06, clear of both wheels' sweep.
  - **B2:** the front rails stop at the towers, ahead of the rack and tie rods. The rear rails rise over the rear
    suspension.
  - **B3:** the floor kicks up over the rear subframe, and the wheelhouses stand inboard of the rear tyres.
  - **B6:** the rear seat has moved forward to x −0.80 and narrowed to 1.18 m.
  - These groups are gone from both the static packaging check and the motion check. The motion check now covers
    the whole new structure.
- **Open, for D1.3:**
  - **B4:** the rear doors reach the tyres.
  - **B5:** the arch liners are too tight.
  - **B7:** the placeholder doors and liners overlap the new structure.

## Status after D1.3 (exterior, 1 November 2026)

**Resolved:**
- **B4:** the rear doors end ahead of the rear wheel openings.
- **B5:**
  - The front arch liners follow the front tyres' swept envelope plus 25 mm, with a raised inner crown over the
    goose-neck knuckle.
  - The rear liners sit inside the structure's wheelhouses.
- **B7:** the doors, their inner layers and the liners are rebuilt from the new exterior's own surface
  (`blender/exterior_panels.py`).

The static packaging check and the motion check now have no known groups. Every body part is checked in full.

## Status after D1.4 (1 November 2026)

- The body's lower edge now covers the pack's protection plate (sills and bumpers at about 0.18 m).
- The structure's faces inside the wheelhouses carry black underbody protection (only those faces; the parts are unchanged).
- The front arch liners continue down to the A pillar's foot (a designed contact in the packaging check).
- Sensors sit on real mounting points: lidar on the front header, antenna through the roof, cameras on the windscreen and
  tailgate, front radar on the bumper beam (docs/d1/d1.4/README.md).
