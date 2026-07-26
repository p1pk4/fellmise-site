"""Emit the static site: index.html (EN) and ru/index.html (RU).

    python tools/build_site.py

There is no build step at serve time — this writes plain HTML that is committed
and served as-is. It exists so the two language pages cannot drift apart
structurally: markup lives here once, copy lives in I18N, and both pages are
stamped from the same template. Edit this file, re-run, commit the HTML.
"""

import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------------
# copy
# --------------------------------------------------------------------------
FEATURES = [
    dict(id="skills", sprite="feat_skills",
         en_t="Skills, no levels",
         en_p="There is no level next to your name. You get better at what you "
              "actually do — swing a blade and the arm remembers, fumble a lock "
              "and try it again. The character is the one you played into being, "
              "not the one a class menu handed you.",
         ru_t="Скиллы вместо уровней",
         ru_p="Рядом с именем нет уровня. Ты становишься лучше в том, что делаешь "
              "руками: машешь клинком — рука запоминает, не открыл замок — пробуешь "
              "снова. Персонаж вырастает из твоей игры, а не из меню классов."),
    dict(id="mining", sprite="feat_mining",
         en_t="Mining & gathering",
         en_p="Everything the world is made of, somebody pulled out of it by hand. "
              "Veins run dry, and the richest ground is always where it is least "
              "safe to stand. What you carry home is exactly what you were willing "
              "to risk going out for.",
         ru_t="Добыча",
         ru_p="Всё, из чего сделан мир, кто-то вытащил из него руками. Жилы "
              "истощаются, а самое богатое всегда лежит там, где стоять опаснее "
              "всего. Домой приносишь ровно то, чем рискнул."),
    dict(id="craft", sprite="feat_craft",
         en_t="Crafting",
         en_p="Gear is made by players, at an anvil, out of what someone else dug "
              "up. A good smith's name travels further than most swordsmen's. "
              "Nothing worth wearing falls out of a menu.",
         ru_t="Крафт",
         ru_p="Снаряжение делают игроки — у наковальни, из того, что кто-то выкопал. "
              "Имя хорошего кузнеца расходится дальше, чем имя иного мечника. "
              "Ничего стоящего не выпадает из меню."),
    dict(id="pvp", sprite="feat_pvp",
         en_t="High-TTK PvP",
         en_p="Fights last long enough to actually be fights — long enough to "
              "reposition, to shout for help, to decide you would rather run. "
              "Nobody bursts down in one hit from off-screen. You keep choosing "
              "the win, you don't get handed it.",
         ru_t="PvP с высоким TTK",
         ru_p="Бой длится достаточно, чтобы быть боем: перестроиться, позвать на "
              "помощь, решить, что лучше бежать. Никто не рассыпается от одного "
              "удара из-за края экрана. Победу удерживают, а не выигрывают вспышкой."),
    dict(id="death", sprite="feat_death", extra="feat_death_alt",
         en_t="Death is a place",
         en_p="Dying does not reload — it moves you. The other side has its own "
              "geography, its own routes back, and its own residents who never "
              "found one. Go deep enough and you may return knowing necromancy.",
         ru_t="Смерть — это место",
         ru_p="Смерть не перезагружает, а переносит. У той стороны своя география, "
              "свои дороги обратно и свои жители, которые их не нашли. Зайди "
              "достаточно глубоко — и вернёшься, зная некромантию."),
    dict(id="nemesis", sprite="feat_nemesis",
         en_t="Nemesis",
         en_p="The world remembers who did it. Kill without witnesses and nothing "
              "follows you home; leave someone breathing and the story gets told, "
              "and the people who loved them come looking. Your enemies are the "
              "ones you made.",
         ru_t="Немезида",
         ru_p="Мир помнит, кто это сделал. Убивай без свидетелей — и за тобой никто "
              "не придёт; оставь кого-то в живых — историю расскажут, и придут те, "
              "кому он был дорог. Врагов ты делаешь сам."),
    dict(id="world", sprite="feat_world", extra="feat_tavern",
         en_t="A world that plays itself",
         en_p="Log out and the world keeps its appointments. NPCs run dungeons, "
              "haul cargo, argue over prices and drink in taverns whether or not "
              "anyone is watching. You are joining a place that was already busy.",
         ru_t="Мир, который играет сам",
         ru_p="Ты вышел — мир остался при делах. NPC ходят в данжи, возят груз, "
              "торгуются и пьют в тавернах, смотришь ты или нет. Ты приходишь туда, "
              "где уже давно занято."),
    dict(id="factions", sprite=None,
         en_t="Two factions: humans and monsters",
         en_p="Play the people behind the walls, or the things outside them. Both "
              "sides are playable, and both sides are somebody's home.",
         ru_t="Две фракции: люди и монстры",
         ru_p="Играй за тех, кто за стеной, или за тех, кто снаружи. Обе стороны "
              "играбельны, и обе — чей-то дом."),
]

