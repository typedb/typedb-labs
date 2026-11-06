"""Review the body structure against the provisional exterior (D1.2): not part of the app.

    uv run --project blender python -I blender/structure_review.py [front34 side rear34 ...]

1. Fit: builds the provisional D1.1 skin (blender/exterior.py) and reports how far any part of the body structure
   (web/assets-src/body-structure.glb, so build it first) reaches outside it. The structure is the fixed layer and
   the exterior a replaceable skin over it, so a new exterior design is checked here before it is adopted.
2. Renders: the structure inside the skin, which is drawn almost transparent, to web/shots/ghost-<view>.png.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy  # must come first
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).parent))
import exterior as ex  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
GHOST = {"paint": 0.12, "glass": 0.12, "glass-roof": 0.12, "gloss-black": 0.12, "cladding": 0.25}


def import_structure() -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / "web" / "assets-src" / "body-structure.glb"))
    return [o for o in set(bpy.data.objects) - before if o.type == "MESH"]


def fit(body: bpy.types.Object, parts: list[bpy.types.Object]) -> list[tuple[float, str, tuple]]:
    """(distance outside the skin, part, where) for every part that reaches outside it, worst first."""
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    out = []
    for o in parts:
        worst, where = 0.0, None
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            hit, n, _, d = bvh.find_nearest(p)
            if hit is not None and (p - hit).dot(n) > 0 and d > worst:
                worst, where = d, (round(p.x, 3), round(p.z, 3), round(-p.y, 3))  # back to app coordinates
        if worst > 0.001:
            out.append((worst, o.name.split(".")[0], where))
    return sorted(out, reverse=True)


def main(views: list[str]) -> None:
    body = ex.build()
    parts = import_structure()
    outside = fit(body, parts)
    print("outside the provisional skin:", ", ".join(f"{n} {d * 1000:.0f} mm at {w}" for d, n, w in outside) or "nothing")
    ecoat = ex.trial.principled("ecoat", (0.30, 0.32, 0.34), metallic=0.2, roughness=0.45, coat=0.3)
    cast = ex.trial.principled("cast", (0.55, 0.56, 0.58), metallic=0.9, roughness=0.4)
    for o in parts:
        cast_part = any("cast" in m.name or "forged" in m.name for m in o.data.materials)
        o.data.materials.clear()
        o.data.materials.append(cast if cast_part else ecoat)
    for name, alpha in GHOST.items():
        bpy.data.materials[name].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = alpha
    for o in bpy.data.objects:
        if o.name.startswith(("arch-lip", "lamp-")):
            o.hide_render = True
    for v in views:
        print("rendered", ex.render(v, "ghost", 128))


if __name__ == "__main__":
    main([a for a in sys.argv[1:] if a in ex.VIEWS])
