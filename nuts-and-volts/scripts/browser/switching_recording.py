"""UI milestone review: record rapid switching between parts, systems and assemblies (live, Chrome's screencast, which
does not stall rendering) and save an animated WebP and key frames. Separate headless Chrome (see cdp.py).
    uv run --with websocket-client --with pillow python -I scripts/browser/switching_recording.py <output-dir> [width height]
"""
import base64, io, json, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from cdp import Browser
from PIL import Image

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
w, h = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (1512, 860)
b = Browser(tempfile.mkdtemp() + "/profile", width=w, height=h, scale=1)
b.call("Page.navigate", url="http://127.0.0.1:5180/?quality=high")
time.sleep(4)
b.js("[...document.querySelectorAll('button')].find(e => /Explore the vehicle|Skip intro/.test(e.textContent))?.click();"
     "await new Promise(r => setTimeout(r, 3000)); __select('quarter-r'); await new Promise(r => setTimeout(r, 3000)); return 1;")
frames = []


def send(method, params=None, expression=None):
    b.n += 1
    msg = {"id": b.n, "method": method, "params": params or {}}
    if expression:
        msg = {"id": b.n, "method": "Runtime.evaluate", "params": {"expression": expression}}
    b.ws.send(json.dumps(msg))


def pump(seconds):
    end = time.time() + seconds
    b.ws.settimeout(0.3)
    while time.time() < end:
        try:
            msg = json.loads(b.ws.recv())
        except Exception:
            continue
        if msg.get("method") == "Page.screencastFrame":
            p = msg["params"]
            frames.append((time.time() - t0, base64.b64decode(p["data"])))
            send("Page.screencastFrameAck", {"sessionId": p["sessionId"]})


t0 = time.time()
send("Page.startScreencast", {"format": "jpeg", "quality": 80, "maxWidth": w, "maxHeight": h, "everyNthFrame": 2})
steps = ["__select('front-motor')", "__select('lv-battery')",
         "[...document.querySelectorAll('.tree-row')].find(e => e.textContent.startsWith('Propulsion')).click()",
         "__select('caliper-fl')", "__select('battery-module-3')", "__select('door-fl')", "__select('tyre-rr')",
         "[...document.querySelectorAll('.tree-row')].find(e => e.textContent.startsWith('Braking')).click()",
         "__select('front-inverter')", "__select('quarter-r')"]
pump(1.0)
for s in steps:
    send("Runtime.evaluate", expression=s)
    pump(0.8)
pump(1.5)
print(len(frames), "frames over", round(frames[-1][0], 1), "s")
step, picked, t = 1 / 12, [], 0.0
while t <= frames[-1][0]:
    picked.append(min(frames, key=lambda f: abs(f[0] - t))[1])
    t += step
images = [Image.open(io.BytesIO(d)).convert("RGB").resize((w * 2 // 3, h * 2 // 3)) for d in picked]
images[0].save(out / "rapid-switching.webp", save_all=True, append_images=images[1:], duration=int(step * 1000), loop=0, quality=72)
for name, at in (("switch-a", 2.0), ("switch-b", 4.6), ("switch-c", 7.8)):
    Image.open(io.BytesIO(min(frames, key=lambda f: abs(f[0] - at))[1])).convert("RGB").save(out / f"{name}.jpg", quality=85)
print("saved", len(images), "frames")
b.close()
