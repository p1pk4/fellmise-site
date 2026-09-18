"""Top-down composition: how /proto/ lays the world out, and how it is checked.

The spec (assets/scene_spec.json) was written for the perspective corridor:
lanes at fixed distances from the road, beats respaced for perspective. Seen
from above that reads as two rows of props along a line. This module lays a
biome out from assets/topdown/composition.json instead — keyed clusters,
masses, fences as plot boundaries, scatter — and keeps from the spec only what
is not about presentation: sprite whitelist, heights, groups, boards.

Everything here is used by tools/generate_layout.py for the `topdown` target
only. The legacy target never imports it.

Geometry is the renderer's, not an approximation of it:
  * a sprite lies flat, centre at pos, spanning z ± h/2; its BOTTOM edge is at
    z + h/2 (screen-down is +z). Width = h * aspect of the texture proto
    actually loads (proto/sprites_stripped/ where it exists).
  * the ground contact — the footprint — is the bottom band of the sprite:
    depth clamp(0.25 h, 0.4, 2.5), width = the widest opaque row in the lower
    quarter of the art. Two footprints overlapping is a collision.
  * the road is proto's road: assets/road_spline.json through the same
    Catmull-Rom (three.js 'catmullrom', tension 0.5), 64 samples, linear in
    between; half-width = config road_half_width x spline width factor.
"""

import json
import math
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
COMPOSITION = ASSETS / "topdown" / "composition.json"
SPLINE = ASSETS / "road_spline.json"
STRIPPED_DIR = ROOT / "proto" / "sprites_stripped"

FENCE_TYPES = ("hero_fence", "end_post")
FENCE_THICKNESS = 0.7          # proto draws a run as a 0.7 m wide strip
SKY_TYPES = ("cloud_a", "cloud_b", "cloud_c", "moon")


class CompositionError(ValueError):
    pass


# -------------------------------------------------------------------- sprites
_stripped = None
_dims = {}


def stripped_set():
    global _stripped
    if _stripped is None:
        idx = STRIPPED_DIR / "index.json"
        _stripped = set(json.loads(idx.read_text(encoding="utf-8"))["stripped"]) if idx.exists() else set()
    return _stripped


def dims(t):
    """(aspect, foot) of the texture proto draws for `t`. `foot` is the widest
    opaque row in the lower quarter (75..95% of height) as a fraction of width
    — trunk and roots for a tree, the walls for a house."""
    if t not in _dims:
        p = STRIPPED_DIR / f"{t}.webp" if t in stripped_set() else ASSETS / f"{t}.webp"
        with Image.open(p) as im:
            a = im.convert("RGBA").getchannel("A")
            aspect = im.width / im.height
        W = min(a.width, 256)
        H = max(1, round(a.height * W / a.width))
        a = a.resize((W, H))
        px = a.load()
        best = 0
        for y in range(int(H * 0.75), int(H * 0.95)):
            xs = [x for x in range(W) if px[x, y] > 16]
            if xs:
                best = max(best, xs[-1] - xs[0] + 1)
        _dims[t] = (aspect, max(best / W, 0.15))
    return _dims[t]


