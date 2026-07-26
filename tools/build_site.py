"""Emit the static site: index.html (EN) and ru/index.html (RU).

    python tools/build_site.py

There is no build step at serve time — this writes plain HTML that is committed
and served as-is. It exists so the two language pages cannot drift apart
structurally: markup lives here once, copy lives in I18N, and both pages are
stamped from the same template. Edit this file, re-run, commit the HTML.
"""

import pathlib

from biomes import BIOMES, ROWS

ROOT = pathlib.Path(__file__).resolve().parent.parent

CSS_V = "5"          # cache-buster on styles.css / main.js

# --------------------------------------------------------------------------
# copy
# --------------------------------------------------------------------------
FEATURES = [
    dict(id="skills", sprite="feat_skills",
         en_t="Skills, no levels",
         en_p="No level next to your name. Swing a sword and your sword skill "
              "grows; pick locks and your lockpicking does. Want a different "
              "character — play differently, don't roll a new one.",
         ru_t="Скиллы вместо уровней",
         ru_p="Уровня нет. Машешь мечом — растёт меч, лезешь по замкам — растёт "
              "взлом. Нужен другой персонаж — играй по-другому, а не создавай "
              "нового."),
    dict(id="mining", sprite="feat_mining",
         en_t="Mining and gathering",
         en_p="Every ore, log, herb and fish was pulled out of the ground by "
              "somebody's hands. Veins run out. The best ground is where people "
              "get killed. What you haul back is what you keep.",
         ru_t="Добыча",
         ru_p="Руду, дерево, траву и рыбу кто-то вытащил руками. Жилы кончаются, "
              "лучшее лежит там, где убивают. Сколько дотащил — столько и твоё."),
    dict(id="craft", sprite="feat_craft",
         en_t="Crafting",
         en_p="Anything worth wearing is made by a player at an anvil. A good "
              "smith's name is known across the shard. Nothing drops out of a menu.",
         ru_t="Крафт",
         ru_p="Всё стоящее делают игроки у наковальни. Кузнеца с именем знают на "
              "весь шард. Из меню не падает ничего."),
    dict(id="pvp", sprite="feat_pvp",
         en_t="Fights that last",
         en_p="Nobody dies in one hit. There is time to turn around, call your "
              "people, or leave on foot. Whoever won ground it out — they didn't "
              "get a lucky proc.",
         ru_t="Долгий бой",
         ru_p="С одного удара не убивают. Успеешь развернуться, позвать своих или "
              "уйти ногами. Кто победил — тот дожал, а не прокнул."),
    dict(id="death", sprite="feat_death", extra="feat_death_alt",
         en_t="Death is a place",
         en_p="The living don't teach necromancy. Die, ride the ship of the dead "
              "as a ghost, and come back changed.",
         ru_t="Смерть — это место",
         ru_p="Некромантию не учат живые. Умри, сядь духом на корабль мёртвых — "
              "и вернись другим."),
    dict(id="vendetta", sprite="feat_vendetta",
         en_t="Vendetta",
         en_p="Kill in front of witnesses and the family remembers. An avenger "
              "will find you on the far side of the map. Work clean.",
         ru_t="Кровная месть",
         ru_p="Убил при свидетелях — родня запомнила. Мститель найдёт тебя хоть "
              "на другом конце карты. Работай чисто."),
    # anchor target for the "World" nav link
    dict(id="world", anchor="world", sprite="feat_world", extra="feat_tavern",
         en_t="A world that plays itself",
         en_p="Log off and the world stays. NPCs run dungeons, haul goods, haggle "
              "and drink in taverns. You are not arriving at an empty map.",
         ru_t="Мир играет сам",
         ru_p="Вышел из игры — мир остался. NPC лезут в данжи, возят товар, "
              "торгуются и пьют в таверне. Ты приходишь не на пустую карту."),
    dict(id="factions", sprite=None,
         en_t="Humans and monsters",
         en_p="Play the people behind the wall, or the ones hammering on it. "
              "Both sides are alive, and both sides have a home.",
         ru_t="Люди и монстры",
         ru_p="Играй за людей за стеной или за тех, кто ломится снаружи. Обе "
              "стороны живые, у обеих свой дом."),
    # NB: housing is an OPEN block in the GDD, and this copy names open-world
    # placement and layered building on purpose (both are in the GDD's own
    # "Строительство (решено)" section). See DEVLOG — the caution line added to
    # the GDD last batch is now narrower than what the site says.
    dict(id="home", sprite="feat_home",
         en_t="A home to come back to",
         en_p="Claim an empty patch of land and build it in layers: foundation, "
              "walls, door, roof. Your chests hold everything you have earned. "
              "At night the monsters test the walls.",
         ru_t="Дом, куда возвращаешься",
         ru_p="Займи свободный клочок земли и строй слоями: фундамент, стены, "
              "дверь, крыша. В сундуках — всё нажитое. Ночью монстры проверят "
              "стены на прочность."),
]

