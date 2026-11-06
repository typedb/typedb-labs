"""Front and rear electric drive units, modelled for close inspection (C3a).

Build them with scripts/build-assets.sh (runs this script, then compresses the result). Writes
web/assets-src/{front,rear}-drive-unit.glb and the visual mappings web/public/assets/{...}.map.json.

Layout (docs/engineering-references.md has the sources and the simplifications log). Each unit is a
three-shaft, parallel-axis drive unit, the common layout for single-motor axles:
  - a permanent-magnet synchronous motor (hairpin stator, rotor with V-shaped magnet pockets, resolver)
    whose axis sits above the wheel axis, on the vehicle's left of the gearbox;
  - a two-stage helical reduction in a split aluminium case: input pinion on the rotor shaft, an
    intermediate shaft (large gear + integral pinion), and the final-drive gear bolted to an open
    differential (side gears and spider gears) on the wheel axis;
  - a silicon-carbide inverter on top of the motor (six-pack power module on a pin-fin cold plate,
    film DC-link capacitor, gate-driver and control boards, DC busbars, phase busbars through a current
    sensor, HV connector);
  - oil pump and oil cooler, three rubber mounts, and the two drive shafts with constant-velocity joints;
  - the rear unit has a park lock on the intermediate shaft; the front unit a disconnect clutch there, so
    the front motor can stop when its drive is not needed.

Nodes are named by neutral visual keys ("stator", "pinion"); the mapping file says which component id
each node draws, so Blender names never become database identifiers (decision 0001). Positions are the
real assembled positions in the app's coordinates (x forward, y up, z to the right): the unit's shafts
run along z, so every turned part is a lathe around z, moved to its shaft's (x, y).
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import kit  # noqa: E402
from kit import TAU, box, cylinder, lathe, merge_into, new_object, polar_array, rod, transform  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
AXLE_Y = 0.405  # wheel centre height (web/src/vehicle/dimensions.ts)
HUB_Z = 0.735  # where the drive shaft's splined stub ends inside the hub (corner-fr hub)

# Gear train (concept design; docs/engineering-references.md). Normal modules, helix angles, teeth.
STAGE1 = dict(module=0.002, helix=25.0, pinion=21, gear=61)  # input pinion -> intermediate gear
STAGE2 = dict(module=0.003, helix=22.0, pinion=17, gear=53)  # intermediate pinion -> final-drive gear
RATIO = STAGE1["gear"] / STAGE1["pinion"] * STAGE2["gear"] / STAGE2["pinion"]  # 9.056


def pitch_radius(stage: dict, teeth: int) -> float:
    return stage["module"] * teeth / (2 * math.cos(math.radians(stage["helix"])))


CD1 = pitch_radius(STAGE1, STAGE1["pinion"]) + pitch_radius(STAGE1, STAGE1["gear"])  # 0.0905 m
CD2 = pitch_radius(STAGE2, STAGE2["pinion"]) + pitch_radius(STAGE2, STAGE2["gear"])  # 0.1133 m

# Planes along the shafts (z, metres). The motor is on the left (z < 0), the gear train on the right.
CASE_Z = (0.03, 0.125)  # main case half: motor flange face to split line
COVER_Z = (0.125, 0.215)  # cover half
STAGE1_Z = 0.165  # input pinion and intermediate gear (centre of face)
STAGE2_Z = 0.085  # intermediate pinion and final-drive gear
DIFF_Z = (0.0, 0.135)  # differential case


@dataclass
class Unit:
    key: str  # "front" / "rear": the component-id prefix
    wheel: tuple[float, float]  # (x, y) of the wheel axis = differential axis
    motor: tuple[float, float]  # (x, y) of the motor axis
    housing_r: float  # motor housing outer radius
    stator_r: float  # stator outer radius
    rotor_r: float
    stack: tuple[float, float]  # lamination stack z range
    housing_z: tuple[float, float]
    special: str  # "disconnect" or "park-lock"

    @property
    def d(self) -> int:  # +1 front unit, -1 rear unit: "outwards" along x
        return 1 if self.key == "front" else -1


FRONT = Unit("front", (1.58, AXLE_Y), (1.55, 0.593), 0.13, 0.112, 0.068, (-0.215, -0.045), (-0.27, 0.03), "disconnect")
REAR = Unit("rear", (-1.45, AXLE_Y), (-1.55, 0.567), 0.145, 0.125, 0.078, (-0.25, -0.04), (-0.285, 0.03), "park-lock")


def at(bm: bmesh.types.BMesh, xy, z: float = 0.0) -> bmesh.types.BMesh:
    return transform(bm, Matrix.Translation((xy[0], xy[1], z)))


def intermediate_axis(u: Unit) -> Vector:
    """The intermediate shaft sits where its two gear meshes put it: CD1 from the motor, CD2 from the wheel
    axis. Of the two solutions, the one away from the vehicle's centre (more room in the case)."""
    m, w = Vector(u.motor), Vector(u.wheel)
    dist = (m - w).length
    a = (CD2 ** 2 - CD1 ** 2 + dist ** 2) / (2 * dist)
    h = math.sqrt(max(CD2 ** 2 - a ** 2, 0.0))
    base = w + (m - w) * (a / dist)
    perp = Vector((-(m - w).y, (m - w).x)) / dist
    options = [base + perp * h, base - perp * h]
    return max(options, key=lambda p: p.x * u.d)


# ---- generic shapes ----------------------------------------------------------------------------------

def prism(outline: list[tuple[float, float]], z0: float, z1: float) -> bmesh.types.BMesh:
    """A closed polygon (x, y) extruded from z0 to z1."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    n = len(outline)
    for i in range(n):
        k = (i + 1) % n
        bm.faces.new((bottom[i], bottom[k], top[k], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Convex hull, counter-clockwise (monotone chain)."""
    pts = sorted(set(points))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def circles_outline(circles: list[tuple[Vector, float]], steps: int = 72) -> list[tuple[float, float]]:
    pts = []
    for c, r in circles:
        pts += [(round(c.x + r * math.cos(TAU * i / steps), 6), round(c.y + r * math.sin(TAU * i / steps), 6)) for i in range(steps)]
    return hull(pts)


def gear(teeth: int, module: float, face: float, helix_deg: float = 0.0, layers: int = 4, taper: float = 1.0) -> bmesh.types.BMesh:
    """A (helical) spur gear around the z axis from z=0 to z=face. `taper` < 1 shrinks the top face, which
    with layers=1 gives a simple bevel gear."""
    b = math.radians(helix_deg)
    r = module * teeth / (2 * math.cos(b))
    ra, rf = r + module, r - 1.25 * module
    p = TAU / teeth
    profile = []
    for i in range(teeth):
        c = p * i
        profile += [(rf, c - 0.5 * p), (rf, c - 0.3 * p), (ra, c - 0.13 * p), (ra, c + 0.13 * p), (rf, c + 0.3 * p)]
    twist = face * math.tan(b) / r
    bm = bmesh.new()
    rings = []
    for k in range(layers + 1):
        t = k / layers
        s = 1 + (taper - 1) * t
        rings.append([bm.verts.new((rr * s * math.cos(a + twist * t), rr * s * math.sin(a + twist * t), face * t)) for rr, a in profile])
    n = len(profile)
    for k in range(layers):
        lo, hi = rings[k], rings[k + 1]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(r0: float, r1: float, z0: float, z1: float, segments: int = 64) -> bmesh.types.BMesh:
    return lathe([(r0, z0), (r1, z0), (r1, z1), (r0, z1)], segments)


