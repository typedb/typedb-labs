"""Drive a headless Chrome (real engine, Metal GPU) through the DevTools Protocol, for review screenshots and
measurements. Used by scripts/browser/review.py and perf.py."""
import base64, json, subprocess, sys, time, urllib.request
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9333

class Browser:
    def __init__(self, profile, width=1600, height=1000, scale=2):
        self.proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
            f"--window-size={width},{height}", f"--force-device-scale-factor={scale}", "--use-angle=metal", "--ignore-gpu-blocklist",
            "--enable-gpu-rasterization", "--no-first-run", "--no-default-browser-check", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                page = next(t for t in tabs if t["type"] == "page"); break
            except Exception: time.sleep(0.2)
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=120)
        self.n = 0
        self.call("Page.enable"); self.call("Runtime.enable")
        self.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=scale, mobile=False)

    def call(self, method, **params):
        self.n += 1; mid = self.n
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg: raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def js(self, expr):
        r = self.call("Runtime.evaluate", expression=f"(async () => {{ {expr} }})()", awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r: raise RuntimeError(r["exceptionDetails"])
        return r["result"].get("value")

    def shot(self, path, width=2000):
        """Save the page as a JPEG (by .jpg path) or PNG, scaled to `width` pixels wide."""
        metrics = self.call("Page.getLayoutMetrics")["cssVisualViewport"]
        dpr = self.js("return devicePixelRatio;")
        clip = {"x": 0, "y": 0, "width": metrics["clientWidth"], "height": metrics["clientHeight"],
                "scale": width / (metrics["clientWidth"] * dpr)}
        fmt = {"format": "jpeg", "quality": 86} if str(path).endswith(".jpg") else {"format": "png"}
        data = self.call("Page.captureScreenshot", clip=clip, **fmt)["data"]
        open(path, "wb").write(base64.b64decode(data))

    def close(self):
        self.proc.terminate()
