# Android launcher icons and splash screens from build/icon.png (run once after `cap add android`; the results are committed).
#   python3 scripts/icons.py
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "android", "app", "src", "main", "res")
src = Image.open(os.path.join(HERE, "..", "..", "build", "icon.png")).convert("RGBA")
box = src.getbbox()                                   # the black rounded square
sq = src.crop(box)
w, h = sq.size
# the candles inside the square, without its rounded corners
inner = sq.crop((int(w * .14), int(h * .14), int(w * .86), int(h * .86)))

def candles(size, frac):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = int(size * frac)
    img.alpha_composite(inner.resize((s, s), Image.LANCZOS), ((size - s) // 2, (size - s) // 2))
    return img

def on_black(size, frac, shape):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    if shape == "round": d.ellipse((0, 0, size - 1, size - 1), fill=255)
    else: d.rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 6, fill=255)
    img.paste((0, 0, 0, 255), (0, 0), mask)
    img.alpha_composite(candles(size, frac))
    return img

for dpi, n in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    d = os.path.join(RES, "mipmap-" + dpi)
    on_black(n, .62, "square").save(os.path.join(d, "ic_launcher.png"))
    on_black(n, .56, "round").save(os.path.join(d, "ic_launcher_round.png"))
    # adaptive icon: 108dp canvas, the launcher masks it to ~66dp, so the candles stay well inside
    f = n * 108 // 48
    candles(f, .42).save(os.path.join(d, "ic_launcher_foreground.png"))

# splash screens: black with the icon in the middle, same sizes as the templates Capacitor generated
for root, _, files in os.walk(RES):
    for fn in files:
        if fn == "splash.png":
            p = os.path.join(root, fn)
            W, H = Image.open(p).size
            img = Image.new("RGB", (W, H), (0, 0, 0))
            s = min(W, H) // 4
            img.paste(sq.resize((s, s), Image.LANCZOS), ((W - s) // 2, (H - s) // 2), sq.resize((s, s), Image.LANCZOS))
            img.save(p)
