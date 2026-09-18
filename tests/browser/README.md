# Browser smoke + visual regression

Tooling only, никогда не попадает на сайт. Playwright 1.63.0 (Chromium), pngjs.
Сайт отдаётся как статика из checkout'а (`lib/server.mjs`, только 127.0.0.1),
внешние запросы (Google Fonts) отвечаются локально: сеть не нужна.

## Установка

```
npm ci --prefix tests/browser
npx --prefix tests/browser playwright install chromium     # в CI: --with-deps
```

## Smoke

```
npm run smoke --prefix tests/browser                       # этот checkout
SITE_ROOT=/путь/к/другому/checkout npm run smoke --prefix tests/browser
```

Покрытие: `/`, `/ru/`, robots/sitemap, `/proto/` (WebGL, готовность, зумы, точки
`__PROTO.go`), `/next/` live и fallback (<760px, reduced-motion, без WebGL), `/full/`.
`KNOWN BUG` — воспроизведённые дефекты (`test.fail`): тест зелёный, пока дефект
есть, и краснеет, когда его починят.

## Visual

Контрольные кадры, viewport, deviceScaleFactor и допуски — `checkpoints.json`.

```
cd tests/browser
node visual.mjs run --base main                          # main -> рабочее дерево
node visual.mjs run --base main --head site-x --mode strict
node visual.mjs capture --root <checkout> --out <dir>    # только снять
node visual.mjs compare --base <dir> --head <dir> --out <dir> [--mode strict]
node visual.mjs selftest                                 # раннер ловит изменения?
```

`run` поднимает git worktree для ref'ов во временной папке и удаляет их после.
Результат: `out/visual/{base,head,diff}/*.png`, `report.json`, `report.md`.

* **report** — отличия измеряются и публикуются, exit 0 (падает, только если
  head не снялся).
* **strict** — любой кадр с отличием больше `tolerance.strict_max_changed_pixels`
  (сейчас 0) или без пары — exit 1. Для изменений, которые не должны быть видны.
  В CI включается меткой PR `visual-strict`.

Эталонные PNG не хранятся в git: base и head снимаются в одном окружении в
момент сравнения.
