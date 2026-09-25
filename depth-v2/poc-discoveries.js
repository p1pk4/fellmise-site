/* Находки биомов — часть живого маршрута на всех трёх входах (/, /ru/,
 * /depth-v2/). Статика, reduced-motion, узкое окно и страница без JS этот
 * модуль и его картинки не грузят вовсе: их подключает только journey.js,
 * а его в этих режимах нет (boot.js). Превью оставляет один ключ:
 * ?poc=mine показывает находки одной шахты.
 *
 * Один движок на все биомы, поведение задают данные. Пока пользователь идёт
 * глубже, в свободных местах кадра одна за другой «шлёпаются» отдельные
 * нарисованные находки и остаются: к концу биома вокруг основного текста
 * собрана маленькая коллекция. Не инвентарь, не HUD, не карточки: предмет без
 * рамки и плашки, под ним название и одна строка. Стрелок к окружению нет.
 *
 * Две системы координат, и в этом вся модель. Находка появляется в мире — на
 * крыше и на заборе в деревне, на траве и на тропе в лесу, по бокам от
 * вагонетки в шахте, на пирсе и на стеле у ядра, на стволе дерева и у
 * поленницы дома (world). Там она держится мгновение, а потом коротким
 * движением «нашлёпывается» на страницу — в своё постоянное место в кадре
 * (slot). Дальше камера идёт своей дорогой, сцена едет и растёт, а найденная
 * вещь стоит в коллекции у края кадра и больше не пересчитывается из мира.
 * Прибитый предмет физически не может остаться на своей опоре: опора уезжает.
 * Поэтому опора — это момент находки, а коллекция живёт в кадре.
 *
 * Текст не дробит кластер: подпись есть только у последней найденной вещи —
 * название и одна строка. У остальных текста нет, кластер читается целиком.
 *
 * Появление: opacity 0→1 и scale .88→1.025→1 за ~220 мс, у каждого предмета
 * свой постоянный наклон. После появления предмет неподвижен. Перед тем как
 * следующая сцена займёт кадр, коллекция уходит целиком. Правило — функция
 * локального прогресса биома, поэтому при прокрутке назад находки убираются в
 * обратном порядке. У порога (threshold) находок нет намеренно — это пауза.
 *
 * Копия — POC, финальный текст сверяется с GDD позже.
 */
import { LOCALE } from './route.js';

/* Данные биомов.
   k        — номер биома (0 деревня, 1 лес, 2 шахта, 3 порог, 4 ядро, 5 дом);
   stretch  — во сколько раз дольше прокручивается биом [до раскрытия
              следующей сцены, после];
   exit     — локальный прогресс, на котором коллекция уходит (null — остаётся
              до конца маршрута);
   zone     — свободная полоса кадра по горизонтали, в которой держатся подписи;
   keep     — главный объект биома в долях плиты сцены (не кадра): плита едет и
              растёт, поэтому на экране этот прямоугольник у каждого момента
              свой. Находка не должна заходить в него в свой момент появления;
   props    — CSS-фильтр предметов биома (приглушить там, где сцена тихая).
   Предмет: at — локальный прогресс появления; world — [x, y, h] точки находки
   в кадре того момента, когда она появляется (центр и высота в долях кадра);
   slot — [x, y, h] её постоянного места в коллекции; rot — постоянный наклон;
   cap — сторона подписи (below / above / left / right); cx — сдвиг подписи в
   долях ширины. Подпись появляется уже в коллекции, после перелёта. */
