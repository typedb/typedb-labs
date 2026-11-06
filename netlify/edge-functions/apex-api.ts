// Netlify Edge Function: answers labs.typedb.com/apex/api/* with Project Apex's API over TypeDB Cloud.
//
// The data is read-only and changes only when the database is reseeded, so every successful answer is
// cached for a day on Netlify's CDN and served stale for a week while it refreshes. A new deploy clears
// the cache; so does purging the "apex-api" cache tag (Netlify UI or API) after a reseed.
//
// Env vars (Netlify site settings): APEX_TYPEDB_ADDRESS (https://<cluster>.cloud.typedb.com:8000),
// APEX_TYPEDB_USERNAME, APEX_TYPEDB_PASSWORD, APEX_DATABASE (default "apex").

import { handle } from "../../apex/api/src/app.ts";
import { settingsFromEnv } from "../../apex/api/src/settings.ts";
import { cached, prefixedEnv, stripPrefix } from "./shared.ts";

export const config = {
  path: "/apex/api/*",
  cache: "manual",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

export default async (request: Request) =>
  cached(await handle(stripPrefix(request, "/apex"), settingsFromEnv(prefixedEnv("APEX_"))), "apex-api");
