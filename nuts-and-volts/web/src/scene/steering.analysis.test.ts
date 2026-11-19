// Steering and toe-link searches (run on demand: ANALYSE=1), used to choose the hard points in
// web/src/vehicle/suspension.json (docs/c3c/suspension-architecture.md):
//   steering search   steering-arm length, angle and height (RACKX, ARMY, ARMR, BETA lists), then the tie rod's inner
//                     joint for the least bump steer; reports rack travel for +/-35 deg at -80/0/+80 mm, the other
//                     wheel's angle (Ackermann) and the steer at which the linkage would lock
//   rear toe link     (REAR=1) the toe link's inner joint for little toe change, slightly in at bump
//   fine tie rod      the front tie rod's inner joint for the current steering arm, in 2.5 mm steps
import { afterEach, it } from "vitest";
import * as THREE from "three";
import hp from "../vehicle/suspension.json";
import { pickups, pose, rackFor, steerAtRack } from "./kinematics";

// the searches try hard points in place: put the file's values back after each one
const saved = structuredClone(hp);
afterEach(() => Object.assign(hp.front, structuredClone(saved.front)) && Object.assign(hp.rear, structuredClone(saved.rear)));

const toe = (t: number) => { try { return pose("fr", t, 0, 0).toe; } catch { return NaN; } };
it.skipIf(!process.env.ANALYSE)("steering search", () => {
  const P = pickups("fr");
  const k = P.U.clone().sub(P.L).normalize();
  const res: string[] = [];
  const list = (k: string, d: number[]) => (process.env[k] ? process.env[k]!.split(",").map(Number) : d);
  for (const rackX of list("RACKX", [1.40, 1.42])) for (const y of list("ARMY", [0.44, 0.48, 0.52])) for (const r of list("ARMR", [0.12, 0.135, 0.15])) for (const beta of list("BETA", [0, 4, 8, 12])) {
    const ax = P.L.clone().addScaledVector(k, (y - P.L.y) / k.y);
    const b = THREE.MathUtils.degToRad(beta);
    const S = [ax.x - r * Math.cos(b), y, ax.z - r * Math.sin(b)];
    if (S[0] < rackX - 0.02) continue;
    hp.front.linkOuter = S;
    let best: { e: number; T: number[] } | null = null;
    for (let ty = y - 0.06; ty <= y + 0.0601; ty += 0.005) for (let tz = 0.34; tz <= 0.4801; tz += 0.01) {
      hp.front.linkInner = [rackX, ty, tz];
      const e = Math.max(...[-0.08, -0.04, 0.04, 0.08].map((t) => Math.abs(toe(t))));
      if (e > 0.6) continue;
      if (!Number.isNaN(e) && (!best || e < best.e)) best = { e, T: [rackX, +ty.toFixed(3), +tz.toFixed(3)] };
    }
    if (!best) continue;
    hp.front.linkInner = best.T;
    try {
      const racks = [-0.08, 0, 0.08].flatMap((t) => [rackFor("fr", t, 35), rackFor("fr", t, -35)]);
      const max = Math.max(...racks.map(Math.abs));
      const outer = pose("fl", 0, 0, rackFor("fr", 0, 35)).toe;
      // lock margin: the largest steer reachable either way at full rebound and bump (stepping the rack until the linkage locks)
      let lim = 90;
      for (const t of [-0.08, 0.08]) for (const sgn of [-1, 1]) {
        let best = 0;
        for (let r = 0; r <= 0.14; r += 0.002) { try { best = Math.max(best, sgn * steerAtRack("fr", t, sgn * r)); } catch { break; } }
        lim = Math.min(lim, best);
      }
      res.push(`rack x ${rackX} ${(max * 1000).toFixed(1)} mm  S ${S.map((v) => v.toFixed(3))} r ${r} beta ${beta}  T ${best.T}  bump steer ${best.e.toFixed(2)}  outer ${outer.toFixed(1)} lock limit ${lim.toFixed(0)}  racks ${racks.map((v) => (v * 1000).toFixed(0)).join(" ")}`);
    } catch (e) { res.push(`fail S ${S.map((v) => v.toFixed(3))} ${String(e)}`); }
  }
  console.info(res.sort().join("\n"));
}, 1_800_000);

it.skipIf(!process.env.ANALYSE || !process.env.REAR)("rear toe link search", () => {
  const res: string[] = [];
  const S = hp.rear.linkOuter;
  for (let ty = S[1] - 0.1; ty <= S[1] + 0.1001; ty += 0.005) for (let tz = 0.32; tz <= 0.5201; tz += 0.01) for (const tx of [S[0] + 0.03, S[0], S[0] - 0.03]) {
    hp.rear.linkInner = [+tx.toFixed(3), +ty.toFixed(3), +tz.toFixed(2)];
    try {
      const toes = [-0.08, -0.04, 0.04, 0.08].map((t) => pose("rr", t).toe);
      // slight toe-in in bump (positive), little change in rebound
      const score = Math.max(Math.abs(toes[0]), Math.abs(toes[1])) + Math.abs(toes[3] - 0.15);
      res.push(`${score.toFixed(3)} T ${hp.rear.linkInner} toes ${toes.map((v) => v.toFixed(2)).join(" ")}`);
    } catch { /* not closable */ }
  }
  console.info(res.sort().slice(0, 8).join("\n"));
}, 600_000);

it.skipIf(!process.env.ANALYSE)("fine tie-rod search", () => {
  const rows: string[] = [];
  for (const S of [hp.front.linkOuter]) {
    hp.front.linkOuter = S;
    const hp0 = [...hp.front.linkInner];
    let best = { e: 9, T: [0, 0, 0], toes: [] as number[] };
    for (let ty = S[1] - 0.03; ty <= S[1] + 0.0301; ty += 0.0025) for (let tz = 0.41; tz <= 0.4701; tz += 0.0025) {
      hp.front.linkInner = [hp0[0], +ty.toFixed(4), +tz.toFixed(4)];
      try {
        const toes = [-0.08, -0.04, 0.04, 0.08].map((t) => pose("fr", t, 0, 0).toe);
        const e = Math.max(...toes.map(Math.abs));
        if (e < best.e) best = { e, T: hp.front.linkInner, toes };
      } catch { /* not closable */ }
    }
    rows.push(`S ${S} T ${best.T} bump steer ${best.e.toFixed(3)} toes ${best.toes.map((v) => v.toFixed(2)).join(" ")}`);
  }
  console.info(rows.join("\n"));
}, 900_000);
