# C3c mechanical completeness audit and proposed scope (30 October 2026)

Branch `feature/c3c-mechanical-completion`, from `main` at `5e404ce` (C3b merged). Audit only: nothing has
been rebuilt yet.

**How this was audited.** For every part in the areas below I checked five things:
- whether a Blender model draws it, or a simple browser shape;
- its TypeDB type, assembly and systems;
- how many physical connections it has;
- how many function-level dependencies it takes part in;
- whether the packaging check covers it.

Classification:
- **Complete:** credible geometry, correct placement and meaningful semantics.
- **Partial:** present but simplified in geometry or semantics.
- **TypeDB only:** represented in TypeDB but drawn as a placeholder.
- **Missing:** neither.

## Summary

| Area | Status | Main gaps |
|---|---|---|
| Drive units, halfshafts, hub drive path | **Complete** (C3a; open differential corrected in C3b) | Only the front-right hub is a detailed model |
| Battery, HV distribution, charging, 12 V supply | **Complete** (C3b) | none for C3c |
| Front-right wheel corner | **Complete** geometry (Phase A, Blender), **partial** semantics | Suspension parts have no functions |
| Other three wheel corners (fl, rl, rr) | **TypeDB only** | Simple boxes and cylinders; the rear corners are just copies of the front |
| Front suspension (double wishbone) | **Partial** | Front-right arms, damper and spring are Blender; the left side is placeholder. **No suspension function anywhere:** a broken lower arm affects nothing |
| Rear suspension (multi-link) | **TypeDB only** | Placeholder arms, toe links, dampers and knuckles; no rear-specific geometry |
| Subframes and their body mounts | **TypeDB only / missing** | Subframes are flat boxes. The rubber mounts to the body don't exist; the subframes are "bolted" straight to the rails |
| Anti-roll bars | **Partial** | Tube shapes; no bushes or clamps; no roll-control function |
| Steering | **Partial** | Rack, column and EPS motor are simple shapes (the front-right tie rod is Blender). No intermediate shaft or universal joints. **The column does not depend on the steering wheel.** The power-steering loop has **no sensor** (no torque sensor) |
| Brakes, wheel end | **Complete** front-right, **TypeDB only** at the other three corners | Discs, callipers, pads, hoses exist with good hydraulic semantics (booster and pedal fallbacks, ESC fails open). No rear electric parking brake |
| Brakes, hydraulic supply | **Partial / missing** | Master cylinder and booster are simple shapes. **No rigid brake lines** from the ESC module to the corners (the hoses connect to the ESC directly). **No fluid reservoir** |
| Thermal management | **Partial** | Radiator, fans, pump, chiller, compressor and HVAC are simple shapes. `coolant-lines` is a single tube: it stands in for every hose, yet is drawn only from the radiator to the pack. **No coolant reaches the drive units in 3D,** though in TypeDB both inverters and oil coolers depend on it. **Nothing depends on the radiator.** Missing: reservoir, thermal-mode valve, coolant heater, condenser, refrigerant lines |
| Mounts, joints, attachment points | **Partial** | Drive-unit mounts and pack-to-sill tabs exist. Subframe mounts, damper top-mount bolts to the body, and rack mounts are not separate parts. Arm bushings are only drawn on the front-right Blender arms |
| Driveline to wheel hub | **Complete** semantically | Hub, bearing and nut are Blender at front-right only |
| Body structure | Deferred to the body milestone | Sills through the wheel arches (B1), arch liners without connections, floating roof sensors |

**Counts behind it.**
- 382 components, 150 of them drawn by Blender: 25 at the front-right corner, 72 in the drive units, 53 in the
  pack and power electronics.
- Of the 121 chassis and thermal parts (wheel corners, suspension, steering, brake control, thermal), 96 are
  still placeholder shapes.
- None of the 30 suspension parts takes part in any dependency.

## What is already good enough (do not rebuild)

- **Front-right corner model** (`blender/corner.py`): tyre, wheel, nuts, disc, calliper, pads, shield, hose,
  hub, bearing, nut, knuckle, wheel-speed sensor, both wishbones, forked damper, spring, top mount, drop link,
  tie rod. It is reused for the front-left by mirroring, not rebuilt.
- **Drive units and battery:** keep as they are.
- **Brake hydraulic semantics:** keep the booster and pedal fallbacks and the ESC failing open; only insert the
  missing parts into the chain.
- **The open-differential rule** stays exactly as it is.

## Proposed C3c scope (in order; each step is its own tested, pushed commit set)

1. **Wheel corners, all four, in Blender.**
   - Mirror the front-right corner for the front-left.
   - Build a **rear corner** for both rear wheels: a multi-link knuckle with toe-link arm, a smaller disc and
     calliper, and a new **electric parking-brake actuator** on each rear calliper (`epb-actuator-rl`, `-rr`).
   - All existing ids are kept; the placeholders go.
