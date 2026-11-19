"""Same close-ups at a given quality tier, for judging rendering changes (brake corner and the whole car).

    uv run --with websocket-client python -I scripts/browser/quality.py <output-dir> <prefix> <quality> [extra-options]

Separate headless Chrome (see cdp.py), 1600x1000 at 2x; the app's own pixel-ratio cap for the tier applies.
"""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser

out, prefix, quality = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
out.mkdir(parents=True, exist_ok=True)
b = Browser(tempfile.mkdtemp() + "/profile")
b.call("Page.navigate", url=f"http://127.0.0.1:5180/?quality={quality}" + (f"&{sys.argv[4]}" if len(sys.argv) > 4 else ""))
b.js(r"""for (let i=0;i<60 && !(window.__vx && window.__select);i++) await new Promise(r=>setTimeout(r,500));
await new Promise(r=>setTimeout(r,1500));
[...document.querySelectorAll('button')].find(e => e.textContent.includes('Explore the vehicle')).click();
await new Promise(r=>setTimeout(r,2500));
document.querySelector('.explore .panel-close')?.click(); await new Promise(r=>setTimeout(r,1500)); return 1;""")
B = "['brake-disc-fr','caliper-fr','brake-pad-inner-fr','brake-pad-outer-fr','brake-shield-fr','hub-fr','wheel-bearing-fr','knuckle-fr','wheel-speed-sensor-fr','brake-hose-fr','hub-nut-fr']"
views = [
    ("corner", f"await __focus(0,['brake-disc-fr','caliper-fr'],20,25,0.95,{B}); await __focus(0,['brake-disc-fr','caliper-fr'],20,25,0.95,{B});"),
    ("car", "const ids=(await import('/src/scene/vehicleState.ts')).vehicleState.built.map(b=>b.id); await __focus(0,ids,48,12,9.5); await __focus(0,ids,48,12,9.5);"),
]
for name, code in views:
    b.js(code + " window.__vx.setFrameloop('always'); await new Promise(r=>setTimeout(r,1200)); return 1;")
    b.shot(str(out / f"{prefix}-{name}.jpg"), width=3200)
    print("shot", name, b.js("return [devicePixelRatio, __vx.gl.getPixelRatio(), __vx.gl.domElement.width];"))
b.close()
