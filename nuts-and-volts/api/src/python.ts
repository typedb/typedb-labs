// Small helpers that make the port behave like the Python it replaces: Python-style sorting by key
// tuples, and Python's text for values in messages.

/** Compares two sort keys the way Python compares tuples: element by element, numbers and strings by value. */
export function compare(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compare(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (a === b) return 0;
  if (a === null || a === undefined || b === null || b === undefined) throw new Error("cannot order null");
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

/** A sorted copy (stable, like Python's sorted), ordered by the key each item gives. */
export function sortBy<T>(items: Iterable<T>, key: (item: T) => unknown): T[] {
  return [...items]
    .map((item, index) => ({ item, index, k: key(item) }))
    .sort((x, y) => compare(x.k, y.k) || x.index - y.index)
    .map((x) => x.item);
}

/** Python's sorted() on plain strings or numbers. */
export function sorted<T extends string | number>(items: Iterable<T>): T[] {
  return [...items].sort(compare);
}

/** Python's set difference as a sorted list. */
export function without<T extends string | number>(items: Iterable<T>, ...taken: Iterable<T>[]): T[] {
  const out = new Set(items);
  for (const t of taken) for (const x of t) out.delete(x);
  return sorted(out);
}

/** How Python writes a value inside an f-string: repr() for lists and dicts, str() for the rest. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  return pyRepr(value);
}

export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ")}}`;
  }
  return String(value);
}
