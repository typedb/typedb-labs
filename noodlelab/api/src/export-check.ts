// Check the downloadable model: take the ZIP the app serves, load it into a fresh database exactly as its README
// says (schema in a schema transaction, then the data's queries in order in one write transaction), and compare
// with the source.
//
//     npm run export-check -- [source-database]
//
// Checks the files' syntax (generated variables are letters and digits only; no comments, blank lines or exponent
// numbers), then compares the named totals (components, connections, dependencies, assemblies, systems, functions...),
// every instance (type, attribute values and role players, matched without IIDs), every type's instance count, the
// schema, representative explorer answers and the README's example queries. Returns a report; the fresh database
// ("vehicle-export-check-<random>") is deleted afterwards.

import * as exportModel from "./export.ts";
import { toJson } from "./json.ts";
import * as queries from "./queries.ts";
import * as questions from "./questions.ts";
import { sorted } from "./python.ts";
import { value, type Connection, type Tx } from "./typedb.ts";
import { unzip as unzipBytes, zip } from "./zip.ts";

// The totals compared by name (each counts instances of the type and its subtypes).
export const TOTALS = ["component", "connection", "dependency", "assembly", "system", "vehicle-function", "fallback", "control-loop",
  "assembly-membership", "system-membership", "visual-representation"];

export type Files = Record<string, string>;

