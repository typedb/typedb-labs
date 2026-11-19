// Connection settings from the environment. The defaults are TypeDB's own for a local server
// (compose.yaml binds it to 127.0.0.1, so only this computer can reach it).

import type { Settings } from "./typedb.ts";

export type { Settings };

/**
 * Reads the settings through `get` (process.env locally, Netlify.env on the edge), so this file needs no
 * runtime of its own. Like the Python settings, nothing is validated here: a wrong address shows up as
 * "TypeDB unavailable" on the first request.
 *
 * The default address is the HTTP port (8004 on this computer; 8000 inside Docker), not the gRPC port 1733
 * the Python backend used: this backend talks to TypeDB over its HTTP API, which is what lets the same code
 * run on Netlify's edge. TypeDB Studio still uses either port.
 */
export function settingsFromEnv(get: (name: string) => string | undefined): Settings {
  return {
    address: get("TYPEDB_ADDRESS") ?? "127.0.0.1:8004",
    username: get("TYPEDB_USERNAME") ?? "admin",
    password: get("TYPEDB_PASSWORD") ?? "password",
    database: get("TYPEDB_DATABASE") ?? "vehicle",
  };
}
