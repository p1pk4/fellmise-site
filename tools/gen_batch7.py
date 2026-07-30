"""Batch 7 — set dressing for journey v3 stage 2.

    python tools/gen_batch7.py

RUNS ON fellmise_objects_v1, the accepted battle preset. A newer LoRA
(fellmise_sprite_v2) and its workflow exist in the pipeline, but the owner has
not signed it off, and the brief is explicit: without acceptance, generate on
v1. The graph is loaded from the archived v1 workflow and re-asserted here, so
the preset cannot drift.

The pipeline moved to D:\\Dev\\ART_Fellmise; only its client and workflow are
read, nothing there is written to.
"""

import json
import pathlib
import sys
import time
import traceback

PIPELINE = pathlib.Path(r"D:\Dev\ART_Fellmise")
sys.path.insert(0, str(PIPELINE / "scripts"))
import comfy_client as cc  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
ERRLOG = ROOT / "out" / "site_assets" / "gen_errors.log"
WORKFLOW = PIPELINE / "workflows" / "objects_battle_v1_archived.json"

SEEDS = [1001, 2002, 3003, 4004]
PROMPT = "fllmse style, {obj}, game asset, top-down view, plain gray background"

TASKS = [
    # sky
    ("cloud_a", "fluffy white cloud"),
    ("cloud_b", "long stretched cloud"),
    ("cloud_c", "dark storm cloud"),
    ("moon", "full moon with craters"),
    # terrain backdrops and near dressing
    ("hill_green", "wide green grassy hill"),
    ("hill_dark", "wide dark distant hill"),
    ("rock_s", "small mossy boulder"),
    ("rock_m", "medium mossy boulder"),
    ("rock_l", "large mossy boulder"),
    ("grass_tuft_a", "large grass tuft with blades"),
    ("grass_tuft_b", "tall grass tuft with blades"),
    ("branch_canopy", "hanging tree branch with leaves"),
    # village
    ("fence_seg", "wooden fence segment with two posts"),
    ("barn", "wooden barn with hay loft"),
    ("haystack", "round haystack"),
    # forest
    ("mushrooms", "cluster of forest mushrooms"),
    ("fern", "green fern plant"),
    # mine
    ("beam_frame", "wooden mine support frame"),
    ("stalagmite_a", "tall cave stalagmite"),
    ("stalagmite_b", "short cave stalagmite"),
    ("minecart", "wooden mine cart full of ore"),
    ("lantern_chain", "hanging lantern on chain"),
    ("ore_pile", "pile of raw ore chunks"),
    # spirit
    ("grave_a", "old crooked gravestone leaning to one side"),
    ("grave_b", "old gravestone with a crack"),
    ("grave_c", "old gravestone covered with ivy"),
    ("candles", "cluster of melted candles with flames"),
    # final
    ("chest", "closed wooden treasure chest"),
]


def load_template():
    doc = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    wf = doc["prompt"]
    lora = wf["10"]["inputs"]
    ks = wf["3"]["inputs"]
    assert lora["lora_name"] == "fellmise_objects_v1.safetensors", lora["lora_name"]
    assert lora["strength_model"] == 0.7 and lora["strength_clip"] == 0.7
    assert wf["4"]["inputs"]["ckpt_name"] == "flux1-dev-fp8.safetensors"
    assert ks["steps"] == 20 and ks["cfg"] == 1.0
    assert ks["sampler_name"] == "euler" and ks["scheduler"] == "simple"
    assert wf["8"]["inputs"]["guidance"] == 3.5
    assert wf["5"]["inputs"]["width"] == wf["5"]["inputs"]["height"] == 1024
    assert len([n for n in wf.values() if n["class_type"] == "LoraLoader"]) == 1
    return doc


def build(template, obj, seed):
    wf = json.loads(json.dumps(template["prompt"]))
    wf["6"]["inputs"]["text"] = PROMPT.format(obj=obj)
    wf["3"]["inputs"]["seed"] = seed
    wf["12"]["inputs"]["filename_prefix"] = cc.unique_prefix("dress")
    return wf


def main():
    template = load_template()
    total = len(TASKS) * len(SEEDS)
    print(f"batch 7 (dressing): {len(TASKS)} позиций x {len(SEEDS)} сидов = {total} кадров")
    print("LoRA: fellmise_objects_v1 @0.7 (приёмки v2 не было)\n", flush=True)
    t0 = time.time()
    made = skipped = failed = 0

    for tid, obj in TASKS:
        outdir = RAW / tid
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "prompt.txt").write_text(PROMPT.format(obj=obj), encoding="utf-8")
        print(f"{tid}: {obj}", flush=True)
        for seed in SEEDS:
            path = outdir / f"{tid}_{seed}.png"
            if path.exists():
                skipped += 1
                continue
            try:
                t1 = time.time()
                blobs = cc.fetch_images(cc.wait_for(cc.submit(build(template, obj, seed)),
                                                    timeout=900))
                if not blobs:
                    raise RuntimeError("no image returned")
                path.write_bytes(blobs[0])
                made += 1
                done = made + skipped + failed
                eta = (time.time() - t0) / max(made, 1) * (total - done) / 60
                print(f"  [{done}/{total}] {path.name}  {time.time()-t1:5.1f}s  ETA {eta:4.1f} мин",
                      flush=True)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                ERRLOG.parent.mkdir(parents=True, exist_ok=True)
                with ERRLOG.open("a", encoding="utf-8") as fh:
                    fh.write(f"{time.strftime('%H:%M:%S')} {tid}_{seed} "
                             f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}---\n")
                print(f"  !! {tid}_{seed} FAILED ({type(exc).__name__}: {exc})", flush=True)
                time.sleep(5)

    print(f"\nсгенерировано {made}, пропущено {skipped}, ошибок {failed} из {total}")
    print(f"всего {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
