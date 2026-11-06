// The downloadable TypeDB model: the live database written out as TypeQL, so anyone can load the demonstrator's
// exact model into their own TypeDB 3.14 server.
//
//     schema.tql  the schema, functions included, exactly as TypeDB returns it (the driver's schema call)
//     data.tql    every entity and relation with its attributes and role players, as one `insert` query
//     README.md   how to load it and some representative queries to try
//
// Everything is read from TypeDB in one READ transaction, never from the seed files, so the export is the database
// the app shows. It is generic: it reads instances, attributes and role players without knowing the vehicle's types.

import { compare, sortBy, sorted } from "./python.ts";
import { string, type Concept, type Connection, type Tx } from "./typedb.ts";

export const ENTITIES = "match $x isa! $t; entity $t;";
export const RELATIONS = "match $x isa! $t; relation $t;";
export const OWNERSHIPS = "match $x isa! $t; {kind} $t; $x has $a;";
export const ROLE_PLAYERS = "match $r isa! $t; relation $t; $r links ($role: $p);";

export interface Instance {
  kind: "entity" | "relation";
  type: string;
  /** (attribute, value as a TypeQL literal) */
  has: [string, string][];
  /** (role, player's IID) */
  links: [string, string][];
}

export type Instances = Map<string, Instance>;

/** A double in plain decimal notation, never an exponent (1e-07): the shortest exact form, written out. */
function plainDouble(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`);
  if (n === 0) return "0.0";
  const sign = n < 0 ? "-" : "";
  const [mantissa, exponentText] = Math.abs(n).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const exponent = Number(exponentText);
  let text: string;
  if (exponent < 0) text = `0.${"0".repeat(-exponent - 1)}${digits}`;
  else if (exponent >= digits.length - 1) text = digits.padEnd(exponent + 1, "0");
  else text = `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  return sign + (text.includes(".") ? text : `${text}.0`);
}

/** An attribute's value as a TypeQL literal of its own value type. */
export function literal(value: unknown, valueType: string): string {
  if (valueType === "string") return string(value as string);
  if (valueType === "boolean") return value ? "true" : "false";
  if (valueType === "double") return plainDouble(value as number);
  if (valueType === "integer") return String(Math.trunc(value as number));
  throw new Error(`value type ${valueType} is not exported`);
}

function iidOf(c: Concept | undefined): string {
  if (!c || !("iid" in c)) throw new Error("expected an instance");
  return c.iid;
}

function labelOf(c: Concept | undefined): string {
  if (!c || !("label" in c)) throw new Error("expected a type");
  return c.label;
}

/** Every instance with its type, attributes and role players, keyed by IID. */
export async function readModel(tx: Tx): Promise<Instances> {
  const instances: Instances = new Map();
  for (const [kind, query] of [["entity", ENTITIES], ["relation", RELATIONS]] as const) {
    for (const r of await tx.rows(query)) instances.set(iidOf(r.x), { kind, type: labelOf(r.t), has: [], links: [] });
  }
  for (const kind of ["entity", "relation"]) {
    for (const r of await tx.rows(OWNERSHIPS.replace("{kind}", kind))) {
      const a = r.a;
      if (!a || a.kind !== "attribute") throw new Error("expected an attribute");
      instances.get(iidOf(r.x))!.has.push([a.type.label, literal(a.value, a.valueType)]);
    }
  }
  for (const r of await tx.rows(ROLE_PLAYERS)) {
    const role = labelOf(r.role).split(":").pop()!;
    instances.get(iidOf(r.r))!.links.push([role, iidOf(r.p)]);
  }
  return instances;
}

// The largest query written (bytes). Some TypeDB servers and clients accept only about 100 KB in one query (a 446 KB
// single insert was cut off at about 106 KB), so the data is written as a series of smaller queries.
export const MAX_QUERY_BYTES = 60_000;
// The most entities one match step looks up (see renderData).
const LOOKUPS_PER_STAGE = 8;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

/**
 * The data as a series of queries, each under MAX_QUERY_BYTES, ended by `end;` and a blank line, so TypeDB
 * Console's `source` runs them one by one (without `end;` it sends the whole file as one query) and a driver can
 * split the file at blank lines. Run them in order in one write transaction.
 *
 * - Entities first, in `insert` batches, ordered by type and key.
 * - Then relations. Each relation query is a pipeline of small steps: `match` up to LOOKUPS_PER_STAGE entities
 *   by their keys, then `insert` the relations that use them, and so on; entities found earlier in the query are
 *   reused. (One `match` finding hundreds of entities at once is slow to plan: 80 key lookups take about a
 *   second, 250 took two minutes and gigabytes of memory.) A relation that plays a role in another (a fallback
 *   protects a dependency) is inserted in the same query as the relations that refer to it.
 *
 * Variables are plain generated names ($e1... for entities, $r1... for relations): letters and digits only, so
 * every TypeQL parser accepts them; ids stay attribute values (component-id and the other keys). No comments and
 * no blank lines inside a query. The output is stable from one export to the next.
 */
