"""Нарезка принятых master scenes на три плана глубины — один раз, офлайн.

    python depth-v2/build_planes.py

Зачем офлайн. Те же маски можно повесить CSS-ом, и первый прогон PoC так и
делал: 18 полноэкранных слоёв, у каждого своя `mask-image`, плюс фон через
`background-size: cover`. На масштабе 3+ браузер перерастеризует такой слой
каждый кадр — замер дал p95 233 мс и худший кадр 550 мс при медиане 16.7.
С запечённой альфой план становится обычной картинкой, и прокрутка остаётся
чистой композицией трансформом.

Мастера только читаются. Ни перегенерации, ни цветокоррекции: альфа-канал
добавляется, пиксели RGB копируются как есть.

Зоны — те же, что задавала CSS-маска: ядро вокруг точки прохода, средняя
полоса и кольцо у краёв кадра, с широкой растушёвкой. В зоне перехлёста обе
соседние зоны полупрозрачны, поэтому двоения картинки не видно.
"""

import json
import pathlib
import re

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "out" / "scene_batch1" / "final"
OUT = ROOT / "out" / "depth-v2" / "planes"

# Стопы раскладки: (доля радиуса, альфа). Между стопами — линейная
# интерполяция, ровно как у CSS-градиента.
STOPS = {
    "bg":  lambda r0, r1: [(0.0, 1.0), (r0 * 0.62, 1.0), (r0 * 0.96, 0.55), (r0 * 1.28, 0.0)],
    "mid": lambda r0, r1: [(r0 * 0.46, 0.0), (r0 * 1.04, 1.0), (r1 * 0.86, 1.0), (r1 * 1.16, 0.0)],
    "fg":  lambda r0, r1: [(r1 * 0.72, 0.0), (r1 * 0.98, 0.60), (r1 * 1.28, 1.0)],
}


def scene_defs():
    """Определения берутся из scenes.js, чтобы они не разошлись с рантаймом."""
    src = (ROOT / "depth-v2" / "scenes.js").read_text(encoding="utf-8")
    out = []
    for block in re.findall(r"\{\s*id:\s*'([^']+)'(.*?)\n  \}", src, re.S):
        sid, body = block
        f = re.search(r"file:\s*'([^']+)'", body).group(1)
        gate = [float(v) for v in re.search(r"gate:\s*\[([^\]]+)\]", body).group(1).split(",")]
        ring = [float(v) for v in re.search(r"ring:\s*\[([^\]]+)\]", body).group(1).split(",")]
        out.append(dict(id=sid, file=f, gate=gate, ring=ring))
    return out


def radial_distance(w, h, gx, gy):
    """Нормированное расстояние до точки прохода в системе CSS-эллипса
    `ellipse 100% 104%`: 1.0 — граница градиента."""
    x = np.arange(w, dtype=np.float32)[None, :] - gx * w
    y = np.arange(h, dtype=np.float32)[:, None] - gy * h
    return np.sqrt((x / (1.00 * w)) ** 2 + (y / (1.04 * h)) ** 2)


def alpha_from_stops(d, stops):
    xs = np.array([s[0] for s in stops], dtype=np.float32)
    ys = np.array([s[1] for s in stops], dtype=np.float32)
    return np.interp(d, xs, ys, left=ys[0], right=ys[-1]).astype(np.float32)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for s in scene_defs():
        img = Image.open(MASTERS / s["file"]).convert("RGB")
        w, h = img.size
        rgb = np.asarray(img, dtype=np.uint8)
        d = radial_distance(w, h, *s["gate"])
        r0, r1 = s["ring"]
        for key, stops in STOPS.items():
            a = alpha_from_stops(d, stops(r0, r1))
            rgba = np.dstack([rgb, (a * 255).round().astype(np.uint8)])
            name = f"{s['id']}_{key}.webp"
            Image.fromarray(rgba, "RGBA").save(OUT / name, quality=92, method=5)
            index.setdefault(s["id"], {})[key] = name
        print(f"{s['id']:10} {w}x{h}  bg/mid/fg готовы")
    (OUT / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
