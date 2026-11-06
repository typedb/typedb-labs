"""Body structure (D1.2): the body-in-white around the mechanical vehicle, to the interfaces in
docs/c3c/body-interfaces.md. Concept engineering for an original vehicle, simplified.

Build with scripts/build-assets.sh. Writes web/assets-src/body-structure.glb and
web/public/assets/body-structure.map.json.

Load paths, front to back:
  front-crash-beam > front-crash-box-<s> > front-rail-<s> > front-tower-<s> > (brace) > bulkhead > a-pillar-<s>
  front subframe mounts 1/2 on the front rails, 3/4 on the front floor rails > sills
  sill-<s> > a/b/c-pillar-<s> > roof-rail-<s> (headers and bows between the roof rails)
  cabin-floor (with the heel kick-up) > floor-crossmember-3 (rear subframe mounts 1/2) > rear-rail-<s>
  rear-rail-<s> > rear-tower-<s> > wheelhouse-r<s> > rear-floor (boot floor and back panel) > d-pillar-<s>
  rear subframe mounts 3/4 on the rear rails > rear-crash-box-<s> > rear-crash-beam

Kept clear (body-interfaces.md): the tyres' swept envelopes, the tie rods' sweep (the front rails stop ahead of
the rack and the towers rise beside it), the steering shaft, the brake booster and master cylinder, the drive
units, the battery pack and its pipe runs. The structure sits inside the provisional D1.1 exterior
(blender/exterior.py); the exterior is a separate, replaceable skin over it, so no part here depends on it.

Left parts mirror the right (z -> -z). Materials: "body-ecoat" (pressed steel in its grey e-coat), "aluminium-cast"
(the cast suspension towers), "aluminium-forged" (extruded crash boxes and beams).
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
from kit import merge_into, new_object, transform  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HP = json.loads((ROOT / "web" / "src" / "vehicle" / "suspension.json").read_text())
SIDES = (("l", -1), ("r", 1))
STEEL, CAST, EXTRUSION = "body-ecoat", "aluminium-cast", "aluminium-forged"
REAR_AXLE = HP["rear"]["wheel"][0]
ARCH_R = 0.52  # rear wheelhouse crown radius about the axle: tyre (0.405) + 80 mm bump + 35 mm
WHEELHOUSE_Z = 0.643  # inner wall: 15 mm inside the rear tyres' envelope (0.658), outboard of the brake lines' rise (0.625)


def V(x, y, z, s=1):
    return Vector((x, y, s * z))


# ---- geometry helpers ------------------------------------------------------------------------------------

def sweep(points: list[Vector], a: float, b: float, ref: Vector) -> bmesh.types.BMesh:
    """A closed rectangular section a x b swept along a polyline. `a` is measured along `ref` (projected square
    to the path), `b` across it."""
    bm = bmesh.new()
    rings = []
    n = len(points)
    for i, p in enumerate(points):
        t = (points[min(i + 1, n - 1)] - points[max(i - 1, 0)]).normalized()
        u = (ref - ref.dot(t) * t).normalized()
        v = t.cross(u)
        rings.append([bm.verts.new(p + u * (su * a / 2) + v * (sv * b / 2)) for su, sv in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(4):
            bm.faces.new((r0[k], r1[k], r1[(k + 1) % 4], r0[(k + 1) % 4]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def prism(outline: list[tuple[float, float]], axis: str, a0: float, a1: float) -> bmesh.types.BMesh:
    """A closed 2D outline extruded between a0 and a1 along `axis`. The outline's two coordinates are the other two
    axes in x, y, z order (axis "z": (x, y); axis "x": (y, z); axis "y": (x, z))."""
    def place(c, w):
        if axis == "z":
            return Vector((c[0], c[1], w))
        if axis == "x":
            return Vector((w, c[0], c[1]))
        return Vector((c[0], w, c[1]))
    bm = bmesh.new()
    lo = [bm.verts.new(place(c, a0)) for c in outline]
    hi = [bm.verts.new(place(c, a1)) for c in outline]
    bm.faces.new(lo)
    bm.faces.new(hi[::-1])
    m = len(outline)
    for i in range(m):
        k = (i + 1) % m
        bm.faces.new((lo[i], lo[k], hi[k], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def sheet(polyline: list[tuple[float, float]], thickness: float, axis: str, a0: float, a1: float) -> bmesh.types.BMesh:
    """A pressed panel: an open 2D polyline thickened to one side (its left) and extruded along `axis`."""
    pts = [Vector(p) for p in polyline]
    off = []
    for i in range(len(pts)):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        off.append(pts[i] + Vector((-t.y, t.x)) * thickness)
    outline = [tuple(p) for p in pts] + [tuple(p) for p in reversed(off)]
    return prism(outline, axis, a0, a1)


def box(lo, hi) -> bmesh.types.BMesh:
    lo, hi = Vector(lo), Vector(hi)
    return transform(kit.box(*(hi - lo)), Matrix.Translation((lo + hi) / 2))


def mirror(bm: bmesh.types.BMesh, s: int) -> bmesh.types.BMesh:
    if s < 0:
        transform(bm, Matrix.Diagonal((1, 1, -1, 1)))
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def ring_y(c: Vector, r0: float, r1: float, y0: float, y1: float, segments: int = 40) -> bmesh.types.BMesh:
    """A thick ring (tube wall) with a vertical axis, centred at c (x, z) between heights y0 and y1."""
    bm = kit.lathe([(r0, y0), (r1, y0), (r1, y1), (r0, y1)], segments)
    return transform(bm, Matrix.Translation((c.x, 0, c.z)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))


def disc_y(c: Vector, r: float, y0: float, y1: float, hole: float = 0.0, segments: int = 40) -> bmesh.types.BMesh:
    if hole:
        return ring_y(c, hole, r, y0, y1, segments)
    bm = kit.cylinder(r, y1 - y0, segments)
    return transform(bm, Matrix.Translation((c.x, (y0 + y1) / 2, c.z)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))


def part(name: str, pieces: list[bmesh.types.BMesh], mat: str, bevel: float = 0.0) -> bpy.types.Object:
    bm = bmesh.new()
    for p in pieces:
        merge_into(bm, p)
    o = new_object(name, bm, mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    o = kit.shade(o, 35.0)
    kit.box_uv(o, 3.0)
    return o


# ---- front structure ---------------------------------------------------------------------------------------

def front_rail(s: int):
    """Closed box rail from the crash box, inboard of the front tyre's sweep, over subframe mount 1/2 (spacer top
    y 0.45), below the 12 V battery / power distribution unit, ending in the tower's inboard wall at x 1.70: it
    stops short of the steering rack, tie rods and shaft, whose sweep it may not cross (R2)."""
    pts = [V(2.16, 0.52, 0.50, s), V(2.01, 0.515, 0.45, s), V(1.92, 0.505, 0.35, s), V(1.84, 0.50, 0.345, s),
           V(1.79, 0.535, 0.345, s), V(1.745, 0.56, 0.345, s), V(1.70, 0.585, 0.345, s)]  # over the battery coolant line
    return part(f"front-rail-{'lr'[s > 0]}", [sweep(pts, 0.10, 0.07, Vector((0, 1, 0)))], STEEL, 0.006)


def front_tower(s: int):
    """Cast suspension tower: the inboard wall beside the spring, the turret round the damper's top mount, the
    upper arm's two pivot brackets, and a brace back over the brake booster to the bulkhead's cowl."""
    top = Vector(HP["front"]["damperTop"])
    wall = prism([(1.40, 0.66), (1.70, 0.60), (1.82, 0.56), (1.82, 0.975), (1.40, 0.975)], "z", 0.351, 0.357)
    pieces = [wall,
              ring_y(Vector((top.x, 0, top.z)), 0.096, 0.10, 0.93, 0.975),
              disc_y(Vector((top.x, 0, top.z)), 0.10, 0.975, 0.981, hole=0.035)]
    for key in ("upperFront", "upperRear"):
        px, py, pz = HP["front"][key]
        for dx in (-0.03, 0.03):
            pieces.append(prism([(py - 0.045, 0.357), (py - 0.03, pz + 0.035), (py + 0.03, pz + 0.035), (py + 0.075, 0.357)],
                                "x", px + dx - 0.0025, px + dx + 0.0025))
    brace = sweep([Vector((1.47, 0.955, 0.40)), Vector((1.30, 0.952, 0.43)), Vector((1.10, 0.945, 0.45))], 0.05, 0.05, Vector((0, 1, 0)))
    pieces.append(brace)
    return part(f"front-tower-{'lr'[s > 0]}", [mirror(p, s) for p in pieces], CAST, 0.002)


def front_floor_rail(s: int):
    """Rail under the toe board: from a bracket on subframe mount 3/4 (spacer top y 0.35, ahead of the pack) back
    and outboard behind the front tyres' sweep, above the pack's lid and the brake lines, under the toe board into
    the sill's front end."""
    pieces = [sweep([V(1.27, 0.44, 0.36), V(1.17, 0.44, 0.38), V(1.10, 0.44, 0.47), V(1.04, 0.44, 0.62), V(1.00, 0.44, 0.705)],
                    0.08, 0.07, Vector((0, 1, 0))),  # behind the front tyres' sweep at full lock
              box((1.222, 0.347, 0.32), (1.252, 0.41, 0.40))]  # ahead of the battery coolant line over the mount
    return part(f"front-floor-rail-{'lr'[s > 0]}", [mirror(p, s) for p in pieces], STEEL, 0.004)


