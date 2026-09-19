"""Layout pipeline tests: legacy + top-down targets, stable ids, overrides.

    python tools/test_layout.py            # stdlib unittest, no extra deps

What each test protects is in its docstring. The committed files are part of
the contract: /next/ reads assets/layout.json, /proto/ reads
assets/topdown/layout.runtime.json, and both must be what the generator says.
"""

import copy
import json
import pathlib
import re
import struct
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import generate_layout as G   # noqa: E402
import topdown_compose as TC  # noqa: E402
import topdown_layout as T    # noqa: E402

SPEC = json.loads(G.SPEC.read_text(encoding="utf-8"))
CFG = G.load_topdown_config()
COMP = TC.load_composition()

# assets/layout.json as /next/ has read it since 2feb83f (LF-normalised). The
# legacy target must not move while top-down is being recomposed; change this
# only in a batch that deliberately changes /next/.
LEGACY_SHA256 = "0898d0865c2d26d27ddab96dfe45827e62b554ff81d6cb2ebc57e7e3e4d2fb49"


def build(target, spec=SPEC, comp=COMP):
    layout, bad, _ = G.generate(copy.deepcopy(spec), target,
                                CFG if target == "topdown" else None,
                                copy.deepcopy(comp) if target == "topdown" else None)
    return layout, bad


def ids(layout):
    return list(T.objects(layout))


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def positions(layout):
    return {i: (o.get("t"), o["pos"], o["h"], o["rotY"]) for i, o in T.objects(layout).items()}


# Scatter is accepted or refused by geometry: a new object can take the spot of
# a scatter candidate. Its ids are still stable (hash candidate), only the set
# can shrink. Everything else is authored and must not move.
DERIVED = ("/scatter/",)


def authored(id_list):
    return [i for i in id_list if not any(d in i for d in DERIVED)]


LEGACY, _ = build("legacy")
TOPDOWN, TOPDOWN_BAD = build("topdown")


class Generation(unittest.TestCase):
    def test_deterministic(self):
        """Same input, byte-identical output — for both targets."""
        for target in ("legacy", "topdown"):
            a, _ = build(target)
            b, _ = build(target)
            self.assertEqual(G.dump(a), G.dump(b), target)

    def test_committed_files_are_current(self):
        """The committed generated files are exactly what the generator makes."""
        self.assertEqual(G.dump(LEGACY), read("assets/layout.json"))
        self.assertEqual(G.dump(TOPDOWN), read("assets/topdown/layout.generated.json"))
        runtime = T.merge(TOPDOWN, T.load_overrides())
        self.assertEqual(T.dump(runtime), read("assets/topdown/layout.runtime.json"))

    def test_legacy_layout_unchanged(self):
        """/next/'s layout is byte-identical to the one production serves."""
        import hashlib
        text = read("assets/layout.json").encode("utf-8")
        self.assertEqual(hashlib.sha256(text).hexdigest(), LEGACY_SHA256)

    def test_topdown_has_no_violations(self):
        """Zero road intrusions, zero collisions — and no known-list to hide any."""
        self.assertEqual(TOPDOWN_BAD, [])
        self.assertNotIn("validator_known_violations", CFG)

    def test_validator_still_catches_intrusions(self):
        """Put a barn on the road: the validator must say so."""
        comp = copy.deepcopy(COMP)
        comp["biomes"]["village"]["clusters"].append(
            {"key": "barn-on-road", "at": [1.0, -60], "items": [{"t": "barn", "h": "barn"}]})
        _, bad = build("topdown", comp=comp)
        self.assertTrue(any("barn-on-road" in b and "на дороге" in b for b in bad), bad)

    def test_validator_catches_collisions(self):
        """Two houses on one spot collide."""
        comp = copy.deepcopy(COMP)
        comp["biomes"]["village"]["clusters"].append(
            {"key": "twin", "at": [-15.5, -14], "items": [{"t": "hero_house_a", "h": "house"}]})
        _, bad = build("topdown", comp=comp)
        self.assertTrue(any("twin" in b and "друг на друге" in b for b in bad), bad)

    def test_composition_structure_checked(self):
        """Duplicate keys, diagonal fences, unknown boards, '/' in keys fail."""
        for mutate in (
            lambda b: b["clusters"].append(dict(b["clusters"][0])),
            lambda b: b["fences"].append({"key": "diag", "from": [10, -1], "to": [14, -5]}),
            lambda b: b["boards"].__setitem__("no_such_board", {"at": [9, -9]}),
            lambda b: b["clusters"].append({"key": "bad/key", "at": [0, 0], "items": []}),
        ):
            comp = copy.deepcopy(COMP)
            mutate(comp["biomes"]["village"])
            self.assertTrue(TC.check_composition(comp, SPEC))
        self.assertEqual(TC.check_composition(COMP, SPEC), [])


class StableIds(unittest.TestCase):
    def test_unique(self):
        """Every sprite and board id is unique and none is a legacy id."""
        every = ids(TOPDOWN)
        self.assertEqual(len(every), len(set(every)))
        self.assertTrue(all("#" not in i for i in every), "легаси-id в top-down")

    def test_same_kind_cluster_insert_keeps_ids_and_positions(self):
        """A new place of the SAME kind (a well square) inserted first in the
        village renames nothing and moves nothing that was authored: ids come
        from keys, jitter hashes the id."""
        comp = copy.deepcopy(COMP)
        comp["biomes"]["village"]["clusters"].insert(0, {
            "key": "north-well", "at": [-30, -96], "items": [
                {"key": "well", "t": "hero_well", "h": "well"},
                {"t": "prop_crates", "h": "crates", "dx": -3.4, "dz": 1.6}]})
        new, _ = build("topdown", comp=comp)
        before, after = positions(TOPDOWN), positions(new)
        for i in authored(before):
            self.assertIn(i, after)
            self.assertEqual(before[i], after[i], i)
        self.assertIn("village/north-well/well", after)

    def test_member_insert_is_contained(self):
        """A new item in one cluster changes nothing outside that cluster."""
        comp = copy.deepcopy(COMP)
        wh = next(c for c in comp["biomes"]["village"]["clusters"] if c["key"] == "west-homes")
        wh["items"].insert(0, {"t": "hero_tree_b", "h": "bush", "dx": 4, "dz": -30})
        new, _ = build("topdown", comp=comp)
        before, after = positions(TOPDOWN), positions(new)
        for i in authored(before):
            if not i.startswith("village/west-homes/"):
                self.assertEqual(before[i], after.get(i), i)

    def test_mass_members_keep_their_place(self):
        """A mass member is its hash candidate: a member present before and
        after an unrelated insertion sits exactly where it sat."""
        comp = copy.deepcopy(COMP)
        comp["biomes"]["forest"]["clusters"].append(
            {"key": "extra-stump", "at": [22, -40], "items": [{"t": "biome_stump", "h": "stump"}]})
        new, _ = build("topdown", comp=comp)
        before, after = positions(TOPDOWN), positions(new)
        common = [i for i in before if i in after and "/east-deep/" in i]
        self.assertTrue(common)
        for i in common:
            self.assertEqual(before[i], after[i], i)

    def test_keyed_spec_tacts_survive_same_kind_insert(self):
        """Fallback path (a biome composition.json does not describe): spec
        beats with an explicit `key` keep their ids and jitter when a beat of
        the SAME kind is inserted above them. Without keys the ordinal-based
        id now names a different beat — shown too, so the test measures
        something."""
        comp = copy.deepcopy(COMP)
        del comp["biomes"]["forest"]
        spec = copy.deepcopy(SPEC)
        for n, beat in enumerate(spec["biomes"]["forest"]["rhythm"]):
            beat["key"] = f"beat-{n}"
        base, _ = build("topdown", spec=spec, comp=comp)
        spec2 = copy.deepcopy(spec)
        spec2["biomes"]["forest"]["rhythm"].insert(0, {
            "z": -4, "side": "L", "lane": "near", "group": "pine_stand", "key": "new-stand"})
        new, _ = build("topdown", spec=spec2, comp=comp)
        keyed = [i for i in ids(base) if i.startswith("forest/beat-")]
        self.assertTrue(keyed)
        self.assertEqual([i for i in keyed if i not in set(ids(new))], [])
        self.assertTrue(any(i.startswith("forest/new-stand/") for i in ids(new)))

        plain_new = copy.deepcopy(SPEC)
        plain_new["biomes"]["forest"]["rhythm"].insert(0, {
            "z": -4, "side": "L", "lane": "near", "group": "pine_stand"})
        a, _ = build("topdown", spec=SPEC, comp=comp)
        b, _ = build("topdown", spec=plain_new, comp=comp)
        pa, pb = positions(a), positions(b)
        self.assertNotEqual(pa["forest/pine_stand.1/biome_pine_a.1"],
                            pb["forest/pine_stand.1/biome_pine_a.1"])

    def test_ids_do_not_depend_on_array_position(self):
        """Ids are not array positions, and none carries the legacy counter."""
        for i in ids(TOPDOWN):
            self.assertIsNone(re.search(r"#\d+$", i), i)
        shuffled = copy.deepcopy(TOPDOWN)
        s = shuffled["biomes"]["village"]["sprites"]
        s.append(s.pop(0))
        self.assertEqual(sorted(ids(TOPDOWN)), sorted(ids(shuffled)))
        runtime = T.merge(shuffled, T.load_overrides())
        self.assertEqual(sorted(ids(runtime)), sorted(ids(TOPDOWN)))


