# C3c step 2b: suspension architecture (31 October 2026)

Written before the corners were rebuilt. The hard points live in `web/src/vehicle/suspension.json`, read by the
Blender models (`blender/corner.py`, `blender/chassis.py`) and the motion checks (`web/src/scene/kinematics.ts`),
so the drawings and the checks cannot drift apart. Concept geometry for an original vehicle, not a validated
production design.

## 1. What the 43 conflicts were

Each of the 73 conflicting poses from step 2 was re-measured as a true minimum distance between the two parts'
surfaces (sampled every 1.5 mm; `web/src/scene/travel.analysis.test.ts`). 65 were **real intersections** (the
surfaces touch or cross, under 1 mm). 8 were **near-clearance warnings** (1–5 mm apart).

| Cause | Pairs | Intersecting poses | Near poses | What was wrong |
|---|---|---|---|---|
| Upper-arm placement | 12 | 28 | 2 | The upper arm sat inside the tyre's height (ball joint 17 mm inboard of the tyre's inner sidewall, legs reaching 23 cm fore and aft). At lock the tyre's inner edge swept into the legs; at rebound the camber change brought the tyre and rim onto the ball joint; the legs straddled the spring so low that the spring's bottom coils met them in rebound. |
| Drop-link positioning | 16 | 24 | 0 | The drop link ran from the bar's end behind the axle up to the damper, straight across the path of the tie rod (front) or toe link (rear) and the spring's lower coils. At full bump and lock the tyre and drive shaft reached it too. |
| Anti-roll bar in the tyre's sweep | 6 | 6 | 0 | The bar's ends sat 15 cm behind the axle and 60 cm out, inside the space the tyre sweeps at lock. |
| Steering / toe arm and calliper | 7 | 7 | 3 | The calliper sat behind and above the axle, on the same side as the steering arm and tie rod; in rebound the tie rod rose into it. The steering arm swung into the damper's fork leg at lock. The rear (the front flipped) had the same toe link / calliper clash. |
| Damper fork and drive shaft | 1 | 0 | 2 | Kinematics: at full rebound with lock the shaft's angle brought it within 3–5 mm of the fork leg. |
| Wheel envelope and a packaged part | 1 | 0 | 1 | The front-right tyre at full bump and lock came within 1 mm of the power distribution unit. |

Root causes, in the brief's terms:
- **Upper-arm placement:** the main one (30 poses).
- **Drop-link positioning:** 24.
- **Wheel and tyre envelope:** the anti-roll bar's ends (6) and the PDU (1).
- **Steering-arm geometry:** 10.
- **Suspension kinematics:** fork and shaft (2).
- **Knuckle geometry:** none on its own, but the knuckle fixed the upper joint's position, so it is part of the first cause.

## 2. Architectures considered

Requirements:
- **Keep:** the wheelbase, wheel centres and drive units.
- **Envelope:** ±80 mm of travel, and ±35° of steer for each front wheel, in both directions at every travel position.
- **Load paths:** plausible.
- **Identity and model:** existing component ids kept; buildable as an accurate model.

| Option | Upper joint | Verdict |
|---|---|---|
| **A. Low upper arm, tuned** (step 2) | Inside the tyre's height, inboard of the tyre | **Rejected.** A tyre steered to 35° sweeps its inner edge up to about 19 cm inboard at upper-arm height, so an arm whose legs reach fore and aft there cannot clear it. Narrowing the legs to clear the tyre puts them into the spring. |
| **B. Upper joint inside the wheel** (classic short-long arm) | Inside the rim | **Rejected for the front.** It needs the lower joint far outboard in the wheel to give a sensible steering axis, and the 22-inch rim's large brake leaves no room. The steering axis would have almost no inclination and about 90 mm of scrub radius (the offset where the steering axis meets the ground, relative to the tyre's centre). **Chosen for the rear**, which does not steer. |
| **C. MacPherson strut** | None (the strut is the upper locator) | **Rejected.** It removes `upper-arm-fl/fr`, which have dependencies in TypeDB. The strut body sits at the same height as the old upper arm, so it has the same lock-clearance problem unless it is pushed far inboard, into the drive unit's space. |
| **D. Four-link front** (two upper and two lower links, virtual steering axis) | Two upper links above the tyre | **Not chosen.** Credible, but it needs more parts and new ids, and its kinematics (a virtual kingpin) is harder to model accurately. It gains little over E at this concept stage. |
| **E. High upper arm with a goose-neck knuckle** | Above the tyre | **Selected for the front.** |