2. **Suspension in Blender and in TypeDB.**
   - **Models:** left front arms by mirroring. Rear lower arm, upper arm, toe link, damper, spring and top
     mount. Cast **front and rear subframes** with their bushing points. Anti-roll bars with bushes and clamps.
   - **New parts:** four subframe-to-body mounts per subframe (`front-subframe-mount-1..4`,
     `rear-subframe-mount-1..4`).
   - **New functions** (expected outcomes written first):
     - *wheel location* (knuckle, from the arms, tie rod or toe link);
     - *load support* (spring and top mount);
     - *damping* (damper);
     - *roll control* (anti-roll bar and drop links);
     - *subframe location* (mounts).
   - **Consequence chains:** a broken arm loses that wheel's location, then its road holding, which loses
     steering and braking at that wheel. A broken damper only degrades. A broken drop link only loses roll
     control.
3. **Steering.**
   - Blender rack with a belt-driven EPS motor, rack mounts and gaiters, a column with an **intermediate shaft
     and two universal joints**, and a **steering torque sensor**.
   - The steering chain becomes wheel, column, intermediate shaft, rack, tie rods.
   - The power-steering loop gets its sensor.
4. **Braking supply.**
   - Blender master cylinder with its **reservoir**, an electric booster and a pedal box.
   - **Rigid brake lines** from the ESC module to each corner's hose (`brake-line-fl..rr`).
   - The parking brake becomes a real function, with the rear park lock and the electric parking brake as each
     other's **fallback**: a fallback between two systems, exactly what the model distinguishes.
5. **Thermal circuits.**
   - Blender cooling module (radiator, fan shroud, fans), pump, **reservoir**, **thermal-mode valve** and
     **coolant heater**.
   - `coolant-lines` keeps its id and becomes the front circuit to the pack. New **drive-unit coolant lines**
     (front and rear) reach the inverters, oil coolers and motor jackets at their actual ports.
   - Heat pump: **condenser** and **refrigerant lines**.
   - The radiator's *heat rejection* finally matters: losing it degrades coolant temperature control, which
     degrades the drive units and the pack. Losing the reservoir or the valve has defined outcomes.
6. **Validation.**
   - **Packaging check:** extended to every new model.
   - **New interface check, driven by TypeDB:** for every fluid and power connection between two modelled
     parts, the parts must actually touch (within a few mm). Then "fluid and electrical connections terminate at
     appropriate interfaces" is tested against the semantic model itself.
   - **Steering and suspension clearance check:** front wheels swept to full lock (about ±35°) and both axles
     to bump and rebound (about +80 / -80 mm), tyre and wheel against arms, rack, subframe and drive shafts.
   - The B1 sill clashes stay on the backlog; nothing new is excluded silently.
7. **Failure-query performance.**
   - Hoist the shared-cause fallback check out of the recursion. Measured at C3b: it is half of the 36 ms fixed
     cost per call.
   - Re-measure the single-failure question and the impact panel; keep the oracle test.
8. **Body interfaces for the next milestone** (`docs/c3c/body-interfaces.md`). Documentation only, with no
   exterior changes:
   - wheelbase, track, wheel envelopes at lock and travel;
   - every suspension and subframe mounting point (coordinates from the models);
   - battery-pack outline and sill interface;
   - drive-unit and cooling-module clearance envelopes;
   - steering column and pedal-box bulkhead points;
   - brake-line routes;
   - sensor mounting requirements;
   - and the deficiencies you listed.
9. **Review package:**
   - front, rear, underside and exploded renders;
   - counts, queries, validation results, tests, sizes, load and frame times, assumptions;
   - commit hashes.

**Estimate.**
- About 40 new components:
  - 2 parking-brake actuators
  - 8 subframe mounts
  - steering intermediate shaft, torque sensor, 2 rack mounts
  - reservoir, 4 brake lines, pedal box if separated
  - coolant reservoir, valve, heater, 2 drive-unit coolant lines, condenser, refrigerant lines
  - anti-roll-bar clamps if separated
- Most of the 96 placeholder chassis and thermal parts get real geometry.

**Intentionally deferred** (body milestone or later): the exterior, body-in-white, sills and arch liners, roof
sensor mounts, interior and seats, cabin HVAC ducts, detailed low-voltage harness routing, tyre-pressure
sensors.

## Decisions for you before implementation

- **Scope.** Is the order above right? Steps 1, 2 and 6 (corners, suspension, validation) carry most of the
  credibility gain. Steps 4 and 5 add the most new semantics.
- **Wheel travel and lock targets** for the clearance check. I propose ±35° lock, +80 mm bump, -80 mm rebound
  (typical for this class; concept values).
- **Parking.** Should the park lock and the electric parking brake be modelled as mutual fallbacks? Real cars
  use both, and the model would show a fallback across systems.
