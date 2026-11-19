// Checks the Blender-modelled corner and drive units (web/public/assets/*.glb) against the component manifest:
// the mapping file links every node to a real component id, both detail levels have the same nodes,
// positions are sensible, and every material name is one the app renders. Reads the GLB's JSON chunk
// directly, so it needs no browser.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRONT_AXLE_X, REAR_AXLE_X } from "../vehicle/dimensions";
import { PART_BY_ID } from "../vehicle/manifest";
import { createStudioMaterials } from "../vehicle/studioMaterials";

const asset = (name: string) => fileURLToPath(new URL(`../../public/assets/${name}`, import.meta.url));

function gltfJson(path: string) {
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  const length = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON" chunk
  return JSON.parse(buf.subarray(20, 20 + length).toString("utf8"));
}

/** A corner's parts: the same set at every corner, except tie rod (front) versus toe link and parking brake (rear). */
const cornerParts = (c: "fl" | "fr" | "rl" | "rr") => [
  `tyre-${c}`, `wheel-${c}`, ...[1, 2, 3, 4, 5].map((n) => `wheel-nut-${c}-${n}`), `brake-disc-${c}`, `caliper-${c}`,
  `brake-pad-inner-${c}`, `brake-pad-outer-${c}`, `brake-shield-${c}`, `brake-hose-${c}`, `hub-${c}`, `hub-nut-${c}`,
  `wheel-bearing-${c}`, `knuckle-${c}`, `wheel-speed-sensor-${c}`, `lower-arm-${c}`, `upper-arm-${c}`, `coilover-${c}`,
  `spring-${c}`, `top-mount-${c}`, `drop-link-${c}`, ...(c[0] === "f" ? [`tie-rod-${c}`] : [`toe-link-${c}`, `epb-actuator-${c}`]),
];

describe.each([
  ["fr", FRONT_AXLE_X, 1], ["fl", FRONT_AXLE_X, -1], ["rr", REAR_AXLE_X, 1], ["rl", REAR_AXLE_X, -1],
] as const)("Blender corner %s", (c, axleX, side) => {
  const name = `corner-${c}`;
  const map: { asset: string; nodes: Record<string, string> } = JSON.parse(readFileSync(asset(`${name}.map.json`), "utf8"));
  const roots = (json: { scenes: { nodes: number[] }[]; scene?: number; nodes: { name: string }[] }) =>
    json.scenes[json.scene ?? 0].nodes.map((i) => json.nodes[i]);
  const full = gltfJson(asset(`${name}.glb`));
  const light = gltfJson(asset(`${name}.lod1.glb`));
  const nodes = roots(full) as { name: string; translation: number[]; rotation?: number[] }[];

  it("draws exactly the corner's parts, once each, every node mapped to a manifest id (node names are not ids)", () => {
    expect(nodes.map((n) => map.nodes[n.name]).sort()).toEqual(cornerParts(c).sort());
    for (const id of cornerParts(c)) expect(PART_BY_ID.has(id), id).toBe(true);
    expect(Object.keys(map.nodes).sort()).toEqual(nodes.map((n) => n.name).sort());
    expect(roots(light).map((n) => n.name).sort()).toEqual(nodes.map((n) => n.name).sort());
  });

  it("places every part near its wheel, on its side, near the manifest's stand-in, with no baked rotation", () => {
    for (const n of nodes) {
      const id = map.nodes[n.name];
      const [x, y, z] = n.translation;
      expect(Math.abs(x - axleX), id).toBeLessThan(0.35);
      expect(y, id).toBeGreaterThan(0);
      expect(y, id).toBeLessThan(1.1);
      expect(z * side, id).toBeGreaterThan(0.35);
      expect(n.rotation, id).toBeUndefined();
      const stand = PART_BY_ID.get(id)!.position!;
      expect(Math.hypot(x - stand[0], y - stand[1], z - stand[2]), id).toBeLessThan(0.15);
    }
  });

  it("uses only material names the web app knows how to render, compressed and small enough", () => {
    const t = new THREE.Texture();
    const known = createStudioMaterials({ tread: t, treadCavity: t, ringsFine: t, ringsFriction: t, brushing: t, cast: t, forged: t, friction: t });
    for (const m of full.materials) expect(known.has(m.name), m.name).toBe(true);
    expect(full.extensionsUsed).toContain("EXT_meshopt_compression");
    expect(readFileSync(asset(`${name}.glb`)).byteLength).toBeLessThan(2_500_000);
  });
});

// ---- Drive units (C3a) ---------------------------------------------------------------------------------

const DRIVE_UNIT_PARTS = [
  "motor", "motor-end-cover", "stator", "rotor", "rotor-shaft", "motor-bearing-1", "motor-bearing-2", "resolver", "pinion",
  "intermediate-shaft", "intermediate-gear", "reduction-gear", "differential", "side-gear-l", "side-gear-r", "spider-gears",
  "gearbox", "gearbox-cover", "oil-pump", "oil-cooler", "inverter", "inverter-lid", "power-module", "dc-link-capacitor",
  "inverter-busbars", "gate-driver", "control-board", "current-sensor", "phase-busbars", "hv-connector",
  "drive-unit-mount-1", "drive-unit-mount-2", "drive-unit-mount-3", "halfshaft-l", "halfshaft-r",
];

