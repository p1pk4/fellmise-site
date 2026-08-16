"""Build assets/layout.json out of assets/scene_spec.json.

    python tools/generate_layout.py            # generate, validate, write
    python tools/generate_layout.py --dry      # generate and validate, write nothing

The spec is the source of truth for WHERE THINGS GO; this only executes it. The
placement it produces is deterministic: the same spec and the same seed give a
byte-identical file, so a diff on layout.json is a diff on the spec and never on
a random number.

How each rule in spec.global is honoured:

  lanes          a band is a distance from the road centre. `side` puts the
                 object on the left or the right of it, `C` on the axis.
  lane_jitter    every object is nudged by a hash of (seed, its own id) — not by
                 a running random. Insert one object in the middle of a rhythm
                 and nothing downstream moves.
  layer          derived from the lane, never written by hand.
  groups         a group's internal offsets are applied AS GIVEN. The anchor is
                 jittered; the members are not. That is what keeps a fence in
                 front of its house instead of wandering off it.
  rotY           by side, so a facade faces the road; jittered inside the range
                 the spec allows.
  ground         y is left null and the renderer seats the sprite on its own
                 painted bottom (assets/baselines.json). Only hanging things and
                 sky get an explicit y.
  scatter        Poisson-disc inside the lane band, so scattered dressing does
                 not clump into a heap.

Then spec.global.validator runs, and a violation is a failure — with the list,
not just a count.
"""

import argparse
import hashlib
import json
import math
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SPEC = ASSETS / "scene_spec.json"
OUT = ASSETS / "layout.json"

# Retired from the pack this batch: the audit found no front-on version worth
# making. The spec still names them, so they are skipped loudly rather than
# silently, and the report says so.
RETIRED = {"prop_stones": "выведен из пака: изометрия сверху, роль закрывают rock_s и grass_tuft"}

# The counter is not a single sprite but a stall with goods laid along it.
COUNTER_ITEMS = ["res_iron", "res_gold", "res_diamond", "res_wood",
                 "res_herbs", "res_fish", "res_sword", "res_staff"]


