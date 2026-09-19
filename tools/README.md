# tools/ — генерация и сборка сайта

## Боевой пресет генерации

**С 2026-07-31 сайт генерит на `fellmise_sprite_v2` @ 0.7.**

| | |
|---|---|
| LoRA | `fellmise_sprite_v2.safetensors`, вес 0.7 (model и clip) |
| Воркфлоу | `D:\Dev\ART_Fellmise\workflows\objects_battle_v2.json` |
| Чекпойнт | `flux1-dev-fp8.safetensors` |
| Сэмплер | euler / simple, 20 шагов, cfg 1.0, guidance 3.5 |
| Размер | 1024×1024 |
| Промпт | `fllmse style, <объект>, game asset, top-down view, plain gray background` |
| Негативов | нет |

До 2026-07-31 сайт генерил на `fellmise_objects_v1` @ 0.7 (воркфлоу
`objects_battle_v1_archived.json`). Этим пресетом сделаны все кадры v1-эпохи:
`gen_site_pack.py`, `gen_batch2..4.py`, `gen_batch7.py` его и держат, и
переключать их нельзя — иначе прошлые батчи перестанут воспроизводиться.
Новые генерации идут через `gen_regen_v2.py` и далее.

Основание для переключения — приёмочный прогон `run_lora_v2.py` +
`report_lora_v2.py` от 2026-07-30: по трёхуровневому вердикту пайплайна v2 даёт
**47/56 OK против 32/56** у v1, провальная пятёрка чинится (5/20 → 16/20),
деградации на эталонной нет, контурная резкость втрое выше. Ветка с листами —
`lora-v2-review`, запись в `DEVLOG.md`.

**Оговорка:** v2 склонна подрисовывать мягкий светлый ореол ЗА объектом. На
кристаллах это хуже, чем у v1. Промпты новых генераций пишутся с явным
запретом внешнего свечения, а пик по типу делается с приоритетом чистоты
силуэта над красотой.

Каждый gen-скрипт **переутверждает** весь пресет ассертами при загрузке
воркфлоу. Пресет объявляется один раз — в воркфлоу — и никогда не задаётся
кодом заново.

## Ракурс — обязательно для ВСЕХ генераций

Сцена рисует спрайты вертикальными биллбордами, а камера смотрит вдоль земли.
Значит годится только **фронтальный** ракурс. Изометрия — вид сверху под углом —
на вертикальной плоскости показывает верхнюю грань: крышу, верх подставки, нутро
чаши. Объект читается заваленным назад и висящим. Аудит 2026-07-31 нашёл такую
изометрию у 31 спрайта из 73; именно она несколько проходов подряд выглядела
«левитацией», хотя посадка на грунт была верной.

**Рабочая формулировка (позитивная):**

```
fllmse style, <объект>, game asset, orthographic front elevation,
straight-on eye level view, flat facade facing viewer, no ground base,
plain gray background
```

**Отрицание не работает.** Первый заход шёл с `front view, slightly elevated
camera angle, not isometric` — и переломил модель только на высоких компактных
объектах: 20 из 26. Шесть широких (два дома, ящики, три валуна) вернулись
изометрией на всех четырёх сидах. LoRA обучена на изометричном датасете, и этот
bias сильнее слова «not»: у объектов, у которых в обучении **всегда** была
подставка, модель её и рисует. Второй заход теми же объектами, но позитивной
формулировкой выше, дал фронт на всех шести с первой попытки.

Ключевые части, которые делают работу: `orthographic front elevation` (плоская
проекция вместо перспективы сверху) и `no ground base` (без подставки, которая и
тянет ракурс вверх).

**Пик — по ракурсу, а не по резкости.** Контурная резкость слепа к углу: чёткая
крыша, снятая сверху, наберёт больше, чем чуть мягкий фасад, а убрать надо
именно крышу. Поэтому в `filter_frontal.py` пик записывается руками в `PICKS` с
причиной, и **пока пик не записан, объект не отгружается вообще**. Тихий откат к
«самому резкому» вернул бы изометрию обратно в пак — это не гипотеза, это то,
что делал автопик в предыдущих батчах.

## Правила промптов

* Один объект в кадре, единственное число. Множественное («crystals», «runes»)
  модель понимает как «разложи несколько штук по кадру» и ломает флуд-филл.
* Плоский фон называется явно: `plain gray background`. Без этого фон уходит в
  сцену и вырез становится невозможен.
* Никаких «epic», «highly detailed», «8k», «masterpiece» — на этой LoRA они
  добавляют не качество, а мусор по краям.
