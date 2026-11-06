// Check that Apex can reach its TypeDB server, and list Apex's databases.
//
//     npm run check-connection

import { isApexDatabase } from "../src/settings.ts";
import { Connection, Unavailable } from "../src/typedb.ts";
import { loadSettings } from "./env.ts";

const settings = loadSettings();
const connection = new Connection(settings);
try {
  const names = (await connection.databases()).filter(isApexDatabase).sort();
  console.log(`Connected to TypeDB at ${settings.address}. Apex databases: ${names.join(", ") || "none yet"}.`);
} catch (error) {
  if (error instanceof Unavailable) {
    console.error(`Cannot reach TypeDB at ${settings.address}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
