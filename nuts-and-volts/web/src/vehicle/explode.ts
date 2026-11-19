// The exploded view: where every part is at any point between assembled (0) and exploded (1).
//
// Four things combine:
//  1. Layers. The vehicle separates vertically into engineering layers, each kept in its own plan
//     position so it still reads as part of the vehicle: the exterior panels and closures (with the
//     driving sensors stepping out from where they mount) on top, then the body structure with the
//     cabin, then cooling and brake control, the chassis (suspension, steering, wheel ends), the
//     drivetrain with its power electronics, the low-voltage and charging electrics, and the battery
//     at the bottom.
//  2. A mild expansion field. Within a layer, positions spread a little away from the vehicle's centre
//     (lengthwise and sideways only) so neighbours open small gaps while the vehicle stays recognisable.
//  3. The assembly hierarchy. Each sub-assembly moves within its layer (doors swing out, wheel ends move
//     outboard, drive units slide fore and aft) and each part moves within its assembly (a wheel end
//     fans out into tyre, rim, nuts, disc, pads, calliper, hub; a motor slides apart along its axis).
//     The tree comes from explosion-groups.json, an animation asset generated from TypeDB's assembly
//     relations; which layer an assembly belongs to is choreography, set below.
//  4. A fine-detail phase. Over the last third, parts take a final smaller step (pads part from each
//     other, nuts spread from the hub, bearings leave their housings), so the assembly visibly resolves
//     into finer detail.
//
// Timing runs in tiers: layers first, then sub-assemblies, then parts, then detail.
// Everything is a pure function of the progress value, so it can be scrubbed, paused and reversed exactly.

import groups from "./explosion-groups.json";
import { PARTS, type Part } from "./manifest";
import type { Vec3 } from "./shapes";

/** Assembly tree for choreography only (see explosion-groups.json); TypeDB is the source. */
const PARENT = new Map<string, string | null>(Object.entries(groups.assemblies));
const ASSEMBLY_OF = new Map<string, string>(Object.entries(groups.components));
export const assemblyOf = (partId: string) => {
  const a = ASSEMBLY_OF.get(partId);
  if (!a) throw new Error(`explosion-groups.json has no assembly for ${partId}: regenerate it from TypeDB`);
  return a;
};

/** A movement: an offset (metres, vehicle coordinates), an optional final detail step and a small turn. */
export interface Motion {
  offset: Vec3;
  detail?: Vec3;
  turn?: Vec3;
}

// ---- Expansion field --------------------------------------------------------------------------------

/** Centre the field expands from (vehicle coordinates). */
export const FIELD_CENTRE: Vec3 = [0, 0.75, 0];
/** How much distances from the centre are multiplied by at full explosion, per axis (x, y, z). Heights are left
 * alone: the layers separate vertically. */
export const FIELD_SCALE: Vec3 = [1.16, 1, 1.3];
/** How high the whole assembly floats when fully exploded (keeps the dropped battery off the floor). */
export const EXPLODED_LIFT = 1.85;

// ---- Layers ------------------------------------------------------------------------------------------

export type Layer = "exterior" | "sensors" | "structure" | "cooling-braking" | "chassis" | "drivetrain" | "electrical" | "battery";

/** Each layer's move (metres) and how strongly its parts' own movements apply (1 = as written below). The
 * exterior keeps its shape as a shell; inner layers open less so they don't run into each other. */
export const LAYERS: Record<Layer, { offset: Vec3; parts: number }> = {
  exterior: { offset: [0, 3.4, 0], parts: 0.62 },
  sensors: { offset: [0, 3.4, 0], parts: 1 },
  structure: { offset: [0, 1.85, 0], parts: 0.55 },
  "cooling-braking": { offset: [0.3, 0.98, 0], parts: 0.7 },
  chassis: { offset: [0, 0.3, 0], parts: 0.62 },
  drivetrain: { offset: [0, -1.0, 0], parts: 0.55 },
  electrical: { offset: [0, -0.95, 0], parts: 0.7 },
  battery: { offset: [0, -1.35, 0], parts: 0.7 },
};

