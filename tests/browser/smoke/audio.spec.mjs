/* /proto/ sound (proto/audio.js + assets/topdown/audio.json).
 *
 * Muted by default; nothing is requested or created until the visitor turns
 * the toggle on; a stored "on" comes back only with the next gesture (a
 * scroll is not one). Levels are a pure function of the camera's z through
 * the ground's own biome blend; a transition SFX fires crossing its anchor
 * down the route, once, re-armed only 8 m back above it. Static modes have
 * no sound and no toggle. These are the engine's rules, checked with short
 * synthetic tones (lib/audio_fixture.mjs); the production files are tested
 * in audio-assets.spec.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';
import { AUDIO_CONFIG, routeLiveAudio, isAudioUrl } from '../lib/audio_fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'checkpoints.json'), 'utf8'));
const READY = CONFIG.routes['/proto/'].ready;
const TIMEOUT = CONFIG.routes['/proto/'].readyTimeoutMs;
const LAYOUT = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'layout.runtime.json'), 'utf8'));
const PRES = LAYOUT.presentation;
const REARM = 8;                                         // mirrors SFX_REARM_M in proto/audio.js

const test = base.extend({
  watch: [async ({ page, baseURL }, use) => {
    const w = { errors: [], failed: [], audio: [] };
    await stubExternal(page);
    page.on('pageerror', (e) => w.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') w.errors.push(m.text()); });
    page.on('requestfailed', (r) => { if (r.url().startsWith(baseURL)) w.failed.push(r.url()); });
    page.on('response', (r) => { if (r.url().startsWith(baseURL) && r.status() >= 400) w.failed.push(`${r.status()} ${r.url()}`); });
    page.on('request', (r) => { if (isAudioUrl(r.url())) w.audio.push(new URL(r.url()).pathname); });
    await use(w);
  }, { auto: true }],
});
const clean = (w) => { expect(w.errors, 'console / page errors').toEqual([]); expect(w.failed, 'failed requests').toEqual([]); };
const open = async (page, q = '') => { await page.goto('/proto/' + q); await page.waitForFunction(READY, null, { timeout: TIMEOUT }); };
const A = (page) => page.evaluate(() => window.__PROTO.audio());
const go = (page, z) => page.evaluate((zz) => window.__PROTO.go(zz), z);
const toggle = (page) => page.locator('button.audio-toggle');

test.describe('/proto/ audio', () => {
  test('muted by default: toggle off, no context, nothing requested through the whole route', async ({ page, watch }) => {
    await open(page);
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    let s = await A(page);
    expect([s.enabled, s.context, s.unlocked, s.requested]).toEqual([false, 'none', false, []]);
    // wheel the whole route, click the world, press keys: still silent, still nothing fetched
    await page.mouse.move(640, 400);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 1000);
    await page.mouse.click(640, 400);
    await page.keyboard.press('ArrowDown');
    s = await A(page);
    expect([s.enabled, s.context, s.requested]).toEqual([false, 'none', []]);
    expect(watch.audio, 'no audio request while muted').toEqual([]);
    clean(watch);
  });

  test('enable: the toggle (a user gesture) creates and runs the context; mute releases it', async ({ page, watch }) => {
    const seen = await routeLiveAudio(page);
    await open(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await A(page)).playing).toEqual(['village']);
    let s = await A(page);
    expect([s.enabled, s.context, s.unlocked]).toEqual([true, 'running', true]);
    // at the start of the route: the config and the village ambient only
    expect(seen).toEqual(['/assets/topdown/audio.json', '/' + AUDIO_CONFIG.biomes[0].sources[0].src]);   // WebM chosen
    expect(await page.evaluate(() => localStorage.getItem('fellmise.audio.enabled'))).toBe('true');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await A(page)).context, { timeout: 5000 }).toBe('suspended');
    s = await A(page);
    expect([s.enabled, s.playing]).toEqual([false, []]);
    expect(await page.evaluate(() => localStorage.getItem('fellmise.audio.enabled'))).toBe('false');
    clean(watch);
  });

  test('persistence: a stored "on" waits for a gesture; a scroll is not one', async ({ page, watch }) => {
    await routeLiveAudio(page);
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('fellmise.audio.enabled', 'true'); sessionStorage.setItem('seeded', '1'); } } catch (e) {} });
    await open(page);
    let s = await A(page);
    expect([s.enabled, s.pendingRestore, s.context]).toEqual([false, true, 'none']);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 400);
    s = await A(page);
    expect([s.enabled, s.context], 'scroll does not unlock').toEqual([false, 'none']);
    await page.mouse.click(640, 400);                     // the next real gesture restores it
    await expect.poll(async () => (await A(page)).enabled).toBe(true);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect((await A(page)).context).toBe('running');
    // stored "off" (or nothing): a gesture changes nothing
    await toggle(page).click();
    await page.reload();
    await page.waitForFunction(READY, null, { timeout: TIMEOUT });
    await page.mouse.click(640, 400);
    s = await A(page);
    expect([s.enabled, s.pendingRestore, s.context]).toEqual([false, false, 'none']);
    clean(watch);
  });

  test('storage unavailable: muted, no errors', async ({ page, watch }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
    });
    await open(page);
    await page.mouse.click(640, 400);
    const s = await A(page);
    expect([s.enabled, s.pendingRestore, s.context]).toEqual([false, false, 'none']);
    clean(watch);
  });

  test('biome weights: the ground blend of the same z, forward and back identical', async ({ page, watch }) => {
    await open(page);
    const ids = PRES.biomes.map((b) => b.id);
    const zs = [];
    for (let z = 10; z >= -662; z -= 7) zs.push(z);
    for (const t of PRES.transitions) zs.push(t.anchor_z, t.blend_z[0], t.blend_z[1]);
    const fwd = {};
    for (const z of zs) {
      const [w, p] = await page.evaluate((zz) => [window.__PROTO.audio(zz), window.__PROTO.presentationAt(zz)], z);
      expect(Object.keys(w)).toEqual(ids);
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 3);
      // the ground: biome A with blend f towards B  <=>  ambient A = 1 - f, B = f
      expect(w[p.biome]).toBeCloseTo(1 - p.blend, 2);
      if (p.neighbour) expect(w[p.neighbour]).toBeCloseTo(p.blend, 2);
      expect(Object.values(w).filter((v) => v > 0).length).toBeLessThanOrEqual(2);
      fwd[z] = w;
    }
    // walk the camera down and back up: the state is the same at every z
    for (const z of zs) { await go(page, z); expect((await A(page)).weights).toEqual(fwd[z]); }
    for (const z of [...zs].reverse()) { await go(page, z); expect((await A(page)).weights).toEqual(fwd[z]); }
    // at an anchor both sides sound (the crossfade is the ground's blend band,
    // not centred on the anchor); outside the bands one ambient is pure
    for (const t of PRES.transitions) {
      const w = fwd[t.anchor_z];
      expect(w[t.from] + w[t.to]).toBeCloseTo(1, 3);
      expect(Math.min(w[t.from], w[t.to])).toBeGreaterThan(0.05);
      expect(fwd[t.blend_z[0]][t.from]).toBe(1);
      expect(fwd[t.blend_z[1]][t.to]).toBe(1);
    }
    for (const [z, id] of [[-20, 'village'], [-200, 'forest'], [-340, 'mine'], [-480, 'spirit'], [-640, 'home']]) {
      expect(fwd[z] ? fwd[z][id] : (await page.evaluate((zz) => window.__PROTO.audio(zz), z))[id]).toBe(1);
    }
    clean(watch);
  });

  test('transition SFX: down the route only, once per crossing, re-armed 8 m back', async ({ page, watch }) => {
    const seen = await routeLiveAudio(page);
    await open(page);
    await toggle(page).click();
    await expect.poll(async () => (await A(page)).context).toBe('running');
    const t = PRES.transitions[0], a = t.anchor_z;
    await go(page, a + 4); await go(page, a - 4);                        // cross down
    let s = await A(page);
    expect([s.sfxCount, s.lastSfx.id]).toEqual([1, 'village-forest']);
    await expect.poll(() => seen.includes('/' + AUDIO_CONFIG.transitions[0].sources[0].src)).toBe(true);
    for (let i = 0; i < 10; i++) { await go(page, a + 3); await go(page, a - 3); }   // wheel jitter at the anchor
    await go(page, a + 4);                                               // back up: silent
    expect((await A(page)).sfxCount).toBe(1);
    await go(page, a + REARM + 0.5); await go(page, a - 1);             // really back: re-armed
    expect((await A(page)).sfxCount).toBe(2);
    // a jump over several anchors: each crossed one, in route order, once
    await go(page, 0); await go(page, PRES.transitions[3].anchor_z - 5);
    s = await A(page);
    expect(s.sfxCount).toBe(6);
    expect(s.lastSfx.id).toBe('spirit-home');
    // walking back up the whole route plays nothing
    await go(page, 0);
    expect((await A(page)).sfxCount).toBe(6);
    clean(watch);
  });

  test('toggle: labels EN/RU, keyboard, focus ring, bottom-right clear of cards and key art', async ({ page, watch }) => {
    await open(page);
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Sound');
    const box = await toggle(page).boundingBox();
    expect(box.width).toBe(36);
    expect(box.x + box.width).toBeCloseTo(1280 - 16, 0);
    expect(box.y + box.height).toBeCloseTo(800 - 16, 0);
    // no card or picture window reaches the corner, at any content / key-art peak
    for (const z of [-40, -72, -172, -319, -335, -440, -508, -644]) {
      await go(page, z);
      const hit = await page.evaluate(() => {
        const b = document.querySelector('.audio-toggle').getBoundingClientRect();
        return [...document.querySelectorAll('.content-point, .key-art')].filter((e) => getComputedStyle(e).opacity > 0.01 && !e.closest('[hidden]'))
          .map((e) => e.getBoundingClientRect()).some((r) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
      });
      expect(hit, `overlap at z ${z}`).toBe(false);
    }
    // keyboard: Tab reaches it, focus is visible, Enter and Space toggle it
    let n = 0;
    while (!(await toggle(page).evaluate((b) => b === document.activeElement)) && n++ < 20) await page.keyboard.press('Tab');
    expect(await toggle(page).evaluate((b) => b.matches(':focus-visible') && getComputedStyle(b).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await open(page, '?lang=ru');
    await expect(toggle(page)).toHaveAttribute('aria-label', 'Звук');
    await expect(page.getByRole('button', { name: 'Звук' })).toHaveCount(1);
    clean(watch);
  });

  test('?debug=hud shows the sound state', async ({ page, watch }) => {
    await open(page, '?debug=hud');
    await go(page, PRES.transitions[1].anchor_z + 2);
    await go(page, PRES.transitions[1].anchor_z - 2);
    await expect(page.locator('#hud')).toContainText('звук: выкл');
    await expect(page.locator('#hud')).toContainText('контекст none');
    await expect(page.locator('#hud')).toContainText(/эмбиент: forest 0\.\d\d, mine 0\.\d\d/);
    await expect(page.locator('#hud')).toContainText('SFX: forest-mine');
    clean(watch);
  });

  for (const [name, opts, q] of [['?static=1', {}, '?static=1'], ['reduced motion', { reducedMotion: 'reduce' }, ''],
    ['mobile 390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, '']]) {
    test.describe(`static: ${name}`, () => {
      test.use(opts);
      test('no toggle, no sound, nothing requested', async ({ page, watch }) => {
        await page.addInitScript(() => { try { localStorage.setItem('fellmise.audio.enabled', 'true'); } catch (e) {} });
        await page.goto('/proto/' + q);
        await page.waitForLoadState('networkidle');
        expect(await page.evaluate(() => document.documentElement.dataset.mode)).toBe('static');
        if (opts.isMobile) await page.tap('body'); else await page.mouse.click(10, 10);
        await page.waitForLoadState('networkidle');
        expect(await page.locator('.audio-toggle').count()).toBe(0);
        expect(await page.evaluate(() => typeof window.__PROTO)).toBe('undefined');
        expect(watch.audio).toEqual([]);
        clean(watch);
      });
    });
  }
});
