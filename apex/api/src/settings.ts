// Apex settings, read from environment variables. Every setting is checked when it is loaded, so a
// mistake stops the program straight away with a message that names the setting.
//
// Runtime-neutral: the caller passes a getter (process.env under Node, Netlify.env.get at the edge).
// A local .env file is read by server.ts (Node), never here.

// The databases Apex is allowed to create, replace or delete. Anything else on the server is
// never touched. Tests use throwaway apex-test-* databases.
export const PRISTINE_DATABASE = "apex";
export const DEMO_DATABASE = "apex-demo";
export const TEST_PREFIX = "apex-test-";

// host:port of TypeDB's HTTP endpoint, or a full http:// or https:// origin (TypeDB Cloud).
const ADDRESS = /^(?:https?:\/\/)?[A-Za-z0-9.\-]+:\d{1,5}\/?$/;

export interface Settings {
  address: string;
  username: string;
  password: string;
  database: string;
}

/** The configuration is missing or invalid. The message says what to change. */
export class ConfigError extends Error {}

/** True only for the database names Apex owns. */
export function isApexDatabase(name: string): boolean {
  return name === PRISTINE_DATABASE || name === DEMO_DATABASE || new RegExp(`^${TEST_PREFIX}[a-z0-9-]{1,40}$`).test(name);
}

/**
 * Reads TYPEDB_ADDRESS, TYPEDB_USERNAME, TYPEDB_PASSWORD and APEX_DATABASE through `get`. The local
 * default is TypeDB's HTTP port as compose.yaml publishes it (8003, not the gRPC port 1732 the
 * Python backend used: the HTTP driver talks to the same port TypeDB Studio does).
 */
export function settingsFromEnv(get: (name: string) => string | undefined): Settings {
  const problems: string[] = [];
  const address = get("TYPEDB_ADDRESS") || "127.0.0.1:8003";
  if (!ADDRESS.test(address) || !portOk(address)) {
    problems.push("TYPEDB_ADDRESS: must look like host:port (the HTTP port, for example 127.0.0.1:8003) or an http(s):// origin");
  }
  const username = get("TYPEDB_USERNAME") ?? "admin";
  if (!username) problems.push("TYPEDB_USERNAME: must not be empty");
  const password = get("TYPEDB_PASSWORD") ?? "password";
  const database = get("APEX_DATABASE") || PRISTINE_DATABASE;
  if (!isApexDatabase(database)) {
    problems.push(`APEX_DATABASE: must be '${PRISTINE_DATABASE}', '${DEMO_DATABASE}' or ${TEST_PREFIX}...`);
  }
  if (problems.length) {
    throw new ConfigError(`Invalid settings (${problems.join("; ")}). Check your .env file (see .env.example).`);
  }
  return { address, username, password, database };
}

function portOk(address: string): boolean {
  const port = Number(address.replace(/\/$/, "").split(":").pop());
  return port > 0 && port < 65536;
}
