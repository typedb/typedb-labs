// The body shell: one smooth surface lofted through cross-sections along the car's length,
// then cut into separate panels (bonnet, doors, glass, bumpers...) so each can move on its own.
//
// "Lofting" means: describe the car's outline at many slices from tail to nose, then join
// neighbouring slices with triangles. All panels come from one surface, so they fit together exactly.

import * as THREE from "three";
import { clamp, curve, lerp } from "./curve";
import { AXLE_Y, FRONT_AXLE_X, NOSE_X, REAR_AXLE_X, TAIL_X } from "./dimensions";

// ---- Side profile and plan view (hand-tuned key points: [x, value]) -----------------------------

/** Height of the roof / bonnet / rear window along the centre line. */
const topLine = curve([
  [TAIL_X, 1.04], [-2.39, 1.2], [-2.3, 1.38], [-2.14, 1.475], [-1.85, 1.53], [-1.2, 1.6],
  [-0.3, 1.63], [0.1, 1.61], [0.45, 1.42], [0.9, 1.15], [1.4, 1.09], [1.95, 1.04],
  [2.2, 0.98], [NOSE_X, 0.88],
]);
/** Shoulder (waist) line: where the painted body meets the windows. Rises towards the rear. */
const beltLine = curve([[TAIL_X, 1.17], [-2.15, 1.27], [-1.5, 1.23], [-0.6, 1.18], [0.3, 1.15], [0.9, 1.13], [NOSE_X, 1.0]]);
/** Lowest edge of the body sides (sill), rising at the bumpers. */
const bottomLine = curve([[TAIL_X, 0.5], [-2.22, 0.41], [-1.85, 0.34], [1.8, 0.34], [2.2, 0.39], [NOSE_X, 0.45]]);
/** Half the body width. */
const halfWidth = curve([
  [TAIL_X, 0.76], [-2.3, 0.88], [-2.1, 0.94], [-1.75, 0.978], [-1.25, 0.976], [-0.6, 0.952], [0.6, 0.948], [1.15, 0.96],
  [1.6, 0.962], [1.95, 0.935], [2.22, 0.86], [NOSE_X, 0.74],
]);
/** Half the roof width (the glasshouse leans inwards: "tumblehome"). */
const roofHalfWidth = curve([[TAIL_X, 0.56], [-1.9, 0.6], [-0.6, 0.65], [0.3, 0.66], [1.0, 0.72]]);

// ---- Cross-sections -------------------------------------------------------------------------------

type Tag = "under" | "lower" | "glass" | "roofedge" | "top";
/** One stretch of the half cross-section (bottom centre → top centre), its tag and how finely to sample it. */
const SEGMENTS: { tag: Tag; steps: number }[] = [
  { tag: "under", steps: 7 }, // P0-P1 flat floor
  { tag: "lower", steps: 4 }, // P1-P2 bottom corner
  { tag: "lower", steps: 6 }, // P2-P3 lower side
  { tag: "lower", steps: 7 }, // P3-P4 upper side
  { tag: "lower", steps: 3 }, // P4-P5 shoulder
  { tag: "lower", steps: 2 }, // P5-P6 belt seal
  { tag: "glass", steps: 9 }, // P6-P7 side window
  { tag: "roofedge", steps: 3 }, // P7-P8 roof rail
  { tag: "top", steps: 12 }, // P8-P9 roof / bonnet / windscreen
];
const HALF_STEPS = SEGMENTS.reduce((s, g) => s + g.steps, 0);

/** Key points of the right half of the cross-section at station x, as [z, y]. */
function sectionKeys(x: number): [number, number][] {
  const top = topLine(x);
  const belt = Math.min(beltLine(x), top - 0.015);
  const yb = bottomLine(x);
  const w = halfWidth(x);
  const wr = roofHalfWidth(x);
  // g = how tall the glasshouse is here (0 over the bonnet, 1 at full height).
  const g = clamp((top - belt) / 0.4, 0, 1);
  return [
    [0, yb],
    [w - 0.12, yb],
    [w - 0.015, yb + 0.12],
    [w, lerp(yb, belt, 0.45)],
    [w - 0.02, belt - 0.08],
    [w - 0.085, belt],
    [w - 0.085 - 0.04 * g, belt + 0.015 * g],
    [lerp(w - 0.1, wr + 0.03, g), lerp(belt, top - 0.06, g)],
    [lerp(w - 0.16, wr - 0.06, g), top - 0.008],
    [0, top + 0.025],
  ];
}

