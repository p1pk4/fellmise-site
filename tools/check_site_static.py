"""Static sanity of what GitHub Pages will publish. No network, no browser.

    python tools/check_site_static.py

Pages serves the repository root as-is on every push to main, so the things
that must never break silently are checked here, on files:

  - every published entry page exists;
  - the domain file still says fellmise.com;
  - the root pages are indexable and carry their SEO head;
  - every preview (/proto/, /next/, /full/) says noindex;
  - robots.txt and sitemap.xml exist and agree with the above.

Exit code 1 with the full list of failures, 0 when clean.
"""

import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent

INDEXABLE = ["index.html", "ru/index.html"]
NOINDEX = ["proto/index.html", "next/index.html", "next/ru/index.html",
           "full/index.html", "full/ru/index.html"]
REQUIRED = INDEXABLE + NOINDEX + ["robots.txt", "sitemap.xml", "CNAME", ".nojekyll"]

ROBOTS_META = re.compile(r'<meta\s+name="robots"\s+content="([^"]*)"', re.I)
LD_JSON = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def robots_of(html):
    return [c.lower() for c in ROBOTS_META.findall(html)]


def main():
    bad = []

    for rel in REQUIRED:
        if not (ROOT / rel).is_file():
            bad.append(f"нет файла {rel}")
    if bad:
        return finish(bad)

    cname = read("CNAME").strip()
    if cname != "fellmise.com":
        bad.append(f"CNAME = {cname!r}, ожидается 'fellmise.com'")

    for rel in INDEXABLE:
        html = read(rel)
        if any("noindex" in c for c in robots_of(html)):
            bad.append(f"{rel}: корневая страница помечена noindex")
        for what, pat in (("<title>", r"<title>[^<]+</title>"),
                          ("canonical", r'<link rel="canonical" href="https://fellmise\.com/'),
                          ("description", r'<meta name="description" content="[^"]+"')):
            if not re.search(pat, html):
                bad.append(f"{rel}: нет {what}")
        types = set()
        for block in LD_JSON.findall(html):
            try:
                types.add(json.loads(block).get("@type"))
            except json.JSONDecodeError as exc:
                bad.append(f"{rel}: JSON-LD не парсится — {exc}")
        for t in ("VideoGame", "Organization", "WebSite"):
            if t not in types:
                bad.append(f"{rel}: нет JSON-LD {t}")

    for rel in NOINDEX:
        if not any("noindex" in c for c in robots_of(read(rel))):
            bad.append(f"{rel}: превью без noindex — будет конкурировать с корнем")

    robots = read("robots.txt")
    for line in ("Disallow: /next/", "Disallow: /full/",
                 "Sitemap: https://fellmise.com/sitemap.xml"):
        if line not in robots:
            bad.append(f"robots.txt: нет строки '{line}'")
    if re.search(r"^Disallow:\s*/\s*$", robots, re.M):
        bad.append("robots.txt: закрыт весь сайт (Disallow: /)")

    try:
        tree = ET.fromstring(read("sitemap.xml").encode("utf-8"))
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        locs = [e.text for e in tree.findall("s:url/s:loc", ns)]
        for want in ("https://fellmise.com/", "https://fellmise.com/ru/"):
            if want not in locs:
                bad.append(f"sitemap.xml: нет {want}")
        for loc in locs:
            if any(p in loc for p in ("/next/", "/proto/", "/full/")):
                bad.append(f"sitemap.xml: превью в карте сайта — {loc}")
    except ET.ParseError as exc:
        bad.append(f"sitemap.xml: не XML — {exc}")

    return finish(bad)


def finish(bad):
    if bad:
        print(f"check_site_static: FAIL, {len(bad)}")
        for b in bad:
            print(f"  - {b}")
        return 1
    print("check_site_static: чисто")
    return 0


if __name__ == "__main__":
    sys.exit(main())
