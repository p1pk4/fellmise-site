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

/* Сами тексты биомов живут в content-data.js — чистом модуле данных, который
   читает ещё и сборка статического HTML. Здесь они только переэкспортируются. */
import { BEATS } from './content-data.js';
export { BEATS };

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
     дорожкой 400-650 мс, как задумано.

     Минимальное время показа. При энергичной прокрутке окно range пролетается
     за доли секунды — текст появлялся и сразу гас. Теперь бит, однажды
     показанный, держится не меньше своего dwell, даже если прогресс уже ушёл
     за range вперёд. Правила, по старшинству:
       1. за hardExit (45% раскрытия следующей сцены) — уйти сразу: старый
          текст не должен лежать поверх почти открывшейся новой сцены;
       2. на экране не больше одного бита: как только начинается следующий,
          удерживаемый уходит;
       3. при прокрутке назад, раньше начала range, — уйти сразу;
       4. иначе держать, пока не истечёт dwell.
     Если быстрый рывок перескочил range целиком за один кадр, бит всё равно
     показывается — прогресс уже в его сцене, до hardExit. */
  const set = (b, on, now) => {
    if (on === b.on) return;
    b.on = on;
    if (on) b.shownAt = now;
    b.el.classList.toggle('is-on', on);
    b.el.setAttribute('aria-hidden', String(!on));
  };
  let prevP = null, lastP = 0, timer = 0;

  function update(p) {
    const now = performance.now();
    lastP = p;
    // бит, в чей range попал прогресс или чей range перескочен вперёд за кадр
    let active = null;
    for (const b of blocks) {
      const [a, z] = b.def.range;
      const crossed = prevP !== null && prevP < a && p > z;
      if ((p >= a && p <= z) || (crossed && p < (b.def.hardExit ?? 1))) active = b;
    }
    let wait = Infinity;
    for (const b of blocks) {
      if (b === active) { set(b, true, now); continue; }
      const [a] = b.def.range;
      const held = b.on && !active && p > a && p < (b.def.hardExit ?? 1)
        && now - b.shownAt < (b.def.dwell || 0);
      if (held) wait = Math.min(wait, b.def.dwell - (now - b.shownAt));
      set(b, held, now);
    }
    prevP = p;
    // удерживаемый бит должен уйти и тогда, когда прокрутка уже остановилась
    // и кадры больше не рисуются
    clearTimeout(timer);
    if (wait < Infinity) timer = setTimeout(() => update(lastP), wait + 16);
  }
  return update;
}
