/* Проба: та же деревня сверху, ортографической камерой.
 *
 * Вопрос, на который эта страница отвечает картинкой: читается ли планировка
 * Fellmise в top-down. Спрайты по-прежнему фронтальные и лежат плашмя — других
 * нет, и оценке они не подлежат. Оценивается земля, дорога и то, как объекты
 * друг друга перекрывают.
 *
 * Ничего из journey3/ не импортируется: проба должна удаляться одним `rm -rf
 * proto/`, а импорт сделал бы её частью боевой сцены. Общее у них одно —
 * assets/layout.json, и он читается как есть, без единой правки.
 */

import * as THREE from './vendor/three.module.min.js';

const HUD = document.getElementById('hud');
const ASSETS = '../assets/';
const STRIPPED = './sprites_stripped/';

const ZOOM = { обзор: 48, близко: 18 };    // половина высоты кадра в метрах
const BIOME_SPACING = 150;                  // как в боевой сцене
const SEED = 'fellmise-proto-1';

/* Единое направление света на всю сцену. Тень уезжает на 0.2 м — этого хватает,
   чтобы объект отделился от земли, и мало, чтобы не читаться вторым предметом. */
const LIGHT = { dx: 0.141, dz: 0.141 };    // |смещение| = 0.2 м

/* Диапазоны порядка отрисовки. Объекты сортируются по Z нижнего края (y-sort),
   всё остальное стоит фиксированными этажами заведомо ниже их. */
const ORDER = { ground: -1000, decalFar: -900, decalNear: -880, shadow: -500 };
const OBJECT_BASE = 1000;                   // + (z нижнего края + 800) * 10

const state = { zoom: 'обзор', z: -20, len: 400, objects: 0, decals: 0,
                biomes: 0, ready: false, done: false, sortTest: '—' };

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2c3a24);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
camera.up.set(0, 0, -1);                    // «вверх экрана» — вглубь карты

// ------------------------------------------------------------ детерминизм --
/* Тот же способ, что у расстановки в generate_layout.py: не поток случайных
   чисел, а хеш от (сид, имя). Одна и та же страница при каждой загрузке даёт
   ровно ту же землю, и вставка нового декаля не сдвигает все следующие. */
function h01(...parts) {
  const s = SEED + '|' + parts.join('|');
  let a = 0x9e3779b9, b = 0x85ebca6b;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0xcc9e2d51) >>> 0;
    b = Math.imul(b ^ (a >>> 13), 0x1b873593) >>> 0;
  }
  a = Math.imul(a ^ (b >>> 16), 0x2545f491) >>> 0;
  return a / 4294967296;
}

// ------------------------------------------------------------------ грунт --
/* Четыре слоя против решётки повтора.
 *
 *   А  базовый тайл травы в мировых UV;
 *   Б  низкочастотная перекраска: шум с периодом полсотни метров — заведомо
 *      больше кадра — водит оттенок и яркость в пределах ±12%. Крупные плавные
 *      пятна ломают восприятие повтора сильнее, чем любое смешение тайлов:
 *      глаз ищет одинаковые клетки, а они больше не одинаковые по свету;
 *   В  второй тайл, повёрнутый на 37° и в 1.61 раза крупнее. Угол не кратен
 *      90°, масштаб иррационален — период совпадения двух решёток в кадр не
 *      помещается;
 *   Г  декали отдельными спрайтами поверх, они снаружи этого шейдера.
 *
 * Дорога — маска внутри пола, решение боевой сцены сохраняется. Ось её больше
 * не прямая: она приходит массивом из assets/road_spline.json и интерполируется
 * по Z. Между травой и землёй лежит промежуточный слой вытоптанной травы —
 * два перехода по шуму вместо одного градиента.
 */
