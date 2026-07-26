"""Turn the generated ground patches into tileable textures.

    python tools/make_ground_tiles.py

The object LoRA does not produce seamless tiles — asked for a "ground texture
patch" it produces an OBJECT: a square patch with a decorated border (hedges, a
stone rim). Tiling those directly would show a grid of identical frames. This is
the known open question in LORA_PLAN ("бесшовность краёв объектной LoRA в лоб не
решается").

So the border is discarded and only the middle is used: centre-crop, then build
a 2x2 mirrored block, which is seamless by construction (each edge meets its own
reflection). Mirroring introduces symmetry, which the site hides by laying the
tile under a multiply of the biome colour plus a scene vignette — the texture
carries grain, not pattern.

road_segment is different: seed 4004 came back as a clean straight road with
grass on both edges, so it is rotated flat and tiled along its length only.
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "out" / "site_assets" / "_raw"
ASSETS = ROOT / "assets"

# id -> (source frame, centre-crop share)
TILES = {
    "tile_grass": ("ground_grass/ground_grass_1001.png", 0.46),
    "tile_dirt": ("ground_dirt/ground_dirt_2002.png", 0.44),
    "tile_spirit": ("ground_spirit/ground_spirit_1001.png", 0.46),
}
ROAD = ("road_segment/road_segment_4004.png", 0.62)
OUT = 512          # final tile edge
QUALITY = 82


def mirror_tile(im, side):
    """2x2 block: original, mirrored right, mirrored down, mirrored both."""
    half = side // 2
    a = im.resize((half, half), Image.LANCZOS)
    b = a.transpose(Image.FLIP_LEFT_RIGHT)
    c = a.transpose(Image.FLIP_TOP_BOTTOM)
    d = c.transpose(Image.FLIP_LEFT_RIGHT)
    out = Image.new("RGB", (side, side))
    out.paste(a, (0, 0)); out.paste(b, (half, 0))
    out.paste(c, (0, half)); out.paste(d, (half, half))
    return out


def centre_crop(im, share):
    w, h = im.size
    cw, ch = int(w * share), int(h * share)
    x, y = (w - cw) // 2, (h - ch) // 2
    return im.crop((x, y, x + cw, y + ch))


def main():
    ASSETS.mkdir(exist_ok=True)
    for name, (src, share) in TILES.items():
        im = Image.open(RAW / src).convert("RGB")
        tile = mirror_tile(centre_crop(im, share), OUT)
        p = ASSETS / f"{name}.webp"
        tile.save(p, quality=QUALITY, method=6)
        print(f"{name:<14} {OUT}x{OUT}  {p.stat().st_size/1024:5.1f} KB  <- {src}")

    # road: keep it a strip, tile along X only
    im = Image.open(RAW / ROAD[0]).convert("RGB")
    im = im.rotate(90, expand=True)                 # generated vertical -> horizontal
    w, h = im.size
    band = im.crop((int(w * 0.18), 0, int(w * 0.82), h))   # drop the frame ends
    band = band.resize((768, round(band.height * 768 / band.width)), Image.LANCZOS)
    # mirror horizontally so the left and right edges match when repeated
    strip = Image.new("RGB", (band.width * 2, band.height))
    strip.paste(band, (0, 0))
    strip.paste(band.transpose(Image.FLIP_LEFT_RIGHT), (band.width, 0))
    p = ASSETS / "tile_road.webp"
    strip.save(p, quality=QUALITY, method=6)
    print(f"{'tile_road':<14} {strip.width}x{strip.height}  {p.stat().st_size/1024:5.1f} KB  <- {ROAD[0]}")


if __name__ == "__main__":
    main()
