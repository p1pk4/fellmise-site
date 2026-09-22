/* Depth Journey: текст биома держится, пока биом визуально текущий; смена
 * главы не дёргает картинку; POC шахты с открытиями живёт только на превью.
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
  const probe = async (p) => {
    await page.evaluate((v) => window.__JOURNEY.set(v, { instant: true }), p);
    await page.waitForTimeout(460);                         // смена бита — уход, потом появление
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

test('Mine POC: three discoveries in order, one at a time, only inside Mine; base Mine copy stays', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/depth-v2/?poc=mine');
  await page.waitForFunction(() => document.querySelector('.poc-disc'));
  const span = await page.evaluate(() => window.__JOURNEY.mine());
  expect(span.poc).toBe(true);
  const seen = [];
  for (let p = span.m0 - 0.03; p <= span.m1 + 0.03; p += 0.0025) {
    await page.evaluate((v) => window.__JOURNEY.set(v, { instant: true }), p);
    await page.waitForTimeout(60);
    const s = await page.evaluate(() => ({
      disc: [...document.querySelectorAll('.poc-disc .lab')].filter((l) => +l.style.opacity > 0.5).map((l) => l.querySelector('b').textContent),
      m: window.__JOURNEY.mine().m,
    }));
    expect(s.disc.length, `discoveries at ${p.toFixed(4)}`).toBeLessThanOrEqual(1);
    if (s.m == null) expect(s.disc, `outside Mine at ${p.toFixed(4)}`).toEqual([]);
    if (s.disc[0] && seen.at(-1) !== s.disc[0]) seen.push(s.disc[0]);
  }
  expect(seen).toEqual(['Ore vein', 'Extraction', 'Rare vein']);
  // основной текст шахты на всём её протяжении
  for (const m of [0.1, 0.3, 0.5, 0.69, 0.9]) {
    const p = m <= 0.78 ? span.m0 + (m / 0.78) * (span.rs - span.m0) : span.rs + ((m - 0.78) / 0.22) * (span.m1 - span.rs);
    await page.evaluate((v) => window.__JOURNEY.set(v, { instant: true }), p);
    await page.waitForTimeout(460);
    expect(await beatsOn(page), `base Mine copy at m=${m}`).toEqual(['mine']);
  }
  expect(page._errors).toEqual([]);
  await page.context().close();
});

test('Mine POC is longer to scroll; production routes do not load it', async ({ browser, baseURL }) => {
  const ticks = async (url) => {
    const page = await open(browser, baseURL, url);
    const span = await page.evaluate(() => window.__JOURNEY.mine());
    await page.evaluate((v) => window.__JOURNEY.set(v, { instant: true }), span.m0);
    await page.mouse.move(960, 540);
    let n = 0;
    while ((await page.evaluate(() => window.__JOURNEY.target)) < span.m1 && n < 400) { await page.mouse.wheel(0, 100); n++; }
    const loaded = page._requests.some((u) => /poc-mine\.js/.test(u));
    await page.context().close();
    return { n, loaded };
  };
  const poc = await ticks('/depth-v2/?poc=mine'), plain = await ticks('/depth-v2/'), root = await ticks('/');
  expect(poc.loaded).toBe(true);
  expect(plain.loaded).toBe(false);
  expect(root.loaded).toBe(false);
  expect(poc.n, `wheel ticks through Mine: POC ${poc.n} vs ${plain.n}`).toBeGreaterThanOrEqual(plain.n * 3);
});
