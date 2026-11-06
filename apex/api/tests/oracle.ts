// Independent answer keys, computed straight from data/seed/*.yaml with plain TypeScript.
//
// Deliberately shares NO code with src/ (it reads the YAML itself and uses different
// algorithms), so a bug in the app's queries or calculations can't hide in both places.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SEED_DIR = join(ROOT, "data", "seed");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = Record<string, any>;

/** An exact decimal, kept as scaled integer text so stakes multiply without floating point. */
export class Exact {
  readonly digits: bigint;
  readonly scale: number;

  constructor(text: string | number) {
    const [i, f = ""] = String(text).split(".");
    this.digits = BigInt(i! + f);
    this.scale = f.length;
  }

  static of(digits: bigint, scale: number): Exact {
    const e = Object.create(Exact.prototype) as { digits: bigint; scale: number };
    e.digits = digits;
    e.scale = scale;
    return e as Exact;
  }

  times(o: Exact): Exact {
    return Exact.of(this.digits * o.digits, this.scale + o.scale);
  }

  plus(o: Exact): Exact {
    const s = Math.max(this.scale, o.scale);
    return Exact.of(this.digits * 10n ** BigInt(s - this.scale) + o.digits * 10n ** BigInt(s - o.scale), s);
  }

  equals(o: Exact | string | number): boolean {
    const other = o instanceof Exact ? o : new Exact(o);
    const s = Math.max(this.scale, other.scale);
    return this.digits * 10n ** BigInt(s - this.scale) === other.digits * 10n ** BigInt(s - other.scale);
  }

  /** Canonical text without trailing zeros, for sorting and messages. */
  toString(): string {
    const text = this.digits.toString().padStart(this.scale + 1, "0");
    const int = text.slice(0, text.length - this.scale);
    const frac = text.slice(text.length - this.scale).replace(/0+$/, "");
    return frac ? `${int}.${frac}` : int;
  }

  toNumber(): number {
    return Number(this.toString());
  }
}

/** Every *.yaml under data/seed, in path order (Python's sorted rglob). */
function yamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...yamlFiles(path));
    else if (name.endsWith(".yaml")) out.push(path);
  }
  return out.sort();
}

/** The YAML as a plain object: dates as "YYYY-MM-DD" text and timestamps as "YYYY-MM-DDTHH:MM:SS" text. */
function loadYaml(path: string): Rec {
  const text = readFileSync(path, "utf8").replace(/!!timestamp '([^']*)'/g, (_, t: string) => `'${t.replace(" ", "T")}'`);
  return (parse(text) as Rec) ?? {};
}

/** Every YAML file under data/seed, merged: lists concatenated, mappings combined. */
export function rawSeed(): Rec {
  const seed: Rec = {};
  for (const path of yamlFiles(SEED_DIR)) {
    for (const [key, value] of Object.entries(loadYaml(path))) {
      if (Array.isArray(value)) seed[key] = [...(seed[key] ?? []), ...value];
      else if (typeof value === "object" && value !== null && key !== "deal") seed[key] = { ...(seed[key] ?? {}), ...value };
      else seed[key] = value;
    }
  }
  return seed;
}

/** The schema as TypeDB loads it: the base file, then the numbered migrations. */
export function schemaText(): string {
  const root = join(ROOT, "schema");
  const migrations = readdirSync(join(root, "migrations")).filter((n) => /^[0-9].*\.tql$/.test(n)).sort();
  return [join(root, "schema.tql"), ...migrations.map((n) => join(root, "migrations", n))].map((p) => readFileSync(p, "utf8")).join("\n");
}

/** The holders of one RACI letter entry (a string for A, lists for the others). */
export function holders(hs: string | string[] | undefined): string[] {
  return hs === undefined ? [] : typeof hs === "string" ? [hs] : hs;
}

/**
 * Every route down from `parent`: {company: [product of stakes along each route]}.
 *
 * Depth-first enumeration of every path; throws if a company is revisited on one path (a cycle).
 */
export function ownershipRoutes(seed: Rec, parent: string): Record<string, Exact[]> {
  const children: Record<string, [string, Exact][]> = {};
  for (const own of seed.ownership) (children[own.owner] ??= []).push([own.owned, new Exact(own.stake)]);
  const routes: Record<string, Exact[]> = {};

  const walk = (company: string, product: Exact, path: string[]) => {
    for (const [child, stake] of children[company] ?? []) {
      if (path.includes(child)) throw new Error(`cycle: ${[...path, child].join(" -> ")}`);
      (routes[child] ??= []).push(product.times(stake));
      walk(child, product.times(stake), [...path, child]);
    }
  };

  walk(parent, new Exact("1"), [parent]);
  return routes;
}

export function effectiveStakes(seed: Rec, parent: string): Record<string, [Exact, number]> {
  const out: Record<string, [Exact, number]> = {};
  for (const [c, products] of Object.entries(ownershipRoutes(seed, parent))) {
    out[c] = [products.reduce((a, b) => a.plus(b), new Exact("0")), products.length];
  }
  return out;
}

