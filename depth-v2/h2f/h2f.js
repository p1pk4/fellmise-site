/* hero -> forest на настоящих вырезках переднего плана.
 *
 * Отличие от прошлой схемы принципиальное: ни одна сцена не режется на зоны.
 * hero_plate и forest_plate — цельные картины, внутри них геометрия неизменна,
 * ничего не разъезжается само с собой. Двигаются только настоящие объекты
 * переднего плана, вырезанные по своему силуэту: дуб, левый забор, правый
 * забор. Глубина берётся из их хода мимо камеры и из перекрытия, а не из
 * ложного параллакса кусков одной растровой картины.
 *
 * Проход — матовая маска, обведённая по коридору дороги, и она масштабируется
 * от точки схода. Никакого эллипса и никакой радиальной маски.
 */
const BASE = '/out/depth-v2/h2f/';
const stage = document.getElementById('stage');
const panel = document.getElementById('debug');
const debug = new URLSearchParams(location.search).get('debug') === '1';
if (debug) panel.hidden = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const q = (v, s) => Math.round(v / s) * s;

const index = await (await fetch(BASE + 'index.json')).json();
const ANCHOR = index.passage.anchor;          // точка схода прохода, доли кадра

function el(tag, cls, z) {
  const n = document.createElement(tag);
  n.className = cls;
  if (z !== undefined) n.style.zIndex = String(z);
  stage.appendChild(n);
  return n;
}

/* слои снизу вверх: плита деревни, лес в проходе, заборы, дуб */
const heroPlate = el('img', 'sheet', 0);
heroPlate.src = BASE + index.plate;

const forestHolder = el('div', 'holder', 1);
const forestPlate = document.createElement('img');
forestPlate.className = 'sheet';
forestPlate.src = BASE + index.forest;
forestHolder.appendChild(forestPlate);

const FG = index.cutouts.map((c, i) => {
  const im = el('img', 'sheet', c.id === 'oak' ? 4 : 2 + i);
  im.src = BASE + c.file;
  // дуб ближе всех: он и уходит быстрее и дальше
  const near = c.id === 'oak';
  return { im, id: c.id, k: near ? 3.40 : 2.85, dx: c.id === 'fence_r' ? 5 : c.id === 'fence_l' ? -5 : -7, dy: near ? 9 : 7 };
});

for (const n of [heroPlate, forestPlate, ...FG.map((f) => f.im)]) {
  n.alt = ''; n.decoding = 'async';
  n.style.transformOrigin = `${ANCHOR[0] * 100}% ${ANCHOR[1] * 100}%`;
}
/* Дуб растёт от СВОЕЙ точки, а не от точки схода в центре кадра. Иначе его
   выталкивает геометрией: ствол стоит у самого левого края, и при увеличении
   от центра он уходит за границу уже к k~1.6 — перекрывать край раскрытого
   прохода становится физически нечем. От собственной точки он растёт на месте
   и уходит выносом, а не масштабом. */
const oakLayer = FG.find((f) => f.id === 'oak');
if (oakLayer) oakLayer.im.style.transformOrigin = '18% 42%';

/* ------------------------------------------------------------ хореография */
/*  0.00-0.72  видна ТОЛЬКО деревня: она приближается, передний план успевает
 *             реально пойти мимо камеры; леса нет в кадре вовсе
 *  0.72-0.80  в проходе открывается узкая щель, и в ней уже лес
 *  0.80-0.97  щель раскрывается быстро и решительно
 *  0.97-1.00  лес остаётся один
 *
 * Раньше reveal стоял на 0.55, и база маски при s=1 сразу закрывала крупный
 * центральный участок: лес читался не проходом, а подставленным кадром.  */
const GATE_IN = 0.72, GATE_MID = 0.80, GATE_OUT = 0.97;

/* Дуб идёт по своей траектории из трёх участков. Смысл: он обязан оставаться
   крупным перекрытием, пока проход раскрывается, иначе граница окна читается
   прямым клином по траве — перекрывать её больше нечем.

     до 0.65   как раньше, разгон
     0.65-0.88 продолжает идти мимо камеры, но заметно медленнее;
               часть ствола и кроны всё ещё закрывает край окна
     0.88-1.00 быстрый уход из кадра

   Внутри каждого участка скорость постоянная и ненулевая: дуб нигде не
   замирает, иначе он перестаёт читаться проходящим объектом. */
