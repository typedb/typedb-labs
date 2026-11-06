// Effective ownership of the Atlas group, checked independently, and its guards.
//
// The calculation (group_members) is only correct without ownership cycles. These tests prove the
// guards catch cycles and over-100% holdings, and that Apex then refuses to give figures at all,
// rather than returning plausible-looking wrong totals.

import { expect, test } from "vitest";
import * as database from "../src/database.ts";
import { Dec } from "../src/decimal.ts";
import * as queries from "../src/queries.ts";
import { readSeed, SeedError } from "../src/seed.ts";
import { connection, drop, newName, seeded } from "./helpers.ts";
import * as oracle from "./oracle.ts";

const CYCLE = `match $us isa company, has code "ORG-ATL-US"; $atl isa company, has code "ORG-ATL";
           insert ownership (owner: $us, owned: $atl), has stake 0.05dec;`;
const OVER = `match $cal isa company, has code "ORG-CALDER"; $de isa company, has code "ORG-ATL-DE";
          insert ownership (owner: $cal, owned: $de), has stake 0.2dec;`;

function plain(actual: Record<string, queries.EffectiveStake>) {
  return Object.fromEntries(Object.entries(actual).map(([c, v]) => [c, [v.stake.toString(), v.routes]]));
}

test("effective stakes match an independent route-by-route calculation", async () => {
  const expected = oracle.effectiveStakes(oracle.rawSeed(), "ORG-ATL");
  const { result } = await connection.read((tx) => queries.effectiveOwnership(tx, "ORG-ATL"), seeded());
  expect(plain(result)).toEqual(Object.fromEntries(Object.entries(expected).map(([c, [s, n]]) => [c, [s.toString(), n]])));
});

test("answer key including two routes", async () => {
  const { result: actual } = await connection.read((tx) => queries.effectiveOwnership(tx, "ORG-ATL"), seeded());
  expect(actual["ORG-ATL-IP"]!.stake.eq("0.9")).toBe(true);
  expect(actual["ORG-ATL-IP"]!.routes).toBe(2);
  expect(actual["ORG-ATL-JV"]!.stake.eq("0.6")).toBe(true);
  expect(actual["ORG-ATL-JV"]!.routes).toBe(1);
  for (const code of ["ORG-ATL-UK", "ORG-ATL-US", "ORG-ATL-IE", "ORG-ATL-DE"]) {
    expect(actual[code]!.stake.eq(1)).toBe(true);
    expect(actual[code]!.routes).toBe(1);
  }
  expect(new Set(Object.keys(actual))).toEqual(new Set(["ORG-ATL-UK", "ORG-ATL-US", "ORG-ATL-IE", "ORG-ATL-DE", "ORG-ATL-IP", "ORG-ATL-JV"]));
});

test("a single route would give the wrong answer", () => {
  // Guards the test above: 90% only comes out if BOTH routes are added.
  const routes = oracle.ownershipRoutes(oracle.rawSeed(), "ORG-ATL")["ORG-ATL-IP"]!;
  expect(routes.map((r) => r.toString()).sort()).toEqual(["0.2", "0.7"]);
});

test("guards find nothing on the seed", async () => {
  const { result } = await connection.read((tx) => queries.ownershipProblems(tx), seeded());
  expect(result).toEqual({ cycles: [], over_owned: {} });
});

test("a cycle is detected and no figures are returned", async () => {
  const tx = await connection.open("write", seeded()); // never committed
  try {
    await tx.run(CYCLE);
    expect((await queries.ownershipProblems(tx)).cycles).toEqual(["ORG-ATL", "ORG-ATL-UK", "ORG-ATL-US"]);
    await expect(queries.effectiveOwnership(tx, "ORG-ATL")).rejects.toThrow(/ownership cycle/);
    await expect(queries.groupConsents(tx, "ORG-ATL")).rejects.toThrow(queries.OwnershipDataError);
  } finally {
    await tx.close();
  }
});

test("why the guard exists: unguarded totals are misleading", async () => {
  // Without the guard, a 5% cross-holding makes the recursion report more than 100%.
  const tx = await connection.open("write", seeded()); // never committed
  try {
    await tx.run(CYCLE);
    const raw = Object.fromEntries((await tx.docs(queries.effectiveOwnershipQuery("ORG-ATL"))).map((d) => [d.company, d]));
    expect(Dec.of(raw["ORG-ATL-UK"]!["effective stake"]).gt(1)).toBe(true);
  } finally {
    await tx.close();
  }
});

test("over 100 percent is detected and no figures are returned", async () => {
  const tx = await connection.open("write", seeded()); // never committed
  try {
    await tx.run(OVER);
    const over = (await queries.ownershipProblems(tx)).over_owned;
    expect(Object.keys(over)).toEqual(["ORG-ATL-DE"]);
    expect(over["ORG-ATL-DE"]!.eq("1.2")).toBe(true);
    await expect(queries.effectiveOwnership(tx, "ORG-ATL")).rejects.toThrow(/more than 100% owned/);
  } finally {
    await tx.close();
  }
});

test("the loader refuses a cross-shareholding", async () => {
  const seed = readSeed();
  seed.ownership.push({ owner: "ORG-ATL-US", owned: "ORG-ATL", stake: "0.05" });
  const name = newName();
  try {
    await expect(database.create(connection, name, false, seed)).rejects.toThrow(/cross-shareholdings are rejected/);
    expect(await connection.databaseExists(name)).toBe(false);
  } finally {
    await drop(name);
  }
});

test("the loader refuses over 100 percent", async () => {
  const seed = readSeed();
  seed.ownership.push({ owner: "ORG-CALDER", owned: "ORG-ATL-DE", stake: "0.2" });
  const name = newName();
  try {
    await expect(database.create(connection, name, false, seed)).rejects.toThrow(/ORG-ATL-DE is more than 100% owned/);
    expect(await connection.databaseExists(name)).toBe(false);
  } finally {
    await drop(name);
  }
});

test("the oracle itself notices cycles", () => {
  const seed = oracle.rawSeed();
  seed.ownership.push({ owner: "ORG-ATL-US", owned: "ORG-ATL", stake: "0.05" });
  expect(() => oracle.ownershipRoutes(seed, "ORG-ATL")).toThrow(/cycle/);
});

test("change-of-control consents inside the Atlas group", async () => {
  const { result: consents } = await connection.read((tx) => queries.groupConsents(tx, "ORG-ATL"), seeded());
  expect(consents.map((c) => ({ ...c, stake: c.stake.toString() }))).toEqual([
    { obligation: "CV-COC-CALDER", owed_by: "ORG-ATL-IP", consent_from: "ORG-CALDER", stake: "0.9" },
    { obligation: "CV-COC-HELIX", owed_by: "ORG-ATL-IE", consent_from: "ORG-HELIX", stake: "1" },
    { obligation: "DL-HELIX-WAIVER", owed_by: "ORG-ATL-IE", consent_from: "ORG-HELIX", stake: "1" },
  ]);
});

test("a SeedError lists every problem", () => {
  const error = new SeedError(["a", "b"]);
  expect(error.message).toBe("Seed data problems:\n  - a\n  - b");
});
