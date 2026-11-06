"""C3c renders of the suspension in the running app: each axle's suspension on its own (wheels and tyres hidden),
the subframes with their rubber body mounts against the rails, each axle's right-hand corner from inboard, the
steering system, the brake supply, the thermal circuits, and the underside.
    uv run --with websocket-client python -I scripts/browser/suspension.py <output-dir> [quality]
Separate headless Chrome (see cdp.py), 1600x1000 at 2x.
"""
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser

ROOT = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1])
quality = sys.argv[2] if len(sys.argv) > 2 else "high"
out.mkdir(parents=True, exist_ok=True)

def ids(model):
    return list(json.load(open(ROOT / f"web/public/assets/{model}.map.json"))["nodes"].values())

chassis = ids("chassis")
WHEELS = ("tyre-", "wheel-")  # tyres, wheels and wheel nuts
def axle(a):
    corners = [i for c in (f"{a[0]}l", f"{a[0]}r") for i in ids(f"corner-{c}") if not i.startswith(WHEELS)]
    extra = [f"{a}-halfshaft-l", f"{a}-halfshaft-r", f"{a}-rail-l", f"{a}-rail-r"] + (["steering-rack"] if a == "front" else [])
    return corners + [i for i in chassis if i.startswith(a)] + extra
body = ["front-rail-l", "front-rail-r", "rear-rail-l", "rear-rail-r", "cabin-floor"]

b = Browser(tempfile.mkdtemp() + "/profile")
b.call("Page.navigate", url=f"http://127.0.0.1:5180/?quality={quality}")
b.js(r"""for (let i=0;i<60 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500));
await new Promise(r=>setTimeout(r,1500));
[...document.querySelectorAll('button')].find(e => e.textContent.includes('Explore the vehicle')).click();
await new Promise(r=>setTimeout(r,2500));
document.querySelector('.explore .panel-close')?.click(); await new Promise(r=>setTimeout(r,1500));
return 1;""")

def view(name, focus, az, el, dist, only=None, hide=()):
    args = f"0, {json.dumps(focus)}, {az}, {el}, {dist}, {json.dumps(only) if only else 'undefined'}"
    hidden = "".join(f"__vx.scene.getObjectByName('{h}').visible = false;" for h in hide)
    b.js(f"await __focus({args}); {hidden} await __focus({args}); {hidden} window.__vx.setFrameloop('always');"
         "await new Promise(r=>setTimeout(r,1500)); return 1;")
    b.shot(str(out / f"{name}.jpg"), width=3200)
    print("shot", name)

view("suspension-front", ["front-subframe"], 55, 28, 2.4, axle("front"))
view("suspension-front-rear-view", ["front-subframe"], -110, 18, 2.2, axle("front"))
view("suspension-rear", ["rear-subframe"], -125, 28, 2.4, axle("rear"))
view("suspension-rear-front-view", ["rear-subframe"], 70, 18, 2.2, axle("rear"))
view("subframes-mounts-front", ["front-subframe"], 35, -30, 1.7, chassis + body)
view("subframes-mounts-rear", ["rear-subframe"], -145, -30, 1.7, chassis + body)
view("subframe-mount-close", ["front-subframe-mount-1"], 50, -12, 0.75, chassis + body[:4])
# whole corners from inboard, wheel and tyre shown: the front's goose-neck knuckle and upper arm above the tyre,
# the rear's upper arm inside the wheel and toe link ahead of the axle
corner = lambda c, a: ids(f"corner-{c}") + [i for i in chassis if i.startswith(a)] + [f"{a}-halfshaft-r"]
view("corner-front-inboard", ["hub-fr", "upper-arm-fr"], 215, 8, 2.3, corner("fr", "front"))
view("corner-rear-inboard", ["hub-rr"], 155, 10, 1.9, corner("rr", "rear"))
# steering: rack, mounts, motor and module, torque sensor, shaft and column, with the front suspension (no wheels)
steer = ids("steering") + ["steering-wheel", "front-subframe", "front-halfshaft-l", "front-halfshaft-r"]
steer += [i for c in ("fl", "fr") for i in ids(f"corner-{c}") if i.startswith(("tie-rod", "knuckle", "lower-arm"))]
view("steering", ["steering-rack", "steering-intermediate-shaft"], 55, 32, 2.2, steer)
view("steering-rack-close", ["steering-torque-sensor", "eps-motor"], -150, 25, 0.75, steer)
# brake supply: pedal, booster, master cylinder and reservoir, ESC module, lines to the corners (with the steering)
brakes = ids("brakes") + ids("steering") + ["steering-wheel", "front-subframe", "rear-subframe"]
brakes += [i for c in ("fl", "fr", "rl", "rr") for i in ids(f"corner-{c}") if i.startswith(("caliper", "brake-hose", "brake-disc", "epb-actuator"))]
view("brakes", ["esc-module", "master-cylinder"], 60, 30, 2.4, brakes)
view("brakes-whole", ["brake-line-rl", "brake-line-fr"], 40, 35, 4.6, brakes)
# thermal: cooling module, pump, reservoir, valve, heater, chiller, compressor, refrigerant and coolant lines, with the
# drive units and the battery's coolant line
thermal = ids("thermal") + ids("front-drive-unit") + ids("rear-drive-unit") + ["coolant-lines", "hvac-module", "battery-coolant-manifold"]
view("thermal", ["coolant-valve", "radiator"], 40, 32, 1.5, thermal)
view("thermal-whole", ["rear-coolant-lines"], 50, 30, 4.2, thermal)
view("underside", ["front-subframe", "rear-subframe"], 35, -38, 6.2, hide=("underbody",))
b.close()