describe.each([
  ["front", FRONT_AXLE_X, "front-disconnect"],
  ["rear", REAR_AXLE_X, "rear-park-lock"],
] as const)("Blender %s drive unit", (key, axleX, special) => {
  const name = `${key}-drive-unit`;
  const map: { asset: string; nodes: Record<string, string> } = JSON.parse(readFileSync(asset(`${name}.map.json`), "utf8"));
  const roots = (json: { scenes: { nodes: number[] }[]; scene?: number; nodes: { name: string }[] }) =>
    json.scenes[json.scene ?? 0].nodes.map((i) => json.nodes[i]);
  const full = gltfJson(asset(`${name}.glb`));
  const light = gltfJson(asset(`${name}.lod1.glb`));
  const nodes = roots(full) as { name: string; translation: number[]; rotation?: number[] }[];

  it("draws exactly the unit's parts, once each, every node mapped to a manifest id", () => {
    const expected = [...DRIVE_UNIT_PARTS.map((p) => `${key}-${p}`), special].sort();
    expect(nodes.map((n) => map.nodes[n.name]).sort()).toEqual(expected);
    for (const id of expected) expect(PART_BY_ID.has(id), id).toBe(true);
    expect(roots(light).map((n) => n.name).sort()).toEqual(nodes.map((n) => n.name).sort());
  });

  it("places every part around its axle, near the manifest's simple stand-in, with no baked rotation", () => {
    for (const n of nodes) {
      const id = map.nodes[n.name];
      const [x, y, z] = n.translation;
      expect(Math.abs(x - axleX), id).toBeLessThan(0.3);
      expect(y, id).toBeGreaterThan(0.25);
      expect(y, id).toBeLessThan(0.85);
      expect(Math.abs(z), id).toBeLessThan(0.75);
      expect(n.rotation, id).toBeUndefined();
      const stand = PART_BY_ID.get(id)!.position!;
      expect(Math.hypot(x - stand[0], y - stand[1], z - stand[2]), id).toBeLessThan(0.12);
    }
  });

  it("uses only known materials and is compressed and small", () => {
    const t = new THREE.Texture();
    const known = createStudioMaterials({ tread: t, treadCavity: t, ringsFine: t, ringsFriction: t, brushing: t, cast: t, forged: t, friction: t });
    for (const m of full.materials) expect(known.has(m.name), m.name).toBe(true);
    expect(full.extensionsUsed).toContain("EXT_meshopt_compression");
    expect(readFileSync(asset(`${name}.glb`)).byteLength).toBeLessThan(1_500_000);
  });
});

// ---- Battery pack and power electronics (C3b) -------------------------------------------------------------

describe.each([
  ["hv-battery", 47],
  ["power-electronics", 6],
  ["chassis", 12],
  ["steering", 8],
  ["brakes", 9],
  ["thermal", 14],
  ["body-structure", 42],
  ["body-exterior", 74],
] as const)("Blender %s", (name, count) => {
  const map: { asset: string; nodes: Record<string, string> } = JSON.parse(readFileSync(asset(`${name}.map.json`), "utf8"));
  const roots = (json: { scenes: { nodes: number[] }[]; scene?: number; nodes: { name: string }[] }) =>
    json.scenes[json.scene ?? 0].nodes.map((i) => json.nodes[i]);
  const full = gltfJson(asset(`${name}.glb`));
  const light = gltfJson(asset(`${name}.lod1.glb`));
  const nodes = roots(full) as { name: string; translation: number[]; rotation?: number[] }[];

  it("maps every node, once, to a manifest id; the light copy has the same nodes", () => {
    const ids = nodes.map((n) => map.nodes[n.name]);
    expect(ids.length).toBe(count);
    expect(new Set(ids).size).toBe(count);
    for (const id of ids) expect(PART_BY_ID.has(id), id).toBe(true);
    expect(roots(light).map((n) => n.name).sort()).toEqual(nodes.map((n) => n.name).sort());
  });

  it("places every part near the manifest's simple stand-in, with no baked rotation", () => {
    for (const n of nodes) {
      const id = map.nodes[n.name];
      const stand = PART_BY_ID.get(id)!.position;
      const [x, y, z] = n.translation;
      // body panels have no stand-in position: their fallback is the browser-built shell (web/src/vehicle/body.ts)
      if (stand) expect(Math.hypot(x - stand[0], y - stand[1], z - stand[2]), id).toBeLessThan(0.12);
      expect(n.rotation, id).toBeUndefined();
    }
  });

  it("uses only known materials and is compressed and small", () => {
    const t = new THREE.Texture();
    const known = createStudioMaterials({ tread: t, treadCavity: t, ringsFine: t, ringsFriction: t, brushing: t, cast: t, forged: t, friction: t });
    for (const m of full.materials) expect(known.has(m.name), m.name).toBe(true);
    expect(full.extensionsUsed).toContain("EXT_meshopt_compression");
    expect(readFileSync(asset(`${name}.glb`)).byteLength).toBeLessThan(800_000);
  });
});
