// The TypeDB Advantage panel (/api/advantage): six short sections, each backed by evidence from Apex itself.
//
// Evidence is never written by hand: schema excerpts are read from the schema files that built the database,
// live figures come from TypeDB in the same READ transaction (shown in "Show TypeQL"), and every section links
// to a working example in the app. Statements describe what Apex does; they make no comparison with other
// databases and no performance claim.

import { SCHEMA_FILES, type TextFile } from "./generated/assets.ts";
import * as impact from "./impact.ts";
import * as queries from "./queries.ts";
import { count, sorted } from "./py.ts";
import { value, type Tx } from "./typedb.ts";

export interface Excerpt {
  file: string;
  line: number;
  text: string;
}

/**
 * The schema statement starting at the first line matching `pattern` (up to its closing ';' or, for a
 * function, its return), with its file and line number.
 */
export function excerpt(pattern: RegExp, file?: string): Excerpt {
  const files: TextFile[] = file ? [SCHEMA_FILES.find((f) => f.path === file)!] : SCHEMA_FILES;
  for (const f of files) {
    const lines = f.text.split("\n");
    for (let n = 0; n < lines.length; n++) {
      if (!pattern.test(lines[n]!)) continue;
      const code = (l: string) => l.split("#")[0]!.trimEnd();
      while (n > 0 && lines[n - 1]!.trim() && !code(lines[n - 1]!).endsWith(";") && !lines[n - 1]!.trimStart().startsWith("#")) {
        n--; // back to the start of the statement
      }
      const out: string[] = [];
      for (const text of lines.slice(n)) {
        out.push(text);
        const c = code(text);
        if ((c.endsWith(";") && !out[0]!.startsWith("fun ")) || c.trim().startsWith("return")) break;
      }
      return { file: f.path, line: n + 1, text: out.join("\n") };
    }
  }
  throw new Error(`no schema line matches ${pattern}`);
}

async function labels(tx: Tx, query: string): Promise<string[]> {
  return sorted((await tx.docs(query)).map((d) => d.t.label as string));
}

async function countOf(tx: Tx, query: string): Promise<number> {
  const r = await tx.rows(query);
  return r.length ? value<number>(r[0]!, "n") : 0;
}

