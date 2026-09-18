/* Grounding diagnostic: how a sprite meets the ground in /proto/, compared
 * across shadow models on the SAME objects, camera, zoom, viewport and layout.
 *
 *   node grounding_diag.mjs [--out <dir>] [--grounded-ref <git ref>]
 *   node grounding_diag.mjs --review <git ref> [--out <dir>]
 *
 * --review <ref>: grounding-final-review.png — BEFORE (proto/main.js of <ref>)
 * | AFTER (this working tree), same objects, camera, zoom, layout; plus
 * review.json/md with where each shadow sits relative to the contact line.
 *
 * Diagnostic only. Nothing here is runtime: /proto/main.js is patched IN
 * MEMORY (Playwright route) with the variants below; the repository files are
 * not touched. Variant E borrows the restored-foundation sprites of a git ref
 * (default origin/site-grounding-pass-1) through `git show`, also in memory.
 *
 *   A  current      sprite and runtime shadow exactly as the branch draws them
 *   B  no shadow    same sprite, runtime shadow removed for the test objects
 *   C  centred      ellipse centred ON the measured contact line, no light
 *                   offset, depth capped (0.6 m), width = contact width
 *   D  contact      no ellipse: a thin band (~0.2 m visible) right under the
 *                   contact line, contact width
 *   E  restored     PR #5 restored-foundation sprite + variant C shadow
 *
 * Outputs (in --out, default out/grounding-diag):
 *   grounding-diagnostic.png  rows = objects, columns = variants
 *   grounding-debug.png       variant A with markers: lowest alpha row,
 *                             contact line, quad bottom, shadow centre and
 *                             extent, LIGHT offset
 *   measurements.json / .md   the same numbers, in texture px, metres and
 *                             screen px at the close zoom
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
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'grounding-diag')));
const GREF = arg('--grounded-ref', 'origin/site-grounding-pass-1');
const VIEW = { width: 1280, height: 800 };
const ZOOM = 'близко';                       // 16 m frame -> 50 px per metre

const OBJECTS = [
  ['house (final)', 'home/homestead/house'],
  ['house_a', 'village/west-homes/second-house'],
  ['barn', 'village/work-yard/barn'],
  ['well', 'village/well-square/well'],
  ['lamp', 'village/well-square/lamp'],
  ['tree', 'village/west-homes/old-oak'],
  ['rock', 'mine/gate-west/rock_l.1'],
];
const VARIANTS = [
  ['A', 'current'], ['B', 'no shadow'], ['C', 'contact-centred'], ['D', 'embedded contact'],
  ['E', 'restored + centred'],
];

/* ---------------------------------------------------------------- patch */
const DIAG_JS = `
// ===== grounding diagnostic (in-memory patch, never committed) =====
const DIAG = window.__DIAG || { variant: 'A', ids: [] };
DIAG.reg = {};
function DIAG_alpha(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, img.width, img.height).data, W = img.width, H = img.height;
  const width = new Array(H).fill(0), lo = new Array(H).fill(W), hi = new Array(H).fill(-1);
  let low = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 16) {
    width[y]++; if (x < lo[y]) lo[y] = x; if (x > hi[y]) hi[y] = x; low = y; }
  let max = 0; for (let y = H >> 1; y < H; y++) max = Math.max(max, width[y]);
  let contact = low; for (let y = H - 1; y >= H >> 1; y--) if (width[y] >= 0.25 * max) { contact = y; break; }
  let a = W, b = -1; for (let y = Math.max(0, contact - Math.round(0.03 * H)); y <= contact; y++) { if (lo[y] < a) a = lo[y]; if (hi[y] > b) b = hi[y]; }
  return { H, W, low, contact, cw: (b - a + 1) / W, cc: (a + b + 1) / 2 / W - 0.5 };
}
function DIAG_ellipse(o, cxw, cz, w, d, op) {
  const q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
    map: shadowTexture(), transparent: true, opacity: op, depthTest: false, depthWrite: false, color: 0x1a1a14 }));
  q.rotation.x = -Math.PI / 2; q.position.set(cxw, 0.5, cz); q.renderOrder = ORDER.shadow; return q;
}
let DIAG_bandTex = null;
function DIAG_band(cxw, top, w, d, op) {
  if (!DIAG_bandTex) {
    const W = 256, H = 32, c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d'), im = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = 1 - y / (H - 1), u = Math.min(1, Math.min(x, W - 1 - x) / (W * 0.1));
      im.data[(y * W + x) * 4 + 3] = Math.round(255 * v * v * u); }
    cx.putImageData(im, 0, 0); DIAG_bandTex = new THREE.CanvasTexture(c);
  }
  const q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
    map: DIAG_bandTex, transparent: true, opacity: op, depthTest: false, depthWrite: false, color: 0x14140e }));
  q.rotation.x = -Math.PI / 2; q.position.set(cxw, 0.5, top + d / 2); q.renderOrder = ORDER.shadow; return q;
}
function DIAG_place(art, o, z) {
  const test = DIAG.ids.includes(o.id);
  const w = o.h * art.aspect, m = art.m;
  const quadBottom = z + o.h / 2;
  const alphaLowZ = z - o.h / 2 + (m.low + 1) / m.H * o.h;
  const contactZ = z - o.h / 2 + (m.contact + 1) / m.H * o.h;
  const cxw = o.pos[0] + m.cc * w, cw = m.cw * w;
  // A: exactly what this main.js draws; its numbers are read off the mesh
  let shadow = null, info = { kind: 'none' };
  const v = test ? DIAG.variant : 'A';
  if (v === 'A') {
    shadow = shadowFor(art, o, z);
    const g = shadow && shadow.geometry && shadow.geometry.parameters;
    if (g) info = { kind: 'mesh', cx: shadow.position.x, cz: shadow.position.z, w: g.width, d: g.height };
  }
  else if (v === 'B') { shadow = null; info = { kind: 'none' }; }
  else if (v === 'C' || v === 'E') {
    const d = Math.min(0.37 * cw, 0.6);
    shadow = DIAG_ellipse(o, cxw, contactZ, cw, d, 0.5); info = { kind: 'ellipse', cx: cxw, cz: contactZ, w: cw, d };
  } else if (v === 'D') {
    shadow = DIAG_band(cxw, contactZ - 0.05, cw * 1.02, 0.25, 0.55);
    info = { kind: 'band', cx: cxw, cz: contactZ + 0.075, w: cw * 1.02, d: 0.25 };
  }
  if (shadow) scene.add(shadow);
  const quad = flatQuad(art, o, z); scene.add(quad);
  const light = typeof LIGHT !== 'undefined' ? LIGHT : { dx: 0, dz: 0 };
  // where THIS main.js thinks the contact is, if it has contact metadata
  const meta = art.contact ? { contactZ: z - (0.5 - art.contact.contact_row) * o.h } : null;
  DIAG.reg[o.id] = { id: o.id, t: o.t, x: o.pos[0], z, h: o.h, w, texH: m.H, alphaLowRow: m.low, contactRow: m.contact,
    quadBottom, alphaLowZ, contactZ, contactX: cxw, contactW: cw, shadow: info, light, variant: v, meta };
}
window.__DIAG_API = { info: (id) => DIAG.reg[id] || null };
// ===== end diagnostic =====
`;

