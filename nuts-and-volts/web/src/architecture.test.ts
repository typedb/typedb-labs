// Guards decision 0001 (docs/decisions/0001-typedb-sole-database.md): TypeDB is the only database.
// Fails if a database client, browser storage API or non-TypeDB database service creeps into the project.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Project root: given by the dev container (which mounts the project read-only), else two levels up.
const root = process.env.PROJECT_ROOT ?? fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Client libraries for databases and persistent stores other than TypeDB. */
const FORBIDDEN_PACKAGES = [
  "pg", "postgres", "mysql", "mysql2", "sqlite", "sqlite3", "better-sqlite3", "sql.js", "mongodb", "mongoose",
  "redis", "ioredis", "neo4j-driver", "prisma", "@prisma/client", "typeorm", "sequelize", "knex", "drizzle-orm",
  "dexie", "idb", "localforage", "pouchdb", "firebase", "@supabase/supabase-js", "lowdb", "nedb", "duckdb",
];
const FORBIDDEN_PYTHON = ["sqlalchemy", "psycopg", "psycopg2", "pymongo", "redis", "neo4j", "duckdb", "peewee", "tinydb", "sqlite-utils"];
/** Browser APIs that would persist domain data on the client. */
const STORAGE_APIS = /\b(localStorage|sessionStorage|indexedDB|openDatabase|document\.cookie)\b|\bcaches\.open\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("TypeDB is the only database", () => {
  it("has no other database client in the web app's dependencies", () => {
    const pkg = JSON.parse(read("web/package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => FORBIDDEN_PACKAGES.includes(d))).toEqual([]);
  });

  it("does not persist anything in the browser (no localStorage, IndexedDB, cookies...)", () => {
    const offenders = sourceFiles(join(root, "web/src")).filter((f) => STORAGE_APIS.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("runs no database service other than TypeDB", () => {
    const images = [...read("compose.yaml").matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);
    const databases = images.filter((i) => /postgres|mysql|mariadb|mongo|redis|neo4j|sqlite|duckdb|cassandra|elastic/i.test(i));
    expect(databases).toEqual([]);
    for (const i of images.filter((i) => /typedb/i.test(i))) expect(i).toMatch(/^typedb\/typedb:3\./);
  });

  it("has no database package in the Blender asset pipeline or the semantic API", () => {
    const blender = read("blender/pyproject.toml").toLowerCase();
    expect(FORBIDDEN_PYTHON.filter((p) => new RegExp(`["\\s]${p}[=<>~"\\s]`).test(blender)), "blender/pyproject.toml").toEqual([]);
    const api = JSON.parse(read("api/package.json"));
    const deps = Object.keys({ ...api.dependencies, ...api.devDependencies });
    expect(deps.filter((d) => FORBIDDEN_PACKAGES.includes(d)), "api/package.json").toEqual([]);
    // the official TypeDB HTTP driver, pinned to a 3.x version
    expect(api.dependencies["@typedb/driver-http"]).toMatch(/^3\./);
  });

  it("never reads the seed files at runtime: domain facts reach the web app only through the API", () => {
    // an import or fetch of anything under data/seed, or of a YAML or TypeQL file
    const loads = /(?:\bfrom\s*|\bimport\s*\(\s*|\bfetch\s*\(\s*)["'`][^"'`]*(?:data\/seed|\.ya?ml|\.tql)["'`]/;
    const offenders = sourceFiles(join(root, "web/src")).filter((f) => loads.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
