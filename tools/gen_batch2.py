"""Batch 2 for the site pack: re-prompt res_wood, add six new resource icons.

    python tools/gen_batch2.py

Same battle preset as everything else — the graph comes from
objects_battle_v1.json via gen_site_pack.load_template(), which re-asserts the
whole preset on every run, so batch 2 cannot silently drift from batch 1.

res_wood is regenerated into _raw/res_wood_v2/ rather than over the v1 frames:
v1 rendered a sawn stump instead of stacked timber. If the pine framing also
collapses to a stump, FALLBACK_WOOD is the second formulation to try.
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

FALLBACK_WOOD = "pile of freshly cut wood logs with axe"

TASKS = [
    ("res_wood_v2", "tall pine tree with wood logs stacked at the base"),
    ("res_staff", "wooden mage staff with glowing blue crystal on top"),
    ("res_spellbook", "open magic spellbook with glowing runes"),
    ("res_runes", "carved rune stones with glowing symbols"),
    ("res_axe", "battle axe with steel blade"),
    ("res_shield", "round wooden shield with iron rim"),
    ("res_dagger", "steel dagger with leather grip"),
]


def generate(template, tid, obj):
    outdir = RAW / tid
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "prompt.txt").write_text(G.PROMPT_TEMPLATE.format(obj=obj), encoding="utf-8")
    made = 0
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
            made += 1
            print(f"  {path.name}  {time.time()-t0:5.1f}s", flush=True)
        except Exception as exc:  # noqa: BLE001
            ERRLOG.parent.mkdir(parents=True, exist_ok=True)
            with ERRLOG.open("a", encoding="utf-8") as fh:
                fh.write(f"{time.strftime('%H:%M:%S')} {tid}_{seed} "
                         f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}---\n")
            print(f"  !! {tid}_{seed} FAILED ({type(exc).__name__}: {exc})", flush=True)
            time.sleep(5)
    return made


def main():
    template = G.load_template()
    total = len(TASKS) * len(SEEDS)
    print(f"batch 2: {len(TASKS)} заданий x {len(SEEDS)} сидов = {total} кадров\n", flush=True)
    t0 = time.time()
    for tid, obj in TASKS:
        print(f"{tid}: {obj}", flush=True)
        generate(template, tid, obj)
    print(f"\nготово за {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
