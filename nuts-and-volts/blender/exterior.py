"""D1.1 exterior study: an improved scripted subdivision body, in the app's own coordinates and around the real
mechanical vehicle, for comparison with the approved concept, the October trial and the current app body.

    uv run --project blender python -I blender/exterior.py [front34 side rear34 front rear ...]

What changed from the October trial (blender/exterior_trial.py, kept as it was):
- App coordinates throughout (front axle x 1.58, rear axle x -1.45, nose 2.35, tail -2.41) and the four real wheel
  corners (web/assets-src/corner-*.glb), so the body sits on the actual vehicle.
- Ten landmarks instead of nine, and the roof rails reach them at their own x: the windscreen rakes from a header
  at x 0.1, the roof peaks over the B pillar and falls to a spoiler at x -2.0 (the reference's coupe-SUV line).
- Thirteen rails: a concave lower door between the black cladding and the body side, and a roof rail.
- Stance: the body side, lower door and shoulder flare out over both axles ("hips") and tuck in between, the
  shoulder runs level over both wheels, and the openings are tight to the tyres (68 mm gap at rest).
- Front: a low, near-vertical face with a crisp bonnet edge and a flat bonnet; rear: a raked rear window ending
  in a spoiler, a tall tail and broad haunches (plan view tapers to the tail).
- Glasshouse: dark glass, black A pillars, a pointed rear side window with a body-colour C pillar, and a panoramic
  glass panel in a body-colour roof.
Lights, trim and sensors are left out (D1.4): only thin placeholder light lines, so the views read as a car.

Coordinates are the app's (metres; x forward, y up, z to the right). Renders go to web/shots/exterior-<view>.png.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy  # must come first
import bmesh
from mathutils.bvhtree import BVHTree
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
import exterior_trial as trial  # noqa: E402  materials, studio, wheel finish, helpers (kept as they were)

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "web" / "shots"
F, R = 1.58, -1.45  # axles (web/src/vehicle/dimensions.ts)
AXLE_Y = 0.405
MID = (F + R) / 2  # the wheelbase's centre, where the cameras aim
app = trial.app

# ---- The control cage --------------------------------------------------------------------------------------
# Each rail: its point (x, y, z) at each landmark, in app coordinates, right half (z >= 0). The lower rails and the
# roof rails reach a landmark at different x, so the roof can run from its own header, peak and spoiler.
#   L0 tail centre | L1 rear corner (body) / spoiler (roof) | L2 rear axle / rear window top | L3 C pillar
#   L4 B pillar / roof peak | L5 windscreen header | L6 cowl | L7 front axle | L8 front corner | L9 nose centre
RAILS: dict[str, list[tuple[float, float, float]]] = {
    "underbody-centre": [(-2.34, 0.40, 0), (-2.30, 0.31, 0), (R, 0.29, 0), (-1.05, 0.29, 0), (-0.10, 0.29, 0),
                         (0.30, 0.29, 0), (0.95, 0.29, 0), (F, 0.29, 0), (2.24, 0.31, 0), (2.29, 0.38, 0)],
    "underbody-edge":   [(-2.36, 0.40, 0), (-2.32, 0.31, 0.60), (R, 0.29, 0.80), (-1.05, 0.29, 0.80), (-0.10, 0.29, 0.80),
                         (0.30, 0.29, 0.80), (0.95, 0.29, 0.80), (F, 0.29, 0.80), (2.25, 0.31, 0.60), (2.31, 0.38, 0)],
    "rocker":           [(-2.39, 0.42, 0), (-2.30, 0.37, 0.79), (R, 0.31, 0.95), (-1.05, 0.30, 0.935), (-0.10, 0.30, 0.935),
                         (0.30, 0.30, 0.935), (0.95, 0.30, 0.935), (F, 0.31, 0.95), (2.24, 0.37, 0.78), (2.34, 0.40, 0)],
    "cladding-top":     [(-2.41, 0.58, 0), (-2.31, 0.58, 0.85), (R, 0.50, 0.975), (-1.05, 0.46, 0.955), (-0.10, 0.46, 0.952),
                         (0.30, 0.46, 0.953), (0.95, 0.46, 0.955), (F, 0.50, 0.975), (2.27, 0.56, 0.83), (2.35, 0.56, 0)],
    "lower-door":       [(-2.41, 0.66, 0), (-2.31, 0.67, 0.88), (R, 0.62, 0.99), (-1.05, 0.60, 0.950), (-0.10, 0.60, 0.946),
                         (0.30, 0.60, 0.947), (0.95, 0.60, 0.950), (F, 0.62, 0.99), (2.27, 0.64, 0.85), (2.35, 0.64, 0)],
    "body-side":        [(-2.40, 0.82, 0), (-2.30, 0.82, 0.89), (R, 0.80, 1.00), (-1.05, 0.78, 0.968), (-0.10, 0.78, 0.965),
                         (0.30, 0.78, 0.966), (0.95, 0.78, 0.968), (F, 0.79, 1.00), (2.24, 0.79, 0.84), (2.34, 0.79, 0)],
    "shoulder":         [(-2.38, 0.99, 0), (-2.28, 0.99, 0.86), (R, 0.99, 0.985), (-1.05, 0.975, 0.972), (-0.10, 0.965, 0.970),
                         (0.30, 0.96, 0.969), (0.95, 0.95, 0.968), (F, 0.93, 0.975), (2.18, 0.88, 0.80), (2.30, 0.875, 0)],
    "beltline":         [(-2.35, 1.07, 0), (-2.30, 1.09, 0.83), (-1.62, 1.17, 0.90), (-1.15, 1.135, 0.905), (-0.10, 1.08, 0.905),
                         (0.30, 1.065, 0.902), (0.92, 1.03, 0.895), (F, 0.99, 0.90), (2.15, 0.895, 0.76), (2.27, 0.89, 0)],
    "glass":            [(-2.28, 1.16, 0), (-2.22, 1.18, 0.66), (-1.80, 1.33, 0.75), (-1.20, 1.215, 0.83), (-0.10, 1.13, 0.84),
                         (0.30, 1.115, 0.83), (0.90, 1.06, 0.80), (F, 1.015, 0.77), (2.13, 0.905, 0.62), (2.25, 0.898, 0)],
    "roof-edge":        [(-2.07, 1.385, 0), (-2.02, 1.40, 0.56), (-1.82, 1.43, 0.66), (-1.25, 1.52, 0.70), (-0.35, 1.555, 0.705),
                         (0.08, 1.52, 0.69), (0.92, 1.07, 0.70), (F, 1.025, 0.66), (2.12, 0.912, 0.50), (2.24, 0.905, 0)],
    "roof-rail":        [(-2.04, 1.40, 0), (-1.99, 1.42, 0.52), (-1.72, 1.49, 0.61), (-1.25, 1.555, 0.64), (-0.35, 1.585, 0.645),
                         (0.10, 1.545, 0.63), (0.93, 1.075, 0.60), (F, 1.032, 0.56), (2.11, 0.92, 0.40), (2.23, 0.912, 0)],
    "roof":             [(-2.02, 1.41, 0), (-1.97, 1.43, 0.33), (-1.72, 1.50, 0.38), (-1.25, 1.57, 0.40), (-0.35, 1.60, 0.40),
                         (0.12, 1.56, 0.39), (0.94, 1.08, 0.36), (F, 1.038, 0.34), (2.10, 0.926, 0.25), (2.22, 0.918, 0)],
    "roof-centre":      [(-2.01, 1.415, 0), (-1.96, 1.435, 0), (-1.72, 1.505, 0), (-1.25, 1.575, 0), (-0.35, 1.605, 0),
                         (0.13, 1.565, 0), (0.95, 1.085, 0), (F, 1.042, 0), (2.10, 0.93, 0), (2.22, 0.92, 0)],
}
RAIL_NAMES = list(RAILS)
SAMPLES = [5, 3, 4, 4, 3, 3, 4, 3, 5]  # stations per landmark interval
CREASES = {"shoulder": 1.0, "beltline": 0.8, "cladding-top": 0.7, "roof-edge": 0.5}


def band(rail: str, seg: int) -> str:
    """Material of a cage face, from the band it spans (named by its lower rail) and its landmark interval."""
    i = RAIL_NAMES.index
    lo = i(rail)
    if lo <= i("rocker"):
        return "cladding"
    if lo < i("glass") or seg >= 6:  # body sides, the narrow sill under the windows, bonnet and wings
        return "paint"
    if lo == i("glass"):  # the window band
        return "paint" if seg == 1 else "glass"  # body-colour C pillar behind the pointed rear side window
    if seg == 0:
        return "paint"  # spoiler, above the rear window
    if seg == 5:  # header to cowl: black A pillar, windscreen
        return "gloss-black" if lo == i("roof-edge") else "glass"
    if seg in (3, 4) and lo >= i("roof-rail"):
        return "glass-roof"  # panoramic roof inside a body-colour roof
    return "paint"


def build_cage() -> bpy.types.Object:
    ts = []
    for seg, n in enumerate(SAMPLES):
        ts += [seg + k / n for k in range(n)]
    ts.append(len(SAMPLES))
    curves = {name: [app(*p) for p in pts] for name, pts in RAILS.items()}
    bm = bmesh.new()
    grid = [[bm.verts.new(trial.catmull_rom(curves[name], t)) for name in RAIL_NAMES] for t in ts]
    mats = ["paint", "glass", "glass-roof", "cladding", "gloss-black"]
    for s in range(len(ts) - 1):
        for r in range(len(RAIL_NAMES) - 1):
            f = bm.faces.new((grid[s][r], grid[s + 1][r], grid[s + 1][r + 1], grid[s][r + 1]))
            f.material_index = mats.index(band(RAIL_NAMES[r], int(ts[s])))
    crease = bm.edges.layers.float.new("crease_edge")
    for name, value in CREASES.items():
        r = RAIL_NAMES.index(name)
        for s in range(len(ts) - 1):
            e = bm.edges.get((grid[s][r], grid[s + 1][r]))
            if e:
                e[crease] = value
    for t_corner in (1.0,):  # a crisp corner where the sides turn into the tail
        sidx = ts.index(t_corner)
        for r in range(RAIL_NAMES.index("rocker"), RAIL_NAMES.index("beltline")):
            e = bm.edges.get((grid[sidx][r], grid[sidx][r + 1]))
            if e:
                e[crease] = 0.6
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
    mirror.use_clip = True
    mirror.use_mirror_merge = True
    mirror.merge_threshold = 1e-3
    sub = obj.modifiers.new("subdivision", "SUBSURF")
    sub.levels = sub.render_levels = 3
    return obj


def openings(body: bpy.types.Object, radius: float = 0.473) -> None:
    """Wheel openings tight to the tyres, satin-black lips and dark wheelhouses (as the trial, at the real axles)."""
    saved = (trial.FRONT_AXLE, trial.REAR_AXLE)
    trial.FRONT_AXLE, trial.REAR_AXLE = F, R
    try:
        for x in (F, R):
            for side in (1, -1):
                bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=radius, depth=0.7, location=app(x, AXLE_Y, side * 1.05),
                                                    rotation=(math.pi / 2, 0, 0))
                cutter = bpy.context.object
                boolean = body.modifiers.new("arch", "BOOLEAN")
                boolean.operation, boolean.object, boolean.solver = "DIFFERENCE", cutter, "EXACT"
                trial.apply_modifiers(body)
                bpy.data.objects.remove(cutter)
        bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
        for x in (F, R):
            for side in (1, -1):
                # The lip: a band on the body around the opening, found by casting rays at the body from outside (so it
                # follows the surface exactly), turning in at the opening edge as a return flange.
                inward = app(0, 0, -side) - app(0, 0, 0)
                rows = []
                for i in range(145):
                    a = math.radians(-14 + 208 * i / 144)
                    ring = []
                    for r in (radius + 0.055, radius + 0.004):
                        hit, normal, _, _ = bvh.ray_cast(app(x + r * math.cos(a), AXLE_Y + r * math.sin(a), side * 1.6), inward, 1.2)
                        ring.append(None if hit is None else (hit, normal))
                    if None in ring:
                        rows.append(None)
                        continue
                    (outer, n_out), (edge, n_edge) = ring
                    edge_in = edge.copy()
                    edge_in += (app(x + (radius - 0.004) * math.cos(a), AXLE_Y + (radius - 0.004) * math.sin(a), 0)
                                - app(x + (radius + 0.004) * math.cos(a), AXLE_Y + (radius + 0.004) * math.sin(a), 0))
                    rows.append([outer + n_out * 0.003, edge + n_edge * 0.006, edge_in + n_edge * 0.006, edge_in + inward * 0.06])
                bm = bmesh.new()
                verts = [None if row is None else [bm.verts.new(p) for p in row] for row in rows]
                for va, vb in zip(verts, verts[1:]):
                    if va is None or vb is None:
                        continue
                    for k in range(3):
                        quad = (va[k], vb[k], vb[k + 1], va[k + 1])
                        bm.faces.new(quad if side > 0 else quad[::-1])
                mesh = bpy.data.meshes.new("arch-lip")
                bm.to_mesh(mesh)
                bm.free()
                lip = bpy.data.objects.new("arch-lip", mesh)
                bpy.context.scene.collection.objects.link(lip)
                lip.data.materials.append(bpy.data.materials["cladding"])
                for poly in lip.data.polygons:
                    poly.use_smooth = True
                bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius - 0.012, depth=0.42, end_fill_type="NOTHING",
                                                    location=app(x, AXLE_Y, side * 0.79), rotation=(math.pi / 2, 0, 0))
                liner = bpy.context.object
                liner.data.materials.append(bpy.data.materials["cladding"])
                bpy.ops.object.shade_smooth()
    finally:
        trial.FRONT_AXLE, trial.REAR_AXLE = saved


WHEEL_KEYS = ("tyre", "wheel", "brake-disc", "caliper", "hub-nut", "hub", "brake-shield", "brake-pad-inner", "brake-pad-outer")


def wheels() -> None:
    """The four real corners (only what shows through the wheels), at their real positions."""
    for c in ("fr", "fl", "rr", "rl"):
        bpy.ops.import_scene.gltf(filepath=str(ROOT / "web" / "assets-src" / f"corner-{c}.glb"))
        for o in list(bpy.context.selected_objects):
            if o.parent is None and not (o.name.split(".")[0] in WHEEL_KEYS or o.name.startswith("wheel-nut")):
                for child in o.children_recursive:
                    bpy.data.objects.remove(child)
                bpy.data.objects.remove(o)


VIEWS = {  # camera position, target, focal length (app coordinates); front34/side/rear34 match the reference's angles
    "front34": ((MID + 5.6, 1.05, -5.9), (MID + 0.05, 0.72, 0), 50),
    "side": ((MID, 0.85, -11.5), (MID - 0.1, 0.78, 0), 75),
    "rear34": ((MID - 6.0, 1.25, -5.0), (MID, 0.78, 0), 50),
    "front": ((MID + 11.0, 0.95, 0), (MID, 0.75, 0), 85),
    "rear": ((MID - 11.0, 1.0, 0), (MID, 0.8, 0), 85),
}


def render(view: str, prefix: str = "exterior", samples: int = 96) -> Path:
    saved = trial.VIEWS
    trial.VIEWS = VIEWS
    trial.SHOTS = SHOTS
    try:
        scene = bpy.context.scene
        out = trial.render(view, samples)
        final = SHOTS / f"{prefix}-{view}.png"
        out.replace(final)
        return final
    finally:
        trial.VIEWS = saved


def build() -> bpy.types.Object:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    trial.materials()
    for name in ("glass", "glass-roof"):  # darker, less mirror-like glass, so the window graphic reads
        bsdf = bpy.data.materials[name].node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Specular IOR Level"].default_value = 0.08
        bsdf.inputs["Coat Weight"].default_value = 0.1
    body = build_cage()
    trial.apply_modifiers(body)
    openings(body)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.shade_smooth()
    trial.surface_strip(body, "lamp-front", centre_x=1.9, y=0.86, half_angle=60, facing=1, height=0.012, material="lamp-front")
    trial.surface_strip(body, "lamp-rear", centre_x=-1.9, y=1.05, half_angle=64, facing=-1, height=0.022, material="lamp-rear")
    wheels()
    trial.wheel_finish()
    trial.studio()
    return body


if __name__ == "__main__":
    views = [a for a in sys.argv[1:] if a in VIEWS] or list(VIEWS)
    body = build()
    print(f"body: {len(body.data.polygons)} faces")
    for v in views:
        print("rendered", render(v))
