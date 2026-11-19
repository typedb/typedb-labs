"""Exterior trial (Phase B, one-day time box): can a scripted subdivision-surface body reach the approved
concept's silhouette, body-side surfacing and reflections?

    uv run --project blender python -I blender/exterior_trial.py [front34 side rear34 ...]

Approach
- The body is one subdivision surface. Its control cage is a grid: 11 "rails" running the length of the car
  (underbody centre, underbody edge, rocker, cladding top, body side, shoulder, beltline, glass, roof edge,
  roof, roof centre) sampled at stations between 9 landmarks (tail, rear corner, rear axle, C and B pillars,
  windscreen base, front axle, front corner, nose). Each rail is a smooth (Catmull-Rom) curve through its
  landmark points; at the tail and nose every rail meets the centre plane, so the half body closes on the
  mirror. Blender's Mirror + Subdivision Surface modifiers turn the cage into a smooth, continuous surface;
  edge creases keep the shoulder line, beltline and roof edge crisp.
- Materials follow the cage bands (paint, dark glass, satin-black cladding), so their boundaries are smooth
  curves rather than cuts. Wheel openings are cut once from the final dense surface.
- Dimensions: the provisional targets in docs/design-targets.md (wheelbase 3.03 m, front overhang 0.76 m,
  height about 1.63 m, length 4.75 m, 22-inch wheels). Wheels and brakes are the Phase A models, with a
  darker wheel finish.

Coordinates are the app's (metres; x forward, y up, z to the right); app() converts to Blender's z-up.
Renders go to web/shots/exterior-trial-<view>.png (git-ignored).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy  # must come first
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
CORNER_GLB = ROOT / "web" / "assets-src" / "corner-fr.glb"
HDRI = ROOT / "web" / "public" / "env" / "monochrome_studio_02_1k.hdr"
SHOTS = ROOT / "web" / "shots"

WHEELBASE = 3.03
FRONT_AXLE, REAR_AXLE = WHEELBASE / 2, -WHEELBASE / 2
AXLE_Y, TRACK_HALF, TYRE_R = 0.405, 0.815, 0.403
PHASE_A_AXLE_X = 1.58           # where the Phase A corner model sits (FRONT_AXLE_X in dimensions.ts)


def app(x: float, y: float, z: float) -> Vector:
    """App coordinates -> Blender (z up). Same mapping as Blender's glTF importer."""
    return Vector((x, -z, y))


