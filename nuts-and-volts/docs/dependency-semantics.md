# Dependency semantics: review (30 October 2026)

Status: **review for the owner. No schema or data changed.** The recommendations at the end are proposals.

## What a dependency means today

`dependency (dependent: X, provider: Y)` with a `dependency-kind` reads: *X cannot do its job without Y*.
The failure-impact question follows these edges transitively: if Y fails, everything reachable from Y is
reported as "stopping working".

That rule is only sound when three things hold for every edge:

1. **Loss, not degradation.** Losing Y really stops X, rather than making it weaker, slower or less safe.
2. **One function.** X has only the function that Y supports. A tyre that loses drive torque still rolls,
   steers, brakes and carries load, so "the tyre stops working" overstates it.
3. **No redundancy.** X has no other provider that can stand in, and no mechanical fallback.

Our data breaks each of these in places. The result is answers that are mechanically traceable but
misleading as stated.

## Three families of dependency

The seven kinds fall into the three families you named. They behave differently under failure.

| Family | Kinds in our data | What flows | How a loss behaves |
|---|---|---|---|
| **Physical** | `support`, `torque` | Load paths and mechanical power: a pad pressed by a piston, torque through shaft, gears and hub | Mostly a hard loss of *that* mechanical function, but it does not destroy the dependent's other functions (a hub still carries the wheel without drive torque) |
| **Operational** | `power`, `cooling`, `hydraulic` | Energy or a working medium: electricity, coolant, brake fluid pressure | Electrical supply loss is usually a hard stop; cooling loss is usually a **derating** over time; hydraulic loss depends on fallback paths |
| **Control system** | `control`, `data` | Commands and sensor information | Usually **degradation**: control units are designed to fall back to safe modes, and most sensors have substitutes or are only needed by one sub-function |

## The 14-step chain from the 12 V battery to the rear tyres

```
lv-battery -power-> lv-harness -power-> vcu -control-> rear-gate-driver -control-> rear-power-module
  -power-> rear-stator -torque-> rear-rotor -torque-> rear-rotor-shaft -torque-> rear-pinion
  -torque-> rear-reduction-gear -torque-> rear-differential -torque-> rear-halfshaft-l
  -torque-> hub-rl -torque-> wheel-rl -torque-> tyre-rl
```

| Steps | Verdict | Reasoning |
|---|---|---|
| 1-2: 12 V battery → harness → VCU (power) | **Sound** | The vehicle control unit runs on 12 V. Real EVs keep 12 V alive from the DC-DC converter while the high-voltage system is up, but a failed 12 V battery at start-up, or a 12 V short, does take the control units down. This is the classic "12 V failure immobilises an EV" case. |
| 3-4: VCU → gate driver → power module (control) | **Sound, with a caveat** | With no torque request the inverter produces no torque. Missing in our data: the gate driver also needs its own 12 V supply, which is a second, independent route to the same conclusion. |
| 5-6: power module → stator → rotor | **Sound** | No phase current, no rotating field, no rotor torque. |
| 7-12: rotor → shaft → pinion → gear → differential → drive shaft | **Sound** | This is the drive torque path, a series chain with no alternative. |
| 13-15: drive shaft → hub → wheel → tyre | **Defensible only as "no drive torque reaches the tyre"** | The hub, wheel and tyre all have other functions (bearing the load, braking, steering, grip) that do not depend on drive torque. As written, "the rear-left tyre stops working" is false. |

**Conclusion:** the chain is a correct trace of *how drive torque would be lost*, and the end-to-end
statement "a 12 V failure leaves the vehicle unable to drive" is defensible. Saying that each part on the
chain "stops working" is not. The fault is in the **semantics of the edge, not in its direction**:
a `torque` dependency means "receives drive torque from", and the question should report which
**function** is lost.

## Relationships that produce misleading conclusions (flagged)

Measured with the live impact query on 30 October 2026.

| # | Data | Today's answer | Reality | Severity |
|---|---|---|---|---|
| 1 | `vcu ← wheel-speed-sensor-*` (data, "for traction control"), `esc-module ← wheel-speed-sensor-*` (data, "for anti-lock braking") | One failed wheel-speed sensor "stops" **50 components**, including both drive units, all four tyres and every calliper | A failed sensor disables traction control and anti-lock braking (a warning light); the car still drives and the friction brakes still work | **High**: a safety-related misstatement |
| 2 | `brake-hose-* ← esc-module` (hydraulic), `esc-module ← brake-booster` (hydraulic), `brake-booster ← lv-harness` (power) | Brake booster or 12 V failure "stops" all four callipers | Brake systems are designed with a mechanical or hydraulic fallback: the pedal still applies the brakes (with more force) when the booster or the ESC fails | **High**: a safety-related misstatement |
| 3 | `steering-rack ← eps-motor` (torque) | Power-steering motor failure "stops" the rack and tie rods | Steering still works through the column, just heavier (manual fallback). The data has both providers, but the impact walk treats any single lost provider as a total loss | Medium |
| 4 | `ad-compute ← each sensor` (data) | Losing one camera "stops" the automated-driving computer | Perception degrades; the system may hand over to the driver, but the computer does not stop | Medium |
| 5 | `battery-module-* ← battery-cooling-plate` (cooling), `radiator ← cooling-fan-*` | A coolant-pump failure "stops" 63 components including the whole drive | Loss of cooling makes the battery management system limit power, and eventually stop, over minutes. A derating, not an instant loss | Medium |
| 6 | Cooling loop back into the pack: module → busbar → junction box → PDU → heat-pump compressor → chiller → manifold → cooling plate → modules | One failed module "stops" the other 15 modules (through the cooling circuit) | Modules in series do share one fate (an open module stops the string, which is correct), but the route through the cooling circuit is an artefact of chaining a derating edge | Low: the conclusion is accidentally right, the reasoning wrong |
| 7 | `hub-* ← halfshaft`, `wheel-* ← hub`, `tyre-* ← wheel` (torque) | Drive-shaft failure "stops" the tyre | Only drive torque is lost (see the chain above) | Low, if the wording is fixed |

