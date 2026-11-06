// Wheel envelopes for the body (C3c step 8; on demand: ANALYSE=1): each right-hand wheel's tyre (a 275/45 R22 tyre
// as a solid cylinder) swept over the whole rack stroke and +/-80 mm of travel. Prints the overall box and, in 0.1 m
// slices along the car, the furthest inboard and highest points the tyre reaches: the arch and liner must stay
// outside these. Used for docs/c3c/body-interfaces.md.
import * as THREE from "three";
import { describe, it } from "vitest";
import { TRACK_HALF, TYRE_WIDTH, WHEEL_RADIUS } from "../vehicle/dimensions";
import { type Corner, pickups, pose, rackFor } from "./kinematics";

describe.skipIf(!process.env.ANALYSE)("wheel envelopes", () => {
  it("prints the swept tyre envelope per axle", () => {
    const out: string[] = [];
    for (const c of ["fr", "rr"] as Corner[]) {
      const front = c[0] === "f", W = pickups(c).W;
      const stroke = front ? Math.max(...[-0.08, 0, 0.08].flatMap((t) => [Math.abs(rackFor("fr", t, 35)), Math.abs(rackFor("fr", t, -35))])) : 0;
      const racks = front ? Array.from({ length: 11 }, (_, i) => -stroke + (2 * stroke * i) / 10) : [0];
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a < 72; a++) for (const r of [WHEEL_RADIUS, WHEEL_RADIUS * 0.85]) for (const s of [-1, 1])
        pts.push(new THREE.Vector3(W.x + r * Math.cos((a * Math.PI) / 36), W.y + r * Math.sin((a * Math.PI) / 36), TRACK_HALF + (s * TYRE_WIDTH) / 2));
      const box = new THREE.Box3();
      const slices = new Map<number, { zIn: number; yTop: number }>();
      for (const t of [-0.08, -0.04, 0, 0.04, 0.08]) for (const r of racks) {
        const m = pose(c, t, undefined, r).wheel;
        for (const p of pts) {
          const q = p.clone().applyMatrix4(m);
          box.expandByPoint(q);
          const k = Math.round(q.x * 10) / 10;
          const sl = slices.get(k) ?? { zIn: 9, yTop: -9 };
          sl.zIn = Math.min(sl.zIn, q.z); sl.yTop = Math.max(sl.yTop, q.y);
          slices.set(k, sl);
        }
      }
      const f = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(3)).join(", ");
      out.push(`${c}: rack +/-${(stroke * 1000).toFixed(0)} mm; box [${f(box.min)}] .. [${f(box.max)}]`);
      out.push("  x      inboard z  top y");
      for (const [k, v] of [...slices].sort((a, b) => b[0] - a[0])) out.push(`  ${k.toFixed(1).padStart(5)}  ${v.zIn.toFixed(3)}     ${v.yTop.toFixed(3)}`);
    }
    console.info(out.join("\n"));
  });
});
