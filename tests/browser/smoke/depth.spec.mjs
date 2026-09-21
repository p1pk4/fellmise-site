/* Depth Journey: всё, что маршрут грузит, приходит из репозитория.
 *
 * Эта проверка появилась после реального дефекта: плиты сцен лежали в
 * игнорируемом out/, локально всё работало, а опубликованный /depth-v2/ отдавал
 * 404 на каждую сцену. Поэтому здесь не перечисляются имена файлов — каждый
 * роут проходится целиком, и тест падает на ЛЮБОМ запросе в /out/ и на любом
 * ответе >= 400, откуда бы он ни взялся. CI гоняет набор на чистом checkout,
 * где игнорируемых файлов нет физически, так что зависимость от локального
 * файла здесь не может спрятаться.
 */
import { test, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';

function clean(w) {
  expect(w.out, 'requests into ignored out/').toEqual([]);
  expect(w.http, 'HTTP >= 400').toEqual([]);
  expect(w.failed, 'failed requests').toEqual([]);
  expect(w.pageErrors, 'uncaught JS errors').toEqual([]);
  expect(w.consoleErrors, 'console errors').toEqual([]);
}

/* Провести роут от начала до конца. У маршрута и у изолированных переходов есть
   отладочный API вида window.__NAME.set(progress); если его нет — колесо. */
async function travel(page) {
  const api = await page.evaluate(() => Object.keys(window)
    .filter((k) => /^__[A-Z0-9]+$/.test(k) && window[k] && typeof window[k].set === 'function'));
  if (api.length) {
    for (let t = 0; t <= 1.0001; t += 0.04) {
      await page.evaluate(([k, x]) => window[k].set(x, { instant: true }), [api[0], t]);
      await page.waitForTimeout(50);
    }
  } else {
    await page.mouse.move(640, 400);
    for (let i = 0; i < 300; i++) await page.mouse.wheel(0, 60);
  }
  await page.waitForTimeout(1200);
}

const DESKTOP = { viewport: { width: 1920, height: 1080 } };

test.describe('depth journey: runtime assets ship with the site', () => {
  for (const route of ['/depth-v2/', '/depth-v2/?lang=ru']) {
    test(`${route} — whole journey, nothing from out/, no 4xx`, async ({ browser, baseURL }) => {
      const page = await (await browser.newContext({ ...DESKTOP, baseURL })).newPage();
      const w = await attach(page, baseURL);
      await page.goto(route);
      await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 60_000 });
      await travel(page);
      expect([...w.local].some((p) => p.startsWith('/assets/depth/')), 'scenes come from /assets/depth/').toBe(true);
      clean(w);
      await page.context().close();
    });
  }

  for (const route of ['/depth-v2/h2f/', '/depth-v2/f2m2/', '/depth-v2/m2s/', '/depth-v2/s2c/', '/depth-v2/c2h/']) {
    test(`${route} — isolated transition, nothing from out/, no 4xx`, async ({ browser, baseURL }) => {
      const page = await (await browser.newContext({ ...DESKTOP, baseURL })).newPage();
      const w = await attach(page, baseURL);
      await page.goto(route);
      await page.waitForTimeout(2500);
      await travel(page);
      clean(w);
      await page.context().close();
    });
  }

  for (const [name, opts] of [['reduced motion', { ...DESKTOP, reducedMotion: 'reduce' }],
                              ['narrow 600', { viewport: { width: 600, height: 900 } }]]) {
    test(`/depth-v2/ ${name} — static, nothing from out/, no 4xx`, async ({ browser, baseURL }) => {
      const page = await (await browser.newContext({ ...opts, baseURL })).newPage();
      const w = await attach(page, baseURL);
      await page.goto('/depth-v2/');
      await page.waitForTimeout(2500);
      clean(w);
      await page.context().close();
    });
  }
});

/* Наблюдатели на страницу: у каждого теста свой контекст (viewport,
   reduced-motion), поэтому они вешаются здесь, а не общей фикстурой. */
async function attach(page, baseURL) {
  const w = { pageErrors: [], consoleErrors: [], failed: [], http: [], out: [], local: new Set() };
  await stubExternal(page);
  page.on('pageerror', (e) => w.pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') w.consoleErrors.push(m.text()); });
  page.on('request', (r) => {
    if (!r.url().startsWith(baseURL)) return;
    const path = new URL(r.url()).pathname;
    w.local.add(path);
    if (/^\/out\//.test(path)) w.out.push(path);
  });
  page.on('requestfailed', (r) => { if (r.url().startsWith(baseURL)) w.failed.push(`${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.url().startsWith(baseURL) && r.status() >= 400) w.http.push(`${r.status()} ${r.url()}`); });
  return w;
}
