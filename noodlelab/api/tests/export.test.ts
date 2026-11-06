// The downloadable TypeDB model. The regression test takes the ZIP exactly as the app serves it, loads it into a
// fresh database with the README's own instructions, and compares everything with the source (src/export-check.ts).

import { describe, expect, it } from "vitest";
import { literal, MAX_QUERY_BYTES } from "../src/export.ts";
import { check, syntaxProblems, unzip } from "../src/export-check.ts";
import { unzip as unzipMembers } from "../src/zip.ts";
import { client, connection, database } from "./helpers.ts";

const byteLength = (text: string) => new TextEncoder().encode(text).length;

describe("the downloadable model", () => {
  it("the downloaded ZIP recreates the database", async () => {
    const response = await client(database()).raw("/api/export/model.zip");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("noodlelab-vehicle-typedb-model.zip");
    const files = await unzip(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["README.md", "data.tql", "schema.tql"]);
    const { problems, report, totals } = await check(connection, database(), files);
    expect(problems, report.join("\n")).toEqual([]);
    expect(totals.component).toEqual([423, 423]);
    expect(totals.connection).toEqual([676, 676]);
    expect(totals.dependency).toEqual([396, 396]);
    expect(totals.assembly[0]).toBe(totals.assembly[1]);
    expect(totals.assembly[0]).toBeGreaterThan(0);
    expect(totals["vehicle-function"][0]).toBe(totals["vehicle-function"][1]);
    expect(totals["vehicle-function"][0]).toBeGreaterThan(0);
  });

  it("the files hold the schema with functions and the data", async () => {
    const response = await client(database()).raw("/api/export/model.zip");
    const members = await unzipMembers(new Uint8Array(await response.arrayBuffer()));
    const schema = members["noodlelab-vehicle-typedb-model/schema.tql"];
    const data = members["noodlelab-vehicle-typedb-model/data.tql"];
    expect(schema.startsWith("define")).toBe(true);
    expect(schema).toContain("fun system_components(");
    expect(schema).toContain("fun lost_steps(");
    // ids are attribute values, never variable names
    expect(data.startsWith("insert")).toBe(true);
    expect(data).toContain('isa brake-caliper, has component-id "caliper-fr"');
    expect(data).not.toContain("$caliper-fr");
    // a series of queries, each small enough for size-limited servers and clients
    const queries = data.split("\n\n").filter((q) => q.trim());
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.every((q) => byteLength(q) <= MAX_QUERY_BYTES)).toBe(true);
  });

  it("the syntax check catches what strict parsers reject", () => {
    const ok = { "schema.tql": "define\nentity a;\n",
      "data.tql": 'insert\n  $e1 isa a, has name "x-$y # z";\nend;\n\nmatch\n  $e1 isa a;\ninsert\n  $e2 isa a;\nend;\n\n' };
    expect(syntaxProblems(ok)).toEqual([]);
    for (const bad of ["insert\n  $brake-booster isa a;\nend;\n\n",       // hyphenated variable
      "insert\n  $e_1 isa a;\nend;\n\n",                                  // underscore
      "insert\n  # note\n  $e1 isa a;\nend;\n\n",                        // comment
      "insert\n  $e1 isa a;\n\n  $e2 isa a;\nend;\n\n",                  // blank line inside a query
      "insert\n  $e1 isa a, has size 1e-07;\nend;\n\n",                   // exponent
      "insert\n  $e1 isa a;\n\n",                                        // no end;
      "insert\n" + "  $e1 isa a;\n".repeat(6000) + "end;\n\n"]) {        // over the size limit
      expect(syntaxProblems({ ...ok, "data.tql": bad }).length, bad.slice(0, 40)).toBeGreaterThan(0);
    }
  });

  it("values are written as TypeQL literals", () => {
    expect(literal('say "hi"', "string")).toBe('"say \\"hi\\""');
    expect(literal(800, "double")).toBe("800.0");
    expect(literal(1e-7, "double")).toBe("0.0000001");
    expect(literal(2.5e20, "double")).toBe("250000000000000000000.0");
    expect(literal(6, "integer")).toBe("6");
  });
});
