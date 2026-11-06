// Create the vehicle database: schema, functions and the seed data in data/seed/.
//
//     npm run create-database                   create the database (fails if it exists)
//     npm run create-database -- --if-missing   create it only if it doesn't exist yet (used by compose.yaml)
//     npm run create-database -- --replace      delete and recreate it
//     npm run create-database -- --write-tql    also save the generated insert to data/seed.generated.tql
//
// How it works:
// 1. readSeed(): read the YAML files and expand placeholders (<c>, <a>, <s>, "each").
// 2. validate(): check everything refers to something that exists, before touching the database.
// 3. render(): turn the whole dataset into one TypeQL `insert` query.
// 4. load(): in one WRITE transaction, run the insert, count what arrived in TypeDB, and commit only if
//    every count matches (an insert that silently matched nothing would otherwise go unnoticed).
//
// The visual references (which 3D object draws each component) come from the build-time mapping files in
// web/public/assets/*.map.json; components not in any model file are drawn procedurally in the browser.
// The files are read from the generated module src/generated/assets.ts (`npm run gen`), not from disk.

import { parse } from "yaml";
import { FUNCTIONS_TQL, SCHEMA_TQL, SEED_YAML, VISUAL_MAPS } from "./generated/assets.ts";
import { pythonFloat } from "./json.ts";
import { pyRepr, pyStr, sorted } from "./python.ts";
import { schemaFacts } from "./schema.ts";
import { string, type Connection, type Tx, value } from "./typedb.ts";

export const SCHEMA_FILES: [name: string, text: string][] = [["schema/schema.tql", SCHEMA_TQL], ["schema/functions.tql", FUNCTIONS_TQL]];

export const CORNERS: Record<string, [string, string]> = { fl: ["front", "l"], fr: ["front", "r"], rl: ["rear", "l"], rr: ["rear", "r"] };
// Dependency kind -> family (the relation subtype in the schema).
export const FAMILIES: Record<string, string> = {
  support: "physical-dependency", torque: "physical-dependency",
  power: "operational-dependency", cooling: "operational-dependency", hydraulic: "operational-dependency",
  lubrication: "operational-dependency",
  control: "control-dependency", data: "control-dependency",
};
export const CONNECTION_TYPES: Record<string, [relation: string, attribute: string, key: string]> = {
  mechanical: ["mechanical-connection", "joint-type", "joint"],
  power: ["power-connection", "voltage-class", "voltage"],
  data: ["data-connection", "network", "network"],
  fluid: ["fluid-connection", "fluid", "fluid"],
};

export class SeedError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super("The seed data has problems:\n  - " + problems.join("\n  - "));
    this.problems = problems;
  }
}

// The seed's records, as the YAML gives them (checked by validate, not by the type system).
export type Entry = Record<string, any>;

export interface Seed {
  assemblies: Entry[];
  components: Entry[];
  properties: Entry[];
  systems: Entry[];
  connections: Entry[];
  dependencies: Entry[];
  control_loops: Entry[];
  /** component id -> (asset name, node key) */
  visuals: Map<string, [string, string]>;
}

export interface Resolved {
  properties: Map<string, Record<string, unknown>>;
  members: Map<string, string[]>;
  loops: Entry[];
  connections: Entry[];
  dependencies: Entry[];
  attributes: Map<string, string>;
}

// ---- 1. Reading ---------------------------------------------------------------------------------------------

/** YAML 1.2 (the default): the seed holds no value that YAML 1.1 (PyYAML) would read differently, and the
 * yaml package's 1.1 mode would read the placeholder name "n" as false. */
function yaml(name: string): Entry {
  const text = SEED_YAML[name];
  if (text === undefined) throw new Error(`no seed file ${name}`);
  return parse(text) as Entry;
}

/**
 * All copies of an entry with its placeholders filled in.
 *
 * <c> repeats it for each wheel corner (and sets <a> and <s>); otherwise <a> and <s> repeat it for each
 * axle and side. "each" gives lists for any other placeholder.
 */
