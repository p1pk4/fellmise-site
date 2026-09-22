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
import { BEATS } from './content-data.js';
import { mountChrome, takeSavedProgress } from './chrome.js';
import { IS_PREVIEW } from './route.js';

/* Живой режим может быть отменён в любой момент старта (boot.js: отказ,
   предел времени, узкое окно, reduced-motion). Тогда модуль ничего не
   монтирует, а уже смонтированное освобождает stop(): слушатели, кадры,
   текстуры, звук. Поздно пришедшая загрузка страницу обратно не забирает. */
const alive = () => document.documentElement.dataset.mode === 'live';
if (!alive()) throw new Error('depth-v2: live mode cancelled before start');
const life = new AbortController();

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
const TRAJ_REPORT = [];

// прицел под траекторию: не больше принятого и не больше, чем позволяет
// покрытие; только отпускается
function aimFor(d, scale, W, H) {
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
    run = Math.min(run, lo);
    aimT[s] = run;
  }
  // значения проверены только в узлах сетки. Прицел только отпускается, поэтому
  // берётся на шаг вперёд: между узлами он не больше допустимого. Линейная
  // интерполяция по тем же узлам у точки касания давала лишний прицел, и
  // страховка покрытия на один шаг поднимала масштаб на ~0.14% — микрооткат
  return (l) => { const x = Math.min(N, l * N + 1), s = Math.min(N - 1, Math.floor(x)), t = x - s; return aimT[s] * (1 - t) + aimT[s + 1] * t; };
}

/* Кандидат стыковки в точке x. Обязательные условия проверяются на том
 * масштабе, который реально рисует apply(): траектория, прицел и страховка
 * покрытия поверх (coverScale). Каждая причина отказа отдельно:
 *   A — значения конечные, масштаб положительный;
 *   B — плита закрывает раскрытую часть диафрагмы;
 *   C — масштаб не уменьшается по ходу вперёд;
 *   D — непрерывность: в стыке рисуемый масштаб равен масштабу плиты,
 *       которая дальше ведёт сцену (у неё страховки нет) — без скачка кадра;
 *   E — желательное: скорость в стыке равна скорости принятой кривой (C1).
 * mismatch — |скорость траектории в стыке − скорость принятой кривой|. */
function joinCandidate(d, nxt, pa, w0, pt, x) {
  const A = plateA(nxt, x), A1 = plateA1(nxt, x);
  const r = pchip3([pa, w0], [pt, 1], [x, A], 0, A1);
  let vmin = Infinity;
  for (let s = 1; s < 100; s++) {
    const a = pt + (x - pt) * s / 100, b = pt + (x - pt) * (s + 1) / 100;
    vmin = Math.min(vmin, (r.f(b) - r.f(a)) / (b - a));
  }
  const mismatch = Math.abs(r.mEnd - A1);
  return { f: r.f, r, pj: x, A, vmin, mismatch, rel: mismatch / A1, c1: mismatch <= 1e-9, fail: null, aimK: null };
}
// обязательные условия кандидата (дорого: прицел и рисуемый масштаб по сетке)
function checkCandidate(c, d, nxt, pa, w0, W, H) {
  const { r, pj: x, A } = c;
  const scale = (pp) => (pp <= pa ? w0 : pp >= x ? plateA(nxt, pp) : r.f(pp));
  const aimK = aimFor(d, scale, W, H);
  const eff = (l) => {
    const [rx, ry] = radii(d, l, W, H), [fx, fy] = aimFull(d, l), m = aimK(l);
    return { v: coverScale(scale(globOf(d, l)), d.vp, rx, ry, fx * m, fy * m), need: coverScale(0, d.vp, rx, ry, fx * m, fy * m) };
  };
  // пока сцена назначения — окно секции d (до конца её полосы), рисуется
  // eff; с конца полосы её ведёт уже плита следующей секции — чистый scale
  // без страховки. Стык слоёв — конец полосы, стыковка кривых — x (позже)
  const fail = new Set();
  const l0 = locOf(d, pa), N = 400, pEnd = globOf(d, 1);
  let prev = -Infinity;
  for (let s = 0; s <= N; s++) {
    const { v, need } = eff(l0 + (1 - l0) * s / N);
    if (!Number.isFinite(v) || v <= 0) fail.add('A');
    if (v < need - 1e-9) fail.add('B');
    if (v < prev - 1e-6) fail.add('C');
    prev = v;
  }
  for (let s = 0; s <= N; s++) {
    const v = scale(pEnd + (x + 0.02 - pEnd) * s / N);
    if (!Number.isFinite(v) || v <= 0) fail.add('A');
    if (v < 1 - 1e-9) fail.add('B');                  // плита во весь кадр закрывает его при масштабе ≥ 1
    if (s > 0 && v < prev - 1e-6) fail.add('C');
    prev = v;
  }
  if (!Number.isFinite(r.mEnd)) fail.add('A');
  // непрерывность: в появлении, в смене слоя (страховка не должна быть поверх
  // траектории — иначе кадр прыгнет, когда её не станет) и в стыковке
  if (Math.abs(r.f(pa) - w0) > 1e-9 || Math.abs(eff(1).v - scale(pEnd)) > 1e-6
    || Math.abs(r.f(x) - A) > 1e-9) fail.add('D');
  c.fail = [...fail].sort(); c.aimK = aimK;
  return !c.fail.length;
}

