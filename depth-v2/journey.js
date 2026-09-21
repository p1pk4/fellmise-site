/* Единый маршрут: Village -> Forest -> Mine -> Threshold -> Core -> Home.
 *
 * Хореография переходов НЕ переписывается. Каждая секция несёт параметры,
 * снятые с принятого изолированного маршрута один в один: точка схода, ход
 * камеры, кривые диафрагмы, прицел, вырезки. Общий прогресс 0..1 раскладывается
 * на локальный прогресс секции, и внутри секции всё работает как в её
 * отдельном маршруте. Прежняя схема этого файла (core/mid/ring) снята: она
 * отклонена и источником поведения больше не является.
 *
 * Стыки. Замер показал, что изолированные переходы оставляют входящую сцену
 * крупнее, чем следующая секция её начинает: 1.34 / 1.30 / 1.30 / 1.12 против
 * старта 1.00. Прицел и непрозрачность на стыках сходятся, расходится только
 * масштаб. Поэтому переходы не правятся — добавлен адаптер: масштаб входящей
 * плиты делится на то значение, которым секция кончается, и она приходит к
 * стыку ровно в 1.0. Форма движения та же, меняется только удалённость
 * входящей сцены во время раскрытия — она читается чуть дальше.
 *
 * coverScale страхует покрытие: плита следующей сцены обязана закрывать всё,
 * что успела открыть диафрагма. Тот же guard, что закрыл класс ошибки с
 * вылезающим прямым краем плиты; здесь распространён на все секции, включая
 * те, где в изолированном виде покрытие держалось подобранным таймингом.
 */
import { mountContent } from './content.js';
import { mountChrome } from './chrome.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const q = (v, s) => Math.round(v / s) * s;
const base = (x) => 0.62 * x + 0.38 * (x ** 1.8);

const SOFT = ' #000 0 46%, rgba(0,0,0,.92) 62%, rgba(0,0,0,.6) 78%, rgba(0,0,0,.22) 90%, transparent 100%)';
const WARM = ' #000 0 42%, rgba(0,0,0,.9) 60%, rgba(0,0,0,.56) 77%, rgba(0,0,0,.2) 90%, transparent 100%)';

/* Все сцены маршрута — из assets/depth/hi/: те же принятые плиты после
   super-resolution, ширина каждой подобрана по замеру плотности пикселей на её
   максимальном зуме. По одному файлу на сцену: раньше одна и та же картинка
   грузилась под двумя адресами (mine, core, threshold/spirit) — трижды лишний
   запрос. Изолированные переходы и статическая версия остаются на плитах 1536. */
const HI = '/assets/depth/hi/';

/* Параметры сняты с принятых изолированных маршрутов. endScale — чем секция
   заканчивает входящую плиту; по нему считается нормализация стыка. */
