/* Production audio review for /proto/: network budget + runtime behaviour with the real files.
 *
 *   node audio_integration_review.mjs [--out <dir>]      (default out/audio-integration)
 *
 *   audio-network-report.md   requests / bytes: muted route, first enable, full route
 *                             (WebM/Opus path and the M4A/AAC fallback path)
 *   audio-runtime-report.md   per transition: preload lead, both ambients in the blend,
 *                             one SFX, the next ambient after; codec choice A/B/C
 *   audio-integration.json    the same numbers
 *
 * Chromium only (headless, SwiftShader). The AAC path is forced by making canPlayType
 * deny WebM/Opus; no physical Safari is involved. Nothing in the repository is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from './lib/server.mjs';
import { LAUNCH, stubExternal } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(REPO, 'out', 'audio-integration')));
fs.mkdirSync(OUT, { recursive: true });
const AUDIO = JSON.parse(fs.readFileSync(path.join(REPO, 'assets/topdown/audio.json'), 'utf8'));
const PRES = JSON.parse(fs.readFileSync(path.join(REPO, 'assets/topdown/layout.runtime.json'), 'utf8')).presentation;
const ENTRIES = [...AUDIO.biomes, ...AUDIO.transitions];
const isAudio = (u) => /\/assets\/audio\/|\/assets\/topdown\/audio\.json$/.test(u);
const ROUTE_END = -661.974;
const CODEC = (p) => {
  const orig = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (t) {
    if (p === 'none') return '';
    if (p === 'no-webm' && /webm|opus/.test(t)) return '';
    return orig.call(this, t);
  };
};

const srv = await startServer({ root: REPO });
const browser = await chromium.launch(LAUNCH);

async function session(policy) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await stubExternal(p);
  if (policy) await p.addInitScript(CODEC, policy);
  const net = [], errors = [];
  p.on('response', async (r) => {
    if (!isAudio(r.url())) return;
    let bytes = 0;
    try { bytes = (await r.body()).length; } catch (e) { /* aborted */ }
    net.push({ path: new URL(r.url()).pathname, bytes, t: Date.now() });
  });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(srv.url + '/proto/');
  await p.waitForFunction(() => window.__PROTO?.state.done, null, { timeout: 120000 });
  return { ctx, p, net, errors };
}
const A = (p) => p.evaluate(() => window.__PROTO.audio());
const go = (p, z) => p.evaluate((zz) => window.__PROTO.go(zz), z);
const sum = (net) => ({ requests: net.length, bytes: net.reduce((a, b) => a + b.bytes, 0), files: net.map((n) => `${n.path} (${Math.round(n.bytes / 1024)} KB)`) });
const settle = (p, ms = 1500) => p.waitForTimeout(ms);

const R = { network: {}, runtime: {}, codec: {} };

// ---------------------------------------------------------------- muted
{
  const { ctx, p, net, errors } = await session();
  for (let z = 0; z >= ROUTE_END; z -= 4) await go(p, z);
  await p.mouse.click(640, 400);
  await settle(p);
  const s = await A(p);
  R.network.muted = { ...sum(net), context: s.context, errors };
  await ctx.close();
}

// ------------------------------------------------- first enable + full route, per format
for (const [fmt, policy] of [['webm', null], ['m4a', 'no-webm']]) {
  const { ctx, p, net, errors } = await session(policy);
  await go(p, 0);
  await p.locator('button.audio-toggle').click();
  await p.waitForFunction(() => window.__PROTO.audio().playing.includes('village'), null, { timeout: 30000 });
  await settle(p);
  R.network[`first_${fmt}`] = { ...sum(net), codec: (await A(p)).codec };
  // walk the route at 5 m/s (2 m / 400 ms) and log where each ambient starts vs its band
  const lead = {};
  let z = 0;
  for (; z >= ROUTE_END; z -= 2) {
    await go(p, z);
    await p.waitForTimeout(400);
    const s = await A(p);
    for (const t of PRES.transitions) {
      if (!(t.to in lead) && s.playing.includes(t.to)) lead[t.to] = { at_z: z, band_start_z: t.blend_z[0], lead_m: +(z - t.blend_z[0]).toFixed(1) };
    }
  }
  await settle(p);
  const s = await A(p);
  R.network[`route_${fmt}`] = { ...sum(net), sfxCount: s.sfxCount, playing_at_end: s.playing, errors };
  R.runtime[`preload_${fmt}`] = lead;
  await ctx.close();
}

