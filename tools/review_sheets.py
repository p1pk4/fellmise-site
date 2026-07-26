"""Visual acceptance sheets — every sprite on cream AND on dark.

    python tools/review_sheets.py

Two backgrounds because the defects differ: a pale fringe only shows on dark,
and a dark fringe or a muddy silhouette only shows on cream. Each tile is the
sprite at 256px with its id underneath, so verdicts can come back per id.

Acceptance is not just "the cut is clean". The question is whether an artist
would have drawn it this way — see the anti-cliche rules in tools/README.md.
"""

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
GRADED = ROOT / "out" / "site_assets" / "final_web"
OUT = ROOT / "out" / "site_assets"

TILE = 256
PAD = 14
COLS = 6
LABEL = 22
BACKS = [("cream", (0xFD, 0xF6, 0xE0), (40, 40, 36)),
         ("dark", (0x1E, 0x3D, 0x3D), (245, 240, 225))]


def build(name, bg, fg, sprites):
    cell = TILE + PAD * 2
    rows = (len(sprites) + COLS - 1) // COLS
    im = Image.new("RGB", (COLS * cell, rows * (cell + LABEL)), bg)
    d = ImageDraw.Draw(im)
    for i, p in enumerate(sprites):
        s = Image.open(p).convert("RGBA")
        s.thumbnail((TILE, TILE), Image.LANCZOS)
        x = (i % COLS) * cell + PAD + (TILE - s.width) // 2
        y = (i // COLS) * (cell + LABEL) + PAD + (TILE - s.height) // 2
        im.paste(s, (x, y), s)
        d.text(((i % COLS) * cell + PAD, (i // COLS) * (cell + LABEL) + cell - 4),
               p.stem, fill=fg)
    out = OUT / f"review_sheet_{name}.png"
    im.save(out)
    print(f"{out.name:<26} {im.width}x{im.height}  {len(sprites)} спрайтов  "
          f"{out.stat().st_size/1024:.0f} KB")


def main():
    # door/open derivatives are build artefacts, not art to judge
    sprites = sorted(p for p in GRADED.glob("*.png")
                     if not p.stem.endswith(("_door", "_open")))
    for name, bg, fg in BACKS:
        build(name, bg, fg, sprites)


if __name__ == "__main__":
    main()
