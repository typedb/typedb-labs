// Settings for the Node entry points (server.ts and the scripts): the environment, else a .env file in
// the repository root (copy .env.example; values already in the environment win, as before).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, settingsFromEnv, type Settings } from "../src/settings.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function dotenv(): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(join(ROOT, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Settings from the environment or .env; a configuration problem prints a plain explanation and stops. */
export function loadSettings(overrides: Partial<Settings> = {}): Settings {
  const env = dotenv();
  try {
    return { ...settingsFromEnv((name) => process.env[name] ?? env[name]), ...overrides };
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
}
