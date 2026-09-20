/* Depth journey PoC v2: одна прокрутка — одно путешествие.
 *
 * Идея, которой не было в v1: каждый принятый мастер разбирается на три
 * зоны ОДНОЙ И ТОЙ ЖЕ картинки — кольцо у краёв, средняя полоса и ядро
 * вокруг точки прохода. Это работает потому, что сцены так и написаны:
 * большие объекты обрезаны краями кадра, а в центре — уходящий вглубь путь.
 * Зоны масштабируются от точки прохода с разной скоростью, и кольцо реально
 * улетает за края мимо зрителя.
 *
 * Следующая сцена не подменяет предыдущую кроссфейдом: она раскрывается
 * ОКНОМ в точке прохода текущей, сначала как щель в глубине, и только в
 * конце — на весь кадр. При этом ближний план текущей сцены лежит ВЫШЕ
 * новой сцены по z и продолжает лететь мимо — поэтому деревня ещё какое-то
 * время остаётся по периферии, а скальные массы проходят по краям.
 *
 * Ничего не автоиграет: p всегда следует за колесом, damping лишь сглаживает.
 */
import { PLANES_BASE, SCENES } from './scenes.js';

const stage = document.getElementById('stage');
const vignette = document.getElementById('vignette');
const chill = document.getElementById('chill');
const rail = document.querySelector('#rail i');
const chapter = document.getElementById('chapter');
const hint = document.getElementById('hint');
const panel = document.getElementById('debug');
const debug = new URLSearchParams(location.search).get('debug') === '1';
if (debug) panel.hidden = false;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
/* округление до шага: маска и фильтр не пересчитываются каждый кадр */
const q = (v, s) => Math.round(v / s) * s;

/* ------------------------------------------------------------ построение */
const PLANES = ['bg', 'mid', 'fg'];

const built = SCENES.map((def, i) => {
  const [gx, gy] = def.gate;
  const layers = {};
  for (const key of PLANES) {
    const holder = document.createElement('div');
    holder.className = `holder holder--${def.id} holder--${key}`;
    // ближний план лежит выше следующей сцены, но ниже её ближнего плана:
    // так он пролетает мимо уже открывшегося нового мира
    holder.style.zIndex = String(i * 10 + (key === 'fg' ? 15 : PLANES.indexOf(key)));
    // план — обычная картинка с запечённой альфой (depth-v2/build_planes.py).
    // Никакой CSS-маски на нём нет: прокрутка остаётся чистой композицией
    // трансформом, иначе слой перерастеризуется каждый кадр.
    const plane = document.createElement('img');
    plane.className = `plane plane--${key}`;
    plane.alt = '';
    plane.decoding = 'async';
    plane.src = `${PLANES_BASE}${def.id}_${key}.webp`;
    plane.style.setProperty('--gx', `${gx * 100}%`);
    plane.style.setProperty('--gy', `${gy * 100}%`);
    holder.appendChild(plane);
    stage.appendChild(holder);
    layers[key] = { holder, plane, lastMask: '', shown: true };
  }
  const prev = SCENES[i - 1];
  const len = def.band[1] - def.band[0];
  const next = SCENES[i + 1];
  return {
    def, layers, len,
    tail: next ? 0.42 * (next.band[1] - next.band[0]) : 0.02,
    // окно раскрывается в точке прохода ПРЕДЫДУЩЕЙ сцены
    revealGate: prev ? prev.gate : def.gate,
    // окно начинает открываться ещё в середине предыдущей сцены и доходит
    // до полного кадра уже ВНУТРИ своей: только так зритель успевает побыть
    // в проходе, а не увидеть готовую подмену картинки
    revealFrom: prev ? def.band[0] - 0.70 * (prev.band[1] - prev.band[0]) : -1,
    revealTo: prev ? def.band[0] + 0.34 * len : -1,
  };
});

/* ------------------------------------------------------------ хореография */
/* Масштабы плана внутри собственного участка. Ближний ускоряется к концу —
   именно там он проходит мимо зрителя; дальний идёт почти линейно. */
function planeScale(key, u, target) {
  const base = smooth(clamp(u, 0, 1));
  const rush = smooth(seg(u, 0.30, 1.05)) ** 1.4;
  // сцена не замирает на границе участка: её ближний план продолжает лететь
  // мимо зрителя уже поверх следующего мира
  const over = clamp(u - 1, 0, 0.45) * 2.2;
  if (key === 'bg') return 1 + (target - 1) * (base + 0.25 * over);
  if (key === 'mid') return 1 + (target - 1) * (0.46 * base + 0.54 * rush + 0.55 * over);
  return 1 + (target - 1) * (0.38 * base + 0.62 * rush) * (1 + 1.25 * over);
}

