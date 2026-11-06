// The visual manifest: how each component is drawn. For every stable component id: its shape, its
// assembled position and its rendering material. Nothing about what a component is or how it relates to
// others: names, types, assemblies, systems and relationships live only in TypeDB
// (data/seed/ -> TypeDB -> the semantic API; docs/decisions/0001-typedb-sole-database.md).
//
// Tests keep the ids identical to TypeDB's. Ids never change once published.

import type { PanelId } from "./body";
import { AXLE_Y, DRIVER_Z, FRONT_AXLE_X, REAR_AXLE_X, TRACK_HALF } from "./dimensions";
import hardPoints from "./suspension.json";
import exteriorStandIns from "./exterior-stand-ins.json";
import structureStandIns from "./structure-stand-ins.json";
import type { Shape, Vec3 } from "./shapes";

export type MaterialId =
  | "paint" | "glass" | "roof-glass" | "gloss-black" | "satin-black" | "rubber" | "alloy" | "iron" | "caliper"
  | "aluminium" | "cast" | "hv-orange" | "electronics" | "lamp" | "tail-lamp" | "leather" | "battery" | "steel"
  | "copper" | "pcb" | "fabric";

export interface Part {
  id: string;
  shape: Shape;
  material: MaterialId;
  /** Assembled position (vehicle coordinates). Body panels take theirs from the body surface;
   * inner panels give an offset from the panel they copy. */
  position?: Vec3;
  /** Mounted on the body's front or rear face: x is found from the surface at (y, z), and
   * position[0] becomes the offset from that surface (negative = set into it). */
  attach?: "front" | "rear";
  rotation?: Vec3;
}

// ---- Helpers for parts that come in left/right pairs or four corners ----------------------------------

type Side = { key: "l" | "r"; z: 1 | -1 };
const SIDES: Side[] = [
  { key: "l", z: -1 },
  { key: "r", z: 1 },
];
type Corner = { key: "fl" | "fr" | "rl" | "rr"; x: number; z: 1 | -1; front: boolean };
const CORNERS: Corner[] = [
  { key: "fl", x: FRONT_AXLE_X, z: -1, front: true },
  { key: "fr", x: FRONT_AXLE_X, z: 1, front: true },
  { key: "rl", x: REAR_AXLE_X, z: -1, front: false },
  { key: "rr", x: REAR_AXLE_X, z: 1, front: false },
];
/** A tube given by absolute points: the part's position becomes the points' centre. */
const absTube = (points: Vec3[], radius: number): Pick<Part, "shape" | "position"> => {
  const c: Vec3 = [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length) as Vec3;
  return { position: c, shape: { kind: "tube", radius, points: points.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]] as Vec3) } };
};
/** A suspension hard point (web/src/vehicle/suspension.json) at this corner: the right-hand corner's point, mirrored on the left. */
const hp = (c: { front: boolean; z: number }, key: "upperBall" | "lowerBall" | "upperFront" | "upperRear" | "lowerFront" | "lowerRear" | "linkOuter" | "linkInner" | "damperLower" | "damperTop" | "dropUpper" | "dropLower"): Vec3 => {
  const [x, y, z] = (c.front ? hardPoints.front : hardPoints.rear)[key];
  return [x, y, c.z * z];
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** A tube given by absolute points, placed at the centre of their bounding box (for long, uneven routes). */
const boxTube = (points: Vec3[], radius: number): Pick<Part, "shape" | "position"> => {
  const c: Vec3 = [0, 1, 2].map((k) => (Math.min(...points.map((p) => p[k])) + Math.max(...points.map((p) => p[k]))) / 2) as Vec3;
  return { position: c, shape: { kind: "tube", radius, points: points.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]] as Vec3) } };
};
const mid = (a: Vec3, b: Vec3, lift = 0): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + lift, (a[2] + b[2]) / 2];
const panel = (id: PanelId, material: MaterialId): Part => ({ id, material, shape: { kind: "panel" } });

// ---- Parts --------------------------------------------------------------------------------------------

// The body structure (blender/structure.py, D1.2) and the exterior's non-panel parts (blender/exterior_panels.py, D1.3)
// are drawn from their Blender models; these boxes (each part's bounding box, written by the builds) only stand in
// for them when the models are switched off. The exterior's panels fall back to the browser-built shell (body.ts).
type StandIns = Record<string, { centre: number[]; size: number[] }>;
const box = (table: StandIns, id: string, material: MaterialId): Part => {
  const { centre, size } = table[id];
  return { id, material, shape: { kind: "box", size: size as Vec3, radius: 0.004 }, position: centre as Vec3 };
};
const exteriorPart = (id: string): Part => box(exteriorStandIns as StandIns, id, "satin-black");
/** Where the exterior model draws a part (sensors and mirrors keep their own fallback shapes there). */
const exteriorAt = (id: string): Vec3 => (exteriorStandIns as StandIns)[id].centre as Vec3;
const standIn = (id: string): Part => {
  const { centre, size } = (structureStandIns as StandIns)[id];
  return { id, material: "aluminium", shape: { kind: "box", size: size as Vec3, radius: 0.004 }, position: centre as Vec3 };
};

const body: Part[] = [
  panel("bonnet", "paint"),
  panel("front-bumper", "paint"),
  exteriorPart("grille"),
  ...SIDES.map((s): Part => panel(`fender-${s.key}` as PanelId, "paint")),
  ...SIDES.flatMap((s) => [`headlamp-${s.key}`, `headlamp-lens-${s.key}`].map(exteriorPart)),
  exteriorPart("bonnet-inner"),
  exteriorPart("tailgate-inner"),
  panel("windscreen", "glass"),
  panel("roof", "roof-glass"),
  ...SIDES.map((s): Part => panel(`body-side-${s.key}` as PanelId, "paint")),
  ...SIDES.map((s): Part => panel(`rocker-${s.key}` as PanelId, "gloss-black")),
  panel("tailgate", "paint"),
  panel("tailgate-glass", "glass"),
  panel("rear-bumper", "paint"),
  panel("rear-diffuser", "gloss-black"),
  ...SIDES.map((s): Part => panel(`quarter-${s.key}` as PanelId, "paint")),
  ...SIDES.map((s): Part => panel(`quarter-glass-${s.key}` as PanelId, "glass")),
  ...SIDES.map((s) => exteriorPart(`tail-lamp-${s.key}`)),
  ...CORNERS.map((c): Part => panel(`door-${c.key}` as PanelId, "paint")),
  ...CORNERS.map((c): Part => panel(`glass-${c.key}` as PanelId, "glass")),
  ...SIDES.map((s): Part => ({
    id: `mirror-${s.key}`, material: "gloss-black",
    shape: { kind: "mirror" }, position: exteriorAt(`mirror-${s.key}`), rotation: [0, s.z > 0 ? 0 : Math.PI, 0],
  })),
];

