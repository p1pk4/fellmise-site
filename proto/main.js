/* Проба: та же деревня сверху, ортографической камерой.
 *
 * Вопрос, на который эта страница отвечает картинкой: читается ли планировка
 * Fellmise в top-down. Спрайты по-прежнему фронтальные и лежат плашмя — других
 * нет, и оценке они не подлежат. Оценивается земля, дорога и то, как объекты
 * друг друга перекрывают.
 *
 * Ничего из journey3/ не импортируется: проба должна удаляться одним `rm -rf
 * proto/`, а импорт сделал бы её частью боевой сцены. Расстановка у неё своя —
 * assets/topdown/layout.runtime.json (генерация top-down target + ручные
 * overrides, см. tools/topdown_layout.py). assets/layout.json остаётся за /next/.
 */

import * as THREE from './vendor/three.module.min.js';

const HUD = document.getElementById('hud');
const ASSETS = '../assets/';
const LAYOUT = ASSETS + 'topdown/layout.runtime.json';
const STRIPPED = './sprites_stripped/';

/* Масштаб игры, выведенный из фактов, а не подобранный.
 *
 *   игра   камера ортографическая, orthographicSize 5 по умолчанию (замер:
 *          client/Assets/_Fellmise/Scenes/Bootstrap.unity, объект Main Camera).
 *          Значит высота кадра — 10 юнитов, и 1 юнит = 1 тайл: GDD говорит
 *          «камера ~16 тайлов», а 2*5*16/9 = 17.8 юнита по ширине.
 *   тайл   GDD 2896: «Высота персонажа — 1.5 тайла». Взрослый человек ~1.75 м,
 *          отсюда тайл ≈ 1.17 м. Это единственное допущение в цепочке, и оно
 *          названо: ошибка в росте линейно тянет за собой весь пересчёт.
 *
 * Итог: 1 метр сайта = 0.86 тайла игры, игровой кадр = 11.7 м по высоте.
 */
const TILE_M = 1.75 / 1.5;                  // метров в одном тайле игры
const GAME_ORTHO_SIZE = 5;                  // боевое значение из Bootstrap.unity
const GAME_FRAME_M = GAME_ORTHO_SIZE * 2 * TILE_M;   // 11.67 м по высоте кадра

/* ПРИВЯЗКА К ИГРОВОМУ КАДРУ ОТМЕНЕНА (ground-3).
 *
 * Привязка была сделана и дала отрицательный результат: при кадре 11.7 м
 * дорога занимает 60% экрана, два дома в кадр не помещаются, а спрайты идут в
 * мыло — пака такого разрешения не существует (медиана пака 128 px/м против
 * 219 px/м по GDD, см. tools/measure_foreshortening.py). Метод пересчёта
 * сохранён и работает: GAME_FRAME_M ниже по-прежнему считается и показывается
 * в панели как диагностика расхождения, а не как подпись к режиму.
 *
 * Зумы заданы тем, что реально читается на экране: 16 м — дом с окружением,
 * 40 м — усадьба с соседями и куском дороги. */
const ZOOM = { обзор: 40 / 2, близко: 16 / 2 };
let BIOME_SPACING = null;                    // из runtime layout (assets/topdown/config.json)
const SEED = 'fellmise-proto-1';

/* Полуширина дороги — НЕ из scene_spec.json (там 3.2 для /next/) и не
   константой здесь: единственный источник — assets/topdown/config.json. Его же
   читает валидатор top-down генерации, а сюда число приходит через
   layout.runtime.json (поле road_half_width). История значений — там же.
   Колея держит ту же долю ширины, что и при 5.5. */
let ROAD_HALF = null;                       // задаётся в main() из runtime layout
const RUT_HALF = 0.53;                      // та же доля дороги, что была при 5.5

