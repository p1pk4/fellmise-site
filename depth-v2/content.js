/* Контент маршрута: тексты и их постановка. Логики движения здесь нет, и
 * наоборот — в journey.js нет ни одной строки копирайта.
 *
 * Копия лежит под ключом локали, по одному объекту на язык. Разметка и стили
 * от языка не зависят: / открывается по-английски, /ru/ — по-русски, а превью
 * /depth-v2/ переключается запросом ?lang=. Какой именно вход открыт, решает
 * route.js; язык браузера не определяется нигде.
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
 * variant — разная подача при общем языке, чтобы шесть биомов не читались
 * одинаковыми карточками на одном и том же месте. Карточек нет ни в одном:
 * везде текст, одна линия и мягкий скрим без границ.
 *   quiet    — вертикальная тёплая линия слева от текста
 *   air      — почти голый текст и короткая горизонтальная черта
 *   grounded — дымный скрим и один незамкнутый угловой штрих
 *   bare     — оформления почти нет, эталон деликатности (порог духов)
 *   caption  — редакционная подпись к кадру: градиент уходит в воду
 *
 * Категорийные eyebrow сняты: «THE VILLAGE» над кадром деревни ничего не
 * сообщает — биом уже назван самим изображением и маршрутом. Плашки-теги
 * заменены короткими утверждениями о мире: формула
 * eyebrow -> заголовок -> мелкий абзац -> мелкие теги читалась типовым
 * лендингом, а не языком Fellmise.
 *
 * mark: 'spiral' — высеченная спираль из символики проекта. Стоит ровно на
 * двух битах слоя духов: у порога и в ядре. В деревне знак сняли — там он
 * читался случайным декоративным глифом, а не принадлежностью. Так спираль
 * означает spirit/death layer, а не украшает сайт.
 */
/* Локаль решает route.js: на продакшене её задаёт сам адрес (/ и /ru/), на
   превью — запрос ?lang=. Язык браузера не смотрим ни в одном случае. Здесь
   она только переэкспортируется, чтобы у модуля остался прежний интерфейс. */
export { LOCALE } from './route.js';
import { LOCALE as LOC } from './route.js';

export const BEATS = [
  {
    id: 'village',
    range: [0.030, 0.085],
    // низ слева: там тёмный дуб и забор переднего плана. По центру блок
    // ложился на красные крыши и светлую стену и переставал читаться
    side: 'left', y: 'lower', variant: 'quiet',
    en: {
      headline: 'A world that plays itself',
      body: 'The world does not wait for you. NPC adventurers raid dungeons, return with loot and end the day at the tavern.',
      statements: ['Life goes on without the player.'],
    },
    ru: {
      headline: 'Мир играет в себя',
      body: 'Мир не ждёт игрока. NPC-авантюристы ходят в подземелья, возвращаются с добычей и заканчивают день в таверне.',
      statements: ['Жизнь идёт и без игрока.'],
    },
  },
  {
    id: 'forest',
    range: [0.185, 0.240],
    side: 'right', y: 'lower', variant: 'air',
    en: {
      headline: 'Beyond the safe roads',
      body: 'The farther you travel from civilization, the greater the danger. At night, the wilderness changes — and some places reveal what daylight hides.',
      statements: ['Night changes the rules.'],
    },
    ru: {
      headline: 'За пределами безопасных дорог',
      body: 'Чем дальше от цивилизации, тем выше риск. Ночью дикая местность меняется — и некоторые места открывают то, что скрывает дневной свет.',
      statements: ['Ночь меняет правила.'],
    },
  },
  {
    id: 'mine',
    range: [0.350, 0.400],
    side: 'left', y: 'center', variant: 'grounded',
    en: {
      headline: 'Depth has a price',
      body: 'The deeper you go, the richer the resources — and the greater the risk. What you bring back feeds crafting and trade above ground.',
      statements: ['Better resources. Greater danger.'],
    },
    ru: {
      headline: 'У глубины есть цена',
      body: 'Чем глубже спускаешься, тем богаче ресурсы — и выше риск. Всё, что вынесешь наверх, идёт в ремесло и торговлю.',
      statements: ['Лучше ресурсы. Выше опасность.'],
    },
  },
  {
    id: 'threshold',
    // Самый крупный заголовок маршрута при полном отсутствии оформления:
    // стела остаётся абсолютным центром кадра
    range: [0.500, 0.535],
    side: 'left', y: 'lower', variant: 'bare', mark: 'spiral', hero: true,
    en: {
      headline: 'The dead see more.',
      body: 'Death does not remove you from the world. It reveals another layer of the same place.',
    },
    ru: {
      headline: 'Мёртвые видят больше.',
      body: 'Смерть не выводит тебя из мира. Она открывает другой слой того же места.',
    },
  },
  {
    id: 'core',
    range: [0.638, 0.716],
    side: 'right', y: 'lower', variant: 'caption', mark: 'spiral', hero: true,
    en: {
      headline: 'Death is a place',
      body: 'The dead can follow traces the living cannot see, uncover echoes of what happened here and find paths that exist only beyond death.',
      statements: ['Spirit Sight reveals what life conceals.', 'Some journeys begin after you die.'],
    },
    ru: {
      headline: 'Смерть — это место',
      body: 'Мёртвые видят следы, недоступные живым, находят отголоски произошедшего и пути, существующие только по ту сторону смерти.',
      statements: ['Духовное зрение открывает то, что скрыто от живых.', 'Некоторые пути начинаются после смерти.'],
    },
  },
  {
    id: 'home',
    range: [0.880, 1.000],
    side: 'left', y: 'lower', variant: 'air',
    en: {
      headline: 'A place to return to',
      body: 'Build a home that belongs only to you — part workshop, part storage, part sanctuary inside a shared world.',
      statements: ['Build. Craft. Store. Grow.'],
    },
    ru: {
      headline: 'Место, куда можно вернуться',
      body: 'Построй дом, который принадлежит только тебе — мастерскую, склад и убежище внутри общего мира.',
      statements: ['Строй. Создавай. Храни. Выращивай.'],
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

export function mountContent(root, locale = LOC) {
  document.documentElement.lang = locale;
  root.dataset.lang = locale;
  const blocks = BEATS.map((b) => {
    const c = b[locale] || b[LOC];
    // id-класс нужен стилям: кегль заголовка и мера строки заданы посценно
    const el = node('article', `beat beat--${b.id} beat--${b.variant} beat--${b.side} beat--${b.y}`);
    if (b.hero) el.classList.add('beat--hero');
    if (b.mark) el.classList.add(`beat--mark-${b.mark}`);
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(node('h2', 'beat__headline', c.headline));
    if (c.body) {
      const p = node('p', 'beat__body', c.body);
      p.style.transitionDelay = '90ms';        // тело идёт следом за заголовком
      el.appendChild(p);
    }
    if (c.statements && c.statements.length) {
      const ul = node('ul', 'beat__says');
      c.statements.forEach((t, i) => {
        const li = node('li', null, t);
        li.style.transitionDelay = `${170 + i * 80}ms`;
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
