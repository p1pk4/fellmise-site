"""Top-down presentation: how each biome LOOKS, and where one turns into the next.

composition.json says where things stand; assets/topdown/presentation.json says
what the ground under them is made of, its palette, how much vegetation the
ground decals carry, and where the transitions sit. This module checks that
file and turns it into the one set of numbers every consumer uses:

    presentation.json + config.json (biome_spacing)
        -> compute()  -> layout["presentation"] in layout.generated/runtime.json
        -> proto/main.js: ground-shader uniforms, decal vegetation,
           transition overlay, __PROTO.presentationAt()

Transitions are anchored where the composition narrows (the forest gate, the
mine throat...), not at the mathematical middle between biome origins. Each
is written as a local z inside the biome it leads INTO; world z follows from
biome_spacing. The ground crossfade runs from `lead` metres before the anchor
to `tail` metres after it; the screen dim peaks at the anchor and is gone
`dim.half_width` metres either side.
"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PRESENTATION = ROOT / "assets" / "topdown" / "presentation.json"

GROUND_LAYERS = ("grass", "moss", "stone", "dirt")
DIM_MAX = 0.6            # a transition dims the frame, it never blacks it out
DIM_HALF_MAX = 20.0      # metres: an accent of a passage, not a loading screen


def load(path=PRESENTATION):
    return json.loads(path.read_text(encoding="utf-8"))


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def check(pres, biome_ids):
    """Every problem at once, as lines."""
    bad = []
    if pres.get("version") != 1:
        return ["presentation.json: ожидается \"version\": 1"]
    tex = pres.get("textures", {})
    for layer in GROUND_LAYERS + ("road",):
        f = tex.get(layer)
        if not isinstance(f, str) or not (ROOT / "proto" / f).is_file():
            bad.append(f"textures.{layer}: нет файла proto/{f}")
    biomes = pres.get("biomes", {})
    if list(biomes) != list(biome_ids):
        bad.append(f"biomes: нужны ровно {list(biome_ids)} в этом порядке, а не {list(biomes)}")
    for bid, b in biomes.items():
        g = b.get("ground", {})
        if set(g) != set(GROUND_LAYERS) or not all(_num(g[k], 0, 1) for k in GROUND_LAYERS):
            bad.append(f"{bid}.ground: {list(GROUND_LAYERS)}, каждое 0..1")
        elif sum(g.values()) <= 0:
            bad.append(f"{bid}.ground: хоть один слой > 0")
        tint = b.get("tint")
        if not (isinstance(tint, list) and len(tint) == 3 and all(_num(v, 0.5, 1.5) for v in tint)):
            bad.append(f"{bid}.tint: [r, g, b], каждое 0.5..1.5")
        for key, lo, hi in (("saturation", 0, 1.5), ("brightness", 0.5, 1.5),
                            ("road_stone", 0, 1), ("vegetation", 0, 1)):
            if not _num(b.get(key), lo, hi):
                bad.append(f"{bid}.{key}: число {lo}..{hi}")
    tr = pres.get("transitions", [])
    ids = list(biome_ids)
    if len(tr) != len(ids) - 1:
        bad.append(f"transitions: нужно {len(ids) - 1}, а не {len(tr)}")
    for k, t in enumerate(tr):
        want = (ids[k], ids[k + 1]) if k + 1 < len(ids) else None
        if (t.get("from"), t.get("to")) != want:
            bad.append(f"transitions[{k}]: ожидается {want}, а не {(t.get('from'), t.get('to'))}")
        a = t.get("anchor", {})
        if a.get("biome") not in ids or not _num(a.get("z"), -200, 200):
            bad.append(f"transitions[{k}].anchor: {{biome, z}} — локальный z биома")
        if not (_num(t.get("lead"), 1, 80) and _num(t.get("tail"), 1, 80)):
            bad.append(f"transitions[{k}]: lead и tail — метры 1..80")
        d = t.get("dim", {})
        if not (_num(d.get("max"), 0, DIM_MAX) and _num(d.get("half_width"), 1, DIM_HALF_MAX)):
            bad.append(f"transitions[{k}].dim: max 0..{DIM_MAX}, half_width 1..{DIM_HALF_MAX}")
    return bad


def compute(pres, biome_ids, spacing):
    """World-z form of presentation.json, as the runtime layout carries it."""
    ids = list(biome_ids)
    out_tr = []
    for t in pres["transitions"]:
        a = t["anchor"]
        z = -ids.index(a["biome"]) * spacing + a["z"]
        out_tr.append({
            "from": t["from"], "to": t["to"], "anchor_z": round(z, 3),
            "blend_z": [round(z + t["lead"], 3), round(z - t["tail"], 3)],
            "dim": {"max": t["dim"]["max"], "half_width": t["dim"]["half_width"]},
        })
    return {
        "textures": dict(pres["textures"]),
        "biomes": [{"id": bid, **pres["biomes"][bid]} for bid in ids],
        "transitions": out_tr,
    }


def check_computed(p):
    """Order and overlap of the world-z bands: anchors run down the road, a
    blend band never reaches into the next one."""
    bad = []
    tr = p["transitions"]
    for a, b in zip(tr, tr[1:]):
        if not a["anchor_z"] > b["anchor_z"]:
            bad.append(f"переходы не по порядку: {a['from']}→{a['to']} {a['anchor_z']} "
                       f"и {b['from']}→{b['to']} {b['anchor_z']}")
        if not a["blend_z"][1] > b["blend_z"][0]:
            bad.append(f"полосы перехода {a['from']}→{a['to']} и {b['from']}→{b['to']} "
                       f"перекрываются: {a['blend_z']} / {b['blend_z']}")
    for t in tr:
        if not (t["blend_z"][0] > t["anchor_z"] > t["blend_z"][1]):
            bad.append(f"{t['from']}→{t['to']}: якорь вне своей полосы")
    return bad


def blend_at(p, z):
    """(biome index as a float 0..n-1) at world z — the same ramp the shader
    and proto/main.js use (smoothstep over each blend band)."""
    b = 0.0
    for t in p["transitions"]:
        z0, z1 = t["blend_z"]
        u = min(max((z0 - z) / (z0 - z1), 0.0), 1.0)
        b += u * u * (3 - 2 * u)
    return b
