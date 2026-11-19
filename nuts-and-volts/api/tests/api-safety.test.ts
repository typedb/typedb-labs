// The API is read-only, accepts only validated ids, and the seed loader rejects bad data.

import { describe, expect, it } from "vitest";
import { endpoints } from "../src/app.ts";
import { expand, readSeed, SeedError, validate } from "../src/seed.ts";
import { client, database } from "./helpers.ts";

const c = () => client(database());

describe("API safety", () => {
  it("every endpoint is a read-only GET", async () => {
    const paths = endpoints();
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const concrete = path.replace(/\{[a-z_]+\}/g, "caliper-fr");
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const response = await c().raw(concrete, { method });
        expect(response.status, `${method} ${path}`).toBe(405);
        expect(response.headers.get("allow")).toBe("GET");
      }
    }
  });

  it("ids are validated before any query", async () => {
    for (const bad of ['caliper-fr"; delete', "Caliper-FR", "a--b", "-x", "x".repeat(65), "x y"]) {
      const response = await c().raw(`/api/components/${encodeURIComponent(bad)}`);
      expect([404, 422], bad).toContain(response.status);
      expect("data" in (await response.json())).toBe(false);
    }
  });

  it("an unknown id is a clear not-found", async () => {
    const body = await c().get("/api/components/no-such-part", 404);
    expect(body.error).toBe("not-found");
  });

  it("answers carry the TypeQL that ran", async () => {
    const body = await c().get("/api/components/hub-fr");
    expect(body.typeql.length).toBe(2);
    expect(body.typeql[0]).toContain('"hub-fr"');
    expect(body.typeql[0].startsWith("match")).toBe(true);
  });

  it("placeholders expand for corners, axles and lists", () => {
    const copies = expand({ ends: ["<a>-halfshaft-<s>", "hub-<c>"], kind: "mechanical" });
    expect(copies.map((x) => x.ends)).toEqual([["front-halfshaft-l", "hub-fl"], ["front-halfshaft-r", "hub-fr"],
      ["rear-halfshaft-l", "hub-rl"], ["rear-halfshaft-r", "hub-rr"]]);
    expect(expand({ ends: ["wheel-nut-<c>-<n>", "hub-<c>"], each: { n: [1, 2, 3, 4, 5] } }).length).toBe(20);
  });

  it("seed problems are reported before loading", () => {
    const seed = readSeed();
    seed.connections.push({ kind: "mechanical", joint: "bolted", ends: ["caliper-fr", "no-such-part"] });
    seed.components.push({ id: "caliper-fr", type: "brake-caliper", assembly: "corner-fr", name: "Duplicate" });
    seed.systems.push({ id: "x", name: "X", members: ["nothing-*"] });
    let error: unknown;
    try {
      validate(seed);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SeedError);
    const text = (error as SeedError).problems.join("\n");
    expect(text).toContain("unknown component 'no-such-part'");
    expect(text).toContain("'caliper-fr' appears more than once");
    expect(text).toContain("pattern 'nothing-*' matches no component");
  });

  it("answers report a timing for each query", async () => {
    const body = await c().get("/api/components/hub-fr/relationships");
    expect(body["timings-ms"].length).toBe(5);
    expect(body.typeql.length).toBe(5);
    expect(body["timings-ms"].every((t: unknown) => typeof t === "number" && t >= 0)).toBe(true);
  });

  // Every endpoint that runs queries, with a real id: the contextual TypeQL view relies on what each answer says
  // about its queries.
  const ANSWERING = ["/api/components", "/api/components/hub-fr", "/api/components/hub-fr/assembly", "/api/components/hub-fr/systems",
    "/api/components/hub-fr/relationships", "/api/components/hub-fr/impact", "/api/components/hub-fr/requirements",
    "/api/assemblies", "/api/assemblies/corner-fr", "/api/systems", "/api/systems/propulsion", "/api/types",
    "/api/types/sensor", "/api/questions/sensors-by-type", "/api/questions/battery-to-wheel"];

  it("answers say what each query is for", async () => {
    for (const path of ANSWERING) {
      const body = await c().get(path);
      expect(body.purposes.length, path).toBe(body.typeql.length);
      expect(body.purposes.every((p: unknown) => typeof p === "string" && p), `${path}: a query has no purpose`).toBe(true);
      expect(body["result-queries"].every((i: number) => i >= 0 && i < body.typeql.length), path).toBe(true);
      expect(body.processing.every((p: unknown) => typeof p === "string"), path).toBe(true);
    }
  });

  it("answers mark the query behind the highlighted components", async () => {
    const system = await c().get("/api/systems/propulsion");
    expect(system["result-queries"].length).toBe(1);
    expect(system.typeql[system["result-queries"][0]]).toContain("system_components($s)");
    const assembly = await c().get("/api/assemblies/corner-fr");
    expect(assembly["result-queries"].length).toBe(1);
    expect(assembly.typeql[assembly["result-queries"][0]]).toContain("assembly_components($a)");
    const kind = await c().get("/api/types/sensor");
    expect(kind["result-queries"].length).toBe(1);
    expect(kind.typeql[kind["result-queries"][0]].startsWith("match $x isa sensor;")).toBe(true);
  });

  it("schema definitions come from the database", async () => {
    const body = await c().get("/api/schema/brake-caliper");
    expect(body.typeql).toEqual([]);
    expect(body.source).toBe("database.schema()");
    expect(body["schema-ms"]).toBeGreaterThanOrEqual(0);
    expect(body.data.map((d: { name: string }) => d.name)).toEqual(["brake-caliper", "brake-component", "chassis-component", "component"]);
    expect(body.data[0].definition.startsWith("entity brake-caliper,")).toBe(true);
    expect(body.data[0].definition).toContain("owns piston-count");
    const [fun] = (await c().get("/api/schema/system_components")).data;
    expect(fun.kind).toBe("function");
    expect(fun.definition.startsWith("fun system_components($s: system)")).toBe(true);
    const [rel] = (await c().get("/api/schema/system-membership")).data;
    expect(rel.kind).toBe("relation");
    expect(rel.definition).toContain("relates member");
    expect((await c().get("/api/schema/no-such-type", 404)).error).toBe("not-found");
    expect([404, 422]).toContain((await c().raw('/api/schema/x%22%3B%20delete')).status);
  });
});