function patch(src, groundedTypes) {
  const rep = (a, b) => { if (!src.includes(a)) throw new Error('anchor not found: ' + a.slice(0, 60)); src = src.replace(a, b); };
  rep("import * as THREE from './vendor/three.module.min.js';",
      "import * as THREE from './vendor/three.module.min.js';\n" + DIAG_JS);
  rep("    const url = (strippedSet.has(t) ? STRIPPED : ASSETS) + t + '.webp';",
      `    const G = ${JSON.stringify(groundedTypes)};
    const url = (DIAG.variant === 'E' && G.includes(t) ? './sprites_grounded/'
                 : strippedSet.has(t) ? STRIPPED : ASSETS) + t + '.webp';`);
  rep('      aspect: map.image.width / map.image.height,', '      aspect: map.image.width / map.image.height,\n      m: DIAG_alpha(map.image),');
  rep('      scene.add(shadowFor(art, o, z));\n      scene.add(flatQuad(art, o, z));', '      DIAG_place(art, o, z);');
  rep('  camera.position.set(0, 120, state.z);\n  camera.lookAt(0, 0, state.z);',
      '  const DX = window.__DIAG_X || 0;\n  camera.position.set(DX, 120, state.z);\n  camera.lookAt(DX, 0, state.z);');
  return src;
}

