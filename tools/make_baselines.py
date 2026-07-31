"""Where each sprite's visible bottom actually is.

    python tools/make_baselines.py

A sprite is placed by its PLANE, and the plane's bottom edge is what sits on the
ground. But the art inside it does not reach that edge: the cut leaves padding,
and several sprites are drawn with air under them. The result is a chest, a
haystack and a house hovering a few centimetres above the floor.

So the alpha bounding box is measured here — the bottom of what is actually
painted, as a fraction of the image height — and written to
assets/baselines.json. The renderer drops each sprite by that fraction of its
own height, which puts the painted base on the ground no matter how much padding
the cut left.

Only the bottom is needed: the top, left and right of a billboard touch nothing.
"""

import json
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUT = ASSETS / "baselines.json"
ALPHA = 8


def bottom_gap(p):
    """Fraction of the image height that is empty below the art."""
    im = Image.open(p)
    if im.mode != "RGBA":
        return 0.0
    a = np.asarray(im.convert("RGBA"))[..., 3]
    rows = np.where((a > ALPHA).any(axis=1))[0]
    if not len(rows):
        return 0.0
    return float((a.shape[0] - 1 - rows.max()) / a.shape[0])


def main():
    data = {}
    for p in sorted(ASSETS.glob("*.webp")):
        gap = bottom_gap(p)
        if gap > 0.002:                      # below this it is rounding, not air
            data[p.stem] = round(gap, 4)
    OUT.write_text(json.dumps(data, indent=1, sort_keys=True), encoding="utf-8")

    print(f"{'спрайт':<18}{'пустоты снизу':>15}")
    print("-" * 34)
    for k in sorted(data, key=lambda k: -data[k])[:20]:
        print(f"{k:<18}{data[k]*100:14.1f}%")
    print("-" * 34)
    print(f"{len(data)} спрайтов с зазором -> {OUT.name}")


if __name__ == "__main__":
    main()
