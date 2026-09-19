/* Visual regression for fellmise.com: capture checkpoints, compare two runs.
 *
 *   node visual.mjs capture  --root <site dir> --out <dir> [--mutate]
 *   node visual.mjs compare  --base <dir> --head <dir> --out <dir> [--mode report|strict]
 *   node visual.mjs run      --base <git ref> [--head <git ref>|.] [--out <dir>] [--mode report|strict]
 *   node visual.mjs selftest [--out <dir>]
 *
 * Checkpoints, viewport and tolerances live in checkpoints.json, not here.
 * Screenshots are PNG and never committed: base and head are rendered in the
 * same environment (same machine, browser, GPU emulation) at the time of the
 * comparison, so there is no stored baseline to go stale.
 *
 * Modes:
 *   report  differences are measured and written; exit 0 unless head could
 *           not be captured at all.
 *   strict  any checkpoint over tolerance.strict_max_changed_pixels, or a
 *           checkpoint missing on either side, exits 1. For changes that are
 *           supposed to be invisible.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { startServer } from './lib/server.mjs';
import { LAUNCH, stubExternal } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'checkpoints.json'), 'utf8'));

function args() {
  const a = process.argv.slice(3), o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
  return o;
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
/* HEAD of the checkout, with `+dirty` when tracked files differ from it — a
   working-tree capture must not pass itself off as the commit. */
function shaOf(dir) {
  try {
    const sha = git(dir, 'rev-parse', 'HEAD');
    return git(dir, 'status', '--porcelain', '--untracked-files=no') ? `${sha}+dirty` : sha;
  } catch { return null; }
}
const rafs = (page) => page.evaluate(() => new Promise((r) =>
  requestAnimationFrame(() => requestAnimationFrame(r))));

