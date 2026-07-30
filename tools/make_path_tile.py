"""Cut a tileable path surface out of the road tile.

    python tools/make_path_tile.py

`tile_road` is a picture OF a road: a sand strip with grass painted along both
edges and flat background above and below. Repeated along the journey it laid
those grass edges across the path every few metres, and stretched over one
length it smeared a single green band down the middle of the frame. Neither is
a road.

So the sand interior is cut out on its own. The rows are classified by hue —
sand against grass — and the largest run of sand rows is kept, inset a little
so no grass fringe survives. With mirrored wrapping in the renderer the crop
tiles seamlessly in both directions without any blending work here.

No generation: this is the existing tile, cropped.
"""

import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "journey3" / "public" / "assets" / "tile_road.webp"
OUT = ROOT / "assets" / "tile_path.webp"
INSET = 0.06          # fraction of the band dropped at each edge, as insurance
QUALITY = 88


def main():
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    sand = (r > g) & (g > b) & (mx > 0.35) & ((mx - mn) > 0.10)
    share = sand.mean(axis=1)

    # longest run of rows that are mostly sand
    rows = share > 0.6
    best = (0, 0)
    i = 0
    while i < len(rows):
        if rows[i]:
            j = i
            while j < len(rows) and rows[j]:
                j += 1
            if j - i > best[1] - best[0]:
                best = (i, j)
            i = j
        else:
            i += 1
    y0, y1 = best
    if y1 - y0 < 16:
        raise SystemExit("не нашёл песчаную полосу в tile_road")
    pad = int((y1 - y0) * INSET)
    y0, y1 = y0 + pad, y1 - pad

    # the same treatment across, in case the strip does not span the full width
    cols = sand[y0:y1].mean(axis=0) > 0.6
    xs = np.where(cols)[0]
    x0, x1 = (int(xs.min()), int(xs.max()) + 1) if len(xs) else (0, im.width)
    padx = int((x1 - x0) * INSET)
    x0, x1 = x0 + padx, x1 - padx

    crop = im.crop((x0, y0, x1, y1))
    crop.save(OUT, quality=QUALITY, method=6)
    print(f"{SRC.name} {im.size} -> {OUT.name} {crop.size} "
          f"(строки {y0}..{y1}, столбцы {x0}..{x1})")
    print("рендер обязан включить MirroredRepeatWrapping — иначе будет шов")


if __name__ == "__main__":
    main()