/** Which layer each assembly belongs to (an assembly not listed takes its parent's). The interior travels with
 * the body structure it is fitted to; the driving sensors (and the side cameras in the mirrors) are a layer of
 * their own that moves with the exterior. */
const LAYER_OF_ASSEMBLY: Record<string, Layer> = {
  body: "exterior",
  "body-frame": "structure",
  structure: "structure",
  interior: "structure",
  chassis: "chassis",
  "brake-control": "cooling-braking",
  thermal: "cooling-braking",
  "front-drive-unit": "drivetrain",
  "rear-drive-unit": "drivetrain",
  "hv-battery": "battery",
  "power-distribution": "electrical",
  electronics: "electrical",
  "sensor-suite": "sensors",
};

export function layerOf(partId: string): Layer {
  if (/^side-camera-/.test(partId)) return "sensors";
  for (let a: string | null = assemblyOf(partId); a; a = PARENT.get(a) ?? null) {
    const layer = LAYER_OF_ASSEMBLY[a];
    if (layer) return layer;
  }
  throw new Error(`no exploded-view layer for ${partId}`);
}

// ---- Sub-assembly movements (within their layer) ---------------------------------------------------

/** Which side an id belongs to: -l / -fl / -rl (optionally followed by -n) → left, -r / -fr / -rr → right. */
export const sideOf = (id: string): -1 | 0 | 1 =>
  /-(f|r)?l(-\d+)?$/.test(id) ? -1 : /-(f|r)?r(-\d+)?$/.test(id) ? 1 : 0;
const frontOf = (id: string) => (/-f[lr](-\d+)?$/.test(id) ? 1 : -1);

function assemblyMotion(id: string): Motion | null {
  const s = sideOf(id);
  if (id.startsWith("door-")) return { offset: [frontOf(id) * 0.12, 0, s * 0.55] };
  if (id.startsWith("corner-")) return { offset: [frontOf(id) * 0.15, 0, s * 0.45] };
  const table: Record<string, Vec3> = {
    greenhouse: [0, 0.32, 0],
    "front-end": [0.35, 0, 0],
    "rear-end": [-0.35, 0, 0],
    "body-frame": [0, 0.18, 0],
    "front-suspension": [0.15, 0, 0],
    "rear-suspension": [-0.15, 0, 0],
    steering: [0.1, 0.28, 0],
    "brake-control": [0, 0.15, 0],
    "front-drive-unit": [0.6, 0, 0],
    "rear-drive-unit": [-0.6, 0, 0],
    "battery-junction-box": [0.45, 0.25, -0.1],
  };
  return table[id] ? { offset: table[id] } : null;
}

// ---- Part movements (relative to their own assembly) ------------------------------------------------

type Rule = [RegExp, (s: number, c: Vec3, id: string) => Motion];
const m = (offset: Vec3, detail?: Vec3, turn?: Vec3): Motion => ({ offset, detail, turn });