# ----------------------------------------------------------------------- road
class Road:
    """proto/main.js roadAt(), in Python. z is WORLD z (biome i starts at
    -i * biome_spacing)."""

    NPTS = 64

    def __init__(self, half_width, spline=None, end_z=None):
        spline = spline or json.loads(SPLINE.read_text(encoding="utf-8"))
        # where the road stops (world z). Past it the half-width shrinks along a
        # quarter circle of radius = half-width at the end: a rounded cap, then
        # nothing. None = the old behaviour (clamped to the last sample).
        self.end_z = end_z
        pts = [(p["x"], p["w"], p["z"]) for p in spline["points"]]
        self.half = half_width
        n = len(pts)

        def point(t):
            p = (n - 1) * t
            i = math.floor(p)
            w = p - i
            if w == 0 and i == n - 1:
                i, w = n - 2, 1.0
            p0 = pts[i - 1] if i > 0 else tuple(2 * a - b for a, b in zip(pts[0], pts[1]))
            p1, p2 = pts[i], pts[i + 1]
            p3 = pts[i + 2] if i + 2 < n else tuple(2 * a - b for a, b in zip(pts[n - 1], pts[n - 2]))
            out = []
            for x0, x1, x2, x3 in zip(p0, p1, p2, p3):
                t0, t1 = 0.5 * (x2 - x0), 0.5 * (x3 - x1)
                c2 = -3 * x1 + 3 * x2 - 2 * t0 - t1
                c3 = 2 * x1 - 2 * x2 + t0 + t1
                out.append(x1 + t0 * w + c2 * w * w + c3 * w * w * w)
            return out

        self.z_step = abs(pts[-1][2]) / (self.NPTS - 1)
        samples = [point(i / (self.NPTS - 1)) for i in range(self.NPTS)]
        self.centre = [s[0] for s in samples]
        self.width = [s[1] for s in samples]

    def at(self, z):
        t = min(max(-z / self.z_step, 0.0), self.NPTS - 1.001)
        i = math.floor(t)
        f = t - i
        cx = self.centre[i] + (self.centre[i + 1] - self.centre[i]) * f
        hw = self.half * (self.width[i] + (self.width[i + 1] - self.width[i]) * f)
        if self.end_z is not None and z < self.end_z:
            past = self.end_z - z
            hw = hw * math.sqrt(1 - (past / hw) ** 2) if past < hw else 0.0
        return cx, hw

    def clear(self, x0, x1, z0, z1, margin):
        """True if the x-interval [x0, x1] stays out of the road core plus
        `margin` everywhere along world z in [z1, z0] (z1 < z0)."""
        z = z0
        while True:
            cx, hw = self.at(z)
            if hw <= 0:                     # past the end of the road
                if z <= z1:
                    return True
                z = max(z - 0.5, z1)
                continue
            k = hw + margin
            if x1 > cx - k and x0 < cx + k:
                return False
            if z <= z1:
                return True
            z = max(z - 0.5, z1)


# ------------------------------------------------------------------ geometry
def footprint(o):
    """(x0, x1, z0, z1) of the object's ground contact, LOCAL z (z0 < z1)."""
    x, _, z = o["pos"]
    if o.get("run"):
        r = o["run"]
        if r["axis"] == "z":
            return (x - FENCE_THICKNESS / 2, x + FENCE_THICKNESS / 2, z - r["step"] / 2, z + r["step"] / 2)
        return (x - r["step"] / 2, x + r["step"] / 2, z - FENCE_THICKNESS / 2, z + FENCE_THICKNESS / 2)
    if o.get("board"):
        w = o["h"] * 0.94
        return (x - w / 2, x + w / 2, z - 0.3, z + 0.3)
    aspect, foot = dims(o["t"])
    w = o["h"] * aspect * foot
    bottom = z + o["h"] / 2
    d = min(max(0.25 * o["h"], 0.4), 2.5)
    return (x - w / 2, x + w / 2, bottom - d, bottom)


def sprite_rect(o):
    """The whole drawn sprite, LOCAL z."""
    x, _, z = o["pos"]
    if o.get("run") or o.get("board"):
        return footprint(o)
    aspect, _ = dims(o["t"])
    w = o["h"] * aspect
    return (x - w / 2, x + w / 2, z - o["h"] / 2, z + o["h"] / 2)


def overlap(a, b):
    dx = min(a[1], b[1]) - max(a[0], b[0])
    dz = min(a[3], b[3]) - max(a[2], b[2])
    return dx * dz if dx > 0 and dz > 0 else 0.0


# ---------------------------------------------------------------- composition
def load_composition(path=COMPOSITION):
    return json.loads(path.read_text(encoding="utf-8"))


