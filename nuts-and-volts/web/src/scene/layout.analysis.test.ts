// Layout study (run on demand: ANALYSE=1): the suspension hard points in web/src/vehicle/suspension.json, with
// every moving part reduced to capsules (and the wheel to a tyre-and-rim solid), checked against the real meshes of
// the parts that do not move, over a dense grid of travel and steer. Fast enough to tune hard points before the
// Blender models are rebuilt; the mesh check (travel.test.ts) is the authority.

import * as THREE from "three";
import { describe, it } from "vitest";
import { surfacePoints } from "./clearance";
import { type Corner, pickups, pose, type Pose, rackFor } from "./kinematics";
import { fixedAround, loadVehicle } from "./travel-setup";

type Cap = { id: string; group: keyof Pose; a: THREE.Vector3; b: THREE.Vector3; r: number };

function capsules(c: Corner): Cap[] {
  const P = pickups(c);
  const front = c[0] === "f";
  const axis = P.TOP.clone().sub(P.E).normalize();
  const along = (t: number) => P.E.clone().addScaledVector(axis, t);
  const across = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize(); // the fork's leg spacing
  const hub = P.W.clone().add(new THREE.Vector3(0, 0, -0.06 * P.side));
  const ca = (front ? 1 : 1) * pickups(c).side; // calliper drawn at its angle in the wheel plane
  void ca;
  const angle = (front ? 0.94 : Math.PI);
  const cal = (t: number) => P.W.clone().add(new THREE.Vector3(0.168 * Math.cos(angle + t), 0.168 * Math.sin(angle + t), -0.07 * P.side));
  const shaftOut = P.W.clone().add(new THREE.Vector3(0, 0, -0.2 * P.side));
  const link = front ? "tie-rod" : "toe-link";
  const caps: Cap[] = [
    // knuckle: neck to the upper joint, boss to the lower joint and the steering / toe arm
    { id: "knuckle", group: "wheel", a: hub.clone().add(new THREE.Vector3(0, 0.08, 0)), b: P.U, r: 0.024 },
    { id: "knuckle", group: "wheel", a: hub.clone().add(new THREE.Vector3(0, -0.06, 0)), b: P.L, r: 0.026 },
    { id: "knuckle", group: "wheel", a: hub, b: P.S, r: 0.02 },
    { id: "caliper", group: "wheel", a: cal(-0.55), b: cal(0.55), r: 0.045 },
    { id: "lower-arm", group: "lowerArm", a: P.L, b: P.lowerFront, r: 0.022 },
    { id: "lower-arm", group: "lowerArm", a: P.L, b: P.lowerRear, r: 0.022 },
    { id: "upper-arm", group: "upperArm", a: P.U, b: P.upperFront, r: 0.018 },
    { id: "upper-arm", group: "upperArm", a: P.U, b: P.upperRear, r: 0.018 },
    { id: "upper-arm", group: "upperArm", a: P.U, b: P.U, r: 0.03 },
    { id: link, group: "link", a: P.S, b: P.T, r: 0.014 },
    { id: link, group: "link", a: P.S, b: P.S, r: 0.026 },
    { id: link, group: "link", a: P.T, b: P.T.clone().lerp(P.S, 0.4), r: front ? 0.028 : 0.014 },
    { id: "coilover", group: "damper", a: along(0.19), b: along(0.36), r: 0.028 },
    { id: "coilover", group: "damper", a: P.E.clone().addScaledVector(across, -0.12), b: P.E.clone().addScaledVector(across, 0.12), r: 0.022 },
    { id: "coilover", group: "damper", a: P.E.clone().addScaledVector(across, -0.115), b: along(0.19).addScaledVector(across, -0.115), r: 0.014 },
    { id: "coilover", group: "damper", a: P.E.clone().addScaledVector(across, 0.115), b: along(0.19).addScaledVector(across, 0.115), r: 0.014 },
    { id: "coilover", group: "damper", a: along(0.36), b: P.TOP, r: 0.012 },
    { id: "spring", group: "spring", a: along(0.29), b: P.TOP.clone().addScaledVector(axis, -0.01), r: 0.064 },
    { id: "drop-link", group: "dropLink", a: P.dropLower, b: P.dropUpper, r: 0.01 },
    { id: "drop-link", group: "dropLink", a: P.dropLower, b: P.dropLower, r: 0.024 },
    { id: "drop-link", group: "dropLink", a: P.dropUpper, b: P.dropUpper, r: 0.024 },
    { id: "anti-roll-bar", group: "arb", a: P.dropLower, b: new THREE.Vector3(P.ARB.x, P.ARB.y, 0.36 * P.side), r: 0.014 },
    { id: "halfshaft", group: "shaft", a: P.J.clone().add(new THREE.Vector3(0, 0, 0.12 * P.side)), b: shaftOut, r: 0.02 },
    { id: "halfshaft", group: "shaft", a: shaftOut, b: P.W.clone().add(new THREE.Vector3(0, 0, -0.1 * P.side)), r: 0.048 },
  ];
  return caps;
}

