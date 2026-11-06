// The Impact Explorer API, against a real seeded TypeDB database.
//
// Every expected date, breach and threshold is recomputed from data/seed/*.yaml by tests/oracle.ts
// (a different algorithm from src/impact.ts), and the dependency graph from the YAML and the schema
// text, so the app can't pass by agreeing with itself.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import * as queries from "../src/queries.ts";
import { client, connection, seeded } from "./helpers.ts";
import { breachedDeadlines, holders, projectedDates, rawSeed, ROOT, schemaText, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const ITEMS: Record<string, Rec> = Object.fromEntries([...SEED.items, ...SEED.workstreams].map((i: Rec) => [i.code, i]));
const PLANNED: Record<string, string> = Object.fromEntries(Object.entries(ITEMS).map(([c, i]) => [c, i.due]));
const SCHEMA = schemaText(); // base schema plus migrations, as TypeDB loads it
const PRESETS = [0, 28, 61, 120, 136, 168];
// Either side of every contractual deadline (from docs/dataset.md's answer key).
const BOUNDARIES = [60, 61, 119, 120, 135, 136, 149, 150];

let c: ReturnType<typeof client>;
beforeAll(() => {
  c = client();
});

async function run(days: number, item?: string) {
  const r = await c.get("/api/impact", { delay_days: days, ...(item ? { item } : {}) });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

function hardKindsFromSchema(): Set<string> {
  const kinds = new Set(["hard-dependency"]);
  for (const m of SCHEMA.matchAll(/relation ([\w-]+)(?: @abstract,)? sub ([\w-]+)/g)) if (kinds.has(m[2]!)) kinds.add(m[1]!);
  return kinds;
}

const HARD = hardKindsFromSchema();

/** Items reachable from start through hard dependencies, by depth-first search over the YAML. */
function reachable(start: string): Set<string> {
  const out = new Set([start]);
  const todo = [start];
  while (todo.length) {
    const x = todo.pop()!;
    for (const d of SEED.dependencies) {
      if (d.from === x && HARD.has(d.kind) && !out.has(d.to)) {
        out.add(d.to);
        todo.push(d.to);
      }
    }
  }
  return out;
}

function raciOf(code: string): Set<string> {
  return new Set(Object.entries(SEED.raci[code] as Rec).flatMap(([l, hs]) => holders(hs as string | string[]).map((h) => `${l}|${h}`)));
}

const dayDiff = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;

describe("projections", () => {
  test.each([...new Set([...PRESETS, ...BOUNDARIES])].sort((a, b) => a - b))("projected dates and breaches match the oracle at %i days", async (days) => {
    const data = (await run(days)).data;
    const expected = projectedDates(SEED, "CP-CMA", days);
    for (const it of data.items) {
      expect(it.projected, it.code).toBe(expected[it.code]);
      expect(it.shift_days).toBe(dayDiff(expected[it.code]!, PLANNED[it.code]!));
    }
    const got: Record<string, number> = {};
    for (const d of data.deadlines) for (const x of d.limits) if (x.breached) got[`${d.code}|${x.code}`] = x.days_over;
    expect(got).toEqual(breachedDeadlines(SEED, expected));
    expect(data.level).toBe(Object.keys(got).length ? "breach" : days ? "delayed" : "on-plan");
    expect(new Set(Object.keys(expected).filter((x) => expected[x] !== PLANNED[x]))).toEqual(new Set(data.items.filter((i: Rec) => i.shift_days > 0).map((i: Rec) => i.code)));
  });

  test("the four business scenarios", async () => {
    const breached = async (days: number) => new Set<string>((await run(days)).data.summary.breached);
    expect(await breached(0)).toEqual(new Set());
    expect(await breached(28)).toEqual(new Set());
    expect(await breached(60)).toEqual(new Set());
    expect(await breached(61)).toEqual(new Set(["DL-HELIX-WAIVER"])); // Helix waiver lapses
    expect(await breached(119)).toEqual(new Set(["DL-HELIX-WAIVER"]));
    expect(await breached(120)).toEqual(new Set(["DL-HELIX-WAIVER", "DL-LONGSTOP"])); // long-stop exceeded
    expect(await breached(135)).toEqual(new Set(["DL-HELIX-WAIVER", "DL-LONGSTOP"]));
    expect(await breached(136)).toEqual(new Set(["DL-HELIX-WAIVER", "DL-LONGSTOP", "DL-FUNDS"])); // funds before payment
    const full = Object.fromEntries((await run(168)).data.deadlines.map((d: Rec) => [d.code, Object.fromEntries(d.limits.map((x: Rec) => [x.code, x.days_over]))]));
    expect(full).toEqual({ "DL-HELIX-WAIVER": { "MS-COMPLETION": 108 }, "DL-LONGSTOP": { "MS-COMPLETION": 49 },
      "DL-FUNDS": { "MS-FUNDS": 19, "OB-SETTLE": 33 } });
  });

  test("28 days moves 14 downstream items in 5 workstreams", async () => {
    const data = (await run(28)).data;
    const moved = data.items.filter((i: Rec) => i.shift_days > 0 && i.role === "downstream");
    expect(moved).toHaveLength(14);
    expect(new Set(moved.map((i: Rec) => i.workstream.code)).size).toBe(5);
    expect(data.summary.moved).toBe(15); // including the delayed clearance itself
  });

  test("presets are found from the data", async () => {
    // The thresholds are the smallest delays at which the oracle sees each deadline breached.
    const data = (await run(0)).data;
    const first: Record<string, number> = {};
    for (let days = 0; days < 366; days++) {
      for (const key of Object.keys(breachedDeadlines(SEED, projectedDates(SEED, "CP-CMA", days)))) {
        const dl = key.split("|")[0]!;
        if (!(dl in first)) first[dl] = days;
      }
    }
    const thresholds = Object.fromEntries(data.scenarios.filter((s: Rec) => s.kind === "threshold").map((s: Rec) => [s.deadline, s.days]));
    expect(thresholds).toEqual(first);
    expect(first).toEqual({ "DL-HELIX-WAIVER": 61, "DL-LONGSTOP": 120, "DL-FUNDS": 136 });
    expect(data.scenarios.map((s: Rec) => s.days)).toEqual(PRESETS);
    for (const d of data.deadlines) expect(d.breach_from_days).toBe(first[d.code]);
  });

  test("completed items never move and other subjects work", async () => {
    const data = (await run(90, "CP-COURT")).data;
    expect(data.start.code).toBe("CP-COURT");
    const expected = projectedDates(SEED, "CP-COURT", 90);
    expect(data.items.every((i: Rec) => i.projected === expected[i.code])).toBe(true);
    expect(new Set(data.subjects.map((s: Rec) => s.code))).toEqual(new Set(Object.entries(ITEMS)
      .filter(([, i]) => ["regulatory-clearance", "shareholder-approval", "court-sanction"].includes(i.type) && i.status !== "complete").map(([x]) => x)));
    expect((await c.get("/api/impact", { item: "XX-NONE" })).status).toBe(404);
    expect((await c.get("/api/impact", { delay_days: 366 })).status).toBe(422);
    expect((await c.get("/api/impact", { delay_days: -1 })).status).toBe(422);
  });
});

describe("the dependency graph", () => {
  test("graph edges match the YAML and the schema", async () => {
    const data = (await run(61)).data;
    expect(new Set(data.hard_kinds)).toEqual(HARD);
    const reach = reachable("CP-CMA");
    expect(new Set(data.items.map((i: Rec) => i.code))).toEqual(reach);
    const key = (e: Rec) => `${e.from}|${e.to}|${e.kind}|${e.lag}`;
    const hard = new Set(data.edges.filter((e: Rec) => e.hard).map(key));
    expect(hard).toEqual(new Set(SEED.dependencies.filter((d: Rec) => HARD.has(d.kind) && reach.has(d.from)).map(key)));
    const soft = new Set(data.edges.filter((e: Rec) => !e.hard && e.kind !== "deadline-limit").map((e: Rec) => `${e.from}|${e.to}`));
    expect(soft).toEqual(new Set(SEED.dependencies.filter((d: Rec) => !HARD.has(d.kind) && (reach.has(d.from) || reach.has(d.to))).map((d: Rec) => `${d.from}|${d.to}`)));
    const limits = new Set(data.edges.filter((e: Rec) => e.kind === "deadline-limit").map((e: Rec) => `${e.from}|${e.to}`));
    expect(limits).toEqual(new Set(SEED.deadline_limits.filter((dl: Rec) => reach.has(dl.item)).map((dl: Rec) => `${dl.item}|${dl.deadline}`)));
    expect(new Set(data.edges.filter((e: Rec) => e.kind === "deadline-limit" && e.moved).map((e: Rec) => e.to))).toEqual(new Set(["DL-HELIX-WAIVER"]));
  });

  test("paths and causes follow real dependencies", async () => {
    const data = (await run(168)).data;
    const hard: Record<string, Rec> = Object.fromEntries(SEED.dependencies.filter((d: Rec) => HARD.has(d.kind)).map((d: Rec) => [`${d.from}|${d.to}`, d]));
    for (const it of data.items) {
      expect(it.path[0]).toBe("CP-CMA");
      expect(it.path.at(-1)).toBe(it.code);
      for (let i = 1; i < it.path.length; i++) expect(hard).toHaveProperty(`${it.path[i - 1]}|${it.path[i]}`);
      for (const cause of it.caused_by) {
        expect(hard).toHaveProperty(`${cause.code}|${it.code}`);
        expect(hard[`${cause.code}|${it.code}`]!.lag).toBe(cause.lag);
      }
    }
    const settle = data.items.find((i: Rec) => i.code === "OB-SETTLE");
    expect(settle.path).toEqual(["CP-CMA", "CP-COURT", "MS-COMPLETION", "OB-SETTLE"]);
  });
});

describe("who needs to act", () => {
  test("RACI for every affected item and deadline", async () => {
    const data = (await run(168)).data;
    for (const n of [...data.items, ...data.deadlines]) {
      expect(new Set(n.raci.map((r: Rec) => `${r.letter}|${r.code}`)), n.code).toEqual(raciOf(n.code));
    }
    const people: Record<string, Rec> = Object.fromEntries(data.summary.people.map((p: Rec) => [p.code, p]));
    const okafor = people["PER-OKAFOR"]!;
    expect(okafor.items.some((i: Rec) => i.letter === "A" && i.code === "CP-CMA")).toBe(true);
    const shaw = people["PER-SHAW"]!;
    expect(new Set(shaw.items.filter((i: Rec) => i.via).map((i: Rec) => i.via.code))).toEqual(new Set(["MAN-BWM"]));
    expect(shaw.employer.code).toBe("ORG-BWM");
  });

  test("deadlines carry obligations and consent rights", async () => {
    const data = (await run(61)).data;
    const dls: Record<string, Rec> = Object.fromEntries(data.deadlines.map((d: Rec) => [d.code, d]));
    const helix = dls["DL-HELIX-WAIVER"]!;
    const src = SEED.items.find((i: Rec) => i.code === "DL-HELIX-WAIVER");
    expect(helix.consequence).toBe(src.consequence);
    expect(helix.breached).toBe(true);
    expect(helix.consent_from.map((x: Rec) => x.code)).toEqual(["ORG-HELIX"]);
    expect(helix.bound.map((b: Rec) => b.code)).toEqual(["ORG-ATL-IE"]);
    expect(helix.group_obligation).toEqual({ owed_by: "ORG-ATL-IE", consent_from: "ORG-HELIX", effective_stake: "1" });
    expect(new Set(dls["DL-LONGSTOP"]!.bound.map((b: Rec) => b.code))).toEqual(new Set(SEED.bound_by.filter((o: Rec) => o.obligation === "DL-LONGSTOP").map((o: Rec) => o.obligor)));
  });
});

describe("TypeQL and read-only", () => {
  test("typeql shows the recursive queries", async () => {
    const body = await run(61);
    const typeql: string[] = body.typeql;
    expect(typeql.some((q) => q.includes("impact_edges($start)") && q.includes('"CP-CMA"'))).toBe(true);
    expect(typeql.some((q) => q.includes("downstream($start)"))).toBe(true);
    expect(body.parameters).toEqual({ delay_days: 61 });
    const names: Record<string, string> = Object.fromEntries(body.data.functions.map((f: Rec) => [f.name, f.definition]));
    // Each definition is the function's own comment and body, exactly as in schema/functions.tql.
    const tql = readFileSync(join(ROOT, "schema", "functions.tql"), "utf8");
    for (const [name, text] of Object.entries(names)) {
      expect(tql).toContain(text);
      expect(text).toContain(`fun ${name}(`);
      expect(text.trimEnd().endsWith(";")).toBe(true);
      expect(text.split("\nfun ").length - 1 + (text.startsWith("fun ") ? 1 : 0)).toBe(1); // one function, not two
    }
    expect(names["impact_edges"]).toContain("impact_edges($start)");
    await connection.read(async (tx) => {
      for (const q of typeql) await tx.run(q);
    }, seeded());
  });

  async function snapshot(db: string) {
    const { result } = await connection.read(async (tx) => {
      const counts = await queries.countsByType(tx, ["acquisition", "milestone", "regulatory-clearance", "deadline", "covenant",
        "gating", "sequencing", "informing", "deadline-limit", "responsibility", "accountability", "consultation", "notification", "deal-event"]);
      const dates = (await tx.docs('match $x isa deal-item, has code $c, has due-date $d; fetch { "code": $c, "due": $d, "status": $x.status };'))
        .map((d) => `${d.code}|${d.due}|${d.status}`).sort();
      return { counts, dates };
    }, db);
    return result;
  }

  test("the simulation never changes the database", async () => {
    const before = await snapshot(seeded());
    for (let days = 0; days < 169; days += 7) await run(days);
    await run(300, "CP-COURT");
    expect(await snapshot(seeded())).toEqual(before);
    const source = readFileSync(join(ROOT, "api", "src", "impact.ts"), "utf8");
    expect(source).not.toContain('"write"');
    expect(source).not.toContain("commitTransaction");
  });
});
