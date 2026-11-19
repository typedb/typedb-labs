# Body interfaces: what the body reconstruction must accommodate (C3c step 8, 1 November 2026)

**What this is.** It describes the mechanical vehicle as C3c leaves it. The body reconstruction (body-in-white,
exterior and interior) must fit round it without moving any mechanical assembly. The mechanical parts and their
TypeDB semantics are fixed; the body is what changes.

**Conventions.**
- **Coordinates:** vehicle coordinates in metres. x points forward from the reference point between the nose
  (x 2.34) and tail (x −2.41). y points up from the ground. z points to the right; the vehicle is right-hand drive.
- **Mirroring:** values given for the right side apply mirrored to the left unless stated.
- **Concept values:** these are concept values for an original, unbranded vehicle, not a production design.

**Sources.**
- `web/src/vehicle/dimensions.ts` and `web/src/vehicle/suspension.json` (the suspension hard points).
- The Blender models in `blender/`.
- The motion solver `web/src/scene/kinematics.ts`.
- The envelope study `web/src/scene/envelope.analysis.test.ts`.

**Checking the result.** The body milestone should keep running the existing checks:
- the static packaging test (`web/src/scene/packaging.test.ts`);
- the motion clearance test (`web/src/scene/travel.test.ts`, 10 mm across the whole envelope);
- the connection check (`web/src/semantic/connections.analysis.test.ts`).

The body-structure groups B1–B6 listed in those tests should empty as the body is rebuilt. Each group's test
fails when it no longer occurs, which prompts removing it.

## 1. Fixed vehicle dimensions

| Item | Value |
|---|---|
| Wheelbase | 3.03 m (front axle x 1.58, rear axle x −1.45) |
| Track (tyre centres) | 1.63 m, front and rear (z ±0.815) |
| Tyres and wheels | 275/45 R22 (outer radius 0.405 m, width 0.275 m), 22-inch rims |
| Overhangs | front 0.76 m, rear 0.96 m; length 4.75 m |
| Ride height | wheel centres at y 0.405 (nominal), ±80 mm of travel |

## 2. Wheel arches: the swept envelopes

**What was swept:** each tyre, over the whole rack stroke (±81 mm, so each front wheel turns at least 35° both
ways at every travel position, and up to 45° on the inner wheel at full rebound) and ±80 mm of travel. The arch
and its liner must stay **outside** these figures, with at least **20 mm** clearance (the motion test asks 10 mm
of everything; tyres grow at speed).

**Front-right tyre.**
- **Overall box:** x 1.10–2.06, y −0.09–0.90, z 0.40–1.17.
- **By slice** (the furthest inboard and highest points it reaches, per 0.1 m along the car):

| x | 2.1 | 2.0 | 1.9 | 1.8 | 1.7 | 1.6 | 1.5 | 1.4 | 1.3 | 1.2 | 1.1 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inboard z | 0.62 | 0.52 | 0.40 | 0.43 | 0.51 | 0.59 | 0.50 | 0.42 | 0.40 | 0.47 | 0.59 |
| top y | 0.56 | 0.77 | 0.85 | 0.89 | 0.90 | 0.90 | 0.90 | 0.88 | 0.87 | 0.82 | 0.70 |

**Rear-right tyre** (no steering).
- **Overall box:** x −1.86 to −1.04, y −0.08–0.89, z 0.658–0.953.
- **Inboard face:** z 0.658 throughout; the top is at y 0.89 at the axle.

**Other parts inside the arches.**
- **Front:** the upper ball joint and the top of the goose-neck knuckle reach y ≈ 0.90 at ride height, about 0.98
  at full bump, at z ≈ 0.60–0.62, and move with the wheel's steer.
- **Rear:** the brake lines rise ahead of the rear wheels at x −1.03 to −1.12, z ±0.625, and run over the tyre at
  y 0.80, z ±0.60, to hose brackets at x −1.62, y 0.785, z ±0.505.
- **Front hose brackets:** at x 1.75, y 0.785, z ±0.505, inboard of the front tyres' sweep.

## 3. Suspension towers, subframes and their mounting points

