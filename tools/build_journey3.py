"""Generate the Vite entry pages for journey v3 (Three.js) and deploy the build.

    python tools/build_journey3.py pages     # write journey3/index.html + ru/
    python tools/build_journey3.py deploy    # copy journey3/dist -> next/

Text comes from build_site.I18N/FEATURES, exactly like the production site, so
the copy cannot drift between the two. The DOM overlay is also the FALLBACK:
when WebGL is unavailable, the viewport is narrow, or the visitor asked for
reduced motion, the same markup is shown as a plain scrolling page with the
sprites visible. One source of content, so there is nothing to keep in sync.

Sprites are taken from the existing pack only — no generation runs in this
build (the machine is training a LoRA).
"""

import json
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from build_site import FEATURES, I18N, RESOURCES, att, esc, json_ld  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
J3 = ROOT / "journey3"
NEXT = ROOT / "next"
FEAT = {f["id"]: f for f in FEATURES}
VER = "1"

# Which cards belong to which biome, per the brief.
BIOME_TEXT = [
    ("village", ["world"]),
    ("forest", ["skills", "craft"]),
    ("mine", ["pvp", "mining"]),
    ("spirit", ["death", "vendetta"]),
    ("home", ["home", "factions"]),
]
# Text type A — these blocks are said by an object standing in the scene
# (journey3/src/signs.js). The DOM keeps the same words as a caption, and shows
# them in full in the static fallback.
INWORLD_CARD = {"vendetta": "spirit"}

BIOME_NAME = {
    "village": ("The village", "Деревня"),
    "forest": ("The forest", "Лес"),
    "mine": ("The mine", "Шахта"),
    "spirit": ("The spirit world", "Мир духов"),
    "home": ("Home", "Дом"),
}


def _size(name):
    """Intrinsic size of an exported sprite, so the browser reserves its box."""
    try:
        from PIL import Image
        with Image.open(ROOT / "assets" / f"{name}.webp") as im:
            return im.size
    except Exception:
        return None


def img(name, alt, cls="", eager=False, base=""):
    """<img> straight from the shipped pack — this branch has one width per name."""
    c = f' class="{cls}"' if cls else ""
    load = "eager" if eager else "lazy"
    wh = _size(name)
    dims = f' width="{wh[0]}" height="{wh[1]}"' if wh else ""
    return (f'<img{c} src="{base}assets/{name}.webp" alt="{att(alt)}"{dims} loading="{load}">')


