/* Depth dive PoC: колесо не везёт камеру над картой — оно раздвигает мир.
 *
 *   progress 0..1 (скролл, полностью скрабится в обе стороны)
 *     каждый слой масштабируется ОТ точки прохода со своей скоростью:
 *     фон почти стоит, ближние деревья разлетаются за края экрана
 *     в последней четверти проход раскрывается, и внутри него уже лес
 *
 * Ничего не автоиграет: p всегда следует за колесом, damping только сглаживает.
 * Рендер — DOM-слои с transform/filter: композитинг на GPU, состояние одно (p). */
import { STAGE, FOCUS, VILLAGE, FOREST } from './scene.js';

const stage = document.getElementById('stage');
const debug = new URLSearchParams(location.search).get('debug') === '1';
const panel = document.getElementById('debug');
if (debug) panel.hidden = false;

/* ---------------------------------------------------------------- сборка */
function el(cls, parent) {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
}

function buildScene(def, name) {
  const root = el(`scene scene--${name}`, stage);
  // маска окна живёт на root (её box = кадр), масштаб — на body:
  // иначе маска обрезала бы сцену по её же уменьшенному box'у
  const body = el('scene-body', root);
  const layers = {};
  // земля и дорога — самый дальний слой: по ним читается ось прохода
  const bg = el('layer layer--bg', body);
  const ground = el('ground', bg);
  ground.style.backgroundImage = `url(${def.ground.tile})`;
  if (def.ground.tint !== 'rgba(24,46,20,0)') {
    const tint = el('ground-tint', bg);
    tint.style.background = def.ground.tint;
  }
  const road = el('road', bg);
  road.style.backgroundImage = `url(${def.road.tile})`;
  road.style.width = `${(def.road.width / STAGE.w) * 100}%`;
  road.style.left = `${((800 - def.road.width / 2) / STAGE.w) * 100}%`;
  layers.bg = bg;

  for (const key of ['far', 'mid', 'near', 'focal']) {
    const layer = el(`layer layer--${key}`, body);
    for (const o of def.layers[key]) {
      const img = document.createElement('img');
      img.src = o.src;
      img.alt = '';
      img.decoding = 'async';
      img.className = 'sprite';
      img.style.width = `${(o.w / STAGE.w) * 100}%`;
      img.style.left = `${(o.x / STAGE.w) * 100}%`;
      img.style.top = `${(o.y / STAGE.h) * 100}%`;
      if (o.flip) img.style.setProperty('--flip', '-1');
      layer.appendChild(img);
    }
    layers[key] = layer;
  }
  return { root, body, layers };
}

const village = buildScene(VILLAGE, 'village');
const forest = buildScene(FOREST, 'forest');
const vignette = document.getElementById('vignette');

/* ------------------------------------------------------------- движение */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
/* доля участка [a,b], пройденная к p (0 вне участка) */
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);

/* Каждый слой растёт по своей кривой. Ближние ускоряются к концу (именно там
   они проходят мимо зрителя), дальние идут почти линейно и почти не растут. */
function scales(p) {
  const dive = smooth(seg(p, 0.45, 1));          // раздвигание
  const rush = smooth(seg(p, 0.72, 1)) ** 1.5;   // нырок: последняя четверть
  return {
    bg: 1 + 0.25 * smooth(p),                              // земля почти стоит
    far: 1 + 0.32 * smooth(p) + 0.25 * rush,
    mid: 1 + 0.34 * smooth(p) + 0.45 * dive + 0.85 * rush,
    // ближний план держится в кадре весь подход и вылетает за края в нырке:
    // именно тогда зритель проходит между объектами
    near: 1 + 0.38 * smooth(p) + 1.15 * dive + 3.0 * rush,
    focal: 1 + 0.3 * smooth(p) + 0.95 * dive + 3.9 * rush,
  };
}

/* Лес виден ТОЛЬКО через проход: маска — окно в точке схода, оно растёт вместе
   с нырком. Поэтому это не кроссфейд двух картинок: сперва лес виден в щели
   между соснами, потом окно раскрывается на весь кадр. */
function forestState(p) {
  const grow = smooth(seg(p, 0.5, 1));
  // окно раскрывается по кубической кривой: до 0.8 это щель между соснами,
  // весь раскрыв приходится на последнюю четверть — там и происходит нырок
  const open = seg(p, 0.5, 1) ** 3;
  return {
    scale: 0.45 + 0.4 * grow + 0.22 * seg(p, 0.78, 1) ** 2,   // лес тоже налетает
    openW: 4 + 130 * open,                     // радиус окна, % ширины кадра
    openH: 6 + 135 * open,
    settle: smooth(seg(p, 0.88, 1)),
  };
}

function phaseOf(p) {
  if (p < 0.45) return 'approach';
  if (p < 0.75) return 'spread';
  return 'dive';
}

/* округление до шага: чтобы дорогие свойства не пересчитывались каждый кадр */
const q = (v, step) => Math.round(v / step) * step;