const GROUND_VS = `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GROUND_FS = `
  #define NPTS ${64}
  uniform sampler2D uGrass;
  uniform sampler2D uGrass2;
  uniform sampler2D uRoad;
  uniform vec3 uRoadMean;
  uniform float uHalf;
  uniform float uTile;
  uniform float uRoadTile;
  uniform float uCentre[NPTS];
  uniform float uWidth[NPTS];
  uniform float uZ0;
  uniform float uZStep;
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
  mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

  vec3 hueShift(vec3 c, float k) {
    // сдвиг к тёплому/холодному без перевода в HSV: дешевле и здесь достаточно
    return clamp(c * vec3(1.0 + k, 1.0, 1.0 - k), 0.0, 1.0);
  }

  // ось и ширина дороги на данной Z, линейно между контрольными точками
  void road_at(float z, out float cx, out float hw) {
    float t = clamp((uZ0 - z) / uZStep, 0.0, float(NPTS - 1) - 0.001);
    int i = int(floor(t));
    float f = t - float(i);
    cx = mix(uCentre[i], uCentre[i + 1], f);
    hw = uHalf * mix(uWidth[i], uWidth[i + 1], f);
  }

  void main() {
    // --- А: базовый тайл ---------------------------------------------------
    vec3 a = texture2D(uGrass, vWorld / uTile).rgb;

    // --- В: тот же тайл под 37° и в 1.61 раза крупнее ------------------------
    // Смешение держится около половины и никогда не уходит в чистый слой: как
    // только один из тайлов побеждает целиком, его решётка возвращается. При
    // близких весах амплитуда каждой падает вдвое, а совпасть решётки не могут —
    // угол не кратен 90°, масштаб иррационален, период в кадр не влезает.
    vec2 uv2 = (rot(0.6458) * vWorld) / (uTile * 1.61);
    vec3 c = texture2D(uGrass2, uv2).rgb;
    float mixAC = 0.34 + 0.32 * fbm(vWorld * 0.045);
    vec3 grass = mix(a, c, mixAC);

    // и третья выборка, ещё крупнее и под другим углом — она добивает остаток
    vec3 e = texture2D(uGrass, (rot(-1.13) * vWorld) / (uTile * 2.7)).rgb;
    grass = mix(grass, e, 0.26);

    // --- Б: низкочастотная перекраска, период ~50 м -------------------------
    float low = fbm(vWorld * 0.021);                  // 1/0.021 ≈ 48 м
    grass *= 1.0 + (low - 0.5) * 0.24;                // яркость ±12%
    // и средняя частота: без неё крупные пятна плавают поверх нетронутой сетки
    grass *= 1.0 + (fbm(vWorld * 0.085 + 7.1) - 0.5) * 0.16;
    grass = hueShift(grass, (fbm(vWorld * 0.017 + 31.7) - 0.5) * 0.14);

    // --- дорога ------------------------------------------------------------
    float cx, hw;
    road_at(vWorld.y, cx, hw);
    float d = abs(vWorld.x - cx);

    // Пятна исходного тайла сверху читаются артефактом текстуры, а не грязью:
    // они повторяются вертикально с шагом тайла. Тайл сведён к своему среднему
    // цвету и оставлен только как мелкое зерно.
    vec3 road = mix(uRoadMean, texture2D(uRoad, vWorld / uRoadTile).rgb, 0.22);
    road *= 0.94 + fbm(vWorld * 0.9) * 0.12;

    // Колея: две продольные полосы в 0.9 м друг от друга, прерывистые по шуму.
    // Именно колея, а не пятна, читается сверху как «по дороге ездят».
    float rut = min(abs(d - 0.45), abs(d - 0.45));
    float rutMask = (1.0 - smoothstep(0.0, 0.16, abs(d - 0.45)))
                  * smoothstep(0.35, 0.62, fbm(vec2(vWorld.y * 0.14, 0.0)));
    road *= 1.0 - rutMask * 0.22;

    // --- край: трава -> вытоптанная полоса -> земля -------------------------
    // Один градиент читается мылом. Промежуточный слой даёт ДВА края, и каждый
    // сбит шумом двух частот: медленная задаёт форму тропы, быстрая — языки
    // травы, вгрызающиеся в грунт.
    float jag = (fbm(vec2(vWorld.y * 0.035, 0.0)) - 0.5) * 2.2
              + (fbm(vec2(vWorld.y * 0.31, vWorld.x * 0.12)) - 0.5) * 1.1;
    float eIn = hw + jag;
    float eOut = eIn + 0.8;                            // полоса 0.8 м
    vec3 trampled = mix(grass, road, 0.55) * 0.96;

    vec3 col = grass;
    col = mix(col, trampled, 1.0 - smoothstep(eOut - 0.45, eOut + 0.45, d));
    col = mix(col, road, 1.0 - smoothstep(eIn - 0.35, eIn + 0.35, d));

    gl_FragColor = vec4(col, 1.0);
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

/* Средний цвет картинки — через отрисовку в канвас 1×1. Нужен, чтобы свести
   пятнистый тайл дороги к его собственному тону, а не к придуманному. */
function meanColour(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, 1, 1);
  const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear();
}

/* Ширина силуэта у самого основания — для тени. Не габарит плоскости: у дерева
   крона втрое шире ствола, и тень по габариту легла бы блином. */
