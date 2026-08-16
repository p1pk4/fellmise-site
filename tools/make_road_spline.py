"""Ось дороги и её ширина — данными, а не в коде.

    python tools/make_road_spline.py

Дорога перестаёт быть прямой лентой постоянной ширины. Ось задаётся
контрольными точками, ширина — множителем в тех же точках; между точками и то и
другое интерполируется кодом пробы.

Правило отдельно от данных: КАК по этим точкам ведётся дорога — в шейдере, ГДЕ
они стоят — здесь, в assets/road_spline.json. Поэтому сдвинуть дорогу можно, не
трогая ни строчки шейдера.

Точки детерминированы сидом тем же способом, что расстановка в
generate_layout.py: не поток случайных чисел, а хеш от (сид, имя точки). Вставка
точки в середину не сдвигает все следующие, и один и тот же сид всегда даёт один
и тот же файл.
"""

import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "road_spline.json"

SEED = "fellmise-road-1"
LENGTH = 760.0       # метров вдоль оси: пять биомов по 150 плюс запас
STEP = 40.0          # шаг контрольных точек
AMP_X = 1.5          # виляние оси, ±метры на шаге
AMP_W = 0.20         # ширина, ±доля от базовой


def h01(*parts):
    key = f"{SEED}|" + "|".join(str(p) for p in parts)
    d = hashlib.blake2b(key.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(d, "big") / 2 ** 64


def main():
    pts = []
    n = int(LENGTH / STEP) + 1
    for i in range(n):
        z = -i * STEP
        # первая точка строго на оси: у входа в деревню дорога должна начинаться
        # там, где её ждёт расстановка
        x = 0.0 if i == 0 else round((h01("x", i) * 2 - 1) * AMP_X, 3)
        w = round(1.0 + (h01("w", i) * 2 - 1) * AMP_W, 3)
        pts.append({"z": z, "x": x, "w": w})

    OUT.write_text(json.dumps({
        "seed": SEED,
        "generated": "tools/make_road_spline.py",
        "note": ("x — смещение оси дороги от нуля в метрах, w — множитель "
                 "базовой полуширины. Между точками проба ведёт Catmull-Rom."),
        "step_z": STEP,
        "points": pts,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    dx = max(abs(p["x"]) for p in pts)
    lo = min(p["w"] for p in pts)
    hi = max(p["w"] for p in pts)
    print(f"{len(pts)} точек через {STEP:.0f} м на {LENGTH:.0f} м")
    print(f"  ось виляет до ±{dx:.2f} м, ширина {lo:.2f}..{hi:.2f} от базовой")
    print(f"-> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
