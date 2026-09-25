/* Depth Journey: находки биомов в живом маршруте (/, /ru/, /depth-v2/).
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
 *   • EN и RU берут свою копию;
 *   • статика, reduced-motion, узкое окно и страница без JS не грузят ни
 *     модуль, ни картинки;
 *   • картинки не участвуют в старте: первый кадр сцены приходит раньше них.
 */
import { test, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';

const BEAT_OF = ['village', 'forest', 'mine', 'threshold', 'core', 'home'];
const DISC_ASSET = /\/assets\/depth\/discovery\//;
const DISC_ANY = /\/assets\/depth\/discovery\/|poc-discoveries\.js/;

async function open(browser, baseURL, url, { width = 1920, height = 1080, ...rest } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, baseURL, ...rest });
  const page = await context.newPage();
  page._errors = []; page._requests = []; page._bad = [];
  page.on('pageerror', (e) => page._errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page._errors.push(m.text()); });
  page.on('request', (r) => page._requests.push(r.url()));
  page.on('requestfailed', (r) => page._bad.push(`failed ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) page._bad.push(`${r.status()} ${r.url()}`); });
  await stubExternal(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
  return page;
}
const biomesData = (page) => page.evaluate(async () => {
  const { BIOMES } = await import('/depth-v2/poc-discoveries.js');
  return Object.entries(BIOMES).map(([name, b]) => ({ name, k: b.k, exit: b.exit, keep: b.keep || [],
    ids: b.items.map((i) => i.id), at: b.items.map((i) => i.at) }));
});
// главный объект биома задан в долях плиты; на экране он у каждого момента свой
const keepNow = (page, rects) => page.evaluate((qs) => {
  const i = [...document.querySelectorAll('#stage img')].filter((x) => !x.hidden && +getComputedStyle(x).opacity > 0.5)
    .map((x) => x.getBoundingClientRect()).filter((r) => r.width > 10).sort((a, b) => b.width - a.width)[0];
  return qs.map((q) => [(i.left + q[0] * i.width) / innerWidth, (i.top + q[1] * i.height) / innerHeight,
    (i.left + q[2] * i.width) / innerWidth, (i.top + q[3] * i.height) / innerHeight]);
}, rects);
const pOf = (sp, m) => (sp.rs >= sp.m1 ? sp.m0 + m * (sp.m1 - sp.m0)
  : m <= 0.78 ? sp.m0 + (m / 0.78) * (sp.rs - sp.m0) : sp.rs + ((m - 0.78) / 0.22) * (sp.m1 - sp.rs));
// установить прогресс и дождаться двух кадров: состояние находок обновляется в
// кадре журнала, и на медленном раннере фиксированной паузы не хватает
const set = (page, v) => page.evaluate((x) => new Promise((ok) => {
  window.__JOURNEY.set(x, { instant: true });
  requestAnimationFrame(() => requestAnimationFrame(ok));
}), v);
const onIn = (page, name) => page.evaluate((n) => [...document.querySelectorAll(`.poc-find.is-on[data-biome="${n}"]`)].map((f) => f.dataset.find), name);
// находки смонтированы (после первого кадра) и картинки нужного биома пришли
// картинки биома приходят по ходу маршрута, на загруженном раннере не мгновенно
const mounted = (page, n) => page.waitForFunction((x) => document.querySelectorAll('.poc-find').length === x, n, { timeout: 60_000 });
const drawn = (page, name) => page.waitForFunction((n) => [...document.querySelectorAll(`.poc-find[data-biome="${n}"] img`)]
  .every((i) => i.complete && i.naturalWidth > 0), name, { timeout: 60_000 });

// A. полный прогон по биомам — на продакшен-маршруте, без query
test('/ discoveries: every biome accumulates in order, leaves before takeover, keeps base copy', async ({ browser, baseURL }) => {
  // плотный проход по пяти биомам плюс проверка главного объекта в момент
  // появления каждой находки: на загруженном раннере это дольше двух минут
  test.setTimeout(420_000);
  const page = await open(browser, baseURL, '/');
  const data = (await biomesData(page)).filter((b) => b.ids.length);
  expect(data.map((b) => b.name).sort()).toEqual(['core', 'forest', 'home', 'mine', 'village']);
  await mounted(page, data.reduce((a, b) => a + b.ids.length, 0));
  const lines = [];
  for (const b of data) {
    const sp = await page.evaluate((k) => window.__JOURNEY.biome(k), b.k);
    await set(page, pOf(sp, 0.02));
    await drawn(page, b.name);                       // картинки биома приходят по ходу маршрута
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
    // главный объект биома: находка не заходит в него в свой момент появления
    // (дальше предмет прибит к экрану, а сцена едет — пересечение по ходу биома
    // неизбежно и не является дефектом)
    for (const [i, id] of b.ids.entries()) {
      await set(page, pOf(sp, Math.min(0.99, b.at[i] + 0.01)));
      await page.waitForTimeout(80);
      const box = await page.evaluate((x) => { const r = document.querySelector(`.poc-find[data-find="${x}"] img`).getBoundingClientRect();
        return [r.left / innerWidth, r.top / innerHeight, r.right / innerWidth, r.bottom / innerHeight]; }, id);
      for (const k of await keepNow(page, b.keep)) {
        const hit = box[0] < k[2] && k[0] < box[2] && box[1] < k[3] && k[1] < box[3];
        expect(hit, `${b.name}/${id} at reveal ${box.map((v) => v.toFixed(2))} overlaps the main object ${k.map((v) => v.toFixed(2))}`).toBe(false);
      }
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
  expect(page._bad).toEqual([]);
  test.info().annotations.push({ type: 'counts', description: lines.join(' · ') });
  await page.context().close();
});

// B, C. остальные входы: находки те же, копия по языку страницы
for (const [url, lang, first] of [['/ru/', 'ru', ['Письмо', 'Сообщения идут по миру и без тебя.']],
  ['/depth-v2/', 'en', ['Sealed letter', 'Messages move through the world without you.']]]) {
  test(`${url} discoveries: live without a query, ${lang.toUpperCase()} copy`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const page = await open(browser, baseURL, url);
    const data = (await biomesData(page)).filter((b) => b.ids.length);
    await mounted(page, data.reduce((a, b) => a + b.ids.length, 0));
    const sp = await page.evaluate(() => window.__JOURNEY.biome(0));
    await set(page, pOf(sp, 0.02));
    await drawn(page, 'village');
    const counts = [];
    for (const m of [0.05, 0.32, 0.44, 0.56, 0.68, 0.86]) {
      await set(page, pOf(sp, m)); await page.waitForTimeout(60);
      counts.push((await onIn(page, 'village')).length);
    }
    expect(counts, `${url}: village accumulates then leaves`).toEqual([0, 1, 2, 3, 4, 0]);
    const cap = await page.evaluate(() => {
      const f = document.querySelector('.poc-find[data-find="sealed-letter"]');
      return [f.querySelector('b').textContent, f.querySelector('span').textContent];
    });
    expect(cap, `${url}: copy`).toEqual(first);
    // порог пуст и здесь
    const th = await page.evaluate(() => window.__JOURNEY.biome(3));
    await set(page, pOf(th, 0.5)); await page.waitForTimeout(60);
    expect(await page.evaluate(() => document.querySelectorAll('.poc-find.is-on').length)).toBe(0);
    expect(page._errors, url).toEqual([]);
    expect(page._bad, url).toEqual([]);
    await page.context().close();
  });
}

// D. лёгкие режимы остаются лёгкими
test('static, reduced-motion, narrow and no-JS load neither the module nor the images', async ({ browser, baseURL }) => {
  const cases = [
    ['/', { viewport: { width: 800, height: 900 } }, 'narrow'],
    ['/ru/', { viewport: { width: 800, height: 900 } }, 'narrow ru'],
    ['/', { viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }, 'reduced-motion'],
    ['/depth-v2/', { viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }, 'preview reduced-motion'],
  ];
  for (const [url, opts, label] of cases) {
    const context = await browser.newContext({ ...opts, baseURL });
    const page = await context.newPage();
    page._requests = []; page._errors = [];
    page.on('request', (r) => page._requests.push(r.url()));
    page.on('pageerror', (e) => page._errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') page._errors.push(m.text()); });
    await stubExternal(page);
    await page.goto(url);
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'static', null, { timeout: 30_000 });
    await page.mouse.move(400, 400);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(60); }
    await page.waitForTimeout(400);
    expect(page._requests.filter((u) => DISC_ANY.test(u)), label).toEqual([]);
    expect(await page.evaluate(() => document.querySelectorAll('.poc-find, .poc-finds').length), label).toBe(0);
    expect(page._errors, label).toEqual([]);
    await context.close();
  }
  // без JS вовсе: в документе только статическая разметка
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  page._requests = [];
  page.on('request', (r) => page._requests.push(r.url()));
  await page.goto('/');
  await page.waitForTimeout(800);
  expect(page._requests.filter((u) => DISC_ANY.test(u)), 'no-JS').toEqual([]);
  expect(await page.locator('#static').count(), 'no-JS keeps static markup').toBe(1);
  await context.close();
});

// J. картинки находок не участвуют в старте
test('startup is not blocked by discovery assets: the first scene comes first', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/');
  await mounted(page, 18);
  await set(page, 0.02);
  await drawn(page, 'village');
  const t = await page.evaluate(() => {
    const e = performance.getEntriesByType('resource');
    const hero = e.filter((r) => /hero_plate_clean|\/h2f\//.test(r.name)).sort((a, b) => a.responseEnd - b.responseEnd)[0];
    const finds = e.filter((r) => /\/assets\/depth\/discovery\//.test(r.name));
    const find = finds.slice().sort((a, b) => a.startTime - b.startTime)[0];
    const mod = e.find((r) => /poc-discoveries\.js/.test(r.name));
    return { hero: hero?.responseEnd ?? null, find: find?.startTime ?? null, mod: mod?.responseEnd ?? null, n: finds.length };
  });
  expect(t.hero, 'first scene loaded').not.toBeNull();
  expect(t.find, 'find assets loaded later').not.toBeNull();
  expect(t.find, `first find asset ${t.find?.toFixed(0)}ms >= first scene ${t.hero?.toFixed(0)}ms`).toBeGreaterThanOrEqual(t.hero);
  // деревня тянет только свои картинки, а не все 18 сразу
  expect(t.n, 'only the current biome is fetched at the start').toBeLessThanOrEqual(8);
  expect(page._errors).toEqual([]);
  test.info().annotations.push({ type: 'startup', description: `scene ${t.hero.toFixed(0)}ms · module ${t.mod?.toFixed(0)}ms · first find asset ${t.find.toFixed(0)}ms · fetched ${t.n}` });
  await page.context().close();
});

// K. широкое окно 1920x900 — тот же живой режим
test('wide 1920x900: discoveries live, no prop leaves the viewport', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const page = await open(browser, baseURL, '/', { width: 1920, height: 900 });
  await mounted(page, 18);
  const data = (await biomesData(page)).filter((b) => b.ids.length);
  for (const b of data) {
    const sp = await page.evaluate((k) => window.__JOURNEY.biome(k), b.k);
    await set(page, pOf(sp, 0.02));
    await drawn(page, b.name);
    await set(page, pOf(sp, Math.min(0.85, (b.exit ?? 1) - 0.05)));
    await page.waitForTimeout(120);
    const out = await page.evaluate((n) => [...document.querySelectorAll(`.poc-find.is-on[data-biome="${n}"]`)]
      .map((f) => { const r = f.getBoundingClientRect(); return { id: f.dataset.find, r: [r.left, r.top, r.right, r.bottom] }; })
      .filter((o) => o.r[0] < -0.5 || o.r[1] < -0.5 || o.r[2] > innerWidth + 0.5 || o.r[3] > innerHeight + 0.5), b.name);
    expect(out, `${b.name}: inside the viewport`).toEqual([]);
  }
  expect(page._errors).toEqual([]);
  expect(page._bad).toEqual([]);
  await page.context().close();
});

// превью: один ключ ?poc=mine оставляет находки одной шахты; продакшен его не знает
test('preview ?poc=mine keeps only Mine; production ignores the query', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/depth-v2/?poc=mine');
  await mounted(page, 4);
  expect(await page.evaluate(() => [...new Set([...document.querySelectorAll('.poc-find')].map((f) => f.dataset.biome))])).toEqual(['mine']);
  const sp = await page.evaluate(() => window.__JOURNEY.biome(2));
  await set(page, pOf(sp, 0.02));
  await drawn(page, 'mine');
  expect(page._requests.filter((u) => DISC_ASSET.test(u) && !/\/mine\//.test(u))).toEqual([]);
  await page.context().close();

  const prod = await open(browser, baseURL, '/?poc=mine');
  await mounted(prod, 18);
  expect(await prod.evaluate(() => [...new Set([...document.querySelectorAll('.poc-find')].map((f) => f.dataset.biome))].sort()))
    .toEqual(['core', 'forest', 'home', 'mine', 'village']);
  await prod.context().close();
});

/* Модель: находка появляется в мире, на своей опоре (world), коротким
   движением уходит в своё место коллекции (slot) и дальше стоит в кадре.
   Карта едет — предмет стоит. Проверяем по всем биомам: появление, перелёт,
   ход вперёд и назад, resize и смену языка. */
// рект и состояние сразу после появления: окно показа в мире короткое,
// поэтому читаем в том же кадре, в котором выставили прогресс
const revealRect = (page, v, id) => page.evaluate(([x, f]) => new Promise((ok) => {
  window.__JOURNEY.set(x, { instant: true });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector(`.poc-find[data-find="${f}"]`);
    const r = el.querySelector('img').getBoundingClientRect();
    ok({ world: el.classList.contains('is-world'),
      x: (r.left + r.right) / 2 / innerWidth, y: (r.top + r.bottom) / 2 / innerHeight, h: r.height / innerHeight });
  }));
}), [v, id]);
const RECT = (page, id) => page.evaluate((x) => {
  const f = document.querySelector(`.poc-find[data-find="${x}"] img`);
  const r = f.getBoundingClientRect();
  return { l: +r.left.toFixed(2), t: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
}, id);
const SCENE = (page) => page.evaluate(() => {
  const i = [...document.querySelectorAll('#stage img')].filter((x) => !x.hidden && +getComputedStyle(x).opacity > 0.5)
    .map((x) => x.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0];
  return { l: +i.left.toFixed(1), t: +i.top.toFixed(1), w: +i.width.toFixed(1) };
});

test('a find appears in the world, stamps into its slot and then stays: every biome', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const page = await open(browser, baseURL, '/');
  const data = (await biomesData(page)).filter((b) => b.ids.length);
  await mounted(page, 18);
  const moved = [];
  for (const b of data) {
    const sp = await page.evaluate((k) => window.__JOURNEY.biome(k), b.k);
    const spec = await page.evaluate(async (n) => {
      const { BIOMES } = await import('/depth-v2/poc-discoveries.js');
      return BIOMES[n].items.map((i) => ({ at: i.at, world: i.world, slot: i.slot }));
    }, b.name);
    const at = spec.map((i) => i.at);
    await set(page, pOf(sp, Math.max(0.01, at[0] - 0.05)));
    await drawn(page, b.name);
    // появление: предмет стоит в точке мира и в масштабе сцены
    for (const [i, id] of b.ids.entries()) {
      await set(page, pOf(sp, Math.max(0.01, at[i] - 0.02)));
      await page.waitForTimeout(120);
      const r = await revealRect(page, pOf(sp, at[i] + 0.005), id);
      expect(r.world, `${b.name}/${id}: shown in the world first`).toBe(true);
      const [wx, wy, wh] = spec[i].world;
      expect(Math.abs(r.x - wx), `${b.name}/${id}: reveal x ${r.x.toFixed(3)} vs world ${wx}`).toBeLessThanOrEqual(0.004);
      expect(Math.abs(r.y - wy), `${b.name}/${id}: reveal y ${r.y.toFixed(3)} vs world ${wy}`).toBeLessThanOrEqual(0.004);
      // высота ректа включает наклон предмета, поэтому сверяем не её саму, а
      // отношение «в мире / в коллекции» — наклон у обоих один и тот же
      const wantScale = spec[i].world[2] / spec[i].slot[2];
      // после перелёта — своё место в коллекции
      await page.waitForTimeout(700);
      const s2 = await page.evaluate((x) => { const el = document.querySelector(`.poc-find[data-find="${x}"]`);
        const q = el.querySelector('img').getBoundingClientRect();
        return { world: el.classList.contains('is-world'), x: (q.left + q.right) / 2 / innerWidth,
          y: (q.top + q.bottom) / 2 / innerHeight, h: q.height / innerHeight }; }, id);
      expect(s2.world, `${b.name}/${id}: no longer in the world`).toBe(false);
      const [sx, sy] = spec[i].slot;
      expect(Math.abs(s2.x - sx), `${b.name}/${id}: slot x ${s2.x.toFixed(3)} vs ${sx}`).toBeLessThanOrEqual(0.004);
      expect(Math.abs(s2.y - sy), `${b.name}/${id}: slot y ${s2.y.toFixed(3)} vs ${sy}`).toBeLessThanOrEqual(0.006);
      // рект включает наклон предмета, поэтому сверяем не высоту саму, а
      // отношение «в мире / в коллекции»: наклон у обоих один и тот же
      expect(Math.abs(r.h / s2.h - wantScale), `${b.name}/${id}: reveal scale ${(r.h / s2.h).toFixed(3)} vs ${wantScale.toFixed(3)}`).toBeLessThanOrEqual(0.03);
    }
    await set(page, pOf(sp, at[0] + 0.01));
    await page.waitForTimeout(300);
    const first = await RECT(page, b.ids[0]);
    const scene0 = await SCENE(page);
    // дальше по биому: сцена уезжает и растёт, находка стоит
    const last = (b.exit ?? 1) - 0.03;
    for (const m of [at[0] + 0.1, (at[0] + last) / 2, last]) {
      await set(page, pOf(sp, Math.min(last, m)));
      await page.waitForTimeout(200);
      const r = await RECT(page, b.ids[0]);
      const d = Math.max(Math.abs(r.l - first.l), Math.abs(r.t - first.t), Math.abs(r.w - first.w), Math.abs(r.h - first.h));
      expect(d, `${b.name}/${b.ids[0]} moved ${d.toFixed(2)}px at m=${m.toFixed(2)}`).toBeLessThanOrEqual(1);
    }
    const scene1 = await SCENE(page);
    const sceneMoved = Math.max(Math.abs(scene1.l - scene0.l), Math.abs(scene1.w - scene0.w));
    // у дома сцена прибытия заморожена и не движется — там сравнивать не с чем
    if (b.k !== 5) expect(sceneMoved, `${b.name}: the scene itself must move`).toBeGreaterThan(40);
    moved.push(`${b.name}: scene ${sceneMoved.toFixed(0)}px, find 0px`);
    // назад: уходят по одной, оставшиеся не двигаются
    const kept = await RECT(page, b.ids[0]);
    for (let i = b.ids.length - 1; i > 0; i--) {
      const gone = await page.evaluate(async (n) => {
        const { BIOMES } = await import('/depth-v2/poc-discoveries.js');
        return BIOMES[n].items.map((x) => x.at);
      }, b.name);
      await set(page, pOf(sp, gone[i] - 0.01));
      await page.waitForTimeout(120);
      expect(await onIn(page, b.name), `${b.name}: reverse to ${i}`).toEqual(b.ids.slice(0, i));
      const still = await RECT(page, b.ids[0]);
      const moved0 = Math.max(Math.abs(still.l - kept.l), Math.abs(still.t - kept.t), Math.abs(still.w - kept.w));
      expect(moved0, `${b.name}: kept find moved ${moved0.toFixed(2)}px on reverse`).toBeLessThanOrEqual(1);
    }
  }
  test.info().annotations.push({ type: 'pinned', description: moved.join(' · ') });
  expect(page._errors).toEqual([]);
  await page.context().close();
});

test('pinned finds keep their place in the viewport across a resize', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/');
  await mounted(page, 18);
  const sp = await page.evaluate(() => window.__JOURNEY.biome(0));
  await set(page, pOf(sp, 0.7));
  await drawn(page, 'village');
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => [...document.querySelectorAll('.poc-find.is-on img')].map((i) => {
    const r = i.getBoundingClientRect();
    return { id: i.closest('.poc-find').dataset.find, x: +((r.left + r.right) / 2 / innerWidth).toFixed(3), y: +((r.top + r.bottom) / 2 / innerHeight).toFixed(3) };
  }));
  expect(before.length).toBeGreaterThan(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => [...document.querySelectorAll('.poc-find.is-on img')].map((i) => {
    const r = i.getBoundingClientRect();
    return { id: i.closest('.poc-find').dataset.find, x: +((r.left + r.right) / 2 / innerWidth).toFixed(3), y: +((r.top + r.bottom) / 2 / innerHeight).toFixed(3) };
  }));
  expect(after.map((a) => a.id)).toEqual(before.map((b) => b.id));
  for (const a of after) {
    const b = before.find((q) => q.id === a.id);
    expect(Math.abs(a.x - b.x), `${a.id}: x after resize`).toBeLessThanOrEqual(0.01);
    expect(Math.abs(a.y - b.y), `${a.id}: y after resize`).toBeLessThanOrEqual(0.01);
  }
  // ничего не уехало за кадр
  const out = await page.evaluate(() => [...document.querySelectorAll('.poc-find.is-on')].map((f) => f.getBoundingClientRect())
    .filter((r) => r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5).length);
  expect(out, 'nothing leaves the viewport after resize').toBe(0);
  expect(page._errors).toEqual([]);
  await page.context().close();
});

test('language switch restores open finds in place, without replaying the reveal', async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL, '/');
  await mounted(page, 18);
  const sp = await page.evaluate(() => window.__JOURNEY.biome(0));
  const at = pOf(sp, 0.7);
  await set(page, at);
  await drawn(page, 'village');
  await page.waitForTimeout(300);
  const before = await onIn(page, 'village');
  const rects = {};
  for (const id of before) rects[id] = await RECT(page, id);
  await page.click('a[href="/ru/"]');
  await page.waitForURL('**/ru/');
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 30_000 });
  await mounted(page, 18);
  await page.waitForFunction((n) => document.querySelectorAll(`.poc-find.is-on[data-biome="village"]`).length === n, before.length, { timeout: 30_000 });
  const after = await onIn(page, 'village');
  expect(after, 'the same finds are open after the switch').toEqual(before);
  // восстановление, а не повторный показ: анимации шлепка нет
  expect(await page.evaluate(() => [...document.querySelectorAll('.poc-find.is-on')]
    .every((f) => f.classList.contains('is-restored') && getComputedStyle(f).animationName === 'none')), 'no reveal replay').toBe(true);
  await drawn(page, 'village');
  await page.waitForTimeout(200);
  for (const id of before) {
    const r = await RECT(page, id);
    const d = Math.max(Math.abs(r.l - rects[id].l), Math.abs(r.t - rects[id].t));
    expect(d, `${id}: pinned position after the language switch`).toBeLessThanOrEqual(1);
  }
  // копия — русская
  const cap = await page.evaluate(() => document.querySelector('.poc-find[data-find="sealed-letter"] b').textContent);
  expect(cap).toBe('Письмо');
  expect(page._errors).toEqual([]);
  await page.context().close();
});
