"""Сайт не должен зависеть от файлов, которых нет в репозитории. No network.

    python tools/check_runtime_refs.py

GitHub Pages публикует ровно то, что лежит в git. Файл, который есть только на
диске разработчика — в игнорируемом out/ или просто не добавленный, — локально
работает, а на сайте отдаёт 404. Так уже было: плиты Depth Journey лежали в
out/, и опубликованный /depth-v2/ остался без единой сцены.

Проверяется весь опубликованный runtime-код (HTML, JS, CSS), а не список
известных имён:

  1. ни одной ссылки в out/ — ни '/out/…', ни 'out/…', ни '../out/…';
  2. каждый абсолютный локальный URL файла ('/assets/…', '/depth-v2/…' и т.п.)
     отслеживается git.

Имена, собранные в JS из частей (BASE + имя из index.json), статически не
разрешить честно: манифесты билдеров несут и служебные поля — маски сборки,
неиспользуемые вырезки, — которые сайту не нужны и не отгружаются. Что сайт
запрашивает на самом деле, проверяет браузерный smoke
tests/browser/smoke/depth.spec.mjs: он проходит каждый роут целиком на чистом
checkout и падает на любом 404 и любом запросе в out/.

Exit 1 со списком нарушений, 0 когда чисто.
"""

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# что публикуется как часть сайта; инструменты, тесты и исходники сборок — нет
RUNTIME_EXT = (".html", ".js", ".css")
NOT_RUNTIME = ("tests/", "tools/", ".github/", "journey3/", "out/", "node_modules/")
# сборочные скрипты в папке маршрута исполняются в Node, а не в браузере
DEV_ONLY = re.compile(r"(^|/)(build_[\w-]+\.mjs|capture[\w-]*\.mjs|shots[\w-]*\.mjs)$")

OUT_REF = re.compile(r"""["'(=]\s*(?:\.{1,2}/)*/?out/[\w./-]*""")
ABS_FILE = re.compile(
    r"""["'(]\s*(/(?:assets|depth-v2|proto|next|full|ru)/[^"'()\s?#]+?"""
    r"""\.(?:webp|png|jpe?g|svg|gif|json|js|mjs|css|webm|m4a|mp3|ogg|woff2?))["')?#]""")


def git_files():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True,
                         text=True, check=True).stdout
    return set(out.split("\n")) - {""}


def main():
    tracked = git_files()
    runtime = sorted(f for f in tracked
                     if f.endswith(RUNTIME_EXT)
                     and not f.startswith(NOT_RUNTIME)
                     and not DEV_ONLY.search(f))
    bad = []

    for rel in runtime:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        for m in OUT_REF.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            bad.append(f"{rel}:{line}: ссылка в игнорируемый out/ — {m.group(0).strip()!r}")
        for m in ABS_FILE.finditer(text):
            url = m.group(1)
            if url.lstrip("/") not in tracked:
                line = text.count("\n", 0, m.start()) + 1
                bad.append(f"{rel}:{line}: {url} не отслеживается git — на сайте будет 404")

    if bad:
        print(f"check_runtime_refs: FAIL, {len(bad)}")
        for b in bad:
            print(f"  - {b}")
        return 1
    print(f"check_runtime_refs: чисто ({len(runtime)} runtime-файлов)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
