/* Test sound for /proto/ — never committed as an asset, never served by the site.
 *
 * The committed assets/topdown/audio.json lists every sound as `planned`
 * (no files yet), so the engine requests nothing. A test that needs sound
 * answers the config with a copy where every entry is `live`, and every
 * assets/audio/* request with a synthetic WAV built here in memory (the
 * browser decodes by content, not by extension). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AUDIO_CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', 'assets', 'topdown', 'audio.json'), 'utf8'));

/* mono 16-bit PCM WAV: a quiet sine, `seconds` long, faded at both ends */
export function synthWav(freq = 220, seconds = 1, rate = 22050) {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const edge = Math.min(n / 2, rate * 0.02);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / edge, (n - 1 - i) / edge);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 0.2 * env * 32767), 44 + i * 2);
  }
  return buf;
}

/* route the page: audio.json -> all live, assets/audio/* -> synthetic WAV.
   Returns the list of audio requests the page made (config + files). */
export async function routeLiveAudio(page) {
  const seen = [];
  const live = JSON.parse(JSON.stringify(AUDIO_CONFIG));
  for (const e of [...live.biomes, ...live.transitions]) e.status = 'live';
  const tone = Object.fromEntries([...live.biomes.map((b, i) => [b.asset, synthWav(160 + 40 * i, 2)]),
    ...live.transitions.map((t, i) => [t.asset, synthWav(600 + 100 * i, 0.4)])]);
  await page.route(/\/assets\/topdown\/audio\.json$/, (r) => {
    seen.push(new URL(r.request().url()).pathname);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(live) });
  });
  await page.route(/\/assets\/audio\//, (r) => {
    const p = new URL(r.request().url()).pathname.replace(/^\//, '');
    seen.push('/' + p);
    const body = tone[p];
    r.fulfill(body ? { status: 200, contentType: 'audio/wav', body } : { status: 404, body: '' });
  });
  return seen;
}

/* every request of the page that belongs to sound (config or files) */
export const isAudioUrl = (u) => /\/assets\/audio\/|\/assets\/topdown\/audio\.json$|\.(webm|ogg|opus|wav|mp3|m4a)(\?|$)/.test(u);
