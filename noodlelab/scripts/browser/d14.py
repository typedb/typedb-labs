"""D1.4 review: the matched before/after app views (assembled, elevated, low side, exploded, highlights), with the
exterior lights off and on. Separate headless Chrome (see cdp.py), 1600x1000 at 2x.
    uv run --with websocket-client python -I scripts/browser/d14.py <output-dir> [lights]
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser

out = Path(sys.argv[1])
lights = len(sys.argv) > 2 and sys.argv[2] == "lights"
out.mkdir(parents=True, exist_ok=True)
b = Browser(tempfile.mkdtemp() + "/profile")
b.call("Page.navigate", url="http://127.0.0.1:5180/?quality=high")
b.js(r"""for (let i=0;i<60 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500));
await new Promise(r=>setTimeout(r,1500));
window.__wait = (ms) => new Promise(r => setTimeout(r, ms));
window.__click = async (sel, text, wait = 1500) => { const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text)); if (!el) throw new Error('no ' + text); el.click(); await __wait(wait); };
await __click('button', 'Explore the vehicle', 2500);
document.querySelector('.explore .panel-close')?.click(); await __wait(1500); return 1;""")
if lights:
    b.js("window.__lights?.(true); await __wait(500); return 1;")


def shot(name, p, turn, polar=1.40):
    b.js(f"await __shot({p}, {turn}, {polar}); await __shot({p}, {turn}, {polar}); return 1;")
    b.shot(str(out / f"{name}.jpg"), width=3200)
    print("shot", name)


# turn 0 is the front three-quarter (see final13 in D1.3)
for name, turn in (("front34", 0.0), ("rear34", 1.5708), ("front", -0.785), ("rear", 2.356), ("side", 0.785)):
    shot(f"{'lit' if lights else 'assembled'}-{name}", 0, turn)
if lights:
    b.close(); sys.exit()
shot("elevated-front34", 0, 0.0, 0.95)
shot("low-side", 0, 0.785, 1.62)
shot("exploded-front34", 1, 0.0)
for name, system in (("body", "Body and structure"), ("sensors", "Perception"), ("lighting", "Exterior lighting")):
    b.js(f"document.querySelector('.focus-bar .link')?.click(); await __wait(600);"
         f"if (!document.querySelector('.tree-row')) await __click('button', 'Explore TypeDB', 1500);"
         f"await __click('.tree-row', '{system}', 3000); return 1;")
    shot(f"highlight-{name}", 0, 0.0, 1.25)
b.close()