let p = 0, target = 0, raf = 0, last = performance.now();
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  let active = 0;
  for (const s of built) {
    const { def } = s;
    const [s0, s1] = def.band;
    // сцена живёт от момента, когда её начали открывать, до конца её участка
    // сцена доживает внутрь следующей: её края ещё проходят по кадру
    const live = p >= s.revealFrom - 0.02 && p <= s1 + s.tail;
    for (const key of PLANES) {
      const L = s.layers[key];
      if (L.shown !== live) { L.holder.hidden = !live; L.shown = live; }
    }
    if (!live) continue;
    active++;

    // до своего участка сцена стоит в глубине и приближается
    const pre = s.revealFrom < 0 ? 1 : seg(p, s.revealFrom, s0);
    const approach = 0.80 + 0.20 * smooth(pre);
    const u = p < s0 ? 0 : (p - s0) / s.len;   // после 1 сцена доигрывает уход

    for (const key of PLANES) {
      const L = s.layers[key];
      const k = approach * planeScale(key, u, def.planes[key]);
      // ближний и средний планы дополнительно сносит вниз: направленный
      // параллакс, а не просто зум
      const push = key === 'fg' ? 9 : key === 'mid' ? 3.5 : 0;
      const dy = push * smooth(seg(u, 0.3, 1));
      L.plane.style.transform =
        `translate3d(0, ${dy.toFixed(2)}%, 0) scale(${k.toFixed(4)})`;
    }

    // окно: сцена видна только сквозь проход предыдущей, пока он не раскрыт
    if (s.revealFrom >= 0) {
      // кубическая кривая: почти весь раскрыв приходится на конец, поэтому
      // долго видно именно щель в глубине, а не половину нового кадра
      const open = seg(p, s.revealFrom, s.revealTo) ** 3.0;
      const w = q(2 + 140 * open, 1), h = q(3 + 146 * open, 1);
      const [rgx, rgy] = s.revealGate;
      const mask = `radial-gradient(ellipse ${w}% ${h}% at ${(rgx * 100).toFixed(1)}% ${(rgy * 100).toFixed(1)}%,`
        + ` #000 64%, rgba(0,0,0,.6) 84%, transparent 100%)`;
      for (const key of PLANES) {
        const L = s.layers[key];
        if (mask !== L.lastMask) {
          L.holder.style.webkitMaskImage = mask;
          L.holder.style.maskImage = mask;
          L.lastMask = mask;
        }
      }
    }
  }

  // текущая сцена — по ней ведутся виньетка, холод и подпись главы
  const cur = built.reduce((a, s) => (p >= s.def.band[0] ? s : a), built[0]);
  const cu = clamp((p - cur.def.band[0]) / cur.len, 0, 1);
  document.documentElement.style.setProperty('--vx', `${cur.def.gate[0] * 100}%`);
  document.documentElement.style.setProperty('--vy', `${cur.def.gate[1] * 100}%`);
  vignette.style.opacity = (0.46 * smooth(seg(cu, 0.35, 0.95))).toFixed(3);
  // бирюза приходит на пороге, держится в ядре и уходит по дороге к дому
  const cold = Math.min(smooth(seg(p, 0.46, 0.60)), 1 - smooth(seg(p, 0.80, 0.90)));
  chill.style.opacity = (0.55 * clamp(cold, 0, 1)).toFixed(3);

  rail.style.width = `${(p * 100).toFixed(2)}%`;
  if (chapter.textContent !== cur.def.title) chapter.textContent = cur.def.title;
  hint.style.opacity = p > 0.02 ? '0' : '1';

  if (debug) {
    panel.textContent = `progress ${p.toFixed(3)}  (target ${target.toFixed(3)})\n`
      + `scene    ${cur.def.id}  u ${cu.toFixed(2)}\n`
      + `live     ${active} scenes\n`
      + `gate     ${cur.def.gate[0]} ${cur.def.gate[1]}`;
  }

  frames.push(now);
  if (frames.length > 240) frames.shift();
  if (p !== target) schedule();
}

function schedule() { if (!raf) raf = requestAnimationFrame(apply); }

addEventListener('wheel', (e) => {
  target = clamp(target + e.deltaY * 0.00042, 0, 1);
  schedule();
}, { passive: true });

addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.08 : 0.015;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') target = clamp(target + step, 0, 1);
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') target = clamp(target - step, 0, 1);
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = 1;
  else return;
  schedule();
});

addEventListener('resize', schedule);

/* картинки грузятся один раз, до первого кадра: по прокрутке сети нет */
await Promise.all(built.flatMap((s) => PLANES.map((k) => s.layers[k].plane))
  .map((im) => (im.complete ? Promise.resolve() : new Promise((res) => { im.onload = im.onerror = res; }))));
schedule();

/* ручка для съёмки и замеров: тот же путь, что у колеса */
window.__JOURNEY = {
  get progress() { return p; },
  set(v, { instant = false } = {}) {
    target = clamp(v, 0, 1);
    if (instant) p = target;
    schedule();
  },
  scenes: () => SCENES.map((d) => d.id),
  fps: () => {
    if (frames.length < 3) return null;
    const d = [];
    for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
    d.sort((a, b) => a - b);
    return { frames: d.length, median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)], worst: d[d.length - 1] };
  },
};
