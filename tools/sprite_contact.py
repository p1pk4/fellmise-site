"""Where each /proto/ sprite actually touches the ground.

    python tools/sprite_contact.py            # write proto/sprite_contact.json
    python tools/sprite_contact.py --check    # fail if the committed file is stale

/proto/ lays frontal sprites flat under a straight-down orthographic camera,
so a sprite's image rows ARE world depth: its contact with the ground is the
image row where the object's base is. That row is not the canvas bottom —
stripped sprites end 0.4-1.2 m above it, and every sprite has some empty or
thin rows below the base — and a shadow anchored to the canvas bottom sits
under the object with a gap: the object floats (grounding diagnostic 2).

Measured on the texture /proto/ really loads (proto/sprites_stripped/<t>.webp
if listed in its index, else assets/<t>.webp). The contact row is the lowest
row of the object's own base, found by one of two rules — each fails exactly
where the other one works, so the choice is made by what the sprite is:

  stripped   the lowest row where the stripped sprite still keeps at least
             half of the original row's opaque pixels. Below it the pedestal
             was cut, and what remains there — drips, stubs, a smear of grass
             under a well — is residue, not the base.
  unstripped the lowest row holding a CONTIGUOUS opaque run of at least 3 % of
             the width, stable for 1 % of the height above it. A trunk or a
             lamp post is narrow but solid and counts; a blade of grass or a
             stray pixel does not. (A "quarter of the widest row" rule — the
             first try — put pine contact at the lowest branches, 18 % of the
             height above the trunk base.)

Repaired sprites (index.json "repaired": the base was restored after the
strip, see there) have a whole base again, so they are measured by the run
rule: comparing with the original row would count its baked ground.

Width and centre come from the opaque extent of the rows from 3 % of the
height above the contact row down to it: the base itself.

All numbers are fractions of the texture (row from the top, width of the
width, centre as offset from the middle), so they hold at any in-scene size.
Runtime reads them; nothing is scanned per frame.
"""

import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
STRIPPED = ROOT / "proto" / "sprites_stripped"
OUT = ROOT / "proto" / "sprite_contact.json"
ALPHA = 16            # same opacity threshold as the diagnostic
KEEP = 0.5            # stripped: share of the original row still opaque
RUN = 0.03            # unstripped: contiguous run, share of the width
STABLE = 0.01         # ...holding for this share of the height above
BAND = 0.03           # rows above the contact row that define the base's width


def source(t, stripped):
    return (STRIPPED if t in stripped else ASSETS) / f"{t}.webp"


def longest_runs(a):
    """Per row: length of the longest contiguous opaque run."""
    out = np.zeros(a.shape[0], dtype=np.int32)
    for y, row in enumerate(a):
        if row.any():
            edges = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
            out[y] = int((np.where(edges == -1)[0] - np.where(edges == 1)[0]).max())
    return out


def measure(t, stripped, repaired=()):
    path = source(t, stripped)
    a = np.asarray(Image.open(path).convert("RGBA"))[..., 3] > ALPHA
    H, W = a.shape
    L = longest_runs(a)
    lower = range(H // 2, H)
    if t in stripped and t not in repaired:
        o = np.asarray(Image.open(ASSETS / f"{t}.webp").convert("RGBA"))[..., 3] > ALPHA
        keep = [(a[y] & o[y]).sum() / o[y].sum() if o[y].any() else 0.0 for y in range(H)]
        rows = [y for y in lower if keep[y] >= KEEP and L[y] >= RUN * W]
        rule = "stripped"
    else:
        k = max(2, int(STABLE * H))
        rows = [y for y in lower if L[y] >= RUN * W and all(L[y - j] >= RUN * W for j in range(1, k + 1))]
        rule = "run"
    if not rows:                      # never happened on the pack; kept honest
        rows = [int(np.where(a.any(axis=1))[0].max())]
        rule += "-fallback"
    row = max(rows)
    band = a[max(row - int(BAND * H), 0): row + 1]
    cols = np.where(band.any(axis=0))[0]
    return {
        "src": path.relative_to(ROOT).as_posix(),
        "rule": rule,
        "contact_row": round((row + 1) / H, 4),
        "contact_width": round((cols.max() - cols.min() + 1) / W, 4),
        "contact_centre": round((cols.max() + cols.min() + 1) / 2 / W - 0.5, 4),
    }


def build():
    index = json.loads((STRIPPED / "index.json").read_text(encoding="utf-8"))
    stripped = set(index["stripped"])
    repaired = set(index.get("repaired", {}))
    names = sorted(p.stem for p in ASSETS.glob("*.webp") if not p.stem.endswith(("_em", "_bleed")))
    sprites = {t: measure(t, stripped, repaired) for t in names}
    return {
        "generated": "tools/sprite_contact.py по текстурам, которые грузит /proto/",
        "rule": (f"stripped: нижняя строка, где вырезанный спрайт сохранил >= {KEEP} "
                 f"непрозрачных пикселей исходной строки; run: нижняя строка со сплошным "
                 f"отрезком >= {RUN} ширины, устойчивым {STABLE} высоты; ширина и центр — "
                 f"по полосе {BAND} высоты над строкой контакта; отремонтированные "
                 f"(index.json repaired) — по run"),
        "sprites": sprites,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = json.dumps(build(), ensure_ascii=False, indent=1) + "\n"
    if args.check:
        have = OUT.read_text(encoding="utf-8") if OUT.exists() else None
        if have != text:
            print("УСТАРЕЛ: proto/sprite_contact.json — запустите python tools/sprite_contact.py")
            sys.exit(1)
        print("актуален: proto/sprite_contact.json")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"-> proto/sprite_contact.json ({len(json.loads(text)['sprites'])} спрайтов)")


if __name__ == "__main__":
    main()