Sound as modelled: the high-voltage series path (modules → busbars → junction box → PDU → harness →
inverter), the BMS closing the contactors (a deliberate fail-safe), torque transmission inside each drive
unit, and the hydraulic supply from hose to calliper.

## Recommendations (for decision; not implemented)

Small, targeted changes. No redesign:

1. **Make the three families explicit in the schema.** Make `dependency` abstract, with subtypes
   `physical-dependency`, `operational-dependency` and `control-dependency`, keeping `dependency-kind`.
   Queries could then ask, for example, "only physical dependencies".
2. **Add the effect of a loss.** An attribute `loss-effect` with the values `function-lost` and `degraded`.
   The impact function follows only `function-lost` edges and reports `degraded` dependents as end points
   ("degraded: traction control unavailable"). This alone fixes flags 1, 4, 5 and 6.
3. **Say which function is lost.** An attribute `affected-function` on the edge (for example "drive
   torque", "power assistance", "anti-lock braking"), so answers read "tyre-rl: loses drive torque"
   instead of "tyre-rl stops working". This fixes flag 7 and the chain wording.
4. **Model fallbacks and redundancy explicitly.** A relation `redundancy (group-member, ...)` or an
   attribute `fallback` on the dependency, so a dependent with an alternative provider (manual steering,
   mechanical brake push-through) is degraded, not lost, when one provider fails. This fixes flags 2 and 3.
   It is a natural fit for TypeDB: "X is lost only if all members of this group are lost" is a rule a
   recursive function can express.
5. **Interim wording (UI only, done in this commit).** The button now reads "If this fails, what is
   affected?" and the summary reads "components affected", not "stop working", until 1-4 are decided.

Recommendations 2 and 3 are the most valuable for a demonstration: they show TypeDB reasoning that is
honest about degradation, which is exactly what an engineering audience will probe.

---

# C1: the corrected model and expected outcomes (written before implementation, 30 October 2026)

Approved by the owner with one refinement: **no blanket rule that degradation never propagates.** A degraded
function can make a higher-level function unavailable; propagation follows the affected function and the
available fallbacks.

## The model

**States belong to functions, not whole components.** A component can have several functions (the ESC
module provides *brake pressure*, *anti-lock braking* and *stability control*); a failure can take away one
and leave the others. Functions are first-class entities in TypeDB (`vehicle-function`), shared across
components (many parts carry *drive torque*).

**Every dependency is a four-role relation:**
`dependency (dependent: C, affected-function: F, provider: P, required-function: G)`:
"C's function F needs P's function G". It is one of three subtypes, by family:
`physical-dependency` (support, torque), `operational-dependency` (power, cooling, hydraulic) or
`control-dependency` (control, data). Each has:

- `loss-effect`: what happens to C's F when P's G is **lost**: `lost` or `degraded`.
- `degradation-effect` (optional): what happens when P's G is only **degraded**: `lost`, `degraded`, or
  (if absent) nothing. **This is how degradation propagates**, where engineering says it does (reduced
  pack power reduces drive power), and only there.
- Optionally a **fallback**: `fallback (protected: <the dependency>, backup: B)`. If P's G is lost but the
  backup B still works, the effect is `degraded` instead of `lost` (the pedal still brakes without the
  booster).

**A failure** of component X means all of X's functions are lost. The impact is the fixed point of applying
the rules above, starting from X. `lost` wins over `degraded` for the same function. The result has three
parts: **lost** functions, **degraded** functions, and **fallbacks in use**.

Single-failure analysis: a fallback is counted as available unless the backup itself is the failed part or
loses a function in the same failure. (The tests check this independently for every component.)

**New components needed by the fallbacks:** `brake-pedal` (type `driver-control`) and `master-cylinder`
(type `brake-component`), both in the brake-control assembly. The braking path becomes: pedal and booster →
master cylinder → ESC hydraulic unit → hoses → callipers. The pedal and the booster are each other's
fallback for brake pressure.

## Expected outcomes (the tests assert these)

Notation: *component: function*. "Must not" lists what the answer must **not** contain.

| # | Failure | Lost | Degraded | Fallback in use | Must not |
|---|---|---|---|---|---|
| 1 | **Wheel-speed sensor (front left)** | ESC module: anti-lock braking, stability control; VCU: traction control; AD computer: automated driving (it requires stability control) | | | any calliper: clamping force; any tyre: drive torque; ESC module: brake pressure |
| 2 | **Brake booster** | AD computer: automated driving (automatic braking needs the booster) | master cylinder, ESC module, all hoses: brake pressure; all callipers: clamping force; all pads: friction braking | pedal for the master cylinder | any calliper or pad lost |
| 3 | **12 V battery** | harness and every 12 V control unit; BMS: battery supervision → junction box: HV supply → PDU → both inverters → all four tyres: drive torque; ESC: anti-lock braking; booster: brake assistance; rack: steering assistance; AD | master cylinder, ESC, hoses, callipers, pads (manual braking via the pedal) | pedal for the master cylinder | any calliper or pad lost; tie rods: steering motion lost |
| 4 | **Coolant pump** | coolant lines and manifold: coolant flow; cooling plate: cell cooling | all 16 modules: cell power; busbars, junction box, PDU, inverters, and through them all four tyres: drive torque (reduced power) | | any tyre: drive torque lost; any module lost |
| 5 | **Power-steering motor** | rack: steering assistance; AD computer: automated driving | | | tie rods or rack: steering motion |
| 6 | **Front gate driver** | front power module, stator, rotor, shaft, gears, front drive shafts, front hubs, wheels and tyres: drive torque | | | any rear part: drive torque |
| 7 | **Battery module 5** (one of 16 in series) | left busbar: pack current → junction box → all propulsion (an open module stops the series string) | cooling plate: cell cooling (heat pump lost, so no chilling) | | any other module lost (the old artefact through the cooling loop) |
| 8 | **ESC module** | its anti-lock braking and stability control; AD computer: automated driving | all hoses: brake pressure; callipers: clamping force; pads (valves fail open: unmodulated braking) | master cylinder for each hose | any calliper or pad lost |
| 9 | **Front-left brake hose** | front-left calliper: clamping force; front-left pads: friction braking | | | any other wheel's brakes |
| 10 | **Steering rack** | tie rods: steering motion; AD computer: automated driving | | | |

The 12 V case (3) keeps the defensible part of the old 14-step chain, now worded as functions: the tyres lose
*drive torque* (not "stop working"), braking is degraded rather than lost, and steering remains (heavier).

---

## Drive units in detail: expected outcomes (C3a, 30 October 2026)

Written before the C3a data was loaded. The drive units gain the parts a real unit has between the battery
harness and the wheels, and each joins the function chains where it physically sits:

- **DC side:** harness → **HV connector** → DC busbars → DC-link capacitor → power module.
- **Control:** VCU torque request → **motor-control board**, which also needs the **resolver** (rotor angle)
  and the **current sensor** (phase currents) → gate driver → power module. The VCU no longer talks to the
  gate driver directly.
- **AC side:** power module → **phase busbars** → stator.
- **Torque:** rotor shaft → input pinion → **intermediate gear** → (front: **disconnect clutch** →)
  **intermediate shaft** → final-drive gear → differential → **spider gears** → **side gear** (one per side) →
  drive shaft → hub.
- **Oil:** the electric **oil pump** (12 V) feeds the **oil cooler**, which passes the heat to the coolant
  lines. Losing oil flow *degrades* the gear train (splash lubrication only); losing oil cooling *degrades*
  the stator (torque limited). New dependency kind `lubrication` (operational family).
- **Front disconnect** needs 12 V and the VCU's command: a spring opens it without them. **Rear park lock**
  needs the VCU's park command; it carries no drive torque, so its failure takes no drive function.

| # | Failure | Lost | Degraded | Must not |
|---|---|---|---|---|
| 4 (revised) | **Coolant pump** | as before, **plus both oil coolers: oil cooling** (their heat goes into the same coolant) | as before, plus both stators: magnetic field | any tyre: drive torque lost; any module lost |
| 11 | **Front resolver** | front control board: motor control → gate driver → power module → … → front tyres: drive torque | | any rear part |
| 12 | **Rear oil pump** | rear oil cooler: oil cooling | rear stator, rear gear train, rear drive shafts, hubs, wheels, tyres: drive torque (limited) | any tyre: drive torque lost |
| 13 | **Front disconnect clutch** | front intermediate shaft, final-drive gear, differential, front drive shafts → front tyres: drive torque | | the front motor's own functions (stator, rotor); any rear part |
| 14 | **Rear left side gear** | rear-left drive shaft, hub, wheel, tyre: drive torque | | the rear-right wheel (see the caveat below) |
| 15 | **Rear park lock** | nothing | nothing | any drive torque |
| 16 | **Front HV connector** | front DC busbars, capacitor, power module, … → front tyres: drive torque | | any rear part |

**Caveat for review (14, and the existing drive-shaft cases; resolved in C3b, see below):** with an *open* differential, a broken side gear
or drive shaft leaves the other wheel of that axle with almost no torque too, because an open differential
passes equal torque to both sides and the broken side resists nothing. The model keeps the approved C1
per-side rule; correcting it would mean "a broken drive shaft loses drive at both wheels of its axle".
Proposed for decision, not implemented.

New assumptions, added to the table below: the resolver has no sensorless fallback (a failed resolver stops
that axle's motor); the oil pump is electric (12 V), not driven by the gears.

## Open differential: axle-level propulsion (C3b, 30 October 2026)

Approved correction of the C3a caveat. Written before the data change.

**Engineering assumption.** Each driven axle has a conventional *open* differential: no locking mechanism,
no limited-slip device, no torque vectoring, and one motor per axle (not one per wheel). An open differential
always passes equal torque to its two side gears; the torque it can deliver is limited by the side that
resists least. If one side gear or drive shaft breaks, that side spins freely and resists nothing, so
**neither wheel on that axle receives useful drive torque.** (Traction control braking the free side does
not help here: the broken side has nothing to brake against.)

**How it is modelled (data only; the reasoning functions are unchanged):**
- Each side gear and each drive shaft provides a new function, **reaction path**: it can carry torque
  between the differential and its wheel. A drive shaft's reaction path needs its side gear's.
- The differential's *drive torque* needs the reaction path of **both** drive shafts on its axle
  (physical, loss: lost).
- Hubs gain an explicit **wheel rotation** function, provided by the wheel bearing, so an answer can show that
  the wheels still turn freely when drive is lost.

**Axle-level versus vehicle-level.** Each impact answer now also summarises propulsion per axle, from TypeDB:
an axle is *lost* when both its tyres lose drive torque, *reduced* when any is degraded or only one is
lost, otherwise *kept*. Vehicle propulsion is *lost* only when every axle is lost, *reduced* when at least one
axle is lost or reduced, otherwise *kept*. Which tyres belong to which axle comes from TypeDB (the drive
torque chain from each axle-drive system's drive shafts to the tyres), not from part names.

| # | Failure | Lost | Must not | Propulsion |
|---|---|---|---|---|
| 14 (revised) | **Rear left side gear** | rear differential, spider gears, both side gears, both drive shafts, both rear hubs, wheels and tyres: drive torque; rear-right drive shaft keeps its reaction path | rear hubs: wheel rotation; any calliper or pad; tie rods: steering motion; any front part | rear lost, front kept → vehicle **reduced** |
| 17 | **Front right drive shaft** | front differential … both front tyres: drive torque | front hubs: wheel rotation; braking; steering; any rear part | front lost, rear kept → vehicle **reduced** |
| 18 | **Rear left wheel bearing** | rear-left hub: wheel rotation | drive torque anywhere (the shaft still reacts torque; a seized bearing is not modelled) | all kept |
| 3 (check) | **12 V battery** | as before | | both axles lost → vehicle **lost** |
| 4 (check) | **Coolant pump** | as before | | both axles reduced → vehicle **reduced** |

## Battery and high-voltage distribution: expected outcomes (C3b, 30 October 2026)

Written before the C3b data. The pack and its distribution gain the parts that real packs have between
the cells and the consumers (sources in docs/engineering-references.md).

**Architecture.**
- **Cells to terminals.** 16 modules in one series string (left column 1, 3 … 15, then right column 16 …
  2). A **service disconnect** joins the two halves in the middle of the string. Then the **pack fuse**,
  then the two **main contactors** in the **junction box** (positive and negative; the positive closes
  through the **pre-charge circuit** first), then the junction box's HV supply.
- **Supervision.** Eight **module monitors** (one per pair of modules, powered by their own cells) report
  cell voltages and temperatures over the **monitor chain** to the BMS. The BMS also reads the **pack current
  sensor**. Without valid cell data the BMS must open the contactors (a deliberate fail-safe). Without
  current measurement it keeps the contactors closed but limits power.
- **Distribution.**
  - The junction box feeds the front inverter directly (hv-harness-front).
  - It feeds the rear inverter through the pack's internal **rear feed** and hv-harness-rear.
  - It feeds the front-compartment PDU through the new **auxiliary harness**; the PDU supplies the DC-DC
    converter (moved next to the 12 V battery), the heat-pump compressor and the on-board charger.
- **12 V.** The 12 V battery feeds the **12 V fuse box**, which feeds the low-voltage harness. The DC-DC
  converter keeps the 12 V battery charged: losing it only degrades the 12 V supply (the battery runs down
  slowly).
- **Charging.** The **charge port** has an AC and a DC inlet.
  - DC: the **DC charge harness** to the pack's rear outlet, then forwards along the internal **rear feed** to the
    junction box. (First drawn running inside the pack to the junction box. The packaging check showed that route
    crossing the side rail and crossmembers, so the cable now joins the rear feed, as real packs bring DC charging
    in at a dedicated inlet. This adds DC charging to scenario 24.)
  - AC: the on-board charger.
  - The junction box's *battery charging* function needs DC charging, with the on-board charger as a
    **fallback** (much slower), and the BMS.

| # | Failure | Lost | Degraded | Must not | Propulsion |
|---|---|---|---|---|---|
| 7 (check) | Battery module 5 | as before (string open) | as before | other modules | vehicle lost |
| 19 | **Pack fuse** | positive contactor, junction box: HV supply, both inverter feeds, PDU, all tyres: drive torque, battery charging | | any module; BMS | vehicle lost |
| 20 | **Module monitor 3** | BMS: battery supervision → contactors → HV supply → all propulsion | | the monitored modules' cell power | vehicle lost |
| 21 | **Pack current sensor** | | BMS: battery supervision → contactors, HV supply → all four tyres: drive torque | anything lost | both axles reduced → vehicle reduced |
| 22 | **DC charge harness** | rear feed: DC charging (added with the reroute below) | junction box: battery charging (on-board charger in use) | propulsion | kept |
| 23 | **Pre-charge circuit** | positive contactor: HV switching → all propulsion | | | vehicle lost |
| 24 | **Rear feed (in the pack)** | hv-harness-rear → rear inverter → rear tyres: drive torque | junction box: battery charging (on-board charger in use; see below) | any front drive | rear lost → vehicle reduced |
| 25 | **12 V fuse box** | the low-voltage harness and every 12 V consumer, as the 12 V battery case (3) | | | vehicle lost |
| 26 | **DC-DC converter** | | 12 V battery: 12 V supply | anything else | kept |
| 27 (corrected) | **Auxiliary harness** | PDU: HV distribution → DC-DC, compressor, on-board charger | battery cooling (chiller lost), 12 V supply | drive torque lost or degraded | both axles kept → vehicle kept |

**Correction to 27, found by its test.** As first written, scenario 27 expected reduced drive at both axles
through the loss of battery chilling. That contradicts the rule approved at C1: losing the chiller only
*degrades* the cooling plate, and a degraded plate does not reduce the modules' power (only a lost plate
does). The data was not changed to fit; the expectation was. Over a long drive the pack would warm and the
BMS would eventually limit power. That is a rate effect, which this model does not represent. Scenario 19
also exposed a gap in the *data*: charging did not depend on the contactors and fuse. It now does, because
charging current reaches the cells through them.

**Assumptions added:** a single series string; one monitor per two modules; loss of cell data opens the
contactors; pre-charge is needed at every start (the static model treats it as needed for HV supply); the
on-board charger is the fallback for charging, not for driving.

## Suspension: expected outcomes (C3c step 2, 30 October 2026)

Written before the data. Until now no suspension part took part in any dependency, so a broken arm affected
nothing. The new functions separate three kinds of consequence.

**Functions.**
- **Wheel location** (knuckle): where the wheel is, held by the lower and upper arms. Each arm provides *knuckle
  location*. The lower arms need the subframe's *subframe location*; the upper arms pivot on the body (not
  modelled as a failure source; since D1.2, on the suspension towers, see "Body structure: load paths").
- **Wheel alignment** (knuckle): the wheel's steer angle, held by the tie rod at the front (*steering motion*)
  and the toe link at the rear (*toe control*, which needs the subframe).
- **Load support** (spring): carries the corner's share of the vehicle's weight, through the top mount's *body
  attachment*.
- **Damping** (damper): controls wheel and body motion; also needs the top mount.
- **Roll control** (anti-roll bar): needs both drop links' *roll link*.
- **Subframe location** (subframe): held by four rubber mounts. Each mount's loss only *degrades* it; the other
  three still hold the subframe.
- **Road holding** (tyre): the per-wheel result that the others feed.

**How they combine at each tyre's *road holding*:**

| Lost provider function | Effect on road holding | Meaning |
|---|---|---|
| Wheel location (an arm or the knuckle) | **lost** | The wheel is no longer held: that corner cannot be used. Essential |
| Wheel alignment (tie rod, toe link) | **lost** | The wheel can steer itself. Essential |
| Load support (spring, top mount) | **degraded** | The corner rests on its bump stop; drivable slowly. Ride and handling much worse |
| Damping (damper) | **degraded** | Ride comfort and grip on rough roads reduced |
| Roll control (anti-roll bar or a drop link) | **degraded**, both wheels of that axle | Handling (body roll, balance) degraded; ride unaffected |
| Subframe location (degraded by one mount) | **degraded**, through the lower arms and the toe links | Alignment shifts slightly; noise and vibration |

A degraded *wheel location* passes on as degraded road holding. A lost one passes on as lost.

**Not modelled:**
- Whether a corner with lost road holding immobilises the vehicle. The answer says what is lost at that wheel.
  The propulsion summary is unchanged, because drive torque does not depend on wheel location in this model.
- Magnitudes and gradual wear.

| # | Failure | Lost | Degraded | Must not |
|---|---|---|---|---|
| 28 | **Front left lower arm** | knuckle-fl: wheel location; tyre-fl: road holding | | any other wheel; drive torque, braking functions, steering motion |
| 29 | **Rear right spring** | (the spring itself) | tyre-rr: road holding | anything lost |
| 30 | **Front left damper** | (the damper itself) | tyre-fl: road holding | anything lost |
| 31 | **Rear left drop link** | rear anti-roll bar: roll control | tyre-rl, tyre-rr: road holding | front tyres |
| 32 | **Front subframe mount 2** | | front subframe: subframe location; both front lower arms and knuckles; tyre-fl, tyre-fr: road holding | anything lost; rear wheels |
| 33 | **Front right tie rod** | knuckle-fr: wheel alignment; tyre-fr: road holding | | the left front wheel |
| 34 | **Rear right toe link** | knuckle-rr: wheel alignment; tyre-rr: road holding | | other wheels |
| 35 | **Front left top mount** | spring-fl: load support; damper-fl: damping | tyre-fl: road holding | anything else lost |
| 10 (revised) | **Steering rack** | as before (both tie rods: steering motion; automated driving), **plus** knuckle-fl, -fr: wheel alignment; tyre-fl, -fr: road holding | | the rear wheels |

**Revision to 10:** a rack that has failed no longer holds the front wheels' steer angle, so both front wheels
lose alignment. This follows from the new *wheel alignment* function. The approved C1 outcome only listed
steering motion because nothing depended on it.

**Geometry assumptions** (concept, not validated production values): front and rear double wishbones with a
tie rod or toe link; ±80 mm wheel travel; ±35° steered angle at the front. Kinematics: `docs/c3c/README.md`.

## Steering: expected outcomes (C3c step 3, 31 October 2026)

Written before the data. Until now the column drove the rack directly, nothing depended on the steering wheel,
and the power-steering loop had no sensor.

**New parts:**
- the **intermediate shaft**, with a universal joint at each end;
- the **steering torque sensor** on the pinion housing;
- two rubber **rack mounts** on the subframe.

**Chain:**
- **Driver input:** steering wheel → column → intermediate shaft → rack (*driver steering input*, then
  *steering motion*) → tie rods.
- **Assistance:** the torque sensor measures the driver's torque in the pinion shaft (*steering torque*, from the
  intermediate shaft). The steering control module needs it for *steering control*, so a dead sensor stops
  the assistance, but steering itself remains (heavier).
