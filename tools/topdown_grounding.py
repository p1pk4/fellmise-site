"""Seat large top-down objects on the ground: restore the base, keep a thin
painted contact layer, measure the real contact line.

    python tools/topdown_grounding.py            # write proto/sprites_grounded/
    python tools/topdown_grounding.py --check    # fail if the committed output is stale

Why. tools/strip_pedestal.py cut the painted ground slab from under the
sprites. For buildings the colour rule also ate the lower foundation (a comb
of stubs remained) and removed every painted pixel of contact, so the wall
ended in a straight hard cut ~4-5 % of the height ABOVE the canvas bottom —
while the shadow was placed at the canvas bottom. Seen from above that is a
card hovering over its own shadow.

What this does, per sprite listed in assets/topdown/grounding.json, from the
ORIGINAL art (assets/<t>.webp) and the stripped one (the object mask):

  1. object = the stripped sprite's opaque pixels, opened by a small kernel
     so the comb stubs do not count as object;
  2. every pixel of the object gets its ORIGINAL alpha back — the foundation
     returns whole;
  3. pedestal pixels (in the original, not in the object) keep their alpha
     for `keep` of the sprite height around the object and fade to zero over
     the next `fade`: a thin painted contact skirt, not a slab;
  4. the contact line is measured: the lowest object row (as a fraction of
     height) and the object's width in the rows just above it.

Output: proto/sprites_grounded/<t>.webp + index.json, which /proto/ reads to
choose the texture and to place the contact shadow. Canvas size never
changes, so positions, footprints and the layout stay exactly as they were.
"""

import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
STRIPPED = ROOT / "proto" / "sprites_stripped"
OUT = ROOT / "proto" / "sprites_grounded"
CONFIG = ASSETS / "topdown" / "grounding.json"
ALPHA = 8
OPEN = 5                  # px kernel: stubs thinner than this are not "object"


def load_config():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    bad = []
    cats = cfg.get("categories", {})
    for t, s in cfg.get("sprites", {}).items():
        if s.get("category") not in cats:
            bad.append(f"{t}: категории '{s.get('category')}' нет в categories")
        if not (ASSETS / f"{t}.webp").exists():
            bad.append(f"{t}: нет assets/{t}.webp")
        if not (STRIPPED / f"{t}.webp").exists():
            bad.append(f"{t}: нет вырезанной версии proto/sprites_stripped/{t}.webp")
    for name, c in cats.items():
        if not (0 <= c.get("keep", -1) <= 0.1 and 0 < c.get("fade", -1) <= 0.2):
            bad.append(f"categories.{name}: keep 0..0.1, fade 0..0.2 (доли высоты)")
    if bad:
        raise SystemExit("grounding.json:\n  " + "\n  ".join(bad))
    return cfg


def distance(mask, limit):
    """Chebyshev distance (px) from `mask`, capped at limit+1, by repeated
    3x3 dilation — no scipy in the toolchain, and limit is a few dozen px."""
    d = np.full(mask.shape, limit + 1, dtype=np.int32)
    d[mask] = 0
    cur = Image.fromarray((mask * 255).astype(np.uint8))
    for k in range(1, limit + 1):
        cur = cur.filter(ImageFilter.MaxFilter(3))
        grown = np.asarray(cur) > 0
        d[grown & (d > k)] = k
    return d