const SECTIONS = [
  {
    id: 'hero', band: [0.00, 0.16], from: HI,
    plate: 'hero_plate_clean.webp', next: 'forest_plate.webp',
    vp: [0.472, 0.462], camK: 1.32, endScale: 1.34,
    cuts: ['hero_fg_oak.webp', 'hero_fg_fence_l.webp', 'hero_fg_fence_r.webp'],
    cutLead: 0.10, cutFade: [0.60, 0.74], plateOut: 0.94,
    gate: [0.58, 0.94], ap: { r0: 62, r1: 1860, pow: 1.45, aspect: 1.12, stops: SOFT },
    nextScale: (l) => 0.72 + 0.28 * smooth(seg(l, 0.58, 0.70)) + 0.34 * smooth(seg(l, 0.70, 1)),
  },
  {
    id: 'forest', band: [0.16, 0.32], from: HI,
    // ТОТ ЖЕ файл, на котором заканчивается hero -> forest: сырой мастер леса.
    // Раньше секция брала forest_plate_clean — плиту с ВЫРЕЗАННЫМИ стволами,
    // а сами стволы возвращались оверлеями поверх, с +10% параллакса. Замер
    // показал, что эти оверлеи и есть 46% кадра, а по краю их растушёванной
    // альфы просвечивал дорисованный фон — те самые светлые дуги на стволах и
    // корнях. Ход вперёд и так несёт цельная плита, поэтому оверлеи убраны
    // совсем: лес остаётся одной картиной от начала участка и до конца.
    plate: 'forest_plate.webp', next: 'mine_plate.webp',
    vp: [0.5143, 0.4813], camK: 1.45, endScale: 1.30, plateOut: 0.96,
    gate: [0.55, 0.96], ap: { r0: 58, r1: 1900, pow: 1.5, aspect: 1.10, stops: SOFT },
    aim: [0.61, 0.43], aimOut: [0.70, 0.99],
    nextScale: (l) => 0.58 + 0.72 * smooth(seg(l, 0.55, 1)),
  },
  {
    id: 'mine', band: [0.32, 0.47], from: HI,
    plate: 'mine_plate.webp', next: 'threshold_plate.webp',
    vp: [0.625, 0.50], camK: 1.26, endScale: 1.30, plateOut: 0.94,
    gate: [0.58, 0.94], ap: { r0: 58, r1: 1880, pow: 1.45, aspect: 1.12, stops: SOFT },
    aim: [0.60, 0.44], aimOut: [0.72, 0.99],
    nextScale: (l) => 0.66 + 0.34 * smooth(seg(l, 0.58, 0.72)) + 0.30 * smooth(seg(l, 0.72, 1)),
  },
  {
    id: 'threshold', band: [0.47, 0.60], from: HI,
    plate: 'threshold_plate.webp', next: 'core_plate.webp',
    vp: [0.552, 0.500], camK: 1.22, endScale: 1.12, plateOut: 0.94,
    gate: [0.55, 0.96], ap: { r0: 54, r1: 2700, pow: 2.6, ry0: 74, ry1: 520, ryPow: 1.7, stops: SOFT },
    aim: [0.470, 0.200], aimOut: [0.80, 0.96],
    nextScale: (l) => 0.60 + 0.80 * smooth(seg(l, 0.55, 0.86)) - 0.28 * smooth(seg(l, 0.86, 1)),
  },
  {
    id: 'core', band: [0.60, 1.00], from: HI,
    plate: 'core_plate.webp', next: 'home_plate.webp',
    // секция живёт до конца прокрутки, но её локальный прогресс кончается на
    // 0.82: дальше идёт полоса прибытия, где всё заморожено и дом просто стоит
    span: [0.60, 0.82],
    vp: [0.470, 0.200], camK: 1.15, endScale: 1.02, freeze: 0.90, plateOut: 0.90,
    gate: [0.55, 0.93], ap: { r0: 26, r1: 2500, pow: 2.2, ry0: 30, ry1: 1250, ryPow: 1.9, stops: WARM },
    aim: [0.565, 0.505], aimOut: [0.80, 0.95],
    nextScale: (l) => 0.30 + 0.72 * smooth(seg(l, 0.55, 0.93)),
  },
];

// Полоса прибытия существует только как подпись главы: слоёв у неё нет,
// в кадре к этому моменту стоит замороженный дом из секции core.
const ARRIVAL = { id: 'home', at: 0.82 };

