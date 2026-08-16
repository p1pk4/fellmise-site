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

Меряются только объекты с читаемой горизонтальной верхней гранью. Деревья, ёлки
и кусты не меряются: плоскости у них нет, результат был бы мусором.
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


def main():
    data = json.loads(MARKS.read_text(encoding="utf-8"))
    ref = data["reference"]["value"]
    tol = data["reference"]["tolerance"]

    print(f"Эталон GDD: {ref} ± {tol}")
    print(f"Источник: {data['reference']['source']}\n")
    print(f"{'спрайт':<16}{'ширина px':>11}{'высота px':>11}"
          f"{'отношение':>12}{'Δ от 0.373':>12}  плоскость")
    print("-" * 92)

    ratios = []
    for name, m in data["sprites"].items():
        p = ASSETS / f"{name}.webp"
        if not p.exists():
            print(f"{name:<16}  нет файла assets/{name}.webp")
            continue
        if m.get("visible") is False or not m.get("corners"):
            ratios.append(0.0)
            print(f"{name:<16}{'—':>11}{'—':>11}{0.0:>12.3f}{0.0 - ref:>+12.3f}"
                  f"  горизонтальной грани нет")
            continue
        w, h = measure(m["corners"])
        r = h / w if w else 0.0
        ratios.append(r)
        print(f"{name:<16}{w:>11}{h:>11}{r:>12.3f}{r - ref:>+12.3f}"
              f"  {m['plane']}")

    print("-" * 92)
    avg = sum(ratios) / len(ratios) if ratios else 0.0
    lo, hi = min(ratios), max(ratios)
    print(f"{'СРЕДНЕЕ':<16}{'':>11}{'':>11}{avg:>12.3f}{avg - ref:>+12.3f}")
    print(f"{'разброс':<16}{'':>11}{'':>11}{lo:>12.3f}..{hi:.3f}")

    ok = abs(avg - ref) <= tol
    print()
    print(f"ВЫВОД: среднее {avg:.3f} "
          f"{'ПОПАДАЕТ' if ok else 'НЕ ПОПАДАЕТ'} в {ref} ± {tol} "
          f"(отклонение {avg - ref:+.3f}).")
    if not ok:
        print("Чинить не в этом батче — здесь только число.")


if __name__ == "__main__":
    main()