* Дефект лечится промптом, а не сидом: если восемь кадров подряд дали не тот
  объект, менять надо формулировку. `branch_hanging` («hanging tree branch with
  leaves») дал целое дерево на 8 кадрах из 8 на обеих моделях — закрыт, ушёл в
  заметки к датасету v3.

## Сборка сайта

`journey3/node_modules` и `journey3/dist` в репозитории **не хранятся** — они
лежали в истории и стоили 70 МБ на каждый клон. Поэтому в свежем клоне первым
делом ставятся зависимости:

```
cd journey3
npm ci                      # ровно версии из package-lock.json, не npm install
npx vite build              # -> journey3/dist
cd ..
python tools/build_journey3.py deploy   # dist -> next/, next/ и коммитится
```

Если правились страницы или копия ассетов, перед сборкой:

```
python tools/build_journey3.py pages
```

Полный цикл с нуля, одной лентой:

```
git clone --single-branch --branch main https://github.com/p1pk4/fellmise-site.git
cd fellmise-site/journey3 && npm ci && npx vite build && cd ..
python tools/build_journey3.py deploy
```

`npm ci` требует `package-lock.json` и стирает `node_modules` перед установкой —
это и нужно: сборка обязана быть воспроизводимой, а `npm install` может тихо
подтянуть другие патч-версии.

## Окружение

Node — `.nvmrc` (24.15.0), Python — `.python-version` (3.11), пакеты Python —
`requirements.txt` (`pip install -r requirements.txt`). Генераторы артов
(`gen_*.py`) дополнительно требуют локальный ComfyUI-пайплайн
(`tools/pipeline.py`), в CI его нет.

## Расстановка: legacy (/next/) и top-down (/proto/)

Один генератор, два target:

```
assets/scene_spec.json ─┬─ generate_layout.py --target legacy ─→ assets/layout.json ─→ /next/
                        │     (id <sprite>#<n>, дорога 3.2, коридор полос)  ↑ Export редактора /next/ (POST /__layout)
                        │
assets/topdown/composition.json  (где стоят места, массы, участки — только вид сверху)
assets/topdown/config.json       (road_half_width 4.2, road_clearance, biome_spacing)
                        └─ generate_layout.py --target topdown ─→ assets/topdown/layout.generated.json
                              (tools/topdown_compose.py)              + assets/topdown/layout.overrides.json
                                                                      ─ topdown_layout.py ─→ layout.runtime.json ─→ /proto/
```

* `python tools/generate_layout.py` — оба target, плюс пересборка runtime.
  `--dry` ничего не пишет, `--check` падает, если committed-файл устарел.
  Для top-down печатается диагностика: число объектов, размах по X, заполнение
  полос |x|, длинные пустоты, объекты целиком за крупными. Это числа, не оценка.
* Legacy composition.json не читает; `assets/layout.json` для /next/ не меняется
  (тест держит его sha256).
* composition.json по биомам: `clusters` (место с ключом: `at` + `items` с dx/dz,
  или `group` из spec), `fences` (отрезок строго вдоль X или Z — границы
  участков), `masses` (много однотипного в области, Poisson по хешу),
  `scatter`, `boards` (куда встать доскам spec), `whitelist_extra` (с причиной).
  Спрайты, высоты, группы, whitelist и тексты досок — из scene_spec.json.
* Геометрия — рендерера: спрайт лежит плашмя, низ на z + h/2; след — нижняя
  полоса спрайта. Дорога — та же, что в шейдере: сплайн `road_spline.json`
  через Catmull-Rom three.js (64 выборки), полуширина × множитель ширины.
  Python-копия сверяется с three.js (`node tools/road_samples.mjs` →
  `tests/fixtures/road_samples.json`; перезапустить при смене сплайна).
* Валидатор top-down: след объекта не заходит на дорогу + `road_clearance`
  (кроме road_props и объектов с `on_road: true`), следы не пересекаются
  (кроме стыков заборов), висящих без `hanging` нет. Списка «известных
  нарушений» нет: их ноль.
* `layout.generated.json` и `layout.runtime.json` руками не правятся. Ручные
  правки — только в `layout.overrides.json`: `{id: {pos|h|rotY|visible}}`, только
  отличия. Id, которого нет в генерации, — ошибка, а не тихий пропуск.
* Top-down export: `POST /__topdown/layout` в `editor_serve.py` принимает весь
  отредактированный runtime-layout, сам вычисляет overrides относительно
  generated, пишет overrides и пересобирает runtime. Generated не пишется никогда.