def check_composition(comp, spec):
    """Structural problems of composition.json, all at once."""
    bad = []
    if comp.get("version") != 1 or not isinstance(comp.get("biomes"), dict):
        return ["composition.json: ожидается {\"version\": 1, \"biomes\": {...}}"]
    for bid, b in comp["biomes"].items():
        if bid not in spec["biomes"]:
            bad.append(f"{bid}: такого биома нет в scene_spec.json")
            continue
        keys = set()
        for kind in ("clusters", "masses", "fences"):
            for c in b.get(kind, []):
                k = c.get("key")
                if not isinstance(k, str) or not k or "/" in k:
                    bad.append(f"{bid}/{kind}: нет ключа или в нём '/': {c}")
                elif k in keys:
                    bad.append(f"{bid}: ключ '{k}' повторяется")
                keys.add(k)
        for c in b.get("clusters", []):
            if ("group" in c) == ("items" in c):
                bad.append(f"{bid}/{c.get('key')}: у кластера ровно одно из group | items")
            if "group" in c and c["group"] not in spec["groups"]:
                bad.append(f"{bid}/{c.get('key')}: группы '{c['group']}' нет в spec")
            ikeys = set()
            for it in c.get("items", []):
                if "t" not in it:
                    bad.append(f"{bid}/{c.get('key')}: элемент без t: {it}")
                if "key" in it:
                    if it["key"] in ikeys:
                        bad.append(f"{bid}/{c.get('key')}: ключ элемента '{it['key']}' повторяется")
                    ikeys.add(it["key"])
        for f in b.get("fences", []):
            (x0, z0), (x1, z1) = f.get("from", (0, 0)), f.get("to", (0, 0))
            if (x0 != x1) == (z0 != z1):
                bad.append(f"{bid}/{f.get('key')}: забор идёт строго вдоль X или вдоль Z")
        for key in b.get("boards", {}):
            if key not in {bd["key"] for bd in spec["biomes"][bid]["boards"]}:
                bad.append(f"{bid}/boards: доски '{key}' нет в spec")
    return bad


