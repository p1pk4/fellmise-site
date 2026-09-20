/* The journey at its production URLs: / (EN) and /ru/ (RU), with /proto/ kept as the preview.
 *
 * One engine: every document loads the runtime from /proto/ and the engine resolves its own
 * resources from its module URL, so the document's depth must not matter. These tests check
 * exactly that — the same world, the right locale, no copy of the engine, no wrong-root fetch —
 * plus what a crawler sees in the plain HTML of each route.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chromium } from '@playwright/test';
import { LAUNCH, stubExternal } from '../lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'checkpoints.json'), 'utf8'));
const READY = CONFIG.routes['/proto/'].ready;
const TIMEOUT = CONFIG.routes['/proto/'].readyTimeoutMs;
const SITE = 'https://fellmise.com';
/* a document must never pull engine files as if they sat next to it */
const WRONG_ROOT = /^\/(main\.js|audio\.js|mode\.js|boot\.js|sprite_contact\.json|sprite_overrides\.json|fallback\.css|sprites_stripped\/|sprites_special\/|vendor\/|tile_)|^\/ru\/(main\.js|mode\.js|boot\.js|sprite|sprites|vendor|tile_|fallback\.css)/;

const test = base.extend({
  watch: [async ({ page, baseURL }, use) => {
    const w = { errors: [], failed: [], req: [] };
    await stubExternal(page);
    page.on('pageerror', (e) => w.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') w.errors.push(m.text()); });
    page.on('request', (r) => { if (r.url().startsWith(baseURL)) w.req.push(new URL(r.url()).pathname); });
    page.on('requestfailed', (r) => { if (r.url().startsWith(baseURL)) w.failed.push(r.url()); });
    page.on('response', (r) => { if (r.url().startsWith(baseURL) && r.status() >= 400) w.failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await use(w);
  }, { auto: true }],
});
const clean = (w) => {
  expect(w.errors, 'console / page errors').toEqual([]);
  expect(w.failed, 'failed requests').toEqual([]);
  expect(w.req.filter((u) => WRONG_ROOT.test(u)), 'engine fetched relative to the document').toEqual([]);
};
const live = (page) => page.waitForFunction(READY, null, { timeout: TIMEOUT });

test.describe('production routes', () => {
  for (const [route, lang, other, label, title] of [['/', 'en', 'ru', 'Sound', 'A world that plays itself'],
    ['/ru/', 'ru', 'en', 'Звук', 'Мир играет сам']]) {
    test(`${route} live: one locale (${lang}), the engine from /proto/, the world of the preview`, async ({ page, watch }) => {
      await page.goto(route);
      await live(page);
      const d = await page.evaluate(() => ({
        mode: document.documentElement.dataset.mode, lang: document.documentElement.lang,
        locales: [...document.querySelectorAll('.content-locale')].map((s) => s.dataset.locale),
        cards: [...document.querySelectorAll('.content-point__title')].map((e) => e.textContent.trim()),
        biomes: window.__PROTO.state.biomes, done: window.__PROTO.state.done,
        canonical: document.querySelector('link[rel=canonical]').href,
        robots: document.querySelector('meta[name=robots]'),
      }));
      expect([d.mode, d.lang, d.locales, d.biomes, d.done]).toEqual(['live', lang, [lang], 5, true]);
      expect(d.cards[0]).toBe(title);
      expect(d.canonical).toBe(`${SITE}${route}`);
      expect(d.robots, 'a production page must not be noindex').toBeNull();
      await expect(page.locator('button.audio-toggle')).toHaveAttribute('aria-label', label);
      // the runtime came from /proto/, and nothing was duplicated next to the document
      expect(watch.req.filter((u) => /\/(main|audio|boot|mode)\.js$/.test(u)).every((u) => u.startsWith('/proto/'))).toBe(true);
      expect(new Set(watch.req.filter((u) => u.includes('/keyart/'))).size)
        .toBe(watch.req.filter((u) => u.includes('/keyart/')).length);           // no duplicate art requests
      clean(watch);
    });

    test(`${route} static (390): the same journey in ${lang}, silent, no world`, async ({ page, watch }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const d = await page.evaluate(() => ({
        mode: document.documentElement.dataset.mode, lang: document.documentElement.lang,
        h2: [...document.querySelectorAll('.content-locale:not([hidden]) h2')].length,
        art: [...document.querySelectorAll('figure.key-art img[src]')].length,
        toggle: document.querySelectorAll('.audio-toggle').length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      expect([d.mode, d.lang, d.h2, d.toggle]).toEqual(['static', lang, 5, 0]);
      expect(d.overflowX).toBeLessThanOrEqual(0);
      expect(watch.req.filter((u) => /three\.module|layout\.runtime|sprites_stripped|\/assets\/audio\//.test(u))).toEqual([]);
      clean(watch);
    });

    test(`${route} without JavaScript: ${lang} copy and the three pictures are in the HTML`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 430, height: 932 } });
      const p = await ctx.newPage();
      await stubExternal(p);
      const req = [];
      p.on('request', (r) => req.push(new URL(r.url()).pathname));
      await p.goto(baseURL + route);
      await p.waitForLoadState('networkidle');
      const d = await p.evaluate(() => ({
        lang: document.documentElement.lang,
        h2: [...document.querySelectorAll('section.content-locale h2')].map((h) => h.textContent.trim()),
        imgs: [...document.querySelectorAll('figure.key-art noscript')].length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      expect(d.lang, 'the document language must match the copy it shows').toBe(lang);
      expect(d.h2.length).toBe(5);
      expect(d.h2[0]).toBe(title);
      expect(d.imgs).toBe(3);
      expect(d.overflowX).toBeLessThanOrEqual(0);
      expect(req.filter((u) => /three\.module|layout\.runtime|sprites_stripped/.test(u))).toEqual([]);
      await ctx.close();
    });
  }

  test('/ and /ru/ serve one locale each — the other language is not in the HTML', async ({ request }) => {
    const en = await (await request.get('/')).text();
    const ru = await (await request.get('/ru/')).text();
    expect(en).toContain('data-locale="en"');
    expect(en).not.toContain('data-locale="ru"');
    expect(ru).toContain('data-locale="ru"');
    expect(ru).not.toContain('data-locale="en"');
    expect(en).toContain('A world that plays itself');
    expect(en).not.toContain('Мир играет сам');
    expect(ru).toContain('Мир играет сам');
    expect(ru).not.toContain('A world that plays itself');
  });

  test('crawler view: canonical, hreflang, OG, Twitter and JSON-LD per route', async ({ request }) => {
    for (const [route, lang, canonical, ogLocale, noindex] of [['/', 'en', `${SITE}/`, 'en_US', false],
      ['/ru/', 'ru', `${SITE}/ru/`, 'ru_RU', false], ['/proto/', 'en', `${SITE}/`, 'en_US', true]]) {
      const r = await request.get(route);
      expect(r.status()).toBe(200);
      const html = await r.text();
      expect(html, route).toContain(`<html lang="${lang}">`);
      expect(html, route).toContain(`<link rel="canonical" href="${canonical}">`);
      for (const h of [`hreflang="en" href="${SITE}/"`, `hreflang="ru" href="${SITE}/ru/"`, `hreflang="x-default" href="${SITE}/"`]) {
        expect(html, route).toContain(h);
      }
      expect(html, route).toContain(`<meta property="og:locale" content="${ogLocale}">`);
      expect(html, route).toContain('twitter:card');
      expect((html.match(/<script type="application\/ld\+json">/g) || []).length, route).toBe(3);
      expect(/<meta name="robots" content="noindex/.test(html), `${route} noindex`).toBe(noindex);
      expect((html.match(/<noscript><img src="\/assets\/keyart\//g) || []).length, route).toBe(3);
    }
  });

  test('/proto/ stays a working preview: both locales, ?lang=ru, noindex, canonical to the root', async ({ page, watch }) => {
    await page.goto('/proto/');
    await live(page);
    expect(await page.evaluate(() => [...document.querySelectorAll('.content-locale')].map((s) => s.dataset.locale))).toEqual(['en', 'ru']);
    expect(await page.evaluate(() => document.querySelector('link[rel=canonical]').href)).toBe(`${SITE}/`);
    await expect(page.locator('button.audio-toggle')).toHaveAttribute('aria-label', 'Sound');
    await page.goto('/proto/?lang=ru');
    await live(page);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru');
    await expect(page.locator('button.audio-toggle')).toHaveAttribute('aria-label', 'Звук');
    expect(await page.evaluate(() => document.querySelector('.content-locale[data-locale="en"]').hidden)).toBe(true);
    clean(watch);
  });

  test('the same spectral ship from every document, and audio only after the toggle', async ({ page, watch }) => {
    for (const route of ['/', '/ru/', '/proto/']) {
      await page.goto(route);
      await live(page);
      await page.evaluate(() => window.__PROTO.go(-456, 'auto'));
      await page.waitForTimeout(300);
      expect(watch.req.filter((u) => u.includes('sprites_special')).every((u) => u.startsWith('/proto/')), route).toBe(true);
      expect(watch.req.filter((u) => /feat_death_alt\.webp$/.test(u)), `${route}: legacy wooden ship`).toEqual([]);
      expect(watch.req.filter((u) => /\/assets\/audio\/|audio\.json/.test(u)), `${route}: audio while muted`).toEqual([]);
      watch.req.length = 0;
    }
    clean(watch);
  });

  test('sound from a production document: config and files resolve from /assets/, not from the page', async ({ page, watch }) => {
    await page.goto('/ru/');
    await live(page);
    await page.evaluate(() => window.__PROTO.go(-20));
    await page.locator('button.audio-toggle').click();
    await page.waitForFunction(() => window.__PROTO.audio().playing.includes('village'), null, { timeout: 30000 });
    const s = await page.evaluate(() => window.__PROTO.audio());
    expect(s.codec).toBe('audio/webm; codecs=opus');
    expect(s.requested.map((u) => u.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, ''))).toEqual([
      'assets/topdown/audio.json', 'assets/audio/ambient/village.webm']);
    clean(watch);
  });
});
