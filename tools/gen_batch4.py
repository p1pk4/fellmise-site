"""Batch 4: biome props for the scroll journey.

    python tools/gen_batch4.py

Same battle preset (graph from objects_battle_v1.json, asserts re-run).

Two entries carry a documented risk and a fallback phrasing, per the brief:
  biome_orevein  — "cave wall section" invites a scene rather than an object;
                   if the background is not flat on any seed, fall back to
                   FALLBACK_OREVEIN.
  biome_portal   — an arch is exotic for a dataset of solid props; on collapse
                   fall back to FALLBACK_PORTAL.
Run with --fallback <id> to regenerate one of them on its fallback phrasing.
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

FALLBACK_OREVEIN = "large dark rock with glowing blue crystals"
FALLBACK_PORTAL = "old stone archway with moss"

TASKS = [
    ("biome_pine_a", "tall dark pine tree"),
    ("biome_pine_b", "two pine trees together"),
    ("biome_stump", "old tree stump with axe stuck in it"),
    ("biome_orevein", "dark cave wall section with glowing blue ore veins"),
    ("biome_crystals", "cluster of tall glowing purple crystals"),
    ("biome_brazier", "iron fire brazier with burning coals"),
    ("biome_deadtree", "bare dead tree with crooked branches"),
    ("biome_portal", "stone arch portal with glowing teal magic surface"),
]

FALLBACKS = {"biome_orevein": FALLBACK_OREVEIN, "biome_portal": FALLBACK_PORTAL}


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
    ap.add_argument("--fallback", choices=sorted(FALLBACKS), default=None)
    args = ap.parse_args()

    template = G.load_template()
    if args.fallback:
        tid = f"{args.fallback}_fb"
        obj = FALLBACKS[args.fallback]
        print(f"fallback {args.fallback}: {obj}\n", flush=True)
        generate(template, tid, obj)
        return

    print(f"batch 4: {len(TASKS)} заданий x {len(SEEDS)} сидов = "
          f"{len(TASKS)*len(SEEDS)} кадров\n", flush=True)
    t0 = time.time()
    for tid, obj in TASKS:
        print(f"{tid}: {obj}", flush=True)
        generate(template, tid, obj)
    print(f"\nготово за {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
