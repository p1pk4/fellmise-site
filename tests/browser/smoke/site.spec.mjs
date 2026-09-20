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
    const r = await page.goto('/proto/?debug=hud');    // the checks below read the debug HUD
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

  /* Content points: every word is in the HTML before any script; the script
     only sets how present each card is, as a function of the camera's z. */
  const contentSrc = () => JSON.parse(fs.readFileSync(
    path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'content_points.json'), 'utf8'));
  const contentCheckpoints = () => CONFIG.checkpoints.filter((c) => c.content);

  test('content: all copy is static HTML (JS off), both locales, headings', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await stubExternal(page);
    await page.goto(baseURL + '/proto/');
    const src = contentSrc();
    for (const loc of ['en', 'ru']) {
      const sec = page.locator(`section.content-locale[data-locale="${loc}"]`);
      await expect(sec).toHaveAttribute('lang', loc);
      await expect(sec.locator('h1')).toHaveCount(1);
      const arts = sec.locator('article.content-point');
      await expect(arts).toHaveCount(src.points.length);
      for (const p of src.points) {
        const a = sec.locator(`article[data-id="${p.id}"]`);
        await expect(a.locator('h2')).toHaveText(p[loc].title);
        await expect(a.locator('.content-point__body')).toHaveText(p[loc].body);
        await expect(a.locator('.content-point__kicker')).toHaveText(p[loc].kicker);
        expect(await a.getAttribute('aria-hidden')).toBeNull();
      }
    }
    // noindex stays: /proto/ is still a prototype route
    expect(await robots(page)).toContain('noindex');
    await ctx.close();
  });

  test('content: one card per anchor, none between, deterministic, nothing created', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const count = () => page.locator('article.content-point').count();
    const before = await count();
    const at = async (z, zoom = 'обзор') => {
      await page.evaluate(([zz, zm]) => window.__PROTO.go(zz, zm), [z, zoom]);
      return page.evaluate(() => window.__PROTO.content());
    };
    for (const c of contentCheckpoints()) {
      for (const zoom of ['обзор', 'близко']) {
        const s = await at(c.z, zoom);
        const on = s.points.filter((p) => p.weight > 0);
        expect(on.map((p) => p.id), `${c.id} ${zoom}`).toEqual([c.content]);
        expect(on[0].weight).toBe(1);
        expect(on[0].state).toBe('active');
        const op = await page.locator(`section[data-locale="en"] article[data-id="${c.content}"]`)
          .evaluate((el) => getComputedStyle(el).opacity);
        expect(Number(op)).toBe(1);
      }
      // the same z twice gives the same state
      expect(await at(c.z)).toEqual(await at(c.z));
    }
    // half-way between two points nothing is on screen
    const mid = await at(-100);
    expect(mid.points.every((p) => p.weight === 0)).toBe(true);
    // sweeping the whole route: never two cards at once
    for (let z = 20; z > -700; z -= 7) {
      const s = await at(z);
      expect(s.points.filter((p) => p.weight > 0).length, `z ${z}`).toBeLessThanOrEqual(1);
    }
    expect(await count()).toBe(before);
    clean(watch);
  });

  test('debug HUD: hidden by default, shown only with ?debug=hud', async ({ page, watch }) => {
    for (const [q, shown] of [['', false], ['?debug=hud', true], ['?debug=other', false]]) {
      await page.goto('/proto/' + q);
      await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
      if (shown) await expect(page.locator('#hud')).toBeVisible();
      else await expect(page.locator('#hud')).toBeHidden();
      // it is kept up to date either way; the hooks do not depend on it
      await expect(page.locator('#hud')).toContainText('зум:');
      expect(await page.evaluate(() => typeof window.__PROTO.content)).toBe('function');
    }
    clean(watch);
  });

  /* Zoom choreography: auto by default, frame = f(z), the same function as
     tools/camera_choreography.py (restated here from the JSON on purpose). */
  test('zoom: auto by default, frame is a pure function of z, focal objects whole', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const ch = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'camera_choreography.json'), 'utf8'));
    const cam = (z) => page.evaluate((zz) => window.__PROTO.camera(zz), z);
    expect((await page.evaluate(() => window.__PROTO.state.zoom))).toBe('auto');
    expect((await page.evaluate(() => window.__PROTO.camera())).frame).toBe(ch.overview);
    const focus = await page.evaluate(() => window.__PROTO.focus());
    expect(focus.map((f) => f.id)).toEqual(ch.focus.map((f) => f.id));
    const ss = (u) => { const x = Math.min(Math.max(u, 0), 1); return x * x * x * (x * (x * 6 - 15) + 10); };
    const expected = (z) => {
      let best = 0, fr = ch.overview;
      for (const f of focus) {
        const d = z - f.peak;
        const w = Math.abs(d) <= f.hold ? 1 : d > 0 ? ss(1 - (d - f.hold) / f.approach) : f.final ? 1 : ss(1 - (-d - f.hold) / f.exit);
        if (w > best) { best = w; fr = ch.overview - (ch.overview - f.frame) * w; }
      }
      return fr;
    };
    for (let z = 20; z > -710; z -= 3.7) {
      const c = await cam(z);
      expect(Math.abs(c.auto_frame - expected(z)), `z ${z}`).toBeLessThan(1e-9);
      expect(c.auto_frame).toBeGreaterThanOrEqual(ch.close);
      expect(c.auto_frame).toBeLessThanOrEqual(ch.overview);
    }
    // forward and back through the same z: the same frame, whatever came before
    for (const z of [-60, -200.2, -320, -658, -600]) {
      await page.evaluate((zz) => window.__PROTO.go(zz, 'auto'), z);
      const a = (await cam()).frame;
      await page.evaluate(() => window.__PROTO.go(-400, 'auto'));
      await page.evaluate((zz) => window.__PROTO.go(zz, 'auto'), z);
      expect((await cam()).frame).toBe(a);
    }
    // at each peak the focal sprite quad is inside the viewport (camera x = 0)
    const runtime = await (await page.request.get('/assets/topdown/layout.runtime.json')).json();
    const meta = (await (await page.request.get('/proto/sprite_contact.json')).json()).sprites;
    const vw = page.viewportSize().width, vh = page.viewportSize().height;
    const bio = Object.keys(runtime.biomes);
    for (const f of ch.focus) {
      const bi = bio.findIndex((b) => runtime.biomes[b].sprites.some((o) => o.id === f.anchor));
      const o = runtime.biomes[bio[bi]].sprites.find((x) => x.id === f.anchor);
      const aspect = await page.evaluate(async (src) => { const i = new Image(); i.src = '/' + src; await i.decode(); return i.width / i.height; }, meta[o.t].src);
      const peak = focus.find((x) => x.id === f.id).peak;
      await page.evaluate((zz) => window.__PROTO.go(zz, 'auto'), peak);
      const fr = (await cam()).frame;
      expect(fr).toBe(f.frame_height);
      const ppm = vh / fr, w = o.h * aspect, z = -bi * runtime.biome_spacing + o.pos[2];
      const m = Math.min(vw / 2 + (o.pos[0] - w / 2) * ppm, vw - (vw / 2 + (o.pos[0] + w / 2) * ppm),
                         vh / 2 + (z - o.h / 2 - peak) * ppm, vh - (vh / 2 + (z + o.h / 2 - peak) * ppm));
      expect(m, `${f.id} margin`).toBeGreaterThanOrEqual(f.biome === 'home' || f.biome === 'mine' ? 24 : 8);
    }
    // explicit modes stay diagnostic snapshots
    await page.evaluate(() => window.__PROTO.go(-658, 'overview'));
    expect((await cam()).frame).toBe(40);
    await page.evaluate(() => window.__PROTO.go(-658, 'close'));
    expect((await cam()).frame).toBe(16);
    expect(await page.evaluate(() => { try { window.__PROTO.go(0, 'zoomy'); return 'no'; } catch { return 'threw'; } })).toBe('threw');
    // content activation does not depend on zoom
    for (const c of contentCheckpoints()) {
      for (const zm of ['auto', 'overview', 'close']) {
        await page.evaluate(([zz, m]) => window.__PROTO.go(zz, m), [c.z, zm]);
        const on = (await page.evaluate(() => window.__PROTO.content())).points.filter((p) => p.weight > 0).map((p) => p.id);
        expect(on, `${c.id} ${zm}`).toEqual([c.content]);
      }
    }
    clean(watch);
  });

  test('zoom: the route ends at the final house; the wheel stops there, and goes back', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const ch = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'camera_choreography.json'), 'utf8'));
    const runtime = await (await page.request.get('/assets/topdown/layout.runtime.json')).json();
    const bio = Object.keys(runtime.biomes);
    const bi = bio.findIndex((b) => runtime.biomes[b].sprites.some((o) => o.id === ch.route_end.anchor));
    const house = runtime.biomes[bio[bi]].sprites.find((o) => o.id === ch.route_end.anchor);
    const houseZ = -bi * runtime.biome_spacing + house.pos[2];
    const end = await page.evaluate(() => window.__PROTO.state.routeEnd);
    expect(Math.abs(end - (houseZ + ch.route_end.offset))).toBeLessThan(1e-9);
    // scroll forward far past the end: the camera stops at route_end, in auto
    await page.evaluate((z) => window.__PROTO.go(z, 'auto'), end + 30);
    await page.mouse.move(640, 400);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.__PROTO.state.z)).toBe(end);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
    expect(await page.evaluate(() => window.__PROTO.state.z)).toBe(end);
    const cam = await page.evaluate(() => window.__PROTO.camera());
    expect(cam.frame).toBe(ch.focus[ch.focus.length - 1].frame_height);
    // the final house is whole inside the viewport at the stop
    const meta = (await (await page.request.get('/proto/sprite_contact.json')).json()).sprites;
    const aspect = await page.evaluate(async (src) => { const i = new Image(); i.src = '/' + src; await i.decode(); return i.width / i.height; }, meta[house.t].src);
    const vw = page.viewportSize().width, vh = page.viewportSize().height, ppm = vh / cam.frame, w = house.h * aspect;
    const m = Math.min(vw / 2 + (house.pos[0] - w / 2) * ppm, vw - (vw / 2 + (house.pos[0] + w / 2) * ppm),
                       vh / 2 + (houseZ - house.h / 2 - end) * ppm, vh - (vh / 2 + (houseZ + house.h / 2 - end) * ppm));
    expect(m).toBeGreaterThanOrEqual(24);
    expect(houseZ - end).toBeLessThanOrEqual(6);                 // not behind the house
    // backward scroll works from the stop
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -400);
    await expect.poll(() => page.evaluate(() => window.__PROTO.state.z)).toBeGreaterThan(end + 50);
    clean(watch);
  });

  test('finale: the last frame is the house alone — no card left over it', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    // the route ends inside the home card's range: its tail must be gone, not faint
    await page.evaluate(() => window.__PROTO.go(window.__PROTO.state.routeEnd));
    const seen = await page.evaluate(() => ({
      z: window.__PROTO.state.z,
      weights: window.__PROTO.content().points.map((p) => p.weight),
      opacity: [...document.querySelectorAll('#content-overlay .content-point, #keyart-overlay .key-art')]
        .map((e) => +getComputedStyle(e).opacity),
    }));
    expect(seen.z).toBeCloseTo(-661.974, 2);
    expect(seen.weights.every((w) => w === 0), `card weights at the route end: ${seen.weights}`).toBe(true);
    expect(seen.opacity.every((o) => o === 0), `opacities at the route end: ${seen.opacity}`).toBe(true);
    clean(watch);
  });

  test('key art: three windows in plain /proto/, lazy, loaded at peak, clear of cards', async ({ page, watch }) => {
    const art = [];
    page.on('response', (r) => { if (/\/assets\/keyart\/[^/]+\.webp$/.test(r.url())) art.push([r.url().split('/').pop(), r.status()]); });
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const plan = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'key_art.json'), 'utf8'));
    await expect(page.locator('#keyart-overlay figure.key-art')).toHaveCount(plan.slots.length);
    // lazy: at the start only what is within range + preload of the camera is requested
    const start = await page.evaluate(() => window.__PROTO.keyArt());
    for (const k of start) expect(k.requested, k.id).toBe(Math.abs(-20 - k.z) <= k.range + k.preload);
    expect(start.every((k) => k.weight === 0)).toBe(true);
    for (const s of plan.slots) {
      const k = start.find((x) => x.id === s.id);
      await page.evaluate((z) => window.__PROTO.go(z, 'auto'), k.z);
      await page.waitForFunction((id) => window.__PROTO.keyArt().find((x) => x.id === id).loaded, s.id, { timeout: 15000 });
      const now = await page.evaluate(() => window.__PROTO.keyArt());
      expect(now.filter((x) => x.weight > 0).map((x) => x.id), s.id).toEqual([s.id]);
      expect(now.find((x) => x.id === s.id).weight).toBe(1);
      const cards = (await page.evaluate(() => window.__PROTO.content())).points.filter((p) => p.weight > 0);
      expect(cards, `${s.id}: no card at the key art peak`).toEqual([]);
      expect((await page.evaluate(() => window.__PROTO.camera())).auto_weight).toBeLessThanOrEqual(0.05);
      const fig = page.locator(`figure.key-art[data-id="${s.id}"]`);
      const box = await fig.boundingBox();
      const vp = page.viewportSize();
      expect(Math.round(box.width)).toBe(480);
      expect(Math.round(box.height)).toBe(320);
      expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, s.id).toBe(true);
      expect(await fig.locator('img').getAttribute('alt')).toBe(s.alt.en);
    }
    expect(art.map(([n]) => n).sort()).toEqual(plan.slots.map((s) => s.src.split('/').pop()).sort());
    expect(art.every(([, st]) => st === 200)).toBe(true);
    clean(watch);
  });

  test('key art: the spirit picture is gone before the world ship enters the frame', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const runtime = await (await page.request.get('/assets/topdown/layout.runtime.json')).json();
    const meta = (await (await page.request.get('/proto/sprite_contact.json')).json()).sprites;
    const bio = Object.keys(runtime.biomes);
    const bi = bio.indexOf('spirit');
    const ship = runtime.biomes.spirit.sprites.find((o) => o.id === 'spirit/shipwreck/ship');
    const overrides = (await (await page.request.get('/proto/sprite_overrides.json')).json()).overrides;
    // lowest opaque row of the ship texture, measured in the page
    const low = await page.evaluate(async (src) => {
      const i = new Image(); i.src = '/' + src; await i.decode();
      const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const g = c.getContext('2d'); g.drawImage(i, 0, 0);
      const d = g.getImageData(0, 0, i.width, i.height).data;
      for (let y = i.height - 1; y >= 0; y--) for (let x = 0; x < i.width; x++) if (d[(y * i.width + x) * 4 + 3] > 16) return (y + 1) / i.height;
      return 1;
    }, overrides[ship.id] ? 'proto/' + overrides[ship.id].sprite : meta[ship.t].src);
    const zLow = -bi * runtime.biome_spacing + ship.pos[2] - ship.h / 2 + low * ship.h;
    const vh = page.viewportSize().height;
    let lastArt = null, firstShip = null;
    for (let z = -415; z >= -470; z -= 0.25) {
      await page.evaluate((zz) => window.__PROTO.go(zz, 'auto'), z);
      const [k, cam] = await page.evaluate(() => [window.__PROTO.keyArt().find((x) => x.id === 'spirit-afterlife'), window.__PROTO.camera()]);
      const shipRow = vh / 2 + (zLow - z) * (vh / cam.frame);          // screen y of the hull's lowest row
      const shipOn = shipRow > 0;
      expect(k.weight > 0 && shipOn, `z ${z}: art ${k.weight} with the world ship on screen`).toBe(false);
      if (k.weight > 0) lastArt = z;
      if (shipOn && firstShip === null) firstShip = z;
    }
    expect(lastArt - firstShip).toBeGreaterThanOrEqual(2);                // a few metres of plain world between
    expect((await page.evaluate(() => window.__PROTO.keyArt().find((x) => x.id === 'spirit-afterlife'))).z).toBeCloseTo(-440, 3);
    clean(watch);
  });

  test('world ghost ship: /proto/ draws the override for one object, legacy asset elsewhere', async ({ page, watch }) => {
    const got = [];
    page.on('response', (r) => { if (/feat_death_alt/.test(r.url())) got.push([r.url().replace(/^https?:\/\/[^/]+/, ''), r.status()]); });
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    expect(got.map(([u]) => u)).toEqual(['/proto/sprites_special/feat_death_alt_ghost.webp']);   // no wooden ship in /proto/
    expect(got[0][1]).toBe(200);
    const sh = await page.evaluate(() => window.__PROTO.shadows());
    const ship = sh.find((s) => s.id === 'spirit/shipwreck/ship');
    const runtime = await (await page.request.get('/assets/topdown/layout.runtime.json')).json();
    const base = runtime.presentation.contact_shadow.opacity;
    expect(Math.abs(ship.opacity - 0.25 * base)).toBeLessThan(1e-9);
    expect(ship.sprite).toBe('sprites_special/feat_death_alt_ghost.webp');
    const others = sh.filter((s) => s.id !== 'spirit/shipwreck/ship');
    expect(others.every((s) => Math.abs(s.opacity - base) < 1e-9 && s.sprite === null)).toBe(true);
    // legacy consumers still serve the original file, untouched
    const legacy = await page.request.get('/assets/feat_death_alt.webp');
    expect(legacy.status()).toBe(200);
    clean(watch);
  });

  test('key art: RU alt with ?lang=ru; ?debug=keyart outlines the same windows', async ({ page, watch }) => {
    const plan = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'key_art.json'), 'utf8'));
    await page.goto('/proto/?lang=ru');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    for (const s of plan.slots) expect(await page.locator(`figure.key-art[data-id="${s.id}"] img`).getAttribute('alt')).toBe(s.alt.ru);
    await page.goto('/proto/?debug=keyart');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    await expect(page.locator('figure.key-art.debug')).toHaveCount(plan.slots.length);
    await expect(page.locator('#hud')).toBeHidden();
    clean(watch);
  });

  test('zoom: the Z key is a debug tool only', async ({ page, watch }) => {
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    await page.keyboard.press('z');
    expect(await page.evaluate(() => window.__PROTO.state.zoom)).toBe('auto');
    await page.goto('/proto/?debug=hud');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('z');
      seen.push(await page.evaluate(() => window.__PROTO.state.zoom));
    }
    expect(seen).toEqual(['обзор', 'близко', 'auto']);
    await expect(page.locator('#hud')).toContainText('хореография: фокус');
    clean(watch);
  });

  test('content: locale is chosen by ?lang=, deterministically', async ({ page, watch }) => {
    for (const [q, want] of [['', 'en'], ['?lang=ru', 'ru'], ['?lang=xx', 'en']]) {
      await page.goto('/proto/' + q);
      await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
      expect((await page.evaluate(() => window.__PROTO.content())).locale).toBe(want);
      const hidden = await page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll('section.content-locale')].map((s) => [s.dataset.locale, s.hidden])));
      expect(hidden).toEqual({ en: want !== 'en', ru: want !== 'ru' });
    }
    clean(watch);
  });
});

