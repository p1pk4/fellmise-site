"""Metrics and comparison sheets for the fellmise_sprite_v2 acceptance.

    python tools/report_lora_v2.py

Reads out/lora_v2/<tag>/<id>_<seed>.png, written by tools/run_lora_v2.py.
Nothing in the pipeline is touched; its metric module is imported so the gate
here is the same one the preset was accepted on.

What is measured, and what is not:

  вердикт     — the pipeline's own three-level frame_verdict at its own
                threshold: OK, SOFT (background fine, outline too soft), BG
                (failed the background cut). This is the gate the pipeline
                accepted v2 on, so it is reported alongside the plain one.
  годных      — the pipeline's flood_usable: the background floods inward from
                the corners over >=15% of the frame, exactly one connected
                object remains, and it touches <=2 edges. Objective.
  фон         — how much of the frame that flood covered. Higher is a cleaner,
                flatter background. Objective.
  резкость    — variance of the Laplacian in a band around the silhouette.
                Objective, and known to under-read on smooth props.
  ореол       — the outermost ring's luminance minus the interior's, on the cut
                sprite. This is the pale sticker stroke that shows up as a grey
                halo the moment the sprite is filtered. Objective.

  тип         — whether the frame is the object that was ASKED for. NOT measured
                here and deliberately left out of the table. A flood-fill cannot
                tell a haystack from a tree stump; the sheets are written so a
                person can decide, the same way the pipeline leaves its isolation
                column to the eye rather than inventing a number for it.
"""

import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

PIPELINE = pathlib.Path(r"D:\Dev\ART_Fellmise")
sys.path.insert(0, str(PIPELINE / "scripts"))
import acceptance_metrics as M  # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from run_lora_v2 import RUNS, SEEDS, TASKS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out" / "lora_v2"
SHEETS = ROOT / "out" / "lora_v2_sheets"
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
PAD = 8


def font(sz):
    for n in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(n, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def cut(path):
    """Same corner flood as the shipping cut, so the halo is measured on what
    would actually be packaged."""
    rgb = np.asarray(Image.open(path).convert("RGB"))
    flood, _ = M.background_flood(rgb.astype(np.int16))
    obj = ~flood
    if not obj.any():
        return None
    rgba = np.dstack([rgb, (obj * 255).astype(np.uint8)])
    ys, xs = np.where(obj)
    y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + 1 + PAD, rgba.shape[0])
    x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + 1 + PAD, rgba.shape[1])
    return Image.fromarray(rgba[y0:y1, x0:x1], mode="RGBA")


def halo(im):
    a = np.asarray(im).astype(np.float32)
    solid = a[..., 3] > 8
    ring = solid & ~ndimage.binary_erosion(solid, iterations=2)
    inner = ndimage.binary_erosion(solid, iterations=10)
    if not ring.any() or not inner.any():
        return None
    lum = (a[..., :3] / 255.0) @ LUMA
    return float((lum[ring].mean() - lum[inner].mean()) * 100)


def collect():
    data = {}
    for tid, prompt, group in TASKS:
        data[tid] = {"prompt": prompt, "group": group, "runs": {}}
        for tag, _lora, weight in RUNS:
            frames = {}
            for seed in SEEDS:
                f = OUT / tag / f"{tid}_{seed}.png"
                if not f.exists():
                    frames[seed] = None
                    continue
                ok, share, blobs, edges = M.flood_usable(f)
                sprite = cut(f)
                verdict, _o, _s, _b, _e = M.frame_verdict(f, M.SHARP_THRESHOLD)
                frames[seed] = {
                    "ok": bool(ok), "verdict": verdict,
                    "share": round(float(share), 4),
                    "blobs": int(blobs), "edges": int(edges),
                    "sharp": round(float(M.sharpness(f)), 1),
                    "halo": None if sprite is None else round(halo(sprite) or 0.0, 1),
                }
            data[tid]["runs"][tag] = {"weight": weight, "frames": frames}
    return data


def agg(frames):
    got = [f for f in frames.values() if f]
    ok = [f for f in got if f["ok"]]
    if not got:
        return None
    return {
        "n": len(got), "ok": len(ok),
        "v_ok": sum(1 for f in got if f["verdict"] == "OK"),
        "v_soft": sum(1 for f in got if f["verdict"] == "SOFT"),
        "v_bg": sum(1 for f in got if f["verdict"] == "BG"),
        "share": float(np.mean([f["share"] for f in got])),
        "sharp": float(np.mean([f["sharp"] for f in ok])) if ok else 0.0,
        "halo": float(np.mean([f["halo"] for f in got if f["halo"] is not None])),
    }


