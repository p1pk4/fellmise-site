"""Вырезать запечённый цоколь из-под спрайта.

    python tools/strip_pedestal.py            # все спрайты пробы
    python tools/strip_pedestal.py hero_house_a barn

Спрайты нарисованы стоящими на кусочке грунта: под домом светлый овал земли с
травой, под сундуком — песчаное пятно. В перспективном пролёте это работало как
контактная тень. Сверху так не работает: овал лежит на карте вторым, чужим
грунтом и выдаёт, что объект — картинка.

Метод тот же, что в `make_end_post.py`: не задавать координаты руками, а найти
их по альфе и по цвету. Цоколь опознаётся тремя признаками сразу, потому что
поодиночке каждый врёт:

  расширение  силуэт у самого низа шире тела объекта — овал торчит из-под стен;
  цвет        он не совпадает с телом: земля и трава против штукатурки и дерева;
  светлота    он светлее тела — это освещённая земля, а не тень под ней.

ИСХОДНИКИ НЕ ТРОГАЮТСЯ. Результат пишется в proto/sprites_stripped/ вместе с
index.json — списком того, что вырезано, чтобы проба знала, у кого брать
почищенную версию, а у кого исходную.

Метрика видит светлое пятно, но не видит, ЧТО это за пятно. Поэтому скрипт
печатает и найденное, и отвергнутое с причиной, а решение остаётся за глазами.
"""

import argparse
import json
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUT = ROOT / "proto" / "sprites_stripped"
MARKS = pathlib.Path(__file__).with_name("pedestal_marks.json")

ALPHA = 8
BAND = 0.18          # доля высоты снизу, в которой вообще ищем цоколь
BODY = (0.22, 0.55)  # полоса тела, с которой сравниваем цвет и ширину
WIDEN = 1.12         # во сколько раз цоколь должен быть шире тела
DIST = 46.0          # насколько цвет должен разойтись с телом (0..441)
LIGHTER = 6.0        # и насколько быть светлее
MIN_SHARE = 0.18     # доля пикселей полосы, ниже которой это не цоколь
LONE_SHARE = 0.34    # ...а без расширения силуэта — вот эта доля

# Отвергнуто глазами после первого прогона. Метрика на них срабатывает честно —
# внизу действительно светлое пятно другого цвета, — но пятно оказывается самим
# объектом: нижние поленья в связке дров, рукоять кирки, светлое основание
# сталагмита. Список ведётся руками и в этом весь смысл: автомат предлагает,
# глаз решает, и решение хранится рядом с правилом, а не теряется.
MANUAL_REJECT = {
    "res_wood": "светлое пятно — нижние поленья, вырез съедает связку",
    "res_pickaxe": "это рукоять, а не подставка; иконка прилавка, не объект сцены",
    "stalagmite_a": "светлое основание — часть натёка, после выреза остаётся шов",
    "stalagmite_b": "то же самое",
    "biome_pine_a": "подставки нет, вырез выгрызает низ ствола",
    "feat_pvp": "то же: срезается основание древка, а не подставка",
    "res_herbs": "нижние стебли пучка; иконка прилавка, не объект сцены",
}
FEATHER = 3          # строк мягкого края сверху выреза, чтобы не было ступеньки


def load(p):
    im = Image.open(p).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    return im, a