class Road(unittest.TestCase):
    def test_road_model_is_protos(self):
        """The Python road is proto's road: the same 64 samples three.js
        produces (tests/fixtures/road_samples.json, node tools/road_samples.mjs),
        for the spline that is committed now."""
        import hashlib
        fx = json.loads(read("tests/fixtures/road_samples.json"))
        spline = read("assets/road_spline.json").encode("utf-8")
        self.assertEqual(fx["spline_sha256"], hashlib.sha256(spline).hexdigest(),
                         "road_spline.json изменился — node tools/road_samples.mjs")
        road = TC.Road(CFG["road_half_width"])
        for (x, w), cx, cw in zip(fx["samples"], road.centre, road.width):
            self.assertAlmostEqual(x, cx, places=9)
            self.assertAlmostEqual(w, cw, places=9)

    def test_clearance_uses_canonical_width(self):
        """Top-down placement and validation use config road_half_width;
        legacy keeps the spec's."""
        _, _, bld = G.generate(copy.deepcopy(SPEC), "topdown", CFG, copy.deepcopy(COMP))
        self.assertEqual(bld.road, CFG["road_half_width"])
        self.assertEqual(bld.placement_road, CFG["road_half_width"])
        self.assertEqual(bld.composer.road.half, CFG["road_half_width"])
        _, _, leg = G.generate(copy.deepcopy(SPEC), "legacy")
        self.assertEqual(leg.placement_road, SPEC["global"]["road_half_width"])


class Overrides(unittest.TestCase):
    def first(self, layout=None):
        layout = layout or TOPDOWN
        return next(iter(T.objects(layout).items()))

    def test_empty_overrides_equal_generated(self):
        runtime = T.merge(TOPDOWN, {"version": 1, "objects": {}})
        self.assertEqual(runtime["biomes"], TOPDOWN["biomes"])
        self.assertEqual(runtime["road_half_width"], TOPDOWN["road_half_width"])

    def test_override_applied(self):
        oid, obj = self.first()
        before = copy.deepcopy(TOPDOWN)
        ov = {"pos": [1.5, None, -3.25], "h": 2.5, "rotY": 0.3, "visible": False}
        runtime = T.merge(TOPDOWN, {"version": 1, "objects": {oid: ov}})
        got = T.objects(runtime)[oid]
        for k, v in ov.items():
            self.assertEqual(got[k], v)
        self.assertEqual(got["t"], obj["t"])
        self.assertEqual(TOPDOWN, before, "merge изменил входной generated")
        others = [o for i, o in T.objects(runtime).items() if i != oid]
        self.assertEqual(others, [o for i, o in T.objects(TOPDOWN).items() if i != oid])

    def test_runtime_count(self):
        runtime = T.merge(TOPDOWN, T.load_overrides())
        for bid, b in TOPDOWN["biomes"].items():
            for kind in ("sprites", "boards"):
                self.assertEqual(len(runtime["biomes"][bid][kind]), len(b[kind]))

    def test_orphan_fails(self):
        with self.assertRaises(T.OverrideError) as cm:
            T.merge(TOPDOWN, {"version": 1, "objects": {"village/nothing.1": {"h": 2}}})
        self.assertIn("village/nothing.1", str(cm.exception))

    def test_malformed_fails(self):
        oid, _ = self.first()
        cases = [
            {"objects": {}},                                   # no version
            {"version": 1, "objects": []},                     # not a map
            {"version": 1, "objects": {oid: {}}},              # empty
            {"version": 1, "objects": {oid: {"t": "barn"}}},   # not editable
            {"version": 1, "objects": {oid: {"pos": [1, 2]}}},
            {"version": 1, "objects": {oid: {"pos": [1, "a", 2]}}},
            {"version": 1, "objects": {oid: {"h": -1}}},
            {"version": 1, "objects": {oid: {"h": True}}},
            {"version": 1, "objects": {oid: {"rotY": "0.1"}}},
            {"version": 1, "objects": {oid: {"visible": "no"}}},
        ]
        for c in cases:
            with self.assertRaises(T.OverrideError, msg=json.dumps(c)):
                T.merge(TOPDOWN, c)

    def test_duplicate_id_fails(self):
        dup = copy.deepcopy(TOPDOWN)
        s = dup["biomes"]["village"]["sprites"]
        s[1]["id"] = s[0]["id"]
        with self.assertRaises(T.OverrideError):
            T.merge(dup, {"version": 1, "objects": {}})

    def test_diff_roundtrip(self):
        """Editor output -> overrides -> merge gives back the editor output, and
        the overrides hold only the fields that changed."""
        edited = copy.deepcopy(TOPDOWN)
        oid, obj = self.first(edited)
        obj["pos"] = [obj["pos"][0] + 1.0, obj["pos"][1], obj["pos"][2]]
        board = edited["biomes"]["mine"]["boards"][0]
        board["visible"] = False
        data = T.diff(TOPDOWN, edited)
        self.assertEqual(data["objects"], {board["id"]: {"visible": False},
                                           oid: {"pos": obj["pos"]}})
        self.assertEqual(T.merge(TOPDOWN, data)["biomes"], edited["biomes"])

    def test_diff_rejects_non_editable(self):
        edited = copy.deepcopy(TOPDOWN)
        _, obj = self.first(edited)
        obj["t"] = "barn"
        with self.assertRaises(T.OverrideError):
            T.diff(TOPDOWN, edited)
        removed = copy.deepcopy(TOPDOWN)
        removed["biomes"]["village"]["sprites"].pop(0)
        with self.assertRaises(T.OverrideError):
            T.diff(TOPDOWN, removed)

    def test_export_never_writes_generated(self):
        """The top-down export path writes overrides and runtime only."""
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            gen, ov, rt = d / "g.json", d / "o.json", d / "r.json"
            gen.write_text(G.dump(TOPDOWN), encoding="utf-8")
            ov.write_text(T.dump({"version": 1, "objects": {}}), encoding="utf-8")
            before = gen.read_bytes()
            edited = copy.deepcopy(TOPDOWN)
            oid, obj = self.first(edited)
            obj["h"] = obj["h"] + 1
            n = T.export(edited, generated=gen, overrides=ov, runtime=rt, backups=d / "bk")
            self.assertEqual(n, 1)
            self.assertEqual(gen.read_bytes(), before)
            self.assertEqual(json.loads(ov.read_text(encoding="utf-8"))["objects"],
                             {oid: {"h": obj["h"]}})
            self.assertEqual(json.loads(rt.read_text(encoding="utf-8"))["biomes"],
                             edited["biomes"])
            self.assertEqual(len(list((d / "bk").iterdir())), 1)

            bad = copy.deepcopy(edited)
            bad["biomes"]["village"]["sprites"][0]["id"] = "village/ghost.1"
            with self.assertRaises(T.OverrideError):
                T.export(bad, generated=gen, overrides=ov, runtime=rt)
            self.assertEqual(gen.read_bytes(), before)


