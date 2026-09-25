/* Depth Journey: текст биома держится, пока биом визуально текущий; смена
 * главы не дёргает картинку; биом с находками проходится дольше.
 *
 * Появилась после двух замечаний владельца: текст уходил раньше самого
 * биома (короткие окна range), а на смене главы FOREST -> MINE картинка
 * прыгала. Причина прыжка — смена точки масштабирования на смене слоя
 * (сцена назначения росла вокруг точки схода предыдущей секции, плита —
 * вокруг своей), 12–18 px за один кадр.
 */
import { test, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';

async function open(browser, baseURL, url, { width = 1920, height = 1080 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, baseURL });
  const page = await context.newPage();
  page._errors = [];
  page._requests = [];
  page.on('pageerror', (e) => page._errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page._errors.push(m.text()); });
  page.on('request', (r) => page._requests.push(r.url()));
  await stubExternal(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
  return page;
}
const BIOMES = ['village', 'forest', 'mine', 'threshold', 'core', 'home'];
const beatsOn = (page) => page.evaluate(() => [...document.querySelectorAll('.beat.is-on')]
  .map((e) => [...e.classList].find((c) => /^beat--(village|forest|mine|threshold|core|home)$/.test(c)).slice(6)));

test('biome copy stays until the next scene visually takes over; one beat at a time, both directions', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/depth-v2/');
  const T = await page.evaluate(() => window.__JOURNEY.takeover());
  expect(T).toHaveLength(5);
  const expected = (p) => (p < 0.03 ? null : BIOMES[T.filter((t) => p >= t).length]);
  // смена бита — уход, потом появление: ~480 мс по CSS. Ждём результат, а не
  // фиксированную паузу: на загруженном раннере она заканчивалась раньше смены
  const probe = async (p) => {
    await page.evaluate((v) => window.__JOURNEY.set(v, { instant: true }), p);
    await page.waitForTimeout(460);
    const want = expected(p);
    for (let i = 0; i < 12 && JSON.stringify(await beatsOn(page)) !== JSON.stringify(want ? [want] : []); i++) {
      await page.waitForTimeout(120);
    }
    return beatsOn(page);
  };
  // до и после каждой точки смены — прежний и новый биом
  for (const [i, t] of T.entries()) {
    expect(await probe(t - 0.006), `before takeover ${i}`).toEqual([BIOMES[i]]);
    expect(await probe(t + 0.006), `after takeover ${i}`).toEqual([BIOMES[i + 1]]);
  }
  // по всему маршруту вперёд и назад: не больше одного бита, и это текущий биом
  const pts = []; for (let p = 0; p <= 1.0001; p += 0.025) pts.push(+p.toFixed(3));
  for (const p of [...pts, ...pts.slice().reverse()]) {
    const on = await probe(p);
    expect(on.length, `beats at ${p}`).toBeLessThanOrEqual(1);
    expect(on[0] ?? null, `beat at ${p}`).toBe(expected(p));
  }
  expect(page._errors).toEqual([]);
  await page.context().close();
});

