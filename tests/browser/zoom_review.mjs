/* Zoom choreography review: what the visitor's camera does along the route.
 *
 *   node zoom_review.mjs [--out <dir>]      (default out/zoom-review)
 *
 *   zoom-choreography-review.png  5 rows (village … home) × approach / focus /
 *                                 exit, the production view (auto zoom, cards
 *                                 on, no debug HUD), with z / frame / focus /
 *                                 weight under each frame
 *   zoom-route-strip.png          28 small frames at equal z steps, start to end
 *   zoom.json                     the numbers, plus where each focal object's
 *                                 sprite quad sits in the viewport at its peak
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
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'zoom-review')));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'checkpoints.json'), 'utf8'));
const CH = JSON.parse(fs.readFileSync(path.join(REPO, 'assets', 'topdown', 'camera_choreography.json'), 'utf8'));
const RT = JSON.parse(fs.readFileSync(path.join(REPO, 'assets', 'topdown', 'layout.runtime.json'), 'utf8'));
const VW = CONFIG.viewport.width, VH = CONFIG.viewport.height;
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

// focal objects: layout position + texture aspect (the texture /proto/ loads)
const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'proto', 'sprite_contact.json'), 'utf8')).sprites;
function object(id) {
  const bid = Object.keys(RT.biomes).findIndex((b) => RT.biomes[b].sprites.some((o) => o.id === id));
  const o = Object.values(RT.biomes)[bid].sprites.find((x) => x.id === id);
  return { o, z: -bid * RT.biome_spacing + o.pos[2] };
}

const srv = await startServer({ root: REPO });
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor });
const page = await ctx.newPage();
await stubExternal(page);
await page.goto(srv.url + '/proto/');
await page.waitForFunction(CONFIG.routes['/proto/'].ready, null, { timeout: CONFIG.routes['/proto/'].readyTimeoutMs });
if (await page.locator('#hud').isVisible()) throw new Error('debug HUD visible');
const aspects = await page.evaluate(async (srcs) => {
  const out = {};
  for (const [t, s] of Object.entries(srcs)) { const i = new Image(); i.src = '/' + s; await i.decode(); out[t] = i.width / i.height; }
  return out;
}, Object.fromEntries(Object.entries(meta).map(([t, m]) => [t, m.src])));
const focus = await page.evaluate(() => window.__PROTO.focus());
const routeEnd = await page.evaluate(() => window.__PROTO.state.routeEnd);

async function shot(z, file) {
  await page.evaluate((zz) => window.__PROTO.go(zz, 'auto'), z);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (file) await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  return page.evaluate(() => ({ cam: window.__PROTO.camera(), cards: window.__PROTO.content().points.filter((p) => p.weight > 0).map((p) => `${p.id} ${p.weight.toFixed(2)}`) }));
}

const rows = [];
const report = { focus: [] };
for (const f of focus) {
  const spec = CH.focus.find((x) => x.id === f.id);
  const cols = [['approach', f.peak + f.hold + f.approach], ['focus', f.peak],
                f.final ? ['route-end', routeEnd] : ['exit', f.peak - f.hold - f.exit]];
  const cells = [];
  for (const [kind, z] of cols) {
    const file = path.join(OUT, 'shots', `${f.id}-${kind}.png`);
    const s = await shot(z, file);
    cells.push({ kind, z, file, ...s });
  }
  // where the focal sprite quad lands at the peak (camera x = 0)
  const { o, z: oz } = object(spec.anchor);
  const w = o.h * aspects[o.t], ppm = VH / cells[1].cam.frame;
  const box = { left: VW / 2 + (o.pos[0] - w / 2) * ppm, right: VW / 2 + (o.pos[0] + w / 2) * ppm,
                top: VH / 2 + (oz - o.h / 2 - f.peak) * ppm, bottom: VH / 2 + (oz + o.h / 2 - f.peak) * ppm };
  const margin = Math.min(box.left, VW - box.right, box.top, VH - box.bottom);
  report.focus.push({ id: f.id, anchor: spec.anchor, peak: f.peak, frame: cells[1].cam.frame, quad_px: box, min_margin_px: Math.round(margin), cards_at_peak: cells[1].cards });
  rows.push({ f, spec, cells, margin });
}

// route strip: equal z steps over the whole route
const strip = [];
const z0 = 20, z1 = routeEnd, N = 28;       // the strip ends where the visitor's route ends
for (let i = 0; i < N; i++) {
  const z = +(z0 + (z1 - z0) * i / (N - 1)).toFixed(1);
  const file = path.join(OUT, 'shots', `strip-${String(i).padStart(2, '0')}.png`);
  const s = await shot(z, file);
  strip.push({ z, file, ...s });
}
// the finale up close: the last 5 m-steps up to the end of the route
const finale = [];
for (let i = 4; i >= 0; i--) {
  const z = +(routeEnd + i * 4).toFixed(2);
  const file = path.join(OUT, 'shots', `finale-${4 - i}.png`);
  finale.push({ z, file, ...(await shot(z, file)) });
}
report.routeEnd = routeEnd;
report.finale = finale.map((s) => ({ z: s.z, frame: +s.cam.frame.toFixed(2), cards: s.cards }));
report.strip = strip.map((s) => ({ z: s.z, frame: +s.cam.frame.toFixed(2), focus: s.cam.auto_focus, weight: +s.cam.auto_weight.toFixed(3) }));
fs.writeFileSync(path.join(OUT, 'zoom.json'), JSON.stringify(report, null, 1) + '\n');
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
  th{text-align:left;vertical-align:top;color:#ffc857;width:170px} small{color:#9a9e8c} img{display:block}
  .cap{padding:3px 0 0;color:#cfcab8}`;
const cap = (c) => `z ${c.z.toFixed(1)} · frame ${c.cam.frame.toFixed(1)} m · focus ${esc(c.cam.auto_focus || '—')} · w ${c.cam.auto_weight.toFixed(2)}`;
await render(`<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <h1>zoom choreography — auto zoom, production view (cards on, no debug HUD), ${VW}×${VH} DPR ${CONFIG.deviceScaleFactor}</h1>
  <table><tr><th></th><th>approach (window start)</th><th>focus (peak)</th><th>exit (window end) · home: route end</th></tr>
  ${rows.map(({ f, spec, cells, margin }) => `<tr><th>${esc(spec.biome)}<br><small>${esc(f.id)}<br>anchor ${esc(spec.anchor)}<br>peak frame ${spec.frame_height} m<br>focal quad margin ${Math.round(margin)} px</small></th>
  ${cells.map((c) => `<td><img style="width:480px" src="${pathToFileURL(c.file).href}"><div class="cap">${cap(c)}</div></td>`).join('')}</tr>`).join('')}</table>`,
path.join(OUT, 'zoom-choreography-review.png'), 1700);
await render(`<!doctype html><meta charset="utf-8"><style>${CSS} .g{display:grid;grid-template-columns:repeat(7,236px);gap:8px;padding:8px}</style>
  <h1>zoom route strip — ${N} frames, z ${z0} → route end ${z1.toFixed(2)}, equal steps, auto zoom</h1>
  <div class="g">${strip.map((s) => `<div><img style="width:236px" src="${pathToFileURL(s.file).href}"><div class="cap">z ${s.z} · ${s.cam.frame.toFixed(1)} m${s.cam.auto_focus ? ' · ' + esc(s.cam.auto_focus) : ''}</div></div>`).join('')}</div>
  <h1>finale — the last 16 m of the route, 4 m steps, ending at the route end (the scroll stops here)</h1>
  <div class="g" style="grid-template-columns:repeat(5,330px)">${finale.map((s) => `<div><img style="width:330px" src="${pathToFileURL(s.file).href}"><div class="cap">z ${s.z} · ${s.cam.frame.toFixed(1)} m · cards ${esc(s.cards.join(', ') || 'none')}</div></div>`).join('')}</div>`,
path.join(OUT, 'zoom-route-strip.png'), 1720);
await browser.close();
await srv.close();
console.log(JSON.stringify(report.focus.map((f) => [f.id, f.frame, f.min_margin_px, f.cards_at_peak]), null, 0));
console.log(`-> ${OUT}`);
