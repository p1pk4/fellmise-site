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

/* Живой режим может не состояться: не пришёл модуль, первая сцена не
   загрузилась, старт не уложился в предел, окно стало уже или включили
   reduced-motion. Тогда страница переходит в ту же статическую версию — второй
   запасной нет. Статика вынута из документа, но не выброшена: сюда она и
   возвращается. Переход окончательный: живой модуль, пришедший позже,
   страницу уже не забирает (journey.js проверяет режим и после каждого
   ожидания), его слушатели, текстуры и звук освобождает __LIVE_STOP. */
const START_LIMIT = 12000;        // мс до первого кадра живой сцены
const staticRoot = document.getElementById('static');

function toStatic(reason) {
  if (d.dataset.mode !== 'live') return;
  d.dataset.mode = 'static';
  d.dataset.fallback = reason;
  try { window.__LIVE_STOP?.(); } catch { /* живой режим уже не нужен */ }
  if (staticRoot && !staticRoot.isConnected) document.body.insertBefore(staticRoot, document.getElementById('debug'));
  import('./static.js').then((m) => m.mountStatic(staticRoot)).catch(() => {});
}

if (d.dataset.mode === 'live') {
  staticRoot?.remove();
  // деревню 1536 просим сразу, до модулей маршрута: на медленной сети она
  // приходит раньше hi-res и становится стартовым кадром (journey.js, BOOT_HI)
  for (const f of ['hero_plate_clean', 'hero_fg_oak', 'hero_fg_fence_l', 'hero_fg_fence_r']) {
    new Image().src = `/assets/depth/h2f/${f}.webp`;
  }
  const limit = setTimeout(() => toStatic('timeout'), START_LIMIT);
  import('./journey.js').then(() => clearTimeout(limit), () => { clearTimeout(limit); toStatic('error'); });
  for (const [q, reason] of [[NARROW, 'narrow'], [CALM, 'reduced-motion']]) {
    matchMedia(q).addEventListener('change', (e) => { if (e.matches) toStatic(reason); });
  }
} else {
  import('./static.js').then((m) => m.mountStatic(staticRoot));
}
