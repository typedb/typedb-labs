// Netlify Edge Function: answers labs.typedb.com/noodlelab/api/* with the NoodleLab Visual Explorer's
// semantic API over TypeDB Cloud. Caching and env vars as in apex-api.ts, with the NOODLELAB_ prefix:
// NOODLELAB_TYPEDB_ADDRESS, NOODLELAB_TYPEDB_USERNAME, NOODLELAB_TYPEDB_PASSWORD, NOODLELAB_TYPEDB_DATABASE
// (default "vehicle"). Cache tag "noodlelab-api".

import { handle } from "../../noodlelab/api/src/app.ts";
import { settingsFromEnv } from "../../noodlelab/api/src/settings.ts";
import { cached, prefixedEnv, stripPrefix } from "./shared.ts";

export const config = {
  path: "/noodlelab/api/*",
  cache: "manual",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

export default async (request: Request) =>
  cached(await handle(stripPrefix(request, "/noodlelab"), settingsFromEnv(prefixedEnv("NOODLELAB_"))), "noodlelab-api");
