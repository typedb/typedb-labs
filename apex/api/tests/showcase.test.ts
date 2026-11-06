// Phase 6F showcase: the TypeDB Advantage panel, the AI Analyst concept preview and the guided demonstration.
// Every claim must be backed by the schema, the data or a working view; nothing may be invented.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { client } from "./helpers.ts";
import { Exact, rawSeed, ROOT, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const ROUTES = ["/", "/workstreams", "/parties", "/explorer", "/impact", "/analyst", "/guide"];
const COMPARATIVE = /\b(faster|slower|better than|worse than|unlike|compared with|outperform|times (faster|quicker)|only TypeDB)\b/i;

let c: ReturnType<typeof client>;
beforeAll(() => {
  c = client();
});

function linksOf(obj: unknown): string[] {
  if (Array.isArray(obj)) return obj.flatMap(linksOf);
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj).sort().join(",");
    return keys === "label,to" ? [(obj as Rec).to] : Object.values(obj).flatMap(linksOf);
  }
  return [];
}

function validRoute(to: string): boolean {
  const path = to.split("?")[0]!.split("#")[0]!;
  return path === "/" || ROUTES.slice(1).some((r) => path === r || path.startsWith(r + "/"));
}

function filesUnder(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, suffix));
    else if (name.endsWith(suffix)) out.push(path);
  }
  return out;
}

test("advantage has six sections with real evidence", async () => {
  const body = await c.ok("/api/advantage");
  const sections: Rec[] = body.data.sections;
  expect(sections.map((s) => s.key)).toEqual(["typed-relationships", "recursive-reasoning", "schema-constraints", "polymorphism", "application-complexity", "ai-context"]);
  for (const s of sections) {
    expect(s.schema.length && s.links.length && s.statement).toBeTruthy();
    for (const ex of s.schema) { // quoted verbatim from the file, at that line
      const lines = readFileSync(join(ROOT, ex.file), "utf8").split("\n");
      expect(lines.slice(ex.line - 1, ex.line - 1 + ex.text.split("\n").length).join("\n")).toBe(ex.text);
    }
    for (const text of [s.statement, s.note ?? "", ...s.live.map((f: Rec) => f.label)]) expect(COMPARATIVE.test(text), `${s.key}: ${text}`).toBe(false);
    expect(linksOf(s.links).every(validRoute)).toBe(true);
  }
  const facts: Record<string, string> = Object.fromEntries(sections.flatMap((s) => s.live.map((f: Rec) => [f.label, f.value])));
  expect(facts["Mandates stored, each relating client, adviser and the deal"]).toBe(String(SEED.mandates.length));
  expect(facts["Saved functions in the schema"]).toBe(String((readFileSync(join(ROOT, "schema", "functions.tql"), "utf8").match(/^fun /gm) ?? []).length));
  const reach = Object.entries(facts).find(([k]) => k.startsWith("Items a delay to"))![1];
  expect(reach).toBe("17"); // the Impact Explorer's downstream count for CP-CMA
  expect(body.typeql.length).toBeGreaterThan(0);
  expect(body.typeql.some((q: string) => ["insert", "delete", "define"].some((w) => q.includes(w)))).toBe(false);
});

test.each(["closing-risks", "who-acts", "regulatory-delay"])("investigation %s separates executed from hypothetical", async (key) => {
  const body = await c.ok(`/api/analyst/${key}`);
  const steps: Rec[] = body.data.steps;
  const kinds = steps.map((s) => s.kind);
  expect(kinds.at(-1)).toBe("hypothetical");
  expect(kinds.filter((k) => k === "hypothetical")).toHaveLength(1);
  expect(kinds).toContain("executed");
  expect(steps.some((s) => s.kind === "executed" && s.queries.length)).toBe(true);
  for (const s of steps) {
    expect(s.queries.every((i: number) => i >= 0 && i < body.typeql.length)).toBe(true);
    if (s.kind === "hypothetical") {
      expect(s.queries).toEqual([]);
      expect(s.how).toContain("AI agent");
    }
    expect(linksOf(s.findings).every(validRoute)).toBe(true);
  }
  expect(body.data.investigations.map((i: Rec) => i.key)).toEqual(["closing-risks", "who-acts", "regulatory-delay"]);
});

