"""Camera choreography of /proto/: assets/topdown/camera_choreography.json.

    python tools/camera_choreography.py            # check + print the route profile
    python tools/camera_choreography.py --check    # fail on an invalid source

The frame height of the camera is a pure function of camera z (see the JSON's
_doc). This module is the reference implementation proto/main.js mirrors
(`frameAt`), and the validator the tests run: anchors exist, focus points in
route order, 16 <= frame <= 40, windows do not overlap each other nor a biome
transition's dim band, overview is reached between windows.
"""

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "topdown" / "camera_choreography.json"
RUNTIME = ROOT / "assets" / "topdown" / "layout.runtime.json"
BIOMES = ["village", "forest", "mine", "spirit", "home"]


def load(path=SRC):
    return json.loads(path.read_text(encoding="utf-8"))


def runtime():
    return json.loads(RUNTIME.read_text(encoding="utf-8"))


def anchors(rt):
    out = {}
    for bi, (bid, b) in enumerate(rt["biomes"].items()):
        for o in b["sprites"] + b.get("boards", []):
            out[o["id"]] = (bid, o["pos"][0], -bi * rt["biome_spacing"] + o["pos"][2], o)
    return out


def smootherstep(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * t * (t * (t * 6 - 15) + 10)


def peaks(data, rt):
    a = anchors(rt)
    return [(f, a[f["anchor"]][2] + f.get("peak_offset", 0)) for f in data["focus"]]


def weight(f, peak, z):
    """0..1 presence of one focus at camera z (route runs toward smaller z)."""
    d = z - peak
    if abs(d) <= f["hold"]:
        return 1.0
    if d > 0:                                   # before the peak: approach
        return smootherstep(1 - (d - f["hold"]) / f["approach"])
    return smootherstep(1 - (-d - f["hold"]) / f["exit"])


def window(f, peak):
    """[z_end, z_start] of the focus window (z_end < z_start)."""
    return peak - f["hold"] - f["exit"], peak + f["hold"] + f["approach"]


def frame_at(data, rt, z, _pk=None):
    """(frame height, focus id or None, weight) at camera z."""
    best, fid = 0.0, None
    for f, p in (_pk or peaks(data, rt)):
        w = weight(f, p, z)
        if w > best:
            best, fid = w, f["id"]
    frame = data["overview"] - (data["overview"] - _frame_of(data, fid)) * best if fid else data["overview"]
    return frame, fid, best


def _frame_of(data, fid):
    return next(f["frame_height"] for f in data["focus"] if f["id"] == fid)


def check(data, rt=None):
    rt = rt or runtime()
    bad = []
    a = anchors(rt)
    ov, cl = data.get("overview"), data.get("close")
    if (ov, cl) != (40, 16):
        bad.append(f"overview/close {ov}/{cl}: пределы кадра — 40 и 16 м")
    ids = [f.get("id") for f in data.get("focus", [])]
    if len(ids) != len(set(ids)):
        bad.append("повторяющиеся id")
    for f in data.get("focus", []):
        fid = f.get("id", "?")
        if f.get("anchor") not in a:
            bad.append(f"{fid}: якоря {f.get('anchor')} нет в layout")
            continue
        if a[f["anchor"]][0] != f.get("biome"):
            bad.append(f"{fid}: якорь стоит не в биоме {f.get('biome')}")
        if not (isinstance(f.get("frame_height"), (int, float)) and cl <= f["frame_height"] <= ov):
            bad.append(f"{fid}: frame_height {f.get('frame_height')} вне {cl}..{ov}")
        for k in ("approach", "hold", "exit"):
            if not (isinstance(f.get(k), (int, float)) and f[k] >= (0 if k == "hold" else 4)):
                bad.append(f"{fid}: {k} {f.get(k)}")
    if bad:
        return bad
    if [f["biome"] for f in data["focus"]] != BIOMES:
        bad.append("нужно по одному фокусу на биом, в порядке маршрута")
    pk = peaks(data, rt)
    if [p for _, p in pk] != sorted((p for _, p in pk), reverse=True):
        bad.append("фокусы не в порядке маршрута (z убывает)")
    wins = [window(f, p) for f, p in pk]
    for (e1, _), (_, s2), (f1, _), (f2, _) in zip(wins, wins[1:], pk, pk[1:]):
        if s2 >= e1:
            bad.append(f"окна {f1['id']} и {f2['id']} перекрываются: между ними нет обзора")
    for t in rt["presentation"]["transitions"]:
        lo, hi = t["anchor_z"] - t["dim"]["half_width"], t["anchor_z"] + t["dim"]["half_width"]
        for (f, p), (e, s) in zip(pk, wins):
            if e < hi and s > lo:
                bad.append(f"{f['id']}: окно {e:.0f}..{s:.0f} заходит в затемнение перехода "
                           f"{t['from']}→{t['to']} ({lo:.0f}..{hi:.0f})")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    data, rt = load(), runtime()
    bad = check(data, rt)
    if bad:
        print("camera_choreography.json — ошибки:")
        for b in bad:
            print("  " + b)
        sys.exit(1)
    if args.check:
        print("актуален: assets/topdown/camera_choreography.json")
        return
    for f, p in peaks(data, rt):
        e, s = window(f, p)
        print(f"{f['id']:18} peak z {p:7.1f}  frame {f['frame_height']:>4} m  window {s:.0f}..{e:.0f}")


if __name__ == "__main__":
    main()