/** First matching rule wins. `s` is the part's side (-1, 0, 1); `c` its assembled centre. */
const PART_RULES: Rule[] = [
  // exterior skin
  [/^rocker-/, (s) => m([0, -1.0, s * 0.6])],
  [/^roof$/, () => m([0, 0.45, 0])],
  [/^windscreen$/, () => m([0.35, 0.25, 0], undefined, [0, 0, -0.1])],
  [/^body-side-/, (s) => m([0, 0.1, s * 0.55])],
  [/^bonnet$/, () => m([0.2, 0.5, 0], [0, 0.15, 0], [0, 0, -0.14])],
  [/^bonnet-inner$/, () => m([0.1, 0.2, 0], [0, -0.05, 0])],
  [/^front-bumper$/, () => m([0.55, -0.1, 0])],
  [/^grille$/, () => m([0.85, -0.08, 0])],
  [/^headlamp-lens-/, (s) => m([0.75, 0.05, s * 0.32], [0.15, 0, 0])],
  [/^headlamp-/, (s) => m([0.6, 0.05, s * 0.3])],
  [/^fender-/, (s) => m([0.05, 0.05, s * 0.6])],
  [/^tailgate-inner$/, () => m([-0.18, 0.15, 0], [0.05, 0, 0])],
  [/^tailgate-glass$/, () => m([-0.55, 0.6, 0])],
  [/^tailgate$/, () => m([-0.35, 0.3, 0], undefined, [0, 0, 0.14])],
  [/^rear-bumper$/, () => m([-0.5, -0.08, 0])],
  [/^rear-diffuser$/, () => m([-0.7, -0.35, 0])],
  [/^quarter-glass-/, (s) => m([0, 0.15, s * 0.9])],
  [/^quarter-/, (s) => m([0, 0.05, s * 0.55])],
  [/^tail-lamp-/, (s) => m([-0.75, 0.05, s * 0.2])],
  // doors fan out into layers, outermost furthest
  [/^side-camera-/, (s) => m([0.1, -0.12, s * 0.95])],
  [/^mirror-/, (s) => m([0.06, 0.15, s * 1.0])],
  [/^door-handle-/, (s) => m([0.05, 0.05, s * 0.9], [0, 0, 0.12 * s])],
  [/^glass-/, (s) => m([0, 0.35, s * 0.7])],
  [/^door-(f|r)(l|r)$/, (s) => m([0, 0, s * 0.5])],
  [/^door-seal-/, (s) => m([0, 0, s * 0.3])],
  [/^door-structure-/, (s) => m([0, 0, s * 0.12])],
  [/^door-latch-/, (s) => m([-0.2, 0, s * 0.12], [-0.12, 0, 0])],
  [/^window-regulator-/, (s) => m([0, 0.05, s * -0.1], [0, 0.06, 0])],
  [/^door-speaker-/, (s) => m([0.05, -0.05, s * -0.28])],
  [/^door-trim-/, (s) => m([0, 0, s * -0.45])],
  // body frame sits between the interior and the outer skin
  [/^(a|b|c|d)-pillar-|^roof-rail-/, (s) => m([0, 0.08, s * 0.3])],
  [/^front-header$/, () => m([0.2, 0.2, 0])],
  [/^rear-header$/, () => m([-0.2, 0.2, 0])],
  [/^roof-bow-/, () => m([0, 0.2, 0])],
  [/^cross-car-beam$/, () => m([0.15, -0.3, 0])],
  // structure
  [/^underbody$/, () => m([0, -0.45, 0])],
  [/^arch-liner-/, (s) => m([0, 0.4, s * 0.8])],
  [/^sill-/, (s) => m([0, 0, s * 0.45])],
  [/^front-rail-/, (s) => m([0.45, 0.08, s * 0.18])],
  [/^rear-rail-/, (s) => m([-0.45, 0.08, s * 0.18])],
  [/^front-crash-beam$/, () => m([1.1, -0.05, 0])],
  [/^rear-crash-beam$/, () => m([-1.1, -0.05, 0])],
  [/^bulkhead$/, () => m([0.15, 0.55, 0])],
  [/^cabin-floor$/, () => m([0, 0.25, 0])],
  [/^floor-crossmember-/, () => m([0, 0.38, 0])],
  // wheel ends: a sideways stack from knuckle to tyre; nuts spread from the hub at the end
  [/^tyre-/, (s) => m([0, 0, s * 0.85])],
  [/^wheel-nut-/, (s, _c, id) => {
    const a = ((Number(id.slice(-1)) - 1) / 5) * Math.PI * 2;
    return m([0, 0, s * 0.7], [Math.cos(a) * 0.14, Math.sin(a) * 0.14, s * 0.12]);
  }],
  [/^wheel-(f|r)(l|r)$/, (s) => m([0, 0, s * 0.55])],
  [/^epb-actuator-/, (s) => m([0, 0.26, s * 0.3], [0, 0.04, -s * 0.06])],
  [/^caliper-/, (s) => m([0, 0.18, s * 0.38])],
  [/^brake-pad-outer-/, (s) => m([0, 0.1, s * 0.3], [0, 0.05, s * 0.07])],
  [/^brake-pad-inner-/, (s) => m([0, 0.1, s * 0.22], [0, 0.05, -s * 0.07])],
  [/^brake-disc-/, (s) => m([0, 0, s * 0.15])],
  [/^brake-shield-/, (s) => m([0, 0, s * 0.04])],
  [/^wheel-bearing-/, (s) => m([0, 0, -s * 0.06], [0, 0, -s * 0.14])],
  [/^hub-nut-/, (s) => m([0, 0, s * 0.3], [0, 0, s * 0.06])],
  [/^brake-hose-/, (s) => m([-0.05, 0.28, s * 0.3], [0, 0.06, 0])],
  [/^hub-/, (s) => m([0, 0, -s * 0.06])],
  [/^knuckle-/, (s) => m([0, 0, -s * 0.24])],
  [/^wheel-speed-sensor-/, (s) => m([0.08, -0.18, -s * 0.18])],
  // suspension and steering
  [/^lower-arm-/, (s) => m([0, -0.2, s * 0.25])],
  [/^upper-arm-/, (s) => m([0, 0.3, s * 0.3])],
  [/^coilover-/, (s) => m([0, 0.5, s * 0.3])],
  [/^spring-/, (s) => m([0, 0.55, s * 0.45], [0, 0.08, s * 0.1])],
  [/^top-mount-/, (s) => m([0, 0.75, s * 0.3], [0, 0.15, 0])],
  [/^drop-link-/, (s) => m([0, 0.15, s * 0.15])],
  [/^toe-link-/, (s) => m([0, -0.05, s * 0.25])],
  [/-subframe-mount-/, (_s, c) => m([0, -0.3, Math.sign(c[2]) * 0.22], [0, -0.06, 0])],
  [/-subframe$/, () => m([0, -0.45, 0])],
  [/^front-anti-roll-bar$/, () => m([0.3, -0.18, 0])],
  [/^rear-anti-roll-bar$/, () => m([-0.3, -0.18, 0])],
  [/^tie-rod-/, (s) => m([0, 0, s * 0.25])],
  [/^eps-motor$/, () => m([-0.14, -0.12, 0.04])],
  [/^steering-ecu$/, () => m([-0.22, -0.12, -0.06])],
  [/^steering-rack-mount-/, (_s, c) => m([0, -0.22, Math.sign(c[2]) * 0.06])],
  [/^steering-torque-sensor$/, () => m([0, 0.16, 0])],
  [/^steering-intermediate-shaft$/, () => m([-0.08, 0.3, 0])],
  [/^steering-column$/, () => m([-0.15, 0.4, 0])],
  [/^steering-wheel$/, () => m([-0.45, 0.6, 0])],
  [/^brake-booster$/, () => m([-0.05, 0.1, 0.12])],
  [/^master-cylinder$/, () => m([0.12, 0.18, 0.06])],
  [/^brake-fluid-reservoir$/, () => m([0.12, 0.36, 0.06])],
  [/^brake-pedal$/, () => m([-0.25, -0.05, 0.05])],
  [/^esc-module$/, () => m([0.3, 0.12, -0.08])],
  [/^brake-line-/, (s) => m([0, 0.05, s * 0.08])],
  [/^condenser$/, () => m([0.3, 0, 0])],
  [/^coolant-reservoir$/, () => m([0.1, 0.3, -0.05])],
  [/^coolant-valve$/, () => m([0, 0.22, -0.1])],
  [/^coolant-heater$/, () => m([0.1, 0.1, -0.2])],
  [/^refrigerant-lines$/, () => m([0.1, 0.18, 0])],
  [/^front-coolant-lines$/, () => m([0.05, 0.15, -0.12])],
  [/^rear-coolant-lines$/, () => m([0, -0.2, -0.1])],
  // drive units: the motor comes apart along its axis on one side (housing, stator, rotor and shaft, bearing,
  // resolver, end cover), the gear train on the other (case, differential with its gears, final-drive gear,
  // intermediate shaft and gear, input pinion, cover, then the disconnect or park lock), the inverter rises
  // into a stack (tray, busbars, module, sensor, boards, lid), and the mounts drop to the subframe
  [/-motor$/, () => m([0, 0, -0.4])],
  [/-stator$/, () => m([0, 0, -0.7])],
  [/-rotor$/, () => m([0, 0, -0.95])],
  [/-rotor-shaft$/, () => m([0, 0.22, -0.95], [0, 0.06, 0])],
  [/-motor-bearing-1$/, () => m([0, 0, -1.1], [0, 0, -0.1])],
  [/-motor-bearing-2$/, () => m([0, 0.18, -0.25], [0, 0.06, 0])],
  [/-resolver$/, () => m([0, 0.12, -1.22], [0, 0.05, -0.05])],
  [/-motor-end-cover$/, () => m([0, 0, -1.35])],
  [/-gearbox$/, () => m([0, 0, 0.35])],
  [/-differential$/, () => m([0, -0.2, 0.55])],
  [/-side-gear-/, (s) => m([0, -0.38, 0.55 + s * 0.08], [0, 0, s * 0.04])],
  [/-spider-gears$/, () => m([0, -0.5, 0.55])],
  [/-reduction-gear$/, () => m([0, -0.05, 0.75])],
  [/-intermediate-shaft$/, () => m([0, 0.2, 0.66])],
  [/-intermediate-gear$/, () => m([0, 0.2, 0.86])],
  [/-pinion$/, () => m([0, 0.36, 0.8])],
  [/-gearbox-cover$/, () => m([0, 0, 1.05])],
  [/^front-disconnect$|^rear-park-lock$/, () => m([0, 0.22, 1.25])],
  [/-oil-pump$/, () => m([0, -0.28, 0.3])],
  [/-oil-cooler$/, (_s, c) => m([Math.sign(c[0]) * 0.25, 0.05, 0.35])],
  [/-inverter$/, () => m([0, 0.3, 0])],
  [/-phase-busbars$/, () => m([0, 0.38, 0.18])],
  [/-inverter-busbars$/, () => m([0, 0.44, 0])],
  [/-dc-link-capacitor$/, () => m([0, 0.5, -0.25])],
  [/-power-module$/, () => m([0, 0.56, 0])],
  [/^(front|rear)-current-sensor$/, () => m([0, 0.62, 0.22])],
  [/-gate-driver$/, () => m([0, 0.7, 0])],
  [/-control-board$/, () => m([0, 0.78, 0.18])],
  [/-hv-connector$/, (_s, c) => m([-Math.sign(c[0]) * 0.3, 0.55, -0.1])],
  [/-inverter-lid$/, () => m([0, 0.9, 0])],
  [/-drive-unit-mount-3$/, (_s, c) => m([-Math.sign(c[0]) * 0.18, -0.3, 0])],
  [/-drive-unit-mount-/, () => m([0, -0.32, 0])],
  [/-halfshaft-/, (s) => m([0, 0, s * 0.55])],
  // battery: tray drops, the modules lift off into a spread grid, lid and busbars rise above
  [/^battery-enclosure$/, () => m([0, -0.4, 0])],
  [/^battery-side-rail-/, (s) => m([0, -0.3, s * 0.35])],
  [/^battery-cooling-plate$/, () => m([0, -0.18, 0])],
  [/^battery-coolant-manifold$/, () => m([0, -0.08, 0])],
  [/^battery-module-/, (s, c) => m([0, 0.15, s * 0.1], [c[0] * 0.2, 0.08, s * 0.12])],
  [/^battery-crossmember-/, () => m([0, 0.15, 0], [0, 0.1, 0])],
  [/^battery-busbar-/, (s) => m([0, 0.45, s * 0.15])],
  [/^battery-lid$/, () => m([0, 0.75, 0])],
  [/^bms$/, () => m([0.4, 0.55, 0.1])],
  [/^battery-underbody-shield$/, () => m([0, -0.6, 0])],
  [/^battery-monitor-chain$/, () => m([0, 0.4, -0.05])],
  [/^battery-monitor-/, () => m([0, 0.32, 0], [0, 0.06, 0])],
  [/^service-disconnect$/, () => m([-0.35, 0.55, 0], [0, 0.08, 0])],
  [/^battery-rear-feed$/, () => m([-0.05, 0.5, 0.15])],
  [/^battery-vent$/, () => m([-0.35, 0.05, 0.12])],
  // the junction box opens into its parts: housing, contactors, pre-charge, fuse, current sensor
  [/^hv-junction-box$/, () => m([0, -0.04, 0])],
  [/^main-contactor-pos$/, () => m([0, 0.14, -0.06])],
  [/^main-contactor-neg$/, () => m([0, 0.14, 0.06])],
  [/^precharge-circuit$/, () => m([0.1, 0.2, -0.06])],
  [/^pack-fuse$/, () => m([0.1, 0.26, 0])],
  [/^pack-current-sensor$/, () => m([0.1, 0.32, 0.06])],
  // power distribution
  [/^lv-battery$/, () => m([0.7, 0.5, -0.3])],
  [/^pdu$/, () => m([0.7, 0.5, 0.3])],
  [/^dc-dc$/, () => m([0.75, 0.45, 0])],
  [/^lv-fuse-box$/, () => m([0.7, 0.6, -0.2])],
  [/^charge-port$/, () => m([-0.3, 0.1, -0.45])],
  [/^hv-harness-aux$/, () => m([0.35, 0.3, 0])],
  [/^hv-harness-charge$/, () => m([-0.2, -0.3, -0.3])],
  [/^obc$/, () => m([-0.7, 0.5, -0.4])],
  [/^hv-harness-front$/, () => m([0.35, -0.35, 0])],
  [/^hv-harness-rear$/, () => m([-0.35, -0.35, 0])],
  [/^lv-harness$/, () => m([0, 0.85, -0.7])],
  // driving sensors rise with the exterior, then step out from where they mount
  [/^front-camera$/, () => m([0.55, 0.62, 0])],
  [/^rear-camera$/, () => m([-0.75, 0.3, 0])],
  [/^front-radar$/, () => m([0.85, 0.12, 0])],
  [/^corner-radar-f/, (s) => m([0.6, 0.12, s * 0.55])],
  [/^corner-radar-r/, (s) => m([-0.6, 0.12, s * 0.55])],
  [/^lidar$/, () => m([0.2, 0.75, 0], [0, 0.1, 0])],
  [/^gnss-antenna$/, () => m([0, 0.72, 0])],
  // electronics
  [/^ad-compute$/, () => m([-0.35, 0.15, 0.25])],
  [/^vcu$/, () => m([0.2, 0.2, 0.1])],
  [/^bcm$/, () => m([0.2, 0.15, -0.35])],
  [/^gateway$/, () => m([0, 0.25, 0])],
  [/^telematics$/, () => m([0, 0.35, 0])],
  // thermal
  [/^radiator$/, () => m([1.0, 0.1, 0])],
  [/^cooling-fan-/, (s) => m([0.75, 0.1, s * 0.2])],
  [/^coolant-pump$/, () => m([0.5, 0.35, -0.25])],
  [/^battery-chiller$/, () => m([0.45, 0.25, -0.1])],
  [/^heat-pump-compressor$/, () => m([0.55, 0.3, 0.3])],
  [/^hvac-module$/, () => m([-0.1, 0.45, 0])],
  [/^coolant-lines$/, () => m([0.2, -0.25, -0.25])],
  // interior: seats come apart into frame, cushion, back and headrest
  [/^seat-front-/, (s) => m([0, 0, s * 0.1])],
  [/^seat-back-front-/, (s) => m([-0.25, 0.1, s * 0.1])],
  [/^headrest-front-/, (s) => m([-0.3, 0.35, s * 0.1])],
  [/^seat-frame-front-/, (s) => m([0, -0.2, s * 0.1])],
  [/^seat-rear$/, () => m([-0.15, 0, 0])],
  [/^seat-back-rear$/, () => m([-0.4, 0.1, 0])],
  [/^headrest-rear-/, (s) => m([-0.45, 0.35, s * 0.15])],
  [/^seat-frame-rear$/, () => m([-0.15, -0.2, 0])],
  [/^dashboard$/, () => m([0.25, 0.2, 0])],
  [/^driver-display$/, () => m([0.45, 0.38, 0])],
  [/^centre-display$/, () => m([0.5, 0.35, 0])],
  [/^centre-console$/, () => m([0.3, 0.05, 0])],
  [/^headliner$/, () => m([0, 0.65, 0])],
];

