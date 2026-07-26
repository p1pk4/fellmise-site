"""Auto-filter the site pack and cut the best frame of each task.

    python tools/filter_site_pack.py

Filter = the LORA_PLAN v1 usability metric, imported verbatim from the
pipeline's acceptance_metrics.flood_usable: flood the background inward from
the frame corners (+-12 around the corner median) and accept the frame iff
  (a) the flood covers >= 15% of the frame  — the background really is flat,
  (b) exactly one connected object remains  — islands < 0.5% ignored,
  (c) the object touches <= 2 frame edges.
It is imported rather than reimplemented so the gate here cannot drift from
the one the preset was accepted on.

Outputs:
  out/site_assets/<id>/<id>_<seed>.png   every usable frame (full 1024 RGB)
  out/site_assets/final/<id>.png         best frame, cut out, RGBA
  out/site_assets/report.json            per-frame verdicts + the summary table

Best frame = highest contour-band sharpness among the usable frames
(acceptance_metrics.sharpness — variance of the Laplacian over a ~6px band
around the silhouette). That is the project's own secondary metric and the only
mechanical tiebreak available; on plain smooth props it is known to under-read
(see LORA_PLAN / pipeline DEVLOG), so it ranks rather than rejects — a task
with usable frames always ships one.

The cut is the same corner flood, alpha'd and cropped to the object bbox + 8px
padding — identical to scripts/export_sprites.py, so what ships is exactly what
the metric judged.
"""

import json
import pathlib
import shutil
import sys

import numpy as np
from PIL import Image

PIPELINE = pathlib.Path(r"D:\Dev\pixelart-pipeline")
sys.path.insert(0, str(PIPELINE / "scripts"))

import acceptance_metrics as M  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from site_tasks import EXOTIC, SEEDS, TASKS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "out" / "site_assets"
RAW = SITE / "_raw"
FINAL = SITE / "final"
PAD = 8

# Content overrides for the "best frame" pick.
#
# The flood-fill gate judges the BACKGROUND, and the sharpness tiebreak judges
# the OUTLINE — neither can tell whether the object is the thing that was asked
# for. Where visual review found the sharpest usable frame to be the wrong
# object type, the pick is pinned here instead. Type correctness outranks a
# mechanical tiebreak; the frames themselves are untouched and every usable
# seed still ships in out/site_assets/<id>/.
PICK_OVERRIDE = {
    # seeds 2002/3003/4004 all render a double-bladed AXE; 1001 is the only
    # frame with an actual pick head.
    "res_pickaxe": 1001,
    # 4004 (sharpest) is a tiny malformed bundle and 1001 reads as a crossbow;
    # 2002 is a clean bow with a quiver of arrows, i.e. the prompt.
    "res_bow": 2002,
    # every seed leans architectural (the known exotic risk), but 3003 carries a
    # door AND a window while 4004 is a horned, bone-studded totem with neither.
    # (id renamed from its original name in iteration 3.)
    "feat_vendetta": 4004,
}


def cut(src, dst):
    """Corner flood -> alpha -> crop to object bbox + PAD. Same as export_sprites."""
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
    print(f"{'id':<16} {'годных':>7}  выбран           резкость")
    print("-" * 58)

    for tid, obj, _exotic in TASKS:
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
            print(f"{tid:<16} {len(usable)}/{len(frames):<5}  {best.stem:<18} "
                  f"{best_sharp:6.1f}{mark}")
        else:
            print(f"{tid:<16} 0/{len(frames):<5}  — БРАК ПО ВСЕМ СИДАМ"
                  + ("  (экзотика)" if tid in EXOTIC else ""))

        report[tid] = {
            "object": obj, "exotic": tid in EXOTIC,
            "total": len(frames), "usable": len(usable),
            "chosen": chosen, "pick_by": "type" if tid in PICK_OVERRIDE else "sharpness",
            "frames": per_frame,
        }

    shipped = [t for t, r in report.items() if r["chosen"]]
    dead = [t for t, r in report.items() if not r["chosen"]]
    tot_u = sum(r["usable"] for r in report.values())
    tot_n = sum(r["total"] for r in report.values())
    print("-" * 58)
    print(f"кадров годных {tot_u}/{tot_n} ({tot_u/max(tot_n,1)*100:.0f}%), "
          f"заданий со спрайтом {len(shipped)}/{len(TASKS)}")
    if dead:
        print("\nбрак по всем сидам (кандидаты в перепромпт / датасет v2):")
        for t in dead:
            marks = [f"{v['reason']}" for v in report[t]["frames"].values()]
            print(f"  {t:<16} {'экзотика' if t in EXOTIC else 'обычное':<9} "
                  f"причины: {', '.join(sorted(set(marks)))}")

    (SITE / "report.json").write_text(
        json.dumps({"seeds": SEEDS, "tasks": report}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"\n-> {SITE/'report.json'}")


if __name__ == "__main__":
    main()
