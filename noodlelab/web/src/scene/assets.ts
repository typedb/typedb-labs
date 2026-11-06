// Loads the Blender-modelled parts (built by scripts/build-assets.sh into web/public/assets): the front-right
// all four wheel corners, the subframes and anti-roll bars, both drive units, the battery pack, the power electronics, the body structure and the exterior.
//
// Each model comes as three files:
//   <asset>.glb        full detail, Meshopt-compressed
//   <asset>.lod1.glb   the same nodes with about 30% of the triangles, for when a part is small on screen
//   <asset>.map.json   which component id each node draws (node names are only visual keys, never ids)
// Until the TypeDB phase the mapping file is the visual-reference table; afterwards TypeDB holds it
// (decision 0001) and this file is checked against it.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { PART_BY_ID } from "../vehicle/manifest";
import { applyStudioMaterials, createStudioMaterials, setExteriorLights } from "../vehicle/studioMaterials";
import { exteriorLights } from "./lights";
import { quality, settings } from "./settings";

/** Where the app is served from: assets live under the same path. */
const BASE = import.meta.env.BASE_URL;

export interface LoadedParts {
  /** component id -> 3D object (a LOD switching between full and light detail) */
  parts: Map<string, THREE.Object3D>;
  bytes: number;
  millis: number;
}

interface VisualMap {
  asset: string;
  nodes: Record<string, string>; // visual key -> component id
}

const ASSETS = settings.blenderCorner
  ? ["corner-fr", "corner-fl", "corner-rr", "corner-rl", "chassis", "steering", "brakes", "thermal", "front-drive-unit", "rear-drive-unit", "hv-battery", "power-electronics", "body-structure", "body-exterior"]
  : [];

/** A level of detail switches when the part's distance exceeds this many times its radius. */
const LOD_SWITCH = { high: 60, medium: 35, low: 15 } as const;

async function fetchBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.arrayBuffer();
}

async function loadAsset(name: string, loader: GLTFLoader, library: Map<string, THREE.MeshPhysicalMaterial>) {
  const [full, light, map] = await Promise.all([
    fetchBuffer(`${BASE}assets/${name}.glb`),
    fetchBuffer(`${BASE}assets/${name}.lod1.glb`),
    fetch(`${BASE}assets/${name}.map.json`).then((r) => r.json() as Promise<VisualMap>),
  ]);
  const [fullScene, lightScene] = await Promise.all([loader.parseAsync(full, ""), loader.parseAsync(light, "")]);
  const lightByKey = new Map(lightScene.scene.children.map((n) => [n.name, n]));
  const parts = new Map<string, THREE.Object3D>();
  for (const node of [...fullScene.scene.children]) {
    const id = map.nodes[node.name];
    if (!id || !PART_BY_ID.has(id)) {
      console.warn(`Ignoring node "${node.name}" in ${name}: no component id in its mapping`);
      continue;
    }
    // Both levels sit at the origin inside a LOD object placed at the part's assembled position.
    const lod = new THREE.LOD();
    lod.position.copy(node.position);
    node.position.set(0, 0, 0);
    applyStudioMaterials(node, library);
    lod.addLevel(node, 0);
    const low = lightByKey.get(node.name);
    if (low) {
      low.position.set(0, 0, 0);
      applyStudioMaterials(low, library);
      const radius = new THREE.Box3().setFromObject(node).getBoundingSphere(new THREE.Sphere()).radius;
      lod.addLevel(low, Math.max(0.5, radius * LOD_SWITCH[quality.tier]));
    }
    parts.set(id, lod);
  }
  return { parts, bytes: full.byteLength + light.byteLength };
}

async function loadAll(): Promise<LoadedParts> {
  const started = performance.now();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const library = createStudioMaterials();
  setExteriorLights(library, exteriorLights.on);
  exteriorLights.subscribe(() => setExteriorLights(library, exteriorLights.on));
  const parts = new Map<string, THREE.Object3D>();
  let bytes = 0;
  for (const result of await Promise.all(ASSETS.map((a) => loadAsset(a, loader, library)))) {
    for (const [id, obj] of result.parts) parts.set(id, obj);
    bytes += result.bytes;
  }
  return { parts, bytes, millis: performance.now() - started };
}

/** Started once, as soon as the app loads. */
export const externalParts: Promise<LoadedParts> = loadAll();
