# Mechanical upgrade plan (milestone 2.2): phased implementation

Status: **for review.** Approved so far: the Blender modelling approach for mechanical systems, and
refining the front-right corner. Not approved: the full rebuild (this plan), exterior commissioning,
purchases, vendor contact. Milestone 2.2 stays uncommitted until the next visual checkpoint is reviewed.

Starting point: 318 parts; the front-right corner (23 parts, 311k triangles, 9.7 MB uncompressed) is
Blender-built; everything else is browser-built.

## 1. Conventions every phase follows

**Asset pipeline**
- One Blender script per assembly in `blender/assemblies/`, sharing a modelling library (`blender/kit.py`)
  and a library of reusable engineering features (fasteners, bearings, connectors, bushes, hoses, clips).
- **Engineering references**: each assembly script starts with a short design note (layout, proportions,
  interfaces, mounting points, assembly order, materials), drawn from public engineering sources and
  general automotive practice. Where the concept is simplified or fictional, the note says so; those
  notes are collected in `docs/engineering-assumptions.md`.
- **Two levels of detail per heavy part**: full detail for close inspection, and a lighter version (about a
  quarter of the triangles) used automatically when the part is small on screen.
- **Fine surface detail as textures where possible**: tyre tread texture, threads, knurling, cooling fins on
  small parts, stator laminations. These are rendered into normal maps in Blender instead of modelled,
  which keeps triangle counts down without losing the look up close.
- **Compression**: Meshopt geometry compression and quantisation (decoder bundled with the app, no
  external download). Textures as compressed images. Each system is its own file, loaded progressively:
  the visible exterior and wheels first, internal systems in the background before the explosion is
  offered.
- **Reuse**: one geometry for repeated parts (nuts, bolts, clips, connectors, battery cells, bearings),
  drawn with instancing. Each instance keeps its own component id where it is meaningful (for example
  wheel nuts); purely internal repeats (cells inside a module) belong to their parent component. Left-hand
  parts are mirrors of right-hand ones where the real parts are mirror images.
- **Explicit visual mapping**: a generated mapping file links asset nodes to component ids
  (decision 0001); tests check both directions.

**Data**
- From Phase A onwards the parts list is split: **visual manifest** (geometry source, position, material,
  level of detail) stays in the web app; **domain seed** (names, types, assembly membership, systems)
  moves to `data/seed/`, which becomes the TypeDB seed in the TypeDB phase. The explosion's grouping is
  generated from the seed at build time as an animation asset. The running app stops reading names and
  memberships from code files once TypeDB is connected.
- New and split ids are recorded in `docs/component-ids.md`.

**Rendering**
- A studio environment map: I recommend **rendering our own in Blender** (softboxes and strip lights to a
  panoramic HDR image). It is fully owned, has no licence question and can be tuned to the dark-studio
  look. Alternative: a CC0 studio map from Poly Haven (free for commercial use; bundled locally).
- Three quality tiers chosen automatically (and overridable): **High** (ambient occlusion, 4x antialiasing,
  pixel ratio 2), **Medium** (half-resolution occlusion, 2x antialiasing, pixel ratio 1.5), **Low** (no
  occlusion, FXAA, pixel ratio 1, lighter detail levels, merged meshes). Desktop visuals are not reduced to
  suit mobile.

**Measurement** (recorded at every checkpoint, by a scripted benchmark in the dev tools)
- Triangles (all, and actually drawn), draw calls, download size per system, time to first frame and to
  explosion-ready, frame time assembled / mid-animation / fully exploded, GPU memory (estimated from
  geometry and texture sizes; browsers do not expose it directly).
- Devices: M2 Pro (Chrome, Safari, Firefox) here; plus at least one lower-powered laptop and one phone.
  **I need access to those** (team devices, or a paid cloud device lab, which would need your approval).

## 2. Phases

Figures are estimates; "parts" means component ids. Triangles are full-detail (LOD0) for the whole phase;
the lighter level is roughly a quarter. Sizes are after compression.

