# Phase B continuation: plan and review checkpoints (proposed 30 October 2026)

Status: **proposed, awaiting the owner's approval.** Follows the owner's decision of 30 October 2026:
exterior Option A (keep the current exterior; trial preserved), then dependency semantics, the semantic
browsing interface and the mechanical systems, in that order.

Every step follows the CLAUDE.md loop (scoped step, checks, conventional commit, push, report hash).
Nothing merges into `main` before the Phase B review.

## Step 1: Dependency semantics (checkpoint C1)

Make failure-impact answers mechanically defensible (see docs/dependency-semantics.md).

**Schema** (a TypeDB migration; the database is rebuilt from the seed):
- `dependency` becomes abstract with three subtypes: `physical-dependency` (support, torque),
  `operational-dependency` (power, cooling, hydraulic) and `control-dependency` (control, data). The
  existing `dependency-kind` stays.
- `loss-effect` on every dependency: `function-lost` or `degraded`.
- `affected-function` on every dependency: what the dependent loses, in plain words ("drive torque",
  "power assistance", "anti-lock braking", "cell cooling").
- Fallbacks as their own relation: `fallback (protected: <a dependency>, backup: <component>)` with a
  description. A dependency with a working fallback is degraded, not lost, when its provider fails. One
  relation playing a role in another is something TypeDB models natively.
- Components the fallbacks need that we don't model yet (the brake pedal and master cylinder for the
  braking fallback) get new stable ids, simple procedural geometry, and entries in `docs/component-ids.md`.

**Reasoning** (functions in `schema/functions.tql`):
- `impact_edges` follows only `function-lost` dependencies that have no surviving fallback.
- New `degraded_by($start)`: components one step beyond the lost set through `degraded` edges or covered
  fallbacks, with the function that degrades. These are end points: degradation does not propagate.
- The API's impact answer becomes three lists: **lost** (with the function and the chain), **degraded**
  (with the function), and **fallback in use** (which backup takes over). The same applies to
  requirements.

**Data:** every one of the 160 dependencies is classified, with its function. Scenario expectations are
written down first, as a table in `docs/dependency-semantics.md`, then turned into tests. For example:

| Failure | Lost | Degraded | Fallback |
|---|---|---|---|
| Wheel-speed sensor | nothing | anti-lock braking, stability control, traction control, perception | (none needed) |
| Brake booster | nothing | brake assistance | pedal and master cylinder |
| 12 V battery | control units, then the main contactors, so all propulsion | | |
| Coolant pump | nothing immediately | battery and inverter cooling (power limited) | |
| Power-steering motor | power assistance | steering (heavier) | steering column |

**Interface:** the impact list groups *Lost / Degraded / Fallback in use*, with the function named. In
3D, lost parts are highlighted, degraded parts get a second, softer colour, and the rest is ghosted.

**Tests:** the scenario table as oracle tests (pytest, against a real TypeDB); the existing six
decision-record tests still pass; a schema test checks every dependency has a family, effect and function.

**C1 review:** the scenario table with TypeDB's actual answers, screenshots of two or three failures, and
the schema changes. Stop for approval.

## Step 2: Semantic browsing interface (checkpoint C2)

Explore TypeDB's model without selecting a part first (docs/interface-backlog.md).

**Layout:** an "Explore" panel on the left, with four tabs; the component panel stays on the right.
- **Systems:** the functional tree with component counts. Choosing a system highlights its members (with
  sub-systems), lists its control loops, and shows components it shares with other systems.
- **Assemblies:** the physical tree. Choosing a node highlights it; an option explodes only that
  assembly.
- **Types:** the type hierarchy (component > sensor > camera...) with instance counts. Choosing a type
  highlights every instance, including subtypes: polymorphism made visible. A schema card shows what the
  type owns and which roles it can play.
- **Questions:** named aggregate and cross-cutting questions, each answered live with its TypeQL, for
  example:
  - pack energy from the modules
  - components per system
  - components serving several systems
  - sensors feeding more than one control loop
  - connection counts by kind
  - what connects the battery to a front wheel (path)
  - single points of failure for propulsion (components whose loss alone stops it, using Step 1)

