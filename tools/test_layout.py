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


if __name__ == "__main__":
    unittest.main(verbosity=2)
