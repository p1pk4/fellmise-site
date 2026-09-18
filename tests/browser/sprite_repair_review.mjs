/* Sprite repair review: repaired sprites against the two states before them.
 *
 *   node sprite_repair_review.mjs [--baseline <ref>] [--shadow <ref>] [--out <dir>]
 *
 * Columns (each column serves /proto/ and assets/topdown/ files from its own
 * git ref, in memory; the working tree is the last column):
 *   PR #4 baseline      --baseline (default origin/site-biome-presentation-1)
 *   PR #6 shadow fix    --shadow   (default origin/site-grounding-fix-2)
 *   repaired B          this working tree: repaired sprites + regenerated
 *                       sprite_contact.json + the PR #6 shadow
 *
 * Outputs (default out/sprite-repair-review):
 *   sprite-repair-scene-review.png  rows = hero_house_b, hero_house_a,
 *                                   hero_well; one camera per row (close zoom)
 *   route-check-review.png          real route frames (checkpoints.json):
 *                                   village overview/close, home overview/close
 *   review.json                     cameras + each object's shadow as drawn
 *
 * Tooling only: nothing in the repository is written. The camera X offset is
 * patched into main.js in memory so an object off the road axis can be framed.
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
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'sprite-repair-review')));
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'checkpoints.json'), 'utf8'));
const VIEW = CONFIG.viewport;
const PXM = VIEW.height / 16;
const CR = String.fromCharCode(13);
const git = (...a) => execFileSync('git', a, { cwd: REPO, maxBuffer: 64 << 20 });

const COLS = [
  ['PR #4 baseline', arg('--baseline', 'origin/site-biome-presentation-1')],
  ['PR #6 shadow fix', arg('--shadow', 'origin/site-grounding-fix-2')],
  ['PR #6 + repaired B', null],
];
const OBJECTS = [
  ['hero_house_b', 'home/homestead/house'],
  ['hero_house_a', 'village/west-homes/second-house'],
  ['hero_well', 'village/well-square/well'],
];
const ROUTE = ['proto-village-overview', 'proto-village-close', 'proto-home', 'proto-home-close'];

const CAM = '  camera.position.set(0, 120, state.z);\n  camera.lookAt(0, 0, state.z);';
const withCamX = (src) => {
  if (!src.includes(CAM)) throw new Error('camera anchor not found');
  return src.replace(CAM, '  const DX = window.__CAM_X || 0;\n  camera.position.set(DX, 120, state.z);\n  camera.lookAt(DX, 0, state.z);');
};
const show = (ref, p) => { try { return git('show', `${ref}:${p}`); } catch { return null; } };
const TYPES = { js: 'text/javascript', json: 'application/json', webp: 'image/webp', png: 'image/png' };
const rafs = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const slug = (s) => s.replace(/\W+/g, '_');

async function open(browser, srv, ref) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: CONFIG.deviceScaleFactor });
  const page = await ctx.newPage();
  // main.js always gets the camera X hook; with a ref, /proto/ and
  // assets/topdown/ come from that ref (sprites, contact metadata, layout)
  await page.route(/\/(proto|assets\/topdown)\/.*$/, (r) => {
    const rel = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\//, '');
    if (!/\.[a-z0-9]+$/i.test(rel)) return r.continue();       // directory index: served as is
    const ext = rel.split('.').pop();
    let body = ref ? show(ref, rel) : (fs.existsSync(path.join(REPO, rel)) ? fs.readFileSync(path.join(REPO, rel)) : null);
    if (body === null) return r.continue();
    if (rel === 'proto/main.js') body = withCamX(body.toString().split(CR).join(''));
    return r.fulfill({ contentType: TYPES[ext] || 'application/octet-stream', body });
  });
  await page.goto(srv.url + '/proto/');
  await page.addStyleTag({ content: '#hud{display:none!important}' });
  await page.waitForFunction(() => window.__PROTO && window.__PROTO.state.done, null, { timeout: 120000 });
  return { ctx, page };
}

async function sheet(browser, file, title, rows, cols, width) {
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#18191a;color:#e8e6dc;font:13px ui-monospace,monospace}
    table{border-collapse:separate;border-spacing:8px} th{text-align:left;vertical-align:middle;color:#ffc857}
    small{color:#9a9e8c} h1{font-size:15px;margin:10px 8px 0;color:#ffc857} img{display:block}</style>
    <h1>${esc(title)}</h1><table><tr><th></th>${cols.map(([c, r]) => `<th>${esc(c)}<br><small>${esc(r || 'working tree')}</small></th>`).join('')}</tr>
    ${rows.map(([label, sub, key, w]) => `<tr><th>${esc(label)}<br><small>${esc(sub)}</small></th>${cols.map(([c]) =>
      `<td><img style="width:${w}px" src="${pathToFileURL(path.join(OUT, 'cells', `${slug(c)}-${key}.png`)).href}"></td>`).join('')}</tr>`).join('')}</table>`;
  const hf = file.replace(/\.png$/, '.html');
  fs.writeFileSync(hf, html);
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(hf).href);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: file, fullPage: true });
  await ctx.close();
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'cells'), { recursive: true });
  const srv = await startServer({ root: REPO });
  const browser = await chromium.launch(LAUNCH);
  const runtime = JSON.parse(fs.readFileSync(path.join(REPO, 'assets/topdown/layout.runtime.json'), 'utf8'));
  const bio = Object.keys(runtime.biomes);

  // one camera per object, from the repaired sprite's contact point
  const cams = {};
  {
    const { ctx, page } = await open(browser, srv, null);
    const shadows = await page.evaluate(() => window.__PROTO.shadows());
    for (const [key, id] of OBJECTS) {
      const s = shadows.find((x) => x.id === id);
      const bi = bio.findIndex((b) => runtime.biomes[b].sprites.some((o) => o.id === id));
      const o = runtime.biomes[bio[bi]].sprites.find((x) => x.id === id);
      const camZ = s.z - 1.5;
      const sy = (wz) => VIEW.height / 2 + (wz - camZ) * PXM;
      const sx = (wx) => VIEW.width / 2 + (wx - s.x) * PXM;
      const half = Math.max(o.h * 0.62, 2.5);
      const clip = { x: Math.max(0, sx(s.x - half)), y: Math.max(0, sy(s.z - Math.min(o.h * 0.75, 6))) };
      clip.width = Math.min(VIEW.width - clip.x, 2 * half * PXM);
      clip.height = Math.min(VIEW.height - clip.y, sy(s.z + 2.2) - clip.y);
      cams[key] = { id, camX: s.x, camZ, clip };
    }
    await ctx.close();
  }

  const report = { view: VIEW, pxPerM: PXM, cams, columns: {} };
  for (const [col, ref] of COLS) {
    const { ctx, page } = await open(browser, srv, ref);
    for (const [key] of OBJECTS) {
      const C = cams[key];
      await page.evaluate(([x, z]) => { window.__CAM_X = x; window.__PROTO.go(z, 'близко'); }, [C.camX, C.camZ]);
      await rafs(page);
      await page.screenshot({ path: path.join(OUT, 'cells', `${slug(col)}-${key}.png`), clip: C.clip });
    }
    for (const id of ROUTE) {
      const c = CONFIG.checkpoints.find((x) => x.id === id);
      await page.evaluate(([z, zoom]) => { window.__CAM_X = 0; window.__PROTO.go(z, zoom); }, [c.z, c.zoom]);
      await rafs(page);
      await page.screenshot({ path: path.join(OUT, 'cells', `${slug(col)}-${id}.png`) });
    }
    report.columns[col] = {
      ref: ref || 'working tree',
      shadows: await page.evaluate((ids) => (window.__PROTO.shadows ? window.__PROTO.shadows().filter((s) => ids.includes(s.id)) : []),
        OBJECTS.map(([, id]) => id)),
    };
    await ctx.close();
  }

  await sheet(browser, path.join(OUT, 'sprite-repair-scene-review.png'),
    `sprite repair — close zoom ${PXM} px/m, ${VIEW.width}×${VIEW.height}, DPR ${CONFIG.deviceScaleFactor}, same camera per row`,
    OBJECTS.map(([key, id]) => [key, id, key, 420]), COLS, 1500);
  await sheet(browser, path.join(OUT, 'route-check-review.png'),
    'route check — real checkpoints (tests/browser/checkpoints.json), full frame',
    ROUTE.map((id) => {
      const c = CONFIG.checkpoints.find((x) => x.id === id);
      return [id, `z ${c.z} · ${c.zoom}`, id, 520];
    }), COLS, 1760);
  fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(report, null, 1) + '\n');
  await browser.close();
  await srv.close();
  console.log(`-> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
