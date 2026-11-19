// Suspension kinematics for the clearance checks (test helper; the app does not import this).
//
// Every corner is a double wishbone with a tie rod (front) or toe link (rear): five links locate the knuckle, the
// spring and damper carry the load, and an anti-roll bar couples the two sides of an axle through drop links. The
// hard points are those of web/src/vehicle/suspension.json (also read by the Blender models), given for the
// right-hand corner of each axle and mirrored in z for the left.
//
// A pose is solved like this: the lower arm turns on its bushes until the wheel centre has risen by `travel`;
// the upper arm turns until its ball joint is the right distance from the lower one; the knuckle turns about
// the line through both ball joints until the steering (or toe) arm is the link's length from the link's inner
// joint, which the rack has moved sideways by `rack` (front only). Everything else follows: the damper and spring
// from the lower arm, the drop link from the damper or lower arm and the anti-roll bar's end, the drive shaft
// from the hub. Concept geometry, not a validated production kinematic model: no bush compliance, no tyre
// deflection, damper and spring move as described.

import * as THREE from "three";
import { FRONT_AXLE_X, REAR_AXLE_X } from "../vehicle/dimensions";
import hardPoints from "../vehicle/suspension.json";

export type Corner = "fl" | "fr" | "rl" | "rr";
type P3 = [number, number, number];
type Axle = typeof hardPoints.front;

/** Drive shafts' inner (plunging) joint centres, by corner (blender/drive_unit.py halfshaft). */
const SHAFT_INNER: Record<Corner, P3> = {
  fr: [FRONT_AXLE_X, 0.405, 0.245], fl: [FRONT_AXLE_X, 0.405, -0.35],
  rr: [REAR_AXLE_X, 0.405, 0.245], rl: [REAR_AXLE_X, 0.405, -0.365],
};

const POINTS = ["wheel", "lowerBall", "upperBall", "lowerFront", "lowerRear", "upperFront", "upperRear", "linkOuter", "linkInner",
  "damperLower", "damperTop", "dropUpper", "dropLower"] as const;

export function pickups(c: Corner, axle: Axle = c[0] === "f" ? hardPoints.front : hardPoints.rear) {
  const side = c[1] === "l" ? -1 : 1;
  const v = ([x, y, z]: number[]) => new THREE.Vector3(x, y, side * z);
  const P = Object.fromEntries(POINTS.map((k) => [k, v(axle[k])])) as Record<(typeof POINTS)[number], THREE.Vector3>;
  return {
    ...P,
    W: P.wheel, L: P.lowerBall, U: P.upperBall, S: P.linkOuter, T: P.linkInner, E: P.damperLower, TOP: P.damperTop,
    /** arm pivot axes: a point and a unit direction (front bush minus rear bush) */
    LI: P.lowerRear, LA: P.lowerFront.clone().sub(P.lowerRear).normalize(),
    UI: P.upperRear, UA: P.upperFront.clone().sub(P.upperRear).normalize(),
    ARB: new THREE.Vector3(axle.arbAxis[0], axle.arbAxis[1], 0),
    dropOn: axle.dropOn as "damper" | "lowerArm",
    J: new THREE.Vector3(...SHAFT_INNER[c]), side,
  };
}

/** The root of f between a and b nearest to `near` (scans for sign changes, then bisects): keeps a solution
 * continuous with the straight-ahead, ride-height position instead of jumping to the linkage's other branch. */
function nearestRoot(f: (x: number) => number, a: number, b: number, near = 0, steps = 240) {
  let best: [number, number] | null = null;
  const g = (x: number) => { try { return f(x); } catch { return NaN; } }; // NaN: the linkage cannot reach x
  let x0 = a, f0 = g(a);
  for (let i = 1; i <= steps; i++) {
    const x1 = a + ((b - a) * i) / steps, f1 = g(x1);
    if (!Number.isNaN(f0) && !Number.isNaN(f1) && f0 < 0 !== f1 < 0 && (!best || Math.abs((x0 + x1) / 2 - near) < Math.abs((best[0] + best[1]) / 2 - near))) best = [x0, x1];
    x0 = x1; f0 = f1;
  }
  if (!best) throw new Error("no solution in range");
  return bisect(f, best[0], best[1]);
}