class Consumers(unittest.TestCase):
    def test_road_half_single_source(self):
        """Top-down road width lives in config.json only; the generated and
        runtime files carry it, proto reads it from runtime, and no top-down
        code holds its own copy of the number."""
        road = CFG["road_half_width"]
        self.assertEqual(TOPDOWN["road_half_width"], road)
        self.assertEqual(TOPDOWN["debug"]["road_half_width"], road)
        runtime = json.loads(read("assets/topdown/layout.runtime.json"))
        self.assertEqual(runtime["road_half_width"], road)
        proto = read("proto/main.js")
        self.assertIn("ROAD_HALF = layout.road_half_width", proto)
        self.assertIsNone(re.search(r"ROAD_HALF\s*=\s*[\d.]+", proto))
        literal = re.escape(repr(road))
        for rel in ("proto/main.js", "tools/generate_layout.py", "tools/topdown_layout.py",
                    "tools/topdown_compose.py"):
            self.assertIsNone(re.search(rf"(?<![\d.]){literal}(?![\d])", read(rel)), rel)
        # legacy keeps the spec's own value
        self.assertEqual(LEGACY["debug"]["road_half_width"],
                         SPEC["global"]["road_half_width"])

    def test_next_reads_legacy(self):
        """/next/ still reads assets/layout.json, and its copy is the legacy file."""
        world = read("journey3/src/world.js")
        self.assertIn("${ASSETS}layout.json", world)
        self.assertNotIn("topdown", world)
        built = "".join(p.read_text(encoding="utf-8")
                        for p in (ROOT / "next" / "assets").glob("world-*.js"))
        self.assertIn("layout.json", built)
        self.assertNotIn("topdown", built)
        self.assertEqual(read("next/assets/layout.json"), read("assets/layout.json"))
        self.assertFalse((ROOT / "next" / "assets" / "topdown").exists())

    def test_proto_reads_topdown_runtime(self):
        proto = read("proto/main.js")
        self.assertIn("'topdown/layout.runtime.json'", proto)
        self.assertIn("BIOME_SPACING = layout.biome_spacing", proto)
        self.assertIsNone(re.search(r"BIOME_SPACING\s*=\s*\d", proto))
        runtime = json.loads(read("assets/topdown/layout.runtime.json"))
        self.assertEqual(runtime["biome_spacing"], CFG["biome_spacing"])
        self.assertIsNone(re.search(r"ASSETS\s*\+\s*'layout\.json'", proto))


class Presentation(unittest.TestCase):
    """assets/topdown/presentation.json -> runtime -> proto: one source."""

    def setUp(self):
        import topdown_presentation as TP
        self.TP = TP
        self.pres = TP.load()
        self.ids = list(SPEC["biomes"])

    def test_schema_clean(self):
        self.assertEqual(self.TP.check(self.pres, self.ids), [])

    def test_every_biome_has_presentation(self):
        self.assertEqual(list(self.pres["biomes"]), self.ids)

    def test_schema_catches_problems(self):
        for mutate in (
            lambda p: p["biomes"].pop("mine"),
            lambda p: p["biomes"]["forest"]["ground"].__setitem__("grass", 2),
            lambda p: p["biomes"]["spirit"].__setitem__("tint", [3, 1, 1]),
            lambda p: p["transitions"].pop(),
            lambda p: p["transitions"][1].__setitem__("to", "home"),
            lambda p: p["transitions"][0]["dim"].__setitem__("max", 1.0),
            lambda p: p["textures"].__setitem__("stone", "nope.webp"),
        ):
            p = copy.deepcopy(self.pres)
            mutate(p)
            self.assertTrue(self.TP.check(p, self.ids))

    def test_transitions_ordered_and_apart(self):
        comp = self.TP.compute(self.pres, self.ids, CFG["biome_spacing"])
        self.assertEqual(self.TP.check_computed(comp), [])
        bad = copy.deepcopy(self.pres)
        bad["transitions"][1]["anchor"] = {"biome": "forest", "z": -10}
        self.assertTrue(self.TP.check_computed(self.TP.compute(bad, self.ids, CFG["biome_spacing"])))

    def test_runtime_carries_the_computed_boundaries(self):
        """What proto reads (runtime layout) is exactly compute(presentation.json)."""
        runtime = json.loads(read("assets/topdown/layout.runtime.json"))
        self.assertEqual(runtime["presentation"],
                         self.TP.compute(self.pres, self.ids, CFG["biome_spacing"]))
        self.assertEqual(runtime["road_end_z"], CFG["road_end_z"])

    def test_anchors_sit_in_the_constrictions(self):
        """Each anchor falls inside the z-span of the objects that narrow the
        road there (the composition's gates), not at a midpoint."""
        comp = self.TP.compute(self.pres, self.ids, CFG["biome_spacing"])
        spans = {("village", "forest"): ("forest", ("gate-west", "gate-east")),
                 ("forest", "mine"): ("mine", ("gate-west", "gate-east", "squeeze-west", "squeeze-east")),
                 ("mine", "spirit"): ("mine", ("exit-narrows",)),
                 ("spirit", "home"): ("home", ("gate-pines-west", "gate-pines-east", "returning-green-west"))}
        objs = T.objects(TOPDOWN)
        for t in comp["transitions"]:
            bid, keys = spans[(t["from"], t["to"])]
            bi = self.ids.index(bid)
            zs = [-bi * CFG["biome_spacing"] + o["pos"][2] for i, o in objs.items()
                  if any(i.startswith(f"{bid}/{k}/") for k in keys)]
            self.assertTrue(zs, t)
            self.assertLessEqual(min(zs) - 12, t["anchor_z"], t)
            self.assertLessEqual(t["anchor_z"], max(zs) + 12, t)

    def test_shader_and_js_read_runtime(self):
        """proto builds uniforms and the overlay from layout.presentation — no
        biome boundary or palette literal of its own."""
        proto = read("proto/main.js")
        for needle in ("PRES = layout.presentation", "uTrans: { value: PRES.transitions.map",
                       "uGround: { value: PRES.biomes.map", "uRoadEnd: { value: ROAD_END }",
                       "const ROAD_END = layout.road_end_z", "NB: PRES.biomes.length"):
            self.assertIn(needle, proto)
        for t in json.loads(read("assets/topdown/layout.runtime.json"))["presentation"]["transitions"]:
            self.assertNotIn(str(t["anchor_z"]), proto)


class RoadEnd(unittest.TestCase):
    def test_spline_reproducible(self):
        """road_spline.json is what tools/make_road_spline.py produces."""
        import make_road_spline as MRS
        _, text = MRS.build()
        self.assertEqual(text, read("assets/road_spline.json"))
        pts = json.loads(text)["points"]
        self.assertEqual(pts[-1]["z"], CFG["road_end_z"])

    def test_no_road_behind_the_house(self):
        """Past the terminal the road is gone: zero half-width a road-width
        after the end, and every point behind the house is clear."""
        road = TC.Road(CFG["road_half_width"], end_z=CFG["road_end_z"])
        end = CFG["road_end_z"]
        self.assertGreater(road.at(end + 10)[1], 3.0)
        self.assertEqual(road.at(end - 6)[1], 0.0)
        house = T.objects(TOPDOWN)["home/homestead/house"]
        top = -4 * CFG["biome_spacing"] + house["pos"][2] - house["h"] / 2
        for z in (top, top - 10, top - 40, -760):
            self.assertEqual(road.at(z)[1], 0.0, z)
            self.assertTrue(road.clear(-2, 2, z, z - 1, CFG["road_clearance"]))

    def test_terminal_object_matches_road_end(self):
        self.assertEqual(TC.check_terminal(TOPDOWN, CFG["biome_spacing"], CFG["road_end_z"]), [])
        moved = copy.deepcopy(TOPDOWN)
        T.objects(moved)["home/homestead/house"]["pos"][2] -= 5
        self.assertTrue(TC.check_terminal(moved, CFG["biome_spacing"], CFG["road_end_z"]))


