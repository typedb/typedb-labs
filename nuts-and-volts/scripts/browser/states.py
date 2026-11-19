"""Capture the same highlight states for before/after comparisons (selection, system, assembly, type, failure).

    uv run --with websocket-client python -I scripts/browser/states.py <output-dir> <prefix> [quality]

Runs a separate headless Chrome (see cdp.py); 1600x1000 at 2x, saved as 2000-pixel JPEGs.
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser

out, prefix = Path(sys.argv[1]), sys.argv[2]
quality = sys.argv[3] if len(sys.argv) > 3 else "high"
out.mkdir(parents=True, exist_ok=True)
b = Browser(tempfile.mkdtemp() + "/profile")
b.call("Page.navigate", url=f"http://127.0.0.1:5180/?quality={quality}")
b.js(r"""for (let i=0;i<60 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500));
window.__wait = (ms) => new Promise(r => setTimeout(r, ms));
window.__click = async (sel, text, wait = 1500) => {
  let el; for (let i = 0; i < 50 && !el; i++) { el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text)); if (!el) await __wait(200); }
  if (!el) throw new Error('not found: ' + sel + ' / ' + text);
  el.scrollIntoView({block:'center'}); el.click(); await __wait(wait); };
await __wait(1500); await __click('button', 'Explore the vehicle', 3000); return 1;""")
states = [
    ("selection", "__select('caliper-fr'); await __wait(3000);"),
    ("system", "document.querySelector('aside.panel .panel-close')?.click(); await __click('.explore-tabs button', 'Systems'); await __click('.tree-row', 'Braking', 2500);"),
    ("assembly", "await __click('.explore-tabs button', 'Assemblies'); await __click('.tree-row', 'Electric powertrain', 2500);"),
    ("type", "await __click('.explore-tabs button', 'Types'); await __click('.tree-row', 'Sensor', 2500);"),
    ("failure", "document.querySelector('.focus-bar .link')?.click(); __select('lv-battery'); await __wait(2500); await __click('.panel .chip', 'If this fails', 3000);"),
]
for name, code in states:
    b.js(code + " return 1;")
    b.shot(str(out / f"{prefix}-{name}.jpg")); print("shot", name)
b.close()
