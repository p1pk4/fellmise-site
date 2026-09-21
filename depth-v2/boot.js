/* Развилка маршрута: живой он или статический. Один и тот же код обслуживает
 * три входа — /, /ru/ и превью /depth-v2/.
 *
 * Режим уже отметил ранний скрипт в <head> (data-mode на <html>), до первой
 * отрисовки: статическая разметка лежит в документе с самого начала, и без
 * этого на десктопе она бы мелькнула. Здесь режим только читается; если
 * раннего скрипта почему-то нет, решение принимается заново по тем же двум
 * условиям — узкий экран или prefers-reduced-motion.
 *
 * Тот же принцип, что и в /proto/boot.js: лишняя ветка не запрашивается вовсе.
 * В статике не грузятся ни journey.js со всей хореографией, ни chrome.js, ни
 * движок звука — там физически нет ни прокрутки камерой, ни кнопки звука, ни
 * AudioContext. В живом режиме, наоборот, статическая разметка удаляется из
 * документа: она не нужна, её картинки не должны грузиться, а заголовок h1 на
 * странице должен остаться один — знак Fellmise в системном UI.
 */
const NARROW = '(max-width: 1279px)';
const CALM = '(prefers-reduced-motion: reduce)';

const d = document.documentElement;
if (!d.dataset.mode) {
  const asked = new URLSearchParams(location.search).get('lang');
  if (location.pathname.includes('/depth-v2/') && (asked === 'en' || asked === 'ru')) d.lang = asked;
  d.dataset.mode = matchMedia(NARROW).matches || matchMedia(CALM).matches ? 'static' : 'live';
}

if (d.dataset.mode === 'live') {
  document.getElementById('static')?.remove();
  import('./journey.js');
} else {
  import('./static.js').then((m) => m.mountStatic(document.getElementById('static')));
}
