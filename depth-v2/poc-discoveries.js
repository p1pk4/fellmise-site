/* POC: находки биомов. Только превью: /depth-v2/?poc=discoveries (все биомы)
 * и /depth-v2/?poc=mine (только шахта). / и /ru/ и обычный /depth-v2/ этот
 * модуль и его картинки не грузят вовсе.
 *
 * Один движок на все биомы, поведение задают данные. Пока пользователь идёт
 * глубже, в свободных местах кадра одна за другой «шлёпаются» отдельные
 * нарисованные находки и остаются: к концу биома вокруг основного текста
 * собрана маленькая коллекция. Не инвентарь, не HUD, не карточки: предмет без
 * рамки и плашки, под ним название и одна строка. Стрелок к окружению нет.
 *
 * Находки биома — один компактный кластер на одной физически правдоподобной
 * опоре (земля у тележки, корни дерева, порода у стены, берег, двор). Предметы
 * стоят вплотную и частично перекрывают друг друга: это одна композиция, а не
 * список. Под всей группой — одно мягкое органическое пятно-тень (under) из
 * маски underlay.webp, прижатое к основанию кластера; оно проявляется с первой
 * находкой, плотнеет по мере накопления и уходит вместе с группой.
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
   zone     — свободная полоса кадра по горизонтали, в которой держатся подписи.
   under    — подложка кластера: центр x, y и размер w, h в долях кадра, rot —
              наклон пятна, tone — цвет (rgb), op — плотность при полной группе;
   props    — CSS-фильтр предметов биома (приглушить там, где сцена тихая).
   Предмет: at — локальный прогресс появления; x, y — центр предмета в долях
   кадра; h — высота в долях высоты кадра; rot — постоянный наклон; cap —
   сторона подписи (below / above / left / right); cx — сдвиг подписи в долях
   ширины. */