export function expand(entry: Entry): Entry[] {
  const text = JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "each")));
  const names = new Set([...text.matchAll(/<(\w+)>/g)].map((m) => m[1]));
  const axes = new Map<string, string[]>();
  for (const [k, vs] of Object.entries((entry.each ?? {}) as Record<string, unknown[]>)) axes.set(k, vs.map((v) => pyStr(v)));
  if (names.has("c")) {
    axes.set("c", Object.keys(CORNERS));
  } else {
    if (names.has("a")) axes.set("a", ["front", "rear"]);
    if (names.has("s")) axes.set("s", ["l", "r"]);
  }
  const implied = names.has("c") ? ["a", "s"] : [];
  const missing = [...names].filter((n) => !axes.has(n) && !implied.includes(n));
  if (missing.length) throw new SeedError([`placeholder ${pyRepr(sorted(missing))} has no values in ${pyRepr(entry)}`]);
  const keys = [...axes.keys()];
  const combos: string[][] = [[]];
  for (const k of keys) {
    const next: string[][] = [];
    for (const combo of combos) for (const v of axes.get(k)!) next.push([...combo, v]);
    combos.splice(0, combos.length, ...next);
  }
  const out: Entry[] = [];
  for (const combo of combos) {
    const values = new Map(keys.map((k, i) => [k, combo[i]]));
    if (values.has("c")) {
      const [a, s] = CORNERS[values.get("c")!];
      values.set("a", a);
      values.set("s", s);
    }
    const filled = text.replace(/<(\w+)>/g, (_, name: string) => values.get(name)!);
    out.push(JSON.parse(filled));
  }
  return out;
}

/** The seed as plain data, with every placeholder expanded. */
export function readSeed(): Seed {
  return {
    assemblies: yaml("assemblies.yaml").assemblies,
    components: yaml("components.yaml").components,
    properties: yaml("properties.yaml").properties,
    systems: yaml("systems.yaml").systems,
    connections: (yaml("connections.yaml").connections as Entry[]).flatMap(expand),
    dependencies: (yaml("dependencies.yaml").dependencies as Entry[]).flatMap(expand),
    control_loops: yaml("control-loops.yaml")["control-loops"],
    visuals: readVisualMaps(),
  };
}

/** component id -> (asset name, node key), from the build-time mapping files. */
export function readVisualMaps(): Map<string, [string, string]> {
  const visuals = new Map<string, [string, string]>();
  for (const name of sorted(Object.keys(VISUAL_MAPS))) {
    const data = JSON.parse(VISUAL_MAPS[name]) as { asset: string; nodes: Record<string, string> };
    for (const [key, component] of Object.entries(data.nodes)) visuals.set(component, [data.asset, key]);
  }
  return visuals;
}

// ---- 2. Checking -------------------------------------------------------------------------------------------

/** Python's fnmatch: `*` anything, `?` one character, `[...]` a set; everything else literal. */
export function fnmatch(name: string, pattern: string): boolean {
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") regex += ".*";
    else if (c === "?") regex += ".";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) regex += "\\[";
      else {
        let set = pattern.slice(i + 1, end);
        if (set.startsWith("!")) set = "^" + set.slice(1);
        regex += `[${set.replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else regex += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^(?:${regex})$`, "s").test(name);
}

/** The ids matching any of the patterns; a pattern that matches nothing is a problem. */
export function matching(patterns: string | string[], ids: string[], where: string, problems: string[]): string[] {
  const list = typeof patterns === "string" ? [patterns] : patterns;
  const found: string[] = [];
  for (const p of list) {
    const hits = ids.filter((i) => fnmatch(i, p));
    if (!hits.length) problems.push(`${where}: pattern '${p}' matches no component`);
    for (const h of hits) if (!found.includes(h)) found.push(h);
  }
  return found;
}

/**
 * Check the seed and work out the final facts: properties per component and system members.
 *
 * Returns the problems found (empty when the seed is good) and the resolved data.
 */
