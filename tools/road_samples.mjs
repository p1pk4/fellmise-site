/* Reference road samples, computed by the three.js /proto/ ships.
 *
 *   node tools/road_samples.mjs      # -> tests/fixtures/road_samples.json
 *
 * proto/main.js turns assets/road_spline.json into 64 samples with
 * THREE.CatmullRomCurve3(..., 'catmullrom', 0.5).getPoint(i / 63). The top-down
 * generator validates road clearance with a Python copy of that
 * (tools/topdown_compose.py Road); tools/test_layout.py compares the copy with
 * these samples. Re-run when road_spline.json changes — the test says so.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = await import(pathToFileURL(path.join(ROOT, 'proto/vendor/three.module.min.js')).href);
const raw = fs.readFileSync(path.join(ROOT, 'assets/road_spline.json'), 'utf8').replace(/\r\n/g, '\n');
const spline = JSON.parse(raw);
const NPTS = 64;
const curve = new THREE.CatmullRomCurve3(
  spline.points.map((p) => new THREE.Vector3(p.x, p.w, p.z)), false, 'catmullrom', 0.5);
const samples = [];
for (let i = 0; i < NPTS; i++) {
  const v = curve.getPoint(i / (NPTS - 1));
  samples.push([v.x, v.y]);
}
const out = {
  generated: 'node tools/road_samples.mjs (three.js r' + THREE.REVISION + ')',
  spline_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  samples,
};
fs.mkdirSync(path.join(ROOT, 'tests/fixtures'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/road_samples.json'), JSON.stringify(out, null, 1) + '\n');
console.log('-> tests/fixtures/road_samples.json');