const structure: Part[] = [
  panel("underbody", "satin-black"),
  ...CORNERS.map((c) => exteriorPart(`arch-liner-${c.key}`)),
  ...Object.keys(structureStandIns).map(standIn),
];

// Each axle has its own hard points (blender/corner.py, web/src/vehicle/suspension.json): a leading calliper at
// the front, a trailing one with the parking-brake actuator at the rear.
const corners: Part[] = CORNERS.flatMap((c): Part[] => {
  const flip: Vec3 = [0, c.z > 0 ? 0 : Math.PI, 0]; // wheel faces outwards on both sides
  const caliperAngle = (c.front ? hardPoints.front : hardPoints.rear).caliperAngle;
  const discR = 0.19;
  return [
    { id: `tyre-${c.key}`, material: "rubber",
      shape: { kind: "tyre" }, position: [c.x, AXLE_Y, c.z * TRACK_HALF], rotation: flip },
    { id: `wheel-${c.key}`, material: "alloy",
      shape: { kind: "rim" }, position: [c.x, AXLE_Y, c.z * TRACK_HALF], rotation: flip },
    { id: `brake-disc-${c.key}`, material: "iron",
      shape: { kind: "disc", radius: discR }, position: [c.x, AXLE_Y, c.z * (TRACK_HALF - 0.08)], rotation: flip },
    { id: `caliper-${c.key}`, material: "caliper",
      shape: { kind: "caliper" },
      position: [c.x + Math.cos(caliperAngle) * (discR - 0.03), AXLE_Y + Math.sin(caliperAngle) * (discR - 0.03), c.z * (TRACK_HALF - 0.08)],
      rotation: [0, c.z > 0 ? 0 : Math.PI, caliperAngle - Math.PI / 2] },
    { id: `knuckle-${c.key}`, material: "cast",
      shape: { kind: "box", size: [0.09, c.front ? 0.6 : 0.3, 0.06], radius: 0.02 },
      position: [c.x, c.front ? AXLE_Y + 0.15 : AXLE_Y, c.z * (TRACK_HALF - 0.11)] },
    { id: `wheel-speed-sensor-${c.key}`, material: "electronics", shape: { kind: "cylinder", radius: 0.012, length: 0.06, axis: "z" },
      position: [c.x - 0.057, AXLE_Y + 0.12, c.z * (TRACK_HALF - 0.093)] },
    // rear callipers carry the electric parking brake's actuator on their inboard half
    ...(c.front ? [] : [{ id: `epb-actuator-${c.key}`, material: "satin-black" as const,
      shape: { kind: "cylinder" as const, radius: 0.034, length: 0.07, axis: "z" as const },
      position: [c.x + Math.cos(caliperAngle) * 0.176, AXLE_Y + Math.sin(caliperAngle) * 0.176, c.z * (TRACK_HALF - 0.15)] as Vec3 }]),
  ];
});

/** A wishbone stand-in from its ball joint and two inner bushes, placed at their centre. */
const arm = (outer: Vec3, front: Vec3, rear: Vec3): Pick<Part, "shape" | "position"> => {
  const c: Vec3 = [0, 1, 2].map((k) => (outer[k] + front[k] + rear[k]) / 3) as Vec3;
  return { position: c, shape: { kind: "arm", inner: [sub(front, c), sub(rear, c)], outer: sub(outer, c) } };
};

const suspension: Part[] = [
  ...CORNERS.flatMap((c): Part[] => {
    const e = hp(c, "damperLower"), top = hp(c, "damperTop");
    const lean: Vec3 = [Math.atan2(e[2] - top[2], top[1] - e[1]), 0, Math.atan2(e[0] - top[0], top[1] - e[1])];
    return [
      { id: `lower-arm-${c.key}`, material: "aluminium", ...arm(hp(c, "lowerBall"), hp(c, "lowerFront"), hp(c, "lowerRear")) },
      { id: `coilover-${c.key}`, material: "steel",
        shape: { kind: "damper", length: 0.44 }, position: mid(e, top), rotation: lean },
      { id: `spring-${c.key}`, material: "alloy",
        shape: { kind: "spring", length: 0.32 }, position: mid(e, top, 0.13), rotation: lean },
      { id: `top-mount-${c.key}`, material: "cast",
        shape: { kind: "cylinder", radius: 0.065, length: 0.035, axis: "y" }, position: top, rotation: lean },
    ];
  }),
  // Subframes, their body mounts and the anti-roll bars (blender/chassis.py has the detailed models). Both axles
  // share one layout in "front-relative" dx (positive forwards at the front, rearwards at the rear).
  ...(["front", "rear"] as const).flatMap((a): Part[] => {
    const at = (dx: number, y: number, z: number): Vec3 => [a === "front" ? FRONT_AXLE_X + dx : REAR_AXLE_X - dx, y, z];
    const fwd = a === "front" ? 1 : -1;
    return [
      { id: `${a}-subframe`, material: "cast",
        shape: { kind: "box", size: [0.62, a === "front" ? 0.06 : 0.2, 0.9], radius: 0.02 }, position: at(0, a === "front" ? 0.24 : 0.3, 0) },
      (() => {
        const h = a === "front" ? hardPoints.front : hardPoints.rear;
        const [x, y] = h.arbAxis, [ex, ey, ez] = h.dropLower, lean = Math.sign(ex - x) * 0.04;
        return { id: `${a}-anti-roll-bar`, material: "steel" as const,
          ...absTube([[ex, ey, -ez], [x + lean, y + 0.01, -0.4], [x, y, -0.34], [x, y, 0.34], [x + lean, y + 0.01, 0.4], [ex, ey, ez]], 0.012) };
      })(),
      ...[1, 2, 3, 4].map((n): Part => {
        const dx = (n <= 2 ? fwd : -fwd) * 0.3;
        const top = fwd * dx < 0 ? 0.35 : 0.45; // body brackets: lower for the pair nearer the cabin
        return { id: `${a}-subframe-mount-${n}`, material: "satin-black",
          shape: { kind: "cylinder", radius: 0.035, length: top - 0.18, axis: "y" },
          position: at(dx + (dx > 0 ? 0.04 : -0.02), (top + 0.18) / 2, (n % 2 ? -1 : 1) * 0.36) };
      }),
    ];
  }),
];

