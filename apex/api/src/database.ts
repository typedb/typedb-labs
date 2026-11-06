// Creating Apex databases: schema, functions and seed data, from scratch.
//
// Only Apex's own databases can be created or replaced (apex, apex-demo, apex-test-*); anything
// else on the server is refused, so a typo can never delete someone else's data. Used by the seed
// service, the scripts and the tests, never by the API.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as seedModule from "./seed.ts";
import { isApexDatabase } from "./settings.ts";
import type { Connection } from "./typedb.ts";

export const ROOT = seedModule.ROOT;
const BASE_SCHEMA = [join(ROOT, "schema", "schema.tql"), join(ROOT, "schema", "functions.tql")];
const MIGRATIONS_DIR = join(ROOT, "schema", "migrations");

/**
 * schema/migrations/NNN-*.tql in number order. Approved schema files are never edited: changes are
 * new migrations, applied after the base schema whenever a database is built.
 */
export function migrationFiles(): string[] {
  const names = readdirSync(MIGRATIONS_DIR).filter((n) => /^[0-9][0-9][0-9]-.*\.tql$/.test(n)).sort();
  const numbers = names.map((n) => n.slice(0, 3));
  if (new Set(numbers).size !== numbers.length) throw new Error(`two migrations share a number: ${numbers}`);
  return names.map((n) => join(MIGRATIONS_DIR, n));
}

export const SCHEMA_FILES = [...BASE_SCHEMA, ...migrationFiles()];

export class DatabaseExists extends Error {}

function checkName(name: string): void {
  if (!isApexDatabase(name)) throw new Error(`refusing to touch database '${name}': Apex only manages apex, apex-demo and apex-test-*`);
}

export async function drop(connection: Connection, name: string): Promise<void> {
  checkName(name);
  if (await connection.databaseExists(name)) await connection.deleteDatabase(name);
}

/** Create an empty database with the schema and functions (no data). */
export async function createSchema(connection: Connection, name: string): Promise<void> {
  checkName(name);
  if (await connection.databaseExists(name)) throw new DatabaseExists(`database '${name}' already exists (use --replace to rebuild it)`);
  await connection.createDatabase(name);
  try {
    for (const path of SCHEMA_FILES) {
      const text = readFileSync(path, "utf8");
      await connection.transaction("schema", (tx) => tx.run(text), name);
    }
  } catch (error) {
    await drop(connection, name);
    throw error;
  }
}

/**
 * Create database `name` with schema, functions and seed data. Returns the load report.
 *
 * If the seed is refused, the half-made database is removed again.
 */
export async function create(connection: Connection, name: string, replace = false, seed?: seedModule.Seed | null): Promise<{ counts: Record<string, number> }> {
  checkName(name);
  if (replace) await drop(connection, name);
  await createSchema(connection, name);
  try {
    return await seedModule.load(connection, name, seed);
  } catch (error) {
    await drop(connection, name);
    throw error;
  }
}
