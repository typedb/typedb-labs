// The Apex HTTP API. Read-only: every endpoint is a GET and opens only READ transactions.
//
// The React frontend talks only to this. Each answer carries the exact TypeQL that produced it
// (recorded as it ran, parameters included), so the "Show TypeQL" drawer is always the truth.
//
// Runtime-neutral: handle(request, settings) uses only web-standard Request and Response, so the same
// code serves under Node (server.ts) and on Netlify's edge (netlify/edge-functions/api.ts). This is the
// one place HTTP concerns live: routes, parameter checks, status codes and the response envelope.
// Status codes and error bodies match the FastAPI original, so the frontend sees no difference.
//
// The database connection is opened on first use, so the API starts (and /api/health explains the
// problem) even while TypeDB is still starting or unreachable; a broken connection is dropped and
// reopened on the next request.

import * as advantage from "./advantage.ts";
import * as analyst from "./analyst.ts";
import * as capabilities from "./capabilities.ts";
import * as connections from "./connections.ts";
import * as engagement from "./engagement.ts";
import * as explorer from "./explorer.ts";
import * as guide from "./guide.ts";
import * as impact from "./impact.ts";
import * as overview from "./overview.ts";
import * as partyPages from "./parties.ts";
import * as queries from "./queries.ts";
import * as schedule from "./schedule.ts";
import * as workstreams from "./workstreams.ts";
import { jsonText, pyRoundTo, sorted } from "./py.ts";
import type { Settings } from "./settings.ts";
import { Connection, QueryFailed, string, Unavailable, type Tx } from "./typedb.ts";

// The same pattern the seed validator enforces for every code.
export const CODE = /^[A-Z]{2,5}-[A-Z0-9]+(-[A-Z0-9]+)*$/;
const CODE_TEXT = "^[A-Z]{2,5}-[A-Z0-9]+(-[A-Z0-9]+)*$";
const KEY = /^[a-z-]{3,40}$/;
const KEY_TEXT = "^[a-z-]{3,40}$";

export const UNAVAILABLE = "The database is not reachable. Check that TypeDB is running (docker compose ps).";
export const LOGIN_REFUSED = "TypeDB refused the login. Check TYPEDB_USERNAME and TYPEDB_PASSWORD in .env.";
export const QUERY_FAILED = "The database could not answer this question. The server log has the details.";
const CREATE_HINT = "npm run create-database (in api/)";

type Json = Record<string, unknown> | unknown[];

class HttpError extends Error {
  readonly status: number;
  readonly body: Json;

  constructor(status: number, body: Json | string) {
    super(typeof body === "string" ? body : JSON.stringify(body));
    this.status = status;
    this.body = typeof body === "string" ? { detail: body } : body;
  }
}

class DatabaseMissing extends Error {}

/** A safe, plain explanation of a connection failure (never the raw driver message). */
function explain(error: unknown): string {
  if (error instanceof DatabaseMissing) return error.message;
  return error instanceof Error && error.message.includes("AUT1") ? LOGIN_REFUSED : UNAVAILABLE;
}

// ---- One shared connection per process, keyed by its settings ----------------------------------

interface Shared {
  connection: Connection;
  /** The database was seen to exist on this connection; reset when anything fails. */
  verified: boolean;
}

const shared = new Map<string, Shared>();

function connectionFor(settings: Settings): Shared {
  const key = JSON.stringify([settings.address, settings.username, settings.password, settings.database]);
  let found = shared.get(key);
  if (!found) {
    found = { connection: new Connection(settings), verified: false };
    shared.set(key, found);
  }
  return found;
}

/** Forgets every connection (tests use it between settings). */
export function resetConnections(): void {
  shared.clear();
}

/** Asks the server whether the database exists; throws DatabaseMissing or Unavailable. */
async function verify(s: Shared): Promise<void> {
  if (s.verified) return;
  if (!(await s.connection.databaseExists())) {
    throw new DatabaseMissing(`The database '${s.connection.database}' doesn't exist yet. Create it with: ${CREATE_HINT}`);
  }
  s.verified = true;
}

