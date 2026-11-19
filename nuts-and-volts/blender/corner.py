"""The four wheel corners, modelled for close inspection.

Build them with scripts/build-assets.sh (runs this script, then compresses the result). For each corner
(fr, fl, rr, rl) this script writes the uncompressed model to web/assets-src/corner-<c>.glb and the visual
mapping to web/public/assets/corner-<c>.map.json.

Nodes are named by neutral visual keys (for example "caliper"); the mapping file says which component
id each node draws, so Blender names never become database identifiers (decision 0001). Positions are
the real assembled positions, in the app's coordinates (x forward, y up, z to the right). Dimensions
follow web/src/vehicle/dimensions.ts.

The suspension hard points (ball joints, arm bushes, damper ends, links) come from web/src/vehicle/suspension.json,
which the motion checks (web/src/scene/kinematics.ts) read too. Each axle's right-hand corner is built from its
own points; the left-hand corner is its mirror image (C3c step 2b: the rear is no longer the front flipped).
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
from kit import TAU, box, cylinder, lathe, merge_into, new_object, polar_array, rod, sector, transform  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

HARD_POINTS = json.loads((ROOT / "web" / "src" / "vehicle" / "suspension.json").read_text())

# Set per axle by configure(): the wheel centre (FRONT_AXLE_X or REAR_AXLE_X, AXLE_Y, TRACK_HALF), the calliper's
# angle in the wheel plane (radians from forward, towards up), and the hard points relative to the wheel centre.
AXLE = Vector(HARD_POINTS["front"]["wheel"])
CALIPER_ANGLE = HARD_POINTS["front"]["caliperAngle"]
PCD = 0.057  # wheel-stud circle radius (5 x 114.3 mm)
MOUNT_Z = 0.035  # hub mounting face, measured outwards from the wheel centre plane


def at_axle(obj):
    obj.data.transform(Matrix.Translation(AXLE))
    return obj


# ---- tyre ---------------------------------------------------------------------------------------------

def tyre_uv(obj) -> None:
    """Wrap-around UVs for the tyre: u runs once round the circumference; v runs across the tread
    (tread faces) or up the sidewall (sidewall faces). The app tiles its tread texture 64 times round."""
    mesh = obj.data
    uv = kit.fresh_uv(mesh)
    tread = [m.name for m in mesh.materials].index("rubber-tread") if "rubber-tread" in [m.name for m in mesh.materials] else -1
    for p in mesh.polygons:
        us = []
        for li in p.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co - AXLE
            u = (math.atan2(co.y, co.x) / TAU) % 1.0
            v = (co.z + 0.135) / 0.27 if p.material_index == tread else (math.hypot(co.x, co.y) - 0.28) / 0.13
            us.append([li, u, v])
        if max(u for _, u, _ in us) - min(u for _, u, _ in us) > 0.5:  # face straddles the seam
            for item in us:
                if item[1] < 0.5:
                    item[1] += 1.0
        for li, u, v in us:
            uv.data[li].uv = (u, v)


def tyre():
    """275/45 R22. The shape (rounded shoulders, four circumferential grooves, rim-protector rib,
    sidewall rings, raised size marking) is geometry; the tread blocks and sipes are a generated
    surface texture in the app, which looks finer up close at a fraction of the triangles."""
    grooves = [-0.058, -0.02, 0.02, 0.058]
    tread = []
    z = -0.094
    for g in grooves:
        tread += [(0.405, z), (0.405, g - 0.0065), (0.3955, g - 0.005), (0.3955, g + 0.005), (0.405, g + 0.0065)]
        z = g + 0.0065
    tread.append((0.405, 0.094))
    side = [(0.283, -0.112), (0.287, -0.122), (0.291, -0.1335), (0.298, -0.1355), (0.305, -0.132),  # bead, rim protector rib
            (0.318, -0.1325), (0.345, -0.1345), (0.366, -0.133), (0.368, -0.1345), (0.371, -0.1345), (0.373, -0.1325),  # sidewall ring
            (0.385, -0.1265), (0.395, -0.117), (0.401, -0.106), (0.404, -0.098)]
    outer = side + tread + [(r, -zz) for r, zz in reversed(side)]
    inner = [(0.288, 0.104), (0.33, 0.116), (0.372, 0.104), (0.388, 0.08), (0.39, 0.0), (0.388, -0.08), (0.372, -0.104), (0.33, -0.116), (0.288, -0.104)]
    body = kit.shade(new_object("tyre", lathe(outer + inner, 192), "rubber-tyre"), 40)
    kit.assign_by_normal(body, "rubber-tread", region=lambda c: abs(c.z) < 0.096 and Vector((c.x, c.y)).length > 0.393)

    # Raised sidewall marking on the outer side (size only: no brand).
    marks = []
    for text, centre in (("275/45 R22 112Y", math.pi / 2), ("RADIAL TUBELESS", -math.pi / 2)):
        curve = bpy.data.curves.new("mark", "FONT")
        curve.body = text
        curve.size = 0.017
        curve.extrude = 0.0006
        curve.align_x = "CENTER"
        holder = bpy.data.objects.new("mark", curve)
        bpy.context.scene.collection.objects.link(holder)
        mark = kit.to_mesh(holder)
        flip = 1 if centre > 0 else -1
        for v in mark.data.vertices:
            x, y, zz = v.co
            r = 0.352 + flip * y
            a = centre - flip * x / 0.352
            v.co = (r * math.cos(a), r * math.sin(a), 0.1342 + zz)
        mark.data.materials.clear()
        mark.data.materials.append(kit.material("rubber-tyre"))
        marks.append(mark)
    body = kit.join("tyre", [body, *marks])
    at_axle(body)
    tyre_uv(body)
    return body


# ---- wheel --------------------------------------------------------------------------------------------

def loft(sections: list[list[Vector]]) -> bmesh.types.BMesh:
    """Solid through a series of matching cross-sections (any number of points), capped at both ends."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in s] for s in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            k = (i + 1) % n
            bm.faces.new((a[i], a[k], b[k], b[i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def face_z(r: float) -> float:
    """Height of a spoke's centre line at radius r: the face dishes outwards towards the rim (concave wheel)."""
    t = max(0.0, (r - 0.088) / 0.186)
    return 0.072 + 0.032 * t ** 1.35


def spoke_leg(angle: float, r0: float, r1: float, w0: float, w1: float, swing: float = 0.0):
    """A faceted spoke: flat underside, sloping side facets and a raised central ridge (a five-sided section
    that catches light along its length). `swing` bends it sideways towards the rim."""
    sections = []
    n = 12
    for i in range(n + 1):
        t = i / n
        r = r0 + (r1 - r0) * t
        w = w0 + (w1 - w0) * t
        d = 0.031 - 0.011 * min(1.0, (r - 0.088) / 0.186)
        a = angle + swing * t ** 1.1
        u = Vector((math.cos(a), math.sin(a), 0))
        v = Vector((-math.sin(a), math.cos(a), 0))
        c = u * r + Vector((0, 0, face_z(r)))
        up = Vector((0, 0, 1))
        sections.append([c - v * w / 2 - up * d / 2, c + v * w / 2 - up * d / 2, c + v * w * 0.4 + up * d * 0.28,
                         c + up * d / 2, c - v * w * 0.4 + up * d * 0.28])
    return loft(sections)


def wheel():
    """22 x 9.5 forged wheel: five sculpted Y-spokes with a raised ridge, diamond-cut faces over gunmetal
    paint, recessed nut pockets, machined lip, real barrel profile with bead seats and drop centre, valve."""
    outer = [(0.296, -0.122), (0.297, -0.112), (0.284, -0.106), (0.2794, -0.095), (0.281, -0.085), (0.274, -0.072),
             (0.258, -0.055), (0.258, 0.02), (0.272, 0.05), (0.281, 0.072), (0.2794, 0.095), (0.284, 0.106), (0.297, 0.113), (0.296, 0.122)]
    inner = [(r - 0.007, zz) for r, zz in reversed(outer)]
    barrel = kit.bevel(new_object("barrel", lathe(outer + inner, 192), "alloy-painted"), 0.0015, 2)

    hub = new_object("hub", lathe([(0.034, MOUNT_Z), (0.1, MOUNT_Z), (0.102, 0.072), (0.097, 0.087), (0.042, 0.089), (0.034, 0.083)], 128), "alloy-painted")
    holes = bmesh.new()
    for i in range(5):
        a = math.pi / 2 + TAU * i / 5
        c = Vector((PCD * math.cos(a), PCD * math.sin(a), 0))
        merge_into(holes, transform(cylinder(0.0105, 0.12, 32), Matrix.Translation(c + Vector((0, 0, 0.06)))))
        merge_into(holes, transform(cylinder(0.0168, 0.03, 48), Matrix.Translation(c + Vector((0, 0, 0.076 + 0.015)))))  # nut pocket
    hub = kit.bevel(kit.cut(hub, new_object("holes", holes, "alloy-painted")), 0.0016, 3)

    spokes = bmesh.new()
    for i in range(5):
        base = math.pi / 2 + math.pi / 5 + TAU * i / 5
        merge_into(spokes, spoke_leg(base, 0.086, 0.152, 0.05, 0.044))  # trunk
        for side in (-1, 1):
            merge_into(spokes, spoke_leg(base + side * 0.04, 0.14, 0.274, 0.03, 0.022, side * 0.13))  # legs
    spokes = kit.bevel(new_object("spokes", spokes, "alloy-painted"), 0.0026, 3, 22)

    cap = new_object("cap", lathe([(0.0005, 0.097), (0.024, 0.0955), (0.026, 0.093), (0.03, 0.092), (0.031, 0.089), (0.031, 0.084), (0.0005, 0.084)], 96), "gloss-black")
    valve = new_object("valve", rod(Vector((0, 0.262, 0.062)), Vector((0, 0.285, 0.098)), 0.004, 16), "steel-chrome")

    obj = kit.join("wheel", [kit.shade(o, 28) for o in (barrel, hub, spokes)] + [kit.shade(cap, 40), kit.shade(valve, 40)])
    # Diamond-cut (machined) faces: the spoke tops and ridge facets, the hub face and the rim lip.
    kit.assign_by_normal(obj, "alloy-machined", Vector((0, 0, 1)), 0.55, only="alloy-painted",
                         region=lambda c: c.z > 0.066 and 0.04 < Vector((c.x, c.y)).length < 0.3)
    kit.radial_uv(obj, Vector((0, 0, 0)))
    return at_axle(obj)


def wheel_nuts():
    """Five nuts sharing one geometry (drawn from one mesh, placed five times)."""
    hexa = new_object("hex", cylinder(0.0108, 0.017, 6), "steel-chrome")
    hexa = kit.bevel(hexa, 0.0012, 2, 40)
    seat = new_object("seat", transform(cylinder(0.0098, 0.007, 32, r2=0.0072), Matrix.Translation((0, 0, -0.012))), "steel-chrome")
    dome = new_object("dome", transform(kit.sphere(0.0092, 3), Matrix.Translation((0, 0, 0.0085)) @ Matrix.Diagonal((1, 1, 0.75, 1))), "steel-chrome")
    first = kit.join("nut", [kit.shade(hexa, 30), kit.shade(seat, 30), kit.shade(dome, 60)])
    kit.box_uv(first)
    nuts = []
    for n in range(1, 6):
        a = math.pi / 2 + TAU * (n - 1) / 5
        obj = first if n == 1 else bpy.data.objects.new(f"nut{n}", first.data)
        if n > 1:
            bpy.context.scene.collection.objects.link(obj)
        obj.location = AXLE + Vector((PCD * math.cos(a), PCD * math.sin(a), 0.076 + 0.0155))  # seated in its pocket
        nuts.append(obj)
    return nuts


# ---- brakes -------------------------------------------------------------------------------------------

RING_Z = MOUNT_Z - 0.055  # centre plane of the disc's friction ring


def brake_disc():
    """380 x 34 mm two-piece floating disc: ventilated iron ring with curved vanes and slots,
    anodised aluminium hat, ten bobbins."""
    parts = []
    for z0, z1 in ((RING_Z - 0.017, RING_Z - 0.006), (RING_Z + 0.006, RING_Z + 0.017)):
        plate = new_object("plate", lathe([(0.112, z0), (0.19, z0), (0.19, z1), (0.112, z1)], 160), "iron-cast")
        slots = bmesh.new()
        face = z1 if z1 > RING_Z else z0
        for i in range(8):
            a = TAU * i / 8
            s = transform(box(0.055, 0.0032, 0.004), Matrix.Translation((0.152 * math.cos(a), 0.152 * math.sin(a), face)) @ Matrix.Rotation(a + 0.55, 4, "Z"))
            merge_into(slots, s)
        plate = kit.bevel(kit.cut(plate, new_object("slots", slots, "iron-cast")), 0.001, 2)
        plate = kit.shade(plate, 30)
        kit.assign_by_normal(plate, "iron-friction", Vector((0, 0, 1 if z1 > RING_Z else -1)), 0.95)
        parts.append(plate)
    vanes = bmesh.new()
    for i in range(48):
        a = TAU * i / 48
        vane = transform(box(0.072, 0.0055, 0.0125), Matrix.Translation((0.151 * math.cos(a), 0.151 * math.sin(a), RING_Z)) @ Matrix.Rotation(a + 0.42, 4, "Z"))
        merge_into(vanes, vane)
    parts.append(kit.shade(kit.bevel(new_object("vanes", vanes, "iron-cast"), 0.001, 1), 30))

    hat = lathe([(0.035, MOUNT_Z - 0.007), (0.035, MOUNT_Z), (0.098, MOUNT_Z), (0.105, MOUNT_Z - 0.006), (0.105, RING_Z + 0.014),
                 (0.114, RING_Z + 0.014), (0.114, RING_Z + 0.008), (0.099, RING_Z + 0.008), (0.099, MOUNT_Z - 0.007)], 128)
    hat = new_object("hat", hat, "aluminium-anodised")
    holes = bmesh.new()
    for i in range(5):
        a = math.pi / 2 + TAU * i / 5
        merge_into(holes, transform(cylinder(0.0075, 0.03, 24), Matrix.Translation((PCD * math.cos(a), PCD * math.sin(a), MOUNT_Z))))
    for i in range(10):
        a = TAU * (i + 0.5) / 10
        merge_into(holes, rod(Vector((0.09 * math.cos(a), 0.09 * math.sin(a), MOUNT_Z - 0.022)), Vector((0.115 * math.cos(a), 0.115 * math.sin(a), MOUNT_Z - 0.022)), 0.0065, 24))
    hat = kit.shade(kit.bevel(kit.cut(hat, new_object("holes", holes, "aluminium-anodised")), 0.0012, 2), 30)
    parts.append(hat)

    bobbins = bmesh.new()
    for i in range(10):
        a = TAU * i / 10
        c = Vector((0.1105 * math.cos(a), 0.1105 * math.sin(a), RING_Z + 0.011))
        merge_into(bobbins, transform(cylinder(0.0055, 0.016, 20), Matrix.Translation(c)))
        merge_into(bobbins, transform(cylinder(0.0078, 0.0025, 20), Matrix.Translation(c + Vector((0, 0, 0.009)))))
    parts.append(kit.shade(new_object("bobbins", bobbins, "steel-zinc"), 40))

    obj = kit.join("disc", parts)
    kit.radial_uv(obj, Vector((0, 0, 0)))
    return at_axle(obj)


def caliper():
    """Six-piston monobloc calliper (one casting either side of the disc, joined by a bridge over it).
    Proportions follow typical large-disc performance callipers: about 290 mm long round the disc, ends
    rounded, three piston bulges each side, a stiffening rib along the bridge, two pad-inspection windows
    either side of a central strut, mounting lugs on the inboard half with bolts, a crossover pipe linking
    the two halves, bleed nipples with caps, and a pad-retaining pin with an anti-rattle spring."""
    c = CALIPER_ANGLE
    span = 0.66
    z_in, z_out = RING_Z - 0.066, RING_Z + 0.06  # outboard half clear of the wheel's spokes
    r_in, r_out = 0.128, 0.232
    mid = (r_in + r_out) / 2
    rough = sector(r_in, r_out, c - span, c + span, z_in, z_out, 96)
    for k in (-span, span):  # rounded ends
        a = c + k
        merge_into(rough, transform(cylinder((r_out - r_in) / 2, z_out - z_in, 64), Matrix.Translation((mid * math.cos(a), mid * math.sin(a), RING_Z))))
    for k in (-0.38, 0.0, 0.38):  # piston bulges, both halves
        a = c + k
        p = Vector((0.176 * math.cos(a), 0.176 * math.sin(a), 0))
        for z, d in ((z_out, 1), (z_in, -1)):
            merge_into(rough, transform(cylinder(0.026, 0.012, 64), Matrix.Translation(p + Vector((0, 0, z + d * 0.003)))))
    merge_into(rough, sector(r_out - 0.004, r_out + 0.004, c - span * 0.8, c + span * 0.8, RING_Z - 0.012, RING_Z + 0.012, 64))  # bridge rib
    for k in (-0.78, 0.78):  # inboard mounting lugs
        a = c + k
        merge_into(rough, transform(box(0.05, 0.036, 0.028), Matrix.Translation((0.168 * math.cos(a), 0.168 * math.sin(a), z_in + 0.012)) @ Matrix.Rotation(a, 4, "Z")))
    body = kit.cast_finish(new_object("body", rough, "caliper-paint"), 0.0018, 14, 0.3)
    # Machined after casting: the disc slot with pad pockets, and two inspection windows.
    pocket = new_object("pocket", sector(0.09, 0.201, c - span + 0.06, c + span - 0.06, RING_Z - 0.034, RING_Z + 0.034, 96), "caliper-paint")
    windows = sector(0.195, 0.26, c - 0.3, c - 0.035, RING_Z - 0.021, RING_Z + 0.021, 32)
    merge_into(windows, sector(0.195, 0.26, c + 0.035, c + 0.3, RING_Z - 0.021, RING_Z + 0.021, 32))
    body = kit.shade(kit.cut(body, pocket, new_object("windows", windows, "caliper-paint")), 50)

    hardware = bmesh.new()
    for k in (-0.78, 0.78):  # mounting bolts with washers
        a = c + k
        p = Vector((0.168 * math.cos(a), 0.168 * math.sin(a), z_in - 0.003))
        merge_into(hardware, transform(cylinder(0.0105, 0.009, 6), Matrix.Translation(p)))
        merge_into(hardware, transform(cylinder(0.012, 0.0018, 32), Matrix.Translation(p + Vector((0, 0, 0.0052)))))
    for k, z in ((-0.52, z_in + 0.022),):  # bleed nipple, on the inboard half only (clear of the wheel)
        a = c + k
        u = Vector((math.cos(a), math.sin(a), 0))
        merge_into(hardware, rod(u * 0.232 + Vector((0, 0, z)), u * 0.246 + Vector((0, 0, z)), 0.0038, 16))
        merge_into(hardware, rod(u * 0.229 + Vector((0, 0, z)), u * 0.236 + Vector((0, 0, z)), 0.0062, 6))
    u = Vector((math.cos(c), math.sin(c), 0))
    merge_into(hardware, rod(u * 0.206 + Vector((0, 0, z_in + 0.012)), u * 0.206 + Vector((0, 0, z_out - 0.008)), 0.0032, 16))  # pad pin
    hw = kit.shade(kit.bevel(new_object("hardware", hardware, "steel-zinc"), 0.0006, 1), 40)
    caps = bmesh.new()
    for k, z in ((-0.52, z_in + 0.022),):
        a = c + k
        u = Vector((math.cos(a), math.sin(a), 0))
        merge_into(caps, rod(u * 0.244 + Vector((0, 0, z)), u * 0.251 + Vector((0, 0, z)), 0.0055, 16))
    caps = kit.shade(new_object("caps", caps, "rubber"), 40)
    # Crossover pipe: steel brake pipe round the outer end, joining the two halves.
    a0 = c + span + 0.02
    pts = [Vector((r * math.cos(a0 + da), r * math.sin(a0 + da), z)) for r, da, z in
           ((0.214, -0.04, z_in + 0.008), (0.226, 0.03, z_in + 0.004), (0.232, 0.06, RING_Z), (0.226, 0.03, z_out - 0.004), (0.214, -0.04, z_out - 0.008))]
    pipe = kit.tube_path(pts, 0.0026, 3)
    pipe.data.materials.append(kit.material("steel-zinc"))
    # Anti-rattle spring: a thin steel strip over the pad pin.
    spring = kit.tube_path([u * 0.205 + Vector((0, 0, RING_Z - 0.03)), u * 0.212 + Vector((0, 0, RING_Z)), u * 0.205 + Vector((0, 0, RING_Z + 0.03))], 0, profile="rect", size=(0.012, 0.0012))
    spring.data.materials.append(kit.material("steel-zinc"))
    obj = kit.join("caliper", [body, hw, caps, kit.shade(pipe, 60), kit.shade(spring, 40)])
    kit.box_uv(obj)
    return at_axle(obj)


def brake_hose():
    """Flexible brake hose from a chassis bracket to the calliper inlet: rubber hose with crimped steel
    end fittings, a banjo bolt at the calliper and a bracket clip at the body end."""
    c = CALIPER_ANGLE - 0.42
    inlet = Vector((0.222 * math.cos(c), 0.222 * math.sin(c), RING_Z - 0.07))
    # from a bracket on the inner wheelhouse behind the upper arm, staying inboard of the tyre and inside the rim
    # (on the calliper's side of the axle: behind it for a trailing calliper, ahead for a leading one)
    sx = math.copysign(1, inlet.x)
    bracket = Vector((sx * 0.17, 0.38, -0.31))  # inboard of the tyre's sweep at lock and bump (C3c step 4)
    path = [bracket, Vector((sx * 0.12, 0.3, -0.155)), Vector((sx * 0.08, 0.255, -0.135)), inlet + Vector((0.0, 0.025, -0.03)), inlet + Vector((0, 0.012, -0.01))]
    hose = kit.tube_path(path, 0.0058, 4)
    hose.data.materials.append(kit.material("rubber"))
    d0 = (path[1] - path[0]).normalized()
    d1 = (path[-1] - path[-2]).normalized()
    pieces = [kit.shade(hose, 60),
              new_object("ferrule-a", rod(path[0] - d0 * 0.004, path[0] + d0 * 0.022, 0.0078, 24), "steel-zinc"),
              new_object("ferrule-b", rod(path[-1] - d1 * 0.022, path[-1] + d1 * 0.002, 0.0078, 24), "steel-zinc"),
              new_object("banjo", transform(cylinder(0.009, 0.012, 32), Matrix.Translation(inlet) @ Matrix.Rotation(math.pi / 2, 4, "X")), "steel-zinc"),
              new_object("banjo-bolt", transform(cylinder(0.0065, 0.03, 6), Matrix.Translation(inlet) @ Matrix.Rotation(math.pi / 2, 4, "X")), "steel-zinc"),
              new_object("clip", transform(box(0.026, 0.004, 0.03), Matrix.Translation(path[0] + Vector((0, 0.012, 0))) @ kit.align_z(d0)), "steel-dark")]
    pieces = [pieces[0]] + [kit.shade(kit.bevel(o, 0.0006, 1), 40) for o in pieces[1:]]
    obj = kit.join("hose", pieces)
    kit.box_uv(obj)
    return at_axle(obj)


def hub_nut():
    """Axle nut on the end of the drive shaft, with its washer, in the middle of the hub."""
    z = MOUNT_Z + 0.008
    nut = kit.bevel(new_object("nut", transform(cylinder(0.019, 0.014, 6), Matrix.Translation((0, 0, z + 0.009))), "steel-zinc"), 0.0012, 2, 40)
    washer = new_object("washer", lathe([(0.012, z), (0.026, z), (0.026, z + 0.002), (0.012, z + 0.002)], 64), "steel-zinc")
    thread = new_object("stub", transform(cylinder(0.0115, 0.026, 32), Matrix.Translation((0, 0, z + 0.006))), "steel-machined")
    obj = kit.join("hub-nut", [kit.shade(nut, 30), kit.shade(washer, 30), kit.shade(thread, 30)])
    kit.radial_uv(obj, Vector((0, 0, 0)))
    return at_axle(obj)


def brake_pad(side: str):
    """Backing plate with ears and a friction block with a centre slot and chamfered ends."""
    c = CALIPER_ANGLE
    s = -1 if side == "inner" else 1
    face = RING_Z + s * 0.017
    fz0, fz1 = sorted((face, face + s * 0.011))
    bz0, bz1 = sorted((face + s * 0.011, face + s * 0.016))
    block = new_object("block", sector(0.133, 0.189, c - 0.36, c + 0.36, fz0, fz1, 32), "pad-friction")
    slot = new_object("slot", sector(0.12, 0.2, c - 0.006, c + 0.006, face - 0.004, face + 0.004, 2), "pad-friction")
    block = kit.shade(kit.bevel(kit.cut(block, slot), 0.002, 2, 35), 35)
    plate = new_object("plate", sector(0.128, 0.195, c - 0.42, c + 0.42, bz0, bz1, 32), "steel-dark")
    plate = kit.shade(kit.bevel(plate, 0.0012, 2), 35)
    obj = kit.join("pad", [block, plate])
    kit.box_uv(obj)
    return at_axle(obj)


def brake_shield():
    """Pressed-steel dust shield with a rolled lip, cut away around the calliper and notched where the knuckle's
    arms pass."""
    z = RING_Z - 0.028
    prof = [(0.076, z - 0.0008), (0.2, z - 0.0008), (0.2055, z + 0.004), (0.2055, z + 0.014), (0.204, z + 0.014),
            (0.204, z + 0.0045), (0.1995, z + 0.0008), (0.076, z + 0.0008)]
    obj = new_object("shield", lathe(prof, 160), "steel-dark")
    window = new_object("w", sector(0.11, 0.25, CALIPER_ANGLE - 1.02, CALIPER_ANGLE + 1.02, z - 0.02, z + 0.03, 24), "steel-dark")
    # notches where the knuckle's arms pass to the lower and upper ball joints and the steering arm
    notches = bmesh.new()
    for p, half in ((LOWER_JOINT, 0.42), (UPPER_JOINT, 0.3), (STEER_JOINT, 0.3)):
        a = math.atan2(p.y, p.x)
        merge_into(notches, sector(0.07, 0.25, a - half, a + half, z - 0.02, z + 0.03, 12))
    obj = kit.shade(kit.cut(obj, window, new_object("notches", notches, "steel-dark")), 40)
    kit.radial_uv(obj, Vector((0, 0, 0)))
    return at_axle(obj)


# ---- hub, bearing, knuckle ----------------------------------------------------------------------------

def hub():
    """Hub flange with scallops, five pressed-in studs, pilot spigot and splined bore."""
    flange_z = MOUNT_Z - 0.007
    prof = [(0.017, -0.062), (0.031, -0.062), (0.031, flange_z - 0.014), (0.07, flange_z - 0.011), (0.077, flange_z - 0.006),
            (0.077, flange_z), (0.036, flange_z), (0.036, flange_z + 0.012), (0.031, flange_z + 0.014), (0.017, flange_z + 0.014)]
    body = new_object("hub", lathe(prof, 96), "steel-machined")
    scallops = bmesh.new()
    for i in range(5):
        a = math.pi / 2 + math.pi / 5 + TAU * i / 5
        merge_into(scallops, transform(cylinder(0.019, 0.05, 40), Matrix.Translation((0.083 * math.cos(a), 0.083 * math.sin(a), flange_z))))
    body = kit.shade(kit.bevel(kit.cut(body, new_object("scallops", scallops, "steel-machined")), 0.0015, 2), 32)
    teeth = polar_array(lambda: transform(box(0.004, 0.003, 0.09), Matrix.Translation((0.0175, 0, -0.012))), 24)
    teeth = kit.shade(new_object("splines", teeth, "steel-machined"), 40)
    studs = bmesh.new()
    for i in range(5):
        a = math.pi / 2 + TAU * i / 5
        p = Vector((PCD * math.cos(a), PCD * math.sin(a), 0))
        merge_into(studs, transform(cylinder(0.0064, 0.06, 24), Matrix.Translation(p + Vector((0, 0, flange_z + 0.026)))))
        merge_into(studs, transform(cylinder(0.0085, 0.006, 24), Matrix.Translation(p + Vector((0, 0, flange_z - 0.009)))))
        merge_into(studs, transform(cylinder(0.0064, 0.003, 24, r2=0.004), Matrix.Translation(p + Vector((0, 0, flange_z + 0.0575)))))
    studs = kit.shade(new_object("studs", studs, "steel-zinc"), 40)
    obj = kit.join("hub", [body, teeth, studs])
    kit.radial_uv(obj, Vector((0, 0, 0)))
    return at_axle(obj)


def bearing():
    """Third-generation hub bearing: flanged outer race, split inner race, two rows of balls, brass cages."""
    z0, z1 = -0.055, -0.005
    outer = new_object("outer", lathe([(0.0475, z0), (0.06, z0), (0.06, z1), (0.0475, z1)], 96), "bearing-steel")
    ears = bmesh.new()
    merge_into(ears, lathe([(0.059, -0.018), (0.07, -0.018), (0.07, -0.008), (0.059, -0.008)], 96))
    for i in range(3):
        a = math.pi / 6 + TAU * i / 3
        merge_into(ears, transform(cylinder(0.014, 0.01, 40), Matrix.Translation((0.078 * math.cos(a), 0.078 * math.sin(a), -0.013))))
    outer = kit.cut(outer, new_object("ears", ears, "bearing-steel"), union=True)
    holes = bmesh.new()
    for i in range(3):
        a = math.pi / 6 + TAU * i / 3
        merge_into(holes, transform(cylinder(0.006, 0.03, 24), Matrix.Translation((0.08 * math.cos(a), 0.08 * math.sin(a), -0.013))))
    grooves = bmesh.new()
    for zr in (-0.043, -0.017):
        merge_into(grooves, lathe([(0.0425 + 0.0058 * math.cos(t), zr + 0.0058 * math.sin(t)) for t in (TAU * i / 16 for i in range(16))], 96))
    outer = kit.cut(outer, new_object("holes", holes, "bearing-steel"), new_object("grooves", grooves, "bearing-steel"))
    outer = kit.shade(kit.bevel(outer, 0.0008, 2), 35)
    inner = new_object("inner", lathe([(0.031, z0 + 0.001), (0.037, z0 + 0.001), (0.037, z1 - 0.001), (0.031, z1 - 0.001)], 96), "bearing-steel")
    inner = kit.shade(kit.bevel(inner, 0.0006, 1), 35)
    balls = bmesh.new()
    cages = bmesh.new()
    for zr in (-0.043, -0.017):
        for i in range(14):
            a = TAU * (i + (0.5 if zr > -0.03 else 0)) / 14
            merge_into(balls, transform(kit.sphere(0.0055, 2), Matrix.Translation((0.0425 * math.cos(a), 0.0425 * math.sin(a), zr))))
        merge_into(cages, lathe([(0.0405, zr - 0.0042), (0.0445, zr - 0.0042), (0.0445, zr + 0.0042), (0.0405, zr + 0.0042)], 96))
    balls = kit.shade(new_object("balls", balls, "bearing-steel"), 80)
    pockets = bmesh.new()
    for zr in (-0.043, -0.017):
        for i in range(14):
            a = TAU * (i + (0.5 if zr > -0.03 else 0)) / 14
            merge_into(pockets, transform(kit.sphere(0.006, 2), Matrix.Translation((0.0425 * math.cos(a), 0.0425 * math.sin(a), zr))))
    cages = kit.shade(kit.cut(new_object("cages", cages, "brass"), new_object("pockets", pockets, "brass")), 40)
    obj = kit.join("bearing", [outer, inner, balls, cages])
    kit.radial_uv(obj, Vector((0, 0, 0)))
    return at_axle(obj)


# Ball joints and the steering (or toe) arm's joint relative to the wheel centre: set by configure().
UPPER_JOINT = LOWER_JOINT = STEER_JOINT = Vector()


def knuckle():
    """Cast aluminium upright: bearing boss, upper and lower ball-joint bosses, steering arm and
    calliper lugs, merged and smoothed like a casting, then machined bores."""
    bm = bmesh.new()
    merge_into(bm, transform(cylinder(0.074, 0.055, 64), Matrix.Translation((0, 0, -0.0575))))
    if UPPER_JOINT.y > 0.3:
        # goose neck: up out of the rim's open inner side, inboard of the tyre's inner sidewall, to the high upper
        # ball joint above the tyre (C3c step 2b)
        neck = [Vector((-0.01, 0.06, -0.065)), Vector((UPPER_JOINT.x * 0.5, 0.17, -0.13)), Vector((UPPER_JOINT.x, 0.28, -0.19)),
                UPPER_JOINT + Vector((0, -0.02, 0))]
        for a, b in zip(neck, neck[1:]):
            merge_into(bm, rod(a, b, 0.021))
            merge_into(bm, transform(kit.sphere(0.021, 2), Matrix.Translation(b)))
    else:
        merge_into(bm, rod(Vector((-0.01, 0.05, -0.06)), UPPER_JOINT + Vector((0, -0.02, 0)), 0.021))
    merge_into(bm, transform(cylinder(0.024, 0.036, 40), Matrix.Translation(UPPER_JOINT) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    merge_into(bm, rod(Vector((0.0, -0.05, -0.062)), LOWER_JOINT + Vector((0, 0.02, 0)), 0.026))
    merge_into(bm, transform(cylinder(0.027, 0.04, 40), Matrix.Translation(LOWER_JOINT) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    merge_into(bm, rod(Vector((math.copysign(0.05, STEER_JOINT.x), STEER_JOINT.y * 0.4, -0.07)), STEER_JOINT, 0.017, 32, 0.014))
    merge_into(bm, transform(cylinder(0.018, 0.028, 32), Matrix.Translation(STEER_JOINT) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    for k in (-0.62, 0.62):
        a = CALIPER_ANGLE + k
        lug = Vector((0.168 * math.cos(a), 0.168 * math.sin(a), RING_Z - 0.09))
        merge_into(bm, rod(Vector((0.06 * math.cos(a), 0.06 * math.sin(a), -0.07)), lug, 0.016))
        merge_into(bm, transform(cylinder(0.017, 0.02, 32), Matrix.Translation(lug)))
    body = kit.cast_finish(new_object("knuckle", bm, "aluminium-cast"), 0.0032, 8, 0.3)
    bores = bmesh.new()
    merge_into(bores, transform(cylinder(0.0605, 0.2, 96), Matrix.Translation((0, 0, -0.05))))
    for p in (UPPER_JOINT, LOWER_JOINT, STEER_JOINT):
        merge_into(bores, transform(cylinder(0.0085, 0.1, 32), Matrix.Translation(p) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    for k in (-0.62, 0.62):
        a = CALIPER_ANGLE + k
        merge_into(bores, transform(cylinder(0.0065, 0.1, 24), Matrix.Translation((0.168 * math.cos(a), 0.168 * math.sin(a), RING_Z - 0.09))))
    face = transform(box(0.4, 0.4, 0.05), Matrix.Translation((0, 0, -0.03 + 0.025)))
    body = kit.cut(body, new_object("bores", bores, "aluminium-cast"), new_object("face", face, "aluminium-cast"))
    body = kit.shade(body, 45)
    kit.assign_by_normal(body, "aluminium-machined", Vector((0, 0, 1)), 0.97)
    kit.box_uv(body, 6)
    return at_axle(body)


def speed_sensor():
    p = Vector((-0.035, 0.065, -0.07))  # above the drive shaft's outer joint, clear of it at full lock
    parts = [
        new_object("body", transform(cylinder(0.008, 0.034, 32), Matrix.Translation(p)), "plastic-black"),
        new_object("tab", transform(box(0.03, 0.016, 0.004), Matrix.Translation(p + Vector((0.014, 0, -0.012)))), "plastic-black"),
        new_object("bolt", transform(cylinder(0.0055, 0.006, 6), Matrix.Translation(p + Vector((0.022, 0, -0.008)))), "steel-zinc"),
        new_object("plug", transform(box(0.018, 0.014, 0.022), Matrix.Translation(p + Vector((0, 0, -0.026)))), "plastic-black"),
    ]
    parts = [kit.shade(kit.bevel(o, 0.0012, 2), 40) for o in parts]
    cable = kit.tube_path([p + Vector((0, 0, -0.037)), p + Vector((-0.01, 0.03, -0.05)), p + Vector((-0.02, 0.09, -0.06)), p + Vector((-0.03, 0.15, -0.055))], 0.0032, 3)
    cable.data.materials.append(kit.material("plastic-black"))
    obj = kit.join("sensor", [*parts, kit.shade(cable, 60)])
    kit.box_uv(obj)
    return at_axle(obj)


# ---- suspension ---------------------------------------------------------------------------------------

def bushing(centre: Vector, axis: str = "X"):
    """Rubber bush pressed into an eye: outer steel sleeve, rubber, inner sleeve with a through-bolt."""
    rot = Matrix.Rotation(math.pi / 2, 4, "Y" if axis == "X" else "X")
    m = Matrix.Translation(centre) @ rot
    pieces = [
        kit.cut(new_object("rubber", transform(lathe([(0.0095, -0.026), (0.02, -0.024), (0.02, 0.024), (0.0095, 0.026)], 48), m), "rubber"),
                new_object("voids", transform(merge_into(sector(0.012, 0.0175, 0.5, 2.6, -0.03, 0.03, 12), sector(0.012, 0.0175, 3.64, 5.74, -0.03, 0.03, 12)), m), "rubber")),  # kidney voids
        new_object("sleeve", transform(lathe([(0.0062, -0.031), (0.0095, -0.031), (0.0095, 0.031), (0.0062, 0.031)], 32), m), "steel-zinc"),
        new_object("bolt", transform(cylinder(0.0062, 0.075, 24), m), "steel-zinc"),
        new_object("head", transform(transform(cylinder(0.011, 0.007, 6), Matrix.Translation((0, 0, 0.038))), m), "steel-zinc"),
        new_object("nut", transform(transform(cylinder(0.011, 0.008, 6), Matrix.Translation((0, 0, -0.038))), m), "steel-zinc"),
    ]
    return [kit.shade(kit.bevel(o, 0.0008, 1), 40) for o in pieces]


def ball_joint(top: Vector, down: bool = False):
    """Ball-joint housing with a pleated rubber boot and a tapered stud."""
    m = Matrix.Translation(top) @ (Matrix.Rotation(math.pi, 4, "X") if down else Matrix.Identity(4)) @ Matrix.Rotation(-math.pi / 2, 4, "X")
    boot = [(0.004, 0.0)] + [(0.018 + 0.004 * math.sin(i * 1.3), 0.002 + i * 0.0035) for i in range(9)] + [(0.008, 0.034), (0.004, 0.034)]
    pieces = [
        new_object("housing", transform(lathe([(0.004, -0.032), (0.026, -0.032), (0.026, -0.004), (0.004, -0.004)], 48), m), "aluminium-forged"),
        new_object("boot", transform(lathe(boot, 48), m), "rubber"),
        new_object("stud", transform(lathe([(0.0005, 0.03), (0.009, 0.03), (0.0065, 0.065), (0.0005, 0.065)], 32), m), "steel-zinc"),
        new_object("castle-nut", transform(transform(cylinder(0.011, 0.01, 6), Matrix.Translation((0, 0, 0.07))), m), "steel-zinc"),
    ]
    return [kit.shade(kit.bevel(o, 0.0008, 1), 40) for o in pieces]


def wishbone(name: str, outer: Vector, inner_front: Vector, inner_rear: Vector, bar=(0.04, 0.026), brace: float | None = None, web_reach: float = 0.42,
             stud_down: bool = False):
    """Forged wishbone: two legs of rounded section, a web near the ball joint, bushings at the frame. The ball
    joint's stud points up into the knuckle (a lower arm) or down into it (stud_down: an upper arm)."""
    legs = [kit.tube_path([inner_front, outer], 0, profile="I", size=bar), kit.tube_path([inner_rear, outer], 0, profile="I", size=bar)]
    web = bmesh.new()
    a, b, c = outer, outer.lerp(inner_front, web_reach), outer.lerp(inner_rear, web_reach)
    n = (b - a).cross(c - a).normalized() * 0.005
    verts = [web.verts.new(p) for p in (a - n, b - n, c - n, a + n, b + n, c + n)]
    web.faces.new((verts[0], verts[2], verts[1]))
    web.faces.new((verts[3], verts[4], verts[5]))
    for i, j in ((0, 1), (1, 2), (2, 0)):
        web.faces.new((verts[i], verts[j], verts[j + 3], verts[i + 3]))
    pieces = legs + [new_object("web", web, "aluminium-forged")]
    for p in (inner_front, inner_rear):
        pieces.append(new_object("eye", transform(cylinder(0.029, 0.056, 48), Matrix.Translation(p) @ Matrix.Rotation(math.pi / 2, 4, "Y")), "aluminium-forged"))
    pieces.append(new_object("cup", transform(cylinder(0.028, 0.03, 48), Matrix.Translation(outer) @ Matrix.Rotation(math.pi / 2, 4, "X")), "aluminium-forged"))
    if brace is not None:
        f, r = inner_front.lerp(outer, brace), inner_rear.lerp(outer, brace)
        pieces.append(kit.tube_path([f, r], 0, profile="rect", size=(0.03, 0.022)))
        mid = (f + r) / 2
        for dx in (-0.022, 0.022):
            pieces.append(new_object("clevis", transform(box(0.008, 0.06, 0.05), Matrix.Translation(mid + Vector((dx, 0.03, 0)))), "aluminium-forged"))
    for o in pieces:
        if not o.data.materials:
            o.data.materials.append(kit.material("aluminium-forged"))
    body = kit.join("arm", pieces)
    body = kit.cast_finish(body, 0.0028, 6, 0.32)
    bores = bmesh.new()
    for p in (inner_front, inner_rear):
        merge_into(bores, transform(cylinder(0.02, 0.1, 40), Matrix.Translation(p) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    body = kit.shade(kit.cut(body, new_object("bores", bores, "aluminium-forged")), 40)
    extras = bushing(inner_front) + bushing(inner_rear) + (ball_joint(outer - Vector((0, 0.015, 0)), down=True) if stud_down else ball_joint(outer + Vector((0, 0.015, 0))))
    obj = kit.join(name, [body, *extras])
    kit.box_uv(obj, 6)
    return obj


# The damper runs from its lower eye on the lower arm to the top mount; the spring passes between the upper arm's
# legs. Set by configure().
LOWER_EYE = TOP = DROP_TOP = Vector()
DAMPER_FRAME = Matrix.Identity(4)
FORK = 0.115  # half the fork legs' spacing: clear of the drive shaft's swing with lock and travel


def fork():
    """Damper fork: two legs from the lower cross-tube up past the drive shaft, joined by a clamp round the
    damper body. Local frame: lower eye at the origin, damper axis +y, legs either side in x."""
    bm = bmesh.new()
    for x in (-FORK, FORK):  # wide enough for the drive shaft's movement with steering and travel
        merge_into(bm, rod(Vector((x, 0.0, 0.0)), Vector((x, 0.19, 0.0)), 0.012, 24))
        merge_into(bm, rod(Vector((x, 0.19, 0.0)), Vector((x * 0.4, 0.215, 0.0)), 0.012, 24))
        merge_into(bm, transform(cylinder(0.02, 0.03, 32), Matrix.Translation((x, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Y")))
    merge_into(bm, transform(box(0.1, 0.022, 0.03), Matrix.Translation((0, 0.21, 0))))
    merge_into(bm, transform(lathe([(0.025, 0.19), (0.034, 0.19), (0.034, 0.225), (0.025, 0.225)], 40), Matrix.Rotation(-math.pi / 2, 4, "X")))
    return bm


def damper():
    """Monotube damper: a forged fork whose two legs straddle the drive shaft (C3a: the shaft passes through
    here), painted body clamped in the fork, threaded sleeve, notched spring perch, chrome rod and a
    polyurethane bump stop. Built along +y, then aimed at the top mount."""
    def along_y(prof, seg=40):  # lathe around y instead of z
        return transform(lathe(prof, seg), Matrix.Rotation(-math.pi / 2, 4, "X"))
    thread = [(0.0268, 0.2)] + [p for i in range(40) for p in ((0.029, 0.2 + i * 0.0025 + 0.00125), (0.0268, 0.2 + (i + 1) * 0.0025))] + [(0.0245, 0.3), (0.0245, 0.2)]
    bump = [(0.009, 0.4)] + [(0.017 + 0.005 * abs(math.sin(i * 0.8)), 0.4 + i * 0.006) for i in range(12)] + [(0.009, 0.472)]
    pieces = [
        new_object("body", along_y([(0.0005, 0.19), (0.025, 0.19), (0.025, 0.355), (0.0215, 0.362), (0.0005, 0.362)]), "damper-paint"),
        new_object("thread", along_y(thread), "steel-zinc"),
        new_object("perch", along_y([(0.0285, 0.275), (0.06, 0.275), (0.06, 0.283), (0.0285, 0.285)]), "aluminium-anodised"),
        new_object("lock", along_y([(0.0285, 0.288), (0.04, 0.288), (0.04, 0.298), (0.0285, 0.298)]), "aluminium-anodised"),
        new_object("rod", along_y([(0.0005, 0.36), (0.009, 0.36), (0.009, 0.66), (0.0005, 0.66)]), "steel-chrome"),
        new_object("bump", along_y(bump), "polyurethane"),
        new_object("eye", transform(cylinder(0.022, 2 * FORK + 0.03, 48), Matrix.Rotation(math.pi / 2, 4, "Y")), "damper-paint"),
        new_object("fork", fork(), "aluminium-forged"),
    ]
    notches = bmesh.new()
    for i in range(4):
        a = TAU * i / 4
        merge_into(notches, transform(box(0.012, 0.012, 0.008), Matrix.Translation((0.06 * math.cos(a), 0.293, 0.06 * math.sin(a))) @ Matrix.Rotation(-a, 4, "Y")))
    pieces[3] = kit.cut(pieces[3], new_object("notches", notches, "aluminium-anodised"))
    pieces = [kit.shade(kit.bevel(o, 0.0009, 2), 35) for o in pieces]
    pieces += bushing(Vector((0, 0, 0)))
    # bracket for the drop link's upper joint, from the nearer fork leg
    q = DAMPER_FRAME.inverted() @ DROP_TOP
    leg = Vector((math.copysign(FORK, q.x), q.y, 0))
    bracket = bmesh.new()
    merge_into(bracket, rod(leg, q, 0.011, 24))
    merge_into(bracket, transform(cylinder(0.016, 0.03, 32), Matrix.Translation(q) @ kit.align_z((q - leg).normalized())))
    pieces.append(kit.shade(new_object("drop-bracket", bracket, "aluminium-forged"), 40))
    obj = kit.join("damper", pieces)
    obj.data.transform(DAMPER_FRAME)
    kit.box_uv(obj, 6)
    return obj


def spring():
    obj = kit.helix(0.052, 0.0068, 0.283, 0.618, 6.4)  # slim enough to clear the upper arm's legs
    obj.data.materials.append(kit.material("spring-paint"))
    obj = kit.shade(obj, 70)
    obj.data.transform(DAMPER_FRAME)
    kit.box_uv(obj, 6)
    return obj


def top_mount():
    def along_y(prof, seg=64):
        return transform(lathe(prof, seg), Matrix.Rotation(-math.pi / 2, 4, "X"))
    pieces = [
        new_object("seat", along_y([(0.03, 0.618), (0.068, 0.618), (0.072, 0.626), (0.068, 0.628), (0.03, 0.624)]), "steel-dark"),
        new_object("rubber", along_y([(0.012, 0.626), (0.05, 0.628), (0.052, 0.648), (0.012, 0.65)]), "rubber"),
        new_object("plate", along_y([(0.012, 0.648), (0.08, 0.648), (0.08, 0.654), (0.012, 0.654)], 3), "steel-dark"),  # three-cornered plate
        new_object("nut", transform(cylinder(0.012, 0.012, 6), Matrix.Translation((0, 0.662, 0)) @ Matrix.Rotation(math.pi / 2, 4, "X")), "steel-zinc"),
    ]
    studs = bmesh.new()
    for i in range(3):
        a = math.pi / 3 + TAU * i / 3
        merge_into(studs, transform(cylinder(0.005, 0.03, 20), Matrix.Translation((0.05 * math.cos(a), 0.666, 0.05 * math.sin(a))) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    pieces.append(new_object("studs", studs, "steel-zinc"))
    pieces = [kit.shade(kit.bevel(o, 0.0012, 2), 40) for o in pieces]
    obj = kit.join("top", pieces)
    obj.data.transform(DAMPER_FRAME)
    kit.box_uv(obj, 6)
    return obj


def link(name: str, a: Vector, b: Vector, r: float, adjuster: bool = False, gaiter: bool = False):
    """A rod with ball joints: drop links and the track rod."""
    pieces = [new_object("rod", rod(a, b, r, 32), "steel-zinc")]
    d = (b - a).normalized()
    for p, down in ((a, True), (b, False)):
        pieces += ball_joint(p, down)
    if adjuster:
        m = b - d * 0.06
        pieces.append(new_object("nut", transform(cylinder(0.013, 0.012, 6), Matrix.Translation(m) @ kit.align_z(d)), "steel-zinc"))
        pieces.append(new_object("end", rod(b - d * 0.055, b, r * 1.6, 32), "aluminium-forged"))
    if gaiter:
        prof = [(r + 0.002, 0.0)] + [(0.019 + 0.009 * abs(math.sin(i * 0.9)), 0.004 + i * 0.008) for i in range(11)] + [(r + 0.002, 0.096)]
        pieces.append(new_object("gaiter", transform(lathe(prof, 48), Matrix.Translation(a) @ kit.align_z(d)), "rubber"))
    pieces = [kit.shade(o, 40) for o in pieces]
    obj = kit.join(name, pieces)
    kit.box_uv(obj, 6)
    return obj


def epb_actuator():
    """Electric parking-brake actuator on a rear calliper's inboard half (motor-on-calliper): a gear housing
    over the central piston, the motor alongside it, and the connector. It drives the piston's spindle to clamp
    the pads mechanically, independent of hydraulic pressure."""
    c = CALIPER_ANGLE
    u = Vector((math.cos(c), math.sin(c), 0))
    z_in = RING_Z - 0.066
    p = u * 0.176
    side = Vector((-u.y, u.x, 0))  # along the calliper, in the wheel plane
    gear = new_object("epb-gear", transform(cylinder(0.034, 0.03, 48), Matrix.Translation(p + Vector((0, 0, z_in - 0.017)))), "aluminium-cast")
    motor = new_object("epb-motor", transform(cylinder(0.019, 0.07, 40), Matrix.Translation(p + side * 0.045 + Vector((0, 0, z_in - 0.05)))), "steel-dark")
    cap = new_object("epb-cap", transform(cylinder(0.02, 0.006, 40), Matrix.Translation(p + side * 0.045 + Vector((0, 0, z_in - 0.087)))), "plastic-black")
    plug = new_object("epb-plug", transform(box(0.018, 0.02, 0.022), Matrix.Translation(p - side * 0.03 + Vector((0, 0, z_in - 0.024)))), "plastic-black")
    pieces = [kit.shade(kit.bevel(o, 0.0008, 2), 40) for o in (gear, motor, cap, plug)]
    obj = kit.join("epb", pieces)
    kit.box_uv(obj, 6)
    return at_axle(obj)


# ---- build --------------------------------------------------------------------------------------------
#
# Each axle's right-hand corner is built from its own hard points (web/src/vehicle/suspension.json):
#   front  high upper arm above the tyre with a goose-neck knuckle, leading calliper, steering arm behind the axle
#   rear   upper arm inside the wheel, trailing calliper with an electric parking brake, toe link ahead of the axle
# The left-hand corners are mirror images (the tyre is turned round instead, so its sidewall marking still reads
# correctly). The rear corners use the front's disc, calliper and arm sections (a simplification: docs/c3c/README.md).


def configure(axle: str):
    """Set the module's geometry for one axle's right-hand corner."""
    global AXLE, CALIPER_ANGLE, UPPER_JOINT, LOWER_JOINT, STEER_JOINT, LOWER_EYE, TOP, DROP_TOP, DAMPER_FRAME
    hp = {k: (Vector(v) if isinstance(v, list) and len(v) == 3 else v) for k, v in HARD_POINTS[axle].items()}
    AXLE = hp["wheel"]
    CALIPER_ANGLE = hp["caliperAngle"]
    UPPER_JOINT, LOWER_JOINT, STEER_JOINT = hp["upperBall"] - AXLE, hp["lowerBall"] - AXLE, hp["linkOuter"] - AXLE
    LOWER_EYE, TOP, DROP_TOP = hp["damperLower"], hp["damperTop"], hp["dropUpper"]
    DAMPER_FRAME = Matrix.Translation(LOWER_EYE) @ Vector((0, 1, 0)).rotation_difference((TOP - LOWER_EYE).normalized()).to_matrix().to_4x4()
    return hp


def corner_parts(rear: bool) -> dict:
    """The right-hand corner's parts of one axle, keyed by neutral visual key."""
    hp = configure("rear" if rear else "front")
    parts = {
        "tyre": tyre(),
        "wheel": wheel(),
        **{f"wheel-nut-{n}": nut for n, nut in enumerate(wheel_nuts(), start=1)},
        "brake-disc": brake_disc(),
        "caliper": caliper(),
        "brake-pad-inner": brake_pad("inner"),
        "brake-pad-outer": brake_pad("outer"),
        "brake-shield": brake_shield(),
        "brake-hose": brake_hose(),
        "hub-nut": hub_nut(),
        "hub": hub(),
        "wheel-bearing": bearing(),
        "knuckle": knuckle(),
        "wheel-speed-sensor": speed_sensor(),
        "lower-arm": wishbone("lower", hp["lowerBall"], hp["lowerFront"], hp["lowerRear"], brace=0.586),
        # upper arm: its legs pass either side of the spring
        "upper-arm": wishbone("upper", hp["upperBall"], hp["upperFront"], hp["upperRear"], bar=(0.032, 0.022), web_reach=0.2, stud_down=True),
        "coilover": damper(),
        "spring": spring(),
        "top-mount": top_mount(),
        # drop link: from the anti-roll bar's end to the bracket on the damper's fork
        "drop-link": link("drop", hp["dropLower"], hp["dropUpper"], 0.006),
    }
    if rear:
        parts["toe-link"] = link("toe", hp["linkInner"], hp["linkOuter"], 0.0085, adjuster=True)
        parts["epb-actuator"] = epb_actuator()
    else:
        parts["tie-rod"] = link("tie", hp["linkInner"], hp["linkOuter"], 0.0085, adjuster=True, gaiter=True)
    return parts


def corner_transform(corner: str, turn: bool) -> Matrix:
    """Maps the axle's right-hand geometry to `corner`. turn=True gives a rotation instead of a mirror (for the tyre)."""
    if corner[1] == "r":
        return Matrix.Identity(4)
    x = AXLE.x
    return Matrix.Translation((2 * x, 0, 0)) @ Matrix.Diagonal((-1, 1, -1, 1)) if turn else Matrix.Diagonal((1, 1, -1, 1))


def build(corner: str = "fr"):
    kit.reset()
    rear = corner[0] == "r"
    parts = corner_parts(rear)
    # Remove any helper objects left behind.
    keep = {o.name for o in parts.values()}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    nodes = {}
    for key, obj in parts.items():
        m = corner_transform(corner, turn=key == "tyre")
        if m != Matrix.Identity(4):
            if obj.location.length > 0:  # repeated parts (wheel nuts) share a mesh placed by location: give each its own
                if obj.data.users > 1:
                    obj.data = obj.data.copy()
                obj.data.transform(Matrix.Translation(obj.location))
                obj.location = (0, 0, 0)
            obj.data.transform(m)
            if m.determinant() < 0:  # a mirror turns the faces inside out
                obj.data.flip_normals()
            obj.data.update()
        pid = f"wheel-nut-{corner}-{key[-1]}" if key.startswith("wheel-nut-") else f"{key}-{corner}"
        kit.finish(obj, key)  # neutral visual key, e.g. "caliper", "wheel-nut-3"
        nodes[key] = pid
    asset = f"corner-{corner}"
    out = ROOT / "web" / "assets-src" / f"{asset}.glb"
    mp = ROOT / "web" / "public" / "assets" / f"{asset}.map.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    mp.write_text(json.dumps({"asset": asset, "nodes": nodes}, indent=2) + "\n")
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in parts.values())
    print(f"{asset}: exported {len(parts)} parts, {tris:,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    for key, obj in parts.items():
        print(f"  {nodes[key]:24s} {sum(len(p.vertices) - 2 for p in obj.data.polygons):>8,} tris  {[m.name for m in obj.data.materials]}")


if __name__ == "__main__":
    for c in sys.argv[1:] or ["fr", "fl", "rr", "rl"]:
        build(c)
