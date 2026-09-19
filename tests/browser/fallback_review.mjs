/* Static journey review (/proto/ fallback): readable contact sheets of viewport
 * checkpoints, not one giant full-page shot.
 *
 *   node fallback_review.mjs [--out <dir>]      (default out/fallback-review)
 *
 *   fallback-mobile-review.png   390×844: start, village, forest, mine, spirit, home/end
 *   fallback-desktop-review.png  1280×800 ?static=1: the same points
 *   fallback-extra-review.png    768/834 static, 900/1024 live, 430×932 and RU at 390
 *   fallback-nojs-review.png     430×932 with JavaScript disabled: copy + the three pictures
 *
 * Nothing in the repository is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from './lib/server.mjs';
import { LAUNCH, stubExternal } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'fallback-review')));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const srv = await startServer({ root: REPO });
const browser = await chromium.launch(LAUNCH);
const STOPS = [['start', null], ['village', 'village-world'], ['forest', 'forest-skills'], ['mine', 'mine-mining'],
               ['spirit', 'spirit-afterlife'], ['home / end', 'home-home']];

async function flow(tag, opts, q) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage(); await stubExternal(p);
  await p.goto(srv.url + '/proto/' + q);
  await p.waitForLoadState('networkidle');
  const mode = await p.evaluate(() => [document.documentElement.dataset.mode, document.documentElement.dataset.modeReason]);
  const shots = [];
  for (const [label, id] of STOPS) {
    await p.evaluate((i) => {
      if (!i) { scrollTo(0, 0); return; }
      const el = document.querySelector(`section.content-locale:not([hidden]) [data-id="${i}"], figure.key-art[data-id="${i}"]`);
      scrollTo(0, Math.max(0, el.getBoundingClientRect().top + scrollY - 24));
      if (i === 'home-home') scrollTo(0, document.documentElement.scrollHeight);
    }, id);
    await p.evaluate(() => Promise.all([...document.images].filter((i) => i.getAttribute('src') && i.getBoundingClientRect().top < innerHeight * 2)
      .map((i) => i.decode().catch(() => {}))));
    await p.waitForTimeout(250);
    const file = path.join(OUT, 'shots', `${tag}-${label.replace(/\W+/g, '_')}.png`);
    await p.screenshot({ path: file });
    shots.push({ label, file });
  }
  await ctx.close();
  return { mode, shots };
}

async function sheet(file, title, rows, w) {
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#18191a;color:#e8e6dc;font:12px ui-monospace,monospace}
    h1{font-size:15px;margin:10px 12px;color:#ffc857} h2{font-size:13px;margin:6px 12px;color:#ffc857}
    .g{display:flex;flex-wrap:wrap;gap:10px;padding:0 12px 12px;align-items:flex-start} img{display:block;border:1px solid #333} .c{color:#cfcab8;padding:3px 0}</style>
    <h1>${esc(title)}</h1>${rows.map((r) => `<h2>${esc(r.title)} · mode ${esc(r.mode.join(' / '))}</h2><div class="g">${r.shots.map((s) =>
      `<div><img style="width:${r.w}px" src="${pathToFileURL(s.file).href}"><div class="c">${esc(s.label)}</div></div>`).join('')}</div>`).join('')}`;
  const hf = file.replace(/\.png$/, '.html'); fs.writeFileSync(hf, html);
  const c = await browser.newContext({ viewport: { width: w, height: 800 } }); const p = await c.newPage();
  await p.goto(pathToFileURL(hf).href); await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: file, fullPage: true }); await c.close();
}

const m390 = await flow('m390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, '');
await sheet(path.join(OUT, 'fallback-mobile-review.png'), 'static journey — 390×844 (mobile), viewport checkpoints, EN',
  [{ title: '390×844', ...m390, w: 260 }], 1720);
const d1280 = await flow('d1280', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, '?static=1');
await sheet(path.join(OUT, 'fallback-desktop-review.png'), 'static journey — 1280×800 forced (?static=1), viewport checkpoints, EN',
  [{ title: '1280×800 ?static=1', ...d1280, w: 520 }], 1640);
const m430 = await flow('m430', { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, '');
const ru = await flow('ru390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, '?lang=ru');
async function liveShot(tag, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); await stubExternal(p);
  await p.goto(srv.url + '/proto/'); await p.waitForFunction(() => window.__PROTO?.state.done, null, { timeout: 120000 });
  const mode = await p.evaluate(() => [document.documentElement.dataset.mode]);
  const shots = [];
  for (const [label, z] of [['start', -20], ['village card', -40], ['mine card + adit', -319]]) {
    await p.evaluate((zz) => window.__PROTO.go(zz, 'auto'), z);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = path.join(OUT, 'shots', `${tag}-${label.replace(/\W+/g, '_')}.png`); await p.screenshot({ path: file });
    shots.push({ label, file });
  }
  await ctx.close();
  return { mode, shots };
}
const t768 = await flow('t768', { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 }, '');
const t834 = await flow('t834', { viewport: { width: 834, height: 1194 }, deviceScaleFactor: 1 }, '');
const l900 = await liveShot('l900', 900, 700);
const l1024 = await liveShot('l1024', 1024, 768);
await sheet(path.join(OUT, 'fallback-extra-review.png'), 'breakpoint 900 — 768 and 834 static; 900 and 1024 live; 430×932 and RU at 390 static',
  [{ title: '768×1024', ...t768, w: 240 }, { title: '834×1194', ...t834, w: 240 },
   { title: '900×700 (live)', ...l900, w: 440 }, { title: '1024×768 (live)', ...l1024, w: 440 },
   { title: '430×932', ...m430, w: 220 }, { title: '390×844 ?lang=ru', ...ru, w: 220 }], 1560);
// no JavaScript: the <noscript> pictures
const nojs = await (async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); await stubExternal(p);
  await p.goto(srv.url + '/proto/');
  const shots = [];
  for (const [label, sel] of [['start (copy)', null], ['village art', 'village-life'], ['mine art', 'mine-work'], ['spirit art', 'spirit-afterlife']]) {
    if (sel) await p.locator(`figure.key-art[data-id="${sel}"] img[src]`).scrollIntoViewIfNeeded();
    else await p.evaluate(() => scrollTo(0, 0));
    await p.waitForLoadState('networkidle');
    await p.evaluate(() => Promise.all([...document.images].filter((i) => i.getAttribute('src')).map((i) => i.decode().catch(() => {}))));
    const file = path.join(OUT, 'shots', `nojs-${label.replace(/\W+/g, '_')}.png`); await p.screenshot({ path: file });
    shots.push({ label, file });
  }
  await ctx.close();
  return { mode: ['no JavaScript'], shots };
})();
await sheet(path.join(OUT, 'fallback-nojs-review.png'), '/proto/ with JavaScript disabled — 430×932: copy + the three approved pictures (<noscript> twins)',
  [{ title: '430×932, JS off', ...nojs, w: 300 }], 1300);
await browser.close(); await srv.close();
console.log(`-> ${OUT}`, JSON.stringify({ m390: m390.mode, d1280: d1280.mode, m430: m430.mode, ru: ru.mode, t768: t768.mode, t834: t834.mode, l900: l900.mode, l1024: l1024.mode }));