async function reachable(s: Shared): Promise<boolean> {
  try {
    return await s.connection.databaseExists();
  } catch {
    return false;
  }
}

// ---- Parameter checking, with FastAPI's error bodies -------------------------------------------

type Loc = ["query" | "path", string, ...number[]];

interface Problem {
  type: string;
  loc: Loc;
  msg: string;
  input: unknown;
  ctx?: Record<string, unknown>;
}

class Params {
  readonly problems: Problem[] = [];
  private readonly query: URLSearchParams;

  constructor(query: URLSearchParams) {
    this.query = query;
  }

  private last(name: string): string | undefined {
    const all = this.query.getAll(name);
    return all.length ? all[all.length - 1] : undefined;
  }

  /** A string query parameter checked against a pattern; `required` gives "Field required" when absent. */
  pattern(name: string, pattern: RegExp, text: string, required: boolean): string | null {
    const raw = this.last(name);
    if (raw === undefined) {
      if (required) this.problems.push({ type: "missing", loc: ["query", name], msg: "Field required", input: null });
      return null;
    }
    if (!pattern.test(raw)) {
      this.problems.push({ type: "string_pattern_mismatch", loc: ["query", name], msg: `String should match pattern '${text}'`, input: raw, ctx: { pattern: text } });
      return null;
    }
    return raw;
  }

  /** An integer query parameter with bounds, or its default. */
  int(name: string, fallback: number, ge: number, le: number): number {
    const raw = this.last(name);
    if (raw === undefined) return fallback;
    const n = parseInt_(raw);
    if (n === null) {
      this.problems.push({ type: "int_parsing", loc: ["query", name], msg: "Input should be a valid integer, unable to parse string as an integer", input: raw });
      return fallback;
    }
    if (n < ge) {
      this.problems.push({ type: "greater_than_equal", loc: ["query", name], msg: `Input should be greater than or equal to ${ge}`, input: raw, ctx: { ge } });
      return fallback;
    }
    if (n > le) {
      this.problems.push({ type: "less_than_equal", loc: ["query", name], msg: `Input should be less than or equal to ${le}`, input: raw, ctx: { le } });
      return fallback;
    }
    return n;
  }

  bool(name: string, fallback: boolean): boolean {
    const raw = this.last(name);
    if (raw === undefined) return fallback;
    const v = raw.trim().toLowerCase();
    if (["1", "true", "t", "yes", "y", "on"].includes(v)) return true;
    if (["0", "false", "f", "no", "n", "off"].includes(v)) return false;
    this.problems.push({ type: "bool_parsing", loc: ["query", name], msg: "Input should be a valid boolean, unable to interpret input", input: raw });
    return fallback;
  }

  /** A repeatable parameter restricted to the given words (a list, or null when absent). */
  choices(name: string, allowed: string[]): string[] | null {
    const all = this.query.getAll(name);
    if (!all.length) return null;
    const expected = allowed.map((a) => `'${a}'`).join(", ").replace(/, ([^,]*)$/, " or $1");
    all.forEach((v, i) => {
      if (!allowed.includes(v)) {
        this.problems.push({ type: "literal_error", loc: ["query", name, i], msg: `Input should be ${expected}`, input: v, ctx: { expected } });
      }
    });
    return all;
  }

  /** Stops with 422 if any parameter was wrong. */
  check(): void {
    if (this.problems.length) throw new HttpError(422, { detail: this.problems });
  }
}

/** pydantic's lenient integer reading of a query string: digits, with surrounding spaces or a ".0" allowed. */
function parseInt_(raw: string): number | null {
  const text = raw.trim();
  if (/^[+-]?\d+$/.test(text)) return Number(text);
  if (/^[+-]?\d+\.0*$/.test(text)) return Number(text.split(".")[0]);
  return null;
}

