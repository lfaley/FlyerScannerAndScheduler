#!/usr/bin/env python3
"""Generate every app icon FlyerSnap ships, from the brand tokens.

    python3 tools/build-app-icons.py

Writes:
  icon-192.png, icon-512.png          purpose "any" -- rounded square with
                                      transparent corners, the shape iOS and
                                      desktop expect to place as-is.
  icon-maskable-192/512.png           purpose "maskable" -- FULL BLEED, no
                                      transparency, artwork inside the 80%
                                      safe circle. Android masks icons to a
                                      circle/squircle: transparent corners
                                      show through as notches, and artwork
                                      outside the safe zone gets clipped.
  apple-touch-icon.png (180x180)      iOS home screen. Must be opaque -- iOS
                                      composites transparency onto BLACK.

Generated rather than hand-drawn so the icons cannot drift from the palette,
and so any size can be re-cut without redrawing. Re-run after a palette change.
"""
from PIL import Image, ImageDraw
import math, os

# Brand tokens -- keep in step with css/tokens.css.
GREEN  = (45, 90, 74, 255)      # --green   #2D5A4A
CREAM  = (247, 245, 240, 255)   # --bg      #F7F5F0
LENSLT = (228, 238, 233, 255)   # --green-lt #E4EEE9
RED    = (192, 57, 43, 255)     # --red     #C0392B

SS = 4   # supersample factor; drawn big, then reduced for clean edges


def camera(d, cx, cy, w):
    """Draw the camera glyph centred on (cx, cy), w wide."""
    h = w * 0.66
    x0, y0 = cx - w / 2, cy - h / 2 + h * 0.08
    r = w * 0.10

    # viewfinder bump, drawn first so the body overlaps its base
    bw, bh = w * 0.22, h * 0.20
    d.rounded_rectangle([cx - bw / 2, y0 - bh * 0.9, cx + bw / 2, y0 + bh * 0.4],
                        radius=bh * 0.35, fill=CREAM)
    # body
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=r, fill=CREAM)
    # lens
    lr = h * 0.34
    d.ellipse([cx - lr, cy - lr + h * 0.06, cx + lr, cy + lr + h * 0.06], fill=GREEN)
    d.ellipse([cx - lr * 0.45, cy - lr * 0.45 + h * 0.06,
               cx + lr * 0.45, cy + lr * 0.45 + h * 0.06], fill=LENSLT)
    # flash
    fr = w * 0.055
    d.ellipse([x0 + w * 0.80 - fr, y0 + h * 0.20 - fr,
               x0 + w * 0.80 + fr, y0 + h * 0.20 + fr], fill=RED)


def build(size, *, maskable=False, opaque=False, path):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable or opaque:
        # Full bleed: every pixel painted. A maskable icon with transparent
        # corners shows notches once Android applies its mask; an iOS icon
        # with transparency composites onto black.
        d.rectangle([0, 0, S, S], fill=GREEN)
    else:
        # iOS/desktop place this shape as-is, so give it the rounded square.
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=GREEN)

    # Maskable safe zone: artwork must sit inside a circle of 80% diameter
    # (radius 0.4 * size). The glyph is a wide rectangle, so size it by its
    # corner distance, not its width, or the corners clip.
    if maskable:
        safe_r = S * 0.40 * 0.92          # 8% margin inside the safe circle
        ratio = 0.66                       # glyph height / width
        # half-diagonal of the glyph = (w/2) * sqrt(1 + ratio^2)
        w = 2 * safe_r / math.sqrt(1 + ratio ** 2)
    else:
        w = S * 0.62

    camera(d, S / 2, S / 2, w)
    img = img.resize((size, size), Image.LANCZOS)
    if opaque:
        img = img.convert('RGB')          # no alpha channel at all for iOS
    img.save(path)
    print(f'  {path:28} {size}x{size}'
          f'{"  maskable" if maskable else ""}{"  opaque" if opaque else ""}')


if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(__file__), '..'))
    print('writing icons:')
    build(192, path='icon-192.png')
    build(512, path='icon-512.png')
    build(192, maskable=True, path='icon-maskable-192.png')
    build(512, maskable=True, path='icon-maskable-512.png')
    build(180, opaque=True,  path='apple-touch-icon.png')