## 3. Selected: front high upper arm, rear double wishbone with toe link

**Front (each side).**
- **Goose-neck knuckle.** The knuckle rises out of the rim's open inner side, inboard of the tyre's inner
  sidewall, to an upper ball joint about 6 cm above the top of the tyre.
- **Upper arm.** A short wishbone above the tyre. Its legs straddle the spring and it pivots on the body's
  suspension tower.
- **Lower arm.** The same lower wishbone as before, on the subframe.
- **Coilover.** The damper's forked lower end straddles the drive shaft. The spring passes between the upper
  arm's legs to the top mount, which stays under the bonnet (bonnet inner panel at about y 0.83–1.0 above the
  wheel).
- **Steering arm and tie rod behind the axle.** The arm is angled inboard for Ackermann geometry. The tie
  rod's inner joint lies on the line through the two arms' inner pivots, for low bump steer.
- **Calliper ahead of the axle** (leading), opposite the steering arm.
- **Anti-roll bar** ahead of the drive unit on the subframe's front cross member, low. Its ends stay inboard of
  the tyre's sweep, and the drop links rise to brackets on the damper fork's front leg.

**Rear (each side).** A double wishbone with a separate toe link, a common modern layout. It has its own hard
points; it is no longer the front flipped.
- **Upper arm inside the wheel.** The rear does not steer, so the arm can enter the rim's open inner side.
- **Lower arm** on the rear subframe, carrying the coilover.
- **Toe link ahead of the axle, low.**
- **Calliper behind the axle**, with the electric parking-brake actuator.
- **Anti-roll bar behind the axle**, with drop links to the damper forks.

**Load paths.**
- **Vertical load:** tyre → knuckle → lower ball joint → lower arm → damper eye → spring → top mount → body.
- **Lateral and braking forces:** shared by the lower arm (subframe, rubber mounts, body) and the upper arm
  (suspension tower, body).
- **Front steering forces:** through the tie rod to the rack on the subframe.
- **Rear toe:** held by the toe link on the rear subframe.
- **Roll:** the bar is clamped in rubber bushes on the cradle, and the drop links act on the damper forks.

**Effect on TypeDB.**
- **Ids and connections:** unchanged. The drop link still joins the damper (`drop-link-* ↔ coilover-*`), and
  the upper arm still attaches to the body.
- **New parts:** none. The calliper, rack and anti-roll bar move, but their functions do not.
- So no semantic change is made for these geometry changes.

## 4. Hard points and resulting geometry

Right-hand corner of each axle, vehicle coordinates in metres (x forward, y up, z right; the left side is the
mirror image). Source: `web/src/vehicle/suspension.json`.

| Point | Front (x, y, z) | Rear (x, y, z) |
|---|---|---|
| Wheel centre | 1.580, 0.405, 0.815 | -1.450, 0.405, 0.815 |
| Lower ball joint | 1.580, 0.235, 0.725 | -1.450, 0.235, 0.725 |
| Upper ball joint | 1.525, 0.875, 0.615 (above the tyre) | -1.440, 0.580, 0.730 (inside the wheel) |
| Lower arm, front / rear bush | 1.750 / 1.410, 0.240, 0.400 | -1.280 / -1.620, 0.240, 0.400 |
| Upper arm, front / rear bush | 1.800, 0.860, 0.400 / 1.420, 0.860, 0.410 | -1.300 / -1.600, 0.570, 0.470 |
| Steering / toe arm joint | 1.439, 0.510, 0.703 (behind the axle) | -1.290, 0.360, 0.700 (ahead of the axle) |
| Tie rod / toe link inner joint | 1.365, 0.505, 0.440 (rack end) | -1.290, 0.360, 0.405 (subframe) |
| Damper lower eye / top mount | 1.580, 0.290, 0.530 / 1.550, 0.935, 0.445 | -1.450, 0.290, 0.530 / -1.460, 0.930, 0.480 |
| Drop link, upper (fork bracket) / lower (bar end) | 1.700, 0.520, 0.490 / 1.720, 0.400, 0.470 | -1.600, 0.450, 0.535 / -1.630, 0.300, 0.550 |
| Anti-roll bar axis (x, y) | 1.84, 0.38 (ahead of the axle) | -1.72, 0.28 (behind the axle) |
| Calliper | ahead of the axle, above it | behind the axle, with the parking-brake actuator |