def crash_box(name: str, x0: float, x1: float, y: float, s: int):
    pieces = [box((x0, y - 0.05, 0.46), (x1, y + 0.05, 0.54))]
    return part(name, [mirror(p, s) for p in pieces], EXTRUSION, 0.008)


def crash_beam(name: str, x_mid: float, x_end: float, y: float):
    """Extruded beam across the car, 45 mm deep and 110 mm tall: straight across the cooling module (|z| <= 0.42),
    swept back at its ends."""
    zs = [-0.62, -0.56, -0.50, -0.42, 0.0, 0.42, 0.50, 0.56, 0.62]
    pts = [Vector((x_mid - (x_mid - x_end) * (max(abs(z) - 0.42, 0) / 0.20) ** 2, y, z)) for z in zs]
    return part(name, [sweep(pts, 0.11, 0.045, Vector((0, 1, 0)))], EXTRUSION, 0.006)


def front_end_carrier():
    """Frame round the cooling module, bolted to the rails' front ends: two posts beside the radiator's tanks
    (|z| 0.425-0.455), a top bar under the bonnet's latch and a bottom bar."""
    pieces = []
    for s in (-1, 1):
        pieces.append(mirror(box((2.15, 0.43, 0.425), (2.20, 0.87, 0.455)), s))
        pieces.append(mirror(box((2.15, 0.48, 0.455), (2.17, 0.56, 0.47)), s))  # flange on the rail's end
    pieces.append(box((2.15, 0.84, -0.47), (2.20, 0.87, 0.47)))
    pieces.append(box((2.15, 0.38, -0.47), (2.20, 0.405, 0.47)))  # under the refrigerant line
    return part("front-end-carrier", pieces, STEEL, 0.004)


