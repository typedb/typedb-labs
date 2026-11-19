"""C2 review screenshots of the semantic browser (1600x1000 at 2x) into docs/c2/.

Runs a separate headless Chrome (the installed Google Chrome, real engine, Metal GPU on this Mac) through the
DevTools Protocol; it never touches the user's own Chrome windows or profile. Needs the dev stack running.
    uv run --with websocket-client python -I scripts/browser/review.py
"""
import sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser
ROOT = Path(__file__).resolve().parents[2]
SP, OUT = tempfile.mkdtemp(), str(ROOT / "docs" / "c2")
b = Browser(SP + "/profile")
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
  ("1-systems", "await __click('button', 'Explore the vehicle', 2500); await __click('.explore-tabs button', 'Systems', 800); await __click('.tree-row', 'Braking', 2500);"),
  ("2-assemblies", "await __click('.explore-tabs button', 'Assemblies', 1200); await __click('.tree-row', 'Electric powertrain', 1500); await __click('.detail .chip', 'Front drive unit', 2500);"),
  ("3-types", "await __click('.explore-tabs button', 'Types', 1200); await __click('.tree-row', 'Sensor', 2500); document.querySelector('.explore-body').scrollTop = 0; await __wait(600);"),
  ("4-questions-path", "await __click('.explore-tabs button', 'Questions', 1200); await __click('.question', 'battery energy reach', 3000);"),
  ("5-questions-single-failures", "await __click('.question', 'single failures', 600); await __until(() => document.querySelector('.questions li.open')?.textContent.includes('drive torque at all four'), 20000); await __wait(1500);"),
  ("6a-nav-system", "document.querySelector('.focus-bar .link')?.click(); await __click('.explore-tabs button', 'Systems', 1000); await __click('.tree-row', 'Braking', 2500);"),
  ("6b-nav-component", "await __click('.detail .link', 'Front left wheel-speed sensor', 3000);"),
  ("6c-nav-impact", "await __click('.panel .chip', 'If this fails', 2500); const p=document.querySelector('.panel'); const s=[...p.querySelectorAll('section')].find(x=>x.textContent.includes('Follow the dependencies')); p.scrollTop = s.offsetTop - 10; await __wait(800);"),
  ("6d-nav-back-to-system", "const p=document.querySelector('.panel'); p.scrollTop=0; await __wait(300); await __click('.panel .chip', 'Perception', 2500);"),
  ("7-typeql-viewer", "const p=document.querySelector('.panel'); await __click('.panel .typeql-toggle', 'TypeQL', 800); const q=p.querySelectorAll('.typeql-query'); q[q.length-1].scrollIntoView({block:'end'}); await __wait(600);"),
]
for name, code in steps:
    b.js(code + " return true;")
    b.shot(f"{OUT}/{name}.jpg"); print("shot", name)
b.close()
