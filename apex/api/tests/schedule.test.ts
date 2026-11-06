// The Gantt chart's API (/api/schedule) and the shared item detail (/api/items/{code}), checked
// against answers recomputed from the raw YAML (tests/oracle.ts shares no code with src/).

import { beforeAll, describe, expect, test } from "vitest";
import { client } from "./helpers.ts";
import { bruteForceFloatTo, derivedProgress, holders, rawSeed, type Rec } from "./oracle.ts";

const SEED = rawSeed();
const ITEMS: Record<string, Rec> = Object.fromEntries(SEED.items.map((i: Rec) => [i.code, i]));
const CONDITIONS = new Set(Object.entries(ITEMS).filter(([, i]) => ["regulatory-clearance", "shareholder-approval", "court-sanction"].includes(i.type)).map(([c]) => c));
const HARD = new Set(["sequencing", "gating"]); // the schema's hard-dependency subtypes; informing is soft

let c: ReturnType<typeof client>;
let chart: Rec;
beforeAll(async () => {
  c = client();
  chart = (await c.ok("/api/schedule")).data;
});

test("the scenario date is the stored one", () => {
  expect(chart.as_of).toBe(SEED.deal.as_of);
  expect(chart.as_of).toBe("2026-10-26");
});

test("every bar and diamond has TypeDB dates", () => {
  const seen: Record<string, Rec> = {};
  for (const ws of chart.workstreams) {
    for (const it of ws.items) {
      expect(it.workstream).toBe(ws.code);
      seen[it.code] = it;
    }
  }
  expect(new Set(Object.keys(seen))).toEqual(new Set(Object.keys(ITEMS))); // every item exactly once
  for (const [code, src] of Object.entries(ITEMS)) {
    const it = seen[code]!;
    const expectedShape = src.type === "deadline" ? "deadline" : src.planned_start ? "bar" : "milestone";
    expect([it.shape, it.type, it.status, it.due, it.planned_start, it.actual_start], code).toEqual(
      [expectedShape, src.type, src.status, src.due, src.planned_start ?? null, src.actual_start ?? null]);
    expect(it.workstream).toBe(src.workstream);
  }
  const shapes = Object.values(seen).map((it) => it.shape);
  expect([shapes.filter((s) => s === "bar").length, shapes.filter((s) => s === "milestone").length, shapes.filter((s) => s === "deadline").length]).toEqual([47, 28, 3]);
});

test("workstreams carry their window and both progress measures", () => {
  const key = (w: Rec) => `${w.planned_start}|${w.due}|${w.code}`;
  expect(chart.workstreams.map((w: Rec) => w.code)).toEqual([...SEED.workstreams].sort((a: Rec, b: Rec) => (key(a) < key(b) ? -1 : 1)).map((w: Rec) => w.code));
  for (const w of chart.workstreams) {
    const src = SEED.workstreams.find((s: Rec) => s.code === w.code);
    const expected = derivedProgress(Object.values(ITEMS).filter((i) => i.workstream === w.code));
    expect([w.planned_start, w.due]).toEqual([src.planned_start, src.due]);
    expect(w.progress).toBe(expected.percent);
    expect([w.milestones_achieved, w.milestones_total]).toEqual([expected.achieved, expected.points]);
    const starts = w.items.map((it: Rec) => it.planned_start || it.due);
    expect(starts).toEqual([...starts].sort()); // rows in date order
  }
});

test("deadlines and what they limit", () => {
  const expected: Record<string, Set<string>> = {};
  for (const limit of SEED.deadline_limits) (expected[limit.deadline] ??= new Set()).add(limit.item);
  expect(Object.fromEntries(chart.deadlines.map((d: Rec) => [d.code, new Set(d.limits)]))).toEqual(expected);
  for (const d of chart.deadlines) {
    expect(d.due).toBe(ITEMS[d.code]!.due);
    expect(d.consequence).toBeTruthy();
  }
});

test("every dependency with its kind", () => {
  const found = Object.fromEntries(chart.dependencies.map((d: Rec) => [`${d.from}|${d.to}`, [d.kind, d.lag, d.hard]]));
  expect(found).toEqual(Object.fromEntries(SEED.dependencies.map((d: Rec) => [`${d.from}|${d.to}`, [d.kind, d.lag ?? null, HARD.has(d.kind)]])));
  expect(chart.dependencies.filter((d: Rec) => d.hard)).toHaveLength(67);
});

