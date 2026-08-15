"""Second pass: the six the first template could not turn.

    python tools/gen_frontal.py

Twenty of the twenty-six came back face-on under the first template. Six did
not, on any seed: two houses, a stack of crates and three boulders. Every one of
them is a WIDE object, and the LoRA insists on drawing wide objects sitting on a
ground plate seen from above — the training data wins over "not isometric".

So the wording changes tactics instead of repeating itself. Rather than telling
the model what NOT to do, it names the thing wanted: a flat elevation, straight
on, standing on nothing. "orthographic front elevation" and "no ground base" are
the two phrases doing the work.
"""

import json
import pathlib
import sys
import time
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pipeline  # noqa: E402  — находит пайплайн, где бы он ни лежал
import comfy_client as cc  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
ERRLOG = ROOT / "out" / "site_assets" / "gen_errors.log"
WORKFLOW = pipeline.workflow("objects_battle_v2.json")

LORA = "fellmise_sprite_v2.safetensors"
WEIGHT = 0.7
SEEDS = [1001, 2002, 3003, 4004]
TEMPLATE = ("fllmse style, {obj}, game asset, orthographic front elevation, "
            "straight-on eye level view, flat facade facing viewer, "
            "no ground base, plain gray background")

# id -> what to ask for. The wording is the object only; the viewpoint comes
# from the template, identical for every one of them.
TASKS = [
    ("hero_house_a", "small village house with a tiled roof and a front door"),
    ("hero_house_b", "village cottage, front wall with a door and two windows"),
    ("prop_crates", "wooden crate"),
    ("rock_s", "small mossy boulder"),
    ("rock_m", "medium mossy boulder"),
    ("rock_l", "large mossy boulder"),
]


def load_template():
    doc = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    wf = doc["prompt"]
    lora, ks = wf["10"]["inputs"], wf["3"]["inputs"]
    assert lora["lora_name"] == LORA, lora["lora_name"]
    assert lora["strength_model"] == WEIGHT and lora["strength_clip"] == WEIGHT
    assert wf["4"]["inputs"]["ckpt_name"] == "flux1-dev-fp8.safetensors"
    assert ks["steps"] == 20 and ks["cfg"] == 1.0
    assert ks["sampler_name"] == "euler" and ks["scheduler"] == "simple"
    assert wf["8"]["inputs"]["guidance"] == 3.5
    assert wf["5"]["inputs"]["width"] == wf["5"]["inputs"]["height"] == 1024
    assert len([n for n in wf.values() if n["class_type"] == "LoraLoader"]) == 1
    return doc


def build(t, obj, seed):
    wf = json.loads(json.dumps(t["prompt"]))
    wf["6"]["inputs"]["text"] = TEMPLATE.format(obj=obj)
    wf["3"]["inputs"]["seed"] = seed
    wf["12"]["inputs"]["filename_prefix"] = cc.unique_prefix("front2")
    return wf


def main():
    tpl = load_template()
    total = len(TASKS) * len(SEEDS)
    print(f"второй заход по ракурсу: {len(TASKS)} позиций x {len(SEEDS)} сидов "
          f"= {total} кадров")
    print(f"LoRA {LORA} @ {WEIGHT}, единый шаблон ракурса\n", flush=True)
    t0 = time.time()
    made = skipped = failed = 0

    for tid, obj in TASKS:
        outdir = RAW / f"{tid}_front2"
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "prompt.txt").write_text(TEMPLATE.format(obj=obj), encoding="utf-8")
        print(f"{tid}: {obj}", flush=True)
        for seed in SEEDS:
            path = outdir / f"{tid}_{seed}.png"
            if path.exists():
                skipped += 1
                continue
            try:
                t1 = time.time()
                blobs = cc.fetch_images(
                    cc.wait_for(cc.submit(build(tpl, obj, seed)), timeout=900))
                if not blobs:
                    raise RuntimeError("no image returned")
                path.write_bytes(blobs[0])
                made += 1
                done = made + skipped + failed
                eta = (time.time() - t0) / max(made, 1) * (total - done) / 60
                print(f"  [{done}/{total}] {path.name}  {time.time()-t1:5.1f}s  "
                      f"ETA {eta:5.1f} мин", flush=True)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                ERRLOG.parent.mkdir(parents=True, exist_ok=True)
                with ERRLOG.open("a", encoding="utf-8") as fh:
                    fh.write(f"{time.strftime('%H:%M:%S')} {tid}_{seed} "
                             f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}---\n")
                print(f"  !! {tid}_{seed} FAILED ({exc})", flush=True)
                time.sleep(5)

    print(f"\nсгенерировано {made}, пропущено {skipped}, ошибок {failed} из {total}")
    print(f"всего {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
