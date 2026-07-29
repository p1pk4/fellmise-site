/* The camera rail.
 *
 * A CatmullRom curve threaded through every biome and every gate, with a slight
 * lateral wander so it never reads as a straight tube. Scroll progress maps to
 * arc length, not to a raw index, so the pace is even regardless of how the
 * control points are spaced.
 *
 * Pace: the curve is sampled through an easing table that slows inside biomes
 * and speeds up across transitions — the dwell happens where there is something
 * to look at.
 */

import * as THREE from 'three';
import { BIOMES, GATES } from './biomes.js';
import { biomeZ, gateZ, applyTod } from './world.js';

export function bindRail({ gsap, ScrollTrigger, stage }) {
  const pts = [];
  // start slightly behind the first biome so it is already in frame at rest
  pts.push(new THREE.Vector3(0, 3.4, biomeZ(0) + 16));
  BIOMES.forEach((b, i) => {
    const wander = (i % 2 === 0 ? 1 : -1) * 3.2;
    pts.push(new THREE.Vector3(wander * 0.5, 3.6, biomeZ(i) + 2));
    pts.push(new THREE.Vector3(wander, 3.2, biomeZ(i) - 18));
    if (GATES[i]) {
      // aim straight at the opening, then just past it
      pts.push(new THREE.Vector3(0, GATES[i].h * 0.42, gateZ(i) + 6));
      pts.push(new THREE.Vector3(0, GATES[i].h * 0.42, gateZ(i) - 5));
    }
  });
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  stage.curve = curve;

  // ---- pacing table: slow in biomes, quick through gates -------------------
  const N = BIOMES.length;
  const segs = [];
  for (let i = 0; i < N; i++) {
    segs.push({ kind: 'biome', weight: 1.6 });
    if (GATES[i]) segs.push({ kind: 'gate', weight: 0.85 });
  }
  const total = segs.reduce((a, s) => a + s.weight, 0);
  let acc = 0;
  segs.forEach((s) => { s.from = acc / total; acc += s.weight; s.to = acc / total; });
  stage.segs = segs;

  // uniform u (0..1 along the curve) for a given scroll progress
  function pathU(p) {
    const stepsPerSeg = 1 / segs.length;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (p <= s.to || i === segs.length - 1) {
        const local = (p - s.from) / (s.to - s.from || 1);
        const eased = s.kind === 'biome'
          ? local                                   // even inside a biome
          : local * local * (3 - 2 * local);        // ease across a gate
        return (i + Math.min(Math.max(eased, 0), 1)) * stepsPerSeg;
      }
    }
    return p;
  }
  stage.pathU = pathU;

  const look = new THREE.Vector3();
  const pos = new THREE.Vector3();

  function place(progress) {
    stage.progress = progress;
    const u = Math.min(Math.max(pathU(progress), 0), 1);
    curve.getPointAt(u, pos);
    // look ahead along the curve so corners feel anticipated
    curve.getPointAt(Math.min(u + 0.012, 1), look);

    const cam = stage.camera;
    const mx = stage.mouse.cx, my = stage.mouse.cy;
    cam.position.set(pos.x + mx * 1.6, pos.y - my * 0.9, pos.z);
    cam.lookAt(look.x + mx * 0.8, look.y - my * 0.5, look.z);
    cam.rotation.z = mx * 0.02;

    updateAtmosphere(stage, progress);
    updateGates(stage, progress);
    updateText(stage, progress);
  }
  stage.place = place;

  ScrollTrigger.create({
    trigger: '#rail',
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => place(self.progress),
  });

  place(0);
}

/* ------------------------------------------------------------- atmosphere */
function updateAtmosphere(stage, p) {
  const segs = stage.segs;
  // which biome are we nearest? crossfade fog/background between neighbours
  const idx = Math.min(BIOMES.length - 1, Math.floor(p * BIOMES.length));
  const nextIdx = Math.min(BIOMES.length - 1, idx + 1);
  const local = p * BIOMES.length - idx;
  const a = BIOMES[idx], b = BIOMES[nextIdx];

  const fogA = new THREE.Color(a.fog), fogB = new THREE.Color(b.fog);
  const skyA = new THREE.Color(a.sky[1]), skyB = new THREE.Color(b.sky[1]);
  const k = Math.min(Math.max((local - 0.55) / 0.45, 0), 1);   // hold, then blend

  // the village's own look follows the visitor's clock
  if (idx === 0 && stage.todLook) {
    fogA.setHex(stage.todLook.fog);
    skyA.setHex(stage.todLook.sky);
  }

  stage.scene.fog.color.copy(fogA).lerp(fogB, k);
  stage.scene.background.copy(skyA).lerp(skyB, k);
  stage.scene.fog.near = THREE.MathUtils.lerp(a.fogNear, b.fogNear, k);
  stage.scene.fog.far = THREE.MathUtils.lerp(a.fogFar, b.fogFar, k);
}

/* ------------------------------------------------------------------ gates */
function updateGates(stage, p) {
  const per = 1 / stage.segs.length;
  stage.segs.forEach((s, i) => {
    if (s.kind !== 'gate') return;
    const gi = Math.floor(i / 2);
    const g = stage.gates[gi];
    if (!g) return;
    // 0..1 across this gate's own slice of the scroll
    const local = Math.min(Math.max((p - s.from) / (s.to - s.from), 0), 1);
    // light kindles on approach, floods at the pass-through, fades behind
    const rise = Math.min(local / 0.62, 1);
    const fall = 1 - Math.min(Math.max((local - 0.74) / 0.26, 0), 1);
    g.light.material.opacity = Math.pow(rise, 1.6) * fall;
    const s2 = 1 + rise * 2.6;
    g.light.scale.set(s2, s2, 1);
    g.frame.material.opacity = 1;
  });
}

/* ------------------------------------------------------------------- text */
function updateText(stage, p) {
  if (!stage.stops) {
    stage.stops = [...document.querySelectorAll('.stop')].map((el) => ({
      el, kids: [...el.children],
    }));
  }
  const n = BIOMES.length;
  stage.stops.forEach((s, i) => {
    const centre = (i + 0.5) / n;
    const d = Math.abs(p - centre);
    // visible while the camera is inside this biome's share of the rail
    const vis = Math.min(Math.max(1 - (d - 0.055) / 0.055, 0), 1);
    s.kids.forEach((k) => {
      k.style.opacity = vis.toFixed(3);
      k.style.transform = `translate3d(0, ${((1 - vis) * 26).toFixed(1)}px, 0)`;
      k.style.pointerEvents = vis > 0.6 ? 'auto' : 'none';
    });
  });
}
