/* Smoke: every published page loads, says what it should to search engines,
 * and starts without errors. Pages are served from a local checkout; anything
 * external (Google Fonts) is answered locally, so no test touches the network.
 *
 * `test.fail` marks a KNOWN defect of the current site, reproduced on purpose:
 * it passes while the defect is there and turns red the day it is fixed, so
 * the marker cannot outlive the bug unnoticed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chromium } from '@playwright/test';
import { LAUNCH, stubExternal } from '../lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'checkpoints.json'), 'utf8'));
const PROTO_READY = CONFIG.routes['/proto/'].ready;

/* Every page gets the same watch: page errors, console errors, local requests
   that failed or answered >= 400, and what external requests were stubbed. */
const test = base.extend({
  watch: [async ({ page, baseURL }, use) => {
    const w = { pageErrors: [], consoleErrors: [], failed: [], http: [], external: [] };
    w.external = await stubExternal(page);
    page.on('pageerror', (e) => w.pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') w.consoleErrors.push(m.text()); });
    page.on('requestfailed', (r) => {
      if (r.url().startsWith(baseURL)) w.failed.push(`${r.url()} ${r.failure()?.errorText}`);
    });
    page.on('response', (r) => {
      if (r.url().startsWith(baseURL) && r.status() >= 400) w.http.push(`${r.status()} ${r.url()}`);
    });
    await use(w);
  }, { auto: true }],
});

function clean(w) {
  expect(w.pageErrors, 'uncaught JS errors').toEqual([]);
  expect(w.consoleErrors, 'console errors').toEqual([]);
  expect(w.failed, 'failed requests').toEqual([]);
  expect(w.http, 'HTTP >= 400').toEqual([]);
}

const robots = (page) => page.locator('meta[name="robots"]').evaluateAll(
  (els) => els.map((e) => e.getAttribute('content').toLowerCase()).join(','));

const ldTypes = (page) => page.locator('script[type="application/ld+json"]').evaluateAll(
  (els) => els.map((e) => JSON.parse(e.textContent)['@type']));

/* ------------------------------------------------------------------- root */
test.describe('root', () => {
  test('/ — indexable landing with SEO head', async ({ page, watch }) => {
    const r = await page.goto('/');
    expect(r.status()).toBe(200);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://fellmise.com/');
    expect(await robots(page)).not.toContain('noindex');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
    expect(await ldTypes(page)).toEqual(expect.arrayContaining(['VideoGame', 'Organization', 'WebSite']));
    await page.waitForLoadState('load');
    clean(watch);
  });

  test('/ru/ — Russian landing keeps canonical and hreflang', async ({ page, watch }) => {
    const r = await page.goto('/ru/');
    expect(r.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://fellmise.com/ru/');
    for (const [lang, href] of [['en', 'https://fellmise.com/'], ['ru', 'https://fellmise.com/ru/'],
                                ['x-default', 'https://fellmise.com/']]) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${lang}"]`)).toHaveAttribute('href', href);
    }
    expect(await robots(page)).not.toContain('noindex');
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForLoadState('load');
    clean(watch);
  });

  test('robots.txt and sitemap.xml are served', async ({ request }) => {
    const rb = await request.get('/robots.txt');
    expect(rb.status()).toBe(200);
    expect(await rb.text()).toContain('Sitemap: https://fellmise.com/sitemap.xml');
    const sm = await request.get('/sitemap.xml');
    expect(sm.status()).toBe(200);
    expect(await sm.text()).toContain('<loc>https://fellmise.com/</loc>');
  });
});

/* ------------------------------------------------------------------ proto */
test.describe('/proto/', () => {
  test('boots WebGL, loads the layout, reaches done, survives zoom and moves', async ({ page, watch }) => {
    const layouts = [];
    page.on('response', (r) => { if (/\/layout[^/]*\.json$/.test(r.url())) layouts.push(r); });
    const r = await page.goto('/proto/');
    expect(r.status()).toBe(200);
    expect(await robots(page)).toContain('noindex');

    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const state = await page.evaluate(() => ({ ...window.__PROTO.state }));
    expect(state.biomes).toBe(5);
    expect(state.objects).toBeGreaterThan(100);
    expect(state.decals).toBeGreaterThan(1000);

    expect(layouts.length, 'layout json requested').toBeGreaterThan(0);
    for (const l of layouts) expect(l.status(), l.url()).toBe(200);

    const gl = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const ctx = c && (c.getContext('webgl2') || c.getContext('webgl'));
      return { canvas: !!c, ctx: !!ctx, lost: ctx ? ctx.isContextLost() : null };
    });
    expect(gl).toEqual({ canvas: true, ctx: true, lost: false });
    await expect(page.locator('#hud')).not.toContainText('ошибка');

    // two zoom states and several world positions, through the page's own hook
    for (const c of CONFIG.checkpoints.filter((x) => x.route === '/proto/')) {
      await page.evaluate(([z, zoom]) => window.__PROTO.go(z, zoom), [c.z, c.zoom]);
      const s = await page.evaluate(() => ({ z: window.__PROTO.state.z, zoom: window.__PROTO.state.zoom }));
      expect(s).toEqual({ z: c.z, zoom: c.zoom });
      await expect(page.locator('#hud')).toContainText(`зум: ${c.zoom}`);
    }
    // the frame is a picture, not a cleared canvas
    const shot = await page.screenshot();
    expect(shot.length).toBeGreaterThan(200_000);
    clean(watch);
  });

  test('repaired sprites are what /proto/ loads', async ({ page, watch }) => {
    const got = new Map();
    page.on('response', async (r) => {
      const m = r.url().match(/\/proto\/sprites_stripped\/(hero_house_a|hero_house_b|hero_well)\.webp$/);
      if (m) got.set(m[1], r.status());
    });
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const index = await (await page.request.get('/proto/sprites_stripped/index.json')).json();
    test.skip(!index.repaired, 'this checkout has no repaired sprites');
    expect(Object.keys(index.repaired).sort()).toEqual(['hero_house_a', 'hero_house_b', 'hero_well']);
    for (const t of Object.keys(index.repaired)) expect(got.get(t), t).toBe(200);
    clean(watch);
  });

  test('every object shadow sits on its measured ground contact', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const has = await page.evaluate(() => typeof window.__PROTO.shadows === 'function');
    test.skip(!has, 'this checkout has no contact shadows yet');
    const runtime = await (await page.request.get('/assets/topdown/layout.runtime.json')).json();
    const meta = (await (await page.request.get('/proto/sprite_contact.json')).json()).sprites;
    const CS = runtime.presentation.contact_shadow;
    const shadows = await page.evaluate(() => window.__PROTO.shadows());
    const byId = new Map(shadows.map((s) => [s.id, s]));
    // aspect of each texture as the page loaded it
    const aspects = await page.evaluate(async (m) => {
      const out = {};
      for (const [t, v] of Object.entries(m)) {
        const img = new Image(); img.src = '/' + v.src; await img.decode();
        out[t] = img.width / img.height;
      }
      return out;
    }, meta);

    let checked = 0;
    const ids = Object.keys(runtime.biomes);
    for (const [bi, bid] of ids.entries()) {
      for (const o of runtime.biomes[bid].sprites) {
        const t = o.t;
        if (!t || t === 'hero_fence' || t === 'end_post' || t.startsWith('cloud_') || t === 'moon' || o.visible === false) continue;
        const s = byId.get(o.id);
        expect(s, `shadow for ${o.id}`).toBeTruthy();
        const m = meta[t];
        expect(m, `contact metadata for ${t}`).toBeTruthy();
        // independent: contact point from metadata + the object's own rotation
        const z0 = -bi * runtime.biome_spacing + o.pos[2], w = o.h * aspects[t], a = o.rotY || 0;
        const px = m.contact_centre * w, py = (0.5 - m.contact_row) * o.h;
        const ex = o.pos[0] + px * Math.cos(a) - py * Math.sin(a);
        const ez = z0 - (px * Math.sin(a) + py * Math.cos(a));
        expect(Math.abs(s.x - ex), `${o.id} x`).toBeLessThan(1e-6);
        expect(Math.abs(s.z - ez), `${o.id} z`).toBeLessThan(1e-6);
        for (const v of [s.x, s.z, s.w, s.d]) expect(Number.isFinite(v), o.id).toBe(true);
        expect(s.w, o.id).toBeGreaterThan(0);
        expect(s.d, o.id).toBeGreaterThan(0);
        expect(s.d, o.id).toBeLessThanOrEqual(CS.depth_max + 1e-9);
        expect(s.d, o.id).toBeLessThanOrEqual(Math.max(CS.depth_min, CS.depth_per_height * o.h) + 1e-9);
        checked++;
      }
    }
    expect(checked).toBe(shadows.length);
    clean(watch);
  });

  test('biome presentation, transitions and the end of the road', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const runtime = await (await page.request.get('/assets/topdown/layout.runtime.json')).json();
    const P = runtime.presentation;
    test.skip(!P, 'this checkout has no biome presentation yet');

    // every biome is where presentation says, away from the transitions
    const probe = await page.evaluate((zs) => zs.map((z) => window.__PROTO.presentationAt(z)),
      [-20, -200, -350, -480, -660]);
    expect(probe.map((p) => p.biome)).toEqual(P.biomes.map((b) => b.id));
    expect(probe.every((p) => p.overlay === 0 && p.blend === 0)).toBe(true);

    // at each anchor the overlay is at its peak, driven by camera z alone
    const overlay = page.locator('#biome-transition-overlay');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(await overlay.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect(await overlay.textContent()).toBe('');
    for (const t of P.transitions) {
      await page.evaluate((z) => window.__PROTO.go(z, 'обзор'), t.anchor_z);
      expect(Number(await overlay.evaluate((e) => e.style.opacity))).toBeCloseTo(t.dim.max, 3);
    }
    await page.evaluate(() => window.__PROTO.go(-20, 'обзор'));
    expect(Number(await overlay.evaluate((e) => e.style.opacity))).toBe(0);

    // the road stops at the final house: nothing a road-width past the end
    const end = runtime.road_end_z;
    const r = await page.evaluate((e) => [window.__PROTO.roadAt(e + 10), window.__PROTO.roadAt(e - 6),
      window.__PROTO.roadAt(e - 40)], end);
    expect(r[0].hw).toBeGreaterThan(3);
    expect(r[1].hw).toBe(0);
    expect(r[2].hw).toBe(0);
    clean(watch);
  });
});

