/* Разметка статической версии маршрута — одна функция, одна реализация.
 *
 * renderStatic(locale, links) возвращает HTML-строку. Её вызывают в двух местах,
 * и нигде больше статическая версия не собирается:
 *
 *   • build_static_content.mjs — при сборке вписывает результат прямо в / ,
 *     /ru/ и превью между маркерами STATIC_CONTENT. Поэтому содержимое есть в
 *     документе ДО любого JavaScript: без JS, на узком экране и при
 *     reduced-motion человек видит один и тот же готовый HTML;
 *   • static.js — в браузере, и только на превью, когда ?lang=ru просит другой
 *     язык, чем тот, что вписан в страницу при сборке.
 *
 * Модуль чистый: ни DOM, ни location. Тексты — из content-data.js, картинки —
 * принятые плиты сцен, которыми идёт и живой маршрут.
 */
import { BEATS, STATIC_UI } from './content-data.js';

const SCENES = {
  village:   '/out/depth-v2/h2f/hero_plate_clean.webp',
  forest:    '/out/depth-v2/h2f/forest_plate.webp',
  mine:      '/out/depth-v2/m2s/mine_plate.webp',
  threshold: '/out/depth-v2/s2c/threshold_plate.webp',
  core:      '/out/depth-v2/s2c/core_plate.webp',
  home:      '/out/depth-v2/c2h/home_plate.webp',
};

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderStatic(locale, links) {
  const t = STATIC_UI[locale] || STATIC_UI.en;
  const other = locale === 'en' ? 'ru' : 'en';
  const out = [];
  out.push('<header class="st__top">');
  // единственный h1 страницы — имя игры; заголовки битов идут h2
  out.push('<h1 class="st__mark">Fellmise</h1>');
  out.push(`<a class="st__lang" href="${esc(links[other])}" hreflang="${other}" aria-label="${esc(t.otherLabel)}">${esc(t.other)}</a>`);
  out.push('</header>');
  BEATS.forEach((b, i) => {
    const c = b[locale] || b.en;
    out.push('<section class="st__beat">');
    // первая плита нужна сразу, остальные — по мере прокрутки
    out.push(`<img src="${SCENES[b.id]}" alt="" width="1536" height="960" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async">`);
    out.push('<div class="st__text">');
    out.push(`<h2 class="st__headline">${esc(c.headline)}</h2>`);
    if (c.body) out.push(`<p class="st__body">${esc(c.body)}</p>`);
    if (c.statements && c.statements.length) {
      out.push('<ul class="st__says">');
      for (const x of c.statements) out.push(`<li>${esc(x)}</li>`);
      out.push('</ul>');
    }
    out.push('</div>');
    out.push('</section>');
  });
  out.push('<footer class="st__foot">');
  out.push(`<p class="st__note">${esc(t.note)}</p>`);
  out.push('<p class="st__copy">© 2026 Fellmise</p>');
  out.push('</footer>');
  return out.join('\n');
}