RESOURCES = [
    # Ordered by role: gathering, tools, weapons, magic.
    # res_axe / res_dagger / res_shield stay in assets/ but are off the page —
    # they are held back for devlog posts.
    ("res_iron", "Iron ore", "Руда"),
    ("res_gold", "Gold ore", "Золото"),
    ("res_diamond", "Crystals", "Кристаллы"),
    ("res_wood", "Logs", "Брёвна"),
    ("res_herbs", "Herbs", "Травы"),
    ("res_fish", "Fish", "Рыба"),
    ("res_pickaxe", "Pickaxe", "Кирка"),
    ("res_sword", "Sword", "Меч"),
    ("res_bow", "Bow", "Лук"),
    ("res_staff", "Staff", "Посох"),
    ("res_spellbook", "Spellbook", "Книга заклинаний"),
    ("res_runes", "Runes", "Руны"),
    ("res_potion", "Potion", "Зелье"),
]

I18N = {
    "en": dict(
        lang="en", href="/", other_href="ru/", other_label="RU", self_label="EN",
        title="Fellmise — top-down 2D sandbox MMO",
        desc="Top-down 2D sandbox MMO inspired by Ultima Online: skill-based "
             "progression, playable monster faction, PC+mobile crossplay",
        tagline="You killed them by the hundreds. Now they've come for you.",
        descriptor="Skills instead of levels. Death costs you. A world that runs "
                   "without you. No pay-to-win.",
        cta_steam="Wishlist on Steam — soon",
        cta_discord="Discord",
        nav_features="Features", nav_world="World", nav_devlog="Devlog",
        devlog_tip="Devlog starts soon",
        menu="Menu",
        tod_prefix="in Fellmise now:",
        tod=dict(dawn="dawn", day="day", dusk="sunset", night="night"),
        features_title="What Fellmise is",
        res_title="Dug up, chopped down, forged",
        soon="art coming soon",
        disclaimer="Fellmise is in early development. Everything here is still being "
                   "built and will change.",
        rights="© 2026 Fellmise", steam="Steam", discord="Discord",
        skip="Skip to content",
        journey="Journey",
    ),
    "ru": dict(
        lang="ru", href="/ru/", other_href="../", other_label="EN", self_label="RU",
        title="Fellmise — 2D-песочница MMO с видом сверху",
        desc="Хардкорная 2D-песочница MMO с видом сверху в духе Ultima Online: скиллы вместо уровней, играбельная фракция монстров, кроссплей PC и мобайл",
        tagline="Ты убивал их сотнями. Теперь они пришли за тобой.",
        descriptor="Качаешь то, чем играешь. Смерть уносит вещи. Мир живёт без тебя. "
                   "Доната нет.",
        cta_steam="Wishlist в Steam — скоро",
        cta_discord="Discord",
        nav_features="Механики", nav_world="Мир", nav_devlog="Devlog",
        devlog_tip="Скоро",
        menu="Меню",
        tod_prefix="в Fellmise сейчас:",
        tod=dict(dawn="рассвет", day="день", dusk="закат", night="ночь"),
        features_title="Что это за игра",
        res_title="Копай, руби, куй",
        soon="арт будет",
        disclaimer="Игра в ранней разработке. Всё, что видишь, ещё поменяется.",
        rights="© 2026 Fellmise", steam="Steam", discord="Discord",
        skip="К содержимому",
        journey="Путешествие",
    ),
}

HERO_SPRITES = [
    # class suffix, sprite, parallax depth, hidden on mobile.
    # Order here is DOM order = paint order: earlier entries sit behind later
    # ones, which is what puts tree crowns over the houses. Sizes and positions
    # live in styles.css so one file owns the composition.
    ("house-b", "hero_house_b", 0.04, False),
    ("tree-a", "hero_tree_a", 0.09, False),
    ("well", "hero_well", 0.06, False),
    ("house-a", "hero_house_a", 0.05, False),
    ("tree-b", "hero_tree_b", 0.11, True),
    ("crates", "prop_crates", 0.13, True),
    ("lantern", "prop_lantern", 0.14, True),
    ("signpost", "prop_signpost", 0.15, False),
    ("stones-a", "prop_stones", 0.18, False),
    ("stones-b", "prop_stones", 0.20, True),
    ("stones-c", "prop_stones", 0.22, True),
]