/* Траектории для окна W×H — без побочных эффектов. Выбор стыковки:
 *   1) есть кандидаты с точным C1, прошедшие обязательные условия, — берётся
 *      тот, у которого после касания меньше всего проседает скорость (как
 *      раньше);
 *   2) иначе — из прошедших обязательные условия (A–D) тот, у кого меньше
 *      рассогласование скорости в стыке; при равенстве — больший vmin, затем
 *      более ранний x. Монотонность сохраняется (Fritsch–Carlson ограничивает
 *      наклон), камера назад не идёт; в стыке остаётся излом скорости — в
 *      отчёте это fallback, не C1;
 *   3) обязательным условиям не отвечает никто — ошибка с перечнем причин
 *      (boot.js переведёт страницу в статику). */
function computeTrajectories(W, H, full = false) {
  const traj = [], report = [];
  for (let i = 1; i < SECTIONS.length; i++) {
    const d = SECTIONS[i], nxt = SECTIONS[i + 1];
    const la = d.gate[0], pa = globOf(d, la), w0 = d.nextScale(la) / d.endScale;
    let lt = 1;
    for (let s = 0; s <= 4000; s++) {
      const l = s / 4000, [rx, ry] = radii(d, l, W, H);
      if (coverScale(0, d.vp, rx, ry, 0, 0) >= 1 - 1e-9) { lt = l; break; }
    }
    const pt = globOf(d, lt);
    let f, pj, rep, aimK = null;
    if (nxt) {
      // стыковка: не позже начала окна текста следующей сцены
      const cands = [];
      for (let j = 0.05; j <= 0.4001; j += 0.005) {
        const x = globOf(nxt, j);
        if (x > JOIN_BEFORE[nxt.id] + 1e-9) break;
        if (x <= pt + 1e-9) continue;
        cands.push(joinCandidate(d, nxt, pa, w0, pt, x));
      }
      // порядок предпочтения: сначала точный C1 по убыванию vmin (как раньше),
      // затем остальные по возрастанию рассогласования, при равенстве — больший
      // vmin, затем более ранний x. Берётся первый, прошедший обязательные
      // условия; обычно это первый же кандидат
      const order = [...cands].sort((p, q) => (q.c1 - p.c1)
        || (p.c1 ? q.vmin - p.vmin : (p.mismatch - q.mismatch) || (q.vmin - p.vmin)) || (p.pj - q.pj));
      let best = null;
      for (const c of order) {
        if (checkCandidate(c, d, nxt, pa, w0, W, H)) { best = c; break; }
      }
      if (full) for (const c of cands) if (!c.fail) checkCandidate(c, d, nxt, pa, w0, W, H);
      if (!best) {
        const why = cands.map((c) => c.fail.join('')).join(',');
        throw new Error(`depth-v2: no valid ${d.id} -> ${nxt.id} trajectory at ${W}x${H} (${cands.length} candidates: ${why})`);
      }
      ({ f, pj, aimK } = best);
      const count = (k) => cands.filter((c) => c.fail?.includes(k)).length;
      rep = { id: `${d.id}->${nxt.id}`, mode: best.c1 ? 'c1' : 'fallback', pj: +pj.toFixed(4), pt: +pt.toFixed(4),
        mismatch: +best.mismatch.toFixed(4), rel: +best.rel.toFixed(4), candidates: cands.length,
        c1Candidates: cands.filter((c) => c.c1).length,
        ...(full ? { rejected: { A: count('A'), B: count('B'), C: count('C'), D: count('D'),
          E: cands.filter((c) => c.fail && !c.fail.length && !c.c1).length } } : {}) };
    } else {
      f = hermite(pa, w0, 0, pt, 1, 0); pj = pt;                     // прибытие
      rep = { id: `${d.id}->home`, mode: 'arrival', pj: +pj.toFixed(4), pt: +pt.toFixed(4), mismatch: 0, rel: 0 };
    }
    const scale = (p) => (p <= pa ? w0 : p >= pj ? (nxt ? plateA(nxt, p) : 1) : f(p));
    traj[i] = { pa, pt, pj, scale, aimK: aimK || aimFor(d, scale, W, H) };
    report.push(rep);
  }
  return { traj, report };
}

