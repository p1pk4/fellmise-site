"""Build the three documents of the journey from one body.

    python tools/build_pages.py            # write index.html, ru/index.html, proto/index.html head
    python tools/build_pages.py --check    # CI: fail if any of them is out of date

One journey, three documents:

    /            the production page, English only      (indexable, canonical /)
    /ru/         the production page, Russian only      (indexable, canonical /ru/)
    /proto/      the preview, both locales + ?lang=     (noindex, canonical /)

The body (the live canvas, the content points and the key art windows) is authored
and generated once, in proto/index.html: tools/build_proto_content.py writes the
content points there and tools/key_art.py the key art figures, both from
assets/topdown/*.json. This tool only derives the two production documents from it:
it keeps the same <style> and the same #journey markup, drops the locale the
document does not serve, and puts the right head on top. Nothing is authored twice.

The runtime engine is NOT copied: every document loads the same modules from
/proto/ (mode.js, boot.js, fallback.css), and the engine resolves its own
resources from its module URL, so the document's depth does not matter.

The head (title, description, canonical, hreflang, OG, Twitter, the three JSON-LD
blocks) comes from the same I18N table the previous root placeholder used
(tools/build_site.py), so the search footprint of the domain does not change.
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from build_site import I18N, att, json_ld  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROTO = ROOT / "proto"
SITE = "https://fellmise.com"
ENGINE = "/proto"                      # the one place the runtime lives


def read(p):
    return (ROOT / p).read_text(encoding="utf-8")


def body_of(page):
    """<style> block and the #journey markup of proto/index.html."""
    style = page[page.index("<style>"):page.index("</style>") + 8]
    body = page[page.index("<main id=\"journey\">"):page.index("</main>") + 7]
    head_extra = re.search(r'(<div id="biome-transition-overlay".*?</div>\s*<div id="hud".*?</div>)', page, re.S).group(1)
    return style, head_extra, body


def only_locale(body, lang):
    """Keep one <section class="content-locale">: a production page serves one language."""
    out = []
    for m in re.finditer(r'\n?  <section class="content-locale"[^>]*data-locale="(\w+)".*?\n  </section>', body, re.S):
        if m.group(1) != lang:
            out.append((m.start(), m.end()))
    for a, b in reversed(out):
        body = body[:a] + body[b:]
    # the kept section is the only one: it is never hidden, and mode.js keeps it visible
    body = body.replace(f'<section class="content-locale" lang="{lang}" data-locale="{lang}" hidden>',
                        f'<section class="content-locale" lang="{lang}" data-locale="{lang}">')
    return body


def key_art_locale(body, lang):
    """One alt text per document, on the lazy <img> and on its <noscript> twin alike:
    a single-locale page must read correctly also without JavaScript (mode.js swaps
    alt at runtime only for the preview, which keeps both)."""
    def fig(m):
        block = m.group(0)
        ru = re.search(r'data-alt-ru="([^"]*)"', block)
        if lang == "ru" and ru:
            block = re.sub(r'alt="[^"]*"', 'alt="' + ru.group(1).replace("\\", "\\\\") + '"', block)
        return re.sub(r'\s*data-alt-ru="[^"]*"', "", block)
    return re.sub(r'<figure class="key-art".*?</figure>', fig, body, flags=re.S)


def head(lang, route, *, index=True, canonical=None):
    t = I18N[lang]
    canonical = canonical or f"{SITE}{route}"
    robots = "" if index else '<meta name="robots" content="noindex, nofollow">\n'
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{robots}<title>{att(t['title'])}</title>
<meta name="description" content="{att(t['desc'])}">
<link rel="canonical" href="{canonical}">
<link rel="alternate" hreflang="en" href="{SITE}/">
<link rel="alternate" hreflang="ru" href="{SITE}/ru/">
<link rel="alternate" hreflang="x-default" href="{SITE}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fellmise">
<meta property="og:locale" content="{'en_US' if lang == 'en' else 'ru_RU'}">
<meta property="og:title" content="{att(t['title'])}">
<meta property="og:description" content="{att(t['desc'])}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE}/assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{att(t['title'])}">
<meta name="twitter:description" content="{att(t['desc'])}">
<meta name="twitter:image" content="{SITE}/assets/og.jpg">
<meta name="theme-color" content="#1a2216">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32">
<link rel="icon" href="/assets/icon-512.png" sizes="512x512">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
{json_ld(t, lang)}"""


def page(lang, route, body_parts, *, index=True, canonical=None, locales=None):
    style, overlays, body = body_parts
    if locales:
        body = only_locale(body, locales)
        body = key_art_locale(body, locales)
    return (head(lang, route, index=index, canonical=canonical) + style + f"""
<link rel="stylesheet" href="{ENGINE}/fallback.css">
<script src="{ENGINE}/mode.js"></script>
</head>
<body>
{overlays}
{body}
<script type="module" src="{ENGINE}/boot.js"></script>
</body>
</html>
""")


def proto_page(body_parts):
    """The preview keeps both locales and ?lang=; it is not indexed and points at the root."""
    style, overlays, body = body_parts
    return (head("en", "/proto/", index=False, canonical=f"{SITE}/") + style + f"""
<link rel="stylesheet" href="./fallback.css">
<script src="./mode.js"></script>
</head>
<body>
{overlays}
{body}
<script type="module" src="./boot.js"></script>
</body>
</html>
""")


def build():
    parts = body_of(read("proto/index.html"))
    return {
        "index.html": page("en", "/", parts, locales="en"),
        "ru/index.html": page("ru", "/ru/", parts, locales="ru"),
        "proto/index.html": proto_page(parts),
    }


def main(argv):
    pages = build()
    check = "--check" in argv
    bad = []
    for rel, text in pages.items():
        p = ROOT / rel
        old = p.read_text(encoding="utf-8") if p.exists() else None
        if check:
            if old != text:
                bad.append(rel)
        elif old != text:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline="\n")
            print("written:", rel)
        else:
            print("current:", rel)
    if check:
        for rel in bad:
            print(f"build_pages: {rel} is out of date — run python tools/build_pages.py")
        if bad:
            return 1
        print("build_pages: index.html, ru/index.html, proto/index.html are current")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
