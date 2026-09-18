/* Browser smoke for fellmise.com. The site under test is a directory served as
 * static files — SITE_ROOT, the repository root by default — so the same suite
 * runs against any checkout (a PR head, main, a worktree).
 *
 *   npm run smoke                              # this checkout
 *   SITE_ROOT=/path/to/other/checkout npm run smoke
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { LAUNCH } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, process.env.SITE_ROOT || '../..');
const PORT = Number(process.env.SMOKE_PORT || 4173);
const OUT = path.resolve(HERE, '../../out/smoke');

export default defineConfig({
  testDir: './smoke',
  timeout: 150_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: 0,
  outputDir: path.join(OUT, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(OUT, 'results.json') }],
    ['html', { outputFolder: path.join(OUT, 'html'), open: 'never' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: LAUNCH,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node lib/server.mjs --root "${ROOT}" --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/robots.txt`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  metadata: { siteRoot: ROOT },
});
