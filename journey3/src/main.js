/* Fellmise journey v3 — Three.js entry.
 *
 * Structure:
 *   main.js    capability gate, Lenis -> ScrollTrigger proxy, DOM chrome
 *   world.js   diorama construction from the existing sprite pack
 *   rail.js    the camera path and its scroll binding
 *
 * The renderer only starts when it can help. Otherwise the page stays a plain
 * scrolling document with the same copy and the same sprites — the overlay IS
 * the fallback, so there is nothing to keep in sync.
 */

import './style.css';

const STATIC_MAX = 760;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const params = new URLSearchParams(location.search);
const forceStatic = params.get('static') === '1';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const live = !forceStatic && !reduced && innerWidth >= STATIC_MAX && hasWebGL();

document.body.classList.add(live ? 'is-live' : 'is-static');
if (params.get('debug') === '1') document.body.classList.add('is-debug');

/* ------------------------------------------------------------- time of day */
const TOD = (h) => (h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 18 ? 'day' : h >= 18 && h < 21 ? 'dusk' : 'night');
let tod = TOD(new Date().getHours());

function paintClock() {
  tod = TOD(new Date().getHours());
  const cfg = window.J3 || {};
  const el = document.getElementById('clock-text');
  if (el) el.textContent = `${cfg.todPrefix || ''} ${(cfg.tod || {})[tod] || tod}`;
  document.body.dataset.tod = tod;
}
paintClock();
setInterval(paintClock, 60000);

/* ----------------------------------------------------------------- chrome */
const veil = document.getElementById('veil');

if (!live) {
  if (veil) veil.remove();
} else {
  boot().catch((err) => {
    // Any failure at all degrades to the static page rather than a blank one.
    console.warn('journey disabled:', err);
    document.body.classList.remove('is-live');
    document.body.classList.add('is-static');
    if (veil) veil.remove();
  });
}

async function boot() {
  const [{ default: Lenis }, gsapMod, scrollMod, world, rail] = await Promise.all([
    import('lenis'),
    import('gsap'),
    import('gsap/ScrollTrigger'),
    import('./world.js'),
    import('./rail.js'),
  ]);
  const gsap = gsapMod.gsap || gsapMod.default;
  const ScrollTrigger = scrollMod.ScrollTrigger || scrollMod.default;
  gsap.registerPlugin(ScrollTrigger);

  /* The bar follows the loader, not a timer: it is the real count of textures
     the opening frame is waiting on. `total` grows as more are queued, which is
     honest — the bar slows down rather than lying about being nearly done. */
  const fill = document.getElementById('boot-fill');
  const mgr = world.loadingManager;
  if (mgr && fill) {
    mgr.onProgress = (_u, loaded, total) => {
      fill.style.width = `${Math.round((loaded / Math.max(total, 1)) * 100)}%`;
    };
  }

  const stage = await world.createWorld({ canvas: document.getElementById('stage'), tod });
  if (fill) fill.style.width = '100%';
  // Everything the opening frame needs is now in. The rest of the journey warms
  // up in the background from startLoop, so this is the only honest place to
  // measure the first-frame budget from.
  performance.mark('j3-first-frame');
  document.documentElement.dataset.firstFrame = '1';

  /* Lenis drives the scroll; ScrollTrigger reads it through a proxy so both
     agree on a single source of truth for scrollTop. */
  const lenis = new Lenis({ duration: 1.05, smoothWheel: true, syncTouch: false });
  lenis.on('scroll', ScrollTrigger.update);
  ScrollTrigger.scrollerProxy(document.documentElement, {
    scrollTop(value) {
      if (arguments.length) lenis.scrollTo(value, { immediate: true });
      return lenis.animatedScroll;
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, width: innerWidth, height: innerHeight };
    },
  });
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  rail.bindRail({ gsap, ScrollTrigger, stage });
  world.startLoop(stage);

  ScrollTrigger.refresh();
  // The splash comes off only once a frame with the village in it has actually
  // been painted. Two frames of grace, because the first rAF fires before the
  // renderer has put anything on the canvas.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.body.classList.add('is-ready');
  window.__J3 = stage;             // handles for the smoke tests
}

/* ----------------------------------------------------- mobile menu-less nav */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const el = document.querySelector(a.getAttribute('href'));
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
  });
});
