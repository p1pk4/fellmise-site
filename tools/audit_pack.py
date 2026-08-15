"""Fitness audit of the sprite pack for a billboard scene.

    python tools/audit_pack.py

The journey draws every sprite as a vertical plane facing the camera, and the
camera looks along the ground roughly horizontally. A sprite drawn FRONT-ON
works: what you see is what a person standing there would see. A sprite drawn in
three-quarter top-down does not — it shows its roof, the top of its base plate,
the inside of its bowl — and once that plane is stood upright the object reads as
tilted back and hovering. That is the same defect that has been chased through
several passes as "levitation" and "the thing is not sitting on the ground".

So the audit has one axis that matters: VIEWPOINT.

  фронт          drawn face-on. Works as a billboard.
  изометрия      drawn from above at an angle. Its top faces are visible, and on
                 a vertical plane they point at the sky.
  плоский        no viewpoint at all — a cloud, the moon, an inventory icon.
                 Nothing to be wrong.

The viewpoint column is set BY EYE, from out/night_report/g_audit_*.png, and the
call is recorded here per id rather than guessed at by an algorithm: no cheap
measurement separates "roof visible" from "steep front".

The verdict then follows from where the sprite is actually used:

  ok             front or flat; or isometric but never seen at ground level
                 (a counter icon, a backdrop past the fog).
  перегенерить   isometric AND standing on the ground in a scene. This is the
                 list to regenerate, front-on.
  не использовать isometric with no front-on equivalent worth making — better
                 replaced by something else than redrawn.

Nothing is regenerated here. This produces the table and the sheets to approve.
"""

import json
import pathlib
from collections import defaultdict

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
LAYOUT = ASSETS / "layout.json"
OUT = ROOT / "out" / "night_report"

FRONT, ISO, FLAT = "фронт", "изометрия", "плоский"

# Set by eye off g_audit_dark.png. Where a sprite is mixed — a front-on subject
# on a base plate drawn from above — it counts as isometric, because the base is
# exactly the part that betrays the angle when the plane is stood up.
VIEW = {
    # --- flat: no viewpoint to be wrong ------------------------------------
    "cloud_a": FLAT, "cloud_b": FLAT, "cloud_c": FLAT, "moon": FLAT,
    "res_axe": FLAT, "res_bow": FLAT, "res_dagger": FLAT, "res_diamond": FLAT,
    "res_fish": FLAT, "res_gold": FLAT, "res_herbs": FLAT, "res_iron": FLAT,
    "res_pickaxe": FLAT, "res_potion": FLAT, "res_runes": FLAT,
    "res_shield": FLAT, "res_spellbook": FLAT, "res_staff": FLAT,
    "res_sword": FLAT, "res_wood": FLAT,
    # --- front-on: these are the ones the scene can actually use ------------
    "biome_deadtree": FRONT, "biome_pine_a": FRONT, "biome_pine_b": FRONT,
    "hero_tree_a": FRONT, "hero_tree_b": FRONT, "branch_canopy": FRONT,
    "fern": FRONT, "grass_tuft_a": FRONT, "grass_tuft_b": FRONT,
    "mushrooms": FRONT, "candles": FRONT,
    "fence_seg": FRONT, "hero_fence": FRONT,
    "prop_lantern": FRONT, "prop_signpost": FRONT, "lantern_chain": FRONT,
    "feat_pvp": FRONT, "feat_skills": FRONT,
    "grave_a": FRONT, "grave_b": FRONT,
    "biome_orevein": FRONT, "hill_dark": FRONT,
    # --- three-quarter top-down --------------------------------------------
    "barn": ISO, "beam_frame": ISO, "biome_brazier": ISO, "biome_crystals": ISO,
    "biome_portal": ISO, "biome_stump": ISO, "chest": ISO,
    "feat_craft": ISO, "feat_death": ISO, "feat_death_alt": ISO,
    "feat_home": ISO, "feat_mining": ISO, "feat_tavern": ISO,
    "feat_vendetta": ISO, "feat_world": ISO,
    "grave_c": ISO, "haystack": ISO, "hero_cart": ISO,
    "hero_house_a": ISO, "hero_house_b": ISO, "hero_well": ISO,
    "hill_green": ISO, "minecart": ISO, "ore_pile": ISO,
    "prop_crates": ISO, "prop_stones": ISO,
    "rock_l": ISO, "rock_m": ISO, "rock_s": ISO,
    "stalagmite_a": ISO, "stalagmite_b": ISO,
}

# Isometric, but never seen standing on the ground beside the camera, so the
# angle costs nothing. Each one says why.
FORGIVEN = {
    "hill_green": "задник за линией горизонта, ниже уровня земли — верхняя грань не видна",
    "feat_world": "прилавок, стоит боком к дороге; купол вида сверху читается как навес",
    "res_iron": "лежит на прилавке", "res_gold": "лежит на прилавке",
    "res_diamond": "лежит на прилавке", "res_wood": "лежит на прилавке",
    "res_fish": "лежит на прилавке",
}

