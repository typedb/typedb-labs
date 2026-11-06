"""D1.3 exterior: the body shell redesigned from design lines, over the D1.2 body structure.

    uv run --project blender python -I blender/exterior_d13.py [front34 side rear34 front rear ...]

How it differs from D1.1 (blender/exterior.py, kept for comparison):
- The surface is controlled by DESIGN LINES rather than a loose cage. Each line (rocker, bumper, body side, the
  shoulder crease, the beltline, the window line, the roof) has its own side-view height curve and plan-view
  half-width curve. These are interpolated without overshoot (monotone cubic), so the control net, and the
  subdivision surface over it, stays taut.
- Each line wraps the front and the rear with its own face position, corner radius and bow. That shapes the fascia
  and tailgate deliberately:
  - front: the bonnet edge overhangs a set-back upper fascia, the bumper stands forward, the lip tucks under;
  - rear: the shoulder crease wraps the tail as a ledge, and the tailgate tucks in below it.
- The wheel arches are flared: the lower body swells round each opening (front wings, rear haunches) and tucks in
  between.
- Shared with D1.1: materials, studio, cameras, the wheel openings and lips, and the real wheel corners. The views
  are identical, so the two can be compared directly.

Coordinates are the app's (metres; x forward, y up, z right). Renders: web/shots/d13-<view>.png.
The structure must stay inside this shell: blender/structure_review.py checks it.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import bpy  # must come first
import bmesh

sys.path.insert(0, str(Path(__file__).parent))
import exterior as d11  # noqa: E402  openings, wheels, cameras, render (D1.1)

trial = d11.trial
app = trial.app
F, R = d11.F, d11.R


def pchip(points: list[tuple[float, float]]):
    """Monotone cubic interpolation (Fritsch-Carlson) through (x, value) points: no overshoot, so no ripples."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    n = len(xs)
    if n == 1:
        return lambda x: ys[0]
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [d[0]] + [0.0] * (n - 2) + [d[-1]]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x: float) -> float:
        if x <= xs[0]:
            return ys[0] + m[0] * (x - xs[0])
        if x >= xs[-1]:
            return ys[-1] + m[-1] * (x - xs[-1])
        i = max(k for k in range(n - 1) if xs[k] <= x)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f


@dataclass
class Line:
    """One design line, right half. y: side-view height along x; z: plan-view half-width along x.
    front / rear: (face x at the centre line, plan corner radius, bow of the face, height at the centre or None)."""
    name: str
    y: list[tuple[float, float]]
    z: list[tuple[float, float]]
    front: tuple
    rear: tuple
    flare: bool = False
    follow: bool = False  # round the front corner, keep following the side-view curve (the bonnet's lines)


