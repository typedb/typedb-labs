"""Front and rear subframes, their rubber body mounts and the anti-roll bars (C3c step 2).

Build with scripts/build-assets.sh. Writes web/assets-src/chassis.glb and web/public/assets/chassis.map.json.

Both cradles share one layout, written in "front-relative" coordinates: dx is measured from the axle, positive
towards the front of the car at the front axle and rearwards at the rear (x = axle - dx), so each cradle's
lower-arm bushes sit either side of its axle. The suspension hard points (anti-roll-bar axis and ends, toe-link
inner joints) come from web/src/vehicle/suspension.json, shared with blender/corner.py and the motion checks.

  subframe   cast cradle: two side members, three cross members (front, centre under the drive unit, rear with
             the anti-roll-bar clamps), clevis brackets either side of each lower-arm bush, pads under the
             drive-unit mounts, and at the rear tall brackets for the toe links' inner joints
  mounts     four rubber body mounts per subframe at its corners, each with a spacer tube up to the body
             (the chassis rail at the front and at the rear-most pair; the floor at the rear's front pair)
  anti-roll  bent steel bar with flattened eyes for the drop links, rubber bushes in steel clamps on the cradle

Positions follow web/src/vehicle/dimensions.ts and the corners' pickup points (blender/corner.py).
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
FRONT_X, REAR_X = 1.58, -1.45

# Shared layout (front-relative dx, metres)
SIDE_Z = 0.33  # side members' centre lines
Y0, Y1 = 0.20, 0.25  # cradle bottom and top
ARM_DX, ARM_Y, ARM_Z = 0.17, 0.24, 0.40  # lower-arm inner bushes (blender/corner.py wishbone)
EYE_HALF = 0.028  # half the arm eye's length
CROSS = dict(front=0.26, rear=-0.28)  # front and rear cross members
HARD_POINTS = json.loads((ROOT / "web" / "src" / "vehicle" / "suspension.json").read_text())
ARB_BEND_Z, ARB_BUSH_Z = 0.38, 0.30  # where the bar bends towards its ends, and its rubber bushes


def rel(axle: str, x: float, y: float, z: float):
    """Vehicle coordinates -> front-relative (dx, y, z) for this axle."""
    return (x - FRONT_X if axle == "front" else REAR_X - x, y, z)


def arb(axle: str):
    """The anti-roll bar's axis (front-relative dx, y) and the drop link's lower joint (front-relative)."""
    hp = HARD_POINTS[axle]
    dx, y, _ = rel(axle, hp["arbAxis"][0], hp["arbAxis"][1], 0)
    return dx, y, rel(axle, *hp["dropLower"])
MOUNT_DX, MOUNT_Z = 0.30, 0.36  # inboard of the tyre's sweep at full lock (C3c step 2)
# drive-unit mount pads (dx, z): blender/drive_unit.py mount()
DU_PADS = dict(front=[(-0.03, -0.22), (-0.04, 0.125), (0.21, 0.175)], rear=[(0.10, -0.235), (-0.04, 0.125), (0.21, 0.175)])
# body attachment height (mount at -dx, mount at +dx): brackets under the body, clear of the steering column, cables and
# coolant line above them (the body milestone designs the brackets: docs/c3c/body-interfaces.md)
MOUNT_TOP = dict(front=(0.35, 0.45), rear=(0.35, 0.45))


def obj(name, bm, mat, bevel=0.0, sharp=35.0):
    o = new_object(name, bm, mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    return kit.shade(o, sharp)


def place(axle: str):
    """Front-relative (dx, y, z) -> vehicle coordinates for this axle."""
    if axle == "front":
        return lambda dx, y, z: Vector((FRONT_X + dx, y, z))
    return lambda dx, y, z: Vector((REAR_X - dx, y, z))


def bar(p, a: Vector, b: Vector, w: float, h: float) -> bmesh.types.BMesh:
    """A rectangular-section member from a to b (front-relative points), w across, h tall."""
    pa, pb = p(*a), p(*b)
    d = pb - pa
    m = Matrix.Translation((pa + pb) / 2) @ Vector((1, 0, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    return transform(box(d.length, h, w), m)


def subframe(axle: str):
    p = place(axle)
    yc, h = (Y0 + Y1) / 2, Y1 - Y0
    bm = bmesh.new()
    xf, xr = CROSS["front"], CROSS["rear"]
    for s in (-1, 1):  # side members, kinked outwards at the ends towards the body mounts
        merge_into(bm, bar(p, (xr, yc, s * SIDE_Z), (xf, yc, s * SIDE_Z), 0.06, h))
        for dx in (xr, xf):
            merge_into(bm, bar(p, (dx, yc, s * SIDE_Z), (dx + (0.04 if dx > 0 else -0.02), yc, s * MOUNT_Z), 0.07, h))
    for dx in (xf, xr):  # front and rear cross members
        merge_into(bm, bar(p, (dx, yc, -SIDE_Z), (dx, yc, SIDE_Z), 0.07, h))
    pads = DU_PADS[axle]
    c = sum(dx for dx, _ in pads[:2]) / 2
    w = abs(pads[0][0] - pads[1][0]) + 0.09
    merge_into(bm, bar(p, (c, yc, -SIDE_Z), (c, yc, SIDE_Z), w, h))  # centre cross member under the drive unit
    for dx, z in pads:  # machined pads under the drive-unit mounts
        merge_into(bm, transform(box(0.09, 0.006, 0.08), Matrix.Translation(p(dx, Y1 - 0.003, z))))
    dx3, z3 = pads[2]  # torque-rod bracket from the front cross member
    merge_into(bm, bar(p, (xf, yc, z3), (dx3, yc, z3), 0.05, h))
    for s in (-1, 1):
        for dx in (-ARM_DX, ARM_DX):  # clevis brackets either side of each lower-arm bush
            for side in (-1, 1):
                # from the side member out to just past the bush's eye (clear of the tyre at full lock)
                z0, z1 = SIDE_Z - 0.015, ARM_Z + 0.03
                q = p(dx + side * (EYE_HALF + 0.012), (Y0 + ARM_Y + 0.035) / 2, s * (z0 + z1) / 2)
                merge_into(bm, transform(box(0.008, ARM_Y + 0.035 - Y0, z1 - z0), Matrix.Translation(q)))
        # anti-roll-bar clamp pedestal on the cross member under the bar
        adx, ay, _ = arb(axle)
        merge_into(bm, transform(box(0.05, ay - 0.018 - Y1 + 0.004, 0.06), Matrix.Translation(p(adx, (Y1 + ay - 0.018) / 2, s * ARB_BUSH_Z))))
        if axle == "rear":  # toe-link brackets: two plates rising to the toe link's inner joint
            tdx, ty, tz = rel(axle, *HARD_POINTS["rear"]["linkInner"])
            for side in (-1, 1):
                q = p(tdx + side * 0.024, (Y1 + ty + 0.02) / 2, s * (SIDE_Z + tz) / 2 + s * 0.01)
                merge_into(bm, transform(box(0.008, ty + 0.02 - Y1, tz - SIDE_Z + 0.04), Matrix.Translation(q)))
    cradle = obj(f"{axle}-subframe-cradle", bm, "aluminium-cast", 0.003, 40)
    # bolts through the arm bushes and the toe-link joints' clevises
    bolts = bmesh.new()
    for s in (-1, 1):
        for dx in (-ARM_DX, ARM_DX):
            q = p(dx, ARM_Y, s * ARM_Z)
            merge_into(bolts, transform(cylinder(0.0065, 2 * (EYE_HALF + 0.022), 16), Matrix.Translation(q) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    o = kit.join(f"{axle}-subframe", [cradle, obj("bolts", bolts, "steel-zinc")])
    kit.box_uv(o, 6)
    return o


def body_mount(axle: str, n: int):
    """Rubber body mount: a bush in a cast housing on the subframe's corner, a spacer tube to the body and a
    through-bolt with washer. n: 1 front-left, 2 front-right, 3 rear-left, 4 rear-right (by vehicle position)."""
    p = place(axle)
    # vehicle-forward first: at the front axle +dx is forward; at the rear -dx is forward
    fwd = 1 if axle == "front" else -1
    dx = fwd * MOUNT_DX if n in (1, 2) else -fwd * MOUNT_DX
    s = -1 if n in (1, 3) else 1
    top = MOUNT_TOP[axle][0 if dx < 0 else 1]
    c = p(dx + (0.04 if dx > 0 else -0.02), (Y0 + Y1) / 2, s * MOUNT_Z)
    housing = transform(lathe([(0.02, -0.03), (0.04, -0.03), (0.04, 0.03), (0.02, 0.03)], 48), Matrix.Translation(c) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    rubber = transform(lathe([(0.01, -0.033), (0.02, -0.03), (0.02, 0.03), (0.01, 0.033)], 48), Matrix.Translation(c) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    spacer = rod(c + Vector((0, 0.033, 0)), Vector((c.x, top - 0.003, c.z)), 0.016, 24)
    washer = transform(cylinder(0.03, 0.004, 32), Matrix.Translation(c - Vector((0, 0.036, 0))) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    head = transform(cylinder(0.012, 0.01, 6), Matrix.Translation(c - Vector((0, 0.043, 0))) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    o = kit.join(f"{axle}-subframe-mount-{n}", [obj("housing", housing, "aluminium-cast", 0.001), obj("rubber", rubber, "rubber"),
                                               obj("spacer", spacer, "steel-dark"), obj("washer", washer, "steel-zinc"), obj("head", head, "steel-zinc")])
    kit.box_uv(o, 6)
    return o


def anti_roll_bar(axle: str):
    """Tubular anti-roll bar: a straight centre across the cradle, bends at both ends rising to flattened eyes
    for the drop links, and rubber bushes in steel clamps on a cradle cross member."""
    p = place(axle)
    adx, ay, (ex, ey, ez) = arb(axle)
    toward = math.copysign(0.04, ex - adx)  # the bends lean towards the ends
    pts = [p(ex, ey, -ez), p(adx + toward, ay + 0.01, -ARB_BEND_Z - 0.02), p(adx, ay, -ARB_BEND_Z + 0.04),
           p(adx, ay, ARB_BEND_Z - 0.04), p(adx + toward, ay + 0.01, ARB_BEND_Z + 0.02), p(ex, ey, ez)]
    tube = kit.tube_path(pts, 0.012, 6)
    tube.data.materials.append(kit.material("spring-paint"))
    eyes = bmesh.new()
    for s in (-1, 1):
        q = p(ex, ey, s * ez)
        merge_into(eyes, transform(cylinder(0.02, 0.012, 32), Matrix.Translation(q) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    bushes = bmesh.new()
    clamps = bmesh.new()
    for s in (-1, 1):
        q = p(adx, ay, s * ARB_BUSH_Z)
        merge_into(bushes, transform(lathe([(0.0125, -0.022), (0.022, -0.02), (0.022, 0.02), (0.0125, 0.022)], 32), Matrix.Translation(q)))
        merge_into(clamps, transform(lathe([(0.022, -0.016), (0.026, -0.016), (0.026, 0.016), (0.022, 0.016)], 32), Matrix.Translation(q)))
        for side in (-1, 1):
            merge_into(clamps, transform(box(0.012, 0.006, 0.032), Matrix.Translation(q + Vector((side * 0.032, -0.016, 0)))))
    o = kit.join(f"{axle}-anti-roll-bar", [kit.shade(tube, 60), obj("eyes", eyes, "steel-dark", 0.001), obj("bushes", bushes, "rubber"),
                                          obj("clamps", clamps, "steel-zinc")])
    kit.box_uv(o, 6)
    return o


def build():
    kit.reset()
    parts = {}
    for axle in ("front", "rear"):
        parts[f"{axle}-subframe"] = subframe(axle)
        parts[f"{axle}-anti-roll-bar"] = anti_roll_bar(axle)
        for n in (1, 2, 3, 4):
            parts[f"{axle}-subframe-mount-{n}"] = body_mount(axle, n)
    keep = {o.name for o in parts.values()}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    nodes = {}
    for pid, o in parts.items():
        kit.finish(o, pid)
        nodes[o.name] = pid
    out = ROOT / "web" / "assets-src" / "chassis.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    (ROOT / "web" / "public" / "assets" / "chassis.map.json").write_text(json.dumps({"asset": "chassis", "nodes": nodes}, indent=2) + "\n")
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts.values())
    print(f"chassis: {len(parts)} parts, {tris:,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    for pid, o in parts.items():
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        print(f"  {pid:24s} [{lo[0]:.3f} {lo[1]:.3f} {lo[2]:.3f}] .. [{hi[0]:.3f} {hi[1]:.3f} {hi[2]:.3f}]")


if __name__ == "__main__":
    build()