- **Rack mounts:** each mount provides *rack location*, which needs the subframe's *subframe location*. Losing one
  mount only degrades the rack's steering motion (the other still holds it), the same rule as the subframe's
  body mounts.

| # | Failure | Lost | Degraded | Must not appear |
|---|---|---|---|---|
| 36 | **Steering torque sensor** | steering module: steering control; power-steering motor: power assistance; rack: steering assistance; AD computer: automated driving | | rack: steering motion; tie rods; anything at the wheels |
| 37 | **Intermediate shaft** | torque sensor: steering torque; rack: steering motion; both tie rods; both front knuckles: wheel alignment; both front tyres: road holding; AD computer; rack: steering assistance (the sensor reads nothing) | | rear wheels; braking; drive torque |
| 38 | **Left rack mount** | | rack: steering motion | anything lost |
| 39 | **Steering wheel** | column: driver steering input, and the same chain as 37 | | rear wheels; braking; drive torque |

**Simplification, kept from the existing model:** losing the rack's steering motion makes the front wheels lose
*wheel alignment* (step 2's rule). In reality the wheels stay where they are; the driver just cannot steer them.

## Braking supply and parking: expected outcomes (C3c step 4, 31 October 2026)

Written before the data.

**Brake supply.**
- **New parts:**
  - the **brake-fluid reservoir** on the master cylinder;
  - **rigid brake lines** from the stability-control (ESC) module to each corner's hose (`brake-line-fl` … `-rr`).
- **The chain becomes:** reservoir → master cylinder → ESC module → line → hose → calliper.
- **Fail-open fallback moves to the lines.** The ESC's fallback (its valves fail open, so pedal pressure passes
  through, unmodulated) now sits on the lines, which the module feeds. The hoses follow the lines.
