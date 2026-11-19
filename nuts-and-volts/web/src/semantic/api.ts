// The only way the web app learns what components are and how they relate: named, read-only questions to
// the semantic API, which answers from TypeDB (docs/decisions/0001-typedb-sole-database.md).
// Every answer carries the exact TypeQL that produced it.
//
// There is no fallback data. If TypeDB (or the API) can't be reached, callers get an "unavailable" error
// and show it; the 3D model, which is a static asset, keeps working.

export interface Answer<T> extends QueryRecord {
  data: T;
}

/** What an answer says about the queries behind it. */
export interface QueryRecord {
  typeql: string[];
  /** how long each query took in TypeDB (ms), in the same order as `typeql` */
  "timings-ms": number[];
  /** what each query was for, in the same order */
  purposes?: (string | null)[];
  /** indexes of the queries whose answers are the components the answer is about (the highlighted ones) */
  "result-queries"?: number[];
  /** steps the API did itself, in TypeScript, after TypeDB answered */
  processing?: string[];
}

/** Just the query record of an answer (or a focus built from one). */
export const queryRecord = (a: QueryRecord): QueryRecord => ({
  typeql: a.typeql, "timings-ms": a["timings-ms"], purposes: a.purposes, "result-queries": a["result-queries"], processing: a.processing,
});

export type Failure = "unavailable" | "not-found" | "failed";

export class SemanticError extends Error {
  constructor(public readonly kind: Failure, message: string) {
    super(message);
  }
}

export const UNAVAILABLE = "TypeDB is not reachable, so semantic information cannot be shown. The 3D model still works.";

/** Every answer also tells the status indicator whether TypeDB is reachable, so it never lags behind. */
export const TYPEDB_STATUS_EVENT = "typedb-status";
const report = (available: boolean) => window.dispatchEvent(new CustomEvent(TYPEDB_STATUS_EVENT, { detail: available }));

/** Requests on their way, by path: two views asking the same question at the same moment (the component panel
 * and the TypeQL overlay) share one request. Nothing is kept once it has answered. */
const inFlight = new Map<string, Promise<Answer<unknown>>>();

