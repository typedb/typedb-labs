// Facts read from the schema text: which attribute holds which value type, which entity types are concrete.
// Both the seed loader and the API use them (the API, to write a double attribute's value as Python did).

import { SCHEMA_TQL } from "./generated/assets.ts";

export interface SchemaFacts {
  /** entity types that can have instances (not @abstract) */
  concrete: Set<string>;
  /** attribute name -> value type (string, double, integer...) */
  attributes: Map<string, string>;
}

/** Entity types (and which are abstract) and attribute value types, read from schema/schema.tql. */
export function schemaFacts(text = SCHEMA_TQL): SchemaFacts {
  const entities = new Map<string, boolean>();
  for (const m of text.matchAll(/^entity ([a-z-]+)( @abstract)?/gm)) entities.set(m[1], Boolean(m[2]));
  const attributes = new Map<string, string>();
  for (const m of text.matchAll(/^attribute ([a-z-]+), value (\w+)/gm)) attributes.set(m[1], m[2]);
  return { concrete: new Set([...entities].filter(([, abstract]) => !abstract).map(([e]) => e)), attributes };
}

const FACTS = schemaFacts();

/** Whether the attribute's value type is double in the repository's schema. */
export function isDouble(attribute: string): boolean {
  return FACTS.attributes.get(attribute) === "double";
}
