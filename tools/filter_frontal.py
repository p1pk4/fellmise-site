"""Filter the frontal regeneration and lay it out for a viewpoint call.

    python tools/filter_frontal.py            # gate + sheets
    python tools/filter_frontal.py --ship     # cut, defringe, grade, export

The gate is the pipeline's own usability metric, imported rather than
reimplemented. But the pick is NOT by sharpness this time: the whole point of
the batch is the ANGLE, and sharpness is blind to it — a crisp roof seen from
above scores better than a slightly soft facade, and the roof is exactly what
must go.

So this writes one sheet per object with all four seeds side by side, and the
seed is chosen by eye and recorded in PICKS with a reason. Until a pick is
recorded, the object ships nothing: a silent fallback to "sharpest" would put
the isometric frame straight back into the pack.
"""

import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pipeline  # noqa: E402
import acceptance_metrics as M  # noqa: E402
from gen_frontal import SEEDS, TASKS  # noqa: E402
from grade_sprites import SAT_CAP, defringe, grade, load, mean_saturation  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
FINAL = ROOT / "out" / "site_assets" / "final"
GRADED = ROOT / "out" / "site_assets" / "final_web"
ASSETS = ROOT / "assets"
SHEET = ROOT / "out" / "night_report"
PAD = 8
QUALITY = 85

# Export widths, by role in the scene. Same table the earlier batches used.
WIDTH = {
    "hero_house_a": 560, "hero_house_b": 560, "barn": 480, "feat_tavern": 448,
    "hero_well": 560, "hero_cart": 560, "haystack": 300, "prop_crates": 360,
    "chest": 340, "feat_craft": 640, "feat_death": 640, "feat_death_alt": 560,
    "feat_vendetta": 640, "feat_mining": 640, "biome_brazier": 560,
    "biome_crystals": 560, "biome_stump": 560, "grave_c": 300,
    "minecart": 380, "ore_pile": 300, "rock_s": 320, "rock_m": 320,
    "rock_l": 320, "stalagmite_a": 300, "stalagmite_b": 300, "beam_frame": 560,
}

# id -> (seed, why). By eye, off h_frontal_dark.png, on the ANGLE.
#
# The template did NOT force the viewpoint across the board. The LoRA is trained
# on isometric assets and that training wins: tall, compact subjects came back
# face-on, wide buildings sitting on a ground plate did not. Six ids are absent
# from this table on purpose — they are still isometric and go to a second pass
# with a harder prompt, see SECOND_PASS.
PICKS = {
    # --- came back genuinely front-on ------------------------------------
    "feat_vendetta": (3003, "тотем строго фронтом, подставки нет"),
    "biome_crystals": (2002, "шпили фронтом, цоколь минимальный"),
    "biome_stump": (2002, "пень фронтом, без травяного пятачка"),
    "grave_c": (2002, "плита фронтом, подставка почти не видна"),
    "stalagmite_a": (2002, "шпиль фронтом, цоколь чище прочих"),
    "stalagmite_b": (2002, "второй силуэт, тоже фронт"),
    "feat_death": (1001, "фасад склепа прямо на камеру, верхняя грань не видна"),
    "feat_death_alt": (3003, "корабль в профиль — для биллборда это и есть фронт; без воды"),
    "chest": (3003, "сундук передней гранью, крышка почти не показывает верх"),
    "ore_pile": (2002, "куча — верхней грани как таковой нет"),
    "haystack": (2002, "рулон в профиль, торец на камеру"),
    "minecart": (3003, "вагонетка бортом, колёса читаются"),
    "feat_craft": (3003, "наковальня и колода фронтом"),
    "beam_frame": (3003, "АРКА С ПРОЁМОМ — переписанный промпт сработал, "
                         "под ней действительно можно пролететь"),
    # --- не идеал, но верхняя грань уже не доминирует --------------------
    "biome_brazier": (4004, "чаша сбоку, внутрь почти не смотрим"),
    "feat_mining": (4004, "скальная стена с жилой вместо взгляда в яму сверху"),
    "hero_well": (1001, "колодец почти фронтом, крыша плоская к камере"),
    "hero_cart": (3003, "телега бортом"),
    "barn": (1001, "самый фронтальный из четырёх, подставка узкая"),
    "feat_tavern": (1001, "фасад с окнами на камеру, крыша уходит назад"),
}

# Still three-quarter top-down on all four seeds. The prompt did not reach them:
# every one is a wide object whose base plate the model insists on drawing.
SECOND_PASS = {
    "hero_house_a": "дом целиком в изометрии на всех сидах",
    "hero_house_b": "то же",
    "prop_crates": "ящики штабелем, верхняя грань доминирует",
    "rock_s": "моховая шапка сверху на всех сидах",
    "rock_m": "то же",
    "rock_l": "то же",
}


def font(sz):
    for n in ("segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(n, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def cut(src):
    rgb = np.asarray(Image.open(src).convert("RGB"))
    flood, _ = M.background_flood(rgb.astype(np.int16))
    obj = ~flood
    if not obj.any():
        return None
    rgba = np.dstack([rgb, (obj * 255).astype(np.uint8)])
    ys, xs = np.where(obj)
    y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + 1 + PAD, rgba.shape[0])
    x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + 1 + PAD, rgba.shape[1])
    return Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA")


