// The generated module (schema texts and parsed policies) must match the files it was generated from, and
// the API must keep reading its configuration from that module rather than from disk.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { CONNECTION_POLICY, ENGAGEMENT_POLICY, SCHEMA_FILES } from "../src/generated/assets.ts";
import { OUT, render, ROOT } from "../scripts/gen.ts";

test("src/generated/assets.ts is up to date", () => {
  expect(readFileSync(OUT, "utf8")).toBe(render()); // stale: run npm run gen
});

test("the policies the API serves are the files in config/", () => {
  // The policy files are parsed at build time (npm run gen), so the API needs neither config/ nor a YAML parser.
  expect(ENGAGEMENT_POLICY).toEqual(parse(readFileSync(join(ROOT, "config", "engagement-policy.yaml"), "utf8")));
  expect(CONNECTION_POLICY).toEqual(parse(readFileSync(join(ROOT, "config", "connection-policy.yaml"), "utf8")));
  expect(SCHEMA_FILES.map((f) => f.path)).toEqual(["schema/schema.tql", "schema/functions.tql", "schema/migrations/001-phase6-foundation.tql", "schema/migrations/002-meeting-agenda.tql"]);
});

test("the runtime core touches no runtime-specific API", () => {
  // app.ts and everything it imports must run under Node and Deno alike: no node:* imports, no file reads.
  for (const file of ["app.ts", "settings.ts", "typedb.ts", "decimal.ts", "py.ts", "queries.ts", "capabilities.ts", "overview.ts", "explorer.ts",
    "impact.ts", "schedule.ts", "workstreams.ts", "engagement.ts", "parties.ts", "connections.ts", "advantage.ts", "analyst.ts", "guide.ts", "models.ts"]) {
    const source = readFileSync(join(ROOT, "api", "src", file), "utf8");
    expect(source, file).not.toMatch(/from "node:/);
    expect(source, file).not.toMatch(/\bDeno\./);
    expect(source, file).not.toMatch(/readFileSync|process\.env[.[]/);
    expect(source, file).not.toMatch(/from "yaml"/);
  }
});
