/* Depth Journey: запуск корня не оставляет пустую страницу.
 *
 * Появилась после инцидента в production: / подолгу показывал тёмный экран
 * (старт ждал декодирования hi-res деревни, а статика к этому моменту уже
 * удалена), отказ модуля оставлял пустой корень, а окно, суженное после
 * запуска ниже порога, прятало живую сцену стилями при data-mode=live.
 * Порог живого режима — 1024 CSS px (был 1280).
 *
 * «Есть содержимое» здесь значит одно из двух: видна статическая версия с
 * текстом или в видимой сцене есть картинка с пикселями.
 *
 * Сценарии с отказами намеренно рождают ошибки сети: они перечислены в самих
 * тестах и не проверяются на «console 0» — это делают обычные сценарии.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';

const LIVE_MIN = 1024;                 // живой режим с этой ширины CSS viewport

const START_LIMIT = 12_000;           // тот же предел, что в depth-v2/boot.js

const shown = () => {
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const st = document.getElementById('static');
  const stage = document.getElementById('stage');
  const pixels = vis(stage) ? [...stage.querySelectorAll('img')].filter((im) => {
    const box = im.closest('.holder') || (im.classList.contains('cut') ? im.parentElement : im);
    return !box.hidden && im.getAttribute('src') && im.naturalWidth > 0;
  }).length : 0;
  const staticText = vis(st) ? (st.querySelector('h2')?.textContent || '').trim() : '';
  return { mode: document.documentElement.dataset.mode || null, staticText, pixels,
    meaningful: !!staticText || pixels > 0, journey: !!window.__JOURNEY,
    sound: !!document.querySelector('.audio-toggle'),
    hiPlate: [...(stage?.querySelectorAll('img') || [])].some((im) => /\/hi\/hero_plate_clean/.test(im.getAttribute('src') || '')) };
};

async function open(browser, baseURL, url, { width = 1920, height = 1080, route, ...ctx } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, baseURL, ...ctx });
  const page = await context.newPage();
  await stubExternal(page);
  if (route) await route(page);
  await page.goto(url, { waitUntil: 'commit' });
  return page;
}
const wait = (page, ms) => page.waitForTimeout(ms);

/* Правило режима живёт в четырёх копиях: ранний скрипт трёх документов и
   boot.js. Разойтись им нельзя — иначе ранняя развилка и boot.js решат по-разному. */
test('rule: every copy of the mode rule uses the same breakpoint', () => {
  const q = `(max-width: ${LIVE_MIN - 1}px)`;
  const ROOT = test.info().config.metadata.siteRoot;   // проверяемая копия сайта (playwright.config)
  for (const f of ['index.html', 'ru/index.html', 'depth-v2/index.html', 'depth-v2/boot.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const found = [...src.matchAll(/\(max-width: \d+px\)/g)].map((m) => m[0]);
    expect(found, f).toEqual([q]);
  }
});

/* A. Одна и та же развилка для EN и RU при одинаковом окне */
test('A: / and /ru/ pick the same mode at the same viewport', async ({ browser, baseURL }) => {
  const rows = [];
  for (const width of [1920, 1440, 1366, 1280, 1279, 1152, 1024, 1023, 600]) {
    const modes = [];
    for (const url of ['/', '/ru/', '/depth-v2/']) {
      const page = await open(browser, baseURL, url, { width, height: 900 });
      await page.waitForLoadState('domcontentloaded');
      modes.push(await page.evaluate(() => document.documentElement.dataset.mode));
      await page.context().close();
    }
    rows.push(`${width}: ${modes.join(' / ')}`);
    expect(new Set(modes).size, `mode at ${width}: ${modes}`).toBe(1);
    expect(modes[0], `mode at ${width}`).toBe(width >= LIVE_MIN ? 'live' : 'static');
  }
  test.info().annotations.push({ type: 'modes', description: rows.join(' · ') });
});

/* B. Режим и стили не расходятся: на границе и после сужения окна */
test('B: CSS follows the chosen mode at the breakpoint and after resize', async ({ browser, baseURL }) => {
  for (const width of [LIVE_MIN, LIVE_MIN - 1]) {
    const page = await open(browser, baseURL, '/', { width, height: 900 });
    await expect.poll(() => page.evaluate(shown), { timeout: 20_000 }).toMatchObject({ meaningful: true });
    const s = await page.evaluate(() => ({ mode: document.documentElement.dataset.mode,
      stage: getComputedStyle(document.getElementById('stage')).display }));
    expect(s.stage === 'none', `stage hidden at ${width} must mean static mode`).toBe(s.mode !== 'live');
    await page.context().close();
  }
  // живой старт на 1280, окно сужается до 1152: живой режим продолжает работать
  const page = await open(browser, baseURL, '/', { width: 1280, height: 800 });
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
  await page.setViewportSize({ width: 1152, height: 720 });
  await wait(page, 600);
  await page.evaluate(() => window.__JOURNEY.set(0.2, { instant: true }));
  await expect.poll(() => page.evaluate(shown), { timeout: 5_000 }).toMatchObject({ meaningful: true, mode: 'live', journey: true });
  // и уже порога: статика, не пустая страница
  await page.setViewportSize({ width: LIVE_MIN - 1, height: 720 });
  await expect.poll(() => page.evaluate(shown), { timeout: 5_000 }).toMatchObject({ meaningful: true, mode: 'static', sound: false, journey: false });
  await page.context().close();
});

/* B2. reduced-motion, включённый после живого старта, останавливает живой режим */
test('B2: reduced-motion turned on after start stops live', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/ru/');
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(shown), { timeout: 5_000 }).toMatchObject({ meaningful: true, mode: 'static', sound: false, journey: false });
  await page.context().close();
});

