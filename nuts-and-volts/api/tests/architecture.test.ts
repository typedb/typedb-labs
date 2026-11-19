// The integration tests listed in docs/decisions/0001-typedb-sole-database.md, against a real TypeDB server.
//
// 1. component metadata comes from TypeDB
// 2. assembly relationships come from TypeDB
// 3. semantic perspectives are produced by TypeQL
// 4. every component id in TypeDB resolves to a visual asset node, and every visual node to a component
//    (this side checks TypeDB against the model files; web/src/semantic/integration.test.ts checks it
//    against the web app's visual manifest)
// 5. no other database is used (also web/src/architecture.test.ts, which reads the whole project)
// 6. a stopped TypeDB produces the explicit error state, not mock data
// Plus 7: the explosion grouping (an animation asset) is generated from TypeDB and still matches it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { explosionGroups, render } from "../src/animation.ts";
import type { Doc } from "../src/queries.ts";
import { client, connection, database, scratchDatabase, subset } from "./helpers.ts";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url));

describe("TypeDB is the source of every fact", () => {
  it("1. component metadata comes from TypeDB", async () => {
    // Change a name and a property in TypeDB only: the API must return the new values at once.
    const scratch = await scratchDatabase();
    try {
      const c = client(scratch);
      const before = (await c.get("/api/components/caliper-fr")).data;
      expect(before.name).toBe("Front right brake calliper");
      await connection.transaction("write", async (tx) => {
        await tx.run('match $c isa brake-caliper, has component-id "caliper-fr", has name $n, has piston-count $p; delete has $n of $c; has $p of $c;');
        await tx.run('match $c isa brake-caliper, has component-id "caliper-fr"; insert $c has name "Renamed only in TypeDB", has piston-count 8;');
      }, scratch);
      const after = (await c.get("/api/components/caliper-fr")).data;
      expect(after.name).toBe("Renamed only in TypeDB");
      expect(after.properties).toContainEqual({ attribute: "piston-count", value: 8 });
    } finally {
      await connection.deleteDatabase(scratch);
    }
  });

  it("2. assembly relationships come from TypeDB", async () => {
    // Move a component to another assembly in TypeDB only: its assembly path must follow.
    const scratch = await scratchDatabase();
    try {
      const c = client(scratch);
      const pathOf = async () => (await c.get("/api/components/lidar/assembly")).data.path.map((a: Doc) => a.id);
      expect(await pathOf()).toEqual(["sensor-suite", "vehicle"]);
      await connection.transaction("write", async (tx) => {
        await tx.run('match $c isa component, has component-id "lidar"; $m isa assembly-membership (member: $c); delete $m;');
        await tx.run('match $c isa component, has component-id "lidar"; $a isa assembly, has assembly-id "greenhouse"; '
          + "insert assembly-membership (assembly: $a, member: $c);");
      }, scratch);
      expect(await pathOf()).toEqual(["greenhouse", "body", "vehicle"]);
      expect((await c.get("/api/assemblies/body")).data["all-component-ids"]).toContain("lidar");
      expect((await c.get("/api/assemblies/sensor-suite")).data["all-component-ids"]).not.toContain("lidar");
    } finally {
      await connection.deleteDatabase(scratch);
    }
  });

  /** Every string that looks like an id, anywhere in a query result. */
  function idsIn(value: unknown, found: Set<string>): Set<string> {
    if (Array.isArray(value)) for (const v of value) idsIn(v, found);
    else if (value && typeof value === "object") for (const v of Object.values(value)) idsIn(v, found);
    else if (typeof value === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) found.add(value);
    return found;
  }

  it("3. semantic perspectives are produced by TypeQL", async () => {
    // Every answer lists its TypeQL; running exactly that TypeQL in TypeDB yields every id the answer shows.
    const c = client(database());
    for (const [path, key] of [["/api/systems/braking", "components"], ["/api/assemblies/front-drive-unit", "all-component-ids"],
      ["/api/components/lv-battery/impact", "lost"], ["/api/components/tyre-fr/requirements", "required"]]) {
      const body = await c.get(path);
      expect(body.typeql.length, `${path} returned no TypeQL`).toBeGreaterThan(0);
      const shown: (string | Doc)[] = body.data[key];
      const shownIds = new Set(shown.map((x) => (typeof x === "string" ? x : x.id)));
      expect(shownIds.size, `${path} returned nothing`).toBeGreaterThan(0);
      const found = new Set<string>();
      await connection.read(async (tx) => {
        for (const query of body.typeql as string[]) {
          if (query.includes("fetch")) idsIn(await tx.docs(query), found); // the others are existence checks that return no ids
        }
      }, database());
      const missing = [...shownIds].filter((i) => !found.has(i)).sort();
      expect(missing, `${path}: ids not produced by its TypeQL`).toEqual([]);
    }
  });

  it("4. every component has a visual node and every node a component", async () => {
    // TypeDB's visual references agree with the model files' mapping, in both directions.
    const components: Doc[] = (await client(database()).get("/api/components")).data;
    const byId = new Map(components.map((c) => [c.id, c]));
    const modelNodes = new Map<string, string>();
    const assets = join(PROJECT, "web", "public", "assets");
    for (const file of readdirSync(assets).filter((f) => f.endsWith(".map.json"))) {
      const data = JSON.parse(readFileSync(join(assets, file), "utf8"));
      for (const [node, component] of Object.entries(data.nodes as Record<string, string>)) modelNodes.set(`${data.asset}/${node}`, component);
    }
    // every node in a model file -> a component whose visual reference is that node
    for (const [assetNode, component] of modelNodes) {
      expect(byId.has(component), `${assetNode} draws unknown component ${component}`).toBe(true);
      expect(`${byId.get(component)!.asset}/${byId.get(component)!.node}`).toBe(assetNode);
    }
    // every component -> a node in a model file, or drawn procedurally under its own id
    for (const c of components) {
      if (c.asset === "procedural") expect(c.node).toBe(c.id);
      else expect(modelNodes.has(`${c.asset}/${c.node}`), `${c.id} points at missing node ${c.asset}/${c.node}`).toBe(true);
    }
  });

  const DATABASE_PACKAGES = /pg|postgres|mysql|sqlite|mongo|mongoose|redis|neo4j|prisma|typeorm|sequelize|knex|drizzle|dexie|idb|localforage|pouchdb|firebase|supabase|lowdb|nedb|duckdb|cassandra|elastic/i;

  it("5. no other database in the backend", () => {
    // The backend depends on the TypeDB driver and nothing that stores data.
    const pkg = JSON.parse(readFileSync(join(PROJECT, "api", "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps).toContain("@typedb/driver-http");
    expect(deps.filter((d) => DATABASE_PACKAGES.test(d))).toEqual([]);
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
    for (const source of [...sources(join(PROJECT, "api", "src")), ...sources(join(PROJECT, "api", "scripts")), join(PROJECT, "api", "server.ts")]) {
      const imports = [...readFileSync(source, "utf8").matchAll(/^\s*import\b[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
      expect(imports.filter((i) => !i.startsWith(".") && !i.startsWith("node:") && DATABASE_PACKAGES.test(i)), source).toEqual([]);
    }
  });

  it("6. an unreachable TypeDB gives the explicit error, not data", async () => {
    // With no TypeDB at the address, every semantic endpoint says so, with no data.
    const c = client("vehicle", "127.0.0.1:1");
    for (const path of ["/api/components", "/api/components/caliper-fr", "/api/components/caliper-fr/assembly",
      "/api/components/caliper-fr/systems", "/api/components/caliper-fr/relationships",
      "/api/components/caliper-fr/impact", "/api/components/caliper-fr/requirements",
      "/api/assemblies/chassis", "/api/systems", "/api/systems/braking"]) {
      const response = await c.raw(path);
      expect(response.status, path).toBe(503);
      const body = await response.json();
      expect(body.error).toBe("typedb-unavailable");
      expect("data" in body).toBe(false);
    }
    const health = await c.raw("/api/health");
    expect(health.status).toBe(503);
    expect((await health.json()).typedb).toBe("unavailable");
  });

  it("7. the explosion grouping is generated from TypeDB and current", async () => {
    // The animation's assembly grouping is exactly what TypeDB says now (regenerate with `npm run animation`).
    const { result } = await connection.read(explosionGroups, database());
    const committed = readFileSync(join(PROJECT, "web", "src", "vehicle", "explosion-groups.json"), "utf8");
    expect(committed, "web/src/vehicle/explosion-groups.json is out of date: regenerate it from TypeDB").toBe(render(result));
  });

  it("the highlighted ids of a perspective are a subset of the components", async () => {
    const c = client(database());
    const all = new Set(((await c.get("/api/components")).data as Doc[]).map((x) => x.id));
    expect(subset((await c.get("/api/assemblies/vehicle")).data["all-component-ids"], all)).toBe(true);
  });
});
