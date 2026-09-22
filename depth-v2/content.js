/* Контент маршрута: тексты и их постановка. Логики движения здесь нет, и
 * наоборот — в journey.js нет ни одной строки копирайта.
 *
 * Копия лежит под ключом локали, по одному объекту на язык. Разметка и стили
 * от языка не зависят: / открывается по-английски, /ru/ — по-русски, а превью
 * /depth-v2/ переключается запросом ?lang=. Какой именно вход открыт, решает
 * route.js; язык браузера не определяется нигде.
 *
 * Текст биома держится, пока биом визуально текущий: сцена назначения ещё не
 * заняла TAKEOVER кадра (journey.js). Короткие окна range для показа больше
 * не используются — range[0] деревни задаёт только, когда появится первый
 * текст (первый кадр маршрута остаётся чистым).
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

  /* Какой бит показан, решает journey.js: текущий биом — тот, чья сцена
     визуально занимает кадр (доля кадра сцены назначения ещё не дошла до
     TAKEOVER). Текст биома держится всё время, пока биом текущий; начало
     деревни — её range[0], чтобы первый кадр оставался чистым.
     Смена бита последовательная: прежний гаснет, новый появляется после
     его ухода (SWAP мс), поэтому основного текста на экране не бывает два.
     Сама анимация — временная, на CSS, текст не скрабится колесом. */
  const SWAP = 380;
  const set = (b, on) => {
    if (on === b.on) return;
    b.on = on;
    b.el.classList.toggle('is-on', on);
    b.el.setAttribute('aria-hidden', String(!on));
  };
  let want = null, shown = null, timer = 0;
  function update(p, idx) {
    const next = p >= BEATS[0].range[0] ? blocks[idx] || null : null;
    if (next === want) return;
    want = next;
    clearTimeout(timer);
    if (shown && shown !== want) { set(shown, false); shown = null; }
    if (!want) return;
    const anyOn = blocks.some((b) => b.on);
    const show = () => { if (want === next) { set(next, true); shown = next; } };
    if (anyOn) timer = setTimeout(show, SWAP); else show();
  }
  return update;
}
