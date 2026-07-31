/* Dump the current placement out of biomes.js into assets/layout.json.
 *
 *   node tools/dump_layout.mjs
 *
 * Run once, to seed the file the editor then owns. It imports the module rather
 * than parsing it, so what lands in the JSON is exactly what the renderer was
 * building — no transcription step to get wrong.
 *
 * Only placement moves out: sprites, boards and the counter. Fog, sky, ground
 * tint, particles and the gates stay in biomes.js, because they are settings of
 * a biome rather than things a person drags around with a mouse.
 */
import { writeFileSync } from 'node:fs';
import { BIOMES } from '../journey3/src/biomes.js';

/* Ids have to survive an export/import round trip and stay readable, so they are
   the sprite name plus its occurrence number within the biome. */
function ider() {
  const seen = new Map();
  return (t) => {
    const n = (seen.get(t) || 0) + 1;
    seen.set(t, n);
    return `${t}#${n}`;
  };
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

const out = { version: 1, generated: 'tools/dump_layout.mjs', biomes: {} };

for (const b of BIOMES) {
  const id = ider();
  const entry = { sprites: [], boards: [] };

  for (const s of b.sprites || []) {
    const o = {
      id: id(s.t), t: s.t, layer: s.layer,
      pos: [round(s.x), s.y === undefined ? null : round(s.y), round(s.z)],
      h: round(s.h), rotY: 0, visible: true,
    };
    // everything else the renderer understands, carried through untouched
    for (const k of ['dim', 'sway', 'blur', 'drift', 'span', 'nofog', 'shadow']) {
      if (s[k] !== undefined) o[k] = s[k];
    }
    entry.sprites.push(o);
  }

  for (const d of b.boards || []) {
    entry.boards.push({
      id: `board:${d.key}`, key: d.key, kind: d.kind,
      pos: [round(d.x), null, round(d.z)], h: round(d.h),
      rotY: round(d.ry || 0), visible: true,
    });
  }

  if (b.counter) {
    entry.counter = {
      id: 'counter', stall: { ...b.counter.stall }, items: [...b.counter.items],
      x0: b.counter.x0, step: b.counter.step, y: b.counter.y,
      z: b.counter.z, h: b.counter.h, visible: true,
    };
  }

  out.biomes[b.id] = entry;
}

writeFileSync('assets/layout.json', JSON.stringify(out, null, 1) + '\n', 'utf8');
const n = Object.values(out.biomes).reduce(
  (a, e) => a + e.sprites.length + e.boards.length + (e.counter ? 1 : 0), 0);
console.log(`assets/layout.json: ${Object.keys(out.biomes).length} биомов, ${n} объектов`);
