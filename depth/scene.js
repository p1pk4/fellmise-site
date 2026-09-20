/* Постановка двух сцен PoC из уже принятого арта: ничего не рисуется заново,
   спрайты берутся как есть из /assets/ и /proto/sprites_stripped/.

   Сцена — виртуальная «сцена» 1600×1000; координаты объектов в её единицах,
   якорь спрайта — низ-центр (как у объекта, стоящего на земле). Слои от фона к
   переднему плану: bg → far → mid → near, плюс focal — ворота из сосен вокруг
   прохода, через который зритель и проваливается.

   Фокус (FOCUS) — точка схода: центр прохода. Все слои масштабируются ОТ неё,
   поэтому ближние объекты разъезжаются наружу мимо зрителя, а дальние почти
   стоят на месте. Village и Forest делят одну и ту же ось дороги (x = 800),
   поэтому переход не читается монтажной склейкой. */

export const STAGE = { w: 1600, h: 1000 };
export const FOCUS = { x: 800, y: 330 };          // центр прохода в лес
export const ROAD_X = 800;

const S = (n) => `/proto/sprites_stripped/${n}.webp`;   // без «подставки» под спрайтом
const A = (n) => `/assets/${n}.webp`;

export const VILLAGE = {
  ground: { tile: '/proto/tile_grass.webp', tint: 'rgba(24,46,20,0)' },
  road: { tile: '/proto/tile_path.webp', width: 210 },
  layers: {
    far: [
      { src: S('hero_house_b'), x: 520, y: 356, w: 150 },
      { src: S('barn'), x: 1090, y: 360, w: 176 },
      { src: A('hero_tree_a'), x: 386, y: 368, w: 132 },
      { src: A('hero_tree_a'), x: 1240, y: 372, w: 140, flip: true },
      { src: A('hero_tree_b'), x: 636, y: 352, w: 96 },
      { src: A('hero_tree_b'), x: 978, y: 350, w: 92, flip: true },
      { src: S('prop_signpost'), x: 906, y: 366, w: 66 },
    ],
    mid: [
      { src: S('feat_tavern'), x: 452, y: 612, w: 320 },
      { src: S('hero_house_a'), x: 1160, y: 620, w: 300 },
      { src: S('hero_well'), x: 690, y: 566, w: 148 },
      { src: S('hero_cart'), x: 1000, y: 580, w: 196 },
      { src: A('haystack'), x: 1330, y: 556, w: 150 },
      { src: A('fence_seg'), x: 300, y: 590, w: 240 },
      { src: A('grass_tuft_a'), x: 640, y: 636, w: 80 },
      { src: A('grass_tuft_b'), x: 1060, y: 648, w: 86 },
    ],
    near: [
      { src: A('hero_tree_a'), x: 150, y: 1120, w: 620 },
      { src: A('hero_tree_a'), x: 1470, y: 1160, w: 660, flip: true },
      { src: A('hero_fence'), x: 470, y: 1010, w: 380 },
      { src: A('fence_seg'), x: 1180, y: 1020, w: 360, flip: true },
      { src: A('prop_crates'), x: 1560, y: 900, w: 250 },
      { src: A('haystack'), x: 60, y: 918, w: 270 },
      { src: A('grass_tuft_a'), x: 330, y: 1060, w: 190 },
      { src: A('grass_tuft_b'), x: 1330, y: 1080, w: 200 },
    ],
    focal: [                                   // ворота: сосны по краям прохода
      { src: A('biome_pine_a'), x: 662, y: 430, w: 190 },
      { src: A('biome_pine_b'), x: 944, y: 438, w: 232, flip: true },
      { src: A('biome_pine_a'), x: 726, y: 386, w: 132 },
      { src: A('biome_pine_b'), x: 880, y: 390, w: 150, flip: true },
      { src: A('rock_m'), x: 620, y: 452, w: 120 },
      { src: A('fern'), x: 980, y: 462, w: 110 },
    ],
  },
};

export const FOREST = {
  ground: { tile: '/proto/tile_grass.webp', tint: 'rgba(12,30,14,0.55)' },
  road: { tile: '/proto/tile_path.webp', width: 168 },
  layers: {
    far: [
      { src: A('biome_pine_a'), x: 560, y: 330, w: 120 },
      { src: A('biome_pine_b'), x: 690, y: 336, w: 130 },
      { src: A('biome_pine_a'), x: 930, y: 334, w: 126, flip: true },
      { src: A('biome_pine_b'), x: 1060, y: 340, w: 136, flip: true },
      { src: A('biome_deadtree'), x: 430, y: 346, w: 130 },
      { src: A('biome_pine_a'), x: 1210, y: 348, w: 140 },
    ],
    mid: [
      { src: A('biome_pine_b'), x: 470, y: 600, w: 300 },
      { src: A('biome_pine_a'), x: 1150, y: 618, w: 280, flip: true },
      { src: A('biome_deadtree'), x: 300, y: 560, w: 230 },
      { src: S('biome_stump'), x: 980, y: 548, w: 130 },
      { src: A('rock_l'), x: 660, y: 566, w: 170 },
      { src: A('mushrooms'), x: 902, y: 596, w: 96 },
      { src: A('fern'), x: 1300, y: 580, w: 150 },
    ],
    near: [
      { src: A('biome_pine_a'), x: 180, y: 1180, w: 700 },
      { src: A('biome_pine_b'), x: 1450, y: 1210, w: 760, flip: true },
      { src: A('fern'), x: 470, y: 1030, w: 300 },
      { src: A('rock_l'), x: 1160, y: 1000, w: 330 },
      { src: A('mushrooms'), x: 330, y: 980, w: 190 },
      { src: A('grass_tuft_a'), x: 1320, y: 1070, w: 230 },
    ],
    focal: [],
  },
};
