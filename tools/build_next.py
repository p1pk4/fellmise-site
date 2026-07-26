"""Build the PixiJS journey into next/ — a self-contained preview build.

    python tools/build_next.py

Layout of the hybrid:

    <canvas id="stage">   fixed, full-screen, BEHIND everything — Pixi draws the
                          biome scenes here
    <div id="dom">        normal document flow: header, per-biome sections with
                          the copy and cards, footer. All text lives in the DOM,
                          so SEO and i18n are unaffected by the renderer.

Every section also carries its sprites as ordinary <img> inside .sec__scene.
When Pixi is running those are hidden (the canvas draws them instead); when it
is not — phone, reduced motion, no WebGL — they are shown and the page is the
static version. One source of content, so the fallback cannot drift.

next/ is self-contained (its own assets and vendor copies) and carries
robots: noindex, so promoting it to the root later is a copy, and until then it
cannot compete with the live site in search.

WebP only in next/: the PNG fallbacks are 18 MB and exist for browsers that
predate universal WebP support, which is not a population worth duplicating the
whole pack for in a preview build.
"""

import json
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from biomes import BIOMES, ROWS  # noqa: E402
from build_site import FEATURES, I18N, RESOURCES, att, esc, manifest  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
NEXT = ROOT / "next"
FEAT_BY_ID = {f["id"]: f for f in FEATURES}

# ground tile + sky per biome, mirrored from styles.css
LOOK = {
    "village": dict(tile="tile_grass", ground=0xA8CB53, sky=[0x7EB8E0, 0xC7E6F2], road="tile_road"),
    "forest":  dict(tile="tile_grass", ground=0x6B8F43, sky=[0x8FBCD6, 0xCFE4D6]),
    "mine":    dict(tile="tile_dirt",  ground=0x3D3A45, sky=[0x221F2A, 0x3A3542], dark=True),
    "spirit":  dict(tile="tile_spirit", ground=0x1E3D3D, sky=[0x10222A, 0x21454A], dark=True),
    "home":    dict(tile="tile_grass", ground=0xA8CB53, sky=[0xE78B4A, 0xF4C98A], dusk=True),
}

# where the camera aims when falling through each gate, as a share of the frame
GATE_FOCUS = {
    "village": dict(art="hero_house_b", door=True, fx=0.47, fy=0.80, warm=0xFFBE6E),
    "forest":  dict(art="biome_orevein", fx=0.50, fy=0.52, warm=0x96D2FF),
    "mine":    dict(art="biome_portal", fx=0.50, fy=0.46, warm=0x78FFE8),
    "spirit":  dict(art="feat_death", door=True, fx=0.56, fy=0.36, warm=0xFFD696),
}

PARTICLES = {
    "village": [dict(kind="smoke", n=5, box=[0.16, 0.20, 0.26, 0.30]),
                dict(kind="smoke", n=5, box=[0.60, 0.16, 0.70, 0.26])],
    "forest":  [dict(kind="fly", n=14, box=[0.05, 0.35, 0.95, 0.80])],
    "mine":    [dict(kind="flame", n=26, box=[0.235, 0.80, 0.265, 0.84]),
                dict(kind="spark", n=10, box=[0.22, 0.62, 0.30, 0.80])],
    "spirit":  [dict(kind="soul", n=10, box=[0.08, 0.30, 0.94, 0.82])],
    "home":    [dict(kind="smoke", n=4, box=[0.14, 0.20, 0.24, 0.30])],
}


def scene_spec():
    """Everything the renderer needs, as data — the engine stays generic."""
    out = {"rows": ROWS, "biomes": [], "gates": []}
    for b in BIOMES:
        look = LOOK[b["id"]]
        out["biomes"].append({
            "id": b["id"],
            "look": look,
            "particles": PARTICLES.get(b["id"], []),
            "sprites": [
                {"name": name, "row": row, "h": base_h, "iso": iso,
                 "x": None, "cls": cls}
                for cls, name, row, base_h, hide, iso in b["sprites"]
            ],
        })
        if b.get("gate"):
            g = dict(GATE_FOCUS[b["id"]])
            g["from"] = b["id"]
            out["gates"].append(g)
    # horizontal placement, kept here so the engine has no per-biome knowledge
    X = {
        "village": [0.14, 0.33, 0.455, 0.66, 0.86, 0.79, 0.50, 0.07, 0.38],
        "forest": [0.16, 0.40, 0.72, 0.46],
        "mine": [0.16, 0.72, 0.44, 0.28],
        "spirit": [0.13, 0.30, 0.48, 0.75, 0.62],
        "home": [0.18, 0.42, 0.66, 0.47],
    }
    for bi, b in enumerate(out["biomes"]):
        xs = X[b["id"]]
        for i, sp in enumerate(b["sprites"]):
            sp["x"] = xs[i] if i < len(xs) else 0.5
    return out


