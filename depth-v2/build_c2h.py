"""Слои перехода spirit_core -> home_finale.

    python depth-v2/build_c2h.py

Резать нечего: движение несёт цельная плита ядра, масштабируемая от точки
схода — дальней воды между берегами, куда зритель уходит из холодного слоя.

Точки хореографии:

  vp    — дальняя вода в ядре: направление выхода из мира духов.
  light — ДВА ТЁПЛЫХ ОКНА в доме. Плита дома смещается так, чтобы окна попали
          ровно в точку схода, и входит сильно уменьшенной. Поэтому первое,
          что видно в крошечной диафрагме, — одинокий тёплый огонёк далеко
          впереди, а не «картинка дома». Дом читается позже, когда окно
          подрастает и вокруг огонька появляется его окружение.

Мастера только читаются, цвет не трогается. Никакого накладного свечения
поверх кадра: тёплый свет — это настоящие окна принятого мастера.
"""

import json
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "out" / "scene_batch1" / "final"
OUT = ROOT / "out" / "depth-v2" / "c2h"

VP = [0.470, 0.200]       # дальняя вода между берегами в ядре
LIGHT = [0.565, 0.505]    # два тёплых окна по сторонам двери


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for src, dst in (("spirit_core.png", "core_plate.webp"),
                     ("home_finale.png", "home_plate.webp")):
        im = Image.open(MASTERS / src).convert("RGB")
        im.save(OUT / dst, quality=95, method=5)
        print(f"{src:22} -> {dst:20} {im.size[0]}x{im.size[1]}")

    (OUT / "index.json").write_text(json.dumps({
        "plate": "core_plate.webp",
        "next": "home_plate.webp",
        "vp": VP,
        "light": LIGHT,
    }, indent=1), encoding="utf-8")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
