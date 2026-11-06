// Writing answers as JSON exactly as the Python backend did.
//
// Python's json module writes a float as "380.0" and an int as "6"; JavaScript writes both as a number
// with no way to tell them apart. The web app's TypeScript types say a property's value is a number either
// way, so this only matters for byte-for-byte fidelity, which the port keeps: a value read from a double
// attribute is wrapped in `Double`, and `toJson` writes it the way Python would.

/** A number that came from a TypeDB double (or a sum of doubles): written with a decimal point. */
export class Double {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }
}

/** The text Python's repr() gives a float: shortest round-trip digits, an exponent only below 1e-4 or from 1e16. */
export function pythonFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`);
  if (n === 0) return Object.is(n, -0) ? "-0.0" : "0.0";
  const sign = n < 0 ? "-" : "";
  const [mantissa, exponentText] = Math.abs(n).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const e = Math.abs(exponent) < 10 ? `0${Math.abs(exponent)}` : String(Math.abs(exponent));
    return `${sign}${m}e${exponent < 0 ? "-" : "+"}${e}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
  const fraction = digits.slice(exponent + 1);
  return `${sign}${whole}.${fraction || "0"}`;
}

/** Python's `format(x, "g")` with its default precision of 6, as the question summaries use it. */
export function pythonG(n: number): string {
  if (n === 0) return "0";
  const exponent = Math.floor(Math.log10(Math.abs(n)));
  let text: string;
  if (exponent < -4 || exponent >= 6) {
    const [m, e] = n.toExponential(5).split("e");
    const mantissa = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
    const ex = Number(e);
    text = `${mantissa}e${ex < 0 ? "-" : "+"}${Math.abs(ex) < 10 ? "0" : ""}${Math.abs(ex)}`;
  } else {
    text = n.toPrecision(6);
    if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  }
  return text;
}

/** Serialises like Python's json.dumps with compact separators and ensure_ascii off, writing Doubles as floats. */
export function toJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Double) return pythonFloat(value.value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
    return Number.isInteger(value) ? String(value) : pythonFloat(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(toJson).join(",")}]`;
  if (typeof value === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) parts.push(`${JSON.stringify(k)}:${toJson(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`cannot write ${typeof value} as JSON`);
}
