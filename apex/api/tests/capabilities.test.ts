// The "Show TypeQL" capability labels: detected from the queries that actually ran, never claimed.

import { beforeAll, expect, test } from "vitest";
import * as capabilities from "../src/capabilities.ts";
import { client } from "./helpers.ts";
import type { Rec } from "./oracle.ts";

// Read by hand from schema/functions.tql: these call themselves, or (ownership_cycles) call one that does.
const RECURSIVE = new Set(["downstream", "impact_edges", "upstream", "group_members", "owners_above", "ownership_cycles"]);

const URLS = ["/api/deal", "/api/approvals", "/api/activity", "/api/parties", "/api/progress", "/api/raci?workstream=WS-REG",
  "/api/checks", "/api/ownership", "/api/graph", "/api/graph/node/PER-SHAW", "/api/impact?delay_days=61",
  "/api/schedule", "/api/items/CP-CMA"];

let answers: Record<string, Rec>;
beforeAll(async () => {
  const c = client();
  answers = {};
  for (const u of URLS) answers[u] = (await c.get(u)).body;
});

test("recursive functions are read from the schema", () => {
  expect(capabilities.recursiveFunctions()).toEqual(RECURSIVE); // accountable_for is not recursive
});

test("recursion comes from the call graph, not from any call", () => {
  const defs = `
    define
    fun plain($x: company) -> { company }: match ownership (owner: $x, owned: $y); return { $y };
    fun twice($x: company) -> { company }: match let $y in plain($x); return { $y };
    fun loop_a($x: company) -> { company }: match { let $y in loop_b($x); } or { ownership (owner: $x, owned: $y); }; return { $y };
    fun loop_b($x: company) -> { company }: match let $y in loop_a($x); return { $y };
    fun uses_loop($x: company) -> { company }: match let $y in loop_a($x); return { $y };
    `;
  expect(capabilities.recursiveIn(defs)).toEqual(new Set(["loop_a", "loop_b", "uses_loop"])); // plain and twice are ordinary
  expect(capabilities.functionCalls(defs).get("twice")).toEqual(new Set(["plain"]));
});

test("calling an ordinary function is not labelled recursive", () => {
  const q = 'match $i isa deal-item, has code "CP-CMA"; let $p = accountable_for($i); $p has name $n; fetch { "n": $n };';
  expect(capabilities.detect([q])).not.toContain("Recursive functions");
  expect(capabilities.detect([q.replace("let $p = accountable_for($i)", "let $p in downstream($i)")])).toContain("Recursive functions");
});

test("detection on small examples", () => {
  const d = capabilities.detect;
  expect(d(["match $x isa deal-item; not { accountability (accountable-item: $x); };"])).toEqual(["Polymorphism", "Negation", "Typed relationships"]);
  expect(d(["match $m isa mandate (client: $c, adviser: $a, engagement: $d);"])).toEqual(["N-ary relationships", "Typed relationships"]);
  expect(d(['match $s isa company, has code "X"; let $c in owners_above($s);'])).toEqual(["Recursive functions"]);
  // Words inside strings and comments are not query features.
  expect(d(['match $x isa company, has name "not { downstream(x) }"; # reduce count'])).toEqual([]);
});

test("every answer carries its labels", () => {
  for (const [url, body] of Object.entries(answers)) {
    expect(body.capabilities, url).toEqual(capabilities.detect(body.typeql));
    expect(body.query_capabilities, url).toEqual(body.typeql.map((q: string) => capabilities.detect([q])));
  }
});

test.each(URLS)("recursion is claimed only when a recursive function is called: %s", (url) => {
  const body = answers[url]!;
  const calls = body.typeql.some((q: string) => [...RECURSIVE].some((f) => new RegExp(`\\b${f}\\s*\\(`).test(q)));
  expect(body.capabilities.includes("Recursive functions")).toBe(calls);
});

test("expected labels on key panels", () => {
  const labels: Record<string, Set<string>> = Object.fromEntries(Object.entries(answers).map(([u, b]) => [u, new Set(b.capabilities)]));
  expect(labels["/api/impact?delay_days=61"]!.has("Recursive functions")).toBe(true);
  expect(labels["/api/ownership"]!.has("Recursive functions")).toBe(true);
  for (const u of ["/api/deal", "/api/schedule", "/api/checks"]) expect(labels[u]!.has("Recursive functions"), u).toBe(false);
  expect(labels["/api/checks"]!.has("Negation")).toBe(true);
  expect(labels["/api/schedule"]!.has("Negation")).toBe(false);
  expect(labels["/api/parties"]!.has("N-ary relationships")).toBe(true); // mandate: client, adviser, engagement
  expect(labels["/api/progress"]!.has("Aggregation")).toBe(true); // count groupby
  expect(labels["/api/items/CP-CMA"]!.has("Nested queries")).toBe(true);
});
