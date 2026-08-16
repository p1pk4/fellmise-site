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

/* The splash bar counts real texture loads. Exported from here so the entry
   chunk can reach it the moment this module resolves — before createWorld runs,
   which is when the loading actually starts — without importing three itself. */
export const loadingManager = THREE.DefaultLoadingManager;

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
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texCache = new Map();
  function loadTex(name) {
    if (texCache.has(name)) return texCache.get(name);
    // resolves to null rather than rejecting: optional maps (_em, _bleed) are
    // asked for by name, and a cached rejection would surface as an unhandled
    // rejection the moment a second sprite asked for the same one.
    const p = new Promise((res) => {
      loader.load(`${ASSETS}${name}.webp`, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        // Without this the ground smears into blotches the moment it is seen at
        // a grazing angle — which, on a road running away from the camera, is
        // most of the frame.
        t.anisotropy = maxAniso;
        res(t);
      }, undefined, () => res(null));
    });
    texCache.set(name, p);
    return p;
  }

  /* Where everything stands. Placement is data, not code: this file is what
     ?editor=1 writes back, and biomes.js keeps only the atmosphere. */
  let LAYOUT = { biomes: {} };
  try {
    LAYOUT = await fetch(`${ASSETS}layout.json`).then((r) => r.json());
  } catch {
    console.warn('[j3] нет assets/layout.json — сцены будут пустыми');
  }

  /* How much empty space each sprite has below its art, as a fraction of its
     height (tools/make_baselines.py). Without this a chest or a haystack floats
     by however much padding the cut happened to leave. */
  let BASELINE = {};
  try {
    BASELINE = await fetch(`${ASSETS}baselines.json`).then((r) => r.json());
  } catch { /* no manifest -> planes sit on their own bottom edge, as before */ }

  /* Which sprites emit light, and how that light behaves. Written by
     tools/make_emissive.py alongside the masks, so the renderer never has to
     guess: a source exists here only if a mask was actually cut for it. */
  let EMISSIVE = {};
  try {
    EMISSIVE = await fetch(`${ASSETS}emissive.json`).then((r) => r.json());
  } catch { /* no manifest -> no emissive planes, the scene still renders */ }

  const state = {
    renderer, scene, camera, tod,
    groups: [], gates: [], sway: [], lights: [], emitters: [], boards: [], drift: [], backdrops: [], editable: [],
    ready: new Set(), loading: new Map(),
    clock: new THREE.Clock(), progress: 0, mouse: { x: 0, y: 0, cx: 0, cy: 0 },
    layout: LAYOUT,          // the editor writes this back out
  };

  /* Everything the editor is allowed to touch, by id. `spec` is the very object
     that came out of layout.json, so writing the file back is a matter of
     copying the mesh's transform into it — no second source of truth. `extra`
     is for parts that must follow the main mesh, like a board's blank back. */
  function register(id, kind, mesh, spec, group, extra = []) {
    state.editable.push({ id, kind, mesh, spec: spec.src || spec, group, extra });
  }

  /* ------------------------------------------------------------- primitives */
  async function makeSprite(spec, group) {
    // the editor addresses objects by id; anything built without one is
    // scenery the editor does not own (the counter's goods, for instance)
    const tex = await loadTex(spec.t);
    if (!tex) return null;
    const aspect = tex.image.width / tex.image.height;
    const h = spec.h;
    const geo = new THREE.PlaneGeometry(h * aspect, h);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.04, depthWrite: false,
      side: THREE.DoubleSide,
      // the moon is not weather: at dusk the fog turned it into an orange disc
      fog: spec.nofog !== true,
    });
    if (spec.dim) mat.color.setScalar(spec.dim);
    // Occluders brushing the lens should be out of focus. Rather than shipping a
    // second, blurred copy of every one of them, the sampler is pushed down the
    // mip chain — same texture, no extra bytes, and it costs nothing per frame.
    if (spec.blur) blurSampling(mat, spec.blur);
    const mesh = new THREE.Mesh(geo, mat);
    // `y` is the CENTRE height, for things that do not stand on the ground:
    // clouds, the moon, a lantern on a chain, a beam spanning the tunnel.
    const drop = spec.y !== undefined ? 0 : (BASELINE[spec.t] || 0) * h;
    mesh.position.set(spec.x, spec.y !== undefined ? spec.y : h / 2 - drop, spec.z);
    mesh.renderOrder = spec.layer;
    // an explicit `y` means the thing is not on the floor — a cloud, the moon, a
    // lantern on a chain, goods on a counter. The ground test reads this rather
    // than keeping its own list of names.
    mesh.userData.h0 = h;                       // высота, на которую построена геометрия
    mesh.userData.gap = BASELINE[spec.t] || 0;   // пустота снизу, для пересадки при масштабе
    mesh.rotation.y = spec.rotY || 0;
    mesh.visible = spec.visible !== false;
    mesh.userData.standsOnGround = spec.y === undefined;
    group.add(mesh);
    if (spec.id) register(spec.id, 'sprite', mesh, spec, group);
    // things hanging in the air cast nothing we could honestly place
    if (spec.shadow !== false && spec.y === undefined
        && spec.layer >= 1 && spec.layer <= 2) {
      addShadow(group, spec, h * aspect);
    }
    // Layer 3 is the stuff meant to brush the lens from inside the biome. Seen
    // from OUTSIDE — through the gate, before you get there — it stands either
    // side of the opening as a pair of strips that belong to nowhere. Kept on a
    // list so the rail can switch them off until the camera is actually inside.
    if (spec.layer === 3) group.userData.occluders.push(mesh);
    // Backdrops past the fog distance are pure fog colour: above the horizon
    // they are invisible, below it they lie there as a flat pale silhouette
    // over the ground. They carry nothing, so they are switched off.
    if (spec.layer === 0) state.backdrops.push(mesh);
    if (spec.drift) {
      state.drift.push({ mesh, speed: spec.drift, span: spec.span || 90, x0: spec.x });
    }
    if (spec.sway) state.sway.push({ mesh, phase: Math.random() * 6.28 });
    if (EMISSIVE[spec.t]) await addLight(mesh, spec, EMISSIVE[spec.t]);
    return mesh;
  }

  /* A light source is the sprite's OWN glowing pixels, drawn additively back
     over it, plus the same shape blurred wide as the spill onto the object it
     sits on. Nothing round is involved: the flame is flame-shaped, the window
     is a rectangle, the crystal has facets. Both planes match the sprite's
     footprint exactly, so the mask lines up pixel for pixel with the art.

     They are the only things above the bloom threshold, which is what makes the
     bloom selective without a second render pass. */
  async function addLight(host, spec, info) {
    const bleedTex = await loadTex(`${spec.t}_bleed`);
    const emTex = await loadTex(`${spec.t}_em`);
    if (!emTex) return;
    const aspect = emTex.image.width / emTex.image.height;
    const geo = new THREE.PlaneGeometry(spec.h * aspect, spec.h);
    const entry = { kind: info.kind, phase: Math.random() * 6.28, parts: [] };
    // a darkened backdrop or occluder copy is a silhouette, not a lit object —
    // its light is dimmed by the same factor as its art
    // ...times the source's own strength, which falls with how much of the
    // sprite already glows (see tools/make_emissive.py)
    const level = (spec.dim !== undefined ? spec.dim : 1) * (info.strength || 0.7);

    /* The glow is a CHILD of the sprite it belongs to, at local (0,0,dz).
       Parented to the biome instead, it stayed behind the moment a house was
       moved — windows lighting up a tree, a fence, the bare ground. Now it
       cannot come apart from its own wall, including when the editor drags
       the house around. */
    const add = (role, tex, dz, opacity) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      m.position.set(0, 0, dz);
      m.renderOrder = 9;
      host.add(m);
      entry.parts.push({ role, mesh: m, base: opacity });
    };

    // spill first, then the source itself on top of it
    if (bleedTex) add('bleed', bleedTex, 0.02, 0.62 * level);
    add('em', emTex, 0.04, 1.0 * level);
    state.lights.push(entry);
  }

  function blurSampling(mat, bias) {
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'texture2D( map, vMapUv )', `texture2D( map, vMapUv, ${bias.toFixed(1)} )`);
    };
    mat.customProgramCacheKey = () => `blur${bias}`;
  }

  /* A soft dark ellipse on the ground under a sprite. Billboards have no
     contact with the floor of their own accord, and without this a tree or an
     ore vein reads as hanging an inch above the ground — which is exactly what
     it was doing. Only for things that stand IN the scene: backdrops and
     occluders are too far or too near for a contact shadow to mean anything. */
  const shadowTex = makeShadowTexture();
  function addShadow(group, spec, width) {
    const w = width * 0.72;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.34),
      new THREE.MeshBasicMaterial({
        map: shadowTex, transparent: true, opacity: 0.34,
        depthWrite: false, fog: true,
      }));
    m.rotation.x = -Math.PI / 2;
    // just above the floor plane, and a touch forward so the sprite's own
    // baked base does not sit on top of it
    m.position.set(spec.x, 0.03, spec.z + w * 0.06);
    m.userData.forSprite = spec.t;
    m.renderOrder = -8;
    group.add(m);
  }

  function makeShadowTexture() {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }

  // A soft round dot — for particles only (embers, dust, souls). Light sources
  // no longer use it: they carry their own shape.
  const dotTex = makeDotTexture();
  function makeDotTexture() {
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

  /* Text type A: a board standing in the scene, its face drawn into a canvas.
     Copy comes from the page (window.J3.boards) so both locales use the same
     markup and the same words as the DOM, which stays as the caption and as
     the fallback. */
  async function makeBoard(def, group) {
    const copy = ((window.J3 && window.J3.boards) || {})[def.key];
    if (!copy) return;
    const { drawBoard, drawBoardBack, fontsReady } = await import('./signs.js');
    await fontsReady();
    const canvas = drawBoard({ kind: def.kind, title: copy.title, sub: copy.sub });
    const mkTex = (cv) => {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    };

    const aspect = canvas.width / canvas.height;
    const geo = new THREE.PlaneGeometry(def.h * aspect, def.h);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: mkTex(canvas), transparent: true, alphaTest: 0.02,
      depthWrite: false, side: THREE.FrontSide, fog: true,
    }));
    // the same plank facing the other way, with nothing written on it
    const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: mkTex(drawBoardBack({ kind: def.kind })), transparent: true,
      alphaTest: 0.02, depthWrite: false, side: THREE.BackSide, fog: true,
    }));
    back.position.set(def.x, def.h / 2, def.z);
    back.rotation.y = def.ry || 0;
    back.renderOrder = 2;
    group.add(back);
    mesh.visible = def.visible !== false;
    back.visible = def.visible !== false;
    mesh.position.set(def.x, def.h / 2, def.z);
    // turned a little towards the road, so it reads as placed rather than pasted
    mesh.rotation.y = def.ry || 0;
    mesh.renderOrder = 2;
    group.add(mesh);
    state.boards.push({ key: def.key, mesh, fit: canvas.__fit });
    if (def.id) register(def.id, 'board', mesh, def, group, [back]);
    return mesh;
  }

  /* The resource strip as an object in the world: a market stall with the
     ore, the timber and the tools laid out along it. The DOM rail stays as the
     static fallback — this is the same list, standing up. */
  async function makeCounter(def, group) {
    await makeSprite({ ...def.stall, shadow: true }, group);
    for (let i = 0; i < def.items.length; i++) {
      await makeSprite({
        t: def.items[i], layer: 2, h: def.h,
        x: def.x0 + i * def.step,
        y: def.y + (i % 2 ? 0.03 : 0),   // a hair of unevenness, so it is laid out, not stamped
        z: def.z,
      }, group);
    }
  }

  /* Per-vertex alpha ramp along the plane's length, so a floor arrives and
     leaves instead of starting at a straight edge. Written into the colour
     attribute as RGBA — the material's own colour still tints on top. */
  function fadeEnds(geo, len, fade, width, edge) {
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 4);
    const smooth = (t) => { const u = Math.min(Math.max(t, 0), 1); return u * u * (3 - 2 * u); };
    for (let i = 0; i < pos.count; i++) {
      const d = len / 2 - Math.abs(pos.getY(i));    // distance to the nearer end
      let a = smooth(d / fade);
      if (width) a *= smooth((width / 2 - Math.abs(pos.getX(i))) / edge);
      col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
      col[i * 4 + 3] = a;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  }

  async function makeGround(b, group, index) {
    // A floor must cover its own biome and reach into the gate, but not sit on
    // top of the next one's: they are coplanar at y=0 and the neighbour used to
    // win the depth test (the mine rendered on grass). Hence a shorter plane, a
    // hair of Y separation per biome so the destination wins in the overlap,
    // and an alpha ramp at each end so the change happens at the opening rather
    // than along a ruled line across the frame.
    const LEN = 190, CZ = -5, FADE = 24;
    const y = index * 0.004;

    const tex = (await loadTex(b.ground)).clone();
    tex.needsUpdate = true;
    tex.anisotropy = maxAniso;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);          // UV is world-space now; repeat is not used

    let roadTex = null;
    if (b.road) {
      roadTex = (await loadTex(b.road)).clone();
      roadTex.needsUpdate = true;
      roadTex.anisotropy = maxAniso;
      roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
      roadTex.repeat.set(1, 1);
    }

    const { makeGroundMaterial } = await import('./ground.js');
    const mat = makeGroundMaterial(THREE, {
      groundMap: tex, roadMap: roadTex,
      tint: b.groundTint, roadTint: b.roadTint || 0xdccbaa,
      // the road is painted into the floor, so its width is a number here and
      // not the size of a second plane
      halfWidth: (LAYOUT.debug && LAYOUT.debug.road_half_width) || 3.2,
    });
    (state.groundMats ||= []).push(mat);

    // more segments than before: the floor is one mesh now and its vertex ramp
    // has to be smooth across a longer span
    const geo = new THREE.PlaneGeometry(190, LEN, 1, 48);
    fadeEnds(geo, LEN, FADE);
    const g = new THREE.Mesh(geo, mat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, y, CZ);
    g.renderOrder = -10;
    group.add(g);
  }


  /* layout.json keeps position as one array, which is what a person reads and
     what the editor writes; the builders below want it spread out. */
  /* `src` is deliberately the ORIGINAL entry out of layout.json, not a copy.
     The editor writes a mesh's transform back into it, and Export stringifies
     the same document that was loaded — so there is exactly one object per
     thing on screen, and no step where the two can drift apart. */
  function fromLayout(o) {
    const [x, y, z] = o.pos;
    return { ...o, x, y: y === null ? undefined : y, z, src: o };
  }
  function fromBoard(o) {
    const [x, , z] = o.pos;
    return { ...o, x, z, ry: o.rotY, src: o };
  }

  /* ------------------------------------------------------------ biome build */
  async function buildBiome(i) {
    if (state.ready.has(i)) return;
    if (state.loading.has(i)) return state.loading.get(i);
    const b = BIOMES[i];
    const group = new THREE.Group();
    group.position.z = biomeZ(i);
    group.visible = true;
    group.userData.occluders = [];
    scene.add(group);
    state.groups[i] = { group, def: b };

    const L = LAYOUT.biomes[b.id] || {};
    const job = (async () => {
      await makeGround(b, group, i);
      for (const s of (L.sprites || [])) await makeSprite(fromLayout(s), group);
      for (const bd of (L.boards || [])) await makeBoard(fromBoard(bd), group);
      if (L.counter) await makeCounter(L.counter, group);
      const { makeEmitters } = await import('./life.js');
      state.emitters.push(...makeEmitters(THREE, group, b, dotTex));
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
    if (!tex) return;
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

    // The flood at the peak is the gate art's own spill map blown up, not a
    // round blob: the crypt floods candle-shaped, the cave floods vein-shaped.
    // All four gate arts have a mask, but fall back to the frame's silhouette
    // if one is ever missing.
    // Only ask for masks the manifest says exist. Asking unconditionally meant
    // a 404 apiece for every gate whose art stopped being a light source — the
    // cottage and the crypt both lost their glow in the front-on regeneration.
    const lit = !!EMISSIVE[g.art];
    const floodTex = (lit && await loadTex(`${g.art}_bleed`)) || tex;
    const light = new THREE.Mesh(
      new THREE.PlaneGeometry(g.h * aspect * 1.35, g.h * 1.35),
      new THREE.MeshBasicMaterial({
        map: floodTex, color: g.warm, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0,
      }));
    // In FRONT of the facade: behind it the opaque wall of the sprite hid the
    // glow entirely and the opening read as a dark patch. Centred exactly like
    // the frame — the flood carries the art's own footprint, so any other
    // anchor puts the window-shaped glow up on the roof.
    light.position.set(0, g.h / 2, 0.6);
    light.renderOrder = 8;
    grp.add(light);

    // the opening's own emissive, always on — so the gate reads as lit from
    // far away, before the flood starts
    const emTex = lit ? await loadTex(`${g.art}_em`) : null;
    if (emTex) {
      const em = new THREE.Mesh(
        new THREE.PlaneGeometry(g.h * aspect, g.h),
        new THREE.MeshBasicMaterial({
          map: emTex, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
      /* Child of the frame, like every other light in the scene: added to the
         gate group it kept its own coordinates, and the audit could not tell it
         apart from a glow that had come off its object. */
      em.position.set(0, 0, 0.04);
      em.renderOrder = 9;
      frame.add(em);
      state.lights.push({
        kind: (EMISSIVE[g.art] || {}).kind || 'steady',
        phase: Math.random() * 6.28, parts: [{ role: 'em', mesh: em, base: 1.0 }],
      });
    }

    const leaves = g.door ? makeDoor(g, grp, tex, aspect) : null;
    state.gates[i] = { def: g, group: grp, frame, light, leaves };
  }

  /* Door leaves, cut out of the gate art by texture offset — the same texture,
     sampled twice over the doorway rectangle, so a swinging door costs no extra
     bytes. Each leaf's geometry is shifted so its origin sits ON the jamb, and
     then it is simply rotated about Y: the hinge is in the geometry, not in a
     parent object. Behind them a dark quad hides the door painted into the art,
     otherwise an open doorway still shows a closed door. */
  function makeDoor(g, grp, tex, aspect) {
    const [x0, y0, x1, y1] = g.door;
    const planeW = g.h * aspect;
    const doorW = (x1 - x0) * planeW;
    const doorH = (y1 - y0) * g.h;
    const cy = (1 - (y0 + y1) / 2) * g.h;

    const dark = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW * 1.02, doorH * 1.02),
      new THREE.MeshBasicMaterial({ color: 0x120d09, fog: true }));
    dark.position.set(((x0 + x1) / 2 - 0.5) * planeW, cy, 0.02);
    dark.renderOrder = 6;
    grp.add(dark);

    const leaves = [];
    for (const side of [-1, 1]) {
      const t2 = tex.clone();
      t2.needsUpdate = true;
      t2.wrapS = t2.wrapT = THREE.ClampToEdgeWrapping;
      t2.repeat.set((x1 - x0) / 2, y1 - y0);
      t2.offset.set(side < 0 ? x0 : (x0 + x1) / 2, 1 - y1);

      const geo = new THREE.PlaneGeometry(doorW / 2, doorH);
      // origin to the hinge edge: left leaf hinges on its left, right on its right
      geo.translate((side < 0 ? 1 : -1) * doorW / 4, 0, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: t2, transparent: true, alphaTest: 0.04,
        depthWrite: false, side: THREE.DoubleSide, fog: true,
      }));
      m.position.set((side < 0 ? x0 : x1) - 0.5, cy, 0.05);
      m.position.x = ((side < 0 ? x0 : x1) - 0.5) * planeW;
      m.renderOrder = 7;
      grp.add(m);
      leaves.push({ mesh: m, side });
    }
    return leaves;
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

/* Value noise: a pseudo-random value per unit of x, smoothly interpolated. A
   sine reads as machinery — the eye locks onto the period within a second or
   two. Fire needs the level to wander instead. */
function noise1(x, seed) {
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

/* How bright a source is right now, 0..1 of its own level.
   fire   — flickers on two octaves of noise, never fully out
   pulse  — arcane light breathing slowly, shallow and regular
   steady — a window is simply on */
function lightLevel(kind, t, phase) {
  if (kind === 'fire') {
    const n = 0.65 * noise1(t * 6.5 + phase, phase)
            + 0.35 * noise1(t * 17.0 + phase, phase + 4);
    return 0.74 + 0.30 * n;
  }
  if (kind === 'pulse') return 0.88 + 0.12 * Math.sin(t * 0.85 + phase);
  return 1;
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

  const _far = new THREE.Vector3();
  const tick = () => {
    const dt = Math.min(state.clock.getDelta(), 0.05);
    const t = state.clock.elapsedTime;

    // mouse look: a small camera offset, lerped
    state.mouse.cx += (state.mouse.x - state.mouse.cx) * 0.06;
    state.mouse.cy += (state.mouse.y - state.mouse.cy) * 0.06;

    // clouds cross the sky and wrap round; slow enough to read as weather
    for (const d of state.drift) {
      let x = d.mesh.position.x + d.speed * dt;
      if (x > d.x0 + d.span / 2) x -= d.span;
      d.mesh.position.x = x;
    }
    if (state.groundMats) {
      for (const m of state.groundMats) {
        m.userData.uniforms.uCam.value.copy(camera.position);
      }
    }
    for (const b of state.backdrops) {
      b.visible = b.getWorldPosition(_far).distanceTo(camera.position) < scene.fog.far;
    }
    for (const s of state.sway) {
      s.mesh.rotation.z = Math.sin(t * 0.42 + s.phase) * 0.0087;   // ~0.5deg
    }
    for (const L of state.lights) {
      // lightHold freezes the flicker so before/after captures are comparable
      const k = state.lightHold !== undefined ? state.lightHold
                                              : lightLevel(L.kind, t, L.phase);
      for (const p of L.parts) p.mesh.material.opacity = p.base * k;
    }
    if (state.stepEmitters) state.stepEmitters(state, dt, t);

    if (state.composer) state.composer.render(dt);
    else renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
