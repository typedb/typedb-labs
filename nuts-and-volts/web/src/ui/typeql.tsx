// Reading TypeQL for display: light syntax highlighting, and the schema concepts a query uses (its types,
// relation types with their roles, functions and attributes), read from the query text itself so what the
// interface says a query explores can never drift from the query that ran.

import { Fragment } from "react";

const KEYWORDS = /\b(match|fetch|reduce|groupby|select|distinct|limit|let|in|or|not|isa!?|has|links|sub!?|owns|plays|relates|label|is|count|sum|return|fun|define|entity|relation|attribute|value)\b/g;

/** Highlight keywords, $variables and strings (colours in styles.css: .tq-kw, .tq-var, .tq-str). */
export function highlight(query: string) {
  const parts = query.split(/(\$[a-z0-9_-]+|"[^"]*")/gi);
  return parts.map((part, i) => {
    if (part.startsWith("$")) return <span key={i} className="tq-var">{part}</span>;
    if (part.startsWith('"')) return <span key={i} className="tq-str">{part}</span>;
    const bits = part.split(KEYWORDS);
    return <Fragment key={i}>{bits.map((b, j) => (j % 2 ? <span key={j} className="tq-kw">{b}</span> : b))}</Fragment>;
  });
}

export interface Concepts {
  /** entity and relation types matched with isa (relation types also appear under relations) */
  types: string[];
  /** relation types written as patterns, with the roles the query names ("any" when the role is a variable) */
  relations: { name: string; roles: string[] }[];
  /** functions the query calls (TypeDB functions are written in snake_case) */
  functions: string[];
  /** attribute types the query reads or matches */
  attributes: string[];
}

const LABEL = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";

/** The schema concepts a query uses. A relation written as `links (...)` takes its type from the `isa` in the same
 * statement; when that type is a variable (any relation type, its subtypes included), it is reported by that
 * variable, as "any $kind". */
export function concepts(query: string): Concepts {
  const relations = new Map<string, Set<string>>();
  const addRelation = (name: string, roles: string) => {
    const set = relations.get(name) ?? new Set<string>();
    for (const m of roles.matchAll(/(\$?[a-z][a-z0-9-]*)\s*:\s*\$/g)) set.add(m[1].startsWith("$") ? "any role" : m[1]);
    relations.set(name, set);
  };
  // Statements end with ";" (nested sub-queries in fetch are statements too).
  for (const statement of query.split(";")) {
    for (const m of statement.matchAll(new RegExp(`(?<![\\w$.-])(${LABEL}|links)\\s*\\(((?:\\s*\\$?${LABEL}\\s*:\\s*\\$[\\w-]+\\s*,?)+)\\)`, "g"))) {
      let name = m[1];
      if (name === "links") {
        const isa = statement.match(new RegExp(`isa!?\\s+(\\$[\\w-]+|${LABEL})`));
        name = !isa ? "any relation" : isa[1].startsWith("$") ? `any ${isa[1]}` : isa[1];
      }
      addRelation(name, m[2]);
    }
  }
  const relationNames = new Set(relations.keys());
  const types = new Set<string>();
  for (const m of query.matchAll(new RegExp(`\\bisa!?\\s+(${LABEL})`, "g"))) if (!relationNames.has(m[1])) types.add(m[1]);
  for (const m of query.matchAll(new RegExp(`\\b(?:label|sub!?)\\s+(${LABEL})`, "g"))) types.add(m[1]);
  const functions = new Set<string>();
  for (const m of query.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*\(/g)) functions.add(m[1]);
  const attributes = new Set<string>();
  for (const m of query.matchAll(new RegExp(`\\bhas\\s+(${LABEL})`, "g"))) attributes.add(m[1]);
  for (const m of query.matchAll(new RegExp(`\\$[\\w-]+\\.(${LABEL})`, "g"))) attributes.add(m[1]);
  return {
    types: [...types],
    relations: [...relations].map(([name, roles]) => ({ name, roles: [...roles] })),
    functions: [...functions],
    attributes: [...attributes],
  };
}