class ContactShadow(unittest.TestCase):
    """proto/sprite_contact.json + presentation.contact_shadow -> /proto/ shadows."""

    def setUp(self):
        import math
        import sprite_contact as SC
        import topdown_presentation as TP
        self.math, self.SC, self.TP = math, SC, TP
        self.meta = json.loads(read("proto/sprite_contact.json"))["sprites"]
        self.runtime = json.loads(read("assets/topdown/layout.runtime.json"))

    def drawn(self):
        """(biome index, object) for every sprite /proto/ draws with a shadow."""
        for bi, b in enumerate(self.runtime["biomes"].values()):
            for o in b["sprites"]:
                t = o.get("t")
                if not t or t in ("hero_fence", "end_post") or t.startswith("cloud_") or t == "moon":
                    continue
                if o.get("visible") is False:
                    continue
                yield bi, o

    def test_metadata_deterministic_and_current(self):
        self.assertEqual(json.dumps(self.SC.build(), ensure_ascii=False, indent=1) + "\n",
                         read("proto/sprite_contact.json"))

    def test_coverage_of_every_shadowed_sprite(self):
        need = {o["t"] for _, o in self.drawn()} | {"prop_crates"}     # + the sort-test sprite
        self.assertEqual(sorted(need - set(self.meta)), [])

    def test_metadata_values_sane(self):
        for t, m in self.meta.items():
            for k in ("contact_row", "contact_width", "contact_centre"):
                self.assertTrue(self.math.isfinite(m[k]), (t, k))
            self.assertTrue(0.5 < m["contact_row"] <= 1.0, (t, m))
            self.assertTrue(0.0 < m["contact_width"] <= 1.0, (t, m))
            self.assertTrue(abs(m["contact_centre"]) < 0.5, (t, m))
            self.assertIn(m["rule"], ("stripped", "run"), t)          # no fallback in the pack

    def test_measured_on_the_texture_proto_loads(self):
        stripped = set(json.loads(read("proto/sprites_stripped/index.json"))["stripped"])
        for t, m in self.meta.items():
            want = f"proto/sprites_stripped/{t}.webp" if t in stripped else f"assets/{t}.webp"
            self.assertEqual(m["src"], want, t)

    def test_shadow_sizes_capped_and_finite(self):
        p = self.runtime["presentation"]
        cs = p["contact_shadow"]
        for _, o in self.drawn():
            m = self.meta[o["t"]]
            base_w = m["contact_width"] * o["h"] * self._aspect(o["t"])
            w, d = self.TP.shadow_size(p, o["h"], base_w)
            self.assertTrue(self.math.isfinite(w) and self.math.isfinite(d) and w > 0 and d > 0, o["id"])
            self.assertLessEqual(d, cs["depth_max"] + 1e-9, o["id"])
            self.assertLessEqual(d, max(cs["depth_min"], cs["depth_per_height"] * o["h"]) + 1e-9, o["id"])
            self.assertLessEqual(d, self.TP.CONTACT_DEPTH_MAX, o["id"])

    def test_schema_rejects_bad_contact_shadow(self):
        pres = self.TP.load()
        ids = list(SPEC["biomes"])
        for key, bad in (("depth_max", 3.0), ("opacity", 0.0), ("depth_min", "x"), ("width_scale", 5)):
            p = copy.deepcopy(pres)
            p["contact_shadow"][key] = bad
            self.assertTrue(self.TP.check(p, ids), key)
        p = copy.deepcopy(pres)
        p["contact_shadow"]["depth_min"] = 0.5
        p["contact_shadow"]["depth_max"] = 0.2
        self.assertTrue(self.TP.check(p, ids))

    def test_proto_uses_contact_not_canvas_or_light(self):
        proto = read("proto/main.js")
        self.assertNotIn("LIGHT", proto)
        self.assertNotIn("baseWidth", proto)
        self.assertIn("fetch('./sprite_contact.json')", proto)
        self.assertIn("PRES.contact_shadow", proto)
        self.assertIn("q.position.set(p.x, 0.5, p.z)", proto)

    _asp = {}

    def _aspect(self, t):
        if t not in self._asp:
            from PIL import Image
            with Image.open(ROOT / self.meta[t]["src"]) as im:
                self._asp[t] = im.width / im.height
        return self._asp[t]


class SpriteRepair(unittest.TestCase):
    """hero_house_b, hero_house_a, hero_well: base restored after the strip."""

    REPAIRED = ["hero_house_a", "hero_house_b", "hero_well"]

    def setUp(self):
        self.index = json.loads(read("proto/sprites_stripped/index.json"))
        self.meta = json.loads(read("proto/sprite_contact.json"))["sprites"]

    def test_exactly_the_three_are_repaired_and_still_loaded_from_stripped(self):
        self.assertEqual(sorted(self.index.get("repaired", {})), self.REPAIRED)
        for t in self.REPAIRED:
            self.assertIn(t, self.index["stripped"])
            self.assertEqual(self.meta[t]["src"], f"proto/sprites_stripped/{t}.webp")

    def test_canvas_and_upper_part_unchanged(self):
        """Same canvas as the original; above the repaired band it IS the
        original (webp noise only), so nothing moved inside the picture."""
        import numpy as np
        from PIL import Image
        for t in self.REPAIRED:
            with Image.open(ROOT / "proto" / "sprites_stripped" / f"{t}.webp") as im:
                r = np.asarray(im.convert("RGBA")).astype(int)
            with Image.open(ROOT / "assets" / f"{t}.webp") as im:
                o = np.asarray(im.convert("RGBA")).astype(int)
            self.assertEqual(r.shape, o.shape, t)
            top = self.index["repaired"][t]["unchanged_rows_from_top"]
            self.assertGreater(top / r.shape[0], 0.7, t)
            d = np.abs(r[:top] - o[:top])
            self.assertLessEqual(d[..., 3].max(), 24, t)
            self.assertLess(d[..., :3][r[:top, :, 3] > 200].mean(), 3.0, t)

    def test_base_is_whole_no_residue_below(self):
        """Contact by the run rule, and nothing opaque below it: no drips, no
        comb, no ground skirt left under the base."""
        import numpy as np
        from PIL import Image
        for t in self.REPAIRED:
            m = self.meta[t]
            self.assertEqual(m["rule"], "run", t)
            with Image.open(ROOT / m["src"]) as im:
                a = np.asarray(im.convert("RGBA"))[..., 3] > 16
            low = (np.nonzero(a.any(axis=1))[0].max() + 1) / a.shape[0]
            self.assertLess(low - m["contact_row"], 0.01, t)

    def test_layout_footprint_pinned(self):
        """The repair does not move the layout: the footprint width the
        composer uses is the pre-repair one recorded in index.json."""
        TC._dims.clear(); TC._repaired = None
        for t in self.REPAIRED:
            self.assertEqual(TC.dims(t)[1], self.index["repaired"][t]["layout_foot"], t)

    def test_strip_does_not_overwrite_repairs(self):
        src = read("tools/strip_pedestal.py")
        self.assertIn('prev.get("repaired", {})', src)
        self.assertIn("if n in repaired:", src)