export function ask<T>(path: string, signal?: AbortSignal): Promise<Answer<T>> {
  let shared = inFlight.get(path);
  if (!shared) {
    shared = request(path).finally(() => inFlight.delete(path));
    inFlight.set(path, shared);
  }
  if (!signal) return shared as Promise<Answer<T>>;
  // Each caller can stop waiting without cancelling the request for the others.
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    shared.then((a) => resolve(a as Answer<T>), reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Where the API lives: /api next to the app, whatever path the app itself is served from. */
export const API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

async function request(path: string): Promise<Answer<unknown>> {
  let response: Response;
  try {
    response = await fetch(`${API}/${path}`, { headers: { Accept: "application/json" } });
  } catch {
    report(false);
    throw new SemanticError("unavailable", UNAVAILABLE);
  }
  // 502/504: the development server could not reach the API itself.
  const available = ![502, 503, 504].includes(response.status);
  report(available);
  if (!available) throw new SemanticError("unavailable", UNAVAILABLE);
  const body = await response.json().catch(() => null);
  if (response.status === 404) throw new SemanticError("not-found", body?.message ?? "Not found in TypeDB.");
  if (!response.ok || !body || !("data" in body)) throw new SemanticError("failed", body?.message ?? "TypeDB could not answer.");
  return body as Answer<unknown>;
}

const id = (value: string) => encodeURIComponent(value);

// ---- Answers --------------------------------------------------------------------------------------------

export interface Named { id: string; name: string }

export interface ComponentDetails {
  id: string;
  name: string;
  description: string | null;
  type: string;
  /** the type and its supertypes, most specific first: e.g. brake-caliper, brake-component, chassis-component, component */
  types: string[];
  properties: { attribute: string; value: string | number }[];
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
  /** the dependent's function that relies on... */
  function: string;
  /** ...this function of the provider */
  needs: string;
  /** what happens to `function` if `needs` is lost / only degraded (null: nothing) */
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

/** One affected component: which of its functions are lost or degraded, and which it keeps. */
export interface AffectedComponent extends Named { steps: number; lost: string[]; degraded: string[]; kept: string[] }

export interface Impact {
  /** the failed part loses every function it has */
  failed: { id: string; name: string | null; functions: string[] };
  components: AffectedComponent[];
  lost: (Reached & { "via-function": string })[];
  degraded: (Reached & { "via-function": string })[];
  fallbacks: (Named & { function: string; provider: string; "provider-name": string; needs: string; backup: string;
    "backup-name": string; description: string })[];
  /** drive per axle and for the whole vehicle, from the tyres each axle drives (TypeDB) */
  propulsion: { axles: { system: string; name: string; tyres: string[]; lost: number; degraded: number; state: PropulsionState }[];
    vehicle: PropulsionState };
}

export type PropulsionState = "lost" | "reduced" | "kept";

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
  /** each member with every system it belongs to */
  components: (Named & { systems: Named[] })[];
  "control-loops": { name: string; description: string | null; controller: string; sensors: string[]; actuators: string[] }[];
}

export interface ComponentListing extends Named { type: string; asset: string; node: string }

export interface QuestionMeta { id: string; title: string; capability: string; explanation: string }

export interface QuestionResult extends QuestionMeta {
  summary: string;
  columns: string[];
  rows: (string | number)[][];
  /** component ids the answer is about */
  highlight: string[];
}

export interface TypeNode { type: string; parent: string | null; total: number; direct: number }

/** A type's or function's definition as the database's schema states it (not a query result). */
export interface SchemaDefinition { name: string; kind: "entity" | "relation" | "attribute" | "function"; definition: string }
export interface SchemaAnswer extends Answer<SchemaDefinition[]> { "schema-ms": number; source: string }

export interface TypeDetail {
  type: string;
  supertypes: string[];
  owns: string[];
  plays: string[];
  instances: (Named & { type: string })[];
}

export const semantic = {
  health: async () => {
    const response = await fetch(`${API}/health`).catch(() => null);
    return response?.ok === true;
  },
  components: (s?: AbortSignal) => ask<ComponentListing[]>("components", s),
  component: (c: string, s?: AbortSignal) => ask<ComponentDetails>(`components/${id(c)}`, s),
  assemblyOf: (c: string, s?: AbortSignal) => ask<ComponentAssembly>(`components/${id(c)}/assembly`, s),
  systemsOf: (c: string, s?: AbortSignal) => ask<ComponentSystem[]>(`components/${id(c)}/systems`, s),
  relationships: (c: string, s?: AbortSignal) => ask<ComponentRelationships>(`components/${id(c)}/relationships`, s),
  impact: (c: string, s?: AbortSignal) => ask<Impact>(`components/${id(c)}/impact`, s),
  requirements: (c: string, s?: AbortSignal) => ask<{ required: Requirement[] }>(`components/${id(c)}/requirements`, s),
  assembly: (a: string, s?: AbortSignal) => ask<AssemblyDetails>(`assemblies/${id(a)}`, s),
  assemblies: (s?: AbortSignal) => ask<AssemblyNode[]>("assemblies", s),
  systems: (s?: AbortSignal) => ask<SystemSummary[]>("systems", s),
  types: (s?: AbortSignal) => ask<TypeNode[]>("types", s),
  questions: (s?: AbortSignal) => ask<QuestionMeta[]>("questions", s),
  question: (q: string, s?: AbortSignal) => ask<QuestionResult>(`questions/${id(q)}`, s),
  type: (label: string, s?: AbortSignal) => ask<TypeDetail>(`types/${id(label)}`, s),
  system: (sys: string, s?: AbortSignal) => ask<SystemDetails>(`systems/${id(sys)}`, s),
  /** a type (with its supertypes) or function, from the schema TypeDB returns */
  schema: (name: string, s?: AbortSignal) => ask<SchemaDefinition[]>(`schema/${id(name)}`, s) as Promise<SchemaAnswer>,
};
