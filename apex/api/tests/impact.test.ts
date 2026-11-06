// The Impact Explorer's projections, checked against an independent calculation and the answer
// key in docs/dataset.md.

import { beforeAll, describe, expect, test } from "vitest";
import * as impact from "../src/impact.ts";
import { connection, seeded } from "./helpers.ts";
import * as oracle from "./oracle.ts";

const ANSWER_KEY_DELAYS = [0, 1, 28, 60, 61, 119, 120, 135, 136, 149, 150, 168, 365];
type Projection = Awaited<ReturnType<typeof impact.project>>;

const projections: Record<number, Projection> = {};
beforeAll(async () => {
  await connection.read(async (tx) => {
    for (const d of ANSWER_KEY_DELAYS) projections[d] = await impact.project(tx, "CP-CMA", d);
  }, seeded());
});

function breaches(result: Projection): Record<string, number> {
  return Object.fromEntries(result.deadlines.filter((d) => d.breached).map((d) => [`${d.deadline}|${d.item}`, d.days_over]));
}

describe.each(ANSWER_KEY_DELAYS)("delay %i", (delay) => {
  test("every projected date matches the independent calculation", () => {
    const seed = oracle.rawSeed();
    const expected = oracle.projectedDates(seed, "CP-CMA", delay);
    const result = projections[delay]!;
    for (const [code, item] of Object.entries(result.items)) expect(item.projected, code).toBe(expected[code]);
    const planned: Record<string, string> = {};
    for (const i of [...seed.items, ...seed.workstreams]) planned[i.code] = i.due;
    const movedByOracle = new Set(Object.keys(expected).filter((c) => expected[c] !== planned[c]));
    expect(new Set([...movedByOracle, "CP-CMA"])).toEqual(new Set(Object.keys(result.items)));
    expect(breaches(result)).toEqual(oracle.breachedDeadlines(seed, expected));
  });
});

test("no delay moves nothing", () => {
  expect(new Set(Object.keys(projections[0]!.items))).toEqual(new Set(["CP-CMA"]));
  expect(breaches(projections[0]!)).toEqual({});
});

test("28 days", () => {
  const r = projections[28]!;
  expect(r.items["MS-COMPLETION"]!.projected).toBe("2026-12-30");
  expect(r.items["OB-SETTLE"]!.projected).toBe("2027-01-13");
  expect(Object.keys(r.items).length - 1).toBe(14); // 14 downstream items move
  expect(new Set(Object.entries(r.items).filter(([c]) => c !== "CP-CMA").map(([, i]) => i.workstream))).toEqual(
    new Set(["WS-LEG", "WS-FIN", "WS-INT", "WS-PPL", "WS-COM"])); // in 5 other workstreams
  expect(breaches(r)).toEqual({});
});

test("the Helix waiver lapses from 61 days", () => {
  expect(breaches(projections[60]!)).not.toHaveProperty("DL-HELIX-WAIVER|MS-COMPLETION");
  expect(breaches(projections[61]!)).toEqual({ "DL-HELIX-WAIVER|MS-COMPLETION": 1 });
});

test("the long-stop is breached from 120 days", () => {
  expect(breaches(projections[119]!)).not.toHaveProperty("DL-LONGSTOP|MS-COMPLETION");
  expect(breaches(projections[120]!)["DL-LONGSTOP|MS-COMPLETION"]).toBe(1);
});

test("certain funds are breached by settlement from 136 days", () => {
  expect(breaches(projections[135]!)).not.toHaveProperty("DL-FUNDS|OB-SETTLE");
  expect(breaches(projections[136]!)["DL-FUNDS|OB-SETTLE"]).toBe(1);
  expect(breaches(projections[149]!)).not.toHaveProperty("DL-FUNDS|MS-FUNDS");
  expect(breaches(projections[150]!)["DL-FUNDS|MS-FUNDS"]).toBe(1);
});

test("Phase 2 reference, 168 days", () => {
  const r = projections[168]!;
  expect(r.items["MS-COMPLETION"]!.projected).toBe("2027-05-19");
  expect(r.items["CV-RETENTION"]!.projected).toBe("2027-11-17");
  expect(breaches(r)).toEqual({ "DL-HELIX-WAIVER|MS-COMPLETION": 108, "DL-LONGSTOP|MS-COMPLETION": 49,
    "DL-FUNDS|MS-FUNDS": 19, "DL-FUNDS|OB-SETTLE": 33 });
});

test("a breached deadline carries its consequence and who is bound", () => {
  const helix = projections[61]!.deadlines.find((d) => d.deadline === "DL-HELIX-WAIVER")!;
  expect(helix.bound).toEqual(["ORG-ATL-IE"]);
  expect(helix.consequence).toContain("call option revives");
});

test("the cause chain is reported", () => {
  const items = projections[28]!.items;
  expect(items["CP-COURT"]!.caused_by).toEqual(["CP-CMA"]);
  expect(items["MS-COMPLETION"]!.caused_by).toEqual(["CP-COURT"]);
  expect(items["OB-SETTLE"]!.caused_by).toEqual(["MS-COMPLETION"]); // 14 days after completion beats drawdown + 0
});

test("soft links never move dates", async () => {
  const { result: r } = await connection.read((tx) => impact.project(tx, "HR-CONSULT", 60), seeded()); // only "informs" Day 1
  expect(new Set(Object.keys(r.items))).toEqual(new Set(["HR-CONSULT"]));
});

test("a completed item cannot be delayed", async () => {
  const { result: r } = await connection.read((tx) => impact.project(tx, "CP-EC", 30), seeded());
  expect(r.items["CP-EC"]!.shift_days).toBe(0);
  expect(new Set(Object.keys(r.items))).toEqual(new Set(["CP-EC"]));
});

test("an unknown item and a bad delay are refused", async () => {
  await connection.read(async (tx) => {
    await expect(impact.project(tx, "CP-NOPE", 10)).rejects.toThrow(impact.NotFound);
    await expect(impact.project(tx, "CP-CMA", 400)).rejects.toThrow(/delay must be/);
  }, seeded());
});

const day = (iso: string) => oracle.days(iso);

test("propagate takes the latest of several prerequisites", () => {
  const planned = { A: day("2027-01-01"), B: day("2027-01-01"), C: day("2027-01-10") };
  const edges = [{ from: "A", to: "C", lag: 5 }, { from: "B", to: "C", lag: 9 }];
  expect(impact.propagate("A", 10, edges, planned)["C"]).toEqual([day("2027-01-16"), ["A"]]);
  expect(impact.propagate("A", 2, edges, planned)["C"]).toEqual([day("2027-01-10"), []]); // slack absorbs it
});

test("propagate refuses a dependency cycle", () => {
  const planned = { A: day("2027-01-01"), B: day("2027-01-02") };
  const edges = [{ from: "A", to: "B", lag: 1 }, { from: "B", to: "A", lag: 1 }];
  expect(() => impact.propagate("A", 1, edges, planned)).toThrow(/cycle/);
});
