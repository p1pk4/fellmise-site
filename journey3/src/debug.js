/* Debug overlays — loaded only for ?debug=…, and only then.
 *
 *   ?debug=rows    the rhythm: a line across the road at every beat, with its Z
 *   ?debug=lanes   the lane bands: a line down each side at its distance, plus
 *                  the road edges, with the lane name and number
 *   ?debug=rows,lanes  both
 *
 * The numbers are read from assets/layout.json, which the generator writes them
 * into. The scene never sees scene_spec.json, and an overlay that guessed the
 * bands would be worse than no overlay at all — it would agree with itself and
 * disagree with the thing being checked.
 */

const COL = {
  road: 0xff5555,
  verge: 0xffc857, near: 0x8ee06a, mid: 0x6ac3e0, far: 0xb08ae0, back: 0x8a8f99,
  row: 0xff8ad8,
};

export async function startDebug(stage, THREE, modes) {
  const dbg = (stage.layout && stage.layout.debug) || null;
  if (!dbg) {
    console.warn('[j3] в layout.json нет блока debug — пересоберите generate_layout.py');
    return;
  }
  const root = new THREE.Group();
  root.renderOrder = 900;
  stage.scene.add(root);

  /* A ribbon lying on the ground rather than a THREE.Line.
     Two reasons, and the second is why it changed: GL draws a line one device
     pixel wide however far away it is, which is already close to useless at
     1440px across a hundred metres of road — and in this scene, behind the
     effect composer, the lines did not reach the frame at all. Only the labels
     did, which made the overlay look like it was working. A ribbon is ordinary
     geometry and goes through the same path as everything else. */
  const RIBBON = 0.34;                 // metres across

  const line = (pts, colour) => {
    const [a, b] = pts;
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    const g = new THREE.PlaneGeometry(RIBBON, len);
    const m = new THREE.MeshBasicMaterial({ color: colour, depthTest: false,
                                            fog: false, transparent: true,
                                            opacity: 0.85,
                                            side: THREE.DoubleSide });
    const l = new THREE.Mesh(g, m);
    l.rotation.x = -Math.PI / 2;                     // flat on the ground
    l.rotation.z = Math.atan2(dx, dz);               // ...pointing along the run
    l.position.set((a[0] + b[0]) / 2, Math.max(a[1], b[1]),
                   (a[2] + b[2]) / 2);
    l.renderOrder = 900;
    return l;
  };

  /* Labels are canvas textures rather than DOM: they have to sit at a place in
     the world, and a DOM tag would need reprojecting every frame. */
  const label = (text, colour, at, size = 1.6) => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const cx = c.getContext('2d');
    cx.fillStyle = 'rgba(10,12,14,.82)';
    cx.fillRect(0, 0, 256, 64);
    cx.font = 'bold 34px ui-monospace, monospace';
    cx.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
    cx.textBaseline = 'middle';
    cx.fillText(text, 10, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    /* Constant size on screen, not in the world: a world-scaled label is
       unreadable at the far end of the biome and fills the frame when the
       camera passes it. */
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: t, depthTest: false, fog: false, transparent: true,
      sizeAttenuation: false }));
    s.scale.set(size * 0.11, size * 0.0275, 1);
    s.position.set(at[0], at[1], at[2]);
    s.renderOrder = 901;
    return s;
  };

  const spacing = 150;   // must match BIOME_SPACING; only used to place overlays
  const biomes = Object.keys(dbg.rows);

  biomes.forEach((bid, i) => {
    const z0 = -i * spacing;
    const len = dbg.length[bid];

    if (modes.has('lanes')) {
      const lanes = dbg.lanes[bid];
      // the road itself, so the bands have something to be measured from
      for (const s of [-1, 1]) {
        root.add(line([[s * dbg.road_half_width, 0.06, z0 + 4],
                       [s * dbg.road_half_width, 0.06, z0 - len]], COL.road));
      }
      root.add(label(`дорога ±${dbg.road_half_width}`, COL.road,
                     [dbg.road_half_width + 2.4, 1.4, z0 - 6]));
      Object.entries(lanes).forEach(([name, d], li) => {
        const colour = COL[name] || 0xffffff;
        for (const s of [-1, 1]) {
          root.add(line([[s * d, 0.06, z0 + 4], [s * d, 0.06, z0 - len]], colour));
        }
        // staggered down the road: all of them at one z stacked into a single
        // unreadable smear at the vanishing point
        const lz = z0 - 12 - li * 9;
        root.add(label(`${name} ${d}`, colour, [d + 2.8, 1.2, lz]));
        root.add(label(`${name} ${d}`, colour, [-d - 2.8, 1.2, lz]));
      });
    }

    if (modes.has('rows')) {
      const wide = (dbg.lanes[bid].back || 26) + 4;
      for (const z of dbg.rows[bid]) {
        root.add(line([[-wide, 0.08, z0 + z], [wide, 0.08, z0 + z]], COL.row));
        root.add(label(`z ${z}`, COL.row, [0, 1.1, z0 + z]));
      }
    }
  });

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:12px;top:12px;z-index:60;padding:8px 12px;'
    + 'background:rgba(18,22,24,.9);color:#fdf6e0;font:12px ui-monospace,monospace';
  panel.textContent = `debug: ${[...modes].join(', ')} · линии и подписи в мировых координатах`;
  document.body.appendChild(panel);
  console.log('[j3] debug:', [...modes].join(', '));
}