def bulkhead():
    """Dash panel and toe board between the hinge pillars, with the cowl ledge on top. Openings (R7): steering
    shaft, brake pushrod, refrigerant line, 12 V harness."""
    o = part("bulkhead", [sheet([(0.88, 0.384), (1.035, 0.555), (1.035, 0.93), (1.12, 0.955)], 0.004, "z", -0.73, 0.73)], STEEL)
    cutters = []
    for c, r in ((Vector((1.033, 0.725, 0.345)), 0.04), (Vector((1.033, 0.83, 0.265)), 0.035), (Vector((1.033, 0.80, 0.0)), 0.03),
                 (Vector((1.033, 0.755, -0.597)), 0.025)):  # ... and the 12 V harness's grommet
        bm = transform(kit.cylinder(r, 0.08, 32), Matrix.Translation(c) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
        cutters.append(new_object("cut", bm, STEEL))
    return kit.cut(o, *cutters)


def cross_car_beam():
    """Tube between the hinge pillars carrying the steering column's bracket (x 0.80, y 0.92) and the dashboard."""
    pts = [Vector(p) for p in ((0.99, 0.90, -0.77), (0.86, 0.92, -0.62), (0.80, 0.93, -0.30), (0.80, 0.94, 0.0),
                               (0.80, 0.93, 0.30), (0.86, 0.92, 0.62), (0.99, 0.90, 0.77))]
    o = kit.shade(kit.tube_path(pts, 0.03, 4), 35.0)
    o.name = "cross-car-beam"
    o.data.materials.append(kit.material(STEEL))
    kit.box_uv(o, 3.0)
    return o


# ---- floor and sills -------------------------------------------------------------------------------------

def sill(s: int):
    """Closed sill section from the A-pillar's foot (x 1.06) to the C-pillar's (x -0.97): clear of both wheels'
    sweep (R1), behind the provisional exterior's wheel openings and above its rocker (y 0.30). Its inner face
    (z 0.705) takes the pack's mounting tabs; the brake lines run beside it at z 0.69."""
    outline = [(0.30, 0.72), (0.30, 0.84), (0.325, 0.875), (0.49, 0.875), (0.52, 0.85), (0.52, 0.705), (0.32, 0.705)]
    return part(f"sill-{'lr'[s > 0]}", [mirror(prism(outline, "x", -0.97, 1.06), s)], STEEL, 0.006)


def cabin_floor():
    """Flat floor on the pack (y 0.38) from the toe board back to the heel kick-up, which rises over the rear
    subframe to the boot floor (R3). The kick-up is narrower, leaving the brake lines' rise (z 0.625)."""
    flat = sheet([(0.89, 0.384), (-0.97, 0.384)], 0.004, "z", -0.705, 0.705)
    kick = sheet([(-0.97, 0.384), (-1.03, 0.384), (-1.10, 0.50), (-1.22, 0.80), (-1.27, 0.86)], 0.004, "z", -0.60, 0.60)
    return part("cabin-floor", [flat, kick], STEEL)


def floor_crossmember(n: int, x: float):
    outline = [(x - 0.05, 0.384), (x + 0.05, 0.384), (x + 0.03, 0.44), (x - 0.03, 0.44)]
    return part(f"floor-crossmember-{n}", [prism(outline, "z", -0.705, 0.705)], STEEL, 0.004)


def rear_seat_crossmember():
    """Under the kick-up: carries the rear subframe's front mounts (1/2, spacer top y 0.35) on two brackets."""
    pieces = [box((-1.20, 0.40, -0.58), (-1.095, 0.50, 0.58))]
    for s in (-1, 1):
        pieces.append(mirror(box((-1.165, 0.347, 0.32), (-1.095, 0.41, 0.40)), s))
    return part("floor-crossmember-3", pieces, STEEL, 0.004)


# ---- rear structure ---------------------------------------------------------------------------------------

def rear_rail(s: int):
    """From the kick-up crossmember, up over the rear suspension (above the toe links, between the drive unit and the
    springs), down to subframe mount 3/4 (spacer top y 0.45) under the on-board charger, then out to the crash box."""
    pts = [V(-1.12, 0.45, 0.375, s), V(-1.20, 0.52, 0.375, s), V(-1.28, 0.62, 0.375, s), V(-1.40, 0.68, 0.375, s),
           V(-1.60, 0.68, 0.375, s), V(-1.655, 0.60, 0.375, s), V(-1.72, 0.49, 0.375, s), V(-1.95, 0.49, 0.375, s),
           V(-2.08, 0.49, 0.47, s), V(-2.15, 0.49, 0.50, s)]
    return part(f"rear-rail-{'lr'[s > 0]}", [sweep(pts, 0.10, 0.07, Vector((0, 1, 0)))], STEEL, 0.006)


def rear_tower(s: int):
    """Turret round the rear damper's top mount, through the boot floor, tied down to the rail and out to the
    wheelhouse; the upper arm's pivot brackets hang under the rail."""
    top = Vector(HP["rear"]["damperTop"])
    c = Vector((top.x, 0, top.z))
    pieces = [ring_y(c, 0.096, 0.10, 0.86, 0.978),
              disc_y(c, 0.10, 0.978, 0.984, hole=0.035),
              box((top.x - 0.08, 0.70, 0.405), (top.x + 0.08, 0.90, 0.41)),
              box((top.x - 0.08, 0.935, top.z + 0.095), (top.x + 0.08, 0.94, WHEELHOUSE_Z))]
    for key in ("upperFront", "upperRear"):
        px, py, pz = HP["rear"][key]
        for dx in (-0.03, 0.022) if key == "upperRear" else (-0.022, 0.03):  # the inner lugs clear of the damper at bump
            pieces.append(box((px + dx - 0.0025, py - 0.04, 0.40), (px + dx + 0.0025, 0.65, pz + 0.03)))
    return part(f"rear-tower-{'lr'[s > 0]}", [mirror(p, s) for p in pieces], CAST, 0.002)


def wheelhouse(s: int):
    """Rear wheelhouse inner: a wall inboard of the tyre (above the upper arm at full bump, y >= 0.70) and the crown
    over it (R3)."""
    a0 = math.asin((0.70 - 0.405) / ARCH_R)
    angles = [a0 + (math.pi - 2 * a0) * i / 40 for i in range(41)]
    outline = [(REAR_AXLE + ARCH_R * math.cos(a), 0.405 + ARCH_R * math.sin(a)) for a in angles]
    wall = prism(outline, "z", WHEELHOUSE_Z, WHEELHOUSE_Z + 0.004)
    crown = kit.sector(ARCH_R, ARCH_R + 0.004, a0, math.pi - a0, WHEELHOUSE_Z, 0.86, 40)
    transform(crown, Matrix.Translation((REAR_AXLE, 0.405, 0)))
    return part(f"wheelhouse-r{'lr'[s > 0]}", [mirror(wall, s), mirror(crown, s)], STEEL)


def rear_floor():
    """Boot floor over the rear drive unit (y 0.86), between the wheelhouses and wider behind them, with openings for
    the damper turrets, and the back panel tying it to the rails' ends."""
    outline = [(-1.27, -WHEELHOUSE_Z), (-1.97, -WHEELHOUSE_Z), (-1.99, -0.78), (-2.154, -0.78),
               (-2.154, 0.78), (-1.99, 0.78), (-1.97, WHEELHOUSE_Z), (-1.27, WHEELHOUSE_Z)]
    floor = new_object("rear-floor", prism(outline, "y", 0.856, 0.86), STEEL)
    cutters = []
    for s in (-1, 1):
        top = HP["rear"]["damperTop"]
        bm = transform(kit.cylinder(0.098, 0.1, 40), Matrix.Translation((top[0], 0.86, s * top[2])) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
        cutters.append(new_object("cut", bm, STEEL))
    grommet = transform(kit.cylinder(0.025, 0.1, 24), Matrix.Translation((-1.85, 0.86, -0.60)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    cutters.append(new_object("cut", grommet, STEEL))  # the 12 V harness down to the rear electrics
    floor = kit.cut(floor, *cutters)
    back = new_object("back", prism([(0.44, -0.78), (0.86, -0.78), (0.86, 0.78), (0.44, 0.78)], "x", -2.158, -2.154), STEEL)
    o = kit.join("rear-floor", [floor, back])
    o = kit.shade(o, 35.0)
    kit.box_uv(o, 3.0)
    return o


# ---- pillars and roof (inside the provisional D1.1 skin) ------------------------------------------------------

PILLARS = {
    "a-pillar": ([(1.02, 0.47, 0.80), (1.02, 0.95, 0.80), (0.90, 1.02, 0.73), (0.50, 1.25, 0.64), (0.10, 1.47, 0.63)], 0.05, 0.08),
    "b-pillar": ([(-0.10, 0.48, 0.81), (-0.10, 1.10, 0.81), (-0.13, 1.47, 0.66)], 0.05, 0.11),
    "c-pillar": ([(-0.935, 0.48, 0.80), (-0.95, 0.93, 0.81), (-1.08, 1.12, 0.80), (-1.27, 1.45, 0.66)], 0.05, 0.09),
    "d-pillar": ([(-2.15, 0.86, 0.76), (-2.11, 1.15, 0.62), (-2.00, 1.355, 0.54)], 0.05, 0.08),
    "roof-rail": ([(0.10, 1.47, 0.63), (-0.35, 1.505, 0.655), (-1.25, 1.465, 0.655), (-1.82, 1.385, 0.61), (-2.00, 1.355, 0.54)], 0.06, 0.07),
}
ROOF_BOWS = {"front-header": (0.10, 1.47, 0.63, 1.51), "roof-bow-1": (-0.55, 1.50, 0.655, 1.55),
             "roof-bow-2": (-1.25, 1.465, 0.655, 1.51), "rear-header": (-2.00, 1.355, 0.54, 1.385)}


def pillar(base: str, s: int):
    pts, a, b = PILLARS[base]
    pieces = [sweep([V(*p, s) for p in pts], a, b, Vector((0, 0, s)))]
    if base == "a-pillar":  # the hinge pillar: the front door's hinges and the bulkhead's side
        pieces.append(mirror(box((0.97, 0.47, 0.73), (1.07, 0.98, 0.86)), s))
    if base == "c-pillar":  # gusset back to the wheelhouse crown's front end, 20 mm ahead of the rear tyre's sweep
        pieces.append(mirror(box((-1.02, 0.70, 0.775), (-0.95, 0.77, 0.825)), s))
    return part(f"{base}-{'lr'[s > 0]}", pieces, STEEL, 0.005)


def roof_bow(name: str):
    x, y_edge, z_edge, y_mid = ROOF_BOWS[name]
    zs = [-z_edge + 2 * z_edge * i / 8 for i in range(9)]
    pts = [Vector((x, y_edge + (y_mid - y_edge) * (1 - (z / z_edge) ** 2), z)) for z in zs]
    return part(name, [sweep(pts, 0.04, 0.06, Vector((0, 1, 0)))], STEEL, 0.004)


def coat_wheelhouses(o: bpy.types.Object) -> None:
    """D1.4: the structure's faces that look into a wheelhouse get the black underbody protection a production body
    carries there, so the arches read dark in the assembled car. Only those faces change: every part stays whole and
    visible for the engineering views."""
    wheels = [(HP[a]["wheel"][0], s) for a in ("front", "rear") for _, s in SIDES]

    def facing_a_wheel(p) -> bool:
        c = o.matrix_world @ p.center
        for ax, s in wheels:
            if c.z * s < 0.25 or math.hypot(c.x - ax, c.y - 0.405) > 0.80:
                continue
            to_wheel = Vector((ax, 0.405, s * 0.80)) - c
            if (o.matrix_world.to_3x3() @ p.normal).normalized().dot(to_wheel.normalized()) > 0.25:
                return True
        return False

    mesh = o.data
    names = [m.name for m in mesh.materials]
    if "underbody-coat" not in names:
        mesh.materials.append(kit.material("underbody-coat"))
    idx = [m.name for m in mesh.materials].index("underbody-coat")
    for p in mesh.polygons:
        if facing_a_wheel(p):
            p.material_index = idx


def build():
    kit.reset()
    parts = {}

    def add(o):
        parts[o.name.split(".")[0]] = o  # rebuilt objects carry a numeric suffix until the originals are gone

    for k, s in SIDES:
        add(front_rail(s))
        add(front_tower(s))
        add(front_floor_rail(s))
        add(crash_box(f"front-crash-box-{k}", 2.16, 2.28, 0.52, s))
        add(sill(s))
        add(rear_rail(s))
        add(rear_tower(s))
        add(wheelhouse(s))
        add(crash_box(f"rear-crash-box-{k}", -2.30, -2.15, 0.52, s))
        for base in PILLARS:
            add(pillar(base, s))
    add(crash_beam("front-crash-beam", 2.315, 2.27, 0.52))
    add(crash_beam("rear-crash-beam", -2.325, -2.29, 0.52))
    add(front_end_carrier())
    add(bulkhead())
    add(cross_car_beam())
    add(cabin_floor())
    add(floor_crossmember(1, 0.50))
    add(floor_crossmember(2, -0.55))
    add(rear_seat_crossmember())
    add(rear_floor())
    for name in ROOF_BOWS:
        add(roof_bow(name))

    for o in parts.values():
        coat_wheelhouses(o)
    keep = set(parts.values())
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    nodes = {}
    for pid, o in parts.items():
        kit.finish(o, pid)
        nodes[o.name] = pid
    out = ROOT / "web" / "assets-src" / "body-structure.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    (ROOT / "web" / "public" / "assets" / "body-structure.map.json").write_text(
        json.dumps({"asset": "body-structure", "nodes": dict(sorted(nodes.items()))}, indent=2) + "\n")
    # The app's simple stand-ins (web/src/vehicle/manifest.ts, used only when the models are switched off): each
    # part's bounding box, rounded to the millimetre.
    stand_ins = {}
    for pid, o in sorted(parts.items()):
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        stand_ins[pid] = {"centre": [round((a + b) / 2, 3) for a, b in zip(lo, hi)], "size": [round(b - a, 3) for a, b in zip(lo, hi)]}
    (ROOT / "web" / "src" / "vehicle" / "structure-stand-ins.json").write_text("{\n" + ",\n".join(f' "{k}": {json.dumps(v)}' for k, v in stand_ins.items()) + "\n}\n")
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts.values())
    print(f"body-structure: {len(parts)} parts, {tris:,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    build()
