"""D1.3 exterior panels: the D1.3 shell (blender/exterior_d13.py) cut into its real panels, with the closures' inner
parts, the wheel-arch liners and the underbody, as the app's model `body-exterior`.

    uv run --project blender python -I blender/exterior_panels.py

How the panels follow the body surface:
- Every panel is cut out of the one shell. Each control face of the shell is tagged with its panel, and the
  subdivision passes the tag on, so the panels separate exactly along the shell's edge loops. The shell's side
  stations sit on the shut lines (exterior_d13.X_FIX).
- Each panel's edges are pulled back 2 mm (a 4 mm shut line), and painted panels get 2 mm of thickness inwards, so the
  seams read as real gaps.
- Inner parts are offset copies of their panel's surface:
  - bonnet and tailgate inner panels;
  - the door inner structure and trim;
  - the door seals along the door edge.
- The handles sit on the door skin.

D1.4 adds the details in blender/exterior_details.py (lamps, the lidar pod and antenna fin, mirrors with their cameras,
the intake's slats), lowers the body's bottom edge over the pack, ramps the underbody trays into the bumpers and carries
the arch liners further down the arches.

Panels keep their existing component ids (the same ids as the browser-built body in web/src/vehicle/body.ts).
Writes web/assets-src/body-exterior.glb, web/public/assets/body-exterior.map.json and
web/src/vehicle/exterior-stand-ins.json (bounding boxes for the app's fallback shapes).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy  # must come first
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).parent))
import exterior_d13 as d13  # noqa: E402
import exterior_details as details  # noqa: E402
import kit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
app = d13.app
F, R = d13.F, d13.R
GAP = 0.0015           # half a shut line
SKIN = 0.002           # sheet thickness of painted panels
OPENING = 0.473        # wheel-opening radius (as D1.1 / D1.3 renders)
CLIPPED_IN = ("grille", "rear-diffuser")  # trims clipped tight into their bumpers: no open shut line (D1.4)
SKINS: set[str] = set()  # the panel ids cut from the shell
MATERIALS = {"paint": "body-paint", "glass": "body-glass", "glass-roof": "roof-glass", "cladding": "satin-black",
             "gloss-black": "gloss-black"}

# ---- which panel each control face belongs to -------------------------------------------------------------------

def panel_of(lo: int, s: int, x: float, z: float) -> str:
    """lo: the face's lower design line (0 under, 1 under-edge, 2 rocker, 3 cladding-top, 4 lower-door, 5 body-side,
    6 upper-fascia, 7 shoulder, 8 beltline, 9 glass, 10 roof-edge, 11 roof-rail, 12 roof). s: its station
    (tail face < 5 <= tail corner < 9 <= side < 37 <= front corner < 41 <= front face). '*' becomes l or r."""
    if lo == 0:
        return "drop"  # the shell's closed bottom: the underbody is its own part
    if s < 9:  # tail
        face = s < 5
        if lo <= 2:
            return "rear-diffuser" if face else "rear-bumper"
        if lo <= 4:
            return "rear-bumper"
        if lo <= 8:
            return "tailgate" if face else "quarter-*"
        if lo == 9:
            return "tailgate-glass"
        return "tailgate"  # the spoiler
    if s >= 37:  # front
        if lo <= 6:
            return "grille" if (s >= 42 and lo == 3) else "front-bumper"
        return "bonnet"
    if x > 0.95:
        return "fender-*" if lo <= 7 else "bonnet"
    if lo >= 11:
        return "windscreen" if x > 0.08 else "roof"
    if lo == 10 or (lo == 9 and 0.60 < x < 0.95):
        return "body-side-*"  # the roof side rail and the black A pillar, over the structure's A pillar
    if x > -0.10:
        return {1: "rocker-*", 2: "rocker-*", 9: "glass-f*"}.get(lo, "door-f*")
    if x > -0.95:
        return {1: "rocker-*", 2: "rocker-*", 9: "glass-r*"}.get(lo, "door-r*")
    if lo == 9:
        return "quarter-glass-*" if x > -1.70 else "body-side-*"
    return "quarter-*"


# ---- geometry helpers ----------------------------------------------------------------------------------------------

def split(body: bpy.types.Object) -> dict[str, bmesh.types.BMesh]:
    """The shell's faces grouped by panel id (left/right from which side of the centre line they are on)."""
    names = {int(k): v for k, v in body["panel_names"].items()}
    attr = body.data.attributes["panel"].data
    by_panel: dict[str, list[int]] = {}
    for p in body.data.polygons:
        base = names[attr[p.index].value]
        if base == "drop":
            continue
        side = "r" if p.center.y < 0 else "l"  # Blender's -y is the app's +z (right)
        by_panel.setdefault(base.replace("*", side), []).append(p.index)
    out = {}
    for pid, faces in by_panel.items():
        bm = bmesh.new()
        bm.from_mesh(body.data)
        keep = set(faces)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        out[pid] = bm
    return out


