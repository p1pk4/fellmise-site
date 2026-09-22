/* Depth Journey: находки биомов (POC, только превью /depth-v2/?poc=discoveries).
 *
 * Правила одни для всех биомов, данные берутся из самого модуля
 * poc-discoveries.js (импорт в странице), поэтому тест проверяет то, что
 * реально описано в данных:
 *   • находки биома появляются по одной в заданном порядке и накапливаются
 *     (0 -> 1 -> … -> N), при прокрутке назад уходят в обратном порядке;
 *   • перед захватом кадра следующей сцены коллекция уходит целиком;
 *   • основной текст биома при этом на месте;
 *   • у порога находок нет — это намеренная пауза;
 *   • находки не заходят в защищённые зоны центрального объекта (keep);
 *   • обычные маршруты не грузят ни модуль, ни картинки находок.
 */
import { test, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';

const BEAT_OF = ['village', 'forest', 'mine', 'threshold', 'core', 'home'];

async function open(browser, baseURL, url) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, baseURL });
  const page = await context.newPage();
  page._errors = []; page._requests = [];
  page.on('pageerror', (e) => page._errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page._errors.push(m.text()); });
  page.on('request', (r) => page._requests.push(r.url()));
  await stubExternal(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
  return page;
}
const biomesData = (page) => page.evaluate(async () => {
  const { BIOMES } = await import('/depth-v2/poc-discoveries.js');
  return Object.entries(BIOMES).map(([name, b]) => ({ name, k: b.k, exit: b.exit, keep: b.keep || [], ids: b.items.map((i) => i.id) }));
});
const pOf = (sp, m) => (sp.rs >= sp.m1 ? sp.m0 + m * (sp.m1 - sp.m0)
  : m <= 0.78 ? sp.m0 + (m / 0.78) * (sp.rs - sp.m0) : sp.rs + ((m - 0.78) / 0.22) * (sp.m1 - sp.rs));
const set = (page, v) => page.evaluate((x) => window.__JOURNEY.set(x, { instant: true }), v);
const onIn = (page, name) => page.evaluate((n) => [...document.querySelectorAll(`.poc-find.is-on[data-biome="${n}"]`)].map((f) => f.dataset.find), name);

test('discoveries: every biome accumulates in order, leaves before takeover, keeps base copy', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const page = await open(browser, baseURL, '/depth-v2/?poc=discoveries');
  const data = (await biomesData(page)).filter((b) => b.ids.length);
  expect(data.map((b) => b.name).sort()).toEqual(['core', 'forest', 'home', 'mine', 'village']);
  await page.waitForFunction((n) => document.querySelectorAll('.poc-find').length === n, data.reduce((a, b) => a + b.ids.length, 0));
  const lines = [];
  for (const b of data) {
    const sp = await page.evaluate((k) => window.__JOURNEY.biome(k), b.k);
    const counts = [];
    for (let m = -0.05; m <= 1.05; m += 0.01) {
      const p = m < 0 ? sp.m0 + m * 0.2 * (sp.m1 - sp.m0) : m > 1 ? sp.m1 + (m - 1) * 0.2 * (sp.m1 - sp.m0) : pOf(sp, m);
      await set(page, Math.min(1, Math.max(0, p)));
      await page.waitForTimeout(30);
      const on = await onIn(page, b.name);
      if (on.length) expect(on, `${b.name}: accumulated finds at m=${m.toFixed(2)}`).toEqual(b.ids.slice(0, on.length));
      if (on.length !== counts.at(-1)) counts.push(on.length);
    }
    const expected = [0, ...b.ids.map((_, i) => i + 1)];
    if (b.exit != null) expected.push(0);
    expect(counts, `${b.name}: count over the biome`).toEqual(b.k === 5 ? expected.filter((c, i) => !(i === 0 && counts[0] !== 0)) : expected);
    // назад от собранного состояния (до ухода коллекции): только убывает, N -> 0
    const rev = [];
    for (let m = (b.exit ?? 1) - 0.01; m >= 0; m -= 0.02) {
      await set(page, pOf(sp, m)); await page.waitForTimeout(30);
      const n = (await onIn(page, b.name)).length;
      if (n !== rev.at(-1)) rev.push(n);
    }
    expect(rev, `${b.name}: reverse removes in order`).toEqual(b.ids.map((_, i) => b.ids.length - i).concat(0));
    // основной текст биома держится, пока находки на странице
    await set(page, pOf(sp, Math.min(0.85, (b.exit ?? 1) - 0.05))); await page.waitForTimeout(460);
    const beat = await page.evaluate(() => [...document.querySelectorAll('.beat.is-on')].map((e) => [...e.classList].find((c) => /^beat--(village|forest|mine|threshold|core|home)$/.test(c)).slice(6)));
    expect(beat, `${b.name}: base copy`).toEqual([BEAT_OF[b.k]]);
    // защищённые зоны центрального объекта в собранном состоянии
    const boxes = await page.evaluate((n) => [...document.querySelectorAll(`.poc-find.is-on[data-biome="${n}"] img`)].map((i) => { const r = i.getBoundingClientRect(); return [r.left / innerWidth, r.top / innerHeight, r.right / innerWidth, r.bottom / innerHeight]; }), b.name);
    for (const k of b.keep) for (const r of boxes) {
      const hit = r[0] < k[2] && k[0] < r[2] && r[1] < k[3] && k[1] < r[3];
      expect(hit, `${b.name}: find ${r.map((v) => v.toFixed(2))} overlaps protected ${k}`).toBe(false);
    }
    lines.push(`${b.name}: ${counts.join('→')}`);
  }
  // порог: находок нет
  const th = await page.evaluate(() => window.__JOURNEY.biome(3));
  for (const m of [0.2, 0.5, 0.8]) { await set(page, pOf(th, m)); await page.waitForTimeout(40); expect(await page.evaluate(() => document.querySelectorAll('.poc-find.is-on').length), `threshold m=${m}`).toBe(0); }
  // старой системы выносок нет
  expect(await page.evaluate(() => document.querySelectorAll('.poc-disc, .poc-finds svg, .poc-finds line, .poc-finds circle').length)).toBe(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('.poc-find img')].every((i) => i.complete && i.naturalWidth > 0)), 'all find images loaded').toBe(true);
  expect(page._errors).toEqual([]);
  test.info().annotations.push({ type: 'counts', description: lines.join(' · ') });
  await page.context().close();
});

test('discoveries: production routes load neither the module nor the images; ?poc=mine keeps only Mine', async ({ browser, baseURL }) => {
  for (const url of ['/', '/ru/', '/depth-v2/']) {
    const page = await open(browser, baseURL, url);
    for (const p of [0.06, 0.2, 0.36, 0.68, 0.95]) { await set(page, p); await page.waitForTimeout(150); }
    expect(page._requests.filter((u) => /\/assets\/depth\/discovery\/|poc-discoveries\.js/.test(u)), url).toEqual([]);
    expect(page._errors, url).toEqual([]);
    await page.context().close();
  }
  const page = await open(browser, baseURL, '/depth-v2/?poc=mine');
  await page.waitForFunction(() => document.querySelectorAll('.poc-find').length === 4);
  expect(await page.evaluate(() => [...new Set([...document.querySelectorAll('.poc-find')].map((f) => f.dataset.biome))])).toEqual(['mine']);
  expect(page._requests.filter((u) => /\/assets\/depth\/discovery\/(?!mine\/)/.test(u))).toEqual([]);
  await page.context().close();
});