function baseWidth(img) {
  const W = Math.min(img.width, 256);
  const H = Math.round(img.height * (W / img.width));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, W, H);
  const d = cx.getImageData(0, 0, W, H).data;
  let lo = W, hi = 0;
  for (let y = Math.floor(H * 0.9); y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 16) { if (x < lo) lo = x; if (x > hi) hi = x; }
    }
  }
  return hi > lo ? (hi - lo + 1) / W : 0.5;      // доля ширины картинки
}

// ---------------------------------------------------------------- спрайты --
const cache = new Map();
let strippedSet = new Set();

function sprite(t) {
  if (!cache.has(t)) {
    const url = (strippedSet.has(t) ? STRIPPED : ASSETS) + t + '.webp';
    cache.set(t, tex(url).then((map) => ({
      map,
      aspect: map.image.width / map.image.height,
      base: baseWidth(map.image),
    })).catch(() => null));
  }
  return cache.get(t);
}

/* Порядок отрисовки — по Z НИЖНЕГО КРАЯ спрайта, а не по его высоте.
   Классический y-sort: кто ниже по экрану, тот поверх. По высоте было неверно —
   низкий объект, стоящий ПЕРЕД домом, уходил под фасад просто потому, что дом
   выше. Экран смотрит вдоль -Y с up = -Z, значит больший Z ниже по экрану. */
function orderOf(zBottom) {
  return OBJECT_BASE + Math.round((zBottom + 800) * 10);
}

function flatQuad(art, o, z) {
  const w = o.h * art.aspect;
  const q = new THREE.Mesh(
    new THREE.PlaneGeometry(w, o.h),
    new THREE.MeshBasicMaterial({
      map: art.map, transparent: true, alphaTest: 0.04,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }));
  q.rotation.x = -Math.PI / 2;
  q.rotation.z = o.rotY || 0;
  q.position.set(o.pos[0], 1, z);
  q.renderOrder = orderOf(z + o.h / 2);
  return q;
}

/* Тень вместо вырезанного цоколя. Эллипс по ширине силуэта у основания, мягкий
   край, единое смещение по свету. */
let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

function shadowFor(art, o, z) {
  const w = o.h * art.aspect * art.base * 1.05;
  const q = new THREE.Mesh(
    new THREE.PlaneGeometry(w, w * 0.62),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, opacity: 0.35,
      depthTest: false, depthWrite: false, color: 0x1a1a14,
    }));
  q.rotation.x = -Math.PI / 2;
  q.position.set(o.pos[0] + LIGHT.dx, 0.5, z + o.h / 2 + LIGHT.dz);
  q.renderOrder = ORDER.shadow;
  return q;
}

/* Сегменты одного отрезка: та же X и разрыв по Z не больше шага. Забор в пробе
   рисуется одним прямоугольником — смотрим, как читается линейный объект. */
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
      if (cur && o.pos[2] - cur.z1 <= 5) cur.z1 = o.pos[2];
      else { cur = { x, z0: o.pos[2], z1: o.pos[2] }; runs.push(cur); }
    }
  }
  return runs;
}

// ------------------------------------------------------------------ декали --
/* Главный ломатель регулярности. Проплешина земли рисуется здесь же, потому что
   в паке её нет, а именно она работает лучше всех: пятно другого материала,
   которое не повторяется. Остальное — мелочь из пака. */
function patchTexture(kind) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
  const tone = kind === 'dark' ? '92,74,48' : '124,102,66';
  g.addColorStop(0, `rgba(${tone},0.85)`);
  g.addColorStop(0.6, `rgba(${tone},0.5)`);
  g.addColorStop(1, `rgba(${tone},0)`);
  cx.fillStyle = g;
  cx.beginPath();
  // рваный контур, иначе проплешина читается ровным кругом
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = S / 2 * (0.62 + 0.3 * h01('patch', kind, i));
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.8;
    i ? cx.lineTo(x, y) : cx.moveTo(x, y);
  }
  cx.closePath();
  cx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DECALS = [
  { key: 'patch', tex: () => patchTexture('light'), size: [2.4, 5.0], share: 0.16,
    order: ORDER.decalFar, onRoad: true },
  { key: 'patch2', tex: () => patchTexture('dark'), size: [1.6, 3.2], share: 0.10,
    order: ORDER.decalFar, onRoad: true },
  { key: 'grass_tuft_a', size: [0.9, 1.7], share: 0.30, order: ORDER.decalNear },
  { key: 'grass_tuft_b', size: [0.9, 1.7], share: 0.24, order: ORDER.decalNear },
  { key: 'rock_s', size: [0.6, 1.2], share: 0.12, order: ORDER.decalNear },
  { key: 'mushrooms', size: [0.5, 0.9], share: 0.04, order: ORDER.decalNear },
  { key: 'fern', size: [0.8, 1.5], share: 0.04, order: ORDER.decalNear },
];

