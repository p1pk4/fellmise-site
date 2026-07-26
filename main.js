/* Fellmise — header chrome, the biome journey and its idle life.

   Motion budget, in the order it degrades:
     desktop        ScrollSmoother + gate tunnels + mouse parallax + particles
     < 1024px       no mouse parallax
     < 760px        no smoother, no gates, no particles (glows stay)
     reduced motion nothing but the time-of-day tint

   Every animated property is transform or opacity. */

(function () {
  'use strict';

  var STATIC_MAX = 760;
  var MOUSE_MIN = 1024;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = window.matchMedia('(hover: none)').matches;
  var isStatic = reduced || window.innerWidth < STATIC_MAX;
  var params = new URLSearchParams(location.search);

  if (isStatic) document.body.classList.add('is-static');
  if (params.get('debug') === 'rows') document.body.classList.add('is-debug-rows');

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
      var open = wrap.classList.toggle('is-open');
      devBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ------------------------------------------------ time of day ---------- */
  /* Village only, and the whole scene at once. */
  var village = document.querySelector('.biome--village');
  if (village) {
    var partOfDay = function (h) {
      if (h >= 5 && h < 8) return 'dawn';
      if (h >= 8 && h < 18) return 'day';
      if (h >= 18 && h < 21) return 'dusk';
      return 'night';
    };
    var TINT = {
      day: 'transparent',
      dawn: 'linear-gradient(180deg, rgba(255,178,120,.34), rgba(255,226,180,.12))',
      dusk: 'linear-gradient(180deg, rgba(255,132,72,.34), rgba(120,60,90,.20))',
      night: 'linear-gradient(180deg, rgba(18,26,72,.52), rgba(20,34,74,.42))'
    };
    var paint = function () {
      var labels = window.TOD_LABELS || {};
      var tod = partOfDay(new Date().getHours());
      village.setAttribute('data-tod', tod);
      var tint = village.querySelector('.biome__tint');
      if (tint) tint.style.background = TINT[tod];
      var text = document.getElementById('clock-text');
      if (text) text.textContent = (labels.prefix || '') + ' ' + (labels[tod] || tod);
    };
    paint();
    setInterval(paint, 60000);
  }

  /* ------------------------------------------------ lazy promotion ------- */
  var biomes = [].slice.call(document.querySelectorAll('.biome'));
  if ('IntersectionObserver' in window) {
    var warm = function (el) {
      if (!el || el.dataset.warm) return;
      el.dataset.warm = '1';
      [].forEach.call(el.querySelectorAll('img[loading="lazy"]'), function (img) {
        img.loading = 'eager';
      });
    };
    var warmer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var i = biomes.indexOf(en.target);
        warm(biomes[i + 1]);
        var g = en.target.nextElementSibling;
        if (g && g.classList.contains('gate')) warm(g);
      });
    }, { rootMargin: '60% 0px' });
    biomes.forEach(function (b) { warmer.observe(b); });
  }

  /* ------------------------------------------------ idle life ------------ */
  /* Staggered by index so two copies of the same prop never pulse together. */
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function stagger(sel, durMin, durMax) {
    [].forEach.call(document.querySelectorAll(sel), function (el, i) {
      el.style.setProperty('--dur', rnd(durMin, durMax).toFixed(2) + 's');
      el.style.setProperty('--delay', (-i * 1.7 - Math.random() * 2).toFixed(2) + 's');
    });
  }

  function particles(scene, kind, n, box) {
    var layer = document.createElement('div');
    layer.className = 'fx fx--' + kind;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i');
      p.style.left = rnd(box[0], box[2]).toFixed(1) + '%';
      p.style.top = rnd(box[1], box[3]).toFixed(1) + '%';
      p.style.setProperty('--dx', rnd(-18, 18).toFixed(0) + 'px');
      p.style.setProperty('--dur', rnd(kind === 'smoke' ? 6 : 4, kind === 'smoke' ? 9 : 8).toFixed(1) + 's');
      p.style.setProperty('--delay', (-rnd(0, 8)).toFixed(1) + 's');
      layer.appendChild(p);
    }
    scene.appendChild(layer);
  }

  if (!reduced) {
    stagger('.sprite--tree-a img, .sprite--tree-b img, .sprite--tree-a2 img,' +
            '.sprite--pine-a img, .sprite--pine-b img, .sprite--deadtree img,' +
            '.sprite--deadtree2 img', 6, 9);
    stagger('.sprite--lantern img, .sprite--lantern2 img,' +
            '.sprite--brazier img, .sprite--brazier2 img', 2.6, 4.2);
    stagger('.sprite--crystals img', 4, 7);

    if (window.innerWidth >= STATIC_MAX) {
      var sceneOf = function (id) {
        var b = document.querySelector('.biome--' + id);
        return b && b.querySelector('.biome__scene');
      };
      var v = sceneOf('village'), f = sceneOf('forest'),
          m = sceneOf('mine'), sp = sceneOf('spirit'), hm = sceneOf('home');
      // chimney smoke sits over the two village roofs
      if (v) { particles(v, 'smoke', 4, [18, 26, 26, 34]); particles(v, 'smoke', 4, [62, 22, 70, 30]); }
      if (hm) particles(hm, 'smoke', 3, [16, 26, 24, 34]);
      if (f) particles(f, 'fly', 10, [8, 40, 92, 78]);
      if (sp) particles(sp, 'wisp', 7, [10, 35, 92, 80]);
      if (m) particles(m, 'spark', 6, [58, 40, 78, 70]);
    }
  }

  if (isStatic) return;

  /* ------------------------------------------------ GSAP journey --------- */
  /* Loaded here rather than with a <script> tag: below 760px or under reduced
     motion the journey never runs, and the library would be 127 KB of dead
     weight on exactly the devices that can least afford it. */
  var BASE = document.currentScript ? '' : '';
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var el = document.createElement('script');
      el.src = src; el.async = false;
      el.onload = res; el.onerror = rej;
      document.head.appendChild(el);
    });
  }

  var vendor = (document.documentElement.lang === 'ru' ? '../' : '') + 'vendor/';
  loadScript(vendor + 'gsap.min.js')
    .then(function () { return loadScript(vendor + 'ScrollTrigger.min.js'); })
    .then(function () { return loadScript(vendor + 'ScrollSmoother.min.js'); })
    .then(startJourney)
    .catch(function () { /* no journey; the page still works as sections */ });

  function startJourney() {
  var gsap = window.gsap;
  if (!gsap) return;
  gsap.registerPlugin(window.ScrollTrigger, window.ScrollSmoother);

  if (window.ScrollSmoother && !touch) {
    window.ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 1.05,
      effects: false,
      normalizeScroll: false
    });
  }

  /* --- gate tunnels ------------------------------------------------------ */
  [].forEach.call(document.querySelectorAll('.gate'), function (gate) {
    var zoom = gate.querySelector('.gate__zoom');
    var door = gate.querySelector('.gate__door');
    var light = gate.querySelector('.gate__light');
    var glow = gate.querySelector('.gate__glow');
    var vig = gate.querySelector('.gate__vignette');
    var nextBiome = gate.nextElementSibling;
    var reveal = nextBiome && nextBiome.classList.contains('biome')
      ? nextBiome.querySelector('.biome__reveal') : null;
    var nextScene = nextBiome && nextBiome.classList.contains('biome')
      ? nextBiome.querySelector('.biome__scene') : null;

    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: gate,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1,
        pin: gate.querySelector('.gate__stage'),
        pinSpacing: false,
        anticipatePin: 1
      },
      defaults: { ease: 'power2.inOut' }
    });

    // The hinge must sit on the door's own left edge. The door layer spans the
    // whole stage, so a percentage origin would hinge on the stage, not the art;
    // measure the rendered image and convert to pixels once it has loaded.
    if (door) {
      var setHinge = function () {
        var img = door.querySelector('img');
        if (!img || !img.complete || !img.naturalWidth) return;
        var ib = img.getBoundingClientRect(), db = door.getBoundingClientRect();
        var frac = parseFloat(getComputedStyle(door).getPropertyValue('--hinge')) / 100;
        if (!frac) frac = 0.41;
        door.style.transformOrigin = ((ib.left - db.left) + ib.width * frac).toFixed(1) + 'px 50%';
      };
      setHinge();
      var dimg = door.querySelector('img');
      if (dimg && !dimg.complete) dimg.addEventListener('load', setHinge);
      window.addEventListener('resize', setHinge);
    }

    // Ф1 approach — the scene leans in, the door swings, light kindles
    tl.fromTo(zoom, { scale: 1 }, { scale: 1.15, duration: 0.35 }, 0);
    if (door) tl.fromTo(door, { rotateY: 0 }, { rotateY: -85, duration: 0.30 }, 0.04);
    if (light) tl.fromTo(light, { opacity: 0, scale: 0.7 },
                                { opacity: 1, scale: 1, duration: 0.32 }, 0.05);

    // Ф2 fall-through — the camera flies into the opening
    tl.to(zoom, { scale: 3.2, duration: 0.40 }, 0.35);
    if (light) tl.to(light, { scale: 3.4, opacity: 0.9, duration: 0.40 }, 0.35);
    if (vig) tl.fromTo(vig, { opacity: 0 }, { opacity: 1, duration: 0.40 }, 0.35);
    if (glow) tl.fromTo(glow, { opacity: 0 }, { opacity: 1, duration: 0.34 }, 0.44);

    // Ф3 birth — the next biome comes out of the light from depth
    if (reveal) tl.fromTo(reveal, { opacity: 1 }, { opacity: 0, duration: 0.25 }, 0.75);
    if (nextScene) tl.fromTo(nextScene, { scale: 1.25 }, { scale: 1, duration: 0.25 }, 0.75);
    if (glow) tl.to(glow, { opacity: 0, duration: 0.25 }, 0.75);
    tl.to(zoom, { opacity: 0, duration: 0.15 }, 0.80);
  });

  /* --- parallax inside a biome ------------------------------------------ */
  biomes.forEach(function (b) {
    var scene = b.querySelector('.biome__scene');
    if (!scene) return;
    [].forEach.call(scene.querySelectorAll('.sprite[data-row]'), function (sp) {
      var row = parseInt(sp.getAttribute('data-row'), 10) || 0;
      gsap.to(sp, {
        yPercent: (2 - row) * -6,          // far rows drift more
        ease: 'none',
        scrollTrigger: { trigger: b, start: 'top bottom', end: 'bottom top', scrub: 1 }
      });
    });
  });

  /* --- mouse parallax ---------------------------------------------------- */
  if (!touch && window.innerWidth >= MOUSE_MIN) {
    var scenes = [].map.call(document.querySelectorAll('.biome__scene'), function (sc) {
      return {
        el: sc,
        layers: [].slice.call(sc.querySelectorAll('.sprite[data-row]')),
        tx: 0, ty: 0, cx: 0, cy: 0
      };
    });
    var mx = 0, my = 0;
    window.addEventListener('mousemove', function (e) {
      mx = (e.clientX / window.innerWidth) - 0.5;
      my = (e.clientY / window.innerHeight) - 0.5;
    }, { passive: true });

    var SHIFT = [1, 2, 3.5];               // % of width per row, per the brief
    gsap.ticker.add(function () {
      for (var i = 0; i < scenes.length; i++) {
        var s = scenes[i];
        s.cx += (mx - s.cx) * 0.06;        // lerp
        s.cy += (my - s.cy) * 0.06;
        gsap.set(s.el, { rotateX: (-s.cy * 0.8).toFixed(3), rotateY: (s.cx * 0.8).toFixed(3) });
        for (var j = 0; j < s.layers.length; j++) {
          var row = parseInt(s.layers[j].getAttribute('data-row'), 10) || 0;
          gsap.set(s.layers[j], { xPercent: -s.cx * SHIFT[row] * 2 });
        }
      }
    });
  }
  }
})();