let p = 0, target = 0, raf = 0, last = performance.now();
let lastMask = '', lastFilter = '';
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  // damping: вход остаётся колесом, движение просто без рывков
  p += (target - p) * (1 - Math.pow(0.001, dt / 1000));
  if (Math.abs(target - p) < 0.0004) p = target;

  const s = scales(p);
  const f = forestState(p);
  const dive = smooth(seg(p, 0.45, 1));
  const rush = smooth(seg(p, 0.72, 1));

  // деревня: слои разъезжаются от прохода, ближние — сильнее и в стороны
  village.layers.bg.style.transform = `scale(${s.bg.toFixed(4)})`;
  village.layers.far.style.transform = `scale(${s.far.toFixed(4)})`;
  village.layers.mid.style.transform = `translate3d(0, ${(3 * dive + 4 * rush).toFixed(2)}%, 0) scale(${s.mid.toFixed(4)})`;
  village.layers.near.style.transform = `translate3d(0, ${(5 * dive + 9 * rush).toFixed(2)}%, 0) scale(${s.near.toFixed(4)})`;
  village.layers.focal.style.transform = `scale(${s.focal.toFixed(4)})`;
  // ближний план в самой быстрой части чуть размывается (0 → 2.5px → 0).
  // blur и mask — единственное здесь, что не считается композитором, поэтому
  // они меняются ступенями: глазу шага не видно, а перерисовок в разы меньше
  const blur = q(2.6 * Math.sin(Math.PI * seg(p, 0.55, 1)), 0.5);
  const nearFilter = blur > 0.05 ? `blur(${blur}px)` : '';
  if (nearFilter !== lastFilter) { village.layers.near.style.filter = nearFilter; lastFilter = nearFilter; }
  // деревня не «растворяется»: она уходит за края. В самом конце гасится остаток,
  // который ещё перекрывает лес у краёв кадра.
  village.root.style.opacity = (1 - smooth(seg(p, 0.93, 1))).toFixed(3);

  // лес: растёт из прохода и виден через раскрывающееся окно
  forest.body.style.transform = `scale(${f.scale.toFixed(4)})`;
  const mask = `radial-gradient(ellipse ${q(f.openW, 1)}% ${q(f.openH, 1)}% at var(--fx) var(--fy),`
    + ` #000 62%, rgba(0,0,0,.6) 82%, transparent 100%)`;
  if (mask !== lastMask) {
    forest.root.style.webkitMaskImage = mask;
    forest.root.style.maskImage = mask;
    lastMask = mask;
  }
  forest.root.style.opacity = smooth(seg(p, 0.48, 0.56)).toFixed(3);
  forest.layers.near.style.transform = `translate3d(0, ${(6 * f.settle).toFixed(2)}%, 0) scale(${(1 + 0.22 * f.settle).toFixed(4)})`;
  forest.layers.mid.style.transform = `scale(${(1 + 0.1 * f.settle).toFixed(4)})`;
  forest.layers.far.style.transform = `scale(${(1 + 0.04 * f.settle).toFixed(4)})`;

  vignette.style.opacity = (0.55 * smooth(seg(p, 0.5, 0.95)) * (1 - 0.6 * smooth(seg(p, 0.9, 1)))).toFixed(3);

  if (debug) {
    panel.textContent = `progress ${p.toFixed(3)}  (target ${target.toFixed(3)})\n`
      + `phase    ${phaseOf(p)}\n`
      + `bg ${s.bg.toFixed(2)}  far ${s.far.toFixed(2)}  mid ${s.mid.toFixed(2)}  near ${s.near.toFixed(2)}  focal ${s.focal.toFixed(2)}\n`
      + `forest   scale ${f.scale.toFixed(2)}  opening ${f.openW.toFixed(0)}x${f.openH.toFixed(0)}%  blend ${(seg(p, 0.5, 0.97) * 100).toFixed(0)}%\n`
      + `blur     ${blur.toFixed(2)}px   rush ${rush.toFixed(2)}`;
  }
  frames.push(now);
  if (frames.length > 240) frames.shift();
  if (p !== target) schedule();
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(apply);
}

addEventListener('wheel', (e) => {
  target = clamp(target + e.deltaY * 0.00085, 0, 1);
  schedule();
}, { passive: true });

addEventListener('keydown', (e) => {                    // удобно для съёмки и отладки
  const step = e.shiftKey ? 0.1 : 0.02;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') target = clamp(target + step, 0, 1);
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') target = clamp(target - step, 0, 1);
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = 1;
  else return;
  schedule();
});

addEventListener('resize', schedule);
schedule();

/* ручка для съёмки видео и замеров: тот же путь, что у колеса */
window.__DEPTH = {
  get progress() { return p; },
  get target() { return target; },
  set(v, { instant = false } = {}) {
    target = clamp(v, 0, 1);
    if (instant) p = target;
    schedule();
  },
  state: () => ({ p, target, phase: phaseOf(p), scales: scales(p), forest: forestState(p) }),
  fps: () => {
    if (frames.length < 3) return null;
    const d = [];
    for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
    d.sort((a, b) => a - b);
    return { frames: d.length, median: d[d.length >> 1], worst: d[d.length - 1], avg: d.reduce((a, b) => a + b, 0) / d.length };
  },
};
