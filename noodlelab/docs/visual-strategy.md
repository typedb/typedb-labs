# Visual strategy: asset assessment, benchmark and plan (29 October 2026)

Status: **recommendation for review.** Nothing purchased, nothing migrated, milestone 2.2 uncommitted.

## 1. The question

Can our procedurally generated vehicle reach the quality of a premium automotive / engineering
visualisation, or should we move to professional 3D assets? The vehicle needs high-quality exterior
geometry, detailed internal mechanical assemblies, individually separable parts, licensing that allows
public commercial web use, glTF/GLB delivery to Three.js, good browser performance, and stable ids that
map to TypeDB entities.

## 2. What exists (research summary)

| Source | Exterior | Internals | Separable parts | Licence for a public web app (glTF in the browser) | Cost |
|---|---|---|---|---|---|
| Branded car models (TurboSquid, RenderHub, CGTrader) | Excellent | Rarely | Doors/wheels only | **No**: almost all "editorial use only" for real brands | $75 to $400 |
| TurboSquid / CGTrader generic chassis models | n/a | Chassis, engine, suspension (often combustion) | Partly | **Doubtful**: TurboSquid's licence reportedly requires models to be protected from extraction and prohibits open formats in WebGL (Unity/Unreal WebGL builds excepted). glTF is an open format. Needs written confirmation | $99 to $200 |
| DOSCH "Luxury SUV" (brand-neutral, EV variant, GLB) | Good | Motor, battery, suspension, brakes, electronics | Yes | **No** under the standard licence (bans extractable distribution); special licence needed | €149 + licence fee |
| Fab (Epic) Standard licence assets | Varies | Varies | Varies | Unclear: commercial use in projects allowed; whether a browser-delivered glTF counts as redistribution is not stated. Full EULA must be checked per asset | Varies |
| Sketchfab CC-BY | Mostly branded exteriors (trademark issue) | Almost none; no coherent EV internals found | Rarely | Yes (attribution required) | Free |
| Engineering CAD (GrabCAD, manufacturer libraries) | n/a | Accurate individual parts (bearings, connectors) | Yes | **No** by default: GrabCAD models are for private use; commercial use needs each designer's permission. CAD (STEP) also needs heavy conversion | Free |
| AI 3D generation (Tripo, Meshy) | Fair | Fused, not separable | No | Varies | Low |
| Commissioned original model (work for hire) | As good as we pay for | As specified | As specified, named to our ids | **Yes**: we own it | Quote needed (estimate below) |

**Key finding.** The obstacle is not mainly finding a beautiful model; it is licensing. Our app sends 3D
files to the visitor's browser, where they can be saved. Standard marketplace licences (TurboSquid,
DOSCH, most others) forbid exactly that, and branded vehicles are editorial-only. The only routes with
clean rights are: our own geometry, assets we commission and own, CC-BY/CC0 assets, or a negotiated
web licence.

**Second finding.** No affordable off-the-shelf asset combines a premium exterior with a detailed,
separable EV drivetrain, battery and electronics in a consistent style. Even with an unlimited
licence we would be assembling parts from different sources, in different styles and scales.

## 3. Benchmark: where the current build falls short

Compared with professional engineering visualisations (exploded EV platform renders in manufacturer
launches, KeyShot/V-Ray product exploded views, and the Arboghast sequence):

| Dimension | Professional work | Ours today | Root cause |
|---|---|---|---|
| Geometry fidelity | Every edge chamfered or filleted, so it catches a highlight; curvature continuous | Hard-edged primitives; edges vanish in the dark | Built from Three.js primitives at runtime: no bevels, fillets, booleans or weighted normals |
| Mechanical detail | Ribs, bosses, bolt patterns, casting draft, connectors, cooling fins, cable routing | Smooth boxes and cylinders; few fasteners | Same, plus the part vocabulary is small |
| Materials | Brushed (anisotropic) aluminium, cast texture, machined faces, rubber with tread and lettering, carbon/weave, PCB detail | One flat colour per material; no textures, no normal maps | No texture pipeline |
| Lighting | HDRI studio, soft shadows, ambient occlusion in crevices, rim light | Synthetic softboxes and rim lights; no occlusion or contact shading | No AO, no shadows between parts |
| Separation | Each assembly opens along its own logical axis; spacing depends on part size | Mostly a uniform outward scaling | The expansion field dominates |
| Composition | A designed sculpture: skin frames the image, mechanisms at the centre, deliberate negative space | Even distribution; panels compete with mechanisms | No composition layer |
| Density | Many hundreds to thousands of visible parts (cells, fasteners, connectors, clips) | 318 parts, about 200k triangles | Low part vocabulary; no instancing |
| Realism of the whole | Reads as a photographed object | Reads as a real-time prototype | All of the above |

