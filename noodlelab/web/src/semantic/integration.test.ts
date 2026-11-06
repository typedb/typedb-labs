// Integration tests against the running semantic API and TypeDB (decision 0001, tests 1, 2 and 4 from the
// web app's side). They need the whole stack, so they only run when asked:
//   docker exec -e TYPEDB_INTEGRATION=1 noodlelab-web-dev npx vitest run src/semantic
// When asked, an unreachable API is a failure, not a skip.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTS } from "../vehicle/manifest";

const API = process.env.API_URL ?? "http://127.0.0.1:8000";
const root = process.env.PROJECT_ROOT ?? join(__dirname, "../../..");

async function get<T>(path: string): Promise<{ data: T; typeql: string[] }> {
  const response = await fetch(`${API}/api/${path}`);
  expect(response.status, `${path}: ${response.status}`).toBe(200);
  return response.json();
}

describe.runIf(process.env.TYPEDB_INTEGRATION === "1")("the web app against TypeDB", () => {
  it("every part the web app draws is a component in TypeDB, and every component is drawn", async () => {
    const { data } = await get<{ id: string; asset: string; node: string }[]>("components");
    expect(data.map((c) => c.id).sort()).toEqual(PARTS.map((p) => p.id).sort());
  });

  it("TypeDB's visual references are the nodes the app loads from each model file", async () => {
    const { data } = await get<{ id: string; asset: string; node: string }[]>("components");
    const assets = ["corner-fr", "corner-fl", "corner-rr", "corner-rl", "chassis", "steering", "brakes", "thermal", "front-drive-unit", "rear-drive-unit", "hv-battery", "power-electronics", "body-structure", "body-exterior"];
    expect([...new Set(data.map((c) => c.asset))].sort()).toEqual([...assets, "procedural"].sort());
    for (const asset of assets) {
      const fromTypeDB = Object.fromEntries(data.filter((c) => c.asset === asset).map((c) => [c.node, c.id]));
      const map = JSON.parse(readFileSync(join(root, `web/public/assets/${asset}.map.json`), "utf8"));
      expect(fromTypeDB, asset).toEqual(map.nodes);
    }
  });

  it("component details and assembly paths are answered by TypeQL", async () => {
    const component = await get<{ name: string; types: string[] }>("components/brake-disc-fl");
    expect(component.data.types[0]).toBe("brake-disc");
    expect(component.typeql.join("\n")).toContain('has component-id "brake-disc-fl"');
    const assembly = await get<{ path: { id: string }[] }>("components/brake-disc-fl/assembly");
    expect(assembly.data.path.map((a) => a.id)).toEqual(["corner-fl", "chassis", "vehicle"]);
  });
});

describe.runIf(process.env.TYPEDB_INTEGRATION === "1")("the semantic browser against TypeDB", () => {
  const drawn = new Set(PARTS.map((p) => p.id));

  it("the type hierarchy counts every part the app draws", async () => {
    const { data } = await get<{ type: string; total: number }[]>("types");
    expect(data.find((t) => t.type === "component")!.total).toBe(PARTS.length);
  });

  it("every system's members are parts the app draws", async () => {
    const { data: systems } = await get<{ id: string }[]>("systems");
    for (const s of systems) {
      const { data } = await get<{ components: { id: string }[] }>(`systems/${s.id}`);
      for (const c of data.components) expect(drawn.has(c.id), `${s.id}: ${c.id}`).toBe(true);
    }
  });

  it("every assembly's parts are parts the app draws, and the tree's total is the whole vehicle", async () => {
    const { data: tree } = await get<{ id: string; parent: string | null; total: number }[]>("assemblies");
    expect(tree.find((a) => a.parent === null)!.total).toBe(PARTS.length);
    const { data } = await get<{ "all-component-ids": string[] }>("assemblies/vehicle");
    expect(new Set(data["all-component-ids"])).toEqual(drawn);
  });

  it("every question's highlighted parts are parts the app draws", async () => {
    const { data: questions } = await get<{ id: string }[]>("questions");
    // The 4-second single-failure question is checked against the failure oracle in api/tests instead.
    for (const q of questions.filter((x) => x.id !== "propulsion-single-points")) {
      const { data, typeql } = await get<{ highlight: string[] }>(`questions/${q.id}`);
      expect(typeql.length, q.id).toBeGreaterThan(0);
      for (const id of data.highlight) expect(drawn.has(id), `${q.id}: ${id}`).toBe(true);
    }
  });
});
