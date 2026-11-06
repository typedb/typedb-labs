// Create an Apex database with the schema, functions and fictional seed data.
//
//     npm run create-database                              # creates "apex"
//     npm run create-database -- --replace                 # deletes and rebuilds "apex"
//     npm run create-database -- --name apex-demo --replace
//     npm run create-database -- --if-missing              # creates "apex" only if absent (Docker)
//     npm run create-database -- --name apex-test-x --delete  # removes a throwaway database
//
// Everything is checked before it is saved; if any check fails, nothing is saved.

import { parseArgs } from "node:util";
import * as database from "../src/database.ts";
import { SeedError } from "../src/seed.ts";
import { DEMO_DATABASE, isApexDatabase, PRISTINE_DATABASE } from "../src/settings.ts";
import { Connection } from "../src/typedb.ts";
import { loadSettings } from "./env.ts";

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: {
    name: { type: "string", default: PRISTINE_DATABASE },
    replace: { type: "boolean", default: false },
    "if-missing": { type: "boolean", default: false },
    delete: { type: "boolean", default: false },
  } });
  if (!isApexDatabase(values.name!)) {
    console.error(`--name must be ${PRISTINE_DATABASE}, ${DEMO_DATABASE} or apex-test-...`);
    return 2;
  }
  if (values.replace && values["if-missing"]) {
    console.error("--replace and --if-missing cannot be combined");
    return 2;
  }
  const connection = new Connection(loadSettings());
  if (values.delete) {
    await database.drop(connection, values.name!);
    console.log(`Deleted database '${values.name}' (if it existed).`);
    return 0;
  }
  const started = performance.now();
  let report;
  try {
    report = await database.create(connection, values.name!, values.replace);
  } catch (error) {
    if (error instanceof database.DatabaseExists) {
      console.log(`Not changed: ${error.message}.`);
      return values["if-missing"] ? 0 : 1;
    }
    if (error instanceof SeedError) {
      console.log(`Refused, nothing saved.\n${error.message}`);
      return 1;
    }
    throw error;
  }
  const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
  console.log(`Created database '${values.name}': ${total} entities and relations, all checks passed `
    + `(${((performance.now() - started) / 1000).toFixed(1)}s).`);
  for (const label of Object.keys(report.counts).sort()) console.log(`  ${label.padEnd(24)} ${report.counts[label]}`);
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  process.exit(await main(process.argv.slice(2)));
}
