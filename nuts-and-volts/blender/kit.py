"""Small modelling kit on top of Blender's Python API (bpy).

Everything is modelled in the app's coordinates (metres; x forward, y up, z to the vehicle's right)
and exported without axis conversion, so positions match the web app exactly.

Parts are built from simple solids, then refined with modifiers that the browser alone cannot do:
bevels (so every edge catches a highlight), booleans (holes, slots, windows), voxel remeshing (cast
shapes with natural fillets) and weighted normals (crisp, clean shading on flat machined faces).
"""

from __future__ import annotations

import math

import bpy  # must come first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

TAU = math.tau


# ---- scene and materials ----------------------------------------------------------------------------

def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name: str) -> bpy.types.Material:
    """Materials are placeholders named by role; the web app swaps in its own PBR materials by name."""
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


def new_object(name: str, bm: bmesh.types.BMesh, mat: str) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material(mat))
    return obj


def transform(bm: bmesh.types.BMesh, m: Matrix) -> bmesh.types.BMesh:
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def align_z(direction: Vector) -> Matrix:
    """Rotation turning +z onto `direction`."""
    return Vector((0, 0, 1)).rotation_difference(direction.normalized()).to_matrix().to_4x4()


# ---- primitive solids (all closed, so booleans work) -------------------------------------------------