function pathParam(name: string, raw: string, pattern: RegExp, text: string): string {
  const decoded = decodeURIComponent(raw);
  if (!pattern.test(decoded)) {
    throw new HttpError(422, { detail: [{ type: "string_pattern_mismatch", loc: ["path", name], msg: `String should match pattern '${text}'`, input: decoded, ctx: { pattern: text } }] });
  }
  return decoded;
}

// ---- The handler ---------------------------------------------------------------------------------

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(jsonText(body), { status, headers: { "content-type": "application/json", ...headers } });
}

type Work<T> = (tx: Tx) => Promise<T>;
type Parameters = Record<string, string | number | string[]>;

/**
 * Serves one request. Every answer is {data, typeql, parameters, database, elapsed_ms, capabilities,
 * query_capabilities}; errors are {detail: ...} with the same statuses as before (404 unknown code,
 * 422 bad parameter, 409 ownership guards, 503 TypeDB unreachable, 500 query failed).
 */
export async function handle(request: Request, settings: Settings): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const route = match(path);
  if (!route) {
    // A trailing slash is redirected to the route without it, as the original did.
    if (path.endsWith("/") && match(path.slice(0, -1))) {
      return new Response(null, { status: 307, headers: { location: path.slice(0, -1) + url.search } });
    }
    return json({ detail: "Not Found" }, 404);
  }
  if (request.method !== "GET") return json({ detail: "Method Not Allowed" }, 405, { allow: "GET" });
  try {
    return await dispatch(route, url.searchParams, connectionFor(settings));
  } catch (error) {
    if (error instanceof HttpError) return json(error.body, error.status);
    throw error;
  }
}

