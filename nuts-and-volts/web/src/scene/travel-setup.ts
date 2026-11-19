// The vehicle as the suspension-travel checks see it (test helper; the app does not import this): every model
// loaded, every corner's moving parts, the designed joints between parts and the known body-structure groups.

import * as THREE from "three";
import { PART_BY_ID } from "../vehicle/manifest";
import { buildVehicle } from "./buildVehicle";
import { loadParts } from "./clearance";
import type { Corner, Pose } from "./kinematics";

export const MODELS = ["corner-fr", "corner-fl", "corner-rr", "corner-rl", "chassis", "steering", "brakes", "thermal", "front-drive-unit", "rear-drive-unit", "hv-battery", "power-electronics", "body-structure", "body-exterior"];

/** Which part of a corner moves how. Ids are given without the corner suffix. */
const WHEEL_GROUP = ["tyre", "wheel", "brake-disc", "caliper", "brake-pad-inner", "brake-pad-outer", "brake-shield", "hub", "hub-nut",
  "wheel-bearing", "knuckle", "wheel-speed-sensor", "epb-actuator"];
export function movingParts(c: Corner): [string, keyof Pose][] {
  const front = c[0] === "f", axle = front ? "front" : "rear", s = c[1];
  return [
    ...WHEEL_GROUP.map((p): [string, keyof Pose] => [`${p}-${c}`, "wheel"]),
    ...[1, 2, 3, 4, 5].map((n): [string, keyof Pose] => [`wheel-nut-${c}-${n}`, "wheel"]),
    [`lower-arm-${c}`, "lowerArm"], [`upper-arm-${c}`, "upperArm"], [front ? `tie-rod-${c}` : `toe-link-${c}`, "link"],
    [`coilover-${c}`, "damper"], [`spring-${c}`, "spring"], [`drop-link-${c}`, "dropLink"], [`${axle}-halfshaft-${s}`, "shaft"],
  ];
}

/** Designed joints between a moving part and its neighbour (patterns over ids). */
const JOINTS: [RegExp, RegExp][] = [
  [/^knuckle-/, /^(lower-arm|upper-arm|tie-rod|toe-link)-/],
  [/^coilover-/, /^(lower-arm|drop-link|spring|top-mount)-/],
  [/^spring-/, /^top-mount-/],
  [/-halfshaft-/, /^(hub|hub-nut|wheel-bearing|knuckle|brake-disc|brake-shield)-/],
  // The check turns each drive shaft as a whole about its inner joint. In reality the inboard stub (beside the
  // motor, splined into the side gear) does not move, so pairs with the shaft's own drive unit are not
  // meaningful here; the static packaging check covers them.
  [/^front-halfshaft-/, /^front-(?!halfshaft)/],
  [/^rear-halfshaft-/, /^rear-(?!halfshaft)/],
  [/^lower-arm-/, /^(front|rear)-subframe$/],
  // the upper arms' bushes in the suspension towers' brackets (D1.2)
  [/^upper-arm-/, /^(front|rear)-tower-[lr]$/],
  [/^tie-rod-/, /^steering-rack$/],
  [/^toe-link-/, /^rear-subframe$/],
  [/^drop-link-/, /-anti-roll-bar$/],
  // the anti-roll bar turns in its rubber bushes, which are clamped to the subframe
  [/-anti-roll-bar$/, /^(front|rear)-subframe$/],
];
export const joint = (a: string, b: string) => JOINTS.some(([p, q]) => (p.test(a) && q.test(b)) || (p.test(b) && q.test(a)));

/** Known body clashes (docs/body-structure-backlog.md): none open. B1-B3 and B6 were resolved by the D1.2 body
 * structure, B4 and B5 (rear doors, arch liners) by the D1.3 exterior; this check covers both in full. */
export const KNOWN: [string, RegExp][] = [];

/** Every part placed as in the app; models loaded from the real compressed files. */
export async function loadVehicle() {
  const units = new Map<string, THREE.Object3D>();
  for (const m of MODELS) for (const [id, o] of await loadParts(m)) units.set(id, o);
  const built = buildVehicle(units);
  for (const b of built) {
    if (units.has(b.id)) continue;
    b.object.position.copy(b.position);
    b.object.rotation.copy(b.rotation);
    b.object.updateMatrixWorld(true);
  }
  return { built, objects: new Map(built.map((b) => [b.id, b.object])) };
}

/** The parts around a corner that do not move with it (panels, the underbody and brake hoses left out). */
export function fixedAround(c: Corner, built: Awaited<ReturnType<typeof loadVehicle>>["built"]) {
  const moving = new Set(movingParts(c).map(([id]) => id));
  const zone = new THREE.Box3();
  for (const b of built) if (moving.has(b.id)) zone.expandByObject(b.object);
  zone.expandByScalar(0.25);
  return built.filter((b) => !moving.has(b.id) && b.id !== "underbody" && !b.id.startsWith("brake-hose-")
    && PART_BY_ID.get(b.id)!.shape.kind !== "panel" && zone.intersectsBox(new THREE.Box3().setFromObject(b.object)));
}
