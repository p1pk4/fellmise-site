"""World ghost ship: spectral restyle of assets/feat_death_alt.webp (not committed).

Deterministic image processing of the existing runtime sprite - no new ship:
same canvas (560x694), same silhouette and position; colour mapped to the
key art D palette (navy -> slate blue -> pale ice), sails lifted, a thin soft
cyan edge, a low mist band along the hull, the hull bottom slightly dissolved,
the whole a touch translucent. Calmer than the key art.

    python tools/make_ghost_ship.py  ->  proto/sprites_special/feat_death_alt_ghost.png (+ .webp q92)

Only /proto/ uses it (proto/sprite_overrides.json, object spirit/shipwreck/ship);
assets/feat_death_alt.webp stays the legacy source for /next/ and /full/.
"""
import pathlib

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "feat_death_alt.webp"
DST = ROOT / "proto" / "sprites_special" / "feat_death_alt_ghost"

im = Image.open(SRC).convert("RGBA")
a = np.asarray(im).astype(np.float32) / 255.0
rgb, al = a[..., :3], a[..., 3]
H, W = al.shape

# luminance -> key-art-D ramp (navy, slate, ice)
lum = rgb @ np.array([0.30, 0.55, 0.15], np.float32)
lum = np.clip((lum - 0.08) / 0.82, 0, 1) ** 0.85
stops = np.array([[0.00, 22, 30, 58], [0.35, 58, 78, 128], [0.65, 118, 148, 204], [1.00, 214, 228, 248]], np.float32)
ramp = np.stack([np.interp(lum, stops[:, 0], stops[:, i]) for i in (1, 2, 3)], -1) / 255.0
# keep a little of the original texture (value variation), none of its warm hue
grey = np.repeat(lum[..., None], 3, -1)
col = 0.86 * ramp + 0.14 * grey
# sails (bright, low saturation in the source) lifted a bit more
mx, mn = rgb.max(-1), rgb.min(-1)
sail = np.clip((lum - 0.55) / 0.3, 0, 1) * np.clip(1 - (mx - mn) / 0.35, 0, 1)
col = col + sail[..., None] * (np.array([0.93, 0.96, 1.0]) - col) * 0.35

# hull bottom dissolves a little (noise-broken fade over the lowest 16% of the opaque rows)
ys = np.nonzero(al.max(1) > 0.06)[0]
y0, y1 = ys.min(), ys.max()
rows = np.arange(H, dtype=np.float32)[:, None]
fade_start = y1 - 0.16 * (y1 - y0)
t = np.clip((rows - fade_start) / (y1 - fade_start), 0, 1)
rng = np.random.default_rng(7)
noise = np.asarray(Image.fromarray((rng.random((H // 8 + 1, W // 8 + 1)) * 255).astype(np.uint8))
                   .resize((W, H), Image.BICUBIC)).astype(np.float32) / 255.0
dissolve = 1 - 0.55 * t * (0.6 + 0.4 * noise)
al2 = al * dissolve * 0.92

# thin soft cyan edge (outside the silhouette only)
m = Image.fromarray((al * 255).astype(np.uint8))
halo = np.asarray(m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(4))).astype(np.float32) / 255.0
halo = np.clip(halo - al, 0, 1) * 0.42

# low mist along the hull: the hull mask smeared sideways and down, faint
hull = (al > 0.5) & (rows > y0 + 0.62 * (y1 - y0))
mist = Image.fromarray((hull * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14))
mist = np.asarray(mist.resize((int(W * 1.0), H)).transform((W, H), Image.AFFINE, (1, 0, 0, 0, 1, -10))).astype(np.float32) / 255.0
mist = np.clip(mist * 0.55 * (0.7 + 0.3 * noise), 0, 0.45)
mist = np.clip(mist - al2, 0, 1)

# composite: ship over (mist + halo) glow layer
glow_a = np.clip(halo + mist, 0, 0.55)
glow_rgb = (halo[..., None] * np.array([0.62, 0.84, 1.0]) + mist[..., None] * np.array([0.78, 0.84, 0.86])) / np.maximum(halo + mist, 1e-6)[..., None]
out_a = al2 + glow_a * (1 - al2)
out_rgb = (col * al2[..., None] + glow_rgb * glow_a[..., None] * (1 - al2[..., None])) / np.maximum(out_a, 1e-6)[..., None]
out = np.dstack([np.clip(out_rgb, 0, 1), np.clip(out_a, 0, 1)])
img = Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")
img.save(DST.with_suffix(".png"))
img.save(DST.with_suffix(".webp"), "WEBP", quality=92, method=6)
b = (np.asarray(img)[..., 3] > 16)
yy, xx = np.nonzero(b)
print("canvas", img.size, "alpha>16 bbox", xx.min(), yy.min(), xx.max(), yy.max())
