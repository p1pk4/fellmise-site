"""Убрать остаточные следы вырезанной кроны из плиты деревни.

    python depth-v2/clean_hero_traces.py

После вырезки дуба в плите остались тонкие тёмные штрихи — обрывки ветки и
листьев, которые узкая маска вклейки не дотянулась закрыть. На кадрах, где
крона уже ушла, они висят в небе сами по себе и читаются как следы разметки.

След опознаётся как ТОНКОЕ тёмное пятно на гладком фоне: берётся сильно
размытая версия кадра (модель неба и дальних холмов) и ищутся пиксели заметно
темнее неё. Настоящие крыши, стены и холмы под это не попадают — у них другая
площадь и другая протяжённость, поэтому связные области фильтруются по
размеру и по габариту.

Найденные следы заменяются той же размытой моделью: небо там гладкое, и замена
не видна. Всё остальное в плите не трогается.
"""

import pathlib

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLATE = ROOT / "out" / "depth-v2" / "h2f" / "hero_plate_clean.webp"

# Искать следы только там, где они физически могли остаться: внутри бывшей
# кроны дуба. Первый заход искал по всему небу и заодно стёр дальний замок —
# он тоже тонкий тёмный силуэт и под критерий «следа» подходит идеально.
OAK = [(0, 0), (812, 0), (762, 128), (604, 176), (472, 208), (402, 268),
       (332, 302), (316, 482), (302, 662), (150, 704), (0, 692)]
PROTECT = [(548, 110, 760, 268)]   # x0, y0, x1, y1 — дальний замок, не трогать
DARKER_THAN = 15              # насколько темнее модели, чтобы считаться следом
MAX_AREA = 2600               # крупнее — это настоящий объект, не след
MAX_SIDE = 190                # длиннее — тоже объект


def main():
    img = Image.open(PLATE).convert("RGB")
    a = np.asarray(img, dtype=np.float32)
    model = np.asarray(img.filter(ImageFilter.GaussianBlur(17)), dtype=np.float32)

    from PIL import ImageDraw
    z = Image.new("L", img.size, 0)
    ImageDraw.Draw(z).polygon(OAK, fill=255)
    for x0, y0, x1, y1 in PROTECT:
        ImageDraw.Draw(z).rectangle([x0, y0, x1, y1], fill=0)
    zone = np.asarray(z) > 127

    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    lum_m = 0.299 * model[..., 0] + 0.587 * model[..., 1] + 0.114 * model[..., 2]
    cand = ((lum_m - lum) > DARKER_THAN) & zone

    lab, n = ndimage.label(ndimage.binary_closing(cand, np.ones((3, 3))))
    keep = np.zeros_like(cand)
    kept = 0
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        area = int((lab[sl] == i).sum())
        if area <= MAX_AREA and max(h, w) <= MAX_SIDE:
            keep |= (lab == i)
            kept += 1

    grown = ndimage.binary_dilation(keep, np.ones((3, 3)), iterations=2)
    m = np.asarray(Image.fromarray((grown * 255).astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(2.2)), dtype=np.float32)[..., None] / 255.0
    out = model * m + a * (1 - m)

    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(PLATE, quality=95, method=5)
    print(f"следов найдено {n}, убрано {kept}, затронуто {float((m > .3).mean()) * 100:.2f}% кадра")
    print(f"-> {PLATE}")


if __name__ == "__main__":
    main()