// замена целиком: при отказе прежние траектории не смешиваются с новыми
function buildTrajectories(W, H) {
  const { traj, report } = computeTrajectories(W, H);
  TRAJ.length = 0; traj.forEach((t, i) => { TRAJ[i] = t; });
  TRAJ_REPORT.length = 0; TRAJ_REPORT.push(...report);
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

/* ------------------------------------------------------ резидентность плит
 *
 * Плиты крупные (до ~5K по ширине): все разом — это ~400 МБ декодированных
 * текстур. Поэтому в памяти живёт скользящее окно: текущая сцена, следующая и
 * предыдущая, пока она ещё участвует в переходе. Слои строятся без src; адрес
 * им выдаёт менеджер ниже, и он же забирает его, когда сцена больше не нужна.
 *
 * Каждая сцена берётся в память в своей точке — в начале окна текста
 * предыдущей сцены, то есть за целую секцию до собственного раскрытия, — и
 * декодируется заранее (img.decode). Освобождается, когда кадр её уже не
 * использует: с запасом по прогрессу, чтобы не декодировать заново от дрожания
 * у границы, и с ранним повторным захватом при прокрутке назад.
 *
 * Если hi-res почему-то не готова к моменту показа, слой получает принятую
 * плиту 1536 из assets/depth/<переход>/ — картинка та же, только мягче. Замена
 * на hi-res делается, только пока слой скрыт или мал (масштаб <= 0.75, там 1536
 * ещё плотнее экрана): скачка резкости в кадре нет.
 *
 * Готовая текстура на два кадра показывается почти прозрачной (0.002), пока слой
 * ещё не в кадре: заливка в GPU проходит заранее, а не на первом кадре раскрытия.
 */
const LOW = {
  hero: '/assets/depth/h2f/hero_plate_clean.webp', forest: '/assets/depth/h2f/forest_plate.webp',
  mine: '/assets/depth/m2s/mine_plate.webp', threshold: '/assets/depth/s2c/threshold_plate.webp',
  core: '/assets/depth/s2c/core_plate.webp', home: '/assets/depth/c2h/home_plate.webp',
  // вырезки 1536 — во весь кадр, а не обрезки: раскладка у них своя (placeCut)
  hero_fg_oak: '/assets/depth/h2f/hero_fg_oak.webp',
  hero_fg_fence_l: '/assets/depth/h2f/hero_fg_fence_l.webp',
  hero_fg_fence_r: '/assets/depth/h2f/hero_fg_fence_r.webp',
};
const SCENE_OF = {
  'hero_plate_clean.webp': 'hero', 'forest_plate.webp': 'forest', 'mine_plate.webp': 'mine',
  'threshold_plate.webp': 'threshold', 'core_plate.webp': 'core', 'home_plate.webp': 'home',
};
const BEAT_OF = { hero: 'village', forest: 'forest', mine: 'mine', threshold: 'threshold', core: 'core' };
const RELEASE = 0.06, REACQUIRE = 0.05;     // запас по прогрессу за концом участия сцены

const RES = new Map();
let started = false;
const stats = { fallbacks: 0, peakBytes: 0, peakPlates: 0 };
function resource(key, hi, lo) {
  if (!RES.has(key)) RES.set(key, { key, hi, lo, acq: 0, end: 0, on: false, ready: false, img: null, els: [], bytes: 0, warm: 0 });
  return RES.get(key);
}

function layer(tag, cls, z, origin) {
  const n = document.createElement(tag);
  n.className = cls;
  if (tag === 'img') { n.alt = ''; n.decoding = 'async'; }
  n.style.zIndex = String(z);
  n.style.transformOrigin = origin;
  return n;
}

const built = [];
SECTIONS.forEach((s, i) => {
  if (s.hold) { built.push({ def: s }); return; }
  const origin = `${s.vp[0] * 100}% ${s.vp[1] * 100}%`;
  s.origin = origin;
  const z = i * 10;
  const plate = layer('img', 'sheet', z, origin);
  stage.appendChild(plate);
  const holder = document.createElement('div');
  holder.className = 'holder';
  holder.style.zIndex = String(z + 5);
  const next = layer('img', 'sheet', 0, origin);
  holder.appendChild(next);
  stage.appendChild(holder);
  // вырезки лежат выше входящей сцены: они ещё идут мимо, пока она открывается.
  // Каждая — обёртка во весь кадр (её масштабирует камера) с обрезком внутри,
  // положенным ровно туда, где он был в полном кадре (рамки — cuts.json)
  const cuts = (s.cuts || []).map((f) => {
    const wrap = layer('div', 'sheet', z + 8, origin);
    const im = layer('img', 'cut', 0, '0 0');
    im.style.position = 'absolute';
    im.style.maxWidth = 'none';
    wrap.appendChild(im);
    stage.appendChild(wrap);
    const key = f.replace('.webp', '');
    resource(key, s.from + f, LOW[key]).els.push({ el: im, shown: () => !wrap.hidden, cut: key, box: wrap });
    return wrap;
  });
  const sp = SCENE_OF[s.plate], sn = SCENE_OF[s.next];
  resource(sp, s.from + s.plate, LOW[sp]).els.push({ el: plate, shown: () => !plate.hidden, box: plate });
  resource(sn, s.from + s.next, LOW[sn]).els.push({ el: next, shown: () => !holder.hidden, holder, box: holder });
  built.push({ def: s, plate, holder, next, cuts, lastMask: '' });
});

let CUT_BOX = {};
function placeCut(e) {
  // cover для кадра 1.6:1 — так же, как object-fit: cover у полнокадровых плит.
  // Обрезок hi-res стоит в своей рамке из cuts.json, запасная 1536 — во весь кадр
  const W = innerWidth, H = innerHeight, Wr = Math.max(W, H * 1.6), Hr = Wr / 1.6;
  const ox = (W - Wr) / 2, oy = (H - Hr) / 2;
  const [x0, y0, x1, y1] = e.res === 'hi' ? CUT_BOX[e.cut].box : [0, 0, 1, 1];
  Object.assign(e.el.style, { left: `${ox + x0 * Wr}px`, top: `${oy + y0 * Hr}px`,
    width: `${(x1 - x0) * Wr}px`, height: `${(y1 - y0) * Hr}px` });
}
function layoutCuts() {
  for (const R of RES.values()) for (const e of R.els) if (e.cut) placeCut(e);
}

// окна участия сцен: захват — начало окна текста текущей сцены (для первой
// сцены и вырезок — сразу), конец — последний кадр, где слой ещё в кадре
function planResidency() {
  const beat = (id) => BEATS.find((b) => b.id === id);
  SECTIONS.forEach((s, i) => {
    const sp = SCENE_OF[s.plate], sn = SCENE_OF[s.next];
    const P = RES.get(sp), N = RES.get(sn);
    P.end = Math.max(P.end, s.band[1] + 0.004);
    if (i === 0) P.acq = 0;
    N.acq = beat(BEAT_OF[sp]).range[0];
    N.end = Math.max(N.end, sn === 'home' ? 1 : s.band[1] + 0.004);
    for (const f of s.cuts || []) {
      const C = RES.get(f.replace('.webp', ''));
      C.acq = 0; C.end = globOf(s, s.cutFade[1]) + 0.004;
    }
  });
}
planResidency();

function acquire(R) {
  R.on = true; R.ready = false;
  const im = new Image();
  im.decoding = 'async';
  im.src = R.hi;
  R.img = im;
  R.done = im.decode().then(() => {
    if (R.img !== im) return false;
    R.ready = true; R.bytes = im.naturalWidth * im.naturalHeight * 4; R.warm = 2;
    if (started) schedule();          // до конца старта кадры не рисуются
    return true;
  }).catch(() => false);
}
function release(R) {
  R.on = false; R.ready = false; R.img = null; R.bytes = 0; R.warm = 0; R.boot = false;
  for (const e of R.els) { e.el.removeAttribute('src'); e.res = ''; }
}

function residency(pp) {
  let bytes = 0, plates = 0, warming = false;
  for (const R of RES.values()) {
    const wantOn = pp >= R.acq && pp <= R.end + REACQUIRE;
    const wantOff = pp > R.end + RELEASE || pp < R.acq - 0.02;
    if (!R.on && wantOn) acquire(R);
    else if (R.on && wantOff) release(R);
    if (R.on) { bytes += R.bytes; if (R.lo && R.ready) plates++; }
    if (!R.on) continue;
    for (const e of R.els) {
      const shown = e.shown();
      if (R.ready) {
        // замена на hi-res — только пока слой скрыт или мал: без скачка резкости.
        // Исключение — стартовый кадр (R.boot): первая сцена, показанная в 1536,
        // пока hi-res ещё в пути, получает hi-res, как только та готова.
        // Вырезке hi-res нужна её рамка из cuts.json; без неё остаётся 1536
        if (e.res !== 'hi' && (!e.cut || CUT_BOX[e.cut])
          && (!shown || e.res !== 'lo' || (e.el._scale ?? 1) <= 0.75 || R.boot)) {
          e.el.src = R.hi; e.res = 'hi';
          if (e.cut) placeCut(e);
        }
        // прогрев: пока слой не в кадре, два кадра показать его почти прозрачным
        if (R.warm > 0 && !shown && e.res === 'hi') {
          e.box.hidden = false;
          if (e.holder) { e.holder.style.maskImage = 'none'; e.holder.style.webkitMaskImage = 'none'; }
          e.el.style.opacity = '0.002';
          e.warming = true;
        }
      } else if (shown && !e.res && R.lo) {
        e.el.src = R.lo; e.res = 'lo'; stats.fallbacks++;
        if (e.cut) placeCut(e);
      }
    }
    if (R.ready && R.boot && R.els.every((e) => e.res === 'hi')) R.boot = false;
    if (R.warm > 0) { R.warm--; warming = true; }
  }
  stats.peakBytes = Math.max(stats.peakBytes, bytes);
  stats.peakPlates = Math.max(stats.peakPlates, plates);
  return warming;
}
// после прогрева вернуть слоям обычное состояние: видимость и маску заново
// выставит apply() на следующем кадре
function coolDown() {
  let any = false;
  for (const R of RES.values()) for (const e of R.els) {
    if (e.warming && R.warm === 0) { e.el.style.opacity = ''; e.warming = false; any = true; }
  }
  if (any) for (const S of built) S.lastMask = '';
}

function coverScale(want, vp, rx, ry, ax, ay) {
  const l = Math.max(0, vp[0] - rx), r = Math.min(1, vp[0] + rx);
  const t = Math.max(0, vp[1] - ry), b = Math.min(1, vp[1] + ry);
  return Math.max(want, Math.max(
    (vp[0] + ax - l) / vp[0], (r - vp[0] - ax) / (1 - vp[0]),
    (vp[1] + ay - t) / vp[1], (b - vp[1] - ay) / (1 - vp[1]),
  ));
}

buildTrajectories(innerWidth, innerHeight);

/* ------------------------------------------ доминирование сцены и тексты
 *
 * Текст биома держится, пока сам биом визуально текущий. Источник истины —
 * не граница секции, а доля кадра, которую уже заняла сцена назначения: её
 * видно сквозь маску диафрагмы (радиальный градиент со спадом). Когда доля
 * доходит до TAKEOVER, текущим становится следующий биом. Доля — функция
 * нарисованного прогресса, поэтому правило при обратной прокрутке то же.
 *
 * Прежнее трение чтения (read / fast / skip, торможение перед окнами текста)
 * снято: оно было нужно, пока текст жил в коротком окне и его приходилось
 * спасать задержкой. Траектории камеры от него не зависели — трение меняло
 * только скорость, с которой нарисованный прогресс догонял колесо.
 */
const TAKEOVER = 0.75;
const MASK_STOPS = new Map();
function stopsOf(str) {
  if (!MASK_STOPS.has(str)) {
    const st = [];
    for (const m of str.matchAll(/(?:#000 0|rgba\(0,0,0,([\d.]+)\)|transparent) (\d+)%/g)) {
      st.push([+m[2] / 100, m[0].startsWith('#000') ? 1 : m[0].startsWith('transparent') ? 0 : +m[1]]);
    }
    MASK_STOPS.set(str, st);
  }
  return MASK_STOPS.get(str);
}
function alphaAt(st, r) {
  if (r <= st[0][0]) return st[0][1];
  for (let i = 1; i < st.length; i++) {
    if (r <= st[i][0]) { const [r0, a0] = st[i - 1], [r1, a1] = st[i]; return a0 + (a1 - a0) * (r - r0) / (r1 - r0); }
  }
  return 0;
}
// доля кадра, занятая сценой назначения секции d в её локальной точке l
function shareAt(d, l, W, H) {
  if (l < d.gate[0] - 0.01) return 0;
  const [rx, ry] = radii(d, l, W, H), st = stopsOf(d.ap.stops);
  let sum = 0, n = 0;
  for (let j = 0; j < 27; j++) for (let i = 0; i < 48; i++) {
    const x = (i + 0.5) / 48, y = (j + 0.5) / 27;
    const r = Math.hypot((x - d.vp[0]) / rx, (y - d.vp[1]) / ry);
    sum += alphaAt(st, r); n++;
  }
  return sum / n;
}
// точки смены текущего биома: для каждой секции — прогресс, где сцена
// назначения заняла TAKEOVER кадра (не позже конца полосы, где слой меняется)
const TAKE = [];
function computeTakeover(W, H) {
  TAKE.length = 0;
  for (const d of SECTIONS) {
    let at = globOf(d, 1);
    for (let s = 0; s <= 1000; s++) {
      const l = s / 1000;
      if (shareAt(d, l, W, H) >= TAKEOVER) { at = globOf(d, l); break; }
    }
    TAKE.push(Math.min(at, d.band[1]));
  }
}
computeTakeover(innerWidth, innerHeight);
// номер текущего биома: 0 деревня … 5 дом
const dominantAt = (pp) => TAKE.filter((t) => pp >= t).length;

/* POC «находки биомов» — только превью: /depth-v2/?poc=discoveries (все
   биомы) и /depth-v2/?poc=mine (только шахта, принятый эталон). Биом с
   находками длиннее по прокрутке: внутри него колесо двигает прогресс
   медленнее (ход камеры тот же, только проходится дольше). Во сколько раз —
   данные движка находок (poc-discoveries.js), не этого файла.
   Локальный прогресс биома k: 0 — биом занял кадр (TAKE[k-1]), 0.78 — начало
   раскрытия следующей сцены, 1 — следующая сцена заняла кадр (TAKE[k]). У
   дома раскрытия дальше нет: прогресс линейный до конца маршрута. */
const POC_MODE = IS_PREVIEW ? new URLSearchParams(location.search).get('poc') : null;
const POC_ON = POC_MODE === 'discoveries' || POC_MODE === 'mine';
const biomeSpan = (k) => {
  const m0 = k > 0 ? TAKE[k - 1] : 0, m1 = k < TAKE.length ? TAKE[k] : 1;
  const d = SECTIONS[k];
  return { m0, m1, rs: d && k < TAKE.length ? globOf(d, d.gate[0]) : 1 };
};
function biomeLocal(k, pp) {
  const { m0, rs, m1 } = biomeSpan(k);
  if (pp < m0 || pp > m1) return null;
  if (rs >= m1) return (pp - m0) / Math.max(1e-6, m1 - m0);
  return pp <= rs ? 0.78 * (pp - m0) / (rs - m0) : 0.78 + 0.22 * (pp - rs) / (m1 - rs);
}
// растяжение по биомам: { k: [до раскрытия, после] }; приходит с модулем находок
let STRETCH_BY = {};
function wheelGain(tp) {
  const e = 0.012, k = (x) => smooth(Math.min(1, Math.max(0, x)));
  let over = 0;
  for (const [key, [S, X]] of Object.entries(STRETCH_BY)) {
    const { m0, rs, m1 } = biomeSpan(+key);
    // плавные края, чтобы скорость прокрутки не менялась скачком
    const inside = k((tp - (m0 - e)) / e) * (1 - k((tp - m1) / e));
    over = Math.max(over, inside * ((tp < rs ? S : X) - 1));
  }
  return 1 / (1 + over);
}
let poc = null;
if (POC_ON) {
  import('./poc-discoveries.js').then((m) => {
    const only = POC_MODE === 'mine' ? ['mine'] : null;
    const eng = m.mountDiscoveries(document.getElementById('content'), { only, stretch: new URLSearchParams(location.search).get('stretch') });
    STRETCH_BY = eng.stretch;
    poc = eng.update;
    schedule();
  });
}

let p = 0, target = 0, raf = 0, last = performance.now();

const frames = [];

function apply(now) {
  raf = 0;
  const dt = Math.min(64, now - last);
  last = now;
  const step = (target - p) * (1 - Math.pow(0.0012, dt / 1000));
  p += step;
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
      // точка масштабирования: сцена назначения росла вокруг точки схода
      // ПРЕДЫДУЩЕЙ секции (так построено её окно), плита — вокруг своей. При
      // масштабе ~1.06–1.09 резкая смена точки сдвигала кадр на 12–18 px ровно
      // в момент смены слоя (и главы). Точка переходит плавно (smooth, C1) от
      // прежней к своей между сменой слоя и стыковкой траекторий
      let org = d.origin;
      if (prev && p < prev.pj) {
        const pv = SECTIONS[idx - 1].vp, w = smooth(seg(p, b0 - 0.004, prev.pj));
        org = `${((pv[0] + (d.vp[0] - pv[0]) * w) * 100).toFixed(3)}% ${((pv[1] + (d.vp[1] - pv[1]) * w) * 100).toFixed(3)}%`;
      }
      if (S.plate._origin !== org) { S.plate.style.transformOrigin = org; S.plate._origin = org; }
      S.plate.style.transform = `scale(${ps.toFixed(4)})`;
      S.plate._scale = ps;
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
    S.next._scale = sk;
  }

  coolDown();
  const warming = residency(p);

  const cur = p >= ARRIVAL.at ? ARRIVAL
    : SECTIONS.reduce((a, s) => (p >= s.band[0] ? s : a), SECTIONS[0]);
  updateContent(p, dominantAt(p));
  if (poc) poc((k) => biomeLocal(k, p));
  updateChrome(p, cur.id);

  if (debug) {
    const [b0, b1] = cur.band;
    panel.textContent = `progress ${p.toFixed(3)}\nsection  ${cur.id}`
      + `  local ${clamp((p - b0) / (b1 - b0), 0, 1).toFixed(2)}\nlive     ${live}`;
  }

  frames.push(now);
  if (frames.length > 240) frames.shift();
  if (p !== target || warming) schedule();
}

function schedule() { if (!raf && started && !life.signal.aborted) raf = requestAnimationFrame(apply); }

addEventListener('wheel', (e) => {
  target = clamp(target + e.deltaY * 0.00022 * wheelGain(target), 0, 1);
  schedule();
}, { passive: true, signal: life.signal });

addEventListener('keydown', (e) => {
  const step = (e.shiftKey ? 0.06 : 0.01) * wheelGain(target);
  if (e.key === 'ArrowDown' || e.key === 'PageDown') target = clamp(target + step, 0, 1);
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') target = clamp(target - step, 0, 1);
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = 1;
  else return;
  schedule();
}, { signal: life.signal });
addEventListener('resize', () => {
  try {
    buildTrajectories(innerWidth, innerHeight);    // покрытие зависит от пропорций окна
  } catch (e) {
    // траектории другого окна здесь невалидны: живой режим уступает статике
    window.dispatchEvent(new CustomEvent('depth:live-failed', { detail: String(e) }));
    return;
  }
  for (const S of built) S.lastMask = '';
  computeTakeover(innerWidth, innerHeight);
  layoutCuts();
  schedule();
}, { signal: life.signal });

window.__LIVE_STOP = function stop() {
  life.abort();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  for (const R of RES.values()) if (R.on) release(R);   // поздний decode отбрасывается (R.img)
  updateChrome.stop();
  delete window.__JOURNEY;
};

// старт: раскладка вырезок и первая сцена. Ждём только то, что в кадре сразу, —
// деревню и её вырезки; остальное подтягивает окно резидентности по ходу.
// Раньше старт ждал hi-res деревни (~1.1 МБ и декодирование 4736 px) при
// пустой сцене: на медленной сети это секунды тёмного экрана. Теперь hi-res
// ждём недолго (BOOT_HI); не успела — первым кадром идёт принятая плита 1536,
// а hi-res заменяет её, как только готова. Не пришла ни та, ни другая —
// старт отказывает, и boot.js показывает статику.
const BOOT_HI = 1200;
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const loaded = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(true); im.onerror = () => ok(false); im.src = src; });
CUT_BOX = await Promise.race([fetch('/assets/depth/hi/cuts.json').then((r) => r.json()), wait(4000).then(() => ({}))])
  .catch(() => ({}));