RESOURCES = [
    ("res_iron", "Iron ore", "Железная руда"),
    ("res_gold", "Gold ore", "Золотая руда"),
    ("res_diamond", "Crystals", "Кристаллы"),
    ("res_wood", "Logs", "Брёвна"),
    ("res_herbs", "Herbs", "Травы"),
    ("res_fish", "Fish", "Рыба"),
    ("res_pickaxe", "Pickaxe", "Кирка"),
    ("res_sword", "Sword", "Меч"),
    ("res_bow", "Bow", "Лук"),
    ("res_potion", "Potion", "Зелье"),
]

I18N = {
    "en": dict(
        lang="en", href="/", other_href="ru/", other_label="RU", self_label="EN",
        title="Fellmise — top-down 2D sandbox MMO",
        desc="Top-down 2D sandbox MMO inspired by Ultima Online: skill-based "
             "progression, playable monster faction, PC+mobile crossplay",
        tagline="You killed them by the hundreds. Now they've come for you.",
        descriptor="Skills instead of levels. Death with consequences. A living "
                   "world. No pay-to-win.",
        cta_steam="Wishlist on Steam — soon",
        cta_discord="Discord",
        tod_prefix="in Fellmise now:",
        tod=dict(dawn="dawn", day="day", dusk="sunset", night="night"),
        features_title="What Fellmise is",
        res_title="Dug up, chopped down, forged",
        soon="art coming soon",
        disclaimer="Fellmise is in early development. Everything you see is work "
                   "in progress and subject to change.",
        rights="© 2026 Fellmise", steam="Steam", discord="Discord",
        skip="Skip to content",
    ),
    "ru": dict(
        lang="ru", href="/ru/", other_href="../", other_label="EN", self_label="RU",
        title="Fellmise — 2D-песочница MMO с видом сверху",
        desc="2D-песочница MMO с видом сверху в духе Ultima Online: прокачка через "
             "навыки, играбельная фракция монстров, кроссплей PC и мобайл",
        tagline="Ты убивал их сотнями. Теперь они пришли за тобой.",
        descriptor="Скиллы вместо уровней, смерть с последствиями, живой мир. "
                   "Без доната.",
        cta_steam="Wishlist в Steam — скоро",
        cta_discord="Discord",
        tod_prefix="в Fellmise сейчас:",
        tod=dict(dawn="рассвет", day="день", dusk="закат", night="ночь"),
        features_title="Что такое Fellmise",
        res_title="Добыто, срублено, выковано",
        soon="арт скоро",
        disclaimer="Игра в ранней разработке, всё может измениться.",
        rights="© 2026 Fellmise", steam="Steam", discord="Discord",
        skip="К содержимому",
    ),
}

HERO_SPRITES = [
    # class suffix, sprite, parallax depth, hidden on mobile
    ("tree-a", "hero_tree_a", 0.10, False),
    ("house-b", "hero_house_b", 0.05, False),
    ("well", "hero_well", 0.07, False),
    ("house-a", "hero_house_a", 0.05, False),
    ("tree-b", "hero_tree_b", 0.12, True),
    ("cart", "hero_cart", 0.16, True),
    ("fence", "hero_fence", 0.18, True),
]


def esc(s):
    """Escape for HTML text. Kept minimal so apostrophes stay readable."""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def att(s):
    """Escape for a double-quoted attribute value."""
    return esc(s).replace('"', "&quot;")