### Phase A: finalise the wheel-corner benchmark
- **Systems**: front-right corner: wheel (new premium design: sculpted spokes with real cross-section,
  deeper face, detailed hub and cap), tyre (tread and sidewall via normal maps, rim-protector rib, finer
  marking), calliper (redesigned silhouette, bridge, bleed and pad-retention hardware, brake hose with
  banjo fitting), suspension refinements (forged-section arms, better joints and bushes, mounts).
  Plus the conventions above: assembly library, LOD, compression, instancing, mapping file, studio
  environment, quality tiers, benchmark script, and the visual manifest / domain seed split.
- **Parts**: 23 → about 27 (new: brake hose, axle nut, calliper retaining hardware as a fastener set, ABS
  cable clip). **Triangles**: 311k → about 180k (detail moves into normal maps). **Size**: about 3 MB
  geometry + 2 MB textures.
- **Performance**: neutral or better than today; first measurements of the tiers.
- **Risks**: baking normal maps headless (Cycles CPU, slower builds); meshopt decoder integration;
  tuning our own environment map.
- **Dependencies**: none.
- **Checkpoint A**: corner before/after (same angles as last time), close-ups of wheel, tyre, calliper,
  suspension; tier comparison; performance table.

### Phase B: drivetrain and battery
- **Systems**: both drive units: ribbed motor housing and end covers, stator with hairpin copper windings
  and laminated core, rotor with magnet pockets, splined shaft, bearings, resolver, split gearbox case,
  helical gear train, differential with spider gears, park lock, oil pump; inverter with power modules,
  capacitor, gate-driver board, busbars, high-voltage connectors and coolant ports; drive shafts with
  constant-velocity joints and boots. Battery: ribbed tray with side-impact rails and crossmembers, lid
  and seals, cooling plate with channels and manifolds, 16 modules with end plates, cells (instanced),
  busbars and sense wiring, module monitoring boards, junction box with contactors, fuses and pre-charge,
  service disconnect, battery management board, high-voltage connectors and routed orange cables with
  clips. Power distribution: 12-volt battery, DC-DC converter, on-board charger, distribution unit with
  fuses, low-voltage harness backbone and connectors.
- **Parts**: +about 150 (drive units about 70, battery about 60, power distribution about 20).
- **Triangles**: about 700k (cells instanced: about 380 cells share one geometry). **Size**: about 8 MB.
- **Performance**: the largest single increase in draw calls; instancing and per-material merging keep it
  under about 900 for the whole vehicle at this point.
- **Risks**: hairpin windings are complex to model credibly; cell instancing with selection (cells are not
  individually selectable, modules are); keeping the battery legible when exploded.
- **Dependencies**: Phase A conventions.
- **Checkpoint B**: wide shots plus close-ups of a motor (assembled and exploded), gearbox, inverter,
  battery (assembled, lid off, exploded), junction box; performance.

### Phase C: chassis and mechanical systems
- **Systems**: front-left corner (mirror), rear corners (multi-link rear suspension with five links,
  parking-brake calliper, rear hub), front and rear subframes with mounts, steering rack with
  power-steering motor, pinion housing and gaiters, anti-roll bars with bushes and clamps, longitudinal
  rails and crash beams as extruded sections, brake control hardware, thermal system (radiator and
  condenser with fins in normal maps, fans and shrouds, pumps, chiller, compressor, valves, hoses with
  clamps).
- **Parts**: +about 90. **Triangles**: about 800k (front-left reuses front-right geometry). **Size**: about 6 MB.
- **Performance**: triangle count is now high enough that level-of-detail switching matters; draw calls
  about 1,200.
- **Risks**: multi-link geometry and clearances; the thermal system getting visually busy.
- **Dependencies**: Phase A corner as the template.
- **Checkpoint C**: all four corners, steering, subframes, thermal; exploded chassis close-ups; performance.

