// The shapes of the API's answers: the same as web/src/semantic/api.ts, which is the web app's side of the
// contract (kept separate so the backend and the web app each type-check on their own). A `Double` stands
// where the Python backend returned a float (see json.ts); the web app sees a number.

import type { Double } from "./json.ts";

/** What an answer says about the queries behind it. */
export interface QueryRecord {
  typeql: string[];
  "timings-ms": number[];
  purposes: (string | null)[];
  "result-queries": number[];
  processing: string[];
}

export interface Answer<T> extends QueryRecord {
  data: T;
}

export interface Named { id: string; name: string }

export interface ComponentDetails {
  id: string;
  name: string | null;
  description: string | null;
  type: string;
  /** the type and its supertypes, most specific first */
  types: string[];
  properties: { attribute: string; value: string | number | Double }[];
}

export interface ComponentAssembly { assembly: Named; path: Named[] }

export interface ComponentSystem extends Named { description: string | null; parents: Named[] }

export interface Connection {
  kind: string;
  other: string;
  "other-name": string;
  "other-type": string;
  details: Record<string, string>;
}

/** A dependency seen from one side: the other component, and which function of each is involved. */
export interface Dependency extends Named {
  family: "physical" | "operational" | "control";
  kind: string;
  function: string;
  needs: string;
  loss: "lost" | "degraded";
  degradation: "lost" | "degraded" | null;
  description: string | null;
  fallback: Named[];
}

export interface ComponentRelationships {
  connections: Connection[];
  needs: Dependency[];
  "needed-by": Dependency[];
  "control-loops": { name: string; description: string | null; role: string; system: string; "system-name": string }[];
}

/** A (component, function) reached from a failure or a requirement walk. */
export interface Reached extends Named { function: string; steps: number; via: string; kind: string }

export interface AffectedComponent extends Named { steps: number; lost: string[]; degraded: string[]; kept: string[] }

export type PropulsionState = "lost" | "reduced" | "kept";

export interface Impact {
  failed: { id: string; name: string | null; functions: string[] };
  components: AffectedComponent[];
  lost: (Reached & { "via-function": string })[];
  degraded: (Reached & { "via-function": string })[];
  fallbacks: (Named & { function: string; provider: string; "provider-name": string; needs: string; backup: string;
    "backup-name": string; description: string })[];
  propulsion: { axles: { system: string; name: string; tyres: string[]; lost: number; degraded: number; state: PropulsionState }[];
    vehicle: PropulsionState };
}

export interface Requirement extends Reached { role: "essential" | "backed up" | "supporting" }

export interface AssemblyDetails extends Named {
  description: string | null;
  parents: Named[];
  subassemblies: Named[];
  components: (Named & { type: string })[];
  "all-component-ids": string[];
}

export interface SystemSummary extends Named { description: string | null; parent: string | null; total: number }

export interface AssemblyNode extends Named { parent: string | null; direct: number; total: number }

export interface SystemDetails extends Named {
  description: string | null;
  subsystems: Named[];
  components: (Named & { systems: Named[] })[];
  "control-loops": { name: string; description: string | null; controller: string; sensors: string[]; actuators: string[] }[];
}

export interface ComponentListing extends Named { type: string; asset: string; node: string }

export interface QuestionMeta { id: string; title: string; capability: string; explanation: string }

export interface QuestionResult extends QuestionMeta {
  summary: string;
  columns: string[];
  rows: (string | number | Double)[][];
  /** component ids the answer is about */
  highlight: string[];
}

export interface TypeNode { type: string; parent: string | null; total: number; direct: number }

/** A type's or function's definition as the database's schema states it (not a query result). */
export interface SchemaDefinition { name: string; kind: "entity" | "relation" | "attribute" | "function"; definition: string }

export interface TypeDetail {
  type: string;
  supertypes: string[];
  owns: string[];
  plays: string[];
  instances: (Named & { type: string })[];
}
