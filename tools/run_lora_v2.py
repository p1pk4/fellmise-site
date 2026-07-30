"""Acceptance run for fellmise_sprite_v2 against fellmise_objects_v1.

    python tools/run_lora_v2.py

Nothing in the pipeline is switched, written to, or reconfigured. Its workflow
and its ComfyUI client are READ; every frame this produces lands in the site's
own out/lora_v2/. The verdict on moving the battle preset to v2 is the owner's.

Method, from the pipeline's own acceptance: the same tasks, the same seeds, and
the same sampler for both models — only which LoRA is attached, and at what
weight, changes. Anything else and the comparison measures the settings instead
of the dataset.

Two groups of tasks:

  * The v1 acceptance set, verbatim from the pipeline's run_acceptance_v2 — five
    entities v1 failed outright (barrel, mailbox, chest_open, bulletin_board,
    rowboat) and five it handled (tree_normal, ore_vein_base, campfire, sack,
    moongate). The first half asks whether v2 fixes the disease, the second
    whether it trades one defect for another. All ten are taken rather than an
    arbitrary eight: dropping two would only make the comparison weaker.

  * Four types that failed in THIS repo's batch 7, at the exact prompts they
    failed on — a stalagmite that came out as a cave mouth every seed, a hanging
    branch that came out as a whole tree every seed, a haystack that came out as
    a stump, and crystals that arrived with a pale halo baked into the art.
    Rewording them would test the prompt, not the model.

v1 runs at the battle weight only. v2 runs at 0.6 / 0.7 / 0.8, because the
weight is the one dial the owner would actually turn.

The pipeline already holds v1@0.7 and v2@0.7 at seeds 2002/3003/4004; those are
copied in rather than regenerated, and only the missing frames are made.
"""

import json
import pathlib
import shutil
import sys
import time
import traceback

PIPELINE = pathlib.Path(r"D:\Dev\ART_Fellmise")
sys.path.insert(0, str(PIPELINE / "scripts"))
import comfy_client as cc  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out" / "lora_v2"
ERRLOG = OUT / "errors.log"
WORKFLOW = PIPELINE / "workflows" / "objects_battle_v1_archived.json"
BORROW = PIPELINE / "archive" / "v1_era" / "output" / "acceptance_v2"

LORA_V1 = "fellmise_objects_v1.safetensors"
LORA_V2 = "fellmise_sprite_v2.safetensors"
SEEDS = [1001, 2002, 3003, 4004]
TEMPLATE = "fllmse style, {}, game asset, top-down view, plain gray background"

# (id, prompt, group)
TASKS = [
    ("barrel", "wooden barrel", "провальная"),
    ("mailbox", "wooden mailbox on a post", "провальная"),
    ("chest_open", "wooden chest with open lid", "провальная"),
    ("bulletin_board", "wooden bulletin board with blank notes", "провальная"),
    ("rowboat", "small wooden rowboat", "провальная"),
    ("tree_normal", "green leafy tree with round crown", "эталонная"),
    ("ore_vein_base", "ore vein in gray rock, neutral gray metallic streaks", "эталонная"),
    ("campfire", "campfire with stone ring", "эталонная"),
    ("sack", "burlap sack tied with rope", "эталонная"),
    ("moongate", "stone archway portal with soft blue glow", "эталонная"),
    # the four this repo's batch 7 could not get out of v1
    ("stalagmite", "tall cave stalagmite", "проблемная"),
    ("branch_hanging", "hanging tree branch with leaves", "проблемная"),
    ("haystack", "round haystack", "проблемная"),
    ("crystals", "cluster of tall glowing purple crystals", "проблемная"),
]

# tag -> (lora, weight); the borrowed set covers the first two at three seeds
RUNS = [
    ("v1_w07", LORA_V1, 0.7),
    ("v2_w06", LORA_V2, 0.6),
    ("v2_w07", LORA_V2, 0.7),
    ("v2_w08", LORA_V2, 0.8),
]


