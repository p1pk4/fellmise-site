"""Слои перехода mine -> spirit threshold.

    python depth-v2/build_m2s.py

Здесь нечего резать. Движение в этом переходе несёт сама сцена: цельная плита
выработки масштабируется от точки схода рельса, и ближние валуны уходят за
края вместе с ней. Вырезок переднего плана поэтому нет — значит нет и
отдельных летящих кусков, и ощущения разрезанного кадра.

Сборка сводится к двум вещам: перегнать принятые мастера в рантаймовый формат
и записать две точки, на которых держится хореография.

  vp      — точка схода рельса: там, где путь уходит в устье выработки.
            От неё масштабируется всё: плита, плита порога и диафрагма.
  target  — стела со светящейся спиралью в пороге. Плита порога смещается
            так, чтобы стела попала в точку схода: тогда первое, что видно в
            раскрывшейся диафрагме, — читаемая светящаяся цель в глубине
            тёмного устья, а не тёмное пятно.

Мастера только читаются, цвет не трогается.
"""

import json
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "out" / "scene_batch1" / "final"
OUT = ROOT / "out" / "depth-v2" / "m2s"

VP = [0.625, 0.50]        # рельс сходится в устье выработки
TARGET = [0.60, 0.44]     # стела со светящейся спиралью в пороге


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for src, dst in (("mine_approach.png", "mine_plate.webp"),
                     ("spirit_threshold.png", "spirit_plate.webp")):
        im = Image.open(MASTERS / src).convert("RGB")
        im.save(OUT / dst, quality=95, method=5)
        print(f"{src:24} -> {dst:20} {im.size[0]}x{im.size[1]}")

    (OUT / "index.json").write_text(json.dumps({
        "plate": "mine_plate.webp",
        "next": "spirit_plate.webp",
        "vp": VP,
        "target": TARGET,
    }, indent=1), encoding="utf-8")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
