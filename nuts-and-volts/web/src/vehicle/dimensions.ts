// Overall proportions of the vehicle, in metres. Similar in size and stance to a premium mid-size SUV;
// the shape itself is original and unbranded.
//
// Coordinates: x points forward, y points up, z points to the vehicle's right.
// The origin is a fixed body reference point on the ground and the centre line (between the nose and tail).
//
// Engineering baseline (docs/design-targets.md, 30 October 2026): wheelbase 3.03 m, front overhang 0.76 m,
// length 4.75 m. The axles are placed from the nose, so changing these numbers moves the wheels, wheel
// arches, suspension, steering and drive units together; the body stays where it is. If they change,
// also update AXLE in blender/corner.py and rebuild the assets (scripts/build-assets.sh).

export const WHEELBASE = 3.03;
export const FRONT_OVERHANG = 0.76;
export const TRACK_HALF = 0.815; // centre of each tyre, measured from the centre line
export const WHEEL_RADIUS = 0.405; // tyre outer radius: 275/45 R22
export const RIM_RADIUS = 0.2794; // 22-inch rim
export const TYRE_WIDTH = 0.275;
export const AXLE_Y = WHEEL_RADIUS; // wheels sit on the ground

export const NOSE_X = 2.34;
export const TAIL_X = -2.41;
export const FRONT_AXLE_X = NOSE_X - FRONT_OVERHANG; // 1.58
export const REAR_AXLE_X = FRONT_AXLE_X - WHEELBASE; // -1.45 (rear overhang 0.96)

/** Right-hand drive (UK). Driver sits on the right (+z). */
export const DRIVER_Z = 0.37;
