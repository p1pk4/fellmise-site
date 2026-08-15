/* Scene editor — loaded only for ?editor=1, and only then.
 *
 * The journey is a scroll ride: the camera is on rails and nothing can be
 * touched. This turns it into a room you can walk around, so the placement can
 * be done by eye instead of by editing numbers and rebuilding.
 *
 *   ЛКМ по объекту   выделить
 *   ЛКМ тянуть       двигать по земле (XZ)
 *   ПКМ тянуть       осмотреться
 *   колесо           над объектом — размер, иначе — приблизить
 *   WASD / QE        лететь, Shift — быстрее
 *   R / Shift+R      повернуть по Y
 *   Del              скрыть, Backspace — вернуть последний скрытый
 *   Esc              снять выделение
 *
 * What it writes is assets/layout.json, the same file the scene reads. There is
 * no separate editor format and no second source of truth: `spec` in the object
 * registry IS the entry that came out of the file, and Export copies each mesh's
 * transform back into it.
 */

const KEY = {};
let stage, THREE, dom, state;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const r3 = (v) => Math.round(v * 1000) / 1000;

export async function startEditor(_stage, _THREE) {
  stage = _stage;
  THREE = _THREE;
  state = {
    sel: null, hidden: [], drag: null, look: false,
    yaw: 0, pitch: -0.12, speed: 18,
  };

  // the rail owns the camera on a normal visit; here nobody else may touch it
  stage.editing = true;
  document.body.classList.add('is-editing');
  stage.camera.position.set(0, 6, 14);
  aim();

  buildDom();
  bindInput();
  outline();
  loop();
  refreshList();
  say('редактор: ЛКМ — выделить и тянуть, ПКМ — осмотреться, WASD — лететь');
}

/* ----------------------------------------------------------------- camera */
function aim() {
  const c = stage.camera;
  const dir = new THREE.Vector3(
    Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch));
  c.lookAt(c.position.clone().add(dir));
  return dir;
}

function fly(dt) {
  const c = stage.camera;
  const dir = aim();
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const v = state.speed * dt * (KEY.shift ? 3 : 1);
  if (KEY.w) c.position.addScaledVector(dir, v);
  if (KEY.s) c.position.addScaledVector(dir, -v);
  if (KEY.a) c.position.addScaledVector(right, -v);
  if (KEY.d) c.position.addScaledVector(right, v);
  if (KEY.q) c.position.y -= v;
  if (KEY.e) c.position.y += v;
}

/* -------------------------------------------------------------- selection */
function pick(ev) {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(
    (ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1), stage.camera);
  const meshes = stage.editable.filter((e) => e.mesh.visible).map((e) => e.mesh);
  const hit = rc.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  return stage.editable.find((e) => e.mesh === hit.object) || null;
}

function select(entry) {
  state.sel = entry;
  outline();
  refreshList();
  if (entry) {
    const [x, y, z] = entry.spec.pos;
    say(`${entry.id} — x ${r3(x)} z ${r3(z)}${y === null || y === undefined ? '' : ` y ${r3(y)}`}`);
  }
}

function outline() {
  if (!dom.box) {
    dom.box = new THREE.Box3Helper(new THREE.Box3(), 0x66ff99);
    dom.box.renderOrder = 999;
    dom.box.material.depthTest = false;
    stage.scene.add(dom.box);
  }
  dom.box.visible = !!state.sel;
  if (state.sel) dom.box.box.setFromObject(state.sel.mesh);
}

/* ------------------------------------------------------------------ edits */
function groundPlaneAt(entry) {
  // drag happens on the floor the object stands on, not on the camera plane
  const y = entry.mesh.getWorldPosition(new THREE.Vector3()).y;
  return new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
}

function dragTo(ev) {
  const e = state.sel, d = state.drag;
  if (!e || !d) return;
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(
    (ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1), stage.camera);
  const at = new THREE.Vector3();
  if (!rc.ray.intersectPlane(d.plane, at)) return;
  const local = e.group.worldToLocal(at.clone());
  e.mesh.position.x = local.x + d.off.x;
  e.mesh.position.z = local.z + d.off.z;
  for (const x of e.extra) { x.position.x = e.mesh.position.x; x.position.z = e.mesh.position.z; }
  writeBack(e);
  outline();
}

function scaleBy(k) {
  const e = state.sel;
  if (!e) return;
  const h = clamp((e.spec.h || 1) * k, 0.15, 60);
  e.spec.h = r3(h);
  const s = h / (e.mesh.userData.h0 || h);
  e.mesh.scale.setScalar(s);
  for (const x of e.extra) x.scale.setScalar(s);
  reseat(e);
  writeBack(e);
  outline();
}