def esc(s):
    """Escape for HTML text. Kept minimal so apostrophes stay readable."""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def att(s):
    """Escape for a double-quoted attribute value."""
    return esc(s).replace('"', "&quot;")


import json as _json

_MANIFEST = None


def manifest():
    """Which widths export_web actually produced, per name."""
    global _MANIFEST
    if _MANIFEST is None:
        p = ROOT / "assets" / "manifest.json"
        _MANIFEST = _json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return _MANIFEST


# How wide each kind of image is drawn, so the browser can pick a variant
# BEFORE layout. Values are deliberately a little generous: guessing small
# fetches a blurry file, guessing large only wastes a step.
SIZES = {
    "scene": "(max-width: 760px) 46vw, 34vw",   # sprites standing in a biome
    "card": "(max-width: 760px) 78vw, 30vw",    # art inside a feature card
    "res": "(max-width: 760px) 26vw, 120px",    # resource strip pictogram
    "gate": "(max-width: 760px) 92vw, 52vw",    # doorway art in a gate
}


def pic(a, name, alt, cls="", loading="lazy", extra_attr="", kind="scene"):
    """<picture> with a responsive WebP srcset and a single PNG fallback.

    srcset comes straight from assets/manifest.json, so the markup can never
    claim a width that was not exported (and never asks for an upscale — the
    exporter refuses to make one).
    """
    m = manifest().get(name)
    c = f' class="{cls}"' if cls else ""
    if not m:
        return (f'<picture{c}><source srcset="{a}{name}.webp" type="image/webp">'
                f'<img src="{a}{name}.png" alt="{att(alt)}" loading="{loading}" '
                f'decoding="async"{extra_attr}></picture>')

    srcset = ", ".join(f"{a}{name}-{w}.webp {w}w" for w in m["w"])
    sizes = SIZES.get(kind, SIZES["scene"])
    dims = f' width="{m["width"]}" height="{m["height"]}"'
    return (f'<picture{c}>'
            f'<source type="image/webp" srcset="{srcset}" sizes="{sizes}">'
            f'<img src="{a}{name}.png" alt="{att(alt)}" loading="{loading}" '
            f'decoding="async"{dims}{extra_attr}></picture>')


