/* spirit_core -> home_finale: выход из холодного слоя на тёплый огонёк.
 *
 * Это не ещё одна такая же диафрагма. Здесь окно раскрытия построено вокруг
 * САМОГО СВЕТА: плита дома входит сильно уменьшенной и смещена так, что её
 * два тёплых окна попадают ровно в точку схода. Поэтому первое, что видно в
 * крошечном окне, — одинокий золотой огонёк далеко впереди в холодном мире,
 * а не подставленная картинка дома. Дом читается позже, когда окно подрастёт
 * и вокруг огонька проявится его окружение.
 *
 * Накладного свечения поверх кадра нет: тёплый свет — это настоящие окна
 * принятого мастера. Ядро и дом остаются цельными плитами, ничего не режется
 * и не летит отдельно.
 *
 * Финал обязан ОСТАНОВИТЬСЯ. Ход камеры не просто замедляется к единице, а
 * замораживается: к 0.90 его значение фиксируется, к 0.93 дом дорастает и
 * встаёт, и последние 0.97-1.00 в кадре не меняется уже ничего. Дальше нет ни
 * прохода, ни следующей цели.
 */
const BASE = '/assets/depth/c2h/';
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
const AIM = [VP[0] - index.light[0], VP[1] - index.light[1]];

function el(tag, cls, z) {
  const n = document.createElement(tag);
  n.className = cls;
  if (z !== undefined) n.style.zIndex = String(z);
  stage.appendChild(n);
  return n;
}

const core = el('img', 'sheet', 0);
core.src = BASE + index.plate;

const homeHolder = el('div', 'holder', 1);
const home = document.createElement('img');
home.className = 'sheet';
home.src = BASE + index.next;
homeHolder.appendChild(home);

for (const n of [core, home]) {
  n.alt = '';
  n.decoding = 'async';
  n.style.transformOrigin = ORIGIN;
}

/* ------------------------------------------------------------ хореография */
/*  A 0.00-0.55  уход из мира духов: корабль и след остаются позади
 *  B 0.55-0.68  далеко впереди — крошечный тёплый огонёк, дома ещё нет
 *  C 0.68-0.84  огонёк растёт, проступают два окна и часть двора
 *  D 0.84-0.95  дом читается целиком, тропа к двери становится осью
 *  E 0.95-1.00  прибытие: в кадре не меняется уже ничего                    */
const B_IN = 0.55, C_IN = 0.68, D_IN = 0.84, E_IN = 0.95;
const FREEZE = 0.90;          // с этого момента ход камеры зафиксирован

/* Покрывается только ВИДИМАЯ часть открытого окна: за краем экрана закрывать
   нечего, иначе требуемый масштаб улетает и плита раздувается. */
function coverScale(desired, rx, ry, ax, ay) {
  const l = Math.max(0, VP[0] - rx), r = Math.min(1, VP[0] + rx);
  const t = Math.max(0, VP[1] - ry), b = Math.min(1, VP[1] + ry);
  return Math.max(desired, Math.max(
    (VP[0] + ax - l) / VP[0],
    (r - VP[0] - ax) / (1 - VP[0]),
    (VP[1] + ay - t) / VP[1],
    (b - VP[1] - ay) / (1 - VP[1]),
  ));
}

const base = (x) => 0.62 * x + 0.38 * (x ** 1.8);

let p = 0, target = 0, raf = 0, last = performance.now(), lastMask = '';
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  // ход вперёд, замирающий к финалу: значение плавно фиксируется на base(0.90)
  const stop = smooth(seg(p, FREEZE, 0.97));
  const travel = base(p) * (1 - stop) + base(FREEZE) * stop;
  core.style.transform = `scale(${(1 + 1.15 * travel).toFixed(4)})`;

  const shown = p >= B_IN - 0.01;
  if (homeHolder.hidden === shown) homeHolder.hidden = !shown;
  if (shown) {
    // окно раскрывается вокруг самого света: сперва точка, затем окружение
    const g = seg(p, B_IN, 0.93);
    const W = innerWidth, H = innerHeight, k = W / 1920;
    const rx = (26 + 2500 * (g ** 2.2)) * k;
    const ry = (30 + 1250 * (g ** 1.9)) * k;
    const m = `radial-gradient(ellipse ${q(rx, 4)}px ${q(ry, 4)}px at ${(VP[0] * 100).toFixed(1)}% ${(VP[1] * 100).toFixed(1)}%,`
      + ' #000 0 42%, rgba(0,0,0,.9) 60%, rgba(0,0,0,.56) 77%, rgba(0,0,0,.2) 90%, transparent 100%)';
    if (m !== lastMask) {
      homeHolder.style.webkitMaskImage = m;
      homeHolder.style.maskImage = m;
      lastMask = m;
    }
    // прицел держит окна в точке схода и отпускает, когда дом уже читается
    const aim = 1 - smooth(seg(p, D_IN - 0.04, E_IN));
    const ax = AIM[0] * aim, ay = AIM[1] * aim;
    // дом входит крошечным — тогда его окна и читаются одиноким огоньком —
    // и дорастает до своей компоновки к 0.93, после чего стоит
    const want = 0.30 + 0.72 * smooth(seg(p, B_IN, 0.93));
    const sk = coverScale(want, rx / W, ry / H, ax, ay);
    home.style.transform =
      `translate3d(${(ax * 100).toFixed(2)}%, ${(ay * 100).toFixed(2)}%, 0) scale(${sk.toFixed(4)})`;
  }

  core.style.opacity = (1 - smooth(seg(p, FREEZE, 0.97))).toFixed(3);

  if (debug) {
    const phase = p < B_IN ? 'A leaving spirit' : p < C_IN ? 'B first warm light'
      : p < D_IN ? 'C return' : p < E_IN ? 'D home reveal' : 'E arrival';
    panel.textContent = `t      ${p.toFixed(3)}\nphase  ${phase}\n`
      + `travel ${travel.toFixed(3)}${stop > 0 ? '  (freezing)' : ''}`;
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

await Promise.all([core, home]
  .map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
homeHolder.hidden = true;
schedule();

window.__C2H = {
  get progress() { return p; },
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
};
