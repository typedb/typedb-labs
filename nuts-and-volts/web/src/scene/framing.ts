// The size of the fully exploded assembly, measured once when the vehicle is built, so the camera
// can pull back far enough to show all of it at any screen size.

import type { Vec3 } from "../vehicle/shapes";

export const explodedVolume = {
  /** Half-size of the exploded assembly around the vertical axis it turns on (metres). */
  radius: 7,
  /** Height of the middle of the exploded assembly. */
  centreY: 2.5,
  /** Half its height. */
  halfHeight: 3,
};

/** The bounds are of part centres: parts reach this far beyond them (metres). */
const PART_REACH = 0.35;

export function setExplodedVolume(min: Vec3, max: Vec3) {
  const reach = Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[2]), Math.abs(max[2]));
  explodedVolume.radius = reach + PART_REACH;
  explodedVolume.centreY = (min[1] + max[1]) / 2;
  explodedVolume.halfHeight = (max[1] - min[1]) / 2 + PART_REACH;
}
