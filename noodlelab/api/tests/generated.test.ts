// The generated module src/generated/assets.ts must match the schema, seed and model map files it was made from.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, target } from "../scripts/gen.ts";

describe("generated assets", () => {
  it("src/generated/assets.ts is current (run `npm run gen` if not)", () => {
    expect(readFileSync(target, "utf8")).toBe(render());
  });
});
