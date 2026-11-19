"""Frame-time measurement in Chrome: CPU time per frame, GPU time (EXT_disjoint_timer_query_webgl2) and frame interval, per quality tier and scene state.

Runs a separate headless Chrome (the installed Google Chrome, real engine, Metal GPU on this Mac) through the
DevTools Protocol; it never touches the user's own Chrome windows or profile. Needs the dev stack running.
    uv run --with websocket-client python -I scripts/browser/perf.py [results.json]
"""
import json, os, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser
SP = tempfile.mkdtemp()
MEASURE = r"""
window.__wait = (ms) => new Promise(r => setTimeout(r, ms));
window.__click = async (sel, text, wait = 1200) => { const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text)); el.click(); await __wait(wait); };
window.__frames = async (n = 150, animate = false) => {
  const s = __vx, gl = s.gl.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  s.setFrameloop('never');
  const cpu = [], gpu = [], interval = [], queries = [];
  let last = performance.now();
  await new Promise((done) => {
    let i = 0;
    const tick = (ts) => {
      if (animate) __vxProgress.set(0.2 + 0.6 * (i / n));
      interval.push(ts - last); last = ts;
      const q = ext && gl.createQuery(); if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t0 = performance.now(); s.advance(ts); const t1 = performance.now();
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); }
      cpu.push(t1 - t0);
      if (++i < n) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  await __wait(500);
  for (const q of queries) {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  s.setFrameloop('always');
  const st = (a) => { a = a.slice(15).sort((x, y) => x - y); if (!a.length) return null; return { p50: +a[Math.floor(a.length * 0.5)].toFixed(2), p90: +a[Math.floor(a.length * 0.9)].toFixed(2), max: +a[a.length - 1].toFixed(2) }; };
  return { cpu: st(cpu), gpu: st(gpu), interval: st(interval), info: { calls: s.gl.info.render.calls, triangles: s.gl.info.render.triangles } };
};
"""
results = {}
# PERF_TIERS (default "high,medium") and PERF_QUERY (extra address options, e.g. "ao=half") narrow a run.
for tier in os.environ.get("PERF_TIERS", "high,medium").split(","):
    b = Browser(SP + "/profile")
    b.call("Page.navigate", url=f"http://127.0.0.1:5180/?quality={tier}&{os.environ.get('PERF_QUERY', '')}")
    b.js("for (let i=0;i<60 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500)); " + MEASURE + " await __wait(1500); return 1;")
    b.js("await __click('button', 'Explore the vehicle', 3000); document.querySelector('.explore .panel-close')?.click(); await __wait(1500); return 1;")
    r = {}
    r["assembled, explorer closed"] = b.js("return await __frames();")
    b.js("await __click('button', 'Explore TypeDB', 1500); await __click('.tree-row', 'Braking', 2500); return 1;")
    r["assembled, explorer open, Braking highlighted"] = b.js("return await __frames();")
    b.js("__vxProgress.set(1); await __wait(5000); return 1;")
    r["exploded, Braking highlighted"] = b.js("return await __frames();")
    r["exploding (animation), Braking highlighted"] = b.js("return await __frames(150, true);")
    b.js("document.querySelector('.focus-bar .link')?.click(); await __wait(1000); return 1;")
    r["exploding (animation), no highlight"] = b.js("return await __frames(150, true);")
    results[tier] = r
    b.close()
if len(sys.argv) > 1:
    open(sys.argv[1], "w").write(json.dumps(results, indent=1))   # optional: save the full results
for tier, r in results.items():
    for k, v in r.items():
        print(f"{tier:6} {k:48} cpu {v['cpu']['p50']:5}/{v['cpu']['p90']:5}  gpu {v['gpu']['p50']:6}/{v['gpu']['p90']:6}  frame {v['interval']['p50']}/{v['interval']['p90']}")