export function partMotion(part: Part, center: Vec3): Motion | null {
  const s = sideOf(part.id) || (Math.sign(Math.round(center[2] * 20)) as -1 | 0 | 1);
  const k = LAYERS[layerOf(part.id)].parts;
  const scale = (v: Vec3) => v.map((x) => x * k) as Vec3;
  for (const [re, f] of PART_RULES) {
    if (!re.test(part.id)) continue;
    const motion = f(s, center, part.id);
    // Unless a part has its own detail step, it finishes by moving a little further the same way.
    return { offset: scale(motion.offset), turn: motion.turn, detail: scale(motion.detail ?? (motion.offset.map((v) => v * 0.25) as Vec3)) };
  }
  return null;
}

// ---- Timeline ---------------------------------------------------------------------------------------

/** Each tier has its own slice of the 0→1 progress; tiers overlap so the motion flows continuously. */
const TIERS: [number, number][] = [
  [0.0, 0.42], // 1: layers (exterior up, battery down...)
  [0.2, 0.62], // 2: sub-assemblies (doors, wheel ends, drive units...)
  [0.4, 0.82], // 3: parts
  [0.68, 1.0], // 4: fine detail
];

export interface Step {
  offset: Vec3;
  turn?: Vec3;
  start: number;
  end: number;
}

