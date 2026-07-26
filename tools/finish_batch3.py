"""Filter, pick and cut ONLY the batch-3 sprites.

    python tools/finish_batch3.py

Same reasoning as finish_batch2: a full filter_site_pack re-run would rebuild
every final by sharpness and undo the punched holes, res_iron's v2 and the
earlier type-picks. This touches only what batch 3 produced.

Picks are pinned by review — sharpness ranks outlines, not whether the object
is the thing that was asked for.
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

# ship id, raw folder, prompt, pinned seed (None -> sharpest usable)
TARGETS = [
    ("feat_skills", "feat_skills_v2",
     "wooden weapon rack with sword and battle axe hanging on hooks", 1001),
    ("feat_craft", "feat_craft_v2",
     "blacksmith anvil with steel hammer lying on it and glowing orange metal bar", 2002),
    ("prop_signpost", "prop_signpost", "wooden signpost with two direction arrows", 4004),
    ("prop_lantern", "prop_lantern", "street lantern on wooden post with warm light", 4004),
    ("prop_crates", "prop_crates", "stack of two wooden crates with rope", 2002),
    ("prop_stones", "prop_stones", "small cluster of gray cobblestones", 1001),
]

# why each pin, so the choice is auditable later
WHY = {
    "feat_skills": "единственный кадр ровно с мечом и секирой на крюках (2002/3003 вплетают лишнее, 4004 брак)",
    "feat_craft": "молот лежит на наковальне + светящаяся заготовка, самый чистый силуэт",
    "prop_signpost": "две стрелки в разные стороны — читается как развилка",
    "prop_lantern": "тёплое окно без размытого ореола вокруг (у 2002 гало плохо режется)",
    "prop_crates": "два ящика и верёвка, самый резкий",
    "prop_stones": "плоский кластер булыжника — ложится на дорогу (4004 куча, 3003 плитка)",
}


def main():
    rep = json.loads((SITE / "report.json").read_text(encoding="utf-8"))
    print(f"{'id':<15}{'годных':>8}  выбран")
    for tid, folder, obj, pin in TARGETS:
        frames = []
        for f in sorted((RAW / folder).glob("*.png")):
            ok, share, blobs, edges = M.flood_usable(f)
            frames.append(dict(path=f, stem=f.stem, ok=ok, share=share,
                               blobs=blobs, edges=edges, sharp=M.sharpness(f)))
        usable = [f for f in frames if f["ok"]]
        if not usable:
            print(f"{tid:<15}{0:>4}/{len(frames):<3}  — БРАК ПО ВСЕМ СИДАМ")
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
        print(f"{tid:<15}{len(usable):>4}/{len(frames):<3}  {chosen['stem']}{holes}")

        rep["tasks"][tid] = {
            "object": obj, "exotic": False,
            "total": len(frames), "usable": len(usable),
            "chosen": chosen["stem"], "pick_by": "type",
            "pick_reason": WHY.get(tid, ""),
            "frames": {f["stem"]: {"usable": f["ok"], "flood_share": round(f["share"], 4),
                                   "blobs": f["blobs"], "edges": f["edges"],
                                   "sharp": round(f["sharp"], 1)} for f in frames},
        }
        if folder != tid:
            rep["tasks"][tid]["note"] = f"перегенерация, кадры в _raw/{folder}/"
    (SITE / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
    print(f"\n-> {SITE/'report.json'}")


if __name__ == "__main__":
    main()