**TypeQL inspector:** one consistent drawer for every view: the queries that ran, formatted, with timing
and a copy button. Read-only, so inspecting, never editing.

**API:** new named, read-only endpoints (assembly tree, type hierarchy with counts, schema of a type,
instances of a type, the question list and each question), each with its TypeQL, plus tests.

Built in two commits: API and tests first (C2a), then the interface (C2b).

**C2 review:** screenshots and a short walkthrough at desktop size in a normal browser window, plus the
question list with real answers. Stop for approval.

## Step 3: Mechanical systems (checkpoints C3a, C3b, then the Phase B review)

**Decision needed first: which dimensions do the mechanical parts use?** The app currently uses a
2.874 m wheelbase; the provisional target is 3.03 m. The drive units, battery and front packaging depend
on it. Options:
1. **Move the app to the provisional dimensions now** (recommended). The current procedural body follows
   the axle positions for its wheel arches; its outline needs small adjustments (nose 2.34 → 2.275 m from
   the centre). The Phase A corner moves with the axle. One small step with before/after screenshots, so
   all mechanical work is done once, at the target dimensions.
2. Keep 2.874 m and move everything when the exterior is revisited. Less work now, rework later.

**Then, in order:**
- **C3a, drive units (front and rear):** permanent-magnet motor (housing with cooling jacket, laminated
  stator with hairpin windings, rotor with magnet pockets, shaft, bearings, resolver), single-speed
  gearbox (split case, helical input and intermediate gears, open differential with spider gears, park
  lock), silicon-carbide inverter (power modules, DC-link capacitor, gate-driver and control boards,
  busbars, current sensors, HV connector), mounts. Review with assembled and exploded renders.
- **C3b, battery and power distribution:** structural enclosure (extruded side rails, crossmembers,
  underbody protection plate), modules (cell stacks, end plates, busbars), cooling plates and manifold,
  battery management (BMS master and module monitoring boards), HV junction box (contactors, pre-charge,
  fuses, current sensor), PDU, HV harnesses and connectors, DC-DC converter, on-board charger, charge
  port, 12 V battery. The pack layout is decided against the chosen wheelbase.

**For every subsystem:**
- Blender models in the Phase A pipeline (compression, light versions, shared geometry, mapping file).
- Existing ids are kept; new parts get stable ids recorded in `docs/component-ids.md`.
- Each component goes into TypeDB with its type, assembly, systems, connections and dependencies
  (using Step 1's semantics).
- Explosion rules so the assemblies stay readable.
- Tests: mapping file against TypeDB, seed oracles.

**Engineering basis:**
- `docs/engineering-references.md` lists the public sources used: published teardowns and technical
  papers on hairpin-stator motors, SiC traction inverters, 800 V module and pack architecture, and
  battery management.
- A **simplifications and fictional assumptions** log records what was invented or simplified
  (dimensions, cell counts, ratings).
- Part counts are estimates, not targets; meaningful parts only.

**Phase B review package** (as specified earlier): assembled and exploded renders, mechanical close-ups,
schema summary, example TypeQL and results, test results, performance measured in a normal browser
(CPU, GPU and total frame time where the browser exposes them), asset sizes and triangle counts, known
limitations, commit history and branch status. Stop for approval before Phase C.

## Order and gates at a glance

| # | Step | Ends with |
|---|---|---|
| 1 | Dependency semantics: schema, data, functions, API, UI, tests | **C1 review** |
| 2a | Browsing API: trees, types, schema, questions, TypeQL; tests | commit |
| 2b | Explore panel, TypeQL inspector, polish | **C2 review** |
| 3.0 | Dimensions decision applied (if option 1) | commit with before/after |
| 3a | Drive units | **C3a review** |
| 3b | Battery and power distribution | **C3b review** |
| 3c | Phase B review package | **Phase B review** |

Preserved for later: `blender/exterior_trial.py`, `docs/exterior-trial/` (renders and assessment),
`docs/exterior-feasibility.md`, `docs/reference/` (concept image) and `docs/design-targets.md`.
