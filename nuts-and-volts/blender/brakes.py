"""Brake supply (C3c step 4): pedal, electric booster, master cylinder with its fluid reservoir, the
stability-control (ESC) hydraulic unit and the four rigid brake lines to the corners' hoses.

Build with scripts/build-assets.sh. Writes web/assets-src/brakes.glb and web/public/assets/brakes.map.json.

  brake-pedal            pedal box bracket under the steering column, pedal arm and pad, pushrod through the bulkhead
  brake-booster          electric booster on the bulkhead: a ribbed body with its motor and gear housing
  master-cylinder        tandem master cylinder on the booster, with the two circuit pipes to the ESC module
  brake-fluid-reservoir  translucent reservoir on the master cylinder, with cap and level-sensor plug
  esc-module             valve block with the pump motor, the control unit and its connector, on a bracket
  brake-line-<corner>    coated steel lines from the ESC module to each corner's hose bracket (front: over the power
                         distribution unit; rear: down the bulkhead, along the gap between the battery pack and the
                         sill, then up inboard of the rear tyre)

Positions follow the parts around them: the bulkhead at x 1.04, the steering column and intermediate shaft, the
upper arms' pivots, and the hose brackets of blender/corner.py (0.17 m from the axle, 0.38 m up, 0.31 m inboard).
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
from kit import box, cylinder, lathe, merge_into, new_object, rod, transform  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HP = json.loads((ROOT / "web" / "src" / "vehicle" / "suspension.json").read_text())

Z = 0.29  # brake pedal, booster and master cylinder line (right-hand drive: inboard of the column)
BOOSTER = (1.065, 1.205)  # x span on the bulkhead
BOOSTER_Y, BOOSTER_R = 0.84, 0.075
MC = (1.205, 1.355)
ESC = Vector((1.84, 0.70, 0.05))
PEDAL_PIVOT = Vector((0.92, 0.66, Z))
PEDAL_PAD = Vector((0.82, 0.44, Z))


def obj(name, bm, mat, bevel=0.0, sharp=35.0):
    o = new_object(name, bm, mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    return kit.shade(o, sharp)


def along_x(prof, y, z, seg=48):
    """A lathe profile [(r, x)] turned about a line parallel to x through (y, z)."""
    return transform(lathe(prof, seg), Matrix.Translation((0, y, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))


def finish(name, parts):
    o = kit.join(name, parts)
    kit.box_uv(o, 6)
    return o


def hose_bracket(corner: str) -> Vector:
    """Where the corner's flexible hose starts (blender/corner.py brake_hose), for the corner's calliper side."""
    axle = HP["front" if corner[0] == "f" else "rear"]
    w = Vector(axle["wheel"])
    sx = math.copysign(1, math.cos(axle["caliperAngle"] - 0.42))
    side = -1 if corner[1] == "l" else 1
    return Vector((w.x + sx * 0.17, w.y + 0.38, side * (w.z - 0.31)))


def pedal():
    bracket = transform(box(0.09, 0.12, 0.08), Matrix.Translation(PEDAL_PIVOT + Vector((0.03, 0.03, 0))))
    arm = kit.tube_path([PEDAL_PIVOT, PEDAL_PIVOT.lerp(PEDAL_PAD, 0.5) + Vector((0.03, 0, 0)), PEDAL_PAD], 0, profile="rect", size=(0.018, 0.012))
    arm.data.materials.append(kit.material("steel-dark"))
    pad = transform(box(0.012, 0.075, 0.07), Matrix.Translation(PEDAL_PAD) @ Matrix.Rotation(0.35, 4, "Z"))
    push_from = PEDAL_PIVOT.lerp(PEDAL_PAD, 0.18)
    pushrod = rod(push_from, Vector((BOOSTER[0], BOOSTER_Y - 0.02, Z)), 0.006, 16)
    return finish("brake-pedal", [kit.shade(kit.bevel(obj("bracket", bracket, "steel-dark"), 0.003, 2), 35), kit.shade(arm, 40),
                                  kit.shade(obj("pad", pad, "rubber", 0.003), 35), obj("pushrod", pushrod, "steel-zinc")])


def booster():
    prof = [(0.0, BOOSTER[0]), (BOOSTER_R - 0.01, BOOSTER[0]), (BOOSTER_R, BOOSTER[0] + 0.012)]
    for i in range(5):  # ribs round the body
        x = BOOSTER[0] + 0.025 + i * 0.024
        prof += [(BOOSTER_R, x), (BOOSTER_R + 0.004, x + 0.006), (BOOSTER_R, x + 0.012)]
    prof += [(BOOSTER_R, BOOSTER[1] - 0.012), (BOOSTER_R - 0.012, BOOSTER[1]), (0.0, BOOSTER[1])]
    body = along_x(prof, BOOSTER_Y, Z)
    motor = transform(cylinder(0.035, 0.11, 40), Matrix.Translation((1.15, BOOSTER_Y - 0.06, Z - 0.075)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    gear = transform(box(0.06, 0.05, 0.06), Matrix.Translation((1.12, BOOSTER_Y - 0.045, Z - 0.05)))
    plug = transform(box(0.03, 0.02, 0.025), Matrix.Translation((1.18, BOOSTER_Y - 0.06, Z - 0.115)))
    studs = bmesh.new()
    for a in (0.6, 2.2, 3.8, 5.4):
        merge_into(studs, transform(cylinder(0.005, 0.03, 12), Matrix.Translation((BOOSTER[0] - 0.012, BOOSTER_Y + 0.05 * math.sin(a), Z + 0.05 * math.cos(a))) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    return finish("brake-booster", [kit.shade(kit.cast_finish(obj("body", body, "aluminium-cast"), 0.002, 4, 0.3), 40),
                                    kit.shade(obj("motor", motor, "steel-dark", 0.002), 40), kit.shade(obj("gear", gear, "aluminium-cast", 0.004), 35),
                                    kit.shade(obj("plug", plug, "plastic-black", 0.002), 35), obj("studs", studs, "steel-zinc")])


def master_cylinder():
    y = BOOSTER_Y + 0.02
    body = along_x([(0.0, MC[0]), (0.05, MC[0]), (0.05, MC[0] + 0.012), (0.026, MC[0] + 0.016), (0.026, MC[1] - 0.01), (0.02, MC[1]), (0.0, MC[1])], y, Z)
    ports = bmesh.new()
    for x in (MC[0] + 0.05, MC[0] + 0.1):  # inlet bosses for the reservoir, outlet bosses for the circuits
        merge_into(ports, transform(cylinder(0.011, 0.025, 24), Matrix.Translation((x, y + 0.03, Z))))
        merge_into(ports, transform(cylinder(0.009, 0.02, 24), Matrix.Translation((x, y, Z - 0.03))))
    pipes = []
    for k, x in enumerate((MC[0] + 0.05, MC[0] + 0.1)):  # two circuits to the ESC module, above the upper arm's pivots
        dz = 0.012 * k
        pts = [Vector((x, y - 0.006, Z - 0.04)), Vector((x + 0.03, y - 0.02, Z - 0.09 + dz)), Vector((1.6, 0.92, 0.2 + dz)),
               Vector((1.78, 0.86, 0.06 + dz)), Vector((ESC.x - 0.03, ESC.y + 0.05, ESC.z - 0.01 + dz))]
        p = kit.tube_path(pts, 0.0028, 3)
        p.data.materials.append(kit.material("steel-zinc"))
        pipes.append(kit.shade(p, 60))
    return finish("master-cylinder", [kit.shade(kit.cast_finish(obj("body", body, "aluminium-cast"), 0.0015, 4, 0.3), 40),
                                      obj("ports", ports, "aluminium-cast", 0.001), *pipes])


def reservoir():
    y0 = BOOSTER_Y + 0.02 + 0.045
    tank = transform(box(0.11, 0.06, 0.07), Matrix.Translation(((MC[0] + MC[1]) / 2 - 0.005, y0 + 0.03, Z)))
    neck = transform(cylinder(0.018, 0.02, 32), Matrix.Translation(((MC[0] + MC[1]) / 2 - 0.03, y0 + 0.07, Z)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    cap = transform(cylinder(0.024, 0.016, 32), Matrix.Translation(((MC[0] + MC[1]) / 2 - 0.03, y0 + 0.087, Z)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    plug = transform(box(0.02, 0.02, 0.02), Matrix.Translation((MC[1] - 0.02, y0 + 0.02, Z + 0.04)))
    return finish("brake-fluid-reservoir", [kit.shade(kit.bevel(obj("tank", tank, "plastic-reservoir"), 0.008, 3), 35), obj("neck", neck, "plastic-reservoir", 0.001),
                                            kit.shade(obj("cap", cap, "plastic-black", 0.002), 40), kit.shade(obj("plug", plug, "plastic-black", 0.002), 35)])


def esc_module():
    block = transform(box(0.11, 0.09, 0.1), Matrix.Translation(ESC))
    motor = transform(cylinder(0.035, 0.06, 40), Matrix.Translation(ESC + Vector((0.07, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
    ecu = transform(box(0.03, 0.1, 0.12), Matrix.Translation(ESC - Vector((0.07, 0, 0))))
    conn = transform(box(0.025, 0.04, 0.05), Matrix.Translation(ESC + Vector((-0.07, -0.065, 0.02))))
    bracket = transform(box(0.14, 0.012, 0.14), Matrix.Translation(ESC - Vector((0, 0.055, 0))))
    fittings = bmesh.new()
    for i in range(6):  # two inlets from the master cylinder, four outlets to the corners
        a = Vector((-0.04 + 0.016 * i, 0.045, -0.02 + 0.01 * (i % 2)))
        merge_into(fittings, transform(cylinder(0.006, 0.012, 6), Matrix.Translation(ESC + a)))
    return finish("esc-module", [kit.shade(kit.bevel(obj("block", block, "aluminium-machined"), 0.003, 2), 30),
                                 kit.shade(obj("motor", motor, "steel-dark", 0.002), 40), kit.shade(kit.bevel(obj("ecu", ecu, "plastic-black"), 0.004, 2), 35),
                                 kit.shade(obj("conn", conn, "plastic-black", 0.002), 35), kit.shade(obj("bracket", bracket, "steel-dark", 0.002), 35),
                                 obj("fittings", fittings, "steel-zinc")])


def brake_line(corner: str):
    s = -1 if corner[1] == "l" else 1
    end = hose_bracket(corner)
    start = ESC + Vector((-0.04 + 0.016 * "fl fr rl rr".split().index(corner) + 0.032, 0.05, 0))
    if corner[0] == "f":  # over the power distribution unit and 12 V battery, under the upper arm, to the hose bracket
        pts = [start, start + Vector((0, 0.03, 0)), Vector((1.77, 0.75, s * 0.25)), Vector((1.78, 0.76, s * 0.42)), end + Vector((0.02, 0.0, -s * 0.03)), end]
    else:
        # back over the front drive unit, down in front of the bulkhead, under the cabin floor between the pack and the
        # sill, up ahead of the rear wheel inboard of its arch, then over the tyre (inboard of its sweep) to the bracket
        pts = [start, start + Vector((0, 0.1, 0)), Vector((1.7, 0.86, s * 0.12)), Vector((1.12, 0.86, s * 0.12)), Vector((1.12, 0.40, s * 0.12)),
               Vector((1.1, 0.38, s * 0.5)), Vector((1.0, 0.365, s * 0.69)), Vector((-0.99, 0.365, s * 0.69)), Vector((-1.03, 0.37, s * 0.625)),
               Vector((-1.1, 0.4, s * 0.625)), Vector((-1.12, 0.8, s * 0.625)), Vector((end.x + 0.06, 0.8, s * 0.6)), end]
    line = kit.tube_path(pts, 0.0028, 3)
    line.data.materials.append(kit.material("steel-zinc"))
    clips = bmesh.new()
    for a, b in zip(pts[1:-1], pts[2:]):
        m = a.lerp(b, 0.5)
        merge_into(clips, transform(box(0.012, 0.012, 0.012), Matrix.Translation(m)))
    return finish(f"brake-line-{corner}", [kit.shade(line, 60), obj("clips", clips, "plastic-black", 0.001)])


def build():
    kit.reset()
    parts = {
        "brake-pedal": pedal(),
        "brake-booster": booster(),
        "master-cylinder": master_cylinder(),
        "brake-fluid-reservoir": reservoir(),
        "esc-module": esc_module(),
        **{f"brake-line-{c}": brake_line(c) for c in ("fl", "fr", "rl", "rr")},
    }
    keep = {o.name for o in parts.values()}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    nodes = {}
    for pid, o in parts.items():
        kit.finish(o, pid)
        nodes[o.name] = pid
    out = ROOT / "web" / "assets-src" / "brakes.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    (ROOT / "web" / "public" / "assets" / "brakes.map.json").write_text(json.dumps({"asset": "brakes", "nodes": nodes}, indent=2) + "\n")
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts.values())
    print(f"brakes: {len(parts)} parts, {tris:,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    for pid, o in parts.items():
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        print(f"  {pid:24s} [{lo[0]:.3f} {lo[1]:.3f} {lo[2]:.3f}] .. [{hi[0]:.3f} {hi[1]:.3f} {hi[2]:.3f}]")


if __name__ == "__main__":
    build()
