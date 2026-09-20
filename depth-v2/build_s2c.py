"""Слои перехода spirit_threshold -> spirit_core.

    python depth-v2/build_s2c.py

Резать нечего и здесь: движение несёт цельная плита порога, масштабируемая от
точки схода пути. Ближние мёртвые стволы уходят за края вместе с ней.

Точки, на которых держится хореография:

  vp      — путь за стелой, куда зритель идёт. От неё масштабируется всё.
  target  — ДАЛЬНЯЯ холодная вода в ядре, между берегами. Плита ядра смещается
            так, чтобы эта даль попала в точку схода: первое, что видно в
            узкой диафрагме, — холодная даль впереди, а не корабль.
  ship    — где в ядре стоит призрачный корабль. Он заметно ниже цели прицела,
            поэтому в узкую вертикальную щель не попадает и появляется только
            когда раскрыв пошёл вширь. Здесь эта точка не используется
            рантаймом, она записана как проверяемое обоснование тайминга.

Ядро берётся из ПРИНЯТОГО out/scene_batch1/final/spirit_core.png — того, где
призрачный корабль собран композитом с настоящей полупрозрачностью.

Мастера только читаются, цвет не трогается.
"""

import json
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "out" / "scene_batch1" / "final"
OUT = ROOT / "out" / "depth-v2" / "s2c"

VP = [0.552, 0.500]       # путь за стелой в пороге
TARGET = [0.470, 0.200]   # дальняя вода между берегами в ядре
SHIP = [0.517, 0.387]     # призрачный корабль: на 0.19 кадра ниже цели


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for src, dst in (("spirit_threshold.png", "threshold_plate.webp"),
                     ("spirit_core.png", "core_plate.webp")):
        im = Image.open(MASTERS / src).convert("RGB")
        im.save(OUT / dst, quality=95, method=5)
        print(f"{src:24} -> {dst:22} {im.size[0]}x{im.size[1]}")

    (OUT / "index.json").write_text(json.dumps({
        "plate": "threshold_plate.webp",
        "next": "core_plate.webp",
        "vp": VP,
        "target": TARGET,
        "ship": SHIP,
    }, indent=1), encoding="utf-8")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
