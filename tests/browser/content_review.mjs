/* Content points review: the human-review sheet for the DOM cards of /proto/.
 *
 *   node content_review.mjs [--out <dir>]      (default out/content-review)
 *
 *   content-points-review.png  one row per content checkpoint (checkpoints.json
 *                              entries with a `content` field): the full frame
 *                              with its active card, and id / z / side / weight
 *   content-copy.md            id, EN title/body, RU title/body, source — the
 *                              copy, readable apart from the picture
 *   content-points-close-review.png  village and home at the close zoom: the
 *                              same cards, checked for type at 50 px/m
 *   content.json               what __PROTO.content() reported per checkpoint,
 *                              plus the card's box on screen
 *
 * Same viewport/DPR as the visual suite. Nothing in the repository is written.
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
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'content-review')));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'checkpoints.json'), 'utf8'));
const SRC = JSON.parse(fs.readFileSync(path.join(REPO, 'assets', 'topdown', 'content_points.json'), 'utf8'));
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cell = (t) => String(t).replace(/\|/g, '\\|');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

// copy table: straight from the source of truth
const points = [...SRC.points].sort((a, b) => a.order - b.order);
fs.writeFileSync(path.join(OUT, 'content-copy.md'), [
  '# Content points — copy', '',
  'Source of truth: `assets/topdown/content_points.json`; every title/body is a verbatim quote of',
  '`tools/build_site.py` FEATURES (checked by `tools/build_proto_content.py --check`).', '',
  '| id | EN title | EN body | RU title | RU body | source |', '|---|---|---|---|---|---|',
  ...points.map((p) => `| ${p.id} | ${cell(p.en.title)} | ${cell(p.en.body)} | ${cell(p.ru.title)} | ${cell(p.ru.body)} | `
    + `${p.copy_source.file} FEATURES[${p.copy_source.features_id}]; kicker: ${cell(p.en.kicker)} / ${cell(p.ru.kicker)}; ${cell(p.copy_source.why)} |`),
  ''].join('\n'));

const srv = await startServer({ root: REPO });
const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor });
const page = await ctx.newPage();
await stubExternal(page);
const rc = CONFIG.routes['/proto/'];
await page.goto(srv.url + '/proto/');
await page.waitForFunction(rc.ready, null, { timeout: rc.readyTimeoutMs });
// the debug HUD is not part of the page: it must not be in these pictures
if (await page.locator('#hud').isVisible()) throw new Error('debug HUD is visible without ?debug=hud');
const CLOSE = [['close-village', 'village-world'], ['close-home', 'home-home']].map(([id, point]) => {
  const c = CONFIG.checkpoints.find((x) => x.content === point);
  return { ...c, id, zoom: 'близко', close: true };
});
const rows = [];
for (const c of [...CONFIG.checkpoints.filter((x) => x.content), ...CLOSE]) {
  await page.evaluate(([z, zoom]) => window.__PROTO.go(z, zoom), [c.z, c.zoom]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const file = path.join(OUT, 'shots', `${c.id}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  const info = await page.evaluate(() => window.__PROTO.content());
  const p = info.points.find((x) => x.id === c.content);
  p.card = await page.locator(`section[data-locale="${info.locale}"] article[data-id="${c.content}"]`)
    .evaluate((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
  rows.push({ c, p, file, others: info.points.filter((x) => x.id !== c.content && x.weight > 0).map((x) => x.id) });
}
await ctx.close();
fs.writeFileSync(path.join(OUT, 'content.json'), JSON.stringify(rows.map(({ c, p, others }) => ({ checkpoint: c.id, z: c.z, zoom: c.zoom, point: p, othersVisible: others })), null, 1) + '\n');

async function sheet(list, file, title) {
const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#18191a;color:#e8e6dc;font:13px ui-monospace,monospace}
  h1{font-size:15px;margin:10px 12px 4px;color:#ffc857} table{border-collapse:separate;border-spacing:10px}
  th{text-align:left;vertical-align:top;color:#ffc857;width:230px} td small{color:#9a9e8c} img{display:block;width:960px}</style>
  <h1>${esc(title)}</h1>
  <table>${list.map(({ c, p, file, others }) => `<tr><th>${esc(c.id)}<br><small>point ${esc(p.id)}<br>z ${c.z} (anchor ${p.z})<br>side ${esc(p.side)} · weight ${p.weight.toFixed(2)} · ${esc(p.state)}<br>zoom ${esc(c.zoom)}<br>marker on screen ${Math.round(p.screen.x)}, ${Math.round(p.screen.y)}<br>card ${p.card.w}×${p.card.h} at ${p.card.x}, ${p.card.y}<br>other cards visible: ${others.length ? esc(others.join(', ')) : 'none'}</small></th>
  <td><img src="${pathToFileURL(file).href}"></td></tr>`).join('')}</table>`;
const hf = file.replace(/\.png$/, '.html');
fs.writeFileSync(hf, html);
const sc = await browser.newContext({ viewport: { width: 1240, height: 800 } });
const sp = await sc.newPage();
await sp.goto(pathToFileURL(hf).href);
await sp.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
await sp.screenshot({ path: file, fullPage: true });
await sc.close();
}
const VP = `${CONFIG.viewport.width}×${CONFIG.viewport.height} DPR ${CONFIG.deviceScaleFactor}, EN, no debug HUD`;
await sheet(rows.filter((r) => !r.c.close), path.join(OUT, 'content-points-review.png'), `content points review — ${VP}, zoom обзор`);
await sheet(rows.filter((r) => r.c.close), path.join(OUT, 'content-points-close-review.png'), `content points — close zoom (16 m frame) — ${VP}`);
await browser.close();
await srv.close();
console.log(`-> ${OUT}`);