const steering: Part[] = [
  { id: "steering-rack", material: "aluminium",
    // ends at the tie rods' inner joints, chosen for low bump steer (C3c step 2b, web/src/vehicle/suspension.json)
    shape: { kind: "cylinder", radius: 0.03, length: 2 * hardPoints.front.linkInner[2], axis: "z" },
    position: [hardPoints.front.linkInner[0], hardPoints.front.linkInner[1], 0] },
  // blender/steering.py has the detailed models: a rack-parallel motor behind the rack with the control module on its
  // inner end, the torque sensor on the pinion (driver's side), rack mounts on the subframe, and the column and
  // intermediate shaft through the bulkhead
  { id: "eps-motor", material: "cast",
    shape: { kind: "cylinder", radius: 0.045, length: 0.13, axis: "z" }, position: [hardPoints.front.linkInner[0] - 0.08, 0.46, 0.125] },
  { id: "steering-ecu", material: "electronics",
    shape: { kind: "finned-box", size: [0.1, 0.1, 0.05], fins: 5 }, position: [hardPoints.front.linkInner[0] - 0.08, 0.46, 0.03] },
  { id: "steering-torque-sensor", material: "cast",
    shape: { kind: "cylinder", radius: 0.042, length: 0.04, axis: "y" }, position: [hardPoints.front.linkInner[0] - 0.02, 0.58, 0.25] },
  ...SIDES.map((s): Part => ({
    id: `steering-rack-mount-${s.key}`, material: "cast",
    shape: { kind: "box", size: [0.06, 0.25, 0.05], radius: 0.01 }, position: [1.335, 0.38, s.z > 0 ? 0.228 : -0.285] })),
  { id: "steering-intermediate-shaft", material: "steel",
    ...absTube([[hardPoints.front.linkInner[0], 0.635, 0.3], [0.95, 0.73, DRIVER_Z]], 0.012) },
  { id: "steering-column", material: "steel",
    ...absTube([[0.95, 0.73, DRIVER_Z], [0.605, 0.968, DRIVER_Z]], 0.03) },
  { id: "steering-wheel", material: "leather",
    shape: { kind: "steering-wheel" }, position: [0.6, 0.97, DRIVER_Z], rotation: [0, 0, -0.42] },
];

const brakeControl: Part[] = [
  // blender/brakes.py has the detailed models: pedal, booster, master cylinder and reservoir on the driver's side
  // of the bulkhead (inboard of the steering column), the ESC module in the front bay, rigid lines to the corners
  { id: "brake-booster", material: "cast",
    shape: { kind: "cylinder", radius: 0.075, length: 0.14, axis: "x" }, position: [1.135, 0.84, 0.29] },
  { id: "esc-module", material: "aluminium",
    shape: { kind: "box", size: [0.15, 0.1, 0.12], radius: 0.02 }, position: [1.84, 0.7, 0.05] },
  { id: "master-cylinder", material: "aluminium", // with its two circuit pipes to the ESC module
    ...absTube([[1.205, 0.86, 0.29], [1.355, 0.86, 0.29], [1.6, 0.9, 0.2], [1.78, 0.76, 0.09]], 0.026) },
  { id: "brake-fluid-reservoir", material: "satin-black",
    shape: { kind: "box", size: [0.11, 0.07, 0.07], radius: 0.01 }, position: [1.275, 0.95, 0.29] },
  { id: "brake-pedal", material: "satin-black",
    ...absTube([[0.92, 0.66, 0.29], [0.82, 0.44, 0.29], [0.9, 0.62, 0.29], [1.065, 0.82, 0.29]], 0.012) },
  ...CORNERS.map((c): Part => {
    const s = c.z, end: Vec3 = c.front ? [c.x + 0.17, 0.785, s * 0.505] : [c.x - 0.17, 0.785, s * 0.505];
    const route: Vec3[] = c.front
      ? [[1.84, 0.75, 0.05], [1.77, 0.75, s * 0.25], [1.78, 0.76, s * 0.42], end]
      : [[1.84, 0.8, 0.05], [1.7, 0.86, s * 0.12], [1.12, 0.86, s * 0.12], [1.12, 0.4, s * 0.12], [1.1, 0.38, s * 0.5], [1.0, 0.365, s * 0.69],
        [-0.99, 0.365, s * 0.69], [-1.03, 0.37, s * 0.625], [-1.1, 0.4, s * 0.625], [-1.12, 0.8, s * 0.625], [end[0] + 0.06, 0.8, s * 0.6], end];
    return { id: `brake-line-${c.key}`, material: "steel", ...boxTube(route, 0.004) };
  }),
];

// Drive units: three parallel shafts along z (docs/engineering-references.md). The motor's axis is above the
// wheel axis on the left, the two-stage gear train in a split case on the right, the inverter on top.
// The Blender models (blender/drive_unit.py) use the same layout; these simple shapes are the fallback.
type DriveKey = "front" | "rear";
const DRIVE = {
  front: { motor: [-0.03, 0.593], inter: [0.0186, 0.5167], housingR: 0.13, statorR: 0.112, rotorR: 0.068, stack: [-0.215, -0.045], housing: [-0.27, 0.03] },
  rear: { motor: [-0.1, 0.567], inter: [-0.087, 0.4775], housingR: 0.145, statorR: 0.125, rotorR: 0.078, stack: [-0.25, -0.04], housing: [-0.285, 0.03] },
} as const;
/** Positions within a drive unit: axle x plus an offset; "motor" / "inter" / "wheel" shafts. */
const duAt = (key: DriveKey, x: number, shaft: "motor" | "inter" | "wheel", z: number, dy = 0): Vec3 => {
  const [ox, y] = shaft === "wheel" ? [0, AXLE_Y] : DRIVE[key][shaft];
  return [x + ox, y + dy, z];
};

