/* Grounding patch integration review: the same camera on each object, four
 * states side by side.
 *
 *   node patch_review.mjs [--base <git ref>] [--out <dir>]
 *
 *   baseline    proto/main.js of --base (default origin/site-biome-presentation-1,
 *               PR #4), in memory — the old shadow model
 *   shadow-fix  this working tree, ?patches=none (PR #6 contact shadow only)
 *   patch A     this working tree, ?patches=A
 *   patch B     this working tree, ?patches=B
 *
 * plus the order check (patch A drawn OVER the contact shadow instead of
 * under it) and every patch alone on grey.
 *
 * Outputs (default out/patch-review):
 *   patch-integration-review.png  rows = objects, columns = the four states
 *   patch-on-gray-review.png      each patch PNG on grey + file + placement
 *   patch-order-check.png         patch A under vs over the contact shadow
 *   review.json                   camera, crop and the patch quads as drawn
 *
 * Tooling only: the camera X offset is patched into main.js in memory; the
 * repository files are not touched. Same viewport, DPR, zoom and object
 * position in frame for every state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from './lib/server.mjs';
import { LAUNCH } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'patch-review')));
const BASE = arg('--base', 'origin/site-biome-presentation-1');
const VIEW = { width: 1280, height: 800 };
const PXM = VIEW.height / 16;                 // close zoom: 16 m frame -> 50 px per metre
const CR = String.fromCharCode(13);
const git = (...a) => execFileSync('git', a, { cwd: REPO, maxBuffer: 64 << 20 });

const GP = JSON.parse(fs.readFileSync(path.join(REPO, 'proto', 'ground_patches.json'), 'utf8'));
const RUNTIME = JSON.parse(fs.readFileSync(path.join(REPO, 'assets', 'topdown', 'layout.runtime.json'), 'utf8'));
const OBJECTS = GP.patches.map((p) => ({ key: p.key, id: p.id, t: p.t }));

const STATES = [
  ['baseline', `PR #4 (${BASE})`, 'base', 'none'],
  ['shadow-fix', 'PR #6 contact shadow', 'tree', 'none'],
  ['patch A', 'PR #6 + patch A', 'tree', 'A'],
  ['patch B', 'PR #6 + patch B', 'tree', 'B'],
];

function withCamX(src) {
  const a = '  camera.position.set(0, 120, state.z);\n  camera.lookAt(0, 0, state.z);';
  if (!src.includes(a)) throw new Error('camera anchor not found');
  return src.replace(a, '  const DX = window.__CAM_X || 0;\n  camera.position.set(DX, 120, state.z);\n  camera.lookAt(DX, 0, state.z);');
}
const SRC = {
  base: withCamX(git('show', `${BASE}:proto/main.js`).toString().split(CR).join('')),
  tree: withCamX(fs.readFileSync(path.join(REPO, 'proto', 'main.js'), 'utf8').split(CR).join('')),
};
const rafs = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cell = (state, key) => path.join(OUT, 'cells', `${state.replace(/\W+/g, '_')}-${key}.png`);

async function open(browser, srv, src, query) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/\/proto\/main\.js(\?.*)?$/, (r) => r.fulfill({ contentType: 'text/javascript', body: src }));
  await page.goto(srv.url + '/proto/' + query);
  await page.addStyleTag({ content: '#hud{display:none!important}' });
  await page.waitForFunction(() => window.__PROTO && window.__PROTO.state.done, null, { timeout: 120000 });
  return { ctx, page };
}

async function sheetPNG(browser, html, file, width) {
  const hf = file.replace(/\.png$/, '.html');
  fs.writeFileSync(hf, html);
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(hf).href);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: file, fullPage: true });
  await ctx.close();
}

const CSS = `body{margin:0;background:#18191a;color:#e8e6dc;font:13px ui-monospace,monospace}
  table{border-collapse:separate;border-spacing:8px} th{text-align:left;vertical-align:middle;color:#ffc857}
  td{vertical-align:top} small{color:#9a9e8c} h1{font-size:15px;margin:10px 8px 0;color:#ffc857}`;

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'cells'), { recursive: true });
  const srv = await startServer({ root: REPO });
  const browser = await chromium.launch(LAUNCH);

  // one camera and crop per object, from the PR #6 contact point
  const cams = {};
  {
    const { ctx, page } = await open(browser, srv, SRC.tree, '?patches=none');
    const shadows = await page.evaluate(() => window.__PROTO.shadows());
    const bio = Object.keys(RUNTIME.biomes);
    for (const O of OBJECTS) {
      const s = shadows.find((x) => x.id === O.id);
      if (!s) throw new Error('no such object in the scene: ' + O.id);
      const bi = bio.findIndex((b) => RUNTIME.biomes[b].sprites.some((o) => o.id === O.id));
      const o = RUNTIME.biomes[bio[bi]].sprites.find((x) => x.id === O.id);
      const camZ = s.z - 1.5;
      const sy = (wz) => VIEW.height / 2 + (wz - camZ) * PXM;
      const sx = (wx) => VIEW.width / 2 + (wx - s.x) * PXM;
      const half = Math.max(s.w / 2, 2) + 1.4;
      const clip = { x: Math.max(0, sx(s.x - half)), y: Math.max(0, sy(s.z - Math.min(o.h * 0.6, 5))) };
      clip.width = Math.min(VIEW.width - clip.x, 2 * half * PXM);
      clip.height = Math.min(VIEW.height - clip.y, sy(s.z + 2.4) - clip.y);
      cams[O.key] = { camX: s.x, camZ, clip, contact: { x: s.x, z: s.z, w: s.w }, h: o.h };
    }
    await ctx.close();
  }

  const report = { base: BASE, view: VIEW, pxPerM: PXM, zoom: 'близко', cams, states: {} };
  const shoot = async (label, srcKey, query) => {
    const { ctx, page } = await open(browser, srv, SRC[srcKey], query);
    for (const O of OBJECTS) {
      const C = cams[O.key];
      await page.evaluate(([x, z]) => { window.__CAM_X = x; window.__PROTO.go(z, 'близко'); }, [C.camX, C.camZ]);
      await rafs(page);
      await page.screenshot({ path: cell(label, O.key), clip: C.clip });
    }
    report.states[label] = { query, source: srcKey === 'base' ? BASE : 'working tree',
      patches: await page.evaluate(() => (window.__PROTO.patches ? window.__PROTO.patches() : [])) };
    await ctx.close();
  };
  for (const [label, , src, v] of STATES) await shoot(label, src, `?patches=${v}`);
  await shoot('A over shadow', 'tree', '?patches=A&patch_order=over_shadow');

  /* ---- patch-integration-review.png */
  const row = (O, cols) => `<tr><th>${esc(O.key)}<br><small>${esc(O.id)}</small></th>`
    + cols.map((c) => `<td><img style="display:block;width:340px" src="${pathToFileURL(cell(c, O.key)).href}"></td>`).join('') + '</tr>';
  await sheetPNG(browser, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
    <h1>patch integration review — close zoom ${PXM} px/m, 1280×800, DPR 1, same camera per row</h1>
    <table><tr><th></th>${STATES.map(([l, d]) => `<th>${esc(l)}<br><small>${esc(d)}</small></th>`).join('')}</tr>
    ${OBJECTS.map((O) => row(O, STATES.map(([l]) => l))).join('')}</table>`,
  path.join(OUT, 'patch-integration-review.png'), 1500);

  /* ---- patch-order-check.png */
  await sheetPNG(browser, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
    <h1>order check — patch A under the contact shadow (chosen) vs over it</h1>
    <table><tr><th></th><th>patch A · under shadow</th><th>patch A · over shadow</th></tr>
    ${OBJECTS.map((O) => row(O, ['patch A', 'A over shadow'])).join('')}</table>`,
  path.join(OUT, 'patch-order-check.png'), 800);

  /* ---- patch-on-gray-review.png */
  const drawn = Object.fromEntries(['patch A', 'patch B'].flatMap((l) => report.states[l].patches.map((p) => [p.file, p])));
  const tiles = GP.patches.flatMap((p) => Object.entries(p.variants).map(([v, file]) => {
    const d = drawn[file] || {};
    const mpp = cams[p.key].h / p.sprite_px[1];
    const lbl = `${p.key} ${v} → ${p.id} · sprite ${p.sprite_px.join('×')} px + pad L${p.pad_px.left}/R${p.pad_px.right}/B${p.pad_px.bottom} px`
      + ` (${(p.pad_px.left * mpp).toFixed(2)} m) · quad ${d.w ? d.w.toFixed(2) : '?'}×${d.h ? d.h.toFixed(2) : '?'} m, top = sprite top`;
    return `<div style="margin:8px"><div style="color:#ffc857">${esc(file.split('/').pop())}</div>
      <div style="color:#9a9e8c;margin-bottom:4px">${esc(lbl)}</div>
      <div style="background:#808080;display:inline-block;outline:1px dashed #555">
      <img style="display:block;width:560px" src="${pathToFileURL(path.join(REPO, 'proto', file)).href}"></div></div>`;
  }));
  await sheetPNG(browser, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
    <h1>ground patches on grey (#808080) — dashed box = patch canvas; the sprite covers the upper part</h1>
    <div style="display:grid;grid-template-columns:repeat(2,600px)">${tiles.join('')}</div>`,
  path.join(OUT, 'patch-on-gray-review.png'), 1240);

  fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(report, null, 1) + '\n');
  await browser.close();
  await srv.close();
  console.log(`-> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
