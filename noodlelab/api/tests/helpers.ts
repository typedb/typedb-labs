// Shared by the test files: the connection, the shared test database and a client that calls the API in-process.

import { inject } from "vitest";
import { handle } from "../src/app.ts";
import { createDatabase } from "../src/seed.ts";
import { settingsFromEnv, type Settings } from "../src/settings.ts";
import { Connection } from "../src/typedb.ts";

export const settings: Settings = settingsFromEnv((name) => process.env[name]);
export const connection = new Connection(settings);

/** The freshly seeded database shared by tests that only read (created once per run by global-setup.ts). */
export const database = (): string => inject("database");

export const disposableName = () => `vehicle-test-${Math.random().toString(16).slice(2, 10)}`;

/** A freshly seeded database for a test that changes data; the caller deletes it. */
export async function scratchDatabase(): Promise<string> {
  const name = disposableName();
  await createDatabase(connection, name);
  return name;
}

export interface Client {
  get(path: string, status?: number): Promise<Record<string, any>>;
  raw(path: string, init?: RequestInit): Promise<Response>;
}

/** Calls the API's handler directly (no network), like FastAPI's TestClient did. */
export function client(databaseName: string, address = settings.address): Client {
  const s = { ...settings, address, database: databaseName };
  const raw = (path: string, init?: RequestInit) => handle(new Request(`http://test${path}`, init), s);
  return {
    raw,
    async get(path, status = 200) {
      const response = await raw(path);
      const text = await response.text();
      if (response.status !== status) throw new Error(`${path}: ${response.status} ${text}`);
      return JSON.parse(text);
    },
  };
}

export const setEqual = <T>(a: Iterable<T>, b: Iterable<T>) => {
  const x = new Set(a), y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/** Python's `a <= b` on sets: every element of a is in b. */
export const subset = <T>(a: Iterable<T>, b: Iterable<T>) => {
  const y = new Set(b);
  return [...a].every((v) => y.has(v));
};