The current build is a sound functional base: stable ids, hierarchy, deterministic motion, selection.
The ceiling we are hitting comes from how the geometry is made, not from the architecture.

## 4. Options

**A. Keep runtime procedural geometry and add more of it.** Cheapest, but the ceiling is real: primitives
assembled in the browser cannot produce fillets, chamfers, weighted normals or baked texture detail.
More parts would add density but not quality. *Not recommended.*

**B. Buy a professional full-vehicle asset.** Best exterior immediately, but no asset meets the licence
requirement for open web delivery, and none has a credible separable EV interior. The DOSCH model is the
only near fit and needs a special licence of unknown cost. *Not recommended as the primary route;
worth one enquiry.*

**C. Commission a complete original vehicle.** Best quality and full ownership. But a fully detailed
mechanical interior (hundreds of parts) is a large, slow commission, and iterating through a third party
is expensive. *Recommended for the exterior only (see D).*

**D. Hybrid (recommended).**
1. **Mechanical systems: move our procedural generation into Blender.** Write the parts as Python
   scripts that run Blender headless (the official `bpy` package). They gain real bevels and fillets,
   booleans (vents, bolt holes, pockets), arrays (fins, cells, fasteners), weighted normals, UV
   unwrapping and baked ambient-occlusion and normal maps, then export compressed GLB. Mechanical parts
   (wheels, discs, callipers, bearings, gears, motors, housings, modules, connectors) are rotational,
   extruded and patterned shapes, which is exactly what procedural CAD-style modelling does well.
   Everything stays ours: no licence risk, ids generated with the geometry, fully repeatable.
2. **Exterior body, glass and interior trim: commission an original premium EV SUV** from a
   professional automotive modeller as work for hire, with full rights. Organic surfaces are where
   procedural generation is genuinely weak and a skilled artist adds the most. It would be delivered as
   a layered Blender/glTF file with panels, inner panels, seals and trim named to our manifest ids.
3. **Textures from CC0 libraries** (for example Poly Haven / ambientCG): brushed metal, cast aluminium,
   rubber, fabric, and an HDRI studio environment, all free for commercial use.
4. **Optional parallel enquiry:** ask DOSCH for a web licence quote, as a benchmark and fallback.

### Commission estimate (to be confirmed by quotes)
An original, high-quality unbranded SUV exterior with closures, glass, lights, inner panels and a
modest interior: roughly **US$8,000 to $25,000** and **6 to 10 weeks** from an experienced freelance
automotive modeller, more from a studio. This is my estimate from general market knowledge, not a
verified quote (public data is sparse). Recommend requesting three quotes with a written brief.

## 5. Architecture: preserving the TypeDB integration

- **The component manifest stays the single source of truth.** Each part gains a `source`: procedural
  (built in the browser, as now), `blender` (generated GLB node) or `commissioned` (artist GLB node).
- **A mapping file links asset node names to stable component ids**, so TypeDB never depends on mesh
  naming. Tests fail if any manifest id has no geometry, or any geometry node has no id.
- **Explosion, selection and highlighting work on component ids only**, so changing a part's geometry
  source changes nothing else. Animation logic never contains semantic relationships.
- **Repeated parts** (cells, fasteners, connectors) are drawn with instancing for performance, while each
  instance keeps its own id where it is semantically meaningful (for example individual battery modules).
  Purely visual repeats (the cells inside a module) stay part of their parent component.

## 6. Rendering and performance plan

- HDRI studio environment plus the existing camera-following rim lights; ambient occlusion
  (N8AO / SSAO) and soft contact shading; Neutral or AgX tone mapping.