export const BIOMES = {
  // деревня — физические следы живого мира; текст слева внизу, письмо на крыше,
  // объявление на заборе, ранец у телеги, книга на траве; дорога и дома открыты
  village: {
    k: 0, stretch: [3.2, 1.5], exit: 0.84, zone: [0.06, 0.985],
    keep: [[0.406, 0.319, 0.619, 0.532]],
    items: [
      { id: 'sealed-letter', at: 0.30, world: [0.309, 0.439, 0.042], slot: [0.61, 0.9, 0.07], rot: -7, cap: 'above', z: 4,
        en: ['Sealed letter', 'Messages move through the world without you.'],
        ru: ['Письмо', 'Сообщения идут по миру и без тебя.'] },
      { id: 'notice', at: 0.42, world: [0.763, 0.675, 0.09], slot: [0.705, 0.888, 0.095], rot: 1.5, cap: 'above', z: 1,
        en: ['Notice', 'Work appears whether a player is there to take it or not.'],
        ru: ['Объявление', 'Дела появляются независимо от того, рядом ли игрок.'] },
      { id: 'adventurer-pack', at: 0.54, world: [0.597, 0.785, 0.118], slot: [0.8, 0.88, 0.11], rot: -1, cap: 'above', z: 2,
        en: ["Adventurer's pack", 'Others leave town, return with loot, and spend it.'],
        ru: ['Ранец авантюриста', 'Другие уходят за добычей, возвращаются и тратят её.'] },
      { id: 'field-book', at: 0.66, world: [0.762, 0.861, 0.075], slot: [0.895, 0.895, 0.08], rot: 2, cap: 'above', z: 3,
        en: ['Field book', 'Knowledge is something you can carry.'],
        ru: ['Полевая книга', 'Знание здесь можно буквально носить с собой.'] },
    ],
  },
  // лес — природные образцы и странности, не добыча; текст справа, кора у правого
  // дерева, след на тропе, поросль на травяном склоне слева; просвет тропы открыт
  forest: {
    k: 1, stretch: [2.8, 1.45], exit: 0.9, zone: [0.015, 0.985],
    keep: [[0.459, 0.259, 0.564, 0.463]],
    items: [
      { id: 'strange-bark', at: 0.20, world: [0.646, 0.725, 0.055], slot: [0.1, 0.895, 0.08], rot: -2, cap: 'above', z: 2,
        en: ['Strange bark', 'Not every place worth finding is marked on a map.'],
        ru: ['Странная кора', 'Не каждое важное место отмечено на карте.'] },
      { id: 'fresh-track', at: 0.38, world: [0.484, 0.794, 0.055], slot: [0.2, 0.898, 0.075], rot: 1, cap: 'above', z: 3,
        en: ['Fresh track', 'The farther from safety, the less predictable the wilds.'],
        ru: ['Свежий след', 'Чем дальше от безопасности, тем непредсказуемее дикая местность.'] },
      { id: 'night-growth', at: 0.56, world: [0.366, 0.774, 0.113], slot: [0.305, 0.885, 0.1], rot: -1.5, cap: 'above', z: 1,
        en: ['Night growth', 'Some things are easier to find after dark.'],
        ru: ['Ночная поросль', 'Некоторые вещи легче найти после наступления темноты.'] },
    ],
  },
  mine: {
    k: 2, stretch: [3, 1.6], exit: 0.9, zone: [0.3, 0.985],
    keep: [[0.527, 0.293, 0.678, 0.559]],
    items: [
      { id: 'ore-sample', at: 0.10, world: [0.545, 0.688, 0.054], slot: [0.615, 0.895, 0.08], rot: -2, cap: 'above', z: 1,
        en: ['Ore sample', 'Depth changes what the rock gives back.'],
        ru: ['Образец руды', 'С глубиной меняется то, что отдаёт порода.'] },
      { id: 'mining-pickaxe', at: 0.26, world: [0.652, 0.763, 0.068], slot: [0.71, 0.893, 0.085], rot: 1.5, cap: 'above', z: 2,
        en: ['Mining Pick', 'The right tool decides what you can bring back.'],
        ru: ['Кирка', 'От инструмента зависит, что ты сможешь унести наверх.'] },
      { id: 'ore-cargo', at: 0.43, world: [0.681, 0.715, 0.082], slot: [0.805, 0.885, 0.1], rot: -1, cap: 'above', z: 3,
        en: ['The haul', 'What you extract feeds crafting and trade.'],
        ru: ['Добыча', 'То, что вынесешь наверх, идёт в ремесло и торговлю.'] },
      { id: 'deep-material', at: 0.60, world: [0.824, 0.832, 0.073], slot: [0.9, 0.898, 0.075], rot: 2, cap: 'above', z: 4,
        en: ['Rare Crystal', 'Richer materials wait where the risk is higher.'],
        ru: ['Редкий кристалл', 'Чем ценнее находка, тем опаснее путь к ней.'] },
    ],
  },
  // ядро мира мёртвых — не добыча, а свидетельства другого слоя; текст справа
  // внизу, шлем на пирсе, осколок на стеле, след духа на открытой воде слева;
  // корабль и силуэты пирса и стелы остаются читаемыми
  core: {
    k: 4, stretch: [2.5, 1.45], exit: 0.9, zone: [0.015, 0.985],
    props: 'saturate(.72) brightness(.86)',
    keep: [[0.419, 0.327, 0.616, 0.425]],
    items: [
      { id: 'spirit-trace', at: 0.18, world: [0.339, 0.551, 0.069], slot: [0.1, 0.893, 0.085], rot: -1, cap: 'above', spectral: true, z: 1,
        en: ['Spirit trace', 'The dead see paths the living leave behind.'],
        ru: ['След духа', 'Мёртвые видят пути, оставленные живыми.'] },
      { id: 'awakened-relic', at: 0.36, world: [0.603, 0.736, 0.076], slot: [0.2, 0.893, 0.085], rot: 1.5, cap: 'above', z: 2,
        en: ['Awakened relic', 'Some things reveal what they are only after death.'],
        ru: ['Пробуждённая реликвия', 'Некоторые вещи раскрывают себя только после смерти.'] },
      { id: 'spiral-shard', at: 0.54, world: [0.411, 0.554, 0.059], slot: [0.3, 0.9, 0.07], rot: -2, cap: 'above', z: 3,
        en: ['Spiral shard', 'The same world reveals another layer.'],
        ru: ['Осколок спирали', 'Тот же мир открывает другой слой.'] },
    ],
  },
  // дом — то, что остаётся; сундук у дальнего забора, ящик с инструментом на
  // земле у поленницы, мешочек семян у дороги, трофей на стволе дерева;
  // дом и окна — главный финал, коллекция остаётся до конца маршрута
  home: {
    k: 5, stretch: [2, 2], exit: null, zone: [0.02, 0.985],
    keep: [[0.5, 0.25, 0.75, 0.55]],
    items: [
      { id: 'storage-chest', at: 0.15, world: [0.335, 0.655, 0.085], slot: [0.615, 0.895, 0.08], rot: -1.5, cap: 'above', z: 1,
        en: ['Storage', 'What you bring home stays yours.'],
        ru: ['Хранилище', 'То, что ты принёс домой, остаётся твоим.'] },
      { id: 'workshop-kit', at: 0.3, world: [0.715, 0.765, 0.09], slot: [0.71, 0.893, 0.085], rot: 1, cap: 'above', z: 2,
        en: ['Workshop', 'Craft without leaving your own space.'],
        ru: ['Мастерская', 'Создавай вещи, не покидая своего пространства.'] },
      { id: 'trophy', at: 0.45, world: [0.095, 0.42, 0.1], slot: [0.805, 0.89, 0.09], rot: -1, cap: 'above', z: 4,
        en: ['Trophy', 'Bring pieces of your journey back with you.'],
        ru: ['Трофей', 'Возвращайся домой с памятью о пройденном пути.'] },
      { id: 'seed-pouch', at: 0.6, world: [0.53, 0.9, 0.07], slot: [0.9, 0.9, 0.07], rot: 2, cap: 'above', z: 3,
        en: ['Grow', 'Your home can produce more than storage.'],
        ru: ['Выращивай', 'Дом — это больше, чем просто склад.'] },
    ],
  },
};
const ASSETS = '/assets/depth/discovery/';
// картинки биома приходят по ходу маршрута: текущий биом, следующий с
// середины текущего и предыдущий у его начала (ход назад не ждёт сети)
const AHEAD = 0.45, BACK = 0.25;
// сколько предмет держится на своей опоре в мире, прежде чем уйти в коллекцию
// (сам перелёт — .28s, задан переходом в CSS)
const WORLD_HOLD = 190;