export function resolve(seed: Seed): [string[], Resolved] {
  const problems: string[] = [];
  const facts = schemaFacts();
  const ids: string[] = seed.components.map((c) => c.id);
  const idSet = new Set(ids);
  const assemblies = new Map(seed.assemblies.map((a) => [a.id as string, a]));
  const systems = new Map(seed.systems.map((s) => [s.id as string, s]));

  for (const dup of sorted(new Set(ids.filter((i) => ids.filter((j) => j === i).length > 1)))) {
    problems.push(`component id '${dup}' appears more than once`);
  }
  const roots = seed.assemblies.filter((a) => a.parent === null).map((a) => a.id);
  if (roots.length !== 1) problems.push(`there must be exactly one top assembly, found ${pyRepr(roots)}`);
  for (const a of seed.assemblies) {
    if (a.parent !== null && !assemblies.has(a.parent)) problems.push(`assembly '${a.id}' has unknown parent '${a.parent}'`);
  }
  for (const c of seed.components) {
    if (!facts.concrete.has(c.type)) {
      problems.push(`component '${c.id}' has type '${c.type}', which is not a concrete entity type in the schema`);
    }
    if (!assemblies.has(c.assembly)) problems.push(`component '${c.id}' is in unknown assembly '${c.assembly}'`);
  }

  const properties = new Map<string, Record<string, unknown>>(ids.map((i) => [i, {}]));
  for (const entry of seed.properties) {
    for (const i of matching(entry.match, ids, `properties ${pyStr(entry.match)}`, problems)) {
      for (const [attr, v] of Object.entries(entry)) {
        if (attr === "match") continue;
        if (!facts.attributes.has(attr)) problems.push(`properties of '${i}': unknown attribute '${attr}'`);
        properties.get(i)![attr] = v;
      }
    }
  }

  const members = new Map<string, string[]>();
  for (const s of seed.systems) {
    if (s.parent != null && !systems.has(s.parent)) problems.push(`system '${s.id}' has unknown parent '${s.parent}'`);
    members.set(s.id, matching(s.members ?? [], ids, `system '${s.id}'`, problems));
  }

  for (const c of seed.connections) {
    const [a, b] = c.ends as [string, string];
    for (const end of [a, b]) {
      if (!idSet.has(end)) problems.push(`connection ${a} -- ${b}: unknown component '${end}'`);
    }
    if (a === b) problems.push(`connection joins '${a}' to itself`);
    if (!Object.hasOwn(CONNECTION_TYPES, c.kind)) problems.push(`connection ${a} -- ${b}: unknown kind '${c.kind}'`);
  }
  for (const d of seed.dependencies) {
    const where = `dependency ${d.dependent}: ${pyStr(d.function)} <- ${d.provider}: ${pyStr(d.needs)}`;
    for (const end of [d.dependent, d.provider]) {
      if (!idSet.has(end)) problems.push(`${where}: unknown component '${end}'`);
    }
    if (!Object.hasOwn(FAMILIES, d.kind ?? "")) problems.push(`${where}: unknown kind '${pyStr(d.kind)}'`);
    if (!d.function || !d.needs) problems.push(`${where}: needs both 'function' and 'needs'`);
    if (!["lost", "degraded"].includes(d.loss)) problems.push(`${where}: 'loss' must be lost or degraded`);
    if (![undefined, null, "lost", "degraded"].includes(d.degradation)) problems.push(`${where}: 'degradation' must be lost or degraded`);
    if ("fallback" in d) {
      const backup = d.fallback?.backup;
      if (!idSet.has(backup)) problems.push(`${where}: unknown fallback backup '${pyStr(backup)}'`);
      if (backup === d.provider) problems.push(`${where}: a component cannot be its own fallback`);
      if (d.loss !== "lost") problems.push(`${where}: a fallback only makes sense when the loss effect is 'lost'`);
    }
  }

  const loops: Entry[] = [];
  for (const loop of seed.control_loops) {
    const where = `control loop '${loop.name}'`;
    if (!idSet.has(loop.controller)) problems.push(`${where}: unknown controller '${loop.controller}'`);
    if (!systems.has(loop.system)) problems.push(`${where}: unknown system '${loop.system}'`);
    loops.push({ ...loop, sensors: loop.sensors?.length ? matching(loop.sensors, ids, where, problems) : [],
      actuators: matching(loop.actuators, ids, where, problems) });
  }

  for (const component of seed.visuals.keys()) {
    if (!idSet.has(component)) problems.push(`a 3D model file maps a node to unknown component '${component}'`);
  }

  // Identical facts written twice (e.g. a corner pattern that also matches its own axle) count once.
  const connections = new Map<string, Entry>();
  for (const c of seed.connections) connections.set(JSON.stringify([c.kind, sorted(c.ends as string[])]), c);
  const dependencies = new Map<string, Entry>();
  for (const d of seed.dependencies) dependencies.set(JSON.stringify([d.dependent, d.function, d.provider, d.needs]), d);
  return [problems, { properties, members, loops, connections: [...connections.values()], dependencies: [...dependencies.values()],
    attributes: facts.attributes }];
}