- **Reservoir:** losing it (a leak or an empty reservoir) loses the master cylinder's pressure. Neither the booster
  nor the pedal can make up for missing fluid.

**Parking: two separate mechanisms that back each other up for holding the vehicle, never for braking.**
- **Park lock** (in the rear drive unit, commanded by the VCU): *parking hold*.
- **Electric parking brake:** each rear calliper's actuator provides *parking hold*, which needs 12 V and the ESC
  module's *parking-brake control*. The calliper then provides *parking clamp* (the actuator drives the piston
  mechanically, with no hydraulic pressure).
- **Holding the vehicle:** each rear tyre's *vehicle holding* needs:
  - the park lock's *parking hold*, with that side's parking brake as the fallback;
  - its calliper's *parking clamp*, with the park lock as the fallback.

  So losing either mechanism only degrades holding, and losing both loses it.
- **No path from either parking mechanism into service braking.** Calliper *clamping force*, pad *friction
  braking* and brake pressure never list the park lock or the parking brake as a fallback.

| # | Failure | Lost | Degraded | Must not appear |
|---|---|---|---|---|
| 40 | **Rear park lock** | | rear tyres: vehicle holding (the parking brake holds) | any braking function |
| 41 | **Rear left parking-brake actuator** | rear-left calliper: parking clamp | rear-left tyre: vehicle holding (the park lock holds) | clamping force; the right side |
| 42 | **12 V battery** (revised) | as before, plus both parking mechanisms and both rear tyres' vehicle holding | as before | |
| 43 | **Brake-fluid reservoir** | master cylinder and ESC module: brake pressure; every line, hose and calliper's braking | | parking functions |
| 44 | **One brake line (front left)** | that hose, calliper and pads | | other corners; parking |
| 8 (revised) | **ESC module** | AD computer; both rear callipers: parking clamp | callipers: clamping force (lines fall back to the master cylinder); rear tyres: vehicle holding | |
| — | **Any service-braking failure** | — | — | the park lock or parking brake as a fallback |

