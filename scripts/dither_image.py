#!/usr/bin/env python3
"""
Dither a photo into the landing page's duotone pixel style.

Ordered (Bayer 8x8) dithering into 1-bit square dots with a 1 px gap, transparent
background, single ink colour. The photo's backdrop is pushed to black so only the
subject emits dots; optional HUD frames echo a "scanning" interface.

Usage (requires Pillow):
  python3 scripts/dither_image.py SOURCE OUT.png [--cells 260] [--ink d7f5e6] [--crop x0,y0,x1,y1] [--gamma 0.85] [--hud]

SOURCE may be a local path or an https URL. Use public-domain / CC0 images only
(e.g. The Met Open Access): see README "Image credits".
"""
import argparse
import io
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageOps

BAYER = [
    [0, 48, 12, 60, 3, 51, 15, 63],
    [32, 16, 44, 28, 35, 19, 47, 31],
    [8, 56, 4, 52, 11, 59, 7, 55],
    [40, 24, 36, 20, 43, 27, 39, 23],
    [2, 50, 14, 62, 1, 49, 13, 61],
    [34, 18, 46, 30, 33, 17, 45, 29],
    [10, 58, 6, 54, 9, 57, 5, 53],
    [42, 26, 38, 22, 41, 25, 37, 21],
]


def load(src: str) -> Image.Image:
    if src.startswith("http"):
        req = urllib.request.Request(src, headers={"User-Agent": "openscan-asset-script"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    return Image.open(src).convert("RGB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("out")
    ap.add_argument("--cells", type=int, default=260, help="dither grid size (square)")
    ap.add_argument("--dot", type=int, default=2, help="dot size in px")
    ap.add_argument("--gap", type=int, default=1, help="gap between dots in px")
    ap.add_argument("--ink", default="d7f5e6", help="ink colour hex")
    ap.add_argument("--crop", help="x0,y0,x1,y1 in source pixels (default: centred square)")
    ap.add_argument("--hud", action="store_true", help="overlay scanning HUD frames")
    ap.add_argument("--gamma", type=float, default=1.0, help="<1 lifts mid-tones, >1 deepens them")
    ap.add_argument("--warm-subject", action="store_true", help="separate a warm subject (marble, skin) from a neutral grey backdrop by colour")
    a = ap.parse_args()

    rgb = load(a.source)
    if a.crop:
        rgb = rgb.crop(tuple(int(v) for v in a.crop.split(",")))
    else:
        s = min(rgb.size)
        rgb = rgb.crop(((rgb.width - s) // 2, (rgb.height - s) // 2, (rgb.width + s) // 2, (rgb.height + s) // 2))
    rgb = rgb.resize((a.cells * 3, a.cells * 3), Image.LANCZOS)
    img = ImageOps.grayscale(rgb)

    if a.warm_subject:
        # Neutral backdrop has R≈B; marble/skin is warmer. Mask by warmth, clean it up, then
        # stretch tones inside the mask only so the shadowed side keeps its detail.
        r, _, b = rgb.split()
        rp, bp = r.load(), b.load()
        mask = Image.new("L", rgb.size)
        mp = mask.load()
        for y in range(rgb.height):
            for x in range(rgb.width):
                d = rp[x, y] - bp[x, y]
                mp[x, y] = max(0, min(255, (d - 8) * 255 // 14))
        mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
        vals = sorted(img.getpixel((x, y)) for x in range(0, img.width, 3) for y in range(0, img.height, 3) if mask.getpixel((x, y)) > 200)
        lo, hi = vals[int(len(vals) * 0.02)], vals[int(len(vals) * 0.995)]
        img = img.point(lambda p: max(0, min(255, int((p - lo) * 255 / max(1, hi - lo)))))
        img = Image.composite(img, Image.new("L", img.size, 0), mask)
    else:
        # Backdrop → black: estimate it from the border and use it as the black point.
        w, h = img.size
        border = [img.getpixel((x, y)) for x in range(0, w, 7) for y in (0, h - 1)] + [img.getpixel((x, y)) for y in range(0, h, 7) for x in (0, w - 1)]
        border.sort()
        black = border[int(len(border) * 0.9)] + 6
        img = img.point(lambda p: max(0, min(255, int((p - black) * 255 / max(1, 250 - black)))))
    if a.gamma != 1.0:
        img = img.point(lambda p: int(255 * (p / 255) ** a.gamma))
    # local contrast (broad) then detail (fine), so relief reads at dot resolution
    img = img.filter(ImageFilter.UnsharpMask(radius=18, percent=90, threshold=0))
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=160, threshold=2))
    img = img.resize((a.cells, a.cells), Image.LANCZOS)

    if a.hud:
        d = ImageDraw.Draw(img)
        c = a.cells
        for x0, y0, x1, y1 in [(0.70, 0.03, 0.97, 0.20), (0.03, 0.74, 0.27, 0.95), (0.80, 0.56, 0.99, 0.70)]:
            box = [int(x0 * c), int(y0 * c), int(x1 * c), int(y1 * c)]
            d.rectangle(box, outline=200, fill=None)
            d.rectangle([box[0], box[1], box[2], box[1] + max(2, c // 60)], fill=170)
            for i, yy in enumerate(range(box[1] + c // 28, box[3] - 2, max(3, c // 45))):
                d.line([box[0] + 3, yy, box[0] + 3 + int((box[2] - box[0] - 6) * (0.35 + 0.5 * ((i * 37) % 10) / 10)), yy], fill=120)

    pitch = a.dot + a.gap
    size = a.cells * pitch
    out = Image.new("P", (size, size), 0)
    ink = bytes.fromhex(a.ink)
    out.putpalette([0, 0, 0, *ink] + [0] * (256 * 3 - 6))
    px = img.load()
    draw = ImageDraw.Draw(out)
    for y in range(a.cells):
        for x in range(a.cells):
            if px[x, y] / 255 > (BAYER[y % 8][x % 8] + 0.5) / 64:
                draw.rectangle([x * pitch, y * pitch, x * pitch + a.dot - 1, y * pitch + a.dot - 1], fill=1)
    out.save(a.out, optimize=True, bits=1, transparency=0)
    print(f"wrote {a.out} ({size}x{size})")


if __name__ == "__main__":
    main()
