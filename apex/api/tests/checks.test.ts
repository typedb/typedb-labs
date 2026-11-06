// The three Overview data-quality checks fire on planted problems (never committed).

import { expect, test } from "vitest";
import * as queries from "../src/queries.ts";
import { connection, seeded } from "./helpers.ts";

const PLANTED = `
insert
  $m isa milestone, has code "MS-PLANTED", has name "Planted problem", has status "in-progress",
     has due-date 2026-10-01;
  $c isa regulatory-clearance, has code "CP-PLANTED", has name "Planted clearance", has status "not-started",
     has due-date 2026-12-31;
`;

test("each check finds exactly its planted problem", async () => {
  const tx = await connection.open("write", seeded()); // never committed
  try {
    await tx.run(PLANTED);
    expect(await queries.dataQualityChecks(tx)).toEqual({
      no_accountable: ["CP-PLANTED", "MS-PLANTED"],
      overdue: ["MS-PLANTED"], // due before 26 Oct 2026 and not complete
      clearance_without_authority: ["CP-PLANTED"],
    });
  } finally {
    await tx.close();
  }
});

test("planted problems were not saved", async () => {
  const { result } = await connection.read((tx) => queries.dataQualityChecks(tx), seeded());
  expect(Object.values(result).every((codes) => codes.length === 0)).toBe(true);
});