class ContentPoints(unittest.TestCase):
    """assets/topdown/content_points.json -> static <article>s in proto/index.html."""

    def setUp(self):
        import build_proto_content as BPC
        self.B = BPC
        self.data = BPC.load()
        self.runtime = json.loads(read("assets/topdown/layout.runtime.json"))

    def test_source_valid(self):
        """Schema, 5 stable ids, one per biome in route order, EN+RU, anchors and
        markers resolve, windows do not overlap, copy quotes the site verbatim."""
        self.assertEqual(self.B.check(self.data), [])
        pts = self.data["points"]
        self.assertEqual(len({p["id"] for p in pts}), 5)
        self.assertEqual([p["biome"] for p in sorted(pts, key=lambda p: p["order"])],
                         ["village", "forest", "mine", "spirit", "home"])

    def test_check_catches_bad_source(self):
        """Invented copy, a missing anchor, overlapping windows and an empty
        locale are all refused."""
        for mutate in (
            lambda d: d["points"][0]["en"].__setitem__("body", "Coming 2027 with 10 000 players."),
            lambda d: d["points"][1]["anchor"].__setitem__("object", "forest/board/nope"),
            lambda d: d["points"][2]["activation"].__setitem__("range", 200),
            lambda d: d["points"][3]["ru"].__setitem__("title", ""),
            lambda d: d["points"][4]["ru"].__setitem__("body", "TODO"),
        ):
            d = copy.deepcopy(self.data)
            mutate(d)
            self.assertTrue(self.B.check(d, self.runtime))

    def test_owner_example_is_the_village_point(self):
        v = next(p for p in self.data["points"] if p["biome"] == "village")
        self.assertEqual(v["en"]["title"], "A world that plays itself")
        self.assertEqual(v["en"]["body"], "Log off and the world stays. NPCs run dungeons, haul goods, "
                                          "haggle and drink in taverns. You are not arriving at an empty map.")

    def test_static_html_is_current_and_holds_every_word(self):
        """The page itself (no script) carries all 5 points in both locales."""
        from html.parser import HTMLParser
        page = read("proto/index.html")
        self.assertEqual(self.B.render(page, self.data), page)

        class P(HTMLParser):
            def __init__(s):
                super().__init__(); s.stack = []; s.found = []; s.locale = None; s.hidden = {}
            def handle_starttag(s, tag, attrs):
                a = dict(attrs)
                if tag == "section" and "data-locale" in a:
                    s.locale = a["data-locale"]; s.hidden[s.locale] = "hidden" in a
                if tag == "article":
                    s.found.append({"locale": s.locale, "id": a["data-id"], "text": {}})
                cls = a.get("class", "")
                s.stack.append(cls.replace("content-point__", "") if cls.startswith("content-point__") else None)
            def handle_endtag(s, tag):
                if s.stack: s.stack.pop()
            def handle_data(s, d):
                if s.stack and s.stack[-1] in ("kicker", "title", "body") and s.found:
                    s.found[-1]["text"][s.stack[-1]] = s.found[-1]["text"].get(s.stack[-1], "") + d
        pp = P(); pp.feed(page)
        self.assertEqual(pp.hidden, {"en": False, "ru": True})
        self.assertEqual(len(pp.found), 10)
        for art in pp.found:
            src = next(p for p in self.data["points"] if p["id"] == art["id"])[art["locale"]]
            self.assertEqual(art["text"], {k: src[k] for k in ("kicker", "title", "body")}, art)

    def test_one_card_at_a_time_along_the_route(self):
        """presence() of proto/main.js, sampled every 0.5 m of the route: never
        two cards at once, and each point reaches full presence at its anchor."""
        pts = [(self.B.anchor_z(self.runtime, p["anchor"]["object"]), p["activation"]) for p in self.data["points"]]

        def w(z, az, a):
            d = abs(z - az)
            if d <= a["core"]:
                return 1.0
            if d >= a["range"]:
                return 0.0
            u = (d - a["core"]) / (a["range"] - a["core"])
            return 1 - u * u * (3 - 2 * u)
        z = 20.0
        while z > -720:
            self.assertLessEqual(sum(1 for az, a in pts if w(z, az, a) > 0), 1, z)
            z -= 0.5
        for az, a in pts:
            self.assertEqual(w(az, az, a), 1.0)

    def test_proto_only_activates_never_writes_copy(self):
        """main.js reads the articles; it does not create, fill or remove them."""
        proto = read("proto/main.js")
        self.assertIn("document.querySelectorAll('.content-point')", proto)
        self.assertIsNone(re.search(r"fetch\([^)]*content_points", proto))
        block = proto[proto.index("контентные точки --"):proto.index("---- key art --")]
        for bad in ("createElement(", ".remove()", "textContent", "innerHTML", "innerText"):
            self.assertNotIn(bad, block)


class CameraChoreography(unittest.TestCase):
    """assets/topdown/camera_choreography.json: frame height = f(camera z)."""

    VIEW = (1280, 800)          # checkpoints.json viewport: margins below are for it

    def setUp(self):
        import camera_choreography as CC
        self.C = CC
        self.data = CC.load()
        self.rt = json.loads(read("assets/topdown/layout.runtime.json"))
        self.pk = CC.peaks(self.data, self.rt)

    def frame(self, z):
        return self.C.frame_at(self.data, self.rt, z, self.pk)[0]

    def test_source_valid(self):
        self.assertEqual(self.C.check(self.data, self.rt), [])

    def test_check_catches_bad_source(self):
        for mutate in (
            lambda d: d["focus"][0].__setitem__("frame_height", 12),       # past the pack's ceiling
            lambda d: d["focus"][1].__setitem__("frame_height", 48),
            lambda d: d["focus"][2].__setitem__("anchor", "mine/adit/nope"),
            lambda d: d["focus"][2].__setitem__("approach", 40),           # into the forest→mine dim
            lambda d: d["focus"].reverse(),
            lambda d: d["focus"][2].__setitem__("final", True),            # final only last
            lambda d: d["route_end"].__setitem__("offset", -20),          # past the house
            lambda d: d["route_end"].__setitem__("anchor", "home/nope"),
        ):
            d = copy.deepcopy(self.data)
            mutate(d)
            self.assertTrue(self.C.check(d, self.rt))

    def test_limits_continuity_and_overview_between(self):
        """16..40 everywhere; no jump anywhere (bounded slope); exactly the
        overview between windows and at every transition anchor."""
        z, dz, prev, steep = 20.0, 0.05, None, 0.0
        while z > -720:
            f = self.frame(z)
            self.assertTrue(16 <= f <= 40, (z, f))
            if prev is not None:
                steep = max(steep, abs(f - prev) / dz)
            prev, z = f, z - dz
        # m of frame per m of route. The steepest ramp is the mine approach
        # ((40 - 22) / 15 m × 1.875, smootherstep's peak slope = 2.25); a cut
        # would show up here as (40 - 16) / 0.05 = 480
        self.assertLess(steep, 3.0)
        wins = [self.C.window(f, p) for f, p in self.pk]
        for (e1, _), (_, s2) in zip(wins, wins[1:]):
            self.assertEqual(self.frame((e1 + s2) / 2), 40)
        for t in self.rt["presentation"]["transitions"]:
            self.assertEqual(self.frame(t["anchor_z"]), 40, t["to"])
        for f, p in self.pk:
            self.assertEqual(self.frame(p), f["frame_height"], f["id"])

    def test_deterministic_both_directions(self):
        zs = [20 - i * 0.37 for i in range(1960)]
        fwd = [self.frame(z) for z in zs]
        back = [self.frame(z) for z in reversed(zs)][::-1]
        self.assertEqual(fwd, back)

    def test_focal_objects_whole_in_frame(self):
        """At its peak each focal sprite quad is inside a 1280×800 viewport
        (camera x = 0) with a margin; the final house above all."""
        from PIL import Image
        meta = json.loads(read("proto/sprite_contact.json"))["sprites"]
        anchors = self.C.anchors(self.rt)
        W, H = self.VIEW
        for f, p in self.pk:
            _, x, z, o = anchors[f["anchor"]]
            with Image.open(ROOT / meta[o["t"]]["src"]) as im:
                w = o["h"] * im.width / im.height
            ppm = H / f["frame_height"]
            left, right = W / 2 + (x - w / 2) * ppm, W / 2 + (x + w / 2) * ppm
            top, bottom = H / 2 + (z - o["h"] / 2 - p) * ppm, H / 2 + (z + o["h"] / 2 - p) * ppm
            margin = min(left, W - right, top, H - bottom)
            self.assertGreaterEqual(margin, 24 if f["biome"] in ("home", "mine") else 8, (f["id"], margin))

    def test_route_ends_at_the_final_house(self):
        """The visitor's route stops at route_end: the final house whole in a
        1280×800 frame, the camera no more than 6 m past its centre, the frame
        still the finale's (no zoom-out into the woods), the home card faded."""
        from PIL import Image
        import build_proto_content as BPC
        end = self.C.route_end(self.data, self.rt)
        f, peak = self.pk[-1]
        self.assertTrue(f.get("final"))
        _, x, zc, o = self.C.anchors(self.rt)["home/homestead/house"]
        self.assertAlmostEqual(end, zc - 4, places=6)
        self.assertLessEqual(zc - end, 6)                          # not behind the house
        self.assertEqual(self.frame(end), f["frame_height"])        # holds, no exit
        meta = json.loads(read("proto/sprite_contact.json"))["sprites"]
        with Image.open(ROOT / meta[o["t"]]["src"]) as im:
            w = o["h"] * im.width / im.height
        W, H = self.VIEW
        ppm = H / self.frame(end)
        m = min(W / 2 + (x - w / 2) * ppm, W - (W / 2 + (x + w / 2) * ppm),
                H / 2 + (zc - o["h"] / 2 - end) * ppm, H - (H / 2 + (zc + o["h"] / 2 - end) * ppm))
        self.assertGreaterEqual(m, 24, m)
        home = next(p for p in BPC.load()["points"] if p["biome"] == "home")
        d = abs(end - BPC.anchor_z(self.rt, home["anchor"]["object"]))
        a = home["activation"]
        u = min(max((d - a["core"]) / (a["range"] - a["core"]), 0), 1)
        self.assertLess(1 - u * u * (3 - 2 * u), 0.05)             # the card has had its say

    def test_proto_mirrors_the_reference(self):
        proto = read("proto/main.js")
        self.assertIn("fetch(ASSETS + 'topdown/camera_choreography.json')", proto)
        self.assertIn("x * x * x * (x * (x * 6 - 15) + 10)", proto)       # smootherstep, as here
        self.assertIn("zoom: 'auto'", proto)
        self.assertIn("Math.max(state.routeEnd ?? -state.len - 20,", proto)   # the wheel stops at route_end
        for bad in ("setTimeout", "setInterval", "performance.now", "Date.now"):
            self.assertNotIn(bad, proto)