* Стабильный id: `<биом>/<ключ места>/<ключ элемента>` или
  `<биом>/<ключ места>/<спрайт>.<n>` (n — среди таких же в этом месте), заборы
  `<биом>/<ключ отрезка>/hero_fence.<n>`, массы `<биом>/<ключ массы>/c<кандидат>`,
  scatter `<биом>/scatter/c<кандидат>`, доски `<биом>/board/<key>`. Jitter и
  поворот хешируются от id, поэтому вставка нового места ничего не сдвигает.
  Биом без описания в composition.json собирается по ритму spec; такт с явным
  `key` сохраняет id при вставке такого же такта выше.

## Вид биомов и переходы (/proto/)

```
assets/topdown/presentation.json   (грунт, палитра, растительность, якоря переходов)
assets/topdown/config.json         (biome_spacing, road_end_z)
        └─ generate_layout.py → layout.presentation + road_end_z в runtime
              → proto/main.js: uniforms шейдера грунта, затемнение перехода,
                доля травяных декалей, __PROTO.presentationAt(z)
```

* Грунт — одна плоскость и один шейдер. Слои: трава, мох (`tile_spirit`),
  плиты (`tile_dirt`, пол шахты), земля (зерно дорожного тайла); веса из
  presentation, пятнами по шуму. Палитра биома (tint, насыщенность, яркость)
  ложится на весь грунт вместе с дорогой; спрайты не перекрашиваются.
* Переход задан якорем там, где композиция сужает путь (локальный z биома, в
  который ведёт переход): грунт меняется от `lead` метров до якоря до `tail`
  после, граница сбита шумом, затемнение кадра — только около якоря и только
  от положения камеры.
* Дорога кончается у финального дома: `config.json road_end_z` = низ объекта
  `road_terminal` в composition (проверяется). `make_road_spline.py` строит
  сплайн до этой точки; шейдер, JS и Python-модель закругляют торец, дальше
  полотна нет. После смены сплайна — `node tools/road_samples.mjs`.

## Контакт объектов с землёй (/proto/)

`python tools/sprite_contact.py` → `proto/sprite_contact.json`: для каждого
спрайта — строка основания, ширина и центр основания, посчитанные по той
текстуре, что грузит /proto/ (вырезанные — по месту выреза цоколя, остальные —
по нижнему сплошному отрезку, чтобы ствол дерева считался, а травинка нет).
Тень объекта центрируется на этой линии (с учётом поворота спрайта), без
смещения по свету; ширина — ширина основания, глубина мала и ограничена
(`presentation.json → contact_shadow`). `--check` — в CI.

Ремонт низа (sprite bottom repair): `hero_house_b`, `hero_house_a`, `hero_well`
в `proto/sprites_stripped/` — вариант B: основание восстановлено из исходника
без земли + inpaint только полосы основания, выше неё — исходные пиксели.
Список — `index.json → repaired`; `strip_pedestal.py` их не пересобирает,
`sprite_contact.py` меряет их по правилу run (основание снова цельное), а
`topdown_compose.py` держит прежнюю ширину следа (`layout_foot`), чтобы layout
не сдвинулся. Лист «PR #4 | PR #6 | repaired»: `node tests/browser/sprite_repair_review.mjs`.

Диагностика: `node tests/browser/grounding_diag.mjs` (варианты тени A–E на 7
объектах, маркеры контакта) и `--review <git ref>` («было | стало»,
`grounding-final-review.png`). Proto подменяется в памяти, файлы не трогаются.

## Контентные точки /proto/

```
assets/topdown/content_points.json ─ tools/build_proto_content.py ─→ proto/index.html (статические <article>)
                                                                  └→ proto/main.js только активирует их
```

* 5 точек, по одной на биом. Якорь — стабильный id доски layout
  (`village/board/world_plays_itself` …); доска-якорь рисуется знаком
  `prop_signpost` без букв, остальные доски в /proto/ не рисуются (в layout
  остаются).
* Тексты не сочиняются: каждый title/body — дословная цитата
  `tools/build_site.py` FEATURES (kicker — имя биома из `tools/biomes.py`);
  `--check` падает при расхождении, плейсхолдере, пустой локали, битом якоре
  или перекрытии окон.
* Все карточки обеих локалей есть в HTML до скрипта (SEO, screen reader,
  будущий static fallback). EN видна, RU — в `hidden`-секции; `/proto/?lang=ru`.
* Присутствие карточки — чистая функция z камеры (core/range из JSON), без
  таймеров; окна не перекрываются, видна максимум одна.
* `python tools/build_proto_content.py` — пересобрать HTML; `--check` — в CI;
  `node tests/browser/content_review.mjs` — лист `content-points-review.png` и
  `content-copy.md` (в CI — артефакт `content-review-*`).