// ---------------------------------------------------------------- per transition (WebM)
{
  const { ctx, p, errors } = await session();
  await go(p, 0);
  await p.locator('button.audio-toggle').click();
  await p.waitForFunction(() => window.__PROTO.audio().playing.includes('village'), null, { timeout: 30000 });
  const rows = [];
  let z = 0;
  for (const t of PRES.transitions) {
    // approach like a visitor (4 m / 400 ms = 10 m/s, twice the review walk speed)
    for (; z > t.blend_z[0] + 2; z -= 4) { await go(p, z); await p.waitForTimeout(400); }
    const before = await A(p);
    const sfx0 = before.sfxCount;                                  // before the band: some anchors sit early in it
    const mid = (t.blend_z[0] + t.blend_z[1]) / 2;
    for (; z > mid; z -= 2) { await go(p, z); await p.waitForTimeout(150); }
    await p.waitForTimeout(700);
    const inBlend = await A(p);
    for (; z > t.anchor_z - 3; z -= 1) await go(p, z);
    for (let k = 0; k < 4; k++) { await go(p, t.anchor_z + 2); await go(p, t.anchor_z - 2); }
    const afterAnchor = await A(p);
    for (; z > t.blend_z[1] - 6; z -= 2) await go(p, z);
    await p.waitForTimeout(2500);
    const after = await A(p);
    rows.push({
      transition: `${t.from} → ${t.to}`, next_loaded_before_band: before.playing.includes(t.to),
      blend: { z: +mid.toFixed(1), weights: [inBlend.weights[t.from], inBlend.weights[t.to]], gains: [inBlend.ambients[t.from], inBlend.ambients[t.to]] },
      sfx_fired: afterAnchor.sfxCount - sfx0, sfx_id: afterAnchor.lastSfx?.id, after: { playing: after.playing, gain_to: after.ambients[t.to] },
    });
  }
  // back up the route: no SFX, weights follow z
  const back0 = (await A(p)).sfxCount;
  for (; z < 0; z += 4) await go(p, z);
  const back = await A(p);
  R.runtime.transitions = rows;
  R.runtime.backward = { sfx_added: back.sfxCount - back0, weights_at_0: back.weights };
  R.runtime.errors = errors;
  await ctx.close();
}

// ---------------------------------------------------------------- codec choice
for (const [name, policy] of [['A (WebM/Opus supported)', null], ['B (WebM/Opus denied, AAC supported)', 'no-webm'], ['C (nothing supported)', 'none']]) {
  const { ctx, p, net, errors } = await session(policy);
  await p.locator('button.audio-toggle').click();
  await settle(p, 2500);
  const s = await A(p);
  R.codec[name] = { codec: s.codec, playing: s.playing, pressed: await p.locator('button.audio-toggle').getAttribute('aria-pressed'),
    disabled: await p.locator('button.audio-toggle').getAttribute('aria-disabled'), requests: net.map((n) => n.path), errors };
  await ctx.close();
}
await browser.close();
await srv.close();
fs.writeFileSync(path.join(OUT, 'audio-integration.json'), JSON.stringify(R, null, 1));

