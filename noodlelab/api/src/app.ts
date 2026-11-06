// The semantic HTTP API. Read-only: every endpoint is a GET, opens only READ transactions and runs only the
// named queries in queries.ts and questions.ts. The browser never sends TypeQL and never sees credentials.
//
// Every answer has the shape {"data": ..., "typeql": [...], "timings-ms": [...], "purposes": [...],
// "result-queries": [...], "processing": [...]}: "typeql" lists the exact queries that produced it, in the order
// they ran (recorded as they ran, parameters included); "timings-ms" how long each took in TypeDB, measured to its
// last answer; "purposes" what each was for; "result-queries" the indexes of the queries whose answers are the
// components the answer is about; and "processing" the steps the API did itself with the answers.
//
// If TypeDB is unreachable, every endpoint answers 503 with {"error": "typedb-unavailable"}: there is no
// fallback data. The connection is checked on first use and checked again after a failure, so the API recovers
// by itself when TypeDB comes back.
//
// `handle` takes a web-standard Request and returns a Response, using nothing from Node or Deno, so the same
// code serves locally (server.ts) and on Netlify's edge (netlify/edge-functions/api.ts). Status codes and bodies
// match the Python/FastAPI backend this replaces, including FastAPI's 422 for an invalid id.

import * as exportModel from "./export.ts";
import { toJson } from "./json.ts";
import * as queries from "./queries.ts";
import { NotFound } from "./queries.ts";
import * as questions from "./questions.ts";
import { Connection, QueryFailed, Unavailable, type Settings, type Tx } from "./typedb.ts";
import { zip } from "./zip.ts";

// Stable ids: lower-case words separated by single hyphens (the same rule the schema enforces).
const ID = "^[a-z0-9]+(-[a-z0-9]+)*$";
// Schema names: type labels (hyphens) and function names (underscores).
const NAME = "^[a-z0-9]+([-_][a-z0-9]+)*$";
const MAX_LENGTH = 64;