function bisect(f: (x: number) => number, a: number, b: number, n = 60) {
  let fa = f(a);
  for (let i = 0; i < n; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (fa < 0 === fm < 0) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

const Z = new THREE.Vector3(0, 0, 1);
const turn = (p: THREE.Vector3, o: THREE.Vector3, axis: THREE.Vector3, t: number) => p.clone().sub(o).applyAxisAngle(axis, t).add(o);
const rotationAbout = (o: THREE.Vector3, axis: THREE.Vector3, t: number) => new THREE.Matrix4().makeTranslation(o.x, o.y, o.z)
  .multiply(new THREE.Matrix4().makeRotationAxis(axis, t)).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));

/** Rigid transform taking the triangle (a0, b0, c0) onto (a, b, c). */
function frameMatrix(a0: THREE.Vector3, b0: THREE.Vector3, c0: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  const basis = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    const e1 = q.clone().sub(p).normalize();
    const e2 = r.clone().sub(p).addScaledVector(e1, -r.clone().sub(p).dot(e1)).normalize();
    return new THREE.Matrix4().makeBasis(e1, e2, e1.clone().cross(e2));
  };
  const rot = basis(a, b, c).multiply(basis(a0, b0, c0).transpose());
  return new THREE.Matrix4().makeTranslation(a.x, a.y, a.z).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-a0.x, -a0.y, -a0.z));
}