async function dispatch(route: Route, searchParams: URLSearchParams, db: Shared): Promise<Response> {
  const params = new Params(searchParams);

  /** Run work(tx) in one READ transaction and wrap the result with its TypeQL. */
  const answer = async <T>(work: Work<T>, parameters: Parameters = {}): Promise<Response> => {
    for (const attempt of [1, 2]) {
      try {
        await verify(db);
      } catch (error) {
        db.verified = false;
        console.warn(`TypeDB unavailable: ${explain(error)}`);
        return json({ detail: explain(error) }, 503);
      }
      const started = performance.now();
      let data: T;
      let tx: Tx;
      try {
        ({ result: data, tx } = await db.connection.read(work));
      } catch (error) {
        if (error instanceof HttpError) return json(error.body, error.status);
        if (error instanceof queries.NoDealError) {
          return json({ detail: `${error.message}. Rebuild it with: ${CREATE_HINT} -- --replace` }, 503);
        }
        if (error instanceof explorer.OwnershipRoutesMismatch) {
          return json({ detail: `Ownership routes don't match TypeDB's figures: ${error.message}`, cycles: [], over_owned: {}, typeql: error.typeql }, 409);
        }
        if (error instanceof queries.OwnershipDataError) {
          // Effective stakes would be misleading, so none are returned: only the problem, and the
          // guard queries that found it.
          const over: Record<string, string> = {};
          for (const [c, t] of Object.entries(error.problems.over_owned)) over[c] = t.toPlainString();
          return json({ detail: error.message, cycles: error.problems.cycles, over_owned: over, typeql: error.typeql }, 409);
        }
        if (error instanceof Unavailable || (attempt === 1 && !(await reachable(db)))) {
          db.verified = false;
          if (attempt === 1) {
            console.warn(`TypeDB connection lost, reconnecting: ${error instanceof Error ? error.constructor.name : error}`);
            continue;
          }
          return json({ detail: explain(error) }, 503);
        }
        console.error("query failed", error instanceof QueryFailed ? `${error.code}: ${error.message}` : error);
        return json({ detail: QUERY_FAILED }, 500);
      }
      return json({ data, typeql: tx.queries, parameters, database: db.connection.database,
        elapsed_ms: pyRoundTo(performance.now() - started, 1),
        capabilities: capabilities.detect(tx.queries),
        query_capabilities: tx.queries.map((q) => capabilities.detect([q])) });
    }
    return json({ detail: UNAVAILABLE }, 503);
  };

  switch (route.name) {
    case "health": {
      try {
        if (!(await reachable(db))) throw new Error("TypeDB did not answer"); // ask the server, not just the cache
      } catch (error) {
        db.verified = false;
        return json({ status: "unavailable", database: db.connection.database, detail: explain(error) }, 503);
      }
      return json({ status: "ok", database: db.connection.database, detail: null });
    }
    case "deal":
      return answer(overview.summary);
    case "milestones": {
      const criticality = params.choices("criticality", queries.CRITICALITIES);
      params.check();
      return answer((tx) => overview.milestones(tx, criticality), criticality ? { criticality } : {});
    }
    case "approvals":
      return answer(queries.approvals);
    case "activity": {
      const limit = params.int("limit", 10, 1, 50);
      params.check();
      return answer((tx) => queries.activity(tx, limit), { limit });
    }
    case "parties":
      return answer(queries.parties);
    case "progress":
      return answer((tx) => queries.workstreams(tx));
    case "raci": {
      const workstream = params.pattern("workstream", CODE, CODE_TEXT, true);
      params.check();
      return answer(async (tx) => {
        const found = await queries.raci(tx, workstream!);
        if (found === null) throw new HttpError(404, `No workstream with code ${workstream}.`);
        return found;
      }, { workstream: workstream! });
    }
    case "checks":
      return answer(overview.checks);
    case "ownership": {
      const parent = params.pattern("parent", CODE, CODE_TEXT, false);
      params.check();
      return answer(async (tx) => {
        if (parent && !(await tx.rows(`match $p isa company, has code ${string(parent)};`)).length) {
          throw new HttpError(404, `No company with code ${parent}.`);
        }
        try {
          return await explorer.ownership(tx, parent);
        } catch (error) {
          if (error instanceof queries.OwnershipDataError || error instanceof explorer.OwnershipRoutesMismatch) error.typeql = [...tx.queries];
          throw error;
        }
      }, parent ? { parent } : {});
    }
    case "graph":
      return answer(explorer.graph);
    case "graph-node": {
      const code = pathParam("code", route.arg!, CODE, CODE_TEXT);
      return answer(async (tx) => {
        const found = await explorer.node(tx, code);
        if (found === null) throw new HttpError(404, `No organisation or person with code ${code}.`);
        return found;
      }, { code });
    }
    case "schedule":
      return answer(schedule.schedule);
    case "item": {
      const code = pathParam("code", route.arg!, CODE, CODE_TEXT);
      return answer(async (tx) => {
        const found = await schedule.item(tx, code);
        if (found === null) throw new HttpError(404, `No work item with code ${code}.`);
        return found;
      }, { code });
    }
    case "workstreams":
      return answer(workstreams.summaries);
    case "workstream": {
      const code = pathParam("code", route.arg!, CODE, CODE_TEXT);
      return answer(async (tx) => {
        const found = await workstreams.detail(tx, code);
        if (found === null) throw new HttpError(404, `No workstream with code ${code}.`);
        return found;
      }, { code });
    }
    case "register":
      return answer(partyPages.register);
    case "party": {
      const code = pathParam("code", route.arg!, CODE, CODE_TEXT);
      return answer(async (tx) => {
        const found = await partyPages.profile(tx, code);
        if (found === null) throw new HttpError(404, `No person or organisation with code ${code}.`);
        return found;
      }, { code });
    }
    case "engagement-policy":
      return json({ data: engagement.policy(), source: "config/engagement-policy.yaml" });
    case "connectables":
      return answer(async (tx) => {
        const things = await queries.connectables(tx);
        return sorted(Object.keys(things).map((c) => connections.node(things, c)), (n) => [n.kind, n.name || ""]);
      });
    case "connections": {
      const source = params.pattern("from", CODE, CODE_TEXT, true);
      const to = params.pattern("to", CODE, CODE_TEXT, true);
      const maxHops = params.int("max_hops", 3, 1, 3);
      const results = params.int("results", 20, 1, 50);
      const activity = params.bool("activity", true);
      const ws = params.bool("workstreams", false);
      params.check();
      return answer(async (tx) => {
        try {
          return await connections.find(tx, source!, to!, maxHops, results, activity, ws);
        } catch (error) {
          if (error instanceof connections.UnknownCode) throw new HttpError(404, `Nothing with code ${error.message} can be connected.`);
          if (error instanceof connections.BadOption) throw new HttpError(422, error.message);
          throw error;
        }
      }, { from: source!, to: to!, max_hops: maxHops, results, activity: String(activity), workstreams: String(ws) });
    }
    case "advantage":
      return answer(advantage.advantage);
    case "analyst": {
      const key = pathParam("key", route.arg!, KEY, KEY_TEXT);
      return answer(async (tx) => {
        try {
          return await analyst.run(tx, key);
        } catch (error) {
          if (error instanceof analyst.UnknownInvestigation) throw new HttpError(404, `No investigation called ${key}.`);
          throw error;
        }
      }, { key });
    }
    case "guide":
      return json({ data: guide.guide() });
    case "impact": {
      const item = params.pattern("item", CODE, CODE_TEXT, false);
      const delayDays = params.int("delay_days", 0, 0, impact.MAX_DELAY_DAYS);
      params.check();
      return answer(async (tx) => {
        const code = item || (await impact.defaultSubject(tx));
        if (code === null) throw new HttpError(404, "No open condition to simulate.");
        let result;
        try {
          result = await impact.scenario(tx, code, delayDays);
        } catch (error) {
          if (error instanceof impact.NotFound) throw new HttpError(404, `No work item with code ${code}.`);
          throw error;
        }
        const subjects = (await queries.conditions(tx)).filter((c) => c.status !== "complete")
          .map((c) => ({ code: c.code, name: c.name, status: c.status, type: c.type ?? null }));
        return { ...result, subjects };
      }, { ...(item ? { item } : {}), delay_days: delayDays });
    }
    default:
      return json({ detail: "Not Found" }, 404);
  }
}

