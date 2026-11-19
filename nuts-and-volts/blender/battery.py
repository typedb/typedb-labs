"""High-voltage battery pack and power electronics, modelled for close inspection (C3b).

Build with scripts/build-assets.sh. Writes two models, each with its visual mapping (node key -> component id):
  hv-battery          the pack: enclosure, side rails, crossmembers, protection plate, cooling plate and
                      manifold, 16 modules of 14 prismatic cells, module busbars, 8 module monitors and their
                      chain, the front bay (junction box with contactors, pre-charge, fuse, current sensor;
                      BMS), the mid-string service disconnect, the internal rear HV feed, the vent valve, lid
  power-electronics   front PDU, DC-DC converter, 12 V battery, 12 V fuse box, on-board charger, charge port

Positions are the real assembled positions in the app's coordinates (x forward, y up, z to the right). The
pack sits between the protection plate at y=0.19 (ground clearance) and the cabin floor at y=0.38.
Sources and simplifications: docs/engineering-references.md.
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
from kit import TAU, box, cylinder, lathe, merge_into, new_object, rod, transform  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# ---- pack layout ------------------------------------------------------------------------------------------
X0, X1, BAY = -1.02, 0.98, 1.20  # rear wall, front wall of the module area, front of the front bay
BAY_Z = 0.50  # the bay is narrower than the pack (clear of the front wheels)
HALF_Z = 0.69  # outer face of the side rails
Y_SHIELD, Y_FLOOR, Y_PLATE, Y_MODULE, Y_LID = 0.19, 0.20, 0.207, 0.218, 0.356
ROWS = [-0.88 + 0.24 * i for i in range(8)]  # module centres along x
COLUMN_Z = 0.33  # module centres at z = -0.33 (left, odd ids) and +0.33 (right, even ids)
CROSS_X = [-0.76, -0.04, 0.68]  # crossmembers sit in gaps between rows
MOD = dict(x=0.20, z=0.56, cells=14, cell_t=0.036, cell_w=0.18, cell_h=0.10)


def bx(size, centre, mat, bevel=0.0015, name="box"):
    o = new_object(name, transform(box(*size), Matrix.Translation(centre)), mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    return kit.shade(o, 35)


def obj(name, bm, mat, bevel=0.0, sharp=35.0):
    o = new_object(name, bm, mat)
    if bevel:
        o = kit.bevel(o, bevel, 2)
    return kit.shade(o, sharp)


def uv(o):
    kit.box_uv(o, 6.0)
    return o


def prism(outline, y0, y1):
    """A closed polygon in the (x, z) plane extruded from y0 to y1."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y0, z)) for x, z in outline]
    hi = [bm.verts.new((x, y1, z)) for x, z in outline]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    n = len(outline)
    for i in range(n):
        k = (i + 1) % n
        bm.faces.new((lo[i], hi[i], hi[k], lo[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def outline(margin=0.0):
    """Plan outline of the pack: the module area plus the narrower front bay."""
    hz, bz = HALF_Z - margin, BAY_Z - margin
    return [(X0 + margin, -hz), (X0 + margin, hz), (X1, hz), (X1, bz), (BAY - margin, bz), (BAY - margin, -bz), (X1, -bz), (X1, -hz)]


def along_x(bm):
    """Turn something built along z to run along x."""
    return transform(bm, Matrix.Rotation(math.pi / 2, 4, "Y"))


# ---- structure --------------------------------------------------------------------------------------------

def enclosure():
    """Cast-and-extruded aluminium tray: floor and walls (the side rails are separate extrusions), with
    lifting and mounting bosses and the coolant ports in the bay's front wall."""
    outer = new_object("tray", prism(outline(0.04), Y_FLOOR, 0.35), "aluminium-cast")
    pocket = new_object("tray-pocket", prism(outline(0.048), Y_FLOOR + 0.006, 0.4), "aluminium-cast")
    tray = kit.shade(kit.cut(outer, pocket), 35)
    flange = bmesh.new()
    merge_into(flange, prism(outline(0.03), 0.346, 0.352))
    hole = new_object("flange-hole", prism(outline(0.05), 0.34, 0.36), "aluminium-cast")
    fl = kit.shade(kit.cut(new_object("flange", flange, "aluminium-cast"), hole), 35)
    extra = bmesh.new()
    for z in (-0.07, -0.02):  # coolant inlet and outlet through the bay's front wall
        merge_into(extra, rod(Vector((BAY - 0.045, 0.26, z)), Vector((BAY + 0.012, 0.26, z)), 0.011, 20))
        merge_into(extra, rod(Vector((BAY + 0.004, 0.26, z)), Vector((BAY + 0.012, 0.26, z)), 0.014, 20))
    o = kit.join("battery-enclosure", [tray, fl, obj("ports", extra, "aluminium-machined")])
    return uv(o)


def side_rail(side: int):
    """Extruded side rail with three hollow chambers (the crash structure in a side impact) and the bracket
    tabs that bolt the pack to the sill."""
    z_in, z_out = side * (HALF_Z - 0.045), side * HALF_Z
    zc, w = (z_in + z_out) / 2, abs(z_out - z_in)
    pieces = bmesh.new()
    length = 1.955  # ends clear of the rear wheel arches
    xc = -0.0075
    for y, h in ((Y_FLOOR + 0.004, 0.008), (0.25, 0.006), (0.30, 0.006), (0.336, 0.008)):  # flanges and webs
        merge_into(pieces, transform(box(length, h, w), Matrix.Translation((xc, y, zc))))
    for z in (z_in + side * 0.0025, zc, z_out - side * 0.0025):  # walls
        merge_into(pieces, transform(box(length, 0.136, 0.005), Matrix.Translation((xc, 0.272, z))))
    for x in (-0.86, -0.4, 0.06, 0.52):  # sill-mounting tabs
        merge_into(pieces, transform(box(0.06, 0.008, 0.03), Matrix.Translation((x, 0.33, z_out + side * 0.012))))
    return uv(obj(f"side-rail-{'l' if side < 0 else 'r'}", pieces, "aluminium-forged"))


def crossmember(x: float):
    """Hat-section crossmember between module rows, bolted to the floor and the rails."""
    bm = transform(box(0.03, 0.006, 2 * (HALF_Z - 0.05)), Matrix.Translation((x, Y_FLOOR + 0.009, 0)))
    for dx in (-0.012, 0.012):
        merge_into(bm, transform(box(0.004, 0.09, 2 * (HALF_Z - 0.05)), Matrix.Translation((x + dx, Y_FLOOR + 0.054, 0))))
    merge_into(bm, transform(box(0.028, 0.005, 2 * (HALF_Z - 0.05)), Matrix.Translation((x, Y_FLOOR + 0.098, 0))))
    return uv(obj("crossmember", bm, "aluminium-forged", 0.0008))


def shield():
    """Underbody protection plate: stamped with stiffening ribs, bolted round its edge."""
    bm = prism(outline(0.03), Y_SHIELD, Y_SHIELD + 0.005)
    for x in [X0 + 0.15 + 0.25 * i for i in range(9)]:
        merge_into(bm, transform(box(0.02, 0.003, 1.1), Matrix.Translation((x, Y_SHIELD - 0.0015, 0))))
    o = obj("shield", bm, "steel-dark", 0.0)
    pts = [(x, s * (HALF_Z - 0.045)) for x in [X0 + 0.06 + 0.2 * i for i in range(10)] for s in (-1, 1)]
    bolts = bmesh.new()
    for x, z in pts:
        merge_into(bolts, transform(cylinder(0.007, 0.005, 6), Matrix.Translation((x, Y_SHIELD - 0.0025, z)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    return uv(kit.join("battery-underbody-shield", [o, obj("shield-bolts", bolts, "steel-zinc")]))


def lid():
    """Composite lid with a stiffening pattern and bolted flange; a hatch over the service disconnect."""
    bm = prism(outline(0.03), Y_LID, Y_LID + 0.004)
    for x in ROWS:
        merge_into(bm, transform(box(0.16, 0.003, 0.48), Matrix.Translation((x, Y_LID + 0.0055, -COLUMN_Z))))
        merge_into(bm, transform(box(0.16, 0.003, 0.48), Matrix.Translation((x, Y_LID + 0.0055, COLUMN_Z))))
    o = obj("lid", bm, "plastic-black", 0.0)
    hatch = bx((0.09, 0.004, 0.14), (X0 + 0.07, Y_LID + 0.006, 0), "aluminium-cast", 0.001, "hatch")
    return uv(kit.join("battery-lid", [o, hatch]))


# ---- cooling -----------------------------------------------------------------------------------------------

def cooling_plate():
    """One brazed aluminium plate under all modules, with the coolant channels pressed into its underside."""
    bm = transform(box(X1 - X0 - 0.1, 0.006, 2 * (HALF_Z - 0.07)), Matrix.Translation(((X0 + X1) / 2, Y_PLATE + 0.004, 0)))
    for x in ROWS:  # serpentine channels, one loop per module row
        for dz in (-0.5, -0.4, -0.3, -0.2, -0.1, 0.1, 0.2, 0.3, 0.4, 0.5):
            merge_into(bm, transform(box(0.17, 0.003, 0.016), Matrix.Translation((x, Y_PLATE, dz))))
    pad = transform(box(X1 - X0 - 0.12, 0.002, 2 * (HALF_Z - 0.09)), Matrix.Translation(((X0 + X1) / 2, Y_PLATE + 0.008, 0)))
    o = kit.join("battery-cooling-plate", [obj("plate", bm, "aluminium-machined"), obj("pad", pad, "module-grey")])
    return uv(o)


def manifold():
    """Coolant supply and return rails along the centre of the pack, from the bay's ports to every row."""
    bm = bmesh.new()
    for z, port in ((-0.04, -0.07), (-0.018, -0.02)):  # supply and return
        merge_into(bm, rod(Vector((X0 + 0.06, 0.226, z)), Vector((X1 - 0.02, 0.226, z)), 0.0095, 20))
        merge_into(bm, rod(Vector((X1 - 0.02, 0.226, z)), Vector((BAY - 0.05, 0.26, port)), 0.0095, 20))
    for x in ROWS:  # a feed into the plate's channels for every row
        merge_into(bm, rod(Vector((x, 0.224, -0.04)), Vector((x, 0.214, -0.04)), 0.006, 12))
    return uv(obj("battery-coolant-manifold", bm, "aluminium-machined"))


# ---- modules ------------------------------------------------------------------------------------------------

def module_mesh():
    """One module, at the origin: 14 prismatic cells stacked along z between end plates, steel straps,
    cell terminals with laser-welded busbars, and the module's sense harness. Shared by all 16 modules."""
    n, t, w, h = MOD["cells"], MOD["cell_t"], MOD["cell_w"], MOD["cell_h"]
    z0 = -n * t / 2
    y0 = 0.004
    cells = bmesh.new()
    for i in range(n):
        merge_into(cells, transform(box(w, h, t - 0.0016), Matrix.Translation((0, y0 + h / 2, z0 + t * (i + 0.5)))))
    cells_o = obj("cells", cells, "battery-cell", 0.0012, 30)
    vents = bmesh.new()
    terms = bmesh.new()
    bars = bmesh.new()
    for i in range(n):
        z = z0 + t * (i + 0.5)
        merge_into(vents, transform(box(0.024, 0.0012, 0.012), Matrix.Translation((0, y0 + h + 0.0006, z))))
        for s in (-1, 1):
            merge_into(terms, transform(box(0.026, 0.004, 0.018), Matrix.Translation((s * 0.062, y0 + h + 0.002, z))))
        if i < n - 1:  # series links: alternate sides
            s = -1 if i % 2 == 0 else 1
            merge_into(bars, transform(box(0.03, 0.0025, t + 0.016), Matrix.Translation((s * 0.062, y0 + h + 0.0052, z + t / 2))))
    for zc in (z0 - 0.002, -z0 + 0.002):  # module terminals at the ends
        s = -1 if zc < 0 else 1
        merge_into(bars, transform(box(0.03, 0.0025, 0.03), Matrix.Translation((s * 0.062, y0 + h + 0.0052, zc))))
    ends = bmesh.new()
    for zc in (z0 - 0.007, -z0 + 0.007):
        merge_into(ends, transform(box(w + 0.01, h + 0.006, 0.012), Matrix.Translation((0, y0 + h / 2, zc))))
        for s in (-1, 1):
            merge_into(ends, transform(cylinder(0.006, 0.02, 12), Matrix.Translation((s * 0.085, y0 + 0.01, zc))))
    straps = bmesh.new()
    for s in (-1, 1):
        for y in (y0 + 0.02, y0 + h - 0.02):
            merge_into(straps, transform(box(0.002, 0.018, -2 * z0 + 0.026), Matrix.Translation((s * (w / 2 + 0.001), y, 0))))
    base = transform(box(w + 0.01, 0.004, -2 * z0 + 0.026), Matrix.Translation((0, 0.002, 0)))
    sense = bmesh.new()
    merge_into(sense, transform(box(0.008, 0.002, -2 * z0 - 0.02), Matrix.Translation((0, y0 + h + 0.0052, 0))))
    o = kit.join("module", [cells_o, obj("vents", vents, "aluminium-machined"), obj("terms", terms, "aluminium-machined"),
                            obj("bars", bars, "copper"), obj("ends", ends, "aluminium-cast", 0.0008), obj("straps", straps, "steel-zinc"),
                            obj("base", base, "module-grey"), obj("sense", sense, "plastic-black")])
    uv(o)
    return o


def modules():
    """16 modules sharing one mesh, matching the manifest: row i (rear to front) holds module 2i+1 on the left
    and 2i+2 on the right."""
    src = module_mesh()
    out = {}
    for i, x in enumerate(ROWS):
        for j, z in enumerate((-COLUMN_Z, COLUMN_Z)):
            n = i * 2 + j + 1
            o = bpy.data.objects.new(f"battery-module-{n}", src.data)
            bpy.context.scene.collection.objects.link(o)
            o.location = (x, Y_MODULE, z)
            out[f"battery-module-{n}"] = o
    bpy.data.objects.remove(src)
    return out


def string_busbars(side: int):
    """Module-to-module links along one column, plus the column's lead: the left column's front module to the
    junction box (+) and its rear module to the service disconnect; the right column the other way (-)."""
    z = side * COLUMN_Z
    top = Y_MODULE + 0.004 + MOD["cell_h"] + 0.0075
    zl, zr = z - side * 0.255, z + side * 0.255  # module end terminals (inner and outer ends of the column)
    bm = bmesh.new()
    for a, b in zip(ROWS, ROWS[1:]):  # rows alternate which end their terminal is on
        ze = zl if ROWS.index(a) % 2 == 0 else zr
        merge_into(bm, transform(box(b - a, 0.003, 0.028), Matrix.Translation(((a + b) / 2, top, ze))))
        merge_into(bm, transform(box(0.02, 0.012, 0.03), Matrix.Translation((a + 0.12, top - 0.006, ze))))
    # leads: the front module to its main contactor in the junction box, the rear module to the service disconnect
    merge_into(bm, rod(Vector((ROWS[-1] + 0.06, top, zr)), Vector((X1 + 0.03, 0.30, -0.40 if side < 0 else -0.22)), 0.008, 12))
    merge_into(bm, rod(Vector((ROWS[0] - 0.06, top, zl)), Vector((X0 + 0.085, 0.33, side * 0.035)), 0.008, 12))
    return uv(obj(f"busbar-{'l' if side < 0 else 'r'}", bm, "copper", 0.0004))


def monitor(n: int):
    """Module monitor for the row's two modules: a board on a bracket over the centre channel, reading cell
    voltages and temperatures, with a sense lead to each module."""
    x = ROWS[n - 1]
    y = 0.322
    board = bx((0.13, 0.0016, 0.07), (x, y, 0), "pcb", 0.0005, "mon-pcb")
    chips = bmesh.new()
    for dx, dz, sx, sz in ((0, 0, 0.02, 0.02), (0.04, 0.015, 0.012, 0.01), (-0.04, -0.015, 0.012, 0.01), (-0.045, 0.02, 0.014, 0.014)):
        merge_into(chips, transform(box(sx, 0.003, sz), Matrix.Translation((x + dx, y + 0.0023, dz))))
    bracket = bmesh.new()
    for s in (-1, 1):  # legs down to the modules' end plates
        merge_into(bracket, transform(box(0.012, 0.09, 0.004), Matrix.Translation((x + s * 0.055, y - 0.046, s * 0.055))))
        merge_into(bracket, transform(box(0.012, 0.003, 0.03), Matrix.Translation((x + s * 0.055, y - 0.0015, s * 0.04))))
    leads = bmesh.new()
    for s in (-1, 1):
        merge_into(leads, rod(Vector((x - 0.05, y + 0.001, s * 0.035)), Vector((x - 0.07, 0.33, s * 0.06)), 0.0025, 8))
    o = kit.join(f"monitor-{n}", [board, obj("mon-chips", chips, "plastic-black"), obj("mon-bracket", bracket, "aluminium-cast"),
                                   obj("mon-leads", leads, "plastic-black")])
    return uv(o)


def monitor_chain():
    """Daisy-chain ribbon linking the monitors to the BMS in the front bay."""
    bm = bmesh.new()
    pts = [Vector((x, 0.326, -0.03)) for x in ROWS] + [Vector((X1 + 0.0, 0.32, -0.03)), Vector((1.0, 0.27, 0.17))]
    for a, b in zip(pts, pts[1:]):
        merge_into(bm, rod(a, b, 0.003, 8))
    for p in pts[:-2]:
        merge_into(bm, transform(box(0.014, 0.006, 0.01), Matrix.Translation((p.x + 0.04, 0.326, -0.03))))
    return uv(obj("battery-monitor-chain", bm, "plastic-black"))


# ---- front bay, service disconnect, rear feed, vent ----------------------------------------------------------

JB = dict(x0=0.99, x1=1.14, z0=-0.44, z1=-0.15, y0=0.212, y1=0.335)


def junction_box():
    """The junction box's housing: a cast tray with a bolted cover, HV outlets on its front face (front
    inverter, auxiliary harness, DC charging) and the low-voltage connector."""
    j = JB
    cx, cz = (j["x0"] + j["x1"]) / 2, (j["z0"] + j["z1"]) / 2
    sx, sz = j["x1"] - j["x0"], j["z1"] - j["z0"]
    outer = new_object("jb", transform(box(sx, j["y1"] - j["y0"], sz), Matrix.Translation((cx, (j["y0"] + j["y1"]) / 2, cz))), "aluminium-cast")
    pocket = new_object("jb-pocket", transform(box(sx - 0.012, j["y1"] - j["y0"], sz - 0.012), Matrix.Translation((cx, (j["y0"] + j["y1"]) / 2 + 0.006, cz))), "aluminium-cast")
    tray = kit.shade(kit.bevel(kit.cut(outer, pocket), 0.0015, 2), 35)
    cover = bx((sx + 0.004, 0.006, sz + 0.004), (cx, j["y1"] + 0.003, cz), "aluminium-cast", 0.0015, "jb-cover")
    outlets = bmesh.new()
    for z in (-0.40, -0.30):  # front inverter, auxiliary harness to the PDU
        merge_into(outlets, rod(Vector((j["x1"], 0.29, z)), Vector((j["x1"] + 0.035, 0.29, z)), 0.016, 24))
    out_o = obj("jb-outlets", outlets, "hv-orange", 0.0)
    lv = bx((0.03, 0.02, 0.03), (j["x1"] + 0.012, 0.25, -0.2), "plastic-black", 0.001, "jb-lv")
    return uv(kit.join("hv-junction-box", [tray, cover, out_o, lv]))


def contactor(name: str, z: float):
    """Sealed main contactor: a cylindrical body with two heavy terminals on top and a coil connector."""
    x = 1.045
    body = obj("ct-body", transform(cylinder(0.026, 0.06, 32), Matrix.Translation((x, 0.25, z)) @ Matrix.Rotation(math.pi / 2, 4, "X")), "plastic-black", 0.001)
    base = bx((0.07, 0.006, 0.06), (x, 0.221, z), "steel-zinc", 0.0008, "ct-base")
    terms = bmesh.new()
    for dz in (-0.013, 0.013):
        merge_into(terms, transform(cylinder(0.006, 0.016, 12), Matrix.Translation((x, 0.288, z + dz)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    coil = bx((0.012, 0.01, 0.014), (x - 0.03, 0.27, z), "plastic-black", 0.0005, "ct-coil")
    return uv(kit.join(name, [body, base, obj("ct-terms", terms, "copper"), coil]))


def precharge():
    """Pre-charge relay and its finned power resistor."""
    x, z = 1.105, -0.40
    relay = bx((0.03, 0.03, 0.024), (x, 0.235, z), "plastic-black", 0.001, "pc-relay")
    res = bmesh.new()
    merge_into(res, transform(box(0.05, 0.016, 0.03), Matrix.Translation((x, 0.228, z + 0.04))))
    for k in range(6):
        merge_into(res, transform(box(0.05, 0.012, 0.002), Matrix.Translation((x, 0.24, z + 0.027 + k * 0.005))))
    return uv(kit.join("precharge-circuit", [relay, obj("pc-res", res, "aluminium-machined")]))


def pack_fuse():
    """The pack's main fuse: a ceramic body with bolted copper end blades."""
    x, z = 1.105, -0.26
    body = obj("fuse-body", transform(cylinder(0.013, 0.07, 24), Matrix.Translation((x, 0.245, z))), "module-grey", 0.001)
    blades = bmesh.new()
    for s in (-1, 1):
        merge_into(blades, transform(box(0.026, 0.004, 0.03), Matrix.Translation((x, 0.245, z + s * 0.048))))
    return uv(kit.join("pack-fuse", [body, obj("fuse-blades", blades, "copper")]))


def pack_current_sensor():
    """Pack current sensor: a shunt on the negative busbar with its measurement electronics."""
    x, z = 1.105, -0.18
    bar = bx((0.016, 0.004, 0.05), (x, 0.24, z), "copper", 0.0004, "cs-bar")
    box_ = bx((0.03, 0.016, 0.03), (x, 0.252, z), "plastic-black", 0.001, "cs-box")
    return uv(kit.join("pack-current-sensor", [bar, box_]))


def bms_master():
    """BMS master controller in the bay: finned housing, two connectors (vehicle network, monitor chain)."""
    c = (1.065, 0.26, 0.28)
    body = bmesh.new()
    merge_into(body, transform(box(0.15, 0.05, 0.24), Matrix.Translation(c)))
    for k in range(7):
        merge_into(body, transform(box(0.15, 0.006, 0.006), Matrix.Translation((c[0], c[1] + 0.028, c[2] - 0.1 + k * 0.033))))
    plugs = bmesh.new()
    for z in (0.20, 0.25):
        merge_into(plugs, transform(box(0.025, 0.022, 0.03), Matrix.Translation((c[0] - 0.085, c[1], z))))
    return uv(kit.join("bms", [obj("bms-body", body, "aluminium-cast", 0.001), obj("bms-plugs", plugs, "plastic-black", 0.0008)]))


def service_disconnect():
    """Manual service disconnect at the middle of the string (rear of the pack, reachable through the floor):
    a fused plug in a socket, with an orange handle."""
    x = X0 + 0.09
    socket = bx((0.07, 0.05, 0.1), (x, 0.31, 0), "plastic-black", 0.002, "msd-socket")
    plug = bx((0.05, 0.028, 0.08), (x, 0.345, 0), "hv-orange", 0.003, "msd-plug")
    handle = obj("msd-handle", rod(Vector((x, 0.36, -0.03)), Vector((x, 0.36, 0.03)), 0.006, 16), "hv-orange")
    return uv(kit.join("service-disconnect", [socket, plug, handle]))


def rear_feed():
    """HV cable pair from the junction box along the centre channel to the pack's rear outlets: one for the rear
    inverter's cable, one for the DC charging cable (charging current runs forwards along the same feed)."""
    bm = bmesh.new()
    for dz in (0.0, 0.025):
        z = 0.02 + dz
        pts = [Vector((1.0, 0.30, -0.17 + dz)), Vector((X1 - 0.02, 0.338, z)), Vector((X0 + 0.16, 0.338, z)), Vector((X0 + 0.06, 0.30, 0.10 + dz))]
        for a, b in zip(pts, pts[1:]):
            merge_into(bm, rod(a, b, 0.009, 16))
    cable = obj("feed-cable", bm, "hv-orange")
    outlet = bmesh.new()  # rear outlets: the rear inverter's cable (right) and the DC charging cable (left)
    for z in (0.113, -0.10):
        merge_into(outlet, rod(Vector((X0 + 0.07, 0.30, z)), Vector((X0 + 0.0, 0.30, z)), 0.022, 24))
    for dz in (0.0, 0.025):  # the charging conductors join the feed inside the pack
        merge_into(outlet, rod(Vector((X0 + 0.06, 0.30, -0.10 + dz)), Vector((X0 + 0.16, 0.338, 0.02 + dz)), 0.008, 16))
    outlet = obj("feed-outlet", outlet, "hv-orange")
    return uv(kit.join("battery-rear-feed", [cable, outlet]))


def vent():
    """Pressure-relief and degassing valve in the rear wall: lets gases out in a cell fault, keeps water out."""
    c = Vector((X0 + 0.045, 0.28, 0.42))
    body = obj("vent-body", rod(c, c - Vector((0.03, 0, 0)), 0.022, 32), "plastic-black", 0.001)
    cap = obj("vent-cap", rod(c - Vector((0.028, 0, 0)), c - Vector((0.036, 0, 0)), 0.026, 32), "module-grey", 0.001)
    return uv(kit.join("battery-vent", [body, cap]))


# ---- power electronics and charging (front compartment, rear quarter) ------------------------------------------

def finned_unit(name, size, centre, fins_axis="x", fins=8, connectors=()):
    sx, sy, sz = size
    bm = transform(box(sx, sy, sz), Matrix.Translation(centre))
    for k in range(fins):
        t = -0.4 + 0.8 * k / max(1, fins - 1)
        if fins_axis == "x":
            merge_into(bm, transform(box(sx * 0.9, 0.012, 0.004), Matrix.Translation((centre[0], centre[1] + sy / 2 + 0.006, centre[2] + t * sz))))
        else:
            merge_into(bm, transform(box(0.004, 0.012, sz * 0.9), Matrix.Translation((centre[0] + t * sx, centre[1] + sy / 2 + 0.006, centre[2]))))
    parts = [obj(name + "-body", bm, "aluminium-cast", 0.0012)]
    for c, mat, s in connectors:
        parts.append(bx(s, c, mat, 0.002, name + "-conn"))
    return uv(kit.join(name, parts))


def lv_battery():
    c = (1.95, 0.66, -0.34)  # inboard of the left front rail and the front-left upper arm's pivot
    case = bx((0.24, 0.17, 0.17), c, "plastic-black", 0.006, "lvb-case")
    lid_ = bx((0.244, 0.012, 0.174), (c[0], c[1] + 0.09, c[2]), "plastic-black", 0.004, "lvb-lid")
    posts = bmesh.new()
    for dz in (-0.05, 0.05):
        merge_into(posts, transform(cylinder(0.009, 0.02, 16), Matrix.Translation((c[0] + 0.07, c[1] + 0.105, c[2] + dz)) @ Matrix.Rotation(math.pi / 2, 4, "X")))
    return uv(kit.join("lv-battery", [case, lid_, obj("lvb-posts", posts, "steel-zinc")]))


def charge_port():
    """Combined AC and DC charging inlet (AC pins above two DC pins in one face) on a mounting frame behind the
    left rear quarter's charging door. The face looks outwards (-z)."""
    c = Vector((-1.98, 0.86, -0.9))
    frame = bx((0.12, 0.16, 0.012), (c.x, c.y, c.z + 0.02), "plastic-black", 0.002, "cp-frame")
    face = bmesh.new()
    merge_into(face, transform(cylinder(0.042, 0.03, 40), Matrix.Translation((c.x, c.y + 0.02, c.z))))
    merge_into(face, transform(box(0.06, 0.05, 0.03), Matrix.Translation((c.x, c.y - 0.045, c.z))))
    sockets = bmesh.new()
    for dx, dy in ((-0.02, 0.015), (0.02, 0.015), (0.0, -0.015), (-0.025, -0.01), (0.025, -0.01), (0.0, 0.03)):
        merge_into(sockets, transform(cylinder(0.006, 0.006, 12), Matrix.Translation((c.x + dx, c.y + 0.02 + dy, c.z - 0.016))))
    for dx in (-0.017, 0.017):
        merge_into(sockets, transform(cylinder(0.009, 0.006, 16), Matrix.Translation((c.x + dx, c.y - 0.045, c.z - 0.016))))
    rear = obj("cp-rear", transform(cylinder(0.03, 0.05, 24), Matrix.Translation((c.x, c.y, c.z + 0.045))), "plastic-black", 0.001)
    o = kit.join("charge-port", [frame, obj("cp-face", face, "plastic-black", 0.001), obj("cp-sockets", sockets, "steel-chrome"), rear])
    return uv(o)


def build_battery():
    kit.reset()
    parts = {
        "battery-enclosure": enclosure(),
        "battery-side-rail-l": side_rail(-1),
        "battery-side-rail-r": side_rail(1),
        **{f"battery-crossmember-{i + 1}": crossmember(x) for i, x in enumerate(CROSS_X)},
        "battery-underbody-shield": shield(),
        "battery-cooling-plate": cooling_plate(),
        "battery-coolant-manifold": manifold(),
        **modules(),
        "battery-busbar-l": string_busbars(-1),
        "battery-busbar-r": string_busbars(1),
        **{f"battery-monitor-{n}": monitor(n) for n in range(1, 9)},
        "battery-monitor-chain": monitor_chain(),
        "hv-junction-box": junction_box(),
        "main-contactor-pos": contactor("main-contactor-pos", -0.40),
        "main-contactor-neg": contactor("main-contactor-neg", -0.22),
        "precharge-circuit": precharge(),
        "pack-fuse": pack_fuse(),
        "pack-current-sensor": pack_current_sensor(),
        "bms": bms_master(),
        "service-disconnect": service_disconnect(),
        "battery-rear-feed": rear_feed(),
        "battery-vent": vent(),
        "battery-lid": lid(),
    }
    export("hv-battery", parts)


def build_power():
    kit.reset()
    parts = {
        "pdu": finned_unit("pdu", (0.2, 0.11, 0.22), (1.95, 0.655, 0.315), "z", 7,  # inboard of the right front rail, clear of the
                           # front-right tyre at full bump and lock (C3c step 2b)
                           [((1.95 - 0.105, 0.66, 0.27), "hv-orange", (0.02, 0.04, 0.05)), ((1.95 - 0.105, 0.66, 0.37), "hv-orange", (0.02, 0.04, 0.05)),
                            ((1.95, 0.72, 0.39), "plastic-black", (0.04, 0.02, 0.03))]),
        "dc-dc": finned_unit("dc-dc", (0.16, 0.07, 0.22), (1.99, 0.565, 0.0), "z", 9,
                             [((1.99 - 0.085, 0.565, -0.06), "hv-orange", (0.02, 0.035, 0.04)), ((1.99 + 0.0, 0.565, -0.12), "steel-zinc", (0.03, 0.02, 0.02))]),
        "obc": finned_unit("obc", (0.3, 0.1, 0.26), (-1.9, 0.6, -0.33), "x", 8,
                           [((-1.9 + 0.155, 0.6, -0.28), "hv-orange", (0.02, 0.04, 0.05)), ((-1.9 - 0.155, 0.6, -0.4), "plastic-black", (0.02, 0.04, 0.05))]),
        "lv-battery": lv_battery(),
        "lv-fuse-box": finned_unit("lv-fuse-box", (0.14, 0.06, 0.1), (1.95, 0.70, -0.17), "x", 0,
                                   [((1.95, 0.735, -0.17), "plastic-black", (0.13, 0.012, 0.09))]),
        "charge-port": charge_port(),
    }
    export("power-electronics", parts)


def export(asset: str, parts: dict):
    keep = {o.name for o in parts.values()}
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o)
    nodes = {}
    for pid, o in parts.items():
        kit.finish(o, pid)  # the visual key is the id itself here: no left/right or axle variants to share
        nodes[o.name] = pid
    out = ROOT / "web" / "assets-src" / f"{asset}.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    kit.export_glb(str(out))
    (ROOT / "web" / "public" / "assets" / f"{asset}.map.json").write_text(json.dumps({"asset": asset, "nodes": nodes}, indent=2) + "\n")
    meshes = {}
    for pid, o in parts.items():
        meshes.setdefault(o.data.name, (pid, sum(len(p.vertices) - 2 for p in o.data.polygons)))
    tris = sum(t for _, t in meshes.values())
    print(f"{asset}: {len(parts)} parts, {tris:,} unique triangles -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    for pid, o in parts.items():
        lo = [min(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) + o.location[i] for i in range(3)]
        print(f"  {pid:28s} [{lo[0]:.3f} {lo[1]:.3f} {lo[2]:.3f}] .. [{hi[0]:.3f} {hi[1]:.3f} {hi[2]:.3f}]")


if __name__ == "__main__":
    which = sys.argv[1:] or ["battery", "power"]
    if "battery" in which:
        build_battery()
    if "power" in which:
        build_power()
