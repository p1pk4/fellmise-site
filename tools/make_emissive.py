"""Cut emissive masks out of the sprites, so light has the shape of the thing.

    python tools/make_emissive.py            # write masks + a review sheet
    python tools/make_emissive.py --sheet    # only rebuild the sheet

Until now every light source was a round glow quad pinned in front of the
sprite: a brazier, a window and a crystal all bloomed as the same circle. Here
the glowing pixels are taken FROM the art, so the light carries the silhouette
of the flame, the pane, the facet.

Two outputs per source:
  <id>_em.webp     the emissive pixels alone, everything else transparent —
                   drawn additively on top of the sprite and the only thing the
                   bloom pass sees.
  <id>_bleed.webp  the same mask blurred wide and dimmed — the contact spill
                   that lets the light sit ON the bowl, the frame, the stone.

Selection is per-source, because "bright" alone is useless: a white highlight on
a roof is bright too. Each rule states the hue window and how bright and how
saturated a pixel must be to count, and every rule was checked against the sheet
this writes.
"""

import argparse
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets"
# assets/ is the source of truth; build_journey3.py pages copies it into
# public/. Writing straight to public/ meant the next `pages` run clobbered
# these with whatever stale copy assets/ still held — and the scene then
# asked for masks that no longer existed.
OUT = ROOT / "assets"
SHEET = ROOT / "out" / "night_report"

# hue is degrees 0..360; val/sat are 0..1. `grow` dilates the mask a little so
# the emissive covers the sprite's own dark outline around the glowing area.
RULES = {
    # fire: orange through yellow, and it must be genuinely bright
    "biome_brazier": dict(hue=(8, 62), val=0.55, sat=0.35, grow=1),
    # the portal surface plus the drops at its base — cyan/teal
    "biome_portal": dict(hue=(150, 205), val=0.45, sat=0.30, grow=1),
    # crystal facets — violet through magenta
    "biome_crystals": dict(hue=(255, 320), val=0.45, sat=0.28, grow=1),
    # lantern glass — warm yellow, small and bright
    "prop_lantern": dict(hue=(28, 62), val=0.62, sat=0.35, grow=1),
    # The two cottages had warm lit panes in the isometric art and have cool
    # daylight glass in the front-on regeneration — there is no light in them to
    # find. Left out rather than tuned: the rule was matching their sandy base.
    "feat_tavern": dict(hue=(28, 58), val=0.60, sat=0.38, grow=0),
    # The crypt had candles in the old art and has none in the new one: the
    # front-on regeneration is a plain stone facade with a wooden door. The rule
    # was still finding ~1500 warm pixels on the door and lighting them, which
    # is a glow with nothing behind it. Removed rather than tuned down.
    # the ore vein inside the cave mouth
    "biome_orevein": dict(hue=(150, 210), val=0.42, sat=0.28, grow=1),
    "feat_mining": dict(hue=(150, 210), val=0.42, sat=0.26, grow=1),
    # batch 7: the two new flames in the scene
    "lantern_chain": dict(hue=(28, 62), val=0.60, sat=0.35, grow=1),
    "candles": dict(hue=(20, 62), val=0.64, sat=0.30, grow=1),
}

# how each source behaves: fire flickers on noise, arcane light pulses slowly,
# a window or a lantern pane is simply on
KIND = {
    "biome_brazier": "fire",
    "biome_portal": "pulse", "biome_crystals": "pulse",
    "biome_orevein": "pulse", "feat_mining": "pulse",
    "prop_lantern": "steady",
    "feat_tavern": "steady",
    "lantern_chain": "steady", "candles": "fire",
}

MIN_PIXELS = 40          # below this the rule found nothing real
BLEED_BLUR = 9           # sigma for the contact spill
BLEED_GAIN = 0.55
BLEED_FLOOR = 0.16      # ниже этой доли от максимума заражения нет
# A mask that lives in the bottom sliver of the sprite is not a light, it is the
# ground plate the art is standing on — warm sand matches a window's hue window
# exactly. Caught here rather than in a screenshot: the front-on regeneration
# gave the houses cool glass and a warm base, and the old rules happily lit the
# base and called it a window.
BASE_BAND = 0.15        # нижняя доля высоты, которую считаем цоколем
# 0.75, не 0.5: у входа в шахту нижняя часть светится по-настоящему — там
# лужа света на полу штольни, и 60% маски внизу это верно. Отсекаем только
# случай «маска почти целиком цоколь», как у дома с песчаной подставкой (96%).
BASE_MAX = 0.75


