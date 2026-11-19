"""C3b screenshots of the battery in the existing explorer (1600x1000 at 2x) into docs/c3b/: the Battery
management system, the battery junction box assembly, the cell-monitor type, the single-failure question,
and a pack-fuse failure with its propulsion summary. Separate headless Chrome (see cdp.py).
    uv run --with websocket-client python -I scripts/browser/c3b_explorer.py
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser
ROOT = Path(__file__).resolve().parents[2]
OUT = str(ROOT / "docs" / "c3b")
b = Browser(tempfile.mkdtemp() + "/profile")
b.call("Page.navigate", url="http://127.0.0.1:5180/?quality=high")
HELP = r"""
window.__wait = (ms) => new Promise(r => setTimeout(r, ms));
window.__click = async (sel, text, wait = 1200) => {
  const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(text) || e.textContent.includes(text));
  if (!el) throw new Error('not found: ' + sel + ' ' + text);
  el.scrollIntoView({ block: 'center' }); el.click(); await __wait(wait); return true;
};
window.__until = async (fn, ms = 15000) => { const t = performance.now(); while (!fn() && performance.now() - t < ms) await __wait(200); return !!fn(); };
"""
print(b.js("for (let i=0;i<60 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500)); " + HELP + " await __wait(1500); return 'ready';"))
steps = [
    ("explorer-battery-management", "await __click('button', 'Explore the vehicle', 2500); await __click('.explore-tabs button', 'Systems', 800); await __click('.tree-row', 'Battery management', 2500);"),
    ("explorer-junction-box", "await __click('.explore-tabs button', 'Assemblies', 1200); await __click('.tree-row', 'Electric powertrain', 1500); await __click('.detail .chip', 'High-voltage battery', 1500); await __click('.detail .chip', 'Battery junction box', 2500);"),
    ("explorer-cell-monitor", "await __click('.explore-tabs button', 'Types', 1200); await __click('.tree-row', 'Cell monitor', 2500);"),
    ("explorer-single-failures", "await __click('.explore-tabs button', 'Questions', 1200); await __click('.question', 'single failures', 600); await __until(() => document.querySelector('.questions li.open')?.textContent.includes('drive torque at all four'), 30000); await __wait(1500);"),
    ("impact-pack-fuse", "document.querySelector('.explore .panel-close')?.click(); await __wait(600); __select('pack-fuse'); await __wait(2000); await __click('aside.panel .chip', 'If this fails', 3500);"),
]
for name, code in steps:
    print(b.js(code + " return true;"))
    b.shot(f"{OUT}/{name}.jpg", width=3200); print("shot", name)
b.close()