/* ---------------------------------------- непрерывная траектория назначения
 *
 * Раньше масштаб входящей плиты складывался из двух независимых частей:
 * заданной кривой nextScale/endScale и страховки покрытия coverScale. Пока
 * прицел сдвигал плиту к цели, страховка требовала лишнего масштаба; когда
 * прицел отпускался, требование падало — и сцена назначения, уже выросшая до
 * 1.12–1.25, возвращалась к 1.0. Телеметрия это показала на всех переходах,
 * кроме hero -> forest: камера «дышала» назад. У threshold откат был заложен
 * прямо в кривую (член −0.28).
 *
 * Теперь у каждой сцены назначения ОДНА функция масштаба по общему
 * прогрессу — от первого появления до точки, где она сливается с принятой
 * кривой текущей плиты следующей секции. Три узла:
 *
 *   появление  (p_appear, w0, наклон 0) — стартовая удалённость принятая;
 *   касание    (p_touch, 1)  — диафрагма дошла до ближнего края кадра, дальше
 *              плита обязана закрывать кадр целиком, иначе виден её край;
 *   стыковка   (p_join, A, A') — значение и скорость принятой кривой; стыковка
 *              стоит раньше окна текста следующей сцены, так что кадр под
 *              текстом остаётся принятым.
 *
 * Через узлы идёт монотонный кубический Эрмит (Fritsch–Carlson): масштаб
 * только растёт, а на стыке совпадают и значение, и скорость (C1). Прицел
 * ограничивается так, чтобы страховке покрытия никогда не требовалось больше
 * траектории — иначе она снова вздёрнет масштаб выше неё.
 *
 * hero -> forest откатов не имел и не трогается. Для core -> home вместо
 * стыковки прибытие: дом приходит к 1.0 и стоит.
 */
const JOIN_BEFORE = { forest: 0.185, mine: 0.350, threshold: 0.500, core: 0.638 }; // начала окон текста
const spanOf = (d) => d.span || d.band;
const locOf = (d, p) => { const [s0, s1] = spanOf(d); return clamp((p - s0) / (s1 - s0), 0, 1); };
const globOf = (d, l) => { const [s0, s1] = spanOf(d); return s0 + l * (s1 - s0); };
const dbase = (x) => 0.62 + 0.38 * 1.8 * Math.max(x, 1e-9) ** 0.8;
const plateA = (d, p) => 1 + d.camK * base(locOf(d, p));
const plateA1 = (d, p) => { const [s0, s1] = spanOf(d); return d.camK * dbase(locOf(d, p)) / (s1 - s0); };

function radii(d, l, W, H) {
  const a = d.ap, k = W / 1920, g = seg(l, d.gate[0], d.gate[1]);
  const px = (a.r0 + a.r1 * (g ** a.pow)) * k;
  const py = a.ry0 !== undefined ? (a.ry0 + a.ry1 * (g ** a.ryPow)) * k : px * a.aspect;
  return [px / W, py / H];
}
function aimFull(d, l) {
  if (!d.aim) return [0, 0];
  const a = 1 - smooth(seg(l, d.aimOut[0], d.aimOut[1]));
  return [(d.vp[0] - d.aim[0]) * a, (d.vp[1] - d.aim[1]) * a];
}
function hermite(x0, y0, m0, x1, y1, m1) {
  const h = x1 - x0;
  return (x) => {
    const t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0
      + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
  };
}
// три узла, наклоны на концах заданы, внутренний — по Fritsch–Carlson;
// возвращает функцию и фактический наклон в последнем узле
function pchip3([x0, y0], [x1, y1], [x2, y2], m0, m2) {
  const d0 = (y1 - y0) / (x1 - x0), d1 = (y2 - y1) / (x2 - x1);
  let m1 = d0 * d1 <= 0 ? 0 : 3 * (x2 - x0) / ((2 * x2 - x1 - x0) / d0 + (x2 + x1 - 2 * x0) / d1);
  m1 = Math.min(m1, 3 * d0, 3 * d1);
  const mEnd = Math.min(m2, 3 * d1);
  const f0 = hermite(x0, y0, Math.min(m0, 3 * d0), x1, y1, m1), f1 = hermite(x1, y1, m1, x2, y2, mEnd);
  return { f: (x) => (x <= x1 ? f0(x) : f1(x)), mEnd };
}