export const BIOMES = {
  // деревня — физические следы живого мира; текст слева внизу, находки справа,
  // в небе над крышами и на траве, дорога и дома открыты
  village: {
    k: 0, stretch: [3.2, 1.5], exit: 0.84, zone: [0.28, 0.985],
    keep: [[0.36, 0.22, 0.72, 0.58]],
    items: [
      { id: 'sealed-letter', at: 0.30, x: 0.415, y: 0.915, h: 0.058, rot: -4, cap: 'right', z: 4,
        en: ['Sealed letter', 'Messages move through the world without you.'],
        ru: ['Письмо', 'Сообщения идут по миру и без тебя.'] },
      { id: 'notice', at: 0.42, x: 0.845, y: 0.735, h: 0.115, rot: 1.5, cap: 'right', z: 1,
        en: ['Notice', 'Work appears whether a player is there to take it or not.'],
        ru: ['Объявление', 'Дела появляются независимо от того, рядом ли игрок.'] },
      { id: 'adventurer-pack', at: 0.54, x: 0.62, y: 0.845, h: 0.14, rot: -1, cap: 'left', z: 2,
        en: ["Adventurer's pack", 'Others leave town, return with loot, and spend it.'],
        ru: ['Ранец авантюриста', 'Другие уходят за добычей, возвращаются и тратят её.'] },
      { id: 'field-book', at: 0.66, x: 0.79, y: 0.9, h: 0.082, rot: 2, cap: 'left', z: 3,
        en: ['Field book', 'Knowledge is something you can carry.'],
        ru: ['Полевая книга', 'Знание здесь можно буквально носить с собой.'] },
    ],
  },
  // лес — природные образцы и странности, не добыча; текст справа, находки
  // слева и снизу слева, центральная тропа открыта
  forest: {
    k: 1, stretch: [2.8, 1.45], exit: 0.9, zone: [0.015, 0.985],
    keep: [[0.42, 0.1, 0.6, 0.45]],
    items: [
      { id: 'strange-bark', at: 0.20, x: 0.74, y: 0.9, h: 0.095, rot: -2, cap: 'left', z: 2,
        en: ['Strange bark', 'Not every place worth finding is marked on a map.'],
        ru: ['Странная кора', 'Не каждое важное место отмечено на карте.'] },
      { id: 'fresh-track', at: 0.38, x: 0.47, y: 0.94, h: 0.08, rot: 1, cap: 'right', z: 3,
        en: ['Fresh track', 'The farther from safety, the less predictable the wilds.'],
        ru: ['Свежий след', 'Чем дальше от безопасности, тем непредсказуемее дикая местность.'] },
      { id: 'night-growth', at: 0.56, x: 0.12, y: 0.86, h: 0.14, rot: -1.5, cap: 'right', z: 1,
        en: ['Night growth', 'Some things are easier to find after dark.'],
        ru: ['Ночная поросль', 'Некоторые вещи легче найти после наступления темноты.'] },
    ],
  },
  mine: {
    k: 2, stretch: [3, 1.6], exit: 0.9, zone: [0.3, 0.985],
    keep: [[0.46, 0.15, 0.715, 0.6]],
    items: [
      { id: 'ore-sample', at: 0.10, x: 0.465, y: 0.865, h: 0.1, rot: -2, cap: 'left', z: 1,
        en: ['Ore sample', 'Depth changes what the rock gives back.'],
        ru: ['Образец руды', 'С глубиной меняется то, что отдаёт порода.'] },
      { id: 'mining-pickaxe', at: 0.26, x: 0.625, y: 0.93, h: 0.105, rot: 1.5, cap: 'right', z: 2,
        en: ['Mining Pick', 'The right tool decides what you can bring back.'],
        ru: ['Кирка', 'От инструмента зависит, что ты сможешь унести наверх.'] },
      { id: 'ore-cargo', at: 0.43, x: 0.72, y: 0.86, h: 0.15, rot: -1, cap: 'right', z: 3,
        en: ['The haul', 'What you extract feeds crafting and trade.'],
        ru: ['Добыча', 'То, что вынесешь наверх, идёт в ремесло и торговлю.'] },
      { id: 'deep-material', at: 0.60, x: 0.865, y: 0.9, h: 0.088, rot: 2, cap: 'left', z: 4,
        en: ['Rare Crystal', 'Richer materials wait where the risk is higher.'],
        ru: ['Редкий кристалл', 'Чем ценнее находка, тем опаснее путь к ней.'] },
    ],
  },
  // ядро мира мёртвых — не добыча, а свидетельства другого слоя; текст справа
  // внизу, находки по левому краю; корабль, след на воде, пирс и стела открыты
  core: {
    k: 4, stretch: [2.5, 1.45], exit: 0.9, zone: [0.015, 0.985],
    props: 'saturate(.72) brightness(.86)',
    keep: [[0.39, 0.4, 0.7, 0.555]],
    items: [
      { id: 'spirit-trace', at: 0.18, x: 0.5, y: 0.655, h: 0.1, rot: -1, cap: 'right', spectral: true, z: 1,
        en: ['Spirit trace', 'The dead see paths the living leave behind.'],
        ru: ['След духа', 'Мёртвые видят пути, оставленные живыми.'] },
      { id: 'awakened-relic', at: 0.36, x: 0.78, y: 0.88, h: 0.1, rot: 1.5, cap: 'left', z: 2,
        en: ['Awakened relic', 'Some things reveal what they are only after death.'],
        ru: ['Пробуждённая реликвия', 'Некоторые вещи раскрывают себя только после смерти.'] },
      { id: 'spiral-shard', at: 0.54, x: 0.412, y: 0.6, h: 0.07, rot: -2, cap: 'right', z: 3,
        en: ['Spiral shard', 'The same world reveals another layer.'],
        ru: ['Осколок спирали', 'Тот же мир открывает другой слой.'] },
    ],
  },
  // дом — то, что остаётся; тихо по краям, дом и окна — главный финал;
  // коллекция остаётся до конца маршрута
  home: {
    k: 5, stretch: [2, 2], exit: null, zone: [0.02, 0.985],
    keep: [[0.5, 0.25, 0.75, 0.55]],
    items: [
      { id: 'storage-chest', at: 0.15, x: 0.335, y: 0.655, h: 0.085, rot: -1.5, cap: 'right', z: 1,
        en: ['Storage', 'What you bring home stays yours.'],
        ru: ['Хранилище', 'То, что ты принёс домой, остаётся твоим.'] },
      { id: 'workshop-kit', at: 0.3, x: 0.665, y: 0.68, h: 0.09, rot: 1, cap: 'right', z: 2,
        en: ['Workshop', 'Craft without leaving your own space.'],
        ru: ['Мастерская', 'Создавай вещи, не покидая своего пространства.'] },
      { id: 'trophy', at: 0.45, x: 0.125, y: 0.42, h: 0.1, rot: -1, cap: 'right', z: 4,
        en: ['Trophy', 'Bring pieces of your journey back with you.'],
        ru: ['Трофей', 'Возвращайся домой с памятью о пройденном пути.'] },
      { id: 'seed-pouch', at: 0.6, x: 0.53, y: 0.9, h: 0.07, rot: 2, cap: 'right', z: 3,
        en: ['Grow', 'Your home can produce more than storage.'],
        ru: ['Выращивай', 'Дом — это больше, чем просто склад.'] },
    ],
  },
};
const ASSETS = '/assets/depth/discovery/';
const UNDERLAY = `${ASSETS}underlay.webp`;