function reseat(e) {
  // keep the painted bottom on the floor after a resize
  if (e.spec.pos && e.spec.pos[1] !== null && e.spec.pos[1] !== undefined) return;
  const h0 = e.mesh.userData.h0 || e.spec.h;
  const gap = e.mesh.userData.gap || 0;
  const h = e.spec.h;
  e.mesh.position.y = (h / 2 - gap * h) / (h / h0);   // scale is applied on top
  for (const x of e.extra) x.position.y = e.mesh.position.y;
}

function rotateBy(rad) {
  const e = state.sel;
  if (!e) return;
  e.mesh.rotation.y += rad;
  for (const x of e.extra) x.rotation.y = e.mesh.rotation.y;
  writeBack(e);
}

function hideSel() {
  const e = state.sel;
  if (!e) return;
  e.mesh.visible = false;
  for (const x of e.extra) x.visible = false;
  e.spec.visible = false;
  state.hidden.push(e);
  select(null);
  say(`скрыт ${e.id} — Backspace вернёт`);
}

function unhide() {
  const e = state.hidden.pop();
  if (!e) return;
  e.mesh.visible = true;
  for (const x of e.extra) x.visible = true;
  e.spec.visible = true;
  select(e);
  say(`возвращён ${e.id}`);
}

/* The registry entry's `spec` is the layout entry itself, so this is all that
   "saving" means — the mesh's transform copied into the object the file will be
   stringified from. */
function writeBack(e) {
  const m = e.mesh;
  if (e.kind === 'board') {
    e.spec.pos = [r3(m.position.x), null, r3(m.position.z)];
    e.spec.rotY = r3(m.rotation.y);
  } else {
    const hasY = e.spec.pos[1] !== null && e.spec.pos[1] !== undefined;
    e.spec.pos = [r3(m.position.x), hasY ? r3(m.position.y) : null, r3(m.position.z)];
    e.spec.rotY = r3(m.rotation.y);
  }
}

/* ----------------------------------------------------------------- export */
function serialise() {
  for (const e of stage.editable) writeBack(e);
  return JSON.stringify(stage.layout, null, 1) + '\n';
}

async function doExport() {
  const body = serialise();
  try {
    const r = await fetch('/__layout', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    if (r.ok) {
      const t = await r.text();
      say(`сохранено в ${t.trim()} — пересоберите, чтобы увидеть на сайте`);
      return;
    }
  } catch { /* not running under editor_serve.py: fall back to a download */ }
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'layout.json';
  a.click();
  URL.revokeObjectURL(url);
  say('скачан layout.json — положите его в assets/ и пересоберите');
}

function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch (err) {
      say(`не разобрал файл: ${err.message}`);
      return;
    }
    let n = 0;
    for (const b of Object.values(data.biomes || {})) {
      for (const o of [...(b.sprites || []), ...(b.boards || [])]) {
        const e = stage.editable.find((x) => x.id === o.id);
        if (!e) continue;
        e.mesh.position.x = o.pos[0];
        e.mesh.position.z = o.pos[2];
        if (o.pos[1] !== null && o.pos[1] !== undefined) e.mesh.position.y = o.pos[1];
        e.mesh.rotation.y = o.rotY || 0;
        e.mesh.visible = o.visible !== false;
        const s = (o.h || e.spec.h) / (e.mesh.userData.h0 || e.spec.h);
        e.mesh.scale.setScalar(s);
        Object.assign(e.spec, o);
        for (const x of e.extra) {
          x.position.copy(e.mesh.position);
          x.rotation.y = e.mesh.rotation.y;
          x.scale.setScalar(s);
          x.visible = e.mesh.visible;
        }
        if (o.pos[1] === null || o.pos[1] === undefined) reseat(e);
        n++;
      }
    }
    outline();
    refreshList();
    say(`импортировано объектов: ${n}`);
  };
  inp.click();
}

