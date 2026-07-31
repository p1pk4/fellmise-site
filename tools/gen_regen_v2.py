"""Regenerate the two sprites that need new art, on the v2 battle preset.

    python tools/gen_regen_v2.py

Runs on fellmise_sprite_v2 @ 0.7 — the pipeline's battle preset since
2026-07-30, and now the site's too (see tools/README.md). The graph is loaded
from `objects_battle_v2.json` and every parameter re-asserted here, so the
preset cannot drift between the two repositories.

Only two objects are generated. `stalagmite_a` / `stalagmite_b` and `haystack`
already have usable v2 frames from the acceptance run in out/lora_v2/ and are
picked from there rather than made again — same model, same weight, same
sampler, so a second run would only spend GPU to get the same pictures.

`branch_hanging` is deliberately absent: eight frames across both models all
came back as a whole tree. That is the prompt, not the model, and it is written
into the dataset notes for v3 instead of being retried here.

The two new prompts are aimed at the defect, not at the look:
  biome_crystals — the shipped sprite carries a painted glow around the spires,
    which the v2 acceptance showed getting worse, not better. The prompt now
    asks for a matte base and no outer glow, and the pick is by CLEANLINESS.
  feat_mining — same baked halo. Re-framed as a pit with the veins inside it,
    so the glow has somewhere to live that is not the silhouette.
"""

import json
import pathlib
import sys
import time
import traceback

PIPELINE = pathlib.Path(r"D:\Dev\ART_Fellmise")
sys.path.insert(0, str(PIPELINE / "scripts"))
import comfy_client as cc  # noqa: E402

# The client hard-codes 127.0.0.1:8188. The headless instance that used to sit
# there is gone; the running ComfyUI listens on 8189. Overridden here rather
# than edited in the pipeline, which stays read-only.
cc.SERVER = "http://127.0.0.1:8189"

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
ERRLOG = ROOT / "out" / "site_assets" / "gen_errors.log"
WORKFLOW = PIPELINE / "workflows" / "objects_battle_v2.json"

LORA = "fellmise_sprite_v2.safetensors"
WEIGHT = 0.7
SEEDS = [1001, 2002, 3003, 4004]
PROMPT = "fllmse style, {obj}, game asset, top-down view, plain gray background"

TASKS = [
    ("biome_crystals",
     "cluster of tall glowing purple crystals, matte dark rock base, no outer glow"),
    ("feat_mining",
     "dark rocky pit with glowing blue ore veins inside"),
]


def load_template():
    doc = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    wf = doc["prompt"]
    lora = wf["10"]["inputs"]
    ks = wf["3"]["inputs"]
    assert lora["lora_name"] == LORA, lora["lora_name"]
    assert lora["strength_model"] == WEIGHT and lora["strength_clip"] == WEIGHT
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
    wf["12"]["inputs"]["filename_prefix"] = cc.unique_prefix("regenv2")
    return wf


def main():
    template = load_template()
    total = len(TASKS) * len(SEEDS)
    print(f"перегенерация на {LORA} @ {WEIGHT}: {len(TASKS)} позиций x "
          f"{len(SEEDS)} сидов = {total} кадров\n", flush=True)
    t0 = time.time()
    made = failed = 0
    for tid, obj in TASKS:
        outdir = RAW / f"{tid}_v2"
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "prompt.txt").write_text(PROMPT.format(obj=obj), encoding="utf-8")
        print(f"{tid}: {obj}", flush=True)
        for seed in SEEDS:
            path = outdir / f"{tid}_{seed}.png"
            if path.exists():
                continue
            try:
                t1 = time.time()
                blobs = cc.fetch_images(
                    cc.wait_for(cc.submit(build(template, obj, seed)), timeout=900))
                if not blobs:
                    raise RuntimeError("no image returned")
                path.write_bytes(blobs[0])
                made += 1
                print(f"  [{made}/{total}] {path.name}  {time.time()-t1:5.1f}s", flush=True)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                ERRLOG.parent.mkdir(parents=True, exist_ok=True)
                with ERRLOG.open("a", encoding="utf-8") as fh:
                    fh.write(f"{time.strftime('%H:%M:%S')} {tid}_{seed} "
                             f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}---\n")
                print(f"  !! {tid}_{seed} FAILED ({exc})", flush=True)
                time.sleep(5)
    print(f"\nсгенерировано {made}, ошибок {failed} из {total}, "
          f"{(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