# ---- 1. The control cage ----------------------------------------------------------------------------------
# For each rail: its point (x, y, z) at each landmark L0..L8, in app coordinates (z >= 0: the right half).
#   L0 tail centre | L1 rear corner | L2 rear axle | L3 C pillar | L4 B pillar | L5 windscreen base / cowl
#   L6 front axle | L7 front corner | L8 nose centre
R, F = REAR_AXLE, FRONT_AXLE
RAILS: dict[str, list[tuple[float, float, float]]] = {
    "underbody-centre": [(-2.30, 0.33, 0), (-2.25, 0.27, 0), (R, 0.26, 0), (-0.55, 0.26, 0), (0.15, 0.26, 0),
                         (0.95, 0.26, 0), (F, 0.26, 0), (2.04, 0.27, 0), (2.10, 0.33, 0)],
    "underbody-edge":   [(-2.36, 0.33, 0), (-2.30, 0.27, 0.62), (R, 0.26, 0.80), (-0.55, 0.26, 0.80), (0.15, 0.26, 0.80),
                         (0.95, 0.26, 0.80), (F, 0.26, 0.80), (2.08, 0.27, 0.58), (2.15, 0.33, 0)],
    "rocker":           [(-2.42, 0.35, 0), (-2.390, 0.34, 0.86), (R, 0.33, 0.93), (-0.55, 0.33, 0.935), (0.15, 0.33, 0.935), (0.95, 0.33, 0.93), (F, 0.33, 0.93), (2.185, 0.34, 0.8), (2.22, 0.35, 0)],
    "cladding-top":     [(-2.465, 0.47, 0), (-2.435, 0.47, 0.9), (R, 0.47, 0.975), (-0.55, 0.46, 0.962), (0.15, 0.46, 0.962), (0.95, 0.47, 0.968), (F, 0.47, 0.975), (2.240, 0.47, 0.86), (2.275, 0.48, 0)],
    "body-side":        [(-2.475, 0.67, 0), (-2.445, 0.67, 0.91), (R, 0.69, 0.985), (-0.55, 0.67, 0.958), (0.15, 0.67, 0.955), (0.95, 0.68, 0.965), (F, 0.69, 0.985), (2.230, 0.66, 0.875), (2.265, 0.65, 0)],
    "under-shoulder":   [(-2.46, 0.90, 0), (-2.430, 0.90, 0.9), (R, 0.90, 0.972), (-0.55, 0.89, 0.948), (0.15, 0.885, 0.945), (0.95, 0.88, 0.952), (F, 0.87, 0.972), (2.200, 0.83, 0.865), (2.235, 0.82, 0)],
    "shoulder":         [(-2.45, 0.97, 0), (-2.420, 0.97, 0.9), (R, 0.96, 0.997), (-0.55, 0.95, 0.975), (0.15, 0.945, 0.972), (0.95, 0.94, 0.978), (F, 0.92, 0.997), (2.175, 0.86, 0.86), (2.21, 0.845, 0)],
    "beltline":         [(-2.42, 1.07, 0), (-2.35, 1.09, 0.77), (R, 1.20, 0.89), (-0.55, 1.17, 0.90), (0.15, 1.13, 0.90), (0.92, 1.09, 0.885), (F, 0.98, 0.92), (2.145, 0.90, 0.82), (2.18, 0.866, 0)],
    "glass":            [(-2.24, 1.25, 0), (-2.16, 1.27, 0.64), (R, 1.37, 0.79), (-0.55, 1.40, 0.82), (0.17, 1.39, 0.83),
                         (0.97, 1.10, 0.80), (1.55, 0.985, 0.80), (2.05, 0.895, 0.62), (2.165, 0.87, 0)],
    "roof-edge":        [(-2.06, 1.38, 0), (-1.99, 1.41, 0.60), (R, 1.49, 0.70), (-0.55, 1.56, 0.73), (0.20, 1.565, 0.72),
                         (1.00, 1.105, 0.62), (1.55, 0.99, 0.58), (2.03, 0.895, 0.46), (2.16, 0.87, 0)],
    "roof":             [(-2.00, 1.41, 0), (-1.95, 1.44, 0.36), (R, 1.54, 0.40), (-0.55, 1.615, 0.41), (0.22, 1.60, 0.40),
                         (1.00, 1.11, 0.33), (1.55, 0.995, 0.32), (2.02, 0.90, 0.27), (2.155, 0.87, 0)],
    "roof-centre":      [(-1.99, 1.415, 0), (-1.94, 1.45, 0), (R, 1.555, 0), (-0.55, 1.632, 0), (0.24, 1.61, 0),
                         (1.00, 1.112, 0), (1.55, 0.997, 0), (2.02, 0.902, 0), (2.155, 0.87, 0)],
}
RAIL_NAMES = list(RAILS)
# Stations sampled in each of the 8 landmark intervals (denser where the body turns at the ends).
SAMPLES = [5, 3, 4, 4, 3, 4, 3, 5]
# Edge creases along rails (0..1): crisp feature lines.
CREASES = {"shoulder": 1.0, "beltline": 0.9, "roof-edge": 0.55, "cladding-top": 0.7}


def catmull_rom(points: list[Vector], t: float) -> Vector:
    i = min(int(t), len(points) - 2)
    u = t - i
    p0 = points[max(i - 1, 0)]
    p1, p2 = points[i], points[i + 1]
    p3 = points[min(i + 2, len(points) - 1)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)


def station_params() -> list[float]:
    ts = []
    for seg, n in enumerate(SAMPLES):
        ts += [seg + k / n for k in range(n)]
    return ts + [len(SAMPLES)]


def band_material(rail_lo: str, t: float) -> str:
    """Which material a cage face gets, from the rail band it spans and where along the car it is."""
    lo = RAIL_NAMES.index(rail_lo)
    if lo <= RAIL_NAMES.index("rocker"):
        return "cladding"
    if lo == RAIL_NAMES.index("cladding-top") and t > 7.25:     # front face: lower air intake
        return "gloss-black"
    if lo >= RAIL_NAMES.index("beltline"):
        if t < 1.0:                              # rear face, above the beltline: rear window
            return "glass" if lo <= RAIL_NAMES.index("roof-edge") or t > 0.35 else "paint"
        if t < 4.0:                              # roof edge to belt: side glass; above: roof
            return "glass" if lo < RAIL_NAMES.index("roof-edge") else "glass-roof"
        if t < 5.0:                              # B pillar to cowl: front side glass and windscreen
            return "glass"
        return "paint"                           # bonnet and wings
    return "paint"


