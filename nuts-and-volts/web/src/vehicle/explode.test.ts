// Checks the exploded view: deterministic, exactly assembled at 0, every part separated at 1,
// smooth (no jumps) in between, and following the hierarchy (major assemblies move first).

import { describe, expect, it } from "vitest";
import { buildVehicle } from "../scene/buildVehicle";
import { buildExplosionPlan, EXPLODED_LIFT, partTransform } from "./explode";
import { PARTS } from "./manifest";
import type { Vec3 } from "./shapes";

const built = buildVehicle();
const centers = new Map(built.map((b) => [b.id, b.position.toArray() as Vec3]));
const plan = buildExplosionPlan(centers);
const at = (id: string, p: number) => partTransform(centers.get(id)!, plan.get(id)!, p)[0];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("exploded view", () => {
  it("has a plan for every part, keyed by its stable id", () => {
    expect([...plan.keys()].sort()).toEqual(PARTS.map((p) => p.id).sort());
  });

  it("is exactly the assembled vehicle at progress 0", () => {
    for (const [id, c] of centers) expect(at(id, 0)).toEqual(c);
  });

  it("gives the same answer every time (deterministic, so it can be reversed exactly)", () => {
    for (const p of [0.13, 0.5, 0.87]) for (const id of ["door-fl", "battery-module-7", "front-rotor"]) expect(at(id, p)).toEqual(at(id, p));
  });

  it("moves every part away from its assembled place, beyond the overall lift", () => {
    const stuck = [...centers].filter(([id, c]) => dist(at(id, 1), [c[0], c[1] + EXPLODED_LIFT, c[2]]) < 0.15).map(([id]) => id);
    expect(stuck).toEqual([]);
  });

  it("moves smoothly: no part jumps between neighbouring progress values", () => {
    for (const id of centers.keys()) {
      for (let i = 0; i < 200; i++) expect(dist(at(id, i / 200), at(id, (i + 1) / 200)), id).toBeLessThan(0.16);
    }
  });

  it("separates the doors into layers, outermost furthest out", () => {
    const z = (id: string) => at(id, 1)[2];
    expect(z("door-fr")).toBeGreaterThan(z("door-structure-fr"));
    expect(z("door-structure-fr")).toBeGreaterThan(z("door-trim-fr"));
    expect(z("door-fl")).toBeLessThan(z("door-structure-fl"));
  });

  it("moves major assemblies before the parts inside them", () => {
    const start = (id: string, level: number) => plan.get(id)![level].start;
    expect(start("battery-module-3", 0)).toBeLessThan(start("battery-module-3", 1)); // battery drops, then modules spread
    expect(start("glass-fl", 0)).toBeLessThan(start("glass-fl", 1));
  });

  it("keeps the overall picture recognisable: front parts stay in front, roof stays on top", () => {
    expect(at("front-bumper", 1)[0]).toBeGreaterThan(at("rear-bumper", 1)[0]);
    expect(at("roof", 1)[1]).toBeGreaterThan(at("seat-rear", 1)[1]);
    expect(at("seat-rear", 1)[1]).toBeGreaterThan(at("battery-module-1", 1)[1]);
  });
});
