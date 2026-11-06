// Create the vehicle database in TypeDB: `npm run create-database -- [--if-missing | --replace] [--write-tql]`.
// The work is in src/seed.ts; this file only reads the command line and talks to the terminal.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDatabase, readSeed, render, SeedError, validate } from "../src/seed.ts";
import { settingsFromEnv } from "../src/settings.ts";
import { Connection } from "../src/typedb.ts";

const GENERATED_TQL = fileURLToPath(new URL("../../data/seed.generated.tql", import.meta.url));

const args = process.argv.slice(2);
const known = ["--if-missing", "--replace", "--write-tql", "--name"];
const unknown = args.filter((a) => a.startsWith("--") && !known.includes(a));
if (unknown.length || (args.includes("--if-missing") && args.includes("--replace"))) {
  console.error("usage: create-database [--if-missing | --replace] [--write-tql] [--name DATABASE]");
  process.exit(2);
}
const settings = settingsFromEnv((name) => process.env[name]);
// --name overrides TYPEDB_DATABASE, for throwaway copies such as the tests' vehicle-test-* databases.
const database = args.includes("--name") ? args[args.indexOf("--name") + 1] : settings.database;

const seed = readSeed();
let resolved;
try {
  resolved = validate(seed);
} catch (error) {
  if (!(error instanceof SeedError)) throw error;
  console.error(error.message);
  process.exit(1);
}
if (args.includes("--write-tql")) {
  writeFileSync(GENERATED_TQL, render(seed, resolved));
  console.log(`Wrote ${GENERATED_TQL}`);
}

const connection = new Connection(settings);
if (await connection.databaseExists(database)) {
  if (args.includes("--if-missing")) {
    console.log(`Database '${database}' already exists; left as it is.`);
    process.exit(0);
  }
  if (!args.includes("--replace")) {
    console.error(`Database '${database}' already exists. Use --replace to recreate it.`);
    process.exit(1);
  }
  await connection.deleteDatabase(database);
}
const counts = await createDatabase(connection, database, seed);
console.log(`Created database '${database}':`, Object.entries(counts).map(([label, n]) => `${n} ${label}`).join(", "));
