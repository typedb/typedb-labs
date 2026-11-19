// Checks the play / pause / scrub logic behind the Assembled ←→ Exploded control.

import { beforeEach, describe, expect, it } from "vitest";
import { progress } from "./progress";

describe("explosion progress", () => {
  beforeEach(() => progress.set(0));

  it("plays forwards to exactly 1 and stops", () => {
    progress.play(1);
    for (let i = 0; i < 1000; i++) progress.tick(0.05);
    expect(progress.value).toBe(1);
    expect(progress.direction).toBe(0);
  });

  it("plays backwards to exactly 0 and stops", () => {
    progress.set(1);
    progress.play(-1);
    for (let i = 0; i < 1000; i++) progress.tick(0.05);
    expect(progress.value).toBe(0);
    expect(progress.direction).toBe(0);
  });

  it("stops playing when the slider is moved, and keeps values within 0..1", () => {
    progress.play(1);
    progress.tick(0.5);
    progress.set(0.4);
    progress.tick(0.5);
    expect(progress.value).toBe(0.4);
    progress.set(7);
    expect(progress.value).toBe(1);
  });
});
