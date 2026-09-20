"""Чистая плита деревни: фон под вырезками достраивается генеративным inpaint.

    python depth-v2/inpaint_hero_plate.py

Прошлая плита строилась горизонтальной протяжкой пикселей. На кадрах, где
передний план уже ушёл, это читалось как размазанные полосы — слева под дубом,
сверху под кроной, вдоль заборов. Протяжка снята полностью.

Здесь каждая область достраивается отдельным проходом Flux по своей маске:

  1. маска вырезки расширяется на 30 px — модели нужен контекст вокруг дыры;
  2. область достраивается по описанию того, что там ДОЛЖНО быть
     (дальние холмы и дымка, деревня, трава, край дороги);
  3. результат вклеивается обратно по УЗКОЙ маске (вырезка + 6 px, растушёвка
     4 px), поэтому вне настоящей дыры остаются исходные пиксели мастера.

Цель — правдоподобный фон, а не реконструкция скрытого. Он виден короткий
момент, пока передний план идёт мимо камеры: простая трава и продолжение
ландшафта здесь лучше выдуманной архитектуры.

Мастер только читается.
"""

import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

sys.path.insert(0, r"D:\Dev\ART_Fellmise\_system\scripts")
import comfy_client as cc  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "out" / "scene_batch1" / "final"
H2F = ROOT / "out" / "depth-v2" / "h2f"
REF = ROOT / "out" / "scene_batch1" / "ref"        # input-директория ComfyUI
W, HH = 1536, 960

STYLE = ("hand-painted 2D game environment illustration, flat painterly colour "
         "fills, soft dark warm-brown contour lines, matte surfaces, economical "
         "brushwork, warm late-afternoon light, same style and lighting as the "
         "surrounding painting. ")

AREAS = {
    "oak": STYLE + (
        "A continuous stretch of countryside on the left side of a village at "
        "golden hour: rolling green wooded hills stepping back into warm golden "
        "haze under a pale warm sky, the last few village roofs and hedges at the "
        "far edge, then mown grass, a low hedgerow and the packed earth verge of a "
        "path in the near ground. Everything continues evenly and naturally with "
        "no object standing in front of it."),
    "fence_l": STYLE + (
        "Open ground at the edge of a village: mown green grass with tufts, the "
        "packed ochre earth edge of a path, a few small stones and low bushes, "
        "warm evening light raking across it, continuing evenly."),
    "fence_r": STYLE + (
        "Open ground beside village houses: mown green grass with tufts, the "
        "packed ochre earth verge of a path, low bushes and a couple of small "
        "stones, warm evening light, continuing evenly."),
}


def mask_from(alpha, grow, feather):
    m = ndimage.binary_dilation(alpha > 0.35, np.ones((3, 3)), iterations=max(1, grow // 2))
    img = Image.fromarray((m * 255).astype(np.uint8))
    if feather:
        img = img.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(img, dtype=np.float32) / 255.0


def inpaint(plate_rgb, mask_wide, prompt, seed):
    """Один проход Flux по широкой маске. Вне неё пиксели не трогаются."""
    Image.fromarray(plate_rgb.clip(0, 255).astype(np.uint8)).save(REF / "h2f_src.png")
    m8 = (mask_wide * 255).clip(0, 255).astype(np.uint8)
    Image.merge("RGB", [Image.fromarray(m8)] * 3).save(REF / "h2f_mask.png")
    wf = {
        "4":  {"class_type": "CheckpointLoaderSimple",
               "inputs": {"ckpt_name": "flux1-dev-fp8.safetensors"}},
        "20": {"class_type": "LoadImage", "inputs": {"image": "h2f_src.png", "upload": "image"}},
        "25": {"class_type": "LoadImageMask",
               "inputs": {"image": "h2f_mask.png", "channel": "red", "upload": "image"}},
        "21": {"class_type": "VAEEncode", "inputs": {"pixels": ["20", 0], "vae": ["4", 2]}},
        "26": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["21", 0], "mask": ["25", 0]}},
        "6":  {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7":  {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 1]}},
        "8":  {"class_type": "FluxGuidance", "inputs": {"guidance": 3.5, "conditioning": ["6", 0]}},
        "9":  {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["7", 0]}},
        "3":  {"class_type": "KSampler",
               "inputs": {"seed": seed, "steps": 20, "cfg": 1.0, "sampler_name": "euler",
                          "scheduler": "simple", "denoise": 1.0, "model": ["4", 0],
                          "positive": ["8", 0], "negative": ["9", 0], "latent_image": ["26", 0]}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "12": {"class_type": "SaveImage",
               "inputs": {"filename_prefix": cc.unique_prefix("h2fplate"), "images": ["11", 0]}},
    }
    raw = cc.fetch_images(cc.wait_for(cc.submit(wf), timeout=900))[0]
    tmp = H2F / "_inpaint_raw.png"
    tmp.write_bytes(raw)
    out = np.asarray(Image.open(tmp).convert("RGB"), dtype=np.float32)
    tmp.unlink()
    return out


def main():
    hero = np.asarray(Image.open(MASTERS / "hero_start.png").convert("RGB"), dtype=np.float32)
    index = json.loads((H2F / "index.json").read_text(encoding="utf-8"))
    plate = hero.copy()
    narrow_all = np.zeros((HH, W), np.float32)

    for i, c in enumerate(index["cutouts"]):
        alpha = np.asarray(Image.open(H2F / c["file"]).split()[-1], dtype=np.float32) / 255.0
        wide = mask_from(alpha, grow=30, feather=8)      # контекст для модели
        narrow = mask_from(alpha, grow=6, feather=4)     # что реально заменяем
        narrow_all = np.maximum(narrow_all, narrow)
        got = inpaint(plate, wide, AREAS[c["id"]], seed=707070 + i * 1111)
        n3 = narrow[..., None]
        plate = got * n3 + plate * (1 - n3)
        print(f"{c['id']:10} достроено, заменено {float((narrow > .5).mean()) * 100:5.2f}% кадра")

    Image.fromarray(plate.clip(0, 255).astype(np.uint8)).save(
        H2F / "hero_plate_clean.webp", quality=95, method=5)

    # проверка: вернуть вырезки на место — должно совпасть с мастером
    comp = Image.fromarray(plate.clip(0, 255).astype(np.uint8))
    for c in index["cutouts"]:
        fg = Image.open(H2F / c["file"])
        comp.paste(fg, (0, 0), fg)
    comp.save(H2F / "hero_plate_clean_review.png")
    d = np.abs(np.asarray(comp, dtype=np.int16) - hero.astype(np.int16)).max(axis=2)
    print(f"композит против мастера: средняя разница {d.mean():.2f}, "
          f"выше 12 у {float((d > 12).mean()) * 100:.2f}% пикселей")

    index["plate"] = "hero_plate_clean.webp"
    (H2F / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"-> {H2F / 'hero_plate_clean.webp'}")


if __name__ == "__main__":
    main()
