"""Thermal circuits (C3c step 5): the front cooling module (condenser, radiator, fan shroud and fans), the coolant pump,
reservoir, thermal-mode valve and heater, the battery chiller and heat-pump compressor, the refrigerant lines, and
the coolant lines to both drive units. The battery's own coolant line and the cabin climate module stay simple
shapes in the app.

Build with scripts/build-assets.sh. Writes web/assets-src/thermal.glb and web/public/assets/thermal.map.json.

  radiator             aluminium core with plastic end tanks, hose stubs and the fan shroud behind it
  condenser            thinner core ahead of the radiator, with its receiver-drier
  cooling-fan-<side>   motor hub, seven swept blades and a ring, in the shroud
  coolant-pump         electric pump: motor can, volute, inlet and outlet stubs
  coolant-reservoir    translucent expansion tank high in the front bay, cap, hose down to the pump
  coolant-valve        rotary valve body with its actuator and three ports
  coolant-heater       high-voltage heater block with its connector and hose stubs
  battery-chiller      plate heat exchanger with its expansion valve and four ports
  heat-pump-compressor electric scroll compressor with its inverter and ports
  refrigerant-lines    aluminium pipes: compressor > condenser > chiller > compressor, and over the front drive unit
                       through the bulkhead to the cabin climate module
  <axle>-coolant-lines supply and return hoses from the valve to the inverter's front face and the oil cooler
                       (the rear pair runs under the battery pack)

Positions follow the parts around them (front drive unit, ESC module, power distribution unit, 12 V battery,
anti-roll bar, rear drive unit and the high-voltage harnesses).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import kit  # noqa: E402
from kit import box, cylinder, merge_into, new_object, transform  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

RAD_X, RAD_Y, RAD_Z = 2.20, (0.47, 0.81), 0.38  # radiator core: centre x, height span, half width (between the front rails)
COND_X = 2.243
FANS = [Vector((2.12, 0.64, s * 0.22)) for s in (-1, 1)]
PUMP = Vector((1.75, 0.50, -0.25))
RESERVOIR = Vector((1.98, 0.82, -0.12))
VALVE = Vector((1.76, 0.56, -0.15))
HEATER = Vector((1.88, 0.49, -0.25))
CHILLER = Vector((1.84, 0.46, -0.12))
COMPRESSOR = Vector((1.84, 0.47, 0.18))
HVAC = Vector((0.83, 0.66, -0.05))


def obj(name, bm, mat, bevel=0.0, sharp=35.0):
    o = new_object(name, bm, mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    return kit.shade(o, sharp)


def bx(size, centre, mat, bevel=0.002, name="box"):
    return obj(name, transform(box(*size), Matrix.Translation(centre)), mat, bevel)


def cyl(r, h, centre, axis="Y", mat="aluminium-cast", seg=40, name="cyl"):
    rot = {"X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X"), "Z": Matrix.Identity(4)}[axis]
    return obj(name, transform(cylinder(r, h, seg), Matrix.Translation(centre) @ rot), mat, 0.001)


def pipe(points, r, mat, name="pipe"):
    p = kit.tube_path([Vector(v) for v in points], r, 3)
    p.data.materials.append(kit.material(mat))
    p.name = name
    return kit.shade(p, 60)


def finish(name, parts):
    o = kit.join(name, parts)
    kit.box_uv(o, 6)
    return o


def core(x, depth, ys, half, tubes, name):
    """A heat-exchanger core: a block with fine horizontal tubes standing proud on both faces."""
    h = ys[1] - ys[0]
    bm = transform(box(depth, h, 2 * half), Matrix.Translation((x, (ys[0] + ys[1]) / 2, 0)))
    for i in range(tubes):
        y = ys[0] + h * (i + 0.5) / tubes
        merge_into(bm, transform(box(depth + 0.004, 0.003, 2 * half - 0.01), Matrix.Translation((x, y, 0))))
    return obj(name, bm, "aluminium-machined")


def radiator():
    parts = [core(RAD_X, 0.03, RAD_Y, RAD_Z, 40, "core")]
    for s in (-1, 1):  # plastic end tanks with hose stubs
        parts.append(bx((0.05, RAD_Y[1] - RAD_Y[0] + 0.02, 0.04), (RAD_X, (RAD_Y[0] + RAD_Y[1]) / 2, s * (RAD_Z + 0.02)), "plastic-black", 0.006))
        parts.append(cyl(0.017, 0.05, (RAD_X - 0.04, RAD_Y[1] - 0.05 if s > 0 else RAD_Y[0] + 0.05, s * (RAD_Z + 0.02)), "X", "plastic-black"))
    # fan shroud behind the core: a plate with two rings for the fans
    shroud = transform(box(0.01, RAD_Y[1] - RAD_Y[0] + 0.02, 2 * RAD_Z + 0.02), Matrix.Translation((RAD_X - 0.045, (RAD_Y[0] + RAD_Y[1]) / 2, 0)))
    for f in FANS:
        merge_into(shroud, transform(kit_ring(0.165, 0.175, 0.04), Matrix.Translation((RAD_X - 0.06, f.y, f.z)) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    parts.append(obj("shroud", shroud, "plastic-black", 0.002))
    return finish("radiator", parts)


def kit_ring(r0, r1, h, seg=64):
    return kit.lathe([(r0, -h / 2), (r1, -h / 2), (r1, h / 2), (r0, h / 2)], seg)


def condenser():
    parts = [core(COND_X, 0.016, (RAD_Y[0] + 0.02, RAD_Y[1] - 0.02), RAD_Z - 0.02, 34, "core")]
    for s in (-1, 1):
        parts.append(bx((0.022, RAD_Y[1] - RAD_Y[0] - 0.02, 0.025), (COND_X, (RAD_Y[0] + RAD_Y[1]) / 2, s * (RAD_Z - 0.005)), "aluminium-cast", 0.004))
    parts.append(cyl(0.02, 0.22, (COND_X + 0.012, 0.62, RAD_Z - 0.02), "Y", "aluminium-cast", name="drier"))
    return finish("condenser", parts)


def fan(c: Vector, side: int):
    parts = [cyl(0.05, 0.05, c, "X", "steel-dark", name="motor"), cyl(0.155, 0.012, c + Vector((0.012, 0, 0)), "X", "plastic-black", 64, "ring-face")]
    blades = bmesh.new()
    for i in range(7):
        a = math.tau * i / 7
        m = Matrix.Translation(c + Vector((0.02, 0, 0))) @ Matrix.Rotation(a, 4, "X") @ Matrix.Translation((0, 0.1, 0)) @ Matrix.Rotation(0.5 * side, 4, "Y")
        merge_into(blades, transform(box(0.004, 0.1, 0.05), m))
    parts.append(obj("blades", blades, "plastic-black", 0.001))
    # the ring face is a disc here: cut it back to a thin rim so the blades show
    parts[1] = kit.cut(parts[1], cyl(0.145, 0.05, c + Vector((0.012, 0, 0)), "X", "plastic-black", 64, "cut"))
    return finish(f"cooling-fan-{'l' if side < 0 else 'r'}", parts)


def battery_coolant_lines():
    """The battery's coolant circuit (`coolant-lines`): radiator outlet > pump inlet, pump outlet > valve, valve >
    chiller, then from the chiller over the front-left drive shaft, under the rack's left end, behind the left rack
    mount and over the subframe's rear-left mount to the pack's ports (the route the simple shape used)."""
    r, m = 0.013, "rubber"
    lines = [
        [(RAD_X - 0.04, RAD_Y[0] + 0.05, -(RAD_Z + 0.02)), (2.1, 0.44, -0.37), (1.95, 0.43, -0.32), (1.8, 0.43, -0.27), PUMP + Vector((0, -0.105, 0))],
        [PUMP + Vector((0.065, -0.045, 0)), (1.8, 0.47, -0.2), (1.8, 0.56, -0.19), VALVE + Vector((0.0, 0.0, -0.045))],
        [VALVE + Vector((0.045, 0, 0)), (1.83, 0.54, -0.13), CHILLER + Vector((-0.02, 0.045, 0.0))],
        [CHILLER + Vector((-0.065, 0.0, -0.02)), (1.775, 0.46, -0.33), (1.7, 0.45, -0.4), (1.68, 0.5, -0.4), (1.46, 0.49, -0.38), (1.44, 0.38, -0.38),
         (1.36, 0.36, -0.4), (1.31, 0.38, -0.36), (1.21, 0.31, -0.22), (1.212, 0.26, -0.07)],
    ]
    return finish("coolant-lines", [pipe(p, r, m) for p in lines])


def coolant_pump():
    parts = [cyl(0.038, 0.09, PUMP + Vector((0, 0.01, 0)), "Y", "steel-dark", name="motor"),
             cyl(0.05, 0.03, PUMP + Vector((0, -0.045, 0)), "Y", "aluminium-cast", name="volute"),
             cyl(0.014, 0.05, PUMP + Vector((0.04, -0.045, 0)), "X", "aluminium-cast", name="outlet"),
             cyl(0.014, 0.04, PUMP + Vector((0, -0.075, 0)), "Y", "aluminium-cast", name="inlet"),
             bx((0.02, 0.02, 0.025), PUMP + Vector((-0.045, 0.03, 0)), "plastic-black", 0.002, "plug")]
    return finish("coolant-pump", parts)


def reservoir():
    parts = [bx((0.12, 0.09, 0.1), RESERVOIR, "plastic-reservoir", 0.012, "tank"),
             cyl(0.024, 0.016, RESERVOIR + Vector((0.02, 0.053, 0.02)), "Y", "plastic-black", name="cap"),
             pipe([RESERVOIR + Vector((-0.05, -0.04, 0.03)), (1.86, 0.70, -0.1), (1.80, 0.58, -0.22), PUMP + Vector((0.01, 0.055, 0))], 0.008, "rubber", "hose")]
    return finish("coolant-reservoir", parts)


def valve():
    parts = [cyl(0.03, 0.06, VALVE, "Y", "aluminium-cast", name="body"), bx((0.05, 0.035, 0.05), VALVE + Vector((0, 0.045, 0)), "plastic-black", 0.004, "actuator")]
    for d in (Vector((0.04, 0, 0)), Vector((0, 0, 0.04)), Vector((0, 0, -0.04))):
        parts.append(cyl(0.012, 0.03, VALVE + d, "X" if d.x else "Z", "aluminium-cast", name="port"))
    return finish("coolant-valve", parts)


def heater():
    parts = [bx((0.12, 0.08, 0.1), HEATER, "aluminium-cast", 0.004, "block"), bx((0.03, 0.03, 0.035), HEATER + Vector((-0.06, 0.02, 0.03)), "hv-orange", 0.003, "hv")]
    for dz in (-0.03, 0.03):
        parts.append(cyl(0.011, 0.04, HEATER + Vector((0.07, -0.02, dz)), "X", "aluminium-cast", name="stub"))
    # hose to the valve's side port, over the chiller
    parts.append(pipe([HEATER + Vector((-0.03, 0.04, 0.03)), (1.85, 0.56, -0.17), VALVE + Vector((0.055, 0, 0))], 0.01, "rubber", "hose"))
    return finish("coolant-heater", parts)


def chiller():
    plates = transform(box(0.12, 0.08, 0.08), Matrix.Translation(CHILLER))
    for i in range(9):
        merge_into(plates, transform(box(0.122, 0.002, 0.082), Matrix.Translation(CHILLER + Vector((0, -0.036 + 0.009 * i, 0)))))
    parts = [obj("plates", plates, "aluminium-machined", 0.001), bx((0.03, 0.03, 0.04), CHILLER + Vector((0.035, 0.055, 0)), "aluminium-cast", 0.003, "expansion-valve")]
    for dx in (-0.035, 0.0):
        for dz in (-0.025, 0.025):
            parts.append(cyl(0.009, 0.02, CHILLER + Vector((dx, 0.05, dz)), "Y", "aluminium-cast", name="port"))
    return finish("battery-chiller", parts)


def compressor():
    parts = [cyl(0.06, 0.16, COMPRESSOR, "X", "aluminium-cast", 48, "scroll"), bx((0.1, 0.04, 0.09), COMPRESSOR + Vector((0, 0.07, 0)), "aluminium-cast", 0.004, "inverter"),
             bx((0.03, 0.025, 0.03), COMPRESSOR + Vector((-0.06, 0.08, 0.03)), "hv-orange", 0.003, "hv"),
             cyl(0.012, 0.03, COMPRESSOR + Vector((0.09, 0.02, 0)), "X", "aluminium-cast", name="discharge"),
             cyl(0.014, 0.03, COMPRESSOR + Vector((-0.09, -0.02, 0)), "X", "aluminium-cast", name="suction")]
    return finish("heat-pump-compressor", parts)


def refrigerant_lines():
    r, m = 0.007, "aluminium-machined"
    lines = [
        # compressor discharge > under the fans > up in front of the condenser
        [COMPRESSOR + Vector((0.105, 0.02, 0)), (1.97, 0.44, 0.2), (2.12, 0.43, 0.3), (2.27, 0.43, 0.38), (2.27, 0.5, 0.4), (COND_X + 0.012, 0.52, 0.39)],
        # condenser outlet > under the fans > chiller's expansion valve
        [(COND_X + 0.012, 0.52, -0.39), (2.27, 0.5, -0.4), (2.27, 0.43, -0.38), (2.12, 0.43, -0.3), (1.95, 0.45, -0.15), CHILLER + Vector((0.07, 0.04, 0))],
        # chiller > compressor suction, under the ESC module and over the anti-roll bar
        [CHILLER + Vector((-0.04, 0.06, 0.03)), (1.8, 0.42, 0.0), (1.75, 0.43, 0.1), COMPRESSOR + Vector((-0.105, -0.02, 0))],
        # compressor > over the front drive unit > through the bulkhead > cabin climate module
        [COMPRESSOR + Vector((-0.06, 0.06, -0.05)), (1.71, 0.6, 0.06), (1.71, 0.93, 0.02), (1.1, 0.93, 0.02), (1.0, 0.8, 0.0), HVAC + Vector((0.0, 0.0, 0.0))],
    ]
    return finish("refrigerant-lines", [pipe(p, r, m) for p in lines])


def coolant_lines(axle: str):
    r, m = 0.011, "rubber"
    if axle == "front":
        lines = [
            [VALVE + Vector((0.0, 0.03, 0.0)), (1.73, 0.68, -0.15), (1.715, 0.76, -0.15), (1.70, 0.76, -0.15)],  # to the inverter's front face
            [VALVE + Vector((0.0, -0.03, 0.04)), (1.74, 0.27, -0.1), (1.48, 0.27, -0.03), (1.45, 0.33, 0.07), (1.452, 0.47, 0.07)],  # oil cooler, from below
        ]
    else:  # down from the valve, under the battery pack, in under the rear high-voltage harness to the rear drive unit
        trunk = [VALVE + Vector((0.0, -0.03, -0.04)), (1.74, 0.165, -0.18), (1.2, 0.165, 0.03), (-1.0, 0.165, 0.03), (-1.1, 0.3, 0.05), (-1.3, 0.3, 0.05)]
        lines = [
            trunk + [(-1.322, 0.3, 0.08), (-1.322, 0.5, 0.08), (-1.332, 0.5, 0.08)],  # oil cooler, through the gearbox wall
            [(v.x, v.y, v.z + 0.03) if isinstance(v, Vector) else (v[0], v[1], v[2] + 0.03) for v in trunk[1:-1]] + [(-1.3, 0.3, 0.02), (-1.335, 0.32, 0.02), (-1.335, 0.74, 0.02), (-1.372, 0.74, 0.02)],
        ]
    return finish(f"{axle}-coolant-lines", [pipe(p, r, m) for p in lines])


def build():
    kit.reset()
    parts = {
        "radiator": radiator(),
        "condenser": condenser(),
        "cooling-fan-l": fan(FANS[0], -1),
        "cooling-fan-r": fan(FANS[1], 1),
        "coolant-pump": coolant_pump(),
        "coolant-reservoir": reservoir(),
        "coolant-valve": valve(),
        "coolant-heater": heater(),
        "battery-chiller": chiller(),
        "heat-pump-compressor": compressor(),
        "refrigerant-lines": refrigerant_lines(),
        "front-coolant-lines": coolant_lines("front"),
        "rear-coolant-lines": coolant_lines("rear"),
        "coolant-lines": battery_coolant_lines(),
    }
    keep = {o.name for o in parts.values()}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    nodes = {}
    for pid, o in parts.items():
        kit.finish(o, pid)
        nodes[o.name] = pid
    out = ROOT / "web" / "assets-src" / "thermal.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    (ROOT / "web" / "public" / "assets" / "thermal.map.json").write_text(json.dumps({"asset": "thermal", "nodes": nodes}, indent=2) + "\n")
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts.values())
    print(f"thermal: {len(parts)} parts, {tris:,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    for pid, o in parts.items():
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        print(f"  {pid:22s} [{lo[0]:.3f} {lo[1]:.3f} {lo[2]:.3f}] .. [{hi[0]:.3f} {hi[1]:.3f} {hi[2]:.3f}]")


if __name__ == "__main__":
    build()