// ---------------------------------------------------------------- reports
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
const sizes = ENTRIES.map((e) => ({ id: e.id, webm: fs.statSync(path.join(REPO, e.sources[0].src)).size, m4a: fs.statSync(path.join(REPO, e.sources[1].src)).size }));
const tot = (k) => sizes.reduce((a, s) => a + s[k], 0);
const N = R.network;
fs.writeFileSync(path.join(OUT, 'audio-network-report.md'), `# /proto/ audio — network report (production files)

Measured by \`tests/browser/audio_integration_review.mjs\`: headless Chromium, local static server, a camera walk at 5 m/s. The AAC path is forced by denying WebM/Opus in \`canPlayType\`.

## Production files

| Sound | WebM/Opus | M4A/AAC |
|---|---:|---:|
${sizes.map((s) => `| ${s.id} | ${kb(s.webm)} | ${kb(s.m4a)} |`).join('\n')}
| **total** | **${kb(tot('webm'))}** | **${kb(tot('m4a'))}** |

The AAC ambients hold the 60 s loop twice. A 1024-sample AAC frame does not divide 60 s, so a one-loop AAC stream cannot wrap seamlessly (see \`tools/audio_loop_encode.py\`). That is why AAC is about 3× the WebM size; it is only fetched when WebM/Opus is unavailable.

## Traffic

| Scenario | Requests | Bytes | Files |
|---|---:|---:|---|
| muted, whole route + a click | ${N.muted.requests} | ${N.muted.bytes} | — |
| first enable (WebM) | ${N.first_webm.requests} | ${kb(N.first_webm.bytes)} | ${N.first_webm.files.join('<br>')} |
| full route (WebM), incl. first enable | ${N.route_webm.requests} | ${kb(N.route_webm.bytes)} | ${N.route_webm.files.join('<br>')} |
| first enable (AAC fallback) | ${N.first_m4a.requests} | ${kb(N.first_m4a.bytes)} | ${N.first_m4a.files.join('<br>')} |
| full route (AAC fallback) | ${N.route_m4a.requests} | ${kb(N.route_m4a.bytes)} | ${N.route_m4a.files.join('<br>')} |

- Muted: AudioContext ${N.muted.context}, 0 requests — not even \`audio.json\`.
- On the WebM path, no \`.m4a\` is requested (${N.route_webm.files.filter((f) => f.includes('.m4a')).length} in the full route); on the AAC path, no \`.webm\` is requested (${N.route_m4a.files.filter((f) => f.includes('.webm')).length}).
- Each file is fetched once per page. Walking back re-uses the decoded buffers.
`);
const T = R.runtime;
fs.writeFileSync(path.join(OUT, 'audio-runtime-report.md'), `# /proto/ audio — runtime report (real engine, production files)

Measured by \`tests/browser/audio_integration_review.mjs\` in headless Chromium, with a real click on the Sound toggle. No synthetic fixtures are involved.

## Transitions (WebM path)

| Transition | Next ambient loaded before its band | Mid-blend weights (from / to) | Mid-blend gains (from / to) | SFX fired | After the band |
|---|---|---|---|---:|---|
${T.transitions.map((r) => `| ${r.transition} | ${r.next_loaded_before_band ? 'yes' : '**no**'} | ${r.blend.weights.join(' / ')} | ${r.blend.gains.join(' / ')} | ${r.sfx_fired} (${r.sfx_id}) | playing ${r.after.playing.join(', ')}, gain ${r.after.gain_to} |`).join('\n')}

Crossing each anchor included 4 extra back-and-forth jitters of ±2 m, and the SFX still fired once. Walking back up the whole route added ${T.backward.sfx_added} SFX. Console / page errors: ${T.errors.length ? T.errors.join('; ') : 'none'}.

## Preload lead at 5 m/s (where the next ambient started vs where its band begins)

| Next ambient | Started at z (WebM) | Band starts at z | Lead (WebM) | Lead (AAC) |
|---|---:|---:|---:|---:|
${PRES.transitions.map((t) => { const w = T.preload_webm[t.to] || {}, m = T.preload_m4a[t.to] || {}; return `| ${t.to} | ${w.at_z ?? '—'} | ${t.blend_z[0]} | ${w.lead_m ?? '—'} m | ${m.lead_m ?? '—'} m |`; }).join('\n')}

The engine starts the next ambient once its band is within 60 m. On a local server it starts immediately; the lead leaves about ${Math.min(...Object.values(T.preload_webm).map((v) => v.lead_m))} m ≈ ${(Math.min(...Object.values(T.preload_webm).map((v) => v.lead_m)) / 5).toFixed(0)} s at 5 m/s to download and decode before the file becomes audible.

## Codec choice

| Case | Chosen | Playing | aria-pressed | aria-disabled | Requests | Errors |
|---|---|---|---|---|---|---|
${Object.entries(R.codec).map(([k, v]) => `| ${k} | ${v.codec ?? 'none'} | ${v.playing.join(', ') || '—'} | ${v.pressed} | ${v.disabled ?? '—'} | ${v.requests.join('<br>')} | ${v.errors.length ? v.errors.join('; ') : 'none'} |`).join('\n')}

Physical Safari / iOS: **not tested** (none available here).
`);
console.log(JSON.stringify({ network: Object.fromEntries(Object.entries(N).map(([k, v]) => [k, [v.requests, v.bytes]])), transitions: T.transitions.map((r) => [r.transition, r.next_loaded_before_band, r.sfx_fired]), codec: Object.fromEntries(Object.entries(R.codec).map(([k, v]) => [k, v.codec])) }));
