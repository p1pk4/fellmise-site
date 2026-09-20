"""Слои для теста hero -> forest на НАСТОЯЩИХ вырезках переднего плана.

    python depth-v2/build_hero_forest.py

Почему не как раньше. Прошлая схема резала один мастер на core/mid/ring и
двигала куски одной и той же растровой картины с разной скоростью. Это давало
ложный параллакс: стволы расходились сами с собой, камни двоились, земля
переставала совпадать, по краям зон лезли швы. Никакой feather этого не чинит —
геометрия внутри одной картины обязана оставаться неизменной.

Здесь наоборот:
  * hero_plate    — ЦЕЛЬНАЯ сцена, внутри ничего не разъезжается;
  * hero_fg_*     — только реальные близкие объекты, вырезанные по своему
                    силуэту: дуб с кроной, левый забор, правый забор,
                    верхняя правая листва;
  * под вырезками фон в плите достраивается диффузией, иначе на их месте
    открылась бы дыра, когда объект уедет;
  * forest_plate  — тоже ЦЕЛЬНАЯ сцена, без деления;
  * passage_matte — матовая маска прохода, обведённая по реальной геометрии
    дороги и домов, а не эллипс.

Мастера только читаются. Цвет не трогается: из картины берутся те же пиксели,
добавляется альфа.
"""

import json
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "out" / "scene_batch1" / "final"
OUT = ROOT / "out" / "depth-v2" / "h2f"
W, H = 1536, 960

# Близкие объекты hero. Область поиска — ПОЛИГОН по реальному силуэту, а не
# прямоугольник: иначе порог по темноте забирает тёмные фахверковые балки
# домов, и в вырезку уезжает половина деревни (так и вышло в первом заходе).
CUTOUTS = [
    dict(id="oak", lum=84,
         note="дуб слева: ствол, крона по верху кадра и свисающая ветка",
         region=[(0, 0), (812, 0), (762, 128), (604, 176), (472, 208), (402, 268),
                 (332, 302), (316, 482), (302, 662), (150, 704), (0, 692)]),
    dict(id="fence_l", lum=90,
         note="ближний забор слева со столбом калитки",
         region=[(0, 548), (300, 542), (452, 512), (574, 506), (578, 800),
                 (0, 812)]),
    dict(id="fence_r", lum=90,
         note="ближний забор справа со столбом калитки и тёмный ближний план",
         region=[(1016, 508), (1120, 506), (1536, 560), (1536, 812), (1012, 800)]),
]

# Проход: обведён по реальному коридору дороги между столбами и домами.
# Точки намеренно неровные — граница не должна читаться фигурой.
PASSAGE = [
    (706, 436), (754, 424), (806, 428), (852, 442), (874, 500),
    (908, 604), (962, 726), (1046, 884), (1092, 1010),
    (452, 1010), (508, 878), (582, 742), (630, 620), (664, 512),
]
PASSAGE_ANCHOR = (768, 452)   # там, где дорога уходит между домами


def luminance(rgb):
    return (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])


def despeckle(mask, keep=280):
    """Убрать мелкие крапины: они дают по краям вырезки грязь."""
    from scipy import ndimage
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    drop = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s < keep])
    out = mask.copy()
    out[drop] = False
    return ndimage.binary_closing(out, np.ones((5, 5)))


def build_cutouts(rgb):
    lum = luminance(rgb.astype(np.float32))
    layers = []
    for c in CUTOUTS:
        poly = Image.new("L", (W, H), 0)
        ImageDraw.Draw(poly).polygon(c["region"], fill=255)
        region = np.asarray(poly) > 127
        m = despeckle((lum < c["lum"]) & region)
        a = np.asarray(Image.fromarray((m * 255).astype(np.uint8))
                       .filter(ImageFilter.GaussianBlur(1.4)), dtype=np.float32) / 255.0
        layers.append((c, a))
    return layers


