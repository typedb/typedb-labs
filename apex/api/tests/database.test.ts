// Creating and loading the database, and checking the loaded data in TypeDB itself.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import * as database from "../src/database.ts";
import * as queries from "../src/queries.ts";
import * as seedModule from "../src/seed.ts";
import { expectedCounts, readSeed, YDate } from "../src/seed.ts";
import { value } from "../src/typedb.ts";
import { connection, drop, newName, seeded } from "./helpers.ts";

const seed = readSeed();

test("every expected instance arrived", async () => {
  const expected = expectedCounts(seed);
  const { result } = await connection.read((tx) => queries.countsByType(tx, Object.keys(expected).sort()), seeded());
  expect(result).toEqual(expected);
  expect(Object.values(expected).reduce((a, b) => a + b, 0)).toBe(1058); // 6A.2: 471 -> 1051; 6E: + 7 steering meetings
});

test("each item has exactly one Accountable in TypeDB", async () => {
  const q = `match $x isa deal-item, has code $c; accountability (holder: $h, accountable-item: $x);
           reduce $n = count groupby $c;`;
  const { result } = await connection.read(async (tx) => {
    const counts = Object.fromEntries((await tx.rows(q)).map((r) => [value<string>(r, "c"), value<number>(r, "n")]));
    let total = await queries.countExact(tx, "workstream");
    for (const t of ["activity", "milestone", "regulatory-clearance", "shareholder-approval", "court-sanction", "covenant", "deadline"]) total += await queries.countExact(tx, t);
    return { counts, total };
  }, seeded());
  expect(Object.keys(result.counts)).toHaveLength(result.total);
  expect(result.total).toBe(85); // re-baselined in Phase 6A.2 (was 41)
  expect(new Set(Object.values(result.counts))).toEqual(new Set([1]));
});

test("hard dependencies have no cycles", async () => {
  const q = "match $x isa deal-item, has code $c; let $y in downstream($x); $y is $x; select $c;";
  const { result } = await connection.read((tx) => tx.rows(q), seeded());
  expect(result).toEqual([]);
});

test("base plan dates respect every hard dependency", async () => {
  const q = `match $d isa hard-dependency (prerequisite: $a, dependent: $b), has lag-days $lag;
                 $a has code $ac, has due-date $ad; $b has code $bc, has due-date $bd;
           fetch { "from": $ac, "to": $bc, "from due": $ad, "to due": $bd, "lag": $lag };`;
  const { result: edges } = await connection.read((tx) => tx.docs(q), seeded());
  expect(edges).toHaveLength(67); // re-baselined in Phase 6A.2 (was 25)
  const late = edges.filter((e) => Date.parse(e["to due"]) < Date.parse(e["from due"]) + e.lag * 86_400_000);
  expect(late).toEqual([]);
});

test("the base plan meets every deadline", async () => {
  const { result } = await connection.read(async (tx) => ({ items: await queries.allItems(tx), limits: await queries.allDeadlineLimits(tx) }), seeded());
  expect(result.limits).toHaveLength(4);
  for (const limit of result.limits) expect(result.items[limit.item]!.due! <= limit.due, limit.item).toBe(true);
});

test("data-quality checks are clean on the seed", async () => {
  const { result } = await connection.read((tx) => queries.dataQualityChecks(tx), seeded());
  expect(result).toEqual({ no_accountable: [], overdue: [], clearance_without_authority: [] });
});

test("responsibility is recorded via the adviser's mandate", async () => {
  const q = `match $p isa person, has code "PER-AINSWORTH"; $r isa responsibility (holder: $p, via: $m);
           $m has code $mc; select $mc; distinct;`;
  const { result } = await connection.read((tx) => tx.rows(q), seeded());
  expect(result.map((r) => value<string>(r, "mc"))).toEqual(["MAN-BWM"]);
});

test("saved functions answer on the seed", async () => {
  const { result } = await connection.read(async (tx) => ({
    blockers: await tx.docs(`match $x isa milestone, has code "MS-COMPLETION"; let $y in upstream($x);
                                $y has code $c; fetch { "c": $c };`),
    owner: await tx.docs(`match $x isa regulatory-clearance, has code "CP-CMA"; let $p = accountable_for($x);
                             $p has name $n; fetch { "n": $n };`),
  }), seeded());
  const blockers = new Set(result.blockers.map((b) => b.c));
  for (const c of ["CP-CMA", "CP-EC", "CP-HSR", "CP-NSIA", "CP-SHAREHOLDERS", "CP-COURT", "MS-ANNOUNCE"]) expect(blockers.has(c), c).toBe(true);
  expect(result.owner).toEqual([{ n: "Daniel Okafor" }]);
});

