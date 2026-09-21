/* Развилка маршрута: живой он или статический. Один и тот же код обслуживает
 * три входа — /, /ru/ и превью /depth-v2/, — и решение принимается здесь один
 * раз, до загрузки чего бы то ни было тяжёлого.
 *
 * Тот же принцип, что и в /proto/boot.js: лишняя ветка не запрашивается вовсе.
 * В статике не грузятся ни journey.js со всей хореографией, ни chrome.js, ни
 * движок звука, поэтому там физически нет ни диафрагм, ни прокрутки, ни кнопки
 * звука, ни AudioContext — не выключены, а просто отсутствуют.
 *
 * Условие одно на два случая, и второго сайта не заводится:
 *   • узкий экран — маршрут рассчитан на 1280+ и колесо;
 *   • prefers-reduced-motion — человек попросил не двигать картинку, а весь
 *     смысл этого маршрута в непрерывном движении внутрь мира.
 *
 * Те же два условия продублированы в depth.css, который прячет сцену. CSS и
 * этот гейт обязаны сходиться: правило там записано тем же медиавыражением.
 */
const NARROW = '(max-width: 1279px)';
const CALM = '(prefers-reduced-motion: reduce)';

// на превью язык задаётся запросом; отметить его нужно до статики, иначе она
// не узнает, на каком языке говорить
const asked = new URLSearchParams(location.search).get('lang');
if (location.pathname.includes('/depth-v2/') && (asked === 'en' || asked === 'ru')) {
  document.documentElement.lang = asked;
}

const live = !matchMedia(NARROW).matches && !matchMedia(CALM).matches;
document.documentElement.dataset.mode = live ? 'live' : 'static';

if (live) {
  import('./journey.js');
} else {
  import('./static.js').then((m) => m.mountStatic(document.getElementById('static')));
}