# Isometric with no front-on version worth making.
DROP = {
    "prop_stones": "дорожка камней сверху — на вертикальной плоскости это просто "
                   "пятно; в сцене её роль уже закрывают rock_s и grass_tuft",
    "beam_frame": "сплошной щит, а не арка: под ним не пролететь, а рядом он "
                  "читается воротами в никуда",
}


def usage():
    """Which biome each id actually stands in, from the shipping layout."""
    data = json.loads(LAYOUT.read_text(encoding="utf-8"))
    where = defaultdict(set)
    for bid, b in data["biomes"].items():
        for o in b.get("sprites", []):
            where[o["t"]].add(bid)
        c = b.get("counter")
        if c:
            where[c["stall"]["t"]].add(bid)
            for it in c["items"]:
                where[it].add(bid)
    return where


def verdict(sid, view, used):
    if view in (FLAT, FRONT):
        return "ok", ""
    if sid in DROP:
        return "не использовать", DROP[sid]
    if sid in FORGIVEN:
        return "ok", FORGIVEN[sid]
    if not used:
        return "ok", "в сцене не стоит — на полке"
    return "перегенерить", "изометрия на вертикальной плоскости: видна верхняя грань"


def font(sz):
    for n in ("segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(n, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def sheet(rows, name, only):
    items = [r for r in rows if r["verdict"] == only]
    if not items:
        return
    T, COLS, PAD, HEAD = 230, 6, 10, 52
    n = (len(items) + COLS - 1) // COLS
    for bed_name, bed, ink in (("cream", (253, 246, 224), (40, 42, 34)),
                               ("dark", (26, 30, 34), (238, 234, 222))):
        im = Image.new("RGB", (COLS * (T + PAD) + PAD, HEAD + n * (T + 42) + PAD), bed)
        d = ImageDraw.Draw(im)
        d.text((PAD, 14), f"{only.upper()} — {len(items)} шт", fill=ink, font=font(24))
        for i, r in enumerate(items):
            sp = Image.open(ASSETS / f"{r['id']}.webp").convert("RGBA")
            cell = Image.alpha_composite(Image.new("RGBA", sp.size, bed + (255,)), sp)
            cell = cell.convert("RGB")
            cell.thumbnail((T - 8, T - 8))
            x = PAD + (i % COLS) * (T + PAD)
            y = HEAD + (i // COLS) * (T + 42)
            im.paste(cell, (x + (T - cell.width) // 2, y + (T - cell.height) // 2))
            d.text((x + 2, y + T + 4), r["id"], fill=ink, font=font(14))
            d.text((x + 2, y + T + 22), f"{r['view']} · {', '.join(r['biomes']) or '—'}",
                   fill=ink, font=font(12))
        im.save(OUT / f"g_{name}_{bed_name}.png")
        print(f"-> g_{name}_{bed_name}.png")


def main():
    where = usage()
    ids = sorted(p.stem for p in ASSETS.glob("*.webp")
                 if not p.stem.endswith(("_em", "_bleed")) and not p.stem.startswith("tile_"))

    rows = []
    for sid in ids:
        view = VIEW.get(sid)
        if view is None:
            print(f"  [!] {sid} не классифицирован — добавьте в VIEW")
            view = "?"
        used = sorted(where.get(sid, ()))
        v, why = verdict(sid, view, used)
        rows.append({"id": sid, "view": view, "biomes": used, "verdict": v, "why": why})

    print(f"\n{'id':<18}{'ракурс':<12}{'биомы (по layout)':<30}{'вердикт':<16}примечание")
    print("-" * 118)
    for r in rows:
        print(f"{r['id']:<18}{r['view']:<12}{', '.join(r['biomes'])[:29]:<30}"
              f"{r['verdict']:<16}{r['why'][:44]}")

    by = defaultdict(int)
    for r in rows:
        by[r["verdict"]] += 1
    print("-" * 118)
    print("итого: " + " · ".join(f"{k} {v}" for k, v in sorted(by.items())))
    vb = defaultdict(int)
    for r in rows:
        vb[r["view"]] += 1
    print("ракурсы: " + " · ".join(f"{k} {v}" for k, v in sorted(vb.items())))

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "g_audit.json").write_text(
        json.dumps({"rows": rows, "totals": dict(by)}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    for name, only in (("regen", "перегенерить"), ("drop", "не использовать")):
        sheet(rows, name, only)
    print(f"-> {OUT/'g_audit.json'}")


if __name__ == "__main__":
    main()
