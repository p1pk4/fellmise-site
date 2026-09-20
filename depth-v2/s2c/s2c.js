/* spirit_threshold -> spirit_core: узкий порог, за ним мир раскрывается.
 *
 * Главный reveal маршрута, поэтому это не копия mine -> spirit. Там диафрагма
 * просто росла круглой. Здесь у неё МЕНЯЕТСЯ ФОРМА: сперва узкий мягкий овал
 * вдоль пути — щель, в которую едва видно холодную даль, — а в фазе раскрытия
 * горизонтальный радиус разгоняется много быстрее вертикального, и окно
 * расходится вширь. Ощущение не «кружок подрос», а «пространство раздалось».
 *
 * Движение по-прежнему несёт цельная плита порога, масштабируемая от точки
 * схода пути. Ни core/mid/ring, ни отдельных летящих кусков.
 *
 * Корабль придержан композиционно, а не таймером: плита ядра смещена так, что
 * в точку схода попадает дальняя вода, а корабль стоит на 0.19 кадра ниже.
 * В узкую вертикальную щель он не попадает физически и проявляется только
 * когда раскрыв пошёл вширь и вниз.
 */
const BASE = '/out/depth-v2/s2c/';
const stage = document.getElementById('stage');
const panel = document.getElementById('debug');
const debug = new URLSearchParams(location.search).get('debug') === '1';
if (debug) panel.hidden = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const q = (v, s) => Math.round(v / s) * s;

const index = await (await fetch(BASE + 'index.json')).json();
const VP = index.vp;
const ORIGIN = `${VP[0] * 100}% ${VP[1] * 100}%`;
const AIM = [VP[0] - index.target[0], VP[1] - index.target[1]];

function el(tag, cls, z) {
  const n = document.createElement(tag);
  n.className = cls;
  if (z !== undefined) n.style.zIndex = String(z);
  stage.appendChild(n);
  return n;
}

const threshold = el('img', 'sheet', 0);
threshold.src = BASE + index.plate;

const coreHolder = el('div', 'holder', 1);
const core = document.createElement('img');
core.className = 'sheet';
core.src = BASE + index.next;
coreHolder.appendChild(core);

for (const n of [threshold, core]) {
  n.alt = '';
  n.decoding = 'async';
  n.style.transformOrigin = ORIGIN;
}

/* ------------------------------------------------------------ хореография */
/*  A 0.00-0.55  только порог: ход вперёд по пути, стела — направление
 *  B 0.55-0.70  за стелой читается холодная даль: узкая щель вдоль пути
 *  C 0.70-0.88  мир раскрывается — окно расходится ВШИРЬ, приходит вода
 *  D 0.82-0.94  становится читаем призрачный корабль: кульминация
 *  E 0.94-1.00  ядро занимает кадр                                          */
const B_IN = 0.55, C_IN = 0.70, D_IN = 0.82, E_IN = 0.94;

/* Плита следующей сцены обязана покрывать всё, что успела открыть диафрагма.
   Раньше это выдерживалось подобранным таймингом, и на стыке параметров
   вылезал её прямой край. Здесь требуемый масштаб считается из геометрии
   окна и смещения прицела, и берётся максимум с желаемым: класс ошибки
   закрыт целиком, а не подогнан. */
function coverScale(desired, rx, ry, ax, ay) {
  // Покрывать нужно только ВИДИМУЮ часть открытого окна, а не всю его
  // математическую протяжённость: когда диафрагма перерастает кадр, её
  // края уже за экраном и закрывать там нечего. Без этого ограничения
  // требуемый масштаб улетал втрое и ядро раздувалось.
  const l = Math.max(0, VP[0] - rx), r = Math.min(1, VP[0] + rx);
  const t = Math.max(0, VP[1] - ry), b = Math.min(1, VP[1] + ry);
  const need = Math.max(
    (VP[0] + ax - l) / VP[0],
    (r - VP[0] - ax) / (1 - VP[0]),
    (VP[1] + ay - t) / VP[1],
    (b - VP[1] - ay) / (1 - VP[1]),
  );
  return Math.max(desired, need);
}

let p = 0, target = 0, raf = 0, last = performance.now(), lastMask = '';
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  const travel = 0.62 * p + 0.38 * (p ** 1.8);
  threshold.style.transform = `scale(${(1 + 1.22 * travel).toFixed(4)})`;

  const shown = p >= B_IN - 0.01;
  if (coreHolder.hidden === shown) coreHolder.hidden = !shown;
  if (shown) {
    const g = seg(p, B_IN, 0.96);
    const W = innerWidth, H = innerHeight, k = W / 1920;
    // горизонталь разгоняется резче вертикали: щель -> раскрытое пространство
    const rx = (54 + 2700 * (g ** 2.6)) * k;
    const ry = (74 + 520 * (g ** 1.7)) * k;
    const m = `radial-gradient(ellipse ${q(rx, 4)}px ${q(ry, 4)}px at ${(VP[0] * 100).toFixed(1)}% ${(VP[1] * 100).toFixed(1)}%,`
      + ' #000 0 46%, rgba(0,0,0,.92) 62%, rgba(0,0,0,.6) 78%, rgba(0,0,0,.22) 90%, transparent 100%)';
    if (m !== lastMask) {
      coreHolder.style.webkitMaskImage = m;
      coreHolder.style.maskImage = m;
      lastMask = m;
    }
    // прицел держит даль в точке схода и отпускает к кульминации
    const aim = 1 - smooth(seg(p, D_IN - 0.02, E_IN + 0.02));
    const ax = AIM[0] * aim, ay = AIM[1] * aim;
    const want = 0.60 + 0.80 * smooth(seg(p, B_IN, 0.86)) - 0.28 * smooth(seg(p, 0.86, 1));
    const sk = coverScale(want, rx / W, ry / H, ax, ay);
    core.style.transform =
      `translate3d(${(ax * 100).toFixed(2)}%, ${(ay * 100).toFixed(2)}%, 0) scale(${sk.toFixed(4)})`;
  }

  threshold.style.opacity = (1 - smooth(seg(p, E_IN, 0.995))).toFixed(3);

  if (debug) {
    const phase = p < B_IN ? 'A approach' : p < C_IN ? 'B crossing'
      : p < D_IN ? 'C world opens' : p < E_IN ? 'D ship reveal' : 'E takeover';
    panel.textContent = `t      ${p.toFixed(3)}\nphase  ${phase}`;
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

await Promise.all([threshold, core]
  .map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
coreHolder.hidden = true;
schedule();

window.__S2C = {
  get progress() { return p; },
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
};
