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

  test('key art planning: nothing in production, placeholders only with ?debug=keyart', async ({ page, watch }) => {
    const plans = [];
    page.on('request', (r) => { if (/key_art\.json/.test(r.url())) plans.push(r.url()); });
    await page.goto('/proto/');
    await page.waitForFunction(PROTO_READY, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
    expect(plans).toEqual([]);
    await expect(page.locator('#keyart-review, .keyart-slot')).toHaveCount(0);
    expect(await page.evaluate(() => window.__PROTO.keyArt())).toEqual([]);

    await page.goto('/proto/?debug=keyart');
    await page.waitForFunction(() => window.__PROTO?.state.done && window.__PROTO.keyArt().length > 0, null, { timeout: 120000 });
    const plan = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'key_art.json'), 'utf8'));
    const slots = await page.evaluate(() => window.__PROTO.keyArt());
    expect(slots.map((s) => s.id)).toEqual(plan.slots.map((s) => s.id));
    await expect(page.locator('.keyart-slot')).toHaveCount(plan.slots.length);
    await expect(page.locator('#hud')).toBeHidden();
    for (const s of slots) {
      await page.evaluate((z) => window.__PROTO.go(z, 'auto'), s.z);
      const on = (await page.evaluate(() => window.__PROTO.keyArt())).filter((k) => k.weight > 0);
      expect(on.map((k) => k.id)).toEqual([s.id]);
      expect(on[0].weight).toBe(1);
      const cards = (await page.evaluate(() => window.__PROTO.content())).points.filter((p) => p.weight > 0);
      expect(cards, `${s.id}: no card at the key art peak`).toEqual([]);
      expect((await page.evaluate(() => window.__PROTO.camera())).auto_weight).toBe(0);
      const box = await page.locator(`.keyart-slot[data-id="${s.id}"]`).boundingBox();
      const vp = page.viewportSize();
      expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height).toBe(true);
    }
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