def h01(seed, *parts):
    import hashlib
    key = f"{seed}|" + "|".join(str(p) for p in parts)
    d = hashlib.blake2b(key.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(d, "big") / 2 ** 64


class Composer:
    """Lays out one biome from composition.json through the Builder's place()
    (which enforces the whitelist, retired sprites and existing art)."""

    def __init__(self, bld, comp, road, spacing, margin):
        self.bld, self.comp, self.road = bld, comp, road
        self.spacing, self.margin = spacing, margin
        self.jit = comp.get("jitter", {"x": 0.0, "z": 0.0, "rot_deg": 0.0})

    def height(self, h, scale=1.0):
        return self.bld.height(h) * scale

    def world(self, bi, z):
        return -bi * self.spacing + z

    def road_clear(self, bi, fp):
        return self.road.clear(fp[0], fp[1], self.world(bi, fp[3]), self.world(bi, fp[2]), self.margin)

    def rot(self, sid, t):
        # buildings stand square to the view; natural things get a small tilt,
        # from their own id, so repetition does not read as a stamp
        if t.startswith(("hero_house", "barn", "feat_", "biome_orevein", "beam_frame")):
            return 0.0
        a = self.jit.get("rot_deg", 0.0)
        return round(math.radians((h01(self.bld.seed, sid, "rot") * 2 - 1) * a), 4)

    def put(self, bid, t, x, z, h, sid, extra=None, rot=None):
        o = self.bld.place(bid, t, x, z, h, side="C", layer=1, jit=False,
                           rot=self.rot(sid, t) if rot is None else rot, sid=sid,
                           extra=extra)
        return o

    def biome(self, bid, bi):
        spec_b = self.bld.spec["biomes"][bid]
        cb = self.comp["biomes"][bid]
        wl = spec_b["whitelist"]
        extra_wl = cb.get("whitelist_extra", {})
        spec_b["whitelist"] = list(wl) + [t for t in extra_wl if t not in wl]
        try:
            return self._biome(bid, bi, spec_b, cb)
        finally:
            spec_b["whitelist"] = wl

    def _biome(self, bid, bi, spec_b, cb):
        seed = self.bld.seed
        sprites = []

        # --- clusters: authored places, anchor jittered by its own key --------
        for c in cb.get("clusters", []):
            ck = f"{bid}/{c['key']}"
            ax = c["at"][0] + (h01(seed, ck, "x") * 2 - 1) * self.jit["x"]
            az = c["at"][1] + (h01(seed, ck, "z") * 2 - 1) * self.jit["z"]
            if "group" in c:
                mirror = -1 if c.get("mirror") else 1
                items = [{"t": c.get(m["t"], m["t"]), "h": m["h"], "dx": mirror * m["dx"], "dz": m["dz"]}
                         for m in self.bld.spec["groups"][c["group"]]["members"]]
            else:
                items = c["items"]
            counts = {}
            for it in items:
                t = it["t"]
                if "key" in it:
                    sid = f"{ck}/{it['key']}"
                else:
                    counts[t] = counts.get(t, 0) + 1
                    sid = f"{ck}/{t}.{counts[t]}"
                extra = {"_grp": ck}
                for flag in ("on_road", "road_terminal"):
                    if it.get(flag):
                        extra[flag] = True
                o = self.put(bid, t, ax + it.get("dx", 0), az + it.get("dz", 0),
                             self.height(it["h"], it.get("scale", 1.0)), sid, extra)
                if o:
                    sprites.append(o)

        # --- fences: boundaries of plots, one strip per run ------------------
        for f in cb.get("fences", []):
            fk = f"{bid}/{f['key']}"
            (x0, z0), (x1, z1) = f["from"], f["to"]
            axis = "z" if x0 == x1 else "x"
            length = abs(z1 - z0) if axis == "z" else abs(x1 - x0)
            n = max(1, round(length / 2.8))
            step = length / n
            h = self.height("fence")
            for k in range(n):
                u = (k + 0.5) / n
                x = x0 + (x1 - x0) * u
                z = z0 + (z1 - z0) * u
                o = self.put(bid, "hero_fence", x, z, h, f"{fk}/hero_fence.{k + 1}", rot=0.0,
                             extra={"run": {"key": fk, "axis": axis, "step": round(step, 3)}})
                if o:
                    sprites.append(o)

        # --- boards: spec text at top-down positions; obstacles for what follows
        boards = []
        moved = cb.get("boards", {})
        for bd in spec_b["boards"]:
            at = moved.get(bd["key"], {}).get("at")
            if at is None:
                x = self.bld.lane_x(bid, bd.get("lane", "verge"), bd["side"])
                at = [x, bd["z"]]
            boards.append({
                "id": f"{bid}/board/{bd['key']}", "key": bd["key"],
                "kind": "stone" if bid == "spirit" else "wood",
                "pos": [round(at[0], 3), None, round(at[1], 3)],
                "h": self.bld.height("board"), "rotY": 0.0, "visible": True,
            })
        boards_fp = [{**bd, "board": True} for bd in boards]
        # --- masses: many of one kind inside an area, Poisson by hash ---------
        for m in cb.get("masses", []):
            mk = f"{bid}/{m['key']}"
            (xa, xb), (za, zb) = m["area"]["x"], m["area"]["z"]
            s0, s1 = m.get("scale", [1.0, 1.0])
            made, tries = 0, 0
            while made < m["count"] and tries < m["count"] * 300:
                k, tries = tries, tries + 1
                x = xa + h01(seed, mk, "x", k) * (xb - xa)
                z = za + h01(seed, mk, "z", k) * (zb - za)
                t = m["types"][int(h01(seed, mk, "t", k) * len(m["types"]))]
                h = self.height(m["h"] if isinstance(m["h"], (int, float, str)) else m["h"][t],
                                s0 + h01(seed, mk, "s", k) * (s1 - s0))
                probe = {"t": t, "pos": [x, None, z], "h": h}
                fp = footprint(probe)
                if not m.get("on_road") and not self.road_clear(bi, fp):
                    continue
                if any(overlap(fp, footprint(o)) > 0 for o in sprites + boards_fp):
                    continue
                sp = m.get("spacing", 0)
                if sp and any(o.get("_grp") == mk and math.hypot(o["pos"][0] - x, o["pos"][2] - z) < sp
                              for o in sprites):
                    continue
                extra = {"_grp": mk}
                if m.get("on_road"):
                    extra["on_road"] = True
                o = self.put(bid, t, x, z, h, f"{mk}/c{k}", extra)
                if o:
                    sprites.append(o)
                    made += 1
            if made < m["count"]:
                self.bld.notes.append(f"{bid}: масса {m['key']} уместила {made} из {m['count']}")

        # --- scatter: small things, off the road, clear of everything ---------
        sc = cb.get("scatter")
        if sc:
            (xa, xb), (za, zb) = sc["x"], sc["z"]
            made, tries = 0, 0
            placed = []
            while made < sc["count"] and tries < sc["count"] * 300:
                k, tries = tries, tries + 1
                side = -1 if h01(seed, bid, "sc-side", k) < 0.5 else 1
                x = side * (xa + h01(seed, bid, "sc-x", k) * (xb - xa))
                z = za + h01(seed, bid, "sc-z", k) * (zb - za)
                t = sc["types"][int(h01(seed, bid, "sc-t", k) * len(sc["types"]))]
                h = self.height(self.bld.h_key(t))
                probe = {"t": t, "pos": [x, None, z], "h": h}
                fp = footprint(probe)
                if not self.road_clear(bi, fp):
                    continue
                if any(overlap(fp, footprint(o)) > 0 for o in sprites + boards_fp):
                    continue
                # dressing is not hidden under a crown or a roof
                if any(o["h"] >= 4.0 and overlap(sprite_rect(probe), sprite_rect(o)) > 0 for o in sprites):
                    continue
                if any(math.hypot(px - x, pz - z) < sc.get("spacing", 2.4) for px, pz in placed):
                    continue
                o = self.put(bid, t, x, z, h, f"{bid}/scatter/c{k}", {"_grp": f"{bid}/scatter"})
                if o:
                    sprites.append(o)
                    placed.append((x, z))
                    made += 1
            if made < sc["count"]:
                self.bld.notes.append(f"{bid}: scatter уместил {made} из {sc['count']}")

        return {"sprites": sprites, "boards": boards}


# ------------------------------------------------------------------ validator
def validate(layout, spec, road, spacing, margin, road_props):
    """Hard failures of a top-down layout: road intrusions, collisions,
    undeclared hanging objects. Returns a list of lines."""
    bad = []
    for bi, (bid, b) in enumerate(layout["biomes"].items()):
        objs = [o for o in b["sprites"] if o.get("visible", True)]
        objs += [{**bd, "board": True, "t": "board"} for bd in b.get("boards", [])]
        fps = [(o, footprint(o)) for o in objs]
        for o, fp in fps:
            if o["t"] in road_props or o.get("on_road"):
                continue
            if not road.clear(fp[0], fp[1], -bi * spacing + fp[3], -bi * spacing + fp[2], margin):
                cx, hw = road.at(-bi * spacing + fp[3])
                bad.append(f"{bid}/{o['id']}: на дороге — след x {fp[0]:.2f}..{fp[1]:.2f}, "
                           f"дорога {cx - hw:.2f}..{cx + hw:.2f} + {margin}")
            if o["pos"][1] is not None and not o.get("hanging"):
                bad.append(f"{bid}/{o['id']}: висит (y={o['pos'][1]}), не объявлен hanging")
        for i in range(len(fps)):
            a, fa = fps[i]
            for j in range(i + 1, len(fps)):
                c, fc = fps[j]
                # fence meets fence: the same run, or two runs joined at a corner
                if a.get("run") and c.get("run"):
                    continue
                ov = overlap(fa, fc)
                if ov > 0.05:
                    bad.append(f"{bid}: {a['id']} и {c['id']} стоят друг на друге "
                               f"(пересечение следов {ov:.2f} м²)")
    return bad


def check_terminal(layout, spacing, end_z, tol=1.0):
    """The road ends at the object the composition marks `road_terminal`: its
    bottom edge (world z) is the configured road end, within `tol` metres."""
    marked = [(bi, o) for bi, b in enumerate(layout["biomes"].values())
              for o in b["sprites"] if o.get("road_terminal")]
    if len(marked) != 1:
        return [f"road_terminal: должен быть ровно один объект, а их {len(marked)}"]
    bi, o = marked[0]
    bottom = -bi * spacing + o["pos"][2] + o["h"] / 2
    if abs(bottom - end_z) > tol:
        return [f"road_terminal {o['id']}: низ на z {bottom:.2f}, а дорога кончается на "
                f"{end_z} (config.json road_end_z) — разошлись больше чем на {tol} м"]
    return []


# ---------------------------------------------------------------- diagnostics
BANDS = [(0, 8), (8, 16), (16, 24), (24, 32), (32, 50), (50, 999)]


def diagnostics(layout, road, spacing, max_gap):
    """Numbers to look at, not a verdict. Per biome: counts, lateral extent and
    occupancy by |x| band, longitudinal gaps, objects hidden entirely behind a
    bigger one, objects declared on the road."""
    out = {}
    for bi, (bid, b) in enumerate(layout["biomes"].items()):
        objs = [o for o in b["sprites"] if o.get("visible", True)]
        solid = [o for o in objs if not o.get("run")]
        xs = sorted(o["pos"][0] for o in solid)
        ax = sorted(abs(x) for x in xs)
        band = {}
        for lo, hi in BANDS:
            left = sum(1 for x in xs if -hi < x <= -lo)
            right = sum(1 for x in xs if lo <= x < hi)
            band[f"{lo}-{hi if hi < 999 else '∞'}"] = [left, right]
        zs = sorted({round(o["pos"][2]) for o in solid if o["h"] >= 2.0}, reverse=True)
        gaps = [(a, c) for a, c in zip(zs, zs[1:]) if a - c > max_gap]
        hidden = []
        for o in solid:
            r = sprite_rect(o)
            for p in solid:
                if p is o or p["h"] <= o["h"]:
                    continue
                R = sprite_rect(p)
                if (R[0] <= r[0] and r[1] <= R[1] and R[2] <= r[2] and r[3] <= R[3]
                        and R[3] > r[3]):
                    hidden.append(o["id"])
                    break
        out[bid] = {
            "objects": len(objs), "fence_segments": len(objs) - len(solid),
            "boards": len(b.get("boards", [])),
            "x_min": round(xs[0], 1) if xs else None, "x_max": round(xs[-1], 1) if xs else None,
            "median_abs_x": round(ax[len(ax) // 2], 1) if ax else None,
            "bands_LR": band, "gaps_over": gaps, "hidden_behind_bigger": hidden,
            "declared_on_road": [o["id"] for o in objs if o.get("on_road")],
        }
    return out


def diagnostics_text(d):
    L = []
    for bid, v in d.items():
        L.append(f"  {bid:<8} объектов {v['objects']:>3} (забор {v['fence_segments']}), "
                 f"досок {v['boards']}, x {v['x_min']}..{v['x_max']}, медиана |x| {v['median_abs_x']}")
        L.append("           полосы |x| Л/П: " + "  ".join(f"{k}:{l}/{r}" for k, (l, r) in v["bands_LR"].items()))
        if v["gaps_over"]:
            L.append(f"           пустые перегоны: {v['gaps_over']}")
        if v["hidden_behind_bigger"]:
            L.append(f"           целиком за крупным: {', '.join(v['hidden_behind_bigger'])}")
        if v["declared_on_road"]:
            L.append(f"           на дороге по замыслу: {', '.join(v['declared_on_road'])}")
    return "\n".join(L)
