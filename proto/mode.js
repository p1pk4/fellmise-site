/* Режим /proto/: живое WebGL-путешествие или статическая DOM-версия того же
   пути. ЕДИНСТВЕННОЕ место, где это решается (классический скрипт в <head>,
   до отрисовки body — без мигания).

     live    desktop, ширина >= 900, без reduced motion, есть WebGL2
     static  всё остальное: ширина < 900, prefers-reduced-motion, нет WebGL2,
             ?static=1 (диагностика), падение живой загрузки (fail())

   Без JavaScript класса нет вовсе — это тоже статическая версия: разметка по
   умолчанию и есть fallback, живому режиму нужен класс mode-live. Причину
   выбора видно только в ?debug=hud (data-mode-reason на <html>). */
(function () {
  var NARROW = 900;                       // единственный порог ширины; тесты зеркалят его
  var q = new URLSearchParams(location.search);
  var root = document.documentElement;

  function hasWebGL2() {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
  }

  var reason = q.get('static') === '1' ? 'forced'
    : innerWidth < NARROW ? 'narrow'
    : matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced-motion'
    : !hasWebGL2() ? 'no-webgl'
    : null;
  var mode = reason ? 'static' : 'live';

  // локаль — та же, что выбирает main.js (?lang=, по умолчанию EN)
  function applyLocale() {
    var sections = document.querySelectorAll('.content-locale');
    var have = Array.prototype.map.call(sections, function (s) { return s.dataset.locale; });
    var loc = have.indexOf(q.get('lang')) >= 0 ? q.get('lang') : (have[0] || 'en');
    sections.forEach(function (s) { s.hidden = s.dataset.locale !== loc; });
    if (loc === 'ru') {
      document.querySelectorAll('.key-art img[data-alt-ru]').forEach(function (i) { i.alt = i.dataset.altRu; });
    }
    root.lang = loc;
    return loc;
  }

  // статика: картинки key art — обычные ленивые <img>, мир не грузится
  function goStatic(why) {
    mode = 'static';
    reason = reason || why;
    root.classList.remove('mode-live');
    root.classList.add('mode-static');
    root.dataset.mode = 'static';
    root.dataset.modeReason = reason;
    var run = function () {
      applyLocale();
      document.querySelectorAll('.key-art img[data-src]').forEach(function (i) {
        if (!i.getAttribute('src')) { i.loading = 'lazy'; i.src = i.dataset.src; }
      });
      var c = document.querySelector('body > canvas');
      if (c) c.remove();
      var hud = document.getElementById('hud');
      if (hud && q.getAll('debug').join(',').split(',').indexOf('hud') < 0) hud.hidden = true;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }

  root.dataset.mode = mode;
  if (mode === 'live') root.classList.add('mode-live');
  else goStatic(reason);

  window.FELLMISE_MODE = {
    NARROW: NARROW,
    get mode() { return mode; },
    get reason() { return reason; },
    // живая загрузка упала (нет контекста, ошибка сборки сцены): тот же путь в DOM
    fail: function (err) {
      if (mode === 'static') return;
      reason = 'boot-failed';
      goStatic('boot-failed');
      var hud = document.getElementById('hud');
      if (hud && q.getAll('debug').join(',').split(',').indexOf('hud') >= 0) {
        hud.hidden = false;
        hud.textContent = 'ошибка: ' + (err && err.message ? err.message : err);
      }
    },
  };
})();