interface Route {
  name: string;
  arg?: string;
}

const FIXED: Record<string, string> = {
  "/api/health": "health", "/api/deal": "deal", "/api/milestones": "milestones", "/api/approvals": "approvals",
  "/api/activity": "activity", "/api/parties": "parties", "/api/progress": "progress", "/api/raci": "raci",
  "/api/checks": "checks", "/api/ownership": "ownership", "/api/graph": "graph", "/api/schedule": "schedule",
  "/api/workstreams": "workstreams", "/api/register": "register", "/api/engagement-policy": "engagement-policy",
  "/api/connectables": "connectables", "/api/connections": "connections", "/api/advantage": "advantage",
  "/api/guide": "guide", "/api/impact": "impact",
};

const WITH_ARG: [RegExp, string][] = [
  [/^\/api\/graph\/node\/([^/]+)$/, "graph-node"], [/^\/api\/items\/([^/]+)$/, "item"],
  [/^\/api\/workstreams\/([^/]+)$/, "workstream"], [/^\/api\/parties\/([^/]+)$/, "party"], [/^\/api\/analyst\/([^/]+)$/, "analyst"],
];

/** The endpoints, all GET; every other path is 404 and every other method 405. */
export function match(path: string): Route | null {
  if (path in FIXED) return { name: FIXED[path]! };
  for (const [pattern, name] of WITH_ARG) {
    const m = pattern.exec(path);
    if (m) return { name, arg: m[1] };
  }
  return null;
}

/** The routes, for tests that check the API is read-only. */
export const ROUTES = [...Object.keys(FIXED), ...WITH_ARG.map(([p]) => p.source)];
