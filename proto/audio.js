/* Звук /proto/ — один менеджер на всё (живой режим; статика молчит: этот
   модуль грузит только main.js).

   Политика: по умолчанию выключено. До того как посетитель сам нажмёт
   переключатель, здесь не создаётся AudioContext и не запрашивается ни один
   файл. Сохранённое «включено» (localStorage) не обходит autoplay: звук
   поднимается только на следующем жесте пользователя (pointerdown / keydown).

   Уровни — чистая функция z камеры по ТОЙ ЖЕ карте биомов, что грунт
   (presentation: порядок биомов, blend_z переходов; сама функция biomeAt —
   из main.js, та же, что смешивает грунт): вес эмбиента i = max(0, 1 − |b − i|).
   Один z — один набор весов, вперёд и назад одинаково; сглаживание — только
   setTargetAtTime против щелчков, цель от времени не зависит.

   SFX перехода — при пересечении якоря вниз по маршруту; снова взводится,
   только когда камера отошла назад за якорь на SFX_REARM_M (дрожание колеса не
   спамит; путь назад — без звука).

   Сам assets/topdown/audio.json запрашивается только при включении звука.
   Файлы со status planned не запрашиваются никогда; live — лениво: звучащий
   эмбиент, следующий по маршруту (когда до его полосы меньше preload_ahead_m)
   и SFX ближайшего перехода. Раскодированный файл остаётся в памяти до ухода
   со страницы: обратный путь его не перезапрашивает. */

const SFX_REARM_M = 8;          // hysteresis of the transition SFX, metres of z