def rgb_to_hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    idx = m & (mx == r)
    h[idx] = (60 * ((g - b)[idx] / d[idx]) + 360) % 360
    idx = m & (mx == g)
    h[idx] = 60 * ((b - r)[idx] / d[idx]) + 120
    idx = m & (mx == b)
    h[idx] = 60 * ((r - g)[idx] / d[idx]) + 240
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def build(name, rule):
    p = SRC / f"{name}.webp"
    if not p.exists():
        return None
    im = Image.open(p).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb = a[..., :3] / 255.0
    alpha = a[..., 3]

    h, s, v = rgb_to_hsv(rgb)
    lo, hi = rule["hue"]
    hue_ok = (h >= lo) & (h <= hi) if lo <= hi else ((h >= lo) | (h <= hi))
    mask = hue_ok & (v >= rule["val"]) & (s >= rule["sat"]) & (alpha > 8)

    # drop specks: a few stray pixels are noise, not a light source
    lbl, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lbl, range(1, n + 1))
        keep = [i + 1 for i, sz in enumerate(sizes) if sz >= 12]
        mask = np.isin(lbl, keep) if keep else np.zeros_like(mask)

    count = int(mask.sum())
    if count < MIN_PIXELS:
        return dict(name=name, count=count, ok=False)

    cut = int(mask.shape[0] * (1 - BASE_BAND))
    in_base = mask[cut:].sum() / max(count, 1)
    if in_base > BASE_MAX:
        return dict(name=name, count=count, ok=False,
                    why=f"{in_base*100:.0f}% маски в нижних {BASE_BAND*100:.0f}% "
                        f"высоты — это цоколь, а не источник")

    if rule.get("grow"):
        mask = ndimage.binary_dilation(mask, iterations=rule["grow"])

    # emissive: the lit pixels at their own colour, lifted toward white so the
    # bloom has something to work with
    em = np.zeros_like(a)
    lift = np.clip(rgb * 1.25 + 0.10, 0, 1)
    em[..., :3] = lift * 255
    em[..., 3] = mask * 255
    Image.fromarray(em.astype(np.uint8), "RGBA").save(OUT / f"{name}_em.webp",
                                                      quality=90, method=6)

    # Bleed: the same shape, blurred wide and dimmed — the spill ONTO THE
    # OBJECT. Clipped to the sprite's own silhouette, because a blur of a window
    # reaches past the wall it is in, and once the plane is stood upright that
    # overspill lands on the grass in front of the house as a bright patch.
    # Light belongs on the thing that emits it.
    blur = ndimage.gaussian_filter(mask.astype(np.float32), BLEED_BLUR)
    blur *= (alpha > 8)
    if blur.max() > 0:
        blur = blur / blur.max()
    # A gaussian has no edge: every pixel of the sprite ends up with SOME value,
    # and three percent of full brightness over a whole wall is a visible wash —
    # on a nine-metre house near the camera it read as the ground glowing. The
    # tail is cut so the spill stays where the light actually reaches.
    blur = np.clip((blur - BLEED_FLOOR) / (1.0 - BLEED_FLOOR), 0.0, 1.0)
    tint = (lift * mask[..., None]).reshape(-1, 3)
    lit = tint[mask.reshape(-1)]
    colour = lit.mean(axis=0) if len(lit) else np.array([1.0, 0.8, 0.5])
    bl = np.zeros_like(a)
    bl[..., :3] = colour * 255
    bl[..., 3] = np.clip(blur * 255 * BLEED_GAIN, 0, 255)
    Image.fromarray(bl.astype(np.uint8), "RGBA").save(OUT / f"{name}_bleed.webp",
                                                      quality=88, method=6)
    # How hard to add the emissive back over the art. Additive blending doubles
    # a pixel, so a source that is already large and bright — the ore stream, a
    # crystal cluster — blows out to white at full strength, losing its colour.
    # A lit window on a dark wall has the opposite problem and needs all of it.
    # So the strength falls with how much of the sprite is already glowing.
    cover = count / max(int((alpha > 8).sum()), 1)
    strength = float(np.clip(0.30 + 0.62 * (1 - cover * 4), 0.32, 0.88))
    return dict(name=name, count=count, ok=True, cover=round(float(cover), 3),
                strength=round(strength, 2),
                colour=tuple((colour * 255).round().astype(int)))


def sheet(results):
    """Off / on / with bleed, per source, on the dark bed the biomes use."""
    from PIL import ImageDraw
    good = [r for r in results if r and r["ok"]]
    T, PAD = 210, 10
    im = Image.new("RGB", (3 * T + 4 * PAD, len(good) * (T + 22) + PAD), (0x1E, 0x25, 0x28))
    d = ImageDraw.Draw(im)
    for row, r in enumerate(good):
        base = Image.open(SRC / f"{r['name']}.webp").convert("RGBA")
        em = Image.open(OUT / f"{r['name']}_em.webp").convert("RGBA")
        bleed = Image.open(OUT / f"{r['name']}_bleed.webp").convert("RGBA")
        y = PAD + row * (T + 22)
        for col, layers in enumerate(([base], [base, em], [bleed, base, em])):
            cell = Image.new("RGBA", base.size, (0x1E, 0x25, 0x28, 255))
            for L in layers:
                cell = Image.alpha_composite(cell, L)
            c = cell.convert("RGB")
            c.thumbnail((T - 8, T - 8))
            im.paste(c, (PAD + col * (T + PAD) + (T - c.width) // 2, y + (T - c.height) // 2))
        d.text((PAD, y + T + 4), f"{r['name']}   пикселей {r['count']}", fill=(240, 235, 220))
    d.text((PAD, 2), "выкл  /  вкл  /  с заражением", fill=(255, 220, 160))
    SHEET.mkdir(parents=True, exist_ok=True)
    out = SHEET / "b1_emissive_sheet.png"
    im.save(out)
    print(f"-> {out}  ({len(good)} источников)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    results = []
    for name, rule in RULES.items():
        r = build(name, rule)
        results.append(r)
        if r is None:
            print(f"{name:<18} НЕТ СПРАЙТА")
        elif r["ok"]:
            print(f"{name:<18} пикселей {r['count']:>6}  покрытие {r['cover']:.3f}"
                  f"  сила {r['strength']:.2f}  цвет {r['colour']}")
        else:
            print(f"{name:<18} ОТКЛОНЁН ({r['count']} px) — "
                  + r.get("why", "правило не поймало свет"))
    import json
    man = {r["name"]: {"kind": KIND.get(r["name"], "steady"),
                       "strength": r["strength"],
                       "colour": [int(c) for c in r["colour"]]}
           for r in results if r and r["ok"]}
    (OUT / "emissive.json").write_text(json.dumps(man, indent=1), encoding="utf-8")
    print(f"-> emissive.json ({len(man)} источников)")
    sheet(results)


if __name__ == "__main__":
    main()