def pic(a, name, alt, cls="", loading="lazy", extra_attr=""):
    """<picture> with a WebP source and a PNG fallback."""
    c = f' class="{cls}"' if cls else ""
    return (f'<picture{c}>'
            f'<source srcset="{a}{name}.webp" type="image/webp">'
            f'<img src="{a}{name}.png" alt="{att(alt)}" loading="{loading}" '
            f'decoding="async"{extra_attr}></picture>')


def build(lang):
    t = I18N[lang]
    a = "assets/" if lang == "en" else "../assets/"
    root = "" if lang == "en" else "../"
    tk, pk = ("en_t", "en_p") if lang == "en" else ("ru_t", "ru_p")

    hero = "\n".join(
        f'        <div class="sprite sprite--{cls}{" is-mobile-hidden" if hide else ""}" '
        f'data-depth="{depth}">'
        + pic(a, name, "", loading="eager" if i < 3 else "lazy") + "</div>"
        for i, (cls, name, depth, hide) in enumerate(HERO_SPRITES))

    cards = []
    for f in FEATURES:
        if f["sprite"]:
            art = pic(a, f["sprite"], f[tk], cls="card__art")
            if f.get("extra"):
                art += pic(a, f["extra"], "", cls="card__art card__art--corner")
        else:
            art = (f'<div class="card__art card__art--soon" role="img" '
                   f'aria-label="{att(t["soon"])}"><span>{esc(t["soon"])}</span></div>')
        cards.append(
            f'        <article class="card" id="f-{f["id"]}">\n'
            f'          <div class="card__roof" aria-hidden="true"></div>\n'
            f'          <div class="card__body">\n'
            f'            {art}\n'
            f'            <h3 class="card__title">{esc(f[tk])}</h3>\n'
            f'            <p class="card__text">{esc(f[pk])}</p>\n'
            f'          </div>\n'
            f'        </article>')
        if f["id"] == "craft":
            items = "\n".join(
                f'            <li class="res"><figure>'
                + pic(a, rid, label if lang == "en" else label_ru)
                + f'<figcaption>{esc(label if lang == "en" else label_ru)}</figcaption>'
                f'</figure></li>'
                for rid, label, label_ru in RESOURCES)
            cards.append(
                f'        <section class="resources" aria-labelledby="res-h">\n'
                f'          <h3 class="resources__title" id="res-h">{esc(t["res_title"])}</h3>\n'
                f'          <ul class="resources__strip">\n{items}\n          </ul>\n'
                f'        </section>')

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Alegreya:ital,wght@0,400;0,700;1,400&family=PT+Mono&display=swap">
<link rel="stylesheet" href="{root}styles.css">
<script>window.TOD_LABELS = {tod_json};</script>
</head>
<body>
<a class="skip" href="#features">{esc(t['skip'])}</a>

<header class="topbar">
  <a class="logo" href="{root or '/'}">FELLMISE</a>
  <nav class="lang" aria-label="Language">
    <span class="lang__current" aria-current="true">{esc(t['self_label'])}</span>
    <a href="{t['other_href']}" hreflang="{'ru' if lang == 'en' else 'en'}">{esc(t['other_label'])}</a>
  </nav>
</header>

<main>
  <section class="hero" id="hero" data-tod="day">
    <div class="hero__sky" aria-hidden="true"></div>
    <div class="hero__ground" aria-hidden="true"></div>
    <div class="hero__path" aria-hidden="true"></div>
    <div class="hero__tint" aria-hidden="true"></div>

    <div class="hero__scene" aria-hidden="true">
{hero}
    </div>

    <p class="clock" id="clock"><span class="clock__dot"></span><span id="clock-text"></span></p>

    <div class="hero__copy">
      <div class="sign">
        <p class="sign__text">{esc(t['tagline'])}</p>
      </div>
      <p class="descriptor">{esc(t['descriptor'])}</p>
      <div class="cta">
        <button class="btn btn--steam" disabled>{esc(t['cta_steam'])}</button>
        <!-- TODO: подставить инвайт, когда создан сервер Discord -->
        <a class="btn btn--discord" href="#">{esc(t['cta_discord'])}</a>
      </div>
    </div>
  </section>

  <section class="features" id="features" aria-labelledby="features-h">
    <h2 class="section-title" id="features-h">{esc(t['features_title'])}</h2>
    <div class="features__grid">
{chr(10).join(cards)}
    </div>
  </section>

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

<script src="{root}main.js" defer></script>
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
