"""Batch 6: the defect-list art fixes.

    python tools/gen_batch6.py

Same battle preset. Four re-prompts from the owner's defect list:

  biome_stump_v3   no axe at all — v2 still reads as the "axe in the stump"
                   cliche even when it only leans (see tools/README.md).
  biome_orevein_fb the v1 art is a walled tile, not an object; asked for a rock
                   formation with a cave mouth instead.
  biome_crystals_v2 v1 carries a grey plinth whose fringe survives defringe.
  feat_pvp_v2      v1 crops the flag; ask for the whole banner in frame.
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

TASKS = [
    ("biome_stump_v3", "old tree stump with wood chips around"),
    ("biome_orevein_fb",
     "large dark rock formation with glowing blue crystals, cave entrance"),
    ("biome_crystals_v2", "cluster of tall glowing purple crystals on bare rock"),
    ("feat_pvp_v2", "war banner on wooden pole, full flag visible"),
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
    print(f"batch 6: {len(TASKS)} заданий x {len(SEEDS)} сидов = "
          f"{len(TASKS)*len(SEEDS)} кадров\n", flush=True)
    t0 = time.time()
    for tid, obj in TASKS:
        print(f"{tid}: {obj}", flush=True)
        generate(template, tid, obj)
    print(f"\nготово за {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