/* Смещения тени по свету больше нет. Оно уводило пятно вниз по экрану, то
   есть ПЕРЕД объектом, — для вида 3/4 это свет из-за предмета, против
   нарисованной светотени, и вместе с привязкой к кромке холста давало
   «парение» (grounding diagnostic 2). Отбрасываемая тень, если понадобится, —
   отдельная система; здесь только контакт с землёй. */

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
  uniform float uRutHalf;
  uniform float uCentre[NPTS];
  uniform float uWidth[NPTS];
  uniform float uZ0;
  uniform float uZStep;
  uniform float uRoadEnd;
  uniform sampler2D uMoss;
  uniform sampler2D uStone;
  // presentation биомов из runtime layout: веса слоёв (трава, мох, камень,
  // грунт), тон (tint.rgb, насыщенность), тон2 (яркость, камень в дороге)
  uniform vec4 uGround[NB];
  uniform vec4 uTone[NB];
  uniform vec4 uTone2[NB];
  uniform vec2 uTrans[NTRANS];   // полосы переходов: (z начала, z конца)
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

  // ось и ширина дороги на данной Z, линейно между контрольными точками.
  // За концом дороги (uRoadEnd) полуширина сходит на нет по четверти круга
  // радиусом в саму полуширину — скруглённый торец, дальше полотна нет.
  void road_at(float z, out float cx, out float hw) {
    float t = clamp((uZ0 - z) / uZStep, 0.0, float(NPTS - 1) - 0.001);
    int i = int(floor(t));
    float f = t - float(i);
    cx = mix(uCentre[i], uCentre[i + 1], f);
    hw = uHalf * mix(uWidth[i], uWidth[i + 1], f);
    float past = uRoadEnd - z;
    if (past > 0.0) hw = past < hw ? hw * sqrt(1.0 - (past / hw) * (past / hw)) : 0.0;
  }

  // Непрерывный номер биома 0..NB-1 на данной Z: сумма плавных ступеней по
  // полосам переходов (presentation.transitions, мировые Z из runtime). Та же
  // формула — в proto/main.js biomeAt() и tools/topdown_presentation.py.
  float biome_at(float z) {
    float b = 0.0;
    for (int k = 0; k < NTRANS; k++) {
      float u = clamp((uTrans[k].x - z) / (uTrans[k].x - uTrans[k].y), 0.0, 1.0);
      b += u * u * (3.0 - 2.0 * u);
    }
    return b;
  }

  void main() {
    // --- какой биом под этим пикселем ------------------------------------------
    // Граница сбита шумом на ±7 м: ровная горизонтальная линия перехода читалась
    // бы швом поперёк дороги.
    float bz = vWorld.y + (fbm(vWorld * 0.04 + 3.3) - 0.5) * 14.0;
    float b = biome_at(bz);
    vec4 gw = vec4(0.0), tone = vec4(0.0), tone2 = vec4(0.0);
    for (int k = 0; k < NB; k++) {
      float w = max(0.0, 1.0 - abs(b - float(k)));
      gw += w * uGround[k];
      tone += w * uTone[k];
      tone2 += w * uTone2[k];
    }

    // --- А/В/Б: трава, как было (ground-3), только там, где она есть ---------
    vec3 grass = vec3(0.0);
    if (gw.x > 0.001) {
      vec3 a = texture2D(uGrass, vWorld / uTile).rgb;
      // тот же тайл под 37° и в 1.61 раза крупнее: смешение держится около
      // половины, решётки не совпадают — период в кадр не влезает
      vec2 uv2 = (rot(0.6458) * vWorld) / (uTile * 1.61);
      vec3 c = texture2D(uGrass2, uv2).rgb;
      float mixAC = 0.34 + 0.32 * fbm(vWorld * 0.045);
      grass = mix(a, c, mixAC);
      vec3 e = texture2D(uGrass, (rot(-1.13) * vWorld) / (uTile * 2.7)).rgb;
      grass = mix(grass, e, 0.26);
    }

    // --- мох (tile_spirit): те же приёмы — два угла, некратные масштабы ------
    vec3 moss = vec3(0.0);
    if (gw.y > 0.001) {
      vec3 m1 = texture2D(uMoss, (rot(0.41) * vWorld) / (uTile * 1.13)).rgb;
      vec3 m2 = texture2D(uMoss, (rot(-0.93) * vWorld) / (uTile * 2.31)).rgb;
      moss = mix(m1, m2, 0.45 + 0.3 * (fbm(vWorld * 0.05 + 5.0) - 0.5));
    }

    // --- камень (tile_dirt — пол шахты из плит) ------------------------------
    // Одна выборка под 13° с лёгким искажением координат: две решётки плит
    // поверх друг друга дают кашу, а искажённая одна читается неровной
    // мостовой, выложенной руками.
    vec3 stone = vec3(0.0);
    if (gw.z > 0.001 || tone2.y > 0.001) {
      vec2 warp = vec2(fbm(vWorld * 0.15 + 9.0), fbm(vWorld * 0.15 + 21.0)) - 0.5;
      stone = texture2D(uStone, (rot(0.227) * vWorld) / 8.5 + warp * 0.18).rgb;
    }

    // --- грунт (зерно дорожного тайла, сведённое к своему среднему) ----------
    vec3 dirt = vec3(0.0);
    if (gw.w > 0.001) {
      dirt = mix(uRoadMean, texture2D(uRoad, (rot(0.7) * vWorld) / (uRoadTile * 1.3)).rgb, 0.35);
      dirt *= (0.86 + fbm(vWorld * 0.6 + 2.0) * 0.18);
      // земля темнее и серее полотна: иначе в шахте дорога тонет в грунте
      dirt = mix(vec3(dot(dirt, vec3(0.299, 0.587, 0.114))), dirt, 0.45) * 0.66;
    }

    // --- слои пятнами, а не средним цветом ----------------------------------
    // Вес слоя умножается на свой шум и возводится в куб: где слой один, он
    // целиком; где их несколько, они проступают пятнами, а не мутной смесью.
    vec4 n = vec4(fbm(vWorld * 0.05 + 1.3), fbm(vWorld * 0.06 + 17.0),
                  fbm(vWorld * 0.08 + 41.0), fbm(vWorld * 0.055 + 63.0));
    vec4 lw = gw * (0.35 + n * 1.3);
    lw = lw * lw * lw;
    lw /= max(dot(lw, vec4(1.0)), 1e-5);
    vec3 ground = lw.x * grass + lw.y * moss + lw.z * stone + lw.w * dirt;

    // Б: низкочастотная перекраска, период ~50 м, — поверх всего грунта
    float low = fbm(vWorld * 0.021);
    ground *= 1.0 + (low - 0.5) * 0.24;
    ground *= 1.0 + (fbm(vWorld * 0.085 + 7.1) - 0.5) * 0.16;
    ground = hueShift(ground, (fbm(vWorld * 0.017 + 31.7) - 0.5) * 0.14);

    // --- дорога ------------------------------------------------------------
    float cx, hw;
    road_at(vWorld.y, cx, hw);
    float d = abs(vWorld.x - cx);
    // у торца дорога тает целиком — вместе с колеёй, шумом кромки и полосой
    float alive = smoothstep(0.0, 0.8, hw);

    // Пятна исходного тайла сверху читаются артефактом текстуры, а не грязью:
    // тайл сведён к своему среднему цвету и оставлен только как мелкое зерно.
    vec3 road = mix(uRoadMean, texture2D(uRoad, vWorld / uRoadTile).rgb, 0.22);
    road *= 0.94 + fbm(vWorld * 0.9) * 0.12;
    // в шахте в полотно вкраплены плиты
    road = mix(road, stone * 1.05, tone2.y * smoothstep(0.35, 0.7, n.z));

    // Колея: две продольные полосы, прерывистые по шуму
    float rutBreak = smoothstep(0.30, 0.52, fbm(vec2(vWorld.y * 0.09, 0.0)))
                   * smoothstep(0.28, 0.60, fbm(vec2(vWorld.y * 0.37, 11.3)));
    float rutMask = (1.0 - smoothstep(0.0, 0.22, abs(d - uRutHalf))) * rutBreak * alive;
    road *= 1.0 - rutMask * 0.30;

    // --- край: грунт -> вытоптанная полоса -> дорога -------------------------
    float jag = (fbm(vec2(vWorld.y * 0.035, 0.0)) - 0.5) * 1.1
              + (fbm(vec2(vWorld.y * 0.62, vWorld.x * 0.24)) - 0.5) * 1.5
              + (fbm(vec2(vWorld.y * 1.70, vWorld.x * 0.70)) - 0.5) * 0.55;
    float eIn = hw + jag * alive;
    float eOut = eIn + 0.8 * alive;
    vec3 trampled = mix(ground, road, 0.55) * 0.96;

    vec3 col = ground;
    col = mix(col, trampled, (1.0 - smoothstep(eOut - 0.28, eOut + 0.28, d)) * alive);
    col = mix(col, road, (1.0 - smoothstep(eIn - 0.20, eIn + 0.20, d)) * alive);

    // --- палитра биома: весь грунт вместе с дорогой; спрайты не трогаются ----
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, tone.w) * tone.rgb * tone2.x;

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