W_MID = 0.962  # body side half-width between the arches
# front / rear: (x at the centre line, plan corner radius, how far the face's flat centre stands ahead of its corners,
# height at the centre or None). The faces are flat across the crash beam and cooling module (|z| < 0.40) and wrap
# back hard at the corners.
LINES = [
    Line("under-centre", [(-2.4, 0.24), (2.4, 0.24)], [(0, 0.0)], (2.24, 0.30, 0.03, None), (-2.28, 0.30, 0.03, None)),
    # under the sills and the pack's side rails: the satin-black cladding comes down over the pack's sides, to about
    # 0.18 m (D1.4: below the pack's protection plate, so its edge does not show under the sills)
    Line("under-edge", [(-2.4, 0.13), (2.4, 0.13)], [(-2.4, 0.86), (2.4, 0.86)], (2.27, 0.30, 0.03, None), (-2.29, 0.30, 0.03, None)),
    Line("rocker", [(-1.95, 0.39), (-1.75, 0.33), (-1.0, 0.305), (1.0, 0.305), (1.75, 0.32), (1.9, 0.35)],
         [(-1.95, 0.88), (-1.75, 0.93), (1.75, 0.93), (1.9, 0.90)], (2.315, 0.30, 0.04, None, 0.56), (-2.35, 0.30, 0.03, None, 0.58), True),
    Line("cladding-top", [(-1.95, 0.55), (-1.75, 0.48), (-1.0, 0.455), (1.0, 0.455), (1.75, 0.47), (1.9, 0.49)],
         [(-1.95, 0.90), (-1.75, 0.95), (1.75, 0.95), (1.9, 0.925)], (2.352, 0.30, 0.04, None, 0.56), (-2.395, 0.30, 0.04, None, 0.58), True),
    Line("lower-door", [(-1.95, 0.66), (-1.75, 0.63), (-1.0, 0.60), (1.0, 0.60), (1.75, 0.62), (1.9, 0.63)],
         [(-1.95, 0.90), (-1.75, 0.935), (-0.6, 0.92), (0.6, 0.92), (1.75, 0.935), (1.9, 0.915)], (2.350, 0.30, 0.04, None, 0.56),
         (-2.405, 0.30, 0.04, None, 0.58), True),
    Line("body-side", [(-1.95, 0.82), (-1.75, 0.80), (-1.0, 0.78), (1.0, 0.78), (1.75, 0.785), (1.9, 0.78)],
         [(-1.95, 0.915), (-1.75, 0.962), (-1.0, W_MID), (1.0, W_MID), (1.75, 0.962), (1.9, 0.935)], (2.342, 0.42, 0.06, 0.76),
         (-2.38, 0.42, 0.06, None, 0.40), True),
    Line("upper-fascia", [(-1.95, 0.925), (-1.75, 0.905), (-1.0, 0.895), (1.0, 0.89), (1.6, 0.88), (1.85, 0.845)],
         [(-1.95, 0.92), (-1.75, 0.968), (-1.0, 0.966), (1.0, 0.966), (1.75, 0.968), (1.85, 0.945)], (2.305, 0.40, 0.05, 0.83),
         (-2.355, 0.40, 0.07, None, 0.35), True),
    Line("shoulder", [(-1.98, 1.02), (-1.75, 1.005), (-1.0, 0.975), (0.0, 0.965), (1.0, 0.955), (1.55, 0.93), (1.89, 0.888), (2.10, 0.87), (2.33, 0.855)],
         [(-1.98, 0.92), (-1.75, 0.97), (-1.0, 0.968), (1.0, 0.966), (1.75, 0.968), (1.9, 0.945)], (2.33, 0.38, 0.06, None),
         (-2.41, 0.38, 0.05, None), True, True),
    Line("beltline", [(-2.01, 1.07), (-1.62, 1.16), (-1.15, 1.135), (-0.1, 1.08), (0.92, 1.03), (1.58, 0.985), (1.85, 0.95), (2.10, 0.90), (2.30, 0.862)],
         [(-2.01, 0.86), (-1.6, 0.90), (-1.0, 0.905), (0.9, 0.895), (1.58, 0.895), (1.92, 0.85)], (2.300, 0.34, 0.05, None),
         (-2.35, 0.34, 0.05, None), follow=True),
    Line("glass", [(-2.07, 1.12), (-1.96, 1.13), (-1.80, 1.29), (-1.20, 1.215), (-0.1, 1.13), (0.3, 1.115), (0.90, 1.06), (1.58, 1.0), (1.85, 0.96), (2.10, 0.905), (2.30, 0.865)],
         [(-2.07, 0.75), (-1.96, 0.76), (-1.8, 0.77), (-1.2, 0.83), (-0.1, 0.84), (0.3, 0.83), (0.9, 0.80), (1.58, 0.77), (1.94, 0.71)],
         (2.275, 0.30, 0.04, None), (-2.30, 0.20, 0.04, None), follow=True),
    Line("roof-edge", [(-1.82, 1.43), (-1.25, 1.52), (-0.35, 1.555), (0.08, 1.52), (0.80, 1.135), (1.0, 1.06), (1.58, 1.02), (1.85, 0.975), (2.10, 0.912), (2.30, 0.868)],
         [(-1.82, 0.66), (-1.25, 0.70), (-0.35, 0.705), (0.08, 0.69), (0.92, 0.70), (1.58, 0.66), (1.97, 0.58)],
         (2.255, 0.26, 0.03, None), (-2.06, 0.22, 0.02, 1.40), follow=True),
    Line("roof-rail", [(-1.83, 1.465), (-1.25, 1.555), (-0.35, 1.585), (0.10, 1.545), (0.81, 1.14), (1.01, 1.065), (1.58, 1.03), (1.85, 0.983), (2.10, 0.916), (2.30, 0.87)],
         [(-1.83, 0.60), (-1.25, 0.64), (-0.35, 0.645), (0.10, 0.63), (0.93, 0.60), (1.58, 0.56), (1.99, 0.47)],
         (2.245, 0.24, 0.02, None), (-2.05, 0.20, 0.02, 1.41), follow=True),
    Line("roof", [(-1.875, 1.475), (-1.25, 1.57), (-0.35, 1.60), (0.12, 1.56), (0.82, 1.145), (1.02, 1.07), (1.58, 1.035), (1.85, 0.988), (2.10, 0.918), (2.30, 0.872)],
         [(-1.875, 0.36), (-1.25, 0.40), (-0.35, 0.40), (0.12, 0.39), (0.94, 0.36), (1.58, 0.34), (2.075, 0.28)],
         (2.24, 0.15, 0.015, None), (-2.04, 0.15, 0.015, 1.415), follow=True),
    Line("roof-centre", [(-2.03, 1.418), (-1.89, 1.48), (-1.25, 1.575), (-0.35, 1.605), (0.13, 1.565), (0.83, 1.15), (1.03, 1.075),
                         (1.58, 1.04), (1.85, 0.99), (2.10, 0.92), (2.235, 0.882)],
         [(0, 0.0)], (2.235, 0.16, 0, None), (-2.03, 0.155, 0, None)),  # spread like the roof line beside it
]
NAMES = [l.name for l in LINES]
N_FACE, N_ARC, N_SIDE = 5, 4, 28
# Side stations shared by every line, so panel joints follow clean edge loops: the quarter / rear door (-0.95),
# the B pillar (-0.10), the windscreen's top (0.08) and base (0.95), the roof glass (-1.25, 0.0), the rear side
# window's tip (-1.70). Each line adds its own two stations at each end, before its corners.
X_FIX = [-1.70, -1.55, -1.45, -1.35, -1.25, -1.10, -0.95, -0.80, -0.62, -0.45, -0.28, -0.10, 0.0, 0.08, 0.25, 0.42,
         0.60, 0.78, 0.95, 1.10, 1.25, 1.40, 1.58, 1.70, 1.80]