def pic_img(a, name, alt, cls="", loading="lazy"):
    """Plain <img> with a WebP srcset — next/ ships no PNG fallbacks."""
    m = manifest().get(name)
    c = f' class="{cls}"' if cls else ""
    if not m:
        return f'<img{c} src="{a}{name}.webp" alt="{att(alt)}" loading="{loading}" decoding="async">'
    srcset = ", ".join(f"{a}{name}-{w}.webp {w}w" for w in m["w"])
    return (f'<img{c} src="{a}{name}-{m["w"][-1]}.webp" srcset="{srcset}" '
            f'sizes="(max-width: 760px) 46vw, 34vw" alt="{att(alt)}" '
            f'width="{m["width"]}" height="{m["height"]}" '
            f'loading="{loading}" decoding="async">')


def build(lang):
    t = I18N[lang]
    a = "assets/" if lang == "en" else "../assets/"
    root = "" if lang == "en" else "../"
    tk, pk = ("en_t", "en_p") if lang == "en" else ("ru_t", "ru_p")

    def card(fid):
        f = FEAT_BY_ID[fid]
        if f["sprite"]:
            art = pic_img(a, f["sprite"], f[tk], cls="card__art")
            if f.get("extra"):
                art += pic_img(a, f["extra"], "", cls="card__art card__art--corner")
        else:
            art = (f'<div class="card__art card__art--soon" role="img" '
                   f'aria-label="{att(t["soon"])}"><span>{esc(t["soon"])}</span></div>')
        return ('        <article class="card" id="f-' + f["id"] + '">\n'
                '          <div class="card__roof" aria-hidden="true"></div>\n'
                '          <div class="card__body">\n'
                '            ' + art + '\n'
                '            <h3 class="card__title">' + esc(f[tk]) + '</h3>\n'
                '            <p class="card__text">' + esc(f[pk]) + '</p>\n'
                '          </div>\n'
                '        </article>')

    resources = (
        '        <section class="resources" aria-labelledby="res-h">\n'
        '          <h3 class="resources__title" id="res-h">' + esc(t["res_title"]) + '</h3>\n'
        '          <ul class="resources__strip">\n'
        + "\n".join(
            '            <li class="res"><figure>'
            + pic_img(a, rid, lab if lang == "en" else lab_ru)
            + '<figcaption>' + esc(lab if lang == "en" else lab_ru) + '</figcaption></figure></li>'
            for rid, lab, lab_ru in RESOURCES)
        + '\n          </ul>\n        </section>')

    cta = ('      <div class="cta">\n'
           '        <button class="btn btn--steam" disabled>' + esc(t["cta_steam"]) + '</button>\n'
           '        <a class="btn btn--discord" href="#">' + esc(t["cta_discord"]) + '</a>\n'
           '      </div>')

    secs = []
    for bi, b in enumerate(BIOMES):
        load = "eager" if bi == 0 else "lazy"
        scene = "\n".join(
            '        <div class="dsprite dsprite--' + cls + (' is-iso' if iso else '')
            + '" data-row="' + str(row) + '">' + pic_img(a, name, "", loading=load) + '</div>'
            for cls, name, row, base_h, hide, iso in b["sprites"])
        parts = ['  <section class="sec sec--' + b["id"] + '" id="b-' + b["id"] + '"\n'
                 '           data-scene="' + b["id"] + '" aria-label="' + att(b[lang]) + '">']
        parts.append('    <div class="sec__scene" aria-hidden="true">\n' + scene + '\n    </div>')
        if b.get("clock"):
            parts.append('    <p class="clock" id="clock"><span class="clock__dot"></span>'
                         '<span id="clock-text"></span></p>')
        if bi == 0:
            parts.append('    <div class="pitch">\n      <div class="sign">\n'
                         '        <p class="sign__text">' + esc(t["tagline"]) + '</p>\n'
                         '        <p class="sign__sub">' + esc(t["descriptor"]) + '</p>\n'
                         '      </div>\n' + cta + '\n    </div>')
        body = [card(c) for c in b["cards"]]
        if b.get("resources"):
            body.append(resources)
        parts.append('    <div class="sec__cards">\n' + "\n".join(body) + '\n    </div>')
        if b.get("cta") and bi > 0:
            parts.append('    <div class="sec__outro">\n' + cta + '\n    </div>')
        parts.append('  </section>')
        secs.append("\n".join(parts))
        if b.get("gate"):
            secs.append('  <div class="gatezone" data-gate="' + b["id"] + '" aria-hidden="true"></div>')

    tod = ("{" + ", ".join(f'"{k}": "{v}"' for k, v in t["tod"].items())
           + f', "prefix": "{t["tod_prefix"]}"' + "}")

    return f"""<!doctype html>
<html lang="{t['lang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{esc(t['title'])} — preview</title>
<meta name="description" content="{att(t['desc'])}">
<link rel="icon" href="{a}favicon-32.png" sizes="32x32">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" media="print" onload="this.media='all'"
      href="https://fonts.googleapis.com/css2?family=Podkova:wght@500;700&family=Vollkorn:wght@400;600;700&family=PT+Mono&display=swap">
<noscript><link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Podkova:wght@500;700&family=Vollkorn:wght@400;600;700&family=PT+Mono&display=swap"></noscript>
<link rel="stylesheet" href="{root}styles.css?v={VER}">
<script>window.TOD_LABELS = {tod}; window.SCENE_URL = "{root}scene.json";
        window.ASSET_BASE = "{a}";</script>
</head>
<body>
<canvas id="stage" aria-hidden="true"></canvas>

<div id="dom">
<a class="skip" href="#b-village">{esc(t['skip'])}</a>

<header class="topbar">
  <a class="logo" href="{root or './'}">FELLMISE</a>
  <button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="nav"
          aria-label="{att(t['menu'])}"><span></span><span></span><span></span></button>
  <nav class="nav" id="nav" aria-label="{att(t['menu'])}">
    <a class="nav__link" href="#b-forest">{esc(t['nav_features'])}</a>
    <a class="nav__link" href="#b-spirit">{esc(t['nav_world'])}</a>
    <span class="nav__devlog-wrap">
      <button class="nav__link nav__devlog" id="devlog-btn" type="button"
              aria-expanded="false">{esc(t['nav_devlog'])}</button>
      <span class="devlog-tip" id="devlog-tip" role="status">{esc(t['devlog_tip'])}</span>
    </span>
    <span class="lang">
      <span class="lang__current" aria-current="true">{esc(t['self_label'])}</span>
      <a href="{t['other_href']}">{esc(t['other_label'])}</a>
    </span>
  </nav>
</header>

<main>
{chr(10).join(secs)}

  <p class="disclaimer">{esc(t['disclaimer'])}</p>
</main>

<footer class="footer">
  <p class="footer__brand">fellmise.com</p>
  <p class="footer__rights">{esc(t['rights'])}</p>
  <nav class="footer__links" aria-label="Links">
    <a href="#">{esc(t['discord'])}</a>
    <a href="#">{esc(t['steam'])}</a>
    <a href="{t['other_href']}">{esc(t['other_label'])}</a>
  </nav>
</footer>
</div>

<script src="{root}vendor/gsap.min.js" defer></script>
<script src="{root}vendor/ScrollTrigger.min.js" defer></script>
<!-- module, so the dynamic import of journey.js resolves against this
     file rather than about:blank (which is what a classic script does) -->
<script type="module" src="{root}main.js?v={VER}"></script>
</body>
</html>
"""