// ---- Calendar days, the oracle's own way (UTC epoch days) -----------------------------------------

export function days(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
}

export function iso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function plusDays(date: string, n: number): string {
  return iso(days(date) + n);
}

export function diffDays(later: string, earlier: string): number {
  return days(later) - days(earlier);
}

/** Relax every hard dependency until nothing changes (Bellman-Ford style). Dates are ISO text. */
export function projectedDates(seed: Rec, start: string, delayDays: number): Record<string, string> {
  const items: Record<string, Rec> = {};
  for (const i of [...seed.items, ...seed.workstreams]) items[i.code] = i;
  const dates: Record<string, string> = {};
  for (const [code, it] of Object.entries(items)) dates[code] = it.due;
  const done = new Set(Object.entries(items).filter(([, it]) => it.status === "complete").map(([c]) => c));
  if (!done.has(start)) dates[start] = plusDays(dates[start]!, delayDays);
  const hard = seed.dependencies.filter((d: Rec) => d.kind === "gating" || d.kind === "sequencing");
  for (let round = 0; round <= Object.keys(items).length; round++) {
    let changed = false;
    for (const d of hard) {
      if (done.has(d.to)) continue;
      const candidate = plusDays(dates[d.from]!, d.lag);
      if (candidate > dates[d.to]!) {
        dates[d.to] = candidate;
        changed = true;
      }
    }
    if (!changed) return dates;
  }
  throw new Error("dates never settled: hard dependencies contain a cycle");
}

/** {"deadline|item": days over} for every deadline an item would miss. */
export function breachedDeadlines(seed: Rec, dates: Record<string, string>): Record<string, number> {
  const due: Record<string, string> = {};
  for (const i of seed.items) due[i.code] = i.due;
  const out: Record<string, number> = {};
  for (const dl of seed.deadline_limits) {
    if (dates[dl.item]! > due[dl.deadline]!) out[`${dl.deadline}|${dl.item}`] = diffDays(dates[dl.item]!, due[dl.deadline]!);
  }
  return out;
}

/** Python's round(): half to even. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  return x - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
}

/** Duration-weighted completion and milestone readiness, recomputed from raw YAML items (D5). */
export function derivedProgress(items: Rec[]) {
  const spans = items.filter((i) => i.type !== "deadline" && i.planned_start).map((i) => [i, diffDays(i.due, i.planned_start) + 1] as const);
  const points = items.filter((i) => i.type !== "deadline" && !i.planned_start);
  const weight = spans.reduce((s, [, d]) => s + d, 0);
  const done = spans.reduce((s, [i, d]) => s + d * (i.status === "complete" ? 100 : i.progress ?? 0), 0);
  return { percent: weight ? roundHalfEven(done / weight) : null, activities: spans.length,
    achieved: points.filter((i) => i.status === "complete").length, points: points.length };
}

// ---- Schedule float by brute force (used by the schedule and parties tests) ------------------------

/** Try every delay, day by day, until a limited item lands after its deadline; for one deadline, or any. */
export function bruteForceFloatTo(seed: Rec, code: string, onlyDeadline: string | null): number | null {
  const items: Record<string, Rec> = {};
  for (const i of seed.items) items[i.code] = i;
  for (const w of seed.workstreams) items[w.code] = { ...w, type: "workstream", workstream: null };
  const out: Record<string, Rec[]> = {};
  for (const d of seed.dependencies) if (d.kind === "sequencing" || d.kind === "gating") (out[d.from] ??= []).push(d);
  const reach = new Set([code]);
  const todo = [code];
  while (todo.length) {
    for (const d of out[todo.pop()!] ?? []) {
      if (!reach.has(d.to)) {
        reach.add(d.to);
        todo.push(d.to);
      }
    }
  }
  const limits = seed.deadline_limits.filter((l: Rec) => reach.has(l.item) && (onlyDeadline === null || onlyDeadline === l.deadline));
  if (!limits.length) return null;
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (x: string) => { // topological order over the reachable sub-graph
    if (seen.has(x)) return;
    seen.add(x);
    for (const d of out[x] ?? []) if (reach.has(d.to)) visit(d.to);
    order.push(x);
  };
  visit(code);
  order.reverse();
  for (let delay = 0; delay < 366; delay++) {
    const when: Record<string, string> = {};
    for (const x of order) {
      const base = items[x]!.due as string;
      if (items[x]!.status === "complete") {
        when[x] = base;
        continue;
      }
      when[x] = x === code ? plusDays(base, delay) : base;
      for (const d of seed.dependencies) {
        if ((d.kind === "sequencing" || d.kind === "gating") && d.to === x && d.from in when) {
          const candidate = plusDays(when[d.from]!, d.lag ?? 0);
          if (candidate > when[x]!) when[x] = candidate;
        }
      }
    }
    if (limits.some((l: Rec) => when[l.item]! > items[l.deadline]!.due)) return delay - 1;
  }
  return null;
}

export function bruteForceFloat(seed: Rec, code: string): number | null {
  return bruteForceFloatTo(seed, code, null);
}
