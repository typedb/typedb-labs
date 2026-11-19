// Renders every part in the manifest as its own object, named by its stable part id, and moves the
// objects to their exploded positions whenever the progress value changes.

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { use, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { buildExplosionPlan, explodedBounds, partTransform } from "../vehicle/explode";
import type { Vec3 } from "../vehicle/shapes";
import { externalParts } from "./assets";
import { buildVehicle } from "./buildVehicle";
import { setExplodedVolume } from "./framing";
import { progress } from "./progress";
import { vehicleState } from "./vehicleState";

import { theme } from "../theme";

const COLOURS = { primary: new THREE.Color(theme.accent), secondary: new THREE.Color(theme.accentSoft), degraded: new THREE.Color(theme.degraded) };
const GLOW = { selected: theme.highlight.selectedGlow, primary: theme.highlight.primaryGlow, secondary: theme.highlight.secondaryGlow,
  degraded: theme.highlight.degradedGlow };

export function Vehicle({ selectedId, highlight, onSelect, onHover }: {
  selectedId: string | null;
  /** component ids to bring forward (a semantic focus), with their level; the rest is ghosted. null = no focus */
  highlight: Map<string, "primary" | "secondary" | "degraded"> | null;
  onSelect: (id: string | null) => void;
  /** the part under the pointer (null when none) */
  onHover: (id: string | null) => void;
}) {
  const loaded = use(externalParts);
  const built = useMemo(() => buildVehicle(loaded.parts), [loaded]);
  const plan = useMemo(() => {
    const centers = new Map(built.map((b) => [b.id, b.position.toArray() as Vec3]));
    const plan = buildExplosionPlan(centers);
    const { min, max } = explodedBounds(centers, plan);
    setExplodedVolume(min, max);
    Object.assign(vehicleState, { built, plan, loaded });
    return plan;
  }, [built, loaded]);
  const applied = useRef(-1);

  useEffect(
    () => () => {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      for (const b of built) {
        b.object.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          geometries.add(mesh.geometry);
          for (const m of [mesh.userData.baseMaterial ?? mesh.material].flat()) materials.add(m);
        });
      }
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
    [built],
  );

  // Highlighting, in one place so the layers never undo each other. Each mesh keeps its own material as its
  // base; the selected part glows; with a semantic focus (an assembly, a system, a failure's impact) the
  // focused parts get a faint glow and everything else is ghosted. Variants are made once per base material.
  const variants = useMemo(() => new Map<string, THREE.Material>(), [built]);
  useEffect(() => () => { for (const m of variants.values()) m.dispose(); variants.clear(); }, [variants]);
  useEffect(() => {
    const variant = (base: THREE.Material, kind: "selected" | "primary" | "secondary" | "degraded" | "ghost") => {
      const key = `${base.uuid}:${kind}`;
      let m = variants.get(key);
      if (!m) {
        const copy = base.clone() as THREE.MeshPhysicalMaterial;
        if (kind === "ghost") {
          copy.transparent = true;
          copy.opacity = theme.highlight.ghostOpacity;
          copy.depthWrite = false;
        } else if ("emissive" in copy) {
          copy.emissive = COLOURS[kind === "selected" ? "primary" : kind].clone();
          copy.emissiveIntensity = GLOW[kind];
        }
        variants.set(key, (m = copy));
      }
      return m;
    };
    for (const b of built) {
      const kind = b.id === selectedId ? "selected" : highlight ? (highlight.get(b.id) ?? "ghost") : null;
      b.object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const base = (mesh.userData.baseMaterial ??= mesh.material) as THREE.Material | THREE.Material[];
        mesh.material = kind === null ? base : Array.isArray(base) ? base.map((m) => variant(m, kind)) : variant(base, kind);
      });
    }
  }, [selectedId, highlight, built, variants]);

  useFrame((_, dt) => {
    progress.tick(Math.min(dt, 0.1));
    const p = progress.value;
    if (p === applied.current) return;
    applied.current = p;
    for (const b of built) {
      const [pos, turn] = partTransform(b.position.toArray() as Vec3, plan.get(b.id)!, p);
      b.object.position.set(...pos);
      b.object.rotation.set(b.rotation.x + turn[0], b.rotation.y + turn[1], b.rotation.z + turn[2]);
    }
  });

  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect((e.object.userData.partId as string) ?? null);
  };
  const hover = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = on ? "pointer" : "";
    onHover(on ? ((e.object.userData.partId as string) ?? null) : null);
  };

  return (
    <group name="vehicle" onClick={pick} onPointerOver={hover(true)} onPointerOut={hover(false)}>
      {built.map((b) => (
        <primitive key={b.id} object={b.object} />
      ))}
    </group>
  );
}
