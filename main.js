/* Fellmise — hero scene behaviour and header chrome.
   Jobs: tint the scene to the visitor's local time of day, drift the sprite
   layers on scroll, run the mobile menu, and pop the Devlog placeholder.
   Motion is skipped when the visitor asked for reduced motion (the colour wash
   stays — a tint is not movement). */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------ mobile menu ---------- */
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Following an anchor should close the menu, not leave it covering the page.
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
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* ------------------------------------------------ time of day ---------- */
  var hero = document.getElementById('hero');
  if (!hero) return;

  function partOfDay(h) {
    if (h >= 5 && h < 8) return 'dawn';
    if (h >= 8 && h < 18) return 'day';
    if (h >= 18 && h < 21) return 'dusk';
    return 'night';
  }

  function paintClock() {
    var labels = window.TOD_LABELS || {};
    var tod = partOfDay(new Date().getHours());
    hero.setAttribute('data-tod', tod);
    var text = document.getElementById('clock-text');
    if (text) text.textContent = (labels.prefix || '') + ' ' + (labels[tod] || tod);
  }

  paintClock();
  // Re-check on the minute so an open tab rolls over into the next phase.
  setInterval(paintClock, 60000);

  /* ------------------------------------------------ parallax ------------- */
  if (reduced) return;

  var layers = [].slice.call(hero.querySelectorAll('.sprite'));
  if (!layers.length) return;

  var ticking = false;

  function apply() {
    var y = window.pageYOffset || document.documentElement.scrollTop;
    // Only the hero is animated; past it the transform is irrelevant.
    if (y < hero.offsetHeight + 200) {
      for (var i = 0; i < layers.length; i++) {
        var d = parseFloat(layers[i].getAttribute('data-depth')) || 0;
        layers[i].style.transform = 'translate3d(0,' + (y * d).toFixed(2) + 'px,0)';
      }
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(apply);
    }
  }, { passive: true });

  apply();
})();