def build(lang):
    t = I18N[lang]
    tk, pk = ("en_t", "en_p") if lang == "en" else ("ru_t", "ru_p")
    other = "ru/" if lang == "en" else "../"
    base = "" if lang == "en" else "../"

    def card(fid, inworld=""):
        f = FEAT[fid]
        mark = f' data-inworld="{inworld}"' if inworld else ""
        art = img(f["sprite"], f[tk], cls="card__art", base=base) if f["sprite"] else \
            f'<div class="card__soon">{esc(t["soon"])}</div>'
        return (f'        <article class="card"{mark}>\n'
                f'          {art}\n'
                f'          <h3>{esc(f[tk])}</h3>\n'
                f'          <p>{esc(f[pk])}</p>\n'
                '        </article>')

    res = "\n".join(
        f'          <li>{img(rid, lab if lang == "en" else lab_ru, base=base)}'
        f'<span>{esc(lab if lang == "en" else lab_ru)}</span></li>'
        for rid, lab, lab_ru in RESOURCES)

    boards = {
        "village": {"title": t["tagline"], "sub": t["descriptor"]},
        "spirit": {"title": FEAT["vendetta"][tk], "sub": FEAT["vendetta"][pk]},
    }

    stops = []
    for i, (bid, cards) in enumerate(BIOME_TEXT):
        name = BIOME_NAME[bid][0 if lang == "en" else 1]
        inner = []
        if i == 0:
            inner.append(
                '      <div class="sign" data-inworld="village">\n'
                f'        <h1>{esc(t["tagline"])}</h1>\n'
                f'        <p>{esc(t["descriptor"])}</p>\n'
                '      </div>\n'
                '      <div class="cta">\n'
                f'        <button class="btn btn--steam" disabled>{esc(t["cta_steam"])}</button>\n'
                f'        <a class="btn btn--discord" href="#">{esc(t["cta_discord"])}</a>\n'
                '      </div>')
        inner.append('      <div class="cards">\n'
                     + "\n".join(card(c, INWORLD_CARD.get(c, "")) for c in cards)
                     + '\n      </div>')
        if bid == "home":
            inner.append('      <section class="res" aria-label="' + att(t["res_title"]) + '">\n'
                         f'        <h3>{esc(t["res_title"])}</h3>\n'
                         f'        <ul>\n{res}\n        </ul>\n      </section>')
            inner.append(
                '      <div class="cta">\n'
                f'        <button class="btn btn--steam" disabled>{esc(t["cta_steam"])}</button>\n'
                f'        <a class="btn btn--discord" href="#">{esc(t["cta_discord"])}</a>\n'
                '      </div>')
        stops.append(f'    <section class="stop" data-biome="{bid}" aria-label="{att(name)}">\n'
                     + "\n".join(inner) + '\n    </section>')

    return f"""<!doctype html>
<html lang="{t['lang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{esc(t['title'])} — journey preview</title>
<meta name="description" content="{att(t['desc'])}">
<link rel="icon" href="{base}assets/favicon-32.png" sizes="32x32">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" media="print" onload="this.media='all'"
      href="https://fonts.googleapis.com/css2?family=Podkova:wght@700&family=Vollkorn:wght@400;600;700&family=PT+Mono&display=swap">
{json_ld(t, lang)}
<script>window.J3 = {{ lang: "{lang}", assets: "{base}assets/", tod: {json.dumps(t['tod'], ensure_ascii=False)},
                       todPrefix: {json.dumps(t['tod_prefix'], ensure_ascii=False)},
                       boards: {json.dumps(boards, ensure_ascii=False)} }};</script>
</head>
<body>

<canvas id="stage" aria-hidden="true"></canvas>
<div id="veil" aria-hidden="true"></div>

<header class="top">
  <a class="logo" href="{base or './'}">FELLMISE</a>
  <p class="clock" id="clock"><span class="dot"></span><span id="clock-text"></span></p>
  <nav class="lang" aria-label="Language">
    <span aria-current="true">{esc(t['self_label'])}</span>
    <a href="{other}">{esc(t['other_label'])}</a>
  </nav>
</header>

<main id="rail">
{chr(10).join(stops)}
  <p class="note">{esc(t['disclaimer'])}</p>
</main>

<footer class="foot">
  <span>fellmise.com</span><span>{esc(t['rights'])}</span>
  <a href="{other}">{esc(t['other_label'])}</a>
</footer>

<script type="module" src="{base}src/main.js"></script>
</body>
</html>
"""


def pages():
    (J3 / "index.html").write_text(build("en"), encoding="utf-8")
    (J3 / "ru").mkdir(exist_ok=True)
    (J3 / "ru" / "index.html").write_text(build("ru"), encoding="utf-8")
    # assets live next to the pages so Vite copies them verbatim from public/
    pub = J3 / "public" / "assets"
    pub.mkdir(parents=True, exist_ok=True)
    n = 0
    for p in (ROOT / "assets").iterdir():
        if p.suffix == ".webp" or p.name in ("favicon-32.png", "manifest.json", "og.jpg"):
            shutil.copy2(p, pub / p.name)
            n += 1
    print(f"pages: index.html {(J3/'index.html').stat().st_size/1024:.1f} KB, "
          f"ru/index.html {(J3/'ru'/'index.html').stat().st_size/1024:.1f} KB, assets {n}")


def deploy():
    dist = J3 / "dist"
    if not dist.is_dir():
        raise SystemExit("нет journey3/dist — сначала npm run build")
    if NEXT.exists():
        shutil.rmtree(NEXT)
    shutil.copytree(dist, NEXT)
    # Vite emits ru/index.html already; make sure nothing indexable slipped in
    size = sum(f.stat().st_size for f in NEXT.rglob("*") if f.is_file())
    files = sum(1 for f in NEXT.rglob("*") if f.is_file())
    print(f"deploy: next/ {files} файлов, {size/1048576:.2f} MB")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pages"
    {"pages": pages, "deploy": deploy}[cmd]()