describe("/api/items/{code}", () => {
  async function detail(code: string) {
    const r = await c.get(`/api/items/${code}`);
    expect(r.status, r.text).toBe(200);
    return r.body.data;
  }

  test.each(["CP-CMA", "DL-HELIX-WAIVER", "AC-REG-CMA-RESP", "CV-COC-CALDER", "MS-COMPLETION", "AC-COM-DAY1"])("item detail matches the seed: %s", async (code) => {
    const d = await detail(code);
    const src = ITEMS[code]!;
    expect([d.name, d.type, d.status, d.due, d.planned_start]).toEqual([src.name, src.type, src.status, src.due, src.planned_start ?? null]);
    expect(d.description).toBe(src.description ?? null);
    expect(d.workstream.code).toBe(src.workstream);

    const raci = SEED.raci[code] as Rec;
    const expected = Object.fromEntries(Object.entries(raci).map(([letter, hs]) => [letter, [...holders(hs as string | string[])].sort()]));
    expect(Object.fromEntries(Object.entries(d.raci).map(([letter, hs]) => [letter, (hs as Rec[]).map((h) => h.code).sort()]))).toEqual(expected);
    expect(d.raci.A).toHaveLength(1);

    expect(new Set(d.depends_on.map((x: Rec) => `${x.code}|${x.kind}|${x.lag}`))).toEqual(
      new Set(SEED.dependencies.filter((e: Rec) => e.to === code).map((e: Rec) => `${e.from}|${e.kind}|${e.lag ?? null}`)));
    expect(new Set(d.needed_by.map((x: Rec) => `${x.code}|${x.kind}`))).toEqual(
      new Set(SEED.dependencies.filter((e: Rec) => e.from === code).map((e: Rec) => `${e.to}|${e.kind}`)));
    expect(new Set(d.limited_by.map((x: Rec) => x.code))).toEqual(new Set(SEED.deadline_limits.filter((l: Rec) => l.item === code).map((l: Rec) => l.deadline)));
    expect(new Set(d.limits.map((x: Rec) => x.code))).toEqual(new Set(SEED.deadline_limits.filter((l: Rec) => l.deadline === code).map((l: Rec) => l.item)));
    expect(new Set(d.bound.map((x: Rec) => x.code))).toEqual(new Set(SEED.bound_by.filter((b: Rec) => b.obligation === code).map((b: Rec) => b.obligor)));
    expect(new Set(d.consent_from.map((x: Rec) => x.code))).toEqual(new Set(SEED.consents.filter((x: Rec) => x.obligation === code).map((x: Rec) => x.grantor)));

    const events = SEED.events.filter((e: Rec) => e.subject === code).sort((a: Rec, b: Rec) => {
      const ka = `${a.at}|${a.code}`;
      const kb = `${b.at}|${b.code}`;
      return ka < kb ? 1 : ka > kb ? -1 : 0;
    });
    expect(d.events.map((e: Rec) => e.code)).toEqual(events.map((e: Rec) => e.code)); // newest first
    expect(new Set(d.risks.map((r: Rec) => r.code))).toEqual(new Set(SEED.risks.filter((r: Rec) => r.exposed.includes(code)).map((r: Rec) => r.code)));
    expect(d.simulate).toBe(CONDITIONS.has(code) && src.status !== "complete");
  });

  test("simulate is offered only for open conditions", async () => {
    expect((await detail("CP-CMA")).simulate).toBe(true);
    expect((await detail("CP-EC")).simulate).toBe(false); // complete
    expect((await detail("AC-REG-CMA-RESP")).simulate).toBe(false); // an activity, not a condition
  });

  test("advisers act via their mandate in item detail", async () => {
    const d = await detail("DL-HELIX-WAIVER");
    const ainsworth = d.raci.R.find((h: Rec) => h.code === "PER-AINSWORTH");
    expect(ainsworth.via).toBe("MAN-BWM");
    expect(ainsworth.employer).toBe("Blackwood Marsh LLP");
  });

  test("an unknown item is 404 and bad codes are refused", async () => {
    expect((await c.get("/api/items/MS-NOPE")).status).toBe(404);
    expect((await c.get("/api/items/not%20a%20code")).status).toBe(422);
  });

  test("schedule and item detail only read", async () => {
    for (const url of ["/api/schedule", "/api/items/CP-CMA"]) {
      const typeql: string[] = (await c.ok(url)).typeql;
      expect(typeql.length).toBeGreaterThan(0);
      expect(typeql.some((q) => ["insert", "delete", "define", "update"].some((w) => q.includes(w)))).toBe(false);
    }
  });

  test("item detail lists the meetings that discussed it", async () => {
    const d = await detail("AC-INT-INTERIM");
    const expected = new Set(SEED.events.filter((e: Rec) => (e.agenda ?? []).includes("AC-INT-INTERIM")).map((e: Rec) => e.code));
    expect(new Set(d.discussed_at.map((m: Rec) => m.code))).toEqual(expected);
    expect(expected).toEqual(new Set(["EV-INT-14"]));
    expect(d.discussed_at[0].subject.code).toBe("WS-INT");
  });

  test("critical paths are the Impact Explorer's thresholds", async () => {
    // One calculation: each deadline's exposure is its Impact breaking point minus one, and its critical
    // path is the open items sharing that smallest float (recomputed by brute force).
    const paths: Record<string, Rec> = Object.fromEntries(chart.deadlines.map((d: Rec) => [d.code, d.critical_path]));
    expect(Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, v.float]))).toEqual({ "DL-HELIX-WAIVER": 60, "DL-LONGSTOP": 119, "DL-FUNDS": 135 });
    for (const [deadline, cp] of Object.entries(paths)) {
      const floats: Record<string, number> = {};
      for (const [code, i] of Object.entries(ITEMS)) {
        if (i.status === "complete") continue;
        const f = bruteForceFloatTo(SEED, code, deadline);
        if (f !== null) floats[code] = f;
      }
      expect(cp.float).toBe(Math.min(...Object.values(floats)));
      expect(new Set(cp.items)).toEqual(new Set(Object.entries(floats).filter(([, f]) => f === cp.float).map(([x]) => x)));
    }
    const onPath = new Set(chart.workstreams.flatMap((w: Rec) => w.items).filter((i: Rec) => i.critical_for.length).map((i: Rec) => i.code));
    expect(onPath).toEqual(new Set(["CP-CMA", "CP-COURT", "MS-COMPLETION", "OB-SETTLE"]));
  });

  test("the item panel's float is the same calculation", async () => {
    const floats: Record<string, number | null> = Object.fromEntries(chart.workstreams.flatMap((w: Rec) => w.items).map((i: Rec) => [i.code, i.float]));
    for (const code of ["CP-CMA", "AC-REG-CMA-RESP", "AC-INT-SYSTEMS", "MS-FUNDS"]) expect((await detail(code)).float).toBe(floats[code]);
  });
});
