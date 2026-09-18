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
import topdown_layout as T    # noqa: E402

SPEC = json.loads(G.SPEC.read_text(encoding="utf-8"))
CFG = G.load_topdown_config()


def build(target, spec=SPEC):
    layout, bad, _ = G.generate(copy.deepcopy(spec), target, CFG if target == "topdown" else None)
    return layout, bad


def ids(layout):
    return list(T.objects(layout))


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


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

    def test_known_violations_match(self):
        """The top-down validator's findings are exactly the known list."""
        new, stale = G.known_split(TOPDOWN_BAD, CFG.get("validator_known_violations", []))
        self.assertEqual(new, [], "новые нарушения top-down")
        self.assertEqual(stale, [], "устаревшие записи в validator_known_violations")

    def test_topdown_scene_equals_legacy_scene(self):
        """Visual invariant: top-down placement is the legacy placement.

        Before this batch /proto/ drew assets/layout.json. Same objects, same
        order, same sprite, position, height, rotation, visibility and every
        other field — only the id differs — so the picture cannot differ."""
        self.assertEqual(list(LEGACY["biomes"]), list(TOPDOWN["biomes"]))
        for bid in LEGACY["biomes"]:
            a, b = LEGACY["biomes"][bid], TOPDOWN["biomes"][bid]
            for kind in ("sprites", "boards"):
                self.assertEqual(len(a[kind]), len(b[kind]), f"{bid}/{kind}")
                for x, y in zip(a[kind], b[kind]):
                    self.assertEqual({k: v for k, v in x.items() if k != "id"},
                                     {k: v for k, v in y.items() if k != "id"})
            ca, cb = a.get("counter"), b.get("counter")
            self.assertEqual(ca and {k: v for k, v in ca.items() if k != "id"},
                             cb and {k: v for k, v in cb.items() if k != "id"})
        da, db = dict(LEGACY["debug"]), dict(TOPDOWN["debug"])
        da.pop("road_half_width"), db.pop("road_half_width")
        self.assertEqual(da, db)


class StableIds(unittest.TestCase):
    def test_unique(self):
        """Every sprite, board and counter id is unique."""
        every = ids(TOPDOWN) + [b["counter"]["id"] for b in TOPDOWN["biomes"].values()
                                if b.get("counter")]
        self.assertEqual(len(every), len(set(every)))
        self.assertTrue(all("#" not in i for i in every), "легаси-id в top-down")

    def test_insert_beat_keeps_other_ids(self):
        """A beat of another kind inserted at the head of the village rhythm
        renames nothing that existed. The legacy scheme does rename: the same
        legacy id now points at a different object — shown here too, so the
        test would notice if it stopped measuring anything."""
        spec = copy.deepcopy(SPEC)
        v = spec["biomes"]["village"]
        v["rhythm"].insert(0, {"z": -5, "side": "R", "lane": "far",
                               "single": "hero_well", "h": "well"})
        for run in v.get("runs", []):
            run["owner_tact"] += 1          # runs point at beats by index
        new, _ = build("topdown", spec)
        # Scatter and end posts are DERIVED from geometry: inserting a beat
        # re-spaces the row, so a scatter candidate may now be refused or a
        # fence end may now butt into a building and need no post. Those
        # objects can legitimately vanish; everything authored must keep its id.
        before = [i for i in ids(TOPDOWN)
                  if "/scatter/" not in i and "/end_post." not in i]
        after = set(ids(new))
        self.assertEqual([i for i in before if i not in after], [])
        self.assertIn("village/hero_well.1", after)

        legacy_new, _ = build("legacy", spec)

        def legacy_to_topdown(leg, top):
            return {x["id"]: y["id"]
                    for bid in leg["biomes"] for kind in ("sprites", "boards")
                    for x, y in zip(leg["biomes"][bid][kind], top["biomes"][bid][kind])}
        old_map = legacy_to_topdown(LEGACY, TOPDOWN)
        new_map = legacy_to_topdown(legacy_new, new)
        self.assertNotEqual(old_map["hero_well#1"], new_map["hero_well#1"])

    def test_group_member_insert_is_contained(self):
        """A member added to one group changes ids only inside containers of
        that group; biomes that do not use it keep every id."""
        spec = copy.deepcopy(SPEC)
        spec["groups"]["grove"]["members"].insert(
            0, {"t": "rock_s", "dx": 3.5, "dz": 2.0, "h": "rock_s"})
        new, _ = build("topdown", spec)
        after = set(ids(new))
        kept = [i for i in ids(TOPDOWN) if "/grove." not in i and "/scatter/" not in i
                and "/end_post." not in i]
        self.assertEqual([i for i in kept if i not in after], [])
        for bid in ("forest", "mine", "spirit"):
            self.assertEqual(ids({"biomes": {bid: TOPDOWN["biomes"][bid]}}),
                             ids({"biomes": {bid: new["biomes"][bid]}}), bid)

    def test_ids_do_not_depend_on_array_position(self):
        """Ids are not array positions: moving an unrelated object to the end of
        its biome's list after generation changes no id, and no id carries the
        legacy global occurrence counter."""
        for i in ids(TOPDOWN):
            self.assertIsNone(re.search(r"#\d+$", i), i)
        shuffled = copy.deepcopy(TOPDOWN)
        s = shuffled["biomes"]["village"]["sprites"]
        s.append(s.pop(0))
        self.assertEqual(sorted(ids(TOPDOWN)), sorted(ids(shuffled)))
        runtime = T.merge(shuffled, T.load_overrides())
        self.assertEqual(sorted(ids(runtime)), sorted(ids(TOPDOWN)))


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
        for rel in ("proto/main.js", "tools/generate_layout.py", "tools/topdown_layout.py"):
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
        self.assertIsNone(re.search(r"ASSETS\s*\+\s*'layout\.json'", proto))


if __name__ == "__main__":
    unittest.main(verbosity=2)
