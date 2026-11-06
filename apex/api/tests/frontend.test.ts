// The frontend holds no business data: no seed names, codes, dates, amounts or text in its source
// or in the built bundle. Everything on screen has to come from TypeDB through the API.
//
// (The product itself is called "Project Apex", the same as the fictional deal, so that one name is
// allowed in the page title. The app's header takes the deal name from the API.)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { rawSeed, ROOT, type Rec } from "./oracle.ts";

const WEB = join(ROOT, "web");
const SOURCE_SUFFIXES = new Set([".ts", ".tsx", ".css", ".html", ".json", ".svg"]);

function seedValues(): Set<string> {
  const seed = rawSeed();
  const values = new Set<string>();
  for (const section of ["organisations", "people", "mandates", "financing", "workstreams", "items"]) {
    for (const record of seed[section] as Rec[]) {
      values.add(record.code);
      for (const field of ["name", "description", "consequence", "job_title"]) {
        if (typeof record[field] === "string" && record[field].length > 6) values.add(record[field]);
      }
      for (const field of ["due", "planned_start"]) if (record[field]) values.add(record[field]);
      if (record.value) values.add(record.value);
    }
  }
  for (const event of seed.events) values.add(event.summary);
  const deal = seed.deal;
  for (const v of [deal.code, deal.description, deal.value, deal.as_of, deal.structure]) values.add(v);
  // Generic words that legitimately appear in UI chrome are not business data.
  for (const v of ["company", "Regulatory", "Financing", "milestone"]) values.delete(v);
  return values;
}

function files(root: string, suffixes?: Set<string>): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...files(path, suffixes));
    else if (!suffixes || suffixes.has(path.slice(path.lastIndexOf(".")))) out.push(path);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Seed values appearing as whole words. (Library code contains fragments such as the hex
 * constant 0x800000000000 or the name RoutingDirector, which are not business data.)
 */
function offending(paths: string[], values: Set<string>): string[] {
  const patterns = [...values].map((v) => [v, new RegExp(`(?<![\\w])${escape(v)}(?![\\w])`)] as const);
  const found: string[] = [];
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    for (const [v, pat] of patterns) if (pat.test(text)) found.push(`${relative(WEB, path)}: ${JSON.stringify(v)}`);
  }
  return found;
}

test("the frontend source has no seed data", () => {
  const src = [...files(join(WEB, "src"), SOURCE_SUFFIXES), join(WEB, "index.html")];
  expect(src.length).toBeGreaterThan(10);
  expect(offending(src, seedValues())).toEqual([]);
});

test("the built bundle has no seed data", (ctx) => {
  const dist = join(WEB, "dist");
  if (!existsSync(dist)) return ctx.skip(); // frontend not built (cd web && npm run build)
  const bundle = files(dist).filter((p) => [".js", ".css", ".html"].includes(p.slice(p.lastIndexOf("."))));
  expect(bundle.length).toBeGreaterThan(0);
  expect(offending(bundle, seedValues())).toEqual([]);
});

test("the Impact Explorer has no scenario outcomes", () => {
  // The thresholds (61, 120, 136 days...), the presets and the scenario's outcomes all come from
  // /api/impact. None of them, and none of the delay figures, may be written into the screen's code.
  const paths = [...files(join(WEB, "src", "components", "impact")).filter((p) => p.endsWith(".tsx")), join(WEB, "src", "pages", "Impact.tsx")];
  expect(paths.length).toBeGreaterThanOrEqual(5);
  const numbers = /(?<![\w.#/-])(28|60|61|119|120|135|136|149|150|168)(?![\w%])/;
  const words = ["Helix", "long-stop", "Long-stop", "certain funds", "CMA", "CP-CMA", "Phase 2"];
  const found: string[] = [];
  for (const path of paths) {
    readFileSync(path, "utf8").split("\n").forEach((line, n) => {
      const code = line.split("//")[0]!;
      if (numbers.test(code) || words.some((w) => code.includes(w))) found.push(`${path.split("/").pop()}:${n + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  expect(found).toEqual([]);
});

test("the schedule never uses the real date", () => {
  // Every "due in", "overdue" and the date line come from the scenario date stored in TypeDB
  // (docs/phase6-plan.md §4); the Gantt chart and the item panel never read the browser's clock.
  const paths = [...files(join(WEB, "src", "components", "gantt")), ...files(join(WEB, "src", "components", "parties")),
    ...files(join(WEB, "src", "components", "workstreams")),
    ...["Parties.tsx", "Party.tsx", "Workstreams.tsx", "Workstream.tsx"].map((f) => join(WEB, "src", "pages", f))]
    .filter((p) => /\.tsx?$/.test(p));
  expect(paths.length).toBeGreaterThanOrEqual(9);
  const clock = /Date\.now\(|new Date\(\s*\)|performance\.now\(/;
  expect(paths.filter((p) => clock.test(readFileSync(p, "utf8"))).map((p) => p.split("/").pop())).toEqual([]);
  expect(readFileSync(join(WEB, "src", "components", "gantt", "gantt.tsx"), "utf8")).toContain("as_of");
});

test("no contact value in the frontend source or bundle", () => {
  // Contacts are masked on the server (decision D8): no full address or number may be in the frontend.
  const people = rawSeed().people as Rec[];
  const secrets = new Set([...people.map((p) => p.email), ...people.map((p) => p.phone)]);
  const paths = [...files(join(WEB, "src"), SOURCE_SUFFIXES)];
  if (existsSync(join(WEB, "dist"))) paths.push(...files(join(WEB, "dist")).filter((p) => [".js", ".css", ".html"].includes(p.slice(p.lastIndexOf(".")))));
  const found = paths.flatMap((p) => [...secrets].filter((s) => readFileSync(p, "utf8").includes(s)).map((s) => `${relative(WEB, p)}: ${s}`));
  expect(found).toEqual([]);
});
