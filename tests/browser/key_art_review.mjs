/* Key art planning review: where the planned illustration windows sit.
 *
 *   node key_art_review.mjs [--out <dir>]      (default out/key-art-planning)
 *
 *   key-art-slots-review.png   per slot: enter / peak / exit, /proto/?debug=keyart
 *                              (neutral placeholders at the planned size), with
 *                              id, biome, z, camera frame, aspect, display px, side
 *   key-art-route-review.png   30 frames at equal z steps over the whole route:
 *                              how often a picture shows up
 *   key-art.json               the numbers + collision checks at every peak
 *
 * Placeholders exist only in ?debug=keyart. Nothing in the repository is written.
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
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'key-art-planning')));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'checkpoints.json'), 'utf8'));
const PLAN = JSON.parse(fs.readFileSync(path.join(REPO, 'assets', 'topdown', 'key_art.json'), 'utf8'));
const VW = CONFIG.viewport.width, VH = CONFIG.viewport.height;
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const srv = await startServer({ root: REPO });
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor });
const page = await ctx.newPage();
await stubExternal(page);
await page.goto(srv.url + '/proto/?debug=keyart');
await page.waitForFunction(() => window.__PROTO?.state.done && window.__PROTO.keyArt().length > 0, null, { timeout: 120000 });
if (await page.locator('#hud').isVisible()) throw new Error('debug HUD visible');
const slots = await page.evaluate(() => window.__PROTO.keyArt());
const routeEnd = await page.evaluate(() => window.__PROTO.state.routeEnd);

async function at(z) {
  await page.evaluate((zz) => window.__PROTO.go(zz, 'auto'), z);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const P = window.__PROTO;
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const cards = [...document.querySelectorAll('section.content-locale:not([hidden]) .content-point')]
      .map((el) => ({ id: el.dataset.id, opacity: +getComputedStyle(el).opacity, rect: rect(el) })).filter((c) => c.opacity > 0);
    const art = [...document.querySelectorAll('.keyart-slot')]
      .map((el) => ({ id: el.dataset.id, opacity: +el.style.opacity, rect: rect(el) })).filter((a) => a.opacity > 0);
    const cam = P.camera();
    return { cam, cards, art, dim: +document.getElementById('biome-transition-overlay').style.opacity,
             biome: P.presentationAt(cam.z).biome };
  });
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rows = [];
const report = { slots: [] };
for (const s of slots) {
  const mid = (s.core + s.range) / 2;
  const cols = [['enter', s.z + mid], ['peak', s.z], ['exit', s.z - mid]];
  const cells = [];
  for (const [kind, z] of cols) {
    const file = path.join(OUT, 'shots', `${s.id}-${kind}.png`);
    const st = await at(z);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
    cells.push({ kind, z, file, st });
  }
  // collisions at the peak
  const pk = cells[1].st;
  const me = pk.art.find((a) => a.id === s.id);
  const ppm = VH / pk.cam.frame;
  const road = await page.evaluate(([z0, top, bottom, ppm, vh]) => {
    // road x-extent (screen px) over the rows the placeholder spans
    let lo = Infinity, hi = -Infinity;
    for (let y = top; y <= bottom; y += 4) {
      const z = z0 + (y - vh / 2) / ppm, r = window.__PROTO.roadAt(z);
      lo = Math.min(lo, (r.cx - r.hw) * ppm); hi = Math.max(hi, (r.cx + r.hw) * ppm);
    }
    return { lo, hi };
  }, [s.z, me.rect.y, me.rect.y + me.rect.h, ppm, VH]);
  const roadPx = { x: VW / 2 + road.lo, w: road.hi - road.lo, y: me.rect.y, h: me.rect.h };
  const chk = {
    inside_viewport: me.rect.x >= 0 && me.rect.y >= 0 && me.rect.x + me.rect.w <= VW && me.rect.y + me.rect.h <= VH,
    covers_active_card: pk.cards.some((c) => overlap(c.rect, me.rect)),
    cards_visible_at_peak: pk.cards.map((c) => `${c.id} ${c.opacity}`),
    camera_focus_weight: pk.cam.auto_weight, camera_frame: pk.cam.frame,
    transition_dim: pk.dim, covers_road: overlap(roadPx, me.rect),
    road_gap_px: Math.round(me.rect.x > VW / 2 ? me.rect.x - (VW / 2 + road.hi) : (VW / 2 + road.lo) - (me.rect.x + me.rect.w)),
    other_art_visible: pk.art.filter((a) => a.id !== s.id).map((a) => a.id),
    rect: me.rect,
  };
  report.slots.push({ ...s, enter_z: s.z + s.range, exit_z: s.z - s.range, checks: chk,
    frames: cells.map((c) => ({ kind: c.kind, z: c.z, frame: c.st.cam.frame, art: c.st.art.map((a) => `${a.id} ${a.opacity}`), cards: c.st.cards.map((x) => `${x.id} ${x.opacity}`) })) });
  rows.push({ s, cells, chk });
}

const strip = [];
const N = 30;
for (let i = 0; i < N; i++) {
  const z = +(20 + (routeEnd - 20) * i / (N - 1)).toFixed(1);
  const file = path.join(OUT, 'shots', `route-${String(i).padStart(2, '0')}.png`);
  const st = await at(z);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  strip.push({ z, file, st });
}
report.route = strip.map((x) => ({ z: x.z, frame: +x.st.cam.frame.toFixed(1), art: x.st.art.map((a) => a.id), cards: x.st.cards.map((c) => c.id) }));
fs.writeFileSync(path.join(OUT, 'key-art.json'), JSON.stringify(report, null, 1) + '\n');
await ctx.close();

async function render(html, file, width) {
  const hf = file.replace(/\.png$/, '.html');
  fs.writeFileSync(hf, html);
  const c = await browser.newContext({ viewport: { width, height: 800 } });
  const p = await c.newPage();
  await p.goto(pathToFileURL(hf).href);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: file, fullPage: true });
  await c.close();
}
const CSS = `body{margin:0;background:#18191a;color:#e8e6dc;font:12px ui-monospace,monospace}
  h1{font-size:15px;margin:10px 12px 4px;color:#ffc857} table{border-collapse:separate;border-spacing:8px}
  th{text-align:left;vertical-align:top;color:#ffc857;width:200px} small{color:#9a9e8c} img{display:block} .cap{padding:3px 0 0;color:#cfcab8}`;
const spec = (id) => PLAN.slots.find((x) => x.id === id);
await render(`<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <h1>key art slots — PLANNING placeholders (/proto/?debug=keyart), auto zoom, ${VW}×${VH} DPR ${CONFIG.deviceScaleFactor}</h1>
  <table><tr><th></th><th>enter</th><th>peak</th><th>exit</th></tr>
  ${rows.map(({ s, cells, chk }) => { const p = spec(s.id); return `<tr><th>${esc(s.id)}<br><small>biome ${esc(p.biome)}<br>anchor ${esc(p.anchor.object)}<br>window ${(s.z + s.range).toFixed(1)} … ${(s.z - s.range).toFixed(1)}<br>peak ${s.z.toFixed(1)} ±${s.core}<br>aspect ${esc(p.aspect)} · ${s.w}×${s.h} css · side ${esc(s.side)}<br>target ${p.target_px.join('×')} px<br>at peak: frame ${chk.camera_frame} m, focus w ${chk.camera_focus_weight}, dim ${chk.transition_dim}<br>cards at peak: ${esc(chk.cards_visible_at_peak.join(', ') || 'none')}<br>road gap ${chk.road_gap_px} px · in viewport ${chk.inside_viewport}</small></th>
  ${cells.map((c) => `<td><img style="width:430px" src="${pathToFileURL(c.file).href}"><div class="cap">z ${c.z.toFixed(1)} · frame ${c.st.cam.frame.toFixed(1)} m · art ${esc(c.st.art.map((a) => a.opacity.toFixed(2)).join(', ') || '0')}</div></td>`).join('')}</tr>`; }).join('')}</table>`,
path.join(OUT, 'key-art-slots-review.png'), 1620);
await render(`<!doctype html><meta charset="utf-8"><style>${CSS} .g{display:grid;grid-template-columns:repeat(6,270px);gap:8px;padding:8px} .on{outline:3px solid #ffc857}</style>
  <h1>key art on the route — ${N} frames, z 20 → route end ${routeEnd.toFixed(2)}; outlined = a key art window is on screen</h1>
  <div class="g">${strip.map((x) => `<div><img class="${x.st.art.length ? 'on' : ''}" style="width:270px" src="${pathToFileURL(x.file).href}"><div class="cap">z ${x.z} · ${x.st.cam.frame.toFixed(0)} m${x.st.art.length ? ' · ART ' + esc(x.st.art.map((a) => a.id).join(',')) : ''}${x.st.cards.length ? ' · card' : ''}</div></div>`).join('')}</div>`,
path.join(OUT, 'key-art-route-review.png'), 1720);
await browser.close();
await srv.close();
console.log(JSON.stringify(report.slots.map((s) => ({ id: s.id, ...s.checks, rect: undefined })), null, 1));
console.log(`-> ${OUT}`);