**Simplification.** The park lock acts through the rear differential and drive shafts. Those links are not
repeated in the holding chain. "Parking hold" needs the VCU and 12 V to engage, so the static model treats a
dead 12 V supply as no holding. In reality a lock that is already engaged stays engaged.

## Thermal circuits: expected outcomes (C3c step 5, 1 November 2026)

Written before the data. Until now one `coolant-lines` part stood for the whole circuit, and nothing depended on
the radiator.

**Coolant.**
- **Supply and flow:** the **coolant reservoir** (expansion tank) keeps the circuit filled; the pump drives the
  flow.
- **Temperature:** the **thermal-mode valve** routes coolant through the radiator, the battery chiller or the
  **coolant heater**, and so provides *coolant temperature*:
  - losing the radiator degrades it (the chiller can still take heat, with less margin);
  - an unpowered valve stays where it was, so it is degraded rather than lost.
- **Chiller and heater:** these act on the battery circuit, and the heater also on the cabin climate.

  *Revised while implementing.* The first version also let the chiller and heater degrade *coolant temperature*.
  Scenario 27 (the auxiliary HV harness) then derated all four motors whenever the heat pump stopped, although
  the radiator still rejects their heat. That was too strong.
- **Lines:** `coolant-lines` keeps its id and becomes the battery's circuit. New `front-coolant-lines` and
  `rear-coolant-lines` carry coolant to each drive unit's inverter and oil cooler. The rear pair runs under the
  pack.
