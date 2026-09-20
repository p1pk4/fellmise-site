"""Локальная починка швов в восстановленной плите леса.

    python depth-v2/fix_f2m_seam.py

Что чинится. После зеркальной заливки дыр от передних стволов в плите
остались вертикальные разрывы: на t~0.84-0.93, когда ствол уходит, зритель
видел тёмную полосу — место, где кончается восстановленный фон.

Швы не назначаются на глаз, а измеряются: по каждой колонке считается средний
горизонтальный перепад и сравнивается с тем же замером по мастеру. Колонки,
где перепад вырос, и есть швы.

Метод починки, без всякой генерации:
  * берётся узкая полоса вокруг шва с запасом;
  * нарисованное содержимое НЕ заменяется: правится только низкочастотная
    составляющая, то есть тон, по перепаду которого шов и виден;
  * внутри полосы значения тона заменяются линейной протяжкой между её
    краями, построчно, и разница добавляется к плите;
  * переход косинусный, поэтому новой вертикальной границы не возникает;
  * вне полосы пиксели плиты не трогаются вовсе.

Композиция леса, вырезки, маска прохода и хореография не меняются.
"""

import pathlib

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
F2M = ROOT / "out" / "depth-v2" / "f2m"
MASTER = ROOT / "out" / "scene_batch1" / "final" / "forest_transition.png"
PLATE = F2M / "forest_plate_clean.webp"
PAD = 22          # запас по обе стороны от шва
DONOR = 130       # ширина донорской области
TOP_END = 520     # ниже этой строки починка не действует: там земля и тропа


def seam_columns(plate, master, thresh=6.4, top=(0, 520)):
    a, b = top
    g = np.abs(np.diff(plate[a:b], axis=1)).mean(axis=(0, 2))
    gm = np.abs(np.diff(master[a:b], axis=1)).mean(axis=(0, 2))
    return np.nonzero(g - gm > thresh)[0]


def merge_bands(cols, w, pad=PAD, cap=120):
    """Полосы узкие и не сливаются в широкую зону: если слить, починка
    превращается в растянутую заливку — ровно тот дефект, от которого уходим."""
    bands = []
    for x in cols:
        lo, hi = max(1, x - pad), min(w - 1, x + pad)
        if bands and lo <= bands[-1][1] and hi - bands[-1][0] <= cap:
            bands[-1][1] = max(bands[-1][1], hi)
        else:
            bands.append([lo, hi])
    return bands


def lowfreq(arr, sigma=34):
    """Низкочастотная составляющая: только тон, без рисунка."""
    im = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)


def streak_energy(block):
    """Насколько в полосе есть длинная вертикальная кромка.

    Шов здесь — это не ступенька тона и не смаз, а ТЁМНЫЙ ДАЛЬНИЙ СТВОЛ с
    неестественно прямой кромкой во всю высоту кадра, занесённый зеркальной
    заливкой. Такую кромку и ищем: столбец, у которого горизонтальный перепад
    держится почти по всей высоте."""
    g = np.abs(np.diff(block, axis=1)).mean(axis=2)
    return (g > 6).mean(axis=0).max()


def pick_donor(plate, lo, hi, search=(560, 1010)):
    """Выбрать донорскую полосу в коридоре дальнего леса.

    Донор не назначается наугад: перебираются все положения в дальней части
    кадра, и берётся то, где нет длинной вертикальной кромки, а тон ближе
    всего к краям чинимой полосы. Так в дыру не приедет второй такой же
    прямой ствол."""
    w = hi - lo
    edge = 0.5 * (plate[:, lo - 1] + plate[:, hi])
    best, best_score = None, 1e9
    for x in range(search[0], search[1] - w, 6):
        block = plate[:, x:x + w]
        streak = streak_energy(block)
        tone = np.abs(block.mean(axis=1) - edge).mean()
        score = streak * 60 + tone
        if score < best_score:
            best, best_score = x, score
    return best


def fix_band(plate, lf, lo, hi):
    """Заменить полосу донором из дальнего леса и подогнать тон.

    Нарисованное содержимое донора настоящее — это пиксели того же кадра с
    нужной глубины. Тон выравнивается по низкой частоте, поэтому стыка по
    яркости не возникает; переход косинусный, поэтому нет и новой кромки."""
    w = hi - lo
    src = pick_donor(plate, lo, hi)
    block = plate[:, src:src + w].copy()

    # тон донора приводится к тому, что должно быть в полосе
    t = np.linspace(0, 1, w)[None, :, None]
    target_lf = lf[:, lo - 1:lo] * (1 - t) + lf[:, hi:hi + 1] * t
    block = block + (target_lf - lowfreq(block))

    feather = (0.5 - 0.5 * np.cos(np.linspace(0, 2 * np.pi, w)))[None, :, None]
    # по вертикали починка живёт только там, где идёт клин: ниже начинается
    # земля и тропа, и чужой донор там не сходится по рисунку
    h = plate.shape[0]
    vfade = np.clip((TOP_END - np.arange(h)) / 90.0, 0, 1)[:, None, None]
    out = plate.copy()
    out[:, lo:hi] = block * (feather * vfade) + plate[:, lo:hi] * (1 - feather * vfade)
    return out


def main():
    plate = np.asarray(Image.open(PLATE).convert("RGB"), dtype=np.float32)
    master = np.asarray(Image.open(MASTER).convert("RGB"), dtype=np.float32)
    before = seam_columns(plate, master)
    bands = merge_bands(before, plate.shape[1])
    print("швы найдены в колонках:", ", ".join(str(int(c)) for c in before))
    print("полосы починки:", bands)

    lf = lowfreq(plate)
    for lo, hi in bands:
        plate = fix_band(plate, lf, lo, hi)

    after = seam_columns(plate, master)
    print(f"после починки колонок со швом: {len(after)}"
          + (f" ({', '.join(str(int(c)) for c in after)})" if len(after) else ""))

    Image.fromarray(plate.clip(0, 255).astype(np.uint8)).save(PLATE, quality=95, method=5)
    print(f"-> {PLATE}")


if __name__ == "__main__":
    main()
