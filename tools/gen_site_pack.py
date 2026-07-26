"""Generate the fellmise.com art pack on the v1 battle preset.

    python tools/gen_site_pack.py

26 tasks x 4 seeds = 104 frames -> out/site_assets/_raw/<id>/<id>_<seed>.png.

The preset is not re-declared here: the graph is loaded from
pixelart-pipeline/workflows/objects_battle_v1.json and only three inputs are
patched — the object phrase (node 6), the seed (node 3) and the SaveImage
prefix (node 12). Everything that defines the preset (flux1-dev-fp8,
fellmise_objects_v1 @0.7 with no blue2d, euler/simple, 20 steps, guidance 3.5,
cfg 1.0, 1024x1024) therefore comes from the accepted file, and drift between
this script and the accepted preset is impossible by construction.

The negative node stays wired through ConditioningZeroOut exactly as in the
workflow: at cfg 1.0 it contributes nothing, which is what "негативов нет"
means in this graph.

Re-runnable: frames already on disk are skipped, so an interrupted run resumes.
"""

import json
import pathlib
import sys
import time
import traceback

PIPELINE = pathlib.Path(r"D:\Dev\pixelart-pipeline")
sys.path.insert(0, str(PIPELINE))

import comfy_client as cc  # noqa: E402

from site_tasks import SEEDS, TASKS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
ERRLOG = ROOT / "out" / "site_assets" / "gen_errors.log"
WORKFLOW = PIPELINE / "workflows" / "objects_battle_v1.json"

PROMPT_TEMPLATE = "fllmse style, {obj}, game asset, top-down view, plain gray background"


def load_template():
    """The accepted battle graph, plus a sanity check on what it declares."""
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
    # No LoRA other than fellmise_objects_v1 may be in the graph (no blue2d).
    loaders = [n for n in wf.values() if n["class_type"] == "LoraLoader"]
    assert len(loaders) == 1, f"expected exactly one LoRA, got {len(loaders)}"
    return doc


def build(template, obj, seed):
    wf = json.loads(json.dumps(template["prompt"]))  # deep copy per frame
    wf["6"]["inputs"]["text"] = PROMPT_TEMPLATE.format(obj=obj)
    wf["3"]["inputs"]["seed"] = seed
    # Must vary per submit or a cached SaveImage never re-emits — see
    # comfy_client.unique_prefix.
    wf["12"]["inputs"]["filename_prefix"] = cc.unique_prefix("site")
    return wf


def main():
    template = load_template()
    RAW.mkdir(parents=True, exist_ok=True)
    total = len(TASKS) * len(SEEDS)
    made = skipped = failed = 0
    times, t0 = [], time.time()
    print(f"site pack: {total} кадров ({len(TASKS)} заданий x {len(SEEDS)} сидов), "
          f"пресет objects_battle_v1\n", flush=True)

    for tid, obj, _exotic in TASKS:
        prompt = PROMPT_TEMPLATE.format(obj=obj)
        outdir = RAW / tid
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "prompt.txt").write_text(prompt, encoding="utf-8")
        for seed in SEEDS:
            path = outdir / f"{tid}_{seed}.png"
            if path.exists():
                skipped += 1
                continue
            try:
                t1 = time.time()
                blobs = cc.fetch_images(cc.wait_for(cc.submit(build(template, obj, seed)),
                                                    timeout=600))
                if not blobs:
                    raise RuntimeError("no image returned")
                path.write_bytes(blobs[0])
                dt = time.time() - t1
                made += 1
                times.append(dt)
                done = made + skipped + failed
                eta = (sum(times) / len(times)) * (total - done) / 60
                print(f"  [{done}/{total}] {tid}_{seed}  {dt:5.1f}s  ETA {eta:4.1f} мин",
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
    if times:
        print(f"среднее {sum(times)/len(times):.1f}s/кадр, всего {(time.time()-t0)/60:.1f} мин")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