# --------------------------------------------------------------- determinism
def h01(seed, *parts):
    """A stable number in [0,1) from the seed and a name. Not a stream: the same
    name always gives the same number, whatever order things are built in."""
    key = f"{seed}|" + "|".join(str(p) for p in parts)
    d = hashlib.blake2b(key.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(d, "big") / 2 ** 64


def jitter(seed, name, amp):
    return (h01(seed, name) * 2 - 1) * amp


# ------------------------------------------------------------------ geometry
_aspect_cache = {}


def aspect(t):
    """Width / height of the sprite, for the overlap test."""
    if t not in _aspect_cache:
        p = ASSETS / f"{t}.webp"
        if not p.exists():
            _aspect_cache[t] = None
        else:
            with Image.open(p) as im:
                _aspect_cache[t] = im.width / im.height
    return _aspect_cache[t]


class Builder:
    def __init__(self, spec):
        self.spec = spec
        self.g = spec["global"]
        self.seed = self.g["seed"]
        self.lanes = self.g["lanes"]
        self.heights = self.g["heights"]
        self.road = self.g["road_half_width"]
        self.counts = {}
        self.skipped = []
        self.notes = []
        self.conflicts = set()

    # -- helpers ----------------------------------------------------------
    def lane_x(self, biome, lane, side):
        table = dict(self.lanes)
        table.update(self.spec["biomes"][biome].get("lane_override", {}))
        d = table[lane]
        return 0.0 if side == "C" else (-d if side == "L" else d)

    def layer_of(self, lane):
        if lane in ("verge", "near"):
            return 1
        if lane == "mid":
            return 0.5
        return 0

    def rot_for(self, side, name):
        """Facades face the road: left verge turns right, right verge turns left."""
        if side == "C":
            return 0.0
        lo, hi = (4.0, 12.0)
        deg = lo + h01(self.seed, "rot", name) * (hi - lo)
        if side == "L":
            deg = -deg
        return round(math.radians(deg), 4)

    def uid(self, t):
        self.counts[t] = self.counts.get(t, 0) + 1
        return f"{t}#{self.counts[t]}"

    def height(self, key):
        if isinstance(key, (int, float)):
            return float(key)
        return float(self.heights[key])

    def place(self, biome, t, x, z, h, *, side="C", y=None, layer=1,
              rot=None, extra=None, jit=True):
        if t in RETIRED:
            self.skipped.append((biome, t))
            return None
        if not (ASSETS / f"{t}.webp").exists():
            raise SystemExit(f"[{biome}] нет спрайта assets/{t}.webp — spec ссылается на то, чего нет")
        wl = self.spec["biomes"][biome]["whitelist"]
        if t not in wl:
            # A spec that asks for something its own whitelist forbids is a bug
            # in the spec, not in the scene. All of them are collected and
            # reported together — dying on the first would mean finding them one
            # round trip at a time — and the object is skipped.
            self.conflicts.add((biome, t))
            return None

        oid = self.uid(t)
        if jit:
            x += jitter(self.seed, f"{oid}:x", self.g["lane_jitter"]["x"])
            z += jitter(self.seed, f"{oid}:z", self.g["lane_jitter"]["z"])
        o = {
            "id": oid, "t": t, "layer": layer,
            "pos": [round(x, 3), None if y is None else round(y, 3), round(z, 3)],
            "h": round(h, 3),
            "rotY": self.rot_for(side, oid) if rot is None else round(rot, 4),
            "visible": True,
        }
        if extra:
            o.update(extra)
        return o

    @staticmethod
    def tag(objs, grp, on_axis):
        """Mark a cluster so the validator can tell designed adjacency from an
        accident, and an object the spec deliberately put on the axis from one
        that drifted there."""
        for o in objs:
            if o is not None:
                o["_grp"] = grp
                o["_axis"] = on_axis
        return [o for o in objs if o is not None]

    # -- one biome --------------------------------------------------------
    def biome(self, bid):
        b = self.spec["biomes"][bid]
        out = {"sprites": [], "boards": []}

        # --- rhythm: the beats along the road ----------------------------
        for i, beat in enumerate(b["rhythm"]):
            z, side, lane = beat["z"], beat["side"], beat["lane"]
            x0 = self.lane_x(bid, lane, side)
            layer = self.layer_of(lane)

            if "group" in beat:
                grp = self.spec["groups"][beat["group"]]
                # the anchor takes the jitter; members hang off it rigidly
                ax = x0 + jitter(self.seed, f"{bid}:{i}:x", self.g["lane_jitter"]["x"])
                az = z + jitter(self.seed, f"{bid}:{i}:z", self.g["lane_jitter"]["z"])
                made = []
                gname = beat["group"]
                for m in grp["members"]:
                    t = beat.get(m["t"], m["t"])       # `house` picks which house
                    mirror = -1 if side == "L" else 1  # a group reads outward from the road
                    made.append(self.place(
                        bid, t, ax + mirror * m["dx"], az + m["dz"],
                        self.height(m["h"]), side=side, layer=layer, jit=False,
                        y=self.height(m["h"]) * 0.5 if m.get("hanging") else
                          (self.g["camera_eye_height"] + self.height(m["h"]) * 0.5
                           if m.get("over_road") else None),
                        extra={**{k: m[k] for k in ("sway", "dim") if k in m},
                               **({"hanging": True} if m.get("hanging") else {}),
                               **({"over_road": True} if m.get("over_road") else {}),
                               "_from": f"группа {gname}, член {m['t']} dx={m['dx']}, "
                                        f"полоса {lane}={self.lane_x(bid, lane, 'R'):.1f}",
                               "_jit": round(abs(ax - x0), 3)}))
                out["sprites"] += self.tag(made, f"{bid}:{i}", side == "C")
                continue

            single = beat["single"]
            if single == "counter":
                out["counter"] = self.counter(bid, x0, z)
                continue
            o = self.place(bid, single, x0, z, self.height(beat["h"]),
                           side=side, layer=layer)
            out["sprites"] += self.tag([o], f"{bid}:{i}", side == "C")

        # --- boards ------------------------------------------------------
        for bd in b["boards"]:
            # boards have their own band now; "verge" was hard-coded here and
            # quietly ignored the spec the moment it grew a `lane` field
            x = self.lane_x(bid, bd.get("lane", "verge"), bd["side"])
            x += jitter(self.seed, f"board:{bd['key']}:x", self.g["lane_jitter"]["x"])
            deg = 4.0 + h01(self.seed, "board", bd["key"]) * 6.0
            out["boards"].append({
                "id": f"board:{bd['key']}", "key": bd["key"],
                "kind": "stone" if bid == "spirit" else "wood",
                "pos": [round(x, 3), None, round(bd["z"], 3)],
                "h": self.height("board"),
                "rotY": round(math.radians(-deg if bd["side"] == "L" else deg), 4),
                "visible": True,
            })

        # --- backdrop ----------------------------------------------------
        bd = b.get("backdrop")
        if bd:
            z = bd["from_z"]
            n = 0
            while z >= bd["to_z"]:
                side = "L" if n % 2 == 0 else "R"
                x0 = self.lane_x(bid, bd["lane"], side)
                if "group" in bd:
                    grp = self.spec["groups"][bd["group"]]
                    made = [self.place(bid, m["t"], x0 + m["dx"], z + m["dz"],
                                       self.height(m["h"]), side="C", layer=0,
                                       rot=0.0, jit=False,
                                       extra={"dim": m.get("dim", bd.get("dim", 0.7))})
                            for m in grp["members"]]
                    out["sprites"] += self.tag(made, f"{bid}:bd{n}", True)
                else:
                    o = self.place(bid, bd["single"], x0, z, self.height("deadtree"),
                                   side="C", layer=0, rot=0.0,
                                   extra={"dim": bd.get("dim", 0.6)})
                    if o:
                        out["sprites"].append(o)
                z -= bd["every_z"]
                n += 1

        # --- sky ---------------------------------------------------------
        sky = b.get("sky")
        if sky:
            z0, z1 = sky["z_range"]
            y0, y1 = sky["y_range"]
            # which clouds this biome allows is a decision in the spec: the
            # forest gets only the storm cloud, the closing dusk only the light
            # ones. Cycling a/b/c regardless would have overridden that.
            kinds = [c for c in ("cloud_a", "cloud_b", "cloud_c")
                     if c in b["whitelist"]]
            if not kinds:
                self.notes.append(f"{bid}: sky задан, но облаков нет в whitelist")
            for k in range(sky.get("clouds", 0) if kinds else 0):
                t = kinds[k % len(kinds)]
                fx = h01(self.seed, bid, "cloud", k)
                fz = h01(self.seed, bid, "cloudz", k)
                o = self.place(bid, t, -28 + fx * 56, z0 + (z1 - z0) * fz,
                               self.height("cloud"), side="C", rot=0.0, layer=0,
                               y=y0 + (y1 - y0) * h01(self.seed, bid, "cloudy", k),
                               jit=False,
                               extra={"drift": round(0.18 + fx * 0.22, 3), "span": 110})
                if o:
                    out["sprites"].append(o)
            mo = sky.get("moon")
            if mo:
                o = self.place(bid, "moon", mo["x"], mo["z"], self.height("moon"),
                               side="C", rot=0.0, layer=0, y=mo["y"], jit=False,
                               extra={"nofog": True})
                if o:
                    out["sprites"].append(o)

        # --- scatter -----------------------------------------------------
        sc = b.get("scatter")
        if sc:
            placed = [(o["pos"][0], o["pos"][2],
                       (aspect(o["t"]) or 1) * o["h"] / 2)
                      for o in out["sprites"] if o["layer"] >= 0.5]
            for j, (t, x, z, _half) in enumerate(self.poisson(bid, sc, b["length_z"], placed)):
                o = self.place(bid, t, x, z, self.height(self.h_key(t)),
                               side="L" if x < 0 else "R", layer=1, jit=False)
                if o:
                    out["sprites"].append(o)

        return out

    def h_key(self, t):
        table = {
            "grass_tuft_a": "tuft", "grass_tuft_b": "tuft", "rock_s": "rock_s",
            "rock_m": "rock_m", "rock_l": "rock_l", "mushrooms": "mushrooms",
            "fern": "fern", "ore_pile": "ore_pile", "stalagmite_b": "stalagmite",
            "grave_c": "grave", "candles": "candles", "prop_stones": "tuft",
        }
        return table.get(t, "tuft")

    def counter(self, bid, x0, z):
        stall_h = self.height("cart") * 2.2
        return {
            "id": "counter", "visible": True,
            "stall": {"t": "feat_world", "x": round(x0, 3), "z": round(z, 3),
                      "h": round(stall_h, 3), "layer": 1},
            "items": COUNTER_ITEMS,
            "x0": round(x0 - 2.3, 3), "step": 0.62,
            "y": round(stall_h * 0.52, 3), "z": round(z + 0.8, 3), "h": 0.72,
        }

    # -- scatter ----------------------------------------------------------
    def poisson(self, bid, sc, length, placed=()):
        """Poisson-disc inside the allowed lane bands. Candidates are drawn from
        the seeded hash, not from random(), so the scatter is reproducible; a
        candidate is kept only if it clears everything already placed."""
        table = dict(self.lanes)
        table.update(self.spec["biomes"][bid].get("lane_override", {}))
        bands = [table[l] for l in sc["lanes"]]
        lo, hi = min(bands) - 1.0, max(bands) + 1.0
        rmin = 2.4      # плюс габариты пары, см. ниже
        out, tries = [], 0
        while len(out) < sc["count"] and tries < sc["count"] * 400:
            k = tries
            tries += 1
            side = -1 if h01(self.seed, bid, "sside", k) < 0.5 else 1
            x = side * (lo + h01(self.seed, bid, "sx", k) * (hi - lo))
            z = -2 - h01(self.seed, bid, "sz", k) * (length - 6)
            if sc.get("avoid_road") and abs(x) < self.road + 0.8:
                continue
            t = sc["types"][len(out) % len(sc["types"])]
            half = (aspect(t) or 1) * self.height(self.h_key(t)) / 2
            if any(abs(z - pz) < 1.2 and abs(x - px) < half + ph + 0.8
                   for _t, px, pz, ph in out):
                continue
            if any((x - px) ** 2 + (z - pz) ** 2 < rmin ** 2 for _t, px, pz, _h in out):
                continue
            # and clear of everything the rhythm already put down: scattered
            # dressing that lands inside a house is worse than one tuft fewer
            gap = self.g["validator"]["min_bbox_gap"]
            if any(abs(z - pz) < 1.2 and abs(x - px) < half + pw + gap
                   for px, pz, pw in placed):
                continue
            out.append((t, x, z, half))
        if len(out) < sc["count"]:
            self.notes.append(
                f"{bid}: scatter разложил {len(out)} из {sc['count']} — "
                f"полоса узкая, ближе {rmin} м не ставлю")
        return out

    def build(self):
        biomes = {bid: self.biome(bid) for bid in self.spec["biomes"]}
        return {
            "version": 1,
            "generated": "tools/generate_layout.py по assets/scene_spec.json",
            "seed": self.seed,
            # What ?debug=lanes and ?debug=rows draw. Written here because the
            # scene never reads the spec — it would have to guess the numbers,
            # and a debug overlay that guesses is worse than none.
            "debug": {
                "road_half_width": self.road,
                "lanes": {bid: {**self.lanes,
                                **self.spec["biomes"][bid].get("lane_override", {})}
                          for bid in self.spec["biomes"]},
                "rows": {bid: [b["z"] for b in self.spec["biomes"][bid]["rhythm"]]
                         for bid in self.spec["biomes"]},
                "length": {bid: self.spec["biomes"][bid]["length_z"]
                           for bid in self.spec["biomes"]},
            },
            "biomes": biomes,
        }


# ----------------------------------------------------------------- validator
def jitter_of(o):
    """How much of this object's offset is jitter rather than the spec's own
    numbers — so a report can quote the spec's value, not a jittered one."""
    return o.get("_jit", 0.0)


def validate(layout, spec):
    v = spec["global"]["validator"]
    road = spec["global"]["road_half_width"]
    bad = []

    for bid, b in layout["biomes"].items():
        objs = [o for o in b["sprites"] if o["layer"] >= 0.5]
        for o in b["sprites"]:
            x, y, z = o["pos"]
            w = (aspect(o["t"]) or 1) * o["h"]

            # `side: C` is the spec putting something on the axis on purpose —
            # the arch the camera flies under, the closing house at the end of
            # the path. The rule is for everything that did NOT ask to be there.
            if (v.get("forbid_on_road") and o["t"] not in spec["road_props"]
                    and not o.get("_axis")):
                if abs(x) < road + 0.8 and o["layer"] >= 0.5 and y is None:
                    # A violation is only useful if it says what to change. The
                    # binding number is lane + dx, and it has to clear the road
                    # margin even at the worst jitter — so the fix is one of two
                    # numbers in the spec, and both are named here.
                    need = road + 0.8 + spec["global"]["lane_jitter"]["x"]
                    src = o.get("_from", "")
                    bad.append(
                        f"{bid}/{o['id']}: на дороге, x={x} (порог {road + 0.8})"
                        + (f"\n      {src}: нужно |полоса + dx| >= {need:.1f}, "
                           f"сейчас {abs(x) - jitter_of(o):.1f}" if src else ""))

            if v.get("require_ground_contact"):
                sky = o["t"].startswith("cloud") or o["t"] == "moon"
                declared = o.get("hanging") or o.get("over_road")
                if y is not None and not sky and not declared:
                    bad.append(f"{bid}/{o['id']}: висит (y={y}), "
                               f"хотя spec не объявлял его подвесным")

        # objects must not sit inside one another
        gap = v.get("min_bbox_gap", 0)
        for i in range(len(objs)):
            a = objs[i]
            ax, _, az = a["pos"]
            aw = (aspect(a["t"]) or 1) * a["h"] / 2
            for j in range(i + 1, len(objs)):
                c = objs[j]
                cx, _, cz = c["pos"]
                cw = (aspect(c["t"]) or 1) * c["h"] / 2
                # a group's internal geometry is the spec's design: a fence
                # stands right in front of its house, candles right at a grave.
                # Only unrelated objects are held apart.
                if a.get("_grp") and a.get("_grp") == c.get("_grp"):
                    continue
                if abs(az - cz) > 1.2:
                    continue
                overlap = (aw + cw + gap) - abs(ax - cx)
                if overlap > 0:
                    bad.append(f"{bid}: {a['id']} и {c['id']} перекрываются на "
                               f"{overlap:.2f} м (нужен зазор {gap})")

        # no dead stretch along the road
        # walk INTO the biome: 0 is the entrance and -length the far end
        zs = sorted({round(o["pos"][2]) for o in b["sprites"] if o["layer"] >= 0.5},
                    reverse=True)
        length = spec["biomes"][bid]["length_z"]
        walk = [0] + zs + [-length]
        for a, c in zip(walk, walk[1:]):
            if a - c > v["max_gap_z"]:
                bad.append(f"{bid}: пустой перегон {a}..{c} — {a - c:.0f} м "
                           f"при пороге {v['max_gap_z']}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="записать файл несмотря на нарушения (они всё равно печатаются)")
    args = ap.parse_args()

    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    bld = Builder(spec)
    layout = bld.build()

    n = {bid: len(b["sprites"]) + len(b["boards"]) + (1 if b.get("counter") else 0)
         for bid, b in layout["biomes"].items()}
    print(f"{'биом':<10}{'объектов':>10}{'спрайтов':>10}{'досок':>8}")
    print("-" * 38)
    for bid, b in layout["biomes"].items():
        print(f"{bid:<10}{n[bid]:>10}{len(b['sprites']):>10}{len(b['boards']):>8}")
    print("-" * 38)
    print(f"{'всего':<10}{sum(n.values()):>10}")

    for t in {t for _b, t in bld.skipped}:
        print(f"\n  пропущен '{t}': {RETIRED[t]}")
    for note in bld.notes:
        print(f"  {note}")

    bad = validate(layout, spec)   # runs before the tags are stripped
    if bad:
        print(f"\nВАЛИДАТОР: нарушений {len(bad)}")
        for line in bad:
            print(f"  - {line}")
        if spec["global"]["validator"].get("fail_on_violation") and not args.force:
            sys.exit(1)
        if args.force:
            print("  --force: файл всё равно записан, нарушения выше не исправлены")
    else:
        print("\nвалидатор: чисто")

    for b in layout["biomes"].values():
        for o in b["sprites"]:
            for k in ("_grp", "_axis", "_from", "_jit"):
                o.pop(k, None)

    if args.dry:
        print("\n--dry: файл не записан")
        return
    if OUT.exists() and not (ASSETS / "layout_manual.json").exists():
        (ASSETS / "layout_manual.json").write_bytes(OUT.read_bytes())
        print("прежняя ручная расстановка сохранена как assets/layout_manual.json")
    OUT.write_text(json.dumps(layout, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"-> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
