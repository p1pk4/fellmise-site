"""Split a hinged door out of a gate sprite.

    python tools/make_door_layers.py          (run AFTER grade_sprites.py)

The village and crypt gates open their door before the camera falls through it.
That needs two layers in exact register:

    <art>_door.png  — the same canvas, everything transparent except the door
    <art>_open.png  — the same canvas with the door replaced by a lit opening

Keeping both at the full canvas size means the browser can stack them with no
offset maths, and the hinge is just a transform-origin in percentages.

The door rectangles were measured off the art by eye (tools/_doorgrid.png shows
the grid used); they are normalised, so they survive any re-export size.
"""

import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRADED = ROOT / "out" / "site_assets" / "final_web"

# id -> (x0, y0, x1, y1) as shares of the canvas, plus the warm interior colour
DOORS = {
    "hero_house_b": dict(rect=(0.410, 0.715, 0.553, 0.960), warm=(96, 58, 26)),
    "feat_death":   dict(rect=(0.487, 0.215, 0.632, 0.530), warm=(70, 46, 30)),
}


def build(name, spec):
    src = Image.open(GRADED / f"{name}.png").convert("RGBA")
    w, h = src.size
    x0, y0, x1, y1 = spec["rect"]
    px = (round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h))
    a = np.asarray(src).copy()

    # --- door layer: only the rectangle survives ---------------------------
    door = np.zeros_like(a)
    door[px[1]:px[3], px[0]:px[2]] = a[px[1]:px[3], px[0]:px[2]]
    Image.fromarray(door, "RGBA").save(GRADED / f"{name}_door.png")

    # --- body layer: the doorway becomes a lit interior --------------------
    body = a.copy()
    ph, pw = px[3] - px[1], px[2] - px[0]
    yy = np.linspace(0.0, 1.0, ph)[:, None]
    xx = np.linspace(-1.0, 1.0, pw)[None, :]
    # dark at the top and edges, warm glow low and central — reads as a room
    glow = np.clip(1.0 - (xx ** 2) * 0.85, 0, 1) * np.clip(yy * 1.25, 0, 1)
    warm = np.array(spec["warm"], dtype=np.float32)
    inner = warm[None, None, :] * (0.35 + 0.65 * glow[..., None])
    keep = a[px[1]:px[3], px[0]:px[2], 3:4] > 0        # stay inside the silhouette
    patch = np.where(keep, inner.astype(np.uint8), body[px[1]:px[3], px[0]:px[2], :3])
    body[px[1]:px[3], px[0]:px[2], :3] = patch
    Image.fromarray(body, "RGBA").save(GRADED / f"{name}_open.png")

    hinge = x0 * 100
    print(f"{name}: дверь {px[2]-px[0]}x{px[3]-px[1]}px, петля на {hinge:.1f}% ширины"
          f" -> {name}_door.png, {name}_open.png")


def main():
    for name, spec in DOORS.items():
        build(name, spec)


if __name__ == "__main__":
    main()
