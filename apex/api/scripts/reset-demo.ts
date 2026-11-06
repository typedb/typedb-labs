// Rebuild the "apex-demo" database from the seed data, after a live demonstration.
//
//     npm run reset-demo
//
// Only ever touches apex-demo; the pristine "apex" database is never changed.

import { main } from "./create-database.ts";

process.exit(await main(["--name", "apex-demo", "--replace"]));
