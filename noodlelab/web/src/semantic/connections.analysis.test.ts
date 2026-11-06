// Connection check (C3c step 6; on demand: TYPEDB_INTEGRATION=1 ANALYSE=1): every mechanical, power and fluid
// connection TypeDB holds, against the drawn vehicle. For each pair the smallest distance between the two parts'
// surfaces (sampled every 5 mm) is measured in the assembled vehicle; pairs further apart than 15 mm are listed, so
// floating or wrongly routed parts show up. Data connections are left out: a signal needs no contact. A light check,
// not a geometric validation: reviewed by eye, summarised in docs/c3c/README.md.

import * as THREE from "three";
import { describe, it } from "vitest";
import { surfacePoints } from "../scene/clearance";
import { loadVehicle } from "../scene/travel-setup";

const API = process.env.API_URL ?? "http://127.0.0.1:8000";
const REACH = 0.05;

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}/api/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return ((await r.json()) as { data: T }).data;
}

function nearest(a: Float32Array, b: Float32Array) {
  const key = (x: number, y: number, z: number) => `${Math.floor(x / REACH)},${Math.floor(y / REACH)},${Math.floor(z / REACH)}`;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < b.length; i += 3) {
    const k = key(b[i], b[i + 1], b[i + 2]);
    const c = cells.get(k); if (c) c.push(i); else cells.set(k, [i]);
  }
  let best = REACH * REACH;
  for (let i = 0; i < a.length; i += 3) {
    const gx = Math.floor(a[i] / REACH), gy = Math.floor(a[i + 1] / REACH), gz = Math.floor(a[i + 2] / REACH);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cells.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
        const d = (b[j] - a[i]) ** 2 + (b[j + 1] - a[i + 1]) ** 2 + (b[j + 2] - a[i + 2]) ** 2;
        if (d < best) best = d;
      }
    }
  }
  return Math.sqrt(best);
}

describe.runIf(process.env.TYPEDB_INTEGRATION === "1" && process.env.ANALYSE)("connections against the drawn vehicle", () => {
  it("lists physical connections whose parts do not meet", async () => {
    const { objects } = await loadVehicle();
    const components = await get<{ id: string }[]>("components");
    const pairs = new Map<string, string>();
    for (const { id } of components) {
      const rel = await get<{ connections: { kind: string; other: string }[] }>(`components/${id}/relationships`);
      for (const c of rel.connections) {
        if (c.kind === "data-connection") continue;
        const k = [id, c.other].sort().join(" / ");
        pairs.set(k, c.kind.replace("-connection", ""));
      }
    }
    const points = new Map<string, Float32Array>();
    const pts = (id: string) => {
      let p = points.get(id);
      if (!p) points.set(id, (p = surfacePoints(objects.get(id)!, 0.005, undefined, undefined, 0.005)));
      return p;
    };
    const far: string[] = [];
    for (const [k, kind] of pairs) {
      const [a, b] = k.split(" / ");
      if (!objects.has(a) || !objects.has(b)) { far.push(`  (not drawn)  ${kind.padEnd(10)} ${k}`); continue; }
      const ba = new THREE.Box3().setFromObject(objects.get(a)!), bb = new THREE.Box3().setFromObject(objects.get(b)!);
      const gap = ba.distanceToPoint(bb.clampPoint(ba.getCenter(new THREE.Vector3()), new THREE.Vector3()));
      const d = gap > REACH ? gap : nearest(pts(a), pts(b));
      if (d > 0.015) far.push(`${(d * 1000).toFixed(0).padStart(6)} mm  ${kind.padEnd(10)} ${k}`);
    }
    far.sort((x, y) => parseFloat(y) - parseFloat(x));
    console.info([`${pairs.size} physical connections; ${far.length} with parts more than 15 mm apart:`, ...far].join("\n"));
  }, 1_800_000);
});
