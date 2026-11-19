"""Before/after sheets for a review: <dir>/before/*.jpg (the previous phase, from scripts/browser/d14.py) beside
<dir>/after/*.jpg, cropped to the vehicle, into <dir>/compare-<view>.jpg; lit-*.jpg are paired with the unlit view.
    uv run --with pillow python -I scripts/browser/compare_pairs.py docs/d1/d1.4
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
d = Path(sys.argv[1])
font = ImageFont.load_default(size=40)
for a in sorted((d / "after").glob("*.jpg")):
    if a.name.startswith("lit-"):
        b = d / "after" / a.name.replace("lit-", "assembled-"); labels = ("lights off", "lights on")
    else:
        b = d / "before" / a.name; labels = ("D1.3", "D1.4")
    if not b.exists(): continue
    ims = []
    for f in (b, a):
        im = Image.open(f).convert("RGB")
        w, h = im.size
        ims.append(im.crop((int(w * 0.14), int(h * 0.16), int(w * 0.86), int(h * 0.84))).resize((1200, 750)))
    sheet = Image.new("RGB", (2400, 750))
    for i, (im, lab) in enumerate(zip(ims, labels)):
        sheet.paste(im, (i * 1200, 0)); ImageDraw.Draw(sheet).text((i * 1200 + 30, 20), lab, fill=(200, 200, 210), font=font)
    out = d / f"compare-{a.name.replace('lit-', 'lights-')}"
    sheet.save(out, quality=85); print(out.name)
