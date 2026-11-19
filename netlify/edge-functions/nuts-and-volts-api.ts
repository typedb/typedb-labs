// Netlify Edge Function: answers labs.typedb.com/nuts-and-volts/api/* with the Nuts & Volts lab's
// semantic API over TypeDB Cloud. Caching and env vars as in apex-api.ts, with the NUTS_AND_VOLTS_ prefix:
// NUTS_AND_VOLTS_TYPEDB_ADDRESS, NUTS_AND_VOLTS_TYPEDB_USERNAME, NUTS_AND_VOLTS_TYPEDB_PASSWORD, NUTS_AND_VOLTS_TYPEDB_DATABASE
// (default "vehicle"). Cache tag "nuts-and-volts-api".

import { handle } from "../../nuts-and-volts/api/src/app.ts";
import { settingsFromEnv } from "../../nuts-and-volts/api/src/settings.ts";
import { cached, prefixedEnv, stripPrefix } from "../lib/shared.ts";

export const config = {
  path: "/nuts-and-volts/api/*",
  cache: "manual",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

export default async (request: Request) =>
  cached(await handle(stripPrefix(request, "/nuts-and-volts"), settingsFromEnv(prefixedEnv("NUTS_AND_VOLTS_"))), "nuts-and-volts-api");
