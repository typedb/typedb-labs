// Physically based materials (PBR): each surface is described by colour, how metallic it is and
// how rough it is, and the renderer works out reflections from the studio lighting.

import * as THREE from "three";
import type { MaterialId } from "./manifest";

/** The unpainted inside face of body panels (bare pressed metal), seen once the panels separate. */
export function createPanelInsideMaterial() {
  return new THREE.MeshStandardMaterial({ color: "#7d848c", metalness: 0.55, roughness: 0.5, side: THREE.BackSide });
}

export function createMaterials(): Record<MaterialId, THREE.MeshPhysicalMaterial> {
  const m = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
  return {
    // Metallic paint under a glossy clear coat, like real automotive paint.
    paint: m({ color: "#9097a0", metalness: 0.8, roughness: 0.27, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 }),
    glass: m({ color: "#4f5d6c", metalness: 0.6, roughness: 0.04, transparent: true, opacity: 0.45, clearcoat: 1, envMapIntensity: 1.8 }),
    "roof-glass": m({ color: "#2e3946", metalness: 0.7, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.8 }),
    "gloss-black": m({ color: "#121418", metalness: 0.4, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05 }),
    "satin-black": m({ color: "#2a2d33", metalness: 0.15, roughness: 0.55 }),
    rubber: m({ color: "#1f2023", metalness: 0, roughness: 0.78, sheen: 0.3, sheenColor: new THREE.Color("#5a5f66") }),
    alloy: m({ color: "#9aa0a6", metalness: 1, roughness: 0.24, clearcoat: 0.6 }),
    iron: m({ color: "#6d6f72", metalness: 1, roughness: 0.48 }),
    caliper: m({ color: "#3a3f45", metalness: 0.6, roughness: 0.32, clearcoat: 0.8 }),
    aluminium: m({ color: "#b6bbc0", metalness: 1, roughness: 0.36 }),
    cast: m({ color: "#7c8187", metalness: 0.9, roughness: 0.55 }),
    steel: m({ color: "#9ea3a8", metalness: 1, roughness: 0.3 }),
    // High-voltage cables are orange on real electric vehicles, by convention.
    "hv-orange": m({ color: "#d46a1f", metalness: 0.05, roughness: 0.45 }),
    copper: m({ color: "#b0643a", metalness: 1, roughness: 0.32 }),
    pcb: m({ color: "#1f3a2d", metalness: 0.3, roughness: 0.45 }),
    fabric: m({ color: "#4a4744", metalness: 0, roughness: 0.9 }),
    electronics: m({ color: "#3d444c", metalness: 0.5, roughness: 0.36 }),
    battery: m({ color: "#5a6470", metalness: 0.75, roughness: 0.34 }),
    leather: m({ color: "#2b2622", metalness: 0, roughness: 0.6, sheen: 0.6, sheenColor: new THREE.Color("#6b5d50") }),
    lamp: m({ color: "#d9dde2", metalness: 0.2, roughness: 0.1, emissive: new THREE.Color("#e8f0ff"), emissiveIntensity: 0.6, clearcoat: 1 }),
    "tail-lamp": m({ color: "#3a0507", metalness: 0.2, roughness: 0.15, emissive: new THREE.Color("#b3141b"), emissiveIntensity: 0.5, clearcoat: 1 }),
  };
}