def build_cage() -> bpy.types.Object:
    ts = station_params()
    curves = {name: [app(*p) for p in pts] for name, pts in RAILS.items()}
    bm = bmesh.new()
    grid = [[bm.verts.new(catmull_rom(curves[name], t)) for name in RAIL_NAMES] for t in ts]
    mats = ["paint", "glass", "glass-roof", "cladding", "gloss-black"]
    for s in range(len(ts) - 1):
        for r in range(len(RAIL_NAMES) - 1):
            f = bm.faces.new((grid[s][r], grid[s + 1][r], grid[s + 1][r + 1], grid[s][r + 1]))
            f.material_index = mats.index(band_material(RAIL_NAMES[r], (ts[s] + ts[s + 1]) / 2))
    crease = bm.edges.layers.float.new("crease_edge")
    for name, value in CREASES.items():
        r = RAIL_NAMES.index(name)
        for s in range(len(ts) - 1):
            e = bm.edges.get((grid[s][r], grid[s + 1][r]))
            if e:
                e[crease] = value
    for t_corner in (1.0, 7.0):
        sidx = ts.index(t_corner)
        for r in range(RAIL_NAMES.index("rocker"), RAIL_NAMES.index("beltline")):
            e = bm.edges.get((grid[sidx][r], grid[sidx][r + 1]))
            if e:
                e[crease] = 0.7
    # Points on the centre plane snap exactly onto it, so the mirror welds them.
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
    mirror.use_axis = (False, True, False)       # app z (right) is Blender -y
    mirror.use_clip = True
    mirror.use_mirror_merge = True
    mirror.merge_threshold = 1e-3
    sub = obj.modifiers.new("subdivision", "SUBSURF")
    sub.levels = sub.render_levels = 3
    return obj


def apply_modifiers(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def cut_wheel_openings(body: bpy.types.Object) -> None:
    """Cut the wheel openings from the smooth surface, line them, and give them satin-black arch lips."""
    for x in (FRONT_AXLE, REAR_AXLE):
        for side in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=0.46, depth=0.7,
                                                location=app(x, AXLE_Y, side * 1.05), rotation=(math.pi / 2, 0, 0))
            cutter = bpy.context.object
            boolean = body.modifiers.new("arch", "BOOLEAN")
            boolean.operation, boolean.object, boolean.solver = "DIFFERENCE", cutter, "EXACT"
            apply_modifiers(body)
            bpy.data.objects.remove(cutter)
    # Arch lips: a band around each opening, projected onto the body and given a little thickness.
    for x in (FRONT_AXLE, REAR_AXLE):
        for side in (1, -1):
            bm = bmesh.new()
            rows = []
            for i in range(97):
                a = math.radians(-14 + 208 * i / 96)
                rows.append([bm.verts.new(app(x + r * math.cos(a), AXLE_Y + r * math.sin(a), side * 1.3)) for r in (0.462, 0.535)])
            for a, b in zip(rows, rows[1:]):
                bm.faces.new((a[0], b[0], b[1], a[1]) if side > 0 else (a[1], b[1], b[0], a[0]))
            mesh = bpy.data.meshes.new("arch-lip")
            bm.to_mesh(mesh)
            bm.free()
            lip = bpy.data.objects.new("arch-lip", mesh)
            bpy.context.scene.collection.objects.link(lip)
            lip.data.materials.append(bpy.data.materials["cladding"])
            wrap = lip.modifiers.new("onto-body", "SHRINKWRAP")
            wrap.target, wrap.wrap_method = body, "PROJECT"
            wrap.use_project_y, wrap.use_negative_direction, wrap.use_positive_direction = True, True, True
            wrap.offset = 0.002
            thick = lip.modifiers.new("thickness", "SOLIDIFY")
            thick.thickness, thick.offset = 0.012, 1.0
            lip.modifiers.new("smooth", "SUBSURF").levels = 1
            bpy.context.view_layer.objects.active = lip
            bpy.ops.object.shade_smooth()
    # Wheelhouse liners: dark half-cylinders so the openings look deep, not hollow.
    for x in (FRONT_AXLE, REAR_AXLE):
        for side in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.455, depth=0.42, end_fill_type="NOTHING",
                                                location=app(x, AXLE_Y, side * 0.80), rotation=(math.pi / 2, 0, 0))
            liner = bpy.context.object
            liner.name = "wheelhouse"
            liner.data.materials.append(bpy.data.materials["cladding"])
            bpy.ops.object.shade_smooth()


# ---- 2. Details: lights, mirrors ------------------------------------------------------------------------