/** {file name: text} from the model ZIP. */
export async function unzip(data: Uint8Array): Promise<Files> {
  const members = await unzipBytes(data);
  return Object.fromEntries(Object.entries(members).map(([n, text]) => [n.split("/").slice(1).join("/"), text]));
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Python's str.splitlines(): no empty last line for text that ends with a newline. */
const splitlines = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

/**
 * Generated syntax that a strict or size-limited TypeQL client could reject: data.tql must be queries
 * separated by blank lines, each under MAX_QUERY_BYTES and starting with insert or match, with plain
 * variables (letters and digits), no comments and no exponent numbers; schema.tql must have no blank lines.
 */
export function syntaxProblems(files: Files): string[] {
  const data = files["data.tql"];
  const problems: string[] = [];
  const list = data.split("\n\n").filter((q) => q.trim());
  if (!list.length) problems.push("data.tql has no queries");
  list.forEach((q, i) => {
    const n = i + 1;
    if (byteLength(q) > exportModel.MAX_QUERY_BYTES) problems.push(`data.tql query ${n} is ${byteLength(q)} bytes`);
    if (!/^(insert|match)/.test(q.replace(/^\n+/, ""))) problems.push(`data.tql query ${n} does not start with insert or match`);
    if (!q.trimEnd().endsWith("end;")) problems.push(`data.tql query ${n} does not end with end;`);
  });
  const outsideStrings = data.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const bad = sorted(new Set([...outsideStrings.matchAll(/\$[^\s,;():]+/g)].map((m) => m[0]).filter((v) => !/^\$[a-z][a-z0-9]*$/.test(v))));
  if (bad.length) problems.push(`variables that are not plain letters and digits: ${JSON.stringify(bad.slice(0, 5))}`);
  if (splitlines(files["schema.tql"]).some((line) => !line.trim())) problems.push("schema.tql has blank lines");
  if (outsideStrings.includes("#")) problems.push("data.tql has comments");
  if (/(?<![\w$])\d+(\.\d+)?[eE][-+]?\d/.test(outsideStrings)) problems.push("data.tql has numbers in exponent notation");
  return problems;
}

/** Loads the files into a new database the way the README says: schema, then the data's queries in order. */
export async function loadFiles(connection: Connection, files: Files, database: string): Promise<void> {
  await connection.createDatabase(database);
  await connection.transaction("schema", (tx) => tx.run(files["schema.tql"]), database);
  await connection.transaction("write", async (tx) => {
    for (const query of files["data.tql"].split("\n\n")) if (query.trim()) await tx.run(query);
  }, database);
}

export async function totals(connection: Connection, database: string): Promise<Record<string, number>> {
  const { result } = await connection.read(async (tx) => {
    const out: Record<string, number> = {};
    for (const t of TOTALS) {
      const rows = await tx.rows(`match $x isa ${t}; reduce $n = count;`);
      out[t] = rows.length ? value<number>(rows[0], "n") : 0;
    }
    return out;
  }, database);
  return result;
}

/**
 * Each instance as text without IIDs: entities by type and attributes, relations also by their role players'
 * canonical forms (relations playing roles are resolved first). Returns how many times each form occurs.
 */
export function canonical(instances: exportModel.Instances): Map<string, number> {
  const memo = new Map<string, string>();
  const form = (i: string): string => {
    if (!memo.has(i)) {
      const inst = instances.get(i)!;
      const players = sorted(inst.links.map(([role, p]) => `${role}=${form(p)}`));
      memo.set(i, `${inst.type}${JSON.stringify(sorted(inst.has.map(([a, v]) => `${a}=${v}`)))}${JSON.stringify(players)}`);
    }
    return memo.get(i)!;
  };
  const counter = new Map<string, number>();
  for (const i of instances.keys()) counter.set(form(i), (counter.get(form(i)) ?? 0) + 1);
  return counter;
}

function sameCounter(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && [...a].every(([k, n]) => b.get(k) === n);
}

/** The TypeQL examples in the README (fenced blocks starting with match). */
export function readmeQueries(readme: string): string[] {
  const blocks = readme.split("```").filter((_, i) => i % 2 === 1);
  return blocks.map((b) => b.trim()).filter((b) => b.startsWith("match"));
}

/** Answers with every list sorted: TypeDB returns answers in no particular order, and the comparison is about what the answers are. */
export function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise).sort((x, y) => (toJson(x) < toJson(y) ? -1 : toJson(x) > toJson(y) ? 1 : 0));
  if (v && typeof v === "object" && !(v instanceof Map) && v.constructor === Object) {
    return Object.fromEntries(sorted(Object.keys(v)).map((k) => [k, normalise((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** Representative explorer answers, as plain data. */
export async function answers(connection: Connection, database: string): Promise<Record<string, unknown>> {
  const { result } = await connection.read(async (tx: Tx) => ({
    systems: await queries.systemList(tx),
    propulsion: sorted((await queries.system(tx, "propulsion")).components.map((c) => c.id)),
    powertrain: (await queries.assembly(tx, "powertrain"))["all-component-ids"],
    types: await queries.typeHierarchy(tx),
    sensors: (await queries.typeDetail(tx, "sensor")).instances,
    "caliper-relationships": await queries.componentRelationships(tx, "caliper-fr"),
    "lv-battery-impact": await queries.componentImpact(tx, "lv-battery"),
    "front-motor-requirements": await queries.componentRequirements(tx, "front-motor"),
    "pack-energy": await questions.run(tx, "pack-energy"),
    "load-path": await questions.run(tx, "load-path"),
  }), database);
  return result;
}

export interface Check {
  problems: string[];
  report: string[];
  /** {type: (source total, loaded total)} */
  totals: Record<string, [number, number]>;
}

/**
 * `files` defaults to a fresh export of the source, packed and unpacked through the same ZIP the app serves.
 * `loaded` names a database already loaded from those files some other way (for example with TypeDB Console);
 * it is compared, not deleted.
 */
export async function check(connection: Connection, source: string, files?: Files, loaded?: string): Promise<Check> {
  if (!files) {
    const built = (await exportModel.build(connection, source)).files;
    files = await unzip(await zip(Object.entries(built).map(([n, t]) => [`noodlelab-vehicle-typedb-model/${n}`, t])));
  }
  const problems = syntaxProblems(files);
  const report = [`syntax: ${problems.length ? problems.join("; ") : "clean"}`];
  const target = loaded ?? `vehicle-export-check-${Math.random().toString(16).slice(2, 10)}`;
  const named: Record<string, [number, number]> = {};
  try {
    if (loaded) report.push(`comparing ${loaded}, loaded beforehand`);
    else {
      await loadFiles(connection, files, target);
      report.push("loaded into a fresh database with the README's instructions");
    }
    const [ta, tb] = [await totals(connection, source), await totals(connection, target)];
    for (const t of TOTALS) {
      named[t] = [ta[t], tb[t]];
      report.push(`${t}: ${ta[t]} source, ${tb[t]} loaded`);
      if (ta[t] !== tb[t]) problems.push(`${t} totals differ`);
    }
    const ia = (await connection.read(exportModel.readModel, source)).result;
    const ib = (await connection.read(exportModel.readModel, target)).result;
    const [ca, cb] = [exportModel.counts(ia), exportModel.counts(ib)];
    for (const k of ["entities", "relations", "ownerships", "role-players"] as const) {
      report.push(`${k}: ${ca[k]} original, ${cb[k]} loaded`);
      if (ca[k] !== cb[k]) problems.push(`${k} differ`);
    }
    const sameTypes = sameCounter(ca["by-type"], cb["by-type"]);
    if (!sameTypes) {
      const all = new Set([...ca["by-type"].keys(), ...cb["by-type"].keys()]);
      const differing = [...all].filter((t) => ca["by-type"].get(t) !== cb["by-type"].get(t))
        .map((t) => `${t}: (${ca["by-type"].get(t)}, ${cb["by-type"].get(t)})`);
      problems.push(`per-type counts differ: ${differing.join(", ")}`);
    }
    report.push(`types with instances: ${ca["by-type"].size}, every count equal: ${sameTypes}`);
    const same = sameCounter(canonical(ia), canonical(ib));
    report.push(`every instance identical (type, attributes, role players): ${same}`);
    if (!same) problems.push("instances differ");
    if ((await connection.schema(source)) !== (await connection.schema(target))) problems.push("schemas differ");
    report.push(`schema identical: ${!problems.includes("schemas differ")}`);
    const [qa, qb] = [normalise(await answers(connection, source)), normalise(await answers(connection, target))] as [
      Record<string, unknown>, Record<string, unknown>];
    for (const name of Object.keys(qa)) {
      const ok = toJson(qa[name]) === toJson(qb[name]);
      report.push(`query ${name}: ${ok ? "same answer" : "DIFFERENT"}`);
      if (!ok) problems.push(`query ${name} differs`);
    }
    const examples = readmeQueries(files["README.md"]);
    for (let i = 0; i < examples.length; i++) {
      try {
        const { result: n } = await connection.read(async (tx) => {
          const resp = await tx.run(examples[i]);
          return resp.answerType === "ok" ? 0 : resp.answers.length;
        }, target);
        report.push(`README query ${i + 1}: ${n} answers`);
        if (n === 0) problems.push(`README query ${i + 1} has no answers`);
      } catch (error) {
        problems.push(`README query ${i + 1} fails: ${(error as Error).message}`);
      }
    }
    return { problems, report, totals: named };
  } finally {
    if (!loaded && (await connection.databaseExists(target))) await connection.deleteDatabase(target);
  }
}
