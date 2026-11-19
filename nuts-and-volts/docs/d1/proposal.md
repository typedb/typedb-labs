# Milestone D1: body, chassis and exterior reconstruction: assessment and proposal (1 November 2026)

**Status: for approval. No modelling has started.**
- **Branch:** `feature/d1-body-exterior`, from `main` at `79eec6c` (C3c merged).
- **Starting point:** `docs/c3c/body-interfaces.md`.

## 1. Visual assessment of the current vehicle

Reference renders: `docs/c3c/final/` (assembled, exploded, mechanical only). The comparison with the approved
concept image and the October exterior trial is `docs/exterior-trial/compare-matching-angles.jpg`.

**What is already right:**
- **Proportions.** Since the wheelbase change, the dimensions match the concept: 4.75 m long, 3.03 m wheelbase,
  0.76 m front overhang, 22-inch wheels at a 1.63 m track.
- **The mechanical vehicle under the skin** is now detailed and complete.
- **The exploded view** reads well for the mechanical assemblies.

**What lets it down.** The body is still the milestone 2.1 one, built in the browser from rings of points:

| Area | Problem |
|---|---|
| **Surfaces** | Faceted, wavy highlights; no crisp edges. The front is a tall rounded block ("fridge nose"); the sides are slab-like with no shoulder or tension; the rear is a plain box. |
| **Front and rear graphics** | No light signature: small headlamp blocks, two red tail blocks, a plain grille band. These are what make a modern EV recognisable, and they are missing entirely. |
| **Glasshouse** | Glass is clear and pale, so the interior and the structural tubes show through like a showroom cutaway. There is no black window graphic, the pillars are body-coloured tubes, and the roof reads as part of the glass. |
| **Wheels and arches** | Arches are round cut-outs with no lip or flare, and large gaps show at the rear. The wheels look small in them. Tyres and arches don't share a stance. |
| **Lower body** | A thin black rocker over an exposed silver battery side and sill; the underbody and subframes are visible from normal viewing angles. |
| **Details** | Small blocky handles and mirrors. The lidar puck and shark fin sit on the roof like add-ons. There is no visible radar or camera integration. |
| **Structure (body-in-white)** | Simple tubes and boxes, many through the mechanical parts. These are body backlog B1–B6, now requirements R1–R10. No towers, no wheelhouses, no load paths a visitor could read. |
| **Exploded view of the body** | Panels fly out as thin same-coloured shells. Structure, closures, glass and trim are not visually distinct. |

**Overall:** the mechanical side now outclasses the exterior. The body is the weakest part of the demonstrator,
and the first thing a visitor sees.

## 2. Intended exterior design

**An original, unbranded premium electric SUV,** guided by the approved concept image
(`docs/reference/concept-target.webp`) for its character, not copied from it. The design elements:

| Element | Intent |
|---|---|
| **Stance** | Wheels pushed to the corners, tight arches with thin satin-black lips, and the body tucked in over the rocker so the wheels read large. Darker wheel finish. |
| **Front** | Low, sharp bonnet leading edge. A **full-width thin light blade** joining slim headlamps. A framed lower intake, with the radar behind a smooth panel. Vertical corner air curtains. No grille opening above the blade, as on an EV. |
| **Side** | A crisp shoulder line running over both wheels, a concave lower door, a bright thin sill trim, flush door handles and slim camera-mirror pods (the side cameras are in them). |
| **Glasshouse** | Coupé-SUV roofline, black A-, B- and C-pillars giving a "floating roof", body-colour roof rails, a beltline kick at the C-pillar, dark tinted glass with a black frit band. |
| **Rear** | A **full-width tail-light bar**, a tailgate spoiler, a body-colour upper and satin-black lower bumper with a diffuser, and the rear camera in the light bar's centre. |
| **Roof** | The lidar in a low, integrated pod at the windscreen header, the GNSS antenna in a shark fin, and the panoramic roof glass inside the roof frame. |
| **Colour and materials** | Graphite metallic paint (clearcoat), gloss black for pillars and glass frit, satin black for cladding, and the existing studio lighting. |

**Kept within:** the C3c body interfaces (wheel envelopes, top mounts, pivots, mounts, routes) and the fixed
dimensions.

## 3. Modelling approach

| Option | Result | Verdict |
|---|---|---|
| A. Improve the browser-built body | Faceting and the ring construction remain | **Rejected**: the construction is the limit |
| **B. Scripted subdivision surface in Blender** (extend `blender/exterior_trial.py`), split into panels | Clean, continuous, credible bodywork; character comes from the graphics (lights, glass, intake, trims), which are engineering shapes that suit code | **Recommended** |
| C. Hand modelling or commissioning | Closest to the concept | Declined earlier; listed for completeness |

**Expectation, stated honestly** (as in the October trial):
- **Likely:** a clean, credible, convincingly premium but somewhat generic SUV, clearly far better than today.
- **Unlikely:** a match for the concept image's subtle surface design, which needs hand sculpting.

The proposal puts the effort where code does well: crisp graphics, panel gaps, glazing and lights.

**How it would be built:**
- **Outer skin:** one control cage, the "rails and landmarks" of the trial, kept in a data file like
  `suspension.json`. Blender smooths it.
- **Panels:** the finished surface is cut into panels along their shut lines, with 3–4 mm gaps. Each panel is
  a node named by its **existing component id**, for example `bonnet`, `door-fl`, `fender-l`, `tailgate`,
  `quarter-l`. Inner panels get thickness, so the exploded view shows real parts, not shells.