/* ------------------------------------------------------------------- next */
test.describe('/next/', () => {
  test('desktop: live WebGL journey boots', async ({ page, watch }) => {
    const r = await page.goto('/next/');
    expect(r.status()).toBe(200);
    expect(await robots(page)).toContain('noindex');
    await page.waitForFunction(() => document.body.classList.contains('is-ready') && !!window.__J3,
                               null, { timeout: 120_000 });
    await expect(page.locator('body')).toHaveClass(/is-live/);
    expect(await page.evaluate(() => document.documentElement.dataset.firstFrame)).toBe('1');
    expect(await page.evaluate(() => !!(window.__J3.renderer && window.__J3.scene && window.__J3.camera)))
      .toBe(true);
    clean(watch);
  });

  for (const [name, opts] of [
    ['narrow viewport (<760px)', { viewport: { width: 600, height: 900 } }],
    ['prefers-reduced-motion', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }],
  ]) {
    test.describe(name, () => {
      test.use(opts);

      test('static fallback, no WebGL boot, content in the DOM', async ({ page, watch }) => {
        const chunks = [];
        page.on('request', (q) => { if (/\/assets\/world-[^/]+\.js$/.test(q.url())) chunks.push(q.url()); });
        await page.goto('/next/');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).toHaveClass(/is-static/);
        await expect(page.locator('body')).not.toHaveClass(/is-live/);
        expect(chunks, 'scene chunk must not load').toEqual([]);
        expect(await page.evaluate(() => typeof window.__J3)).toBe('undefined');
        await expect(page.locator('h1')).toHaveText(/\S/);
        await expect(page.locator('.stop')).toHaveCount(5);
        clean(watch);
      });

      test('KNOWN BUG: boot splash covers the static fallback forever', async ({ page }) => {
        // #boot is removed only by body.is-ready, which only the live branch
        // sets. In static mode the splash (fixed, z-index 9, opaque) stays on
        // top of the content. Runtime is out of scope for this batch.
        test.fail();
        await page.goto('/next/');
        await page.waitForLoadState('networkidle');
        const onTop = await page.evaluate(() => {
          const r = document.querySelector('h1').getBoundingClientRect();
          const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !!el && !!el.closest('h1');
        });
        expect(onTop, 'h1 is the topmost element at its own position').toBe(true);
      });
    });
  }
});