const segDist = (p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3) => {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a < 1e-12 && e < 1e-12) return p1.distanceTo(p2);
  if (a < 1e-12) t = THREE.MathUtils.clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e < 1e-12) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
};

/** Distance from a point (in the wheel's own frame: origin at the wheel centre, axis z outwards) to the wheel:
 * tyre annulus 0.28-0.405 m, rim barrel shell, closed outer face, open inner side. */
function wheelDistance(p: THREE.Vector3) {
  const HW = 0.1375, R = 0.405, RIM = 0.26;
  const rad = Math.hypot(p.x, p.y), a = p.z;
  if (a >= -HW && a <= HW) return rad > R ? rad - R : rad >= RIM ? -Math.min(rad - RIM, R - rad, HW - Math.abs(a)) : RIM - rad;
  if (a > HW) return rad <= R ? a - HW : Math.hypot(a - HW, rad - R);
  if (rad < RIM) return Math.hypot(-HW - a, RIM - rad);
  if (rad <= R) return -HW - a;
  return Math.hypot(-HW - a, rad - R);
}

/** Distance from a point to a segment, without allocating. */
function pointSeg(x: number, y: number, z: number, a: THREE.Vector3, b: THREE.Vector3) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l = dx * dx + dy * dy + dz * dz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / l)) : 0;
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy, z - a.z - t * dz);
}

/** A part's points in a 5 cm grid: near(a, b, r) lists the points within the box round segment ab grown by r. */
function index(id: string, p: Float32Array) {
  const C = 0.05, cells = new Map<string, number[]>();
  for (let i = 0; i < p.length; i += 3) {
    const k = `${Math.floor(p[i] / C)},${Math.floor(p[i + 1] / C)},${Math.floor(p[i + 2] / C)}`;
    const c = cells.get(k); if (c) c.push(i); else cells.set(k, [i]);
  }
  return {
    id, p,
    near(a: THREE.Vector3, b: THREE.Vector3, r: number) {
      const out: number[] = [];
      const lo = [Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r].map((v) => Math.floor(v / C));
      const hi = [Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r].map((v) => Math.floor(v / C));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const c = cells.get(`${x},${y},${z}`); if (c) out.push(...c);
      }
      return out;
    },
  };
}

const designed = (a: string, b: string, front: boolean) => {
  const pairs = [["knuckle", "lower-arm"], ["knuckle", "upper-arm"], ["knuckle", front ? "tie-rod" : "toe-link"], ["coilover", "lower-arm"],
    ["coilover", "spring"], ["coilover", "drop-link"], ["drop-link", "anti-roll-bar"], ["halfshaft", "knuckle"], ["halfshaft", "caliper"]];
  return pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
};