test("the generated seed.tql loads on its own, as in Studio", async () => {
  const name = newName();
  try {
    await database.createSchema(connection, name);
    await connection.transaction("write", (tx) => tx.run(readFileSync(seedModule.SEED_TQL, "utf8")), name);
    const expected = expectedCounts(seed);
    const { result } = await connection.read((tx) => queries.countsByType(tx, Object.keys(expected).sort()), name);
    expect(result).toEqual(expected);
  } finally {
    await drop(name);
  }
});

test("create refuses an existing database", async () => {
  await expect(database.create(connection, seeded())).rejects.toThrow(database.DatabaseExists);
});

test.each(["newslens", "charcoal", "cti", "apex-production"])("create and drop refuse other projects' databases: %s", async (name) => {
  await expect(database.create(connection, name, true)).rejects.toThrow(/refusing/);
  await expect(database.drop(connection, name)).rejects.toThrow(/refusing/);
});

test("a seed failing a TypeDB check saves nothing", async () => {
  // An overdue item passes the YAML validator but fails the data-quality check inside TypeDB.
  const broken = readSeed();
  broken.items.find((i: seedModule.Seed) => i.code === "CP-CMA").due = new YDate("2026-10-01");
  const name = newName();
  try {
    await expect(database.create(connection, name, false, broken)).rejects.toThrow(/overdue failed for CP-CMA/);
    expect(await connection.databaseExists(name)).toBe(false);
  } finally {
    await drop(name);
  }
});

// ---- Phase 6A.2: the activity history and risk register, checked in TypeDB ----

test("migrations are part of a new database", async () => {
  await connection.read(async (tx) => {
    for (const t of ["activity", "request", "reply", "risk", "risk-exposure", "registrar"]) expect((await tx.rows(`match $t label ${t};`)).length, t).toBeGreaterThan(0);
  }, seeded());
});

test("event types arrive exactly", async () => {
  const types = ["request", "response", "meeting", "delivery", "decision", "notice", "status-change"];
  const { result } = await connection.read(async (tx) => ({
    found: await queries.countsByType(tx, types),
    total: (await tx.rows("match $e isa deal-event;")).length,
  }), seeded());
  expect(result.found).toEqual(Object.fromEntries(types.map((t) => [t, seed.events.filter((e: seedModule.Seed) => e.type === t).length])));
  expect(result.total).toBe(seed.events.length);
  expect(result.total).toBe(118); // 6E: + 7 steering meetings
});

test("every reply links a response to its request", async () => {
  const q = `match $q isa request, has code $qc; $a isa response, has code $ac;
           reply (original: $q, answer: $a); select $qc, $ac;`;
  const { result } = await connection.read((tx) => tx.rows(q), seeded());
  const found = new Set(result.map((r) => `${value<string>(r, "qc")}|${value<string>(r, "ac")}`));
  expect(found).toEqual(new Set(seed.events.flatMap((e: seedModule.Seed) => (e.reply_to ?? []).map((o: string) => `${o}|${e.code}`))));
});

test("unanswered requests are found by negation", async () => {
  const q = "match $q isa request, has code $c; not { reply (original: $q); }; select $c;";
  const { result } = await connection.read((tx) => tx.rows(q), seeded());
  const found = new Set(result.map((r) => value<string>(r, "c")));
  const answered = new Set(seed.events.flatMap((e: seedModule.Seed) => e.reply_to ?? []));
  expect(found).toEqual(new Set(seed.events.filter((e: seedModule.Seed) => e.type === "request" && !answered.has(e.code)).map((e: seedModule.Seed) => e.code)));
  expect(found.has("EV-INT-05") && found.has("EV-PPL-04")).toBe(true); // the two deliberate overdue responses
});

test("every risk has one owner and its exposures", async () => {
  const q = `match $r isa risk, has code $c; risk-ownership (risk-owner: $o, owned-risk: $r); $o has code $oc;
           select $c, $oc;`;
  const { result } = await connection.read(async (tx) => ({
    owners: Object.fromEntries((await tx.rows(q)).map((r) => [value<string>(r, "c"), value<string>(r, "oc")])),
    exposures: (await tx.rows("match risk-exposure (risk: $r, exposed: $x);")).length,
  }), seeded());
  expect(result.owners).toEqual(Object.fromEntries(seed.risks.map((r: seedModule.Seed) => [r.code, r.owner])));
  expect(result.exposures).toBe(seed.risks.reduce((n: number, r: seedModule.Seed) => n + r.exposed.length, 0));
});
