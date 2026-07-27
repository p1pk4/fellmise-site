/* Fellmise — header chrome and the scroll journey.
   Jobs: mobile menu, Devlog placeholder, time-of-day tint on the village, and
   the biome journey (gate zoom, reveal curtains, parallax, lazy promotion).

   The journey is OFF for prefers-reduced-motion or viewports under 760px — the
   page then falls back to plain stacked biome sections with the same content,
   nothing hidden. Only transform and opacity are ever animated. */

(function () {
  'use strict';

  var STATIC_MAX = 760;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isStatic = reduced || window.innerWidth < STATIC_MAX;
  if (isStatic) document.body.classList.add('is-static');

  /* ------------------------------------------------ mobile menu ---------- */
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

  /* ------------------------------------------------ devlog placeholder --- */
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
  var village = document.querySelector('.biome--village');
  if (village) {
    var partOfDay = function (h) {
      if (h >= 5 && h < 8) return 'dawn';
      if (h >= 8 && h < 18) return 'day';
      if (h >= 18 && h < 21) return 'dusk';
      return 'night';
    };
    var paintClock = function () {
      var labels = window.TOD_LABELS || {};
      var tod = partOfDay(new Date().getHours());
      village.setAttribute('data-tod', tod);
      var text = document.getElementById('clock-text');
      if (text) text.textContent = (labels.prefix || '') + ' ' + (labels[tod] || tod);
    };
    paintClock();
    setInterval(paintClock, 60000);   // roll over into the next phase in an open tab
  }

  /* ------------------------------------------------ lazy promotion ------- */
  /* Images below the first screen ship with loading="lazy" so they cost the
     first screen nothing and still work without JS. Flipping an unloaded image
     back to eager starts its fetch, so one section ahead of the viewport the
     next biome is promoted and is decoded by the time it is reached. */
  var biomes = [].slice.call(document.querySelectorAll('.biome'));
  if ('IntersectionObserver' in window) {
    var warm = function (section) {
      if (!section || section.dataset.warm) return;
      section.dataset.warm = '1';
      [].forEach.call(section.querySelectorAll('img[loading="lazy"]'), function (img) {
        img.loading = 'eager';
      });
    };
    var warmer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var i = biomes.indexOf(en.target);
        warm(biomes[i + 1]);
        var gate = en.target.nextElementSibling;
        if (gate && gate.classList.contains('gate')) warm(gate);
      });
    }, { rootMargin: '60% 0px' });
    biomes.forEach(function (b) { warmer.observe(b); });
  }

  if (isStatic) return;

  /* ------------------------------------------------ journey -------------- */
  var gates = [].slice.call(document.querySelectorAll('.gate')).map(function (g) {
    return {
      el: g,
      art: g.querySelector('.gate__art'),
      veil: g.querySelector('.gate__veil'),
      next: g.nextElementSibling && g.nextElementSibling.classList.contains('biome')
        ? g.nextElementSibling.querySelector('.biome__reveal') : null
    };
  });

  var layers = biomes.map(function (b) {
    return { el: b, sprites: [].slice.call(b.querySelectorAll('.sprite[data-depth]')) };
  });

  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var ticking = false;

  function frame() {
    ticking = false;
    var vh = window.innerHeight;

    for (var i = 0; i < gates.length; i++) {
      var g = gates[i];
      var r = g.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;   // far away, skip the math
      // progress across the gate's scroll length, 0 when its top hits the
      // viewport top, 1 when its bottom does
      var span = r.height - vh;
      var p = clamp01(span > 0 ? -r.top / span : 0);

      if (g.art) {
        g.art.style.transform = 'scale(' + (1 + p * 5).toFixed(3) + ')';
        g.art.style.opacity = (1 - clamp01((p - 0.55) / 0.35)).toFixed(3);
      }
      if (g.veil) g.veil.style.opacity = clamp01(p / 0.85).toFixed(3);
      // the biome after the gate emerges out of that darkness
      if (g.next) g.next.style.opacity = (1 - clamp01((p - 0.75) / 0.25)).toFixed(3);
    }

    for (var j = 0; j < layers.length; j++) {
      var L = layers[j];
      var lr = L.el.getBoundingClientRect();
      if (lr.bottom < 0 || lr.top > vh) continue;
      // -1 .. 1 across the viewport
      var t = (vh - lr.top) / (vh + lr.height) - 0.5;
      for (var k = 0; k < L.sprites.length; k++) {
        var sp = L.sprites[k];
        var d = parseFloat(sp.getAttribute('data-depth')) || 0;
        sp.style.transform = 'translate3d(0,' + (t * d * -160).toFixed(2) + 'px,0)';
      }
    }
  }

  function onScroll() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(frame); }
  }

  // curtains start opaque so a biome entered through a gate emerges from black
  gates.forEach(function (g) { if (g.next) g.next.style.opacity = '1'; });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  frame();
})();
