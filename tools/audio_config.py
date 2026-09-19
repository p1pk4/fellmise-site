"""Validate assets/topdown/audio.json — the asset contract of the /proto/ sound.

    python tools/audio_config.py --check      # CI: exit 1 on any problem

The file is data only (proto/audio.js holds the rules). Checked here:
  * master: muted by default, gains and fades in range, preload distance;
  * biomes: exactly the presentation biomes of layout.runtime.json, in route
    order (no second biome map: the engine takes the blend bands from there);
  * transitions: exactly the presentation transitions (from/to, id from-to);
  * every entry: id, sources [{src, type}] under assets/audio/ (WebM/Opus then
    M4A/AAC, extension matching the type), status planned|live, loop,
    gain 0..1, fade_ms [in, out], notes; no logic keys;
  * status live => every source file is committed; planned => nothing is requested,
    so a planned file must NOT be committed (no placeholder sounds in main).
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / "assets" / "topdown" / "audio.json"
LAYOUT = ROOT / "assets" / "topdown" / "layout.runtime.json"
# source types in preference order, with the file extension each must carry
TYPES = {"audio/webm; codecs=opus": ".webm", "audio/mp4; codecs=mp4a.40.2": ".m4a"}
ENTRY_KEYS = {"id", "sources", "status", "loop", "gain", "fade_ms", "notes"}
MASTER_KEYS = {"default_muted", "gain", "fade_ms", "smoothing_s", "preload_ahead_m"}


def validate(cfg, presentation, root=ROOT):
    bad = []
    m = cfg.get("master", {})
    if set(m) != MASTER_KEYS:
        bad.append(f"master: keys {sorted(m)} != {sorted(MASTER_KEYS)}")
    if m.get("default_muted") is not True:
        bad.append("master.default_muted must be true (no sound before the visitor asks)")
    if not (0 < m.get("gain", -1) <= 1):
        bad.append("master.gain must be in (0, 1]")
    if not (0 <= m.get("fade_ms", -1) <= 3000):
        bad.append("master.fade_ms must be in [0, 3000]")
    if not (0 < m.get("smoothing_s", -1) <= 1):
        bad.append("master.smoothing_s must be in (0, 1]")
    if not (0 <= m.get("preload_ahead_m", -1) <= 150):
        bad.append("master.preload_ahead_m must be in [0, 150]")

    def entry(kind, e, loop):
        where = f"{kind} {e.get('id')}"
        extra = set(e) - ENTRY_KEYS - ({"from", "to"} if kind == "transition" else set())
        missing = ENTRY_KEYS - set(e)
        if missing:
            bad.append(f"{where}: missing {sorted(missing)}")
        if extra:
            bad.append(f"{where}: unexpected keys {sorted(extra)} (data only, no logic)")
        src = e.get("sources")
        if not (isinstance(src, list) and src and all(isinstance(x, dict) and set(x) == {"src", "type"} for x in src)):
            bad.append(f"{where}: sources must be a non-empty list of {{src, type}}")
            src = []
        types = [x["type"] for x in src]
        if types != list(TYPES)[:len(types)] or len(types) != len(TYPES):
            bad.append(f"{where}: sources must be {list(TYPES)} in this order (primary, then fallback)")
        for x in src:
            want = TYPES.get(x["type"], "?")
            if not (x["src"].startswith("assets/audio/") and x["src"].endswith(want)):
                bad.append(f"{where}: {x['src']!r} must be assets/audio/*{want} for {x['type']!r}")
        if e.get("status") not in ("planned", "live"):
            bad.append(f"{where}: status must be planned|live")
        exists = [(root / x["src"]).is_file() for x in src]
        if e.get("status") == "live" and not all(exists):
            bad.append(f"{where}: live but not every source is committed")
        if e.get("status") == "planned" and any(exists):
            bad.append(f"{where}: planned but a source file exists (no placeholder sounds; mark it live)")
        if e.get("loop") is not loop:
            bad.append(f"{where}: loop must be {str(loop).lower()}")
        if not (isinstance(e.get("gain"), (int, float)) and 0 < e["gain"] <= 1):
            bad.append(f"{where}: gain must be in (0, 1]")
        f = e.get("fade_ms")
        if not (isinstance(f, list) and len(f) == 2 and all(isinstance(x, (int, float)) and 0 <= x <= 5000 for x in f)):
            bad.append(f"{where}: fade_ms must be [in, out] in 0..5000 ms")
        if not str(e.get("notes", "")).strip():
            bad.append(f"{where}: notes are empty")

    order = [b["id"] for b in presentation["biomes"]]
    got = [b.get("id") for b in cfg.get("biomes", [])]
    if got != order:
        bad.append(f"biomes {got} != presentation order {order}")
    for b in cfg.get("biomes", []):
        entry("biome", b, True)

    want = [(t["from"], t["to"]) for t in presentation["transitions"]]
    got = [(t.get("from"), t.get("to")) for t in cfg.get("transitions", [])]
    if got != want:
        bad.append(f"transitions {got} != presentation transitions {want}")
    for t in cfg.get("transitions", []):
        if t.get("id") != f"{t.get('from')}-{t.get('to')}":
            bad.append(f"transition {t.get('id')}: id must be from-to")
        entry("transition", t, False)
    return bad


def load():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    presentation = json.loads(LAYOUT.read_text(encoding="utf-8"))["presentation"]
    return cfg, presentation


def main(argv):
    cfg, presentation = load()
    bad = validate(cfg, presentation)
    for b in bad:
        print("audio.json:", b)
    if bad:
        return 1
    live = [e["id"] for e in cfg["biomes"] + cfg["transitions"] if e["status"] == "live"]
    print(f"audio.json ok: {len(cfg['biomes'])} ambients, {len(cfg['transitions'])} transition SFX, {len(TYPES)} formats each, "
          f"live: {', '.join(live) or 'none (all planned)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
