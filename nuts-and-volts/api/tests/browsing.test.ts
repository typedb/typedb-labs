// Browsing answers (assembly tree, systems, type hierarchy, schema of a type) against oracles worked out from the
// seed and schema files.

import { describe, expect, it } from "vitest";
import { SCHEMA_TQL } from "../src/generated/assets.ts";
import type { Doc } from "../src/queries.ts";
import { client, database, setEqual } from "./helpers.ts";
import { PARENT, RESOLVED, SEED } from "./oracle.ts";

const SUPER = new Map<string, string | undefined>(
  [...SCHEMA_TQL.matchAll(/^entity ([a-z-]+)(?: @abstract)?(?:, sub ([a-z-]+)| sub ([a-z-]+))?/gm)].map((m) => [m[1], m[2] || m[3]]),
);

function chain(assembly: string): string[] {
  const out = [assembly];
  while (PARENT.get(out[out.length - 1])) out.push(PARENT.get(out[out.length - 1])!);
  return out;
}

function isA(typeLabel: string | undefined, ancestor: string): boolean {
  while (typeLabel) {
    if (typeLabel === ancestor) return true;
    typeLabel = SUPER.get(typeLabel);
  }
  return false;
}

const c = () => client(database());

describe("browsing", () => {
  it("assembly tree counts", async () => {
    const tree = new Map<string, Doc>(((await c().get("/api/assemblies")).data as Doc[]).map((a) => [a.id, a]));
    expect(setEqual(tree.keys(), PARENT.keys())).toBe(true);
    for (const [aid, a] of tree) {
      expect(a.parent).toBe(PARENT.get(aid));
      expect(a.direct).toBe(SEED.components.filter((x) => x.assembly === aid).length);
      expect(a.total).toBe(SEED.components.filter((x) => chain(x.assembly).includes(aid)).length);
    }
  });

  it("system totals include subsystems", async () => {
    const systems = new Map<string, Doc>(((await c().get("/api/systems")).data as Doc[]).map((s) => [s.id, s]));
    for (const s of SEED.systems) {
      let subtree = new Set<string>([s.id]);
      let frontier = new Set<string>([s.id]);
      while (frontier.size) { // every level of sub-systems
        frontier = new Set(SEED.systems.filter((x) => frontier.has(x.parent)).map((x) => x.id));
        subtree = new Set([...subtree, ...frontier]);
      }
      const expected = new Set([...subtree].flatMap((x) => RESOLVED.members.get(x)!));
      expect(systems.get(s.id)!.total, s.id).toBe(expected.size);
    }
  });

  it("system members list their other systems", async () => {
    const data = (await c().get("/api/systems/brake-control")).data;
    const sensor = data.components.find((x: Doc) => x.id === "wheel-speed-sensor-fl");
    expect(new Set(sensor.systems.map((s: Doc) => s.id))).toEqual(new Set(["brake-control", "traction-control", "perception"]));
  });

  it("type hierarchy counts are polymorphic", async () => {
    const types = new Map<string, Doc>(((await c().get("/api/types")).data as Doc[]).map((t) => [t.type, t]));
    const direct = new Map<string, number>();
    for (const x of SEED.components) direct.set(x.type, (direct.get(x.type) ?? 0) + 1);
    for (const [label, t] of types) {
      expect(t.direct, label).toBe(direct.get(label) ?? 0);
      expect(t.total, label).toBe([...direct].filter(([ty]) => isA(ty, label)).reduce((n, [, k]) => n + k, 0));
    }
    expect(types.get("component")!.total).toBe(SEED.components.length);
    // 15 vehicle sensors, 2 resolvers and 2 current sensors (C3a), 8 module monitors and the pack current sensor (C3b),
    // the steering torque sensor (C3c)
    expect(types.get("sensor")!.direct).toBe(0);
    expect(types.get("sensor")!.total).toBe(29);
  });

  it("type detail shows schema and every subtype instance", async () => {
    const data = (await c().get("/api/types/sensor")).data;
    expect(data.owns).toContain("sensing-range-m");
    expect(data.plays).toContain("control-loop:sensor");
    expect(setEqual(data.instances.map((i: Doc) => i.id), SEED.components.filter((x) => isA(x.type, "sensor")).map((x) => x.id))).toBe(true);
    expect(new Set(data.instances.map((i: Doc) => i.type))).toEqual(new Set(["camera", "radar", "lidar", "gnss-receiver", "wheel-speed-sensor",
      "position-sensor", "current-sensor", "cell-monitor", "torque-sensor"]));
    const caliper = (await c().get("/api/types/brake-caliper")).data;
    expect(caliper.supertypes).toEqual(["brake-component", "chassis-component", "component"]);
    expect(caliper.owns).toContain("piston-count");
  });

  it("an unknown type is not found", async () => {
    expect((await c().get("/api/types/spaceship", 404)).error).toBe("not-found");
  });
});
