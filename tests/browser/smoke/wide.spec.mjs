/* Depth Journey: широкие окна.
 *
 * Появилась после дефекта в production: на окнах шире ~2.05:1 (1920×900 —
 * обычный развёрнутый браузер на мониторе 1920×1080) buildTrajectories не
 * находил стыковки Forest -> Mine с точным C1, оставлял best = null и падал
 * на старте; до PR #28 это была пустая страница, после — аварийная статика.
 *
 * Широкая сетка окон проверяется расчётом траекторий (без отдельной записи
 * на каждый размер), браузером — старт, маршрут и resize на нескольких окнах.
 */
import { test, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';

const WORKING = [[1920, 1080], [1280, 800], [1152, 720], [1024, 768], [1920, 940]];
const WIDE = [[1920, 930], [1920, 920], [1920, 900], [1920, 800], [1536, 730], [1440, 700], [1366, 650],
  [1280, 620], [2560, 1080], [3440, 1300], [3440, 1440]];

async function open(browser, baseURL, url, { width = 1920, height = 1080, ...ctx } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, baseURL, ...ctx });
  const page = await context.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page._errors.push(m.text()); });
  await stubExternal(page);
  await page.goto(url);
  return page;
}
const liveReady = (page) => page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
const state = (page) => page.evaluate(() => {
  const stage = document.getElementById('stage');
  const px = [...stage.querySelectorAll('img')].filter((im) => {
    const box = im.closest('.holder') || (im.classList.contains('cut') ? im.parentElement : im);
    return !box.hidden && im.getAttribute('src') && im.naturalWidth > 0;
  }).length;
  return { mode: document.documentElement.dataset.mode, fallback: document.documentElement.dataset.fallback || null,
    journey: !!window.__JOURNEY, progress: window.__JOURNEY?.progress ?? null, px,
    stage: getComputedStyle(stage).display };
});

/* Расчёт: каждое окно сетки получает траектории всех переходов; прежние
   размеры остаются на точном C1; значения конечные, масштаб не падает */
test('trajectories exist for every viewport in the grid; working sizes keep exact C1', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/depth-v2/');
  await liveReady(page);
  const rows = await page.evaluate(({ working, wide }) => [...working, ...wide].map(([w, h]) => {
    let report, scales;
    try {
      report = window.__JOURNEY.trajectories(w, h);
      scales = report.map((r, k) => {
        const i = k + 1, from = r.pt - 0.05, to = r.pj + 0.03, ps = [];
        for (let s = 0; s <= 400; s++) ps.push(from + (to - from) * s / 400);
        return window.__JOURNEY.trajectoryScale(w, h, i, ps);
      });
    } catch (e) { return { w, h, error: String(e) }; }
    return { w, h, report, scales };
  }), { working: WORKING, wide: WIDE });

  const lines = [];
  for (const r of rows) {
    expect(r.error, `${r.w}x${r.h}`).toBeUndefined();
    for (const [k, rep] of r.report.entries()) {
      const sc = r.scales[k];
      expect(sc.every((v) => Number.isFinite(v) && v > 0), `${r.w}x${r.h} ${rep.id}: finite, positive`).toBe(true);
      for (let s = 1; s < sc.length; s++) {
        expect(sc[s], `${r.w}x${r.h} ${rep.id}: scale never shrinks`).toBeGreaterThanOrEqual(sc[s - 1] - 1e-9);
      }
    }
    const isWorking = WORKING.some(([w, h]) => w === r.w && h === r.h);
    if (isWorking) expect(r.report.map((x) => x.mode), `${r.w}x${r.h} keeps C1`).toEqual(['c1', 'c1', 'c1', 'arrival']);
    const worst = r.report.reduce((a, x) => Math.max(a, x.rel), 0);
    lines.push(`${r.w}x${r.h}: ${r.report.map((x) => `${x.id} ${x.mode}${x.mode === 'fallback' ? ` Δ${(x.rel * 100).toFixed(1)}%` : ''}`).join(', ')} · max ${(worst * 100).toFixed(1)}%`);
  }
  test.info().annotations.push({ type: 'trajectories', description: lines.join('\n') });
  await page.context().close();
});

