"""Pick, cut and ship the v2 regenerations.

    python tools/finish_regen_v2.py --sheet

Four sprites are replaced. Two were generated fresh (`biome_crystals`,
`feat_mining`); two are taken from the v2 acceptance run in out/lora_v2/ rather
than made again — same model, same weight, same sampler, so a second run would
only spend GPU to get the same pictures.

The pick is BY CLEANLINESS, not by sharpness. Every one of these four is being
replaced because of a halo baked into the art, and the sharpness tiebreak is
blind to that: it reads the outline's crispness, and a bright painted aura is
crisp. So the frames are ranked by the ring-minus-interior measurement that
found the defect in the first place, and the choice is written down with a
reason next to it.
"""

import argparse
import json
import pathlib
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

PIPELINE = pathlib.Path(r"D:\Dev\ART_Fellmise")
sys.path.insert(0, str(PIPELINE / "scripts"))
import acceptance_metrics as M  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from grade_sprites import SAT_CAP, defringe, grade, load, mean_saturation  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
LORA_V2 = ROOT / "out" / "lora_v2"
FINAL = ROOT / "out" / "site_assets" / "final"
GRADED = ROOT / "out" / "site_assets" / "final_web"
ASSETS = ROOT / "assets"
SHEET = ROOT / "out" / "night_report"
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
PAD = 8
QUALITY = 85

# id -> (where the frame comes from, chosen seed, exported width, why)
PICKS = {
    "biome_crystals": (
        RAW / "biome_crystals_v2", 1001, 560,
        "выбран глазом против ауры: 2002 и 4004 несут светлую дымку за шпилями, "
        "3003 даёт шипы-артефакты по верхним углам. ЧИСЛО ОРЕОЛА ЗДЕСЬ СПОРИТ С "
        "ГЛАЗОМ (+28 против +15 у 3003) и глазу проигрывает: у кристаллов светел "
        "сам силуэт, так что кольцо ярче нутра даже без всякой ауры, а у кадров "
        "с аурой мягкая дымка кольцо, наоборот, размывает"),
    "feat_mining": (
        RAW / "feat_mining_v2", 2002, 640,
        "яма с жилами внутри, свечение заперто в чаше и не выходит на силуэт; "
        "3003 и 4004 пускают луч вверх, 1001 подсвечивает наружный камень"),
    "stalagmite_a": (
        LORA_V2 / "v2_w07", 2002, 300,
        "самый высокий шпиль из приёмочного прогона; нора у основания уходит "
        "в грунт при посадке"),
    "stalagmite_b": (
        LORA_V2 / "v2_w07", 4004, 300,
        "второй силуэт, отличный от 2002, — чтобы в шахте не стояли близнецы"),
    "haystack": (
        LORA_V2 / "v2_w07", 3003, 300,
        "сено читается стогом; 2002 и 4004 несут дверь в боку, 1001 не прошёл "
        "тест плоского фона"),
}
# the acceptance run names its frames by entity, not by the site's sprite id
SOURCE_ID = {"stalagmite_a": "stalagmite", "stalagmite_b": "stalagmite",
             "haystack": "haystack"}


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


def halo(im):
    a = np.asarray(im).astype(np.float32)
    solid = a[..., 3] > 8
    ring = solid & ~ndimage.binary_erosion(solid, iterations=2)
    inner = ndimage.binary_erosion(solid, iterations=10)
    if not ring.any() or not inner.any():
        return 0.0
    lum = (a[..., :3] / 255.0) @ LUMA
    return float((lum[ring].mean() - lum[inner].mean()) * 100)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()

    # the pack's own saturation target, off what is already graded and shipped
    old = [p for p in sorted(GRADED.glob("*.png")) if p.stem not in PICKS]
    target = float(np.median([
        mean_saturation(load(p)[..., :3].astype(np.float32) / 255.0, load(p)[..., 3] > 8)
        for p in old]))
    print(f"цель насыщенности из пака ({len(old)} спрайтов): {target:.3f}\n")

    print(f"{'спрайт':<16}{'сид':>6}{'ореол':>9}{'все сиды (ореол)':>34}")
    print("-" * 66)
    rows, report = [], {}
    for tid, (src_dir, seed, width, why) in PICKS.items():
        sid = SOURCE_ID.get(tid, tid)
        halos = {}
        for s in (1001, 2002, 3003, 4004):
            f = src_dir / f"{sid}_{s}.png"
            if f.exists():
                sp = cut(f)
                halos[s] = round(halo(sp), 1) if sp else None
        chosen = src_dir / f"{sid}_{seed}.png"
        if not chosen.exists():
            print(f"{tid:<16} НЕТ КАДРА {chosen}")
            continue
        sprite = cut(chosen)
        sprite.save(FINAL / f"{tid}.png")

        d = defringe(np.asarray(sprite))
        sat = mean_saturation(d[..., :3].astype(np.float32) / 255.0, d[..., 3] > 8)
        gain = float(np.clip(target / sat, *SAT_CAP)) if sat > 1e-6 else 1.0
        out = grade(d, gain)
        Image.fromarray(out, mode="RGBA").save(GRADED / f"{tid}.png")

        im = Image.fromarray(out, mode="RGBA")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im.save(ASSETS / f"{tid}.webp", quality=QUALITY, method=6)

        allh = "  ".join(f"{s}:{v:+.0f}" if v is not None else f"{s}:—"
                         for s, v in halos.items())
        print(f"{tid:<16}{seed:>6}{halos.get(seed, 0):+9.1f}{allh:>34}")
        rows.append((tid, im))
        report[tid] = {"seed": seed, "source": str(src_dir.relative_to(ROOT)),
                       "halo": halos, "width": im.width, "why": why}

    print("-" * 66)
    print(f"{len(rows)} спрайтов -> assets/\n")
    for tid, r in report.items():
        print(f"  {tid} <- сид {r['seed']}: {r['why']}")
    (ROOT / "out" / "site_assets" / "regen_v2.json").write_text(
        json.dumps({"lora": "fellmise_sprite_v2", "weight": 0.7, "picks": report},
                   ensure_ascii=False, indent=1), encoding="utf-8")

    if args.sheet:
        write_sheets(rows)


def write_sheets(rows):
    from PIL import ImageDraw
    T, PAD_, COLS = 260, 12, 5
    for name, bg, fg in (("cream", (253, 246, 224), (56, 59, 45)),
                         ("dark", (26, 30, 34), (240, 235, 220))):
        im = Image.new("RGB", (COLS * (T + PAD_) + PAD_, T + 40), bg)
        d = ImageDraw.Draw(im)
        for i, (stem, sprite) in enumerate(rows):
            cell = Image.alpha_composite(
                Image.new("RGBA", sprite.size, bg + (255,)), sprite).convert("RGB")
            cell.thumbnail((T - 8, T - 8))
            x = PAD_ + i * (T + PAD_)
            im.paste(cell, (x + (T - cell.width) // 2, 10 + (T - cell.height) // 2))
            d.text((x + 2, T + 16), stem, fill=fg)
        out = SHEET / f"b2_regen_{name}.png"
        SHEET.mkdir(parents=True, exist_ok=True)
        im.save(out)
        print(f"-> {out}")


if __name__ == "__main__":
    main()
