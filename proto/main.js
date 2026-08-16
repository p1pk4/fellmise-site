/* Проба: та же деревня сверху, ортографической камерой.
 *
 * Вопрос, на который эта страница отвечает картинкой: читается ли планировка
 * Fellmise в top-down. Всё остальное здесь сознательно грубое — спрайты
 * фронтальные и лежат плашмя, потому что других нет, и оценке они не подлежат.
 *
 * Ничего из journey3/ не импортируется: проба должна удаляться одним `rm -rf
 * proto/`, а импорт сделал бы её частью боевой сцены. Общее у них одно —
 * assets/layout.json, и он читается как есть, без единой правки. Тайлы грунта
 * лежат копиями рядом по той же причине.
 */

import * as THREE from './vendor/three.module.min.js';

const HUD = document.getElementById('hud');
const ASSETS = '../assets/';

/* Ортокамера смотрит строго вниз, ось Y — вертикаль мира. X и Z объекта из
   layout.json ложатся на карту напрямую: в top-down план сцены и есть план
   карты, пересчитывать нечего. */
const ZOOM = { обзор: 48, близко: 18 };    // половина высоты кадра в метрах
const BIOME_SPACING = 150;                  // как в боевой сцене

const state = { zoom: 'обзор', z: -20, len: 400, objects: 0, biomes: 0,
                ready: false };

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2c3a24);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
camera.up.set(0, 0, -1);                    // «вверх экрана» — вглубь карты

// ------------------------------------------------------------------ грунт --
/* Дорога — маска внутри пола: решение из боевой сцены сохраняется. Но UV здесь
   мировые и без перспективы — в ортографии тайл одинаков по всему кадру, и
   растяжения к горизонту, которое приходилось лечить в пролёте, просто нет.
   Тумана и постпроцессинга тоже нет: картинка должна быть чистой. */
const GROUND_VS = `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GROUND_FS = `
  uniform sampler2D uGrass;
  uniform sampler2D uRoad;
  uniform float uHalf;
  uniform float uTile;
  uniform float uRoadTile;
  varying vec2 vWorld;

  float h21(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
               mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    return vnoise(p) * 0.6 + vnoise(p * 2.1) * 0.3 + vnoise(p * 4.3) * 0.1;
  }

  void main() {
    vec3 grass = texture2D(uGrass, vWorld / uTile).rgb;
    vec3 road  = texture2D(uRoad,  vWorld / uRoadTile).rgb;

    // край дороги сбит шумом двух частот: медленная задаёт форму тропы,
    // быстрая — языки травы, вгрызающиеся в грунт
    float edge = uHalf
               + (fbm(vec2(vWorld.y * 0.035, 0.0)) - 0.5) * 2.2
               + (fbm(vec2(vWorld.y * 0.31, vWorld.x * 0.12)) - 0.5) * 1.1;
    float m = 1.0 - smoothstep(edge - 0.6, edge + 0.6, abs(vWorld.x));

    gl_FragColor = vec4(mix(grass, road, m), 1.0);
  }