/* ------------------------------------------------------------------ capture */
export async function capture({ root, out, mutate = false, quiet = false }) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const srv = await startServer({ root });
  const browser = await chromium.launch(LAUNCH);
  const meta = {
    root: path.resolve(root), sha: shaOf(root), browser: `chromium ${browser.version()}`,
    viewport: CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor,
    mutated: mutate ? 'road_half_width x1.6 in every layout json (self-test)' : null,
    time: new Date().toISOString(), shots: {}, errors: [],
  };
  try {
    const byRoute = new Map();
    for (const c of CONFIG.checkpoints) {
      if (!byRoute.has(c.route)) byRoute.set(c.route, []);
      byRoute.get(c.route).push(c);
    }
    for (const [route, list] of byRoute) {
      const rc = CONFIG.routes[route];
      const ctx = await browser.newContext({
        viewport: CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor,
        reducedMotion: 'no-preference',
      });
      const page = await ctx.newPage();
      await stubExternal(page);
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      if (mutate) {
        await page.route(/\/layout[^/]*\.json$/, async (r) => {
          const resp = await r.fetch();
          const j = await resp.json();
          if (typeof j.road_half_width === 'number') j.road_half_width *= 1.6;
          if (j.debug && typeof j.debug.road_half_width === 'number') j.debug.road_half_width *= 1.6;
          await r.fulfill({ response: resp, json: j });
        });
      }
      try {
        await page.goto(srv.url + route);
        await page.waitForFunction(rc.ready, null, { timeout: rc.readyTimeoutMs });
      } catch (e) {
        meta.errors.push(`${route}: не дождался готовности (${rc.ready}): ${e.message.split('\n')[0]}`
                         + (pageErrors.length ? ` | pageerror: ${pageErrors.join('; ')}` : ''));
        await ctx.close();
        continue;
      }
      for (const c of list) {
        await page.evaluate(([z, zoom]) => window.__PROTO.go(z, zoom), [c.z, c.zoom]);
        // world checkpoints judge the world, content checkpoints (with a
        // `content` field) judge the cards: the DOM card layer is shown only
        // on the latter. A page without the layer is unaffected.
        await page.evaluate((show) => {
          const o = document.getElementById('content-overlay');
          if (o) o.style.visibility = show ? '' : 'hidden';
        }, !!c.content);
        await rafs(page);        // the frame go() drew has to reach the compositor
        const file = path.join(out, `${c.id}.png`);
        await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
        // what the page says is under the camera (biome, blend, dim) — debug
        // metadata for the report; pages without the hook just leave it out
        const presentation = await page.evaluate(
          (z) => (window.__PROTO && window.__PROTO.presentationAt ? window.__PROTO.presentationAt(z) : null), c.z);
        meta.shots[c.id] = { file: `${c.id}.png`, route, z: c.z, zoom: c.zoom, presentation };
        if (!quiet) console.log(`  ${c.id}`);
      }
      if (pageErrors.length) meta.errors.push(`${route}: pageerror: ${pageErrors.join('; ')}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
  return meta;
}

/* ------------------------------------------------------------------ compare */
function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function diffPair(a, b, channelTol) {
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeMismatch: true, changed: a.width * a.height, ratio: 1, maxDelta: 255, meanDelta: 255 };
  }
  const n = a.width * a.height;
  const out = new PNG({ width: a.width, height: a.height });
  let changed = 0, maxDelta = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]),
                       Math.abs(a.data[o + 2] - b.data[o + 2]), Math.abs(a.data[o + 3] - b.data[o + 3]));
    sum += d;
    if (d > maxDelta) maxDelta = d;
    if (d > channelTol) {
      changed++;
      out.data[o] = 255; out.data[o + 1] = 0; out.data[o + 2] = 40; out.data[o + 3] = 255;
    } else {
      // the unchanged picture, greyed and faded, so the red reads as a location
      const g = (b.data[o] * 0.3 + b.data[o + 1] * 0.59 + b.data[o + 2] * 0.11) * 0.35 + 150;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = g; out.data[o + 3] = 255;
    }
  }
  return { changed, ratio: changed / n, maxDelta, meanDelta: sum / n, png: out };
}

export async function compare({ base, head, out, mode = 'report', title = 'visual', smoke = null }) {
  const tol = CONFIG.tolerance;
  fs.mkdirSync(path.join(out, 'diff'), { recursive: true });
  const bm = readMeta(base), hm = readMeta(head);
  const rows = [];
  for (const c of CONFIG.checkpoints) {
    const fb = path.join(base, `${c.id}.png`), fh = path.join(head, `${c.id}.png`);
    const row = { id: c.id, route: c.route, z: c.z, zoom: c.zoom,
                  presentation: hm.shots?.[c.id]?.presentation ?? null };
    if (!fs.existsSync(fh)) {
      Object.assign(row, { result: 'MISSING-HEAD' });
    } else if (!fs.existsSync(fb)) {
      Object.assign(row, { result: 'MISSING-BASE' });
    } else {
      const a = readPng(fb), b = readPng(fh);
      const d = diffPair(a, b, tol.channel);
      Object.assign(row, {
        width: b.width, height: b.height, changed: d.changed,
        ratio: +d.ratio.toFixed(6), maxDelta: d.maxDelta, meanDelta: +d.meanDelta.toFixed(4),
        sizeMismatch: !!d.sizeMismatch,
        result: d.changed === 0 ? 'SAME' : (d.changed <= tol.strict_max_changed_pixels ? 'WITHIN-TOLERANCE' : 'CHANGED'),
      });
      if (d.changed && d.png) {
        fs.writeFileSync(path.join(out, 'diff', `${c.id}.png`), PNG.sync.write(d.png));
        row.diff = `diff/${c.id}.png`;
      }
    }
    rows.push(row);
  }
  const changed = rows.filter((r) => r.result === 'CHANGED');
  const missingHead = rows.filter((r) => r.result === 'MISSING-HEAD');
  const missingBase = rows.filter((r) => r.result === 'MISSING-BASE');
  const visual = changed.length || missingHead.length || missingBase.length ? 'CHANGED' : 'SAME';
  let fail = missingHead.length > 0;
  if (mode === 'strict' && (changed.length || missingBase.length)) fail = true;

  const sheet = await contactSheet(head, hm, path.join(out, 'contact-sheet.png'));
  const report = {
    title, mode, visual, result: fail ? 'FAIL' : 'PASS', smoke,
    contactSheet: sheet ? `${sheet} (head, по маршруту)` : null,
    artifact: process.env.VISUAL_ARTIFACT || null,
    base: { dir: path.resolve(base), sha: bm.sha, browser: bm.browser, errors: bm.errors || [] },
    head: { dir: path.resolve(head), sha: hm.sha, browser: hm.browser, errors: hm.errors || [] },
    viewport: CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor, tolerance: tol,
    time: new Date().toISOString(), checkpoints: rows,
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  const md = markdown(report);
  fs.writeFileSync(path.join(out, 'report.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
  return report;
}

/* One PNG with every head checkpoint in ROUTE order (by camera z), two per
   row, each frame at half size with its caption UNDER it — checkpoint, z,
   zoom, and what presentation says is there (biome, ground, blend, dim).
   Rendered by the same Chromium from a throwaway HTML page, so captions need
   no image library; the frames themselves are untouched. */
async function contactSheet(dir, meta, file) {
  const cps = CONFIG.checkpoints.filter((c) => fs.existsSync(path.join(dir, `${c.id}.png`)))
    .sort((x, y) => y.z - x.z);
  if (!cps.length) return null;
  const esc = (t) => String(t).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const cell = (c, k) => {
    const p = meta.shots?.[c.id]?.presentation;
    const where = p ? `${p.biome}${p.neighbour ? ' → ' + p.neighbour : ''} · грунт ${p.ground}`
      + ` · blend ${p.blend.toFixed(2)} · затемнение ${p.overlay.toFixed(2)}` : '';
    const src = pathToFileURL(path.join(dir, `${c.id}.png`)).href;
    return `<figure><img src="${src}"><figcaption><b>${k + 1}. ${esc(c.id)}</b> · z ${c.z} · ${esc(c.zoom)}`
      + `<br>${esc(where)}</figcaption></figure>`;
  };
  const w = CONFIG.viewport.width / 2, h = CONFIG.viewport.height / 2;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#18191a;color:#e8e6dc;font:13px/1.35 ui-monospace,monospace}
    main{display:grid;grid-template-columns:repeat(2,${w}px);gap:10px;padding:10px}
    figure{margin:0} img{display:block;width:${w}px;height:${h}px}
    figcaption{padding:4px 2px 0} b{color:#ffc857}
    header{padding:10px 10px 0;color:#9a9e8c}</style>
    <header>${esc(meta.sha || '')} · ${esc(meta.browser || '')} · ${CONFIG.viewport.width}×${CONFIG.viewport.height} DPR ${CONFIG.deviceScaleFactor}</header>
    <main>${cps.map(cell).join('')}</main>`;
  const htmlFile = file.replace(/\.png$/, '.html');
  fs.writeFileSync(htmlFile, html);
  const browser = await chromium.launch(LAUNCH);
  try {
    const page = await (await browser.newContext({ viewport: { width: w * 2 + 30, height: 600 } })).newPage();
    await page.goto(pathToFileURL(htmlFile).href);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await browser.close();
  }
  return path.basename(file);
}

function readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return {}; }
}

