// Shared test setup: one fully seeded apex-test-* database for the tests that only read (or never
// commit), created before the suite and deleted after it. Tests use throwaway databases only: never
// `apex` or `apex-demo`. Needs Apex's TypeDB server running (docker compose up -d).

import { randomBytes } from "node:crypto";
import type { TestProject } from "vitest/node";
import * as database from "../src/database.ts";
import { Connection } from "../src/typedb.ts";
import { loadSettings } from "../scripts/env.ts";

declare module "vitest" {
  export interface ProvidedContext {
    seeded: string;
  }
}

export function newName(): string {
  return `apex-test-${randomBytes(4).toString("hex")}`;
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const connection = new Connection(loadSettings());
  const name = newName();
  await database.create(connection, name);
  project.provide("seeded", name);
  return async () => {
    await database.drop(connection, name);
  };
}