`;

const loader = new THREE.TextureLoader();

function tex(url, repeat) {
  return new Promise((res, rej) => {
    loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      res(t);
    }, undefined, () => rej(new Error('нет текстуры ' + url)));
  });
}

// ---------------------------------------------------------------- спрайты --
/* Габарит на карте берётся из пропорций картинки: спрайт кладётся плашмя, его
   ширина — h * aspect, его «глубина» — h. Для вида сверху это заведомо
   неправильно и так и задумано — оценивается план, а не спрайты. */
const cache = new Map();

function sprite(t) {
  if (!cache.has(t)) {
    cache.set(t, tex(ASSETS + t + '.webp').then((map) => ({
      map, aspect: map.image.width / map.image.height,
    })).catch(() => null));
  }
  return cache.get(t);
}

function flatQuad({ map, aspect }, o, z, order) {
  const q = new THREE.Mesh(
    new THREE.PlaneGeometry(o.h * aspect, o.h),
    new THREE.MeshBasicMaterial({
      map, transparent: true, alphaTest: 0.04,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }));
  q.rotation.x = -Math.PI / 2;
  q.rotation.z = o.rotY || 0;
  q.position.set(o.pos[0], 1, z);
  /* Высота НЕ двигает объект — она решает, кто поверх кого. Порядок целиком на
     renderOrder, поэтому depthTest выключен: иначе за очерёдность спорил бы
     ещё и буфер глубины, а плоскости все на одном уровне. */
  q.renderOrder = order;
  return q;
}

/* Сегменты одного отрезка: та же X и разрыв по Z не больше шага. Забор в пробе
   рисуется одним прямоугольником — смотрим, как читается линейный объект, а не
   как выглядят его сегменты. */
function groupRuns(segs) {
  const byX = new Map();
  for (const o of segs) {
    const k = Math.round(o.pos[0] * 2) / 2;
    if (!byX.has(k)) byX.set(k, []);
    byX.get(k).push(o);
  }
  const runs = [];
  for (const [x, list] of byX) {
    list.sort((a, b) => a.pos[2] - b.pos[2]);
    let cur = null;
    for (const o of list) {
      if (cur && o.pos[2] - cur.z1 <= 5) {
        cur.z1 = o.pos[2];
      } else {
        cur = { x, z0: o.pos[2], z1: o.pos[2] };
        runs.push(cur);
      }
    }
  }
  return runs;
}

// ------------------------------------------------------------------ сборка --
async function main() {
  const layout = await (await fetch(ASSETS + 'layout.json')).json();
  const dbg = layout.debug;
  const ids = Object.keys(layout.biomes);
  state.biomes = ids.length;
  state.len = (ids.length - 1) * BIOME_SPACING + dbg.length[ids[ids.length - 1]];

  const [grass, road] = await Promise.all([
    tex('./tile_grass.webp', true), tex('./tile_path.webp', true),
  ]);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, state.len + 200),
    new THREE.ShaderMaterial({
      vertexShader: GROUND_VS, fragmentShader: GROUND_FS,
      uniforms: {
        uGrass: { value: grass }, uRoad: { value: road },
        uHalf: { value: dbg.road_half_width },
        uTile: { value: 9.0 }, uRoadTile: { value: 6.5 },
      },
    }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -state.len / 2 + 40);
  ground.renderOrder = -100;
  scene.add(ground);

  for (const [i, bid] of ids.entries()) {
    const z0 = -i * BIOME_SPACING;
    const b = layout.biomes[bid];
    const all = [...b.sprites, ...(b.boards || [])];
    const isFence = (o) => o.t === 'hero_fence' || o.t === 'end_post';

    for (const run of groupRuns(all.filter(isFence))) {
      const q = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, Math.max(run.z1 - run.z0, 0.7)),
        new THREE.MeshBasicMaterial({ color: 0x7a4f2a, depthTest: false }));
      q.rotation.x = -Math.PI / 2;
      q.position.set(run.x, 1, z0 + (run.z0 + run.z1) / 2);
      q.renderOrder = 200;
      scene.add(q);
      state.objects++;
    }

    for (const o of all) {
      if (isFence(o) || o.visible === false) continue;
      if (!o.t) {
        // вывеска: лица у неё нет, в боевой сцене оно рисуется в canvas
        const q = new THREE.Mesh(
          new THREE.PlaneGeometry(o.h * 0.94, 0.6),
          new THREE.MeshBasicMaterial({ color: 0xfdf6e0, depthTest: false }));
        q.rotation.x = -Math.PI / 2;
        q.rotation.z = o.rotY || 0;
        q.position.set(o.pos[0], 1, z0 + o.pos[2]);
        q.renderOrder = 300;
        scene.add(q);
        state.objects++;
        continue;
      }
      const art = await sprite(o.t);
      if (!art) continue;
      scene.add(flatQuad(art, o, z0 + o.pos[2], Math.round(o.h * 10)));
      state.objects++;
    }
  }

  state.ready = true;          // чтобы съёмка не начиналась на полпути
  resize();
  draw();
}

// ---------------------------------------------------------------- камера ---
function resize() {
  const w = innerWidth, h = innerHeight;
  const half = ZOOM[state.zoom];
  camera.left = -half * (w / h);
  camera.right = half * (w / h);
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function draw() {
  camera.position.set(0, 120, state.z);
  camera.lookAt(0, 0, state.z);
  camera.up.set(0, 0, -1);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  HUD.innerHTML = 'top-down проба · ортокамера, взгляд вниз\n'
    + `зум: <b>${state.zoom}</b> (${ZOOM[state.zoom]} м в полкадра) — клавиша Z\n`
    + `камера z = <b>${state.z.toFixed(0)}</b> — колесо мыши\n`
    + `${state.objects} объектов из assets/layout.json, ${state.biomes} биомов`;
}

addEventListener('wheel', (e) => {
  state.z = Math.min(20, Math.max(-state.len - 20, state.z - e.deltaY * 0.06));
  draw();
}, { passive: true });

addEventListener('keydown', (e) => {
  // без анимаций и плавностей: два фиксированных уровня, переключение мгновенно
  if ('zZяЯ'.includes(e.key)) {
    state.zoom = state.zoom === 'обзор' ? 'близко' : 'обзор';
    resize();
    draw();
  }
});

addEventListener('resize', () => { resize(); draw(); });

/* Ручка для скриншотов: та же камера, тот же путь, без анимаций. */
window.__PROTO = {
  go(z, zoom) {
    if (zoom) state.zoom = zoom;
    state.z = z;
    resize();
    draw();
  },
  state,
};

main().catch((e) => { HUD.textContent = 'ошибка: ' + e.message; throw e; });