// ход после точки заморозки F: скорость base'(F) линейно гаснет к нулю за
// окно [F, 0.97]; значение растёт монотонно и встаёт (C1 в F, нулевая скорость в конце)
function frozenTravel(F, l) {
  const Lz = 0.97 - F, t = Math.min(1, (l - F) / Lz);
  return base(F) + dbase(F) * Lz * (t - t * t / 2);
}

const TRAJ = [];   // TRAJ[i]: траектория сцены назначения секции i (i >= 1)
function buildTrajectories(W, H) {
  for (let i = 1; i < SECTIONS.length; i++) {
    const d = SECTIONS[i], nxt = SECTIONS[i + 1];
    const la = d.gate[0], pa = globOf(d, la), w0 = d.nextScale(la) / d.endScale;
    let lt = 1;
    for (let s = 0; s <= 4000; s++) {
      const l = s / 4000, [rx, ry] = radii(d, l, W, H);
      if (coverScale(0, d.vp, rx, ry, 0, 0) >= 1 - 1e-9) { lt = l; break; }
    }
    const pt = globOf(d, lt);
    let f, pj;
    if (nxt) {
      // стыковка: не позже начала окна текста; из вариантов, где скорость
      // принятой кривой достижима без нарушения монотонности (C1), берётся тот,
      // у которого после касания меньше всего проседает скорость — иначе ход
      // заметно замедлялся бы между раскрытием и следующей секцией
      let best = null;
      for (let j = 0.05; j <= 0.4001; j += 0.005) {
        const x = globOf(nxt, j);
        if (x > JOIN_BEFORE[nxt.id] + 1e-9) break;
        const r = pchip3([pa, w0], [pt, 1], [x, plateA(nxt, x)], 0, plateA1(nxt, x));
        if (Math.abs(r.mEnd - plateA1(nxt, x)) > 1e-9) continue;
        let vmin = Infinity;
        for (let s = 1; s < 100; s++) {
          const a = pt + (x - pt) * s / 100, b = pt + (x - pt) * (s + 1) / 100;
          vmin = Math.min(vmin, (r.f(b) - r.f(a)) / (b - a));
        }
        if (!best || vmin > best.vmin) best = { f: r.f, pj: x, vmin };
      }
      ({ f, pj } = best);
    } else {
      f = hermite(pa, w0, 0, pt, 1, 0); pj = pt;                     // прибытие
    }
    const scale = (p) => (p <= pa ? w0 : p >= pj ? (nxt ? plateA(nxt, p) : 1) : f(p));
    // прицел: не больше принятого и не больше, чем позволяет покрытие
    const N = 1000, aimT = new Float32Array(N + 1);
    let run = 1;
    for (let s = 0; s <= N; s++) {
      const l = s / N, [rx, ry] = radii(d, l, W, H), [fx, fy] = aimFull(d, l), sk = scale(globOf(d, l));
      let lo = 0, hi = 1;
      if (coverScale(0, d.vp, rx, ry, fx, fy) <= sk) lo = 1;
      else for (let it = 0; it < 30; it++) {
        const m = (lo + hi) / 2;
        if (coverScale(0, d.vp, rx, ry, fx * m, fy * m) <= sk) lo = m; else hi = m;
      }
      run = Math.min(run, lo);                                   // прицел только отпускается
      aimT[s] = run;
    }
    const aimK = (l) => { const x = l * N, s = Math.min(N - 1, Math.floor(x)), t = x - s; return aimT[s] * (1 - t) + aimT[s + 1] * t; };
    TRAJ[i] = { pa, pt, pj, scale, aimK };
  }
}

const stage = document.getElementById('stage');
/* Тексты живут в content.js: здесь нет ни одной строки копирайта, а там нет
   ни одной строки хореографии. updateContent ведётся общим прогрессом. */
const updateContent = mountContent(document.getElementById('content'));
/* Системный UI собирает chrome.js: знак, язык, глава и нить маршрута.
   Здесь не осталось ни одной строки об интерфейсе, там — ни одной о движении. */