const driveUnit = (key: DriveKey, x: number): Part[] => {
  const u = DRIVE[key];
  const [h0, h1] = u.housing;
  const top = u.motor[1] + u.housingR + 0.01;
  return [
    { id: `${key}-motor`, material: "cast",
      shape: { kind: "ring", radius: u.housingR, inner: u.statorR, length: h1 - h0, axis: "z" }, position: duAt(key, x, "motor", (h0 + h1) / 2) },
    { id: `${key}-gearbox`, material: "aluminium",
      shape: { kind: "box", size: [0.3, 0.34, 0.095], radius: 0.04 }, position: [x - 0.02, 0.47, 0.0775] },
    { id: `${key}-inverter`, material: "electronics",
      shape: { kind: "box", size: [0.3, 0.075, 0.4], radius: 0.01 }, position: [x + u.motor[0], top + 0.0375, -0.06] },
    ...SIDES.map((s): Part => ({
      id: `${key}-halfshaft-${s.key}`, material: "steel",
      shape: { kind: "cylinder", radius: 0.022, length: 0.6, axis: "z" }, position: [x, AXLE_Y, s.z * 0.44],
    })),
  ];
};

// Battery pack (blender/battery.py has the detailed model; these simple shapes are the fallback). The pack sits
// between the protection plate at y=0.19 and the cabin floor at 0.38; a narrower front bay holds the junction
// box and BMS. Module rows run rear to front: row i holds module 2i+1 (left) and 2i+2 (right).
const ROWS = Array.from({ length: 8 }, (_, i) => -0.88 + i * 0.24);
const battery: Part[] = [
  { id: "battery-enclosure", material: "aluminium",
    shape: { kind: "box", size: [2.2, 0.15, 1.32], radius: 0.02 }, position: [0.11, 0.276, 0] },
  { id: "battery-lid", material: "satin-black",
    shape: { kind: "box", size: [2.16, 0.008, 1.32], radius: 0.003 }, position: [0.09, 0.36, 0] },
  { id: "battery-underbody-shield", material: "steel",
    shape: { kind: "box", size: [2.16, 0.008, 1.32], radius: 0.003 }, position: [0.09, 0.19, 0] },
  { id: "battery-cooling-plate", material: "aluminium",
    shape: { kind: "box", size: [1.9, 0.01, 1.24], radius: 0.003 }, position: [-0.02, 0.211, 0] },
  ...ROWS.flatMap((x, i) =>
    SIDES.map((s, j): Part => ({
      id: `battery-module-${i * 2 + j + 1}`, material: "battery", shape: { kind: "battery-module" }, position: [x - 0.0, 0.273, s.z * 0.33],
    })),
  ),
  ...SIDES.map((s): Part => ({
    id: `battery-busbar-${s.key}`, material: "copper",
    // the right column's lead crosses to the negative contactor, so its centre sits further in
    shape: { kind: "box", size: [1.9, 0.006, 0.03], radius: 0.002 }, position: [0.03, 0.315, s.z < 0 ? -0.32 : 0.19],
  })),
  ...[-0.76, -0.04, 0.68].map((x, i): Part => ({
    id: `battery-crossmember-${i + 1}`, material: "aluminium",
    shape: { kind: "box", size: [0.03, 0.095, 1.28], radius: 0.004 }, position: [x, 0.254, 0],
  })),
  ...SIDES.map((s): Part => ({
    id: `battery-side-rail-${s.key}`, material: "aluminium",
    shape: { kind: "box", size: [1.955, 0.14, 0.045], radius: 0.006 }, position: [-0.0075, 0.27, s.z * 0.668],
  })),
  { id: "battery-coolant-manifold", material: "aluminium",
    ...absTube([...[-0.96, -0.64, -0.32, 0, 0.32, 0.64, 0.96].map((x): Vec3 => [x, 0.226, -0.03]), [1.15, 0.26, -0.045]], 0.012) },
  ...ROWS.map((x, i): Part => ({
    id: `battery-monitor-${i + 1}`, material: "pcb",
    shape: { kind: "box", size: [0.13, 0.01, 0.07], radius: 0.002 }, position: [x - 0.0, 0.282, 0],
  })),
  { id: "battery-monitor-chain", material: "satin-black",
    shape: { kind: "tube", radius: 0.004, points: [[-0.94, 0.026, -0.1], [0.92, 0.02, -0.1], [0.94, -0.03, 0.1]] }, position: [0.06, 0.3, 0.07] },
  { id: "hv-junction-box", material: "electronics",
    shape: { kind: "box", size: [0.15, 0.123, 0.29], radius: 0.01 }, position: [1.08, 0.277, -0.295] },
  { id: "main-contactor-pos", material: "satin-black",
    shape: { kind: "cylinder", radius: 0.026, length: 0.06, axis: "y" }, position: [1.045, 0.257, -0.4] },
  { id: "main-contactor-neg", material: "satin-black",
    shape: { kind: "cylinder", radius: 0.026, length: 0.06, axis: "y" }, position: [1.045, 0.257, -0.22] },
  { id: "precharge-circuit", material: "satin-black",
    shape: { kind: "box", size: [0.05, 0.03, 0.065], radius: 0.003 }, position: [1.105, 0.235, -0.378] },
  { id: "pack-fuse", material: "electronics",
    shape: { kind: "cylinder", radius: 0.013, length: 0.12, axis: "z" }, position: [1.105, 0.245, -0.26] },
  { id: "pack-current-sensor", material: "satin-black",
    shape: { kind: "box", size: [0.03, 0.02, 0.05], radius: 0.003 }, position: [1.105, 0.249, -0.18] },
  { id: "bms", material: "electronics",
    shape: { kind: "box", size: [0.15, 0.056, 0.24], radius: 0.008 }, position: [1.055, 0.263, 0.28] },
  { id: "service-disconnect", material: "hv-orange",
    shape: { kind: "box", size: [0.07, 0.08, 0.1], radius: 0.006 }, position: [-0.93, 0.325, 0] },
  { id: "battery-rear-feed", material: "hv-orange",
    ...absTube([[1.0, 0.3, -0.16], [0.96, 0.338, 0.03], [-0.86, 0.338, 0.03], [-1.02, 0.3, 0.113]], 0.012) },
  { id: "battery-vent", material: "satin-black",
    shape: { kind: "cylinder", radius: 0.024, length: 0.036, axis: "x" }, position: [-0.993, 0.28, 0.42] },
];