if (!alive()) throw new Error('depth-v2: live mode cancelled during start');
layoutCuts();
// до старта слои скрыты: кадр рисуется только после решения, чем его заполнить
for (const n of stage.children) n.hidden = true;
// true, как только хоть одно из двух дало true; false — если оба отказали
const either = (a, b) => new Promise((ok) => {
  let n = 0;
  const f = (v) => { if (v) ok(true); else if (++n === 2) ok(false); };
  a.then(f); b.then(f);
});
// точка старта: начало маршрута или позиция, сохранённая при смене языка.
// Первая сцена — та, что нужна в этой точке (обычно деревня и вырезки)
const p0 = takeSavedProgress();
p = target = p0;
if (p0 > 0) stage.classList.add('is-live');     // размытая деревня — постер только для начала
const first = [...RES.values()].filter((R) => p0 >= R.acq && p0 <= R.end + REACQUIRE);
const plates = first.filter((R) => !R.els.some((e) => e.cut));
const allPlatesHi = () => plates.every((R) => R.ready);
// деревню 1536 boot.js запросил ещё до модулей. Если она всё ещё в пути — сеть
// медленная: hi-res первой сцены ждёт её, иначе делит с ней канал, и стартовый
// кадр приходит вдвое позже. На быстрой сети 1536 к этому моменту уже в кэше.
// Плита и вырезки ждутся вместе, чтобы вырезки не появлялись позже плиты
const lo = Promise.all(first.map((R) => loaded(R.lo)))
  .then((ok) => first.every((R, i) => ok[i] || !plates.includes(R)));
