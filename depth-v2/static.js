/* Статическая версия маршрута: то же содержание без движения.
 *
 * Её видят те, кому живой маршрут не подходит: узкий экран без колеса и люди,
 * попросившие систему уменьшить движение. Раньше здесь стояла одна строка о
 * том, что прототип десктопный. Для продакшена это не годится: человек пришёл
 * на сайт игры, а не на прототип, и должен прочитать про мир, а не про
 * требования к экрану.
 *
 * Тексты берутся из того же content.js, что и живой маршрут, а картинки — те же
 * принятые плиты сцен. Ни одной отдельной строки копирайта здесь нет, поэтому
 * разойтись двум версиям негде: правка текста правит обе.
 *
 * Хореографии, звука и системного хрома живого режима тут нет вовсе — в
 * статике эти модули даже не загружаются.
 */
import { BEATS } from './content.js';
import { LOCALE, LINKS } from './route.js';

/* Плиты принятых сцен, по одной на бит. Это те же файлы, которыми идёт живой
   маршрут, — новых изображений не заводится. */
const SCENES = {
  village:   '/out/depth-v2/h2f/hero_plate_clean.webp',
  forest:    '/out/depth-v2/h2f/forest_plate.webp',
  mine:      '/out/depth-v2/m2s/mine_plate.webp',
  threshold: '/out/depth-v2/s2c/threshold_plate.webp',
  core:      '/out/depth-v2/s2c/core_plate.webp',
  home:      '/out/depth-v2/c2h/home_plate.webp',
};

/* Примечание — дословно строка .note прежних корневых страниц / и /ru/, не
   новый текст. */
const UI = {
  en: { other: 'RU', otherLabel: 'Русский', note: 'Fellmise is in early development. Everything here is still being built and will change.' },
  ru: { other: 'EN', otherLabel: 'English',  note: 'Игра в ранней разработке. Всё, что видишь, ещё поменяется.' },
};

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export function mountStatic(root) {
  const t = UI[LOCALE] || UI.en;
  const other = LOCALE === 'en' ? 'ru' : 'en';
  root.textContent = '';
  root.hidden = false;

  const head = node('header', 'st__top');
  // тот же единственный h1, что и в живом режиме: имя игры, биты — h2
  head.appendChild(node('h1', 'st__mark', 'Fellmise'));
  const alt = node('a', 'st__lang', t.other);
  alt.href = LINKS[other];
  alt.hreflang = other;
  alt.setAttribute('aria-label', t.otherLabel);
  head.appendChild(alt);
  root.appendChild(head);

  BEATS.forEach((b, i) => {
    const c = b[LOCALE] || b.en;
    const sec = node('section', 'st__beat');
    const img = document.createElement('img');
    img.src = SCENES[b.id];
    img.alt = '';
    // первый кадр нужен сразу, остальные — по мере прокрутки: на телефоне
    // шесть плит разом это лишние полтора мегабайта
    img.loading = i === 0 ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.width = 1536; img.height = 960;
    sec.appendChild(img);

    const text = node('div', 'st__text');
    text.appendChild(node('h2', 'st__headline', c.headline));
    if (c.body) text.appendChild(node('p', 'st__body', c.body));
    if (c.statements && c.statements.length) {
      const ul = node('ul', 'st__says');
      c.statements.forEach((x) => ul.appendChild(node('li', null, x)));
      text.appendChild(ul);
    }
    sec.appendChild(text);
    root.appendChild(sec);
  });

  const foot = node('footer', 'st__foot');
  foot.appendChild(node('p', 'st__note', t.note));
  foot.appendChild(node('p', 'st__copy', '© 2026 Fellmise'));
  root.appendChild(foot);
}