| Interface | Position (right side; left mirrored) | Requirement |
|---|---|---|
| **Front damper top mount** | x 1.55, y 0.935, z 0.445; 3 studs on a 50 mm radius; plate ⌀ 160 mm | A suspension tower with a top-mount plate. The bonnet's inner panel must clear the top mount and spring (top of the stack y ≈ 0.97). |
| **Rear damper top mount** | x −1.46, y 0.93, z 0.48 | A rear tower or shelf. The rear seat and parcel structure must leave room. |
| **Front upper-arm pivots** | front bush x 1.80, y 0.86, z 0.40; rear bush x 1.42, y 0.86, z 0.41 (pivot axis along x) | Brackets on the front tower, above the tyre. The arm swings ±0.04 m at its outer end. |
| **Rear upper-arm pivots** | x −1.30 and −1.60, y 0.57, z 0.47 | Brackets on the rear tower or wheelhouse, ahead of and behind the rear damper. |
| **Front subframe body mounts** | 1/2: x 1.92, z ±0.36, spacer top y 0.45; 3/4: x 1.26, z ±0.36, spacer top y 0.35 | Body brackets meeting each spacer's top (each takes an M12-class through-bolt). The current rails, at y 0.51–0.61 and z ±0.465–0.535, do not meet them. |
| **Rear subframe body mounts** | 1/2: x −1.13, z ±0.36, top y 0.35; 3/4: x −1.79, z ±0.36, top y 0.45 | Brackets under the floor (1/2) and at the rear rails (3/4). |
| **Front subframe** | x 1.25–1.90, y 0.20–0.28, z ±0.455 | Carries the lower arms, rack mounts, anti-roll bar, drive-unit mounts and torque rod. Nothing of the body below y 0.30 between the mounts. |
| **Rear subframe** | x −1.77 to −1.12, y 0.20–0.35, z ±0.455 | Lower arms, toe links, anti-roll bar, drive-unit mounts. |
| **Anti-roll bars** | front axis x 1.84, y 0.38, z ±0.40; rear x −1.72, y 0.28 | Clear space round the bars and their ends as they twist (±16° front, ±25° rear). |

## 4. Battery enclosure and underfloor

- **Pack.** x −0.99 to 1.21, y 0.185 (underbody shield) to 0.364 (lid), z ±0.66. The pack's side rails carry
  mounting tabs at z ±0.69.
  - **Requirement:** sills whose inner faces meet the tabs (z ±0.69–0.70) for the pack's bolts. TypeDB already
    records the pack bolted to both sills.
- **Floor.** The cabin floor sits directly on the pack lid (y ≥ 0.38). Two pipe runs pass along the pack, and the
  floor and sills must leave room for them:
  - **Brake lines:** z ±0.69, y 0.365, x 1.0 to −0.99, between the pack and the sill.
  - **Rear drive-unit coolant pair:** under the pack, y 0.154–0.18, z about +0.03 to +0.07, x 1.2 to −1.0. They
    need a channel or cover in the underbody panel.
- **Front bay of the pack** (x 0.96–1.21): the junction box, BMS and the HV cables leaving forward (`hv-harness-front`,
  `hv-harness-aux`, `coolant-lines` ports).
- **Rear exits** (x −0.99 to −1.10): the rear HV feed, and the DC charge harness to the charge port at x −1.98,
  y 0.86, z −0.875 (left rear quarter).

## 5. Drive units, steering and braking

| Assembly | Space (approximate) | Body interfaces |
|---|---|---|
| **Front drive unit** | x 1.36–1.70, y 0.27–0.82, z −0.31 to +0.23 (drive shafts out to the hubs) | None directly: it is mounted on the subframe. Keep the bonnet's inner panel clear of the inverter (top y 0.82). |
| **Rear drive unit** | x −1.71 to −1.33, y 0.27–0.81, z −0.33 to +0.23 | None directly. The boot floor and rear seat must clear the inverter (top y 0.81). |
| **Steering column** | from the wheel's hub (x 0.605, y 0.968, z 0.37) to the upper universal joint (x 0.95, y 0.73) | A bracket to the cross-car beam (x 0.80, y 0.92). The dashboard must leave the column and its adjustment housing free. |
| **Intermediate shaft** | x 0.95 to 1.365, y 0.73 to 0.635, z 0.37 to 0.30 | A **bulkhead opening** with a rubber seal at x ≈ 1.045, y ≈ 0.72, z ≈ 0.35. |
| **Rack and tie rods** | rack x 1.365, y 0.505, z ±0.42; the tie rods sweep z ±0.36 to ±0.70 at y 0.44–0.58 | **The rebuilt front rails must pass above (y > 0.62) or inboard of the tie rods** (B2). |
| **Pedal box and booster** | pedal x 0.82–0.95, y 0.44–0.66, z 0.29; booster on the bulkhead x 1.04–1.21, y 0.75–0.92, z 0.16–0.37 | A bulkhead mounting face for the booster's four studs, and an opening for the pushrod. |
| **Master cylinder and reservoir** | x 1.20–1.36, y 0.73–1.00, z 0.25–0.34 | The bonnet clears the reservoir's cap (y 1.00), with service access. |
| **ESC module** | x 1.76–1.94, y 0.62–0.75, z −0.02 to 0.12 | A bracket in the front bay. |

## 6. Cooling module and pipe routes

- **Cooling module:**
  - **Position:** the condenser, radiator, shroud and fans sit at x 2.12–2.27, y 0.46–0.82, z ±0.46 (tanks and
    drier), between the front rails.
  - **Body requirements:**
    - a **grille and air path** feeding the whole core;
    - air exits behind the fans;
    - the module carried on the front structure, ahead of the subframe and behind the front crash beam
      (x 2.34, y 0.52).
- **Front bay:** pump, reservoir (top at y 0.88), valve, heater, chiller and compressor sit at x 1.69–2.04,
  y 0.40–0.88.