/** Uniform Catmull-Rom between p1 and p2 (p0, p3 are neighbours). */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Full closed ring at station x: bottom centre → right side → top centre → left side. Points are [z, y]. */
function sectionRing(x: number): [number, number][] {
  const k = sectionKeys(x);
  const half: [number, number][] = [];
  for (let s = 0; s < SEGMENTS.length; s++) {
    const p0 = k[Math.max(0, s - 1)];
    const p1 = k[s];
    const p2 = k[s + 1];
    const p3 = k[Math.min(k.length - 1, s + 2)];
    for (let i = 0; i < SEGMENTS[s].steps; i++) {
      const t = i / SEGMENTS[s].steps;
      half.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  half.push(k[k.length - 1]); // HALF_STEPS + 1 points
  const left = half.slice(1, -1).reverse().map(([z, y]) => [-z, y] as [number, number]);
  return [...half, ...left]; // 2 * HALF_STEPS points, closed
}

/** Tag and window-row index of each ring segment j → j+1. */
type RingSegment = { tag: Tag; seg: number; local: number; count: number };
const RING_SEGMENTS: RingSegment[] = (() => {
  const half: RingSegment[] = [];
  SEGMENTS.forEach((s, k) => {
    for (let i = 0; i < s.steps; i++) half.push({ tag: s.tag, seg: k, local: i, count: s.steps });
  });
  return [...half, ...half.slice().reverse()];
})();

// ---- Panels ---------------------------------------------------------------------------------------

export const PANEL_IDS = [
  "bonnet", "windscreen", "roof", "tailgate", "tailgate-glass", "front-bumper", "rear-bumper", "underbody",
  "fender-l", "fender-r", "door-fl", "door-fr", "door-rl", "door-rr",
  "glass-fl", "glass-fr", "glass-rl", "glass-rr", "quarter-l", "quarter-r",
  "quarter-glass-l", "quarter-glass-r", "body-side-l", "body-side-r", "rocker-l", "rocker-r", "rear-diffuser",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

const FRONT_SPLIT = 2.04; // front bumper starts here
const REAR_SPLIT = -2.08; // rear bumper ends here
const SCREEN_BASE = 0.9; // bonnet / windscreen boundary
const SCREEN_TOP = 0.2; // windscreen / roof boundary
const B_PILLAR: [number, number] = [-0.15, -0.05];
const DOOR_SPLIT = -0.1; // front door / rear door
const REAR_DOOR_END = -1.16;

type Where = "side" | "front-cap" | "rear-cap";

function classify(x: number, y: number, z: number, seg: RingSegment, where: Where): PanelId {
  const s = z >= 0 ? "r" : "l";
  const frame = seg.local === 0 || seg.local === seg.count - 1;
  // The rear window wraps from the roof down the back: it is the window rows of the outline.
  const rearUpper = () => ((seg.tag === "glass" || seg.tag === "top") && !frame ? "tailgate-glass" : "tailgate");
  if (where === "front-cap") return seg.tag === "lower" || seg.tag === "under" ? "front-bumper" : "bonnet";
  if (where === "rear-cap") {
    if (seg.tag !== "lower" && seg.tag !== "under") return rearUpper();
    // By outline segment, not height, so the shut lines run cleanly across the curved end.
    return seg.seg >= 3 ? "tailgate" : seg.seg <= 1 ? "rear-diffuser" : "rear-bumper";
  }
  const yb = bottomLine(x);
  switch (seg.tag) {
    case "under":
      return x > FRONT_SPLIT ? "front-bumper" : x < REAR_SPLIT ? "rear-bumper" : "underbody";
    case "lower":
      if (x > FRONT_SPLIT) return "front-bumper";
      if (x > SCREEN_BASE) return `fender-${s}`;
      if (x > REAR_DOOR_END - 0.2 && x < SCREEN_BASE + 0.12 && y < yb + 0.12) return `rocker-${s}`; // black sill trim
      if (x > DOOR_SPLIT) return `door-f${s}`;
      if (x > REAR_DOOR_END) return `door-r${s}`;
      if (x > REAR_SPLIT) return `quarter-${s}`;
      return y < 0.76 ? "rear-bumper" : `quarter-${s}`;
    case "glass": {
      if (x > SCREEN_BASE) return `fender-${s}`;
      if (x > 0.26) return `body-side-${s}`; // A-pillar
      if (x > B_PILLAR[1]) return frame ? `door-f${s}` : `glass-f${s}`;
      if (x > B_PILLAR[0]) return `body-side-${s}`;
      if (x > REAR_DOOR_END + 0.06) return frame ? `door-r${s}` : `glass-r${s}`;
      if (x > -1.38) return `body-side-${s}`; // C-pillar
      if (x > -1.95) return frame ? `body-side-${s}` : `quarter-glass-${s}`;
      return `body-side-${s}`;
    }
    case "roofedge":
      return x > SCREEN_BASE ? "bonnet" : `body-side-${s}`;
    case "top":
      if (x > SCREEN_BASE) return "bonnet";
      if (x > SCREEN_TOP) return "windscreen";
      if (x > -1.98) return "roof";
      return rearUpper();
  }
}

// ---- Wheel arches ---------------------------------------------------------------------------------

const ARCH_RADIUS = 0.455;
const ARCH_MIN_Z = 0.45;

/** If (x, y) on the side lies inside a wheel arch, return it moved onto the arch edge. */
function archProject(x: number, y: number): [number, number, boolean] {
  for (const ax of [FRONT_AXLE_X, REAR_AXLE_X]) {
    const dx = x - ax;
    const dy = y - AXLE_Y;
    const d = Math.hypot(dx, dy);
    if (d < ARCH_RADIUS) {
      const k = ARCH_RADIUS / Math.max(d, 1e-6);
      return [ax + dx * k, AXLE_Y + dy * k, true];
    }
  }
  return [x, y, false];
}

// ---- Build ----------------------------------------------------------------------------------------

export interface BodyPanel {
  id: PanelId;
  geometry: THREE.BufferGeometry; // centred on `center`
  center: THREE.Vector3; // assembled position of the panel's centre, vehicle coordinates
}

const STATIONS = 150;
const CAP_ROUND = 7; // rings that round off each end
const CAP_FILL = 10; // rings that fill each end face

export function buildBodyPanels(): BodyPanel[] {
  // 1. Rings of points: rear end face, rear rounding, main body, front rounding, front end face.
  type Ring = { x: number[]; pts: [number, number][]; where: Where };
  const rings: Ring[] = [];
  const centroid = (pts: [number, number][]): [number, number] => {
    let z = 0, y = 0;
    for (const p of pts) { z += p[0]; y += p[1]; }
    return [z / pts.length, y / pts.length];
  };
  const capRings = (end: number, dir: 1 | -1, radius: number, bulgeDepth: number): Ring[] => {
    const base = sectionRing(end);
    const c = centroid(base);
    const halfW = Math.max(...base.map((p) => Math.abs(p[0])));
    const halfH = (Math.max(...base.map((p) => p[1])) - Math.min(...base.map((p) => p[1]))) / 2;
    const where: Where = dir > 0 ? "front-cap" : "rear-cap";
    const out: Ring[] = [];
    // Rounding: shrink the outline evenly (width more than height) while stepping past the end.
    for (let k = 1; k <= CAP_ROUND; k++) {
      const th = (k / CAP_ROUND) * (Math.PI / 2);
      const shrink = radius * (1 - Math.cos(th));
      const sz = 1 - shrink / halfW;
      const sy = 1 - (0.5 * shrink) / halfH;
      const pts = base.map(([z, y]) => [z * sz, c[1] + (y - c[1]) * sy] as [number, number]);
      out.push({ x: pts.map(() => end + dir * radius * Math.sin(th)), pts, where });
    }
    // Fill: close the end face by narrowing only its width, so the face is made of vertical strips
    // (narrowing towards a single point would crease it into a pyramid).
    const last = out[out.length - 1].pts;
    for (let k = 1; k <= CAP_FILL; k++) {
      const s = 1 - k / CAP_FILL;
      const bulge = bulgeDepth * (1 - s * s); // end faces are gently convex
      const pts = last.map(([z, y]) => [z * s, y] as [number, number]);
      out.push({ x: pts.map(() => end + dir * (radius + bulge)), pts, where });
    }
    return out;
  };
  rings.push(...capRings(TAIL_X + 0.2, -1, 0.17, 0.07).reverse());
  for (let i = 0; i <= STATIONS; i++) {
    const x = lerp(TAIL_X + 0.2, NOSE_X - 0.03, i / STATIONS);
    const pts = sectionRing(x);
    rings.push({ x: pts.map(() => x), pts, where: "side" });
  }
  rings.push(...capRings(NOSE_X - 0.03, 1, 0.1, 0.05));

  // 2. Vertex grid, with wheel-arch cut-outs.
  const L = 2 * HALF_STEPS;
  const pos = new Float32Array(rings.length * L * 3);
  const inArch = new Uint8Array(rings.length * L);
  rings.forEach((r, i) => {
    r.pts.forEach(([z, y], j) => {
      let x = r.x[j];
      const v = i * L + j;
      const tag = RING_SEGMENTS[j].tag;
      const prevTag = RING_SEGMENTS[(j - 1 + L) % L].tag;
      const sideish = (tag === "under" || tag === "lower" || prevTag === "lower") && Math.abs(z) > ARCH_MIN_Z;
      if (r.where === "side" && sideish) {
        const [px, py, inside] = archProject(x, y);
        x = px;
        y = py;
        inArch[v] = inside ? 1 : 0;
      }
      pos.set([x, y, z], v * 3);
    });
  });

  // 3. Faces (two triangles per quad), skipping quads entirely inside an arch.
  type Face = { a: number; b: number; c: number; d: number; panel: PanelId };
  const faces: Face[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < L; j++) {
      const jn = (j + 1) % L;
      const a = i * L + j, b = (i + 1) * L + j, c = (i + 1) * L + jn, d = i * L + jn;
      if (inArch[a] && inArch[b] && inArch[c] && inArch[d]) continue;
      const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3] + pos[d * 3]) / 4;
      const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4;
      const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2] + pos[d * 3 + 2]) / 4;
      const where = rings[i].where !== "side" ? rings[i].where : rings[i + 1].where;
      faces.push({ a, b, c, d, panel: classify(cx, cy, cz, RING_SEGMENTS[j], where) });
    }
  }

  // 4. Smooth normals over the whole shell, so neighbouring panels shade continuously.
  const index: number[] = [];
  for (const f of faces) index.push(f.a, f.b, f.c, f.a, f.c, f.d);
  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  shell.setIndex(index);
  shell.computeVertexNormals();
  const nrm = shell.getAttribute("normal") as THREE.BufferAttribute;
  // Winding: make sure normals point outwards (away from the body's centre line).
  const flip = (() => {
    let s = 0;
    for (let v = 0; v < rings.length * L; v += 37) s += nrm.getY(v) * (pos[v * 3 + 1] - 0.9) + nrm.getZ(v) * pos[v * 3 + 2];
    return s < 0;
  })();

  // 5. Split into panels.
  const byPanel = new Map<PanelId, Face[]>();
  for (const f of faces) {
    const list = byPanel.get(f.panel) ?? [];
    list.push(f);
    byPanel.set(f.panel, list);
  }
  const out: BodyPanel[] = [];
  for (const id of PANEL_IDS) {
    const list = byPanel.get(id);
    if (!list) continue;
    const remap = new Map<number, number>();
    const p: number[] = [];
    const n: number[] = [];
    const idx: number[] = [];
    const take = (v: number) => {
      let k = remap.get(v);
      if (k === undefined) {
        k = remap.size;
        remap.set(v, k);
        p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        const sgn = flip ? -1 : 1;
        n.push(sgn * nrm.getX(v), sgn * nrm.getY(v), sgn * nrm.getZ(v));
      }
      return k;
    };
    for (const f of list) {
      const a = take(f.a), b = take(f.b), c = take(f.c), d = take(f.d);
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    g.setIndex(idx);
    g.computeBoundingBox();
    const center = g.boundingBox!.getCenter(new THREE.Vector3());
    g.translate(-center.x, -center.y, -center.z);
    g.computeBoundingSphere();
    out.push({ id, geometry: g, center });
  }
  shell.dispose();
  return out;
}

/** Exposed for other parts that need to sit against the body (mirrors, lamps, sensors). */
export const bodyLines = { topLine, beltLine, bottomLine, halfWidth, roofHalfWidth };
