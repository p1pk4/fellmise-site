/* Baseline trace: console messages and network of each page, as they are now.
 * Diagnostic only (not part of CI): `node lib/trace.mjs [siteRoot]`. */
import { chromium } from '@playwright/test';
import { startServer } from './server.mjs';
import { LAUNCH, stubExternal } from './browser.mjs';

const root = process.argv[2] || '../..';
const srv = await startServer({ root });
const browser = await chromium.launch(LAUNCH);
const pages = [
  ['/', {}], ['/ru/', {}], ['/proto/', {}], ['/next/', {}],
  ['/next/', { viewport: { width: 600, height: 900 } }],
  ['/next/', { reducedMotion: 'reduce' }], ['/full/', {}],
];
for (const [route, opts] of pages) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  const ext = await stubExternal(page);
  const log = [], reqs = [], failed = [];
  page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => log.push(`PAGEERROR: ${e.message}`));
  page.on('requestfinished', async (r) => {
    const resp = await r.response();
    reqs.push(`${resp ? resp.status() : '---'} ${r.url().replace(srv.url, '')}`);
  });
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  await page.goto(srv.url + route);
  await page.waitForTimeout(route.startsWith('/next') || route === '/proto/' ? 15000 : 1500);
  const body = await page.evaluate(() => document.body.className);
  console.log(`\n=== ${route} ${JSON.stringify(opts)} body="${body}"`);
  console.log('console:', log.length ? '\n  ' + log.join('\n  ') : 'none');
  console.log('failed:', failed.length ? failed : 'none', '| external stubbed:', ext);
  console.log(`requests ${reqs.length}:`, reqs.slice(0, 12).join(' | '), reqs.length > 12 ? '…' : '');
  await ctx.close();
}
await browser.close();
await srv.close();
