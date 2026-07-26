# DEVLOG — fellmise_site

История работ по сайту `fellmise.com`. Новые записи — сверху, время локальное.
Правила ведения — общие для проектов (см. глобальный `CLAUDE.md`).

---

## 2026-07-26 06:20 — MVP-сайт fellmise.com: вёрстка, web-экспорт, деплой
- **Что:** собран и задеплоен статический двуязычный сайт (EN/RU) из арт-пака v1.
  Hero — CSS-сцена (небо → трава → тропа) со спрайтами на absolute-позициях,
  parallax на скролле, покачивание деревьев, тинт день/ночь/закат/рассвет по
  локальному времени посетителя. 8 карточек-«домиков», полоса ресурсов,
  дисклеймер, футер, SEO/OG/hreflang. Перед вёрсткой закрыты два дефекта пака:
  `res_iron` перегенерён с цветовым якорем (v1 на всех 4 сидах давал серый
  камень, железо не читалось), и у 5 спрайтов выбита прозрачность в замкнутых
  областях фона. Деплой — GitHub Pages, `p1pk4/fellmise-site`, CNAME
  `fellmise.com`; DNS у регистратора переключается руками.
- **Тип:** feat
- **Проверка:** HTML-валидация ✓ (0 битых ссылок, 26/26 img с alt, теги
  сбалансированы) · Pages build ✓ · отдача 200 по EN, RU, css, js, webp, og ✓
  (через `--resolve` на IP Pages, пока DNS не переключён) · вес страницы 0.98 MB
  при цели <1.5 MB ✓ · runClient n/a
- **Commit:** 91175d4, d43d484

**Impact trace**

Создано (`fellmise_site/`):
- `index.html`, `ru/index.html` — генерируются `tools/build_site.py`, коммитятся как статика
- `styles.css`, `main.js`
- `assets/` — 26 WebP + 26 PNG-fallback, `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png`, `og.png`, `og.jpg`
- `tools/build_site.py`, `tools/export_web.py`, `tools/fix_holes.py`, `tools/regen_res_iron.py`
- `CNAME`, `.nojekyll`, `.gitignore`, `DEVLOG.md`

Изменено (`out/site_assets/final/`):
- `res_iron.png` — перегенерация v2 (сид 4004), новый промпт с цветовым якорем
- `feat_skills.png`, `res_bow.png`, `hero_well.png`, `hero_cart.png`, `feat_world.png` — выбиты замкнутые области фона (11 областей)
- `out/site_assets/report.json` — обновлены `chosen`/`object` для `res_iron`, помечен семантический дрейф `feat_death`

Изменено (`fellmise/`):
- `tracker/marketing/marketing.md` — новый файл, статусы домена / арт-пака / деплоя

---

## 2026-07-25 23:33 — Арт-пак сайта v1: 26 объектов на боевом пресете
- **Что:** сгенерирован пак для сайта на пресете `objects_battle_v1`
  (FLUX.1-dev fp8 + `fellmise_objects_v1` @0.7, без blue2d, euler/simple,
  20 шагов, guidance 3.5, cfg 1.0, 1024²): 26 заданий × 4 сида = 104 кадра.
  Автофильтр — флуд-филл из углов (заливка ≥15%, один связный объект, ≤2 края),
  импортируется из `acceptance_metrics`, а не переписан. Годность 104/104,
  спрайт получили 26/26 заданий. Обе экзотики (корабль-призрак, тотем) прошли
  без коллапса к постройке. Персонажи, портреты фракций и UI-иконки не
  генерировались — за границей применимости v1.
- **Тип:** feat
- **Проверка:** флуд-филл 104/104 ✓ · прозрачность финалов 26/26 ✓ ·
  визуальный просмотр контактного листа ✓ (3 кадра перевыбраны по типу:
  `res_pickaxe` — топор вместо кирки, `res_bow` — арбалет, `feat_nemesis` —
  крен к постройке) · runClient n/a
- **Commit:** 91175d4 (внесён вместе с сайтом — репозиторий заведён этим батчем)

**Impact trace**

Создано (`fellmise_site/`):
- `tools/site_tasks.py`, `tools/gen_site_pack.py`, `tools/filter_site_pack.py`
- `out/site_assets/` — 104 кадра, 26 вырезанных PNG с прозрачностью, `report.json`, `contact_sheet.png`
