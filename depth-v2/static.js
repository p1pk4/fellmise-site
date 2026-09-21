/* Статическая версия в браузере.
 *
 * Разметку статики пишет не этот модуль: её вписывает в страницу сборка
 * (build_static_content.mjs) через тот же renderStatic, поэтому готовый HTML
 * есть в документе ещё до JavaScript. Здесь остаётся один случай — превью
 * /depth-v2/?lang=ru: язык там выбирается запросом, а сборка может вписать
 * только один. Тогда разметка пересобирается той же функцией на нужном языке.
 * Отдельной реализации статики тут нет.
 */
import { renderStatic } from './static-markup.js';
import { LOCALE, LINKS } from './route.js';

export function mountStatic(root) {
  if (!root || root.dataset.lang === LOCALE) return;   // уже на нужном языке
  root.innerHTML = renderStatic(LOCALE, LINKS);
  root.dataset.lang = LOCALE;
}
