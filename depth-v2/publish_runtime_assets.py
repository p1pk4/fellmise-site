"""Публикация runtime-ассетов Depth Journey: out/ -> assets/depth/.

    python depth-v2/publish_runtime_assets.py          скопировать
    python depth-v2/publish_runtime_assets.py --check  проверить

Контракт. Билдеры depth-v2/build_*.py пишут рабочий вывод в out/depth-v2/ —
вместе с контактными листами, масками и отладкой. out/ игнорируется git и на
сайт не попадает. Сайт грузит только assets/depth/: туда этот шаг переносит
ровно файлы из depth-v2/runtime_assets.json, байт в байт, и больше ничего.

--check:
  * каждый dst из манифеста существует и отслеживается git — иначе сайт
    опирался бы на локальный файл, которого нет в репозитории;
  * если рабочий вывод out/ есть рядом (локально, после сборки), каждый dst
    байт в байт совпадает со своим src — иначе опубликована устаревшая плита.
    В чистом клоне out/ нет, и эта часть честно пропускается.

Exit 1 со списком расхождений, 0 когда чисто.
"""

import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "depth-v2" / "runtime_assets.json"


def tracked():
    out = subprocess.run(["git", "ls-files", "assets/depth"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout
    return set(out.split())


def main():
    check = "--check" in sys.argv
    items = json.loads(MANIFEST.read_text(encoding="utf-8"))["assets"]
    bad, compared, skipped = [], 0, 0
    git_files = tracked() if check else set()

    for it in items:
        src, dst = ROOT / it["src"], ROOT / it["dst"]
        if not check:
            if not src.is_file():
                bad.append(f"нет рабочего файла {it['src']} — сначала соберите билдером")
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            continue
        if not dst.is_file():
            bad.append(f"нет опубликованного {it['dst']}")
            continue
        if it["dst"] not in git_files:
            bad.append(f"{it['dst']} не отслеживается git — на сайт не попадёт")
        if src.is_file():
            compared += 1
            if src.read_bytes() != dst.read_bytes():
                bad.append(f"{it['dst']} отличается от {it['src']} — запустите публикацию")
        else:
            skipped += 1

    if bad:
        print("publish_runtime_assets: FAIL")
        for b in bad:
            print("  -", b)
        return 1
    if check:
        tail = f", сравнено с out/: {compared}" + (f", out/ нет: {skipped}" if skipped else "")
        print(f"publish_runtime_assets: чисто ({len(items)} файлов{tail})")
    else:
        print(f"publish_runtime_assets: опубликовано {len(items)} файлов в assets/depth/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