test("investigation findings match the records", async () => {
  const who: Rec[] = (await c.ok("/api/analyst/who-acts")).data.steps;
  const overdue = who.find((s) => s.title === "Find responses that are overdue")!;
  expect(new Set(overdue.findings.flatMap((f: Rec) => f.links.map((l: Rec) => l.to)))).toEqual(new Set(["/parties/PER-DONNELLY", "/parties/PER-OSULLIVAN"]));
  const delay: Rec[] = (await c.ok("/api/analyst/regulatory-delay")).data.steps;
  const text = delay.flatMap((s) => s.findings.map((f: Rec) => f.text)).join(" ");
  expect(text).toContain("breaks at 61 days");
  expect(text).toContain("120 days");
  expect(text).toContain("136 days");
  const risks: Rec[] = (await c.ok("/api/analyst/closing-risks")).data.steps;
  expect(risks[1]!.findings[0].text).toContain("can absorb 60 days");
  expect((await c.get("/api/analyst/nope")).status).toBe(404);
});

test("no AI model or external API anywhere", () => {
  const code = filesUnder(join(ROOT, "api", "src"), ".ts").map((p) => readFileSync(p, "utf8")).join("\n").toLowerCase();
  const deps = (readFileSync(join(ROOT, "api", "package.json"), "utf8") + readFileSync(join(ROOT, "web", "package.json"), "utf8")).toLowerCase();
  for (const word of ["anthropic", "openai", "langchain", "fetch(", "xmlhttprequest"]) {
    expect(code, word).not.toContain(word);
    expect(deps, word).not.toContain(word);
  }
});

test("guide figures match the live answers", async () => {
  const steps: Rec[] = (await c.ok("/api/guide")).data.steps;
  expect(steps).toHaveLength(8);
  expect(steps.every((s) => validRoute(s.to))).toBe(true);
  const text = steps.map((s) => s.say + " " + s.show.join(" ")).join(" ");
  const chart = (await c.ok("/api/schedule")).data;
  const helix = chart.deadlines.find((d: Rec) => d.code === "DL-HELIX-WAIVER");
  expect(text).toContain(`absorb ${helix.critical_path.float} days`);
  expect(helix.critical_path.items).toHaveLength(3);
  const breaks = (await c.ok("/api/impact?item=CP-CMA")).data.deadlines.map((d: Rec) => d.breach_from_days).sort((a: number, b: number) => a - b);
  expect(text).toContain(`${breaks[0]}, ${breaks[1]} and ${breaks[2]} days`);
  const moved = (await c.ok("/api/impact?item=CP-CMA&delay_days=61")).data.summary.moved;
  expect(text).toContain(`${moved} items move`);
  const group = (await c.ok("/api/ownership")).data;
  const ip = group.companies.find((x: Rec) => x.code === "ORG-ATL-IP");
  expect(new Exact(ip.stake).equals("0.9")).toBe(true);
  expect(ip.routes).toBe(2);
  expect(text).toContain("90% effective ownership over two routes");
  const status = (await c.ok("/api/deal")).data.status;
  const outstanding = status.conditions_total - status.conditions_satisfied;
  expect(text).toContain(`${["zero", "one", "two", "three"][outstanding]} of ${["", "", "", "", "", "", "six"][status.conditions_total]} conditions outstanding`);
});

test("Show TypeQL uses the TypeDB purple", () => {
  const css = readFileSync(join(ROOT, "web", "src", "index.css"), "utf8").toLowerCase();
  expect(["#f5f1fc", "#ddd1f2", "#65459a"].every((h) => css.includes(h))).toBe(true);
  const drawer = readFileSync(join(ROOT, "web", "src", "components", "typeql.tsx"), "utf8");
  expect(drawer).toContain("bg-typedb-tint");
  expect(drawer).toContain("border-typedb-line");
  expect(drawer).toContain("text-typedb");
});

test("deadline chains are not called critical paths", async () => {
  // The chain is measured against a contractual deadline, so screens and scripts say "deadline-critical chain";
  // "critical path" may appear only to explain that it is not a conventional one.
  const allowed = /not a conventional (\(CPM\) )?critical path/gi;
  const texts = [];
  for (const u of ["/api/guide", "/api/advantage", "/api/analyst/closing-risks"]) texts.push((await c.get(u)).text);
  texts.push(...filesUnder(join(ROOT, "web", "src"), ".tsx").map((p) => readFileSync(p, "utf8")));
  const found = texts.flatMap((t) => [...t.replace(allowed, "").matchAll(/[^\n]{0,40}critical path[^\n]{0,40}/gi)].map((m) => m[0]));
  expect(found).toEqual([]);
});
