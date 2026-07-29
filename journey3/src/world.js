/* Diorama construction. Everything here is planes with alpha textures cut from
 * the existing sprite pack — no models, no generated art.
 *
 * Loading policy: biome 0 and its gate load before the first frame; the rest
 * load in the background, nearest first, and are NEVER disposed. Scrubbing
 * backwards can therefore not hit a freed texture, which is what made the
 * earlier DOM version flicker.
 */

import * as THREE from 'three';
import { BIOMES, GATES, BIOME_SPACING, GATE_OFFSET } from './biomes.js';

const DPR_CAP = 2;
// the RU page sits one level deeper, so the base comes from the page
const ASSETS = (window.J3 && window.J3.assets) || 'assets/';

export const biomeZ = (i) => -i * BIOME_SPACING;
export const gateZ = (i) => biomeZ(i) - GATE_OFFSET;

export async function createWorld({ canvas, tod }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd9c79a, 40, 190);
  scene.background = new THREE.Color(0xc7e6f2);

  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 400);
  camera.position.set(0, 3.4, 8);

  // Flat lighting: the sprites are already shaded, so light only tints them.
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  const loader = new THREE.TextureLoader();
  const texCache = new Map();
  function loadTex(name) {
    if (texCache.has(name)) return texCache.get(name);
    const p = new Promise((res, rej) => {
      loader.load(`${ASSETS}${name}.webp`, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        res(t);
      }, undefined, rej);
    });
    texCache.set(name, p);
    return p;
  }

  const state = {
    renderer, scene, camera, tod,
    groups: [], gates: [], sway: [], glows: [], emitters: [],
    ready: new Set(), loading: new Map(),
    clock: new THREE.Clock(), progress: 0, mouse: { x: 0, y: 0, cx: 0, cy: 0 },
  };

  /* ------------------------------------------------------------- primitives */
  async function makeSprite(spec, group) {
    const tex = await loadTex(spec.t);
    const aspect = tex.image.width / tex.image.height;
    const h = spec.h;
    const geo = new THREE.PlaneGeometry(h * aspect, h);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.04,
      depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    if (spec.dim) mat.color.setScalar(spec.dim);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spec.x, h / 2, spec.z);
    mesh.renderOrder = spec.layer;
    group.add(mesh);
    if (spec.sway) state.sway.push({ mesh, phase: Math.random() * 6.28 });
    if (spec.glow) addGlow(group, mesh, spec);
    return mesh;
  }

  // A soft additive quad in front of a light source. Bloom picks these up; the
  // sprite art itself stays below the bloom threshold.
  const glowTex = makeGlowTexture();
  function addGlow(group, mesh, spec) {
    const size = spec.h * 0.9;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: glowTex, color: spec.glow, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
    g.position.set(spec.x, spec.h * 0.62, spec.z + 0.2);
    g.renderOrder = 9;
    group.add(g);
    state.glows.push({ mesh: g, base: 0.75, phase: Math.random() * 6.28 });
  }

  function makeGlowTexture() {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  async function makeGround(b, group, index) {
    // A ground plane must cover its own biome and reach into the gate, but NOT
    // sit on top of the next biome's ground: they are coplanar at y=0, and the
    // neighbour's tint was winning the depth test (the mine rendered on grass).
    // Hence a shorter plane plus a hair of Y separation per biome, so where two
    // do overlap the nearer-in-order one deterministically wins.
    // A biome's floor must begin just after the PREVIOUS opening and end just
    // after its own, so the floor changes underfoot exactly while passing
    // through. Sitting it under the biome only meant the forest's grass ran on
    // under the mine's cave mouth. Later biomes sit a hair higher, so in the
    // overlap the destination's floor wins — which is the direction of travel.
    const LEN = 150, CZ = -5;
    const y = index * 0.004;

    const tex = (await loadTex(b.ground)).clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 9);
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
    mat.color.setHex(b.groundTint);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(170, LEN), mat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, y, CZ);
    g.renderOrder = -10;
    group.add(g);

    if (b.road) {
      const rt = (await loadTex(b.road)).clone();
      rt.needsUpdate = true;
      rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
      rt.repeat.set(1, 3);
      const rm = new THREE.MeshBasicMaterial({ map: rt, transparent: true, fog: true });
      rm.color.setHex(0xf2ca78);          // keep it reading as the path colour
      const r = new THREE.Mesh(new THREE.PlaneGeometry(11, LEN), rm);
      r.rotation.x = -Math.PI / 2;
      r.position.set(0, y + 0.02, CZ);
      r.renderOrder = -9;
      group.add(r);
    }
  }

  /* ------------------------------------------------------------ biome build */
  async function buildBiome(i) {
    if (state.ready.has(i)) return;
    if (state.loading.has(i)) return state.loading.get(i);
    const b = BIOMES[i];
    const group = new THREE.Group();
    group.position.z = biomeZ(i);
    group.visible = true;
    scene.add(group);
    state.groups[i] = { group, def: b };

    const job = (async () => {
      await makeGround(b, group, i);
      for (const s of b.sprites) await makeSprite(s, group);
      const { makeEmitters } = await import('./life.js');
      state.emitters.push(...makeEmitters(THREE, group, b, glowTex));
      state.ready.add(i);
      state.loading.delete(i);
    })();
    state.loading.set(i, job);
    return job;
  }

  async function buildGate(i) {
    const g = GATES[i];
    if (!g || state.gates[i]) return;
    const grp = new THREE.Group();
    grp.position.z = gateZ(i);
    scene.add(grp);

    const tex = await loadTex(g.art);
    const aspect = tex.image.width / tex.image.height;
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(g.h * aspect, g.h),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.04,
        depthWrite: false, side: THREE.DoubleSide, fog: true,
      }));
    frame.position.set(0, g.h / 2, 0);
    frame.renderOrder = 4;
    grp.add(frame);

    // the light behind the opening, growing to fill the frame at the peak
    const light = new THREE.Mesh(
      new THREE.PlaneGeometry(g.h * 1.5, g.h * 1.5),
      new THREE.MeshBasicMaterial({
        map: glowTex, color: g.warm, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0,
      }));
    // In FRONT of the facade, at door height: behind it the opaque wall of the
    // sprite hid the glow entirely and the opening read as a dark patch.
    light.position.set(0, g.h * 0.30, 0.6);
    light.renderOrder = 8;
    grp.add(light);

    state.gates[i] = { def: g, group: grp, frame, light };
  }

  /* first frame: village + its gate, then the rest in the background */
  await buildBiome(0);
  await buildGate(0);
  state.warmRest = () => {
    (async () => {
      for (let i = 1; i < BIOMES.length; i++) {
        await buildBiome(i);
        await buildGate(i);
      }
    })();
  };

  applyTod(state, tod);
  addResize(state);
  return state;
}

