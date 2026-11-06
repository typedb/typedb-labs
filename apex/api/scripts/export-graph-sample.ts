// Save the current /api/graph answer to web/.layout-sample.json (git-ignored), the input for
// web/scripts/compare-layouts.ts, which compares graph layout engines on the real data.
//
//     npm run export-graph-sample

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { handle } from "../src/app.ts";
import { loadSettings, ROOT } from "./env.ts";

const OUT = join(ROOT, "web", ".layout-sample.json");

const response = await handle(new Request("http://apex/api/graph"), loadSettings());
if (!response.ok) {
  console.error(`/api/graph answered ${response.status}: ${await response.text()}`);
  process.exit(1);
}
const body = (await response.json()) as { data: unknown };
writeFileSync(OUT, JSON.stringify(body.data));
console.log(`wrote ${OUT}`);