const CSS = `
.poc-finds { position: fixed; inset: 0; pointer-events: none; z-index: 40; }
/* общая подложка кластера: маска мягкого неровного пятна, цвет — у биома */
.poc-under { position: absolute; left: 0; top: 0; opacity: 0; transition: opacity .6s ease;
  -webkit-mask: url(${UNDERLAY}) center / 100% 100% no-repeat; mask: url(${UNDERLAY}) center / 100% 100% no-repeat; }
.poc-find { position: absolute; left: 0; top: 0; margin: 0; display: flex; flex-direction: column; align-items: center;
  opacity: 0; transition: opacity .32s ease; }
.poc-find--above { flex-direction: column-reverse; }
.poc-find--above figcaption { margin: 0 0 8px; }
.poc-find--left { flex-direction: row-reverse; }
.poc-find--right { flex-direction: row; }
.poc-find--left figcaption { margin: 0 12px 0 0; text-align: right; }
.poc-find--right figcaption { margin: 0 0 0 12px; text-align: left; }
/* тень короткая и низкая: предмет лежит, а не парит */
.poc-find img { display: block; width: auto; transform: rotate(var(--rot)); filter: var(--props, none) drop-shadow(0 3px 3px rgba(8, 6, 4, .45)); }
.poc-find--spectral img { filter: var(--props, none); }
.poc-find.is-on { opacity: 1; transition: none; animation: poc-stick .22s cubic-bezier(.2, .7, .3, 1) both; }
@keyframes poc-stick {
  0% { opacity: 0; transform: var(--at) scale(.88); }
  65% { opacity: 1; transform: var(--at) scale(1.025); }
  100% { opacity: 1; transform: var(--at) scale(1); }
}
.poc-find figcaption { display: none; margin-top: 8px; text-align: center; color: #e8dbbd;
  text-shadow: 0 1px 6px rgba(0, 0, 0, .85), 0 0 2px rgba(0, 0, 0, .7); }
.poc-find b, .poc-find span { white-space: nowrap; }
.poc-find b { display: block; font: 700 clamp(13px, .82vw, 16px)/1.05 Podkova, Georgia, serif; letter-spacing: .05em;
  text-transform: uppercase; color: #e2b594; }
.poc-find span { display: block; margin-top: .3em; font: 500 clamp(12px, .74vw, 14.5px)/1.3 Vollkorn, Georgia, serif; }
/* подпись — только у последней находки */
.poc-find.is-new figcaption { display: block; }
/* на узком окне строка не помещается: остаётся название */
@media (max-width: 1279px) { .poc-find span { display: none; } }
`;

/* only — список биомов (null — все); stretch — переопределение растяжения шахты
   с превью (?stretch=), для сравнения. Возвращает растяжение по номерам биомов
   для journey.js и update(localOf), где localOf(k) — локальный прогресс биома k
   или null вне его. */