export function renderData(instances: Instances, keys: Map<string, string>, supertypes: Map<string, string[]>): string {
  const keyOf = (inst: Instance): [string, string] => {
    for (const t of [inst.type, ...(supertypes.get(inst.type) ?? [])]) {
      const key = keys.get(t);
      if (key !== undefined) {
        const found = inst.has.find(([a]) => a === key);
        if (found) return [key, found[1]];
      }
    }
    throw new Error(`an instance of ${inst.type} has no key, so relations cannot find it`);
  };
  const sortedHas = (inst: Instance) => sortBy(inst.has, (h) => h);

  const entities = sortBy([...instances.keys()].filter((i) => instances.get(i)!.kind === "entity"),
    (i) => [instances.get(i)!.type, keyOf(instances.get(i)!)[1], sortedHas(instances.get(i)!)]);
  const names = new Map<string, string>(entities.map((i, n) => [i, `$e${n + 1}`]));

  const relSort = (i: string) => {
    const inst = instances.get(i)!;
    return [inst.type, sortBy(inst.links.map(([role, p]) => [role, names.get(p) ?? ""]), (x) => x), sortedHas(inst)];
  };
  const relations = sortBy([...instances.keys()].filter((i) => instances.get(i)!.kind === "relation"), relSort);
  relations.forEach((i, n) => names.set(i, `$r${n + 1}`));

  const hasClause = (inst: Instance) => sortedHas(inst).map(([a, v]) => `, has ${a} ${v}`).join("");

  const insertLine = (i: string) => {
    const inst = instances.get(i)!;
    if (inst.kind === "entity") return `  ${names.get(i)} isa ${inst.type}${hasClause(inst)};`;
    const players = sortBy(inst.links, ([role, p]) => [role, names.get(p)]).map(([role, p]) => `${role}: ${names.get(p)}`).join(", ");
    return `  ${names.get(i)} isa ${inst.type} (${players})${hasClause(inst)};`;
  };

  const matchLine = (i: string) => {
    const [attribute, value] = keyOf(instances.get(i)!);
    return `  ${names.get(i)} isa ${instances.get(i)!.type}, has ${attribute} ${value};`;
  };

  const queries: string[] = [];

  // Entities: insert batches.
  let batch: string[] = [];
  let size = 0;
  for (const i of entities) {
    const line = insertLine(i);
    if (batch.length && size + line.length + 1 > MAX_QUERY_BYTES - 16) {
      queries.push("insert\n" + batch.join("\n"));
      batch = [];
      size = 0;
    }
    batch.push(line);
    size += byteLength(line) + 1;
  }
  if (batch.length) queries.push("insert\n" + batch.join("\n"));

  // Relations: group those linked through relation role players, so each group goes into one query, in the order
  // that defines a relation before it is used.
  const group = new Map<string, string>(relations.map((i) => [i, i]));
  const root = (i: string): string => {
    while (group.get(i) !== i) {
      group.set(i, group.get(group.get(i)!)!);
      i = group.get(i)!;
    }
    return i;
  };
  for (const i of relations) {
    for (const [, p] of instances.get(i)!.links) {
      if (instances.get(p)!.kind === "relation") group.set(root(i), root(p));
    }
  }
  const units = new Map<string, string[]>();
  for (const i of relations) {
    const r = root(i);
    if (!units.has(r)) units.set(r, []);
    units.get(r)!.push(i);
  }
  const played = new Set(relations.flatMap((i) => instances.get(i)!.links.map(([, p]) => p)));
  const minBy = (u: string[]) => u.reduce((best, i) => (compare(relSort(i), relSort(best)) < 0 ? i : best));
  const ordered = sortBy(units.values(), (u) => relSort(minBy(u)));
  for (const u of ordered) {
    const sortedUnit = sortBy(u, (i) => [played.has(i) ? 0 : 1, relSort(i)]);
    u.splice(0, u.length, ...sortedUnit);
  }

  const relationQuery = (unitList: string[][]) => {
    const rels = unitList.flat();
    const bound = new Set<string>();
    const stages: string[] = [];
    let lookups: string[] = [];
    let inserts: string[] = [];
    const flush = () => {
      if (lookups.length) stages.push("match\n" + lookups.join("\n"));
      if (inserts.length) stages.push("insert\n" + inserts.join("\n"));
      lookups = [];
      inserts = [];
    };
    for (const i of rels) {
      const fresh = new Set(instances.get(i)!.links.map(([, p]) => p).filter((p) => instances.get(p)!.kind === "entity" && !bound.has(p)));
      const fresh_ = sortBy(fresh, (e) => Number(names.get(e)!.slice(2)));
      if (lookups.length && lookups.length + fresh_.length > LOOKUPS_PER_STAGE) flush();
      lookups.push(...fresh_.map(matchLine));
      for (const e of fresh_) bound.add(e);
      inserts.push(insertLine(i));
    }
    flush();
    return stages.join("\n");
  };

  let unitBatch: string[][] = [];
  for (const u of ordered) {
    if (unitBatch.length && byteLength(relationQuery([...unitBatch, u])) > MAX_QUERY_BYTES) {
      queries.push(relationQuery(unitBatch));
      unitBatch = [];
    }
    unitBatch.push(u);
  }
  if (unitBatch.length) queries.push(relationQuery(unitBatch));
  const ended = queries.map((q) => q + "\nend;");
  for (const q of ended) {
    if (byteLength(q) > MAX_QUERY_BYTES) throw new Error(`a query of ${byteLength(q)} bytes is over the limit`);
  }
  return ended.join("\n\n") + "\n\n";
}

