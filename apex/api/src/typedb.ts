// Connecting to TypeDB and running queries. Everything else in the API uses this.
//
// Runtime-neutral: only web-standard APIs (fetch) through the official HTTP driver, so the same
// code runs under Node (local development, Docker) and Deno (Netlify Edge Functions).

import {
  TypeDBHttpDriver,
  isOkResponse,
  type ApiResponse,
  type Concept,
  type ConceptRow,
  type ConceptDocument,
  type QueryResponse,
} from "@typedb/driver-http";

export type { Concept, ConceptRow, ConceptDocument };

export interface Settings {
  /** `http://host:8000` or `https://host:8000` (TypeDB Cloud); a bare `host:port` is read as http. */
  address: string;
  username: string;
  password: string;
  database: string;
}

/** Normalises an address to an origin the HTTP driver accepts. */
export function origin(address: string): string {
  return /^https?:\/\//.test(address) ? address.replace(/\/+$/, "") : `http://${address}`;
}

/** TypeDB cannot be reached, or refused the login. */
export class Unavailable extends Error {}

/** TypeDB answered, but the query failed. `code` is TypeDB's error code (e.g. "TQL03"). */
export class QueryFailed extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Driver error codes that mean "could not reach a server" rather than "the server said no".
const CONNECTION_CODES = new Set(["HDR1", "HDR2"]);

function unwrap<T>(resp: ApiResponse<T>): T {
  if (isOkResponse(resp)) return resp.ok;
  if (CONNECTION_CODES.has(resp.err.code) || resp.status === 401 || resp.status === 503) {
    throw new Unavailable(resp.err.message);
  }
  throw new QueryFailed(resp.err.code, resp.err.message);
}

/** One shared driver per process (or per edge isolate): the sign-in token is reused across requests. */
export class Connection {
  readonly settings: Settings;
  private driver: TypeDBHttpDriver;

  constructor(settings: Settings) {
    this.settings = settings;
    this.driver = new TypeDBHttpDriver({
      username: settings.username,
      password: settings.password,
      addresses: [origin(settings.address)],
    });
  }

  get database(): string {
    return this.settings.database;
  }

  /** Asks the server whether the database exists. Throws Unavailable if it cannot answer. */
  async databaseExists(name = this.settings.database): Promise<boolean> {
    const resp = await this.driver.getDatabases();
    return unwrap(resp).databases.some((d) => d.name === name);
  }

  /** Every database name on the server. */
  async databases(): Promise<string[]> {
    return unwrap(await this.driver.getDatabases()).databases.map((d) => d.name);
  }

  /** The database's schema text (one `define`), as TypeDB writes it. */
  async schema(name = this.settings.database): Promise<string> {
    return unwrap(await this.driver.getDatabaseSchema(name));
  }

  async createDatabase(name: string): Promise<void> {
    unwrap(await this.driver.createDatabase(name));
  }

  async deleteDatabase(name: string): Promise<void> {
    unwrap(await this.driver.deleteDatabase(name));
  }

  /**
   * Runs `work` in one transaction of the given type and returns its result with the recording
   * transaction (the queries that ran, in order). READ transactions are closed; WRITE and SCHEMA
   * transactions are committed when `work` returns and rolled back (closed) if it throws.
   */
  async transaction<T>(
    type: "read" | "write" | "schema",
    work: (tx: Tx) => Promise<T>,
    database = this.settings.database,
  ): Promise<{ result: T; tx: Tx }> {
    const opened = unwrap(await this.driver.openTransaction(database, type, { transactionTimeoutMillis: 60_000 }));
    const tx = new Tx(this.driver, opened.transactionId);
    try {
      const result = await work(tx);
      if (type === "read") await this.driver.closeTransaction(tx.id);
      else unwrap(await this.driver.commitTransaction(tx.id));
      return { result, tx };
    } catch (error) {
      await this.driver.closeTransaction(tx.id).catch(() => undefined);
      throw error;
    }
  }

  read<T>(work: (tx: Tx) => Promise<T>, database?: string): Promise<{ result: T; tx: Tx }> {
    return this.transaction("read", work, database);
  }

  /** Opens a transaction the caller closes itself (tests run a write and then discard it, never committing). */
  async open(type: "read" | "write" | "schema", database = this.settings.database): Promise<Tx> {
    const opened = unwrap(await this.driver.openTransaction(database, type, { transactionTimeoutMillis: 60_000 }));
    return new Tx(this.driver, opened.transactionId);
  }
}

