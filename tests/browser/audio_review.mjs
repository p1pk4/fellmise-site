/* Sound review for /proto/: the toggle in the frame, the state per z, and what
 * sound costs (requests, bytes, audio nodes) muted and on.
 *
 *   node audio_review.mjs [--out <dir>]        (default out/audio-review)
 *
 *   audio-ui-review.png    village / mine / spirit / home, muted and on: the
 *                          frame and the corner with the toggle (2x), + focus
 *   audio-state-report.md  z -> ambient weights -> expected ambient; SFX
 *                          anchors; requests / bytes / nodes muted and on
 *   audio-metrics.json     the same numbers, machine-readable
 *
 * Real sound files do not exist yet: "on" is measured with the synthetic WAV
 * of lib/audio_fixture.mjs (every entry switched to live), so byte counts are
 * of the fixture, not of the future assets. Nothing in the repository is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from './lib/server.mjs';
import { LAUNCH, stubExternal } from './lib/browser.mjs';
import { AUDIO_CONFIG, routeLiveAudio, isAudioUrl } from './lib/audio_fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'audio-review')));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const PRES = JSON.parse(fs.readFileSync(path.join(REPO, 'assets', 'topdown', 'layout.runtime.json'), 'utf8')).presentation;
const STOPS = [['village', -40], ['mine', -319], ['spirit', -508], ['home', -644]];

const srv = await startServer({ root: REPO });
const browser = await chromium.launch(LAUNCH);

/* count every audio node the page creates (the engine's cost when on) */
const COUNT_NODES = () => {
  window.__audioNodes = 0;
  const P = (window.BaseAudioContext || window.AudioContext || {}).prototype;
  if (!P) return;
  for (const k of ['createGain', 'createBufferSource', 'createOscillator', 'createBiquadFilter', 'createPanner', 'createStereoPanner', 'createConvolver']) {
    const f = P[k];
    if (f) P[k] = function (...a) { window.__audioNodes++; return f.apply(this, a); };
  }
};

async function session(on) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await stubExternal(p);
  await p.addInitScript(COUNT_NODES);
  const net = { requests: [], bytes: 0 };
  p.on('response', async (r) => {
    if (!isAudioUrl(r.url())) return;
    net.requests.push(new URL(r.url()).pathname);
    try { net.bytes += (await r.body()).length; } catch (e) { /* routed body */ }
  });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (on) await routeLiveAudio(p);
  await p.goto(srv.url + '/proto/');
  await p.waitForFunction(() => window.__PROTO?.state.done, null, { timeout: 120000 });
  if (on) {
    await p.locator('button.audio-toggle').click();
    await p.waitForFunction(() => window.__PROTO.audio().playing.length > 0, null, { timeout: 10000 });
  }
  return { ctx, p, net, errors };
}

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const rows = [];
const perStop = {};
for (const on of [false, true]) {
  const { ctx, p, net, errors } = await session(on);
  await p.waitForTimeout(300);
  const atStart = [...net.requests];
  const shots = [];
  for (const [label, z] of STOPS) {
    await p.evaluate((zz) => window.__PROTO.go(zz, 'auto'), z);
    await p.evaluate(frame);
    await p.waitForTimeout(on ? 400 : 150);
    const tag = `${on ? 'on' : 'muted'}-${label}`;
    const full = path.join(OUT, 'shots', `${tag}.png`);
    const corner = path.join(OUT, 'shots', `${tag}-corner.png`);
    await p.screenshot({ path: full });
    await p.screenshot({ path: corner, clip: { x: 1280 - 120, y: 800 - 90, width: 120, height: 90 } });
    const s = await p.evaluate(() => window.__PROTO.audio());
    perStop[tag] = { weights: s.weights, playing: s.playing, ambients: s.ambients };
    shots.push({ label: `${label} z ${z}${on ? ' · playing ' + s.playing.join('+') : ''}`, full, corner });
  }
  if (!on) {
    // keyboard focus ring on the toggle
    let n = 0;
    while (!(await p.locator('button.audio-toggle').evaluate((b) => b === document.activeElement)) && n++ < 20) await p.keyboard.press('Tab');
    const corner = path.join(OUT, 'shots', 'muted-focus-corner.png');
    await p.screenshot({ path: corner, clip: { x: 1280 - 120, y: 800 - 90, width: 120, height: 90 } });
    shots.push({ label: 'keyboard focus (Tab)', full: null, corner });
  }
  rows.push({ title: on ? 'sound ON (synthetic fixture)' : 'muted (default)', shots });
  // the whole route, 2 m steps, down and back: requests, bytes, nodes, voices
  let maxVoices = 0;
  await p.evaluate(() => window.__PROTO.go(10));
  const sfx0 = await p.evaluate(() => window.__PROTO.audio().sfxCount);
  for (let z = 10; z >= -662; z -= 2) {
    await p.evaluate((zz) => window.__PROTO.go(zz), z);
    if (on) maxVoices = Math.max(maxVoices, (await p.evaluate(() => window.__PROTO.audio().playing.length)));
  }
  await p.waitForTimeout(on ? 800 : 100);
  const s = await p.evaluate(() => ({ a: window.__PROTO.audio(), nodes: window.__audioNodes }));
  perStop[on ? 'on' : 'muted'] = {
    requests: [...net.requests], bytes: net.bytes, nodes: s.nodes, maxVoices, sfxCount: s.a.sfxCount - sfx0,
    context: s.a.context, atStart, errors,
  };
  await ctx.close();
}