const updateChrome = mountChrome(document.getElementById('ui'));
const panel = document.getElementById('debug');
const debug = new URLSearchParams(location.search).get('debug') === '1';
if (debug) panel.hidden = false;

function img(src, z, origin) {
  const n = document.createElement('img');
  n.className = 'sheet';
  n.src = src;
  n.alt = '';
  n.decoding = 'async';
  n.style.zIndex = String(z);
  n.style.transformOrigin = origin;
  stage.appendChild(n);
  return n;
}

const built = [];
SECTIONS.forEach((s, i) => {
  if (s.hold) { built.push({ def: s }); return; }
  const origin = `${s.vp[0] * 100}% ${s.vp[1] * 100}%`;
  const z = i * 10;
  const plate = img(s.from + s.plate, z, origin);
  const holder = document.createElement('div');
  holder.className = 'holder';
  holder.style.zIndex = String(z + 5);
  const next = document.createElement('img');
  next.className = 'sheet';
  next.src = s.from + s.next;
  next.alt = '';
  next.decoding = 'async';
  next.style.transformOrigin = origin;
  holder.appendChild(next);
  stage.appendChild(holder);
  // вырезки лежат выше входящей сцены: они ещё идут мимо, пока она открывается
  const cuts = (s.cuts || []).map((f) => img(s.from + f, z + 8, origin));
  built.push({ def: s, plate, holder, next, cuts, lastMask: '' });
});

function coverScale(want, vp, rx, ry, ax, ay) {
  const l = Math.max(0, vp[0] - rx), r = Math.min(1, vp[0] + rx);
  const t = Math.max(0, vp[1] - ry), b = Math.min(1, vp[1] + ry);
  return Math.max(want, Math.max(
    (vp[0] + ax - l) / vp[0], (r - vp[0] - ax) / (1 - vp[0]),
    (vp[1] + ay - t) / vp[1], (b - vp[1] - ay) / (1 - vp[1]),
  ));
}

buildTrajectories(innerWidth, innerHeight);

