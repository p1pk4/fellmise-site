"""Defringe and colour-grade the whole sprite pack so it reads as one hand.

    python tools/grade_sprites.py            # build out/site_assets/final_web/
    python tools/grade_sprites.py --sheet    # + before/after contact sheets

Reads the ungraded masters in final/ and writes graded copies to final_web/,
which is what export_web.py packages. Grading in place would compound every
time this ran and would destroy the only clean copy; a separate output keeps
the operation idempotent and reversible.

1. DEFRINGE (colour decontamination).
   The brief specified the standard recipe — recolour pixels with alpha < 255
   from their nearest opaque neighbour. MEASURED FIRST: that is a no-op on this
   pack. The cutter writes `alpha = obj * 255`, so alpha is strictly binary —
   0 semi-transparent pixels in all 32 sprites — and there is nothing for the
   standard recipe to touch.

   The halo is real, it just lives one step further in: the generator
   anti-aliased its object against the grey backdrop, and the flood fill kept
   those blended pixels because they sit outside its ±12 background tolerance.
   They end up as a fully-opaque, too-light rim OUTSIDE the art's own dark
   outline. Measured on the masters, that outer ring averages 128-181 luma
   while the ring behind it (the intended outline) averages 62-143.

   The bleed is ~3px deep, so the fix repaints every opaque ring outside that
   depth from the clean interior — see defringe(). A first attempt that treated
   only the outermost ring made it worse: it sourced replacement colour from
   ring 2, which is contaminated too, and simply moved the halo outward.
   v3 adds a second test: grey rim against saturated interior. On the dark
   biome props the fringe is not lighter than the art, it is merely NEUTRAL
   against colour, which the luma test cannot see. ALPHA IS NEVER TOUCHED, as
   asked: the silhouette is bit-for-bit identical, only colour changes.

2. GRADE. One shared set of parameters for every sprite:
     * warm shift  — per-channel gain interpolated by luminance, lifting reds
       and pulling blues down, biased toward the site palette (path #f2ca78,
       roof #88362b) without touching the grass greens;
     * highlight rolloff — the top of the range is compressed ~10%, killing the
       blown specular hits that make generated art look plastic;
     * saturation levelling — the one place a per-sprite number is unavoidable,
       because "even out saturation" is by definition relative to the pack. The
       shared parameters are the TARGET (pack median) and the CAP; each sprite
       gets gain = clamp(target / its own mean, 0.88, 1.12), so no sprite moves
       far and the spread closes. Measured over opaque pixels only.
"""

import argparse
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
FINAL = ROOT / "out" / "site_assets" / "final"
GRADED = ROOT / "out" / "site_assets" / "final_web"

# --- shared grade parameters (identical for every sprite) -------------------
GAIN_SHADOW = np.array([1.045, 0.995, 0.940])   # warm the darks
GAIN_HIGH = np.array([1.020, 1.000, 0.972])     # keep the lights only slightly warm
HL_KNEE = 0.75          # luminance where highlight compression starts
HL_STRENGTH = 0.10      # -10% at full white -> inside the -8..12% brief
SAT_CAP = (0.88, 1.12)  # per-sprite saturation gain is clamped to this
LUMA = np.array([0.2126, 0.7152, 0.0722])


FRINGE_MARGIN = 12.0    # luma a rim pixel must exceed the clean interior by
FRINGE_DEPTH = 3        # how many pixels in the background bleed reaches
FRINGE_SAT_RIM = 0.15   # rim this desaturated ...
FRINGE_SAT_IN = 0.22    # ... against an interior this saturated is grey bleed
FRINGE_REF_DEPTH = 7    # where the 'interior' colour is SAMPLED for that test


def _sat(rgb):
    """HSV-style saturation of an HxWx3 float array."""
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    return np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)


def defringe(rgba):
    """Recolour the contaminated rim. Alpha is returned untouched.

    The bleed is about three pixels deep, not one. A single-ring pass sourced
    its replacement colour from ring 2 — which is contaminated too — so it
    propagated the halo outward instead of removing it (measured: after a
    one-ring pass, rings 1 and 2 sat at 157 and 154 luma against an interior of
    118). So the clean source is taken from FRINGE_DEPTH pixels in, and every
    ring outside that is repainted from it in one go.

    Two independent tests mark a rim pixel as contaminated; either is enough:

      LUMA   — the pixel is lighter than the clean interior by FRINGE_MARGIN.
               Catches a pale halo on mid and dark art.
      GREY   — the pixel is desaturated (< FRINGE_SAT_RIM) while the interior
               behind it is saturated (> FRINGE_SAT_IN). The backdrop is neutral
               grey, so grey sitting against colour is bleed no matter how dark
               it is — this is the case the luma test misses on the dark biome
               props, where the fringe is the same brightness as the art.

    Genuinely bright or genuinely grey art is untouched: a sword blade fails the
    grey test (its interior is also desaturated) and a stone fails it for the
    same reason, while neither is lighter than its own interior.
    """
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3]
    obj = alpha > 0
    if not obj.any():
        return rgba.copy()

    # textbook path, kept for any sprite that ever ships with soft alpha
    solid = alpha == 255
    if solid.any() and not solid.all():
        _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
        rgb = np.where(solid[..., None], rgb, rgb[iy, ix])

    depth = FRINGE_DEPTH
    inner = ndimage.binary_erosion(obj, iterations=depth)
    while depth > 1 and not inner.any():          # thin sprite: back off
        depth -= 1
        inner = ndimage.binary_erosion(obj, iterations=depth)
    if not inner.any():
        return np.dstack([rgb.astype(np.uint8), alpha])

    _, (jy, jx) = ndimage.distance_transform_edt(~inner, return_indices=True)
    clean = rgb[jy, jx]           # what the rim is REPAINTED with (keeps the outline)

    # The saturation reference must be sampled deeper than the replacement: at
    # depth 3 the sample lands on the art's own dark outline, which is itself
    # desaturated, so the grey test could never fire. Sampling past the outline
    # asks the right question ("is there colour behind this rim?") while the
    # repaint still comes from the outline, so outlines survive.
    ref_d = FRINGE_REF_DEPTH
    ref_mask = ndimage.binary_erosion(obj, iterations=ref_d)
    while ref_d > depth and not ref_mask.any():
        ref_d -= 1
        ref_mask = ndimage.binary_erosion(obj, iterations=ref_d)
    if ref_mask.any():
        _, (ky, kx) = ndimage.distance_transform_edt(~ref_mask, return_indices=True)
        ref = rgb[ky, kx]
    else:
        ref = clean

    rim = obj & ~inner
    by_luma = (rgb @ LUMA) > (clean @ LUMA) + FRINGE_MARGIN
    by_grey = (_sat(rgb / 255.0) < FRINGE_SAT_RIM) & (_sat(ref / 255.0) > FRINGE_SAT_IN)
    contaminated = rim & (by_luma | by_grey)

    rgb = np.where(contaminated[..., None], clean, rgb)
    return np.dstack([rgb.astype(np.uint8), alpha])