// ---------------------------------------------------------------- спрайты --
const cache = new Map();
let strippedSet = new Set();
/* Где спрайт касается земли: proto/sprite_contact.json (tools/sprite_contact.py),
   посчитано заранее по той же текстуре, что грузится здесь. Доли высоты и
   ширины текстуры, поэтому годятся при любом размере объекта в сцене. */
let CONTACT = { sprites: {} };
const SHADOWS = [];                          // для __PROTO.shadows(): проверки и отчёты

function sprite(t) {
  if (!cache.has(t)) {
    const url = (strippedSet.has(t) ? STRIPPED : ASSETS) + t + '.webp';
    cache.set(t, tex(url).then((map) => ({
      map,
      aspect: map.image.width / map.image.height,
      contact: CONTACT.sprites[t] || null,
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

/* Контактная тень: объект вдавлен в землю, а не стоит над пятном.

   Центр — НА линии контакта спрайта (строка основания из sprite_contact.json,
   повёрнутая вместе со спрайтом), а не у кромки холста: у вырезанных
   спрайтов основание на 0.4–1.2 м выше кромки, и тень оттуда лежала под
   объектом отдельным пятном. Половина тени уходит под основание — это и
   читается как контакт.

   Размер: ширина — ширина основания; глубина мала и ограничена сверху и
   долей ширины, и долей высоты объекта (у фасада в 12 м она не растёт до
   метров). Все числа — presentation.contact_shadow из runtime layout. */
let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // темнее всего в центре (на линии контакта) и быстро сходит на нет
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.3, 'rgba(0,0,0,0.78)');
  g.addColorStop(0.65, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

/* Точка контакта в мире: основание спрайта с учётом его поворота в плоскости
   земли (flatQuad крутит квад вокруг центра на rotY). */
function contactPoint(art, o, z) {
  const w = o.h * art.aspect, c = art.contact, a = o.rotY || 0;
  const px = c.contact_centre * w, py = (0.5 - c.contact_row) * o.h;   // локально, +y — верх картинки
  return {
    x: o.pos[0] + px * Math.cos(a) - py * Math.sin(a),
    z: z - (px * Math.sin(a) + py * Math.cos(a)),
    w: c.contact_width * w,
  };
}

function shadowSize(o, baseW) {
  const P = PRES.contact_shadow;
  const w = baseW * P.width_scale;
  const cap = Math.min(P.depth_max, P.depth_per_height * o.h);
  const d = Math.max(P.depth_min, Math.min(P.depth_per_width * w, cap));
  return { w, d };
}

function shadowFor(art, o, z) {
  if (!art.contact) return new THREE.Object3D();    // тест покрытия не пускает сюда
  const p = contactPoint(art, o, z);
  const { w, d } = shadowSize(o, p.w);
  const q = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, opacity: PRES.contact_shadow.opacity,
      depthTest: false, depthWrite: false, color: 0x1a1a14,
    }));
  q.rotation.x = -Math.PI / 2;
  q.position.set(p.x, 0.5, p.z);
  q.renderOrder = ORDER.shadow;
  if (o.id) SHADOWS.push({ id: o.id, t: o.t, x: p.x, z: p.z, w, d });
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
function patchTexture(kind, roadImg) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const cx = c.getContext('2d');

  // Внутри проплешины — та же земля, что на дороге. Размытая клякса рядом с
  // чёткими декалями конфликтовала по резкости: пятно без текстуры читается
  // дефектом рендера, а не грязью.
  const tile = document.createElement('canvas');
  const T = kind === 'dark' ? 96 : 128;      // два-три повтора на проплешину
  tile.width = tile.height = T;
  tile.getContext('2d').drawImage(roadImg, 0, 0, T, T);
  cx.save();
  cx.translate(S / 2, S / 2);
  cx.rotate(h01('patchrot', kind) * Math.PI * 2);
  cx.fillStyle = cx.createPattern(tile, 'repeat');
  cx.fillRect(-S, -S, S * 2, S * 2);
  cx.restore();
  // Проплешина — голая земля: она ТЕМНЕЕ травы. Дорожный тайл сам по себе
  // светлее её, и без этого проплешины читались копнами сена на лугу.
  cx.globalCompositeOperation = 'multiply';
  cx.fillStyle = kind === 'dark' ? '#4e4126' : '#6d5c39';
  cx.fillRect(0, 0, S, S);
  cx.globalCompositeOperation = 'source-over';

  // Край — по шуму двух частот, как кромка дороги: медленная задаёт форму
  // пятна, быстрая грызёт его языками. Решение то же, только в полярных
  // координатах, потому что тут край замкнут.
  cx.globalCompositeOperation = 'destination-in';
  cx.beginPath();
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const slow = h01('slow', kind, Math.floor(i / 12)) - 0.5;
    const fast = h01('fast', kind, i) - 0.5;
    const r = S / 2 * (0.80 + slow * 0.34 + fast * 0.12);
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.82;
    i ? cx.lineTo(x, y) : cx.moveTo(x, y);
  }
  cx.closePath();
  const g = cx.createRadialGradient(S / 2, S / 2, S * 0.22, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.9)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = g;
  cx.fill();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DECALS = [
  { key: 'patch', tex: (img) => patchTexture('light', img), size: [1.3, 2.8],
    share: 0.16, order: ORDER.decalFar, onRoad: true, plain: true },
  { key: 'patch2', tex: (img) => patchTexture('dark', img), size: [0.9, 1.9],
    share: 0.10, order: ORDER.decalFar, onRoad: true, plain: true },
  { key: 'grass_tuft_a', size: [0.9, 1.7], share: 0.24, order: ORDER.decalNear, veg: true },
  { key: 'grass_tuft_b', size: [0.9, 1.7], share: 0.18, order: ORDER.decalNear, veg: true },
  /* Кромка должна быть зубчатой ОБЪЕКТАМИ, а не только маской: маска сколь
     угодно рваная всё равно читается краем заливки. Эти кустики сидят поперёк
     границы и заходят на землю. */
  { key: 'grass_tuft_a', name: 'verge_a', size: [0.6, 1.2], share: 0.08,
    order: ORDER.decalNear, verge: true, veg: true },
  { key: 'grass_tuft_b', name: 'verge_b', size: [0.6, 1.2], share: 0.06,
    order: ORDER.decalNear, verge: true, veg: true },
  { key: 'rock_s', size: [0.6, 1.2], share: 0.12, order: ORDER.decalNear },
  { key: 'mushrooms', size: [0.5, 0.9], share: 0.04, order: ORDER.decalNear, veg: true },
  { key: 'fern', size: [0.8, 1.5], share: 0.04, order: ORDER.decalNear, veg: true },
];

/* Плотность пересмотрена после того, как у декалей появилась вариация: тот же
   счёт с разными формами читается заметно гуще и превращается в сыпь. */
const DECAL_DENSITY = 0.085;     // штук на квадратный метр (было 0.15)
const FIELD_X = 55;              // полуширина засеваемой полосы

async function buildDecals(len, roadAt, roadImg) {
  const area = FIELD_X * 2 * (len + 40);
  const total = Math.round(area * DECAL_DENSITY);
  const dummy = new THREE.Object3D();

  for (const [di, spec] of DECALS.entries()) {
    const n = Math.round(total * spec.share);
    let art = null;
    if (spec.tex) art = { map: spec.tex(roadImg), aspect: 1 };
    else art = await sprite(spec.key);
    const dname = spec.name || spec.key;
    if (!art) continue;

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: art.map, transparent: true, alphaTest: spec.tex ? 0.0 : 0.04,
      // проплешина — тональная подмена грунта, а не предмет на нём
      opacity: spec.tex ? 0.72 : 1.0,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.renderOrder = spec.order;
    mesh.frustumCulled = false;
    const col = new THREE.Color();

    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = (h01('dx', dname, i) * 2 - 1) * FIELD_X;
      const z = 20 - h01('dz', dname, i) * (len + 40);
      const { cx, hw } = roadAt(z);
      // трава редеет там, где её нет по presentation (шахта, мир духов); решает
      // тот же хеш, поэтому земля воспроизводится от загрузки к загрузке
      if (spec.veg && h01('veg', dname, i) > presentationAt(z).vegetation) continue;
      let px = x;
      if (spec.verge) {
        if (hw < 0.5) continue;          // за концом дороги кромки нет
        // сажаем поперёк кромки: гладкая hw плюс разброс шире, чем ходит шум
        // края, поэтому часть кустов оказывается на земле, часть на траве
        px = cx + (x < 0 ? -1 : 1) * (hw + (h01('dv2', dname, i) - 0.5) * 1.9);
      } else if (!spec.onRoad && Math.abs(x - cx) < hw * 1.25) {
        continue;
      }

      /* Решётку вычистили из тайла — и собрали новую из декалей: один кустик,
         повторённый сотни раз в одном размере и одной ориентации. Одинаковая
         ФОРМА ловится глазом быстрее, чем одинаковый шаг, поэтому каждому
         экземпляру своя вариация — и вся она из того же хеша, что и позиция,
         так что земля воспроизводится от загрузки к загрузке. */
      const base = (spec.size[0] + spec.size[1]) / 2;
      const s = base * (0.7 + h01('ds', dname, i) * 0.7);        // 0.7…1.4
      const flip = h01('df', dname, i) < 0.5 ? -1 : 1;           // зеркало по X
      dummy.position.set(px, 0.4, z);
      dummy.rotation.set(-Math.PI / 2, 0, h01('dr', dname, i) * Math.PI * 2);
      dummy.scale.set(s * art.aspect * flip, s, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);

      // оттенок ±8%, яркость ±10% — тем же способом
      const hue = (h01('dh', dname, i) - 0.5) * 0.16;
      const val = 1 + (h01('dv', dname, i) - 0.5) * 0.20;
      col.setRGB(val * (1 + hue), val, val * (1 - hue)).convertSRGBToLinear();
      mesh.setColorAt(k, col);
      k++;
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = k;
    state.decals += k;
    scene.add(mesh);
  }
}

// -------------------------------------------------------------- presentation --
/* Как выглядит каждый биом и где один переходит в другой — не здесь, а в
   assets/topdown/presentation.json; tools/generate_layout.py пересчитывает его
   в мировые Z и кладёт в runtime layout (layout.presentation). Отсюда берутся
   и uniforms шейдера, и затемнение перехода, и доля травы в декалях: одни и
   те же числа, одна и та же формула ступени (см. biome_at в GROUND_FS). */
let PRES = null;

function biomeAt(z) {
  let b = 0;
  for (const t of PRES.transitions) {
    const [z0, z1] = t.blend_z;
    const u = Math.min(Math.max((z0 - z) / (z0 - z1), 0), 1);
    b += u * u * (3 - 2 * u);
  }
  return b;
}

/* Затемнение кадра у якоря перехода: пик в якоре, к half_width метров от него
   сходит на нет. Зависит только от положения камеры, не от времени. */
function dimAt(z) {
  let o = 0;
  for (const t of PRES.transitions) {
    const u = Math.min(Math.abs(z - t.anchor_z) / t.dim.half_width, 1);
    o = Math.max(o, t.dim.max * (1 - u * u * (3 - 2 * u)));
  }
  return o;
}

function presentationAt(z) {
  const b = biomeAt(z);
  const i = Math.min(Math.floor(b), PRES.biomes.length - 1);
  const f = b - i;
  const A = PRES.biomes[i], B = PRES.biomes[Math.min(i + 1, PRES.biomes.length - 1)];
  const layers = ['grass', 'moss', 'stone', 'dirt'];
  const w = Object.fromEntries(layers.map((k) => [k, +(A.ground[k] * (1 - f) + B.ground[k] * f).toFixed(3)]));
  return {
    z, biome: A.id, neighbour: f > 0 ? B.id : null, blend: +f.toFixed(3),
    overlay: +dimAt(z).toFixed(3),
    ground: layers.reduce((m, k) => (w[k] > w[m] ? k : m), 'grass'), groundWeights: w,
    vegetation: +(A.vegetation * (1 - f) + B.vegetation * f).toFixed(3),
  };
}

// ------------------------------------------------------------------ сборка --
let roadAt = () => ({ cx: 0, hw: 3.2 });

async function main() {
  const [layout, spline, index, contact] = await Promise.all([
    fetch(LAYOUT).then((r) => r.json()),
    fetch(ASSETS + 'road_spline.json').then((r) => r.json()),
    fetch(STRIPPED + 'index.json').then((r) => r.json()).catch(() => ({ stripped: [] })),
    fetch('./sprite_contact.json').then((r) => r.json()),
  ]);
  strippedSet = new Set(index.stripped);
  CONTACT = contact;
  if (typeof layout.road_half_width !== 'number') {
    throw new Error('в ' + LAYOUT + ' нет road_half_width');
  }
  ROAD_HALF = layout.road_half_width;
  if (typeof layout.biome_spacing !== 'number') {
    throw new Error('в ' + LAYOUT + ' нет biome_spacing');
  }
  BIOME_SPACING = layout.biome_spacing;
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
  // конец дороги — у финального дома (config.json road_end_z через runtime);
  // за ним полуширина сходит по четверти круга, как в шейдере
  if (typeof layout.road_end_z !== 'number') throw new Error('в ' + LAYOUT + ' нет road_end_z');
  const ROAD_END = layout.road_end_z;
  roadAt = (z) => {
    const t = Math.min(Math.max((0 - z) / zStep, 0), NPTS - 1.001);
    const i = Math.floor(t), f = t - i;
    let hw = ROAD_HALF * (width[i] + (width[i + 1] - width[i]) * f);
    const past = ROAD_END - z;
    if (past > 0) hw = past < hw ? hw * Math.sqrt(1 - (past / hw) ** 2) : 0;
    return { cx: centre[i] + (centre[i + 1] - centre[i]) * f, hw };
  };

  PRES = layout.presentation;
  if (!PRES || PRES.biomes.length !== ids.length) throw new Error('в ' + LAYOUT + ' нет presentation');
  const T = PRES.textures;
  /* Все текстуры грунта грузятся ДО первого кадра: state.ready/done ставятся
     только после них, и скриншот не может поймать землю без текстуры. */
  const [grass, grass2, road, moss, stone] = await Promise.all([
    tex('./' + T.grass, true), tex('./' + T.grass, true),
    tex('./' + T.road, true), tex('./' + T.moss, true), tex('./' + T.stone, true),
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
      defines: { NB: PRES.biomes.length, NTRANS: PRES.transitions.length },
      uniforms: {
        uMoss: { value: moss }, uStone: { value: stone },
        uRoadEnd: { value: ROAD_END },
        uGround: { value: PRES.biomes.map((b) => new THREE.Vector4(b.ground.grass, b.ground.moss, b.ground.stone, b.ground.dirt)) },
        uTone: { value: PRES.biomes.map((b) => new THREE.Vector4(b.tint[0], b.tint[1], b.tint[2], b.saturation)) },
        uTone2: { value: PRES.biomes.map((b) => new THREE.Vector4(b.brightness, b.road_stone, 0, 0)) },
        uTrans: { value: PRES.transitions.map((t) => new THREE.Vector2(t.blend_z[0], t.blend_z[1])) },
        uGrass: { value: grass }, uGrass2: { value: grass2 },
        uRoad: { value: road }, uRoadMean: { value: new THREE.Vector3(mean.r, mean.g, mean.b) },
        uHalf: { value: ROAD_HALF },
        uTile: { value: 9.0 }, uRoadTile: { value: 6.5 },
        uRutHalf: { value: RUT_HALF },
        uCentre: { value: centre }, uWidth: { value: width },
        uZ0: { value: 0 }, uZStep: { value: zStep },
      },
    }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -state.len / 2 + 40);
  ground.renderOrder = ORDER.ground;
  scene.add(ground);

  await buildDecals(state.len, roadAt, road.image);

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

    /* Заборы top-down композиции приходят с явным отрезком (o.run: ключ, ось
       и шаг) и могут идти поперёк дороги — участок, а не рельс. Каждый отрезок
       рисуется одной полосой вдоль своей оси, ровно по следу, который меряет
       валидатор (tools/topdown_compose.py footprint). Заборы без o.run — как
       раньше: группировка по X. */
    const fences = all.filter(isFence);
    const byRun = new Map();
    for (const o of fences) {
      if (!o.run || o.visible === false) continue;
      if (!byRun.has(o.run.key)) byRun.set(o.run.key, []);
      byRun.get(o.run.key).push(o);
    }
    for (const segs of byRun.values()) {
      const { axis, step } = segs[0].run;
      const along = segs.map((o) => (axis === 'z' ? o.pos[2] : o.pos[0]));
      const a0 = Math.min(...along) - step / 2, a1 = Math.max(...along) + step / 2;
      const across = segs[0].pos[axis === 'z' ? 0 : 2];
      const q = new THREE.Mesh(
        axis === 'z' ? new THREE.PlaneGeometry(0.7, a1 - a0) : new THREE.PlaneGeometry(a1 - a0, 0.7),
        new THREE.MeshBasicMaterial({ color: 0x7a4f2a, depthTest: false }));
      q.rotation.x = -Math.PI / 2;
      if (axis === 'z') q.position.set(across, 1, z0 + (a0 + a1) / 2);
      else q.position.set((a0 + a1) / 2, 1, z0 + across);
      q.renderOrder = orderOf(z0 + (axis === 'z' ? a1 : across + 0.35));
      scene.add(q);
      state.objects++;
    }
    for (const run of groupRuns(fences.filter((o) => !o.run))) {
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

/* Затемнение перехода — не контент: пустой слой поверх канваса и под панелью,
   прозрачность которого задаёт положение камеры. Своих таймеров и анимаций
   у него нет, поэтому кадр в заданной Z всегда один и тот же. */
const OVERLAY = document.getElementById('biome-transition-overlay');

function draw() {
  if (OVERLAY && PRES) OVERLAY.style.opacity = dimAt(state.z).toFixed(3);
  camera.position.set(0, 120, state.z);
  camera.lookAt(0, 0, state.z);
  camera.up.set(0, 0, -1);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  const halfM = ZOOM[state.zoom];
  const tiles = (halfM * 2) / TILE_M;                 // высота кадра в тайлах
  const asOrtho = halfM / TILE_M;                     // тот же кадр у камеры игры
  const same = Math.abs(asOrtho - GAME_ORTHO_SIZE) < 0.15;
  HUD.innerHTML = 'top-down проба · ортокамера, взгляд вниз\n'
    + `зум: <b>${state.zoom}</b> — эквивалент orthographicSize `
    + `<b>${asOrtho.toFixed(1)}</b>${same ? ' <b>(игровой кадр)</b>' : ''} — клавиша Z\n`
    + `кадр ${(halfM * 2).toFixed(1)} м = ${tiles.toFixed(1)} тайла игры · `
    + `1 м сайта = ${(1 / TILE_M).toFixed(2)} тайла\n`
    + `<b>игровой кадр = ${GAME_FRAME_M.toFixed(1)} м — недостижим при текущем разрешении пака</b>\n`
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

/* Где НА САМОМ ДЕЛЕ проходит кромка дороги.
   Полуширина ROAD_HALF — это гладкая ось; видимый край гуляет от неё на шум.
   Забор стоит на полосе verge = 5.2, и вопрос «снаружи ли он» решается не
   вычитанием ROAD_HALF из 5.2, а замером. Формулы те же, что в шейдере; точность двойная вместо
   одинарной, поэтому число представительное, а не побитовое. */
function edgeStats(z0, z1) {
  const h21 = (x, y) => {
    const v = Math.sin(x * 41.3 + y * 289.1) * 43758.5453;
    return v - Math.floor(v);
  };
  const vnoise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = h21(ix, iy), b = h21(ix + 1, iy);
    const c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
    const top = a + (b - a) * fx, bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  };
  const fbm = (x, y) => vnoise(x, y) * 0.6 + vnoise(x * 2.1, y * 2.1) * 0.3
                      + vnoise(x * 4.3, y * 4.3) * 0.1;
  const VERGE = 5.2;
  let mx = 0, sum = 0, n = 0, over = 0;
  for (let z = z0; z >= z1; z -= 0.1) {
    const { cx, hw } = roadAt(z);
    const jag = (fbm(z * 0.035, 0) - 0.5) * 1.1
              + (fbm(z * 0.62, cx * 0.24) - 0.5) * 1.5
              + (fbm(z * 1.70, cx * 0.70) - 0.5) * 0.55;
    const edge = Math.abs(cx) + hw + jag;
    mx = Math.max(mx, edge); sum += edge; n++;
    if (edge > VERGE) over++;
  }
  return { max: +mx.toFixed(2), mean: +(sum / n).toFixed(2),
           overVerge: +(over / n * 100).toFixed(1), verge: VERGE };
}

/* Ручка для скриншотов: та же камера, тот же путь, без анимаций. */
window.__PROTO = {
  go(z, zoom) {
    if (zoom) state.zoom = zoom;
    state.z = z;
    resize();
    draw();
  },
  sortTest,
  edgeStats,
  state,
  // только чтение: для отчётов и тестов (что под камерой, где дорога)
  presentationAt: (z) => presentationAt(z ?? state.z),
  shadows: () => SHADOWS.map((s) => ({ ...s })),
  roadAt: (z) => roadAt(z),
};

main().catch((e) => { HUD.textContent = 'ошибка: ' + e.message; throw e; });