// contact sheet
{
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#18191a;color:#e8e6dc;font:12px ui-monospace,monospace}
    h1{font-size:15px;margin:10px 12px;color:#ffc857} h2{font-size:13px;margin:6px 12px;color:#ffc857}
    .g{display:flex;flex-wrap:wrap;gap:12px;padding:0 12px 12px;align-items:flex-start} img{display:block;border:1px solid #333}
    .c{color:#cfcab8;padding:3px 0} .pair{display:flex;gap:6px;align-items:flex-end}</style>
    <h1>/proto/ sound toggle — 1280×800, bottom-right; each stop: the frame and the corner at 2x</h1>
    ${rows.map((r) => `<h2>${esc(r.title)}</h2><div class="g">${r.shots.map((s) => `<div><div class="pair">${s.full ? `<img style="width:300px" src="${pathToFileURL(s.full).href}">` : ''}<img style="width:240px" src="${pathToFileURL(s.corner).href}"></div><div class="c">${esc(s.label)}</div></div>`).join('')}</div>`).join('')}`;
  const hf = path.join(OUT, 'audio-ui-review.html');
  fs.writeFileSync(hf, html);
  const c = await browser.newContext({ viewport: { width: 1180, height: 800 } });
  const p = await c.newPage();
  await p.goto(pathToFileURL(hf).href);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: path.join(OUT, 'audio-ui-review.png'), fullPage: true });
  await c.close();
}

// state table: z -> weights (the page's own function)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
await stubExternal(p);
await p.goto(srv.url + '/proto/');
await p.waitForFunction(() => window.__PROTO?.state.done, null, { timeout: 120000 });
const zs = new Set();
for (let z = 0; z >= -660; z -= 20) zs.add(z);
for (const t of PRES.transitions) { zs.add(t.blend_z[0]); zs.add(t.anchor_z); zs.add(t.blend_z[1]); }
zs.add(-661.974);
const table = [];
for (const z of [...zs].sort((a, b) => b - a)) {
  const [w, pr] = await p.evaluate((zz) => [window.__PROTO.audio(zz), window.__PROTO.presentationAt(zz)], z);
  table.push({ z, w, ground: pr.biome + (pr.neighbour ? `→${pr.neighbour} ${pr.blend.toFixed(2)}` : '') });
}
await ctx.close();
await browser.close();
await srv.close();

const ids = PRES.biomes.map((b) => b.id);
const mark = (z) => { for (const t of PRES.transitions) { if (z === t.anchor_z) return ` ← anchor ${t.from}-${t.to} (SFX)`; if (z === t.blend_z[0]) return ` ← blend start ${t.from}-${t.to}`; if (z === t.blend_z[1]) return ` ← blend end ${t.from}-${t.to}`; } return z === -661.974 ? ' ← route end' : ''; };
const expected = (w) => Object.entries(w).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => (v === 1 ? k : `${k} ${Math.round(v * 100)}%`)).join(' + ');
const m = perStop;
const md = `# /proto/ audio — state report

Generated by \`tests/browser/audio_review.mjs\` from the running page (\`__PROTO.audio(z)\` — the engine's own
function, fed by main.js \`biomeAt\`, the same blend that mixes the ground). Weight of ambient *i* = max(0, 1 − |b − i|),
b = biome coordinate of z. Every z has exactly one state; walking back gives the same numbers.

Config: \`assets/topdown/audio.json\` — all ${AUDIO_CONFIG.biomes.length} ambients and ${AUDIO_CONFIG.transitions.length} transition SFX are **planned** (no files yet).

## z → weights → expected ambient

| z | ${ids.join(' | ')} | ground (presentationAt) | expected ambient |
|---:|${ids.map(() => '---:').join('|')}|---|---|
${table.map((r) => `| ${r.z}${mark(r.z)} | ${ids.map((i) => (r.w[i] ? r.w[i].toFixed(2) : '·')).join(' | ')} | ${r.ground} | ${expected(r.w)} |`).join('\n')}

## Transition SFX

| transition | anchor z | fires | re-armed |
|---|---:|---|---|
${PRES.transitions.map((t) => `| ${t.from}-${t.to} | ${t.anchor_z} | camera crosses ${t.anchor_z} going down the route (z decreasing) | after the camera is back above ${+(t.anchor_z + 8).toFixed(3)} (anchor + 8 m) |`).join('\n')}

Backward rule (the minimal one): walking back up the route plays nothing, and a crossing re-arms only 8 m back above the
anchor, so wheel jitter at an anchor plays the SFX once. A jump over several anchors (\`__PROTO.go\`) plays each crossed one once.

## Cost

| | muted (default) | sound on (synthetic fixture) |
|---|---|---|
| audio requests right after load / after the toggle | ${m.muted.atStart.length} | ${m.on.atStart.length} (${m.on.atStart.join(', ')}) |
| audio requests, all (4 stops + whole route down) | ${m.muted.requests.length} | ${m.on.requests.length} |
| audio bytes, all | ${m.muted.bytes} | ${m.on.bytes} (fixture WAV, not the future assets) |
| AudioContext | ${m.muted.context} | ${m.on.context} |
| audio nodes created, all | ${m.muted.nodes} | ${m.on.nodes} |
| ambient voices at once (max) | 0 | ${m.on.maxVoices} |
| SFX fired, whole route down | ${m.muted.sfxCount} (counted, silent) | ${m.on.sfxCount} |
| console errors | ${m.muted.errors.length} | ${m.on.errors.length} |

All requests with sound on: ${m.on.requests.map((r) => '`' + r + '`').join(', ')}.

## At the review stops (sound on)

| stop | weights | playing |
|---|---|---|
${STOPS.map(([l]) => { const s = m['on-' + l]; return `| ${l} | ${expected(s.weights)} | ${s.playing.join(', ')} |`; }).join('\n')}
`;
fs.writeFileSync(path.join(OUT, 'audio-state-report.md'), md);
fs.writeFileSync(path.join(OUT, 'audio-metrics.json'), JSON.stringify(perStop, null, 1));
console.log(`-> ${OUT}`, JSON.stringify({ muted: m.muted, on: { ...m.on, requests: m.on.requests.length } }));
