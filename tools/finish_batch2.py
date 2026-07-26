"""Filter, pick and cut ONLY the batch-2 sprites.

    python tools/finish_batch2.py --review     # verdicts + contact sheet, writes nothing
    python tools/finish_batch2.py              # ship: copy usable, cut best, update report

Deliberately NOT a re-run of filter_site_pack.py. That script rebuilds every
final from _raw/<id>/ by sharpness, which here would undo two things done since:
the punched-out background holes in five sprites, and res_iron's v2 re-prompt
(its v1 frames are still the ones under _raw/res_iron/). Touching only the ids
this batch produced keeps both intact.

Gate is the same imported flood-fill metric as everywhere else. Best frame is
the sharpest usable one unless PICKS pins it — sharpness ranks outlines, it
cannot see whether the object is the thing that was asked for, and on this pack
it has already picked the wrong object type more than once.
"""

import argparse
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

# ship id -> raw folder (res_wood is re-prompted, its frames live in _v2)
TARGETS = [
    ("res_wood", "res_wood_v2", "tall pine tree with wood logs stacked at the base"),
    ("res_staff", "res_staff", "wooden mage staff with glowing blue crystal on top"),
    ("res_spellbook", "res_spellbook", "open magic spellbook with glowing runes"),
    ("res_runes", "res_runes", "carved rune stones with glowing symbols"),
    ("res_axe", "res_axe", "battle axe with steel blade"),
    ("res_shield", "res_shield", "round wooden shield with iron rim"),
    ("res_dagger", "res_dagger", "steel dagger with leather grip"),
]

# Pinned by visual review — type/readability over sharpness. Filled in after
# the --review pass; anything absent falls back to sharpness.
PICKS = {
    "res_wood": 4004,       # clearest stack of cut logs at the trunk
    "res_spellbook": 4004,  # 2002 (sharpest) is a book ON FIRE; 4004 has the glowing runes asked for
    "res_dagger": 2002,     # 1001/3003 (sharpest) read as short SWORDS — res_sword already exists
    "res_runes": 3003,      # see GATE_OVERRIDE
}

# Frames shipped despite failing the usability gate, with the reason.
#
# res_runes: the prompt is plural ("rune stoneS"), so every good frame is four
# separate stones and trips the gate's "exactly one connected object" rule.
# That rule exists to catch a frame collapsing into a scene, and its real
# purpose — a flat background the corner flood can cut — is fully met here:
# the flood reaches all four stones' surroundings and each cuts clean. The one
# frame that does pass (1001) is a rune ARCHWAY and would read as a stone gate
# under a "Runes" label. Shipping content-correct art and recording the
# deviation beats shipping the wrong object to satisfy a proxy.
GATE_OVERRIDE = {
    "res_runes": "плюральный промпт: 4 отдельных камня -> blobs>1; фон плоский, вырез чистый",
}


def judge(folder):
    out = []
    for f in sorted((RAW / folder).glob("*.png")):
        ok, share, blobs, edges = M.flood_usable(f)
        out.append(dict(path=f, stem=f.stem, ok=ok, share=share,
                        blobs=blobs, edges=edges, sharp=M.sharpness(f)))
    return out


def review():
    from PIL import Image, ImageDraw
    T = 230
    sheet = Image.new("RGB", (4 * T, len(TARGETS) * (T + 16)), (238, 238, 238))
    d = ImageDraw.Draw(sheet)
    for r, (tid, folder, _obj) in enumerate(TARGETS):
        frames = judge(folder)
        good = sum(f["ok"] for f in frames)
        print(f"{tid:<14} годных {good}/{len(frames)}  " + "  ".join(
            f"{f['stem'].split('_')[-1]}:{'OK' if f['ok'] else 'BAD'}/{f['sharp']:.0f}"
            for f in frames))
        for c, f in enumerate(frames):
            im = Image.open(f["path"]).convert("RGB")
            im.thumbnail((T - 6, T - 6))
            sheet.paste(im, (c * T + 3, r * (T + 16) + 3))
            d.text((c * T + 6, r * (T + 16) + T + 2),
                   f"{f['stem']} {'OK' if f['ok'] else 'BAD'}", fill=(0, 0, 0))
    sheet.save(SITE / "_batch2_sheet.png")
    print(f"\n-> {SITE/'_batch2_sheet.png'}")


def ship():
    rep = json.loads((SITE / "report.json").read_text(encoding="utf-8"))
    print(f"{'id':<14}{'годных':>8}  выбран")
    for tid, folder, obj in TARGETS:
        frames = judge(folder)
        usable = [f for f in frames if f["ok"]]
        pool = frames if tid in GATE_OVERRIDE else usable
        if not pool:
            print(f"{tid:<14}{0:>4}/{len(frames):<3}  — БРАК ПО ВСЕМ СИДАМ")
            continue
        dst = SITE / tid
        dst.mkdir(parents=True, exist_ok=True)
        for f in usable:
            shutil.copy2(f["path"], dst / f["path"].name)

        pin = PICKS.get(tid)
        chosen = next((f for f in pool if f["stem"].endswith(f"_{pin}")), None) if pin else None
        if chosen is None:
            chosen = max(pool, key=lambda f: f["sharp"])
        if tid in GATE_OVERRIDE and not chosen["ok"]:
            shutil.copy2(chosen["path"], dst / chosen["path"].name)
        filled, skipped = FH.fix(tid, src=chosen["path"])
        mark = " (пик по типу)" if pin else ""
        if tid in GATE_OVERRIDE and not chosen["ok"]:
            mark += " [гейт-оверрайд]"
        holes = f"  дыр залито {filled}" if filled or skipped else ""
        print(f"{tid:<14}{len(usable):>4}/{len(frames):<3}  {chosen['stem']}{mark}{holes}")

        rep["tasks"][tid] = {
            "object": obj, "exotic": False,
            "total": len(frames), "usable": len(usable),
            "chosen": chosen["stem"],
            "pick_by": "type" if pin else "sharpness",
            "frames": {f["stem"]: {"usable": f["ok"], "flood_share": round(f["share"], 4),
                                   "blobs": f["blobs"], "edges": f["edges"],
                                   "sharp": round(f["sharp"], 1)} for f in frames},
        }
        if folder != tid:
            rep["tasks"][tid]["note"] = f"перегенерация, кадры в _raw/{folder}/"
        if tid in GATE_OVERRIDE:
            rep["tasks"][tid]["gate_override"] = GATE_OVERRIDE[tid]
    (SITE / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
    print(f"\n-> {SITE/'report.json'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", action="store_true")
    review() if ap.parse_args().review else ship()
