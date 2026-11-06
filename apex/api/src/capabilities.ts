// Which TypeDB capabilities an answer's queries actually use ("Show TypeQL" line 1).
//
// Labels are detected from the exact TypeQL that ran (the recording transaction), checked against the
// schema files themselves, so a panel is never labelled with something its queries don't do:
//
// - Recursive functions: a query calls a saved function whose definition recurses (a cycle in the schema's
//   call graph, or a call into one). Calling an ordinary function is not enough.
// - N-ary relationships: a relation pattern names three or more role players.
// - Polymorphism: a query matches a type that has subtypes (one pattern finds every kind), or walks the
//   type hierarchy (`sub`).
// - Negation: `not { ... }`.
// - Aggregation: `reduce` (count, sum, ...).
// - Typed relationships: a relation pattern with named roles.
// - Nested queries: a fetch with a subquery.

import { SCHEMA_FILES } from "./generated/assets.ts";

export const ORDER = ["Recursive functions", "N-ary relationships", "Polymorphism", "Negation", "Aggregation",
  "Typed relationships", "Nested queries"] as const;

const STRING = /"(?:[^"\\]|\\.)*"/g;
const COMMENT = /#[^\n]*/g;
const RELATION = /\b([a-z][\w-]*)\s*\(([^()]*)\)/g;
const ROLE = /\b[a-z][\w-]*\s*:\s*\$/g;
const ISA = /\bisa\s+([a-z][\w-]*)/g;

function clean(text: string): string {
  return text.replace(STRING, '""').replace(COMMENT, "");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function schemaText(): string {
  return SCHEMA_FILES.filter((f) => f.path !== "schema/functions.tql").map((f) => f.text).join("\n");
}

let parents: Set<string> | undefined;

/** Types that have at least one subtype, read from the schema files. */
export function parentTypes(): Set<string> {
  if (!parents) {
    parents = new Set([...clean(schemaText()).matchAll(/^\s*(?:entity|relation)\s+[\w-]+\s+sub\s+([\w-]+)/gm)].map((m) => m[1]!));
  }
  return parents;
}

/** {function: {functions its body calls}} for every `fun` defined in the given TypeQL. */
export function functionCalls(text: string): Map<string, Set<string>> {
  const bodies = new Map<string, string>();
  for (const m of clean(text).matchAll(/^\s*fun\s+([\w-]+)\s*\(([\s\S]*?)(?=^\s*fun\s|^\s*(?:re)?define\b|(?![\s\S]))/gm)) {
    bodies.set(m[1]!, m[2]!);
  }
  const out = new Map<string, Set<string>>();
  for (const [name, body] of bodies) {
    out.set(name, new Set([...bodies.keys()].filter((other) => new RegExp(`\\b${escape(other)}\\s*\\(`).test(body))));
  }
  return out;
}

/**
 * Functions whose evaluation recurses: a cycle in the call graph (a function calling itself, directly
 * or through others), or a call into such a function. An ordinary function is never included.
 */
export function recursiveIn(text: string): Set<string> {
  const calls = functionCalls(text);
  const reaches = (start: string): Set<string> => {
    const seen = new Set<string>();
    const todo = [...(calls.get(start) ?? [])];
    while (todo.length) {
      const name = todo.pop()!;
      if (!seen.has(name)) {
        seen.add(name);
        todo.push(...(calls.get(name) ?? []));
      }
    }
    return seen;
  };
  const onCycle = new Set([...calls.keys()].filter((name) => reaches(name).has(name)));
  return new Set([...calls.keys()].filter((name) => onCycle.has(name) || [...reaches(name)].some((r) => onCycle.has(r))));
}

let recursive: Set<string> | undefined;

/** recursiveIn() over every function the schema defines (functions.tql and any migration). */
export function recursiveFunctions(): Set<string> {
  if (!recursive) {
    recursive = recursiveIn(SCHEMA_FILES.filter((f) => f.path !== "schema/schema.tql").map((f) => f.text).join("\n"));
  }
  return recursive;
}

/** The capability labels the given queries genuinely use, in a fixed order. */
export function detect(queries: string[]): string[] {
  const found = new Set<string>();
  const parentSet = parentTypes();
  const recursiveSet = recursiveFunctions();
  for (const raw of queries) {
    const q = clean(raw);
    if ([...recursiveSet].some((f) => new RegExp(`\\b${escape(f)}\\s*\\(`).test(q))) found.add("Recursive functions");
    for (const m of q.matchAll(RELATION)) {
      const relType = m[1]!;
      const roles = [...m[2]!.matchAll(ROLE)].length;
      if (roles >= 1) {
        found.add("Typed relationships");
        if (parentSet.has(relType)) found.add("Polymorphism");
      }
      if (roles >= 3) found.add("N-ary relationships");
    }
    if ([...q.matchAll(ISA)].some((m) => parentSet.has(m[1]!)) || /\$[\w-]+\s+sub!?\s+/.test(q)) found.add("Polymorphism");
    if (/\bnot\s*\{/.test(q)) found.add("Negation");
    if (/\breduce\b/.test(q)) found.add("Aggregation");
    if (/\bfetch\b[\s\S]*[\[(]\s*match\b/.test(q)) found.add("Nested queries");
  }
  return ORDER.filter((label) => found.has(label));
}