/* ------------------------------------------------------------ WebGL absent */
test.describe('no WebGL (--disable-3d-apis)', () => {
  let browser;
  test.beforeAll(async () => {
    browser = await chromium.launch({ args: [...LAUNCH.args, '--disable-3d-apis'] });
  });
  test.afterAll(async () => { await browser?.close(); });

  test('/next/ falls back to static', async ({ baseURL }) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await stubExternal(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(baseURL + '/next/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toHaveClass(/is-static/);
    expect(errors).toEqual([]);
  });

  test('KNOWN BUG: /proto/ has no fallback without WebGL', async ({ baseURL }) => {
    // The renderer is created at module load and throws; the HUD stays at
    // "загрузка…" and nothing else is shown.
    test.fail();
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(baseURL + '/proto/');
    await page.waitForLoadState('networkidle');
    expect(errors, 'no uncaught error without WebGL').toEqual([]);
  });
});

/* ------------------------------------------------------------------- full */
test.describe('/full/', () => {
  test('old full site: document loads, noindex', async ({ page, watch }) => {
    const r = await page.goto('/full/');
    expect(r.status()).toBe(200);
    await expect(page).toHaveTitle(/Fellmise/);
    expect(await robots(page)).toContain('noindex');
    expect(watch.pageErrors).toEqual([]);
    // Pre-existing: images under /full/assets/ do not exist (the page points
    // at its own folder, the pack lives in /assets/). Recorded, not failed —
    // /full/ is frozen reference material.
    test.info().annotations.push({ type: 'known-404', description: `${watch.http.length} × 404 under /full/` });
  });
});
