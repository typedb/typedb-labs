"""C3c final review renders: the whole vehicle assembled and exploded from several angles, and the mechanical
vehicle with the body and interior hidden (which parts are body or interior comes from TypeDB's type hierarchy).
    uv run --with websocket-client python -I scripts/browser/final.py <output-dir> [quality]
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
const ids = [];
for (const t of ['body-component', 'interior-component']) ids.push(...(await (await fetch(`/api/types/${t}`)).json()).data.instances.map(i => i.id));
window.__body = ids;
return ids.length;""")

VIEWS = [("front", 0.6, 1.32), ("rear", -2.4, 1.32), ("side", 1.5708, 1.45), ("top", 0.6, 0.55)]


def shot(name, p, turn, polar, hide_body=False):
    b.js(f"for (const id of window.__body) {{ const o = window.__vx.scene.getObjectByName(id); if (o) o.visible = {str(not hide_body).lower()}; }}"
         f"await __shot({p}, {turn}, {polar}); await __shot({p}, {turn}, {polar}); return 1;")
    b.shot(str(out / f"{name}.jpg"), width=3200)
    print("shot", name)


for view, turn, polar in VIEWS:
    shot(f"assembled-{view}", 0, turn, polar)
for view, turn, polar in VIEWS:
    shot(f"exploded-{view}", 1, turn, polar)
for view, turn, polar in VIEWS[:3]:
    shot(f"mechanical-{view}", 0, turn, polar, hide_body=True)
shot("mechanical-exploded-front", 1, 0.6, 1.32, hide_body=True)
b.close()
