"""Насколько сжата верхняя плоскость спрайта.

    python tools/measure_foreshortening.py

GDD игры (docs/GDD.md:2848-2849) записывает ракурс не углом, а отношением
сжатия верхней плоскости — высота видимой грани, делённая на её ширину, — и
прямо говорит, что отношение измеримо линейкой по любому кадру. Эталон 0.373,
справочно ≈22° над горизонтом.

Правило генерации пака сайта («orthographic front elevation, flat facade facing
viewer») даёт сжатие 0. Здесь нужно не мнение, а число: насколько далеко пак
сайта от игрового ракурса.

Углы плоскости размечены ВРУЧНУЮ в foreshortening_marks.json. Автопоиск граней
на hand-painted спрайте не пишется намеренно: рёбра здесь нарисованы кистью,
границы мягкие, и любая автоматика тут даст уверенное число, ни на чём не
основанное. Ручная отметка честнее — она хотя бы знает, что размечает.

Меряются только объекты с КРУПНОЙ читаемой горизонтальной гранью — не уже
min_face_px из файла разметки. Порог не косметический: первый заход мерил
колпаки труб шириной 55-60 px при высоте грани 5-12 px, где отметка ±3 px даёт
±60% по отношению. Числа получались, вывод про них — нет.

Вторым разделом печатается потолок резкости пака: сколько пикселей текстуры
приходится на метр мира у каждого спрайта и при каком кадре экранная плотность
догоняет текстурную. Живёт здесь же, потому что это тот же вопрос — годен ли
пак для нужного ракурса, только с другой стороны.
"""

import json
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
MARKS = pathlib.Path(__file__).with_name("foreshortening_marks.json")


def measure(corners):
    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]
    return max(xs) - min(xs), max(ys) - min(ys)


def sharpness():
    """До какого зума пак не мылит.

    Спрайт занимает в мире h * aspect метров и несёт ширину текстуры в
    пикселях. Их отношение — плотность текстуры, px на метр мира. Когда
    экранная плотность (пиксели кадра на метр мира) её превышает, движок тянет
    текстуру вверх и разница уходит в мыло. Значит предельная высота кадра =
    высота вьюпорта в пикселях / плотность.
    """
    layout = json.loads((ASSETS / "layout.json").read_text(encoding="utf-8"))
    seen = {}
    for b in layout["biomes"].values():
        for o in b["sprites"]:
            t = o.get("t")
            if not t or t in seen:
                continue
            p = ASSETS / f"{t}.webp"
            if not p.exists():
                continue
            with Image.open(p) as im:
                w_px, aspect = im.width, im.width / im.height
            w_m = o["h"] * aspect
            seen[t] = (w_px, w_m, w_px / w_m)

    rows = sorted(seen.items(), key=lambda kv: kv[1][2])
    print("\n\nПОТОЛОК РЕЗКОСТИ ПАКА")
    print(f"{'спрайт':<18}{'текстура px':>13}{'в мире, м':>12}{'px/м':>10}")
    print("-" * 53)
    for t, (w_px, w_m, d) in rows[:5]:
        print(f"{t:<18}{w_px:>13}{w_m:>12.2f}{d:>10.1f}")
    print(f"{'…':<18}{'':>13}{'':>12}{'':>10}")
    for t, (w_px, w_m, d) in rows[-5:]:
        print(f"{t:<18}{w_px:>13}{w_m:>12.2f}{d:>10.1f}")
    print("-" * 53)

    dens = sorted(v[2] for v in seen.values())
    n = len(dens)
    med = dens[n // 2] if n % 2 else (dens[n // 2 - 1] + dens[n // 2]) / 2
    print(f"{'минимум':<18}{'':>13}{'':>12}{dens[0]:>10.1f}")
    print(f"{'медиана':<18}{'':>13}{'':>12}{med:>10.1f}")
    print(f"{'максимум':<18}{'':>13}{'':>12}{dens[-1]:>10.1f}")
    print(f"спрайтов в пробе: {n}")

    VIEWPORT_PX = 900          # высота кадра пробы в пикселях
    print(f"\nПри вьюпорте {VIEWPORT_PX} px предельная ВЫСОТА КАДРА без апскейла:")
    for name, d in (("по худшему спрайту", dens[0]),
                    ("по медиане", med),
                    ("по лучшему спрайту", dens[-1])):
        print(f"  {name:<22}{VIEWPORT_PX / d:>7.1f} м")

    # GDD: ground-тайл 256 px при тайле 1.17 м (вывод масштаба — в proto/main.js)
    GDD_PPM = 256 / (1.75 / 1.5)
    print(f"\nТребование GDD: PPU 256 при тайле 1.17 м = {GDD_PPM:.0f} px/м.")
    print(f"Пак сайта по медиане {med:.0f} px/м — отставание в "
          f"{GDD_PPM / med:.1f} раза.")


def main():
    data = json.loads(MARKS.read_text(encoding="utf-8"))
    ref = data["reference"]["value"]
    tol = data["reference"]["tolerance"]

    print(f"Эталон GDD: {ref} ± {tol}")
    print(f"Источник: {data['reference']['source']}\n")
    gate = data.get("min_face_px", 0)
    if gate:
        print(f"Порог ширины грани: {gate} px. {data['min_face_why']}\n")
    for name, why in data.get("excluded", {}).items():
        print(f"  вне замера: {name:<16} {why}")
    print()
    print(f"{'спрайт':<16}{'грань px':>10}{'высота px':>11}"
          f"{'отношение':>12}{'Δ от 0.373':>12}  плоскость")
    print("-" * 92)

    ratios = []
    for name, m in data["sprites"].items():
        p = ASSETS / f"{name}.webp"
        if not p.exists():
            print(f"{name:<16}  нет файла assets/{name}.webp")
            continue
        if m.get("visible") is False or not m.get("corners"):
            continue
        w, h = measure(m["corners"])
        if w < gate:
            print(f"{name:<16}{w:>10}  грань уже порога — в таблицу не берётся")
            continue
        r = h / w if w else 0.0
        ratios.append(r)
        print(f"{name:<16}{w:>10}{h:>11}{r:>12.3f}{r - ref:>+12.3f}"
              f"  {m['plane']}")

    print("-" * 92)
    avg = sum(ratios) / len(ratios) if ratios else 0.0
    lo, hi = min(ratios), max(ratios)
    print(f"{'СРЕДНЕЕ':<16}{'':>10}{'':>11}{avg:>12.3f}{avg - ref:>+12.3f}")
    print(f"{'разброс':<16}{'':>10}{'':>11}{lo:>12.3f}..{hi:.3f}"
          f"  ({len(ratios)} объектов)")

    ok = abs(avg - ref) <= tol
    print()
    print(f"ВЫВОД: среднее {avg:.3f} "
          f"{'ПОПАДАЕТ' if ok else 'НЕ ПОПАДАЕТ'} в {ref} ± {tol} "
          f"(отклонение {avg - ref:+.3f}).")
    if not ok:
        print("Чинить не в этом батче — здесь только число.")
    sharpness()


if __name__ == "__main__":
    main()
