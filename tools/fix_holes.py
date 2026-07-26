"""Punch background trapped INSIDE an object out of the final sprites.

    python tools/fix_holes.py [id ...]      (default: the 5 known-affected ids)

The corner flood only reaches background connected to the frame edge, so
background enclosed by the object — inside a bow's arc, between a weapon rack's
posts — stays opaque and shows up as a grey blob on any non-grey page. This
fills those cavities with the same tolerance as the cut (+-12 around the corner
median), then re-exports the sprite.

RULE. An enclosed region is background if its MEDIAN colour sits within
BG_TOL_MEDIAN of the backdrop, regardless of how large it is. The earlier
version carried a 5%-of-frame cap and an outline-contrast heuristic; both were
proxies, and the cap in particular left genuinely open areas opaque — the sky
between pine branches is far more than 5% of the frame. Colour is the direct
question, so colour is what is asked.

Anything whose median is NOT background-grey is left alone and logged, so a
grey object (an iron ore chunk, cobbles) cannot be punched through silently.

Rewrites out/site_assets/final/<id>.png in place; every decision is printed.
"""

import json
import pathlib
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

PIPELINE = pathlib.Path(r"D:\Dev\pixelart-pipeline")
sys.path.insert(0, str(PIPELINE / "scripts"))
import acceptance_metrics as M  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "out" / "site_assets"
RAW = SITE / "_raw"
FINAL = SITE / "final"

DEFAULT_IDS = None          # None -> every sprite in final/
PAD = 8
MIN_REGION = 0.0008         # ignore specks below this share of the frame
BG_TOL_MEDIAN = 16          # a region counts as background if its MEDIAN sits
                            # within this per-channel distance of the backdrop


def source_frame(tid):
    """The raw frame this sprite was cut from, per report.json."""
    rep = json.loads((SITE / "report.json").read_text(encoding="utf-8"))
    stem = rep["tasks"][tid]["chosen"]
    for cand in (RAW / tid / f"{stem}.png", RAW / f"{tid}_v2" / f"{stem}.png"):
        if cand.exists():
            return cand
    raise FileNotFoundError(f"нет исходника для {tid} ({stem})")


def fix(tid, src=None):
    src = src or source_frame(tid)
    rgb = np.asarray(Image.open(src).convert("RGB"))
    a = rgb.astype(np.int16)
    flood, _ = M.background_flood(a)

    corners = np.concatenate([
        a[:M.CORNER, :M.CORNER].reshape(-1, 3), a[:M.CORNER, -M.CORNER:].reshape(-1, 3),
        a[-M.CORNER:, :M.CORNER].reshape(-1, 3), a[-M.CORNER:, -M.CORNER:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    dist = np.abs(a - bg).max(axis=2)
    near_bg = dist <= M.BG_TOL

    enclosed = near_bg & ~flood
    lbl, n = ndimage.label(enclosed)
    px = rgb.shape[0] * rgb.shape[1]

    alpha_bg = flood.copy()
    filled = skipped = 0
    for i in range(1, n + 1):
        region = lbl == i
        share = region.sum() / px
        if share < MIN_REGION:
            continue
        # The test is now the region's own colour, not its size or its border:
        # if the median of an enclosed region sits within BG_TOL_MEDIAN of the
        # backdrop, it IS backdrop and must come out — however large it is. The
        # old 5%-of-frame cap was arbitrary and left real holes (pine crowns,
        # the gaps between bare branches) opaque.
        med = np.median(a[region], axis=0)
        dist = float(np.abs(med - bg).max())
        if dist > BG_TOL_MEDIAN:
            print(f"    ПРОПУСК не фон: медиана отходит на {dist:.0f} (>{BG_TOL_MEDIAN}), "
                  f"область {share*100:.2f}%")
            skipped += 1
            continue
        alpha_bg |= region
        filled += 1
        print(f"    залито {share*100:.2f}% кадра  дельта медианы {dist:.0f}")

    obj = ~alpha_bg
    if not obj.any():
        print("    !! пустой объект, файл не тронут")
        return 0, skipped
    rgba = np.dstack([rgb, (obj * 255).astype(np.uint8)])
    ys, xs = np.where(obj)
    y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + 1 + PAD, rgba.shape[0])
    x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + 1 + PAD, rgba.shape[1])
    FINAL.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA").save(FINAL / f"{tid}.png")
    return filled, skipped


def main():
    ids = sys.argv[1:] or sorted(p.stem for p in FINAL.glob("*.png"))
    tot_f = tot_s = 0
    for tid in ids:
        print(f"{tid}:")
        f, s = fix(tid)
        tot_f += f
        tot_s += s
        if not f and not s:
            print("    замкнутых областей не найдено")
    print(f"\nзалито областей {tot_f}, пропущено по защите {tot_s}")


if __name__ == "__main__":
    main()
