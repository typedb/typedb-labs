"""D1.5 review: the app's engineering presentation and contextual TypeQL, as screenshots. Separate headless Chrome
(see cdp.py), 1600x1000 at 2x unless a size is given.
    uv run --with websocket-client python -I scripts/browser/d15.py <output-dir> [width height]
With a size below 900 wide it takes the smaller-screen set instead.
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser

out = Path(sys.argv[1])
w, h = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (1600, 1000)
out.mkdir(parents=True, exist_ok=True)
b = Browser(tempfile.mkdtemp() + "/profile", width=w, height=h)
b.call("Page.navigate", url="http://127.0.0.1:5180/?quality=high")
b.js(r"""for (let i=0;i<80 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500));
await new Promise(r=>setTimeout(r,2000));
window.__wait = (ms) => new Promise(r => setTimeout(r, ms));
window.__click = async (sel, text, wait = 1500, exact = false) => {
  const el = [...document.querySelectorAll(sel)].find(e => exact ? e.firstElementChild?.textContent === text : e.textContent.includes(text));
  if (!el) throw new Error('no ' + text); el.click(); await __wait(wait); };
window.__clear = async () => { document.querySelector('.focus-bar .link')?.click(); __select(null); await __wait(800); };
await __click('button', 'Explore the vehicle', 3000); return 1;""")


def shot(name, p=0, turn=-0.5, polar=1.40):
    b.js(f"await __shot({p}, {turn}, {polar}); await __shot({p}, {turn}, {polar}); return 1;")
    b.shot(str(out / f"{name}.jpg"), width=min(3200, w * 2))
    print("shot", name)


if w < 900:
    shot("phone-assembled")
    b.js("if (!document.querySelector('.tree-row')) await __click('button', 'Explore TypeDB'); await __click('.tree-row', 'Propulsion', 3000); return 1;")
    shot("phone-explorer")
    b.js("document.querySelector('.explore .panel-close')?.click(); await __wait(800); document.querySelector('.tq-collapse')?.click(); await __wait(1500); return 1;")
    shot("phone-typeql")
    shot("phone-exploded-typeql", 1)
    b.close(); sys.exit()

b.js("document.querySelector('.explore .panel-close')?.click(); await __wait(1000); return 1;")
shot("assembled")
shot("exploded", 1)
shot("exploded-side", 1, 0.785)
b.js("await __click('button', 'Explore TypeDB'); await __click('.tree-row', 'Propulsion', 3000); return 1;")
shot("system-typeql")
b.js("document.querySelector('.tq-block.schema .tq-block-head')?.click(); await __wait(1500); return 1;")
shot("system-typeql-schema")
shot("system-typeql-exploded", 1)
b.js("await __clear(); await __click('.explore-tabs button', 'Assemblies'); await __click('.tree-row', 'Electric powertrain', 3000); return 1;")
shot("assembly-typeql")
b.js("await __clear(); await __click('.explore-tabs button', 'Types'); await __click('.tree-row', 'Sensor', 3000, true); return 1;")
shot("type-typeql")
b.js("await __clear(); document.querySelector('.explore .panel-close')?.click(); __select('caliper-fr'); await __wait(3000);"
     "await __click('.tq-steps button', '4', 1000); return 1;")
shot("component-typeql")
b.js("__select('lv-battery'); await __wait(3000); await __click('.panel .chip', 'If this fails', 5000); return 1;")
shot("impact-typeql")
b.close()
