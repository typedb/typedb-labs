# Quality prototype: front-right wheel corner (29 October 2026)

Status: **for review.** Scope: one corner only (wheel, tyre, brakes, hub, bearing, knuckle, suspension,
steering link). The rest of the vehicle is unchanged. Nothing committed.

## What was built

- **Blender pipeline** (`blender/kit.py`, `blender/corner.py`): parts are written as Python scripts that run
  Blender headless (the official `bpy` package, Blender 5.2.3, isolated in `blender/.venv` via uv).
  Techniques the browser alone cannot do: bevelled edges, boolean cuts (slots, holes, windows, scallops),
  voxel-remeshed "cast" bodies (knuckle, calliper, wishbones), lathe profiles with real cross-sections
  (tyre, rim barrel, threaded damper sleeve, bellows boots), weighted normals for clean flat faces, and
  UVs laid out for surface detail. One command rebuilds the corner in about 8 seconds:
  `uv run --project blender python -I blender/corner.py`
- **23 parts, same stable ids as before** (`tyre-fr`, `caliper-fr`, `wheel-bearing-fr`, ...). Each GLB node is
  named by its component id; a test checks the file against the manifest.
- **In the real app** (`web/src/scene/assets.ts`): the GLB loads at start-up and replaces the browser-built
  parts with the same ids. Explosion, selection and highlighting work unchanged, because they only use ids.
  Clicking any piece of a part (for example the calliper's bolts) selects the whole part.
- **Browser materials** (`web/src/vehicle/studioMaterials.ts`): physically based, matched by name, with
  textures generated in code: concentric machining marks and circular brushing on discs, hubs and the
  diamond-cut wheel face; grain on cast and forged aluminium and on pad friction material.
- **Rendering**: ambient occlusion (soft shading where surfaces meet), 4x multisampled antialiasing,
  filmic tone mapping, pixel ratio up to 2.
- **Comparison switches**: `?corner=procedural` shows the old corner; `?fx=off` turns off the new effects.

## Component detail

| Part | Detail |
|---|---|
| Tyre (275/45 R22) | Shaped sidewall and shoulders, four circumferential grooves, 128 shoulder blocks, 288 sipes, raised size marking (no brand) |
| Wheel (22 x 9.5) | Real barrel profile with bead seats and drop centre, ten split spokes dished to a concave face, diamond-cut face with circular brushing, counterbored stud holes, centre cap, valve |
| Wheel nuts (x5) | Hex body with chamfers, conical seat, domed cap |
| Brake disc (380 x 34 mm) | Two-piece floating disc: ventilated iron ring with 48 angled vanes and slotted faces, anodised aluminium hat with ventilation holes, ten bobbins |
| Calliper | Six-piston monobloc, cast body with piston bulges, machined disc slot and pad inspection window, mounting lugs and bolts, bleed nipples, pad pin |
| Brake pads (x2) | Steel backing plate with ears, friction block with centre slot and chamfers |
| Dust shield | Pressed steel with rolled lip, cut away around the calliper |
| Hub | Scalloped flange, five pressed-in studs, pilot spigot, splined bore |
| Wheel bearing | Flanged outer race with raceway grooves, inner race, two rows of 14 balls, brass cages |
| Knuckle | Cast aluminium upright merged from bearing boss, arms and lugs, with machined bores |
| Wishbones (x2) | Forged arms with web, rubber bushes with sleeves, bolts and nuts, ball joints with pleated boots |
| Damper | Painted monotube, threaded sleeve, notched perch and lock ring, chrome rod, polyurethane bump stop, eye bush |
| Spring, top mount, links | Coil spring with closed ends; top mount with isolator and studs; drop link and track rod with ball joints, adjuster and gaiter |

## Comparison images

Identical camera positions for before and after. Before = original geometry and rendering; after = Blender
corner and new rendering. Images are 2160 x 1350 per side.

1. `compare-1-assembled.jpg`: assembled, outside
2. `compare-2-assembled-inboard.jpg`: assembled, from inside the wheel arch (corner isolated)
3. `compare-3-exploded.jpg`: fully exploded (corner isolated)
4. `compare-4-brake-closeup.jpg`: brake close-up
5. `compare-5-hub-brake-exploded.jpg`: hub, bearing, knuckle and brakes, exploded
6. `compare-6-suspension-exploded.jpg`: suspension, exploded

## Performance (Apple M2 Pro, 2160 x 1350, Chrome-based browser)

| | Before | After |
|---|---|---|
| Triangles, whole vehicle | 259k | 551k (corner alone: 311k) |
| Draw calls | 334 | 362 |
| Frame time, geometry and materials only | 0.6 ms | 0.7 to 0.8 ms |
| Frame time, with ambient occlusion and antialiasing | (not used) | about 7 ms median, 8.5 ms 90th percentile |
| Corner download | (none) | 9.7 MB, uncompressed |
| Load and parse | (none) | 0.6 s locally |

Assessment: the new geometry and materials are almost free; the cost is the screen-space effects
(ambient occlusion at half resolution plus 4x antialiasing), which still leave a wide margin for 60 fps on
this machine. Lower-powered laptops and phones will need a lighter effects setting.

**Scaling to the whole vehicle:** at this density all parts would be several million triangles and roughly
100 MB uncompressed. That needs: mesh compression (Meshopt or Draco, typically 5 to 10 times smaller),
lighter versions of small or hidden parts (the damper thread and calliper here could halve with no visible
change), instancing for repeated parts (nuts, bolts, battery cells) and level of detail. These are
standard and planned.

## Honest assessment

**Where it now reads as professional:** the brake disc, hub, bearing, knuckle, damper, bushes and ball
joints. Close up they show the right construction (floating disc, bearing with cages, cast and machined
surfaces, threaded and plated parts), and the circular brushing and occlusion make them read as real metal.
The exploded stack from tyre to knuckle now reads as an engineering illustration rather than coloured blocks.

**Where it falls short:**
- **Wheel and calliper design** is competent but plain: a design pass (spoke sculpting, calliper silhouette)
  would lift them further.
- **Tyre** lacks sidewall detail (rim protector rib, fine texture).
- **Reflections** come from synthetic studio lights. A high-dynamic-range studio image (free, CC0) would add
  realism to chrome and paint.
- **No surface wear or variation** yet: everything is factory-clean.
- **The rest of the vehicle**, including the body, is unchanged, so wide shots still look like the prototype.

**Conclusion:** the approach clears the main hurdle. Mechanical parts made this way look like engineered
components, not game primitives, and run comfortably in the browser with ids intact. I recommend
scaling it to the other mechanical systems, with the improvements above folded in. The exterior body
decision (commission or not) is separate and still open.
