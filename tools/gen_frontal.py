"""Regenerate the pack front-on, per the audit.

    python tools/gen_frontal.py

The audit found 31 of 73 sprites drawn three-quarter top-down while the scene
stands them up as vertical billboards, so their roofs and base plates point at
the sky. This regenerates the 25 that stand at ground level, plus `beam_frame`,
under ONE viewpoint template — the whole point is that they come back from the
same angle, so they sit in one scene together:

    fllmse style, <объект>, game asset, front view, slightly elevated camera
    angle, not isometric, plain gray background

`prop_stones` is not here: the audit retired it, and it is skipped by
generate_layout.py rather than redrawn.

`beam_frame` gets a rewritten object, not just a new angle. The old prompt
returned a solid timber panel every seed, which is why the camera could not fly
under it; the new one asks for the passage explicitly.

Ids are kept, so the layout and every scene reference stay valid.
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
TEMPLATE = ("fllmse style, {obj}, game asset, front view, "
            "slightly elevated camera angle, not isometric, plain gray background")

# id -> what to ask for. The wording is the object only; the viewpoint comes
# from the template, identical for every one of them.
TASKS = [
    ("hero_house_a", "small village house with a tiled roof"),
    ("hero_house_b", "village cottage with a wooden door"),
    ("barn", "wooden barn with a hay loft"),
    ("feat_tavern", "village tavern with lit windows"),
    ("hero_well", "stone village well with a wooden roof"),
    ("hero_cart", "wooden market cart loaded with goods"),
    ("haystack", "round hay bale"),
    ("prop_crates", "stack of wooden crates"),
    ("chest", "closed wooden treasure chest"),
    ("feat_craft", "blacksmith anvil on a wooden block"),
    ("feat_death", "small stone crypt with a wooden door"),
    ("feat_death_alt", "wooden sailing ship of the dead"),
    ("feat_vendetta", "dark stone totem with horns"),
    ("feat_mining", "dark rocky pit with glowing blue ore veins inside"),
    ("biome_brazier", "iron fire brazier with burning coals"),
    ("biome_crystals", "cluster of tall glowing purple crystals, matte dark rock base"),
    ("biome_stump", "old tree stump with an axe stuck in it"),
    ("grave_c", "old gravestone covered with ivy"),
    ("minecart", "wooden mine cart full of ore"),
    ("ore_pile", "pile of raw ore chunks"),
    ("rock_s", "small mossy boulder"),
    ("rock_m", "medium mossy boulder"),
    ("rock_l", "large mossy boulder"),
    ("stalagmite_a", "tall pointed cave rock spire"),
    ("stalagmite_b", "short pointed cave rock spire"),
    # not a new angle but a new object: the old one was a solid panel, and the
    # camera is supposed to fly under this
    ("beam_frame", "wooden mine support arch with open passage under it"),
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
    wf["12"]["inputs"]["filename_prefix"] = cc.unique_prefix("front")
    return wf


def main():
    tpl = load_template()
    total = len(TASKS) * len(SEEDS)
    print(f"фронтальная перегенерация: {len(TASKS)} позиций x {len(SEEDS)} сидов "
          f"= {total} кадров")
    print(f"LoRA {LORA} @ {WEIGHT}, единый шаблон ракурса\n", flush=True)
    t0 = time.time()
    made = skipped = failed = 0

    for tid, obj in TASKS:
        outdir = RAW / f"{tid}_front"
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