/** Smooth start and stop: the controlled, weightless feel (no sudden jumps). */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const window01 = (p: number, a: number, b: number) => ease(clamp01((p - a) / (b - a)));

/** How far through its own movement a step is at overall progress p (0..1, eased). */
export const stepAmount = (step: Step, p: number) => window01(p, step.start, step.end);

/** How far the expansion field has opened: most of it early, the rest during the fine-detail tier. */
export const fieldAmount = (p: number) => 0.68 * window01(p, 0.0, 0.62) + 0.32 * window01(p, 0.62, 1.0);

const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/**
 * Build each part's list of steps (each moving assembly above it, its own move, its detail step).
 * `centers` gives each part's assembled centre (body panels only know theirs once built).
 */
export function buildExplosionPlan(centers: Map<string, Vec3>): Map<string, Step[]> {
  // Collect every movement with its tier, then stagger within a tier:
  // the ones that travel furthest set off first, so the outer layers lead.
  type Node = { key: string; tier: number; offset: Vec3; turn?: Vec3 };
  const nodes = new Map<string, Node>();
  for (const [layer, { offset }] of Object.entries(LAYERS)) nodes.set(`l:${layer}`, { key: `l:${layer}`, tier: 1, offset });
  for (const part of PARTS) {
    const own = assemblyOf(part.id);
    for (let a: string | null = own; a && a !== "vehicle"; a = PARENT.get(a) ?? null) {
      if (nodes.has(`a:${a}`)) continue;
      const motion = assemblyMotion(a);
      if (motion) nodes.set(`a:${a}`, { key: `a:${a}`, tier: 2, offset: motion.offset });
    }
    const motion = partMotion(part, centers.get(part.id)!);
    if (motion) {
      nodes.set(`p:${part.id}`, { key: `p:${part.id}`, tier: 3, offset: motion.offset, turn: motion.turn });
      if (motion.detail) nodes.set(`d:${part.id}`, { key: `d:${part.id}`, tier: 4, offset: motion.detail });
    }
  }
  const timing = new Map<string, [number, number]>();
  for (let tier = 1; tier <= 4; tier++) {
    const inTier = [...nodes.values()].filter((n) => n.tier === tier);
    inTier.sort((a, b) => length(b.offset) - length(a.offset) || a.key.localeCompare(b.key));
    const [w0, w1] = TIERS[tier - 1];
    const span = w1 - w0;
    // The few, long layer moves overlap more and take longer each, so nothing travels fast.
    const stagger = tier === 1 ? 0.15 : 0.3;
    inTier.forEach((n, i) => {
      const lag = inTier.length > 1 ? i / (inTier.length - 1) : 0;
      const start = w0 + lag * span * stagger;
      timing.set(n.key, [start, start + span * (1 - stagger)]);
    });
  }
  const plan = new Map<string, Step[]>();
  for (const part of PARTS) {
    const keys: string[] = [`l:${layerOf(part.id)}`];
    const assemblies: string[] = [];
    for (let a: string | null = assemblyOf(part.id); a && a !== "vehicle"; a = PARENT.get(a) ?? null) assemblies.unshift(`a:${a}`);
    keys.push(...assemblies, `p:${part.id}`, `d:${part.id}`);
    const steps: Step[] = [];
    for (const k of keys) {
      const n = nodes.get(k);
      if (!n) continue;
      const [start, end] = timing.get(k)!;
      steps.push({ offset: n.offset, turn: n.turn, start, end });
    }
    plan.set(part.id, steps);
  }
  return plan;
}