**Resulting geometry** (concept values from the linkage solver, `web/src/scene/kinematics.ts`):

| | Front | Rear |
|---|---|---|
| Kingpin inclination / caster | 9.8° / 4.9° | — |
| Scrub radius / mechanical trail | 50 mm / 20 mm | — |
| Toe change over ±80 mm (bump steer) | at most 0.13° | ±0.15° (toe-in in rebound, slightly out in bump) |
| Camber at full bump / full rebound | 1.1° more negative / 0.1° more positive | 1.15° more negative / 0.3° more positive |
| Steering arm length | 120 mm, angled 12° outboard | — |
| Rack travel each way | **81.0 mm** | — |
| Anti-roll bar twist over ±80 mm | about ±16° | about ±23° |

**Steering-rack travel (the 91 mm reported in step 2).**
- **The 91 mm was not a requirement.** It came from the step-2 layout: a 137 mm steering arm, and a tie rod
  that worked against Ackermann.
- **Now 81 mm each way**, which is in the usual range for this vehicle class. Three changes produced it:
  - a 120 mm arm;
  - the tie rod's inner joint placed for the least bump steer;
  - the arm angled 12° outboard, which balances the two directions.
- **How 81 mm is defined:** the rack travel at which **each** front wheel reaches 35° in **both** directions at
  **every** travel position. The front-right wheel turning right at full bump sets it.
- **What that means for the other wheel:** at other travel positions the inner wheel turns further.
  - At ride height, full rack gives 41.6° on the inner wheel and 37.5° on the outer.
  - At full rebound, the inner wheel reaches 44.9°.
  - The clearance check covers that whole range, so it checks beyond the 35° target, never short of it.
- **Cost:** the shorter arm needs about 14% more rack force for the same steering torque. Step 3 sizes the
  power-steering motor for it.

## 5. How the hard points were chosen

1. **Fast layout study** (`web/src/scene/layout.analysis.test.ts`, on demand).
   - Every moving part becomes a few capsules (rods with rounded ends); the wheel becomes a tyre-and-rim solid.
   - These are checked against the real meshes of the fixed parts at 99 front poses (9 travel positions × 11
     steer angles) and 9 rear poses. It takes about a minute, so candidate layouts could be compared quickly.
2. **Steering search** (`web/src/scene/debug.analysis.test.ts` and `debug2.analysis.test.ts`). Varied:
   - steering-arm length, angle and height;
   - the rack's fore-aft position.

   For each candidate, the tie rod's inner joint was placed for the least bump steer. Each candidate was then
   scored on:
   - the rack travel needed for 35° at every travel position, in both directions;
   - the outer wheel's angle (Ackermann);
   - the steer at which the linkage would lock.
3. **What forced each choice.**
   - The rack had to stay at least 10 mm behind the front motor (x ≤ 1.395). That ruled out the higher, more
     forward rack positions.
   - The steering arm angles 12° outboard. With the rack behind the arm, the tie rod's own angle already gives
     too much Ackermann (the inner wheel would reach about 49°). The outboard angle brings it back to about
     38°.
   - The calliper moved ahead of the axle, opposite the steering arm.
   - The anti-roll bar moved ahead of the axle, inboard of the tyre's sweep.
   - The drop link moved to the fork's front leg.
   - Caster was raised from 3° to 5° by moving the upper joint back.
   - At the rear, the toe link's inner joint was searched for slight toe-in in bump and little change in rebound.
4. **Final check on the real meshes.** The Blender models were rebuilt from the chosen points and checked by the
   mesh-based motion test (`web/src/scene/travel.test.ts`) and the static packaging test.
