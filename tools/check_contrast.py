"""Measure text contrast against what is actually behind it.

    python tools/check_contrast.py <dir>

The beds under the journey's text are translucent and sit over a 3D frame that
changes with every biome, so reading the contrast off the CSS colours would be
a guess. Instead the collector (scratchpad/b4contrast.js) screenshots each frame
with the text made invisible and records each text block's box and painted
colour; here the background is sampled from that screenshot inside the box.

Reported against WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or
>=18.66px bold). The number quoted is the WORST case in the box — the darkest
background for light text, the lightest for dark text — not the average, since
a single blown-out patch is what actually makes a line unreadable.
"""

import json
import pathlib
import re
import sys

import numpy as np
from PIL import Image


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def luminance(rgb):
    lin = srgb_to_lin(np.asarray(rgb, dtype=np.float64))
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def parse_colour(s):
    m = re.findall(r"[\d.]+", s)
    if not m:
        return (0, 0, 0), 1.0
    v = [float(x) for x in m]
    a = v[3] if len(v) > 3 else 1.0
    return tuple(v[:3]), a


def large(size_px, weight):
    try:
        w = int(weight)
    except ValueError:
        w = 700 if weight in ("bold", "bolder") else 400
    return size_px >= 24 or (size_px >= 18.66 and w >= 700)


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                        else "out/night_report/_contrast")
    data = json.loads((root / "boxes.json").read_text(encoding="utf-8"))

    fails, checked = [], 0
    print(f"{'локаль/биом':<14}{'элемент':<22}{'кегль':>7}{'нужно':>7}{'факт':>8}  текст")
    print("-" * 96)
    for frame in data:
        img = np.asarray(Image.open(root / frame["shot"]).convert("RGB")).astype(np.float64)
        for b in frame["boxes"]:
            x0, y0 = max(b["x"], 0), max(b["y"], 0)
            x1 = min(b["x"] + b["w"], img.shape[1])
            y1 = min(b["y"] + b["h"], img.shape[0])
            if x1 <= x0 or y1 <= y0:
                continue
            patch = img[y0:y1, x0:x1]
            bl = luminance(patch)

            (r, g, bcol), alpha = parse_colour(b["color"])
            if alpha < 1:
                # the text itself is translucent: composite it over the bed
                bed = patch.reshape(-1, 3).mean(axis=0)
                r, g, bcol = (np.array([r, g, bcol]) * alpha + bed * (1 - alpha))
            tl = float(luminance((r, g, bcol)))

            # worst case: whichever end of the bed is closest to the text
            worst_bg = float(np.percentile(bl, 95) if tl < 0.5 else np.percentile(bl, 5))
            hi, lo = max(tl, worst_bg), min(tl, worst_bg)
            ratio = (hi + 0.05) / (lo + 0.05)

            size = float(re.findall(r"[\d.]+", b["size"])[0])
            need = 3.0 if large(size, b["weight"]) else 4.5
            checked += 1
            ok = ratio >= need
            if not ok:
                fails.append((frame, b, ratio, need))
            flag = "  " if ok else " ✗"
            print(f"{frame['loc']+'/'+frame['biome']:<14}{b['sel'][:21]:<22}"
                  f"{size:6.0f}px{need:7.1f}{ratio:8.2f}{flag} {b['text'][:26]}")

    print("-" * 96)
    if fails:
        print(f"НЕ ПРОХОДЯТ {len(fails)} из {checked}:")
        for frame, b, ratio, need in fails:
            print(f"  {frame['loc']}/{frame['biome']:<8} {b['sel'][:26]:<28}"
                  f"{ratio:5.2f} < {need}  «{b['text'][:40]}»")
        raise SystemExit(1)
    print(f"все {checked} блоков текста проходят AA")


if __name__ == "__main__":
    main()
