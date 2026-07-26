"""Build the web-ready asset set from out/site_assets/final/.

    python tools/export_web.py

Every sprite ships as a responsive set: <stem>-480.webp, -768.webp, -1024.webp
for whichever of those the master can actually supply, plus a single PNG
fallback at the largest of them. The page picks a variant through srcset/sizes,
so a phone fetches the 480 and a desktop the 768 or 1024 — the role-based fixed
widths this used to emit sent the same bytes to both.

assets/manifest.json records which widths exist for each name; build_site.py
reads it to write srcset, so the two can never disagree.

Also emits the favicon set from res_diamond and the 1200x630 og:image.
Everything lands in assets/; the site never reads out/.
"""

import json
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Package the graded copies (defringed + colour-graded by grade_sprites.py);
# fall back to the ungraded masters if that pass has not been run.
_MASTER = ROOT / "out" / "site_assets" / "final"
_GRADED = ROOT / "out" / "site_assets" / "final_web"
FINAL = _GRADED if _GRADED.is_dir() else _MASTER
ASSETS = ROOT / "assets"

# Hero scene layout for the og:image: (sprite, centre x, baseline y, width).
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

# Responsive ladder. A variant is emitted only when the master is at least that
# wide — upscaling a generated sprite adds bytes and softness and buys nothing.
# NB: no master in this pack reaches 1024 (the widest is 913), because the cut
# crops to the object's bounding box. The previous "big sprites at 1024" rule
# was therefore upscaling every one of them; capping at the master fixes that.
LADDER = [480, 768, 1024]
QUALITY = 85
BIG_QUALITY = 88

# Sprites drawn large in a biome scene keep the higher quality setting.
BIG = {
    "hero_house_a", "hero_house_b", "hero_tree_a", "feat_tavern", "feat_death_alt",
    "feat_death", "biome_pine_a", "biome_pine_b", "biome_orevein", "biome_portal",
    "biome_crystals", "biome_deadtree", "biome_stump", "biome_brazier",
    "hero_house_b_door", "hero_house_b_open", "feat_death_door", "feat_death_open",
}

# Sprites the page needs at a second size under a second name.
ALIASES = {"feat_home": "hero_house_b"}


def sprites():
    return sorted(FINAL.glob("*.png"))


def widths_for(natural):
    """Ladder steps that do not exceed the master; at least the master itself."""
    ws = [w for w in LADDER if w <= natural]
    return ws or [natural]


def export_sprites():
    """Write <stem>-<w>.webp for each usable width plus one PNG fallback.

    Returns the manifest the page generator needs to write srcset: which widths
    exist for each name, and the intrinsic size of the fallback.
    """
    ASSETS.mkdir(parents=True, exist_ok=True)
    manifest = {}
    tot_w = tot_p = 0

    jobs = [(p.stem, p) for p in sprites()]
    jobs += [(alias, FINAL / f"{src}.png") for alias, src in ALIASES.items()]

    for stem, path in jobs:
        src = Image.open(path).convert("RGBA")
        q = BIG_QUALITY if stem in BIG else QUALITY
        ws = widths_for(src.width)
        for w in ws:
            h = max(1, round(src.height * w / src.width))
            im = src if w == src.width else src.resize((w, h), Image.LANCZOS)
            out = ASSETS / f"{stem}-{w}.webp"
            im.save(out, quality=q, method=6)
            tot_w += out.stat().st_size
        # one PNG fallback, at the largest width we actually produced
        top = ws[-1]
        h = max(1, round(src.height * top / src.width))
        png = ASSETS / f"{stem}.png"
        (src if top == src.width else src.resize((top, h), Image.LANCZOS)).save(png, optimize=True)
        tot_p += png.stat().st_size
        manifest[stem] = {"w": ws, "fallback": top, "width": top, "height": h}

    # tiles are CSS backgrounds; they get a small variant for phones
    for tile in ("tile_grass", "tile_dirt", "tile_spirit", "tile_road"):
        p = ASSETS / f"{tile}.webp"
        if not p.exists():
            continue
        im = Image.open(p).convert("RGB")
        small = min(480, im.width)
        if small < im.width:
            out = ASSETS / f"{tile}-{small}.webp"
            im.resize((small, round(im.height * small / im.width)), Image.LANCZOS) \
              .save(out, quality=82, method=6)
            manifest[tile] = {"w": [small, im.width], "fallback": im.width,
                              "width": im.width, "height": im.height}

    (ASSETS / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest, tot_w, tot_p


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
    manifest, tot_w, tot_p = export_sprites()
    icons = export_favicon()
    og_png, og_jpg = export_og()

    steps = {}
    for name, m in manifest.items():
        steps.setdefault(tuple(m["w"]), []).append(name)
    print("варианты по ширинам:")
    for ws, names in sorted(steps.items(), key=lambda kv: -len(kv[1])):
        print(f"  {str(list(ws)):<22} {len(names):>3} шт  напр. {', '.join(sorted(names)[:3])}")
    print(f"\n{len(manifest)} имён: WebP-варианты {tot_w/1024:.0f} KB, PNG-фолбэки {tot_p/1024:.0f} KB")
    print(f"favicon: {', '.join(icons)}")
    print(f"og.png {og_png/1024:.0f} KB, og.jpg {og_jpg/1024:.0f} KB")


if __name__ == "__main__":
    main()
