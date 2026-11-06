// The loaded model objects are shared and moved by the explosion; rebuilding the vehicle (a hot reload or a
// remount while exploded) must still use their assembled pose, never the moved one.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildVehicle } from "./buildVehicle";

describe("Blender-built parts keep their assembled pose across rebuilds", () => {
  it("records the home pose once and ignores later movement", () => {
    const tyre = new THREE.Group();
    tyre.position.set(1.58, 0.405, 0.815);
    const external = new Map<string, THREE.Object3D>([["tyre-fr", tyre]]);
    const first = buildVehicle(external).find((b) => b.id === "tyre-fr")!;
    tyre.position.set(3.5, 1.8, 3.9); // exploded
    tyre.rotation.set(0.2, 0, 0);
    const second = buildVehicle(external).find((b) => b.id === "tyre-fr")!;
    expect(second.position.toArray()).toEqual(first.position.toArray());
    expect(second.rotation.x).toBe(0);
  });
});
