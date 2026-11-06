"""The steering system (C3c step 3): rack, rack mounts, power-steering motor and control module, torque sensor,
intermediate shaft and column. The steering wheel stays a simple shape in the app.

Build with scripts/build-assets.sh. Writes web/assets-src/steering.glb and web/public/assets/steering.map.json.

  rack          cast housing across the subframe, rubber bellows to the tie rods' inner joints (the tie rods are part
                of the corner models), the pinion housing on the driver's side (right-hand drive) and the ball-nut
                housing the motor's belt drives
  rack mounts   cast brackets rising from the subframe's rear cross member, with rubber bushes clamped round the rack
  motor, module rack-parallel electric motor behind the rack, a belt cover joining it to the ball-nut housing, and
                the control module on the motor's inner end
  torque sensor ring housing on top of the pinion housing, with its connector
  shaft, column  intermediate shaft from the pinion through the bulkhead (rubber seal) to the column, with a universal
                joint at each end; column jacket from the steering wheel down to the upper joint, bracket to the
                cross-car beam

Positions follow web/src/vehicle/suspension.json (the tie rods' inner joints) and the parts around them: the front
drive unit ahead of the rack, the brake booster above the shaft, the bulkhead it passes through.
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
HP = json.loads((ROOT / "web" / "src" / "vehicle" / "suspension.json").read_text())["front"]

RACK_X, RACK_Y, RACK_END = HP["linkInner"][0], HP["linkInner"][1], HP["linkInner"][2]  # tie rods' inner joints at +/-RACK_END
HOUSING_END = 0.36  # the housing ends here; bellows carry on to the joints
PINION_Z = 0.30  # pinion on the driver's side (right-hand drive)
NUT_Z = (0.09, 0.19)  # ball-nut housing driven by the motor's belt
MOTOR = Vector((RACK_X - 0.08, RACK_Y - 0.045, 0.0))  # motor axis (parallel to the rack), behind and below it
MOTOR_Z = (0.06, 0.19)
MOUNT_Z = {-1: 0.285, 1: 0.228}  # rack mounts: the left one outboard of the front motor, the right one between the ball nut and the pinion
SUBFRAME_TOP, CROSS_X = 0.25, 1.30  # front subframe's top and its rear cross member (blender/chassis.py)
UJ_LOW = Vector((RACK_X, RACK_Y + 0.13, PINION_Z))  # lower universal joint, above the torque sensor
UJ_HIGH = Vector((0.95, 0.73, 0.37))  # upper universal joint, under the dashboard, below the brake booster
WHEEL_HUB = Vector((0.605, 0.968, 0.37))  # where the column meets the steering wheel
BULKHEAD_X = 1.045


def obj(name, bm, mat, bevel=0.0, sharp=35.0):
    o = new_object(name, bm, mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    return kit.shade(o, sharp)


def along_z(prof, x, y, seg=48):
    """A lathe profile [(r, z)] turned about a line parallel to z through (x, y)."""
    return transform(lathe(prof, seg), Matrix.Translation((x, y, 0)))


def bellows(z0: float, z1: float, r0=0.02, r1=0.031, pleats=10):
    s = 1 if z1 > z0 else -1
    prof = [(0.0, z0), (r0, z0)]
    for i in range(pleats * 2 + 1):
        t = i / (pleats * 2)
        prof.append((r1 if i % 2 else r1 - 0.007, z0 + (z1 - z0) * t))
    prof += [(r0 - 0.004, z1), (0.0, z1)]
    if s < 0:
        prof = [(r, z) for r, z in reversed(prof)]
    return along_z(prof, RACK_X, RACK_Y)


def rack():
    housing = along_z([(0.0, -HOUSING_END), (0.028, -HOUSING_END), (0.028, HOUSING_END), (0.0, HOUSING_END)], RACK_X, RACK_Y)
    merge_into(housing, along_z([(0.0, NUT_Z[0]), (0.047, NUT_Z[0] + 0.01), (0.05, (NUT_Z[0] + NUT_Z[1]) / 2), (0.047, NUT_Z[1] - 0.01), (0.0, NUT_Z[1])], RACK_X, RACK_Y))
    for z in (-HOUSING_END, HOUSING_END):  # end collars
        merge_into(housing, along_z([(0.0, z - 0.012), (0.033, z - 0.012), (0.033, z + 0.012), (0.0, z + 0.012)], RACK_X, RACK_Y))
    for z in (-MOUNT_Z[-1], MOUNT_Z[1]):  # bosses the mounts clamp
        merge_into(housing, along_z([(0.0, z - 0.03), (0.032, z - 0.03), (0.032, z + 0.03), (0.0, z + 0.03)], RACK_X, RACK_Y))
    # pinion housing: a boss on top, rising to the torque sensor
    merge_into(housing, transform(cylinder(0.034, 0.075, 40), Matrix.Translation((RACK_X, RACK_Y + 0.035, PINION_Z)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    body = kit.cast_finish(obj("rack-housing", housing, "aluminium-cast"), 0.002, 6, 0.3)
    boots = bmesh.new()
    for s in (-1, 1):
        merge_into(boots, bellows(s * (HOUSING_END + 0.006), s * (RACK_END - 0.022)))
    bolts = bmesh.new()
    for z in (NUT_Z[0] + 0.02, NUT_Z[1] - 0.02):
        for a in (0.6, 2.5, 4.4):
            merge_into(bolts, transform(cylinder(0.005, 0.012, 6), Matrix.Translation((RACK_X + 0.047 * math.cos(a), RACK_Y + 0.047 * math.sin(a), z)) @ kit.align_z(Vector((math.cos(a), math.sin(a), 0)))))
    o = kit.join("steering-rack", [kit.shade(body, 40), obj("bellows", boots, "rubber", 0, 60), obj("bolts", bolts, "steel-zinc")])
    kit.box_uv(o, 6)
    return o


def rack_mount(side: int):
    """Cast bracket from the subframe's rear cross member up to the rack, with a rubber bush and a clamp strap."""
    z = side * MOUNT_Z[side]
    base = Vector((CROSS_X, SUBFRAME_TOP, z))
    top = Vector((RACK_X - 0.01, RACK_Y - 0.035, z))
    bm = bmesh.new()
    merge_into(bm, transform(box(0.08, 0.012, 0.05), Matrix.Translation(base + Vector((0, 0.006, 0)))))  # foot on the cross member
    d = top - base
    merge_into(bm, transform(box(0.024, d.length, 0.05), Matrix.Translation((base + top) / 2) @ Vector((0, 1, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()))
    merge_into(bm, along_z([(0.0, z - 0.028), (0.046, z - 0.028), (0.046, z + 0.028), (0.0, z + 0.028)], RACK_X, RACK_Y))  # lower half of the clamp
    bracket = kit.cast_finish(obj("mount-bracket", bm, "aluminium-cast"), 0.0018, 5, 0.3)
    bore = obj("bore", along_z([(0.0, z - 0.04), (0.034, z - 0.04), (0.034, z + 0.04), (0.0, z + 0.04)], RACK_X, RACK_Y), "aluminium-cast")
    bracket = kit.cut(bracket, bore)
    bush = obj("bush", along_z([(0.033, z - 0.026), (0.042, z - 0.026), (0.042, z + 0.026), (0.033, z + 0.026)], RACK_X, RACK_Y), "rubber")
    strap = obj("strap", along_z([(0.043, z - 0.018), (0.049, z - 0.018), (0.049, z + 0.018), (0.043, z + 0.018)], RACK_X, RACK_Y), "steel-dark", 0.0006)
    bolts = bmesh.new()
    for dx in (-0.03, 0.03):
        merge_into(bolts, transform(cylinder(0.008, 0.008, 6), Matrix.Translation(base + Vector((dx, 0.016, 0)))))
    o = kit.join(f"steering-rack-mount-{'l' if side < 0 else 'r'}", [kit.shade(bracket, 40), bush, strap, obj("bolts", bolts, "steel-zinc")])
    kit.box_uv(o, 6)
    return o


def eps_motor():
    """Rack-parallel motor with a finned can, its belt cover to the ball-nut housing, and the phase connector."""
    can = along_z([(0.0, MOTOR_Z[0]), (0.04, MOTOR_Z[0]), (0.043, MOTOR_Z[0] + 0.01), (0.043, MOTOR_Z[1] - 0.01), (0.04, MOTOR_Z[1]), (0.0, MOTOR_Z[1])], MOTOR.x, MOTOR.y)
    fins = bmesh.new()
    for i in range(12):
        a = math.tau * i / 12
        merge_into(fins, transform(box(0.006, 0.006, MOTOR_Z[1] - MOTOR_Z[0] - 0.03),
                                   Matrix.Translation((MOTOR.x + 0.045 * math.cos(a), MOTOR.y + 0.045 * math.sin(a), (MOTOR_Z[0] + MOTOR_Z[1]) / 2)) @ Matrix.Rotation(a, 4, "Z")))
    # belt cover: a rounded slab enclosing both pulleys at the motor's outer end
    zc = MOTOR_Z[1] + 0.014
    cover = along_z([(0.0, zc - 0.014), (0.05, zc - 0.014), (0.05, zc + 0.014), (0.0, zc + 0.014)], MOTOR.x, MOTOR.y)
    merge_into(cover, along_z([(0.0, zc - 0.014), (0.055, zc - 0.014), (0.055, zc + 0.014), (0.0, zc + 0.014)], RACK_X, RACK_Y))
    a, b = Vector((MOTOR.x, MOTOR.y, zc)), Vector((RACK_X, RACK_Y, zc))
    d = b - a
    merge_into(cover, transform(box(d.length, 0.1, 0.028), Matrix.Translation((a + b) / 2) @ Vector((1, 0, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()))
    plug = kit.bevel(new_object("plug", transform(box(0.03, 0.02, 0.025), Matrix.Translation((MOTOR.x - 0.04, MOTOR.y + 0.03, MOTOR_Z[0] + 0.04))), "plastic-black"), 0.002, 2)
    o = kit.join("eps-motor", [kit.shade(kit.cast_finish(obj("can", can, "aluminium-cast"), 0.0015, 4, 0.25), 40), obj("fins", fins, "aluminium-cast"),
                              kit.shade(kit.bevel(obj("belt-cover", cover, "plastic-black"), 0.003, 2), 40), kit.shade(plug, 40)])
    kit.box_uv(o, 6)
    return o


def steering_ecu():
    """The control module on the motor's inner end: a finned aluminium case with two connectors."""
    z0 = MOTOR_Z[0] - 0.055
    case = transform(box(0.1, 0.1, 0.05), Matrix.Translation((MOTOR.x, MOTOR.y, z0 + 0.025)))
    for k in range(6):
        merge_into(case, transform(box(0.09, 0.004, 0.006), Matrix.Translation((MOTOR.x, MOTOR.y - 0.04 + 0.016 * k, z0 - 0.002))))
    conn = bmesh.new()
    for dy in (-0.02, 0.025):
        merge_into(conn, transform(box(0.025, 0.02, 0.03), Matrix.Translation((MOTOR.x - 0.06, MOTOR.y + dy, z0 + 0.025))))
    o = kit.join("steering-ecu", [kit.shade(kit.bevel(obj("case", case, "aluminium-cast"), 0.002, 2), 35), kit.shade(obj("connectors", conn, "plastic-black", 0.002), 35)])
    kit.box_uv(o, 6)
    return o


def torque_sensor():
    """Ring housing between the pinion housing and the lower universal joint, with a connector and harness tail."""
    y0 = RACK_Y + 0.072
    ring = transform(lathe([(0.012, 0.0), (0.04, 0.0), (0.042, 0.006), (0.042, 0.034), (0.04, 0.04), (0.012, 0.04)], 48),
                     Matrix.Translation((RACK_X, y0, PINION_Z)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    plug = transform(box(0.026, 0.022, 0.03), Matrix.Translation((RACK_X - 0.05, y0 + 0.02, PINION_Z)))
    cable = kit.tube_path([Vector((RACK_X - 0.065, y0 + 0.02, PINION_Z)), Vector((RACK_X - 0.1, y0 + 0.0, PINION_Z - 0.02)),
                           Vector((MOTOR.x - 0.03, MOTOR.y + 0.03, MOTOR_Z[0] - 0.03))], 0.004, 3)
    cable.data.materials.append(kit.material("plastic-black"))
    o = kit.join("steering-torque-sensor", [kit.shade(obj("ring", ring, "aluminium-cast", 0.001), 40), kit.shade(obj("plug", plug, "plastic-black", 0.002), 35), kit.shade(cable, 60)])
    kit.box_uv(o, 6)
    return o


def universal_joint(centre: Vector, a: Vector, b: Vector):
    """Two yokes and the cross between them, for shafts arriving along directions a and b."""
    parts = []
    for d, mat in ((a, "steel-machined"), (b, "steel-machined")):
        m = Matrix.Translation(centre) @ kit.align_z(d.normalized())
        yoke = transform(cylinder(0.017, 0.03, 32), m @ Matrix.Translation((0, 0, 0.028)))
        for s in (-1, 1):
            merge_into(yoke, transform(box(0.008, 0.02, 0.03), m @ Matrix.Translation((s * 0.014, 0, 0.008))))
        parts.append(obj("yoke", yoke, mat, 0.001))
    cross = transform(box(0.036, 0.008, 0.008), Matrix.Translation(centre))
    merge_into(cross, transform(box(0.008, 0.036, 0.008), Matrix.Translation(centre)))
    parts.append(obj("cross", cross, "steel-dark", 0.001))
    return parts


def intermediate_shaft():
    d = (UJ_HIGH - UJ_LOW).normalized()
    shaft = rod(UJ_LOW + d * 0.045, UJ_HIGH - d * 0.045, 0.011, 24)
    parts = [obj("shaft", shaft, "steel-dark")]
    parts += universal_joint(UJ_LOW, d, Vector((0, -1, 0)))
    col = (WHEEL_HUB - UJ_HIGH).normalized()
    parts += universal_joint(UJ_HIGH, -d, col)
    # rubber seal where the shaft passes the bulkhead
    t = (BULKHEAD_X - UJ_LOW.x) / (UJ_HIGH.x - UJ_LOW.x)
    p = UJ_LOW.lerp(UJ_HIGH, t)
    seal = transform(lathe([(0.011, -0.03), (0.02, -0.02), (0.03, 0.0), (0.03, 0.006), (0.011, 0.01)], 40), Matrix.Translation(p) @ kit.align_z(Vector((-1, 0, 0))))
    parts.append(obj("seal", seal, "rubber"))
    o = kit.join("steering-intermediate-shaft", [kit.shade(x, 40) for x in parts])
    kit.box_uv(o, 6)
    return o


def column():
    d = (WHEEL_HUB - UJ_HIGH).normalized()
    a, b = UJ_HIGH + d * 0.04, WHEEL_HUB
    jacket = rod(a + d * 0.06, b - d * 0.05, 0.03, 32)
    shaft = rod(a, b, 0.012, 24)
    # tilt-and-reach housing and a bracket up to the cross-car beam
    housing = transform(box(0.09, 0.07, 0.08), Matrix.Translation(a.lerp(b, 0.55)) @ kit.align_z(d))
    m = a.lerp(b, 0.5)
    beam = Vector((0.8, 0.92, m.z))
    bracket = transform(box(0.012, (beam - m).length, 0.07), Matrix.Translation((m + beam) / 2) @ Vector((0, 1, 0)).rotation_difference((beam - m).normalized()).to_matrix().to_4x4())
    o = kit.join("steering-column", [kit.shade(obj("jacket", jacket, "steel-dark"), 40), kit.shade(obj("shaft", shaft, "steel-machined"), 40),
                                     kit.shade(kit.bevel(obj("housing", housing, "aluminium-cast"), 0.004, 2), 35),
                                     kit.shade(kit.bevel(obj("bracket", bracket, "steel-dark"), 0.002, 2), 35)])
    kit.box_uv(o, 6)
    return o


def build():
    kit.reset()
    parts = {
        "steering-rack": rack(),
        "steering-rack-mount-l": rack_mount(-1),
        "steering-rack-mount-r": rack_mount(1),
        "eps-motor": eps_motor(),
        "steering-ecu": steering_ecu(),
        "steering-torque-sensor": torque_sensor(),
        "steering-intermediate-shaft": intermediate_shaft(),
        "steering-column": column(),
    }
    keep = {o.name for o in parts.values()}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    nodes = {}
    for pid, o in parts.items():
        kit.finish(o, pid)
        nodes[o.name] = pid
    out = ROOT / "web" / "assets-src" / "steering.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    (ROOT / "web" / "public" / "assets" / "steering.map.json").write_text(json.dumps({"asset": "steering", "nodes": nodes}, indent=2) + "\n")
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts.values())
    print(f"steering: {len(parts)} parts, {tris:,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    for pid, o in parts.items():
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        print(f"  {pid:28s} [{lo[0]:.3f} {lo[1]:.3f} {lo[2]:.3f}] .. [{hi[0]:.3f} {hi[1]:.3f} {hi[2]:.3f}]")


if __name__ == "__main__":
    build()
