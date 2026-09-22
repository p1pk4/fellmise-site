/* POC: находки шахты. Только превью /depth-v2/?poc=mine; / и /ru/ этот
 * модуль и его картинки не грузят вовсе.
 *
 * Пока пользователь идёт глубже, в свободных местах кадра одна за другой
 * «шлёпаются» отдельные нарисованные находки и остаются: к концу шахты
 * вокруг основного текста собрана маленькая коллекция. Это не инвентарь, не
 * HUD и не карточки: предмет без рамки и плашки, под ним название и одна
 * строка. Стрелок к окружению нет — находка принадлежит странице, а не
 * точке в сцене.
 *
 * Появление: opacity 0→1 и scale .88→1.025→1 за ~220 мс, у каждого предмета
 * свой постоянный наклон. После появления предмет неподвижен. Когда шахта
 * перестаёт доминировать (начинается захват кадра порогом), группа уходит
 * целиком. Правило — функция локального прогресса шахты, поэтому при
 * прокрутке назад находки убираются в обратном порядке.
 *
 * Копия — POC, финальный текст сверяется с GDD позже.
 */
import { LOCALE } from './route.js';

const ASSETS = '/assets/depth/discovery/mine/';
/* at — локальный прогресс шахты, с которого находка лежит на странице;
   x, y — центр предмета в долях кадра; h — высота предмета в долях высоты
   кадра (мешок — самый тяжёлый, кристаллы — мелкий акцент); rot — постоянный
   наклон; cap — с какой стороны подпись (below / above / left / right);
   cx — собственный сдвиг подписи по горизонтали в долях кадра.
   Асимметричная группа в правой половине кадра: слева — основной текст
   шахты, по центру — устье, вагонетка и рельсы. */
const ITEMS = [
  { id: 'ore-sample', at: 0.10, x: 0.815, y: 0.215, h: 0.13, rot: -2, cap: 'below', cx: 0.028,
    en: ['Ore sample', 'Depth changes what the rock gives back.'],
    ru: ['Образец руды', 'С глубиной меняется то, что отдаёт порода.'] },
  { id: 'mining-pickaxe', at: 0.26, x: 0.905, y: 0.42, h: 0.15, rot: 1.5, cap: 'below', cx: -0.022,
    en: ['Mining Pick', 'The right tool decides what you can bring back.'],
    ru: ['Кирка', 'От инструмента зависит, что ты сможешь унести наверх.'] },
  { id: 'ore-cargo', at: 0.43, x: 0.875, y: 0.79, h: 0.19, rot: -1, cap: 'above',
    en: ['The haul', 'What you extract feeds crafting and trade.'],
    ru: ['Добыча', 'То, что вынесешь наверх, идёт в ремесло и торговлю.'] },
  { id: 'deep-material', at: 0.60, x: 0.745, y: 0.82, h: 0.11, rot: 2, cap: 'below', cx: 0.014,
    en: ['Rare Crystal', 'Richer materials wait where the risk is higher.'],
    ru: ['Редкий кристалл', 'Чем ценнее находка, тем опаснее путь к ней.'] },
];
const EXIT = 0.90;          // группа уходит до захвата кадра порогом (m = 1)