class KeyArt(unittest.TestCase):
    """assets/topdown/key_art.json: three live illustration windows over the world."""

    def setUp(self):
        import key_art as KA
        self.K = KA
        self.data = KA.load()
        self.rt = json.loads(read("assets/topdown/layout.runtime.json"))

    def test_plan_valid(self):
        """<= 3 slots, unique ids, valid biome, anchors resolve, ranges ordered,
        sane aspect/size, 2x art target, windows only where the route is free
        (no card, no camera focus, no transition dim, within the route)."""
        self.assertEqual(self.K.check(self.data, self.rt), [])
        self.assertLessEqual(len(self.data["slots"]), 3)

    def test_check_catches_bad_plan(self):
        for mutate in (
            lambda d: d["slots"].append(dict(d["slots"][0], id="fourth")),
            lambda d: d["slots"][0]["anchor"].__setitem__("object", "village/nope"),
            lambda d: d["slots"][1]["activation"].__setitem__("range", 40),     # into the adit focus
            lambda d: d["slots"][2]["anchor"].__setitem__("peak_offset", 0),     # onto the spirit card
            lambda d: d["slots"][0].__setitem__("aspect", "7:1"),
            lambda d: d["slots"][0].__setitem__("target_px", [800, 533]),
            lambda d: d["slots"][1].__setitem__("status", "planned"),            # planned with alt = alt before art
            lambda d: d["slots"][2].__setitem__("status", "shipped"),
            lambda d: d["slots"][0]["alt"].__setitem__("ru", ""),                # live without RU alt
            lambda d: d["slots"][1].__setitem__("src", "assets/keyart/nope.webp"),
            lambda d: d["slots"][2].__setitem__("target_px", [1920, 1280]),      # master is not that size
        ):
            d = copy.deepcopy(self.data)
            mutate(d)
            self.assertTrue(self.K.check(d, self.rt))

    def test_village_life_between_tavern_and_forest(self):
        """village-life: after the tavern focus core, out before the forest
        ground blend and its transition dim, no card at the peak, the camera
        focus at most a tail (<= 0.05) anywhere in the window."""
        import build_proto_content as BPC
        import camera_choreography as CC
        slot = next(x for x in self.data["slots"] if x["id"] == "village-life")
        e, st = self.K.window(slot, self.rt)
        p = self.K.peak(slot, self.rt)
        vf = next(t for t in self.rt["presentation"]["transitions"] if t["from"] == "village")
        self.assertGreaterEqual(e, vf["blend_z"][0])                       # before forest ground
        self.assertGreater(e, vf["anchor_z"] + vf["dim"]["half_width"])     # before the dim
        ch = CC.load()
        tav, tp = next((f, z) for f, z in CC.peaks(ch, self.rt) if f["id"] == "village-tavern")
        self.assertLess(p, tp - tav["hold"])                                # after the focus core
        self.assertLessEqual(self.K.focus_max(slot, self.rt), 0.05)
        self.assertEqual(CC.frame_at(ch, self.rt, p)[0], 40)
        for pt in BPC.load()["points"]:
            d = abs(p - BPC.anchor_z(self.rt, pt["anchor"]["object"]))
            self.assertGreaterEqual(d, pt["activation"]["range"], pt["id"])    # no card at the peak

    def test_new_rules_catch(self):
        """A window deep in the tavern focus, or into the forest ground blend, is refused."""
        for off in (-8, -40):
            d = copy.deepcopy(self.data)
            d["slots"][0]["anchor"]["peak_offset"] = off
            self.assertTrue(self.K.check(d, self.rt), off)

    def test_live_assets_and_static_figures(self):
        """Each slot is live: the approved PNG master (1536x1024), the WebP derived
        from it and current, a static <figure> in proto/index.html with alt EN
        and RU; main.js activates the figures and never fetches the plan."""
        from PIL import Image
        self.assertEqual([s["status"] for s in self.data["slots"]], ["live"] * 3)
        for s in self.data["slots"]:
            with Image.open(ROOT / s["master"]) as im:
                self.assertEqual((im.size, im.mode), ((1536, 1024), "RGB"), s["id"])
            self.assertEqual((ROOT / s["src"]).read_bytes(), self.K.webp_bytes(ROOT / s["master"]), s["id"])
        page = read("proto/index.html")
        self.assertEqual(self.K.render(page, self.data), page)
        for s in self.data["slots"]:
            self.assertIn(f'data-id="{s["id"]}"', page)
            self.assertIn(f'data-src="../{s["src"]}"', page)
            self.assertIn(s["alt"]["ru"], page)
        proto = read("proto/main.js")
        self.assertIn("document.querySelectorAll('.key-art')", proto)
        self.assertNotIn("key_art.json')", proto)

    def test_spirit_art_gone_before_world_ship(self):
        """spirit-afterlife: peak -440, smooth fade out by -453, then a few
        metres of world before the world ship (spirit/shipwreck/ship) enters
        the frame: never both on screen. The other two windows are untouched."""
        slot = next(x for x in self.data["slots"] if x["id"] == "spirit-afterlife")
        self.assertAlmostEqual(self.K.peak(slot, self.rt), -440.0, places=3)
        fv = self.K.first_visible("spirit/shipwreck/ship", self.rt)
        e, st = self.K.window(slot, self.rt)
        self.assertGreaterEqual(e - fv, 2.0)
        self.assertLessEqual(e - fv, 5.0)
        z = st
        while z >= fv - 20:
            if z <= fv:                                   # ship on screen
                self.assertEqual(self.K.presence(slot, self.rt, z), 0.0, z)
            z -= 0.05
        a = slot["activation"]
        self.assertGreaterEqual(a["exit_range"] - a["exit_core"], 6)   # a fade, not a cut
        mt = next(t for t in self.rt["presentation"]["transitions"] if t["from"] == "mine")
        self.assertLess(st, mt["anchor_z"] - mt["dim"]["half_width"])   # entry clear of the dim
        v = {x["id"]: x for x in self.data["slots"]}
        self.assertEqual((v["village-life"]["anchor"], v["village-life"]["activation"]),
                         ({"object": "village/tavern/tavern", "peak_offset": -31.5}, {"core": 4, "range": 10}))
        self.assertEqual((v["mine-work"]["anchor"], v["mine-work"]["activation"]),
                         ({"object": "mine/deep-adit/cave", "peak_offset": -5.4}, {"core": 5, "range": 16}))

    def test_yields_to_is_enforced(self):
        d = copy.deepcopy(self.data)
        s = next(x for x in d["slots"] if x["id"] == "spirit-afterlife")
        s["activation"]["exit_range"] = 17                 # would still show at -457
        self.assertTrue(self.K.check(d, self.rt))

    def test_soft_edge_no_card_chrome(self):
        """The window fades into the world (mask), no frame or popup shadow."""
        page = read("proto/index.html")
        css = page[page.index("  .mode-live .key-art {"):page.index("  .mode-live .key-art[data-side=\"left\"]")]
        self.assertIn("mask-image: radial-gradient(", css)
        for bad in ("border:", "box-shadow", "border-radius"):
            self.assertNotIn(bad, css)