const power: Part[] = [
  { id: "lv-battery", material: "satin-black",
    shape: { kind: "box", size: [0.24, 0.18, 0.17], radius: 0.015 }, position: [1.95, 0.675, -0.34] },
  { id: "lv-fuse-box", material: "satin-black",
    shape: { kind: "box", size: [0.14, 0.07, 0.1], radius: 0.008 }, position: [1.95, 0.705, -0.17] },
  { id: "pdu", material: "electronics",
    shape: { kind: "box", size: [0.2, 0.12, 0.22], radius: 0.015 }, position: [1.943, 0.665, 0.315] },
  { id: "dc-dc", material: "electronics",
    shape: { kind: "finned-box", size: [0.16, 0.07, 0.22], fins: 6 }, position: [1.983, 0.571, -0.01] },
  { id: "obc", material: "electronics",
    shape: { kind: "finned-box", size: [0.3, 0.1, 0.26], fins: 8 }, position: [-1.9, 0.606, -0.33] },
  { id: "charge-port", material: "satin-black",
    shape: { kind: "cylinder", radius: 0.05, length: 0.08, axis: "z" }, position: [-1.98, 0.86, -0.875] },
  // High-voltage harnesses: the junction box feeds the front inverter directly, the PDU over the front drive
  // unit, and the rear inverter through the pack's internal rear feed. The DC charge harness runs from the
  // charge port, under the rear-left drive shaft, to the pack's rear charging outlet.
  { id: "hv-harness-front", material: "hv-orange",
    // inboard of the front-left subframe mount and its body bracket (D1.2), up ahead of the subframe and the
    // steering rack's mount, then over the rack to the inverter
    ...absTube([[1.175, 0.29, -0.26], [1.19, 0.34, -0.25], [1.235, 0.42, -0.23], [1.24, 0.6, -0.21], [1.3, 0.72, -0.18], [1.36, 0.773, -0.17]], 0.014) },
  { id: "hv-harness-rear", material: "hv-orange",
    ...absTube([[-1.02, 0.3, 0.113], [-1.1, 0.345, 0.1], [-1.34, 0.345, -0.05], [-1.37, 0.6, -0.15], [-1.37, 0.762, -0.17]], 0.014) },
  { id: "hv-harness-aux", material: "hv-orange",
    ...absTube([[1.17, 0.29, -0.3], [1.25, 0.4, -0.29], [1.3, 0.75, -0.29], [1.45, 0.9, -0.28], [1.75, 0.92, -0.1], [1.84, 0.92, 0.15], [1.82, 0.8, 0.27], [1.83, 0.66, 0.27]], 0.012) },
  { id: "hv-harness-charge", material: "hv-orange",
    ...absTube([[-1.98, 0.86, -0.83], [-2.0, 0.62, -0.55], [-1.7, 0.48, -0.47], [-1.62, 0.4, -0.42], [-1.62, 0.345, -0.34], [-1.3, 0.345, -0.25],
      [-1.1, 0.345, -0.12], [-1.02, 0.3, -0.1]], 0.012) },
  { id: "lv-harness", material: "satin-black",
    // high and inboard of the front-left spring and the upper arm's pivots, through the bulkhead's grommet, along the
    // left sill over the floor crossmembers, up in front of the rear wheelhouse, over the boot floor beside it, and
    // down through a grommet to the rear electrics (D1.2)
    ...absTube([[1.95, 0.7, -0.17], [1.85, 0.78, -0.3], [1.3, 0.8, -0.33], [1.0, 0.75, -0.62], [0.75, 0.6, -0.675], [0.5, 0.47, -0.675],
      [0.2, 0.47, -0.675], [-0.6, 0.47, -0.675], [-0.9, 0.47, -0.675], [-0.945, 0.55, -0.672], [-0.95, 0.885, -0.66], [-1.1, 0.885, -0.62], [-1.8, 0.885, -0.62], [-1.85, 0.8, -0.58],
      [-1.88, 0.7, -0.52], [-1.9, 0.62, -0.5]], 0.012) },
];

const sensors: Part[] = [
  { id: "front-camera", material: "electronics",
    // behind the top of the windscreen, under the lidar pod
    shape: { kind: "box", size: [0.07, 0.05, 0.16], radius: 0.012 }, position: [0.30, 1.435, 0] },
  { id: "rear-camera", material: "electronics",
    // in the tailgate under the light bar, its lens just proud of the skin (D1.4: placed on the new tail)
    shape: { kind: "cylinder", radius: 0.018, length: 0.04, axis: "x" }, position: [-2.364, 0.955, 0] },
  ...SIDES.map((s): Part => ({
    id: `side-camera-${s.key}`, material: "electronics",
    shape: { kind: "cylinder", radius: 0.014, length: 0.03, axis: "y" }, position: exteriorAt(`side-camera-${s.key}`), // in the mirror's underside
  })),
  { id: "front-radar", material: "electronics",
    // behind the fascia above the intake, on the bumper beam (D1.4: placed behind the new front, not in front of it)
    shape: { kind: "box", size: [0.035, 0.11, 0.13], radius: 0.01 }, position: [2.31, 0.64, 0] },
  ...CORNERS.map((c): Part => ({
    id: `corner-radar-${c.key}`, material: "electronics",
    shape: { kind: "box", size: [0.03, 0.09, 0.1], radius: 0.01 },
    position: [c.front ? 2.18 : -2.22, 0.64, c.z * 0.7], rotation: [0, c.front ? -c.z * 0.75 : c.z * 0.75, 0],
  })),
  { id: "lidar", material: "electronics",
    shape: { kind: "lidar" }, position: exteriorAt("lidar") }, // in its pod on the roof's front edge
  { id: "gnss-antenna", material: "paint",
    shape: { kind: "shark-fin" }, position: exteriorAt("gnss-antenna") }, // its fin on the roof
];

