/* Fellmise next/ — DOM chrome, fallback decision, ScrollTrigger -> Pixi bridge.
 *
 * The renderer is only started when it can actually help: a wide viewport,
 * motion allowed, and a working WebGL context. Otherwise the page stays exactly
 * what it is without JS — DOM sections with the same sprites and the same copy.
 */

(function () {
  'use strict';

  var STATIC_MAX = 760;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  // The Pixi layer is OPT-IN (?pixi=1) until its rendering is signed off.
  // Scene graph, textures, layout, particles and gate choreography are all in
  // place, but the scene renders squeezed into a corner on this driver and the
  // cause is not yet found — so the default preview is the static version,
  // which is complete and correct. See DEVLOG.
  var wantPixi = new URLSearchParams(location.search).get('pixi') === '1';
  var usePixi = wantPixi && !reduced && window.innerWidth >= STATIC_MAX && hasWebGL();
  document.body.classList.add(usePixi ? 'is-pixi' : 'is-static');

  /* ------------------------------------------------ header chrome -------- */
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.classList.contains('nav__link') && e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
  var devBtn = document.getElementById('devlog-btn');
  if (devBtn) {
    var wrap = devBtn.parentNode;
    var close = function () {
      wrap.classList.remove('is-open');
      devBtn.setAttribute('aria-expanded', 'false');
    };
    devBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var o = wrap.classList.toggle('is-open');
      devBtn.setAttribute('aria-expanded', o ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ------------------------------------------------ time of day ---------- */
  function partOfDay(h) {
    if (h >= 5 && h < 8) return 'dawn';
    if (h >= 8 && h < 18) return 'day';
    if (h >= 18 && h < 21) return 'dusk';
    return 'night';
  }
  var village = document.querySelector('.sec--village');
  var todNow = partOfDay(new Date().getHours());
  function paintClock(setTod) {
    var labels = window.TOD_LABELS || {};
    todNow = partOfDay(new Date().getHours());
    if (village) village.setAttribute('data-tod', todNow);
    var text = document.getElementById('clock-text');
    if (text) text.textContent = (labels.prefix || '') + ' ' + (labels[todNow] || todNow);
    if (setTod) setTod(todNow);
  }
  paintClock(null);

  if (!usePixi) return;

  /* ------------------------------------------------ start the renderer --- */
  import('./journey.js').then(function (mod) {
    return mod.startJourney({
      sceneUrl: window.SCENE_URL || 'scene.json',
      assetBase: window.ASSET_BASE || 'assets/',
      onReady: wire,
    });
  }).catch(function (err) {
    // any failure at all falls back to the static page rather than a blank one
    document.body.classList.remove('is-pixi');
    document.body.classList.add('is-static');
    if (window.console) console.warn('journey disabled:', err);
  });

  function wire(api) {
    setInterval(function () { paintClock(api.setTod); }, 60000);
    paintClock(api.setTod);

    if (!window.gsap || !window.ScrollTrigger) return;
    gsap.registerPlugin(ScrollTrigger);

    // Each biome section owns the camera while it is on screen...
    api.biomes.forEach(function (id) {
      var el = document.getElementById('b-' + id);
      if (!el) return;
      ScrollTrigger.create({
        trigger: el,
        start: 'top 60%',
        end: 'bottom 40%',
        onToggle: function (self) { if (self.isActive) api.setBiome(id, 0); },
      });
    });

    // ...and each gate zone scrubs the tunnel between two biomes.
    api.gates.forEach(function (g) {
      var zone = document.querySelector('.gatezone[data-gate="' + g.from + '"]');
      if (!zone) return;
      ScrollTrigger.create({
        trigger: zone,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: function (self) { api.setGate(g, self.progress); },
        onLeave: function () { api.setBiome(nextOf(g.from), 0); },
        onLeaveBack: function () { api.setBiome(g.from, 0); },
      });
    });

    function nextOf(id) {
      var i = api.biomes.indexOf(id);
      return api.biomes[i + 1] || id;
    }

    // first paint: village
    api.setBiome(api.biomes[0], 0);
    ScrollTrigger.refresh();
    document.body.classList.add('is-journey-ready');
  }
})();