/** The schema as TypeDB returns it, without blank lines (for the same reason as the data). */
export function renderSchema(schema: string): string {
  return schema.split("\n").filter((line) => line.trim()).join("\n") + "\n";
}

/** {type: its key attribute} from the schema text (TypeDB 3.14 cannot yet query annotations such as @key). */
export function keysOf(schema: string): Map<string, string> {
  const keys = new Map<string, string>();
  let current: string | null = null;
  for (const line of schema.split("\n")) {
    if (line && !/^\s/.test(line)) {
      const words = line.split(/\s+/).filter(Boolean);
      current = words.length > 1 ? words[1].replace(/[,;]+$/, "") : null;
    }
    const m = /owns ([a-z0-9-]+) @key/.exec(line);
    if (m && current) keys.set(current, m[1]);
  }
  return keys;
}

/** {type: [its supertypes, nearest first]} from the schema text. */
export function supertypesOf(schema: string): Map<string, string[]> {
  const parent = new Map<string, string>();
  let current: string | null = null;
  for (const line of schema.split("\n")) {
    const words = line.split(/\s+/).filter(Boolean);
    if (line && !/^\s/.test(line) && ["entity", "relation", "attribute"].includes(words[0])) current = words[1].replace(/[,;]+$/, "");
    const m = /^\s+sub ([a-z0-9-]+)/.exec(line);
    if (m && current) parent.set(current, m[1]);
  }
  const out = new Map<string, string[]>();
  for (const t of parent.keys()) {
    const chain: string[] = [];
    let p = parent.get(t);
    while (p) {
      chain.push(p);
      p = parent.get(p);
    }
    out.set(t, chain);
  }
  return out;
}

export interface Counts {
  "by-type": Map<string, number>;
  entities: number;
  relations: number;
  ownerships: number;
  "role-players": number;
}

/** How many instances of each type (most specific), and how many attribute ownerships and role players. */
export function counts(instances: Instances): Counts {
  const byType = new Map<string, number>();
  for (const inst of instances.values()) byType.set(inst.type, (byType.get(inst.type) ?? 0) + 1);
  const all = [...instances.values()];
  return {
    "by-type": new Map(sorted(byType.keys()).map((t) => [t, byType.get(t)!])),
    entities: all.filter((i) => i.kind === "entity").length,
    relations: all.filter((i) => i.kind === "relation").length,
    ownerships: all.reduce((n, i) => n + i.has.length, 0),
    "role-players": all.reduce((n, i) => n + i.links.length, 0),
  };
}

