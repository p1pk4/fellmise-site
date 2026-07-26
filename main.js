/* Fellmise — hero scene behaviour.
   Two jobs: tint the scene to the visitor's local time of day, and drift the
   sprite layers on scroll. Both are skipped when the visitor asked for reduced
   motion (the tint stays, the movement does not — a colour wash is not motion). */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hero = document.getElementById('hero');
  if (!hero) return;

  /* ------------------------------------------------ time of day ---------- */
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
