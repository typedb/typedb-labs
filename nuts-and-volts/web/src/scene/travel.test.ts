// Suspension and steering clearances through the approved concept envelope (C3c step 2b): every corner at nine
// wheel-travel positions from -80 mm to +80 mm; the front corners at eleven rack positions across the whole rack
// stroke in each of those (the stroke is set so that each front wheel reaches 35 degrees both ways at every
// travel, so the end positions combine full lock with full bump and full rebound). Concept targets, not validated
// production values.
//
// At each pose the corner's moving parts are placed by the linkage solver (kinematics.ts) and the true minimum
// distance between surfaces (sampled every 2.5 mm; pairs within 15 mm found exactly, others reported as farther) is measured against every part that does not move and against
// the corner's other moving groups. The anti-roll bar's half on this side turns with its drop link, so left and
// right articulation (one wheel in bump, the other in rebound) is covered by checking each side through its own
// travel. Designed joints (ball joints, bushes, the damper's eye, the drive shaft's stub in the hub) are listed as
// contacts. The flexible brake hose is left out: it is designed to bend with the wheel (documented in docs/c3c).
//
// Every other pair must keep at least MIN_CLEARANCE. Known body-structure clashes are reported by backlog item
// (docs/body-structure-backlog.md); the body is rebuilt in the next milestone.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { surfacePoints } from "./clearance";
import { type Corner, pose, type Pose, rackFor } from "./kinematics";
import { fixedAround, joint, KNOWN, loadVehicle, movingParts } from "./travel-setup";

const STEP = 0.0025; // surface sampling, one point per 2.5 mm cube: distances are accurate to about 2 mm
const MIN_CLEARANCE = 0.01; // required gap between parts that move relative to each other
const REACH = 0.015; // pairs further apart than this are reported as at least this far apart
const TRAVEL = [-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08];
const LOCK = 35;

/** Rack stroke (each way) at which both front wheels reach LOCK degrees in both directions at every travel. */
export function rackStroke() {
  let stroke = 0;
  for (const c of ["fr", "fl"] as Corner[]) for (const t of TRAVEL) for (const s of [-LOCK, LOCK]) stroke = Math.max(stroke, Math.abs(rackFor(c, t, s)));
  return stroke;
}

/** Points of a set within a box (as a new array). */
function within(p: Float32Array, box: THREE.Box3) {
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y && z >= box.min.z && z <= box.max.z) out.push(x, y, z);
  }
  return new Float32Array(out);
}

/** Points sorted into cubic cells of REACH: key -> codes (part index * 2^24 + point index). */
const key = (x: number, y: number, z: number) =>
  ((Math.floor(x / REACH) + 2048) * 4096 + Math.floor(y / REACH) + 2048) * 4096 + Math.floor(z / REACH) + 2048;
const NEIGHBOURS = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dz) => (dx * 4096 + dy) * 4096 + dz)));
const PART = 2 ** 24;
function cells(sets: Float32Array[], into = new Map<number, number[]>()) {
  sets.forEach((p, part) => {
    for (let i = 0; i < p.length; i += 3) {
      const k = key(p[i], p[i + 1], p[i + 2]);
      const c = into.get(k), code = part * PART + i / 3;
      if (c) c.push(code); else into.set(k, [code]);
    }
  });
  return into;
}

/** Smallest distance from part a's points (cells of a alone) to each part in `others` (cells), for pairs closer than
 * about REACH: calls found(part, distance) once per part reached. The search for a part stops once it is closer than
 * enough(part): the exact depth of an intersection, or of a known body clash, is not needed. */
function nearestParts(a: Float32Array, aCells: Map<number, number[]>, others: Map<number, number[]>, sets: Float32Array[],
  skip: (part: number) => boolean, found: (part: number, d: number, at: number[]) => void, enough: (part: number) => number) {
  const best = new Map<number, number>();
  const where = new Map<number, number>();
  const stop = new Map<number, number>();
  for (const [k, pts] of aCells) {
    for (const n of NEIGHBOURS) {
      const c = others.get(k + n);
      if (!c) continue;
      for (const code of c) {
        const part = Math.floor(code / PART);
        if (skip(part)) continue;
        let s = stop.get(part);
        if (s === undefined) stop.set(part, (s = enough(part) ** 2));
        let b = best.get(part) ?? Infinity;
        if (b < s) continue;
        const q = sets[part], j = (code - part * PART) * 3;
        for (const i3 of pts) {
          const i = i3 * 3;
          const d = (q[j] - a[i]) ** 2 + (q[j + 1] - a[i + 1]) ** 2 + (q[j + 2] - a[i + 2]) ** 2;
          if (d < b) { b = d; where.set(part, i); }
        }
        best.set(part, b);
      }
    }
  }
  for (const [part, d] of best) { const i = where.get(part)!; found(part, Math.sqrt(d), [a[i], a[i + 1], a[i + 2]]); }
}