export function createAudio({ configUrl, presentation, biomeAt, assetsBase, locale }) {
  const STORAGE_KEY = 'fellmise.audio.enabled';
  let config = null, M = null, byBiome = {};
  const order = presentation.biomes.map((b) => b.id);
  const trans = presentation.transitions.map((t) => ({ ...t, id: `${t.from}-${t.to}`, sfx: null }));
  let configP = null;
  function loadConfig() {
    if (!configP) {
      requested.push(configUrl);
      configP = fetch(configUrl).then((r) => r.json()).then((c) => {
        config = c; M = c.master;
        byBiome = Object.fromEntries(c.biomes.map((b) => [b.id, b]));
        for (const t of trans) t.sfx = c.transitions.find((x) => x.from === t.from && x.to === t.to) || null;
        return c;
      }).catch((e) => { configP = null; throw e; });   // a later click may retry
    }
    return configP;
  }

  let enabled = false;          // what the visitor asked for (toggle)
  let wanted = false;           // stored "on", waiting for a gesture
  let ctx = null, master = null;
  const buffers = new Map();    // asset -> Promise<AudioBuffer|null>
  const voices = new Map();     // biome id -> { src, gain }
  const armed = new Map(trans.map((t) => [t.id, true]));
  const requested = [];
  let lastSfx = null, sfxCount = 0, z = null;

  // ---------------------------------------------------------------- weights
  // biomeAt is main.js's own (the ground's blend): one biome map for picture and sound
  function weights(zz) {
    const b = biomeAt(zz);
    return Object.fromEntries(order.map((id, i) => [id, +Math.max(0, 1 - Math.abs(b - i)).toFixed(4)]));
  }

  // ---------------------------------------------------------------- storage
  function stored() {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch (e) { return false; }
  }
  function store(v) {
    try { localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false'); } catch (e) { /* muted fallback */ }
  }

  // ------------------------------------------------------------------- load
  const live = (a) => a && a.status === 'live';
  function load(asset) {
    if (!buffers.has(asset)) {
      requested.push(asset);
      buffers.set(asset, fetch(assetsBase + asset)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((ab) => new Promise((ok, no) => ctx.decodeAudioData(ab, ok, no)))   // callback form: older Safari
        .catch(() => null));
    }
    return buffers.get(asset);
  }

  // ------------------------------------------------------------- the engine
  function ensureContext() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }

  // fade_ms = [in, out] of the entry: the level eases in over `in` after the
  // file starts (it may arrive while the weight is already > 0) and out over
  // `out` when the voice is released; stop() is scheduled, not timed out
  const fadeIn = (a) => ((a.fade_ms && a.fade_ms[0]) || 0) / 1000;
  const fadeOut = (a) => ((a.fade_ms && a.fade_ms[1]) || 0) / 1000;

  function startVoice(id) {
    const b = byBiome[id];
    if (voices.has(id) || !live(b)) return;
    const v = { gain: ctx.createGain(), src: null, until: Infinity };
    v.gain.gain.value = 0;
    v.gain.connect(master);
    voices.set(id, v);
    load(b.asset).then((buf) => {
      if (!buf || voices.get(id) !== v || !ctx) return;
      v.src = ctx.createBufferSource();
      v.src.buffer = buf;
      v.src.loop = b.loop !== false;
      v.src.connect(v.gain);
      v.src.start();
      v.until = ctx.currentTime + fadeIn(b);
      applyLevels();
    });
  }

  function stopVoice(id, now = false) {
    const v = voices.get(id);
    if (!v) return;
    voices.delete(id);
    const t = ctx.currentTime, out = now ? 0 : fadeOut(byBiome[id] || {});
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, out / 3 || 0.005);
    try { if (v.src) v.src.stop(t + out + 0.05); } catch (e) { /* already stopped */ }
    if (v.src) v.src.onended = () => v.gain.disconnect(); else v.gain.disconnect();
  }

  function applyLevels() {
    if (!ctx || !enabled || !config || z === null) return;
    const w = weights(z);
    const now = ctx.currentTime;
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const b = byBiome[id];
      // audible, or the next biome down the route when its blend band starts
      // within preload_ahead_m (a pure function of z, like the weights)
      const t = presentation.transitions[i - 1];
      const near = w[id] > 0 || (t && t.to === id && z <= t.blend_z[0] + M.preload_ahead_m && z > t.blend_z[0]);
      if (near && live(b)) startVoice(id);
      else if (!near) stopVoice(id);
      const v = voices.get(id);
      // the target is a pure function of z; the time constant only smooths
      if (v && v.src) v.gain.gain.setTargetAtTime(w[id] * (b.gain ?? 1), now,
        now < v.until ? Math.max(M.smoothing_s, fadeIn(b) / 3) : M.smoothing_s);
    }
    for (const t of trans) {
      if (live(t.sfx) && Math.abs(z - t.anchor_z) <= M.preload_ahead_m) load(t.sfx.asset);
    }
  }

  function sfxCheck(prevZ, nextZ) {
    for (const t of trans) {
      const a = t.anchor_z;
      if (nextZ > a + SFX_REARM_M) armed.set(t.id, true);          // back above: re-arm
      const crossed = prevZ !== null && prevZ > a && nextZ <= a;      // down the route only
      if (crossed && armed.get(t.id)) {
        armed.set(t.id, false);
        lastSfx = { id: t.id, z: +nextZ.toFixed(2) };
        sfxCount++;
        if (ctx && enabled && live(t.sfx)) {
          load(t.sfx.asset).then((buf) => {
            if (!buf || !ctx || !enabled) return;
            const s = ctx.createBufferSource(), g = ctx.createGain(), t0 = ctx.currentTime;
            const a = Math.min(fadeIn(t.sfx), buf.duration / 2), r = Math.min(fadeOut(t.sfx), buf.duration - a);
            g.gain.setValueAtTime(0, t0);
            g.gain.linearRampToValueAtTime(t.sfx.gain ?? 1, t0 + a);
            g.gain.setValueAtTime(t.sfx.gain ?? 1, t0 + buf.duration - r);
            g.gain.linearRampToValueAtTime(0, t0 + buf.duration);
            s.buffer = buf; s.connect(g); g.connect(master); s.start(t0);
            s.onended = () => g.disconnect();
          });
        }
      }
    }
  }

  async function turnOn() {
    ensureContext();              // synchronously inside the gesture
    if (!ctx) return;
    enabled = true;
    render();
    try {
      if (ctx.state !== 'running') await ctx.resume();
      await loadConfig();
    } catch (e) { enabled = false; render(); return; }
    if (!enabled) return;          // turned off while loading
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(M.gain, ctx.currentTime, M.fade_ms / 3000);
    applyLevels();
    render();
  }

  function turnOff() {
    enabled = false;
    if (ctx) {
      const fade = M ? M.fade_ms : 0;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, fade / 3000 || 0.01);
      // after the fade: release the voices and let the device sleep
      setTimeout(() => {
        if (enabled || !ctx) return;
        for (const id of [...voices.keys()]) stopVoice(id, true);
        ctx.suspend().catch(() => {});
      }, fade + 50);
    }
    render();
  }

  // ------------------------------------------------------------------- toggle
  const LABEL = { en: 'Sound', ru: 'Звук' };
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'audio-toggle';
  btn.setAttribute('aria-label', LABEL[locale] || LABEL.en);
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
    + '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>'
    + '<path class="audio-toggle__on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '<path class="audio-toggle__off" d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '</svg>';
  function render() {
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.dataset.state = enabled ? 'on' : 'off';
  }
  btn.addEventListener('click', () => {
    if (enabled) { store(false); wanted = false; turnOff(); } else { store(true); wanted = false; turnOn(); }
  });
  document.body.appendChild(btn);
  render();

  // a stored "on" comes back only with the visitor's next gesture
  wanted = stored();
  const gesture = (e) => {
    if (e.target === btn || btn.contains(e.target)) return;   // the toggle handles itself
    if (wanted && !enabled) { wanted = false; turnOn(); }
    removeEventListener('pointerdown', gesture, true);
    removeEventListener('keydown', gesture, true);
  };
  addEventListener('pointerdown', gesture, true);
  addEventListener('keydown', gesture, true);

  return {
    /* every frame (draw): z of the camera */
    update(nextZ) {
      sfxCheck(z, nextZ);
      z = nextZ;
      applyLevels();
    },
    weights,
    state() {
      return {
        enabled, pendingRestore: wanted, context: ctx ? ctx.state : 'none', unlocked: !!ctx && ctx.state === 'running',
        weights: z === null ? null : weights(z),
        ambients: Object.fromEntries([...voices].map(([id, v]) => [id, +v.gain.gain.value.toFixed(3)])),
        playing: [...voices].filter(([, v]) => v.src).map(([id]) => id),
        requested: [...requested], lastSfx, sfxCount,
      };
    },
    hud() {
      const s = this.state();
      const top = s.weights ? Object.entries(s.weights).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ') : '—';
      return `звук: <b>${s.enabled ? 'вкл' : 'выкл'}</b> · контекст ${s.context}${s.pendingRestore ? ' · ждёт жеста' : ''}\n`
        + `эмбиент: ${top} · SFX: ${s.lastSfx ? s.lastSfx.id + ' @' + s.lastSfx.z : '—'} (${s.sfxCount})`;
    },
    button: btn,
    // the live scene failed (static fallback): no sound, no toggle
    destroy() {
      enabled = false; wanted = false;
      removeEventListener('pointerdown', gesture, true);
      removeEventListener('keydown', gesture, true);
      if (ctx) for (const id of [...voices.keys()]) stopVoice(id, true);
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      btn.remove();
    },
  };
}