export const UNAVAILABLE = "TypeDB is not reachable, so semantic information cannot be shown. The 3D model still works.";
export const QUERY_FAILED = "TypeDB could not answer this question. The API log has the details.";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(toJson(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/**
 * One shared TypeDB connection per settings, checked on first use. The HTTP driver signs in once and reuses
 * its token, as the Python backend kept one driver open.
 */
export class Database {
  readonly connection: Connection;
  private verified = false;

  constructor(settings: Settings) {
    this.connection = new Connection(settings);
  }

  get name(): string {
    return this.connection.database;
  }

  /** Makes sure TypeDB answers and has the database; throws Unavailable otherwise. Checked once, until a failure. */
  private async ensure(): Promise<void> {
    if (this.verified) return;
    let exists: boolean;
    try {
      exists = await this.connection.databaseExists();
    } catch (error) {
      console.warn("TypeDB connection failed:", (error as Error).message);
      throw new Unavailable(UNAVAILABLE);
    }
    if (!exists) throw new Unavailable(`TypeDB is running but has no '${this.name}' database. Run the seed step.`);
    this.verified = true;
  }

  /** The next request checks the connection again. */
  reset(): void {
    this.verified = false;
  }

  /**
   * The database's schema as TypeDB writes it (one `define`), and how long reading it took in ms. This is a
   * driver call, not a TypeQL query.
   */
  async schema(): Promise<[string, number]> {
    await this.ensure();
    const start = performance.now();
    try {
      const text = await this.connection.schema();
      return [text, Math.round((performance.now() - start) * 10) / 10];
    } catch (error) {
      console.warn("TypeDB schema read failed:", (error as Error).message);
      this.reset();
      throw new Unavailable(UNAVAILABLE);
    }
  }

  /** The whole model as TypeQL files (see export.ts), read from this database. */
  async model(): Promise<Record<string, string>> {
    await this.ensure();
    try {
      return (await exportModel.build(this.connection, this.name)).files;
    } catch (error) {
      console.warn("TypeDB export failed:", (error as Error).message);
      if (error instanceof Unavailable) {
        this.reset();
        throw new Unavailable(UNAVAILABLE);
      }
      throw new QueryFailed("", QUERY_FAILED);
    }
  }

  /** Runs one named question in a READ transaction; returns (answer, the recording of the queries that ran). */
  async read<T>(question: (tx: Tx) => Promise<T>): Promise<{ result: T; tx: Tx }> {
    await this.ensure();
    try {
      return await this.connection.read(question);
    } catch (error) {
      if (error instanceof NotFound) throw error;
      console.warn("TypeDB query failed:", (error as Error).message);
      // Tell a broken connection apart from a failing query: only the first is "unavailable".
      if (error instanceof Unavailable) {
        this.reset(); // the next request checks again
        throw new Unavailable(UNAVAILABLE);
      }
      throw new QueryFailed(error instanceof QueryFailed ? error.code : "", QUERY_FAILED);
    }
  }
}

// One Database per distinct settings for the life of the process (or edge isolate).
const databases = new Map<string, Database>();

export function database(settings: Settings): Database {
  const key = JSON.stringify([settings.address, settings.username, settings.password, settings.database]);
  let db = databases.get(key);
  if (!db) databases.set(key, (db = new Database(settings)));
  return db;
}

// ---- Routing ---------------------------------------------------------------------------------------------

/** FastAPI's 422 body for a path parameter that fails validation; the web app only needs the status. */
class Invalid extends Error {
  readonly detail: unknown;

  constructor(detail: unknown) {
    super("invalid parameter");
    this.detail = detail;
  }
}

function validated(param: string, input: string, pattern: string): string {
  if (input.length > MAX_LENGTH) {
    throw new Invalid([{ type: "string_too_long", loc: ["path", param], msg: `String should have at most ${MAX_LENGTH} characters`,
      input, ctx: { max_length: MAX_LENGTH } }]);
  }
  if (!new RegExp(pattern).test(input)) {
    throw new Invalid([{ type: "string_pattern_mismatch", loc: ["path", param], msg: `String should match pattern '${pattern}'`,
      input, ctx: { pattern } }]);
  }
  return input;
}

type Handler = (db: Database, params: string[]) => Promise<Response>;

interface Route {
  /** path segments after /api; a segment in braces is a parameter */
  pattern: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(path: string, handler: Handler): void {
  routes.push({ pattern: path.split("/").filter(Boolean), handler });
}

/** The standard answer: the data plus the record of the queries that produced it. */
async function answer<T>(db: Database, question: (tx: Tx) => Promise<T>): Promise<Response> {
  const { result, tx } = await db.read(question);
  return json({ data: result, typeql: tx.queries, "timings-ms": tx.timingsMs, purposes: tx.purposes,
    "result-queries": tx.results, processing: tx.processing });
}

// Ids are checked before any query runs, as FastAPI checked path parameters before calling an endpoint.
const id = (param: string, input: string) => validated(param, input, ID);

route("/health", async (db) => {
  try {
    await db.read((tx) => tx.rows("match $c isa component; limit 1;"));
    return json({ typedb: "available", database: db.name });
  } catch (error) {
    if (error instanceof Unavailable) {
      return json({ typedb: "unavailable", error: "typedb-unavailable", message: error.message }, 503);
    }
    throw error;
  }
});

route("/components", (db) => answer(db, queries.componentList));
route("/components/{component_id}", (db, [c]) => {
  const cid = id("component_id", c);
  return answer(db, (tx) => queries.component(tx, cid));
});
route("/components/{component_id}/assembly", (db, [c]) => {
  const cid = id("component_id", c);
  return answer(db, (tx) => queries.componentAssembly(tx, cid));
});
route("/components/{component_id}/systems", (db, [c]) => {
  const cid = id("component_id", c);
  return answer(db, (tx) => queries.componentSystems(tx, cid));
});
route("/components/{component_id}/relationships", (db, [c]) => {
  const cid = id("component_id", c);
  return answer(db, (tx) => queries.componentRelationships(tx, cid));
});
route("/components/{component_id}/impact", (db, [c]) => {
  const cid = id("component_id", c);
  return answer(db, (tx) => queries.componentImpact(tx, cid));
});
route("/components/{component_id}/requirements", (db, [c]) => {
  const cid = id("component_id", c);
  return answer(db, (tx) => queries.componentRequirements(tx, cid));
});
route("/assemblies", (db) => answer(db, queries.assemblyTree));
route("/types", (db) => answer(db, queries.typeHierarchy));
route("/types/{label}", (db, [l]) => {
  const typeLabel = id("label", l);
  return answer(db, (tx) => queries.typeDetail(tx, typeLabel));
});
route("/questions", async () => json({ data: questions.questionList(), typeql: [], "timings-ms": [], purposes: [], "result-queries": [],
  processing: [] }));
route("/questions/{question_id}", (db, [q]) => {
  const questionId = id("question_id", q);
  return answer(db, (tx) => questions.run(tx, questionId));
});
route("/assemblies/{assembly_id}", (db, [a]) => {
  const assemblyId = id("assembly_id", a);
  return answer(db, (tx) => queries.assembly(tx, assemblyId));
});

/**
 * A type's or function's definition (with its supertypes'), read from the database's schema. No TypeQL
 * query runs, so "typeql" is empty and "schema-ms" says how long the read took.
 */
route("/schema/{name}", async (db, [n]) => {
  const name = validated("name", n, NAME);
  const [text, ms] = await db.schema();
  return json({ data: queries.schemaDefinitions(text, name), typeql: [], "timings-ms": [], purposes: [],
    "result-queries": [], processing: ["TypeScript cuts this definition from the schema text TypeDB returns."],
    "schema-ms": ms, source: "database.schema()" });
});

/** The downloadable TypeDB model: schema.tql, data.tql and README.md, exported from the live database. */
route("/export/model.zip", async (db) => {
  const files = await db.model();
  return new Response(await zip(Object.entries(files).map(([name, text]) => [`noodlelab-vehicle-typedb-model/${name}`, text])), {
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="noodlelab-vehicle-typedb-model.zip"' },
  });
});

route("/systems", (db) => answer(db, queries.systemList));
route("/systems/{system_id}", (db, [s]) => {
  const systemId = id("system_id", s);
  return answer(db, (tx) => queries.system(tx, systemId));
});

/** Every endpoint's path, with its parameters in braces (for the tests: all of them must be read-only GETs). */
export function endpoints(): string[] {
  return routes.map((r) => "/api/" + r.pattern.join("/"));
}

function match(segments: string[]): { route: Route; params: string[] } | null {
  for (const r of routes) {
    if (r.pattern.length !== segments.length) continue;
    const params: string[] = [];
    let ok = true;
    for (let i = 0; i < segments.length && ok; i++) {
      if (r.pattern[i].startsWith("{")) params.push(segments[i]);
      else ok = r.pattern[i] === segments[i];
    }
    if (ok) return { route: r, params };
  }
  return null;
}

/** Answers one request. The same routing and error bodies as the FastAPI app, so the web app sees no change. */
export async function handle(request: Request, settings: Settings): Promise<Response> {
  const url = new URL(request.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return json({ detail: "Not Found" }, 404);
  }
  if (!path.startsWith("/api/")) return json({ detail: "Not Found" }, 404);
  const found = match(path.slice("/api".length).split("/").filter(Boolean));
  if (!found) return json({ detail: "Not Found" }, 404);
  // Like Starlette: a trailing slash redirects to the route without it.
  if (path.length > 1 && path.endsWith("/")) {
    const target = new URL(url);
    target.pathname = url.pathname.replace(/\/+$/, "");
    return new Response(null, { status: 307, headers: { location: target.toString() } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ detail: "Method Not Allowed" }, 405, { allow: "GET" });
  }
  let response: Response;
  try {
    response = await found.route.handler(database(settings), found.params);
  } catch (error) {
    if (error instanceof Invalid) response = json({ detail: error.detail }, 422);
    else if (error instanceof Unavailable) response = json({ error: "typedb-unavailable", message: error.message }, 503);
    else if (error instanceof QueryFailed) response = json({ error: "query-failed", message: error.message }, 500);
    else if (error instanceof NotFound) response = json({ error: "not-found", message: `No ${error.message} in TypeDB.` }, 404);
    else throw error;
  }
  if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
}