def gate():
    rows = {}
    print(f"{'id':<16}{'годных':>8}  по сидам")
    print("-" * 60)
    for tid, _obj in TASKS:
        d = RAW / f"{tid}_front"
        per = {}
        for s in SEEDS:
            f = d / f"{tid}_{s}.png"
            if not f.exists():
                continue
            ok, share, blobs, edges = M.flood_usable(f)
            per[s] = {"ok": bool(ok), "share": round(float(share), 3),
                      "blobs": int(blobs), "edges": int(edges)}
        rows[tid] = per
        good = sum(1 for v in per.values() if v["ok"])
        marks = " ".join(f"{s}:{'+' if v['ok'] else '-'}{v['share']*100:.0f}%"
                         for s, v in per.items())
        print(f"{tid:<16}{good}/{len(per):<6}  {marks}")
    tot = sum(1 for p in rows.values() for v in p.values() if v["ok"])
    n = sum(len(p) for p in rows.values())
    print("-" * 60)
    print(f"кадров годных {tot}/{n} ({tot / max(n, 1) * 100:.0f}%)")
    return rows


def sheets(rows):
    """One row per object, four seeds across, on both beds — for the angle call."""
    C, GAP, LAB = 250, 8, 150
    for bed_name, bed, ink in (("cream", (253, 246, 224), (40, 42, 34)),
                               ("dark", (26, 30, 34), (238, 234, 222))):
        ids = [t for t, _ in TASKS]
        W = LAB + len(SEEDS) * (C + GAP) + GAP
        H = len(ids) * (C + 28) + GAP
        im = Image.new("RGB", (W, H), bed)
        d = ImageDraw.Draw(im)
        for r, tid in enumerate(ids):
            y = GAP + r * (C + 28)
            d.text((6, y + C // 2 - 8), tid, fill=ink, font=font(15))
            for c, s in enumerate(SEEDS):
                f = RAW / f"{tid}_front" / f"{tid}_{s}.png"
                x = LAB + c * (C + GAP)
                if not f.exists():
                    continue
                sp = cut(f)
                if sp is None:
                    continue
                cell = Image.alpha_composite(
                    Image.new("RGBA", sp.size, bed + (255,)), sp).convert("RGB")
                cell.thumbnail((C - 8, C - 8))
                im.paste(cell, (x + (C - cell.width) // 2, y + (C - cell.height) // 2))
                v = rows.get(tid, {}).get(s, {})
                d.text((x + 2, y + C + 4),
                       f"{s} · {'годен' if v.get('ok') else 'БРАК'} · фон {v.get('share', 0)*100:.0f}%",
                       fill=ink, font=font(13))
        out = SHEET / f"h_frontal_{bed_name}.png"
        SHEET.mkdir(parents=True, exist_ok=True)
        im.save(out)
        print(f"-> {out.name}  {im.size}")


def ship():
    if not PICKS:
        raise SystemExit("PICKS пуст — сначала посмотрите h_frontal_dark.png и "
                         "впишите выбранный сид с причиной для каждого id")
    old = [p for p in sorted(GRADED.glob("*.png")) if p.stem not in PICKS]
    target = float(np.median([
        mean_saturation(load(p)[..., :3].astype(np.float32) / 255.0, load(p)[..., 3] > 8)
        for p in old]))
    print(f"цель насыщенности из пака ({len(old)} спрайтов): {target:.3f}\n")

    report = {}
    for tid, (seed, why) in PICKS.items():
        src = RAW / f"{tid}_front" / f"{tid}_{seed}.png"
        if not src.exists():
            print(f"  [!] {tid}: нет кадра {src.name}")
            continue
        sp = cut(src)
        sp.save(FINAL / f"{tid}.png")
        dfr = defringe(np.asarray(sp))
        sat = mean_saturation(dfr[..., :3].astype(np.float32) / 255.0, dfr[..., 3] > 8)
        gain = float(np.clip(target / sat, *SAT_CAP)) if sat > 1e-6 else 1.0
        out = grade(dfr, gain)
        Image.fromarray(out, mode="RGBA").save(GRADED / f"{tid}.png")

        w = WIDTH.get(tid, 400)
        im = Image.fromarray(out, mode="RGBA")
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(ASSETS / f"{tid}.webp", quality=QUALITY, method=6)
        print(f"  {tid:<16} сид {seed}  -> {im.width}px")
        report[tid] = {"seed": seed, "why": why, "width": im.width}

    (ROOT / "out" / "site_assets" / "frontal.json").write_text(
        json.dumps({"lora": "fellmise_sprite_v2", "weight": 0.7,
                    "template": "front view, slightly elevated camera angle, not isometric",
                    "picks": report}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{len(report)} спрайтов заменено в assets/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ship", action="store_true")
    args = ap.parse_args()
    rows = gate()
    if args.ship:
        ship()
    else:
        sheets(rows)


if __name__ == "__main__":
    main()