function moved(p: Float32Array, m: THREE.Matrix4) {
  const e = m.elements, out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

describe("suspension and steering clearances through travel, lock and articulation", () => {
  it(`every moving corner part keeps ${MIN_CLEARANCE * 1000} mm from its neighbours across the envelope`, async () => {
    const { built, objects } = await loadVehicle();
    const stroke = rackStroke();
    const racks = Array.from({ length: 11 }, (_, i) => -stroke + (2 * stroke * i) / 10);
    const report: string[] = [];
    const geometry: string[] = [`rack stroke for ${LOCK} deg at every wheel and travel: +/-${(stroke * 1000).toFixed(1)} mm`];
    const counts = new Map<string, number>();
    const pairs = new Map<string, { d: number; where: string }>();
    for (const c of ["fr", "fl", "rr", "rl"] as Corner[]) {
      const front = c[0] === "f", side = c[1] === "l" ? -1 : 1;
      const arbId = `${front ? "front" : "rear"}-anti-roll-bar`;
      const moving: [string, keyof Pose][] = [...movingParts(c).filter(([id]) => objects.has(id)), [arbId, "arb"]];
      const movingIds = new Set(moving.map(([id]) => id));
      const fixed = fixedAround(c, built).filter((b) => !movingIds.has(b.id));
      // everything the corner can reach: its parts at rest, grown by the travel and the steered tyre's sweep
      const zone = new THREE.Box3();
      for (const [id] of moving) zone.expandByObject(objects.get(id)!);
      zone.expandByScalar(0.2);
      const fixedIds = fixed.map((b) => b.id);
      const fixedSets = fixed.map((b) => surfacePoints(b.object, STEP, undefined, zone, STEP));
      const fixedCells = cells(fixedSets);
      // the anti-roll bar: only this side's half turns with this side's drop link
      const half = new THREE.Box3(new THREE.Vector3(-9, -9, side > 0 ? 0.05 : -9), new THREE.Vector3(9, 9, side > 0 ? 9 : -0.05));
      const local = moving.map(([id, key]) => {
        const p = surfacePoints(objects.get(id)!, STEP, undefined, undefined, STEP);
        return { id, key, p: id === arbId ? within(p, half) : p };
      });
      const poses = TRAVEL.flatMap((t) => (front ? racks.map((r) => pose(c, t, undefined, r)) : [pose(c, t)]));
      const t0 = performance.now();
      process.stderr.write(`${c}: ${local.reduce((n, m) => n + m.p.length / 3, 0)} moving points, ${fixedSets.reduce((n, f) => n + f.length / 3, 0)} fixed points\n`);
      for (const p of poses.slice(0, Number(process.env.TRAVEL_POSES ?? poses.length))) {
        const where = `${c} ${(p.travel * 1000).toFixed(0)} mm, ${front ? `rack ${(p.rack * 1000).toFixed(0)} mm (${p.toe.toFixed(1)} deg)` : "no steer"}`;
        const note = (a: string, b: string, d: number, at: number[]) => {
          const pair = `${a} / ${b}`;
          const known = KNOWN.find(([, re]) => re.test(pair))?.[0];
          if (known) { if (d < MIN_CLEARANCE) counts.set(known, (counts.get(known) ?? 0) + 1); return; }
          const o = pairs.get(pair);
          if (!o || d < o.d) pairs.set(pair, { d, where: `${where} near (${at.map((v) => v.toFixed(3)).join(", ")})` });
        };
        const placed = local.map((m) => moved(m.p, p[m.key] as THREE.Matrix4));
        const own = placed.map((q) => cells([q]));
        const movingCells = new Map<number, number[]>();
        cells(placed, movingCells);
        local.forEach((a, ai) => {
          const enough = (b: string) => (KNOWN.some(([, re]) => re.test(`${a.id} / ${b}`)) ? MIN_CLEARANCE : 0.001);
          nearestParts(placed[ai], own[ai], fixedCells, fixedSets, (f) => joint(a.id, fixedIds[f]), (f, d, at) => note(a.id, fixedIds[f], d, at),
            (f) => enough(fixedIds[f]));
          nearestParts(placed[ai], own[ai], movingCells, placed,
            (b) => b <= ai || local[b].key === a.key || joint(a.id, local[b].id), (b, d, at) => note(a.id, local[b].id, d, at), (b) => enough(local[b].id));
        });
        if (process.env.TRAVEL_POSES) process.stderr.write(`${where}: ${(performance.now() - t0).toFixed(0)} ms\n`);
        if (p.rack === 0 || Math.abs(Math.abs(p.rack) - stroke) < 1e-9 || !front)
          geometry.push(`${where}: camber ${p.camber.toFixed(2)} deg, toe ${p.toe.toFixed(2)} deg, anti-roll bar ${THREE.MathUtils.radToDeg(p.arbTwist).toFixed(1)} deg`);
      }
    }
    const sorted = [...pairs].sort((a, b) => a[1].d - b[1].d);
    report.push(`closest pairs (minimum over the envelope; designed joints and body backlog excluded):`);
    for (const [k, v] of sorted.slice(0, 40)) report.push(`  ${(v.d * 1000).toFixed(1).padStart(5)} mm  ${k}  at ${v.where}`);
    console.info([...geometry, ...report].join("\n"));
    console.info(`known body-structure clashes in motion (poses under ${MIN_CLEARANCE * 1000} mm): ${[...counts].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
    const failing = sorted.filter(([, v]) => v.d < MIN_CLEARANCE).map(([k, v]) => `${k}: ${(v.d * 1000).toFixed(1)} mm at ${v.where}`);
    expect(failing, `pairs closer than ${MIN_CLEARANCE * 1000} mm`).toEqual([]);
  }, 3_600_000);
});
