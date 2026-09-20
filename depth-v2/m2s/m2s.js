/* mine -> spirit threshold по архитектуре, заработавшей в hero -> forest v7.
 *
 * Движение несёт сама сцена: ЦЕЛЬНАЯ плита выработки масштабируется от точки
 * схода рельса — один растр, один центр, одна скорость. Летящих кусков здесь
 * нет вовсе: вырезок переднего плана в этом переходе не заводится, потому что
 * при ходе вперёд ближние валуны и так уходят за края вместе с плитой. Резать
 * сцену не на что, и ощущения разрезанного кадра взяться неоткуда.
 *
 * Порог духов — не вставка. Его плита и диафрагма масштабируются от ТОЙ ЖЕ
 * точки схода, поэтому он ведёт себя как объект впереди по рельсу: сперва
 * далёкая цель, потом приближается. Плита смещена так, что в точку схода
 * попадает стела со светящейся спиралью — самая читаемая деталь порога.
 * Первое чтение поэтому светлое и понятное, а не тёмное пятно: в устье
 * тёмной выработки появляется свет.
 *
 * Диафрагма — мягкая круглая, чуть вытянутая по вертикали, с длинным
 * многоступенчатым спадом: ни кромки, ни контура, ни замочной скважины.
 */
const BASE = '/out/depth-v2/m2s/';
const stage = document.getElementById('stage');
const panel = document.getElementById('debug');
const debug = new URLSearchParams(location.search).get('debug') === '1';
if (debug) panel.hidden = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const q = (v, s) => Math.round(v / s) * s;

const index = await (await fetch(BASE + 'index.json')).json();
const VP = index.vp;                       // рельс сходится в устье
const ORIGIN = `${VP[0] * 100}% ${VP[1] * 100}%`;
// стела порога должна встать ровно в точку схода
const AIM = [(VP[0] - index.target[0]) * 100, (VP[1] - index.target[1]) * 100];

function el(tag, cls, z) {
  const n = document.createElement(tag);
  n.className = cls;
  if (z !== undefined) n.style.zIndex = String(z);
  stage.appendChild(n);
  return n;
}

const mine = el('img', 'sheet', 0);
mine.src = BASE + index.plate;

const spiritHolder = el('div', 'holder', 1);
const spirit = document.createElement('img');
spirit.className = 'sheet';
spirit.src = BASE + index.next;
spiritHolder.appendChild(spirit);

for (const n of [mine, spirit]) {
  n.alt = '';
  n.decoding = 'async';
  n.style.transformOrigin = ORIGIN;
}

/* ------------------------------------------------------------ хореография */
/*  0.00-0.58  только выработка: ход вперёд по рельсу к устью
 *  0.58-0.72  впереди в устье открывается порог — маленькая мягкая диафрагма,
 *             в ней светящаяся стела: читаемая дальняя цель, не пятно
 *  0.72-0.94  диафрагма раскрывается быстро; камень выработки уже ушёл за края
 *  0.94-1.00  порог остаётся один                                           */
const GATE_IN = 0.58, GATE_MID = 0.72, GATE_OUT = 0.94;

let p = 0, target = 0, raf = 0, last = performance.now(), lastMask = '';
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  const travel = 0.62 * p + 0.38 * (p ** 1.8);
  const cam = 1 + 1.26 * travel;
  mine.style.transform = `scale(${cam.toFixed(4)})`;

  const shown = p >= GATE_IN - 0.01;
  if (spiritHolder.hidden === shown) spiritHolder.hidden = !shown;
  if (shown) {
    const g = seg(p, GATE_IN, GATE_OUT);
    const k = innerWidth / 1920;
    const r = q((58 + 1880 * (g ** 1.45)) * k, 4);
    const ry = q(r * 1.12, 4);
    const m = `radial-gradient(ellipse ${r}px ${ry}px at ${(VP[0] * 100).toFixed(1)}% ${(VP[1] * 100).toFixed(1)}%,`
      + ' #000 0 46%, rgba(0,0,0,.92) 62%, rgba(0,0,0,.6) 78%, rgba(0,0,0,.22) 90%, transparent 100%)';
    if (m !== lastMask) {
      spiritHolder.style.webkitMaskImage = m;
      spiritHolder.style.maskImage = m;
      lastMask = m;
    }
    // порог приближается по рельсу; прицел на стелу уходит к финалу,
    // и сцена встаёт своей компоновкой
    const aim = 1 - smooth(seg(p, GATE_MID, 0.99));
    // к GATE_MID плита обязана покрыть кадр целиком: диафрагма к этому
    // моменту перерастает её края, и иначе сверху виден прямой край плиты
    const sk = 0.66 + 0.34 * smooth(seg(p, GATE_IN, GATE_MID))
      + 0.30 * smooth(seg(p, GATE_MID, 1));
    spirit.style.transform =
      `translate3d(${(AIM[0] * aim).toFixed(2)}%, ${(AIM[1] * aim).toFixed(2)}%, 0) scale(${sk.toFixed(4)})`;
  }

  mine.style.opacity = (1 - smooth(seg(p, GATE_OUT, 0.99))).toFixed(3);

  if (debug) {
    const phase = p < GATE_IN ? 'mine approach' : p < GATE_MID ? 'threshold ahead'
      : p < GATE_OUT ? 'aperture opening' : 'threshold';
    panel.textContent = `t      ${p.toFixed(3)}\nphase  ${phase}\ncam    ${cam.toFixed(2)}`;
  }

  frames.push(now);
  if (frames.length > 240) frames.shift();
  if (p !== target) schedule();
}

function schedule() { if (!raf) raf = requestAnimationFrame(apply); }

addEventListener('wheel', (e) => {
  target = clamp(target + e.deltaY * 0.00055, 0, 1);
  schedule();
}, { passive: true });

addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.1 : 0.02;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') target = clamp(target + step, 0, 1);
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') target = clamp(target - step, 0, 1);
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = 1;
  else return;
  schedule();
});
addEventListener('resize', () => { lastMask = ''; schedule(); });

await Promise.all([mine, spirit]
  .map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
spiritHolder.hidden = true;
schedule();

window.__M2S = {
  get progress() { return p; },
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
};