def pull_edges(bm: bmesh.types.BMesh, by: float) -> None:
    """Move the panel's boundary back along its own surface, opening the shut lines."""
    moves = {}
    for v in bm.verts:
        if not v.is_boundary:
            continue
        inward = Vector()
        for f in v.link_faces:
            inward += f.calc_center_median() - v.co
        n = v.normal
        inward -= inward.dot(n) * n
        if inward.length > 1e-9:
            moves[v] = inward.normalized() * by
    for v, d in moves.items():
        v.co += d


def offset(bm: bmesh.types.BMesh, by: float) -> bmesh.types.BMesh:
    """A copy moved along its normals (negative = inwards)."""
    out = bm.copy()
    out.normal_update()
    for v in out.verts:
        v.co += v.normal * by
    return out


def to_object(name: str, bm: bmesh.types.BMesh, materials: list[str], thickness: float = 0.0, inside: str | None = None) -> bpy.types.Object:
    """A panel object. With thickness: the sheet's edges (seen in the shut lines) are satin black, and its inside face
    is `inside` (e-coat grey for painted panels) or, if None, the same as the outside (glass, trim)."""
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    n = len(materials)
    slots = list(materials)
    if thickness:
        slots += ["shut-black"] * n + ([inside] * n if inside else [])
    for m in slots:
        o.data.materials.append(kit.material(m))
    for p in o.data.polygons:
        p.use_smooth = True
    if thickness:
        sol = o.modifiers.new("thickness", "SOLIDIFY")
        sol.thickness, sol.offset, sol.use_rim, sol.use_even_offset = thickness, -1.0, True, False
        sol.material_offset_rim = n
        sol.material_offset = 2 * n if inside else 0
        o = kit.to_mesh(o)
        for p in o.data.polygons:  # flat rims: smooth ones bend the panel's edge shading into a bright line (D1.4)
            if n <= p.material_index < 2 * n:
                p.use_smooth = False
    kit.box_uv(o, 3.0)
    return o


def recolour(bm: bmesh.types.BMesh, index: int) -> bmesh.types.BMesh:
    for f in bm.faces:
        f.material_index = index
    return bm


def single(name: str, bm: bmesh.types.BMesh, material: str, thickness: float = 0.0, smooth: bool = True,
           keep: float = 1.0) -> bpy.types.Object:
    o = to_object(name, recolour(bm, 0), [material], thickness)
    if keep < 1.0:  # hidden inner parts: fewer triangles
        d = o.modifiers.new("lighter", "DECIMATE")
        d.ratio = keep
        o = kit.to_mesh(o)
    if not smooth:
        o = kit.shade(o, 35.0)
    return o


# ---- the wheel openings, lips and liners -------------------------------------------------------------------------

def cut_openings(body: bpy.types.Object) -> None:
    for x in (F, R):
        for side in (1, -1):
            # from z 0.66 outwards
            bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=OPENING, depth=0.74, location=app(x, d13.d11.AXLE_Y, side * 1.03),
                                                rotation=(math.pi / 2, 0, 0))
            cutter = bpy.context.object
            boolean = body.modifiers.new("arch", "BOOLEAN")
            boolean.operation, boolean.object, boolean.solver = "DIFFERENCE", cutter, "EXACT"
            boolean.use_self = True  # the shell touches itself where the bottom meets the sides; without this the cut can fail silently
            d13.trial.apply_modifiers(body)
            bpy.data.objects.remove(cutter)