def lathe(profile: list[tuple[float, float]], segments: int = 96) -> bmesh.types.BMesh:
    """Spin a closed (radius, z) profile around the z axis."""
    bm = bmesh.new()
    rings = []
    for j in range(segments):
        a = TAU * j / segments
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * c, r * s, z)) for r, z in profile])
    n = len(profile)
    for j in range(segments):
        a, b = rings[j], rings[(j + 1) % segments]
        for i in range(n):
            k = (i + 1) % n
            bm.faces.new((a[i], b[i], b[k], a[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def cylinder(r: float, depth: float, segments: int = 48, r2: float | None = None) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    return bm


def box(sx: float, sy: float, sz: float) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    return transform(bm, Matrix.Diagonal((sx, sy, sz, 1)))


def sphere(r: float, subdiv: int = 3) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    return bm


def rod(a: Vector, b: Vector, r: float, segments: int = 32, r2: float | None = None) -> bmesh.types.BMesh:
    """A cylinder from point a to point b."""
    d = b - a
    bm = cylinder(r, d.length, segments, r2)
    return transform(bm, Matrix.Translation((a + b) / 2) @ align_z(d))


def sector(r0: float, r1: float, a0: float, a1: float, z0: float, z1: float, steps: int = 24) -> bmesh.types.BMesh:
    """An annular sector (part of a thick ring) around the z axis, between angles a0 and a1."""
    bm = bmesh.new()
    outline = [(r1 * math.cos(a), r1 * math.sin(a)) for a in (a0 + (a1 - a0) * i / steps for i in range(steps + 1))]
    outline += [(r0 * math.cos(a), r0 * math.sin(a)) for a in (a1 - (a1 - a0) * i / steps for i in range(steps + 1))]
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


def polar_array(make, count: int, start: float = 0.0) -> bmesh.types.BMesh:
    """`count` copies of make() spun evenly around the z axis (one mesh)."""
    out = bmesh.new()
    for i in range(count):
        piece = make()
        transform(piece, Matrix.Rotation(start + TAU * i / count, 4, "Z"))
        merge_into(out, piece)
    return out


def merge_into(target: bmesh.types.BMesh, piece: bmesh.types.BMesh) -> bmesh.types.BMesh:
    mesh = bpy.data.meshes.new("tmp")
    piece.to_mesh(mesh)
    piece.free()
    target.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)
    return target


def tube_path(points: list[Vector], r: float, resolution: int = 6, profile: str = "round", size=(0.0, 0.0)) -> bpy.types.Object:
    """A smooth tube, a rectangular bar ("rect") or an I-section ("I") along a polyline; returned as a mesh."""
    curve = bpy.data.curves.new("path", "CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for p, v in zip(spline.points, points):
        p.co = (v.x, v.y, v.z, 1)
    curve.use_fill_caps = True
    if profile == "round":
        curve.bevel_depth = r
        curve.bevel_resolution = resolution
    else:
        prof = bpy.data.curves.new("profile", "CURVE")
        sp = prof.splines.new("POLY")
        w, h = size
        if profile == "I":  # forged I-section: two flanges joined by a thinner web
            t, web = h * 0.3, w * 0.34
            corners = [(-w, -h), (w, -h), (w, -h + 2 * t), (web, -h + 2 * t), (web, h - 2 * t), (w, h - 2 * t),
                       (w, h), (-w, h), (-w, h - 2 * t), (-web, h - 2 * t), (-web, -h + 2 * t), (-w, -h + 2 * t)]
        else:
            corners = [(-w, -h), (w, -h), (w, h), (-w, h)]
        sp.points.add(len(corners) - 1)
        for p, (x, y) in zip(sp.points, corners):
            p.co = (x / 2, y / 2, 0, 1)
        sp.use_cyclic_u = True
        pobj = bpy.data.objects.new("profile", prof)
        bpy.context.scene.collection.objects.link(pobj)
        curve.bevel_mode = "OBJECT"
        curve.bevel_object = pobj
    obj = bpy.data.objects.new("path", curve)
    bpy.context.scene.collection.objects.link(obj)
    return to_mesh(obj)


def helix(radius: float, wire: float, y0: float, y1: float, coils: float, dead: float = 0.85, steps_per_turn: int = 48) -> bpy.types.Object:
    """Coil spring along +y: `dead` closed turns at each end, open pitch between."""
    pts = []
    total = int(coils * steps_per_turn)
    closed_h = 2 * wire * dead
    open_len = (y1 - y0) - 2 * closed_h - 2 * wire
    for i in range(total + 1):
        t = i / total * coils
        if t < dead:
            y = y0 + wire + t / dead * closed_h
        elif t > coils - dead:
            y = y1 - wire - (coils - t) / dead * closed_h
        else:
            y = y0 + wire + closed_h + (t - dead) / (coils - 2 * dead) * open_len
        a = TAU * t
        pts.append(Vector((radius * math.cos(a), y, radius * math.sin(a))))
    return tube_path(pts, wire, resolution=4)


# ---- objects and modifiers ----------------------------------------------------------------------------

def to_mesh(obj: bpy.types.Object) -> bpy.types.Object:
    """Replace an object (curve, or mesh with modifiers) by a plain mesh with everything applied."""
    deps = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
    new = bpy.data.objects.new(obj.name, mesh)
    bpy.context.scene.collection.objects.link(new)
    new.matrix_world = obj.matrix_world.copy()
    data, kind = obj.data, obj.type
    bpy.data.objects.remove(obj)
    if kind in ("CURVE", "FONT"):
        bevel = data.bevel_object if kind == "CURVE" else None
        bpy.data.curves.remove(data)
        if bevel is not None:
            prof = bevel.data
            bpy.data.objects.remove(bevel)
            bpy.data.curves.remove(prof)
    elif data.users == 0:
        bpy.data.meshes.remove(data)
    return new


def bevel(obj, width: float, segments: int = 3, angle: float = 30.0) -> bpy.types.Object:
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.profile = 0.6
    m.miter_outer = "MITER_ARC"
    m.harden_normals = False
    return to_mesh(obj)


def cut(obj, *cutters, union: bool = False) -> bpy.types.Object:
    """Boolean difference (or union) with cutter objects, which are then deleted."""
    for c in cutters:
        m = obj.modifiers.new("bool", "BOOLEAN")
        m.operation = "UNION" if union else "DIFFERENCE"
        m.object = c
        m.solver = "EXACT"
        obj = to_mesh(obj)
        bpy.data.objects.remove(c)
    return obj


def cast_finish(obj, voxel: float, smooth: int = 6, keep: float = 0.35) -> bpy.types.Object:
    """Voxel remesh + smoothing + decimation: turns a union of simple solids into a cast-looking body."""
    m = obj.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    s = obj.modifiers.new("smooth", "CORRECTIVE_SMOOTH")
    s.iterations = smooth
    s.smooth_type = "LENGTH_WEIGHTED"
    s.use_only_smooth = True
    d = obj.modifiers.new("decimate", "DECIMATE")
    d.ratio = keep
    return to_mesh(obj)


def shade(obj, sharp_deg: float = 32.0) -> bpy.types.Object:
    """Smooth shading with crisp edges above `sharp_deg`, and face-area weighted normals so flat faces stay flat."""
    mesh = obj.data
    for p in mesh.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for e in bm.edges:
        e.smooth = not (e.is_boundary or (len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp_deg)))
    bm.to_mesh(mesh)
    bm.free()
    w = obj.modifiers.new("weighted", "WEIGHTED_NORMAL")
    w.keep_sharp = True
    w.mode = "FACE_AREA"
    return to_mesh(obj)


def join(name: str, objs: list[bpy.types.Object]) -> bpy.types.Object:
    objs = [o for o in objs if o is not None]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    obj = objs[0]
    obj.name = name
    obj.data.name = name
    return obj


def assign_by_normal(obj, mat: str, direction: Vector | None = None, min_dot: float = 0.9, region=None, only: str | None = None) -> None:
    """Give faces facing `direction` (any direction if None), inside `region(center)` if given, and
    currently using material `only` if given, a different material."""
    mesh = obj.data
    names = [m.name for m in mesh.materials]
    if mat not in names:
        mesh.materials.append(material(mat))
        names.append(mat)
    idx = names.index(mat)
    keep = names.index(only) if only in names else None
    d = direction.normalized() if direction is not None else None
    for p in mesh.polygons:
        if d is not None and p.normal.dot(d) < min_dot:
            continue
        if region is not None and not region(p.center):
            continue
        if only is not None and p.material_index != keep:
            continue
        p.material_index = idx


def fresh_uv(mesh) -> bpy.types.MeshUVLoopLayer:
    """A single, new UV layer (joined pieces such as text can bring their own empty one, which would win)."""
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    return mesh.uv_layers.new(name="UVMap")


def radial_uv(obj, centre: Vector, span: float = 0.9) -> None:
    """Planar UVs across the wheel plane, centred on the axle: lets the app draw concentric
    machining marks and circular brushing on discs, hubs and wheel faces."""
    mesh = obj.data
    uv = fresh_uv(mesh)
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - centre.x) / span + 0.5, (co.y - centre.y) / span + 0.5)


def box_uv(obj, scale: float = 4.0) -> None:
    """Simple box-projected UVs (1 unit = 1/scale metre), for tiling surface textures."""
    mesh = obj.data
    uv = fresh_uv(mesh)
    for p in mesh.polygons:
        n = p.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        u, v = [(1, 2), (0, 2), (0, 1)][ax]
        for li in p.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv = (co[u] * scale, co[v] * scale)


def finish(obj, name: str) -> bpy.types.Object:
    """Name the node (its visual key) and move its origin to its bounding-box centre.
    Shared meshes (repeated parts) are already centred and placed by their object location."""
    obj.name = name
    mesh = obj.data
    if mesh.users > 1:
        return obj
    mesh.name = name
    lo = Vector((min(v.co[k] for v in mesh.vertices) for k in range(3)))
    hi = Vector((max(v.co[k] for v in mesh.vertices) for k in range(3)))
    c = (lo + hi) / 2
    mesh.transform(Matrix.Translation(-c))
    obj.location = c
    return obj


def export_glb(path: str) -> None:
    """Export as-is: the scene is already in the app's y-up coordinates, so no axis conversion."""
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=False,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="NONE",
    )