def strip(path, mark=None):
    """Вернуть (изображение или None, отчёт)."""
    im, a = load(path)
    rgb, alpha = a[..., :3], a[..., 3]
    solid = alpha > ALPHA
    rows = np.where(solid.any(axis=1))[0]
    if not len(rows):
        return None, "пустая альфа"
    top, bot = int(rows.min()), int(rows.max())
    h = bot - top + 1

    band0 = bot - max(int(h * BAND), 2) + 1
    b0, b1 = int(h * BODY[0]), int(h * BODY[1])
    body = solid[top + b0: top + b1]
    if not body.any():
        return None, "не нашлось тела для сравнения"

    widths = solid.sum(axis=1).astype(np.float32)
    w_body = float(np.median(widths[top + b0: top + b1]))
    w_band = float(widths[band0: bot + 1].max())
    if w_body <= 0:
        return None, "не нашлось тела для сравнения"
    widen = w_band / w_body

    ref = np.median(rgb[top + b0: top + b1][body], axis=0)

    sel = np.zeros_like(solid)
    band = slice(band0, bot + 1)
    px = rgb[band]
    m = solid[band]
    dist = np.sqrt(((px - ref) ** 2).sum(axis=-1))
    lighter = px.mean(axis=-1) - float(ref.mean())
    sel[band] = m & (dist > DIST) & (lighter > LIGHTER)


    share = sel[band].sum() / max(m.sum(), 1)
    need = MIN_SHARE if widen >= WIDEN else LONE_SHARE
    if share < need:
        return None, (f"светлое пятно {share*100:.0f}% полосы при пороге "
                      f"{need*100:.0f}% (низ шире тела в {widen:.2f}×)")

    # цоколь стоит НА земле: он обязан доходить до самого низа силуэта
    last = solid[bot]
    if last.any() and sel[bot][last].mean() < 0.35:
        return None, "пятно не доходит до низа — это не подставка"


    # Цоколь — самое нижнее, что есть в спрайте. Цветовой тест снимает его ядро
    # (освещённую землю), но оставляет бахрому: пучки травы и камешки по краю
    # темнее тела и в «светлее» не проходят. Раз в колонке цоколь начался — всё,
    # что под ним, тоже цоколь, поэтому вырез продлевается вниз до низа. Порог в
    # три пикселя нужен, чтобы одинокое светлое пятнышко не срезало колонку.
    col = sel[band]
    strong = col.sum(axis=0) >= 3
    first = np.argmax(col, axis=0)
    rows_idx = np.arange(col.shape[0])[:, None]
    sel[band] = np.where(strong[None, :] & (rows_idx >= first[None, :]), m, col)

    # Ручной потолок из pedestal_marks.json — ПОСЛЕ всех правил и жёстко.
    # У амбара и таверны низ стены по яркости близок к плите и проходит порог,
    # а вырез идёт по строкам во всю ширину, поэтому стена срезалась вместе с
    # землёй. Метрику под этот случай не подгоняем: две строки в файле честнее
    # седьмого порога.
    capped = 0
    if mark and mark.get("max_cut_row") is not None:
        cap = int(mark["max_cut_row"])
        capped = int(sel[:cap].sum())
        sel[:cap] = False

    out = a.copy()
    out[..., 3][sel] = 0.0
    # мягкий верх выреза, иначе на месте цоколя остаётся ровная ступенька
    top_cut = int(np.argmax(sel.any(axis=1))) if sel.any() else band0
    for i in range(FEATHER):
        r = top_cut - FEATHER + i
        if 0 <= r < a.shape[0]:
            k = i / FEATHER
            out[r, :, 3] = np.where(solid[r], out[r, :, 3] * (k * 0.6 + 0.4),
                                    out[r, :, 3])

    kept = (out[..., 3] > ALPHA).sum()
    if kept < solid.sum() * 0.35:
        return None, f"вырезалось бы {100 - kept / solid.sum() * 100:.0f}% спрайта"

    img = Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA")
    note = (f"вырезано {sel.sum()} px, {share*100:.0f}% нижней полосы, "
            f"низ шире тела в {widen:.2f}×")
    if capped:
        note += f"; потолок r{mark['max_cut_row']} вернул {capped} px стены"
    return img, note


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="имена спрайтов без .webp")
    args = ap.parse_args()

    names = args.names or sorted(p.stem for p in ASSETS.glob("*.webp")
                                 if not p.stem.endswith(("_em", "_bleed")))
    OUT.mkdir(parents=True, exist_ok=True)

    marks = {}
    if MARKS.exists():
        marks = json.loads(MARKS.read_text(encoding="utf-8")).get("sprites", {})

    done, skip = {}, {}
    for n in names:
        p = ASSETS / f"{n}.webp"
        if not p.exists():
            skip[n] = "нет такого спрайта"
            continue
        if n in MANUAL_REJECT:
            skip[n] = f"отвергнуто глазами: {MANUAL_REJECT[n]}"
            continue
        img, why = strip(p, marks.get(n))
        if img is None:
            skip[n] = why
        else:
            img.save(OUT / f"{n}.webp", "WEBP", quality=92, method=6)
            done[n] = why

    (OUT / "index.json").write_text(
        json.dumps({"stripped": sorted(done)}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8")

    print(f"ЦОКОЛЬ ВЫРЕЗАН — {len(done)}")
    for n in sorted(done):
        print(f"  {n:<18} {done[n]}")
    print(f"\nНЕ НАЙДЕН — {len(skip)}")
    for n in sorted(skip):
        print(f"  {n:<18} {skip[n]}")
    print(f"\n-> proto/sprites_stripped/ ({len(done)} файлов и index.json)")
    print("Сверить глазами: метрика видит светлое пятно, но не видит, что это.")


if __name__ == "__main__":
    main()
