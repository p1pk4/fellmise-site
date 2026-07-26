"""Punch background trapped INSIDE an object out of the final sprites.

    python tools/fix_holes.py [id ...]      (default: the 5 known-affected ids)

The corner flood only reaches background connected to the frame edge, so
background enclosed by the object — inside a bow's arc, between a weapon rack's
posts — stays opaque and shows up as a grey blob on any non-grey page. This
fills those cavities with the same tolerance as the cut (+-12 around the corner
median), then re-exports the sprite.

GUARDS (protecting against punching a hole through the object itself)

  area      a region larger than 5% of the frame is not treated as a cavity.

  border    the spec asked to skip a region whose perimeter borders object
            pixels on >60%. That test cannot discriminate here: a region is
            "enclosed" precisely because it is NOT connected to the outer
            flood, so every neighbouring pixel is an object pixel and the
            figure is ~100% for every genuine cavity — applying it literally
            would skip all of them and disable the fix. The number is still
            computed and logged (obj% column) so the degeneracy is visible.
            What actually distinguishes a real cavity from a background-grey
            patch OF the object is the outline: this style draws a dark, high
            contrast border around every shape, so a true cavity is ringed by
            pixels far from the background colour, while a grey facet of a grey
            object fades into it. So the guard applied is: at least 60% of the
            region's perimeter must differ from the background by more than
            STRONG per channel. Regions failing it are left opaque and logged.

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

DEFAULT_IDS = ["feat_skills", "res_bow", "hero_well", "hero_cart", "feat_world"]
PAD = 8
MIN_REGION = 0.0015      # ignore specks below this share of the frame
MAX_REGION = 0.05        # spec guard: never treat >5% of the frame as a cavity
STRONG = 30              # per-channel distance from bg that counts as a real outline
MIN_BORDER = 0.60        # share of the perimeter that must be a real outline
BAND = 4                 # px sampled outward from the region (clears the anti-alias ramp)


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
        ring = ndimage.binary_dilation(region) & ~region
        obj_frac = float((~flood & ~region)[ring].mean()) if ring.any() else 0.0
        # Sample a BAND, not the 1px ring: the pixels immediately outside a
        # cavity are the anti-aliased ramp off the outline (dist barely over
        # the +-12 tolerance), so a 1px ring reads soft even around a hard
        # black outline. A few px out the real outline is inside the sample.
        band = ndimage.binary_dilation(region, iterations=BAND) & ~region
        border_frac = float((dist[band] > STRONG).mean()) if band.any() else 0.0

        if share > MAX_REGION:
            print(f"    ПРОПУСК область {share*100:.2f}% кадра (>5%), "
                  f"obj%={obj_frac*100:.0f} outline%={border_frac*100:.0f}")
            skipped += 1
            continue
        if border_frac < MIN_BORDER:
            print(f"    ПРОПУСК слабый контур: outline%={border_frac*100:.0f} "
                  f"(<{MIN_BORDER*100:.0f}), область {share*100:.2f}%, obj%={obj_frac*100:.0f}")
            skipped += 1
            continue
        alpha_bg |= region
        filled += 1
        print(f"    залито {share*100:.2f}% кадра  obj%={obj_frac*100:.0f} "
              f"outline%={border_frac*100:.0f}")

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
    ids = sys.argv[1:] or DEFAULT_IDS
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