function schemaRules(): Record<string, number> {
  const text = SCHEMA_FILES.map((f) => f.text).join("\n");
  const code = text.split("\n").map((line) => line.split("#")[0]!).join("\n");
  const rules: [string, RegExp][] = [["keys", /@key/g], ["cardinalities", /@card\(/g], ["value lists", /@values\(/g], ["ranges", /@range\(/g],
    ["functions", /^\s*fun\s/gm]];
  return Object.fromEntries(rules.map(([k, p]) => [k, [...code.matchAll(p)].length]));
}

export async function advantage(tx: Tx) {
  const raciTypes = await labels(tx, 'match $t sub raci-assignment; fetch { "t": $t };');
  const itemTypes = await labels(tx, 'match $t sub deal-item; fetch { "t": $t };');
  const eventTypes = await labels(tx, 'match $t sub deal-event; fetch { "t": $t };');
  const engagementTypes = await labels(tx, 'match $t sub engagement; fetch { "t": $t };');
  const items = await countOf(tx, "match $x isa deal-item; reduce $n = count;");
  const mandates = await countOf(tx, "match $m isa mandate; reduce $n = count;");
  const start = (await impact.defaultSubject(tx))!;
  const reached = new Set((await tx.rows(
    `match $s isa deal-item, has code "${start}"; let $x in downstream($s); $x has code $c; select $c;`)).map((r) => value<string>(r, "c"))).size;
  const checks = await queries.dataQualityChecks(tx);
  const rules = schemaRules();
  const startName = (await queries.allItems(tx))[start]!.name;
  return { sections: [
    { key: "typed-relationships", title: "Typed relationships",
      statement: "Each relationship in Apex is stored as a typed relation with named roles, so an answer says what "
        + "connects two things and in which capacity, and a relation with three players stays one fact.",
      schema: [excerpt(/^relation mandate/), excerpt(/^relation authority-review/), excerpt(/^relation raci-assignment/)],
      live: [{ label: "Mandates stored, each relating client, adviser and the deal", value: String(mandates) },
        { label: "RACI letters, each its own relation type", value: raciTypes.filter((t) => t !== "raci-assignment").join(", ") }],
      note: null,
      links: [{ label: "See a path explained step by step", to: "/explorer?view=paths&from=PER-AINSWORTH&to=ORG-CMA" },
        { label: "Open the transaction network", to: "/explorer" }] },
    { key: "recursive-reasoning", title: "Recursive reasoning",
      statement: "Dependencies and ownership chains are followed to any depth by functions saved in the schema; "
        + "screens call them like built-ins instead of re-implementing the walk.",
      schema: [excerpt(/^fun downstream/), excerpt(/^fun group_members/)],
      live: [{ label: `Items a delay to ${startName} reaches, through every hard dependency`, value: String(reached) },
        { label: "Saved functions in the schema", value: String(rules.functions) }],
      note: null,
      links: [{ label: "Delay the CMA clearance by 61 days", to: "/impact?item=CP-CMA&days=61" },
        { label: "Effective ownership, route by route", to: "/explorer?view=group" }] },
    { key: "schema-constraints", title: "Schema constraints",
      statement: "Rules such as one Accountable per item, stakes between 0 and 100% and the allowed status words are "
        + "declared in the schema and enforced by the database on every write.",
      schema: [excerpt(/plays accountability:accountable-item @card/), excerpt(/^attribute stake/), excerpt(/^attribute status/)],
      live: [{ label: "Constraints declared (keys, cardinalities, value lists, ranges)",
        value: `${rules.keys} · ${rules.cardinalities} · ${rules["value lists"]} · ${rules.ranges}` },
      { label: "Data-quality checks (negation queries) finding a problem now", value: `${count(Object.values(checks), (found) => found.length > 0)} of ${Object.keys(checks).length}` }],
      note: "Apex only reads, so a rejected write cannot be shown in the app. The optional Studio steps in "
        + "docs/demo-script.md (T1) show TypeDB refusing five bad writes, and the automated tests check the same.",
      links: [{ label: "The data checks (Attention needed) on the Overview", to: "/" },
        { label: "Deadline-critical chain to the Helix waiver", to: "/?cp=DL-HELIX-WAIVER" }] },
    { key: "polymorphism", title: "Polymorphism",
      statement: "Queries ask for a parent type and receive every kind beneath it, so a new kind of item or event "
        + "appears in existing screens without changing their queries.",
      schema: [excerpt(/^entity obligation/), excerpt(/^relation engagement/)],
      live: [{ label: `Types under deal-item, all answered by one pattern (\`$x isa deal-item\` finds ${items} records)`,
        value: itemTypes.filter((t) => t !== "deal-item").join(", ") },
      { label: "Event types; engagement is read from the type hierarchy, not listed in code",
        value: `${eventTypes.filter((t) => !["deal-event", "engagement", "outreach"].includes(t)).join(", ")}; `
          + `engagement: ${engagementTypes.filter((t) => t !== "engagement").join(", ")}` }],
      note: null,
      links: [{ label: "A workstream's activity history", to: "/workstreams/WS-REG" },
        { label: "How engagement is assessed", to: "/parties" }] },
    { key: "application-complexity", title: "Application complexity",
      statement: "In Apex the model's meaning lives in the schema and saved functions; the Python adds dates, ranks "
        + "and formats, and the browser only displays answers.",
      schema: [excerpt(/^relation dependency/), excerpt(/^relation hard-dependency/)],
      live: [{ label: "Rules and saved queries held by the database", value: `${rules.keys! + rules.cardinalities! + rules["value lists"]! + rules.ranges!} constraints, ${rules.functions} functions` },
        { label: "Which dependency kinds move dates", value: "read from the schema (`$k sub hard-dependency`), not configured" }],
      note: "Calculations done in Python are stated where they appear: date arithmetic for projections, duration-"
        + "weighted progress, schedule float, engagement and path ranking.",
      links: [{ label: "Open any panel's Show TypeQL", to: "/" },
        { label: "The guided demonstration", to: "/guide" }] },
    { key: "ai-context", title: "Structured context for AI",
      statement: "Every Apex answer arrives as typed records with stable codes, the exact queries that produced it and, "
        + "for findings, the records that support them: material an AI assistant could cite rather than guess.",
      schema: [excerpt(/^relation reply/)],
      live: [{ label: "What each answer carries", value: "data, the executed TypeQL, capability labels, timing" }],
      note: "Apex runs no AI model. The AI Analyst page is a concept preview built from deterministic queries.",
      links: [{ label: "AI Analyst (concept preview)", to: "/analyst" },
        { label: "A finding with its records", to: "/parties/PER-DONNELLY" }] },
  ] };
}
