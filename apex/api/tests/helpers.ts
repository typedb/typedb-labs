// What every test file needs: the connection, the shared seeded database, in-process API calls and
// throwaway databases of a test's own.

import { randomBytes } from "node:crypto";
import { inject } from "vitest";
import { handle, resetConnections } from "../src/app.ts";
import * as database from "../src/database.ts";
import type { Seed } from "../src/seed.ts";
import type { Settings } from "../src/settings.ts";
import { Connection } from "../src/typedb.ts";
import { loadSettings } from "../scripts/env.ts";

export const settings: Settings = loadSettings();
export const connection = new Connection(settings);

/** The seeded database shared by read-only tests (tests/setup.ts). */
export function seeded(): string {
  return inject("seeded");
}

export function newName(): string {
  return `apex-test-${randomBytes(4).toString("hex")}`;
}

/** A seeded database of the test's own, for tests that commit changes; drop it afterwards. */
export async function freshSeeded(seed?: Seed | null): Promise<string> {
  const name = newName();
  await database.create(connection, name, false, seed);
  return name;
}

export async function drop(name: string): Promise<void> {
  await database.drop(connection, name);
}

export interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

/** An in-process API client bound to one database (the TestClient of the original tests). */
export function client(db = seeded(), overrides: Partial<Settings> = {}) {
  const own = { ...settings, database: db, ...overrides };
  return {
    async get(path: string, params: Record<string, string | number | boolean> = {}): Promise<Reply> {
      const url = new URL(`http://apex${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
      const response = await handle(new Request(url), own);
      const text = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: response.status, body, text };
    },
    async request(method: string, path: string): Promise<Reply> {
      const response = await handle(new Request(`http://apex${path}`, { method }), own);
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, text };
    },
    /** A 200 answer's JSON body, or a failed assertion. */
    async ok(path: string, params: Record<string, string | number | boolean> = {}) {
      const r = await this.get(path, params);
      if (r.status !== 200) throw new Error(`${path} answered ${r.status}: ${r.text}`);
      return r.body;
    },
  };
}

export { resetConnections };

/** Runs a write query and commits it (planted problems in a test's own database). */
export async function write(db: string, query: string): Promise<void> {
  await connection.transaction("write", (tx) => tx.run(query), db);
}