/* Браузер: 1920×900 на трёх входах — живой режим, кадр виден, маршрут до Home */
for (const url of ['/', '/ru/', '/depth-v2/']) {
  test(`${url} at 1920x900 starts live and reaches Home`, async ({ browser, baseURL }) => {
    const page = await open(browser, baseURL, url, { width: 1920, height: 900 });
    await liveReady(page);
    await expect.poll(() => state(page), { timeout: 10_000 }).toMatchObject({ mode: 'live', fallback: null, stage: 'block' });
    expect((await state(page)).px).toBeGreaterThan(0);
    await page.evaluate(() => window.__JOURNEY.set(1));
    await page.waitForFunction(() => window.__JOURNEY.progress > 0.999, null, { timeout: 60_000 });
    expect(await state(page)).toMatchObject({ mode: 'live', fallback: null });
    expect(page._errors).toEqual([]);
    await page.context().close();
  });
}

for (const [w, h] of [[2560, 1080], [3440, 1440]]) {
  test(`ultrawide ${w}x${h} starts live`, async ({ browser, baseURL }) => {
    const page = await open(browser, baseURL, '/', { width: w, height: h });
    await liveReady(page);
    await expect.poll(() => state(page), { timeout: 10_000 }).toMatchObject({ mode: 'live', fallback: null });
    expect((await state(page)).px).toBeGreaterThan(0);
    expect(page._errors).toEqual([]);
    await page.context().close();
  });
}

/* Resize в живом режиме: без исключений, прогресс не сбрасывается, сцена на
   месте, движение после перестроения продолжается */
test('resize 1920x1080 -> 1920x900 -> 2560x1080 -> back keeps live at every point of the route', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/');
  await liveReady(page);
  for (const p0 of [0.02, 0.29, 0.52, 1]) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate((v) => window.__JOURNEY.set(v, { instant: true }), p0);
    await page.waitForTimeout(700);
    for (const [w, h] of [[1920, 900], [2560, 1080], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(700);
      const s = await state(page);
      expect(s, `p=${p0} at ${w}x${h}`).toMatchObject({ mode: 'live', fallback: null, journey: true });
      expect(Math.abs(s.progress - p0), `progress kept at ${w}x${h}`).toBeLessThan(0.001);
      expect(s.px, `scene visible at ${w}x${h}`).toBeGreaterThan(0);
    }
  }
  // после перестроения движение продолжается
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.evaluate(() => window.__JOURNEY.set(0.2, { instant: true }));
  await page.mouse.move(960, 450);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
  await page.waitForTimeout(1200);
  expect((await state(page)).progress).toBeGreaterThan(0.21);
  expect(page._errors).toEqual([]);
  await page.context().close();
});

/* Геометрия зависит от CSS-пикселей, а не от физических */
test('1920x900 at DPR 2 picks the same trajectories as at DPR 1', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/', { width: 1920, height: 900, deviceScaleFactor: 2 });
  await liveReady(page);
  expect(await state(page)).toMatchObject({ mode: 'live', fallback: null });
  const pick = (rows) => rows.map(({ id, mode, pj, mismatch }) => ({ id, mode, pj, mismatch }));
  const [cur, ref] = await page.evaluate(() => [window.__JOURNEY.trajectories(), window.__JOURNEY.trajectories(1920, 900)]);
  expect(pick(cur)).toEqual(pick(ref));
  expect(cur.map((r) => r.mode)).toEqual(['fallback', 'c1', 'c1', 'arrival']);
  await page.context().close();
});

/* Рисуемая камера у точки касания Forest: мелкий шаг, ни одного отката.
   Прежняя линейная интерполяция прицела давала здесь подъём и возврат
   масштаба на ~0.14% за один шаг сетки */
for (const [w, h] of [[1920, 1080], [1920, 900]]) {
  test(`rendered destination scale never shrinks around the Forest touch point at ${w}x${h}`, async ({ browser, baseURL }) => {
    const page = await open(browser, baseURL, '/depth-v2/', { width: w, height: h });
    await liveReady(page);
    const worst = await page.evaluate(async () => {
      const num = (t) => { const m = t.match(/scale\(([\d.]+)\)/); return m ? +m[1] : null; };
      const holder = document.querySelectorAll('#stage .holder')[1];      // секция forest -> mine
      let prev = null, worst = 0;
      for (let p = 0.26; p <= 0.30; p += 0.0001) {
        window.__JOURNEY.set(p, { instant: true });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const v = holder.hidden ? null : num(holder.querySelector('img').style.transform);
        if (v != null && prev != null) worst = Math.max(worst, prev - v);
        prev = v;
      }
      return worst;
    });
    expect(worst, 'largest one-step scale decrease').toBeLessThanOrEqual(1e-4);
    await page.context().close();
  });
}
