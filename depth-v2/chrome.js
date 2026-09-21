/* Системный UI маршрута: знак, выбор языка, звук и указатель главы.
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
import { LOCALE, LINKS } from './route.js';
import { mountSound } from './sound.js';

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
  // хранилище может быть запрещено (cookies сайта заблокированы): тогда чтение
  // бросает SecurityError, и без этой защиты падал весь живой модуль
  let saved = null;
  try { saved = sessionStorage.getItem(KEEP); sessionStorage.removeItem(KEEP); } catch { return; }
  if (saved === null) return;
  const v = Number(saved);
  if (!Number.isFinite(v) || v <= 0) return;
  // ждём конца старта journey.js (он ограничен пределом в boot.js), а не
  // фиксированное число кадров: на медленной сети старт длиннее трёх секунд
  const until = performance.now() + 15000;
  const tick = () => {
    if (window.__JOURNEY) window.__JOURNEY.set(v, { instant: true });
    else if (performance.now() < until) requestAnimationFrame(tick);
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
  // Это и есть заголовок страницы: единственный h1, заголовки битов — h2.
  root.appendChild(node('h1', 'mark', 'Fellmise'));

  /* --------------------------------------------- язык и звук, правый верх */
  const tools = node('div', 'tools');

  const langs = node('div', 'lang');
  for (const code of ['en', 'ru']) {
    const a = node('a', `lang__it${code === locale ? ' is-on' : ''}`, code.toUpperCase());
    a.href = LINKS[code];          // продакшен — чистые адреса, превью — ?lang=
    a.setAttribute('aria-current', code === locale ? 'true' : 'false');
    a.addEventListener('click', () => {
      // сохранить место в маршруте, чтобы язык менялся без возврата в начало
      try { sessionStorage.setItem(KEEP, String(window.__JOURNEY?.progress ?? 0)); } catch { /* приватный режим */ }
    });
    langs.appendChild(a);
  }
  tools.appendChild(langs);

  /* Звук — принятый Audio 1 из /proto/, подключённый через sound.js. Контрол
     рисует сам движок, здесь он только переезжает из body в этот кластер:
     состояние включено/выключено остаётся за движком и его data-state. */
  const sound = mountSound(locale);
  tools.appendChild(node('span', 'tools__sep'));
  tools.appendChild(sound.control);
  root.appendChild(tools);

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

  window.__SOUND = sound;    // только для smoke-проверок звука

  const update = function update(p, sectionId) {
    sound.update(p);          // звук подписан на маршрут, а не наоборот
    setChapter(sectionId);
    run.style.transform = `scaleX(${p.toFixed(4)})`;
    hint.style.opacity = p > 0.02 ? '0' : '1';
  };
  // переход в статику: звук и его кнопка больше не нужны
  update.stop = () => { clearTimeout(swap); sound.destroy(); };
  return update;
}

restoreProgress();