* Visual: мировые чекпоинты снимаются без слоя карточек, контентные
  (`content` в checkpoints.json) — с ним.
* Отладочная панель (HUD) скрыта; `/proto/?debug=hud` — показать. При падении
  сцены она открывается сама с текстом ошибки.

## Хореография зума /proto/

`assets/topdown/camera_choreography.json` → высота кадра — чистая функция z
камеры (`frameAt` в `proto/main.js`, эталон и проверки — `tools/camera_choreography.py`).

* Между фокусами — обзор 40 м; у фокуса (стабильный объект layout) кадр
  плавно (smootherstep) сходится к своей высоте и возвращается. Пределы 16..40 м.
* 5 фокусов: таверна, мёртвый дуб, вход в шахту, склеп, финальный дом.
  Окна фокусов не заходят в затемнение переходов и не перекрываются.
* Финал: последний фокус (`final`) без выхода — держится до `route_end` (дом − 4 м),
  где путь камеры кончается: колесо дальше не везёт, назад — как обычно.
* Режим по умолчанию — `auto`. `__PROTO.go(z, 'auto' | 'overview' | 'close')`
  (старые 'обзор'/'близко' тоже); клавиша Z — только с `?debug=hud` или `?debug=zoom`.
* `python tools/camera_choreography.py` — профиль маршрута; `--check` — в CI;
  `node tests/browser/zoom_review.mjs` — `zoom-choreography-review.png` и
  `zoom-route-strip.png` (в CI — артефакт `zoom-review-*`).

## Key art /proto/ (планирование)

`assets/topdown/key_art.json` — слоты будущих иллюстраций (status `planned`, картинок нет).

* Слот — DOM-окно поверх мира, как контентная карточка: якорь — стабильный
  объект layout + `peak_offset`, присутствие — та же функция z (core/range),
  сторона и вертикаль — как у карточки. Мир (Three.js) не трогается.
* Окна — только там, где маршрут свободен: нет карточки, фокуса камеры,
  затемнения перехода (`python tools/key_art.py --check`, в CI).
* В обычном /proto/ нет ничего: ни запроса, ни DOM. `/proto/?debug=keyart` —
  нейтральные заглушки нужного размера; `node tests/browser/key_art_review.mjs`
  → `key-art-slots-review.png`, `key-art-route-review.png` (в CI — артефакт
  `key-art-planning-*`). ТЗ для ART-сессии — `out/key-art-planning/art-briefs.md`.
* Потом: `<figure><img loading=lazy>` с размерами из JSON; грузить за
  `preload_ahead_m` до окна; в статическом fallback — картинка рядом со своей
  контентной точкой (`supports.content_point`); alt EN/RU — по готовому арту.

## Проверки (они же в CI, `.github/workflows/ci.yml`)

```
python tools/check_site_static.py        # страницы, CNAME, noindex, robots, sitemap
python tools/generate_layout.py --check  # committed layouts актуальны
python tools/topdown_layout.py --check   # overrides валидны, runtime актуален
python tools/build_proto_content.py --check  # контентные точки: источник и proto/index.html
python tools/camera_choreography.py --check   # хореография зума
python tools/key_art.py --check               # план key art (слоты)
python tools/test_layout.py              # стабильные id, overrides, потребители
python tools/check_run_rules.py
python tools/measure_foreshortening.py
cd journey3 && npm ci && npm run build && cd .. && python tools/build_journey3.py deploy
git diff --exit-code -- next/            # next/ совпадает со сборкой
npm run smoke --prefix tests/browser     # браузерный smoke (см. tests/browser/README.md)
node tests/browser/visual.mjs run --base main   # visual regression против main
```

CI ничего не деплоит: публикация остаётся за GitHub Pages (main:/).

## Порядок обработки

1. `gen_*.py` — кадры в `out/site_assets/_raw/<id>/`
2. `filter_*.py` — автофильтр (флуд-филл пайплайна) + вырез лучшего кадра
3. `defringe_rim.py` — гашение светлого штриха по силуэту
4. `bleed_alpha.py` — заливка цветом прозрачных пикселей (иначе фильтрация
   подмешивает в край черноту)
5. `finish_*.py` / `export_web.py` — градация под пак и экспорт в `assets/`
6. `build_journey3.py pages` → `vite build` → `build_journey3.py deploy`

Ручной пик по типу (`PICK_OVERRIDE`) — потому что ни флуд-филл, ни резкость не
знают, тот ли это объект, который просили. У каждой записи в словаре стоит
причина.
