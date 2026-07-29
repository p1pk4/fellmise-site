/* Particles. One THREE.Points per emitter so each kind is a single draw call,
 * and they share the soft dot texture the glows use. All motion is written into
 * the position buffer on the CPU — a few dozen points per biome, so this is
 * cheaper than a custom shader and far easier to reason about.
 */

const KIND = {
  ember: { color: 0xffb257, size: 0.34, life: 1.9, vy: 3.4, spread: 0.5, add: true },
  dust:  { color: 0xb9c2d6, size: 0.16, life: 8.0, vy: 0.26, spread: 1.2, add: false },
  fly:   { color: 0xffe89a, size: 0.22, life: 5.5, vy: 0.7, spread: 2.4, add: true },
  soul:  { color: 0x9fe8ff, size: 0.34, life: 6.5, vy: 1.5, spread: 1.6, add: true },
  leaf:  { color: 0xc7d98a, size: 0.26, life: 7.5, vy: -0.5, spread: 2.0, add: false },
};

export function makeEmitters(THREE, group, biome, dotTex) {
  const out = [];
  for (const p of biome.particles || []) {
    const k = KIND[p.kind] || KIND.dust;
    const n = p.n;
    const pos = new Float32Array(n * 3);
    const seed = [];
    const [x0, y0, z0, x1, y1, z1] = p.box;
    for (let i = 0; i < n; i++) {
      const s = {
        x: x0 + Math.random() * (x1 - x0),
        y: y0 + Math.random() * (y1 - y0),
        z: z0 + Math.random() * (z1 - z0),
        t: Math.random(),
        dx: (Math.random() - 0.5) * k.spread,
        dz: (Math.random() - 0.5) * k.spread,
      };
      seed.push(s);
      pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: dotTex, color: k.color, size: k.size,
      transparent: true, depthWrite: false, sizeAttenuation: true,
      blending: k.add ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity: k.add ? 0.95 : 0.5,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 10;
    points.frustumCulled = false;
    group.add(points);
    out.push({ points, seed, k, box: p.box });
  }
  return out;
}

export function stepEmitters(state, dt) {
  for (const e of state.emitters) {
    const arr = e.points.geometry.attributes.position.array;
    const [x0, y0, z0, x1, y1, z1] = e.box;
    for (let i = 0; i < e.seed.length; i++) {
      const s = e.seed[i];
      s.t += dt / e.k.life;
      if (s.t >= 1) {
        s.t = 0;
        s.x = x0 + Math.random() * (x1 - x0);
        s.y = y0 + Math.random() * (y1 - y0);
        s.z = z0 + Math.random() * (z1 - z0);
      }
      arr[i * 3] = s.x + s.dx * s.t;
      arr[i * 3 + 1] = s.y + e.k.vy * s.t * e.k.life * 0.5;
      arr[i * 3 + 2] = s.z + s.dz * s.t;
    }
    e.points.geometry.attributes.position.needsUpdate = true;
    // fade the whole cloud in and out so respawns are never a visible pop
    e.points.material.opacity = (e.k.add ? 0.95 : 0.5) * (0.72 + 0.28 * Math.sin(state.clock.elapsedTime * 0.6));
  }
}