/* ------------------------------------------------------------ proto modes */
/* One rule (proto/mode.js): live = desktop >= NARROW px, no reduced motion,
   WebGL2; everything else - and a failed live boot - is the static journey. */
const NARROW = 900;                                           // mirrors proto/mode.js
const MODE_MATRIX = [
  ['desktop 1280 WebGL', { viewport: { width: 1280, height: 800 } }, '', 'live', null],
  ['desktop 1280 ?static=1', { viewport: { width: 1280, height: 800 } }, '?static=1', 'static', 'forced'],
  ['desktop 1280 reduced motion', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }, '', 'static', 'reduced-motion'],
  ['mobile 390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, '', 'static', 'narrow'],
  ['mobile 430', { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true }, '', 'static', 'narrow'],
  ['tablet 768', { viewport: { width: 768, height: 1024 } }, '', 'static', 'narrow'],
  ['tablet 820', { viewport: { width: 820, height: 1180 } }, '', 'static', 'narrow'],
  ['tablet 834', { viewport: { width: 834, height: 1194 } }, '', 'static', 'narrow'],
  ['desktop 1024', { viewport: { width: 1024, height: 768 } }, '', 'live', null],
  [`width ${NARROW - 1}`, { viewport: { width: NARROW - 1, height: 900 } }, '', 'static', 'narrow'],
  [`width ${NARROW}`, { viewport: { width: NARROW, height: 900 } }, '', 'live', null],
];

