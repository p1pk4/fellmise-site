/* /proto/ sound with the PRODUCTION files (assets/audio/**, assets/topdown/audio.json all live).
 *
 * No synthetic fixtures here: the real engine loads the real files. Covers the
 * files themselves (decode, lengths, seamless loops in both formats), the
 * request budget (muted = nothing; on = config + the files needed now, one
 * format only), the codec choice (WebM/Opus -> M4A/AAC -> none, by capability
 * and by decode failure), persistence, real crossfades with real transition SFX,
 * and silence in the static modes.
 *
 * Not covered: a physical Safari / iOS device (not available to CI). The AAC path
 * is exercised in Chromium by making canPlayType deny WebM/Opus.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chromium } from '@playwright/test';
import { LAUNCH, stubExternal } from '../lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'checkpoints.json'), 'utf8'));
const READY = CONFIG.routes['/proto/'].ready;
const TIMEOUT = CONFIG.routes['/proto/'].readyTimeoutMs;
const AUDIO = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'topdown', 'audio.json'), 'utf8'));
const PRES = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'topdown', 'layout.runtime.json'), 'utf8')).presentation;
const ENTRIES = [...AUDIO.biomes, ...AUDIO.transitions];
const WEBM = 'audio/webm; codecs=opus', AAC = 'audio/mp4; codecs=mp4a.40.2';
const isAudio = (u) => /\/assets\/audio\/|\/assets\/topdown\/audio\.json$/.test(u);

const test = base.extend({
  watch: [async ({ page, baseURL }, use) => {
    const w = { errors: [], failed: [], audio: [], bytes: 0 };
    await stubExternal(page);
    page.on('pageerror', (e) => w.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') w.errors.push(m.text()); });
    page.on('requestfailed', (r) => { if (r.url().startsWith(baseURL)) w.failed.push(r.url()); });
    page.on('response', async (r) => {
      if (!r.url().startsWith(baseURL)) return;
      if (r.status() >= 400) w.failed.push(`${r.status()} ${r.url()}`);
      if (isAudio(r.url())) {
        w.audio.push(new URL(r.url()).pathname);
        try { w.bytes += (await r.body()).length; } catch (e) { /* aborted */ }
      }
    });
    await use(w);
  }, { auto: true }],
});
const clean = (w) => { expect(w.errors, 'console / page errors').toEqual([]); expect(w.failed, 'failed requests').toEqual([]); };
const open = async (page, q = '') => { await page.goto('/proto/' + q); await page.waitForFunction(READY, null, { timeout: TIMEOUT }); };
const A = (page) => page.evaluate(() => {
  const s = window.__PROTO.audio();
  // the engine resolves its URLs from its module: report repo-relative paths
  return { ...s, requested: s.requested.map((u) => u.replace(/^https?:\/\/[^/]+\//, '').replace(/^(\.\.\/)+/, '').replace(/^\/+/, '')) };
});
const go = (page, z) => page.evaluate((zz) => window.__PROTO.go(zz), z);
const toggle = (page) => page.locator('button.audio-toggle');
/* walk the camera like a visitor (steps of 2 m at ~5 m/s) */
async function walk(page, from, to, stepM = 2, msPerStep = 400) {
  const dir = Math.sign(to - from);
  for (let z = from; dir * (to - z) > 0; z += dir * stepM) { await go(page, z); await page.waitForTimeout(msPerStep); }
  await go(page, to);
}

/* canPlayType policy injected before the page scripts: 'all' | 'no-webm' | 'none' */
const CODEC = (p) => {
  const orig = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (t) {
    if (p === 'none') return '';
    if (p === 'no-webm' && /webm|opus/.test(t)) return '';
    return orig.call(this, t);
  };
};

/* decode the file in the page, return length + the wrap check computed on the buffer */
async function decodeInPage(page, url) {
  return page.evaluate(async (u) => {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const buf = await ctx.decodeAudioData(await (await fetch(u)).arrayBuffer());
    const n = buf.length, sr = buf.sampleRate, out = { length: n, sampleRate: sr, channels: buf.numberOfChannels };
    // loop wrap: the step from the last sample to the first vs the 99.9th percentile
    // of in-buffer steps; level (dB) and L/R balance of the last vs the first 250 ms
    const ch = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
    const steps = [];
    for (let i = 1; i < n; i += 7) steps.push(Math.max(...ch.map((c) => Math.abs(c[i] - c[i - 1]))));
    steps.sort((a, b) => a - b);
    const p999 = steps[Math.floor(steps.length * 0.999)] || 1e-9;
    out.wrapJump = Math.max(...ch.map((c) => Math.abs(c[0] - c[n - 1]))) / p999;
    const q = Math.floor(sr / 4);
    const rms = (c, a, b) => { let s = 0; for (let i = a; i < b; i++) s += c[i] * c[i]; return Math.sqrt(s / (b - a)) + 1e-12; };
    const db = (x) => 20 * Math.log10(x);
    out.levelStepDb = db(rms(ch[0], n - q, n)) - db(rms(ch[0], 0, q));
    if (ch.length === 2) {
      out.stereoStepDb = (db(rms(ch[0], n - q, n)) - db(rms(ch[1], n - q, n))) - (db(rms(ch[0], 0, q)) - db(rms(ch[1], 0, q)));
    }
    // click detector: high-passed energy (first difference) in 5 ms around the wrap
    // vs the 99.9th percentile of the same 5 ms windows over the whole buffer
    const w = Math.floor(sr * 0.005), win = [];
    const hpE = (c, a) => { let s = 0; for (let i = a; i < a + w; i++) { const j = (i + n) % n, k = (i - 1 + n) % n; const d = c[j] - c[k]; s += d * d; } return s; };
    for (let a = 0; a + w < n; a += w) win.push(hpE(ch[0], a));
    win.sort((a, b) => a - b);
    out.wrapClick = hpE(ch[0], -Math.floor(w / 2)) / (win[Math.floor(win.length * 0.999)] || 1e-12);
    return out;
  }, url);
}

test.describe('/proto/ production audio', () => {
  test('files: 9 live entries, both formats, decode, exact lengths, seamless ambient loops', async ({ page, watch }) => {
    test.setTimeout(240_000);
    expect(ENTRIES.map((e) => e.status)).toEqual(Array(9).fill('live'));
    await page.goto('/robots.txt');
    const report = {};
    for (const e of ENTRIES) {
      const ambient = !('from' in e);
      expect(e.sources.map((s) => s.type)).toEqual([WEBM, AAC]);
      for (const s of e.sources) {
        const r = await decodeInPage(page, '/' + s.src);
        report[s.src] = r;
        expect(r.sampleRate).toBe(48000);
        expect(r.channels).toBe(ambient ? 2 : 1);
        if (ambient) {
          // WebM: the 60 s loop; AAC: the loop twice (1024-sample frames do not divide 60 s)
          expect(r.length, s.src).toBe(s.type === WEBM ? 2_880_000 : 5_760_000);
          expect(r.wrapJump, `${s.src} sample step at the wrap`).toBeLessThan(1);
          expect(r.wrapClick, `${s.src} click energy at the wrap`).toBeLessThan(1);
          expect(Math.abs(r.levelStepDb), `${s.src} level step`).toBeLessThan(3);
          expect(Math.abs(r.stereoStepDb), `${s.src} stereo step`).toBeLessThan(2);
        } else {
          expect(r.length / 48000, s.src).toBeGreaterThan(1.5);
          expect(r.length / 48000, s.src).toBeLessThan(3.6);
        }
      }
    }
    // the two formats of each SFX are the same length (to the sample)
    for (const t of AUDIO.transitions) expect(report[t.sources[0].src].length).toBe(report[t.sources[1].src].length);
    fs.mkdirSync(path.join(ROOT, 'out', 'audio-integration'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'out', 'audio-integration', 'decode-report.json'), JSON.stringify(report, null, 1));
    clean(watch);
  });

  test('muted: the whole route with real config requests no audio at all', async ({ page, watch }) => {
    await open(page);
    await page.mouse.move(640, 400);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 1000);
    await page.mouse.click(640, 400);
    const s = await A(page);
    expect([s.enabled, s.context, s.requested, s.codec]).toEqual([false, 'none', [], null]);
    expect(watch.audio).toEqual([]);
    clean(watch);
  });

  test('first enable: config + village (WebM only), village plays; next ambient and SFX preload ahead', async ({ page, watch }) => {
    await open(page);
    await go(page, -20);
    await toggle(page).click();
    await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toEqual(['village']);
    let s = await A(page);
    expect(s.codec).toBe(WEBM);
    expect(watch.audio).toEqual(['/assets/topdown/audio.json', '/assets/audio/ambient/village.webm']);
    // approaching the village -> forest band: forest and the transition SFX are fetched before they are needed
    const t = PRES.transitions[0];
    await walk(page, -20, t.blend_z[0] + 10);
    await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toEqual(['village', 'forest']);
    s = await A(page);
    expect(s.weights.forest).toBe(0);                                       // loaded while still silent
    expect(s.requested).toEqual(['assets/topdown/audio.json', 'assets/audio/ambient/village.webm',
      'assets/audio/ambient/forest.webm', 'assets/audio/transitions/village-forest.webm']);
    expect(watch.audio.filter((u) => u.endsWith('.m4a'))).toEqual([]);      // the other format is never touched
    clean(watch);
  });

  test('real crossfades and transition SFX down the whole route; walking back is silent', async ({ page, watch }) => {
    test.setTimeout(360_000);
    await open(page);
    await go(page, 0);
    await toggle(page).click();
    await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toContain('village');
    let z = 0;
    for (const [i, t] of PRES.transitions.entries()) {
      const mid = (t.blend_z[0] + t.blend_z[1]) / 2;
      await walk(page, z, t.blend_z[0] + 2, 4, 200);                         // approach (preload starts 60 m ahead)
      // the next ambient is decoded and running (silently) before its band starts: no gap
      await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toContain(t.to);
      await walk(page, t.blend_z[0] + 2, mid);
      await page.waitForTimeout(600);
      let s = await A(page);
      expect(s.playing).toEqual(expect.arrayContaining([t.from, t.to]));
      expect(s.ambients[t.from], `${t.from} audible in the blend`).toBeGreaterThan(0.01);
      expect(s.ambients[t.to], `${t.to} audible in the blend`).toBeGreaterThan(0.01);
      // cross the anchor (with wheel-like jitter around it): exactly one SFX
      await walk(page, mid, t.anchor_z - 3, 1, 150);
      for (let k = 0; k < 4; k++) { await go(page, t.anchor_z + 2); await go(page, t.anchor_z - 2); }
      s = await A(page);
      expect(s.sfxCount, `one SFX for ${t.from}-${t.to}`).toBe(i + 1);
      expect(s.lastSfx.id).toBe(`${t.from}-${t.to}`);
      z = t.anchor_z - 3;
    }
    await walk(page, z, PRES.transitions[3].blend_z[1] - 10);
    await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toEqual(['home']);
    // every production file of the route was fetched once, one format only
    const s = await A(page);
    const want = ENTRIES.map((e) => e.sources[0].src);
    expect([...s.requested].sort()).toEqual(['assets/topdown/audio.json', ...want].sort());
    expect(new Set(s.requested).size).toBe(s.requested.length);
    // walking back up: weights follow z, no reverse SFX, nothing re-downloaded
    const before = watch.audio.length;
    const w1 = await page.evaluate(() => window.__PROTO.audio(-300));
    await walk(page, PRES.transitions[3].blend_z[1] - 10, -300, 4, 150);
    expect((await A(page)).weights).toEqual(w1);
    expect((await A(page)).sfxCount).toBe(4);
    expect(watch.audio.length).toBe(before);
    clean(watch);
  });

  test('persistence with real files: stored "on" plays nothing until a gesture, then restores', async ({ page, watch }) => {
    await page.addInitScript(() => { try { localStorage.setItem('fellmise.audio.enabled', 'true'); } catch (e) {} });
    await open(page);
    await page.waitForTimeout(500);
    expect((await A(page)).context).toBe('none');
    expect(watch.audio).toEqual([]);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);                                          // a scroll is not a gesture
    expect(watch.audio).toEqual([]);
    await page.mouse.click(640, 400);
    await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toContain('village');
    expect((await A(page)).codec).toBe(WEBM);
    clean(watch);
  });
});

test.describe('/proto/ audio codec choice (capability, never the browser name)', () => {
  test('A: WebM/Opus available -> .webm only', async ({ page, watch }) => {
    await open(page);
    await toggle(page).click();
    await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toContain('village');
    expect((await A(page)).codec).toBe(WEBM);
    expect(watch.audio.some((u) => u.endsWith('.m4a'))).toBe(false);
    clean(watch);
  });

  test('B: no WebM/Opus -> .m4a only, decodes and plays (AAC loop is the 60 s loop twice)', async ({ page, watch }) => {
    await page.addInitScript(CODEC, 'no-webm');
    await open(page);
    await toggle(page).click();
    await expect.poll(async () => (await A(page)).playing, { timeout: 20000 }).toContain('village');
    const s = await A(page);
    expect(s.codec).toBe(AAC);
    expect(watch.audio).toEqual(['/assets/topdown/audio.json', '/assets/audio/ambient/village.m4a']);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    clean(watch);
  });

  test('B2: WebM claimed but undecodable -> falls back to .m4a once, then stays on it', async ({ page, watch }) => {
    await page.route(/\/assets\/audio\/.*\.webm$/, (r) => r.fulfill({ status: 200, contentType: 'audio/webm', body: Buffer.from('not audio') }));
    await open(page);
    await toggle(page).click();
    await expect.poll(async () => (await A(page)).playing, { timeout: 20000 }).toContain('village');
    let s = await A(page);
    expect([s.codec, s.failedTypes]).toEqual([AAC, [WEBM]]);
    await walk(page, 0, PRES.transitions[0].blend_z[0] + 10, 4, 200);
    await expect.poll(async () => (await A(page)).playing, { timeout: 15000 }).toContain('forest');
    s = await A(page);
    expect(s.requested.filter((u) => u.endsWith('.webm'))).toEqual(['assets/audio/ambient/village.webm']);   // only the first try
    // the browser logs the broken file itself; nothing is thrown by the page
    expect(watch.errors.filter((e) => e !== 'Unable to decode audio data')).toEqual([]);
  });

  test('C: nothing playable -> stays muted, aria-disabled, no audio files, no errors', async ({ page, watch }) => {
    await page.addInitScript(CODEC, 'none');
    await open(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    const s = await A(page);
    expect([s.enabled, s.unplayable, s.codec, s.context]).toEqual([false, true, null, 'none']);
    // aria-disabled: the click is still delivered (as a real one would be) and does nothing
    await toggle(page).dispatchEvent('click');
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    expect((await A(page)).enabled).toBe(false);
    expect(watch.audio).toEqual(['/assets/topdown/audio.json']);            // the config, and no sound file
    // the button looks exactly as before (no new visual state)
    expect(await toggle(page).evaluate((b) => getComputedStyle(b).opacity)).toBe('1');
    clean(watch);
  });
});

test.describe('/proto/ static modes stay silent with production audio', () => {
  for (const [name, opts, q] of [['width 899', { viewport: { width: 899, height: 900 } }, ''],
    ['?static=1', {}, '?static=1'], ['reduced motion', { reducedMotion: 'reduce' }, '']]) {
    test.describe(name, () => {
      test.use(opts);
      test('no toggle, no manager, no audio requests', async ({ page, watch }) => {
        const scripts = [];
        page.on('request', (r) => { if (/\/proto\/audio\.js/.test(r.url())) scripts.push(r.url()); });
        await page.addInitScript(() => { try { localStorage.setItem('fellmise.audio.enabled', 'true'); } catch (e) {} });
        await page.goto('/proto/' + q);
        await page.waitForLoadState('networkidle');
        await page.mouse.click(10, 10);
        await page.waitForLoadState('networkidle');
        expect(await page.evaluate(() => document.documentElement.dataset.mode)).toBe('static');
        expect(await page.locator('.audio-toggle').count()).toBe(0);
        expect(scripts, 'audio.js not loaded').toEqual([]);
        expect(watch.audio).toEqual([]);
        clean(watch);
      });
    });
  }

  test('no WebGL (--disable-3d-apis): static, silent', async ({ baseURL }) => {
    const b = await chromium.launch({ ...LAUNCH, args: [...LAUNCH.args, '--disable-3d-apis'] });
    const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await stubExternal(page);
    const audio = [], errors = [];
    page.on('request', (r) => { if (isAudio(r.url()) || /\/proto\/audio\.js/.test(r.url())) audio.push(r.url()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('fellmise.audio.enabled', 'true'); } catch (e) {} });
    await page.goto(baseURL + '/proto/');
    await page.waitForLoadState('networkidle');
    await page.mouse.click(10, 10);
    expect(await page.evaluate(() => [document.documentElement.dataset.mode, document.documentElement.dataset.modeReason])).toEqual(['static', 'no-webgl']);
    expect(await page.locator('.audio-toggle').count()).toBe(0);
    expect(audio).toEqual([]);
    expect(errors).toEqual([]);
    await b.close();
  });
});