const electronics: Part[] = [
  { id: "ad-compute", material: "electronics",
    shape: { kind: "finned-box", size: [0.32, 0.08, 0.26], fins: 10 }, position: [-1.92, 0.6, 0.33] },
  { id: "vcu", material: "electronics",
    shape: { kind: "box", size: [0.16, 0.05, 0.2], radius: 0.01 }, position: [0.86, 0.72, 0.05] },
  { id: "bcm", material: "electronics",
    shape: { kind: "box", size: [0.14, 0.05, 0.18], radius: 0.01 }, position: [0.8, 0.68, -0.55] },
  { id: "gateway", material: "electronics",
    shape: { kind: "box", size: [0.14, 0.04, 0.16], radius: 0.01 }, position: [0.22, 0.45, 0] },
  { id: "telematics", material: "electronics",
    shape: { kind: "box", size: [0.12, 0.03, 0.16], radius: 0.008 }, position: [-0.45, 1.55, 0] },
];

const interior: Part[] = [
  ...SIDES.flatMap((s): Part[] => {
    const at: Vec3 = [0.02, 0.55, s.z * DRIVER_Z];
    const seat = { position: at };
    return [
      { ...seat, id: `seat-front-${s.key}`, material: "leather", shape: { kind: "seat", width: 0.52, piece: "cushion" } },
      { ...seat, id: `seat-back-front-${s.key}`, material: "leather", shape: { kind: "seat", width: 0.52, piece: "back" } },
      { ...seat, id: `headrest-front-${s.key}`, material: "leather", shape: { kind: "seat", width: 0.52, piece: "headrest" } },
      { ...seat, id: `seat-frame-front-${s.key}`, material: "steel", shape: { kind: "seat", width: 0.52, piece: "frame" } },
    ];
  }),
  // forward of the heel kick-up and narrower than the rear wheelhouses and the brake lines' rise (R6, D1.2)
  { id: "seat-rear", material: "leather",
    shape: { kind: "seat", width: 1.18, piece: "cushion" }, position: [-0.8, 0.58, 0] },
  { id: "seat-back-rear", material: "leather",
    shape: { kind: "seat", width: 1.18, piece: "back" }, position: [-0.8, 0.58, 0] },
  { id: "seat-frame-rear", material: "steel",
    shape: { kind: "seat", width: 1.18, piece: "frame" }, position: [-0.8, 0.58, 0] },
  ...SIDES.map((s): Part => ({
    id: `headrest-rear-${s.key}`, material: "leather",
    shape: { kind: "seat", width: 0.52, piece: "headrest" }, position: [-0.8, 0.58, s.z * 0.38],
  })),
  { id: "dashboard", material: "satin-black",
    shape: { kind: "box", size: [0.36, 0.2, 1.46], radius: 0.06 }, position: [0.74, 0.88, 0] },
];

// ---- Detail layers: what makes the exploded view read as an engineering assembly -----------------

// The doors' inner layers follow each door's own surface (blender/exterior_panels.py, D1.3).
const doorLayers: Part[] = CORNERS.flatMap((c) =>
  ["door-structure", "window-regulator", "door-speaker", "door-trim", "door-handle", "door-latch", "door-seal"].map((p) => exteriorPart(`${p}-${c.key}`)));

const wheelDetail: Part[] = CORNERS.flatMap((c): Part[] => {
  const caliperAngle = (c.front ? hardPoints.front : hardPoints.rear).caliperAngle;
  const discR = 0.19;
  const fx = Math.sign(Math.cos(caliperAngle - 0.42)); // the calliper's side of the axle (+1 ahead of it)
  return [
    { id: `hub-${c.key}`, material: "steel",
      shape: { kind: "ring", radius: 0.07, inner: 0.03, length: 0.06, axis: "z" }, position: [c.x, AXLE_Y, c.z * (TRACK_HALF + 0.012)] },
    { id: `brake-shield-${c.key}`, material: "satin-black",
      shape: { kind: "cylinder", radius: discR + 0.012, length: 0.004, axis: "z", segments: 48 },
      position: [c.x, AXLE_Y, c.z * (TRACK_HALF - 0.105)] },
    { id: `brake-hose-${c.key}`, material: "rubber", // from the body bracket on the calliper's side of the axle
      ...absTube([[c.x + fx * 0.17, AXLE_Y + 0.38, c.z * (TRACK_HALF - 0.31)], [c.x + fx * 0.12, AXLE_Y + 0.3, c.z * (TRACK_HALF - 0.155)],
        [c.x + fx * 0.08, AXLE_Y + 0.255, c.z * (TRACK_HALF - 0.135)]], 0.006) },
    { id: `hub-nut-${c.key}`, material: "steel",
      shape: { kind: "cylinder", radius: 0.019, length: 0.016, axis: "z", segments: 6 }, position: [c.x, AXLE_Y, c.z * (TRACK_HALF + 0.05)] },
    { id: `wheel-bearing-${c.key}`, material: "steel",
      shape: { kind: "ring", radius: 0.045, inner: 0.02, length: 0.04, axis: "z" }, position: [c.x, AXLE_Y, c.z * (TRACK_HALF - 0.12)] },
    ...(["inner", "outer"] as const).map((side, k): Part => ({
      id: `brake-pad-${side}-${c.key}`, material: "cast",
      shape: { kind: "box", size: [0.05, 0.12, 0.014], radius: 0.005 },
      position: [c.x + Math.cos(caliperAngle) * (discR - 0.03), AXLE_Y + Math.sin(caliperAngle) * (discR - 0.03),
        c.z * (TRACK_HALF - 0.08 + (k === 0 ? -0.028 : 0.028))],
      rotation: [0, 0, caliperAngle - Math.PI / 2],
    })),
    ...[1, 2, 3, 4, 5].map((n): Part => {
      const a = ((n - 1) / 5) * Math.PI * 2;
      return {
        id: `wheel-nut-${c.key}-${n}`, material: "steel",
        shape: { kind: "cylinder", radius: 0.011, length: 0.03, axis: "z", segments: 6 },
        position: [c.x + Math.cos(a) * 0.058, AXLE_Y + Math.sin(a) * 0.058, c.z * (TRACK_HALF + 0.09)],
      };
    }),
  ];
});