- Multisampled antialiasing in the post-processing chain (or SMAA), device pixel ratio up to 2 on
  capable machines.
- Physically based materials with textures: anisotropic brushed aluminium, clearcoat paint with a flake
  normal map, cast metal roughness variation, tyre tread and sidewall normal maps, PCB textures.
- Geometry: bevelled edges and weighted normals baked in Blender; Meshopt/Draco compression; KTX2 textures.
- Budget (initial targets): about 1.5 million triangles exploded, under 600 draw calls, under 25 MB
  compressed download, 60 fps on an M1 MacBook Air, 30 fps or better on a recent phone. Today: about
  200k triangles, 318 draw calls, under 1 ms GPU time per frame on an M2 Pro.

## 7. Explosion and composition plan

- **Composed layout instead of uniform scaling.** Each assembly gets a designed destination ("station") in
  a three-dimensional composition: exterior panels on an outer envelope that frames the scene; the
  powertrain, battery and wheel ends forming the centre; electronics and thermal systems in clusters
  near their origin. A small amount of field expansion remains, only to keep spatial meaning.
- **Geometry-aware local explosion.** Parts separate along their own axes (a motor along its shaft, a
  wheel end along the axle, door layers across the door), spaced by their actual sizes, not fixed offsets.
- **Collision-free by construction.** A deterministic relaxation step, computed once at build time,
  pushes apart any parts whose bounding boxes overlap at full explosion. The result is fixed data, so
  motion remains deterministic and testable.
- **Three stages** on one slider, as you specified (0 to 35%, 35 to 70%, 70 to 100%), tuned by eye.
- **Ambient drift** as a separate, optional layer: very slow, bounded, varying by assembly; off for
  reduced motion, during selection or inspection, and in tests.
- **Camera:** keep the auto-fit; add a default "hero" angle at full explosion, a very slow idle orbit
  that stops on any interaction, and a focus mode that frames one assembly while the rest dims but
  stays visible (the basis for semantic perspectives in 2.3).

## 8. Recommended sequence

1. **Approve the strategy** (this document).
2. **Visual quality prototype (about 1 week):** rebuild one front corner (wheel, tyre, brake disc,
   calliper, pads, hub, bearing, knuckle, arms, spring, damper, fasteners) through the Blender pipeline
   with textures, AO and the HDRI studio. Deliver assembled, exploded and close-up renders side by side
   with today's corner. This answers whether procedural-in-Blender reaches the bar for mechanical parts.
3. **In parallel:** send a written brief to three automotive modellers for exterior quotes, and one
   licence enquiry to DOSCH. No commitments.
4. **Composition prototype (about 1 week):** the composed layout, stages and drift, using existing parts.
5. **Decision point:** you review 2 and 4 and the quotes.
6. **Full implementation:** apply the pipeline to all mechanical systems, integrate the exterior when
   delivered, then the visual review set (10 screenshots including close-ups) and a performance report.

## 9. Decisions needed

- Approve the hybrid strategy (D), or choose another option.
- Allow installing Blender's Python package (`bpy`, about 350 MB) in a project-local environment managed
  by uv on this Mac. It is official, free and open source. (It cannot run in our Docker setup because
  Blender publishes no Linux ARM build of this package.)
- Approve sending a modelling brief to freelancers for quotes, and a licence enquiry to DOSCH
  (outward-facing: these go out under TypeDB's name).

## Sources
- TurboSquid licence: https://www.turbosquid.com/licensing (WebGL/open-format clause as quoted in
  https://godotforums.org/d/35949-using-non-redistributable-3d-models; to be confirmed with TurboSquid)
- Fab licences: https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab
- DOSCH licence: https://doschdesign.com/information.php?p=2 ; product:
  https://doschdesign.com/produkte/3d/car-details-luxury-suv.html?lid=2
- GrabCAD usage: https://help.grabcad.com/article/246-how-can-models-be-used-and-shared
- Sketchfab search API (downloadable models and licences): https://api.sketchfab.com/v3/search
- NoneCG chassis model: https://www.nonecg.com/3D-products/car-chassis-and-engine-3d-model/
- Blender Python package: https://pypi.org/project/bpy/