- **Consumers:** each consumer needs flow (lost without it, as before) and coolant temperature (degraded without
  it). The consumers are the battery manifold, the inverters' power modules and the oil coolers.

**Refrigerant.**
- **Condenser:** ahead of the radiator. It gives the heat pump's heat to the outside air, helped by the fans'
  airflow (degraded without them).
- **Refrigerant lines:** need the compressor and the condenser. The chiller and the cabin climate module need the
  lines.

| # | Failure | Lost | Degraded | Must not appear |
|---|---|---|---|---|
| 45 | **Radiator** | | valve: coolant temperature; and through it the battery manifold, both inverters' power modules and both oil coolers | anything lost |
| 46 | **Thermal-mode valve** | | the same consumers (temperature) | anything lost |
| 47 | **Condenser** | refrigerant lines: refrigerant flow; chiller: coolant chilling; climate module: cabin climate | battery cooling plate (no chilling) | drive torque lost or degraded |
| 48 | **Coolant reservoir** | | pump: coolant flow, and every line's flow | anything lost |
| 49 | **Front coolant lines** | front oil cooler: oil cooling | front power module: phase current; front stator | anything at the rear; the battery |
| 4 (revised) | **Coolant pump** | battery, front and rear coolant lines' flow; manifold; cooling plate; both oil coolers | battery modules, stators, power modules, tyres' drive torque | |