const DECAL_DENSITY = 0.15;      // штук на квадратный метр
const FIELD_X = 55;              // полуширина засеваемой полосы

async function buildDecals(len, roadAt) {
  const area = FIELD_X * 2 * (len + 40);
  const total = Math.round(area * DECAL_DENSITY);
  const dummy = new THREE.Object3D();

  for (const [di, spec] of DECALS.entries()) {
    const n = Math.round(total * spec.share);
    let art = null;
    if (spec.tex) art = { map: spec.tex(), aspect: 1 };
    else art = await sprite(spec.key);
    if (!art) continue;

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: art.map, transparent: true, alphaTest: spec.tex ? 0.0 : 0.04,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.renderOrder = spec.order;
    mesh.frustumCulled = false;

    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = (h01('dx', di, i) * 2 - 1) * FIELD_X;
      const z = 20 - h01('dz', di, i) * (len + 40);
      const { cx, hw } = roadAt(z);
      // трава и камни на дороге не растут; проплешины — растут, это грязь
      if (!spec.onRoad && Math.abs(x - cx) < hw * 1.25) continue;
      const s = spec.size[0] + h01('ds', di, i) * (spec.size[1] - spec.size[0]);
      dummy.position.set(x, 0.4, z);
      dummy.rotation.set(-Math.PI / 2, 0, h01('dr', di, i) * Math.PI * 2);
      dummy.scale.set(s * art.aspect, s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(k++, dummy.matrix);
    }
    mesh.count = k;
    state.decals += k;
    scene.add(mesh);
  }
}

// ------------------------------------------------------------------ сборка --
let roadAt = () => ({ cx: 0, hw: 3.2 });

async function main() {
  const [layout, spline, index] = await Promise.all([
    fetch(ASSETS + 'layout.json').then((r) => r.json()),
    fetch(ASSETS + 'road_spline.json').then((r) => r.json()),
    fetch(STRIPPED + 'index.json').then((r) => r.json()).catch(() => ({ stripped: [] })),
  ]);
  strippedSet = new Set(index.stripped);
  const dbg = layout.debug;
  const ids = Object.keys(layout.biomes);
  state.biomes = ids.length;
  state.len = (ids.length - 1) * BIOME_SPACING + dbg.length[ids[ids.length - 1]];

  // сплайн -> 64 равномерные выборки: шейдер интерполирует между ними линейно,
  // а Catmull-Rom считается здесь, один раз
  const NPTS = 64;
  const curve = new THREE.CatmullRomCurve3(
    spline.points.map((p) => new THREE.Vector3(p.x, p.w, p.z)), false, 'catmullrom', 0.5);
  const zSpan = Math.abs(spline.points[spline.points.length - 1].z);
  const zStep = zSpan / (NPTS - 1);
  const centre = [], width = [];
  for (let i = 0; i < NPTS; i++) {
    const v = curve.getPoint(i / (NPTS - 1));
    centre.push(v.x);
    width.push(v.y);
  }
  roadAt = (z) => {
    const t = Math.min(Math.max((0 - z) / zStep, 0), NPTS - 1.001);
    const i = Math.floor(t), f = t - i;
    return { cx: centre[i] + (centre[i + 1] - centre[i]) * f,
             hw: dbg.road_half_width * (width[i] + (width[i + 1] - width[i]) * f) };
  };

  const [grass, grass2, road] = await Promise.all([
    tex('./tile_grass.webp', true), tex('./tile_grass.webp', true),
    tex('./tile_path.webp', true),
  ]);
  /* Земля сейчас спорит с крышами — она фон, а не главный предмет кадра.
     Насыщенность снята на 28% и тон уведён в серо-коричневый. */
  const mean = meanColour(road.image);
  const lum = mean.r * 0.299 + mean.g * 0.587 + mean.b * 0.114;
  mean.lerp(new THREE.Color(lum, lum, lum), 0.28);
  mean.lerp(new THREE.Color(0.30, 0.28, 0.25), 0.18);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(320, state.len + 220),
    new THREE.ShaderMaterial({
      vertexShader: GROUND_VS, fragmentShader: GROUND_FS,
      uniforms: {
        uGrass: { value: grass }, uGrass2: { value: grass2 },
        uRoad: { value: road }, uRoadMean: { value: new THREE.Vector3(mean.r, mean.g, mean.b) },
        uHalf: { value: dbg.road_half_width },
        uTile: { value: 9.0 }, uRoadTile: { value: 6.5 },
        uCentre: { value: centre }, uWidth: { value: width },
        uZ0: { value: 0 }, uZStep: { value: zStep },
      },
    }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -state.len / 2 + 40);
  ground.renderOrder = ORDER.ground;
  scene.add(ground);

  await buildDecals(state.len, roadAt);

  /* Первый кадр — это земля и первый биом: ровно то, что видно при открытии.
     Остальные четыре догружаются фоном, пока страница уже нарисована. Иначе
     «вес первого кадра» мерил бы всю дорогу целиком и ни о чём не говорил. */
  await biome(layout, ids, 0);
  state.ready = true;
  resize();
  draw();
  for (let i = 1; i < ids.length; i++) {
    await biome(layout, ids, i);
    draw();
  }
  state.done = true;
  draw();
}