def ground(t, cat):
    orig = np.asarray(Image.open(ASSETS / f"{t}.webp").convert("RGBA")).astype(np.float32)
    strip = np.asarray(Image.open(STRIPPED / f"{t}.webp").convert("RGBA"))
    H = orig.shape[0]
    obj = Image.fromarray(((strip[..., 3] > ALPHA) * 255).astype(np.uint8))
    obj = obj.filter(ImageFilter.MinFilter(OPEN)).filter(ImageFilter.MaxFilter(OPEN))
    obj = np.asarray(obj) > 0

    keep = cat["keep"] * H
    fade = cat["fade"] * H
    d = distance(obj, int(np.ceil(keep + fade)))
    f = np.clip(1.0 - (d - keep) / fade, 0.0, 1.0)
    f[obj] = 1.0
    out = orig.copy()
    out[..., 3] = orig[..., 3] * f

    # the contact line: the lowest row where the object is still a quarter as
    # wide as its widest lower row — a stray stub below it is not the base
    widths = obj.sum(axis=1)
    lower = widths[H // 2:]
    base = H // 2 + int(np.where(lower >= 0.25 * lower.max())[0].max())
    band = obj[max(base - int(0.03 * H), 0): base + 1]
    cols = np.where(band.any(axis=0))[0]
    meta = {
        "category": cat["name"],
        "contact_row": round((base + 1) / H, 4),        # fraction of height, from the top
        "contact_width": round((cols.max() - cols.min() + 1) / orig.shape[1], 4),
        "contact_centre": round((cols.max() + cols.min() + 1) / 2 / orig.shape[1] - 0.5, 4),
    }
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA"), meta


def build():
    cfg = load_config()
    index = {"generated": "tools/topdown_grounding.py по assets/topdown/grounding.json",
             "categories": {k: v["shadow"] for k, v in cfg["categories"].items()},
             "sprites": {}}
    images = {}
    for t, s in sorted(cfg["sprites"].items()):
        cat = dict(cfg["categories"][s["category"]], name=s["category"])
        img, meta = ground(t, cat)
        images[t] = img
        index["sprites"][t] = meta
    return images, index


def encode(img):
    import io
    buf = io.BytesIO()
    # lossy like strip_pedestal.py: lossless was 5-6x heavier; alpha stays lossless
    img.save(buf, "WEBP", quality=92, alpha_quality=100, method=6)
    return buf.getvalue()


def matches(have, want):
    """The committed WebP is lossy, so 'current' is: same size, alpha equal
    (it is stored losslessly), colour within compression noise where opaque.
    A changed keep/fade or a new base moves alpha and fails this at once."""
    a = np.asarray(have.convert("RGBA")).astype(np.int16)
    b = np.asarray(want).astype(np.int16)
    if a.shape != b.shape or np.abs(a[..., 3] - b[..., 3]).max() > 2:
        return False
    m = b[..., 3] > 128
    return bool(m.any()) and float(np.abs(a[..., :3] - b[..., :3])[m].mean()) < 3.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    images, index = build()
    text = json.dumps(index, ensure_ascii=False, indent=1) + "\n"
    if args.check:
        stale = []
        idx = OUT / "index.json"
        if not idx.exists() or idx.read_text(encoding="utf-8") != text:
            stale.append("index.json")
        for t, img in images.items():
            p = OUT / f"{t}.webp"
            if not p.exists() or not matches(Image.open(p), img):
                stale.append(f"{t}.webp")
        if stale:
            print("УСТАРЕЛО в proto/sprites_grounded/: " + ", ".join(stale)
                  + " — запустите python tools/topdown_grounding.py")
            sys.exit(1)
        print(f"актуально: proto/sprites_grounded/ ({len(images)} спрайтов)")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for t, img in images.items():
        (OUT / f"{t}.webp").write_bytes(encode(img))
    (OUT / "index.json").write_text(text, encoding="utf-8")
    for t, m in index["sprites"].items():
        print(f"  {t:<14} {m['category']:<9} контакт на {m['contact_row']*100:.1f}% высоты, "
              f"ширина {m['contact_width']*100:.0f}%")
    print(f"-> proto/sprites_grounded/ ({len(images)} + index.json)")
    print("\nобъекты сцены с этой посадкой (layout.runtime.json):")
    for t, ids in affected(index).items():
        print(f"  {t:<14} {len(ids):>2}: {', '.join(ids)}")


def affected(index):
    """sprite type -> runtime object ids that /proto/ draws with it."""
    runtime = json.loads((ASSETS / "topdown" / "layout.runtime.json").read_text(encoding="utf-8"))
    out = {t: [] for t in index["sprites"]}
    for b in runtime["biomes"].values():
        for o in b["sprites"]:
            if o.get("t") in out:
                out[o["t"]].append(o["id"])
    return out


if __name__ == "__main__":
    main()
