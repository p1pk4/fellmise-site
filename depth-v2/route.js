/* Маршрутизация и язык: единственное, чем различаются три входа в один и тот же
 * маршрут. Ни хореографии, ни копирайта, ни звука здесь нет.
 *
 * Движок живёт в одном экземпляре, в этой папке. Продакшен-страницы /
 * и /ru/ подключают ровно эти же файлы по абсолютным путям, поэтому разойтись
 * им негде: копий нет, сцена, тексты и тайминги у всех трёх входов одни.
 *
 *   /            EN, ссылка RU ведёт на /ru/
 *   /ru/         RU, ссылка EN ведёт на /
 *   /depth-v2/   превью, язык переключается через ?lang= и остаётся внутри
 *
 * Язык берётся из самой страницы — из атрибута lang у <html>. Так продакшен
 * получает чистые адреса без ?lang=en, а превью сохраняет прежний способ
 * смотреть обе локали, не заводя двух страниц.
 */
const SUPPORTED = ['en', 'ru'];

const PREVIEW = location.pathname.includes('/depth-v2/');

function resolveLocale() {
  // на превью запрос имеет приоритет: там ?lang= и есть способ смотреть язык
  const asked = new URLSearchParams(location.search).get('lang');
  if (PREVIEW && SUPPORTED.includes(asked)) return asked;
  const marked = document.documentElement.getAttribute('lang');
  if (SUPPORTED.includes(marked)) return marked;
  return 'en';
}

export const LOCALE = resolveLocale();
export const IS_PREVIEW = PREVIEW;

/* Куда ведут ссылки переключения языка. В продакшене — чистые адреса, на
   превью — тот же документ с другим запросом. */
export const LINKS = PREVIEW
  ? { en: './', ru: './?lang=ru' }
  : { en: '/', ru: '/ru/' };