/** Rotation about `pivot` turning direction d0 onto d, then a translation. */
function alignMatrix(pivot: THREE.Vector3, d0: THREE.Vector3, d: THREE.Vector3, shift = new THREE.Vector3()) {
  const q = new THREE.Quaternion().setFromUnitVectors(d0.clone().normalize(), d.clone().normalize());
  return new THREE.Matrix4().makeTranslation(pivot.x + shift.x, pivot.y + shift.y, pivot.z + shift.z)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

function solve(c: Corner, travel: number, rack: number) {
  const P = pickups(c);
  const dLU = P.U.distanceTo(P.L);
  const tie = P.S.distanceTo(P.T);
  const T = P.T.clone().add(new THREE.Vector3(0, 0, rack));
  const place = (th: number) => {
    const L = turn(P.L, P.LI, P.LA, th);
    const ph = nearestRoot((p) => turn(P.U, P.UI, P.UA, p).distanceTo(L) - dLU, -0.8, 0.8, 0, 64);
    const U = turn(P.U, P.UI, P.UA, ph);
    const k = U.clone().sub(L).normalize();
    // bring the knuckle along with the ball joints, then turn it about their axis until the tie rod fits
    const base = alignMatrix(P.L, P.U.clone().sub(P.L), U.clone().sub(L), L.clone().sub(P.L));
    const S1 = P.S.clone().applyMatrix4(base);
    const a = nearestRoot((t) => turn(S1, L, k, t).distanceTo(T) - tie, -1.2, 1.2);
    const S = turn(S1, L, k, a);
    const K = frameMatrix(P.L, P.U, P.S, L, U, S);
    return { th, ph, L, U, S, K };
  };
  // +/-0.4 rad of lower-arm rotation covers well over +/-80 mm of wheel travel; beyond it the linkage cannot close
  const th = nearestRoot((t) => P.W.clone().applyMatrix4(place(t).K).y - P.W.y - travel, -0.4, 0.4, 0, 40);
  return { P, T, ...place(th) };
}

/** Steering angle of the wheel (degrees; positive = the wheel's front turned towards -z, a left turn). */
function steerOf(K: THREE.Matrix4, side: number) {
  const axis = new THREE.Vector3(0, 0, side).transformDirection(K);
  return THREE.MathUtils.radToDeg(Math.atan2(axis.x, axis.z * side)) * side;
}

/** The wheel's steer angle at a given rack position (for checking the steering range). */
export function steerAtRack(c: Corner, travel: number, rack: number) {
  const s = solve(c, travel, rack);
  return steerOf(s.K, s.P.side);
}

/** Rack travel (metres, +z) that turns this wheel to `steer` degrees at `travel`. */
export function rackFor(c: Corner, travel: number, steer: number) {
  return steer === 0 || c[0] === "r" ? 0 : nearestRoot((r) => steerOf(solve(c, travel, r).K, c[1] === "l" ? -1 : 1) - steer, -0.14, 0.14, 0, 280);
}

export interface Pose {
  travel: number; steer: number; rack: number;
  /** wheel-end group (knuckle, hub, brakes, wheel, tyre...), lower arm, upper arm, tie rod or toe link,
   * damper, spring, drop link, drive shaft, this side's half of the anti-roll bar */
  wheel: THREE.Matrix4; lowerArm: THREE.Matrix4; upperArm: THREE.Matrix4; link: THREE.Matrix4;
  damper: THREE.Matrix4; spring: THREE.Matrix4; dropLink: THREE.Matrix4; shaft: THREE.Matrix4; arb: THREE.Matrix4;
  /** the anti-roll bar's end rotation about its axis (radians) */
  arbTwist: number;
  camber: number; toe: number;
}

/** The corner at `travel` metres of wheel-centre rise (negative = rebound) and, at the front, `steer` degrees.
 * `rack` may be given instead of `steer` (front only). */
export function pose(c: Corner, travel: number, steer = 0, rack = rackFor(c, travel, steer)): Pose {
  const s = solve(c, travel, rack);
  const { P, K, T, S } = s;
  const lowerArm = rotationAbout(P.LI, P.LA, s.th);
  const upperArm = rotationAbout(P.UI, P.UA, s.ph);
  const link = alignMatrix(P.T, P.S.clone().sub(P.T), S.clone().sub(T), T.clone().sub(P.T));
  const E = P.E.clone().applyMatrix4(lowerArm);
  const turned = alignMatrix(P.TOP, P.E.clone().sub(P.TOP), E.clone().sub(P.TOP));
  const damper = new THREE.Matrix4().makeTranslation(...E.clone().sub(P.E.clone().applyMatrix4(turned)).toArray()).multiply(turned);
  const k0 = P.E.clone().sub(P.TOP).normalize(), f = E.distanceTo(P.TOP) / P.E.distanceTo(P.TOP);
  const stretch = new THREE.Matrix4().set(
    1 + (f - 1) * k0.x * k0.x, (f - 1) * k0.x * k0.y, (f - 1) * k0.x * k0.z, 0,
    (f - 1) * k0.y * k0.x, 1 + (f - 1) * k0.y * k0.y, (f - 1) * k0.y * k0.z, 0,
    (f - 1) * k0.z * k0.x, (f - 1) * k0.z * k0.y, 1 + (f - 1) * k0.z * k0.z, 0, 0, 0, 0, 1);
  const spring = new THREE.Matrix4().makeTranslation(P.TOP.x, P.TOP.y, P.TOP.z).multiply(turned.clone().setPosition(0, 0, 0))
    .multiply(stretch).multiply(new THREE.Matrix4().makeTranslation(-P.TOP.x, -P.TOP.y, -P.TOP.z));
  // drop link: its upper joint rides on the damper (or lower arm); the bar's end turns about the bar's axis to meet it
  const top = P.dropUpper.clone().applyMatrix4(P.dropOn === "damper" ? damper : lowerArm);
  const len = P.dropUpper.distanceTo(P.dropLower);
  const arbTwist = nearestRoot((t) => turn(P.dropLower, P.ARB, Z, t).distanceTo(top) - len, -0.6, 0.6);
  const arb = rotationAbout(P.ARB, Z, arbTwist);
  const bottom = P.dropLower.clone().applyMatrix4(arb);
  const dropLink = alignMatrix(P.dropLower, P.dropUpper.clone().sub(P.dropLower), top.clone().sub(bottom), bottom.clone().sub(P.dropLower));
  const W = P.W.clone().applyMatrix4(K);
  const shaft = alignMatrix(P.J, P.W.clone().sub(P.J), W.clone().sub(P.J));
  const spin = new THREE.Vector3(0, 0, P.side).transformDirection(K);
  return {
    travel, steer, rack, wheel: K, lowerArm, upperArm, link, damper, spring, dropLink, shaft, arb, arbTwist,
    camber: THREE.MathUtils.radToDeg(Math.asin(spin.y)), toe: steerOf(K, P.side),
  };
}