def sheet(tid, info):
    """One object: a row per model/weight, a column per seed, on both beds."""
    C, GAP, LAB, HEAD = 260, 8, 176, 46
    f, hf = font(14), font(19)
    rows = [(tag, info["runs"][tag]) for tag, _l, _w in RUNS if tag in info["runs"]]
    W = LAB + len(SEEDS) * (C + GAP) + GAP
    H = HEAD + len(rows) * (C + 30) + GAP

    for bed_name, bed, ink in (("cream", (253, 246, 224), (40, 42, 34)),
                               ("dark", (26, 30, 34), (238, 234, 222))):
        im = Image.new("RGB", (W, H), bed)
        d = ImageDraw.Draw(im)
        d.text((GAP, 10), f"{tid} — {info['prompt']}  [{info['group']}]", fill=ink, font=hf)
        for c, seed in enumerate(SEEDS):
            d.text((LAB + c * (C + GAP) + 4, HEAD - 18), f"сид {seed}", fill=ink, font=f)
        for r, (tag, run) in enumerate(rows):
            y = HEAD + r * (C + 30)
            model = "v1" if tag.startswith("v1") else "v2"
            d.text((GAP, y + C // 2 - 18), f"{model} @ {run['weight']}", fill=ink, font=hf)
            for c, seed in enumerate(SEEDS):
                x = LAB + c * (C + GAP)
                fr = run["frames"].get(seed)
                p = OUT / tag / f"{tid}_{seed}.png"
                if not fr or not p.exists():
                    d.text((x + 8, y + C // 2), "нет кадра", fill=ink, font=f)
                    continue
                sprite = cut(p)
                cell = Image.new("RGBA", sprite.size, bed + (255,))
                cell = Image.alpha_composite(cell, sprite).convert("RGB")
                cell.thumbnail((C - 8, C - 8))
                im.paste(cell, (x + (C - cell.width) // 2, y + (C - cell.height) // 2))
                mark = fr["verdict"]
                d.text((x + 4, y + C + 4),
                       f"{mark} · фон {fr['share']*100:.0f}% · ореол {fr['halo']:+.0f}",
                       fill=ink, font=f)
        SHEETS.mkdir(parents=True, exist_ok=True)
        im.save(SHEETS / f"v1_vs_v2_{tid}_{bed_name}.png")


def main():
    if not OUT.is_dir():
        raise SystemExit(f"нет кадров в {OUT} — сначала tools/run_lora_v2.py")
    data = collect()

    tags = [t for t, _l, _w in RUNS]
    print("вердикт пайплайна (OK из 4 сидов), порог контурной резкости "
          f"{M.SHARP_THRESHOLD}\n")
    print(f"{'объект':<16}{'группа':<12}" + "".join(f"{t:>12}" for t in tags))
    print("-" * (28 + 12 * len(tags)))
    for tid, info in data.items():
        cells = []
        for tag in tags:
            a = agg(info["runs"][tag]["frames"])
            cells.append(f"{a['v_ok']}/{a['n']}" if a else "—")
        print(f"{tid:<16}{info['group']:<12}" + "".join(f"{c:>12}" for c in cells))

    print("\nсводка по прогонам (среднее по всем объектам)")
    print(f"{'прогон':<12}{'OK':>8}{'SOFT':>7}{'BG':>5}{'фон':>9}{'резкость':>11}{'ореол':>9}")
    print("-" * 60)
    summary = {}
    for tag in tags:
        ok = tot = soft = bg = 0
        shares, sharps, halos = [], [], []
        for info in data.values():
            a = agg(info["runs"][tag]["frames"])
            if not a:
                continue
            ok += a["v_ok"]; soft += a["v_soft"]; bg += a["v_bg"]; tot += a["n"]
            shares.append(a["share"]); sharps.append(a["sharp"]); halos.append(a["halo"])
        summary[tag] = dict(ok=ok, soft=soft, bg=bg, total=tot,
                            share=float(np.mean(shares)), sharp=float(np.mean(sharps)),
                            halo=float(np.mean(halos)))
        print(f"{tag:<12}{f'{ok}/{tot}':>8}{soft:>7}{bg:>5}{np.mean(shares)*100:8.1f}%"
              f"{np.mean(sharps):11.0f}{np.mean(halos):+9.1f}")

    print("\nпо группам (годных)")
    groups = sorted({i["group"] for i in data.values()})
    print(f"{'группа':<14}" + "".join(f"{t:>12}" for t in tags))
    for g in groups:
        cells = []
        for tag in tags:
            ok = tot = 0
            for info in data.values():
                if info["group"] != g:
                    continue
                a = agg(info["runs"][tag]["frames"])
                if a:
                    ok += a["v_ok"]; tot += a["n"]
            cells.append(f"{ok}/{tot}")
        print(f"{g:<14}" + "".join(f"{c:>12}" for c in cells))

    for tid, info in data.items():
        sheet(tid, info)
    print(f"\n-> листы: {SHEETS} ({len(data)*2} файлов)")

    (OUT / "metrics.json").write_text(
        json.dumps({"summary": summary, "tasks": data}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    print(f"-> {OUT/'metrics.json'}")


if __name__ == "__main__":
    main()