assert len(X_FIX) == N_SIDE - 3
FLAT = 0.40  # half-width of the faces' flat centre
SIDE0 = N_FACE + N_ARC                     # first side station
SIDE1 = SIDE0 + N_SIDE                     # first front-corner station
CREASES = {"shoulder": 1.0, "beltline": 0.7, "cladding-top": 0.8, "roof-edge": 0.5}
NOT_ACROSS_BONNET = {"beltline", "roof-edge"}  # these creases stop at the front corners: no ridge across the bonnet's nose
# Vertical edges where the wings turn into the bumpers and the body sides into the tailgate (front and rear corners).
CORNER_EDGES = {"front": (SIDE1 + 2, "lower-door", "shoulder", 0.6), "rear": (SIDE0 - 3, "lower-door", "shoulder", 0.6)}
END_CREASES = {"body-side": 0.8, "lower-door": 0.6}  # the bumpers' top edge, front and rear only
FLARE = {F: 0.038, R: 0.042}               # how far the body swells round each axle's opening (rear haunches wider)


def smooth(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def flare(x: float, y: float) -> float:
    """Outward swell of the lower body round the wheel openings: full at the opening's shoulder, fading out."""
    out = 0.0
    for ax, amount in FLARE.items():
        d = math.hypot(x - ax, y - 0.405)
        out = max(out, amount * (1 - smooth((d - 0.50) / 0.42)) * smooth((y - 0.28) / 0.25))
    return out


def rail(line: Line) -> list[tuple[float, float, float]]:
    """The line's control points, tail centre to nose centre: face, corner, side, corner, face."""
    fy, fz = pchip(line.y), pchip(line.z)
    xf, rf, bf, yf, *ff = line.front
    xr, rr, br, yr, *fr = line.rear
    pts: list[tuple[float, float, float]] = []
    xs0, xs1 = xr + br + rr, xf - bf - rf
    w0, w1 = fz(xs0), fz(xs1)

    def wrap(x_side, w, r, x_centre, bow, y_side, y_face, rear: bool, flat_half: float):
        """From the side's end round the plan corner and across the face to the centre line."""
        out = []
        if w < 0.02:  # the centre line: straight on along x
            for k in range(N_ARC + N_FACE + 1):
                x = x_side + (x_centre - x_side) * k / (N_ARC + N_FACE)
                out.append((x, fy(x), 0.0))
            return out
        r = min(r, w - 0.02)
        yy = y_side if y_face is None else y_face
        sgn = -1 if rear else 1
        x_corner = x_centre - sgn * bow
        for k in range(N_ARC):
            th = math.pi / 2 * k / N_ARC
            out.append((x_corner - sgn * r + sgn * r * math.sin(th), y_side + (yy - y_side) * smooth(0.4 * k / N_ARC),
                        w - r + r * math.cos(th)))
        zc = w - r
        flat = min(flat_half, 0.6 * zc) if flat_half < 0.5 else min(flat_half, zc - 0.03)  # bonnet lines keep the proportion
        for k in range(N_FACE + 1):
            z = zc * (1 - k / N_FACE)
            g = 1 - smooth((abs(z) - flat) / max(zc - flat, 1e-3))  # 1 across the flat centre, 0 at the corner
            out.append((x_corner + sgn * bow * g, y_side + (yy - y_side) * smooth(0.4 + 0.6 * k / N_FACE), z))
        return out

    tail = wrap(xs0, w0, rr, xr, br, fy(xs0), yr, rear=True, flat_half=fr[0] if fr else FLAT)
    pts += list(reversed(tail))[:-1]  # the corner's start is the side's first point
    for x in [xs0, (xs0 + X_FIX[0]) / 2, *X_FIX, (X_FIX[-1] + xs1) / 2]:
        pts.append((x, fy(x), fz(x)))
    front = wrap(xs1, w1, rf, xf, bf, fy(xs1), yf, rear=False, flat_half=ff[0] if ff else FLAT)
    if line.follow:  # one smooth bonnet: the height keeps following the side-view curve round the nose
        front = [(x, fy(x), z) for x, _, z in front]
    pts += front
    if line.flare:
        pts = [(x, y, z + flare(x, y) * (1 if SIDE0 - 2 <= i <= SIDE1 + 2 else 0)) for i, (x, y, z) in enumerate(pts)]
    return pts


def band(lo: int, x: float, z: float, station: int) -> str:
    """Material of a control face from its lower line, position and station (tail < SIDE0 <= side < SIDE1 <= front)."""
    i = NAMES.index
    tail, front = station < SIDE0, station >= SIDE1
    if tail and station < N_FACE and lo <= i("rocker"):
        return "gloss-black"  # the diffuser's face (D1.4)
    if lo <= i("rocker"):
        return "cladding"
    if front and lo == i("cladding-top") and station >= SIDE1 + 5:
        return "gloss-black"  # the lower intake (D1.4)
    if lo == i("cladding-top") and (front or tail):
        return "cladding"  # satin-black lower bumpers, continuing the arch lips and sills
    if front and lo == i("upper-fascia") and station >= SIDE1 + 2:
        return "gloss-black"  # the band under the bonnet's edge that carries the light blade (D1.4)
    if lo < i("glass") or (front and lo >= i("glass")) or (not tail and x > 0.95):
        return "paint"
    if lo == i("glass"):
        return "glass" if (tail or -1.80 < x < 0.95) else "paint"
    if tail:
        return "gloss-black" if lo == i("roof-edge") else "paint"  # spoiler underside, roof end
    if lo == i("roof-edge"):
        return "gloss-black" if x > -1.80 else "paint"  # A pillar and roof side rail: dark window surround (D1.4)
    if 0.10 < x <= 0.95:
        return "glass"  # windscreen
    if -1.25 < x < 0.0 and lo >= i("roof-rail"):
        return "glass-roof"
    return "paint"


def build_shell(panel_of=None, levels: int = 3) -> bpy.types.Object:
    """The shell's control net, mirrored and subdivided (not yet applied). panel_of(lower line, station, x, z), if
    given, names each control face's panel; the name's index is kept in the face attribute "panel", which the
    subdivision passes on to every face it makes, so panels separate exactly along the net's edges."""
    rails = [rail(l) for l in LINES]
    n = len(rails[0])
    assert all(len(r) == n for r in rails), [len(r) for r in rails]
    bm = bmesh.new()
    grid = [[bm.verts.new(app(*rails[c][s])) for c in range(len(LINES))] for s in range(n)]
    mats = ["paint", "glass", "glass-roof", "cladding", "gloss-black"]
    panel_layer = bm.faces.layers.int.new("panel") if panel_of else None
    panel_names: dict[str, int] = {}
    for s in range(n - 1):
        for c in range(len(LINES) - 1):
            f = bm.faces.new((grid[s][c], grid[s + 1][c], grid[s + 1][c + 1], grid[s][c + 1]))
            x = (rails[c][s][0] + rails[c + 1][s + 1][0]) / 2
            z = (rails[c][s][2] + rails[c + 1][s + 1][2]) / 2
            f.material_index = mats.index(band(c, x, z, s))
            if panel_of:
                f[panel_layer] = panel_names.setdefault(panel_of(c, s, x, z), len(panel_names))
    crease = bm.edges.layers.float.new("crease_edge")
    for name, value in CREASES.items():
        c = NAMES.index(name)
        for s in range(n - 1):
            if name in NOT_ACROSS_BONNET and s >= SIDE1:
                continue
            e = bm.edges.get((grid[s][c], grid[s + 1][c]))
            if e:
                e[crease] = value
    for s, lo, hi, value in CORNER_EDGES.values():
        for c in range(NAMES.index(lo), NAMES.index(hi)):
            e = bm.edges.get((grid[s][c], grid[s][c + 1]))
            if e:
                e[crease] = value
    for name, value in END_CREASES.items():
        c = NAMES.index(name)
        for s in list(range(SIDE0 - 1)) + list(range(SIDE1 + 1, n - 1)):
            e = bm.edges.get((grid[s][c], grid[s + 1][c]))
            if e:
                e[crease] = value
    for v in bm.verts:
        if abs(v.co.y) < 1e-4:
            v.co.y = 0.0
    mesh = bpy.data.meshes.new("body")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("body", mesh)
    bpy.context.scene.collection.objects.link(obj)
    for m in mats:
        obj.data.materials.append(bpy.data.materials.get(m) or bpy.data.materials.new(m))
    mirror = obj.modifiers.new("mirror", "MIRROR")
    mirror.use_axis = (False, True, False)
    mirror.use_clip = mirror.use_mirror_merge = True
    mirror.merge_threshold = 1e-3
    obj["panel_names"] = {str(v): k for k, v in panel_names.items()} if panel_of else {}
    sub = obj.modifiers.new("subdivision", "SUBSURF")
    sub.levels = sub.render_levels = levels
    return obj


def build() -> bpy.types.Object:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    trial.materials()
    for name in ("glass", "glass-roof"):
        bsdf = bpy.data.materials[name].node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Specular IOR Level"].default_value = 0.08
        bsdf.inputs["Coat Weight"].default_value = 0.1
    satin = bpy.data.materials["cladding"].node_tree.nodes["Principled BSDF"]  # matte satin black, not a mirror of the floor
    satin.inputs["Roughness"].default_value = 0.75
    satin.inputs["Specular IOR Level"].default_value = 0.04
    body = build_shell()
    trial.apply_modifiers(body)
    d11.openings(body)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.shade_smooth()
    # the same thin placeholder light lines as D1.1, so the views compare like for like (lights are D1.4)
    trial.surface_strip(body, "lamp-front", centre_x=1.9, y=0.85, half_angle=60, facing=1, height=0.012, material="lamp-front")
    trial.surface_strip(body, "lamp-rear", centre_x=-1.9, y=1.0, half_angle=64, facing=-1, height=0.022, material="lamp-rear")
    d11.wheels()
    trial.wheel_finish()
    trial.studio()
    return body


def check_fit() -> None:
    """Does everything inside fit under this shell? The body structure must stay entirely inside; the mechanical
    models (not the wheel corners, which pass through the openings) inside above y 0.33 (below that, the
    underbody's parts are meant to show under the car)."""
    import glob
    import structure_review
    bpy.ops.wm.read_factory_settings(use_empty=True)
    trial.materials()
    body = build_shell()
    trial.apply_modifiers(body)
    d11.openings(body)
    structure = structure_review.import_structure()
    out = structure_review.fit(body, structure)
    print("structure outside the shell:", ", ".join(f"{n} {d * 1000:.0f} mm at {w}" for d, n, w in out) or "nothing")
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    worst = []
    for path in sorted(glob.glob(str(d11.ROOT / "web" / "assets-src" / "*.glb"))):
        name = Path(path).stem
        if name.startswith(("corner-", "body-")):  # the wheels and drive shafts pass through the openings
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        for o in set(bpy.data.objects) - before:
            if o.type != "MESH" or "halfshaft" in o.name:
                continue
            far = 0.0
            for v in o.data.vertices:
                p = o.matrix_world @ v.co
                if p.z < 0.33:  # Blender's z is the app's y
                    continue
                hit, n, _, d = bvh.find_nearest(p)
                if hit is not None and (p - hit).dot(n) > 0:
                    far = max(far, d)
            if far > 0.001:
                worst.append((far, f"{name}:{o.name.split('.')[0]}"))
    print("mechanical parts outside the shell:", ", ".join(f"{n} {d * 1000:.0f} mm" for d, n in sorted(worst, reverse=True)) or "nothing")


if __name__ == "__main__" and "fit" in sys.argv[1:]:
    check_fit()
elif __name__ == "__main__":
    views = [a for a in sys.argv[1:] if a in d11.VIEWS] or list(d11.VIEWS)
    body = build()
    print(f"shell: {len(body.data.polygons)} faces")
    for v in views:
        print("rendered", d11.render(v, "d13"))