const upperArms: Part[] = [
  ...CORNERS.map((c): Part => ({ id: `upper-arm-${c.key}`, material: "aluminium", ...arm(hp(c, "upperBall"), hp(c, "upperFront"), hp(c, "upperRear")) })),
  // from the anti-roll bar's end to the bracket on the damper's fork (blender/corner.py)
  ...CORNERS.map((c): Part => ({ id: `drop-link-${c.key}`, material: "steel", ...absTube([hp(c, "dropLower"), hp(c, "dropUpper")], 0.008) })),
  ...CORNERS.filter((c) => !c.front).map((c): Part => ({
    id: `toe-link-${c.key}`, material: "steel", ...absTube([hp(c, "linkInner"), hp(c, "linkOuter")], 0.011) })),
  ...CORNERS.filter((c) => c.front).map((c): Part => ({
    id: `tie-rod-${c.key}`, material: "steel", ...absTube([hp(c, "linkInner"), hp(c, "linkOuter")], 0.012) })),
];

const driveUnitDetail = (key: DriveKey, x: number): Part[] => {
  const u = DRIVE[key];
  const [s0, s1] = u.stack;
  const [h0] = u.housing;
  const top = u.motor[1] + u.housingR + 0.01;
  const mx = x + u.motor[0];
  const d = key === "front" ? 1 : -1;
  return [
    { id: `${key}-stator`, material: "copper",
      shape: { kind: "ring", radius: u.statorR, inner: u.rotorR + 0.001, length: s1 - s0 + 0.05, axis: "z" }, position: duAt(key, x, "motor", (s0 + s1) / 2) },
    { id: `${key}-rotor`, material: "steel",
      shape: { kind: "cylinder", radius: u.rotorR, length: s1 - s0, axis: "z", segments: 40 }, position: duAt(key, x, "motor", (s0 + s1) / 2) },
    { id: `${key}-motor-end-cover`, material: "cast",
      shape: { kind: "cylinder", radius: u.housingR, length: 0.03, axis: "z", segments: 48 }, position: duAt(key, x, "motor", h0 - 0.015) },
    { id: `${key}-rotor-shaft`, material: "steel",
      shape: { kind: "cylinder", radius: 0.02, length: 0.5, axis: "z" }, position: duAt(key, x, "motor", (h0 - 0.03 + 0.205) / 2) },
    ...[1, 2].map((n): Part => ({
      id: `${key}-motor-bearing-${n}`, material: "steel",
      shape: { kind: "ring", radius: n === 1 ? 0.042 : 0.047, inner: n === 1 ? 0.016 : 0.02, length: 0.015, axis: "z" },
      position: duAt(key, x, "motor", n === 1 ? h0 - 0.026 : 0.05),
    })),
    { id: `${key}-resolver`, material: "electronics",
      shape: { kind: "ring", radius: 0.045, inner: 0.022, length: 0.012, axis: "z" }, position: duAt(key, x, "motor", h0 - 0.012) },
    { id: `${key}-pinion`, material: "steel",
      shape: { kind: "gear", radius: 0.025, teeth: 21, thickness: 0.034 }, position: duAt(key, x, "motor", 0.165) },
    { id: `${key}-intermediate-gear`, material: "steel",
      shape: { kind: "gear", radius: 0.069, teeth: 61, thickness: 0.03 }, position: duAt(key, x, "inter", 0.165) },
    { id: `${key}-intermediate-shaft`, material: "steel",
      shape: { kind: "cylinder", radius: 0.019, length: 0.16, axis: "z" }, position: duAt(key, x, "inter", 0.125) },
    { id: `${key}-reduction-gear`, material: "steel",
      shape: { kind: "gear", radius: 0.089, teeth: 53, thickness: 0.038 }, position: duAt(key, x, "wheel", 0.085) },
    { id: `${key}-differential`, material: "cast",
      shape: { kind: "ring", radius: 0.06, inner: 0.019, length: 0.135, axis: "z" }, position: duAt(key, x, "wheel", 0.0675) },
    ...SIDES.map((s): Part => ({
      id: `${key}-side-gear-${s.key}`, material: "steel",
      shape: { kind: "gear", radius: 0.028, teeth: 16, thickness: 0.014 }, position: duAt(key, x, "wheel", 0.0675 + s.z * 0.03),
    })),
    { id: `${key}-spider-gears`, material: "steel",
      shape: { kind: "cylinder", radius: 0.007, length: 0.1, axis: "y" }, position: duAt(key, x, "wheel", 0.0675) },
    { id: `${key}-gearbox-cover`, material: "aluminium",
      shape: { kind: "box", size: [0.3, 0.34, 0.09], radius: 0.04 }, position: [x - 0.02, 0.47, 0.17] },
    { id: `${key}-oil-pump`, material: "cast",
      shape: { kind: "cylinder", radius: 0.026, length: 0.09, axis: "z" }, position: [x + d * 0.06, AXLE_Y - 0.105, 0.06] },
    { id: `${key}-oil-cooler`, material: "aluminium",
      shape: { kind: "box", size: [0.07, 0.06, 0.07], radius: 0.006 }, position: [x - d * 0.06, AXLE_Y + 0.09, 0.07] },
    { id: key === "front" ? "front-disconnect" : "rear-park-lock", material: "electronics",
      shape: { kind: "cylinder", radius: 0.022, length: 0.05, axis: "z" }, position: duAt(key, x, "inter", 0.24, d * 0.05) },
    { id: `${key}-gate-driver`, material: "pcb",
      shape: { kind: "box", size: [0.19, 0.006, 0.17], radius: 0.002 }, position: [mx, top + 0.05, -0.02] },
    { id: `${key}-control-board`, material: "pcb",
      shape: { kind: "box", size: [0.24, 0.006, 0.1], radius: 0.002 }, position: [mx, top + 0.07, 0.085] },
    { id: `${key}-inverter-busbars`, material: "copper",
      shape: { kind: "box", size: [0.11, 0.006, 0.16], radius: 0.002 }, position: [mx, top + 0.066, -0.15] },
    { id: `${key}-phase-busbars`, material: "copper",
      shape: { kind: "box", size: [0.07, 0.04, 0.05], radius: 0.002 }, position: [mx, top - 0.01, 0.08] },
    { id: `${key}-current-sensor`, material: "satin-black",
      shape: { kind: "box", size: [0.11, 0.022, 0.026], radius: 0.004 }, position: [mx, top + 0.03, 0.09] },
    { id: `${key}-hv-connector`, material: "hv-orange",
      shape: { kind: "box", size: [0.04, 0.05, 0.07], radius: 0.006 }, position: [mx - d * 0.168, top + 0.04, -0.17] },
    { id: `${key}-inverter-lid`, material: "aluminium",
      shape: { kind: "box", size: [0.3, 0.008, 0.4], radius: 0.004 }, position: [mx, top + 0.079, -0.06] },
    { id: `${key}-power-module`, material: "pcb",
      shape: { kind: "box", size: [0.1, 0.03, 0.15], radius: 0.004 }, position: [mx, top + 0.02, -0.02] },
    { id: `${key}-dc-link-capacitor`, material: "satin-black",
      shape: { kind: "box", size: [0.21, 0.05, 0.12], radius: 0.01 }, position: [mx, top + 0.034, -0.185] },
    ...[1, 2, 3].map((n): Part => ({
      id: `${key}-drive-unit-mount-${n}`, material: "satin-black",
      shape: { kind: "cylinder", radius: 0.03, length: 0.05, axis: "z" },
      position: n === 1 ? [mx, 0.285, h0 + 0.05] : n === 2 ? [x - d * 0.04, 0.285, 0.125] : [x + d * 0.15, 0.31, 0.175],
    })),
  ];
};