def lip(body: bpy.types.Object, x: float, side: int) -> bmesh.types.BMesh:
    """The satin-black arch lip, laid on the body round the opening by casting rays at it (as the D1.1 renders)."""
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    inward = app(0, 0, -side) - app(0, 0, 0)
    rows = []
    for i in range(145):
        a = math.radians(-14 + 208 * i / 144)
        ring = []
        for r in (OPENING + 0.055, OPENING + 0.004):
            hit, normal, _, _ = bvh.ray_cast(app(x + r * math.cos(a), d13.d11.AXLE_Y + r * math.sin(a), side * 1.6), inward, 1.2)
            ring.append(None if hit is None else (hit, normal))
        if None in ring:
            rows.append(None)
            continue
        (outer, n_out), (edge, n_edge) = ring
        step = (app(x + (OPENING - 0.004) * math.cos(a), 0.405 + (OPENING - 0.004) * math.sin(a), 0)
                - app(x + (OPENING + 0.004) * math.cos(a), 0.405 + (OPENING + 0.004) * math.sin(a), 0))
        edge_in = edge + step
        rows.append([outer + n_out * 0.003, edge + n_edge * 0.006, edge_in + n_edge * 0.006, edge_in + inward * 0.06])
    bm = bmesh.new()
    verts = [None if row is None else [bm.verts.new(p) for p in row] for row in rows]
    for va, vb in zip(verts, verts[1:]):
        if va is None or vb is None:
            continue
        for k in range(3):
            quad = (va[k], vb[k], vb[k + 1], va[k + 1])
            bm.faces.new(quad if side > 0 else quad[::-1])
    return bm


def sector_z(cx: float, cy: float, r0: float, r1: float, a0: float, a1: float, z0: float, z1: float) -> bmesh.types.BMesh:
    """A curved band round the axle (x, y plane, angles in degrees from +x), between z0 and z1 (app coordinates)."""
    bm = kit.sector(r0, r1, math.radians(a0), math.radians(a1), z0, z1, 48)
    kit.transform(bm, Matrix.Translation((cx, cy, 0)))
    return to_app(bm)