for (const [w, h] of [[1920, 1080], [1920, 900]]) {
  test(`chapter change does not move the picture at ${w}x${h}`, async ({ browser, baseURL }) => {
    const page = await open(browser, baseURL, '/depth-v2/', { width: w, height: h });
    const res = await page.evaluate(async () => {
      const J = window.__JOURNEY, secs = J.sections();
      const S = []; for (const n of document.querySelectorAll('#stage > *')) {
        if (n.tagName === 'IMG') S.push({ plate: n }); else if (n.classList.contains('holder')) S.at(-1).holder = n;
      }
      const R = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
      const geo = () => JSON.stringify(['stage', 'ui', 'content'].map((id) => R(document.getElementById(id))));
      const out = [];
      const tick = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      // четыре смены слоя (с ними меняется глава) и глава прибытия (без смены слоя)
      for (let k = 1; k < secs.length; k++) {
        const b0 = secs[k].band[0], rows = [];
        for (let q = b0 - 0.008; q <= b0 + 0.004 + 1e-9; q += 0.0002) {
          J.set(q, { instant: true }); await tick();
          const plate = S[k].plate, onTop = !plate.hidden && +getComputedStyle(plate).opacity > 0.5;
          rows.push({ layer: onTop ? 'plate' : 'holder', rect: R(onTop ? plate : S[k - 1].holder.querySelector('img')), geo: geo(),
            chapter: document.querySelector('.route__name')?.textContent });
        }
        let cross = 0, typical = 0;
        for (let i = 1; i < rows.length; i++) {
          const d = Math.max(...rows[i].rect.map((v, j) => Math.abs(v - rows[i - 1].rect[j])));
          if (rows[i - 1].layer !== rows[i].layer) cross = d; else typical = Math.max(typical, d);
        }
        out.push({ id: `${secs[k - 1].id}->${secs[k].id}`, cross, typical, geoStable: new Set(rows.map((r) => r.geo)).size === 1,
          chapters: [...new Set(rows.map((r) => r.chapter))].length });
      }
      // прибытие: глава меняется на Home при 0.82, сцена та же
      const before = []; J.set(0.8195, { instant: true }); await tick();
      before.push(geo(), R(S[secs.length - 1].holder.querySelector('img')));
      J.set(0.8205, { instant: true }); await tick();
      const after = [geo(), R(S[secs.length - 1].holder.querySelector('img'))];
      out.push({ id: 'core->home (arrival)', cross: Math.max(...after[1].map((v, j) => Math.abs(v - before[1][j]))), typical: 1, geoStable: before[0] === after[0], chapters: 2 });
      return out;
    });
    for (const r of res) {
      expect(r.chapters, `${r.id}: chapter label changes inside the window`).toBe(2);
      expect(r.geoStable, `${r.id}: stage/ui/content boxes unchanged`).toBe(true);
      expect(r.cross, `${r.id}: jump at the layer switch vs the largest normal step ${r.typical.toFixed(2)} px`)
        .toBeLessThanOrEqual(Math.max(1, r.typical * 1.5));
    }
    test.info().annotations.push({ type: 'switch', description: res.map((r) => `${r.id}: ${r.cross.toFixed(2)} px (step ≤ ${r.typical.toFixed(2)})`).join(' · ') });
    await page.context().close();
  });
}

/* Находки живут на всех трёх входах; их поведение проверяет discovery.spec.
   Здесь остаётся то, что видно только по прокрутке: биом с находками
   проходится дольше, чем биом без них (wheelGain в journey.js). */
test('Mine scrolls longer than the threshold: discovery stretch is live on /', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/');
  await page.waitForFunction(() => document.querySelectorAll('.poc-find').length === 18, null, { timeout: 30_000 });
  const ticks = async (k) => {
    const sp = await page.evaluate((x) => window.__JOURNEY.biome(x), k);
    await page.evaluate((v) => window.__JOURNEY.set(v, { instant: true }), sp.m0);
    await page.mouse.move(960, 540);
    let n = 0;
    while ((await page.evaluate(() => window.__JOURNEY.target)) < sp.m1 && n < 800) { await page.mouse.wheel(0, 100); n++; }
    return n / (sp.m1 - sp.m0);
  };
  const mine = await ticks(2), threshold = await ticks(3);
  // растяжение шахты 3x до раскрытия и 1.6x после: в сумме около 2.6x. Счёт
  // тиков дискретный, поэтому порог ниже измеренного — он отделяет растянутый
  // биом от нерастянутого (там было бы 1.0), а не проверяет точное число
  expect(mine / threshold, `wheel ticks per progress: Mine ${mine.toFixed(0)} vs threshold ${threshold.toFixed(0)}`)
    .toBeGreaterThanOrEqual(2);
  expect(page._errors).toEqual([]);
  await page.context().close();
});
