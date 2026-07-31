"""Build the web-ready asset set from out/site_assets/final/.

    python tools/export_web.py

For every sprite: WebP q85 (what browsers actually load) plus a PNG fallback at
the same pixel width, names preserved. Widths follow the role of the sprite on
the page, not its source size:

    hero_*  560px   composed into the hero scene
    feat_*  640px   the largest single element of a feature card
    res_*   224px   pictogram in the resource strip
    prop_*  360px   small dressing on the hero road (~120-180px on screen)
    biome_* 560px   scenery in the journey biomes (up to ~450px on screen)

Also emits the favicon set from res_diamond and the 1200x630 og:image.
Everything lands in assets/; the site never reads out/.
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Package the graded copies (defringed + colour-graded by grade_sprites.py);
# fall back to the ungraded masters if that pass has not been run.
_MASTER = ROOT / "out" / "site_assets" / "final"
_GRADED = ROOT / "out" / "site_assets" / "final_web"
FINAL = _GRADED if _GRADED.is_dir() else _MASTER
ASSETS = ROOT / "assets"

WIDTHS = {"hero_": 560, "feat_": 640, "res_": 224, "prop_": 360, "biome_": 560}
# the tavern is village dressing seen at a distance, and the village is the
# first frame — 640px of it was bought with the opening budget
WIDTH_OVERRIDE = {"feat_tavern": 448}
QUALITY = 85

# Sprites the page needs at a second size under a second name. The housing card
# reuses the hero farmhouse, but as a feature card it wants the 640px feature
# width, and a file can only carry one width per name.
ALIASES = {"feat_home": "hero_house_b"}

# Hero scene layout for the og:image: (sprite, centre x, baseline y, width).
# Mirrors the on-page composition closely enough to read as the same scene.
OG_LAYOUT = [
    ("hero_tree_a", 150, 470, 260),
    ("hero_house_b", 355, 430, 300),
    ("hero_well", 610, 470, 180),
    ("hero_house_a", 860, 425, 290),
    ("hero_tree_b", 1075, 480, 170),
    ("hero_cart", 690, 560, 230),
    ("hero_fence", 200, 570, 240),
]

SKY_TOP, SKY_BOT = (0x7E, 0xB8, 0xE0), (0xC7, 0xE6, 0xF2)
GRASS = [(0xA8, 0xCB, 0x53), (0xBD, 0xD8, 0x5A), (0xD1, 0xE2, 0x76)]
PATH = (0xF2, 0xCA, 0x78)


def width_for(name):
    for pref, w in WIDTHS.items():
        if name.startswith(pref):
            return w
    return 320


def sprites():
    return sorted(FINAL.glob("*.png"))


def export_sprites():
    ASSETS.mkdir(parents=True, exist_ok=True)
    rows = []
    jobs = [(p.stem, p) for p in sprites()]
    jobs += [(alias, FINAL / f"{src}.png") for alias, src in ALIASES.items()]
    for stem, p in jobs:
        w = width_for(stem)
        im = Image.open(p).convert("RGBA")
        h = max(1, round(im.height * w / im.width))
        im = im.resize((w, h), Image.LANCZOS)
        png, webp = ASSETS / f"{stem}.png", ASSETS / f"{stem}.webp"
        im.save(png, optimize=True)
        im.save(webp, quality=QUALITY, method=6)
        rows.append((stem, w, h, png.stat().st_size, webp.stat().st_size))
    return rows


def export_favicon():
    src = Image.open(FINAL / "res_diamond.png").convert("RGBA")
    side = max(src.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(src, ((side - src.width) // 2, (side - src.height) // 2), src)
    out = []
    for size, name in [(32, "favicon-32.png"), (180, "apple-touch-icon.png"),
                       (512, "icon-512.png")]:
        im = sq.resize((size, size), Image.LANCZOS)
        if name == "apple-touch-icon.png":      # iOS composites on black otherwise
            bg = Image.new("RGBA", im.size, (0xFD, 0xF6, 0xE0, 255))
            bg.paste(im, (0, 0), im)
            im = bg
        im.save(ASSETS / name, optimize=True)
        out.append(name)
    return out


def export_og():
    W, H = 1200, 630
    HORIZON = 250
    im = Image.new("RGB", (W, H))
    px = im.load()
    for y in range(H):                       # sky gradient, then flat grass bands
        if y < HORIZON:
            t = y / HORIZON
            px_row = tuple(round(SKY_TOP[i] + (SKY_BOT[i] - SKY_TOP[i]) * t) for i in range(3))
        else:
            t = (y - HORIZON) / (H - HORIZON)
            px_row = GRASS[0] if t < 0.25 else GRASS[1] if t < 0.6 else GRASS[2]
        for x in range(W):
            px[x, y] = px_row

    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    d.polygon([(0, H), (W, H), (W, H - 90), (0, H - 40)], fill=PATH)
    rnd = 1234567                            # deterministic speckles, no Date/random dep
    for _ in range(700):
        rnd = (rnd * 1103515245 + 12345) % (1 << 31)
        x = rnd % W
        rnd = (rnd * 1103515245 + 12345) % (1 << 31)
        y = HORIZON + rnd % (H - HORIZON)
        d.rectangle([x, y, x + 2, y + 2], fill=GRASS[(x + y) % 3])

    for name, cx, base, w in OG_LAYOUT:
        s = Image.open(FINAL / f"{name}.png").convert("RGBA")
        h = max(1, round(s.height * w / s.width))
        s = s.resize((w, h), Image.LANCZOS)
        im.paste(s, (cx - w // 2, base - h), s)

    im.save(ASSETS / "og.png", optimize=True)
    im.convert("RGB").save(ASSETS / "og.jpg", quality=88, optimize=True)
    return (ASSETS / "og.png").stat().st_size, (ASSETS / "og.jpg").stat().st_size


def main():
    rows = export_sprites()
    icons = export_favicon()
    og_png, og_jpg = export_og()

    print(f"{'sprite':<18}{'px':>10}{'png KB':>9}{'webp KB':>9}  экономия")
    tot_p = tot_w = 0
    for name, w, h, sp, sw in rows:
        tot_p += sp
        tot_w += sw
        print(f"{name:<18}{f'{w}x{h}':>10}{sp/1024:9.0f}{sw/1024:9.0f}"
              f"{(1-sw/sp)*100:9.0f}%")
    print(f"\n{len(rows)} спрайтов: PNG {tot_p/1024:.0f} KB -> WebP {tot_w/1024:.0f} KB")
    print(f"favicon: {', '.join(icons)}")
    print(f"og.png {og_png/1024:.0f} KB, og.jpg {og_jpg/1024:.0f} KB")


if __name__ == "__main__":
    main()
