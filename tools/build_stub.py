"""Build the root placeholder ("заглушка") for fellmise.com.

    python tools/build_stub.py

One screen: brand, the hero line, the descriptor, the two CTAs, a small village
scene from existing art, and the language switch. Carries the full SEO head —
canonical, hreflang, OG/Twitter and the three JSON-LD blocks — because the whole
point of the placeholder is to hold the domain's search footprint while the real
site is rebuilt on journey-v2.

The complete iteration-4 site is NOT deleted: build_site.py still generates it,
and it is published at /full/ with noindex so it can be compared and promoted
back with a one-line change. robots.txt disallows /full/ and /next/ so neither
competes with the root.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from build_site import I18N, att, esc, json_ld  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
VER = "1"

# a few sprites make it feel like the game, not a parked domain
SCENE = [
    ("house-b", "hero_house_b"),
    ("tree", "hero_tree_a"),
    ("house-a", "hero_house_a"),
]

CSS = """/* fellmise.com — placeholder. Self-contained: the full site's stylesheet is
   not loaded here, so the page stays small and cannot drift with it. */
:root {
  --grass-1: #a8cb53; --grass-2: #bdd85a; --path: #f2ca78;
  --wood: #a6744a; --wood-dark: #7c5233; --roof: #88362b;
  --ink: #383b2d; --cream: #fdf6e0;
  --sky-1: #7eb8e0; --sky-2: #c7e6f2;
  --display: "Podkova", Georgia, serif;
  --body: "Vollkorn", Georgia, serif;
  --mono: "PT Mono", ui-monospace, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--cream); color: var(--ink);
  font-family: var(--body); font-size: 18px; line-height: 1.6;
  display: flex; flex-direction: column; min-height: 100vh;
}
img { display: block; max-width: 100%; height: auto; }

.top {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; padding: 1rem clamp(1rem, 4vw, 2.5rem); background: var(--ink);
}
.logo {
  font-family: var(--display); font-weight: 700;
  font-size: clamp(1.15rem, 2.6vw, 1.6rem); letter-spacing: .12em;
  color: var(--cream); text-decoration: none; text-shadow: 2px 2px 0 var(--roof);
}
.lang { display: flex; gap: .3rem; font-family: var(--mono); font-size: .75rem; }
.lang a, .lang span {
  padding: .28rem .5rem; border: 2px solid var(--cream); line-height: 1; text-decoration: none;
}
.lang span { background: var(--cream); color: var(--ink); }
.lang a { color: var(--cream); }

.scene { position: relative; height: clamp(200px, 34vh, 380px); overflow: hidden;
         background: linear-gradient(180deg, var(--sky-1), var(--sky-2)); }
.scene__ground {
  position: absolute; left: 0; right: 0; bottom: 0; height: 46%;
  background: linear-gradient(180deg, var(--grass-1), var(--grass-2));
}
.scene__road { position: absolute; left: 0; right: 0; bottom: 0; height: 13%; background: var(--path); }
.sp { position: absolute; bottom: 12%; }
.sp img { height: 100%; width: auto; }
.sp--house-b { left: 6%;  height: 62%; }
.sp--tree    { left: 38%; height: 56%; }
.sp--house-a { left: 62%; height: 70%; }

main { flex: 1; text-align: center; padding: clamp(1.5rem, 5vw, 3rem) clamp(1rem, 4vw, 2.5rem); }

.sign {
  display: inline-block; max-width: min(48rem, calc(100vw - 32px));
  background: repeating-linear-gradient(180deg, var(--wood) 0 16px, var(--wood-dark) 16px 19px);
  border: 4px solid var(--ink); box-shadow: 6px 6px 0 var(--ink);
  padding: clamp(1rem, 3vw, 1.9rem) clamp(1rem, 3.5vw, 2.2rem);
}
.sign h1 {
  margin: 0; font-family: var(--display); font-weight: 700;
  font-size: clamp(22px, 4.2vw, 40px); line-height: 1.22; color: var(--cream);
  text-shadow: 2px 3px 0 rgba(0,0,0,.5); overflow-wrap: break-word;
}
.sign p {
  margin: .9rem 0 0; padding-top: .85rem;
  border-top: 3px solid rgba(253,246,224,.35);
  font-weight: 600; font-size: clamp(15px, 1.9vw, 19px);
  color: var(--cream); text-shadow: 1px 2px 0 rgba(0,0,0,.4);
}

