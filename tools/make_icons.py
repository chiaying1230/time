"""產生 PWA 圖示：python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

BG = (63, 111, 94)        # sage
INK = (246, 243, 234)     # cream
DOT = (226, 140, 112)     # coral
OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024


def glyph(scale, rounded):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    if rounded:
        dr.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    else:
        dr.rectangle([0, 0, S, S], fill=BG)
    c = S / 2
    w, h = 400 * scale, 640 * scale
    x0, y0 = c - w / 2, c - h / 2
    stroke = int(46 * scale)
    # 手機外框
    dr.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=int(70 * scale), outline=INK, width=stroke)
    # 筆記橫線
    lx0, lx1 = x0 + 95 * scale, x0 + w - 95 * scale
    for i, frac in enumerate((0.36, 0.52, 0.68)):
        y = y0 + h * frac
        end = lx1 if i < 2 else lx0 + (lx1 - lx0) * 0.55
        dr.rounded_rectangle([lx0, y - 17 * scale, end, y + 17 * scale], radius=int(17 * scale), fill=INK)
    # 紀錄點
    r = 34 * scale
    cx, cy = c, y0 + h * 0.17
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DOT)
    return img


def save(img, size, name, flatten=False):
    out = img.resize((size, size), Image.LANCZOS)
    if flatten:
        bg = Image.new("RGB", out.size, BG)
        bg.paste(out, mask=out.split()[3])
        out = bg
    out.save(OUT / name, optimize=True)


OUT.mkdir(exist_ok=True)
any_icon = glyph(1.0, rounded=True)
full = glyph(1.0, rounded=False)
maskable = glyph(0.78, rounded=False)  # 圖案縮在安全區內
save(any_icon, 192, "icon-192.png")
save(any_icon, 512, "icon-512.png")
save(maskable, 512, "icon-maskable-512.png", flatten=True)
save(full, 180, "apple-touch-icon.png", flatten=True)
save(any_icon, 32, "favicon-32.png")
print("ok")