/**
 * Where a part is at progress p: its assembled centre pushed out by the expansion field, plus every
 * step's eased offset. Sideways and fore-aft moves also rise slightly mid-travel, so paths curve
 * gently rather than running in straight lines. Returns [position, extra rotation].
 */
export function partTransform(center: Vec3, steps: Step[], p: number): [Vec3, Vec3] {
  const f = fieldAmount(p);
  const pos = center.map((c, k) => c + (c - FIELD_CENTRE[k]) * (FIELD_SCALE[k] - 1) * f) as Vec3;
  pos[1] += EXPLODED_LIFT * window01(p, 0, 0.6);
  const turn: Vec3 = [0, 0, 0];
  for (const st of steps) {
    const e = stepAmount(st, p);
    if (e === 0) continue;
    const [ox, oy, oz] = st.offset;
    const arc = 0.12 * Math.hypot(ox, oz) * Math.sin(Math.PI * e);
    pos[0] += ox * e;
    pos[1] += oy * e + arc;
    pos[2] += oz * e;
    if (st.turn) for (let k = 0; k < 3; k++) turn[k] += st.turn[k] * e;
  }
  return [pos, turn];
}

/** Bounding box of all part centres at full explosion (for camera framing). */
export function explodedBounds(centers: Map<string, Vec3>, plan: Map<string, Step[]>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const [id, c] of centers) {
    const [p] = partTransform(c, plan.get(id)!, 1);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max };
}
