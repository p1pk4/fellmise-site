/* Контент маршрута: тексты и их постановка. Логики движения здесь нет, и
 * наоборот — в journey.js нет ни одной строки копирайта.
 *
 * Структура готова к RU: копия лежит под ключом локали, и добавление второго
 * языка не требует трогать разметку или стили. LOCALE пока один.
 *
 * range — окно ПО ОБЩЕМУ ПРОГРЕССУ, не по колесу. Обе границы подобраны под
 * принятую хореографию и не меняют её: текст появляется после того, как биом
 * устоялся (позже конца предыдущей полосы), и уходит ДО начала раскрытия
 * следующей сцены. Начало раскрытия — это band[0] + gate[0] * длина полосы:
 *
 *   village   раскрытие с 0.093  -> текст до 0.085
 *   forest    раскрытие с 0.248  -> текст до 0.240
 *   mine      раскрытие с 0.407  -> текст до 0.400
 *   threshold раскрытие с 0.542  -> текст до 0.535
 *   core      раскрытие с 0.721  -> текст до 0.716
 *   home      раскрытия дальше нет, текст живёт до конца
 *
 * variant — разная композиция при общем языке, чтобы шесть биомов не читались
 * одинаковыми карточками на одном и том же месте:
 *   panel  — мягкая локальная подложка только под текстом
 *   rule   — без подложки, тонкая тёплая линия вдоль текста
 *   corner — подложка с угловым акцентом
 *   bare   — только текст, вообще без подложки
 */
export const LOCALE = 'en';

export const BEATS = [
  {
    id: 'village',
    range: [0.030, 0.085],
    side: 'left', y: 'center', variant: 'panel',
    en: {
      eyebrow: 'The village',
      headline: 'A world that plays itself',
      body: 'Log off and the world stays. NPC adventurers run dungeons, traders haul goods, craftsmen work the anvil. You are not arriving at an empty map.',
      tags: ['Living NPCs', 'Player economy', 'No empty map'],
    },
  },
  {
    id: 'forest',
    range: [0.185, 0.240],
    side: 'right', y: 'lower', variant: 'rule',
    en: {
      eyebrow: 'The wilds',
      headline: 'Beyond the safe roads',
      body: 'Danger grows with distance from the walls, and night rewrites the rules. The deep woods keep places that are not on any map.',
      tags: ['Night changes the rules', 'Hidden places'],
    },
  },
  {
    id: 'mine',
    range: [0.350, 0.400],
    side: 'left', y: 'center', variant: 'corner',
    en: {
      eyebrow: 'The mine',
      headline: 'Depth has a price',
      body: 'Every ore and every ingot was pulled out by somebody’s hands. The better the material, the deeper it sits and the worse the company.',
      tags: ['Gathering', 'Crafting', 'Risk for reward'],
    },
  },
  {
    id: 'threshold',
    // Здесь намеренно почти ничего: стела остаётся главным объектом кадра
    range: [0.500, 0.535],
    side: 'left', y: 'lower', variant: 'bare',
    en: {
      headline: 'The dead see more.',
      body: 'Death reveals another layer of the same world.',
    },
  },
  {
    id: 'core',
    range: [0.638, 0.716],
    // ниже и правее: корабль и его след должны остаться полностью видимыми,
    // при центральной посадке панель задевала корму
    side: 'right', y: 'lower', variant: 'panel', lead: true,
    en: {
      eyebrow: 'The spirit world',
      headline: 'Death is a place',
      body: 'Dying is not a respawn screen. You go on as a spirit, reading traces the living cannot see, and you come back changed.',
      tags: ['Spirit sight', 'Ghost ship', 'Secrets of the dead'],
    },
  },
  {
    id: 'home',
    range: [0.880, 1.000],
    side: 'left', y: 'lower', variant: 'rule',
    en: {
      eyebrow: 'Home',
      headline: 'A place to return to',
      body: 'Claim a patch of land and build it in layers. Your chests, your workshop, your crops, your trophies — kept safe inside a shared world.',
      tags: ['Building', 'Storage', 'Trophies'],
    },
  },
];

/* --------------------------------------------------------------- рендер */

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export function mountContent(root, locale = LOCALE) {
  const blocks = BEATS.map((b) => {
    const c = b[locale] || b[LOCALE];
    const el = node('article', `beat beat--${b.variant} beat--${b.side} beat--${b.y}`);
    if (b.lead) el.classList.add('beat--lead');
    el.setAttribute('aria-hidden', 'true');
    if (c.eyebrow) el.appendChild(node('p', 'beat__eyebrow', c.eyebrow));
    el.appendChild(node('h2', 'beat__headline', c.headline));
    if (c.body) el.appendChild(node('p', 'beat__body', c.body));
    if (c.tags && c.tags.length) {
      const ul = node('ul', 'beat__tags');
      c.tags.forEach((t, i) => {
        const li = node('li', null, t);
        // теги подхватываются после заголовка, с небольшим запаздыванием
        li.style.transitionDelay = `${150 + i * 90}ms`;
        ul.appendChild(li);
      });
      el.appendChild(ul);
    }
    root.appendChild(el);
    return { def: b, el, on: null };
  });

  /* Видимость решает общий прогресс; сама анимация — временная, на CSS.
     Так текст не скрабится вместе с колесом и всегда идёт своей мягкой
     дорожкой 400-650 мс, как задумано. */
  return function update(p) {
    for (const b of blocks) {
      const [a, z] = b.def.range;
      const on = p >= a && p <= z;
      if (on !== b.on) {
        b.on = on;
        b.el.classList.toggle('is-on', on);
        b.el.setAttribute('aria-hidden', String(!on));
      }
    }
  };
}