const slow = !await Promise.race([lo.then(() => true), wait(150).then(() => false)]);
if (slow) await lo;
if (!alive()) throw new Error('depth-v2: live mode cancelled during start');
residency(p0);
for (const R of first) R.boot = true;
const allHi = Promise.all(first.map((R) => R.done));
if (slow || !await Promise.race([allHi.then(allPlatesHi), wait(BOOT_HI).then(() => false)])) {
  // стартовый кадр 1536 (те же файлы, что у статики и прежнего старта)
  if (!await either(lo, allHi.then(allPlatesHi))) {
    throw new Error('depth-v2: first scene failed to load');
  }
}
if (!alive()) throw new Error('depth-v2: live mode cancelled during start');
started = true;
schedule();
// постер старта (depth.css) снимается, когда первый кадр сцены уже декодирован
requestAnimationFrame(() => Promise.all([...stage.querySelectorAll('img[src]')]
  .map((im) => im.decode().catch(() => {}))).then(() => stage.classList.add('is-live')));

window.__JOURNEY = {
  get progress() { return p; },
  get target() { return target; },
  // точки смены текущего биома по доле кадра и сама доля — для проверок
  takeover: () => [...TAKE],
  share: (i, pp) => shareAt(SECTIONS[i], locOf(SECTIONS[i], pp), innerWidth, innerHeight),
  dominant: () => dominantAt(p),
  // локальный прогресс биома k (0 деревня … 5 дом) и его границы — для проверок POC
  biome: (k) => ({ ...biomeSpan(k), m: biomeLocal(k, p), poc: POC_MODE }),
  mine: () => ({ ...biomeSpan(2), m: biomeLocal(2, p), poc: POC_ON }),
  residency: () => ({ ...stats, resident: [...RES.values()].filter((R) => R.on)
    .map((R) => ({ key: R.key, ready: R.ready, mb: +(R.bytes / 2 ** 20).toFixed(1) })) }),
  set(v, { instant = false } = {}) { target = clamp(v, 0, 1); if (instant) p = target; schedule(); },
  sections: () => SECTIONS.map((s) => ({ id: s.id, band: s.band })),
  // отчёт о выборе траекторий: текущее окно или любое W×H (расчёт без побочных эффектов)
  trajectories: (W, H) => (W ? computeTrajectories(W, H, true).report : TRAJ_REPORT.map((r) => ({ ...r }))),
  // масштаб сцены назначения секции i в точке p для окна W×H — для геометрических тестов
  trajectoryScale: (W, H, i, ps) => { const t = computeTrajectories(W, H).traj[i]; return ps.map((x) => t.scale(x)); },
  fps: () => {
    if (frames.length < 3) return null;
    const d = [];
    for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
    d.sort((a, b) => a - b);
    return { frames: d.length, median: d[d.length >> 1], p95: d[Math.floor(d.length * 0.95)], worst: d[d.length - 1] };
  },
};