def bolts(centres: list[tuple[float, float]], z: float, r: float = 0.0055, h: float = 0.006, facing: int = 1) -> bmesh.types.BMesh:
    """Hex-headed bolts with washers on a face at z, heads pointing +z (facing=1) or -z."""
    bm = bmesh.new()
    for x, y in centres:
        merge_into(bm, transform(cylinder(r * 1.45, 0.0015, 16), Matrix.Translation((x, y, z + facing * 0.00075))))
        merge_into(bm, transform(cylinder(r, h, 6), Matrix.Translation((x, y, z + facing * (0.0015 + h / 2)))))
    return bm


def obj(name: str, bm: bmesh.types.BMesh, mat: str, bevel: float = 0.0, sharp: float = 35.0):
    o = new_object(name, bm, mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    return kit.shade(o, sharp)


def boxed(name: str, size, centre, mat: str, bevel: float = 0.0015):
    return obj(name, transform(box(*size), Matrix.Translation(centre)), mat, bevel)


def finish_uv(o):
    kit.box_uv(o, 6.0)
    return o


# ---- motor --------------------------------------------------------------------------------------------

def motor_housing(u: Unit):
    """Cast aluminium housing with a water jacket between its walls (the jacket's inlet and outlet show as
    ports), axial stiffening ribs, a terminal box on top for the phase busbars, and a flange to the case."""
    z0, z1 = u.housing_z
    R = u.housing_r
    bm = lathe([(u.stator_r, z0), (R, z0), (R, z1 - 0.012), (R + 0.012, z1 - 0.012), (R + 0.012, z1), (u.stator_r, z1)], 96)
    for i in range(10):  # ribs
        a = TAU * (i + 0.5) / 10
        if abs(math.sin(a) - 1) < 0.2:
            continue  # leave the top clear for the terminal box
        merge_into(bm, transform(box(0.008, 0.012, z1 - z0 - 0.03), Matrix.Translation((math.cos(a) * (R + 0.004), math.sin(a) * (R + 0.004), (z0 + z1) / 2 - 0.006)) @ Matrix.Rotation(a, 4, "Z")))
    for zc in (z0 + 0.04, z1 - 0.06):  # coolant ports, on the side towards the vehicle's centre (x)
        a = math.pi if u.d > 0 else 0.0
        a += 0.5 * u.d
        p0 = Vector((math.cos(a) * (R - 0.004), math.sin(a) * (R - 0.004), zc))
        p1 = Vector((math.cos(a) * (R + 0.03), math.sin(a) * (R + 0.03), zc))
        merge_into(bm, rod(p0, p1, 0.011, 24))
        merge_into(bm, rod(p1 - (p1 - p0).normalized() * 0.006, p1, 0.0135, 24))
    merge_into(bm, transform(box(0.07, 0.03, 0.07), Matrix.Translation((0, R + 0.008, -0.01))))  # terminal box
    for i in range(12):  # flange bolts
        a = TAU * (i + 0.5) / 12
        merge_into(bm, bolts([(math.cos(a) * (R + 0.006), math.sin(a) * (R + 0.006))], z1 - 0.012, facing=-1))
    o = obj("motor-housing", at(bm, u.motor), "aluminium-cast", 0.0, 40)
    kit.assign_by_normal(o, "aluminium-machined", Vector((0, 0, 1)), 0.95, region=lambda c: c.z > z1 - 0.002)
    return finish_uv(o)


def end_cover(u: Unit):
    """Non-drive-end cover: carries bearing 1 and the resolver, with a cap over the resolver."""
    z0 = u.housing_z[0]
    R = u.housing_r
    prof = [(0.0, z0 - 0.04), (0.045, z0 - 0.04), (0.05, z0 - 0.033), (0.05, z0 - 0.026), (R - 0.01, z0 - 0.024),
            (R + 0.002, z0 - 0.016), (R + 0.002, z0), (0.0, z0)]
    bm = lathe(prof, 96)
    for i in range(8):
        a = TAU * (i + 0.5) / 8
        merge_into(bm, transform(box(0.006, R - 0.06, 0.008), Matrix.Translation((math.cos(a) * (R + 0.04) / 2, math.sin(a) * (R + 0.04) / 2, z0 - 0.026)) @ Matrix.Rotation(a + math.pi / 2, 4, "Z")))
    merge_into(bm, bolts([(math.cos(TAU * i / 8) * (R - 0.008), math.sin(TAU * i / 8) * (R - 0.008)) for i in range(8)], z0 - 0.016, facing=-1))
    return finish_uv(obj("end-cover", at(bm, u.motor), "aluminium-cast", 0.0, 40))


def stator(u: Unit):
    """Laminated core (48 slots) with hairpin windings: U-shaped crowns at the cover end, welded pairs at the
    drive end, and the three phase leads rising to the terminal box."""
    s0, s1 = u.stack
    ro, ri = u.stator_r, u.rotor_r + 0.0012
    slots, slot_depth = 48, 0.022
    pitch = TAU / slots
    w = pitch * 0.42

    def segment():
        outline = [(ro * math.cos(a), ro * math.sin(a)) for a in (pitch * k / 6 - pitch / 2 for k in range(7))]
        for a, r in ((pitch / 2, ri), (w / 2, ri), (w / 2, ri + slot_depth), (-w / 2, ri + slot_depth), (-w / 2, ri), (-pitch / 2, ri)):
            outline.append((r * math.cos(a), r * math.sin(a)))
        return prism(outline, s0, s1)

    core = polar_array(segment, slots)
    for k in range(int((s1 - s0) / 0.012)):  # lamination grooves (shallow rings on the outside)
        z = s0 + 0.006 + k * 0.012
        merge_into(core, tube(ro - 0.0005, ro + 0.0006, z - 0.0004, z + 0.0004, 96))
    core_obj = obj("core", at(core, u.motor), "electrical-steel", 0.0, 30)

    copper = bmesh.new()
    rm = ri + slot_depth * 0.5
    layers = (rm - 0.005, rm + 0.005)
    for i in range(slots):
        a0, a1 = pitch * i, pitch * (i + 6)
        for li, r in enumerate(layers):
            ra, rb = r, layers[1 - li]
            p0 = Vector((ra * math.cos(a0), ra * math.sin(a0), s0 - 0.002))
            p1 = Vector((ra * math.cos(a0), ra * math.sin(a0), s0 - 0.012 - 0.004 * li))
            pm = Vector(((ra + rb) / 2 * math.cos((a0 + a1) / 2), (ra + rb) / 2 * math.sin((a0 + a1) / 2), s0 - 0.03 - 0.006 * li))
            p2 = Vector((rb * math.cos(a1), rb * math.sin(a1), s0 - 0.012 - 0.004 * li))
            for a, b in ((p0, p1), (p1, pm), (pm, p2)):  # crown end: the bent U of each hairpin
                merge_into(copper, rod(a, b, 0.0022, 6))
            # weld end: leg tips twisted towards the next pin, welded in pairs
            q0 = Vector((ra * math.cos(a0), ra * math.sin(a0), s1 + 0.002))
            q1 = Vector((ra * math.cos(a0 + pitch * 1.5 * (1 if li else -1)), ra * math.sin(a0 + pitch * 1.5 * (1 if li else -1)), s1 + 0.02))
            merge_into(copper, rod(q0, q1, 0.0022, 6))
        tip = Vector((rm * math.cos(pitch * i + pitch * 1.5), rm * math.sin(pitch * i + pitch * 1.5), s1 + 0.024))
        merge_into(copper, transform(kit.sphere(0.0042, 1), Matrix.Translation(tip)))
    for k in range(3):  # phase leads up to the terminal box
        x = -0.018 + 0.018 * k
        merge_into(copper, rod(Vector((x, rm, s1 + 0.02)), Vector((x, u.housing_r - 0.004, s1 + 0.03)), 0.003, 8))
    wind = obj("windings", at(copper, u.motor), "copper", 0.0, 50)
    o = kit.join("stator", [core_obj, wind])
    return finish_uv(o)


def rotor(u: Unit):
    """Laminated rotor (8 poles) with V-shaped magnet pockets, the magnets in them, and balance end plates."""
    s0, s1 = u.stack
    r = u.rotor_r
    core = new_object("rotor-core", lathe([(0.02, s0), (r, s0), (r, s1), (0.02, s1)], 96), "electrical-steel")
    pockets = bmesh.new()
    magnets = bmesh.new()
    for i in range(8):
        a = TAU * i / 8
        for side in (-1, 1):
            ang = a + side * 0.17
            c = Vector((math.cos(ang) * r * 0.76, math.sin(ang) * r * 0.76, (s0 + s1) / 2))
            rot = Matrix.Rotation(ang + side * 0.6 + math.pi / 2, 4, "Z")
            merge_into(pockets, transform(box(r * 0.36, 0.0062, s1 - s0 + 0.01), Matrix.Translation(c) @ rot))
            merge_into(magnets, transform(box(r * 0.34, 0.0052, s1 - s0 - 0.001), Matrix.Translation(c) @ rot))
    core = kit.cut(core, new_object("pockets", pockets, "electrical-steel"))
    core = kit.shade(core, 30)
    mags = kit.shade(new_object("magnets", magnets, "magnet"), 30)
    plates = bmesh.new()
    for z, sgn in ((s0, -1), (s1, 1)):
        merge_into(plates, lathe([(0.022, z), (r - 0.002, z), (r - 0.002, z + sgn * 0.004), (r - 0.012, z + sgn * 0.006), (0.022, z + sgn * 0.006)], 96))
    plates_o = kit.shade(new_object("plates", plates, "aluminium-machined"), 30)
    o = kit.join("rotor", [core, mags, plates_o])
    o.data.transform(Matrix.Translation((u.motor[0], u.motor[1], 0)))
    return finish_uv(o)


def rotor_shaft(u: Unit):
    """Hollow shaft: resolver seat at the cover end, bearing seats, splined drive end for the input pinion."""
    z0, z1 = u.housing_z[0] - 0.03, STAGE1_Z + 0.04
    prof = [(0.008, z0), (0.012, z0), (0.012, z0 + 0.03), (0.016, z0 + 0.032), (0.016, z0 + 0.05), (0.02, z0 + 0.052),
            (0.02, 0.06), (0.016, 0.062), (0.016, z1 - 0.004), (0.014, z1), (0.008, z1)]
    bm = lathe(prof, 48)
    for i in range(18):  # splines
        a = TAU * i / 18
        merge_into(bm, transform(box(0.003, 0.0035, 0.05), Matrix.Translation((math.cos(a) * 0.0165, math.sin(a) * 0.0165, STAGE1_Z)) @ Matrix.Rotation(a, 4, "Z")))
    return finish_uv(obj("rotor-shaft", at(bm, u.motor), "steel-machined", 0.0, 30))


def ball_bearing(name: str, xy, z: float, ri: float, ro: float, width: float):
    """Deep-groove ball bearing: races, balls and a pressed-steel cage."""
    rm = (ri + ro) / 2
    ball = (ro - ri) * 0.3
    races = lathe([(ri, z - width / 2), (rm - ball * 0.7, z - width / 2), (rm - ball * 0.7, z + width / 2), (ri, z + width / 2)], 64)
    merge_into(races, lathe([(rm + ball * 0.7, z - width / 2), (ro, z - width / 2), (ro, z + width / 2), (rm + ball * 0.7, z + width / 2)], 64))
    balls = bmesh.new()
    n = max(7, int(TAU * rm / (ball * 2.6)))
    for i in range(n):
        merge_into(balls, transform(kit.sphere(ball, 1), Matrix.Translation((rm * math.cos(TAU * i / n), rm * math.sin(TAU * i / n), z))))
    cage = lathe([(rm - ball * 0.4, z - width * 0.18), (rm + ball * 0.4, z - width * 0.18), (rm + ball * 0.4, z + width * 0.18), (rm - ball * 0.4, z + width * 0.18)], 64)
    o = kit.join(name, [obj("races", at(races, xy), "bearing-steel", 0, 30), obj("balls", at(balls, xy), "bearing-steel", 0, 80),
                        obj("cage", at(cage, xy), "steel-dark", 0, 30)])
    return finish_uv(o)


def resolver(u: Unit):
    """Variable-reluctance resolver: a lobed rotor ring on the shaft inside a wound stator ring."""
    z = u.housing_z[0] - 0.012
    ring = tube(0.034, 0.045, z - 0.006, z + 0.006, 72)
    for i in range(16):  # stator coils
        a = TAU * i / 16
        merge_into(ring, transform(box(0.006, 0.005, 0.011), Matrix.Translation((math.cos(a) * 0.031, math.sin(a) * 0.031, z)) @ Matrix.Rotation(a, 4, "Z")))
    stator_o = obj("resolver-stator", at(ring, u.motor), "electrical-steel", 0, 30)
    coils = bmesh.new()
    for i in range(16):
        a = TAU * i / 16
        merge_into(coils, transform(box(0.004, 0.007, 0.013), Matrix.Translation((math.cos(a) * 0.0315, math.sin(a) * 0.0315, z)) @ Matrix.Rotation(a, 4, "Z")))
    coils_o = obj("resolver-coils", at(coils, u.motor), "copper", 0, 40)
    lobes = []  # 4-lobed rotor ring: radius varies with angle, which the stator coils read as position
    for i in range(96):
        a = TAU * i / 96
        lobes.append(((0.022 + 0.0035 * math.cos(4 * a)) * math.cos(a), (0.022 + 0.0035 * math.cos(4 * a)) * math.sin(a)))
    rot = prism(lobes, z - 0.004, z + 0.004)
    rot_o = obj("resolver-rotor", at(rot, u.motor), "electrical-steel", 0, 50)
    lead = rod(Vector((0.0, 0.045, z)), Vector((0.0, u.housing_r + 0.01, z - 0.02)), 0.003, 8)
    lead_o = obj("resolver-lead", at(lead, u.motor), "plastic-black", 0, 40)
    return finish_uv(kit.join("resolver", [stator_o, coils_o, rot_o, lead_o]))


# ---- gear train ---------------------------------------------------------------------------------------

def helical(name: str, stage: dict, teeth: int, xy, zc: float, face: float, hand: int, hub: tuple[float, float] | None = None,
            web: bool = False, bore: float = 0.0):
    """A helical gear centred at z=zc; optional hub (bore radius, hub radius), a lightened web, or a plain
    bore (a ring gear that bolts onto a flange)."""
    g = gear(teeth, stage["module"], face, hand * stage["helix"], 6)
    transform(g, Matrix.Translation((0, 0, zc - face / 2)))
    parts = [obj(name + "-teeth", at(g, xy), "steel-machined", 0.0, 25)]
    r = pitch_radius(stage, teeth)
    if web:  # recess both faces between hub and rim, so the gear reads as a forged blank
        rim = r - 1.25 * stage["module"] - 0.006
        cutter = bmesh.new()
        for sgn in (-1, 1):
            merge_into(cutter, tube((hub[1] if hub else bore) + 0.004, rim, *sorted((zc + sgn * face * 0.22, zc + sgn * (face / 2 + 0.01))), 96))
        if bore:
            merge_into(cutter, tube(0.0, bore, zc - face, zc + face, 96))
        parts[0] = kit.cut(parts[0], new_object("web", at(cutter, xy), "steel-machined"))
    if hub:
        h = tube(hub[0], hub[1], zc - face / 2 - 0.006, zc + face / 2 + 0.006, 64)
        parts.append(obj(name + "-hub", at(h, xy), "steel-machined", 0.0, 30))
    return finish_uv(kit.join(name, parts))


def intermediate_shaft(u: Unit, axis: Vector):
    """Shaft with its integral stage-2 pinion and bearing seats; the park gear (rear) or the disconnect
    clutch's dog teeth (front) sit on its cover end."""
    zs = (CASE_Z[0] + 0.012, COVER_Z[1] - 0.008)
    shaft = lathe([(0.0, zs[0]), (0.016, zs[0]), (0.016, zs[0] + 0.02), (0.019, zs[0] + 0.022), (0.019, zs[1] - 0.022),
                   (0.016, zs[1] - 0.02), (0.016, zs[1]), (0.0, zs[1])], 48)
    face = 0.042
    p = gear(STAGE2["pinion"], STAGE2["module"], face, -STAGE2["helix"], 6)
    transform(p, Matrix.Translation((0, 0, STAGE2_Z - face / 2)))
    merge_into(shaft, p)
    o = obj("intermediate-shaft", at(shaft, axis), "steel-machined", 0.0, 25)
    return finish_uv(o)


def differential(u: Unit):
    """Cast-iron case of the open differential: two bulbous halves, the flange the final-drive gear bolts to,
    windows that show the gears inside, and bearing journals at both ends."""
    z0, z1 = DIFF_Z
    rg = pitch_radius(STAGE2, STAGE2["gear"]) - 1.25 * STAGE2["module"] - 0.012
    prof = [(0.0, z0), (0.026, z0), (0.026, z0 + 0.014), (0.036, z0 + 0.016), (0.055, z0 + 0.035), (0.06, STAGE2_Z - 0.03),
            (rg, STAGE2_Z - 0.026), (rg, STAGE2_Z - 0.012), (0.06, STAGE2_Z - 0.012), (0.058, z1 - 0.03), (0.04, z1 - 0.016),
            (0.026, z1 - 0.014), (0.026, z1), (0.0, z1)]
    body = new_object("diff-body", lathe(prof, 96), "iron-cast")
    bore = new_object("diff-bore", tube(0.0, 0.019, z0 - 0.01, z1 + 0.01, 48), "iron-cast")
    windows = bmesh.new()
    for a in (0.0, math.pi):
        merge_into(windows, transform(box(0.05, 0.04, 0.05), Matrix.Translation((math.cos(a) * 0.055, math.sin(a) * 0.055, (z0 + z1) / 2 - 0.018))))
    inner = new_object("diff-inner", lathe([(0.0, z0 + 0.018), (0.046, z0 + 0.03), (0.046, z1 - 0.034), (0.0, z1 - 0.022)], 64), "iron-cast")
    body = kit.cut(body, bore, new_object("windows", windows, "iron-cast"), inner)
    body = kit.shade(body, 35)
    pin_bolts = bolts([(math.cos(TAU * i / 10) * (rg - 0.008), math.sin(TAU * i / 10) * (rg - 0.008)) for i in range(10)], STAGE2_Z - 0.026, facing=-1)
    b = kit.shade(new_object("diff-bolts", pin_bolts, "steel-dark"), 40)
    o = kit.join("differential", [body, b])
    o.data.transform(Matrix.Translation((u.wheel[0], u.wheel[1], 0)))
    return finish_uv(o)


def side_gear(u: Unit, side: int):
    """Bevel side gear splined to a drive shaft (left: side=-1, right: side=1)."""
    zc = (DIFF_Z[0] + DIFF_Z[1]) / 2 + side * 0.022
    g = gear(16, 0.0035, 0.014, 0.0, 1, taper=0.72)
    if side > 0:
        transform(g, Matrix.Rotation(math.pi, 4, "X"))
    transform(g, Matrix.Translation((0, 0, zc)))
    merge_into(g, tube(0.0, 0.017, *sorted((zc, zc + side * 0.022)), 32))
    return finish_uv(obj("side-gear-" + ("l" if side < 0 else "r"), at(g, u.wheel), "steel-machined", 0.0, 25))


def spider_gears(u: Unit):
    """Two bevel pinions on the cross pin, meshing with both side gears."""
    zc = (DIFF_Z[0] + DIFF_Z[1]) / 2
    bm = bmesh.new()
    for sgn in (-1, 1):
        g = gear(10, 0.0035, 0.012, 0.0, 1, taper=0.68)
        transform(g, Matrix.Translation((0, 0, 0.018)))
        transform(g, Matrix.Rotation(-sgn * math.pi / 2, 4, "X"))  # teeth point at the axis
        merge_into(bm, transform(g, Matrix.Translation((0, 0, zc))))
    merge_into(bm, transform(cylinder(0.007, 0.104, 24), Matrix.Translation((0, 0, zc)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    return finish_uv(obj("spider-gears", at(bm, u.wheel), "steel-machined", 0.0, 25))


def case_circles(u: Unit, axis: Vector, wall: float = 0.0):
    rg = pitch_radius(STAGE2, STAGE2["gear"]) + STAGE2["module"]
    ri = pitch_radius(STAGE1, STAGE1["gear"]) + STAGE1["module"]
    return [(Vector(u.wheel), rg + 0.018 - wall), (axis, ri + 0.016 - wall), (Vector(u.motor), 0.07 - wall)]


def gearbox_case(u: Unit, axis: Vector, half: str):
    """One half of the split aluminium case: a shell open at the split line, with bearing bores, external
    ribs and a bolted flange. half = "case" (motor side, carries the motor) or "cover"."""
    z0, z1 = CASE_Z if half == "case" else COVER_Z
    closed = z0 if half == "case" else z1
    outer = circles_outline(case_circles(u, axis))
    inner = circles_outline(case_circles(u, axis, 0.008))
    sh = new_object(half, prism(outer, z0, z1), "aluminium-cast")
    iz0, iz1 = (z0 + 0.008, z1 + 0.01) if half == "case" else (z0 - 0.01, z1 - 0.008)
    holes = bmesh.new()
    merge_into(holes, prism(inner, iz0, iz1))
    for c, r in ((Vector(u.wheel), 0.03), (Vector(u.motor), 0.028)):  # shaft bores in the closed wall
        if half == "case" or c == Vector(u.wheel):
            merge_into(holes, transform(cylinder(r, 0.05, 48), Matrix.Translation((c.x, c.y, closed))))
    sh = kit.cut(sh, new_object("pocket", holes, "aluminium-cast"))
    sgn = -1 if half == "case" else 1
    # bosses are built at the origin: move each to its axis
    bosses = bmesh.new()
    for c, r, hole in ((Vector(u.wheel), 0.052, 0.031), (axis, 0.036, 0.0)) + (((Vector(u.motor), 0.046, 0.0),) if half == "cover" else ()):
        merge_into(bosses, at(tube(hole, r, min(closed, closed + sgn * 0.012), max(closed, closed + sgn * 0.012), 64), c))
    # flange round the split line, with bolts
    flange_out = circles_outline(case_circles(u, axis, -0.009))
    fz = (z1 - 0.008, z1) if half == "case" else (z0, z0 + 0.008)
    flange = prism(flange_out, *fz)
    ribs = bmesh.new()
    centre = (Vector(u.wheel) + axis + Vector(u.motor)) / 3
    for i, (x, y) in enumerate(outer[:: max(1, len(outer) // 10)]):
        p = Vector((x, y))
        dirn = (p - centre).normalized()
        a = math.atan2(dirn.y, dirn.x)
        merge_into(ribs, transform(box(0.012, 0.006, z1 - z0 - 0.01), Matrix.Translation((p.x - dirn.x * 0.004, p.y - dirn.y * 0.004, (z0 + z1) / 2)) @ Matrix.Rotation(a, 4, "Z")))
    bolt_pts = [flange_out[i] for i in range(0, len(flange_out), max(1, len(flange_out) // 14))]
    bolt_pts = [(centre.x + (x - centre.x) * 0.985, centre.y + (y - centre.y) * 0.985) for x, y in bolt_pts]
    fb = bolts(bolt_pts, fz[1] if half == "cover" else fz[0], facing=1 if half == "cover" else -1) if half == "cover" else bmesh.new()
    pieces = [kit.shade(sh, 40), obj(half + "-bosses", bosses, "aluminium-cast", 0, 40), obj(half + "-flange", flange, "aluminium-cast", 0, 40),
              obj(half + "-ribs", ribs, "aluminium-cast", 0, 40)]
    if half == "cover":
        pieces.append(obj("cover-bolts", fb, "steel-zinc", 0, 40))
        # breather and drain plug
        pieces.append(obj("breather", at(cylinder(0.006, 0.02, 16), (axis.x, axis.y + 0.07), z0 + 0.04), "plastic-black", 0, 40))
    else:
        fb.free()
    o = kit.join(half, pieces)
    kit.assign_by_normal(o, "aluminium-machined", Vector((0, 0, 1 if half == "case" else -1)), 0.97,
                         region=lambda c: abs(c.z - (z1 if half == "case" else z0)) < 0.001)
    return finish_uv(o)


def oil_pump(u: Unit, axis: Vector):
    """Electric gerotor oil pump on the bottom of the case: lubricates the gears and sprays the end windings."""
    w = Vector(u.wheel)
    c = Vector((w.x + u.d * 0.06, w.y - 0.105))
    body = at(cylinder(0.026, 0.05, 48), c, 0.075)
    merge_into(body, at(cylinder(0.03, 0.008, 48), c, 0.104))
    motor = at(cylinder(0.022, 0.04, 40), c, 0.03)
    plug = transform(box(0.018, 0.014, 0.02), Matrix.Translation((c.x, c.y - 0.022, 0.03)))
    o = kit.join("oil-pump", [obj("pump", body, "aluminium-cast", 0.001, 40), obj("pump-motor", motor, "steel-dark", 0.001, 40),
                              obj("pump-plug", plug, "plastic-black", 0.001, 40)])
    return finish_uv(o)


def oil_cooler(u: Unit, axis: Vector):
    """Oil-to-coolant plate heat exchanger on the case: the motor's heat leaves through the vehicle's
    coolant circuit."""
    w, m = Vector(u.wheel), Vector(u.motor)
    away = (w + m) / 2 - axis
    away.normalize()
    c = (w + m) / 2 + away * 0.055
    plates = bmesh.new()
    for k in range(9):
        merge_into(plates, transform(box(0.07, 0.006, 0.06), Matrix.Translation((0, -0.024 + k * 0.006, 0))))
    merge_into(plates, transform(box(0.078, 0.008, 0.068), Matrix.Translation((0, -0.03, 0))))
    for x in (-0.026, 0.026):
        merge_into(plates, rod(Vector((x, 0.02, 0.0)), Vector((x, 0.045, 0.0)), 0.006, 16))
    a = math.atan2(away.y, away.x) - math.pi / 2
    transform(plates, Matrix.Translation((c.x, c.y, 0.07)) @ Matrix.Rotation(a, 4, "Z"))
    return finish_uv(obj("oil-cooler", plates, "aluminium-machined", 0.0008, 40))


def special(u: Unit, axis: Vector):
    """Rear: park lock (parking gear on the intermediate shaft, pawl, electric actuator).
    Front: disconnect clutch (dog-clutch sleeve on the intermediate shaft, solenoid actuator)."""
    z = COVER_Z[1] - 0.03
    parts = []
    if u.special == "park-lock":
        g = gear(18, 0.004, 0.012, 0.0, 1)
        parts.append(obj("park-gear", at(transform(g, Matrix.Translation((0, 0, z - 0.006))), axis), "steel-machined", 0, 25))
        out = (axis - Vector(u.wheel)).normalized()
        pivot = axis + out * 0.075
        pawl = transform(box(0.05, 0.01, 0.011), Matrix.Translation((pivot.x - out.x * 0.022, pivot.y - out.y * 0.022, z)) @ Matrix.Rotation(math.atan2(out.y, out.x), 4, "Z"))
        parts.append(obj("pawl", pawl, "steel-dark", 0.001, 35))
        act = at(cylinder(0.022, 0.05, 40), pivot, COVER_Z[1] + 0.025)
        parts.append(obj("park-actuator", act, "aluminium-anodised", 0.001, 40))
        parts.append(obj("park-plug", at(box(0.016, 0.02, 0.016), pivot + Vector((0, 0.026)), COVER_Z[1] + 0.035), "plastic-black", 0.001, 40))
    else:
        sleeve = tube(0.02, 0.028, z - 0.008, z + 0.008, 48)
        for i in range(12):  # dog teeth
            a = TAU * i / 12
            merge_into(sleeve, transform(box(0.006, 0.006, 0.006), Matrix.Translation((math.cos(a) * 0.024, math.sin(a) * 0.024, z - 0.011))))
        parts.append(obj("dog-sleeve", at(sleeve, axis), "steel-machined", 0, 30))
        out = (axis - Vector(u.wheel)).normalized()
        sol = axis + out * 0.06
        parts.append(obj("solenoid", at(cylinder(0.02, 0.055, 40), sol, COVER_Z[1] + 0.025), "steel-dark", 0.001, 40))
        parts.append(obj("fork", rod(Vector((sol.x, sol.y, z)), Vector((axis.x + out.x * 0.028, axis.y + out.y * 0.028, z)), 0.004, 12), "steel-dark", 0, 40))
        parts.append(obj("solenoid-plug", at(box(0.016, 0.02, 0.016), sol + Vector((0, 0.024)), COVER_Z[1] + 0.04), "plastic-black", 0.001, 40))
    return finish_uv(kit.join(u.special, parts))


# ---- inverter -----------------------------------------------------------------------------------------

def inverter_frame(u: Unit):
    """Inverter footprint over the motor: x across, z along; y from the housing top."""
    mx = u.motor[0]
    y0 = u.motor[1] + u.housing_r + 0.01
    return mx, y0, (-0.26, 0.14)


def inverter_housing(u: Unit):
    """Cast tray with a coolant channel under the power module (ports on the side) and mounting feet."""
    mx, y0, (z0, z1) = inverter_frame(u)
    h = 0.075
    outer = new_object("tray", transform(box(0.3, h, z1 - z0), Matrix.Translation((mx, y0 + h / 2, (z0 + z1) / 2))), "aluminium-cast")
    pocket = new_object("tray-pocket", transform(box(0.284, h, z1 - z0 - 0.016), Matrix.Translation((mx, y0 + h / 2 + 0.008, (z0 + z1) / 2))), "aluminium-cast")
    tray = kit.shade(kit.bevel(kit.cut(outer, pocket), 0.002, 2), 35)
    extra = bmesh.new()
    for zc in (-0.08, 0.06):  # coolant ports, towards the vehicle's centre
        p0 = Vector((mx - u.d * 0.15, y0 + 0.02, zc))
        merge_into(extra, rod(p0, p0 - Vector((u.d * 0.035, 0, 0)), 0.009, 20))
        merge_into(extra, rod(p0 - Vector((u.d * 0.03, 0, 0)), p0 - Vector((u.d * 0.035, 0, 0)), 0.011, 20))
    for x in (-0.13, 0.13):  # feet bolted to the motor housing
        for zc in (z0 + 0.02, z1 - 0.02):
            merge_into(extra, transform(box(0.024, 0.016, 0.024), Matrix.Translation((mx + x, y0 - 0.006, zc))))
    feet = obj("tray-extra", extra, "aluminium-cast", 0.001, 40)
    return finish_uv(kit.join("inverter", [tray, feet]))


def inverter_lid(u: Unit):
    mx, y0, (z0, z1) = inverter_frame(u)
    y = y0 + 0.075
    bm = transform(box(0.3, 0.006, z1 - z0), Matrix.Translation((mx, y + 0.003, (z0 + z1) / 2)))
    for k in range(5):  # stiffening beads
        merge_into(bm, transform(box(0.24, 0.004, 0.01), Matrix.Translation((mx, y + 0.007, z0 + 0.06 + k * 0.07))))
    pts = [(mx + sx * 0.14, zc) for sx in (-1, 1) for zc in (z0 + 0.012, (z0 + z1) / 2, z1 - 0.012)]
    bolt_bm = bmesh.new()
    for x, zc in pts:
        merge_into(bolt_bm, transform(cylinder(0.0055, 0.006, 6), Matrix.Translation((x, y + 0.009, zc)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    o = kit.join("inverter-lid", [obj("lid", bm, "aluminium-cast", 0.0015, 40), obj("lid-bolts", bolt_bm, "steel-zinc", 0, 40)])
    return finish_uv(o)


def power_module(u: Unit):
    """Six-pack SiC MOSFET module (three half-bridges) on a pin-fin baseplate that sits in the coolant
    channel; DC terminals on one side, the three AC terminals on the other, gate pins on top."""
    mx, y0, _ = inverter_frame(u)
    zc = -0.02
    y = y0 + 0.012
    base = transform(box(0.1, 0.004, 0.15), Matrix.Translation((mx, y, zc)))
    pins = bmesh.new()
    for i in range(7):
        for k in range(11):
            merge_into(pins, transform(cylinder(0.0022, 0.008, 8), Matrix.Translation((mx - 0.039 + i * 0.013, y - 0.006, zc - 0.065 + k * 0.013)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    frame = transform(box(0.09, 0.016, 0.14), Matrix.Translation((mx, y + 0.01, zc)))
    terms = bmesh.new()
    for i in range(3):  # AC terminals (towards +z: the motor's phase busbars)
        merge_into(terms, transform(box(0.016, 0.003, 0.016), Matrix.Translation((mx - 0.03 + i * 0.03, y + 0.02, zc + 0.078))))
    for i in range(2):  # DC+ / DC-
        merge_into(terms, transform(box(0.022, 0.003, 0.016), Matrix.Translation((mx - 0.016 + i * 0.032, y + 0.02, zc - 0.078))))
    gate = bmesh.new()
    for i in range(3):
        for k in range(6):
            merge_into(gate, transform(box(0.0012, 0.012, 0.0012), Matrix.Translation((mx - 0.03 + i * 0.03 + (k % 2) * 0.004, y + 0.024, zc - 0.02 + (k // 2) * 0.012))))
    o = kit.join("power-module", [obj("base", base, "copper", 0.0006, 40), obj("pins", pins, "copper", 0, 40),
                                  obj("frame", frame, "module-grey", 0.0015, 40), obj("terms", terms, "copper", 0, 40),
                                  obj("gate", gate, "steel-zinc", 0, 40)])
    return finish_uv(o)


def dc_link(u: Unit):
    """Film DC-link capacitor: a potted block between the DC busbars and the module."""
    mx, y0, _ = inverter_frame(u)
    c = (mx, y0 + 0.034, -0.185)
    bm = transform(box(0.21, 0.05, 0.12), Matrix.Translation(c))
    tabs = bmesh.new()
    for i in range(4):
        merge_into(tabs, transform(box(0.02, 0.012, 0.004), Matrix.Translation((mx - 0.06 + i * 0.04, c[1] + 0.03, c[2] + 0.062))))
    o = kit.join("dc-link-capacitor", [obj("cap", bm, "plastic-black", 0.003, 40), obj("tabs", tabs, "copper", 0, 40)])
    return finish_uv(o)


def dc_busbars(u: Unit):
    """Laminated DC busbars: from the HV connector, over the capacitor, to the module's DC terminals."""
    mx, y0, _ = inverter_frame(u)
    y = y0 + 0.064
    bm = bmesh.new()
    for k, dy in enumerate((0.0, 0.004)):
        merge_into(bm, transform(box(0.11, 0.0022, 0.16), Matrix.Translation((mx - u.d * 0.01, y + dy, -0.15))))
        merge_into(bm, transform(box(0.012, 0.035, 0.0022), Matrix.Translation((mx - 0.016 + k * 0.032, y - 0.017 + dy, -0.072))))
        merge_into(bm, transform(box(0.012, 0.0022, 0.012), Matrix.Translation((mx - 0.016 + k * 0.032, y0 + 0.032, -0.077))))
    ins = transform(box(0.112, 0.0016, 0.162), Matrix.Translation((mx - u.d * 0.01, y + 0.002, -0.15)))
    o = kit.join("inverter-busbars", [obj("dc-bars", bm, "copper", 0, 40), obj("dc-insulation", ins, "plastic-black", 0, 40)])
    return finish_uv(o)


def board(name: str, u: Unit, size, centre, chips: list[tuple[float, float, float, float]]):
    """A circuit board: green solder-masked substrate with components (dx, dz, size x, size z)."""
    bm = transform(box(*size), Matrix.Translation(centre))
    parts = bmesh.new()
    for dx, dz, sx, sz in chips:
        merge_into(parts, transform(box(sx, 0.003, sz), Matrix.Translation((centre[0] + dx, centre[1] + size[1] / 2 + 0.0015, centre[2] + dz))))
    o = kit.join(name, [obj(name + "-pcb", bm, "pcb", 0.0006, 40), obj(name + "-parts", parts, "plastic-black", 0.0004, 40)])
    return finish_uv(o)


def gate_driver(u: Unit):
    mx, y0, _ = inverter_frame(u)
    chips = [(-0.03 + i * 0.03, -0.035, 0.012, 0.018) for i in range(3)] + [(-0.03 + i * 0.03, 0.01, 0.014, 0.01) for i in range(3)]
    chips += [(0.04, -0.06, 0.016, 0.016), (-0.04, -0.06, 0.016, 0.016)]
    return board("gate-driver", u, (0.19, 0.0016, 0.17), (mx, y0 + 0.05, -0.02), chips + [(-0.075, k * 0.04 - 0.06, 0.01, 0.02) for k in range(4)])


def control_board(u: Unit):
    """Motor-control board: processor, resolver interface, CAN transceiver and the low-voltage connector."""
    mx, y0, _ = inverter_frame(u)
    chips = [(0.0, 0.0, 0.022, 0.022), (0.04, 0.02, 0.012, 0.012), (-0.04, 0.025, 0.014, 0.01), (0.03, -0.03, 0.01, 0.016)]
    o = board("control-board", u, (0.24, 0.0016, 0.1), (mx, y0 + 0.07, 0.085), chips + [(-0.08, 0.0, 0.03, 0.03), (0.08, 0.02, 0.02, 0.012)])
    plug = obj("lv-plug", transform(box(0.03, 0.02, 0.024), Matrix.Translation((mx - u.d * 0.135, y0 + 0.06, 0.1))), "plastic-black", 0.001, 40)
    return finish_uv(kit.join("control-board", [o, plug]))


def current_sensor(u: Unit):
    """Three-phase current sensor: a moulded body with a magnetic core and Hall element round each
    phase busbar."""
    mx, y0, _ = inverter_frame(u)
    c = (mx, y0 + 0.03, 0.09)
    body = new_object("cs-body", transform(box(0.11, 0.022, 0.026), Matrix.Translation(c)), "plastic-black")
    holes = bmesh.new()
    for i in range(3):
        merge_into(holes, transform(box(0.018, 0.008, 0.04), Matrix.Translation((mx - 0.03 + i * 0.03, c[1], c[2]))))
    body = kit.shade(kit.bevel(kit.cut(body, new_object("cs-holes", holes, "plastic-black")), 0.0012, 2), 40)
    pins = bmesh.new()
    for i in range(6):
        merge_into(pins, transform(box(0.0012, 0.008, 0.0012), Matrix.Translation((mx - 0.04 + i * 0.016, c[1] + 0.014, c[2] - 0.008))))
    return finish_uv(kit.join("current-sensor", [body, obj("cs-pins", pins, "steel-zinc", 0, 40)]))


def phase_busbars(u: Unit):
    """Three copper phase busbars: from the module's AC terminals, through the current sensor, down
    into the motor's terminal box."""
    mx, y0, _ = inverter_frame(u)
    bm = bmesh.new()
    for i in range(3):
        x = mx - 0.03 + i * 0.03
        merge_into(bm, transform(box(0.014, 0.003, 0.05), Matrix.Translation((x, y0 + 0.032, 0.075))))
        merge_into(bm, transform(box(0.014, y0 + 0.032 - (u.motor[1] + u.housing_r) + 0.004, 0.003),
                                 Matrix.Translation((x * 0.0 + mx - 0.018 + i * 0.018, (y0 + 0.032 + u.motor[1] + u.housing_r) / 2, 0.1))))
    return finish_uv(obj("phase-busbars", bm, "copper", 0.0004, 40))


def hv_connector(u: Unit):
    """High-voltage connector on the inverter's inner face, where the HV harness from the battery's
    distribution unit plugs in: orange shell, locking lever, two DC contacts."""
    mx, y0, _ = inverter_frame(u)
    x = mx - u.d * 0.15
    c = Vector((x - u.d * 0.018, y0 + 0.04, -0.17))
    shell = transform(box(0.036, 0.038, 0.06), Matrix.Translation(c))
    lever = transform(box(0.01, 0.006, 0.05), Matrix.Translation((c.x - u.d * 0.012, c.y + 0.022, c.z)))
    flange = transform(box(0.006, 0.05, 0.072), Matrix.Translation((x - u.d * 0.003, c.y, c.z)))
    o = kit.join("hv-connector", [obj("hv-shell", shell, "hv-orange", 0.003, 40), obj("hv-lever", lever, "hv-orange", 0.001, 40),
                                  obj("hv-flange", flange, "aluminium-cast", 0.001, 40)])
    return finish_uv(o)


# ---- mounts and drive shafts ----------------------------------------------------------------------------

def mount(u: Unit, n: int):
    """Rubber drive-unit mounts to the subframe (top at y=0.25): 1 under the motor's cover end, 2 under the
    gearbox, 3 a torque rod (outboard of the axle, on the cover side) that stops the unit rolling under torque."""
    w, m = Vector(u.wheel), Vector(u.motor)
    sub_y = 0.25
    parts = []
    if n in (1, 2):
        if n == 1:
            x, z, top = m.x + u.d * 0.0, u.housing_z[0] + 0.05, m.y - u.housing_r
        else:
            x, z, top = w.x - u.d * 0.04, CASE_Z[1], w.y - 0.12
        bush_y = sub_y + 0.035
        arm = rod(Vector((x, top + 0.01, z)), Vector((x, bush_y + 0.02, z)), 0.014, 24)
        merge_into(arm, transform(box(0.05, 0.012, 0.05), Matrix.Translation((x, top + 0.004, z))))
        parts.append(obj("bracket", arm, "aluminium-cast", 0.001, 40))
        parts.append(obj("bush", at(tube(0.008, 0.028, z - 0.025, z + 0.025, 48), (x, bush_y)), "rubber", 0, 40))
        parts.append(obj("sleeve", at(tube(0.028, 0.033, z - 0.027, z + 0.027, 48), (x, bush_y)), "steel-dark", 0, 40))
        parts.append(obj("bolt", at(cylinder(0.007, 0.07, 16), (x, bush_y), z), "steel-zinc", 0, 40))
        base = transform(box(0.08, 0.008, 0.07), Matrix.Translation((x, sub_y + 0.004, z)))
        merge_into(base, transform(box(0.008, 0.035, 0.07), Matrix.Translation((x - 0.036, sub_y + 0.02, z))))
        merge_into(base, transform(box(0.008, 0.035, 0.07), Matrix.Translation((x + 0.036, sub_y + 0.02, z))))
        parts.append(obj("base", base, "steel-dark", 0.001, 40))
    else:
        a = Vector((w.x + u.d * 0.09, w.y - 0.07, 0.175))
        b = Vector((w.x + u.d * 0.21, sub_y + 0.03, 0.175))
        parts.append(obj("rod", rod(a, b, 0.012, 24), "steel-dark", 0, 40))
        for p, r in ((a, 0.024), (b, 0.02)):
            parts.append(obj("eye", transform(tube(0.007, r, -0.012, 0.012, 40), Matrix.Translation(p)), "steel-dark", 0, 40))
            parts.append(obj("eye-bush", transform(tube(0.009, r - 0.004, -0.0125, 0.0125, 40), Matrix.Translation(p)), "rubber", 0, 40))
    return finish_uv(kit.join(f"mount-{n}", parts))


def halfshaft(u: Unit, side: int):
    """Drive shaft: splined into the side gear, a tripod plunging joint at the inner end, a solid bar,
    a fixed ball joint at the wheel and the splined stub into the hub, with rubber boots over both joints.
    The left one (motor side) starts with a long stub shaft under the motor."""
    z_in = DIFF_Z[1] + 0.005 if side > 0 else DIFF_Z[0] - 0.005
    joint_in = COVER_Z[1] + 0.03 if side > 0 else u.housing_z[0] - 0.08
    z_out = side * 0.6
    s = side
    parts = []
    # stub from the side gear to the inner joint
    za, zb = sorted((z_in, joint_in - s * 0.02))
    stub = lathe([(0.0, za), (0.015, za), (0.015, zb), (0.0, zb)], 32)
    parts.append(obj("stub", at(stub, u.wheel), "steel-machined", 0, 30))
    # inner tripod joint housing (tulip) and boot
    tulip = [(0.0, 0.0), (0.02, 0.0), (0.042, 0.02), (0.045, 0.06), (0.04, 0.065), (0.0, 0.065)]
    bell = lathe([(r, joint_in - s * 0.02 + s * z) for r, z in tulip], 64)
    parts.append(obj("inner-joint", at(bell, u.wheel), "steel-machined", 0, 35))
    boot_prof = []
    z0b, z1b = joint_in + s * 0.04, joint_in + s * 0.13
    for k in range(13):
        t = k / 12
        r = 0.04 + (0.017 - 0.04) * t + (0.006 if k % 2 else 0.0) * (1 - t * 0.5)
        boot_prof.append((r, z0b + (z1b - z0b) * t))
    boot = lathe([(0.0, z0b)] + boot_prof + [(0.0, z1b)], 48)
    parts.append(obj("inner-boot", at(boot, u.wheel), "rubber", 0, 50))
    # bar
    bar = lathe([(0.0, z1b), (0.0145, z1b), (0.0145, z_out - s * 0.11), (0.0, z_out - s * 0.11)], 32)
    parts.append(obj("bar", at(bar, u.wheel), "steel-dark", 0, 30))
    # outer boot and fixed joint
    boot2 = []
    zb0, zb1 = z_out - s * 0.11, z_out - s * 0.035
    for k in range(11):
        t = k / 10
        r = 0.016 + (0.045 - 0.016) * t + (0.005 if k % 2 else 0.0)
        boot2.append((r, zb0 + (zb1 - zb0) * t))
    parts.append(obj("outer-boot", at(lathe([(0.0, zb0)] + boot2 + [(0.0, zb1)], 48), u.wheel), "rubber", 0, 50))
    cv = [(0.0, -0.04), (0.046, -0.04), (0.05, -0.01), (0.046, 0.02), (0.03, 0.035), (0.02, 0.04), (0.0, 0.04)]
    parts.append(obj("outer-joint", at(lathe([(r, z_out + s * z) for r, z in cv], 64), u.wheel), "steel-machined", 0, 35))
    spline = lathe([(0.0, z_out + s * 0.04), (0.0165, z_out + s * 0.04), (0.0165, s * HUB_Z), (0.0, s * HUB_Z)], 32)
    parts.append(obj("hub-stub", at(spline, u.wheel), "steel-machined", 0, 30))
    return finish_uv(kit.join("halfshaft-" + ("l" if side < 0 else "r"), parts))


# ---- build ----------------------------------------------------------------------------------------------

def build(u: Unit):
    kit.reset()
    axis = intermediate_axis(u)
    i_axis = (axis.x, axis.y)
    g1 = helical("intermediate-gear", STAGE1, STAGE1["gear"], i_axis, STAGE1_Z, 0.03, -1, hub=(0.019, 0.032), web=True)
    rg = helical("reduction-gear", STAGE2, STAGE2["gear"], u.wheel, STAGE2_Z, 0.038, 1, web=True, bore=0.058)
    k = u.key
    parts = {
        f"{k}-motor": motor_housing(u),
        f"{k}-motor-end-cover": end_cover(u),
        f"{k}-stator": stator(u),
        f"{k}-rotor": rotor(u),
        f"{k}-rotor-shaft": rotor_shaft(u),
        f"{k}-motor-bearing-1": ball_bearing("motor-bearing-1", u.motor, u.housing_z[0] - 0.026, 0.016, 0.042, 0.014),
        f"{k}-motor-bearing-2": ball_bearing("motor-bearing-2", u.motor, 0.06 - 0.01, 0.02, 0.047, 0.016),
        f"{k}-resolver": resolver(u),
        f"{k}-pinion": helical("pinion", STAGE1, STAGE1["pinion"], u.motor, STAGE1_Z, 0.034, 1, hub=(0.016, 0.02)),
        f"{k}-intermediate-shaft": intermediate_shaft(u, axis),
        f"{k}-intermediate-gear": g1,
        f"{k}-reduction-gear": rg,
        f"{k}-differential": differential(u),
        f"{k}-side-gear-l": side_gear(u, -1),
        f"{k}-side-gear-r": side_gear(u, 1),
        f"{k}-spider-gears": spider_gears(u),
        f"{k}-gearbox": gearbox_case(u, axis, "case"),
        f"{k}-gearbox-cover": gearbox_case(u, axis, "cover"),
        f"{k}-oil-pump": oil_pump(u, axis),
        f"{k}-oil-cooler": oil_cooler(u, axis),
        f"{k}-{u.special}": special(u, axis),
        f"{k}-inverter": inverter_housing(u),
        f"{k}-inverter-lid": inverter_lid(u),
        f"{k}-power-module": power_module(u),
        f"{k}-dc-link-capacitor": dc_link(u),
        f"{k}-inverter-busbars": dc_busbars(u),
        f"{k}-gate-driver": gate_driver(u),
        f"{k}-control-board": control_board(u),
        f"{k}-current-sensor": current_sensor(u),
        f"{k}-phase-busbars": phase_busbars(u),
        f"{k}-hv-connector": hv_connector(u),
        **{f"{k}-drive-unit-mount-{n}": mount(u, n) for n in (1, 2, 3)},
        f"{k}-halfshaft-l": halfshaft(u, -1),
        f"{k}-halfshaft-r": halfshaft(u, 1),
    }
    keep = {o.name for o in parts.values()}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    nodes = {}
    for pid, o in parts.items():
        key = pid[len(k) + 1:]  # neutral visual key, e.g. "stator", "drive-unit-mount-2"
        kit.finish(o, key)
        nodes[key] = pid
    asset = f"{k}-drive-unit"
    out = ROOT / "web" / "assets-src" / f"{asset}.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    mp = ROOT / "web" / "public" / "assets" / f"{asset}.map.json"
    mp.write_text(json.dumps({"asset": asset, "nodes": nodes}, indent=2) + "\n")
    tris = {pid: sum(len(p.vertices) - 2 for p in o.data.polygons) for pid, o in parts.items()}
    print(f"{asset}: {len(parts)} parts, {sum(tris.values()):,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    print(f"  intermediate axis {axis.x:.4f}, {axis.y:.4f}; ratio {RATIO:.3f}; centre distances {CD1:.4f}, {CD2:.4f}")
    for pid, o in parts.items():
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        print(f"  {pid:30s} {tris[pid]:>7,} tris  [{lo[0]:.3f} {lo[1]:.3f} {lo[2]:.3f}] .. [{hi[0]:.3f} {hi[1]:.3f} {hi[2]:.3f}]")


if __name__ == "__main__":
    which = sys.argv[1:] or ["front", "rear"]
    for unit in (FRONT, REAR):
        if unit.key in which:
            build(unit)
