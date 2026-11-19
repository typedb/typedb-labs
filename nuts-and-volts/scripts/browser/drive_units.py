"""C3a review renders of the drive units in the running app: assembled and exploded close-ups of each unit
(only its parts shown), the gear train with the case halves hidden, and the packaging between the wheels.

    uv run --with websocket-client python -I scripts/browser/drive_units.py <output-dir> [quality]

Separate headless Chrome (see cdp.py), 1600x1000 at 2x.
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser

out = Path(sys.argv[1])
quality = sys.argv[2] if len(sys.argv) > 2 else "high"
out.mkdir(parents=True, exist_ok=True)
b = Browser(tempfile.mkdtemp() + "/profile")
b.call("Page.navigate", url=f"http://127.0.0.1:5180/?quality={quality}")
b.js(r"""for (let i=0;i<60 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500));
await new Promise(r=>setTimeout(r,1500));
[...document.querySelectorAll('button')].find(e => e.textContent.includes('Explore the vehicle')).click();
await new Promise(r=>setTimeout(r,2500));
document.querySelector('.explore .panel-close')?.click(); await new Promise(r=>setTimeout(r,1500));
const m = await import('/src/vehicle/manifest.ts');
const maps = {};
for (const k of ['front', 'rear']) maps[k] = Object.values((await (await fetch(`/assets/${k}-drive-unit.map.json`)).json()).nodes);
window.__ids = (k) => maps[k];
window.__near = (k) => m.PARTS.filter(p => p.shape.kind !== 'panel' && !/^(sill|arch-liner|underbody|door|seat|bulkhead|cabin|floor|battery)/.test(p.id)
  && Math.abs((p.position?.[0] ?? 99) - (k === 'front' ? 1.58 : -1.45)) < 0.55 && (p.position?.[1] ?? 9) < 1.0).map(p => p.id)
  .concat(['tyre-fr','wheel-fr','brake-disc-fr','caliper-fr','hub-fr','knuckle-fr','lower-arm-fr','upper-arm-fr','coilover-fr','spring-fr','top-mount-fr','tie-rod-fr','hub-nut-fr','wheel-bearing-fr','brake-shield-fr','brake-pad-inner-fr','brake-pad-outer-fr','drop-link-fr','wheel-speed-sensor-fr','brake-hose-fr']);
return 1;""")

def view(name, p, key, az, el, dist, only="__ids", focus=None, hide=()):
    hidden = "[" + ",".join(f"'{h}'" for h in hide) + "]"
    f = focus or f"__ids('{key}')"
    code = (f"const only = {only}('{key}').filter(id => !{hidden}.some(h => id.endsWith(h)));"
            f"await __focus({p}, {f}, {az}, {el}, {dist}, only); await __focus({p}, {f}, {az}, {el}, {dist}, only);"
            "window.__vx.setFrameloop('always'); await new Promise(r=>setTimeout(r,1500)); return 1;")
    b.js(code)
    b.shot(str(out / f"{name}.jpg"), width=3200)
    print("shot", name)

for key in ("front", "rear"):
    view(f"{key}-assembled", 0, key, 40, 22, 2.1)
    view(f"{key}-assembled-below", 0, key, 220, -16, 2.1)
    view(f"{key}-gear-train", 0, key, 20, 28, 1.2, hide=("-gearbox-cover", "-gearbox", "-inverter", "-inverter-lid", "-halfshaft-r",
         "-drive-unit-mount-3", "-oil-cooler", "-park-lock", "-disconnect"),
         focus=f"['{key}-reduction-gear','{key}-pinion','{key}-intermediate-gear','{key}-differential']")
    view(f"{key}-exploded", 1, key, 62, 16, 7.0)
    view(f"{key}-packaging", 0, key, 150 if key == "front" else 30, 38, 3.6, only="__near")
b.close()
