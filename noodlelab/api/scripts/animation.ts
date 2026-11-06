// Prints the explosion grouping (web/src/vehicle/explosion-groups.json) from the database: `npm run -s animation`.

import { explosionGroups, render } from "../src/animation.ts";
import { settingsFromEnv } from "../src/settings.ts";
import { Connection } from "../src/typedb.ts";

const connection = new Connection(settingsFromEnv((name) => process.env[name]));
const { result } = await connection.read(explosionGroups);
process.stdout.write(render(result));
