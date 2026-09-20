/* Системный UI маршрута: знак, выбор языка и указатель главы.
 *
 * Вынесен из journey.js целиком. Там теперь нет ни одной строки об интерфейсе,
 * здесь — ни одной строки хореографии: модуль получает общий прогресс и id
 * текущей секции и больше ничего о движении не знает.
 *
 * Названия глав живут только здесь. В journey.js их больше нет: второй источник
 * тех же строк неизбежно разъехался бы с этим. Ключи — это id секций маршрута,
 * плюс home для прибытия.
 *
 * Локаль берётся из content.js, чтобы язык у контента и у интерфейса был один
 * и переключался в одном месте.
 */
import { LOCALE } from './content.js';

const CHAPTERS = {
  hero:      { en: 'Village',        ru: 'Деревня' },
  forest:    { en: 'Forest',         ru: 'Лес' },
  mine:      { en: 'Mine',           ru: 'Глубина' },
  threshold: { en: 'Spirit',         ru: 'Порог' },
  core:      { en: 'The dead world', ru: 'Мир мёртвых' },
  home:      { en: 'Home',           ru: 'Дом' },
};

const HINT = { en: 'scroll', ru: 'крутите' };

/* Переключение языка перезагружает страницу: это самый честный способ сменить
   локаль, не трогая ни хореографию, ни порядок монтирования. Чтобы человек не
   оказался в начале маршрута, прогресс кладётся в sessionStorage и сразу после
   старта возвращается через публичный API journey.js. */
const KEEP = 'depth-v2:progress';

function restoreProgress() {
  const saved = sessionStorage.getItem(KEEP);
  if (saved === null) return;
  sessionStorage.removeItem(KEEP);
  const v = Number(saved);
  if (!Number.isFinite(v) || v <= 0) return;
  let tries = 0;
  const tick = () => {
    if (window.__JOURNEY) window.__JOURNEY.set(v, { instant: true });
    else if (tries++ < 180) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export function mountChrome(root, locale = LOCALE) {
  const pick = (o) => o[locale] || o.en;

  /* ----------------------------------------------------------- знак */
  // Существующее текстовое начертание проекта, без нового ассета и подложки.
  root.appendChild(node('div', 'mark', 'Fellmise'));

  /* --------------------------------------------------- язык, правый верх */
  const tools = node('div', 'tools');

  const langs = node('div', 'lang');
  for (const code of ['en', 'ru']) {
    const a = node('a', `lang__it${code === locale ? ' is-on' : ''}`, code.toUpperCase());
    a.href = code === 'en' ? './' : './?lang=ru';
    a.setAttribute('aria-current', code === locale ? 'true' : 'false');
    a.addEventListener('click', () => {
      // сохранить место в маршруте, чтобы язык менялся без возврата в начало
      try { sessionStorage.setItem(KEEP, String(window.__JOURNEY?.progress ?? 0)); } catch { /* приватный режим */ }
    });
    langs.appendChild(a);
  }
  tools.appendChild(langs);
  root.appendChild(tools);

  /* Управления звуком здесь намеренно нет. Движка в прототипе тоже нет, а
     кнопка, которая выглядит рабочей и ничего не делает, читается как
     недоделанный сайт. Вернём вместе с настоящим audio engine отдельным
     проходом: точка подключения — этот модуль и класс is-on на контроле. */

  /* ------------------------------------------ глава и маршрут, низ по центру */
  const route = node('div', 'route');
  const name = node('div', 'route__name');
  const line = node('div', 'route__line');
  const run = node('i', null);
  line.appendChild(run);
  route.append(name, line);
  root.appendChild(route);

  const hint = node('div', 'hint', pick(HINT));
  root.appendChild(hint);

  /* Смена главы: текст гаснет, подменяется и возвращается. Никакого масштаба,
     отскока и переездов через полэкрана — движение меньше, чем у контента. */
  let shown = null, swap = 0;
  function setChapter(id) {
    if (id === shown) return;
    shown = id;
    const text = pick(CHAPTERS[id] || CHAPTERS.hero);
    clearTimeout(swap);
    if (!name.textContent) { name.textContent = text; name.classList.add('is-on'); return; }
    name.classList.remove('is-on');
    swap = setTimeout(() => {
      name.textContent = text;
      name.classList.add('is-on');
    }, 220);
  }

  return function update(p, sectionId) {
    setChapter(sectionId);
    run.style.transform = `scaleX(${p.toFixed(4)})`;
    hint.style.opacity = p > 0.02 ? '0' : '1';
  };
}

restoreProgress();
