// The schema itself refuses bad data, whatever program writes it. Nothing here is ever saved.

import { expect, test } from "vitest";
import { QueryFailed } from "../src/typedb.ts";
import { connection, seeded } from "./helpers.ts";

async function refused(query: string): Promise<string> {
  try {
    await connection.transaction("write", (tx) => tx.run(query), seeded());
  } catch (error) {
    expect(error).toBeInstanceOf(QueryFailed);
    return (error as QueryFailed).message;
  }
  throw new Error("the write was accepted");
}

test("a second Accountable owner is refused", async () => {
  const message = await refused(`
        match $i isa regulatory-clearance, has code "CP-CMA"; $p isa person, has code "PER-SHAW";
        insert accountability (holder: $p, accountable-item: $i);`);
  expect(message).toContain("CNT5");
  expect(message).toContain("accountability:accountable-item");
});

test("a stake over 100 percent is refused", async () => {
  const message = await refused(`
        match $a isa company, has code "ORG-ATL"; $b isa company, has code "ORG-HELIX";
        insert ownership (owner: $a, owned: $b), has stake 1.5dec;`);
  expect(message).toContain("CNT7");
});

test("an unknown status word is refused", async () => {
  const message = await refused('insert $m isa milestone, has code "MS-BAD", has status "nearly-done";');
  expect(message.includes("@values") || message.includes("CNT")).toBe(true);
});

test("progress over 100 is refused", async () => {
  expect(await refused('insert $m isa milestone, has code "MS-BAD", has progress 150;')).toContain("CNT7");
});

test("a regulator cannot be an adviser", async () => {
  const message = await refused(`
        match $c isa company, has code "ORG-NOV"; $r isa regulator, has code "ORG-CMA"; $d isa acquisition;
        insert mandate (client: $c, adviser: $r, engagement: $d);`);
  expect(message).toContain("INF"); // rejected by type checking, before any data is touched
});

test("an item cannot sit in two workstreams", async () => {
  const message = await refused(`
        match $i isa regulatory-clearance, has code "CP-CMA"; $w isa workstream, has code "WS-LEG";
        insert work-breakdown (whole: $w, part: $i);`);
  expect(message).toContain("CNT5");
  expect(message).toContain("work-breakdown:part");
});

test("codes are unique", async () => {
  expect(await refused('insert $m isa milestone, has code "CP-CMA";')).toContain("CNT9");
});

test("an attribute on the wrong type is refused", async () => {
  // A person can't have a stake: only ownership relations own one.
  expect(await refused('insert $p isa person, has code "PER-X", has stake 0.5dec;')).toContain("INF");
});