function markdown(r) {
  const short = (s) => (s ? s.slice(0, 10) + (s.endsWith('+dirty') ? '+dirty' : '') : 'n/a');
  const L = [`### ${r.title}`, '',
    '| Checkpoint | Changed pixels | Ratio | Max Δ | Result | z · biome · ground · blend · dim |',
    '|---|---:|---:|---:|---|---|'];
  for (const c of r.checkpoints) {
    const p = c.presentation;
    const where = p ? `${c.z} · ${p.biome}${p.neighbour ? '→' + p.neighbour : ''} · ${p.ground} · ${p.blend} · ${p.overlay}` : `${c.z}`;
    L.push(`| ${c.id} | ${c.changed ?? '—'} | ${c.ratio !== undefined ? (c.ratio * 100).toFixed(4) + '%' : '—'} | ${c.maxDelta ?? '—'} | ${c.result} | ${where} |`);
  }
  L.push('', '```',
    `SMOKE:  ${r.smoke || 'n/a'}`,
    `VISUAL: ${r.visual}`,
    `MODE:   ${r.mode} -> ${r.result}`,
    `BASE:   ${short(r.base.sha)} (${r.base.browser || 'n/a'})`,
    `HEAD:   ${short(r.head.sha)} (${r.head.browser || 'n/a'})`,
    '```');
  if (r.contactSheet || r.artifact) {
    L.push('', `Скрины, diff и contact sheet: artifact **${r.artifact || 'out/visual'}**`
      + (r.contactSheet ? ` → \`${r.contactSheet.split(' ')[0]}\`` : ''));
  }
  for (const [side, m] of [['base', r.base], ['head', r.head]]) {
    for (const e of m.errors) L.push(`- ${side}: ${e}`);
  }
  return L.join('\n') + '\n';
}