/**
 * An open transaction that remembers every query run through it, in order, so each API answer can
 * carry the exact TypeQL that produced it (parameters included), never a hand-kept copy.
 */
export class Tx {
  readonly queries: string[] = [];
  /** one per query, in the same order: time to the last answer, in ms */
  readonly timingsMs: number[] = [];
  /** one per query: what it is for (or null) */
  readonly purposes: (string | null)[] = [];
  /** indexes of the queries whose answers are the things an answer is about */
  readonly results: number[] = [];
  /** steps the API did itself, in TypeScript, after TypeDB answered */
  readonly processing: string[] = [];

  readonly id: string;
  private driver: TypeDBHttpDriver;

  constructor(driver: TypeDBHttpDriver, id: string) {
    this.driver = driver;
    this.id = id;
  }

  /** Runs a query and returns the raw response. Records the query text (dedented, trimmed). */
  async run(query: string, purpose: string | null = null, result = false): Promise<QueryResponse> {
    this.queries.push(dedent(query));
    const started = performance.now();
    const resp = unwrap(await this.driver.query(this.id, query, { includeQueryStructure: false }));
    this.timingsMs.push(Math.round((performance.now() - started) * 10) / 10);
    this.purposes.push(purpose);
    if (result) this.results.push(this.queries.length - 1);
    return resp;
  }

  /** Runs a fetch query; returns the JSON-like documents (untyped by default: the shape is the query's). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async docs<T = Record<string, any>>(query: string, purpose?: string | null, result?: boolean): Promise<T[]> {
    const resp = await this.run(query, purpose, result);
    if (resp.answerType === "ok") return [];
    if (resp.answerType !== "conceptDocuments") throw new Error(`expected documents, got ${resp.answerType}`);
    return resp.answers as T[];
  }

  /** Runs a match/reduce query; returns the answer rows (variable name -> concept). */
  async rows(query: string, purpose?: string | null, result?: boolean): Promise<ConceptRow[]> {
    const resp = await this.run(query, purpose, result);
    if (resp.answerType === "ok") return [];
    if (resp.answerType !== "conceptRows") throw new Error(`expected rows, got ${resp.answerType}`);
    return resp.answers.map((a) => a.data);
  }

  /** Notes a step the API does itself with the answers, after TypeDB has answered. */
  note(text: string): void {
    this.processing.push(text);
  }

  /** Closes without committing (anything written is discarded). */
  async close(): Promise<void> {
    await this.driver.closeTransaction(this.id).catch(() => undefined);
  }
}

/** Removes common leading indentation and surrounding blank lines (Python's textwrap.dedent + strip). */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(common)).join("\n").trim();
}

// Writing values into TypeQL

/** Writes a string as a TypeQL string literal, escaping characters that would break it. Always use this. */
export function string(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** Writes a decimal as a TypeQL decimal literal, e.g. "0.7" -> 0.7dec. */
export function decimalLiteral(value: string | number): string {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`not a finite decimal: ${text}`);
  return (text.includes(".") ? text : `${text}.0`) + "dec";
}

// Reading values out of answers.
// Value encodings (TypeDB 3.14.1 HTTP API, checked against a live server): string -> string;
// integer -> number; double -> number; boolean -> boolean; decimal -> "0.6dec" (string);
// date -> "2026-10-26"; datetime -> "2026-05-18T09:00:00.000000000"; the same encodings appear in
// fetch documents (where a decimal is also a "…dec" string).

/** The value of a value or attribute concept in a row. */
export function value<T = unknown>(row: ConceptRow, variable: string): T {
  const c = row[variable];
  if (!c || !("value" in c)) throw new Error(`variable $${variable} is not a value or attribute`);
  return c.value as T;
}

/** The type label of a type concept (or of an instance's type) in a row. */
export function label(row: ConceptRow, variable: string): string {
  const c = row[variable];
  if (!c) throw new Error(`variable $${variable} is unbound`);
  if ("label" in c) return c.label;
  if ("type" in c) return c.type.label;
  throw new Error(`variable $${variable} has no type label`);
}

/** The iid of an entity, relation or attribute in a row. */
export function iid(row: ConceptRow, variable: string): string {
  const c = row[variable];
  if (!c || !("iid" in c)) throw new Error(`variable $${variable} has no iid`);
  return c.iid;
}

/** Strips the "dec" suffix TypeDB puts on decimals (e.g. "0.6dec" -> "0.6"); numbers pass through as text. */
export function decimalText(raw: unknown): string {
  const text = String(raw);
  return text.endsWith("dec") ? text.slice(0, -3) : text;
}