def inpaint(rgb, hole, rounds=26):
    """Достроить фон под вырезками горизонтальной протяжкой.

    Изотропная диффузия по большой дыре даёт кашу — первый заход это показал.
    Здесь каждая строка дыры заполняется смесью ближайшего известного пикселя
    слева и справа по расстоянию: у этой сцены фон построен горизонтальными
    полосами (небо, гряды холмов, трава), и протяжка их сохраняет. Лёгкое
    сглаживание сверху убирает полосатость.

    Достройка всё равно приблизительная, и это осознанно: открывшийся участок
    почти всегда у самого края кадра и виден тогда, когда объект уже уходит."""
    src = rgb.astype(np.float32)
    known = hole < 0.02
    out = src.copy()
    for y in range(H):
        row_known = np.nonzero(known[y])[0]
        if row_known.size == 0:
            continue
        idx = np.arange(W)
        left = np.maximum.accumulate(np.where(known[y], idx, -1))
        right = np.minimum.accumulate(np.where(known[y], idx, W)[::-1])[::-1]
        left_ok, right_ok = left >= 0, right < W
        lv = src[y, np.clip(left, 0, W - 1)]
        rv = src[y, np.clip(right, 0, W - 1)]
        dl = np.where(left_ok, idx - left, 1e9).astype(np.float32)
        dr = np.where(right_ok, right - idx, 1e9).astype(np.float32)
        w = (dr / np.maximum(dl + dr, 1e-6))[:, None]
        fill = np.where(left_ok[:, None] & right_ok[:, None], lv * w + rv * (1 - w),
                        np.where(left_ok[:, None], lv, rv))
        m = ~known[y]
        out[y][m] = fill[m]
    h3 = hole[..., None]
    for _ in range(rounds):
        blurred = np.asarray(Image.fromarray(out.clip(0, 255).astype(np.uint8))
                             .filter(ImageFilter.GaussianBlur(3)), dtype=np.float32)
        out = np.where(h3 > 0.02, blurred, src)
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    hero = np.asarray(Image.open(MASTERS / "hero_start.png").convert("RGB"))
    layers = build_cutouts(hero)

    # плита: та же сцена, но без вырезанных объектов
    hole = np.clip(sum(a for _, a in layers), 0, 1)
    plate = inpaint(hero, hole)
    Image.fromarray(plate.clip(0, 255).astype(np.uint8)).save(OUT / "hero_plate.webp", quality=94, method=5)

    index = {"plate": "hero_plate.webp", "cutouts": [], "forest": "forest_plate.webp",
             "passage": {"matte": "passage_matte.png", "anchor": [PASSAGE_ANCHOR[0] / W, PASSAGE_ANCHOR[1] / H]}}
    for c, a in layers:
        rgba = np.dstack([hero, (a * 255).round().astype(np.uint8)])
        name = f"hero_fg_{c['id']}.webp"
        Image.fromarray(rgba, "RGBA").save(OUT / name, quality=94, method=5)
        ys, xs = np.nonzero(a > 0.5)
        index["cutouts"].append({"id": c["id"], "file": name, "note": c["note"],
                                 "coverage": round(float((a > 0.5).mean()) * 100, 2),
                                 "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
        print(f"{c['id']:10} {index['cutouts'][-1]['coverage']:5.2f}% кадра  bbox {index['cutouts'][-1]['bbox']}")

    # лес — целиком, без деления
    Image.open(MASTERS / "forest_transition.png").convert("RGB").save(
        OUT / "forest_plate.webp", quality=94, method=5)

    # матовая маска прохода: белое — то, сквозь что виден лес
    matte = Image.new("L", (W, H), 0)
    ImageDraw.Draw(matte).polygon(PASSAGE, fill=255)
    matte = matte.filter(ImageFilter.GaussianBlur(5))
    Image.merge("RGBA", (matte, matte, matte, matte)).save(OUT / "passage_matte.png")

    (OUT / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