.cta { margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: .9rem; justify-content: center; }
.btn {
  font-family: var(--body); font-weight: 700; font-size: 1.05rem;
  padding: .85rem 1.4rem; border: 4px solid var(--ink); box-shadow: 4px 4px 0 var(--ink);
  text-decoration: none; cursor: pointer;
}
.btn--steam { background: #b9b6ab; color: #4a4942; cursor: not-allowed; }
.btn--discord { background: var(--grass-1); color: var(--ink); }

.note { margin: clamp(1.5rem, 4vw, 2.5rem) auto 0; max-width: 44rem;
        font-family: var(--mono); font-size: .8rem; color: rgba(56,59,45,.8); }

.foot {
  background: var(--ink); color: var(--cream);
  padding: 1.4rem clamp(1rem, 4vw, 2.5rem);
  display: flex; flex-wrap: wrap; gap: .6rem 1.6rem;
  align-items: center; justify-content: space-between;
  font-family: var(--mono); font-size: .78rem;
}
.foot a { color: var(--cream); }

@media (max-width: 620px) {
  .sp--tree { display: none; }
  .sp--house-b { left: 2%; height: 58%; }
  .sp--house-a { left: 52%; height: 66%; }
  .cta { flex-direction: column; align-items: stretch; }
  .btn { width: 100%; text-align: center; }
  .foot { justify-content: center; text-align: center; }
}
"""


def build(lang):
    t = I18N[lang]
    a = "assets/" if lang == "en" else "../assets/"
    root = "" if lang == "en" else "../"
    scene = "\n".join(
        f'    <div class="sp sp--{cls}"><img src="{a}{name}.webp" alt="" '
        f'loading="eager" decoding="async"></div>'
        for cls, name in SCENE)

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
{json_ld(t, lang)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" media="print" onload="this.media='all'"
      href="https://fonts.googleapis.com/css2?family=Podkova:wght@700&family=Vollkorn:wght@400;600;700&family=PT+Mono&display=swap">
<noscript><link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Podkova:wght@700&family=Vollkorn:wght@400;600;700&family=PT+Mono&display=swap"></noscript>
<link rel="stylesheet" href="{root}stub.css?v={VER}">
</head>
<body>

<header class="top">
  <a class="logo" href="{root or './'}">FELLMISE</a>
  <nav class="lang" aria-label="Language">
    <span aria-current="true">{esc(t['self_label'])}</span>
    <a href="{t['other_href']}" hreflang="{'ru' if lang == 'en' else 'en'}">{esc(t['other_label'])}</a>
  </nav>
</header>

<div class="scene" aria-hidden="true">
  <div class="scene__ground"></div>
  <div class="scene__road"></div>
{scene}
</div>

<main>
  <div class="sign">
    <h1>{esc(t['tagline'])}</h1>
    <p>{esc(t['descriptor'])}</p>
  </div>
  <div class="cta">
    <button class="btn btn--steam" disabled>{esc(t['cta_steam'])}</button>
    <!-- TODO: подставить инвайт, когда создан сервер Discord -->
    <a class="btn btn--discord" href="#">{esc(t['cta_discord'])}</a>
  </div>
  <p class="note">{esc(t['disclaimer'])}</p>
</main>

<footer class="foot">
  <span>fellmise.com</span>
  <span>{esc(t['rights'])}</span>
  <nav aria-label="Links">
    <a href="#">{esc(t['discord'])}</a> ·
    <a href="#">{esc(t['steam'])}</a> ·
    <a href="{t['other_href']}">{esc(t['other_label'])}</a>
  </nav>
</footer>

</body>
</html>
"""


def main():
    (ROOT / "stub.css").write_text(CSS, encoding="utf-8")
    (ROOT / "index.html").write_text(build("en"), encoding="utf-8")
    (ROOT / "ru").mkdir(exist_ok=True)
    (ROOT / "ru" / "index.html").write_text(build("ru"), encoding="utf-8")
    for p in ("index.html", "ru/index.html", "stub.css"):
        print(f"{p:<16} {(ROOT/p).stat().st_size/1024:.1f} KB")


if __name__ == "__main__":
    main()
