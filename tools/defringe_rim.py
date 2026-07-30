"""Damp the pale outline the model paints around every sprite.

    python tools/defringe_rim.py --check    # measure, change nothing
    python tools/defringe_rim.py            # fix assets/ in place

The generator draws objects as stickers: a light stroke runs all the way round
the silhouette. On a fir trunk the outermost ring measures 59% luminance against
19% inside. At native size it passes for a highlight; the moment the sprite is
filtered — down a mip chain, or through the occluder blur — that stroke spreads
and reads as a grey halo around everything.

It is damped, not cut. Each pixel within DEPTH of the edge is pulled towards the
colour of the nearest pixel that is genuinely inside the object, by an amount
that falls off with distance from the edge and that only applies where the pixel
is actually BRIGHTER than that reference — a legitimately lit rim keeps its
light, an unearned white stroke does not.

Thin structures are left alone on purpose. Where a bare branch is three pixels
across there is no interior to sample and no halo to speak of: the stroke IS the
branch. Those pixels are skipped rather than smeared with a colour fetched from
somewhere else in the image.

Alpha is never touched.
"""

import argparse
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
QUALITY = 90

DEPTH = 6           # how deep the stroke runs, in pixels
PAD = 4             # reference is sampled this much deeper than DEPTH
MARGIN = 0.05       # only damp pixels this much brighter than their reference
STRENGTH = 1.0      # how far a rim pixel is pulled at the very edge
REACH = DEPTH + PAD + 3   # beyond this the object is too thin to have an inside
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def defringe(rgba):
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    alpha = rgba[..., 3]
    solid = alpha > 8
    core = ndimage.binary_erosion(solid, iterations=DEPTH + PAD)
    if not core.any():
        return rgba, 0.0, 0

    # distance from the silhouette, and the nearest genuinely-inside colour
    dist = ndimage.distance_transform_edt(solid)
    core_d, idx = ndimage.distance_transform_edt(~core, return_distances=True,
                                                 return_indices=True)
    ref = rgb[tuple(idx)]

    band = solid & ~core & (core_d <= REACH)
    if not band.any():
        return rgba, 0.0, 0

    lum = rgb @ LUMA
    lum_ref = ref @ LUMA
    brighter = (lum - lum_ref) > MARGIN

    w = np.clip(1.0 - (dist - 1.0) / DEPTH, 0.0, 1.0) * STRENGTH
    w = np.where(band & brighter, w, 0.0)[..., None]

    before = float(lum[band & brighter].mean() * 100) if (band & brighter).any() else 0.0
    out = rgb * (1 - w) + ref * w
    after = float((out @ LUMA)[band & brighter].mean() * 100) if (band & brighter).any() else 0.0

    fixed = np.dstack([(np.clip(out, 0, 1) * 255).round().astype(np.uint8), alpha])
    return fixed, before - after, int((band & brighter).sum())


def rim_report(rgba):
    """Outermost ring vs interior, the number the defect was found by."""
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    solid = rgba[..., 3] > 8
    ring = solid & ~ndimage.binary_erosion(solid, iterations=2)
    inner = ndimage.binary_erosion(solid, iterations=10)
    if not ring.any() or not inner.any():
        return None
    lum = rgb @ LUMA
    return lum[ring].mean() * 100, lum[inner].mean() * 100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    files = sorted(ASSETS.glob("*.webp"))
    print(f"{'id':<18}{'кант':>7}{'нутро':>7}{'дельта':>8}   после")
    print("-" * 52)
    touched = 0
    for p in files:
        im = Image.open(p)
        if im.mode != "RGBA":
            continue
        a = np.asarray(im.convert("RGBA"))
        r = rim_report(a)
        if r is None:
            continue
        rim, inner = r
        if rim - inner < 8:                 # no halo worth touching
            continue
        fixed, drop, n = defringe(a)
        if not n:
            continue
        touched += 1
        if not args.check:
            Image.fromarray(fixed, mode="RGBA").save(p, quality=QUALITY, method=6)
            r2 = rim_report(np.asarray(Image.open(p).convert("RGBA")))
            after = f"{r2[0]:5.1f} / {r2[1]:5.1f}" if r2 else "—"
        else:
            after = f"-{drop:.1f} п.п."
        print(f"{p.stem:<18}{rim:7.1f}{inner:7.1f}{rim-inner:8.1f}   {after}")

    print("-" * 52)
    print(f"{'проверено' if args.check else 'обработано'}: {touched} спрайтов из {len(files)}")


if __name__ == "__main__":
    main()
