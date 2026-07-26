"""Filter, pick and cut ONLY the batch-4 biome props.

    python tools/finish_batch4.py

Scoped like the earlier finishers: a full filter_site_pack re-run would rebuild
every final by sharpness and undo the punched holes, res_iron v2 and the
type-picks already shipped.

Neither risky prompt needed its fallback — biome_orevein and biome_portal both
came back with a flat background on all four seeds (32/32 usable overall).
"""

import json
import pathlib
import shutil
import sys

PIPELINE = pathlib.Path(r"D:\Dev\pixelart-pipeline")
sys.path.insert(0, str(PIPELINE / "scripts"))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import acceptance_metrics as M  # noqa: E402
import fix_holes as FH  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "out" / "site_assets"
RAW = SITE / "_raw"

# id, prompt, pinned seed, why
TARGETS = [
    ("biome_pine_a", "tall dark pine tree", 3003,
     "самая тёмная и высокая ель, чистый силуэт"),
    ("biome_pine_b", "two pine trees together", 3003,
     "ровно две ели, не сливаются"),
    ("biome_stump", "old tree stump with axe stuck in it", 2002,
     "пень с топором без травяной подложки — ложится на любой грунт"),
    ("biome_orevein", "dark cave wall section with glowing blue ore veins", 1001,
     "читается как вход в шахту с аркой — работает и как проём-гейт"),
    ("biome_crystals", "cluster of tall glowing purple crystals", 2002,
     "самые высокие кристаллы, сильнее свечение"),
    ("biome_brazier", "iron fire brazier with burning coals", 2002,
     "железная чаша на ножках, видны угли и пламя"),
    ("biome_deadtree", "bare dead tree with crooked branches", 3003,
     "голое кривое дерево без подложки — для мира духов"),
    ("biome_portal", "stone arch portal with glowing teal magic surface", 3003,
     "арка с бирюзовой поверхностью и лучами — самый портальный"),
]


def main():
    rep = json.loads((SITE / "report.json").read_text(encoding="utf-8"))
    print(f"{'id':<17}{'годных':>8}  выбран")
    for tid, obj, pin, why in TARGETS:
        frames = []
        for f in sorted((RAW / tid).glob("*.png")):
            ok, share, blobs, edges = M.flood_usable(f)
            frames.append(dict(path=f, stem=f.stem, ok=ok, share=share,
                               blobs=blobs, edges=edges, sharp=M.sharpness(f)))
        usable = [f for f in frames if f["ok"]]
        if not usable:
            print(f"{tid:<17}{0:>4}/{len(frames):<3}  — БРАК ПО ВСЕМ СИДАМ (нужен fallback)")
            continue

        dst = SITE / tid
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True, exist_ok=True)
        for f in usable:
            shutil.copy2(f["path"], dst / f["path"].name)

        chosen = next((f for f in usable if f["stem"].endswith(f"_{pin}")), None) \
            or max(usable, key=lambda f: f["sharp"])
        filled, skipped = FH.fix(tid, src=chosen["path"])
        holes = f"  дыр {filled}" if filled or skipped else ""
        print(f"{tid:<17}{len(usable):>4}/{len(frames):<3}  {chosen['stem']}{holes}")

        rep["tasks"][tid] = {
            "object": obj, "exotic": tid in ("biome_portal", "biome_orevein"),
            "total": len(frames), "usable": len(usable),
            "chosen": chosen["stem"], "pick_by": "type", "pick_reason": why,
            "frames": {f["stem"]: {"usable": f["ok"], "flood_share": round(f["share"], 4),
                                   "blobs": f["blobs"], "edges": f["edges"],
                                   "sharp": round(f["sharp"], 1)} for f in frames},
        }
    (SITE / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
    print(f"\n-> {SITE/'report.json'}")


if __name__ == "__main__":
    main()
