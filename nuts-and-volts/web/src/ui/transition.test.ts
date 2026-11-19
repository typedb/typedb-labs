// Switching selections: the TypeQL overlay is open by default on every screen wider than a phone, and the part
// panel keeps the previous part's details until the next part's are ready.

import { describe, expect, it } from "vitest";
import { panelParts, typeqlStartsCollapsed } from "./transition";

describe("the TypeQL overlay's default", () => {
  it("is open at every desktop and laptop width, whatever the selection", () => {
    for (const w of [1280, 1440, 1512, 1699, 1700, 1920, 2560]) expect(typeqlStartsCollapsed(w)).toBe(false);
  });

  it("starts as its summary on a phone", () => {
    expect(typeqlStartsCollapsed(390)).toBe(true);
  });
});

describe("switching the selected part", () => {
  it("shows nothing with no selection", () => {
    expect(panelParts(null, null)).toEqual([]);
    expect(panelParts(null, "door-fl")).toEqual([]);
  });

  it("shows the first part directly: there is nothing to keep on screen", () => {
    expect(panelParts("door-fl", null)).toEqual([{ id: "door-fl", state: undefined }]);
  });

  it("keeps the previous part on screen while the next one loads hidden", () => {
    expect(panelParts("tyre-rr", "door-fl")).toEqual([
      { id: "door-fl", state: "stale" }, { id: "tyre-rr", state: "pending" }]);
  });

  it("shows only the new part once it is ready", () => {
    expect(panelParts("tyre-rr", "tyre-rr")).toEqual([{ id: "tyre-rr", state: undefined }]);
  });

  it("drops a part replaced before it was ready, keeping the one on screen", () => {
    // door-fl shown; tyre-rr selected then replaced by front-inverter before it loaded
    expect(panelParts("front-inverter", "door-fl").map((p) => p.id)).toEqual(["door-fl", "front-inverter"]);
  });

  it("goes straight back to the part on screen if it is selected again", () => {
    expect(panelParts("door-fl", "door-fl")).toEqual([{ id: "door-fl", state: undefined }]);
  });
});
