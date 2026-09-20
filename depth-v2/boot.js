/* Загрузка /depth-v2/: живой маршрут грузится ТОЛЬКО там, где он уместен.
 *
 * Тот же принцип, что и в /proto/boot.js: в статике модули живого режима не
 * запрашиваются вовсе. Здесь их два — journey.js со всей хореографией и, через
 * него, chrome.js с контролом звука. Поэтому ранний выход отсюда сразу даёт всё,
 * что требуется от статики: ни диафрагм, ни масштабирования, ни прокрутки,
 * ни кнопки звука, ни AudioContext — не потому что они выключены, а потому что
 * этот код просто не исполняется.
 *
 * Условие одно на два случая, и второго fallback-сайта не заводится:
 *   • узкий экран — маршрут рассчитан на 1280+ и колесо;
 *   • prefers-reduced-motion — человек попросил не двигать картинку, а весь
 *     смысл этого маршрута в непрерывном движении внутрь мира.
 *
 * Те же два условия продублированы в depth.css, который показывает заглушку и
 * прячет сцену. CSS и этот гейт обязаны сходиться: правило там записано ровно
 * тем же медиавыражением.
 */
const NARROW = '(max-width: 1279px)';
const CALM = '(prefers-reduced-motion: reduce)';

const live = !matchMedia(NARROW).matches && !matchMedia(CALM).matches;
document.documentElement.dataset.mode = live ? 'live' : 'static';
if (!live) document.getElementById('narrow').dataset.why = matchMedia(NARROW).matches ? 'narrow' : 'calm';

if (live) import('./journey.js');