describe.skipIf(!process.env.ANALYSE)("suspension layout study", () => {
  it("clearances over a dense grid", async () => {
    const { built } = await loadVehicle();
    const out: string[] = [];
    for (const c of ["fr", "rr"] as Corner[]) {
      const front = c[0] === "f";
      const P = pickups(c);
      const excluded = /^(front|rear)-anti-roll-bar$|^steering-rack$|^top-mount-|^brake-hose-|^(front|rear)-subframe$/;
      const fixed = fixedAround(c, built).filter((b) => !excluded.test(b.id));
      const pts = fixed.map((b) => index(b.id, surfacePoints(b.object, 0.006)));
      const caps = capsules(c);
      const best = new Map<string, { d: number; where: string }>();
      const note = (pair: string, d: number, where: string) => { const o = best.get(pair); if (!o || d < o.d) best.set(pair, { d, where }); };
      const travels = [-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08];
      const steers = front ? [-35, -28, -21, -14, -7, 0, 7, 14, 21, 28, 35] : [0];
      const rows: string[] = [];
      for (const t of travels) for (const s of steers) {
        const p = pose(c, t, s);
        const where = `${(t * 1000).toFixed(0)} mm ${s} deg`;
        const placed = caps.map((k) => ({ ...k, a: k.a.clone().applyMatrix4(p[k.group] as THREE.Matrix4), b: k.b.clone().applyMatrix4(p[k.group] as THREE.Matrix4) }));
        const inv = (p.wheel as THREE.Matrix4).clone().invert();
        const toWheel = (v: THREE.Vector3) => { const q = v.clone().applyMatrix4(inv).sub(P.W); q.z *= P.side; return q; };
        // capsules against each other
        for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
          const A = placed[i], B = placed[j];
          if (A.id === B.id || A.group === B.group || designed(A.id, B.id, front)) continue;
          note(`${A.id} / ${B.id}`, segDist(A.a, A.b, B.a, B.b) - A.r - B.r, where);
        }
        // capsules against the wheel (tyre and rim)
        for (const A of placed) {
          if (A.group === "wheel" || A.id === "halfshaft") continue;
          let d = Infinity;
          for (let k = 0; k <= 40; k++) d = Math.min(d, wheelDistance(toWheel(A.a.clone().lerp(A.b, k / 40))) - A.r);
          note(`wheel / ${A.id}`, d, where);
        }
        // capsules and the wheel against the fixed parts (points near each capsule, from a grid)
        for (const f of pts) {
          for (const A of placed) {
            if ((A.id === "lower-arm" && /subframe/.test(f.id)) || (A.id === "spring" && /top-mount/.test(f.id))) continue;
            const near = f.near(A.a, A.b, A.r + 0.05);
            let d = Infinity;
            for (const i of near) d = Math.min(d, pointSeg(f.p[i], f.p[i + 1], f.p[i + 2], A.a, A.b) - A.r);
            if (d < 0.05) note(`${A.id} / ${f.id}`, d, where);
          }
          let d = Infinity;
          const v = new THREE.Vector3();
          for (const i of f.near(P.W.clone().applyMatrix4(p.wheel), P.W.clone().applyMatrix4(p.wheel), 0.45)) d = Math.min(d, wheelDistance(toWheel(v.set(f.p[i], f.p[i + 1], f.p[i + 2]))));
          if (d < 0.05) note(`wheel / ${f.id}`, d, where);
        }
        rows.push(`${c} ${where}: camber ${p.camber.toFixed(2)} toe ${p.toe.toFixed(2)} rack ${(p.rack * 1000).toFixed(1)} arb ${(p.arbTwist * 57.3).toFixed(1)}`);
      }
      out.push(`== ${c}: closest pairs (mm), worst pose`);
      for (const [k, v] of [...best].sort((a, b) => a[1].d - b[1].d)) if (v.d < 0.03) out.push(`${(v.d * 1000).toFixed(1).padStart(7)}  ${k}  @ ${v.where}`);
      out.push(...rows.filter((r) => / 0 deg|35 deg|-35 deg/.test(r)));
      if (front) {
        // steering geometry: axis, rack needed per wheel, Ackermann (outer wheel when the inner one is at 35 deg)
        const k = P.U.clone().sub(P.L);
        const kpi = Math.atan2(-k.z * P.side, k.y) * 57.3, caster = Math.atan2(-k.x, k.y) * 57.3;
        const ground = P.L.clone().addScaledVector(k, -P.L.y / k.y);
        out.push(`KPI ${kpi.toFixed(1)} caster ${caster.toFixed(1)} scrub ${((P.W.z - ground.z) * P.side * 1000).toFixed(0)} mm trail ${((ground.x - P.W.x) * 1000).toFixed(0)} mm`);
        for (const t of [-0.08, 0, 0.08]) {
          const rIn = rackFor("fr", t, 35), rOut = rackFor("fr", t, -35);
          const outer = pose("fl", t, 0, rIn).toe;
          out.push(`travel ${t * 1000}: rack for +35 ${(rIn * 1000).toFixed(1)} mm, -35 ${(rOut * 1000).toFixed(1)} mm; left wheel at that rack ${outer.toFixed(1)} deg`);
        }
      }
    }
    console.info(out.join("\n"));
  }, 1_800_000);
});