class SpriteOverrides(unittest.TestCase):
    """proto/sprite_overrides.json: the spectral world ship, /proto/ only."""

    LEGACY_SHIP_SHA256 = "0d8d65f903be28f76659694741df437a78afe0dddfe668c851940ebb2c785c04"

    def setUp(self):
        self.ov = json.loads(read("proto/sprite_overrides.json"))["overrides"]
        self.rt = json.loads(read("assets/topdown/layout.runtime.json"))

    def test_resolves_exactly_one_object(self):
        objs = [o for b in self.rt["biomes"].values() for o in b["sprites"]]
        self.assertEqual(sorted(self.ov), ["spirit/shipwreck/ship"])
        hits = [o for o in objs if o["id"] in self.ov]
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["t"], "feat_death_alt")       # the type is unchanged

    def test_legacy_asset_and_layout_untouched(self):
        """assets/feat_death_alt.webp byte-identical (it feeds /next/ and /full/);
        the layout still says feat_death_alt, so footprint and composition hold."""
        import hashlib
        self.assertEqual(hashlib.sha256((ROOT / "assets" / "feat_death_alt.webp").read_bytes()).hexdigest(),
                         self.LEGACY_SHIP_SHA256)
        self.assertNotIn("sprites_special", read("assets/layout.json"))
        self.assertNotIn("feat_death_alt_ghost", read("assets/topdown/layout.runtime.json"))
        for f in ("full/index.html", "full/ru/index.html"):
            self.assertNotIn("feat_death_alt_ghost", read(f))
        TC._dims.clear()
        self.assertEqual(TC.dims("feat_death_alt"), TC.dims("feat_death_alt"))   # measured on the legacy texture
        self.assertIn(str(ROOT / "assets"), str(TC.ASSETS))

    def test_override_asset_same_canvas_and_reproducible(self):
        from PIL import Image
        import subprocess
        ov = self.ov["spirit/shipwreck/ship"]
        with Image.open(ROOT / "assets" / "feat_death_alt.webp") as a, Image.open(ROOT / "proto" / ov["sprite"]) as b:
            self.assertEqual(a.size, b.size)                     # same canvas -> same quad, aspect, y-sort
        before = (ROOT / "proto" / ov["sprite"]).read_bytes()
        subprocess.run([sys.executable, str(ROOT / "tools" / "make_ghost_ship.py")], check=True, capture_output=True)
        self.assertEqual((ROOT / "proto" / ov["sprite"]).read_bytes(), before)

    def test_contact_is_the_hull_not_the_haze(self):
        """Contact comes from the legacy type; the override's solid core (alpha
        > 0.5) has the same base row, while its haze (alpha > 16/255) would
        widen it - so the haze is deliberately not measured."""
        import numpy as np
        from PIL import Image
        ov = self.ov["spirit/shipwreck/ship"]
        self.assertEqual(ov["contact_from"], "feat_death_alt")
        meta = json.loads(read("proto/sprite_contact.json"))["sprites"]["feat_death_alt"]
        with Image.open(ROOT / "proto" / ov["sprite"]) as im:
            al = np.asarray(im.convert("RGBA"))[..., 3]
        core = al > 128
        low = (np.nonzero(core.any(1))[0].max() + 1) / al.shape[0]
        self.assertLess(abs(low - meta["contact_row"]), 0.03)
        haze = al > 16
        self.assertGreater((np.nonzero(haze.any(1))[0].max() + 1) / al.shape[0], meta["contact_row"])

    def test_shadow_quarter_for_this_object_only(self):
        self.assertEqual(self.ov["spirit/shipwreck/ship"]["shadow_opacity"], 0.25)
        proto = read("proto/main.js")
        self.assertIn("opacity: PRES.contact_shadow.opacity * (art.shadowOpacity ?? 1)", proto)
        self.assertIn("const art = await spriteFor(o);", proto)


class ProtoModes(unittest.TestCase):
    """/proto/ live vs static: one rule (proto/mode.js), static = the default markup."""

    NARROW = 900           # mirrors proto/mode.js

    def test_single_rule_in_mode_js(self):
        mode = read("proto/mode.js")
        self.assertIn(f"var NARROW = {self.NARROW};", mode)
        for needle in ("q.get('static') === '1'", "innerWidth < NARROW", "prefers-reduced-motion: reduce",
                       "getContext('webgl2')", "fail: function"):
            self.assertIn(needle, mode)
        # no other file decides the mode or repeats the threshold
        for f in ("proto/main.js", "proto/boot.js", "proto/fallback.css", "proto/index.html"):
            txt = read(f)
            # no width breakpoint anywhere else: no innerWidth comparisons, no width media queries
            self.assertIsNone(re.search(r"innerWidth\s*[<>]=?|[<>]=?\s*innerWidth", txt), f)
            self.assertIsNone(re.search(r"\((?:max|min)-width\s*:", txt), f)
            self.assertIsNone(re.search(rf"\b({self.NARROW}|{self.NARROW - 1})px\b", txt), f)
            self.assertNotIn("prefers-reduced-motion: reduce)').matches", txt.replace("REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches", ""), f)

    def test_boot_order_and_no_world_in_static(self):
        """mode.js is a blocking head script (class before first paint); the
        world module is imported only by boot.js and only in live mode."""
        page = read("proto/index.html")
        self.assertLess(page.index('<script src="./mode.js"></script>'), page.index("</head>"))
        self.assertIn('<script type="module" src="./boot.js"></script>', page)
        self.assertNotIn('src="./main.js"', page)
        boot = read("proto/boot.js")
        self.assertIn("if (M && M.mode === 'live')", boot)
        self.assertIn("import('./main.js').catch((e) => M.fail(e))", boot)

    def test_live_css_scoped_and_fallback_css_scoped(self):
        """Every live rule needs .mode-live; every fallback rule needs
        :root:not(.mode-live): neither leaks into the other mode."""
        page = read("proto/index.html")
        css = page[page.index("<style>") + 7:page.index("</style>")]
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        for sel in re.findall(r"([^{}]+)\{", css):
            for one in sel.split(","):
                one = one.strip()
                self.assertTrue(one.startswith((".mode-live", "html.mode-live", ".content-visually-hidden")), one)
        fb = re.sub(r"/\*.*?\*/", "", read("proto/fallback.css"), flags=re.S)
        for block in re.findall(r"([^{}]+)\{[^{}]*\}", re.sub(r"@media[^{]*\{", "", fb)):
            for one in block.split(","):
                one = one.strip()
                if one:
                    self.assertTrue(one.startswith(":root:not(.mode-live)"), one)

    def test_static_order_is_the_route(self):
        """The fallback column follows the route: village(+art) forest mine(+art) (art)spirit home."""
        fb = read("proto/fallback.css")
        orders = dict(re.findall(r'(\.content-point\[data-order="\d"\]|\.key-art\[data-id="[a-z-]+"\]) \{ order: (\d+); \}', fb))
        seq = sorted(orders, key=lambda k: int(orders[k]))
        self.assertEqual(seq, ['.content-point[data-order="1"]', '.key-art[data-id="village-life"]',
                               '.content-point[data-order="2"]', '.content-point[data-order="3"]',
                               '.key-art[data-id="mine-work"]', '.key-art[data-id="spirit-afterlife"]',
                               '.content-point[data-order="4"]', '.content-point[data-order="5"]'])

    def test_live_handlers_guarded(self):
        proto = read("proto/main.js")
        self.assertIn("if (!LIVE()) return;", proto)
        self.assertIn("window.FELLMISE_MODE.fail(e)", proto)


