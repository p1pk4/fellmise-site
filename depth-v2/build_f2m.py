"""Слои перехода forest -> mine по архитектуре V6.

    python depth-v2/build_f2m.py

Та же схема, что доказана на hero -> forest:
  * forest_plate — ЦЕЛЬНАЯ сцена, внутри ничего не разъезжается;
  * вырезки — только реальные близкие объекты по своему силуэту;
  * фон под ними достраивается генеративным inpaint (не протяжкой пикселей);
  * mine_plate — тоже цельная сцена;
  * passage_matte — обводка настоящего прохода между стволами по тропе.

Отличие от hero: здесь силуэты обводятся полигонами вручную, без порога по
цвету. Замер по картине показал, что стволы переднего плана почти не
отличаются от фоновых по яркости и оттенку (RGB 31/21/15 против 25/48/37):
порог тут даёт рвань, а не силуэт.

Мастера только читаются.
"""

import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

sys.path.insert(0, r"D:\Dev\ART_Fellmise\_system\scripts")
import comfy_client as cc  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTERS = ROOT / "out" / "scene_batch1" / "final"
OUT = ROOT / "out" / "depth-v2" / "f2m"
REF = ROOT / "out" / "scene_batch1" / "ref"          # input-директория ComfyUI
W, H = 1536, 960

STYLE = ("hand-painted 2D game environment illustration, flat painterly colour "
         "fills, soft dark warm-brown contour lines, matte surfaces, economical "
         "brushwork, same style and lighting as the surrounding painting. ")

CUTOUTS = [
    dict(id="trunk_l", origin=[0.22, 0.40], k=3.10, mirror=(662, 1012),
         note="крупный ствол слева с корневым наплывом",
         poly=[(225, 0), (515, 0), (520, 420), (560, 500), (632, 566), (650, 636),
               (560, 660), (486, 624), (430, 660), (360, 706), (282, 712),
               (232, 640), (218, 420), (214, 180)],
         fill=STYLE + ("Far forest distance seen deep between trees: dim blue-green atmospheric haze, faint slender silhouettes of small distant trunks far away, thin and pale, everything low in contrast, soft and quiet, receding depth only, the same cool shade as the surrounding distance. Below, mossy ground "
                       "with needle litter fading into the same distance.")),
    dict(id="trunk_r", origin=[0.78, 0.40], k=3.10, mirror=(958, 1012),
         note="крупный ствол справа с корневым наплывом",
         poly=[(1046, 0), (1246, 0), (1300, 180), (1336, 420), (1364, 520),
               (1400, 600), (1392, 672), (1300, 690), (1220, 660), (1140, 690),
               (1060, 672), (996, 620), (968, 560), (1014, 500), (1028, 300)],
         fill=STYLE + ("Far forest distance seen deep between trees: dim blue-green atmospheric haze, faint slender silhouettes of small distant trunks far away, thin and pale, everything low in contrast, soft and quiet, receding depth only, the same cool shade as the surrounding distance. Below, mossy ground "
                       "with needle litter fading into the same distance.")),
    dict(id="rock_l", origin=[0.08, 0.66], k=2.70,
         note="валун у левого края",
         poly=[(0, 486), (86, 470), (170, 496), (232, 556), (250, 640),
               (226, 720), (150, 790), (60, 812), (0, 800)],
         fill=STYLE + ("Mossy forest floor at the foot of dark trunks: moss, "
                       "needle litter, low ferns and grass tufts, deep shadow "
                       "toward the edge of the frame, continuing evenly.")),
    dict(id="stump_r", origin=[0.86, 0.80], k=2.70,
         note="пень и камни справа у тропы",
         poly=[(1186, 700), (1250, 660), (1322, 668), (1360, 700), (1420, 684),
               (1500, 712), (1536, 760), (1536, 900), (1300, 900), (1200, 840),
               (1176, 764)],
         fill=STYLE + ("Mossy forest floor beside a warm ochre path: moss, grass "
                       "tufts, needle litter and a few small stones, warm light "
                       "raking from the path, continuing evenly.")),
]

