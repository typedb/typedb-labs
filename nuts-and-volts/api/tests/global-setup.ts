// Test set-up. These tests need a running TypeDB server and fail, rather than skip, when it is missing: the point
// is to test against the real database.
//
// Each test run creates its own database ("vehicle-test-<random>") from the schema and seed, and deletes it
// afterwards. The real "vehicle" database is never touched.

import type { TestProject } from "vitest/node";
import { createDatabase } from "../src/seed.ts";
import { settingsFromEnv } from "../src/settings.ts";
import { Connection } from "../src/typedb.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** the freshly seeded database shared by tests that only read */
    database: string;
  }
}

export const disposableName = () => `vehicle-test-${Math.random().toString(16).slice(2, 10)}`;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const connection = new Connection(settingsFromEnv((name) => process.env[name]));
  const name = disposableName();
  await createDatabase(connection, name);
  project.provide("database", name);
  return async () => {
    await connection.deleteDatabase(name);
  };
}