/* --------------------------------------------------------------- capture */
const git = (...a) => execFileSync('git', a, { cwd: REPO, maxBuffer: 64 << 20 });
const rafs = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const REVIEW = arg('--review', null);

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'cells'), { recursive: true });
  if (REVIEW) return review();
  // the working copy may be CRLF on Windows; anchors are written with LF
  const CR = String.fromCharCode(13);
  const src = fs.readFileSync(path.join(REPO, 'proto', 'main.js'), 'utf8').split(CR).join('');
  const gindex = JSON.parse(git('show', `${GREF}:proto/sprites_grounded/index.json`).toString());
  const groundedTypes = Object.keys(gindex.sprites);
  const patched = patch(src, groundedTypes);
  const srv = await startServer({ root: REPO });
  const browser = await chromium.launch(LAUNCH);
  const ids = OBJECTS.map(([, id]) => id);
  const meas = {};
  const PXM = VIEW.height / 16;              // px per metre at the close zoom

  async function shoot(variant, debug) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript(([v, list]) => { window.__DIAG = { variant: v, ids: list }; }, [variant, ids]);
    await page.route(/\/proto\/main\.js(\?.*)?$/, (r) => r.fulfill({ contentType: 'text/javascript', body: patched }));
    await page.route(/\/proto\/sprites_grounded\/[^/]+\.webp$/, (r) => {
      const name = r.request().url().split('/').pop();
      r.fulfill({ contentType: 'image/webp', body: git('show', `${GREF}:proto/sprites_grounded/${name}`) });
    });
    await page.goto(srv.url + '/proto/');
    await page.addStyleTag({ content: '#hud{display:none!important}' });
    await page.waitForFunction(() => window.__PROTO && window.__PROTO.state.done, null, { timeout: 120000 });
    for (const [label, id] of OBJECTS) {
      const I = await page.evaluate((i) => window.__DIAG_API.info(i), id);
      if (!I) throw new Error('no such object in the scene: ' + id);
      // camera on the object's contact point, same zoom for every object
      await page.evaluate(([x, z]) => { window.__DIAG_X = x; window.__PROTO.go(z, 'близко'); }, [I.x, I.contactZ - 1.5]);
      await rafs(page);
      const camZ = I.contactZ - 1.5;
      const sy = (wz) => VIEW.height / 2 + (wz - camZ) * PXM;
      const sx = (wx) => VIEW.width / 2 + (wx - I.x) * PXM;
      // crop: the lower part of the object and 2.5 m of ground in front of it
      const half = Math.max(I.w / 2, 2) + 1.2;
      const top = Math.max(I.contactZ - Math.min(I.h, 6), I.z - I.h / 2 - 0.3);
      const clip = { x: Math.max(0, sx(I.x - half)), y: Math.max(0, sy(top)), width: 0, height: 0 };
      clip.width = Math.min(VIEW.width - clip.x, 2 * half * PXM);
      clip.height = Math.min(VIEW.height - clip.y, sy(I.contactZ + 2.8) - clip.y);
      if (debug) {
        await page.evaluate(([J, cam, pxm, vw, vh]) => {
          const c = document.createElement('canvas'); c.width = vw; c.height = vh; c.id = 'diag-overlay';
          Object.assign(c.style, { position: 'fixed', left: 0, top: 0, zIndex: 50, pointerEvents: 'none' });
          document.body.appendChild(c);
          const g = c.getContext('2d');
          const sy = (wz) => vh / 2 + (wz - cam) * pxm, sx = (wx) => vw / 2 + (wx - J.x) * pxm;
          const hline = (wz, col, lbl) => { g.strokeStyle = col; g.lineWidth = 2; g.setLineDash([]);
            g.beginPath(); g.moveTo(sx(J.x - J.w / 2), sy(wz)); g.lineTo(sx(J.x + J.w / 2), sy(wz)); g.stroke();
            g.fillStyle = col; g.font = 'bold 13px monospace'; g.fillText(lbl, sx(J.x + J.w / 2) + 4, sy(wz) + 4); };
          hline(J.alphaLowZ, '#ff3b3b', 'alpha low');
          hline(J.contactZ, '#ffd400', 'contact');
          hline(J.quadBottom, '#00e5ff', 'quad bottom');
          const S = J.shadow;
          g.strokeStyle = '#ff4df0'; g.setLineDash([6, 4]); g.lineWidth = 2;
          g.strokeRect(sx(S.cx - S.w / 2), sy(S.cz - S.d / 2), S.w * pxm, S.d * pxm);
          g.setLineDash([]); g.fillStyle = '#ff4df0';
          g.beginPath(); g.arc(sx(S.cx), sy(S.cz), 5, 0, 7); g.fill();
          g.fillText('shadow centre', sx(S.cx) + 8, sy(S.cz) + 16);
          // LIGHT offset: from the quad-bottom centre to the shadow centre
          g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath();
          g.moveTo(sx(J.x), sy(J.quadBottom)); g.lineTo(sx(J.x + J.light.dx), sy(J.quadBottom + J.light.dz)); g.stroke();
        }, [I, camZ, PXM, VIEW.width, VIEW.height]);
      }
      const file = path.join(OUT, 'cells', `${debug ? 'debug' : variant}-${label.replace(/\W+/g, '_')}.png`);
      await page.screenshot({ path: file, clip });
      if (debug) await page.evaluate(() => document.getElementById('diag-overlay').remove());
      if (variant === 'A' && !debug) {
        meas[id] = { label, ...I, shadowTopZ: I.shadow.cz - I.shadow.d / 2, shadowBottomZ: I.shadow.cz + I.shadow.d / 2 };
      }
    }
    await ctx.close();
  }

  for (const [v] of VARIANTS) await shoot(v, false);
  await shoot('A', true);

  /* ---- sheets */
  async function sheet(file, cols, title) {
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const rows = OBJECTS.map(([label, id]) => `<tr><th>${esc(label)}<br><small>${esc(id)}</small></th>`
      + cols.map(([key]) => {
        const f = path.join(OUT, 'cells', `${key}-${label.replace(/\W+/g, '_')}.png`);
        return `<td><img src="${pathToFileURL(f).href}"></td>`;
      }).join('') + '</tr>').join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#18191a;color:#e8e6dc;font:13px ui-monospace,monospace}
      table{border-collapse:separate;border-spacing:8px} th{text-align:left;vertical-align:middle;color:#ffc857;max-width:170px}
      td{vertical-align:top} img{display:block;max-width:300px;max-height:300px} small{color:#9a9e8c}
      h1{font-size:15px;margin:10px 8px 0;color:#ffc857}</style>
      <h1>${esc(title)}</h1><table><tr><th></th>${cols.map(([k, n]) => `<th>${esc(k)} · ${esc(n)}</th>`).join('')}</tr>${rows}</table>`;
    const hf = file.replace(/\.png$/, '.html');
    fs.writeFileSync(hf, html);
    const ctx = await browser.newContext({ viewport: { width: 1800, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(hf).href);
    await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await p.screenshot({ path: file, fullPage: true });
    await ctx.close();
  }
  await sheet(path.join(OUT, 'grounding-diagnostic.png'), VARIANTS,
    'grounding diagnostic — same camera (close zoom, 50 px/m), same layout; columns = shadow model');
  await sheet(path.join(OUT, 'grounding-debug.png'), [['debug', 'A + markers']],
    'red = lowest alpha row · yellow = contact line · cyan = quad bottom · magenta = shadow centre/extent · white = LIGHT offset');

  /* ---- numbers */
  const rows = Object.values(meas).map((m) => {
    const cm = (a) => +(a * 100).toFixed(0);
    return {
      object: m.label, id: m.id, t: m.t, h_m: m.h,
      alpha_low_above_quad_bottom_cm: cm(m.quadBottom - m.alphaLowZ),
      contact_above_quad_bottom_cm: cm(m.quadBottom - m.contactZ),
      shadow_centre_below_contact_cm: cm(m.shadow.cz - m.contactZ),
      shadow_centre_below_alpha_low_cm: cm(m.shadow.cz - m.alphaLowZ),
      shadow_visible_below_alpha_low_cm: cm(m.shadowBottomZ - m.alphaLowZ),
      shadow_w_m: +m.shadow.w.toFixed(2), shadow_d_m: +m.shadow.d.toFixed(2),
      contact_w_m: +m.contactW.toFixed(2),
      screen_px_contact_to_shadow_centre: +((m.shadow.cz - m.contactZ) * PXM).toFixed(0),
    };
  });
  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(rows, null, 1) + '\n');
  const md = ['| object | t | alpha low ↑ quad bottom | contact ↑ quad bottom | shadow centre ↓ contact | visible shadow ↓ alpha low | shadow w×d | contact w | px (close) |',
    '|---|---|---:|---:|---:|---:|---|---:|---:|',
    ...rows.map((r) => `| ${r.object} | ${r.t} | ${r.alpha_low_above_quad_bottom_cm} cm | ${r.contact_above_quad_bottom_cm} cm | ${r.shadow_centre_below_contact_cm} cm | ${r.shadow_visible_below_alpha_low_cm} cm | ${r.shadow_w_m}×${r.shadow_d_m} m | ${r.contact_w_m} m | ${r.screen_px_contact_to_shadow_centre} |`)];
  fs.writeFileSync(path.join(OUT, 'measurements.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
  await browser.close();
  await srv.close();
  console.log(`\n-> ${OUT}`);
}

/* ------------------------------------------------------------- review */
async function review() {
  const CR = String.fromCharCode(13);
  const before = git('show', `${REVIEW}:proto/main.js`).toString().split(CR).join('');
  const after = fs.readFileSync(path.join(REPO, 'proto', 'main.js'), 'utf8').split(CR).join('');
  const srcs = { BEFORE: patch(before, []), AFTER: patch(after, []) };
  const srv = await startServer({ root: REPO });
  const browser = await chromium.launch(LAUNCH);
  const ids = OBJECTS.map(([, id]) => id);
  const PXM = VIEW.height / 16;
  const out = {};
  for (const [col, body] of Object.entries(srcs)) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((list) => { window.__DIAG = { variant: 'A', ids: list }; }, ids);
    await page.route(/\/proto\/main\.js(\?.*)?$/, (r) => r.fulfill({ contentType: 'text/javascript', body }));
    await page.goto(srv.url + '/proto/');
    await page.addStyleTag({ content: '#hud{display:none!important}' });
    await page.waitForFunction(() => window.__PROTO && window.__PROTO.state.done, null, { timeout: 120000 });
    for (const [label, id] of OBJECTS) {
      const I = await page.evaluate((i) => window.__DIAG_API.info(i), id);
      if (!I) throw new Error('no such object in the scene: ' + id);
      // one camera for both columns: centred on the object's measured base
      const camZ = I.contactZ - 1.5;
      await page.evaluate(([x, z]) => { window.__DIAG_X = x; window.__PROTO.go(z, 'близко'); }, [I.x, camZ]);
      await rafs(page);
      const sy = (wz) => VIEW.height / 2 + (wz - camZ) * PXM;
      const sx = (wx) => VIEW.width / 2 + (wx - I.x) * PXM;
      const half = Math.max(I.w / 2, 2) + 1.2;
      const top = Math.max(I.contactZ - Math.min(I.h, 6), I.z - I.h / 2 - 0.3);
      const clip = { x: Math.max(0, sx(I.x - half)), y: Math.max(0, sy(top)) };
      clip.width = Math.min(VIEW.width - clip.x, 2 * half * PXM);
      clip.height = Math.min(VIEW.height - clip.y, sy(I.contactZ + 2.8) - clip.y);
      await page.screenshot({ path: path.join(OUT, 'cells', `${col}-${label.replace(/\W+/g, '_')}.png`), clip });
      const base = I.meta ? I.meta.contactZ : I.contactZ;
      (out[label] ||= { id, t: I.t })[col] = I.shadow.kind === 'mesh' ? {
        shadow_centre_below_base_cm: +((I.shadow.cz - base) * 100).toFixed(1),
        shadow_w_m: +I.shadow.w.toFixed(2), shadow_d_m: +I.shadow.d.toFixed(2),
        visible_below_base_cm: +((I.shadow.cz + I.shadow.d / 2 - base) * 100).toFixed(1),
      } : { shadow: 'none' };
    }
    await ctx.close();
  }
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = OBJECTS.map(([label, id]) => `<tr><th>${esc(label)}<br><small>${esc(id)}</small></th>`
    + ['BEFORE', 'AFTER'].map((c) => `<td><img src="${pathToFileURL(path.join(OUT, 'cells', `${c}-${label.replace(/\W+/g, '_')}.png`)).href}"></td>`).join('')
    + '</tr>').join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#18191a;color:#e8e6dc;font:13px ui-monospace,monospace}
    table{border-collapse:separate;border-spacing:8px} th{text-align:left;color:#ffc857;max-width:170px}
    img{display:block;max-width:420px;max-height:320px} small{color:#9a9e8c} h1{font-size:15px;margin:10px 8px 0;color:#ffc857}</style>
    <h1>grounding final review — BEFORE ${esc(REVIEW)} | AFTER working tree · close zoom 50 px/m, same camera per row</h1>
    <table><tr><th></th><th>BEFORE</th><th>AFTER</th></tr>${rows}</table>`;
  const hf = path.join(OUT, 'grounding-final-review.html');
  fs.writeFileSync(hf, html);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(hf).href);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: path.join(OUT, 'grounding-final-review.png'), fullPage: true });
  await ctx.close();
  fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(out, null, 1) + '\n');
  const md = ['| object | t | BEFORE: centre ↓ base | BEFORE w×d | BEFORE visible ↓ base | AFTER: centre ↓ base | AFTER w×d | AFTER visible ↓ base |',
    '|---|---|---:|---|---:|---:|---|---:|',
    ...Object.entries(out).map(([l, r]) => `| ${l} | ${r.t} | ${r.BEFORE.shadow_centre_below_base_cm} cm | ${r.BEFORE.shadow_w_m}×${r.BEFORE.shadow_d_m} m | ${r.BEFORE.visible_below_base_cm} cm | ${r.AFTER.shadow_centre_below_base_cm} cm | ${r.AFTER.shadow_w_m}×${r.AFTER.shadow_d_m} m | ${r.AFTER.visible_below_base_cm} cm |`)];
  fs.writeFileSync(path.join(OUT, 'review.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
  await browser.close();
  await srv.close();
  console.log(`\n-> ${path.join(OUT, 'grounding-final-review.png')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
