// Shared by the packaging and suspension-travel checks (test helpers only; the app does not import this).
// Each part's surface is sampled into a voxel grid; two parts whose surfaces share voxels are within about one
// voxel of each other.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const asset = (name: string) => fileURLToPath(new URL(`../../public/assets/${name}`, import.meta.url));

/** A model's parts by component id (the real compressed model and its mapping file). */
export async function loadParts(name: string) {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = readFileSync(asset(`${name}.glb`));
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const map: { nodes: Record<string, string> } = JSON.parse(readFileSync(asset(`${name}.map.json`), "utf8"));
  gltf.scene.updateMatrixWorld(true);
  return new Map(gltf.scene.children.map((n) => [map.nodes[n.name], n]));
}

/** Voxels touched by an object's surface (triangles sampled at a third of a voxel), optionally after moving
 * the object by `move` (a transform in vehicle coordinates applied on top of its own placement). */
export function voxels(object: THREE.Object3D, voxel = 0.006, move?: THREE.Matrix4) {
  const out = new Set<string>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const m = new THREE.Matrix4();
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    m.copy(mesh.matrixWorld);
    if (move) m.premultiply(move);
    const pos = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    const tri = index ? index.count / 3 : pos.count / 3;
    const at = (i: number) => (index ? index.getX(i) : i);
    for (let t = 0; t < tri; t++) {
      a.fromBufferAttribute(pos, at(3 * t)).applyMatrix4(m);
      b.fromBufferAttribute(pos, at(3 * t + 1)).applyMatrix4(m);
      c.fromBufferAttribute(pos, at(3 * t + 2)).applyMatrix4(m);
      const n = Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (voxel / 3));
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          p.copy(a).multiplyScalar(1 - (i + j) / n).addScaledVector(b, i / n).addScaledVector(c, j / n);
          out.add(`${Math.floor(p.x / voxel)},${Math.floor(p.y / voxel)},${Math.floor(p.z / voxel)}`);
        }
    }
  });
  return out;
}

/** Number of voxels two sets share. */
export function shared(a: Set<string>, b: Set<string>) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let n = 0;
  for (const v of small) if (big.has(v)) n++;
  return n;
}

/** Points on an object's surface, about `step` apart (triangles sampled on a grid), optionally moved by `move`
 * and kept only inside `clip`. With `cell`, only one point is kept per cube of that size, so finely meshed parts
 * (a tyre's tread) do not produce far more points than their area needs. */
export function surfacePoints(object: THREE.Object3D, step = 0.002, move?: THREE.Matrix4, clip?: THREE.Box3, cell?: number) {
  const out: number[] = [];
  const seen = new Set<number>();
  const keep = (x: number, y: number, z: number) => {
    if (cell) {
      const k = ((Math.floor(x / cell) + 4096) * 8192 + Math.floor(y / cell) + 4096) * 8192 + Math.floor(z / cell) + 4096;
      if (seen.has(k)) return;
      seen.add(k);
    }
    out.push(x, y, z);
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const m = new THREE.Matrix4(), tri = new THREE.Box3();
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    m.copy(mesh.matrixWorld);
    if (move) m.premultiply(move);
    const pos = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    const count = index ? index.count / 3 : pos.count / 3;
    const at = (i: number) => (index ? index.getX(i) : i);
    for (let t = 0; t < count; t++) {
      a.fromBufferAttribute(pos, at(3 * t)).applyMatrix4(m);
      b.fromBufferAttribute(pos, at(3 * t + 1)).applyMatrix4(m);
      c.fromBufferAttribute(pos, at(3 * t + 2)).applyMatrix4(m);
      if (clip && !clip.intersectsBox(tri.setFromPoints([a, b, c]))) continue;
      const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / step));
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          p.copy(a).multiplyScalar(1 - (i + j) / n).addScaledVector(b, i / n).addScaledVector(c, j / n);
          if (!clip || clip.containsPoint(p)) keep(p.x, p.y, p.z);
        }
    }
  });
  return new Float32Array(out);
}

/** Smallest distance between two point sets (from surfacePoints), searched up to `reach`; Infinity if further.
 * Also returns the two nearest points. Accurate to about the sampling step. */
export function minDistance(pa: Float32Array, pb: Float32Array, reach = 0.02) {
  const key = (x: number, y: number, z: number) => `${Math.floor(x / reach)},${Math.floor(y / reach)},${Math.floor(z / reach)}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < pb.length; i += 3) {
    const k = key(pb[i], pb[i + 1], pb[i + 2]);
    const cell = grid.get(k);
    if (cell) cell.push(i); else grid.set(k, [i]);
  }
  let best = reach * reach, ia = -1, ib = -1;
  for (let i = 0; i < pa.length; i += 3) {
    const x = pa[i], y = pa[i + 1], z = pa[i + 2];
    const gx = Math.floor(x / reach), gy = Math.floor(y / reach), gz = Math.floor(z / reach);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
      if (!cell) continue;
      for (const j of cell) {
        const d = (pb[j] - x) ** 2 + (pb[j + 1] - y) ** 2 + (pb[j + 2] - z) ** 2;
        if (d < best) { best = d; ia = i; ib = j; }
      }
    }
  }
  if (ia < 0) return { d: Infinity };
  return { d: Math.sqrt(best), a: [pa[ia], pa[ia + 1], pa[ia + 2]], b: [pb[ib], pb[ib + 1], pb[ib + 2]] };
}