async function biome(layout, ids, i) {
  {
    const bid = ids[i];
    const z0 = -i * BIOME_SPACING;
    const b = layout.biomes[bid];
    const all = [...b.sprites, ...(b.boards || [])];
    const isFence = (o) => o.t === 'hero_fence' || o.t === 'end_post';
    /* Облака в top-down ложатся на землю белыми кляксами: неба сверху не
       существует. Убраны из отрисовки, но не из данных — могут вернуться
       летящими тенями поверх всего, отдельным слоем над объектами:
         const CLOUDS = ['cloud_a', 'cloud_b', 'cloud_c', 'moon'];  */
    const isSky = (o) => o.t && (o.t.startsWith('cloud_') || o.t === 'moon');

    for (const run of groupRuns(all.filter(isFence))) {
      const zc = z0 + (run.z0 + run.z1) / 2;
      const q = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, Math.max(run.z1 - run.z0, 0.7)),
        new THREE.MeshBasicMaterial({ color: 0x7a4f2a, depthTest: false }));
      q.rotation.x = -Math.PI / 2;
      q.position.set(run.x, 1, zc);
      q.renderOrder = orderOf(z0 + run.z1);
      scene.add(q);
      state.objects++;
    }

    for (const o of all) {
      if (isFence(o) || isSky(o) || o.visible === false) continue;
      const z = z0 + o.pos[2];
      if (!o.t) {
        // вывеска: лица у неё нет, в боевой сцене оно рисуется в canvas
        const q = new THREE.Mesh(
          new THREE.PlaneGeometry(o.h * 0.94, 0.6),
          new THREE.MeshBasicMaterial({ color: 0xfdf6e0, depthTest: false }));
        q.rotation.x = -Math.PI / 2;
        q.rotation.z = o.rotY || 0;
        q.position.set(o.pos[0], 1, z);
        q.renderOrder = orderOf(z + 0.3);
        scene.add(q);
        state.objects++;
        continue;
      }
      const art = await sprite(o.t);
      if (!art) continue;
      scene.add(shadowFor(art, o, z));
      scene.add(flatQuad(art, o, z));
      state.objects++;
    }
  }
}

// ------------------------------------------------- проверка сортировки ----
/* Временный тестовый спрайт вплотную перед домом и за ним. Он НИЖЕ дома —
   именно этот случай старая сортировка по высоте роняла: низкий объект перед
   фасадом уходил под него. */
let testMeshes = [];
async function sortTest(where) {
  for (const m of testMeshes) scene.remove(m);
  testMeshes = [];
  state.sortTest = where;
  if (where === '—') { draw(); return; }

  const art = await sprite('prop_crates');
  const houseZ = -47.6, houseX = 6.83;             // hero_house_a, правый берег
  const dz = where === 'перед домом' ? 4.4 : -4.4;
  const o = { pos: [houseX, null, 0], h: 2.6, rotY: 0 };
  const z = houseZ + dz;
  const q = flatQuad(art, o, z);
  q.material = q.material.clone();
  q.material.color = new THREE.Color(0xffd27a);     // чтобы его было видно
  const s = shadowFor(art, o, z);
  scene.add(s); scene.add(q);
  testMeshes = [q, s];
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
    + `${state.objects} объектов, ${state.decals} декалей, ${state.biomes} биомов\n`
    + `тест сортировки: <b>${state.sortTest}</b>`;
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
  sortTest,
  state,
};

main().catch((e) => { HUD.textContent = 'ошибка: ' + e.message; throw e; });
