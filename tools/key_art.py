"""Key art slots of /proto/ (planning): assets/topdown/key_art.json.

    python tools/key_art.py            # check + print the slot timeline
    python tools/key_art.py --check    # fail on an invalid plan

A slot is a DOM illustration window over the world, anchored to a stable
layout object. Its window (peak ± range of camera z) must sit where the route
is free: no content card visible, no camera focus, no biome transition dim.
Nothing here is drawn in production; /proto/?debug=keyart shows placeholders.
"""

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import build_proto_content as BPC  # noqa: E402
import camera_choreography as CC   # noqa: E402

SRC = ROOT / "assets" / "topdown" / "key_art.json"
VIEW = (1280, 800)
BIOMES = ["village", "forest", "mine", "spirit", "home"]


def load(path=SRC):
    return json.loads(path.read_text(encoding="utf-8"))


def peak(slot, rt):
    return CC.anchors(rt)[slot["anchor"]["object"]][2] + slot["anchor"].get("peak_offset", 0)


def window(slot, rt):
    """(z_end, z_start): where the slot is on screen at all (presence > 0)."""
    p = peak(slot, rt)
    return p - slot["activation"]["range"], p + slot["activation"]["range"]


def aspect(slot):
    a, b = (int(x) for x in slot["aspect"].split(":"))
    return a / b


def display_px(slot):
    w = slot["display"]["width"]
    return w, round(w / aspect(slot))


def busy(rt):
    """Route spans already taken: (z_start, z_end, what)."""
    ch, cp = CC.load(), BPC.load()
    out = []
    for f, p in CC.peaks(ch, rt):
        e, s = CC.window(f, p, CC.route_end(ch, rt))
        out.append((s, e, "camera focus " + f["id"]))
    for p in cp["points"]:
        z = BPC.anchor_z(rt, p["anchor"]["object"])
        out.append((z + p["activation"]["range"], z - p["activation"]["range"], "content card " + p["id"]))
    for t in rt["presentation"]["transitions"]:
        hw = t["dim"]["half_width"]
        out.append((t["anchor_z"] + hw, t["anchor_z"] - hw, f"transition {t['from']}->{t['to']}"))
    return out


def check(data, rt=None):
    rt = rt or CC.runtime()
    bad = []
    slots = data.get("slots", [])
    a = CC.anchors(rt)
    if not 1 <= len(slots) <= 3:
        bad.append(f"слотов {len(slots)}: нужно 1..3")
    ids = [s.get("id") for s in slots]
    if len(ids) != len(set(ids)):
        bad.append("повторяющиеся id")
    for s in slots:
        sid = s.get("id", "?")
        if s.get("status") != "planned":
            bad.append(f"{sid}: status {s.get('status')} (в планировании только planned)")
        if s.get("biome") not in BIOMES:
            bad.append(f"{sid}: biome {s.get('biome')}")
        obj = s.get("anchor", {}).get("object")
        if obj not in a:
            bad.append(f"{sid}: якоря {obj} нет в layout")
            continue
        if a[obj][0] != s.get("biome"):
            bad.append(f"{sid}: якорь не в биоме {s.get('biome')}")
        if s.get("side") not in ("left", "right"):
            bad.append(f"{sid}: side {s.get('side')}")
        act = s.get("activation", {})
        if not (isinstance(act.get("core"), (int, float)) and isinstance(act.get("range"), (int, float))
                and 0 < act["core"] < act["range"] <= 40):
            bad.append(f"{sid}: activation {act}")
        if not re.fullmatch(r"\d+:\d+", str(s.get("aspect", ""))) or not 0.6 <= aspect(s) <= 2.0:
            bad.append(f"{sid}: aspect {s.get('aspect')}")
            continue
        w, h = display_px(s)
        if not (280 <= w <= 560 and h <= 0.6 * VIEW[1]):
            bad.append(f"{sid}: display {w}×{h} вне 280..560 px ширины / 60% высоты кадра")
        tw, th = s.get("target_px", [0, 0])
        if tw < 2 * w or th < 2 * h or abs(tw / th - aspect(s)) > 0.01:
            bad.append(f"{sid}: target_px {tw}×{th} меньше 2× display или не в {s['aspect']}")
        if s.get("alt", {}).get("en") or s.get("alt", {}).get("ru"):
            bad.append(f"{sid}: alt написан до арта")
        if s.get("supports", {}).get("content_point") not in {p["id"] for p in BPC.load()["points"]}:
            bad.append(f"{sid}: supports.content_point не найден")
    if bad:
        return bad
    end = CC.route_end(CC.load(), rt)
    wins = sorted(((window(s, rt), s) for s in slots), key=lambda t: -t[0][1])
    if [s["id"] for _, s in wins] != ids:
        bad.append("слоты не в порядке маршрута")
    for ((e1, _), s1), ((_, s2), t2) in zip(wins, wins[1:]):
        if s2 >= e1:
            bad.append(f"{s1['id']} и {t2['id']} перекрываются")
    for (e, s), slot in wins:
        if e < end:
            bad.append(f"{slot['id']}: окно заходит за конец маршрута")
        for bs, be, what in busy(rt):
            if e < bs and s > be:
                bad.append(f"{slot['id']}: окно {s:.0f}..{e:.0f} пересекается с «{what}» ({bs:.0f}..{be:.0f})")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    data, rt = load(), CC.runtime()
    bad = check(data, rt)
    if bad:
        print("key_art.json — ошибки:")
        for b in bad:
            print("  " + b)
        sys.exit(1)
    if args.check:
        print("актуален: assets/topdown/key_art.json (планирование)")
        return
    for s in data["slots"]:
        e, st = window(s, rt)
        p = peak(s, rt)
        w, h = display_px(s)
        print(f"{s['id']:17} {s['biome']:8} enter {st:7.1f}  peak {p:7.1f} (±{s['activation']['core']})  "
              f"exit {e:7.1f}  {s['side']:5} {s['aspect']} {w}×{h} css  target {s['target_px'][0]}×{s['target_px'][1]}")


if __name__ == "__main__":
    main()
