"""Bleed sprite colour into the transparent border, so filtering has no black to find.

    python tools/bleed_alpha.py            # fix assets/ in place
    python tools/bleed_alpha.py --check    # report only, change nothing

The cut leaves transparent pixels at RGB 0,0,0 and the WebP encoder leaves a few
thousand partly-transparent pixels along every silhouette. Neither matters while
a sprite is drawn at its own size — but the moment the GPU filters it, whether
down a mip chain or through the occluder blur, it averages the visible edge with
that black and the object gets a dark rim. That is the "grey outline on blur".

Straight alpha is kept; only the colour of pixels nobody can see is changed. The
opaque colour is grown outward by repeated nearest-neighbour dilation, so a
filtered edge samples the object instead of the void. Composited output at full
resolution is bit-for-bit what it was — alpha is never touched.
"""

import argparse
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
QUALITY = 90
DEPTH = 12          # how far the colour is grown; a mip chain reaches this far


def bleed(rgba, depth=DEPTH):
    rgb = rgba[..., :3].astype(np.uint8)
    alpha = rgba[..., 3]
    solid = alpha > 8
    if solid.all() or not solid.any():
        return rgba, 0

    # nearest opaque pixel for every pixel, in one pass
    idx = ndimage.distance_transform_edt(~solid, return_distances=False,
                                         return_indices=True)
    filled = rgb[tuple(idx)]
    reach = ndimage.distance_transform_edt(~solid) <= depth
    out = rgb.copy()
    out[~solid & reach] = filled[~solid & reach]
    # partly-transparent pixels carry the encoder's own colour, which is already
    # mixed with the void; give them the nearest solid colour too
    edge = solid & (alpha < 248)
    out[edge] = filled[edge]
    changed = int((~solid & reach).sum() + edge.sum())
    return np.dstack([out, alpha]), changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    files = sorted(ASSETS.glob("*.webp"))
    if not files:
        raise SystemExit(f"нет спрайтов в {ASSETS}")

    total = touched = 0
    for p in files:
        im = Image.open(p)
        if im.mode != "RGBA":
            continue
        a = np.asarray(im.convert("RGBA"))
        out, changed = bleed(a)
        if not changed:
            continue
        total += changed
        touched += 1
        if not args.check:
            Image.fromarray(out, mode="RGBA").save(p, quality=QUALITY, method=6)
    verb = "нашлось бы" if args.check else "залито"
    print(f"{verb} {total} пикселей в {touched} спрайтах из {len(files)}"
          f" (альфа не тронута, глубина {DEPTH}px)")


if __name__ == "__main__":
    main()
