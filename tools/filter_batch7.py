"""Filter and cut batch 7 — the set dressing for journey v3 stage 2.

    python tools/filter_batch7.py

Same gate as the rest of the pack: the pipeline's own usability metric, imported
rather than reimplemented, so what ships here was judged by exactly the rule the
preset was accepted on. Flood the background inward from the frame corners and
accept the frame iff the flood covers >= 15%, exactly one connected object
remains, and it touches <= 2 frame edges. Best of the usable frames by contour
sharpness.

The pipeline lives in D:\\Dev\\ART_Fellmise now; only its metric module is read.

Outputs:
  out/site_assets/final/<id>.png    best frame, cut to alpha
  out/site_assets/batch7.json       per-frame verdicts
"""

import json
import pathlib
import shutil
import sys

import numpy as np
from PIL import Image

PIPELINE = pathlib.Path(r"D:\Dev\ART_Fellmise")
sys.path.insert(0, str(PIPELINE / "scripts"))

import acceptance_metrics as M  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gen_batch7 import SEEDS, TASKS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "out" / "site_assets"
RAW = SITE / "_raw"
FINAL = SITE / "final"
PAD = 8

# Pinned picks, filled in after looking at the review sheet: the flood gate
# judges the background and the sharpness tiebreak judges the outline, and
# neither can tell whether the object is the thing that was asked for.
PICK_OVERRIDE = {}


def cut(src, dst):
    rgb = np.asarray(Image.open(src).convert("RGB"))
    flood, _ = M.background_flood(rgb.astype(np.int16))
    obj = ~flood
    if not obj.any():
        return False
    rgba = np.dstack([rgb, (obj * 255).astype(np.uint8)])
    ys, xs = np.where(obj)
    y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + 1 + PAD, rgba.shape[0])
    x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + 1 + PAD, rgba.shape[1])
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA").save(dst)
    return True


def main():
    FINAL.mkdir(parents=True, exist_ok=True)
    report = {}
    print("годность = флуд-филл: заливка >=15%, один связный объект, <=2 края\n")
    print(f"{'id':<16} {'годных':>7}  выбран              резкость")
    print("-" * 60)

    for tid, obj in TASKS:
        srcdir = RAW / tid
        dstdir = SITE / tid
        if dstdir.exists():
            shutil.rmtree(dstdir)
        frames = sorted(srcdir.glob(f"{tid}_*.png")) if srcdir.is_dir() else []

        per_frame, usable = {}, []
        for f in frames:
            ok, share, blobs, edges = M.flood_usable(f)
            sharp = M.sharpness(f)
            per_frame[f.stem] = {
                "usable": ok, "flood_share": round(share, 4),
                "blobs": blobs, "edges": edges, "sharp": round(sharp, 1),
                "reason": None if ok else (
                    "фон не плоский (заливка <15%)" if share < M.FLOOD_MIN
                    else f"объектов {blobs}, не один" if blobs != 1
                    else f"касается {edges} краёв"),
            }
            if ok:
                usable.append((sharp, f))

        chosen = None
        if usable:
            dstdir.mkdir(parents=True, exist_ok=True)
            for _s, f in usable:
                shutil.copy2(f, dstdir / f.name)
            usable.sort(key=lambda t: -t[0])
            best_sharp, best = usable[0]
            pin = PICK_OVERRIDE.get(tid)
            if pin is not None:
                pinned = [(s, f) for s, f in usable if f.stem.endswith(f"_{pin}")]
                if pinned:
                    best_sharp, best = pinned[0]
            if cut(best, FINAL / f"{tid}.png"):
                chosen = best.stem
            mark = " (пик по типу)" if pin is not None else ""
            print(f"{tid:<16} {len(usable)}/{len(frames):<5}  {best.stem:<21} "
                  f"{best_sharp:6.1f}{mark}")
        else:
            print(f"{tid:<16} 0/{len(frames):<5}  — БРАК ПО ВСЕМ СИДАМ")

        report[tid] = {
            "object": obj, "total": len(frames), "usable": len(usable),
            "chosen": chosen, "frames": per_frame,
        }

    shipped = [t for t, r in report.items() if r["chosen"]]
    dead = [t for t, r in report.items() if not r["chosen"]]
    tot_u = sum(r["usable"] for r in report.values())
    tot_n = sum(r["total"] for r in report.values())
    print("-" * 60)
    print(f"кадров годных {tot_u}/{tot_n} ({tot_u/max(tot_n,1)*100:.0f}%), "
          f"позиций со спрайтом {len(shipped)}/{len(TASKS)}")
    if dead:
        print("\nбрак по всем сидам:")
        for t in dead:
            marks = [v["reason"] for v in report[t]["frames"].values()]
            print(f"  {t:<16} причины: {', '.join(sorted(set(m for m in marks if m)))}")

    (SITE / "batch7.json").write_text(
        json.dumps({"seeds": SEEDS, "lora": "fellmise_objects_v1", "tasks": report},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n-> {SITE/'batch7.json'}")


if __name__ == "__main__":
    main()
