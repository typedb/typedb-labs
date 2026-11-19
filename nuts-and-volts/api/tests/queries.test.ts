// Query results against an independent oracle: the same answers worked out from the seed files.
//
// If TypeDB, a function or a query were wrong, the two would disagree.

import { describe, expect, it } from "vitest";
import type { Doc } from "../src/queries.ts";
import { fnmatch } from "../src/seed.ts";
import { client, database, setEqual } from "./helpers.ts";
import { assemblyChain, COMPONENTS, RESOLVED, SEED } from "./oracle.ts";

const c = () => client(database());

describe("queries against the seed", () => {
  it("component ids in TypeDB match the seed", async () => {
    const ids = ((await c().get("/api/components")).data as Doc[]).map((x) => x.id);
    expect(setEqual(ids, COMPONENTS.keys())).toBe(true);
  });

  it("component details", async () => {
    const data = (await c().get("/api/components/brake-disc-fr")).data;
    expect(data.type).toBe("brake-disc");
    expect(data.types).toEqual(["brake-disc", "brake-component", "chassis-component", "component"]);
    const props = Object.fromEntries(data.properties.map((p: Doc) => [p.attribute, p.value]));
    expect(props["diameter-mm"]).toBe(380);
    expect(props["thickness-mm"]).toBe(34);
  });

  it("assembly path matches the seed", async () => {
    for (const cid of ["caliper-fr", "battery-module-7", "front-stator", "door-handle-rl"]) {
      const path = (await c().get(`/api/components/${cid}/assembly`)).data.path.map((a: Doc) => a.id);
      expect(path).toEqual(assemblyChain(COMPONENTS.get(cid)!.assembly));
    }
  });

  it("assembly membership matches the seed", async () => {
    for (const aid of ["vehicle", "powertrain", "corner-fl", "body"]) {
      const data = (await c().get(`/api/assemblies/${aid}`)).data;
      const expected = [...COMPONENTS].filter(([, x]) => assemblyChain(x.assembly).includes(aid)).map(([cid]) => cid);
      expect(setEqual(data["all-component-ids"], expected)).toBe(true);
      expect(setEqual(data.components.map((x: Doc) => x.id), [...COMPONENTS].filter(([, x]) => x.assembly === aid).map(([cid]) => cid))).toBe(true);
    }
  });

  it("systems of a component", async () => {
    const systems = new Map<string, Doc>(((await c().get("/api/components/wheel-speed-sensor-fl/systems")).data as Doc[]).map((s) => [s.id, s]));
    // one sensor, three functions: the same component in several systems
    expect(new Set(systems.keys())).toEqual(new Set(["brake-control", "traction-control", "perception"]));
    expect(systems.get("perception")!.parents.map((p: Doc) => p.id)).toEqual(["automated-driving"]);
  });

  it("system components include subsystems", async () => {
    for (const sid of ["braking", "propulsion", "automated-driving"]) {
      const data = (await c().get(`/api/systems/${sid}`)).data;
      const subsystems = SEED.systems.filter((s) => s.parent === sid).map((s) => s.id);
      const expected = new Set([...RESOLVED.members.get(sid)!, ...subsystems.flatMap((s) => RESOLVED.members.get(s)!)]);
      expect(setEqual(data.components.map((x: Doc) => x.id), expected)).toBe(true);
    }
  });

  it("relationships", async () => {
    const data = (await c().get("/api/components/caliper-fr/relationships")).data;
    const connected = new Set(data.connections.map((x: Doc) => `${x.kind} ${x.other}`));
    const expected = new Set(RESOLVED.connections.filter((x) => x.ends.includes("caliper-fr"))
      .map((x) => `${x.kind}-connection ${x.ends.find((e: string) => e !== "caliper-fr")}`));
    expect(connected).toEqual(expected);
    expect(new Set(data.needs.map((d: Doc) => `${d.id} ${d.kind}`))).toEqual(new Set(["brake-hose-fr hydraulic"]));
    const loops = new Set(data["control-loops"].map((loop: Doc) => `${loop.name} / ${loop.role}`));
    expect(loops).toEqual(new Set(["Anti-lock braking and stability control / actuator"]));
  });

  it("requirements are the reverse walk", async () => {
    const key = (a: string, b: string) => `${a} | ${b}`;
    const edges = RESOLVED.dependencies.map((d) => [key(d.dependent, d.function), key(d.provider, d.needs)] as [string, string]);
    const required = (await c().get("/api/components/tyre-fr/requirements")).data.required as Doc[];
    const seen = new Set<string>();
    const frontier = [...new Set(edges.filter(([a]) => a.startsWith("tyre-fr | ")).map(([, b]) => b))];
    while (frontier.length) {
      const node = frontier.pop()!;
      if (seen.has(node) || node.startsWith("tyre-fr | ")) continue;
      seen.add(node);
      frontier.push(...edges.filter(([a]) => a === node).map(([, b]) => b));
    }
    expect(new Set(required.map((r) => key(r.id, r.function)))).toEqual(seen);
  });

  it("pattern matching in the seed is exact", () => {
    expect(fnmatch("hub-nut-fl", "hub-??")).toBe(false);
  });
});
