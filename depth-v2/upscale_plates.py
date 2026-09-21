"""Super-resolution рантайм-плит Depth Journey: без перерисовки композиции.

    <python с torch> depth-v2/upscale_plates.py --batch depth-v2/hires_plates.json --models DIR
    <python с torch> depth-v2/upscale_plates.py --model PATH --src A.webp --out B.png [--width 3840]

Мастера сцен сгенерированы в 1536x960, а маршрут показывает их на 1920 px
(cover, x1.25) и затем приближает камерой ещё до x2.2-2.4: на максимуме один
пиксель источника растягивается почти на три экранных. Поэтому плитам нужно
больше реальных пикселей, а не другая картинка.

Здесь — обычный SR x4 (Real-ESRGAN через spandrel) по тайлам с перекрытием,
затем Lanczos до целевой ширины. Никакого img2img и диффузии: сеть только
восстанавливает детали существующего изображения, композиция, цвета и кадр
остаются теми же. Альфа (у вырезок переднего плана) не проходит через сеть —
она масштабируется Lanczos отдельно, чтобы край вырезки не «поплыл».

Пакетный режим читает цели из hires_plates.json (ширина каждой плиты выбрана по
замеру плотности пикселей) и пишет WebP в out/depth-v2/hi/ — рабочий вывод. В
assets/depth/ его байт в байт переносит publish_runtime_assets.py.
"""
import argparse
import json
import pathlib
import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

TILE, PAD = 384, 32


def sr(model, rgb, scale):
    """Тайловый проход: тайлы с перекрытием PAD, в выход идёт только центр."""
    h, w, _ = rgb.shape
    out = np.zeros((h * scale, w * scale, 3), np.float32)
    x = torch.from_numpy(rgb).permute(2, 0, 1)[None].float().cuda() / 255
    for y0 in range(0, h, TILE):
        for x0 in range(0, w, TILE):
            ya, yb = max(0, y0 - PAD), min(h, y0 + TILE + PAD)
            xa, xb = max(0, x0 - PAD), min(w, x0 + TILE + PAD)
            with torch.no_grad():
                t = model(x[:, :, ya:yb, xa:xb]).clamp(0, 1)[0].permute(1, 2, 0).float().cpu().numpy()
            cy, cx = (y0 - ya) * scale, (x0 - xa) * scale
            th, tw = (min(h, y0 + TILE) - y0) * scale, (min(w, x0 + TILE) - x0) * scale
            out[y0 * scale:y0 * scale + th, x0 * scale:x0 * scale + tw] = t[cy:cy + th, cx:cx + tw]
    return (out * 255 + 0.5).clip(0, 255).astype(np.uint8)


def upscale(model, src, width):
    im = Image.open(src)
    alpha = im.getchannel("A") if im.mode == "RGBA" else None
    up = Image.fromarray(sr(model, np.asarray(im.convert("RGB")), model.scale))
    w = width or up.width
    h = round(w * im.height / im.width)
    if up.size != (w, h):
        up = up.resize((w, h), Image.LANCZOS)
    if alpha is not None:
        up = up.convert("RGBA")
        up.putalpha(alpha.resize((w, h), Image.LANCZOS))
    return im.size, up


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch")
    ap.add_argument("--models", help="папка с весами для --batch")
    ap.add_argument("--model")
    ap.add_argument("--src")
    ap.add_argument("--out")
    ap.add_argument("--width", type=int, default=0, help="итоговая ширина; 0 — оставить x4")
    a = ap.parse_args()

    if a.batch:
        spec = json.loads(pathlib.Path(a.batch).read_text(encoding="utf-8"))
        root = pathlib.Path(a.batch).resolve().parent.parent
        model = ModelLoader().load_from_file(str(pathlib.Path(a.models) / spec["model"])).cuda().eval()
        out_dir = root / spec["out_dir"]
        out_dir.mkdir(parents=True, exist_ok=True)
        for it in spec["items"]:
            size, up = upscale(model, root / it["src"], it["width"])
            dst = out_dir / f"{it['name']}.webp"
            up.save(dst, "WEBP", quality=spec["quality"], method=6)
            print(f"{it['name']:18s} {size} -> {up.size}  {dst.stat().st_size / 1024:6.0f} KB")
        return

    model = ModelLoader().load_from_file(a.model).cuda().eval()
    size, up = upscale(model, a.src, a.width)
    up.save(a.out)
    print(f"{a.src} -> {a.out}  {size} -> {up.size}  model x{model.scale}")

if __name__ == "__main__":
    main()