/* -------------------------------------------------------------------- ui  */
function buildDom() {
  dom = {};
  const p = document.createElement('div');
  p.id = 'ed';
  p.innerHTML = `
    <div class="ed__bar">
      <strong>сцена</strong>
      <button id="ed-exp">Export</button>
      <button id="ed-imp">Import</button>
    </div>
    <input id="ed-q" placeholder="поиск по id…" autocomplete="off">
    <div id="ed-list"></div>
    <div class="ed__help">ЛКМ выделить и тянуть · ПКМ осмотреться · колесо размер
      · WASD лететь, Shift быстрее · R поворот · Del скрыть · Backspace вернуть</div>`;
  document.body.appendChild(p);

  const s = document.createElement('div');
  s.id = 'ed-say';
  document.body.appendChild(s);
  dom.say = s;
  dom.list = p.querySelector('#ed-list');
  dom.q = p.querySelector('#ed-q');
  dom.q.addEventListener('input', refreshList);
  p.querySelector('#ed-exp').onclick = doExport;
  p.querySelector('#ed-imp').onclick = doImport;

  const css = document.createElement('style');
  css.textContent = `
    body.is-editing #rail, body.is-editing .foot, body.is-editing #boot { display: none !important; }
    #ed { position: fixed; top: 0; right: 0; width: 290px; max-height: 100vh; z-index: 50;
      display: flex; flex-direction: column; gap: 6px; padding: 10px;
      background: rgba(18,22,24,.92); color: #fdf6e0; font: 12px/1.4 ui-monospace, monospace; }
    #ed .ed__bar { display: flex; gap: 6px; align-items: center; }
    #ed .ed__bar strong { flex: 1; letter-spacing: .08em; }
    #ed button, #ed input { font: inherit; color: #fdf6e0; background: #2b3a33;
      border: 1px solid rgba(253,246,224,.35); padding: 4px 8px; }
    #ed-list { overflow: auto; flex: 1; min-height: 120px; }
    #ed-list div { padding: 2px 4px; cursor: pointer; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    #ed-list div:hover { background: rgba(253,246,224,.12); }
    #ed-list div.on { background: #3f6b4f; }
    #ed-list div.off { opacity: .45; text-decoration: line-through; }
    #ed .ed__help { opacity: .65; font-size: 11px; }
    #ed-say { position: fixed; left: 12px; bottom: 12px; z-index: 50; padding: 6px 10px;
      background: rgba(18,22,24,.88); color: #fdf6e0; font: 12px ui-monospace, monospace; }`;
  document.head.appendChild(css);
}

function refreshList() {
  const q = (dom.q.value || '').toLowerCase();
  dom.list.innerHTML = '';
  for (const e of stage.editable) {
    if (q && !e.id.toLowerCase().includes(q)) continue;
    const d = document.createElement('div');
    d.textContent = e.id;
    if (e === state.sel) d.className = 'on';
    if (!e.mesh.visible) d.className = (d.className + ' off').trim();
    d.onclick = () => { focusOn(e); };
    dom.list.appendChild(d);
  }
}

function focusOn(e) {
  select(e);
  const at = e.mesh.getWorldPosition(new THREE.Vector3());
  stage.camera.position.set(at.x, at.y + 3, at.z + 12);
  state.yaw = 0;
  state.pitch = -0.1;
  aim();
}

function say(t) {
  dom.say.textContent = t;
}

/* ----------------------------------------------------------------- input */
function bindInput() {
  const cv = stage.renderer.domElement;
  cv.style.pointerEvents = 'auto';
  cv.oncontextmenu = (e) => e.preventDefault();

  cv.addEventListener('pointerdown', (ev) => {
    if (ev.button === 2) { state.look = true; cv.setPointerCapture(ev.pointerId); return; }
    if (ev.button !== 0) return;
    const hit = pick(ev);
    select(hit);
    if (hit) {
      const plane = groundPlaneAt(hit);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(
        (ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1), stage.camera);
      const at = new THREE.Vector3();
      if (rc.ray.intersectPlane(plane, at)) {
        const local = hit.group.worldToLocal(at.clone());
        state.drag = { plane, off: { x: hit.mesh.position.x - local.x, z: hit.mesh.position.z - local.z } };
        cv.setPointerCapture(ev.pointerId);
      }
    }
  });

  cv.addEventListener('pointermove', (ev) => {
    if (state.look) {
      state.yaw += ev.movementX * 0.0032;
      state.pitch = clamp(state.pitch - ev.movementY * 0.0032, -1.4, 1.4);
      aim();
    } else if (state.drag) {
      dragTo(ev);
    }
  });

  const stop = () => { state.look = false; state.drag = null; };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);

  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (state.sel && pick(ev)) scaleBy(ev.deltaY < 0 ? 1.06 : 1 / 1.06);
    else stage.camera.position.addScaledVector(aim(), ev.deltaY < 0 ? 2 : -2);
  }, { passive: false });

  addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT') return;
    const k = ev.key.toLowerCase();
    if (k in { w: 1, a: 1, s: 1, d: 1, q: 1, e: 1 }) KEY[k] = true;
    KEY.shift = ev.shiftKey;
    if (k === 'r') { rotateBy(ev.shiftKey ? -0.08 : 0.08); ev.preventDefault(); }
    if (ev.key === 'Delete') hideSel();
    if (ev.key === 'Backspace') { unhide(); ev.preventDefault(); }
    if (ev.key === 'Escape') select(null);
  });
  addEventListener('keyup', (ev) => {
    KEY[ev.key.toLowerCase()] = false;
    KEY.shift = ev.shiftKey;
  });
}

function loop() {
  let last = performance.now();
  let known = 0;
  const step = () => {
    const now = performance.now();
    fly(Math.min((now - last) / 1000, 0.05));
    last = now;
    // biomes past the first stream in after the editor has started, so the
    // list has to notice them appearing rather than being built once
    if (stage.editable.length !== known) {
      known = stage.editable.length;
      refreshList();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
