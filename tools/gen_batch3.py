"""Batch 3: re-prompt two feature sprites, add four road props.

    python tools/gen_batch3.py

Same battle preset (graph loaded from objects_battle_v1.json, asserts re-run).
Re-prompts land in _raw/<id>_v2/ so the v1 frames stay addressable.

feat_skills v1 wove a bow through the rack; the new phrasing names exactly two
weapons on hooks. FALLBACK_RACK is the retreat if it still weaves items in.
"""

import pathlib
import sys
import time
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gen_site_pack as G  # noqa: E402

PIPELINE = pathlib.Path(r"D:\Dev\pixelart-pipeline")
sys.path.insert(0, str(PIPELINE))
import comfy_client as cc  # noqa: E402

from site_tasks import SEEDS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
ERRLOG = ROOT / "out" / "site_assets" / "gen_errors.log"

FALLBACK_RACK = "wooden weapon rack with single sword on hooks"

TASKS = [
    ("feat_skills_v2", "wooden weapon rack with sword and battle axe hanging on hooks"),
    ("feat_craft_v2", "blacksmith anvil with steel hammer lying on it and glowing orange metal bar"),
    ("prop_signpost", "wooden signpost with two direction arrows"),
    ("prop_lantern", "street lantern on wooden post with warm light"),
    ("prop_crates", "stack of two wooden crates with rope"),
    ("prop_stones", "small cluster of gray cobblestones"),
]


def generate(template, tid, obj):
    outdir = RAW / tid
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "prompt.txt").write_text(G.PROMPT_TEMPLATE.format(obj=obj), encoding="utf-8")
    for seed in SEEDS:
        path = outdir / f"{tid}_{seed}.png"
        if path.exists():
            print(f"  skip {path.name}", flush=True)
            continue
        try:
            t0 = time.time()
            blobs = cc.fetch_images(cc.wait_for(cc.submit(G.build(template, obj, seed)),
                                                timeout=900))
            if not blobs:
                raise RuntimeError("no image returned")
            path.write_bytes(blobs[0])
            print(f"  {path.name}  {time.time()-t0:5.1f}s", flush=True)
        except Exception as exc:  # noqa: BLE001
            ERRLOG.parent.mkdir(parents=True, exist_ok=True)
            with ERRLOG.open("a", encoding="utf-8") as fh:
                fh.write(f"{time.strftime('%H:%M:%S')} {tid}_{seed} "
                         f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}---\n")
            print(f"  !! {tid}_{seed} FAILED ({type(exc).__name__}: {exc})", flush=True)
            time.sleep(5)


def main():
    template = G.load_template()
    print(f"batch 3: {len(TASKS)} заданий x {len(SEEDS)} сидов = "
          f"{len(TASKS)*len(SEEDS)} кадров\n", flush=True)
    t0 = time.time()
    for tid, obj in TASKS:
        print(f"{tid}: {obj}", flush=True)
        generate(template, tid, obj)
    print(f"\nготово за {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
