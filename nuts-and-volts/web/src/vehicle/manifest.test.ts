// Checks that the visual manifest is internally consistent, holds no semantic data and matches the built geometry.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildVehicle } from "../scene/buildVehicle";
import { buildBodyPanels, PANEL_IDS } from "./body";
import groups from "./explosion-groups.json";
import { PARTS } from "./manifest";

describe("component manifest", () => {
  it("gives every part a unique, stable-looking id", () => {
    const ids = PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("holds no semantic data: names, types and assemblies come only from TypeDB", () => {
    for (const p of PARTS) {
      const keys = Object.keys(p).filter((k) => ["name", "assembly", "category", "type", "system"].includes(k));
      expect(keys, p.id).toEqual([]);
    }
  });

  it("matches the explosion grouping generated from TypeDB, part for part", () => {
    expect(Object.keys(groups.components).sort()).toEqual(PARTS.map((p) => p.id).sort());
    const parent: Record<string, string | null> = groups.assemblies;
    for (const a of Object.values(groups.components)) {
      let at: string | null = a;
      for (let n = 0; at !== "vehicle"; n++) {
        expect(at, `assembly chain from ${a}`).not.toBeNull();
        expect(n).toBeLessThan(10);
        at = parent[at!] ?? null;
      }
    }
  });

  it("lists exactly the body panels the shell produces, each with real geometry", () => {
    const panelParts = PARTS.filter((p) => p.shape.kind === "panel").map((p) => p.id).sort();
    expect(panelParts).toEqual([...PANEL_IDS].sort());
    const built = buildBodyPanels();
    expect(built.map((b) => b.id).sort()).toEqual([...PANEL_IDS].sort());
    for (const b of built) expect(b.geometry.index!.count, b.id).toBeGreaterThan(30);
  });

  it("gives non-panel parts an explicit position", () => {
    for (const p of PARTS) if (p.shape.kind !== "panel") expect(p.position, p.id).toBeDefined();
  });

  it("builds every part with finite geometry, tagged with its id", () => {
    for (const b of buildVehicle()) {
      const mesh = b.object as THREE.Mesh;
      const pos = mesh.geometry.getAttribute("position");
      expect(pos.count, b.id).toBeGreaterThan(0);
      for (let i = 0; i < pos.count; i += 7) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)), b.id).toBe(true);
      b.object.traverse((o) => expect(o.userData.partId, b.id).toBe(b.id));
    }
  });
});