const thermal: Part[] = [
  { id: "radiator", material: "aluminium",
    shape: { kind: "slats", size: [0.04, 0.36, 0.8], count: 46 }, position: [2.19, 0.64, 0] },
  ...SIDES.map((s): Part => ({
    id: `cooling-fan-${s.key}`, material: "satin-black",
    shape: { kind: "fan", radius: 0.16 }, position: [2.12, 0.64, s.z * 0.22],
  })),
  { id: "coolant-pump", material: "cast",
    shape: { kind: "cylinder", radius: 0.04, length: 0.1, axis: "y" }, position: [1.75, 0.5, -0.25] },
  { id: "battery-chiller", material: "aluminium",
    shape: { kind: "box", size: [0.12, 0.08, 0.08], radius: 0.01 }, position: [1.84, 0.46, -0.12] },
  { id: "heat-pump-compressor", material: "cast",
    shape: { kind: "cylinder", radius: 0.06, length: 0.16, axis: "x" }, position: [1.84, 0.47, 0.18] },
  // blender/thermal.py has the detailed models of the cooling module, pump, reservoir, valve, heater, chiller,
  // compressor, refrigerant lines and the drive units' coolant lines
  { id: "condenser", material: "aluminium",
    shape: { kind: "slats", size: [0.016, 0.3, 0.72], count: 34 }, position: [2.243, 0.64, 0] },
  { id: "coolant-reservoir", material: "satin-black",
    shape: { kind: "box", size: [0.12, 0.09, 0.1], radius: 0.012 }, position: [1.92, 0.76, -0.15] },
  { id: "coolant-valve", material: "cast",
    shape: { kind: "cylinder", radius: 0.03, length: 0.06, axis: "y" }, position: [1.76, 0.56, -0.15] },
  { id: "coolant-heater", material: "cast",
    shape: { kind: "box", size: [0.12, 0.08, 0.1], radius: 0.01 }, position: [1.88, 0.49, -0.25] },
  { id: "refrigerant-lines", material: "aluminium",
    ...boxTube([[1.92, 0.49, 0.18], [2.12, 0.43, 0.3], [2.27, 0.5, 0.4], [2.27, 0.5, -0.4], [2.12, 0.43, -0.3], [1.85, 0.46, -0.12],
      [1.71, 0.93, 0.02], [1.1, 0.93, 0.02], [0.83, 0.66, -0.05]], 0.007) },
  { id: "front-coolant-lines", material: "satin-black",
    ...boxTube([[1.76, 0.56, -0.15], [1.7, 0.76, -0.15], [1.74, 0.27, -0.1], [1.45, 0.33, 0.07], [1.45, 0.47, 0.07]], 0.011) },
  { id: "rear-coolant-lines", material: "satin-black",
    ...boxTube([[1.76, 0.53, -0.19], [1.74, 0.165, -0.18], [-1.0, 0.165, 0.03], [-1.3, 0.3, 0.05], [-1.33, 0.5, 0.08], [-1.36, 0.74, 0.02]], 0.011) },
  { id: "hvac-module", material: "satin-black",
    shape: { kind: "box", size: [0.22, 0.2, 0.5], radius: 0.03 }, position: [0.72, 0.62, -0.1] },
  { id: "coolant-lines", material: "satin-black", // blender/thermal.py: radiator > pump > valve > chiller > battery pack
    ...boxTube([[2.16, 0.52, -0.4], [1.95, 0.4, -0.32], [1.75, 0.395, -0.25], [1.8, 0.56, -0.19], [1.82, 0.505, -0.12], [1.68, 0.5, -0.4],
      [1.46, 0.49, -0.38], [1.36, 0.36, -0.4], [1.212, 0.26, -0.07]], 0.013) },
];

const cabin: Part[] = [
  { id: "centre-console", material: "satin-black",
    shape: { kind: "box", size: [0.62, 0.18, 0.22], radius: 0.04 }, position: [0.1, 0.5, 0] },
  { id: "driver-display", material: "gloss-black",
    shape: { kind: "box", size: [0.025, 0.11, 0.3], radius: 0.008 }, position: [0.68, 1.04, DRIVER_Z], rotation: [0, 0, -0.2] },
  { id: "centre-display", material: "gloss-black",
    shape: { kind: "box", size: [0.025, 0.2, 0.32], radius: 0.008 }, position: [0.8, 1.02, 0], rotation: [0, 0, -0.25] },
  { id: "headliner", material: "fabric",
    shape: { kind: "box", size: [1.5, 0.01, 1.2], radius: 0.004 }, position: [-0.7, 1.5, 0] }, // under the D1.3 roof
];

export const PARTS: Part[] = [
  ...body,
  ...structure,
  ...corners,
  ...suspension,
  ...steering,
  ...brakeControl,
  ...driveUnit("front", FRONT_AXLE_X),
  ...driveUnit("rear", REAR_AXLE_X),
  ...battery,
  ...power,
  ...sensors,
  ...electronics,
  ...interior,
  ...doorLayers,
  ...wheelDetail,
  ...upperArms,
  ...driveUnitDetail("front", FRONT_AXLE_X),
  ...driveUnitDetail("rear", REAR_AXLE_X),
  ...thermal,
  ...cabin,
];

export const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));