export function mountDiscoveries(parent, { only = null, stretch = null } = {}) {
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
  const unders = [];
  const stretchBy = {};
  for (const [name, b] of biomes) {
    const s = name === 'mine' && Number(stretch) > 0 ? [Number(stretch), b.stretch[1]] : b.stretch;
    stretchBy[b.k] = s;
    groups.push(b);
    if (b.under) {
      const u = document.createElement('div');
      u.className = 'poc-under';
      u.dataset.biome = name;
      u.style.background = `rgb(${b.under.tone})`;
      root.appendChild(u);
      unders.push({ b, el: u, n: 0 });
    }
    for (const d of b.items) {
      const fig = document.createElement('figure');
      fig.className = `poc-find poc-find--${d.cap || 'below'}${d.spectral ? ' poc-find--spectral' : ''}`;
      fig.dataset.find = d.id;
      fig.dataset.biome = name;
      fig.style.zIndex = String(d.z ?? 1);
      fig.style.setProperty('--rot', `${d.rot || 0}deg`);
      if (b.props) fig.style.setProperty('--props', b.props);
      const img = new Image();
      img.src = `${ASSETS}${name}/${d.id}.webp`;
      img.alt = '';
      img.decoding = 'async';
      const cap = document.createElement('figcaption');
      cap.innerHTML = '<b></b><span></span>';
      cap.querySelector('b').textContent = d[lang][0];
      cap.querySelector('span').textContent = d[lang][1];
      if (d.cx) cap.style.transform = `translateX(${(d.cx * 100).toFixed(2)}vw)`;
      fig.append(img, cap);
      root.appendChild(fig);
      finds.push({ d, b, fig, img, on: false });
    }
  }

  function layout() {
    const W = innerWidth, H = innerHeight;
    for (const u of unders) {
      const { x, y, w, h, rot = 0 } = u.b.under;
      u.el.style.width = `${Math.round(w * W)}px`;
      u.el.style.height = `${Math.round(h * H)}px`;
      u.el.style.transform = `translate(${Math.round((x - w / 2) * W)}px, ${Math.round((y - h / 2) * H)}px) rotate(${rot}deg)`;
    }
    for (const f of finds) {
      f.img.style.height = `${Math.round(f.d.h * H)}px`;
      // центр предмета — в (x, y); подпись со своей стороны
      const fw = f.fig.offsetWidth, fh = f.fig.offsetHeight, iw = f.img.offsetWidth, ih = f.img.offsetHeight;
      const cx = f.d.x * W, cy = f.d.y * H, cap = f.d.cap || 'below';
      let left = cx - fw / 2, top = cy - fh / 2;
      if (cap === 'below') top = cy - ih / 2;
      if (cap === 'above') top = cy + ih / 2 - fh;
      if (cap === 'left') left = cx + iw / 2 - fw;
      if (cap === 'right') left = cx - iw / 2;
      left = Math.min(Math.max(left, f.b.zone[0] * W), f.b.zone[1] * W - fw);
      const at = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      f.fig.style.setProperty('--at', at);
      f.fig.style.transform = at;
    }
  }
  addEventListener('resize', layout);
  for (const f of finds) f.img.addEventListener('load', layout);
  layout();

  function update(localOf) {
    for (const f of finds) {
      const m = localOf(f.b.k);
      const on = m != null && m >= f.d.at && (f.b.exit == null || m < f.b.exit);
      if (on === f.on) continue;
      f.on = on;
      f.fig.classList.toggle('is-on', on);
    }
    // подпись показывает только последняя найденная вещь биома
    let changed = false;
    for (const b of groups) {
      const on = finds.filter((f) => f.b === b && f.on);
      for (const f of on) {
        const isNew = f === on[on.length - 1];
        if (f.fig.classList.contains('is-new') !== isNew) { f.fig.classList.toggle('is-new', isNew); changed = true; }
      }
    }
    if (changed) layout();      // ширина блока меняется вместе с подписью
    // подложка проявляется с первой находкой и плотнеет к полной группе
    for (const u of unders) {
      const n = finds.filter((f) => f.b === u.b && f.on).length, N = u.b.items.length;
      if (n === u.n) continue;
      u.n = n;
      u.el.style.opacity = n ? String((u.b.under.op ?? 0.6) * (0.55 + 0.45 * n / N)) : '0';
    }
  }
  return { stretch: stretchBy, update };
}