export function applyTod(state, tod) {
  const b = BIOMES[0];
  const LOOK = {
    day: { fog: 0xd9c79a, sky: 0xc7e6f2, mul: 1.0 },
    dawn: { fog: 0xffd0a0, sky: 0xf3d3b0, mul: 0.96 },
    dusk: { fog: 0xe08a4a, sky: 0xf0a469, mul: 0.86 },
    night: { fog: 0x1b2445, sky: 0x141c34, mul: 0.55 },
  };
  const L = LOOK[tod] || LOOK.day;
  state.todLook = L;
  state.tod = tod;
  // village-only: the other biomes keep their fixed atmosphere
  const g = state.groups[0];
  if (g) {
    g.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.map && o.material.blending !== THREE.AdditiveBlending) {
        if (o.userData.baseColor === undefined) o.userData.baseColor = o.material.color.getHex();
        const c = new THREE.Color(o.userData.baseColor).multiplyScalar(L.mul);
        o.material.color.copy(c);
      }
    });
  }
}

function addResize(state) {
  const on = () => {
    state.renderer.setSize(innerWidth, innerHeight, false);
    state.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP));
    state.camera.aspect = innerWidth / innerHeight;
    state.camera.updateProjectionMatrix();
    if (state.composer) state.composer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', on);
  on();
}

export function startLoop(state) {
  const { renderer, scene, camera } = state;
  if (state.warmRest) state.warmRest();

  addEventListener('mousemove', (e) => {
    state.mouse.x = e.clientX / innerWidth - 0.5;
    state.mouse.y = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  import('./life.js').then(({ stepEmitters }) => { state.stepEmitters = stepEmitters; });
  import('postprocessing').then(async (PP) => {
    const { EffectComposer, RenderPass, EffectPass, BloomEffect, BlendFunction } = PP;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({
      blendFunction: BlendFunction.ADD,
      // high threshold so only fire, portal, crystals and windows bloom
      luminanceThreshold: 0.78, luminanceSmoothing: 0.22, intensity: 1.15, mipmapBlur: true,
    })));
    composer.setSize(innerWidth, innerHeight);
    state.composer = composer;
  }).catch(() => { /* bloom is optional; the scene renders without it */ });

  const tick = () => {
    const dt = Math.min(state.clock.getDelta(), 0.05);
    const t = state.clock.elapsedTime;

    // mouse look: a small camera offset, lerped
    state.mouse.cx += (state.mouse.x - state.mouse.cx) * 0.06;
    state.mouse.cy += (state.mouse.y - state.mouse.cy) * 0.06;

    for (const s of state.sway) {
      s.mesh.rotation.z = Math.sin(t * 0.42 + s.phase) * 0.0087;   // ~0.5deg
    }
    for (const g of state.glows) {
      g.mesh.material.opacity = g.base * (0.86 + 0.14 * Math.sin(t * 2.1 + g.phase));
    }
    if (state.stepEmitters) state.stepEmitters(state, dt, t);

    if (state.composer) state.composer.render(dt);
    else renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