test.describe('/proto/ modes', () => {
  for (const [name, opts, q, want, reason] of MODE_MATRIX) {
    test.describe(name, () => {
      test.use(opts);
      test(`${want}${reason ? ' (' + reason + ')' : ''}: boots, no overlay, no errors`, async ({ page, watch }) => {
        const reqs = [];
        page.on('request', (r) => reqs.push(r.url()));
        await page.goto('/proto/' + q);
        if (want === 'live') await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
        else await page.waitForLoadState('networkidle');
        const m = await page.evaluate(() => ({ mode: document.documentElement.dataset.mode, reason: document.documentElement.dataset.modeReason || null,
          cls: document.documentElement.className }));
        expect(m).toEqual({ mode: want, reason, cls: `mode-${want}` });
        await expect(page.locator('#hud')).toBeHidden();            // no loading text left on screen
        const world = reqs.filter((u) => /three\.module|layout\.runtime|sprites_stripped/.test(u));
        if (want === 'static') {
          expect(world, 'static loads no world').toEqual([]);
          // the journey is there, in route order, one locale, readable width
          const order = await page.evaluate(() => [...document.querySelectorAll('#journey article.content-point, #journey figure.key-art')]
            .filter((e) => e.offsetParent !== null).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
            .map((e) => e.dataset.id));
          expect(order).toEqual(['village-world', 'village-life', 'forest-skills', 'mine-mining', 'mine-work',
                                 'spirit-afterlife', 'spirit-death', 'home-home']);
          const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(ov, 'no horizontal overflow').toBeLessThanOrEqual(0);
          expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden');
          const fontPx = await page.locator('section.content-locale:not([hidden]) .content-point__body').first()
            .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
          expect(fontPx).toBeGreaterThanOrEqual(16);
          for (const f of await page.locator('figure.key-art').all()) {
            const box = await f.boundingBox();
            expect(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 0.5).toBe(true);
          }
        } else {
          expect(world.length).toBeGreaterThan(0);
        }
        clean(watch);
      });
    });
  }

  test('static: wheel scrolls the document, not a camera; images lazy with alt', async ({ page, watch }) => {
    await page.goto('/proto/?static=1');
    await page.waitForLoadState('networkidle');
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await page.evaluate(() => typeof window.__PROTO)).toBe('undefined');
    const plan = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'key_art.json'), 'utf8'));
    for (const s of plan.slots) {
      const img = page.locator(`figure.key-art[data-id="${s.id}"] img`);
      expect(await img.getAttribute('loading')).toBe('lazy');
      expect(await img.getAttribute('alt')).toBe(s.alt.en);
    }
    clean(watch);
  });

  test('static: RU with ?lang=ru, one locale in the accessibility tree', async ({ page, watch }) => {
    const plan = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'key_art.json'), 'utf8'));
    for (const [q, loc] of [['?static=1', 'en'], ['?static=1&lang=ru', 'ru']]) {
      await page.goto('/proto/' + q);
      await page.waitForLoadState('networkidle');
      const shown = await page.evaluate(() => [...document.querySelectorAll('section.content-locale')].filter((s) => !s.hidden).map((s) => s.dataset.locale));
      expect(shown).toEqual([loc]);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(loc);
      const h2 = await page.getByRole('heading', { level: 2 }).allTextContents();
      expect(h2.length).toBe(5);                                    // five points, not ten
      for (const s of plan.slots) expect(await page.locator(`figure.key-art[data-id="${s.id}"] img`).getAttribute('alt')).toBe(s.alt[loc]);
    }
    clean(watch);
  });

  test('static without JavaScript: all copy in the HTML, EN first', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await stubExternal(page);
    await page.goto(baseURL + '/proto/');
    const vis = await page.evaluate(() => [...document.querySelectorAll('section.content-locale')].map((s) => [s.dataset.locale, s.hidden]));
    expect(vis).toEqual([['en', false], ['ru', true]]);
    await expect(page.locator('section[data-locale="en"] h2')).toHaveCount(5);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ov).toBeLessThanOrEqual(0);
    // the three approved pictures are real images (the <noscript> twins), EN alt
    const plan = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'key_art.json'), 'utf8'));
    for (const s of plan.slots) {
      const img = page.locator(`figure.key-art[data-id="${s.id}"] img[src]`);
      await expect(img).toHaveCount(1);
      expect(await img.getAttribute('src')).toBe('../' + s.src);
      expect(await img.getAttribute('alt')).toBe(s.alt.en);
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth)).toBe(1536);
      await expect(page.locator(`figure.key-art[data-id="${s.id}"] img[data-src]`)).toBeHidden();
    }
    await ctx.close();
  });

  test('without JavaScript nothing of the world is requested', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    await stubExternal(page);
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    await page.goto(baseURL + '/proto/');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForLoadState('networkidle');
    expect(reqs.filter((u) => /three\.module|layout\.runtime|sprites_|sprite_contact|\/proto\/main\.js/.test(u))).toEqual([]);
    await ctx.close();
  });

  test('with JavaScript the <noscript> twins stay inert: one image per figure, lazy as before', async ({ page, watch }) => {
    const art = [];
    page.on('request', (r) => { if (/\/assets\/keyart\//.test(r.url())) art.push(r.url()); });
    for (const q of ['?static=1', '']) {
      await page.goto('/proto/' + q);
      if (q) await page.waitForLoadState('networkidle');
      else await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
      const imgs = await page.evaluate(() => [...document.querySelectorAll('figure.key-art')].map((f) => f.querySelectorAll('img').length));
      expect(imgs).toEqual([1, 1, 1]);
    }
    // live start: only the window within preload distance was requested
    const live = art.filter((u) => u.includes('keyart'));
    expect(live.length).toBeLessThanOrEqual(4);
    clean(watch);
  });

  test('a failed live boot turns into the static journey (error only in ?debug=hud)', async ({ page }) => {
    await page.route(/\/assets\/topdown\/layout\.runtime\.json$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"broken": true}' }));
    await page.goto('/proto/');
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'static', null, { timeout: 60000 });
    expect(await page.evaluate(() => document.documentElement.dataset.modeReason)).toBe('boot-failed');
    await expect(page.locator('#hud')).toBeHidden();
    expect(await page.locator('body > canvas').count()).toBe(0);
    await expect(page.locator('section[data-locale="en"] article.content-point').first()).toBeVisible();
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.goto('/proto/?debug=hud');
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'static', null, { timeout: 60000 });
    await expect(page.locator('#hud')).toBeVisible();
    await expect(page.locator('#hud')).toContainText('ошибка');
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

  test('/proto/ falls back to the static journey without WebGL', async ({ baseURL }) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await stubExternal(page);
    const errors = [], failed = [], reqs = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r) => failed.push(r.url()));
    page.on('request', (r) => reqs.push(r.url()));
    await page.goto(baseURL + '/proto/');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => [document.documentElement.dataset.mode, document.documentElement.dataset.modeReason]))
      .toEqual(['static', 'no-webgl']);
    await expect(page.locator('section.content-locale[data-locale="en"] article.content-point')).toHaveCount(5);
    await expect(page.locator('#hud')).toBeHidden();
    expect(reqs.filter((u) => /three\.module|layout\.runtime|sprites_stripped|sprite_contact/.test(u))).toEqual([]);
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
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