### Phase D: electronics, interior and body structure
- **Systems**: forward camera module (lens stack, housing, bracket), radars (radome, antenna board,
  housing), roof lidar (rotating head, optical window, base), GNSS antenna internals; automated-driving
  computer (cold plate, heat sink, connectors); control units (shared housing design with connectors);
  main harness routing. Interior: seat frames with rails, recliner and motors, foam and trim layers;
  dashboard cross-car beam, ducts, displays; steering column with universal joints and adjustment; HVAC
  box with blower and flaps. Body structure: pillars and roof bows as closed pressed sections,
  floor crossmembers, door internals (inner panel, window regulator, latch, speaker, harness, hinges),
  bonnet and tailgate inner structures with hinges and gas struts.
- **Parts**: +about 150. **Triangles**: about 800k. **Size**: about 7 MB.
- **Performance**: draw calls about 1,500 at full explosion. The Low tier merges static meshes per
  material.
- **Risks**: interior and body parts are large and soft-surfaced, where scripted modelling is weakest;
  if a part does not reach the bar, it is flagged for the exterior decision rather than forced.
- **Dependencies**: Phases A to C for consistent materials and fasteners.
- **Checkpoint D**: sensors and compute close-ups, seat and door internals, body structure exploded;
  performance.

### Phase E: cinematic explosion redesign
- **Work**: a composed layout instead of uniform scaling. Each assembly gets a designed destination
  ("station"): exterior panels on an outer envelope framing the scene, mechanical systems at the centre,
  smaller parts arranged around their parent assemblies. Parts separate along their own physical axes
  (exported from Blender with each part's size and axes). A build-time spacing step removes overlaps at
  full explosion, so positions stay fixed and testable. Three stages on one slider (0 to 35%, 35 to 70%,
  70 to 100%). Optional ambient drift as a separate layer (off for reduced motion, selection and tests).
  Camera: hero angle at full explosion, very slow idle orbit that stops on any input, and a focus mode
  that frames one assembly while the rest dims but stays visible (needed for the perspectives in 2.3).
- **Parts**: no new geometry. **Performance**: everything visible at once, which is the worst case;
  measured explicitly.
- **Risks**: composition is design work and needs a few review rounds; avoiding both a uniform cloud
  and a cramped layout.
- **Dependencies**: Phases B to D (composition needs the final parts).
- **Checkpoint E**: 50%, 75% and 100% from front three-quarter, side and elevated views; animation
  capture; performance during animation.

### Phase F: full visual review and optimisation
- **Work**: tier tuning on the device matrix, loading-order tuning, final screenshot set (assembled and
  exploded wide shots; close-ups of motors, battery, wheel assemblies, suspension, electronics; mobile),
  performance report, test suite and production build.
- **Checkpoint F**: milestone 2.2 acceptance review against the twelve criteria.

## 3. Totals and budget (end of Phase D)

| | Estimate |
|---|---|
| Component ids | about 690 |
| Triangles, full detail, everything | about 3.3 million (only near-camera parts use full detail) |
| Triangles typically drawn at full explosion | about 1.2 to 1.6 million with levels of detail |
| Draw calls, full explosion | about 1,500 (High), under 600 (Low, merged) |
| Download, compressed | about 27 MB in total, loaded progressively (first view needs about 6 MB) |
| Frame budget | 60 fps on capable desktops (M-series, recent discrete GPUs); 30 fps or better on the Low tier |

## 4. Order of work and review

A → (review) → B → (review) → C → (review) → D → (review) → E → (review) → F → milestone 2.2 acceptance.
TypeDB integration (Phase 3) follows visual approval as before. The data split in Phase A means every
new part is added with its domain facts in the seed from the start, ready to load into TypeDB.

## 5. Decisions needed

1. Approve this plan (or adjust the order or scope).
2. Studio environment: our own Blender-rendered map (recommended) or a CC0 map from Poly Haven.
3. Test devices: which lower-powered laptop and phone I can use, or approval to use a paid cloud device lab.