# Проход: коридор тропы между стволами, к светлой дали. Точки неровные —
# граница не должна читаться фигурой.
PASSAGE = [
    (742, 428), (788, 418), (842, 430), (872, 492), (906, 560), (946, 640),
    (1012, 748), (1076, 860), (1132, 1010),
    (404, 1010), (474, 862), (548, 748), (616, 646), (668, 556), (706, 492),
]
PASSAGE_ANCHOR = (790, 462)

# Маска для маршрута forward-travel (f2m2). Тот же коридор дороги, но с
# расширением вверх: при малом масштабе это узкая щель у точки схода, при
# большом она покрывает кадр целиком. Без расширения на финале сверху
# оставался тёмный клин — маска просто не доставала до верхнего края.
ROAD = [
    (560, 0), (1040, 0), (1080, 300), (874, 500), (906, 560), (946, 640),
    (1012, 748), (1076, 860), (1132, 1010),
    (404, 1010), (474, 862), (548, 748), (616, 646), (668, 556), (706, 492),
    (520, 300),
]


def poly_mask(points, grow=0, feather=0.0):
    img = Image.new("L", (W, H), 0)
    ImageDraw.Draw(img).polygon(points, fill=255)
    m = np.asarray(img) > 127
    if grow:
        m = ndimage.binary_dilation(m, np.ones((3, 3)), iterations=max(1, grow // 2))
    out = Image.fromarray((m * 255).astype(np.uint8))
    if feather:
        out = out.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(out, dtype=np.float32) / 255.0


def mirror_fill(src, hole, axis_x, limit):
    """Заполнить дыру НАСТОЯЩЕЙ дальней частью этого же мастера.

    Генерация на такой площади (15% кадра, колонна во всю высоту) оказалась
    ненадёжной: на месте убранного ствола она рисовала новый крупный ствол —
    статичный в плите и потому «разъезжающийся» с движущейся вырезкой, — а на
    втором заходе выдала плоскую чёрную плиту.

    Здесь пиксели берутся зеркально от края дыры, из коридора дальнего леса
    того же кадра. Контент гарантированно на нужной глубине и в нужном
    контрасте: ничего нового не выдумывается. `limit` складывает выборку
    обратно, чтобы она не заехала на соседний передний ствол."""
    out = src.copy()
    xs = np.arange(W)
    mx = 2 * axis_x - xs
    over = mx > limit
    mx[over] = 2 * limit - mx[over]
    mx = np.clip(mx, 0, W - 1)
    sampled = src[:, mx, :]
    h3 = hole[..., None]
    return sampled * h3 + out * (1 - h3)


def inpaint(plate, mask_wide, prompt, seed, denoise=1.0):
    Image.fromarray(plate.clip(0, 255).astype(np.uint8)).save(REF / "f2m_src.png")
    m8 = (mask_wide * 255).clip(0, 255).astype(np.uint8)
    Image.merge("RGB", [Image.fromarray(m8)] * 3).save(REF / "f2m_mask.png")
    wf = {
        "4":  {"class_type": "CheckpointLoaderSimple",
               "inputs": {"ckpt_name": "flux1-dev-fp8.safetensors"}},
        "20": {"class_type": "LoadImage", "inputs": {"image": "f2m_src.png", "upload": "image"}},
        "25": {"class_type": "LoadImageMask",
               "inputs": {"image": "f2m_mask.png", "channel": "red", "upload": "image"}},
        "21": {"class_type": "VAEEncode", "inputs": {"pixels": ["20", 0], "vae": ["4", 2]}},
        "26": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["21", 0], "mask": ["25", 0]}},
        "6":  {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7":  {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 1]}},
        "8":  {"class_type": "FluxGuidance", "inputs": {"guidance": 3.5, "conditioning": ["6", 0]}},
        "9":  {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["7", 0]}},
        "3":  {"class_type": "KSampler",
               "inputs": {"seed": seed, "steps": 20, "cfg": 1.0, "sampler_name": "euler",
                          "scheduler": "simple", "denoise": denoise, "model": ["4", 0],
                          "positive": ["8", 0], "negative": ["9", 0], "latent_image": ["26", 0]}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "12": {"class_type": "SaveImage",
               "inputs": {"filename_prefix": cc.unique_prefix("f2m"), "images": ["11", 0]}},
    }
    raw = cc.fetch_images(cc.wait_for(cc.submit(wf), timeout=900))[0]
    tmp = OUT / "_raw.png"
    tmp.write_bytes(raw)
    got = np.asarray(Image.open(tmp).convert("RGB"), dtype=np.float32)
    tmp.unlink()
    return got


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    forest = np.asarray(Image.open(MASTERS / "forest_transition.png").convert("RGB"), dtype=np.float32)
    plate = forest.copy()
    index = {"plate": "forest_plate_clean.webp", "next": "mine_plate.webp", "cutouts": [],
             "passage": {"matte": "passage_matte.png", "road": "road_matte.png",
                         "anchor": [PASSAGE_ANCHOR[0] / W, PASSAGE_ANCHOR[1] / H]}}

    for i, c in enumerate(CUTOUTS):
        alpha = poly_mask(c["poly"], grow=4, feather=2.0)     # сам объект
        wide = poly_mask(c["poly"], grow=34, feather=8.0)     # контекст для модели
        narrow = poly_mask(c["poly"], grow=10, feather=4.0)   # что реально заменяем

        rgba = np.dstack([forest.astype(np.uint8), (alpha * 255).round().astype(np.uint8)])
        name = f"forest_fg_{c['id']}.webp"
        Image.fromarray(rgba, "RGBA").save(OUT / name, quality=94, method=5)

        if c.get("mirror"):
            # два крупных ствола: дыра заполняется дальним лесом этого же кадра,
            # затем лёгкий проход модели сшивает шов, ничего не досочиняя
            plate = mirror_fill(plate, narrow, c["mirror"][0], c["mirror"][1])
            got = inpaint(plate, wide, c["fill"], seed=515151 + i * 1717, denoise=0.42)
        else:
            got = inpaint(plate, wide, c["fill"], seed=515151 + i * 1717)
        n3 = narrow[..., None]
        plate = got * n3 + plate * (1 - n3)

        index["cutouts"].append({"id": c["id"], "file": name, "note": c["note"],
                                 "origin": c["origin"], "k": c["k"],
                                 "coverage": round(float((alpha > .5).mean()) * 100, 2)})
        print(f"{c['id']:9} вырезан и достроен, {index['cutouts'][-1]['coverage']:5.2f}% кадра")

    Image.fromarray(plate.clip(0, 255).astype(np.uint8)).save(
        OUT / "forest_plate_clean.webp", quality=95, method=5)
    Image.open(MASTERS / "mine_approach.png").convert("RGB").save(
        OUT / "mine_plate.webp", quality=95, method=5)

    for poly, blur, name in ((PASSAGE, 5, "passage_matte.png"), (ROAD, 6, "road_matte.png")):
        matte = Image.new("L", (W, H), 0)
        ImageDraw.Draw(matte).polygon(poly, fill=255)
        matte = matte.filter(ImageFilter.GaussianBlur(blur))
        Image.merge("RGBA", (matte, matte, matte, matte)).save(OUT / name)

    comp = Image.fromarray(plate.clip(0, 255).astype(np.uint8))
    for c in index["cutouts"]:
        fg = Image.open(OUT / c["file"])
        comp.paste(fg, (0, 0), fg)
    comp.save(OUT / "forest_plate_clean_review.png")
    d = np.abs(np.asarray(comp, dtype=np.int16) - forest.astype(np.int16)).max(axis=2)
    print(f"композит против мастера: средняя разница {d.mean():.2f}, "
          f"выше 12 у {float((d > 12).mean()) * 100:.2f}% пикселей")

    (OUT / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
