/* forest -> mine: движение несёт ДОРОГА, а не вырезки.
 *
 * Чем отличается от прошлой версии. Там главным источником движения были
 * крупные боковые стволы: они масштабировались на зрителя от собственных
 * точек и читались отдельными слоями, летящими в камеру, — сцена выглядела
 * разрезанной. Здесь наоборот.
 *
 * Ход вперёд по дороге — это масштабирование ЦЕЛЬНОЙ плиты от точки схода.
 * Одна картина, один центр, одна скорость: внутри ничего не разъезжается, и
 * весь кадр растекается наружу ровно так, как растекается мир, когда идёшь по
 * дороге. Это и есть forward travel, ничего резать для него не нужно.
 *
 * Шахта — не вставка в центр. Её плита и окно масштабируются ОТ ТОЙ ЖЕ точки
 * схода и в том же темпе, поэтому она ведёт себя как настоящий объект на
 * дороге: сперва далёкая цель впереди, потом приближается.
 *
 * Вырезки стволов оставлены вспомогательными: они идут чуть быстрее плиты
 * (слабый ближний параллакс) и уходят ДО того, как шахта становится центром,
 * чтобы не спорить с ней отдельной анимацией.
 */
const BASE = '/assets/depth/f2m/';
const stage = document.getElementById('stage');
const panel = document.getElementById('debug');
const debug = new URLSearchParams(location.search).get('debug') === '1';
if (debug) panel.hidden = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const q = (v, s) => Math.round(v / s) * s;

const index = await (await fetch(BASE + 'index.json')).json();
const VP = index.passage.anchor;              // точка схода дороги
const ORIGIN = `${VP[0] * 100}% ${VP[1] * 100}%`;

function el(tag, cls, z) {
  const n = document.createElement(tag);
  n.className = cls;
  if (z !== undefined) n.style.zIndex = String(z);
  stage.appendChild(n);
  return n;
}

const forest = el('img', 'sheet', 0);
forest.src = BASE + index.plate;

const mineHolder = el('div', 'holder', 1);
const mine = document.createElement('img');
mine.className = 'sheet';
mine.src = BASE + index.next;
mineHolder.appendChild(mine);

/* только два ствола: валун и пень у самого низа кадра при ходе вперёд
   и так уходят вместе с плитой, отдельный слой для них не нужен */
const FG = index.cutouts
  .filter((c) => c.id === 'trunk_l' || c.id === 'trunk_r')
  .map((c, i) => {
    const im = el('img', 'sheet', 4 + i);
    im.src = BASE + c.file;
    return { im, id: c.id };
  });

for (const n of [forest, mine, ...FG.map((f) => f.im)]) {
  n.alt = ''; n.decoding = 'async';
  n.style.transformOrigin = ORIGIN;          // общая точка схода у всех
}

/* ------------------------------------------------------------ хореография */
/*  A 0.00-0.55  только лес: ход по дороге к точке схода
 *  B 0.55-0.70  впереди на дороге впервые читается шахта — вход, рельс, огонь
 *  C 0.70-0.88  идём дальше, шахта становится целью; стволы уже ушли
 *  D 0.88-1.00  шахта забирает кадр                                         */
const B_IN = 0.55, C_IN = 0.70, D_IN = 0.88;

/* Устье в мастере шахты стоит правее и выше центра. Чтобы дорога вела К ВХОДУ,
   цельная плита смещена так, что вход попадает в точку схода; к финалу
   смещение уходит, и шахта встаёт своей компоновкой. */
const AIM = [(VP[0] - 0.61) * 100, (VP[1] - 0.43) * 100];

let p = 0, target = 0, raf = 0, last = performance.now(), lastMask = '';
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  // ход камеры по дороге: равномерный, чуть ускоряющийся к концу
  const travel = 0.62 * p + 0.38 * (p ** 1.8);
  const cam = 1 + 1.45 * travel;
  forest.style.transform = `scale(${cam.toFixed(4)})`;

  const shown = p >= B_IN - 0.01;
  if (mineHolder.hidden === shown) mineHolder.hidden = !shown;
  if (shown) {
    // окно и плита шахты растут ОТ ТОЙ ЖЕ точки схода: шахта приближается
    // как объект на дороге, а не раскрывается вставкой
    // мягкая диафрагма вместо полигонного коридора: коридор читался замочной
    // скважиной — широкий верх и узкое горло вниз. Язык тот же, что принят в
    // hero -> forest v7.
    const g = seg(p, B_IN, 0.96);
    const k = innerWidth / 1920;
    const r = q((58 + 1900 * (g ** 1.5)) * k, 4);
    const ry = q(r * 1.10, 4);
    const m = `radial-gradient(ellipse ${r}px ${ry}px at ${(VP[0] * 100).toFixed(1)}% ${(VP[1] * 100).toFixed(1)}%,`
      + ' #000 0 46%, rgba(0,0,0,.92) 62%, rgba(0,0,0,.6) 78%, rgba(0,0,0,.22) 90%, transparent 100%)';
    if (m !== lastMask) {
      mineHolder.style.webkitMaskImage = m;
      mineHolder.style.maskImage = m;
      lastMask = m;
    }
    const aim = 1 - smooth(seg(p, C_IN, 0.99));
    const mk = 0.58 + 0.72 * smooth(seg(p, B_IN, 1));
    mine.style.transform =
      `translate3d(${(AIM[0] * aim).toFixed(2)}%, ${(AIM[1] * aim).toFixed(2)}%, 0) scale(${mk.toFixed(4)})`;
  }

  forest.style.opacity = (1 - smooth(seg(p, D_IN, 0.96))).toFixed(3);

  if (debug) {
    const phase = p < B_IN ? 'A forest approach' : p < C_IN ? 'B distant mine'
      : p < D_IN ? 'C commit' : 'D takeover';
    panel.textContent = `t      ${p.toFixed(3)}\nphase  ${phase}\n`
      + `cam    ${cam.toFixed(2)}\nfg     ${fgFade.toFixed(2)}`;
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

await Promise.all([forest, mine, ...FG.map((f) => f.im)]
  .map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
mineHolder.hidden = true;
schedule();

window.__F2M2 = {
  get progress() { return p; },
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
};