export function validate(seed: Seed): Resolved {
  const [problems, resolved] = resolve(seed);
  if (problems.length) throw new SeedError(problems);
  return resolved;
}

// ---- 3. Writing the query -----------------------------------------------------------------------------------

function variable(prefix: string, identifier: string): string {
  return `$${prefix}_` + identifier.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export function functionNames(resolved: Resolved): string[] {
  return sorted(new Set([...resolved.dependencies.map((d) => d.function as string), ...resolved.dependencies.map((d) => d.needs as string)]));
}

function literal(v: unknown, valueType: string): string {
  if (valueType === "string") return string(pyStr(v));
  if (valueType === "double") return pythonFloat(Number(v));
  if (valueType === "integer") return String(Math.trunc(Number(v)));
  throw new Error(`unsupported value type ${valueType}`);
}

function has(attributes: Record<string, unknown>, valueTypes: Map<string, string>): string {
  return Object.entries(attributes).filter(([, v]) => v !== null && v !== undefined)
    .map(([name, v]) => `, has ${name} ${literal(v, valueTypes.get(name)!)}`).join("");
}

/** The whole dataset as one TypeQL insert query. */
export function render(seed: Seed, resolved: Resolved): string {
  const types = resolved.attributes;
  const lines = ["# GENERATED by api/src/seed.ts from data/seed/*.yaml and web/public/assets/*.map.json.",
    "# Do not edit by hand. Load in a WRITE transaction after schema/schema.tql and schema/functions.tql.",
    "insert"];
  const out = (line: string) => lines.push(line);

  out("  # ---- assemblies ----");
  for (const a of seed.assemblies) {
    out(`  ${variable("a", a.id)} isa assembly` + has({ "assembly-id": a.id, name: a.name, description: a.description }, types) + ";");
  }
  for (const a of seed.assemblies) {
    if (a.parent !== null) out(`  assembly-membership (assembly: ${variable("a", a.parent)}, member: ${variable("a", a.id)});`);
  }

  out("  # ---- components ----");
  for (const c of seed.components) {
    const attributes = { "component-id": c.id, name: c.name, ...resolved.properties.get(c.id)! };
    out(`  ${variable("c", c.id)} isa ${c.type}` + has(attributes, types) + ";");
    out(`  assembly-membership (assembly: ${variable("a", c.assembly)}, member: ${variable("c", c.id)});`);
  }

  out("  # ---- systems ----");
  for (const s of seed.systems) {
    out(`  ${variable("s", s.id)} isa system` + has({ "system-id": s.id, name: s.name, description: s.description }, types) + ";");
  }
  for (const s of seed.systems) {
    if (s.parent != null) out(`  system-membership (system: ${variable("s", s.parent)}, member: ${variable("s", s.id)});`);
    for (const m of resolved.members.get(s.id)!) out(`  system-membership (system: ${variable("s", s.id)}, member: ${variable("c", m)});`);
  }

  out("  # ---- connections ----");
  for (const c of resolved.connections) {
    const [relation, attribute, key] = CONNECTION_TYPES[c.kind];
    const [a, b] = c.ends;
    out(`  $conn_${lines.length} isa ${relation} (endpoint: ${variable("c", a)}, endpoint: ${variable("c", b)})`
      + has({ [attribute]: c[key], description: c.description }, types) + ";");
  }

  out("  # ---- functions and dependencies (function to function) ----");
  for (const name of functionNames(resolved)) out(`  ${variable("fn", name)} isa vehicle-function, has function-name ${string(name)};`);
  resolved.dependencies.forEach((d, i) => {
    out(`  $dep_${i} isa ${FAMILIES[d.kind]} (dependent: ${variable("c", d.dependent)}, affected-function: ${variable("fn", d.function)}, `
      + `provider: ${variable("c", d.provider)}, required-function: ${variable("fn", d.needs)})`
      + has({ "dependency-kind": d.kind, "loss-effect": d.loss, "degradation-effect": d.degradation, description: d.description }, types) + ";");
    if ("fallback" in d) {
      out(`  fallback (protected: $dep_${i}, backup: ${variable("c", d.fallback.backup)})`
        + has({ description: d.fallback.description }, types) + ";");
    }
  });

  out("  # ---- control loops ----");
  resolved.loops.forEach((loop, i) => {
    const roles = [`controller: ${variable("c", loop.controller)}`, `controlled-system: ${variable("s", loop.system)}`];
    roles.push(...(loop.sensors as string[]).map((s) => `sensor: ${variable("c", s)}`));
    roles.push(...(loop.actuators as string[]).map((a) => `actuator: ${variable("c", a)}`));
    out(`  $loop_${i} isa control-loop (${roles.join(", ")})` + has({ name: loop.name, description: loop.description }, types) + ";");
  });

  out("  # ---- 3D geometry ----");
  const visuals = new Map<string, [string, string]>(seed.components.map((c) => [c.id, seed.visuals.get(c.id) ?? ["procedural", c.id]]));
  for (const asset of sorted(new Set([...visuals.values()].map(([a]) => a)))) {
    out(`  ${variable("v", asset)} isa visual-asset, has asset-name ${string(asset)};`);
  }
  for (const [component, [asset, key]] of visuals) {
    out(`  visual-representation (represented: ${variable("c", component)}, asset: ${variable("v", asset)}), has node-key ${string(key)};`);
  }
  return lines.join("\n") + "\n";
}

// ---- 4. Loading -------------------------------------------------------------------------------------------

export function expectedCounts(seed: Seed, resolved: Resolved): Record<string, number> {
  return {
    assembly: seed.assemblies.length,
    component: seed.components.length,
    system: seed.systems.length,
    "assembly-membership": seed.assemblies.length - 1 + seed.components.length,
    "system-membership": seed.systems.filter((s) => s.parent).length + [...resolved.members.values()].reduce((n, m) => n + m.length, 0),
    connection: resolved.connections.length,
    dependency: resolved.dependencies.length,
    "vehicle-function": functionNames(resolved).length,
    fallback: resolved.dependencies.filter((d) => "fallback" in d).length,
    "control-loop": resolved.loops.length,
    "visual-representation": seed.components.length,
  };
}

export async function count(tx: Tx, typeLabel: string): Promise<number> {
  return value<number>((await tx.rows(`match $x isa ${typeLabel}; reduce $n = count;`))[0], "n");
}

/**
 * Validate and load the seed into a database that already has the schema. Returns the counts.
 *
 * Throws SeedError (nothing saved) if the seed is wrong or anything is missing after the insert.
 */
export async function load(connection: Connection, database: string, seed?: Seed): Promise<Record<string, number>> {
  seed = seed ?? readSeed();
  const resolved = validate(seed);
  const expected = expectedCounts(seed, resolved);
  const { result } = await connection.transaction("write", async (tx) => {
    await tx.run(render(seed, resolved));
    const actual: Record<string, number> = {};
    for (const typeLabel of Object.keys(expected)) actual[typeLabel] = await count(tx, typeLabel);
    const problems = Object.entries(expected).filter(([t, n]) => actual[t] !== n)
      .map(([t, n]) => `${t}: expected ${n} in TypeDB, found ${actual[t]}`);
    if (problems.length) throw new SeedError(problems); // throwing closes the transaction without a commit
    return actual;
  }, database);
  return result;
}

/** Create the database with the schema, functions and seed. Deletes it again if loading fails. */
export async function createDatabase(connection: Connection, database: string, seed?: Seed): Promise<Record<string, number>> {
  await connection.createDatabase(database);
  try {
    for (const [, text] of SCHEMA_FILES) await connection.transaction("schema", (tx) => tx.run(text), database);
    return await load(connection, database, seed);
  } catch (error) {
    await connection.deleteDatabase(database);
    throw error;
  }
}