function oakTravel(p) {
  if (p < 0.65) return 0.25 * (p / 0.65) ** 2.2;
  if (p < 0.88) return 0.25 + 0.17 * ((p - 0.65) / 0.23);
  return 0.42 + 0.78 * ((p - 0.88) / 0.12) ** 1.6;
}

let p = 0, target = 0, raf = 0, last = performance.now(), lastMask = '';
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  // деревня: один общий наезд камеры, внутри ничего не разъезжается
  const push = 1 + 0.18 * smooth(p);
  heroPlate.style.transform = `scale(${push.toFixed(4)})`;

  // передний план: настоящие объекты, идут быстрее и уходят за края
  // вырезки держатся у своего места почти весь подход и уходят в нырке:
  // если они уезжают рано, из-под них показывается достроенный фон плиты
  const rush = smooth(seg(p, 0.46, 1)) ** 1.5;
  const fenceTravel = 0.16 * smooth(p) + 0.84 * rush;
  for (const f of FG) {
    const oak = f.id === 'oak';
    const travel = oak ? oakTravel(p) : fenceTravel;
    const k = 1 + (f.k - 1) * travel;
    // у дуба вынос копится отдельно и резко добирает в конце: до 0.88 он ещё
    // закрывает край окна, после — быстро покидает кадр
    const dx = oak ? -8 * travel - 42 * Math.max(0, travel - 0.45) : f.dx * travel;
    const dy = oak ? 4 * travel + 12 * Math.max(0, travel - 0.45) : f.dy * travel;
    f.im.style.transform =
      `translate3d(${dx.toFixed(2)}%, ${dy.toFixed(2)}%, 0) scale(${k.toFixed(4)})`;
  }

  // лес: цельная картина, видна только сквозь проход
  const shown = p >= GATE_IN - 0.005;
  if (forestHolder.hidden === shown) forestHolder.hidden = !shown;
  if (shown) {
    // масштаб маски прохода от точки схода: 1 -> кадр целиком
    const g = seg(p, GATE_IN, GATE_OUT);
    // стартует узкой щелью у точки схода (s<1) и раскрывается резко:
    // показатель меньше единицы — рост сразу решительный, без просачивания
    const s = 0.16 + 5.80 * (g ** 1.6);
    const W = innerWidth, Hh = innerHeight;
    const size = q(s * 100, 0.5);
    const mx = Math.round(ANCHOR[0] * W * (1 - s));
    const my = Math.round(ANCHOR[1] * Hh * (1 - s));
    const m = `url("${BASE}${index.passage.matte}") ${mx}px ${my}px / ${size}% ${size}% no-repeat`;
    if (m !== lastMask) {
      forestHolder.style.webkitMask = m;
      forestHolder.style.mask = m;
      lastMask = m;
    }
    // сам лес тоже слегка приближается, но остаётся одной картиной
    // лес входит уже крупным: иначе в проход попадает только светлая тропа,
    // и первый показ читается дымкой, а не лесом
    forestPlate.style.transform = `scale(${(1.18 + 0.16 * smooth(seg(p, GATE_IN, 1))).toFixed(4)})`;
  }

  // деревня окончательно уходит в самом конце, когда её уже почти не видно
  const fade = 1 - smooth(seg(p, GATE_OUT, 1));
  heroPlate.style.opacity = fade.toFixed(3);
  for (const f of FG) f.im.style.opacity = fade.toFixed(3);

  if (debug) {
    const phase = p < GATE_IN ? 'approach' : p < GATE_MID ? 'gate appears'
      : p < GATE_OUT ? 'pass through' : 'forest';
    panel.textContent = `t        ${p.toFixed(3)}  (target ${target.toFixed(3)})\n`
      + `phase    ${phase}\n`
      + `village  ${push.toFixed(2)}   fg oak ${(1 + 2.4 * (0.34 * smooth(p) + 0.66 * rush)).toFixed(2)}\n`
      + `forest   ${shown ? 'visible' : 'absent'}`;
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

await Promise.all([heroPlate, forestPlate, ...FG.map((f) => f.im)]
  .map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
forestHolder.hidden = true;
schedule();

window.__H2F = {
  get progress() { return p; },
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
  fps: () => {
    if (frames.length < 3) return null;
    const d = [];
    for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
    d.sort((a, b) => a - b);
    return { frames: d.length, median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)], worst: d[d.length - 1] };
  },
};
