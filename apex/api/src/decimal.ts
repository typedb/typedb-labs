// Exact decimal arithmetic (what Python's Decimal gave the original backend), on BigInt.
// TypeDB's decimal has 19 fractional digits; all arithmetic here is exact, with no rounding.

export class Dec {
  readonly unscaled: bigint;
  readonly scale: number;

  private constructor(unscaled: bigint, scale: number) {
    this.unscaled = unscaled;
    this.scale = scale;
  }

  /** From "0.6", "0.6dec", 0.6 (only exact when the number prints exactly) or a bigint. */
  static of(value: string | number | bigint | Dec): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === "bigint") return new Dec(value, 0);
    let text = String(value);
    if (text.endsWith("dec")) text = text.slice(0, -3);
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!m) throw new Error(`not a finite decimal: ${value}`);
    const frac = m[3] ?? "";
    return new Dec(BigInt((m[1] ?? "") + m[2] + frac), frac.length);
  }

  static readonly ZERO = new Dec(0n, 0);
  static readonly ONE = new Dec(1n, 0);

  private static align(a: Dec, b: Dec): [bigint, bigint, number] {
    const scale = Math.max(a.scale, b.scale);
    return [a.unscaled * 10n ** BigInt(scale - a.scale), b.unscaled * 10n ** BigInt(scale - b.scale), scale];
  }

  add(other: Dec | string | number): Dec {
    const [x, y, s] = Dec.align(this, Dec.of(other));
    return new Dec(x + y, s);
  }

  sub(other: Dec | string | number): Dec {
    const [x, y, s] = Dec.align(this, Dec.of(other));
    return new Dec(x - y, s);
  }

  mul(other: Dec | string | number): Dec {
    const o = Dec.of(other);
    return new Dec(this.unscaled * o.unscaled, this.scale + o.scale);
  }

  cmp(other: Dec | string | number): -1 | 0 | 1 {
    const [x, y] = Dec.align(this, Dec.of(other));
    return x < y ? -1 : x > y ? 1 : 0;
  }

  eq(other: Dec | string | number): boolean {
    return this.cmp(other) === 0;
  }

  gt(other: Dec | string | number): boolean {
    return this.cmp(other) > 0;
  }

  /** Plain decimal text without trailing zeros, like Python's `format(Decimal, "f")` after normalising. */
  toString(): string {
    const negative = this.unscaled < 0n;
    const digits = (negative ? -this.unscaled : this.unscaled).toString().padStart(this.scale + 1, "0");
    const int = digits.slice(0, digits.length - this.scale);
    const frac = digits.slice(digits.length - this.scale).replace(/0+$/, "");
    return (negative ? "-" : "") + int + (frac ? "." + frac : "");
  }

  /** Plain decimal text keeping every digit of the scale, like Python's str(Decimal): 1.2 * 100 -> "120.0". */
  toPlainString(): string {
    const negative = this.unscaled < 0n;
    const digits = (negative ? -this.unscaled : this.unscaled).toString().padStart(this.scale + 1, "0");
    const int = digits.slice(0, digits.length - this.scale);
    const frac = digits.slice(digits.length - this.scale);
    return (negative ? "-" : "") + int + (frac ? "." + frac : "");
  }

  /** Text with exactly `places` fractional digits (no rounding needed when the value has fewer). */
  toFixed(places: number): string {
    const [int, frac = ""] = this.toString().split(".");
    if (frac.length > places) throw new Error(`${this} has more than ${places} decimal places`);
    return int + (places ? "." + frac.padEnd(places, "0") : "");
  }

  toNumber(): number {
    return Number(this.toString());
  }

  /** As a TypeQL literal, e.g. 0.7dec. */
  toLiteral(): string {
    const text = this.toString();
    return (text.includes(".") ? text : text + ".0") + "dec";
  }

  toJSON(): string {
    return this.toString();
  }
}