def surface_strip(body: bpy.types.Object, name: str, centre_x: float, y: float, half_angle: float,
                  facing: int, height: float, material: str) -> None:
    """A thin light strip following the body surface: rays fan out from inside the body at height y."""
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    pts = []
    for i in range(121):
        a = math.radians(-half_angle + 2 * half_angle * i / 120)
        origin = app(centre_x, y, 0)
        direction = Vector((facing * math.cos(a), -math.sin(a), 0))
        hit, normal, _, _ = bvh.ray_cast(origin, direction, 5)
        if hit is not None:
            pts.append((hit + normal * 0.004, normal))
    bm = bmesh.new()
    rows = []
    for p, n in pts:
        up = Vector((0, 0, 1))
        rows.append([bm.verts.new(p + up * (height / 2)), bm.verts.new(p - up * (height / 2))])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], b[0], b[1], a[1]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials[material])


def mirrors() -> None:
    for side in (1, -1):
        bpy.ops.mesh.primitive_cube_add(size=1, location=app(0.86, 1.17, side * 0.99))
        m = bpy.context.object
        m.name = "mirror"
        m.scale = (0.11, 0.07, 0.045)            # Blender axes: x long, y = app z, z = app y
        m.dimensions = (0.17, 0.22, 0.11)
        m.rotation_euler = (0, 0, math.radians(-8 * side))
        m.modifiers.new("smooth", "SUBSURF").levels = 3
        m.data.materials.append(bpy.data.materials["gloss-black"])
        bpy.ops.object.shade_smooth()


# ---- 3. Wheels from Phase A -------------------------------------------------------------------------------

WHEEL_NODES = ("tyre", "wheel", "brake-disc", "caliper", "hub-nut", "hub", "brake-shield", "brake-pad-inner",
               "brake-pad-outer")


def wheels() -> None:
    bpy.ops.import_scene.gltf(filepath=str(CORNER_GLB))
    imported = [o for o in bpy.context.selected_objects]
    keep = [o for o in imported if o.parent is None and (o.name.split(".")[0] in WHEEL_NODES or o.name.startswith("wheel-nut"))]
    for o in imported:
        if o not in keep and o.parent is None:
            for child in o.children_recursive:
                bpy.data.objects.remove(child)
            bpy.data.objects.remove(o)
    corner = bpy.data.objects.new("corner-fr", None)
    bpy.context.scene.collection.objects.link(corner)
    for o in keep:
        o.parent = corner
    corner.location = (FRONT_AXLE - PHASE_A_AXLE_X, 0, 0)
    for x_shift, mirror in ((0, True), (-WHEELBASE, False), (-WHEELBASE, True)):
        copy = bpy.data.objects.new("corner", None)
        bpy.context.scene.collection.objects.link(copy)
        for o in keep:
            dup = o.copy()
            dup.data = o.data                     # shared geometry
            bpy.context.scene.collection.objects.link(dup)
            dup.parent = copy
        copy.location = (FRONT_AXLE - PHASE_A_AXLE_X + x_shift, 0, 0)
        if mirror:
            copy.scale = (1, -1, 1)                # app z (left-right) is Blender y


# ---- 4. Materials, studio, cameras ------------------------------------------------------------------------

def principled(name: str, base, metallic=0.0, roughness=0.5, coat=0.0, coat_roughness=0.03, emission=None,
               strength=0.0, anisotropy=0.0) -> None:
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        m.node_tree.nodes.clear()
        bsdf = m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        out = m.node_tree.nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for link in list(m.node_tree.links):             # drop imported texture links: the look is set here
        if link.to_node == bsdf:
            m.node_tree.links.remove(link)
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    bsdf.inputs["Anisotropic"].default_value = anisotropy
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength


def materials() -> None:
    principled("paint", (0.060, 0.064, 0.070), metallic=0.8, roughness=0.34, coat=1.0, coat_roughness=0.02)
    principled("glass", (0.004, 0.005, 0.006), roughness=0.03, coat=1.0, coat_roughness=0.0)
    principled("glass-roof", (0.004, 0.005, 0.006), roughness=0.03, coat=1.0, coat_roughness=0.0)
    principled("cladding", (0.012, 0.012, 0.013), roughness=0.55)
    principled("gloss-black", (0.006, 0.006, 0.007), roughness=0.12, coat=1.0)
    principled("lamp-front", (1, 1, 1), emission=(0.92, 0.96, 1.0), strength=35)
    principled("lamp-rear", (0.6, 0.02, 0.02), emission=(1.0, 0.04, 0.03), strength=22)
    principled("floor", (0.002, 0.002, 0.0025), roughness=0.3)
    bpy.data.materials["floor"].node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.2


