"""Batch 5: ground textures and the anti-cliche stump.

    python tools/gen_batch5.py

Same battle preset. Two groups with different downstream handling:

  ground_* / road_segment  — these are TILES, not objects. The flood-fill cut
      must NOT run on them: cutting would punch the texture out of its own
      frame. finish_batch5.py copies them whole.

  biome_stump_v2 — re-prompt away from the "axe buried in the stump" cliche
      (see tools/README.md). FALLBACK_STUMP drops the axe entirely if the model
      keeps burying it.
"""

import argparse
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

FALLBACK_STUMP = "old tree stump with wood chips around"

TASKS = [
    ("ground_grass", "square grass ground texture patch, top-down"),
    ("ground_dirt", "square dark cave floor texture patch, top-down"),
    ("ground_spirit", "square dark mossy ground texture patch, top-down"),
    ("road_segment", "long horizontal dirt road segment with grass patches on edges"),
    ("biome_stump_v2",
     "old tree stump, woodcutter axe leaning against it, wood chips on ground"),
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--fallback-stump", action="store_true")
    args = ap.parse_args()

    template = G.load_template()
    if args.fallback_stump:
        print(f"fallback stump: {FALLBACK_STUMP}\n", flush=True)
        generate(template, "biome_stump_fb", FALLBACK_STUMP)
        return

    print(f"batch 5: {len(TASKS)} заданий x {len(SEEDS)} сидов = "
          f"{len(TASKS)*len(SEEDS)} кадров\n", flush=True)
    t0 = time.time()
    for tid, obj in TASKS:
        print(f"{tid}: {obj}", flush=True)
        generate(template, tid, obj)
    print(f"\nготово за {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
