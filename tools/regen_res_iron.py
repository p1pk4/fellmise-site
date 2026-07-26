"""Re-prompt res_iron on the same battle preset with a colour anchor.

    python tools/regen_res_iron.py

v1 asked for "iron ore chunk" and every seed returned a plain grey stone block
— iron never read. res_gold succeeded with the same shape of prompt because it
carried a colour anchor ("with yellow veins"), so this run adds the equivalent
one for iron. Preset, seeds and filter are unchanged: only the object phrase
moves, which is what makes this a clean A/B against v1.

Frames -> out/site_assets/_raw/res_iron_v2/.
"""

import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gen_site_pack as G  # noqa: E402

PIPELINE = pathlib.Path(r"D:\Dev\pixelart-pipeline")
sys.path.insert(0, str(PIPELINE))
import comfy_client as cc  # noqa: E402

from site_tasks import SEEDS  # noqa: E402

OBJ = "iron ore chunk with rusty orange-brown metallic veins"
OUT = pathlib.Path(__file__).resolve().parent.parent / "out" / "site_assets" / "_raw" / "res_iron_v2"


def main():
    template = G.load_template()          # re-asserts the whole battle preset
    OUT.mkdir(parents=True, exist_ok=True)
    prompt = G.PROMPT_TEMPLATE.format(obj=OBJ)
    (OUT / "prompt.txt").write_text(prompt, encoding="utf-8")
    print(f"res_iron v2: {prompt}\n", flush=True)

    for seed in SEEDS:
        path = OUT / f"res_iron_v2_{seed}.png"
        if path.exists():
            print(f"  skip {path.name}", flush=True)
            continue
        t0 = time.time()
        blobs = cc.fetch_images(cc.wait_for(cc.submit(G.build(template, OBJ, seed)), timeout=600))
        if not blobs:
            raise RuntimeError(f"no image for seed {seed}")
        path.write_bytes(blobs[0])
        print(f"  {path.name}  {time.time()-t0:5.1f}s", flush=True)

    print("\nготово")


if __name__ == "__main__":
    main()