**Simplification:** one valve stands for the circuit's thermal modes. The real circuit has several valves and
modes (cabin heating, battery pre-conditioning, waste-heat recovery).

## Body structure: load paths (D1.2, 1 November 2026)

Written before the data. Until D1.2 the suspension's body ends had no structure behind them: the upper arms
"pivot on the body (not modelled as a failure source)", and the top mounts and subframe mounts provided their
functions unconditionally. The body-in-white now carries them, so a structural failure reaches the wheel.

**Functions.**
- **Structural support** (front and rear rails, the front floor rails, the rear seat crossmember): the primary
  structure. It needs nothing further in this model; the chain stops at the rails.
- **Suspension mounting** (front and rear towers): where the top mount and the upper arm's pivots sit. Each tower
  needs its rail's *structural support*. Losing the rail only **degrades** the tower, because the tower is also tied
  to the bulkhead's cowl (front) or to the wheelhouse and boot floor (rear).
- **Body attachment** (top mount) and **knuckle location** (upper arm) now need their tower's *suspension
  mounting*: lost if the tower is lost, degraded if it is degraded.
- **Body mounting** (each subframe mount) needs the structure it is bolted to:
  - mounts 1/2 at the front: the front rails;
  - mounts 3/4 at the front: the front floor rails;
  - mounts 1/2 at the rear: the rear seat crossmember;
  - mounts 3/4 at the rear: the rear rails.

  The mount's function is lost if that structure is lost.