let p = 0, target = 0, raf = 0, last = performance.now();
const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  p += (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  if (Math.abs(target - p) < 0.0003) p = target;

  const W = innerWidth, H = innerHeight, k = W / 1920;
  let live = 0;

  for (let idx = 0; idx < built.length; idx++) {
    const S = built[idx], d = S.def;
    if (d.hold) continue;
    const [b0, b1] = d.band;
    const [s0, s1] = d.span || d.band;
    const inBand = p >= b0 - 0.004 && p <= b1 + 0.004;
    for (const n of [S.plate, ...S.cuts]) {
      if (n.hidden !== !inBand) n.hidden = !inBand;
    }
    const l = clamp((p - s0) / (s1 - s0), 0, 1);
    // окно следующей сцены не существует до начала раскрытия. Без этого
    // условия у диафрагмы с первого кадра секции виден стартовый радиус —
    // маленькая посторонняя точка в кадре (она и лезла в устье и в небо).
    const holderOn = inBand && l >= d.gate[0] - 0.01;
    if (S.holder.hidden === holderOn) S.holder.hidden = !holderOn;
    if (!inBand) continue;
    live++;

    if (inBand) {
      // заморозка: скорость хода плавно гаснет до нуля к 0.97, но значение не
      // откатывается. Прежняя смесь base(l)·(1−stop) + base(F)·stop за точкой F
      // тянула ход обратно к base(F) — на прибытии камера чуть отъезжала назад.
      const travel = d.freeze && l > d.freeze ? frozenTravel(d.freeze, l) : base(l);
      // до стыковки текущая плита идёт по той же траектории, что вела её как
      // сцену назначения: смена слоя на границе секций не видна ни по значению,
      // ни по скорости
      const prev = TRAJ[idx - 1];
      const ps = prev && p < prev.pj ? prev.scale(p) : 1 + d.camK * travel;
      S.plate.style.transform = `scale(${ps.toFixed(4)})`;
      // гаснет полностью ДО конца полосы: иначе на стыке остаётся 5-12%
      // непрозрачности, и она пропадает скачком — заметная ступенька яркости
      S.plate.style.opacity = (1 - smooth(seg(l, d.plateOut, 0.97))).toFixed(3);
      if (S.cuts.length) {
        const fade = 1 - smooth(seg(l, d.cutFade[0], d.cutFade[1]));
        const ck = (1 + d.camK * travel) * (1 + d.cutLead * travel);
        for (const n of S.cuts) {
          n.style.transform = `scale(${ck.toFixed(4)})`;
          n.style.opacity = fade.toFixed(3);
        }
      }
    }

    const g = seg(l, d.gate[0], d.gate[1]);
    // Диафрагма у всех секций одна по природе: мягкий радиальный градиент с
    // длинным спадом. Полигонная маска-коридор снята — она читалась замочной
    // скважиной: широкий верх и узкое горло вниз.
    const a = d.ap;
    const px = (a.r0 + a.r1 * (g ** a.pow)) * k;
    const py = a.ry0 !== undefined ? (a.ry0 + a.ry1 * (g ** a.ryPow)) * k : px * a.aspect;
    const rx = px / W, ry = py / H;
    const mask = `radial-gradient(ellipse ${q(px, 4)}px ${q(py, 4)}px at ${(d.vp[0] * 100).toFixed(1)}% ${(d.vp[1] * 100).toFixed(1)}%,`
      + a.stops;
    if (mask !== S.lastMask) {
      S.holder.style.webkitMaskImage = mask;
      S.holder.style.maskImage = mask;
      S.lastMask = mask;
    }

    let [ax, ay] = aimFull(d, l);
    let want = d.nextScale(l) / d.endScale;           // hero -> forest: как было
    const T = TRAJ[idx];
    if (T) {
      const m = T.aimK(l);
      ax *= m; ay *= m;
      want = T.scale(p);
    }
    // страховка покрытия осталась; по построению траектории она не срабатывает
    const sk = coverScale(want, d.vp, rx, ry, ax, ay);
    S.next.style.transform =
      `translate3d(${(ax * 100).toFixed(2)}%, ${(ay * 100).toFixed(2)}%, 0) scale(${sk.toFixed(4)})`;
  }

  const cur = p >= ARRIVAL.at ? ARRIVAL
    : SECTIONS.reduce((a, s) => (p >= s.band[0] ? s : a), SECTIONS[0]);
  updateContent(p);
  updateChrome(p, cur.id);

  if (debug) {
    const [b0, b1] = cur.band;
    panel.textContent = `progress ${p.toFixed(3)}\nsection  ${cur.id}`
      + `  local ${clamp((p - b0) / (b1 - b0), 0, 1).toFixed(2)}\nlive     ${live}`;
  }

  frames.push(now);
  if (frames.length > 240) frames.shift();
  if (p !== target) schedule();
}

function schedule() { if (!raf) raf = requestAnimationFrame(apply); }

addEventListener('wheel', (e) => {
  target = clamp(target + e.deltaY * 0.00022, 0, 1);
  schedule();
}, { passive: true });

addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.06 : 0.01;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') target = clamp(target + step, 0, 1);
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') target = clamp(target - step, 0, 1);
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = 1;
  else return;
  schedule();
});
addEventListener('resize', () => {
  buildTrajectories(innerWidth, innerHeight);      // покрытие зависит от пропорций окна
  for (const S of built) S.lastMask = '';
  schedule();
});

await Promise.all([...stage.querySelectorAll('img')]
  .map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
schedule();

window.__JOURNEY = {
  get progress() { return p; },
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
  sections: () => SECTIONS.map((s) => ({ id: s.id, band: s.band })),
  fps: () => {
    if (frames.length < 3) return null;
    const d = [];
    for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
    d.sort((a, b) => a - b);
    return { frames: d.length, median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)], worst: d[d.length - 1] };
  },
};