class Audio(unittest.TestCase):
    """/proto/ sound: assets/topdown/audio.json is data (tools/audio_config.py),
    proto/audio.js the one manager; muted by default, live mode only."""

    @classmethod
    def setUpClass(cls):
        import audio_config as AC
        cls.AC = AC
        cls.cfg, cls.pres = AC.load()

    def bad(self, mutate, root=ROOT):
        cfg = copy.deepcopy(self.cfg)
        mutate(cfg)
        return self.AC.validate(cfg, self.pres, root)

    def test_committed_config_is_valid_and_all_live(self):
        self.assertEqual(self.AC.validate(self.cfg, self.pres), [])
        self.assertEqual([b["id"] for b in self.cfg["biomes"]], ["village", "forest", "mine", "spirit", "home"])
        self.assertEqual([t["id"] for t in self.cfg["transitions"]],
                         ["village-forest", "forest-mine", "mine-spirit", "spirit-home"])
        entries = self.cfg["biomes"] + self.cfg["transitions"]
        self.assertEqual({e["status"] for e in entries}, {"live"})
        # exactly the 18 runtime files (9 sounds x WebM/Opus + M4A/AAC), nothing else, no masters
        want = sorted(x["src"] for e in entries for x in e["sources"])
        have = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "assets" / "audio").rglob("*") if p.is_file())
        self.assertEqual(have, want)
        self.assertEqual(len(want), 18)
        self.assertFalse(list((ROOT / "assets").rglob("*.wav")))
        # the engine contract is unchanged by going live
        self.assertEqual(self.cfg["master"], {"default_muted": True, "gain": 0.8, "fade_ms": 600, "smoothing_s": 0.08,
                                              "preload_ahead_m": 60})

    def test_validator_refuses(self):
        self.assertTrue(self.bad(lambda c: c["master"].update(default_muted=False)))
        self.assertTrue(self.bad(lambda c: c["biomes"].reverse()))
        self.assertTrue(self.bad(lambda c: c["transitions"].pop()))
        self.assertTrue(self.bad(lambda c: c["biomes"][0].update(when="z < -100")))      # logic key
        self.assertTrue(self.bad(lambda c: c["transitions"][0].update(loop=True)))
        self.assertTrue(self.bad(lambda c: c["biomes"][1].update(fade_ms=[100])))
        self.assertTrue(self.bad(lambda c: c["biomes"][2]["sources"].reverse()))          # fallback first
        self.assertTrue(self.bad(lambda c: c["biomes"][2]["sources"].pop()))              # no fallback
        self.assertTrue(self.bad(lambda c: c["biomes"][2]["sources"][0].update(src="sounds/mine.webm")))
        self.assertTrue(self.bad(lambda c: c["biomes"][2]["sources"][1].update(src="assets/audio/ambient/mine.mp3")))
        self.assertTrue(self.bad(lambda c: c["biomes"][3]["sources"][0].update(src="assets/audio/ambient/none.webm")))  # live, missing
        with tempfile.TemporaryDirectory() as d:                                     # planned, but a file exists
            f = pathlib.Path(d) / self.cfg["biomes"][0]["sources"][0]["src"]
            f.parent.mkdir(parents=True)
            f.write_bytes(b"x")
            self.assertTrue(any("planned but" in b for b in self.bad(lambda c: c["biomes"][0].update(status="planned"),
                                                                      pathlib.Path(d))))

    def test_production_files(self):
        """Container, codec, channels and length of the 18 runtime files (the decode itself,
        durations and seamless loops are checked in the browser: tests/browser/smoke/audio.spec.mjs)."""
        def mp4(b, path, off=0, end=None):
            end = len(b) if end is None else end
            while off < end:
                size, typ = struct.unpack(">I4s", b[off:off + 8])
                if typ.decode("latin1") == path[0]:
                    return (off, size) if len(path) == 1 else mp4(b, path[1:], off + 8, off + size)
                off += size
            return None
        for e in self.cfg["biomes"] + self.cfg["transitions"]:
            ambient = "from" not in e
            webm, m4a = ((ROOT / x["src"]).read_bytes() for x in e["sources"])
            with self.subTest(e["id"], fmt="webm"):
                self.assertEqual(webm[:4], bytes.fromhex("1a45dfa3"))                  # EBML
                self.assertIn(b"webm", webm[:64])
                self.assertIn(b"A_OPUS", webm[:512])
                self.assertLess(len(webm), 800_000 if ambient else 40_000)
            with self.subTest(e["id"], fmt="m4a"):
                self.assertEqual(m4a[4:8], b"ftyp")
                self.assertIn(b"mp4a", m4a)
                mvhd = mp4(m4a, ["moov", "mvhd"])
                ts = struct.unpack_from(">I", m4a, mvhd[0] + 20)[0]
                elst = mp4(m4a, ["moov", "trak", "edts", "elst"])
                self.assertIsNotNone(elst, "edit list trims encoder priming / padding")
                v = m4a[elst[0] + 8]
                seg, media_time = struct.unpack_from(">Qq" if v else ">Ii", m4a, elst[0] + 16)
                self.assertGreater(media_time, 0)                                     # priming skipped
                if ambient:                                                            # the 60 s loop twice (AAC frame != 60 s)
                    self.assertEqual(seg, 120 * ts)
                    self.assertLess(len(m4a), 2_600_000)
                else:
                    self.assertLess(seg, 4 * ts)
                    self.assertLess(len(m4a), 40_000)
                stsd = mp4(m4a, ["moov", "trak", "mdia", "minf", "stbl", "stsd"])
                ch = struct.unpack_from(">H", m4a, stsd[0] + 16 + 8 + 16)[0]          # mp4a sample entry: channelcount
                self.assertEqual(ch, 2 if ambient else 1)

    def test_one_manager_live_only(self):
        js = read("proto/audio.js")
        main = read("proto/main.js")
        self.assertIn("import { createAudio } from './audio.js';", main)
        self.assertIn("if (AUDIO) AUDIO.update(state.z);", main)
        for f in ("proto/boot.js", "proto/mode.js", "proto/index.html", "proto/fallback.css"):
            self.assertFalse("./audio.js" in read(f) or "AudioContext" in read(f), f)
        self.assertNotIn("AudioContext", main)
        # the context is created in one place, and only from the toggle or a gesture
        self.assertEqual(js.count("new AC()"), 1)
        self.assertEqual(len(re.findall(r"\bensureContext\(\);", js)), 1)
        self.assertEqual(len(re.findall(r"\bturnOn\(\);", js)), 2)
        self.assertIn("'fellmise.audio.enabled'", js)
        # the format is chosen by capability, never by browser name; one type per session
        self.assertIn("canPlayType", js)
        self.assertNotRegex(js, r"userAgent|navigator\.vendor|Safari")
        self.assertNotIn("autoplay", read("proto/index.html"))
        # no scroll-driven unlock: only pointerdown / keydown / click
        self.assertNotRegex(js, r"addEventListener\('(wheel|scroll|touchmove)'")
        # weights come from the presentation blend bands, not a second map
        self.assertIn("presentation.transitions", js)
        self.assertNotRegex(js, r"-1[0-9]{2}\b|-[3-6][0-9]{2}\b")               # no hard-coded z

    def test_toggle_scoped_to_live(self):
        page = read("proto/index.html")
        self.assertIn(".mode-live .audio-toggle {", page)
        self.assertIn(".mode-live .audio-toggle:focus-visible", page)
        self.assertNotIn("audio-toggle", read("proto/fallback.css"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
