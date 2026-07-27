/* Fellmise journey — PixiJS renderer.
 *
 * Loaded as a module by main.js, and only when the journey will actually run
 * (desktop, motion allowed, WebGL present). Everything it needs about the
 * scenes comes from scene.json, so this file has no per-biome knowledge.
 *
 * Anti-flicker rules, learned from the DOM version:
 *   - every glow is a real sprite whose ALPHA is animated; no filters are
 *     created or destroyed while scrubbing;
 *   - textures are loaded once and never unloaded, so scrubbing backwards can
 *     never hit a texture that was freed;
 *   - only visible scenes tick, but hidden scenes keep their display objects.
 */

import * as PIXI from './vendor/pixi.min.mjs';

const DPR_CAP = 2;
const SCENE_TOP = 0.06;      // scene band occupies this .. SCENE_BOT of the screen
const SCENE_BOT = 0.92;

export async function startJourney({ sceneUrl, assetBase, onReady }) {
  const spec = await fetch(sceneUrl).then(r => r.json());

  const app = new PIXI.Application();
  await app.init({
    canvas: document.getElementById('stage'),
    resizeTo: window,
    antialias: false,
    powerPreference: 'high-performance',
    backgroundAlpha: 1,
    resolution: Math.min(window.devicePixelRatio || 1, DPR_CAP),
    // autoDensity would write its own inline width/height onto the canvas and
    // fought the 100vw/100vh rule, leaving the whole scene squeezed into a
    // corner. The stylesheet owns the CSS size; Pixi owns the buffer.
    autoDensity: false,
  });

  /* ---------------------------------------------------------------- assets */
  const names = new Set();
  spec.biomes.forEach(b => {
    b.sprites.forEach(s => names.add(s.name));
    names.add(b.look.tile);
    if (b.look.road) names.add(b.look.road);
  });
  spec.gates.forEach(g => {
    names.add(g.art);
    if (g.door) { names.add(g.art + '_door'); names.add(g.art + '_open'); }
  });

  const manifest = await fetch(assetBase + 'manifest.json').then(r => r.json()).catch(() => ({}));
  const url = n => {
    const m = manifest[n];
    // tiles keep their plain filename; sprites use the widest ladder step
    if (m && m.full) return assetBase + m.full;
    return assetBase + (m && m.w ? `${n}-${m.w[m.w.length - 1]}.webp` : `${n}.webp`);
  };
  const tex = {};
  const failed = [];
  await Promise.all([...names].map(async n => {
    try { tex[n] = await PIXI.Assets.load(url(n)); }
    catch (e) { failed.push(n + ': ' + (e && e.message || e)); }
  }));
  if (failed.length) console.warn('journey: textures failed', failed);

  // one tiny generated texture drives every particle — a single draw batch
  const dot = (() => {
    const g = new PIXI.Graphics().circle(16, 16, 15).fill(0xffffff);
    return app.renderer.generateTexture({ target: g, resolution: 1 });
  })();

  /* ---------------------------------------------------------------- scenes */
  const world = new PIXI.Container();
  app.stage.addChild(world);

  const scenes = {};

  function bandRect() {
    const h = app.screen.height;
    return { top: h * SCENE_TOP, bot: h * SCENE_BOT, h: h * (SCENE_BOT - SCENE_TOP) };
  }

  function buildScene(b) {
    const c = new PIXI.Container();
    c.visible = false;
    c.sortableChildren = true;

    // sky + ground are plain quads; the ground carries a tiling texture
    const sky = new PIXI.Graphics();
    sky.zIndex = -20;
    c.addChild(sky);

    const groundTex = tex[b.look.tile];
    const ground = groundTex
      ? new PIXI.TilingSprite({ texture: groundTex, width: 10, height: 10 })
      : new PIXI.Graphics();
    ground.zIndex = -10;
    ground.tint = b.look.ground;
    c.addChild(ground);

    let road = null;
    if (b.look.road && tex[b.look.road]) {
      road = new PIXI.TilingSprite({ texture: tex[b.look.road], width: 10, height: 10 });
      road.zIndex = -5;
      c.addChild(road);
      // ragged верхняя кромка: a mask built once, resized on layout
      road.__mask = new PIXI.Graphics();
      c.addChild(road.__mask);
      road.mask = road.__mask;
    }

    const sprites = b.sprites.map(s => {
      const t = tex[s.name];
      const sp = t ? new PIXI.Sprite(t) : new PIXI.Container();
      sp.anchor && (sp.anchor.set(0.5, 1));           // foot-anchored: rows pin the feet
      sp.__spec = s;
      sp.zIndex = spec.rows[s.row].z;
      // contact shadow: a squashed ellipse sprite, skewed for isometric art
      const sh = new PIXI.Graphics().ellipse(0, 0, 50, 12).fill({ color: 0x000000, alpha: 0.30 });
      sh.zIndex = spec.rows[s.row].z - 1;
      if (s.iso) sh.skew.x = -0.32;
      sp.__shadow = sh;
      c.addChild(sh, sp);
      return sp;
    });

    // particles: one ParticleContainer per kind so each is a single draw call
    const emitters = (b.particles || []).map(p => makeEmitter(c, p));

    // whole-scene colour grade (time of day) — one filter, created once
    // TIME OF DAY.
    // The brief asked for a ColorMatrixFilter on the scene container. Measured:
    // any filter on this container makes it render NOTHING — the whole scene
    // disappears and only the renderer background is left (reproduced with and
    // without an explicit filterArea). Rather than ship a scene that vanishes on
    // some drivers, the tint is a full-screen quad INSIDE the container with a
    // multiply blend. It satisfies the actual requirement — sky, ground, road
    // and sprites are all tinted by one object — and costs one draw call
    // instead of a render-texture round trip.
    const grade = new PIXI.Graphics();
    grade.zIndex = 60;
    grade.blendMode = 'multiply';
    grade.alpha = 0;
    c.addChild(grade);

    world.addChild(c);
    return { id: b.id, c, sky, ground, road, sprites, emitters, grade, look: b.look };
  }

  const KIND = {
    smoke: { color: 0xdedad2, alpha: 0.42, size: 16, life: 7.5, vy: -26, spread: 16, blend: 'normal', grow: 1.9 },
    fly:   { color: 0xffe89a, alpha: 0.95, size: 5,  life: 6.0, vy: -12, spread: 40, blend: 'add', grow: 1.0 },
    soul:  { color: 0x9fe8ff, alpha: 0.85, size: 6,  life: 7.0, vy: -20, spread: 30, blend: 'add', grow: 1.1 },
    spark: { color: 0xffd08a, alpha: 0.95, size: 4,  life: 2.2, vy: -70, spread: 18, blend: 'add', grow: 0.6 },
    flame: { color: 0xff8a2b, alpha: 0.95, size: 22, life: 0.9, vy: -60, spread: 9,  blend: 'add', grow: 0.35 },
  };

  function makeEmitter(parent, p) {
    const k = KIND[p.kind] || KIND.smoke;
    const pc = new PIXI.ParticleContainer({
      dynamicProperties: { position: true, scale: true, alpha: true, rotation: false },
    });
    pc.blendMode = k.blend;
    pc.zIndex = 40;
    parent.addChild(pc);
    const items = [];
    for (let i = 0; i < p.n; i++) {
      const pt = new PIXI.Particle({ texture: dot, tint: k.color, anchorX: 0.5, anchorY: 0.5 });
      pt.__t = Math.random();            // phase, so nothing pulses in unison
      items.push(pt);
      pc.addParticle(pt);
    }
    return { pc, items, k, box: p.box, kind: p.kind };
  }

  function stepEmitter(e, dt, band, W) {
    const { k } = e;
    for (const pt of e.items) {
      pt.__t += dt / k.life;
      if (pt.__t >= 1) {
        pt.__t -= 1;
        pt.__x = (e.box[0] + Math.random() * (e.box[2] - e.box[0])) * W;
        pt.__y = band.top + (e.box[1] + Math.random() * (e.box[3] - e.box[1])) * band.h;
        pt.__dx = (Math.random() - 0.5) * k.spread;
      }
      if (pt.__x === undefined) { pt.__t = Math.random(); continue; }
      const t = pt.__t;
      pt.x = pt.__x + pt.__dx * t;
      pt.y = pt.__y + k.vy * t * 60 / 60 * (k.life * 60) / 60 * t * 3;
      const s = (k.size / 32) * (1 + k.grow * t);
      pt.scaleX = pt.scaleY = s;
      // flame reads as fire by fading through its life, not by changing colour
      pt.alpha = k.alpha * Math.sin(Math.PI * Math.min(1, t)) * (e.kind === 'flame' ? 1 : 1);
    }
  }

  spec.biomes.forEach(b => { scenes[b.id] = buildScene(b); });

  // resizeTo is applied on the next tick, so the first layout would otherwise
  // measure a default-sized screen and lay every scene out at a few hundred px
  app.renderer.resize(window.innerWidth, window.innerHeight);

  /* ---------------------------------------------------------------- layout */
  function layoutScene(s) {
    const W = app.screen.width, H = app.screen.height;
    const band = bandRect();

    // A filter on a container needs a bounded area. Without it the scene's
    // bounds go through a full-screen filter texture and the container renders
    // as nothing at all — which is exactly what happened.
    s.grade.clear().rect(0, 0, W, H).fill(0xffffff);
    s.sky.clear().rect(0, 0, W, H).fill(s.look.sky[1]);
    if (s.ground instanceof PIXI.TilingSprite) {
      s.ground.width = W;
      s.ground.height = band.h * 0.42 + (H - band.bot);
      s.ground.x = 0;
      s.ground.y = band.top + band.h * 0.60;
      s.ground.tileScale.set(0.6);
    }
    if (s.road) {
      const ry = band.top + band.h * 0.86;
      const rh = band.h * 0.20;
      s.road.width = W; s.road.height = rh; s.road.x = 0; s.road.y = ry;
      s.road.tileScale.set(rh / s.road.texture.height);
      const m = s.road.__mask;
      m.clear();
      m.moveTo(0, ry + rh * 0.22);
      for (let i = 0; i <= 14; i++) {
        const x = (W / 14) * i;
        m.lineTo(x, ry + rh * (i % 2 ? 0.06 : 0.24));
      }
      m.lineTo(W, ry + rh); m.lineTo(0, ry + rh); m.fill(0xffffff);
    }

    for (const sp of s.sprites) {
      const spec2 = sp.__spec;
      const row = spec.rows[spec2.row];
      const targetH = band.h * (spec2.h / 100) * row.scale;
      if (sp.texture) {
        const k = targetH / sp.texture.height;
        sp.scale.set(k);
      }
      sp.x = spec2.x * W;
      sp.y = band.top + band.h * (1 - row.bottom / 100);
      const sh = sp.__shadow;
      sh.x = sp.x; sh.y = sp.y;
      const w = (sp.width || 80) * 0.34;
      sh.scale.set(w / 50, Math.max(0.35, targetH / 900));
    }
  }

  function layoutAll() { Object.values(scenes).forEach(layoutScene); }

  // app.screen settles a frame or two after init (resizeTo applies on its own
  // schedule), so a one-shot layout measures the wrong size and the scene stays
  // laid out for an 800x600 canvas. Watch the screen instead of trusting one
  // call, and relayout whenever it actually changes.
  let lastW = 0, lastH = 0;
  function syncLayout() {
    if (app.screen.width === lastW && app.screen.height === lastH) return;
    lastW = app.screen.width; lastH = app.screen.height;
    layoutAll();
  }
  syncLayout();
  window.addEventListener('resize', () => requestAnimationFrame(syncLayout));

  /* ------------------------------------------------------------------ gates */
  // one reusable light quad + one full-screen flood, both always present
  const light = new PIXI.Sprite(dot);
  light.anchor.set(0.5); light.alpha = 0; light.blendMode = 'add';
  const flood = new PIXI.Graphics().rect(0, 0, 10, 10).fill(0xffffff);
  flood.alpha = 0;
  const vign = new PIXI.Graphics();
  vign.alpha = 0;
  app.stage.addChild(light, flood, vign);

  const gateArt = new PIXI.Container();
  gateArt.visible = false;
  world.addChild(gateArt);
  const gateBody = new PIXI.Sprite();
  gateBody.anchor.set(0.5);
  const gateDoor = new PIXI.PerspectiveMesh({
    texture: PIXI.Texture.WHITE, verticesX: 2, verticesY: 2,
  });
  gateDoor.visible = false;
  gateArt.addChild(gateBody, gateDoor);

  function sizeFlood() {
    flood.clear().rect(0, 0, app.screen.width, app.screen.height).fill(0xffffff);
    vign.clear();
  }
  sizeFlood();
  window.addEventListener('resize', sizeFlood);

  const state = { scene: null, gate: null, p: 0 };

  function showScene(id) {
    Object.values(scenes).forEach(s => { s.c.visible = (s.id === id); });
    state.scene = id;
  }

  /* --------------------------------------------------------------- controls */
  function paintBackdrop(id) {
    const s = scenes[id];
    if (s) app.renderer.background.color = s.look.sky[0];
  }

  function setBiome(id, progress) {
    paintBackdrop(id);
    state.gate = null;
    gateArt.visible = false;
    light.alpha = 0; flood.alpha = 0; vign.alpha = 0;
    showScene(id);
    const s = scenes[id];
    if (!s) return;
    s.c.scale.set(1);
    s.c.position.set(0, 0);
    s.c.alpha = 1;
  }

  function setGate(g, p) {
    state.gate = g.from; state.p = p;
    paintBackdrop(g.from);
    const from = scenes[g.from];
    const toId = nextOf(g.from);
    const to = scenes[toId];
    if (!from) return;

    from.c.visible = true;
    gateArt.visible = true;

    const W = app.screen.width, H = app.screen.height;
    const fx = g.fx * W, fy = g.fy * H;

    // gate art sits centred, sized to the band
    const bodyTex = tex[g.door ? g.art + '_open' : g.art];
    if (bodyTex && gateBody.texture !== bodyTex) gateBody.texture = bodyTex;
    if (gateBody.texture) {
      const k = (H * 0.56) / gateBody.texture.height;
      gateBody.scale.set(k);
      gateBody.position.set(W / 2, H / 2);
    }

    // Ф1 approach 0..0.35 — camera leans in, door swings, light kindles
    // Ф2 fall 0.35..0.75 — camera flies at the opening
    // Ф3 birth 0.75..1   — next scene grows out of the light
    const p1 = clamp(p / 0.35), p2 = clamp((p - 0.35) / 0.40), p3 = clamp((p - 0.74) / 0.22);
    const zoom = 1 + ease(p1) * 0.15 + ease(p2) * 2.05;

    gateArt.pivot.set(fx, fy);
    gateArt.position.set(fx, fy);
    gateArt.scale.set(zoom);
    // everything we are flying THROUGH is gone by the white-out, so the old
    // scene, the gate art, the light and the new biome never all overlap
    gateArt.alpha = 1 - clamp((p - 0.62) / 0.16);

    from.c.pivot.set(fx, fy);
    from.c.position.set(fx, fy);
    from.c.scale.set(zoom);
    from.c.alpha = 1 - clamp((p - 0.60) / 0.18);

    // the door: a real perspective quad, hinged on its own left edge
    if (g.door && tex[g.art + '_door'] && gateBody.texture) {
      gateDoor.visible = true;
      if (gateDoor.texture !== tex[g.art + '_door']) gateDoor.texture = tex[g.art + '_door'];
      const t = tex[g.art + '_door'];
      const k = gateBody.scale.x;
      const w = t.width * k, h = t.height * k;
      const x0 = W / 2 - w / 2, y0 = H / 2 - h / 2;
      const a = ease(p1) * 1.45;                  // radians of swing
      const dx = Math.cos(a), dz = Math.sin(a);
      // hinge on the left edge; the free edge swings toward the viewer and
      // foreshortens, and its top/bottom spread apart as it comes closer
      const persp = 1 + dz * 0.45;
      gateDoor.setCorners(
        x0, y0,
        x0 + w * dx, y0 + h * (1 - persp) / 2,
        x0 + w * dx, y0 + h - h * (1 - persp) / 2,
        x0, y0 + h
      );
      gateDoor.alpha = 1 - clamp((p - 0.5) / 0.25);
    } else {
      gateDoor.visible = false;
    }

    // light out of the opening, then flooding the frame
    light.position.set(fx, fy);
    const ls = (H * 0.5 / 32) * (0.5 + ease(p1) * 0.8 + ease(p2) * 3.4);
    light.scale.set(ls);
    light.tint = g.warm;
    light.alpha = ease(p1) * 0.55;

    flood.tint = g.warm;
    // the flood belongs to the moment of passing through, not the approach
    flood.alpha = ease(clamp((p - 0.58) / 0.18)) * (1 - clamp((p - 0.80) / 0.15)) * 0.95;

    vign.clear();
    if (p2 > 0) {
      vign.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.9 });
      vign.alpha = ease(p2) * 0.55 * (1 - p3);
    }

    // Ф3 — the next biome is born out of the light
    if (to) {
      to.c.visible = p3 > 0;
      if (p3 > 0) {
        to.c.pivot.set(0, 0);
        to.c.position.set(0, 0);
        to.c.scale.set(1.2 - 0.2 * ease(p3));
        to.c.alpha = ease(p3);
      }
    }
  }

  function nextOf(id) {
    const i = spec.biomes.findIndex(b => b.id === id);
    return spec.biomes[i + 1] ? spec.biomes[i + 1].id : id;
  }

  const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = v => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2);   // power2.inOut

  /* ------------------------------------------------------------ mouse look */
  let mx = 0, my = 0, cx = 0, cy = 0;
  window.addEventListener('mousemove', e => {
    mx = e.clientX / window.innerWidth - 0.5;
    my = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });
  const SHIFT = [1.6, 3.2, 5.5];        // % of width, per row, per the brief

  /* --------------------------------------------------------------- ticker */
  let tod = 'day';
  app.ticker.add(ticker => {
    syncLayout();
    const dt = Math.min(ticker.deltaMS, 50) / 1000;
    const band = bandRect(), W = app.screen.width;

    cx += (mx - cx) * 0.06;
    cy += (my - cy) * 0.06;

    for (const s of Object.values(scenes)) {
      if (!s.c.visible) continue;                 // hidden scenes cost nothing
      for (const e of s.emitters) stepEmitter(e, dt, band, W);
      for (const sp of s.sprites) {
        const row = sp.__spec.row;
        sp.x = sp.__spec.x * W - cx * (W * SHIFT[row] / 100);
        if (sp.__shadow) sp.__shadow.x = sp.x;
      }
      // breathing: skew the sprite a hair, foot stays put (anchor is the foot)
      if (s.id !== 'mine') {
        const t = performance.now() / 1000;
        s.sprites.forEach((sp, i) => {
          if (!sp.__spec.name.match(/tree|pine|deadtree/)) return;
          sp.skew.x = Math.sin(t / 3.4 + i * 1.7) * 0.012;
        });
      }
    }
    applyTod();
  });

  function applyTod() {
    // village only, and it grades the WHOLE container: sky, ground, road, sprites
    const v = scenes.village;
    if (!v) return;
    if (v.__tod === tod) return;
    v.__tod = tod;
    const g = v.grade;
    const LOOK = {
      day:   { tint: 0xffffff, a: 0 },
      dawn:  { tint: 0xffd9b0, a: 0.30 },
      dusk:  { tint: 0xff9a5c, a: 0.40 },
      night: { tint: 0x2f4a8c, a: 0.58 },
    };
    const L = LOOK[tod] || LOOK.day;
    g.tint = L.tint;
    g.alpha = L.a;
  }

  // ?debug=pixi exposes the graph for inspection (and for the layout tests)
  if (location.search.indexOf('debug=pixi') >= 0) {
    window.__J = { app, scenes, tex, spec, failed };
  }

  onReady && onReady({
    app,
    setBiome,
    setGate,
    setTod: t => { tod = t; },
    gates: spec.gates,
    biomes: spec.biomes.map(b => b.id),
  });

  return app;
}