/* --------------------------------------------------------------------- run */
function worktree(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fellmise-visual-'));
  git(REPO, 'worktree', 'add', '--detach', '--force', dir, ref);
  return { dir, drop: () => { try { git(REPO, 'worktree', 'remove', '--force', dir); } catch { /* gone */ } } };
}

function smokeStatus(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')).stats;
    return s.unexpected ? `FAIL (${s.unexpected} unexpected, ${s.expected} passed)`
                        : `PASS (${s.expected} passed, ${s.skipped} skipped, ${s.flaky} flaky)`;
  } catch { return null; }
}

async function run(o) {
  if (!o.base) throw new Error('--base <git ref> обязателен');
  const out = path.resolve(o.out || path.join(REPO, 'out', 'visual'));
  const mode = o.mode || 'report';
  const trees = [];
  try {
    const b = worktree(o.base);
    trees.push(b);
    let headDir = REPO;
    if (o.head && o.head !== '.') {
      const h = worktree(o.head);
      trees.push(h);
      headDir = h.dir;
    }
    console.log(`base ${o.base} -> ${b.dir}`);
    await capture({ root: b.dir, out: path.join(out, 'base') });
    console.log(`head ${o.head || '.'} -> ${headDir}`);
    await capture({ root: headDir, out: path.join(out, 'head') });
    const r = await compare({ base: path.join(out, 'base'), head: path.join(out, 'head'), out, mode,
                        title: o.title || `visual: ${o.base} -> ${o.head || 'working tree'}`,
                        smoke: smokeStatus(o.smoke) });
    return r.result === 'PASS' ? 0 : 1;
  } finally {
    for (const t of trees) t.drop();
  }
}

/* ---------------------------------------------------------------- selftest */
/* The runner must not be a test that compares a picture with itself:
     1. two captures of the same tree must be SAME in strict mode;
     2. a capture with a known mutation must be CHANGED on most checkpoints. */
async function selftest(o) {
  const out = path.resolve(o.out || path.join(REPO, 'out', 'visual-selftest'));
  const root = o.root || REPO;
  await capture({ root, out: path.join(out, 'a'), quiet: true });
  await capture({ root, out: path.join(out, 'b'), quiet: true });
  await capture({ root, out: path.join(out, 'mutated'), mutate: true, quiet: true });
  const same = await compare({ base: path.join(out, 'a'), head: path.join(out, 'b'),
                         out: path.join(out, 'repeat'), mode: 'strict',
                         title: 'self-test 1: same tree twice (strict)' });
  const mut = await compare({ base: path.join(out, 'a'), head: path.join(out, 'mutated'),
                        out: path.join(out, 'mutation'), mode: 'report',
                        title: 'self-test 2: road_half_width x1.6 must be detected' });
  const caught = mut.checkpoints.filter((c) => c.result === 'CHANGED').length;
  const need = Math.ceil(CONFIG.checkpoints.length / 2);
  const ok = same.result === 'PASS' && same.visual === 'SAME' && caught >= need;
  const line = `SELFTEST: ${ok ? 'PASS' : 'FAIL'} — repeat ${same.visual}, mutation caught on ${caught}/${CONFIG.checkpoints.length} (need >= ${need})`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**${line}**\n`);
  return ok ? 0 : 1;
}

/* --------------------------------------------------------------------- cli */
const cmd = process.argv[2];
const o = args();
let code = 0;
try {
  if (cmd === 'capture') {
    const m = await capture({ root: o.root || REPO, out: path.resolve(o.out || path.join(REPO, 'out', 'visual', 'head')), mutate: !!o.mutate });
    if (m.errors.length) { console.error(m.errors.join('\n')); code = 1; }
  } else if (cmd === 'compare') {
    const r = await compare({ base: o.base, head: o.head, out: path.resolve(o.out || path.join(REPO, 'out', 'visual')),
                        mode: o.mode || 'report', title: o.title, smoke: smokeStatus(o.smoke) });
    code = r.result === 'PASS' ? 0 : 1;
  } else if (cmd === 'run') {
    code = await run(o);
  } else if (cmd === 'selftest') {
    code = await selftest(o);
  } else {
    console.error('usage: node visual.mjs capture|compare|run|selftest — см. шапку файла');
    code = 2;
  }
} catch (e) {
  console.error(e);
  code = 1;
}
process.exit(code);