def build(lang):
    t = I18N[lang]
    a = "assets/" if lang == "en" else "../assets/"
    root = "" if lang == "en" else "../"
    tk, pk = ("en_t", "en_p") if lang == "en" else ("ru_t", "ru_p")

    def card_html(fid):
        f = FEAT_BY_ID[fid]
        if f["sprite"]:
            art = pic(a, f["sprite"], f[tk], cls="card__art", kind="card")
            if f.get("extra"):
                art += pic(a, f["extra"], "", cls="card__art card__art--corner", kind="card")
        else:
            art = (f'<div class="card__art card__art--soon" role="img" '
                   f'aria-label="{att(t["soon"])}"><span>{esc(t["soon"])}</span></div>')
        anchor = f' id="{f["anchor"]}"' if f.get("anchor") else ""
        return ('        <article class="card" id="f-' + f["id"] + '"' + anchor + '>\n'
                '          <div class="card__roof" aria-hidden="true"></div>\n'
                '          <div class="card__body">\n'
                '            ' + art + '\n'
                '            <h3 class="card__title">' + esc(f[tk]) + '</h3>\n'
                '            <p class="card__text">' + esc(f[pk]) + '</p>\n'
                '          </div>\n'
                '        </article>')

    resources_html = (
        '        <section class="resources" aria-labelledby="res-h">\n'
        '          <h3 class="resources__title" id="res-h">' + esc(t["res_title"]) + '</h3>\n'
        '          <ul class="resources__strip">\n'
        + "\n".join(
            '            <li class="res"><figure>'
            + pic(a, rid, label if lang == "en" else label_ru, kind="res")
            + '<figcaption>' + esc(label if lang == "en" else label_ru) + '</figcaption>'
            + '</figure></li>'
            for rid, label, label_ru in RESOURCES)
        + '\n          </ul>\n        </section>')

    cta_html = (
        '      <div class="cta">\n'
        '        <button class="btn btn--steam" disabled>' + esc(t["cta_steam"]) + '</button>\n'
        '        <!-- TODO: подставить инвайт, когда создан сервер Discord -->\n'
        '        <a class="btn btn--discord" href="#">' + esc(t["cta_discord"]) + '</a>\n'
        '      </div>')

    sections = []
    for bi, b in enumerate(BIOMES):
        first = bi == 0
        # Biome 1 is the first screen and loads eagerly; everything below is
        # lazy, and main.js promotes the next biome to eager one section ahead.
        load = "eager" if first else "lazy"
        def sprite_html(cls, name, row, base_h, hide, iso):
            r = ROWS[row]
            h = round(base_h * r["scale"], 1)
            style = ('bottom:' + str(r["bottom"]) + '%;height:' + str(h) + '%;'
                     'z-index:' + str(r["z"]) + ';')
            return ('        <div class="sprite sprite--' + cls
                    + (' is-mobile-hidden' if hide else '')
                    + (' is-iso' if iso else '')
                    + '" data-row="' + str(row) + '" style="' + style + '">'
                    # a sprite the mobile layout hides is dead weight on the
                    # first screen there, so it never loads eagerly
                    + pic(a, name, "", loading=('lazy' if hide else load)) + '</div>')

        scene = "\n".join(sprite_html(*sp) for sp in b["sprites"])

        parts = ['  <section class="biome biome--' + b["id"] + '" id="b-' + b["id"] + '"\n'
                 '           data-biome="' + b["id"] + '" aria-label="' + att(b[lang]) + '">']
        parts.append('    <div class="biome__sky" aria-hidden="true"></div>')
        parts.append('    <div class="biome__ground" aria-hidden="true"></div>')
        if b.get("road"):
            parts.append('    <div class="biome__road" aria-hidden="true"></div>')
        if b.get("clock"):
            parts.append('    <div class="biome__tint" aria-hidden="true"></div>')
        parts.append('    <div class="biome__scene" aria-hidden="true">\n' + scene + '\n    </div>')
        if b.get("clock"):
            parts.append('    <p class="clock" id="clock"><span class="clock__dot"></span>'
                         '<span id="clock-text"></span></p>')
        if first:
            parts.append(
                '    <div class="pitch">\n'
                '      <div class="sign">\n'
                '        <p class="sign__text">' + esc(t["tagline"]) + '</p>\n'
                '        <p class="sign__sub">' + esc(t["descriptor"]) + '</p>\n'
                '      </div>\n' + cta_html + '\n    </div>')
        body = [card_html(c) for c in b["cards"]]
        if b.get("resources"):
            body.append(resources_html)
        parts.append('    <div class="biome__cards">\n' + "\n".join(body) + '\n    </div>')
        if b.get("cta") and not first:
            parts.append('    <div class="biome__outro">\n' + cta_html + '\n    </div>')
        parts.append('    <div class="biome__reveal" aria-hidden="true"></div>')
        parts.append('  </section>')
        sections.append("\n".join(parts))

        if b.get("gate"):
            g = b["gate"]
            door = ''
            if g.get("door"):
                # the door is a separate layer hinged on its left edge; the warm
                # opening behind it is the same art with the door area darkened
                door = ('        <div class="gate__door">'
                        + pic(a, g["art"] + "_door", "", loading="lazy", kind="gate") + '</div>\n')
            body = g["art"] + "_open" if g.get("door") else g["art"]
            sections.append(
                '  <div class="gate" data-gate="' + b["id"] + '"'
                + (' data-door="1"' if g.get("door") else '')
                + ' aria-hidden="true">\n'
                '    <div class="gate__stage">\n'
                '      <div class="gate__zoom">\n'
                '        <div class="gate__art">' + pic(a, body, "", loading="lazy", kind="gate") + '</div>\n'
                + door +
                '        <div class="gate__light"></div>\n'
                '      </div>\n'
                '      <div class="gate__glow"></div>\n'
                '      <div class="gate__vignette"></div>\n'
                '    </div>\n'
                '  </div>')

    biomes_html = "\n".join(sections)

    tod_json = ("{" + ", ".join(f'"{k}": "{v}"' for k, v in t["tod"].items())
                + f', "prefix": "{t["tod_prefix"]}"' + "}")

    return f"""<!doctype html>
<html lang="{t['lang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(t['title'])}</title>
<meta name="description" content="{att(t['desc'])}">
<link rel="canonical" href="https://fellmise.com{t['href']}">
<link rel="alternate" hreflang="en" href="https://fellmise.com/">
<link rel="alternate" hreflang="ru" href="https://fellmise.com/ru/">
<link rel="alternate" hreflang="x-default" href="https://fellmise.com/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fellmise">
<meta property="og:locale" content="{'en_US' if lang == 'en' else 'ru_RU'}">
<meta property="og:title" content="{att(t['title'])}">
<meta property="og:description" content="{att(t['desc'])}">
<meta property="og:url" content="https://fellmise.com{t['href']}">
<meta property="og:image" content="https://fellmise.com/assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{att(t['title'])}">
<meta name="twitter:description" content="{att(t['desc'])}">
<meta name="twitter:image" content="https://fellmise.com/assets/og.jpg">
<meta name="theme-color" content="#a8cb53">
<link rel="icon" href="{a}favicon-32.png" sizes="32x32">
<link rel="icon" href="{a}icon-512.png" sizes="512x512">
<link rel="apple-touch-icon" href="{a}apple-touch-icon.png">
<!-- LCP is the village ground band, painted from a CSS background tile, so the
     tile is only discovered after the stylesheet parses unless it is preloaded.
     imagesrcset/imagesizes mirror the media query in styles.css, so a phone
     preloads the 480 variant and a desktop the full one. -->
<link rel="preload" as="image" type="image/webp" fetchpriority="high"
      href="{a}tile_grass.webp"
      imagesrcset="{a}tile_grass-480.webp 480w, {a}tile_grass.webp 512w"
      imagesizes="100vw">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" media="print" onload="this.media='all'"
      href="https://fonts.googleapis.com/css2?family=Podkova:wght@500;700&family=Vollkorn:wght@400;600;700&family=PT+Mono&display=swap">
<noscript><link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Podkova:wght@500;700&family=Vollkorn:wght@400;600;700&family=PT+Mono&display=swap"></noscript>
<link rel="stylesheet" href="{root}styles.css?v={CSS_V}">
<script>window.TOD_LABELS = {tod_json};</script>
</head>
<body>
<a class="skip" href="#b-village">{esc(t['skip'])}</a>

<header class="topbar">
  <a class="logo" href="{root or '/'}">FELLMISE</a>

  <button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="nav"
          aria-label="{att(t['menu'])}"><span></span><span></span><span></span></button>

  <nav class="nav" id="nav" aria-label="{att(t['menu'])}">
    <a class="nav__link" href="#b-forest">{esc(t['nav_features'])}</a>
    <a class="nav__link" href="#world">{esc(t['nav_world'])}</a>
    <span class="nav__devlog-wrap">
      <button class="nav__link nav__devlog" id="devlog-btn" type="button"
              aria-expanded="false" aria-describedby="devlog-tip">{esc(t['nav_devlog'])}</button>
      <span class="devlog-tip" id="devlog-tip" role="status">{esc(t['devlog_tip'])}</span>
    </span>
    <span class="lang">
      <span class="lang__current" aria-current="true">{esc(t['self_label'])}</span>
      <a href="{t['other_href']}" hreflang="{'ru' if lang == 'en' else 'en'}">{esc(t['other_label'])}</a>
    </span>
  </nav>
</header>

<div id="smooth-wrapper"><div id="smooth-content">
<main>
{biomes_html}

  <p class="disclaimer">{esc(t['disclaimer'])}</p>
</main>

<footer class="footer">
  <p class="footer__brand">fellmise.com</p>
  <p class="footer__rights">{esc(t['rights'])}</p>
  <nav class="footer__links" aria-label="Links">
    <!-- TODO: подставить реальные ссылки Discord / Steam -->
    <a href="#">{esc(t['discord'])}</a>
    <a href="#">{esc(t['steam'])}</a>
    <a href="{t['other_href']}">{esc(t['other_label'])}</a>
  </nav>
</footer>
</div></div>

<!-- GSAP is fetched by main.js only when the journey will run (desktop, motion
     allowed). On phones the journey is off, so 127 KB is never downloaded. -->
<script src="{root}main.js?v={CSS_V}" defer></script>
</body>
</html>
"""


def main():
    (ROOT / "index.html").write_text(build("en"), encoding="utf-8")
    (ROOT / "ru").mkdir(exist_ok=True)
    (ROOT / "ru" / "index.html").write_text(build("ru"), encoding="utf-8")
    for p in ("index.html", "ru/index.html"):
        print(f"{p:<16} {(ROOT/p).stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