- **Pipe routes:**
  - **Refrigerant line** to the cabin climate module: over the front drive unit at y 0.93, z ≈ 0, then through a
    **bulkhead opening at x ≈ 1.02, y ≈ 0.80, z ≈ 0**.
  - **Cabin climate module:** stays under the dashboard (x 0.61–0.83, y 0.52–0.72).
  - **Rear brake lines:** run over the front drive unit at y 0.86, z ±0.12, then down in front of the bulkhead
    at x 1.12 to below it, y 0.38.

## 7. Structural mounting points (summary)

| Mounted part | Body structure needed |
|---|---|
| Subframes (8 mounts) | Body brackets at the spacer tops in section 3 |
| Damper top mounts (4) | Front and rear suspension towers |
| Front upper arms (4 pivots) | Tower brackets above the tyre |
| Rear upper arms (4 pivots) | Rear wheelhouse brackets |
| Battery pack | Sill inner faces at z ±0.69, along x −0.99 to 1.21 |
| Steering column | Cross-car beam bracket; bulkhead opening for the shaft |
| Brake booster | Bulkhead mounting face; pushrod opening |
| Cooling module | Front structure between the rails |
| Brake lines, coolant pair, HV harnesses | Clips along the routes above; an underbody channel for the coolant pair |

## 8. Sensors and their housings

| Sensor | Position | Housing the body must provide |
|---|---|---|
| Front camera | x 0.42, y 1.43, centre | Behind the windscreen at the top, in the wiper area |
| Rear camera | tail, y 0.96, centre | In the tailgate's handle or plate recess |
| Side cameras (2) | x 0.70, y 1.15, z ±1.08 | In the mirror housings |
| Front radar | nose, y 0.53, centre | Behind a radar-transparent badge or panel in the lower grille |
| Corner radars (4) | front x 2.18, rear x −2.22; y 0.64; z ±0.70; turned 43° outwards | Behind the bumper corners (radar-transparent paint, no metal) |
| Lidar | x 0.18, y 1.71, centre | A roof-front pod with a clear window |
| GNSS antenna | x −1.60, y 1.68, centre | The roof's shark fin |

## 9. Body-structure requirements: the backlog B1–B6, consolidated

| # | Requirement | Replaces |
|---|---|---|
| **R1** | **Sills** end clear of both wheel envelopes, at about x −0.98 to 1.08, with closing plates. Their inner faces carry the pack's tabs at z ±0.69, and they leave the brake-line run at z ±0.69, y 0.365. | B1 (sills through the arches) |
| **R2** | **Front rails** rise over the suspension. They must clear the coilovers, springs and drop links, pass above (y > 0.62) or inboard of the tie rods' sweep, and meet the front subframe mounts' spacer tops. **Suspension towers** carry the top mounts and the front upper arms' pivots. **Rear rails** do the same for the rear dampers, springs, upper arms and subframe mounts 3/4. | B2 (rails through the suspension) |
| **R3** | **Cabin floor** kicks up over the rear subframe at the rear seat's cross member (x about −1.10). There are wheelhouse inner panels inboard of the rear tyres' envelope (z ≤ 0.63), leaving the rear brake lines' rise at z ±0.625. Body brackets go to rear subframe mounts 1/2. | B3 (floor in the rear arches) |
| **R4** | **Rear doors' shut line** and the rear arch: the door's lower rear corner stays forward of the rear tyre's envelope (x > −1.02 at the sill line). | B4 (rear doors in the tyres) |
| **R5** | **Arch liners** sized from section 2, plus 20 mm. The front liner's crown clears the goose-neck knuckle's top (y 0.98 at bump). The rear liners' front edges leave the brake lines' rise. | B5 (liners too tight) |
| **R6** | **Rear seat** forward of, or raised over, the rear wheelhouses. It must clear the rear tyres' envelope (closest today 13.9 mm) and the brake lines' rise. | B6 (seat over the rear suspension) |
| **R7** | **Bulkhead openings:** the steering shaft (x ≈ 1.045, y ≈ 0.72, z ≈ 0.35), the booster's pushrod and studs (z 0.29), and the refrigerant line (y ≈ 0.80, z ≈ 0). | new |
| **R8** | **Bonnet and front structure:** clear the top mounts and springs (y 0.97), the reservoir cap (y 1.00) and the inverter (y 0.82). The cooling module goes between the rails, behind the crash beam, with a grille feeding it. | new |
| **R9** | **Underbody:** a channel or cover for the rear drive unit's coolant pair under the pack (y 0.154–0.18). Ground clearance is measured from the pack's shield (y 0.185) and the subframes (y 0.20). | new |
| **R10** | **Sensor housings** as in section 8, with radar-transparent covers for every radar. | new |

**What stays as it is.**
- **Mechanical assemblies:** the 24 model files, the suspension hard points and the motion envelope do not
  change.
- **TypeDB:** components, connections, dependencies and fallbacks do not change. The body milestone may replace
  body placeholders (rails, sills, floor, liners, seats) with real geometry under the **same component ids**, and
  add body parts such as towers and brackets as new components with connections to the mechanical parts they
  carry.
