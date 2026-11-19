"""C3c renders of the four wheel corners in the running app (only each corner's parts shown), including the
rear corner from inboard (toe link, parking-brake actuator).
    uv run --with websocket-client python -I scripts/browser/corners.py <output-dir> [quality]
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
window.__corner = {};
for (const c of ['fl','fr','rl','rr']) window.__corner[c] = Object.values((await (await fetch(`/assets/corner-${c}.map.json`)).json()).nodes);
return 1;""")

def view(name, c, az, el, dist, hide=()):
    h = "[" + ",".join(f"'{x}'" for x in hide) + "]"
    b.js(f"const only = __corner['{c}'].filter(id => !{h}.some(p => id.startsWith(p)));"
         f"await __focus(0, ['hub-{c}'], {az}, {el}, {dist}, only); await __focus(0, ['hub-{c}'], {az}, {el}, {dist}, only);"
         "window.__vx.setFrameloop('always'); await new Promise(r=>setTimeout(r,1500)); return 1;")
    b.shot(str(out / f"{name}.jpg"), width=3200)
    print("shot", name)

view("corner-fl", "fl", -150, 18, 1.5)
view("corner-rl", "rl", -30, 18, 1.5)
view("corner-rr", "rr", 150, 18, 1.5)
view("corner-rr-inboard", "rr", 205, 22, 1.15, ("tyre", "wheel"))
view("corner-fl-inboard", "fl", 25, 22, 1.15, ("tyre", "wheel"))
b.close()
