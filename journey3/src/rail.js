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
import { BIOMES, GATES, BIOME_SPACING } from './biomes.js';
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
      // Long approach, then through. The first attempt put a single point 6
      // units before the frame, so the camera crossed it almost immediately and
      // the opening was never on screen — the flight read as a hard cut.
      const gy = GATES[i].h * 0.42;
      pts.push(new THREE.Vector3(0, gy + 0.6, gateZ(i) + 30));
      pts.push(new THREE.Vector3(0, gy, gateZ(i) + 12));
      pts.push(new THREE.Vector3(0, gy, gateZ(i) + 2));
      pts.push(new THREE.Vector3(0, gy, gateZ(i) - 8));
    }
  });
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  stage.curve = curve;

  /* ---- pacing -------------------------------------------------------------
     Each scroll segment must own the stretch of curve that actually contains
     its subject. Splitting the curve into equal slices does NOT do that: a gate
     carries four control points and a biome two, so equal slices put the
     "through the doorway" moment well after the doorway was already behind the
     camera. So every anchor (biome centre, gate frame) is located ON the curve
     by nearest-point search, and progress is mapped between those u values. */
  const SAMPLES = 1500;
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) samples.push(curve.getPointAt(i / SAMPLES));

  function uNearest(target) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      const d = samples[i].distanceToSquared(target);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best / SAMPLES;
  }

  const anchors = [];
  BIOMES.forEach((b, i) => {
    anchors.push({ kind: 'biome', i, u: uNearest(new THREE.Vector3(0, 3.4, biomeZ(i) - 8)), weight: 1.6 });
    if (GATES[i]) {
      anchors.push({ kind: 'gate', i, u: uNearest(new THREE.Vector3(0, GATES[i].h * 0.42, gateZ(i))), weight: 0.9 });
    }
  });

  /* Each segment is centred ON its anchor: it runs from the midpoint with the
     previous anchor to the midpoint with the next. Spanning anchor -> NEXT
     anchor instead put the doorway at the segment's start, so by the time the
     scroll reached the middle of the "gate" the opening was ~45 units behind
     the camera and the flight read as arriving, not passing through. */
  const total = anchors.reduce((a, x) => a + x.weight, 0);
  let acc = 0;
  const segs = anchors.map((a, idx) => {
    const from = acc / total;
    acc += a.weight;
    const to = acc / total;
    const prevU = idx > 0 ? anchors[idx - 1].u : 0;
    const nextU = anchors[idx + 1] ? anchors[idx + 1].u : 1;
    return {
      kind: a.kind, i: a.i, from, to,
      uFrom: (prevU + a.u) / 2,
      uTo: (a.u + nextU) / 2,
      uAnchor: a.u,
    };
  });
  stage.segs = segs;

  function pathU(p) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (p <= s.to || i === segs.length - 1) {
        const local = Math.min(Math.max((p - s.from) / (s.to - s.from || 1), 0), 1);
        // dwell inside a biome, accelerate through a gate
        const eased = s.kind === 'biome' ? local
          : 0.5 - 0.5 * Math.cos(Math.PI * local);   // symmetric about the opening
        return s.uFrom + (s.uTo - s.uFrom) * eased;
      }
    }
    return 1;
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
    cam.lookAt(look.x + mx * 0.8, look.y - 1.15 - my * 0.5, look.z);
    cam.rotation.z = mx * 0.02;

    updateAtmosphere(stage, progress);
    updateGates(stage, progress);
    updateOccluders(stage);
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

  const skyA = new THREE.Color(a.sky[1]), skyB = new THREE.Color(b.sky[1]);
  const k = Math.min(Math.max((local - 0.55) / 0.45, 0), 1);   // hold, then blend

  // the village's own look follows the visitor's clock
  if (idx === 0 && stage.todLook) skyA.setHex(stage.todLook.sky);

  const sky = skyA.clone().lerp(skyB, k);
  stage.scene.background.copy(sky);
  /* Distance fades to the SKY, not to a separate fog colour. The village's fog
     was beige and its sky blue, so anything far enough away stopped short of
     the sky and stood there as a cream blot — the "cloud" around the gate house
     was the forest's backdrop trees doing exactly this. Fading to the colour
     that is actually behind them makes them recede instead of hovering. */
  stage.scene.fog.color.copy(sky);
  stage.scene.fog.near = THREE.MathUtils.lerp(a.fogNear, b.fogNear, k);
  stage.scene.fog.far = THREE.MathUtils.lerp(a.fogFar, b.fogFar, k);
}

/* A biome's near-camera occluders only exist for someone standing in that
   biome. Left on, they are visible through the gate from the biome before it,
   flanking the opening with two strips of the wrong scenery. */
function updateOccluders(stage) {
  const z = stage.camera.position.z;
  stage.groups.forEach((g, i) => {
    if (!g || !g.group.userData.occluders) return;
    const inside = z < -i * BIOME_SPACING + 62;      // past the gate, in the room
    for (const m of g.group.userData.occluders) m.visible = inside;
  });
}

/* ------------------------------------------------------------------ gates */
function updateGates(stage, p) {
  const per = 1 / stage.segs.length;
  stage.segs.forEach((s) => {
    if (s.kind !== 'gate') return;
    const g = stage.gates[s.i];
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
    // the leaves swing open just before the pass-through, then stay open
    if (g.leaves) {
      const open = Math.min(Math.max((local - 0.18) / 0.40, 0), 1);
      const ang = (1 - Math.cos(Math.PI * open)) / 2 * 1.35;   // ~77deg, eased
      // outward, towards the camera: with the other sign the leaves swing
      // INTO the dark interior and are never seen
      for (const L of g.leaves) L.mesh.rotation.y = L.side * ang;
    }
  });
}

/* ------------------------------------------------------------------- text */
function updateText(stage, p) {
  if (!stage.stops) {
    stage.stops = [...document.querySelectorAll('.stop')].map((el) => ({
      el, kids: [...el.children],
    }));
  }
  const bsegs = stage.segs.filter((s) => s.kind === 'biome');
  stage.stops.forEach((s, i) => {
    const seg = bsegs[i];
    if (!seg) return;
    const span = seg.to - seg.from;
    const local = (p - seg.from) / span;              // 0..1 inside this biome
    // fade in over the first fifth, hold, fade out over the last fifth
    const vis = Math.min(Math.max(Math.min(local / 0.2, (1 - local) / 0.2), 0), 1);
    s.kids.forEach((k) => {
      k.style.opacity = vis.toFixed(3);
      k.style.transform = `translate3d(0, ${((1 - vis) * 26).toFixed(1)}px, 0)`;
      k.style.pointerEvents = vis > 0.6 ? 'auto' : 'none';
    });
  });
}
