"""Grade and export ONLY the batch-7 dressing.

    python tools/finish_batch7.py            # grade + export
    python tools/finish_batch7.py --sheet    # also write the review sheets

Scoped on purpose. A full grade_sprites re-run would rewrite every sprite in the
pack, and the pack is what /next/ is already shipping — the new props must join
the existing look, not move it. So the saturation target is MEASURED off the
already-graded pack and applied to the new sprites, instead of being recomputed
from a set that now includes them.

Widths follow the role in the scene, not the source size. A cloud spans the sky
and a mushroom is knee-high; giving both 560px would spend the weight budget on
things nobody can see.
"""

import argparse
import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from grade_sprites import SAT_CAP, defringe, grade, load, mean_saturation  # noqa: E402
from gen_batch7 import TASKS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
FINAL = ROOT / "out" / "site_assets" / "final"
GRADED = ROOT / "out" / "site_assets" / "final_web"
ASSETS = ROOT / "assets"
SHEET = ROOT / "out" / "night_report"
QUALITY = 85

# id prefix -> exported width. Backdrops are seen large and far, dressing small
# and near; nothing is exported wider than it is ever drawn.
WIDTH = {
    "cloud": 560, "moon": 360, "hill": 720,
    "rock": 320, "grass_tuft": 260, "branch_canopy": 560,
    "fence_seg": 360, "barn": 480, "haystack": 300,
    "mushrooms": 260, "fern": 260,
    "beam_frame": 560, "stalagmite": 300, "minecart": 380,
    "lantern_chain": 300, "ore_pile": 300,
    "grave": 300, "candles": 260, "chest": 340,
}


def width_for(tid):
    for pre, w in WIDTH.items():
        if tid.startswith(pre):
            return w
    return 360


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()

    ids = [t for t, _ in TASKS]
    new = [FINAL / f"{t}.png" for t in ids]
    new = [p for p in new if p.exists()]
    if not new:
        raise SystemExit("нет вырезанных спрайтов batch 7 — сначала filter_batch7.py")

    # the pack's own target, measured off what is already graded and shipped
    old = [p for p in sorted(GRADED.glob("*.png")) if p.stem not in ids]
    if not old:
        raise SystemExit(f"нет отградуированного пака в {GRADED}")
    sats_old = []
    for p in old:
        a = load(p)
        sats_old.append(mean_saturation(a[..., :3].astype(np.float32) / 255.0, a[..., 3] > 8))
    target = float(np.median(sats_old))
    print(f"цель насыщенности из пака ({len(old)} спрайтов): {target:.3f}")

    print(f"\n{'id':<16}{'до':>7}{'усиление':>10}{'после':>8}  {'ширина':>7}")
    print("-" * 52)
    rows = []
    for p in new:
        d = defringe(load(p))
        s = mean_saturation(d[..., :3].astype(np.float32) / 255.0, d[..., 3] > 8)
        gain = float(np.clip(target / s, *SAT_CAP)) if s > 1e-6 else 1.0
        out = grade(d, gain)
        Image.fromarray(out, mode="RGBA").save(GRADED / p.name)
        after = mean_saturation(out[..., :3].astype(np.float32) / 255.0, out[..., 3] > 8)

        w = width_for(p.stem)
        im = Image.fromarray(out, mode="RGBA")
        if im.width > w:                      # never upscale past the master
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        ASSETS.mkdir(exist_ok=True)
        im.save(ASSETS / f"{p.stem}.webp", quality=QUALITY, method=6)
        print(f"{p.stem:<16}{s:7.3f}{gain:10.3f}{after:8.3f}  {im.width:5}px")
        rows.append((p.stem, im))

    print(f"\n{len(rows)} спрайтов -> assets/")
    if args.sheet:
        write_sheets(rows)


def write_sheets(rows):
    """Two beds — cream and dark — because the props have to sit on both."""
    from PIL import ImageDraw
    T, COLS, PAD = 190, 6, 10
    for name, bg, fg in (("cream", (253, 246, 224), (56, 59, 45)),
                         ("dark", (30, 37, 40), (240, 235, 220))):
        rowsn = (len(rows) + COLS - 1) // COLS
        im = Image.new("RGB", (COLS * (T + PAD) + PAD, rowsn * (T + 26) + PAD), bg)
        d = ImageDraw.Draw(im)
        for i, (stem, sprite) in enumerate(rows):
            cell = Image.new("RGBA", sprite.size, bg + (255,))
            cell = Image.alpha_composite(cell, sprite).convert("RGB")
            cell.thumbnail((T - 8, T - 8))
            x = PAD + (i % COLS) * (T + PAD)
            y = PAD + (i // COLS) * (T + 26)
            im.paste(cell, (x + (T - cell.width) // 2, y + (T - cell.height) // 2))
            d.text((x + 2, y + T + 4), stem, fill=fg)
        SHEET.mkdir(parents=True, exist_ok=True)
        out = SHEET / f"b0_batch7_{name}.png"
        im.save(out)
        print(f"-> {out}")


if __name__ == "__main__":
    main()
