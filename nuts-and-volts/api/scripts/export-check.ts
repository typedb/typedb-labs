// Checks the downloadable model against the database: `npm run export-check -- [source] [--zip FILE --loaded DATABASE]`.
// With --loaded, compares a database already loaded from that ZIP (e.g. with TypeDB Console) instead of loading one.

import { readFileSync } from "node:fs";
import { check, unzip } from "../src/export-check.ts";
import { settingsFromEnv } from "../src/settings.ts";
import { Connection } from "../src/typedb.ts";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const settings = settingsFromEnv((name) => process.env[name]);
const source = positional[0] ?? settings.database;
const connection = new Connection(settings);
const zipPath = opt("--zip");
const files = zipPath ? await unzip(new Uint8Array(readFileSync(zipPath))) : undefined;
const { problems, report } = await check(connection, source, files, opt("--loaded"));
console.log(report.join("\n"));
console.log(problems.length ? "PROBLEMS: " + problems.join("; ") : "OK: the export reproduces the database");
process.exit(problems.length ? 1 : 0);