**The chains a visitor can follow** (named question "What carries the front-right wheel's load?"):
- tyre → knuckle → lower arm → subframe → subframe mounts → front rail / front floor rail;
- tyre → knuckle → upper arm → tower → front rail;
- tyre → spring and damper → top mount → tower → front rail.

**Not modelled:**
- Crash load paths: the crash boxes, beams and pillars carry no dependencies.
- Partial structural damage and fatigue: a failure here means the part no longer carries its load.
- Two failed mounts on one subframe still only *degrade* it, as one does (as in C3c).

| # | Failure | Lost | Degraded | Must not |
|---|---|---|---|---|
| 50 | **Right front tower** | top-mount-fr: body attachment; upper-arm-fr: knuckle location; spring-fr: load support; coilover-fr: damping; knuckle-fr: wheel location; tyre-fr: road holding | | any other wheel |
| 51 | **Right front rail** | front-subframe-mount-2: body mounting | front-tower-r: suspension mounting; top-mount-fr: body attachment; upper-arm-fr: knuckle location; front subframe: subframe location; knuckle-fl, -fr: wheel location; tyre-fl, -fr: road holding | anything else lost; rear wheels |
| 52 | **Left rear tower** | top-mount-rl: body attachment; upper-arm-rl: knuckle location; spring-rl: load support; coilover-rl: damping; knuckle-rl: wheel location; tyre-rl: road holding | | any other wheel |
| 53 | **Rear seat crossmember** | rear-subframe-mount-1, -2: body mounting | rear subframe: subframe location; rear lower arms, toe links and knuckles; tyre-rl, -rr: road holding | anything else lost; front wheels |
| 54 | **Right front floor rail** | front-subframe-mount-4: body mounting | front subframe: subframe location; tyre-fl, -fr: road holding | anything else lost; the towers |

## What the tests do and do not establish (C2, 30 October 2026)

The impact tests compare TypeDB's answer with an independent implementation of the same rules (`api/tests/oracle.ts`), for
every component as the failed part. Agreement shows **computational consistency**: TypeDB applies the
modelled rules correctly and completely. It does **not** validate the engineering assumptions themselves,
because both implementations read the same dependency data. Whether each dependency, effect and fallback is
right is a matter of engineering review, not testing.

The assumptions that most shape the answers, for review:

| Assumption | Effect on answers | Basis |
|---|---|---|
| The 12 V supply has no redundancy (one battery, one harness) | A 12 V failure loses all propulsion (via the BMS and contactors) | Common in current EVs; some have a second supply for safety systems |
| The BMS must hold the contactors closed | BMS loss opens the high-voltage circuit | Standard fail-safe design |
| Modules are in one series string | Any module failure (open circuit) stops propulsion | Typical 800 V packs; partial-module failures that do not open the circuit are not modelled |
| Loss of cooling degrades rather than stops | Coolant-pump failure reduces power, nothing lost | BMS and inverter derating; over a long period this could become a stop |
| Brake hydraulics fail open through the ESC unit | ESC failure leaves unmodulated braking | Standard design intent |
| Pedal and booster are each other's fallback for brake pressure | Booster failure degrades braking | Mechanical push-through; booster-only braking on electronic demand |
| Automated driving requires stability control, booster, power steering, rack, VCU and gateway | Any of these loses automated driving | A deliberately conservative safety rule |
| One wheel-speed sensor missing switches off anti-lock braking, stability and traction control | Sensor failure loses those functions, not braking | Typical behaviour (warning light) |
| Single failures only; degradation has no magnitude | Answers do not combine failures or say "how much" | Scope of this model |
| A resolver failure stops its motor (no sensorless fallback) | Resolver or current-sensor failure loses that axle's drive | Many production inverters do the same; some can continue sensorless at reduced performance |
| Drive-unit oil pumps are electric (12 V) | Oil-pump failure degrades that axle's torque (splash lubrication and hotter windings) | Common in recent units; some use a gear-driven pump instead |
| Loss of cell monitoring (a module monitor or the monitor chain) opens the contactors | Any monitor failure stops all propulsion | Required fail-safe: cells may not be used unmonitored |
| Pre-charge is needed to close the contactors | A pre-charge failure stops propulsion (at the next start) | The model is static; while already driving the contactors would stay closed |
| Open differentials, one motor per axle (C3b) | A side-gear or drive-shaft failure loses drive at both wheels of that axle; the other axle keeps driving | Conventional open differential: equal torque to both sides, so a free side leaves both without useful torque. A locking or limited-slip differential, or one motor per wheel, would change this |
