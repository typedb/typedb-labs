// Independent answers worked out from the seed files with different algorithms from the backend's, so the tests
// can tell whether TypeDB (and the queries and functions) agree with the data as written.

import { readSeed, validate, type Entry } from "../src/seed.ts";

export const SEED = readSeed();
export const RESOLVED = validate(SEED);
export const DEPS: Entry[] = RESOLVED.dependencies;
export const IDS: string[] = SEED.components.map((c) => c.id);
export const COMPONENTS = new Map<string, Entry>(SEED.components.map((c) => [c.id, c]));
export const PARENT = new Map<string, string | null>(SEED.assemblies.map((a) => [a.id, a.parent]));
export const CORNERS = ["fl", "fr", "rl", "rr"] as const;

/** A (component, function) pair as one string, so it can live in a Set. */
export const pair = (component: string, fn: string) => `${component} | ${fn}`;
export const triple = (component: string, fn: string, backup: string) => `${component} | ${fn} | ${backup}`;

export function assemblyChain(assemblyId: string): string[] {
  const chain = [assemblyId];
  while (PARENT.get(chain[chain.length - 1])) chain.push(PARENT.get(chain[chain.length - 1])!);
  return chain;
}

/** {(component, function): "lost" | "degraded"} when `start` fails (the start's own functions excluded). */
export function oracle(start: string): Map<string, "lost" | "degraded"> {
  const state = new Map<string, "lost" | "degraded">();
  for (;;) {
    let changed = false;
    for (const d of DEPS) {
      const provided = d.provider === start ? "lost" : state.get(pair(d.provider, d.needs));
      let result: "lost" | "degraded";
      if (provided === "lost") {
        if (d.loss === "degraded") result = "degraded";
        else {
          const backup: string | undefined = d.fallback?.backup;
          const available = backup !== undefined && backup !== start
            && ![...state].some(([k, v]) => k.startsWith(`${backup} | `) && v === "lost");
          result = available ? "degraded" : "lost";
        }
      } else if (provided === "degraded" && d.degradation) {
        result = d.degradation;
      } else continue;
      const key = pair(d.dependent, d.function);
      if (d.dependent === start) continue;
      if (state.get(key) !== "lost" && state.get(key) !== result) {
        state.set(key, state.get(key) === "lost" || result === "lost" ? "lost" : result);
        changed = true;
      }
    }
    if (!changed) return state;
  }
}
