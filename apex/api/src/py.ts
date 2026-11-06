// Small helpers that reproduce the Python semantics the original backend relied on, so answers come
// out byte for byte the same: codepoint string order, tuple-key sorting, banker's rounding, calendar
// date arithmetic without time zones, and strftime's "%d %b %Y".

export type Key = string | number | boolean | null | undefined | Key[];

/** Python's comparison for the sort keys used here: strings by code point, numbers, booleans, lists item by item. */
export function cmp(a: Key, b: Key): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "string" && typeof b === "string") return cmpStr(a, b);
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (a == null && b == null) return 0;
  throw new Error(`cannot compare ${JSON.stringify(a)} with ${JSON.stringify(b)}`);
}

function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

/** Python's sorted(): a stable sort on a key, the input left untouched. */
export function sorted<T>(items: Iterable<T>, key: (item: T) => Key = (item) => item as unknown as Key, reverse = false): T[] {
  const out = [...items];
  out.sort((a, b) => (reverse ? -1 : 1) * cmp(key(a), key(b)));
  return out;
}

/** Python's sorted(set(...)) over strings. */
export function sortedUnique(items: Iterable<string>): string[] {
  return sorted(new Set(items));
}

/** Python's max()/min() on a key; `fallback` plays the part of default=. */
export function maxBy<T>(items: Iterable<T>, key: (item: T) => Key): T | undefined {
  let best: T | undefined;
  let bestKey: Key | undefined;
  let first = true;
  for (const item of items) {
    const k = key(item);
    if (first || cmp(k, bestKey!) > 0) {
      best = item;
      bestKey = k;
      first = false;
    }
  }
  return best;
}

export function minBy<T>(items: Iterable<T>, key: (item: T) => Key): T | undefined {
  let best: T | undefined;
  let bestKey: Key | undefined;
  let first = true;
  for (const item of items) {
    const k = key(item);
    if (first || cmp(k, bestKey!) < 0) {
      best = item;
      bestKey = k;
      first = false;
    }
  }
  return best;
}

/** Python's round(x): to the nearest whole number, ties to the even one. */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

/** Python's round(x, places) for a float: exact decimal rounding (ties are not reachable with these inputs). */
export function pyRoundTo(x: number, places: number): number {
  return Number(x.toFixed(places));
}

/** Python's "%g" for a float: six significant digits, trailing zeros dropped. */
export function formatG(x: number): string {
  return String(Number(x.toPrecision(6)));
}

// ---- Calendar dates (YYYY-MM-DD text), with no time zone anywhere -------------------------------

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for an ISO date (a datetime's date part is used). */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) throw new Error(`not a date: ${iso}`);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** (later - earlier).days for two ISO dates. */
export function daysBetween(later: string, earlier: string): number {
  return dayNumber(later) - dayNumber(earlier);
}

export function addDays(iso: string, days: number): string {
  return isoDate(dayNumber(iso) + days);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** strftime("%d %b"): "26 Oct". */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

/** strftime("%d %b %Y"): "26 Oct 2026". */
export function dayMonthYear(iso: string): string {
  return `${dayMonth(iso)} ${iso.slice(0, 4)}`;
}

/** Python's datetime.isoformat() for the datetimes TypeDB returns ("...T09:00:00.000000000" -> "...T09:00:00"). */
export function isoDateTime(value: string): string {
  const [whole, frac = ""] = value.split(".");
  const micros = frac.slice(0, 6).replace(/0+$/, "");
  return micros ? `${whole}.${frac.slice(0, 6)}` : whole;
}

/** Python's f"{n} {word}" + "s" unless n == 1. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Counts the items a predicate holds for (Python's sum over booleans). */
export function count<T>(items: Iterable<T>, test: (item: T) => boolean): number {
  let n = 0;
  for (const item of items) if (test(item)) n++;
  return n;
}

/** Python's dict(sorted(d.items())): the same keys in code-point order. */
export function sortedObject<T>(entries: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of sorted(Object.keys(entries))) out[k] = entries[k]!;
  return out;
}

// ---- JSON as Python wrote it --------------------------------------------------------------------

const FLOAT_MARK = "__pyfloat__";

/** A number that Python held as a float, so "1.0" stays "1.0" in the JSON (JSON.stringify would write 1). */
export class PyFloat {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  toJSON(): string {
    return `${FLOAT_MARK}${this.value}${FLOAT_MARK}`;
  }
}

/** JSON text with every PyFloat written as Python's repr of a float. */
export function jsonText(body: unknown): string {
  return JSON.stringify(body).replace(new RegExp(`"${FLOAT_MARK}(-?[0-9.eE+-]+|NaN|Infinity|-Infinity)${FLOAT_MARK}"`, "g"),
    (_, n: string) => (/^-?\d+$/.test(n) ? `${n}.0` : n));
}