def mean_saturation(rgb01, mask):
    """Mean HSV-style saturation over the masked pixels."""
    if not mask.any():
        return 0.0
    px = rgb01[mask]
    mx = px.max(axis=1)
    mn = px.min(axis=1)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    return float(sat.mean())


def grade(rgba, sat_gain):
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    alpha = rgba[..., 3]

    lum = rgb @ LUMA
    t = np.clip(lum, 0, 1)[..., None]
    gain = GAIN_SHADOW * (1 - t) + GAIN_HIGH * t
    rgb = rgb * gain

    # highlight rolloff above the knee
    lum2 = np.clip(rgb @ LUMA, 0, None)
    over = np.clip((lum2 - HL_KNEE) / (1.0 - HL_KNEE), 0, 1)[..., None]
    rgb = rgb * (1.0 - HL_STRENGTH * over)

    # luma-preserving saturation
    l3 = (rgb @ LUMA)[..., None]
    rgb = l3 + (rgb - l3) * sat_gain

    rgb = np.clip(rgb, 0, 1)
    return np.dstack([(rgb * 255).round().astype(np.uint8), alpha])


def load(p):
    return np.asarray(Image.open(p).convert("RGBA"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true", help="write before/after contact sheets")
    args = ap.parse_args()

    srcs = sorted(FINAL.glob("*.png"))
    if not srcs:
        raise SystemExit(f"нет спрайтов в {FINAL}")

    # pass 1 — defringe, and measure saturation to find the pack target
    stage = {}
    sats = []
    for p in srcs:
        d = defringe(load(p))
        stage[p.stem] = d
        rgb01 = d[..., :3].astype(np.float32) / 255.0
        s = mean_saturation(rgb01, d[..., 3] > 8)
        sats.append(s)
    target = float(np.median(sats))
    print(f"насыщенность: медиана пака {target:.3f}, разброс {min(sats):.3f}..{max(sats):.3f}")

    # pass 2 — grade with the shared parameters + the clamped per-sprite gain
    GRADED.mkdir(parents=True, exist_ok=True)
    moved = []
    for p, s in zip(srcs, sats):
        gain = float(np.clip(target / s, *SAT_CAP)) if s > 1e-6 else 1.0
        out = grade(stage[p.stem], gain)
        Image.fromarray(out, mode="RGBA").save(GRADED / p.name)
        moved.append((p.stem, s, gain))

    after = []
    for p in srcs:
        a = load(GRADED / p.name)
        after.append(mean_saturation(a[..., :3].astype(np.float32) / 255.0, a[..., 3] > 8))
    print(f"после: разброс {min(after):.3f}..{max(after):.3f} "
          f"(σ {np.std(sats):.4f} -> {np.std(after):.4f})")
    clamped = [m for m in moved if m[2] in SAT_CAP]
    print(f"{len(srcs)} спрайтов -> {GRADED}"
          + (f"; упёрлись в кап: {len(clamped)}" if clamped else ""))

    if args.sheet:
        sheet(srcs)


def sheet(srcs):
    """Two contact sheets, same layout, for an A/B flip."""
    from PIL import ImageDraw
    T, COLS = 190, 6
    rows = (len(srcs) + COLS - 1) // COLS
    for label, folder in (("before", FINAL), ("after", GRADED)):
        im = Image.new("RGB", (COLS * T, rows * (T + 14)), (250, 250, 248))
        d = ImageDraw.Draw(im)
        for i, p in enumerate(srcs):
            s = Image.open(folder / p.name).convert("RGBA")
            s.thumbnail((T - 8, T - 8))
            tile = Image.new("RGBA", (T - 8, T - 8), (255, 255, 255, 255))
            tile.paste(s, ((T - 8 - s.width) // 2, (T - 8 - s.height) // 2), s)
            x, y = (i % COLS) * T, (i // COLS) * (T + 14)
            im.paste(tile.convert("RGB"), (x + 4, y + 4))
            d.text((x + 6, y + T + 1), p.stem, fill=(40, 40, 40))
        out = FINAL.parent / f"_grade_{label}.png"
        im.save(out)
        print(f"-> {out}")


if __name__ == "__main__":
    main()
