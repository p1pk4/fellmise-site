"""The post a fence ends on.

    python tools/make_end_post.py

A run of fence has to stop somewhere. Stopping in mid-air reads as a bug, so
each end either butts into a building or gets a post — and the post has to be
the SAME post the fence already ends on, or the join shows.

`hero_fence` is drawn with a round post at each end, so the post is cut out of
it rather than drawn or generated fresh: same line weight, same palette, same
light direction, and it stays matched if the fence art is ever replaced.

The cut is found rather than typed in: the fence's alpha is scanned column by
column, and the post is the tall block at the left edge — it runs the full
height of the art, while the rails between the posts do not.
"""

import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SRC = ASSETS / "hero_fence.webp"
OUT = ASSETS / "end_post.webp"
ALPHA = 8


def main():
    im = Image.open(SRC).convert("RGBA")
    a = np.asarray(im)[..., 3]
    h, w = a.shape

    # how much of each column is painted; the posts are the full-height ones
    fill = (a > ALPHA).sum(axis=0) / h
    tall = fill > 0.80
    if not tall.any():
        raise SystemExit("в hero_fence не нашлось столба во всю высоту")

    # the left post: from the first painted column to where the tall block ends
    painted = np.where(fill > 0.02)[0]
    x0 = int(painted.min())
    idx = np.where(tall)[0]
    end = int(idx[0])
    for i in idx:
        if i - end > 3:                 # a gap means we left the post
            break
        end = int(i)
    x1 = end + 1

    post = im.crop((x0, 0, x1, h))
    # trim to what is actually painted, so the plane is the post and nothing else
    pa = np.asarray(post)[..., 3]
    rows = np.where((pa > ALPHA).any(axis=1))[0]
    cols = np.where((pa > ALPHA).any(axis=0))[0]
    post = post.crop((int(cols.min()), int(rows.min()),
                      int(cols.max()) + 1, int(rows.max()) + 1))

    post.save(OUT, "WEBP", quality=92, method=6)
    print(f"столб вырезан из {SRC.name}: колонки {x0}..{x1} из {w}, "
          f"итог {post.width}x{post.height} -> assets/{OUT.name}")


if __name__ == "__main__":
    main()