const CSS = `
.poc-finds { position: fixed; inset: 0; pointer-events: none; z-index: 40; }
.poc-find { position: absolute; left: 0; top: 0; margin: 0; opacity: 0; transform: var(--at);
  transition: opacity .32s ease; }
/* подпись висит рядом с предметом, но не входит в его коробку: длина строки
   (и разница EN/RU) не должна двигать саму находку */
.poc-find figcaption { position: absolute; }
.poc-find--above figcaption { bottom: 100%; margin-bottom: 8px; left: 50%; transform: translateX(calc(-50% + var(--cx, 0px))); }
.poc-find--below figcaption { top: 100%; margin-top: 8px; left: 50%; transform: translateX(calc(-50% + var(--cx, 0px))); }
.poc-find--left figcaption { right: 100%; margin-right: 12px; top: 50%; transform: translateY(-50%); text-align: right; }
.poc-find--right figcaption { left: 100%; margin-left: 12px; top: 50%; transform: translateY(-50%); text-align: left; }
/* тень короткая и низкая: предмет лежит, а не парит */
.poc-find img { display: block; width: auto; transform: rotate(var(--rot)); filter: var(--props, none) drop-shadow(0 3px 3px rgba(8, 6, 4, .45)); }
.poc-find--spectral img { filter: var(--props, none); }
/* короткий перелёт в коллекцию: одно движение с лёгким перелётом в конце */
.poc-find.is-on { opacity: 1; transform: var(--at);
  transition: transform .28s cubic-bezier(.34, 1.24, .64, 1), opacity .12s ease; }
/* находка в мире: --from переносит предмет из его слота обратно в точку
   находки и в масштаб сцены, там он и проявляется. Правило идёт после is-on:
   у них одна специфичность, и побеждает последнее */
.poc-find.is-on.is-world { opacity: 1; transform: var(--at) var(--from); transition: opacity .12s ease; }
/* возврат на сохранённую позицию (смена языка): находки уже в коллекции */
.poc-find.is-restored { transition: none; }
.poc-find figcaption { display: none; text-align: center; color: #e8dbbd;
  text-shadow: 0 1px 6px rgba(0, 0, 0, .85), 0 0 2px rgba(0, 0, 0, .7); }
.poc-find b, .poc-find span { white-space: nowrap; }
.poc-find b { display: block; font: 700 clamp(13px, .82vw, 16px)/1.05 Podkova, Georgia, serif; letter-spacing: .05em;
  text-transform: uppercase; color: #e2b594; }
.poc-find span { display: block; margin-top: .3em; font: 500 clamp(12px, .74vw, 14.5px)/1.3 Vollkorn, Georgia, serif; }
/* подпись — только у последней находки и только когда она уже в коллекции */
.poc-find.is-new:not(.is-world) figcaption { display: block; }
/* на узком окне строка не помещается: остаётся название */
@media (max-width: 1279px) { .poc-find span { display: none; } }
`;