const CSS = `
.poc-finds { position: fixed; inset: 0; pointer-events: none; z-index: 40; }
.poc-find { position: absolute; left: 0; top: 0; margin: 0; display: flex; flex-direction: column; align-items: center;
  opacity: 0; transition: opacity .32s ease; }
.poc-find--left { flex-direction: row-reverse; align-items: center; }
.poc-find--right { flex-direction: row; align-items: center; }
.poc-find--above { flex-direction: column-reverse; }
.poc-find--left figcaption { margin: 0 14px 0 0; text-align: right; }
.poc-find--right figcaption { margin: 0 0 0 14px; text-align: left; }
.poc-find--above figcaption { margin: 0 0 10px; }
.poc-find img { display: block; width: auto; transform: rotate(var(--rot));
  filter: drop-shadow(0 6px 9px rgba(8, 6, 4, .5)); }
.poc-find.is-on { opacity: 1; transition: none; animation: poc-stick .22s cubic-bezier(.2, .7, .3, 1) both; }
@keyframes poc-stick {
  0% { opacity: 0; transform: var(--at) scale(.88); }
  65% { opacity: 1; transform: var(--at) scale(1.025); }
  100% { opacity: 1; transform: var(--at) scale(1); }
}
.poc-find figcaption { position: relative; margin-top: 12px; max-width: 19rem; text-align: center; color: #eadcbc;
  text-shadow: 0 1px 8px rgba(0, 0, 0, .8), 0 0 2px rgba(0, 0, 0, .6); }
/* мягкая тень только под буквами: растворяется к краям, границы не видно */
.poc-find figcaption::before { content: ''; position: absolute; inset: -18px -36px; z-index: -1;
  background: radial-gradient(closest-side, rgba(10, 9, 8, .62), rgba(10, 9, 8, .34) 55%, transparent); }
.poc-find b, .poc-find span { white-space: nowrap; }
.poc-find b { display: block; font: 700 clamp(15px, .95vw, 19px)/1.05 Podkova, Georgia, serif; letter-spacing: .04em;
  text-transform: uppercase; color: #e7b999; }
.poc-find span { display: block; margin-top: .35em; font: 500 clamp(13px, .8vw, 15.5px)/1.35 Vollkorn, Georgia, serif; }
`;

export function mountMinePoc(parent) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'poc-finds';
  root.setAttribute('aria-hidden', 'true');
  parent.appendChild(root);
  const lang = LOCALE === 'ru' ? 'ru' : 'en';
  const finds = ITEMS.map((d) => {
    const fig = document.createElement('figure');
    fig.className = `poc-find poc-find--${d.cap}`;
    fig.dataset.find = d.id;
    fig.style.setProperty('--rot', `${d.rot}deg`);
    const img = new Image();
    img.src = `${ASSETS}${d.id}.webp`;
    img.alt = '';
    img.decoding = 'async';
    const cap = document.createElement('figcaption');
    cap.innerHTML = '<b></b><span></span>';
    if (d.cx) cap.style.transform = `translateX(${(d.cx * 100).toFixed(2)}vw)`;
    cap.querySelector('b').textContent = d[lang][0];
    cap.querySelector('span').textContent = d[lang][1];
    fig.append(img, cap);
    root.appendChild(fig);
    return { d, fig, img, on: false };
  });

  function layout() {
    const W = innerWidth, H = innerHeight;
    for (const f of finds) {
      f.img.style.height = `${Math.round(f.d.h * H)}px`;
      // центр предмета — в (x, y); подпись сбоку или сверху/снизу от него
      const fw = f.fig.offsetWidth, fh = f.fig.offsetHeight, iw = f.img.offsetWidth, ih = f.img.offsetHeight;
      const cx = f.d.x * W, cy = f.d.y * H;
      let left = cx - fw / 2, top = cy - fh / 2;
      if (f.d.cap === 'below') top = cy - ih / 2;
      if (f.d.cap === 'above') top = cy + ih / 2 - fh;
      if (f.d.cap === 'left') left = cx + iw / 2 - fw;
      if (f.d.cap === 'right') left = cx - iw / 2;
      left = Math.min(Math.max(left, 0.52 * W), W - fw - 0.02 * W);
      const at = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      f.fig.style.setProperty('--at', at);
      f.fig.style.transform = at;
    }
  }
  addEventListener('resize', layout);
  for (const f of finds) f.img.addEventListener('load', layout);
  layout();

  /* m — локальный прогресс шахты (0..1) или null вне её */
  return function update(m) {
    for (const f of finds) {
      const on = m != null && m >= f.d.at && m < EXIT;
      if (on === f.on) continue;
      f.on = on;
      f.fig.classList.toggle('is-on', on);
    }
  };
}