/* C + F. Прямой вход: содержимое видно, пока hi-res ещё в пути; hi-res потом приходит */
for (const url of ['/', '/ru/']) {
  test(`C/F: ${url} shows the village while hi-res is still loading`, async ({ browser, baseURL }) => {
    const page = await open(browser, baseURL, url, {
      route: (pg) => pg.route('**/assets/depth/hi/*.webp', async (r) => { await new Promise((ok) => setTimeout(ok, 8_000)); await r.continue(); }),
    });
    // стартовый кадр (размытая деревня из depth.css) виден с первой отрисовки
    await page.waitForLoadState('domcontentloaded');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage'), '::before').backgroundImage)).toMatch(/^url\(/);
    await expect.poll(() => page.evaluate(shown), { timeout: 5_000 }).toMatchObject({ meaningful: true, mode: 'live' });
    // задержанная hi-res деревня всё-таки заменяет стартовый кадр
    await expect.poll(() => page.evaluate(shown), { timeout: 20_000 }).toMatchObject({ hiPlate: true });
    await page.context().close();
  });
}

/* D. Первая необходимая картинка не пришла: читаемая статика.
   Ожидаемые ошибки: net::ERR_FAILED на hero_plate_clean.webp (hi и 1536). */
test('D: failed first scene falls back to the localized static page', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/ru/', {
    route: (pg) => pg.route(/hero_plate_clean\.webp$/, (r) => r.abort()),
  });
  await expect.poll(() => page.evaluate(shown), { timeout: START_LIMIT + 5_000 })
    .toMatchObject({ mode: 'static', meaningful: true, sound: false });
  expect((await page.evaluate(shown)).staticText).toMatch(/[А-Яа-яЁё]/);
  await page.context().close();
});

/* E. Живой модуль не загрузился (503): статика, не пустой корень.
   Ожидаемая ошибка: 503 на /depth-v2/journey.js. */
test('E: live module failing to load leaves the static page', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/', {
    route: (pg) => pg.route(/\/depth-v2\/journey\.js$/, (r) => r.fulfill({ status: 503, body: '' })),
  });
  await expect.poll(() => page.evaluate(shown), { timeout: 8_000 }).toMatchObject({ mode: 'static', meaningful: true });
  await page.context().close();
});

/* F. Бесконечно медленный старт: через предел — статика, и поздняя загрузка
   не возвращает страницу в живой режим. Ожидаемых ошибок нет: модули просто
   приходят позже предела. */
test('F: a stalled start ends in static and stays there', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/', {
    route: (pg) => pg.route(/\/depth-v2\/journey\.js$/, async (r) => {
      await new Promise((ok) => setTimeout(ok, START_LIMIT + 3_000)); await r.continue(); }),
  });
  await expect.poll(() => page.evaluate(shown), { timeout: START_LIMIT + 2_500 }).toMatchObject({ mode: 'static', meaningful: true });
  await wait(page, 5_000);          // модуль пришёл после предела
  expect(await page.evaluate(shown)).toMatchObject({ mode: 'static', meaningful: true, journey: false, sound: false });
  await page.context().close();
});

/* G. Повторный вход и переключение языка */
test('G: language switch and re-entry start live and keep position', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/');
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
  await page.evaluate(() => window.__JOURNEY.set(0.42, { instant: true }));
  await wait(page, 300);
  await page.click('a[href="/ru/"]');
  await page.waitForURL('**/ru/');
  await page.waitForFunction(() => window.__JOURNEY && Math.abs(window.__JOURNEY.progress - 0.42) < 0.01, null, { timeout: 30_000 });
  expect(await page.evaluate(shown)).toMatchObject({ mode: 'live', meaningful: true });
  await page.goto('/', { waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(shown), { timeout: 10_000 }).toMatchObject({ mode: 'live', meaningful: true });
  await page.context().close();
});

/* I. Хранилище сайта запрещено (cookies заблокированы): чтение sessionStorage
   бросает SecurityError. Живой режим всё равно стартует. */
test('I: blocked site storage does not break the live start', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, baseURL });
  await context.addInitScript(() => {
    for (const k of ['sessionStorage', 'localStorage']) {
      Object.defineProperty(window, k, { get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); } });
    }
  });
  const page = await context.newPage();
  await stubExternal(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(shown), { timeout: 15_000 }).toMatchObject({ mode: 'live', meaningful: true, journey: true });
  await context.close();
});

/* H. Без JavaScript, узкий экран и reduced-motion по-прежнему статичны и читаемы */
for (const [name, opts] of [['no-JS', { javaScriptEnabled: false }], ['narrow', { width: 600, height: 900 }],
  ['reduced-motion', { reducedMotion: 'reduce' }]]) {
  test(`H: ${name} shows the static page`, async ({ browser, baseURL }) => {
    const page = await open(browser, baseURL, '/ru/', opts);
    await page.waitForLoadState('load');
    const s = await page.evaluate(shown).catch(() => null);
    if (opts.javaScriptEnabled === false) {
      await expect(page.locator('#static h2').first()).toBeVisible();
    } else {
      expect(s).toMatchObject({ mode: 'static', meaningful: true, journey: false });
    }
    await page.context().close();
  });
}