- **Body-in-white:** built in Blender from engineering shapes, as the mechanical parts were: hat-section rails,
  towers, sills, pillars, roof rails, cross members, floor with a rear kick-up, wheelhouses, bulkhead with
  openings, crash beams with crash boxes.
- **Glazing, lights and trim:** separate parts with their own materials, and emissive light elements.
- **The browser's body code** (`body.ts` and its panel classifier) retires once the Blender body is in. It stays
  as a fallback only if cheap.

## 4. Structure and load paths in TypeDB

The body becomes something TypeDB can explain, not just a skin.

**New components:**
- front and rear suspension towers (×4);
- wheelhouse inner panels (×4);
- crash boxes (×4);
- subframe mounting brackets on the rails, if they are separate parts;
- a few body parts such as the lidar pod and mirror pods.

Existing ids stay. Placeholders are replaced under the same id.

**New connections close the C3c gaps:**
- top mounts to towers;
- upper-arm pivots to towers and wheelhouses;
- subframe mounts to rail brackets;
- the pack to the sills;
- sensors to their housings.

**Load paths.** If you approve, a small set of *support* dependencies and a named question would show a recognisable
chain, for example from a front wheel: wheel → knuckle → arms → subframe → mounts → rails, and spring → top mount →
tower → rail. That gives an explorable answer to "what carries this wheel's load?". The existing reasoning rules
need no change.

**Process:** as in C3c, expected outcomes are written before the data, the oracle runs over every component, and
counts are reported.

## 5. Requirements R1–R10 and where they are resolved

| Req. | Subject | Phase |
|---|---|---|
| R1 | Sills shortened; pack tabs; brake-line run | D1.2 |
| R2 | Rails over the suspension and tie rods; towers; subframe brackets | D1.2 |
| R3 | Floor kick-up, wheelhouses, rear subframe brackets | D1.2 |
| R4 | Rear door shut line clear of the tyre | D1.3 |
| R5 | Arch liners from the envelopes (+20 mm) | D1.3 |
| R6 | Rear seat clear of the wheelhouses | D1.2 (seat moved) / D1.5 (seat redrawn) |
| R7 | Bulkhead openings (steering shaft, pushrod, refrigerant line) | D1.2 |
| R8 | Bonnet clearance; cooling module behind the crash beam; grille air path | D1.3 / D1.4 |
| R9 | Underbody channel for the coolant pair; ground clearance | D1.2 |
| R10 | Sensor housings with radar-transparent covers | D1.4 |

**Done when:** the static packaging test's body groups B1–B6 are empty and removed, and the motion test stays at
10 mm or more with the new body.

## 6. Implementation phases (each ends with tests, commits, pushes and a review checkpoint)

| Phase | Content | Checkpoint |
|---|---|---|
| **D1.1 Silhouette and design lock** | Control cage at the fixed dimensions. Three views and a three-quarter view, against the concept image and the mechanical vehicle (wheel envelopes, top mounts, cooling module). Window graphic, shut lines and light positions sketched on the surface. | **Approve the silhouette and design** before detail work |
| **D1.2 Body-in-white** | Rails, towers, sills, floor, wheelhouses, pillars, roof frame, bulkhead with openings, crash structure. Resolves R1–R3, R6 (position), R7 and R9. TypeDB: new parts, connections and load paths, with tests. | Structure renders; packaging groups B1–B3 and B6 emptied |
| **D1.3 Exterior surfaces and closures** | Subdivision skin, split into panels by id with gaps and inner panels; doors, bonnet and tailgate as closures; arches with lips; liners from the envelopes. Resolves R4, R5 and R8 (bonnet). | Exterior renders; motion test passes with the new arches |
| **D1.4 Glazing, lights, trim, sensors** | Tinted glass with frit, black pillars, light blade and tail bar (emissive), intake and diffuser, flush handles, mirror pods with cameras, lidar pod, shark fin, radar covers, darker wheel finish. Resolves R10 and R8 (air path). | Detail renders, day and studio looks |
| **D1.5 Presentation and integration** | Exploded view in clear layers (structure / closures / glazing / trim and lights / mechanical), app materials and quality tiers, interior fitted to the new body (seat positions; detail stays simple), performance and download budget, final review. | **Final D1 review** |

**Budgets and guards:**
- **Rendering:** about 0.4 M triangles for the whole body (full detail), with light copies as for the mechanical
  models; draw calls kept near today's.
- **Time:** each phase is time-boxed. At D1.1 I'll say plainly if the silhouette isn't converging rather than
  iterate indefinitely, as in the October trial.

## 7. Risks

- **Design quality is the main risk.** Scripted surfaces converge slowly on character (the October trial). The
  mitigation is to put the character in the graphics, review early at D1.1, and accept "credible and premium"
  rather than "matches the concept image".
- **Ids and features.** The explosion, highlighting, procedural fallbacks and tests depend on the body's ids.
  All are kept; the C3c tests guard the mechanical side.
- **Performance.** Glass and paint are the costly materials, especially with the ghosting found in C3c step 7.
  The budget is checked in every phase.

## 8. Decisions for you

1. **Design direction.** The elements in section 2, guided by the concept image (light blade, floating roof,
   shoulder line, full-width tail bar), unbranded. Is that right?
2. **Modelling approach.** Option B (scripted subdivision skin, engineered body-in-white), with the honest
   expectation above.
3. **Load paths in TypeDB.** Add the support dependencies and a load-path question (section 4)?
4. **Interior.** Fit it to the new body only (seat positions and clearances), leaving its detail for later?
5. **Phases.** The five phases with a silhouette checkpoint after D1.1?
