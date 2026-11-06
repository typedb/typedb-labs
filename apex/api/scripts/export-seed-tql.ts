// Regenerate data/seed.tql (the seed data as one TypeQL insert, for loading in TypeDB Studio).
//
//     npm run export-seed-tql
//
// A test fails if data/seed.tql is out of date with data/seed/*.yaml.

import { writeSeedTql } from "../src/seed.ts";

console.log(`Wrote ${writeSeedTql()}`);