const README = (f: Record<string, string | number>) => `# Noodlelab Visual Explorer: the vehicle model in TypeDB

The complete TypeDB model behind the Noodlelab Visual Explorer, exported from its live database on ${f.day}.
The vehicle is an original concept vehicle for demonstration, not a production model. Its specifications are design
targets, not measured data.

| File | What it holds |
|---|---|
| \`schema.tql\` | The schema: entity, relation and attribute types, and the functions the explorer uses (TypeDB 3.14). |
| \`data.tql\` | The data: every entity and relation with its attributes and role players, as ${f.queries} queries, each ended by \`end;\` and a blank line (each under 60 KB, as some servers and clients limit a query's size). Entities first; then relations, each batch finding its parts by key. Variables are generated (\`$e1\`, \`$r1\`...); each part's id is its \`component-id\` value. |

What is in it: ${f.entities} entities and ${f.relations} relations (${f.components} components, ${f.assemblies} assemblies,
${f.systems} systems, ${f.connections} connections, ${f.dependencies} dependencies, ${f.loops} control loops), ${f.ownerships}
attribute values and ${f.players} role players.

## Load it into your own TypeDB

You need a TypeDB 3.14 server (for example \`docker run -p 1729:1729 typedb/typedb:3.14.1\`) and TypeDB Console, a
TypeDB driver or TypeDB Studio. Load the schema in a schema transaction and commit; then run the data's queries
in order in one write transaction and commit.

**With TypeDB Console** (3.x), from the folder holding these files:

\`\`\`
typedb console --address 127.0.0.1:1729 --username admin --password password --tls-disabled
>> database create vehicle
>> transaction schema vehicle
vehicle::schema>> source schema.tql
vehicle::schema>> commit
>> transaction write vehicle
vehicle::write>> source data.tql
vehicle::write>> commit
\`\`\`

**With the Python driver** (\`pip install typedb-driver==3.*\`):

\`\`\`python
from pathlib import Path
from typedb.driver import TypeDB, Credentials, DriverOptions, DriverTlsConfig, TransactionType

driver = TypeDB.driver("127.0.0.1:1729", Credentials("admin", "password"), DriverOptions(DriverTlsConfig.disabled()))
driver.databases.create("vehicle")
with driver.transaction("vehicle", TransactionType.SCHEMA) as tx:
    tx.query(Path("schema.tql").read_text()).resolve()
    tx.commit()
with driver.transaction("vehicle", TransactionType.WRITE) as tx:
    for query in Path("data.tql").read_text().split("\\n\\n"):  # the queries are separated by blank lines
        if query.strip():
            tx.query(query).resolve()
    tx.commit()
\`\`\`

**With TypeDB Studio:** run \`schema.tql\` in a schema transaction and commit. Then open a write transaction, run
each of the ${f.queries} queries in \`data.tql\` in order (each ends with \`end;\`), and commit.

Loading takes a few seconds. This export was checked by loading it into a fresh database and comparing every
type's instance count, the attribute values and role players, and the answers to the queries below with the
original.

## Queries to try (in a read transaction)

How many components of each kind (polymorphism: \`component\` is abstract, every instance has a more specific type):

\`\`\`
match $c isa! $t; $t sub component;
reduce $n = count groupby $t;
\`\`\`

Every part of the propulsion system, through sub-systems at any depth (a recursive function in \`schema.tql\`):

\`\`\`
match
  $s isa system, has system-id "propulsion";
  let $c in system_components($s);
fetch { "id": $c.component-id, "name": $c.name };
\`\`\`

Every sensor, whatever its kind:

\`\`\`
match $x isa sensor; $x isa! $type;
fetch { "id": $x.component-id, "name": $x.name, "type": $type };
\`\`\`

How the front-right brake calliper is connected (any subtype of the \`connection\` relation):

\`\`\`
match
  $c isa component, has component-id "caliper-fr";
  $r isa! $kind, links (endpoint: $c, endpoint: $other);
fetch { "kind": $kind, "other": $other.name, "details": { $r.* } };
\`\`\`

What stops working, function by function, if the 12 V battery fails (recursive failure reasoning):

\`\`\`
match
  $start isa component, has component-id "lv-battery";
  let $p, $g, $c, $f in lost_steps($start);
fetch { "part": $c.name, "loses": $f.function-name, "because": $p.name, "needs": $g.function-name };
\`\`\`

The total energy stored in the battery modules:

\`\`\`
match $m isa battery-module, has energy-capacity-kwh $e;
reduce $kwh = sum($e), $modules = count;
\`\`\`
`;

/** Today's date as Python's date.today().isoformat() gives it: local time, YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The model as {file name: text}, read from the database in one READ transaction, with its counts. */
export async function build(connection: Connection, database: string): Promise<{ files: Record<string, string>; counts: Counts }> {
  const schema = await connection.schema(database);
  const { result: instances } = await connection.read(readModel, database);
  const data = renderData(instances, keysOf(schema), supertypesOf(schema));
  const c = counts(instances);
  const t = c["by-type"];
  const sup = supertypesOf(schema);
  const total = (rootType: string) => [...t].filter(([ty]) => ty === rootType || (sup.get(ty) ?? []).includes(rootType))
    .reduce((n, [, count]) => n + count, 0);
  const readme = README({
    queries: data.split("\n\n").filter((q) => q.trim()).length, day: today(), entities: c.entities, relations: c.relations,
    components: total("component"), assemblies: total("assembly"), systems: total("system"), connections: total("connection"),
    dependencies: total("dependency"), loops: total("control-loop"), ownerships: c.ownerships, players: c["role-players"],
  });
  return { files: { "schema.tql": renderSchema(schema), "data.tql": data, "README.md": readme }, counts: c };
}