def to_app(bm: bmesh.types.BMesh) -> bmesh.types.BMesh:
    """Geometry written in app coordinates (x, y, z) into Blender's (x, -z, y), as app() does."""
    for v in bm.verts:
        x, y, z = v.co
        v.co = app(x, y, z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def mirror_z(bm: bmesh.types.BMesh, side: int) -> bmesh.types.BMesh:
    if side < 0:
        for v in bm.verts:
            v.co.z = -v.co.z
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def liner(front: bool, side: int) -> bmesh.types.BMesh:
    """Wheel-arch liner sized from the swept envelopes (docs/c3c/body-interfaces.md section 2) plus about 20 mm (R5).
    Front: a crown over the tyre's sweep (y 0.93 at the top) out to the skin, stepping up to y 1.0 inboard, where the
    goose-neck knuckle rises to 0.98 at full bump. Rear: a crown inside the structure's wheelhouse, over the tyre at
    full bump (0.89)."""
    if front:
        pieces = [profile_z(FRONT_ENVELOPE, 0.025, 0.66, 0.93),
                  sector_z(F, 0.405, 0.600, 0.604, 45, 135, 0.50, 0.663),
                  sector_z(F, 0.405, 0.525, 0.604, 45, 135, 0.66, 0.663),
                  # D1.4: the liner continues down the arch's rear and front ends, 15 and 25 mm clear of the steered
                  # tyre's sweep, closing the view into the bay behind and ahead of the wheel
                  box_app((1.071, 0.24, 0.66), (1.075, 0.648, 0.93)),
                  box_app((2.145, 0.24, 0.66), (2.149, 0.478, 0.84))]
    else:
        # behind the C pillar's gusset; D1.4: carried down both ends of the arch towards the sill and the bumper
        pieces = [sector_z(R, 0.405, 0.510, 0.514, 28, 172, 0.65, 0.95)]  # forward of 28 degrees: the sill, C pillar, harness
    bm = bmesh.new()
    for p in pieces:
        kit.merge_into(bm, p)
    # the pieces were built for the right side (+z); mirror for the left
    return mirror_blender(bm, side)


# The front tyre's swept envelope, top y by slice of x (docs/c3c/body-interfaces.md section 2): steered, the tyre
# reaches much further back and higher than a circle round the axle allows.
FRONT_ENVELOPE = [(1.09, 0.62), (1.1, 0.70), (1.2, 0.82), (1.3, 0.87), (1.4, 0.88), (1.5, 0.90), (1.6, 0.90), (1.7, 0.90),
                  (1.8, 0.89), (1.9, 0.85), (2.0, 0.77), (2.1, 0.56), (2.12, 0.45)]


def profile_z(envelope: list[tuple[float, float]], clearance: float, z0: float, z1: float) -> bmesh.types.BMesh:
    """A liner sheet following the envelope's top (plus clearance) along x, between z0 and z1 (app coordinates)."""
    f = d13.pchip(envelope)
    xs = [envelope[0][0] + (envelope[-1][0] - envelope[0][0]) * i / 60 for i in range(61)]
    bm = bmesh.new()
    rows = [[bm.verts.new((x, f(x) + clearance + t, z)) for z in (z0, z1) for t in (0.0,)] for x in xs]
    tops = [[bm.verts.new((x, f(x) + clearance + 0.004, z)) for z in (z0, z1)] for x in xs]
    for (a, b), (c, d), (ta, tb), (tc, td) in zip(rows, rows[1:], tops, tops[1:]):
        bm.faces.new((a, c, d, b))
        bm.faces.new((ta, tb, td, tc))
    return to_app(bm)


def mirror_blender(bm: bmesh.types.BMesh, side: int) -> bmesh.types.BMesh:
    """Mirror geometry already in Blender coordinates across the centre plane (Blender y = -app z)."""
    if side < 0:
        for v in bm.verts:
            v.co.y = -v.co.y
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def box_app(lo, hi) -> bmesh.types.BMesh:
    lo, hi = Vector(lo), Vector(hi)
    return to_app(kit.transform(kit.box(*(hi - lo)), Matrix.Translation((lo + hi) / 2)))


def tray(profile: list[tuple[float, float, float]], t: float = 0.004) -> bmesh.types.BMesh:
    """A closed plate along x through (x, y underside, half-width) stations, t thick (app coordinates)."""
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y + dy, s * w)) for dy, s in ((0, -1), (0, 1), (t, 1), (t, -1))] for x, y, w in profile]
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            bm.faces.new((a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return to_app(bm)


def strake(z: float, x0: float, x1: float, ramp, depth: float = 0.022, t: float = 0.005) -> bmesh.types.BMesh:
    """A thin fin hanging under the rear ramp at z, from x0 to x1: the diffuser's strakes."""
    bm = bmesh.new()
    xs = [x0 + (x1 - x0) * i / 8 for i in range(9)]
    rings = [[bm.verts.new((x, y, z + dz)) for y, dz in ((ramp(x) - depth * (1 - 0.5 * i / 8), -t / 2), (ramp(x) - depth * (1 - 0.5 * i / 8), t / 2),
                                                             (ramp(x) + 0.002, t / 2), (ramp(x) + 0.002, -t / 2))]
             for i, x in enumerate(xs)]
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            bm.faces.new((a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return to_app(bm)


def underbody() -> bmesh.types.BMesh:
    """Aero trays under the front and rear subframes, and the channel covering the rear drive unit's coolant pair
    under the pack (R9): a U section, y 0.138-0.185, z 0 to 0.10, x -0.95 to 1.15. Ground clearance: 0.14 m at the
    front tray (under the coolant lines' run forward) and the channel, 0.16 m at the rear tray.
    D1.4: ahead of the front wheels the front tray rises and widens into the front bumper's lower edge (about 0.18 m),
    and behind the rear subframe the rear tray rises into the rear bumper as a shallow diffuser with three low
    strakes, so neither tray stands out below the bumpers in side view."""
    rear_ramp = d13.pchip([(-2.27, 0.205), (-2.10, 0.185), (-1.92, 0.164), (-1.85, 0.162)])
    pieces = [tray([(1.25, 0.140, 0.38), (1.98, 0.140, 0.38), (2.10, 0.152, 0.44), (2.20, 0.172, 0.50), (2.245, 0.183, 0.52)]),
              tray([(-2.27, 0.205, 0.56), (-2.18, 0.194, 0.52), (-2.10, 0.185, 0.46), (-2.0, 0.174, 0.40), (-1.92, 0.164, 0.38),
                    (-1.85, 0.162, 0.38), (-1.15, 0.162, 0.38)]),
              *[strake(z, -2.265, -1.95, rear_ramp) for z in (-0.24, 0.0, 0.24)],
              box_app((-0.95, 0.138, -0.005), (1.15, 0.142, 0.105)),
              box_app((-0.95, 0.138, -0.009), (1.15, 0.184, -0.005)),
              box_app((-0.95, 0.138, 0.105), (1.15, 0.184, 0.109))]
    bm = bmesh.new()
    for p in pieces:
        kit.merge_into(bm, p)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---- doors: inner structure, trim, seal, handle, latch, speaker, regulator ----------------------------------------

def door_parts(key: str, skin: bmesh.types.BMesh, bvh: BVHTree) -> dict[str, bpy.types.Object]:
    """The door's inner layers, built from its own outer skin (before the shut lines were opened)."""
    side = 1 if key[1] == "r" else -1
    xs = [v.co.x for v in skin.verts]
    x0, x1 = min(xs), max(xs)  # app x is Blender x
    parts = {}
    # inner structure: the skin below the window sill moved 35 mm inwards, 3 mm thick (above the sill it would meet the
    # B pillar, which the door closes against)
    lower = skin.copy()
    bmesh.ops.delete(lower, geom=[f for f in lower.faces if f.calc_center_median().z > 1.04], context="FACES")
    bmesh.ops.delete(lower, geom=[v for v in lower.verts if not v.link_faces], context="VERTS")
    parts[f"door-structure-{key}"] = single(f"door-structure-{key}", offset(lower, -0.035), "body-ecoat", 0.003, keep=0.4)
    lower.free()
    # trim: the upper part of the door, inset from its ends, 85 mm inwards
    trim = skin.copy()
    bmesh.ops.delete(trim, geom=[f for f in trim.faces if not (x0 + 0.08 < f.calc_center_median().x < x1 - 0.08
                                                              and f.calc_center_median().z > 0.56)], context="FACES")
    bmesh.ops.delete(trim, geom=[v for v in trim.verts if not v.link_faces], context="VERTS")
    parts[f"door-trim-{key}"] = single(f"door-trim-{key}", offset(trim, -0.085), "plastic-black", 0.006)
    trim.free()

    def on_skin(x: float, y: float, depth: float) -> tuple[Vector, Vector]:
        hit, n, _, _ = bvh.ray_cast(app(x, y, side * 1.6), app(0, 0, -side) - app(0, 0, 0), 1.2)
        return hit - n * depth, n

    # seal: a tube along the door's front, bottom and rear edges (below the window sill), 30 mm inside the skin
    loop = boundary_loop(skin)
    centre = sum((v for v in loop), Vector()) / len(loop)
    low = [p.z < 1.04 for p in loop]
    start = next(i for i in range(len(loop)) if low[i] and not low[i - 1])  # the longest run below the sill, in order
    run = []
    for k in range(len(loop)):
        i = (start + k) % len(loop)
        if not low[i]:
            break
        run.append(loop[i])
    pts = []
    for p in run[::3]:
        hit, n, _, _ = bvh.find_nearest(p)
        pts.append(p - n * 0.03 + (centre - p).normalized() * 0.015)
    seal = kit.tube_path(pts, 0.008, 3)
    seal.data.materials.append(kit.material("rubber"))
    parts[f"door-seal-{key}"] = seal
    # handle: flush, on the skin near the rear edge, just under the shoulder
    p, n = on_skin(x1 - 0.20, 0.93, 0.001)
    handle = kit.transform(kit.box(0.16, 0.024, 0.014), Matrix.Translation(p) @ kit.align_z(n))
    parts[f"door-handle-{key}"] = single(f"door-handle-{key}", handle, "gloss-black", smooth=False)
    # latch: at the rear edge, between the skin and the trim
    p, n = on_skin(x1 - 0.035, 0.86, 0.055)
    parts[f"door-latch-{key}"] = single(f"door-latch-{key}", kit.transform(kit.box(0.04, 0.04, 0.08), Matrix.Translation(p)),
                                        "steel-dark", smooth=False)
    # speaker: low at the front of the door, between the inner structure and the trim
    p, n = on_skin(x0 + 0.24, 0.62, 0.06)
    spk = kit.transform(kit.cylinder(0.075, 0.045, 32), Matrix.Translation(p) @ kit.align_z(n))
    parts[f"door-speaker-{key}"] = single(f"door-speaker-{key}", spk, "plastic-black", smooth=False)
    # window regulator: two crossed arms in the door's middle, behind the structure
    mid = (x0 + x1) / 2
    a, _ = on_skin(mid - 0.20, 0.62, 0.055)
    b, _ = on_skin(mid + 0.20, 0.98, 0.055)
    c, _ = on_skin(mid - 0.20, 0.98, 0.055)
    d, _ = on_skin(mid + 0.20, 0.62, 0.055)
    reg = bmesh.new()
    kit.merge_into(reg, kit.rod(a, b, 0.006, 12))
    kit.merge_into(reg, kit.rod(c, d, 0.006, 12))
    parts[f"window-regulator-{key}"] = single(f"window-regulator-{key}", reg, "steel-zinc", smooth=False)
    return parts


def boundary_loop(bm: bmesh.types.BMesh) -> list[Vector]:
    """The longest closed boundary of a panel, in order."""
    edges = [e for e in bm.edges if e.is_boundary]
    nxt = {}
    for e in edges:
        a, b = e.verts
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)
    best, seen = [], set()
    for start in nxt:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            options = [v for v in nxt[cur] if v is not prev and v not in seen]
            if not options:
                break
            prev, cur = cur, options[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) > len(best):
            best = loop
    return [v.co.copy() for v in best]


# ---- build ----------------------------------------------------------------------------------------------------------

def build():
    kit.reset()
    d13.trial.materials()
    body = d13.build_shell(panel_of, levels=2)  # the app's copy: one level fewer than the review renders
    d13.trial.apply_modifiers(body)
    cut_openings(body)
    left = sum(1 for p in body.data.polygons if abs(p.center.y) > 0.72 and min(math.hypot(p.center.x - ax, p.center.z - 0.405)
                                                                              for ax in (F, R)) < 0.45)
    assert left == 0, f"{left} faces left inside the wheel openings: the cut failed"
    names = {i: kit.material(MATERIALS.get(m.name if m else "paint", "body-paint")).name for i, m in enumerate(body.data.materials)}
    skins = split(body)
    SKINS.update(skins)
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    parts: dict[str, bpy.types.Object] = {}

    # inner panels and door layers from the uncut skins
    for key in ("fl", "fr", "rl", "rr"):
        parts.update(door_parts(key, skins[f"door-{key}"], bvh))
    # bonnet and tailgate inner panels: from the panel's main face only (the bonnet's top, the tailgate's rear face),
    # so the offset copy cannot cross the tight edges at the nose and the ledge
    for pid, inner, facing in (("bonnet", "bonnet-inner", Vector((0, 0, 1))), ("tailgate", "tailgate-inner", Vector((-1, 0, 0)))):
        face = skins[pid].copy()
        face.normal_update()
        xs = [v.co.x for v in face.verts]
        lo, hi = min(xs) + 0.06, max(xs) - 0.16  # inner panels stop short of the outer panel's edges
        if pid == "bonnet":
            hi = 1.62  # ahead of this the bonnet runs only 15-20 mm over the towers and the front-end carrier
        half = min(max(abs(v.co.y) for v in face.verts) - 0.07, 0.78 if pid == "tailgate" else 0.50)  # bonnet: inboard of the arms
        bmesh.ops.delete(face, geom=[f for f in face.faces if f.normal.dot(facing) < 0.8
                                     or not lo < f.calc_center_median().x < hi or abs(f.calc_center_median().y) > half],
                         context="FACES")
        bmesh.ops.delete(face, geom=[v for v in face.verts if not v.link_faces], context="VERTS")
        parts[inner] = single(inner, offset(face, -0.03), "body-paint", 0.003, keep=0.4)

    # the panels, with their shut lines opened and their thickness
    for pid, bm in skins.items():
        pull_edges(bm, 0.0002 if pid in CLIPPED_IN else GAP)
        glazing = pid in ("windscreen", "tailgate-glass") or pid.startswith(("glass-", "quarter-glass-"))
        mats = [names[i] for i in range(len(body.data.materials))]
        # insides near black (D1.4): seen only through the shut lines and the intake's edges, where paint read as light lines
        parts[pid] = to_object(pid, bm, mats, 0.004 if glazing else SKIN, inside=None if glazing else "shut-black")

    # arch lips: part of the wings (front) and quarter panels (rear)
    for x, owner in ((F, "fender"), (R, "quarter")):
        for side, k in ((1, "r"), (-1, "l")):
            o = single(f"lip-{owner}-{k}", lip(body, x, side), "satin-black")
            parts[f"{owner}-{k}"] = kit.join(f"{owner}-{k}", [parts[f"{owner}-{k}"], o])
    for front, a in ((True, "f"), (False, "r")):
        for side, k in ((1, "r"), (-1, "l")):
            parts[f"arch-liner-{a}{k}"] = single(f"arch-liner-{a}{k}", liner(front, side), "plastic-black")
    parts["underbody"] = single("underbody", underbody(), "plastic-black", smooth=False)
    parts.update(details.build(body))  # lamps, roof sensor housings, mirrors and side cameras (D1.4)
    parts["grille"] = kit.join("grille", [parts["grille"], details.grille_slats(body)])
    parts["rear-bumper"] = kit.join("rear-bumper", [parts["rear-bumper"], details.rear_bumper_trim(body)])  # D1.5

    inside_check(body, parts)
    keep = set(parts.values())
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    nodes, stand_ins = {}, {}
    for pid, o in sorted(parts.items()):
        kit.finish(o, pid)
        nodes[o.name] = pid
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        # app coordinates: Blender (x, y, z) is the app's (x, -z, y)
        stand_ins[pid] = {"centre": [round((lo[0] + hi[0]) / 2, 3), round((lo[2] + hi[2]) / 2, 3), round(-(lo[1] + hi[1]) / 2, 3)],
                          "size": [round(hi[0] - lo[0], 3), round(hi[2] - lo[2], 3), round(hi[1] - lo[1], 3)]}
    out = ROOT / "web" / "assets-src" / "body-exterior.glb"
    export_yup(str(out))
    (ROOT / "web" / "public" / "assets" / "body-exterior.map.json").write_text(
        json.dumps({"asset": "body-exterior", "nodes": dict(sorted(nodes.items()))}, indent=2) + "\n")
    (ROOT / "web" / "src" / "vehicle" / "exterior-stand-ins.json").write_text(
        "{\n" + ",\n".join(f' "{k}": {json.dumps(v)}' for k, v in stand_ins.items()) + "\n}\n")
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in parts.values())
    print(f"body-exterior: {len(parts)} parts, {tris:,} triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


OUTSIDE_BY_DESIGN = ("headlamp", "tail-lamp", "door-handle", "underbody", "arch-liner", "mirror", "side-camera", "lidar", "gnss-antenna")


def inside_check(body: bpy.types.Object, parts: dict[str, bpy.types.Object]) -> None:
    """Inner parts must stay under the skin: report any that reach more than 1 mm outside it."""
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    bad = []
    for pid, o in parts.items():
        if pid in SKINS or pid.startswith(OUTSIDE_BY_DESIGN) or pid.startswith(("fender", "quarter")):
            continue
        far, where = 0.0, None
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            hit, n, _, d = bvh.find_nearest(p)
            if hit is not None and (p - hit).dot(n) > 0 and d > far:
                far, where = d, (round(p.x, 3), round(p.z, 3), round(-p.y, 3))
        if far > 0.001:
            bad.append(f"{pid} {far * 1000:.0f} mm at {where}")
    print("inner parts outside the skin:", ", ".join(bad) or "none")


def export_yup(path: str) -> None:
    """The shell is built in Blender's z-up frame (like the renders), so this export converts to glTF's y-up, which
    is the app's frame; the other models are built directly in app coordinates and export without conversion."""
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", export_image_format="NONE")


if __name__ == "__main__":
    build()