VER = "1"


def main():
    NEXT.mkdir(exist_ok=True)
    (NEXT / "ru").mkdir(exist_ok=True)
    (NEXT / "index.html").write_text(build("en"), encoding="utf-8")
    (NEXT / "ru" / "index.html").write_text(build("ru"), encoding="utf-8")
    (NEXT / "scene.json").write_text(json.dumps(scene_spec(), indent=1), encoding="utf-8")

    # self-contained: webp assets + vendor
    dst = NEXT / "assets"
    dst.mkdir(exist_ok=True)
    n = 0
    for p in (ROOT / "assets").iterdir():
        if p.suffix == ".webp" or p.name in ("favicon-32.png", "manifest.json",
                                             "apple-touch-icon.png", "og.jpg"):
            shutil.copy2(p, dst / p.name)
            n += 1
    vd = NEXT / "vendor"
    vd.mkdir(exist_ok=True)
    for p in (ROOT / "vendor").iterdir():
        shutil.copy2(p, vd / p.name)

    size = sum(f.stat().st_size for f in NEXT.rglob("*") if f.is_file())
    print(f"next/: index.html {(NEXT/'index.html').stat().st_size/1024:.1f} KB, "
          f"ru/index.html {(NEXT/'ru'/'index.html').stat().st_size/1024:.1f} KB")
    print(f"       scene.json {(NEXT/'scene.json').stat().st_size/1024:.1f} KB, "
          f"assets {n} файлов, всего {size/1048576:.2f} MB")


if __name__ == "__main__":
    main()
