"""C3b review renders of the battery pack and high-voltage distribution in the running app: the pack with its
lid off, a module row close-up, the front bay and junction box, the exploded pack, the front compartment's
power electronics, the charging path at the rear, and the pack in place.

    uv run --with websocket-client python -I scripts/browser/battery.py <output-dir> [quality]

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
const nodes = async (a) => Object.values((await (await fetch(`/assets/${a}.map.json`)).json()).nodes);
window.__pack = await nodes('hv-battery');
window.__power = await nodes('power-electronics');
window.__harness = ['hv-harness-front', 'hv-harness-rear', 'hv-harness-aux', 'hv-harness-charge', 'lv-harness', 'coolant-lines'];
window.__all = m.PARTS.map(p => p.id);
window.__bodyless = m.PARTS.filter(p => p.shape.kind !== 'panel' && p.shape.kind !== 'panel-inner' && !/^(sill|arch-liner|underbody|door|seat|headrest|bulkhead|cabin|floor|dashboard|centre-|driver-display|headliner|roof|.-pillar|front-header|rear-header|cross-car|glass|quarter|windscreen|tail|head|mirror|steering-wheel|steering-column|brake-booster|master-cylinder|brake-pedal|front-rail|rear-rail|front-crash|rear-crash|radiator|cooling-fan|hvac)/.test(p.id)).map(p => p.id);
return 1;""")

def view(name, p, focus, az, el, dist, only, hide="[]"):
    b.js(f"const only = ({only}).filter(id => !{hide}.includes(id)); const f = {focus};"
         f"await __focus({p}, f, {az}, {el}, {dist}, only); await __focus({p}, f, {az}, {el}, {dist}, only);"
         "window.__vx.setFrameloop('always'); await new Promise(r=>setTimeout(r,1500)); return 1;")
    b.shot(str(out / f"{name}.jpg"), width=3200)
    print("shot", name)

LID = "['battery-lid']"
view("pack-open", 0, "__pack", 35, 42, 3.6, "__pack", LID)
view("pack-modules", 0, "['battery-module-9','battery-module-10','battery-monitor-5']", 20, 35, 0.75, "__pack", LID)
view("pack-front-bay", 0, "['main-contactor-pos','pack-fuse','bms']", 70, 55, 1.15, "__pack.concat(__harness)", "['battery-lid','hv-junction-box']")
view("pack-exploded", 1, "__pack", 40, 32, 6.8, "__pack")
view("power-front", 0, "['pdu','dc-dc','lv-battery','lv-fuse-box']", 200, 35, 1.3, "__bodyless")
view("charging-rear", 0, "['charge-port','obc','hv-harness-charge']", 300, 25, 1.7, "__bodyless")
view("pack-in-place", 0, "__pack", 140, 30, 4.4, "__bodyless", LID)
b.close()