def wheel_finish() -> None:
    """The Phase A wheel and tyre, re-dressed: darker wheel finish (owner's request), studio rubber."""
    for m in bpy.data.materials:
        n = m.name.split(".")[0]
        if n == "alloy-painted":
            principled(m.name, (0.018, 0.019, 0.021), metallic=0.85, roughness=0.32, coat=0.6)
        elif n == "alloy-machined":
            principled(m.name, (0.10, 0.10, 0.105), metallic=1.0, roughness=0.22, anisotropy=0.6)
        elif n in ("rubber-tread", "rubber-tyre", "rubber"):
            principled(m.name, (0.016, 0.016, 0.017), roughness=0.62)
        elif n == "iron-friction":
            principled(m.name, (0.25, 0.25, 0.25), metallic=1.0, roughness=0.42)
        elif n == "caliper-paint":
            principled(m.name, (0.42, 0.20, 0.08), metallic=0.65, roughness=0.32, coat=0.8)
        elif n in ("steel-plated", "steel", "alloy-forged", "aluminium-cast", "aluminium-machined"):
            principled(m.name, (0.45, 0.45, 0.46), metallic=1.0, roughness=0.3)


def studio() -> None:
    scene = bpy.context.scene
    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(HDRI))
    lighting = nt.nodes.new("ShaderNodeBackground")
    lighting.inputs["Strength"].default_value = 0.45
    backdrop = nt.nodes.new("ShaderNodeBackground")
    backdrop.inputs["Color"].default_value = (0.006, 0.0065, 0.0075, 1)
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(env.outputs["Color"], lighting.inputs["Color"])
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(lighting.outputs["Background"], mix.inputs[1])
    nt.links.new(backdrop.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    # Glossy studio floor.
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    bpy.context.object.data.materials.append(bpy.data.materials["floor"])
    # Softbox overhead and long strip lights either side: they draw the highlight lines along the body.
    def area(name, loc, rot, size, size_y, power):
        bpy.ops.object.light_add(type="AREA", location=loc, rotation=rot)
        light = bpy.context.object
        light.name = name
        light.data.shape = "RECTANGLE"
        light.data.size, light.data.size_y, light.data.energy = size, size_y, power
    area("softbox", (0, 0, 4.2), (0, 0, 0), 5.0, 2.2, 650)
    area("strip-left", (0, 5.0, 2.2), (math.radians(-75), 0, 0), 9, 0.25, 520)
    area("strip-right", (0, -5.0, 2.2), (math.radians(75), 0, 0), 9, 0.25, 520)
    area("rim", (-6, 0, 2.5), (0, math.radians(-60), 0), 3, 3, 350)


VIEWS = {
    # name: (camera position, target, focal length) in app coordinates
    "front34": ((5.6, 1.05, -5.9), (0.05, 0.72, 0), 50),
    "side": ((0.0, 0.85, -11.5), (-0.1, 0.78, 0), 75),
    "rear34": ((-6.0, 1.25, -5.0), (0.0, 0.78, 0), 50),
    "front-detail": ((3.6, 1.05, -2.3), (1.9, 0.8, -0.4), 70),
    "wheel-detail": ((2.6, 0.75, -3.4), (1.5, 0.55, -0.9), 80),
    "rear-detail": ((-3.9, 1.2, -1.9), (-2.2, 0.95, -0.3), 70),
}


def render(view: str, samples: int = 96) -> Path:
    scene = bpy.context.scene
    pos, target, lens = VIEWS[view]
    cam_data = bpy.data.cameras.new(view)
    cam_data.lens = lens
    cam = bpy.data.objects.new(view, cam_data)
    scene.collection.objects.link(cam)
    cam.location = app(*pos)
    direction = app(*target) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.3
    out = SHOTS / f"exterior-trial-{view}.png"
    scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    return out


def build() -> bpy.types.Object:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials()
    body = build_cage()
    apply_modifiers(body)
    cut_wheel_openings(body)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.shade_smooth()
    surface_strip(body, "lamp-front", centre_x=1.6, y=0.858, half_angle=58, facing=1, height=0.014, material="lamp-front")
    surface_strip(body, "lamp-rear", centre_x=-1.8, y=1.05, half_angle=62, facing=-1, height=0.03, material="lamp-rear")
    mirrors()
    wheels()
    wheel_finish()
    studio()
    return body


if __name__ == "__main__":
    views = [a for a in sys.argv[1:] if a in VIEWS] or ["front34", "side", "rear34"]
    body = build()
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f"body: {len(body.data.polygons)} faces, about {tris} triangles")
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "web" / "assets-src" / "exterior-trial.blend"))
    for v in views:
        print("rendered", render(v))
