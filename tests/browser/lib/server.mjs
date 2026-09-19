/* Dependency-free static server for a checkout of the site.
 *
 * Serves a directory the way GitHub Pages serves the repository root:
 * directory -> index.html, `/proto` -> 301 `/proto/`, 404 otherwise. Binds to
 * 127.0.0.1 only. `startServer({ root, port })` resolves to { url, close }.
 * Port 0 picks a free one.
 *
 *   node lib/server.mjs --root ../.. --port 4173     # standalone (smoke webServer)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.zip': 'application/zip',
  '.webm': 'audio/webm', '.m4a': 'audio/mp4',
};

export function startServer({ root, port = 0 }) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.join(base, rel);
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!rel.endsWith('/')) {
          res.writeHead(301, { location: rel + '/' }).end();
          return;
        }
        file = path.join(file, 'index.html');
      }
      fs.readFile(file, (e, body) => {
        if (e) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
          return;
        }
        res.writeHead(200, {
          'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({
        url: `http://127.0.0.1:${p}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
    || process.argv[1]?.endsWith('server.mjs')) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const s = await startServer({ root: arg('--root', '.'), port: Number(arg('--port', 4173)) });
  console.log(`serving ${path.resolve(arg('--root', '.'))} at ${s.url}`);
}
