// Builds the 3D object for every part in the manifest, once: from the browser-built shapes, or from
// a loaded Blender model when one is supplied for that part's id.

import * as THREE from "three";
import { buildBodyPanels, type BodyPanel } from "../vehicle/body";
import { PARTS } from "../vehicle/manifest";
import { createMaterials, createPanelInsideMaterial } from "../vehicle/materials";
import { buildShape } from "../vehicle/shapes";

export interface BuiltPart {
  id: string;
  /** A mesh, or a group of meshes (Blender parts can carry several materials). */
  object: THREE.Object3D;
  /** Assembled position and rotation (vehicle coordinates). */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  source: "procedural" | "blender";
}

/** Returns a function giving the x of the body's front or rear face at height y, sideways offset z. */
function bodySurfaceFinder(panels: BodyPanel[]) {
  const meshes = panels.map((p) => {
    const m = new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.position.copy(p.center);
    m.updateMatrixWorld();
    return m;
  });
  const ray = new THREE.Raycaster();
  return (end: "front" | "rear", y: number, z: number) => {
    const dir = end === "front" ? -1 : 1;
    ray.set(new THREE.Vector3(-dir * 10, y, z), new THREE.Vector3(dir, 0, 0));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) throw new Error(`No body surface at the ${end}, y=${y}, z=${z}`);
    return hit.point.x;
  };
}

/** Build every part once. Body panels come from the lofted shell, other parts from shapes.ts,
 * unless `external` supplies a modelled object for that id. */
export function buildVehicle(external: Map<string, THREE.Object3D> = new Map()): BuiltPart[] {
  const materials = createMaterials();
  const inside = createPanelInsideMaterial();
  const panels = new Map(buildBodyPanels().map((p) => [p.id as string, p]));
  const surface = bodySurfaceFinder([...panels.values()]);
  const procedural = (part: (typeof PARTS)[number]): Omit<BuiltPart, "id" | "object" | "source"> & { geometry: THREE.BufferGeometry } => {
    if (part.shape.kind === "panel") {
      const panel = panels.get(part.id);
      if (!panel) throw new Error(`Body panel "${part.id}" has no surface`);
      return { geometry: panel.geometry, position: panel.center.clone(), rotation: new THREE.Euler() };
    }
    if (part.shape.kind === "panel-inner") {
      const of = panels.get(part.shape.of)!;
      return { geometry: of.geometry.clone().scale(0.96, 0.96, 0.96), position: of.center.clone().add(new THREE.Vector3(...(part.position ?? [0, 0, 0]))), rotation: new THREE.Euler() };
    }
    const position = new THREE.Vector3(...(part.position ?? [0, 0, 0]));
    if (part.attach) position.x = surface(part.attach, position.y, position.z) + (part.attach === "front" ? 1 : -1) * position.x;
    return { geometry: buildShape(part.shape), position, rotation: new THREE.Euler(...(part.rotation ?? [0, 0, 0])) };
  };
  return PARTS.map((part) => {
    const modelled = external.get(part.id);
    if (modelled) {
      // The loaded model objects outlive this function (they are shared and moved by the explosion), so their
      // assembled pose is recorded once, the first time they are used, never re-read from a moved object.
      const home = (modelled.userData.home ??= { position: modelled.position.clone(), rotation: modelled.rotation.clone() }) as
        { position: THREE.Vector3; rotation: THREE.Euler };
      const built: BuiltPart = { id: part.id, object: modelled, position: home.position.clone(), rotation: home.rotation.clone(), source: "blender" };
      tag(modelled, part.id);
      return built;
    }
    const { geometry, position, rotation } = procedural(part);
    const mesh = new THREE.Mesh(geometry, materials[part.material]);
    // painted panels get a bare-metal inside face, so they never read as black holes
    if (part.material === "paint") mesh.add(new THREE.Mesh(geometry, inside));
    tag(mesh, part.id);
    return { id: part.id, object: mesh, position, rotation, source: "procedural" };
  });
}

/** Every mesh inside a part carries the part's id, so clicking any piece selects the whole part. */
function tag(object: THREE.Object3D, id: string) {
  object.name = id;
  object.traverse((o) => (o.userData.partId = id));
}
