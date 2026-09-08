#!/usr/bin/env python3
"""Generate the image derivatives the site actually serves.

Sources stay where they are (the big JPG, the trading PNGs, the 1050-wide
kitchen photos); this writes the sized WebP files that the HTML and manifests
reference. Re-run after adding or replacing a source. Needs Pillow — use the
miniconda python (~/miniconda3/bin/python3).

    python3 tools/media.py headshot assets/headshot2.jpg
    python3 tools/media.py kitchen  assets/kitchen/*.webp          # skips -420/-840 derivatives
    python3 tools/media.py lab      path/to/cover.png ...          # -> assets/lab/<stem>.webp, 960x540, centre-cropped to 16:9
    python3 tools/media.py chart    assets/trading/*.png           # -> assets/trading/<stem>.webp, <=1600 wide
    python3 tools/media.py poster   SRC OUT [WIDTH]                # one file, <=WIDTH wide (default 800)

Sizes are tied to the CSS: the headshot box is 232px (168px on phones), a
kitchen tile is ~200px and a big tile ~410px, a lab card ~400px. Everything is
generated at 2x those so Retina screens get a sharp image and nothing bigger
is ever sent.
"""
import os, sys
from PIL import Image

DERIV = ('-420.webp', '-840.webp')


def load(src):
    im = Image.open(src)
    im.load()                       # read fully so we can overwrite src if asked
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGB')
    if im.mode == 'RGBA':           # flatten onto white — the site has no transparent art
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        im = bg
    return im


def fit_width(im, w):
    if im.width <= w:
        return im
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def crop_ratio(im, rw, rh):
    """Centre-crop to rw:rh without scaling."""
    target = rw / rh
    cur = im.width / im.height
    if abs(cur - target) < 1e-3:
        return im
    if cur > target:                # too wide
        nw = round(im.height * target)
        x = (im.width - nw) // 2
        return im.crop((x, 0, x + nw, im.height))
    nh = round(im.width / target)   # too tall
    y = (im.height - nh) // 2
    return im.crop((0, y, im.width, y + nh))


def save(im, out, q=80, lossless=False):
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    im.save(out, 'WEBP', quality=q, method=6, lossless=lossless)
    print(f'{os.path.getsize(out):>8}  {im.width}x{im.height}  {out}')


def headshot(src):
    im = load(src)
    for w in (464, 696):
        save(fit_width(im, w), f'assets/headshot-{w}.webp', q=82)


def kitchen(srcs):
    for src in srcs:
        if src.endswith(DERIV):
            continue
        stem = os.path.splitext(os.path.basename(src))[0]
        im = load(src)
        save(fit_width(im, 840), f'assets/kitchen/{stem}-840.webp', q=78)
        save(fit_width(im, 420), f'assets/kitchen/{stem}-420.webp', q=80)


def lab(srcs):
    for src in srcs:
        stem = os.path.splitext(os.path.basename(src))[0]
        im = fit_width(crop_ratio(load(src), 16, 9), 960)
        save(im, f'assets/lab/{stem}.webp', q=82)


def chart(srcs):
    """Charts are flat colour with text: try lossless and q85, keep the smaller."""
    for src in srcs:
        stem = os.path.splitext(os.path.basename(src))[0]
        im = fit_width(load(src), 1600)
        out = f'assets/trading/{stem}.webp'
        tmp = out + '.tmp'
        im.save(tmp, 'WEBP', lossless=True, method=6)
        ll = os.path.getsize(tmp)
        im.save(out, 'WEBP', quality=85, method=6)
        if ll < os.path.getsize(out):
            os.replace(tmp, out)
        else:
            os.remove(tmp)
        print(f'{os.path.getsize(out):>8}  {im.width}x{im.height}  {out}')


def poster(src, out, w=800):
    save(fit_width(load(src), w), out, q=80)


if __name__ == '__main__':
    kind, args = (sys.argv[1] if len(sys.argv) > 1 else ''), sys.argv[2:]
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    if kind == 'headshot' and len(args) == 1: headshot(args[0])
    elif kind == 'kitchen' and args: kitchen(args)
    elif kind == 'lab' and args: lab(args)
    elif kind == 'chart' and args: chart(args)
    elif kind == 'poster' and len(args) in (2, 3): poster(args[0], args[1], int(args[2]) if len(args) == 3 else 800)
    else:
        sys.exit(__doc__)