def load_template():
    doc = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    wf = doc["prompt"]
    ks = wf["3"]["inputs"]
    # everything except the LoRA must be the battle preset, and stay it
    assert wf["4"]["inputs"]["ckpt_name"] == "flux1-dev-fp8.safetensors"
    assert ks["steps"] == 20 and ks["cfg"] == 1.0
    assert ks["sampler_name"] == "euler" and ks["scheduler"] == "simple"
    assert wf["8"]["inputs"]["guidance"] == 3.5
    assert wf["5"]["inputs"]["width"] == wf["5"]["inputs"]["height"] == 1024
    assert len([n for n in wf.values() if n["class_type"] == "LoraLoader"]) == 1
    return doc


def build(template, obj, seed, lora, weight):
    wf = json.loads(json.dumps(template["prompt"]))
    wf["6"]["inputs"]["text"] = TEMPLATE.format(obj)
    wf["3"]["inputs"]["seed"] = seed
    wf["10"]["inputs"]["lora_name"] = lora
    wf["10"]["inputs"]["strength_model"] = weight
    wf["10"]["inputs"]["strength_clip"] = weight
    wf["12"]["inputs"]["filename_prefix"] = cc.unique_prefix("lorav2")
    return wf


def borrow():
    """Frames the pipeline already made, copied in instead of regenerated."""
    n = 0
    for tag in ("v1_w07", "v2_w07"):
        src = BORROW / tag
        if not src.is_dir():
            continue
        dst = OUT / tag
        dst.mkdir(parents=True, exist_ok=True)
        for tid, _p, _g in TASKS:
            for seed in SEEDS:
                f = src / f"{tid}_{seed}.png"
                if f.exists() and not (dst / f.name).exists():
                    shutil.copy2(f, dst / f.name)
                    n += 1
    print(f"взято готовым из пайплайна: {n} кадров (пайплайн не изменён)\n", flush=True)


def main():
    template = load_template()
    OUT.mkdir(parents=True, exist_ok=True)
    borrow()

    todo = []
    for tag, lora, weight in RUNS:
        (OUT / tag).mkdir(parents=True, exist_ok=True)
        for tid, prompt, _g in TASKS:
            for seed in SEEDS:
                if not (OUT / tag / f"{tid}_{seed}.png").exists():
                    todo.append((tag, lora, weight, tid, prompt, seed))

    print(f"заданий {len(TASKS)} × сидов {len(SEEDS)} × прогонов {len(RUNS)} "
          f"= {len(TASKS)*len(SEEDS)*len(RUNS)} кадров, из них генерить {len(todo)}")
    print(f"v1 только на боевом весе 0.7; v2 сеткой 0.6 / 0.7 / 0.8\n", flush=True)

    t0 = time.time()
    made = failed = 0
    last_tag = None
    for tag, lora, weight, tid, prompt, seed in todo:
        if tag != last_tag:
            print(f"--- {tag}: {lora} @ {weight}", flush=True)
            last_tag = tag
        path = OUT / tag / f"{tid}_{seed}.png"
        try:
            t1 = time.time()
            blobs = cc.fetch_images(
                cc.wait_for(cc.submit(build(template, prompt, seed, lora, weight)),
                            timeout=900))
            if not blobs:
                raise RuntimeError("no image returned")
            path.write_bytes(blobs[0])
            made += 1
            eta = (time.time() - t0) / made * (len(todo) - made) / 60
            print(f"  [{made+failed}/{len(todo)}] {tag}/{path.name}  "
                  f"{time.time()-t1:5.1f}s  ETA {eta:5.1f} мин", flush=True)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            with ERRLOG.open("a", encoding="utf-8") as fh:
                fh.write(f"{time.strftime('%H:%M:%S')} {tag}/{tid}_{seed} "
                         f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}---\n")
            print(f"  !! {tag}/{tid}_{seed} FAILED ({type(exc).__name__}: {exc})", flush=True)
            time.sleep(5)

    print(f"\nсгенерировано {made}, ошибок {failed} из {len(todo)}")
    print(f"всего {(time.time()-t0)/60:.1f} мин")


if __name__ == "__main__":
    main()