/* only — список биомов (null — все); stretch — переопределение растяжения шахты
   с превью (?stretch=), для сравнения. Возвращает растяжение по номерам биомов
   для journey.js, update(localOf), где localOf(k) — локальный прогресс биома k
   или null вне его, и stop() — снять всё при отказе живого режима. */
export function mountDiscoveries(parent, { only = null, stretch = null } = {}) {
  const life = new AbortController();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'poc-finds';
  root.setAttribute('aria-hidden', 'true');
  parent.appendChild(root);
  const lang = LOCALE === 'ru' ? 'ru' : 'en';
  const biomes = Object.entries(BIOMES).filter(([name, b]) => (!only || only.includes(name)) && b.items.length);

  const finds = [];
  const groups = [];
  const stretchBy = {};
  for (const [name, b] of biomes) {
    const s = name === 'mine' && Number(stretch) > 0 ? [Number(stretch), b.stretch[1]] : b.stretch;
    stretchBy[b.k] = s;
    const group = { b, name, items: [], asked: false };
    groups.push(group);
    for (const d of b.items) {
      const fig = document.createElement('figure');
      fig.className = `poc-find poc-find--${d.cap || 'below'}${d.spectral ? ' poc-find--spectral' : ''}`;
      fig.dataset.find = d.id;
      fig.dataset.biome = name;
      fig.style.zIndex = String(d.z ?? 1);
      fig.style.setProperty('--rot', `${d.rot || 0}deg`);
      if (b.props) fig.style.setProperty('--props', b.props);
      const img = new Image();
      // src ставится в fetch(): к первому кадру картинок находок в сети нет
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'low';        // сцена и её hi-res важнее находок
      const cap = document.createElement('figcaption');
      cap.innerHTML = '<b></b><span></span>';
      cap.querySelector('b').textContent = d[lang][0];
      cap.querySelector('span').textContent = d[lang][1];
      if (d.cx) fig.style.setProperty('--cx', `${(d.cx * 100).toFixed(2)}vw`);
      fig.append(img, cap);
      root.appendChild(fig);
      const f = { d, b, fig, img, on: false, src: `${ASSETS}${name}/${d.id}.webp` };
      group.items.push(f);
      finds.push(f);
    }
  }

  /* Картинки биома: запрашиваются один раз и остаются. Весь набор — 18 файлов
     ~0.5 МБ, в декодированном виде это единицы мегабайт против сотен у плит,
     поэтому выгрузки нет: ход назад не должен ждать повторной загрузки. */
  function fetchGroup(i) {
    const g = groups[i];
    if (!g || g.asked) return;
    g.asked = true;
    for (const f of g.items) {
      f.img.src = f.src;
      // декодируем заранее: к моменту появления предмет уже готов к показу
      f.img.decode?.().catch(() => {});
    }
  }

  /* Раскладка считается один раз (и на resize): предмет живёт в своём слоте, а
     --from — обратный перенос в точку находки, которым пользуется только показ
     в мире. Ни то, ни другое не пересчитывается по ходу маршрута. */
  function layout() {
    const W = innerWidth, H = innerHeight;
    for (const f of finds) {
      const [sx, sy, sh] = f.d.slot, [wx, wy, wh] = f.d.world;
      f.img.style.height = `${Math.round(sh * H)}px`;
      const iw = f.img.offsetWidth, ih = f.img.offsetHeight;
      const left = Math.min(Math.max(sx * W - iw / 2, f.b.zone[0] * W), f.b.zone[1] * W - iw);
      const top = sy * H - ih / 2;
      f.fig.style.setProperty('--at', `translate(${Math.round(left)}px, ${Math.round(top)}px)`);
      // из слота — обратно в точку находки: масштаб сцены и её центр
      f.fig.style.setProperty('--from', `translate(${Math.round(wx * W - (left + iw / 2))}px, `
        + `${Math.round(wy * H - (top + ih / 2))}px) scale(${(wh / sh).toFixed(3)})`);
    }
  }
  addEventListener('resize', layout, { signal: life.signal });
  for (const f of finds) f.img.addEventListener('load', layout, { signal: life.signal });
  layout();

  // первый кадр после монтирования — это возврат на сохранённую позицию: всё,
  // что к этому моменту уже открыто, ставится сразу, без повторного шлепка
  let restoring = true;
  function update(localOf) {
    // текущий биом, следующий с середины текущего, предыдущий у его начала
    for (let i = 0; i < groups.length; i++) {
      const m = localOf(groups[i].b.k);
      if (m == null) continue;
      fetchGroup(i);
      if (m >= AHEAD) fetchGroup(i + 1);
      if (m <= BACK) fetchGroup(i - 1);
    }
    for (const f of finds) {
      const m = localOf(f.b.k);
      const on = m != null && m >= f.d.at && (f.b.exit == null || m < f.b.exit);
      if (on === f.on) continue;
      f.on = on;
      clearTimeout(f.timer);
      if (!on) {
        f.fig.classList.remove('is-on', 'is-world', 'is-restored');
      } else if (restoring) {
        // возврат на сохранённую позицию: находка уже в коллекции
        f.fig.classList.add('is-restored', 'is-on');
      } else {
        // находка: сначала в мире, на своей опоре, потом короткий перелёт в слот
        f.fig.classList.remove('is-restored');
        f.fig.classList.add('is-world', 'is-on');
        f.timer = setTimeout(() => f.fig.classList.remove('is-world'), WORLD_HOLD);
      }
    }
    restoring = false;
    // подпись показывает только последняя найденная вещь биома; в коробку
    // предмета она не входит, поэтому раскладку не трогает
    for (const g of groups) {
      const on = g.items.filter((f) => f.on);
      for (const f of on) f.fig.classList.toggle('is-new', f === on[on.length - 1]);
    }
  }

  // живой режим уступил статике: снять слушатели, DOM и ссылки на картинки
  function stop() {
    life.abort();
    for (const f of finds) clearTimeout(f.timer);
    for (const f of finds) f.img.removeAttribute('src');
    root.remove();
    style.remove();
  }

  return { stretch: stretchBy, update, stop };
}
