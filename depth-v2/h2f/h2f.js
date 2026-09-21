/* hero -> forest: движение несёт ДОРОГА, раскрытие — мягкая диафрагма.
 *
 * Что изменено против прежней версии этого же маршрута:
 *   * ход вперёд даёт масштабирование ЦЕЛЬНОЙ плиты деревни от точки схода
 *     дороги — один растр, один центр, одна скорость. Вырезки больше не
 *     главный движитель и не летят в камеру от собственных точек роста;
 *   * вырезки идут с той же точки схода и всего на 10% быстрее плиты (слабый
 *     ближний параллакс) и уходят ДО того, как лес становится центром;
 *   * окно раскрытия — не «замочная скважина» с жёсткой кромкой, а мягкая
 *     круглая диафрагма с длинным многоступенчатым спадом: ни контура, ни
 *     видимой границы, ни ощущения маски;
 *   * лес и его диафрагма масштабируются от той же точки схода, поэтому лес
 *     читается глубиной впереди по дороге, а не подставленной картинкой.
 */
const BASE = '/assets/depth/h2f/';
const stage = document.getElementById('stage');
const panel = document.getElementById('debug');
const debug = new URLSearchParams(location.search).get('debug') === '1';
if (debug) panel.hidden = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const q = (v, s) => Math.round(v / s) * s;

const index = await (await fetch(BASE + 'index.json')).json();
const VP = [0.472, 0.462];                    // точка схода дороги в деревне
const ORIGIN = `${VP[0] * 100}% ${VP[1] * 100}%`;

function el(tag, cls, z) {
  const n = document.createElement(tag);
  n.className = cls;
  if (z !== undefined) n.style.zIndex = String(z);
  stage.appendChild(n);
  return n;
}

const hero = el('img', 'sheet', 0);
hero.src = BASE + index.plate;

const forestHolder = el('div', 'holder', 1);
const forest = document.createElement('img');
forest.className = 'sheet';
forest.src = BASE + index.forest;
forestHolder.appendChild(forest);

const FG = index.cutouts.map((c, i) => {
  const im = el('img', 'sheet', 4 + i);
  im.src = BASE + c.file;
  return { im, id: c.id };
});

for (const n of [hero, forest, ...FG.map((f) => f.im)]) {
  n.alt = '';
  n.decoding = 'async';
  n.style.transformOrigin = ORIGIN;
}

/* ------------------------------------------------------------ хореография */
/*  0.00-0.58  только деревня: ход по дороге вглубь
 *  0.58-0.70  впереди по дороге открывается лес — маленькая мягкая диафрагма
 *  0.70-0.94  диафрагма раскрывается быстро; передний план уже ушёл
 *  0.94-1.00  лес остаётся один                                             */
const GATE_IN = 0.58, GATE_MID = 0.70, GATE_OUT = 0.94;

let p = 0, target = 0, raf = 0, last = performance.now(), lastMask = '';
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  const travel = 0.62 * p + 0.38 * (p ** 1.8);
  const cam = 1 + 1.32 * travel;
  hero.style.transform = `scale(${cam.toFixed(4)})`;

  // вырезки: та же точка схода, чуть быстрее плиты; уходят до раскрытия
  const fgFade = 1 - smooth(seg(p, 0.60, GATE_MID + 0.04));
  for (const f of FG) {
    f.im.style.transform = `scale(${(cam * (1 + 0.10 * travel)).toFixed(4)})`;
    f.im.style.opacity = fgFade.toFixed(3);
    const off = fgFade < 0.004;
    if (f.im.hidden !== off) f.im.hidden = off;
  }

  const shown = p >= GATE_IN - 0.01;
  if (forestHolder.hidden === shown) forestHolder.hidden = !shown;
  if (shown) {
    /* Мягкая круглая диафрагма, чуть вытянутая по вертикали — так она садится
       по дороге. Спад длинный и многоступенчатый, поэтому кромки не видно.
       Радиус в пикселях: мягкость не зависит от размера окна. */
    const g = seg(p, GATE_IN, GATE_OUT);
    const k = innerWidth / 1920;
    const r = q((62 + 1860 * (g ** 1.45)) * k, 4);
    const ry = q(r * 1.12, 4);
    const m = `radial-gradient(ellipse ${r}px ${ry}px at ${(VP[0] * 100).toFixed(1)}% ${(VP[1] * 100).toFixed(1)}%,`
      + ' #000 0 46%, rgba(0,0,0,.92) 62%, rgba(0,0,0,.6) 78%, rgba(0,0,0,.22) 90%, transparent 100%)';
    if (m !== lastMask) {
      forestHolder.style.webkitMaskImage = m;
      forestHolder.style.maskImage = m;
      lastMask = m;
    }
    // лес приближается по дороге от той же точки схода
    // к GATE_MID плита покрывает кадр целиком: иначе диафрагма перерастает
    // её края и показывает прямой край плиты
    const fk = 0.72 + 0.28 * smooth(seg(p, GATE_IN, GATE_MID))
      + 0.34 * smooth(seg(p, GATE_MID, 1));
    forest.style.transform = `scale(${fk.toFixed(4)})`;
  }

  hero.style.opacity = (1 - smooth(seg(p, GATE_OUT, 0.99))).toFixed(3);

  if (debug) {
    const phase = p < GATE_IN ? 'village approach' : p < GATE_MID ? 'forest ahead'
      : p < GATE_OUT ? 'aperture opening' : 'forest';
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

await Promise.all([hero, forest, ...FG.map((f) => f.im)]
  .map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
forestHolder.hidden = true;
schedule();

window.__H2F = {
  get progress() { return p; },
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
};
