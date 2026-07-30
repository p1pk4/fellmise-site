/* Diorama data. One entry per biome, in scroll order along -Z.
 *
 * Sprites are billboarded planes cut from the existing pack — nothing was
 * generated for this build. Where a diorama needed filling, an existing sprite
 * is reused at a larger scale and darkened (see `dim`), which is what the brief
 * asked for instead of new art.
 *
 * Coordinates are world units. 1 unit ~= 1 metre-ish; a house is ~6 units tall.
 * `h` is the sprite's height in world units — width follows from the texture's
 * own aspect, so nothing is stretched.
 *
 * layer: 0 backdrop .. 3 occluder nearest the camera.
 *
 * Light is NOT declared here. A sprite emits light if tools/make_emissive.py
 * cut a mask for it, and the light then has the shape of the glowing pixels in
 * the art itself — see assets/emissive.json.
 */

export const BIOME_SPACING = 150;      // distance between biome centres on Z
export const GATE_OFFSET = 74;         // where the transition sits between them

export const BIOMES = [
  {
    id: 'village',
    fog: 0xd9c79a, fogNear: 34, fogFar: 130,
    sky: [0x7eb8e0, 0xc7e6f2],
    ground: 'tile_grass', groundTint: 0xa8cb53,
    road: 'tile_road',
    tod: true,                          // only this biome follows the visitor's clock
    sprites: [
      // layer 0 — hills far behind, made from oversized darkened trees
      { t: 'hero_tree_a', x: -34, z: -46, h: 26, layer: 0, dim: 0.34 },
      { t: 'hero_tree_a', x: 30, z: -52, h: 30, layer: 0, dim: 0.30 },
      { t: 'biome_pine_b', x: -6, z: -58, h: 28, layer: 0, dim: 0.28 },
      // layer 1 — the village itself
      { t: 'hero_house_b', x: -11, z: -14, h: 7.4, layer: 1 },
      { t: 'hero_tree_a', x: -4.5, z: -18, h: 8.2, layer: 1, sway: true },
      { t: 'hero_well', x: 1.5, z: -11, h: 4.4, layer: 1 },
      { t: 'hero_house_a', x: 15, z: -16, h: 8.2, layer: 1 },
      { t: 'hero_tree_b', x: 17, z: -20, h: 3.2, layer: 1, sway: true },
      { t: 'prop_crates', x: 16.5, z: -8, h: 2.4, layer: 2 },
      // layer 2 — road dressing
      { t: 'prop_signpost', x: -6.5, z: -2, h: 3.2, layer: 2 },
      { t: 'prop_lantern', x: 5.2, z: -4, h: 3.6, layer: 2 },
      { t: 'prop_stones', x: -2.2, z: 1.5, h: 0.9, layer: 2 },
      // layer 3 — occluder: an oversized darkened tree crown brushing the lens
      { t: 'hero_tree_a', x: -13, z: 9, h: 20, layer: 3, dim: 0.22, blur: 2.6 },
      { t: 'hero_tree_b', x: 12.5, z: 11, h: 9, layer: 3, dim: 0.26, blur: 2.6 },
    ],
    particles: [{ kind: 'leaf', n: 10, box: [-14, 2, -22, 14, 8, 4] }],
    // text type A: the slogan on a plank sign by the road (see signs.js)
    board: { key: 'village', kind: 'wood', x: 7.5, z: -26, h: 7.6, ry: -0.22 },
  },
  {
    id: 'forest',
    fog: 0x2f4a2a, fogNear: 22, fogFar: 105,
    sky: [0x8fbcd6, 0xcfe4d6],
    ground: 'tile_grass', groundTint: 0x6b8f43,
    sprites: [
      { t: 'biome_pine_a', x: -28, z: -50, h: 30, layer: 0, dim: 0.30 },
      { t: 'biome_pine_b', x: 24, z: -46, h: 27, layer: 0, dim: 0.32 },
      { t: 'biome_deadtree', x: 2, z: -54, h: 22, layer: 0, dim: 0.26 },
      { t: 'biome_pine_b', x: -13, z: -18, h: 12, layer: 1, sway: true },
      { t: 'biome_deadtree', x: -3, z: -22, h: 9, layer: 1, sway: true },
      { t: 'biome_pine_a', x: 11, z: -16, h: 13.5, layer: 1, sway: true },
      { t: 'biome_stump', x: 1.2, z: -6, h: 1.9, layer: 2 },
      { t: 'biome_pine_a', x: -11, z: 8, h: 22, layer: 3, dim: 0.20, blur: 2.6 },
      { t: 'biome_pine_b', x: 10.5, z: 10, h: 19, layer: 3, dim: 0.22, blur: 2.6 },
    ],
    particles: [{ kind: 'fly', n: 16, box: [-16, 0.5, -26, 16, 6, 6] }],
  },
  {
    id: 'mine',
    fog: 0x0d1018, fogNear: 12, fogFar: 74, dark: true,
    sky: [0x221f2a, 0x3a3542],
    ground: 'tile_dirt', groundTint: 0x3d3a45,
    sprites: [
      { t: 'biome_orevein', x: -22, z: -44, h: 24, layer: 0, dim: 0.42 },
      { t: 'biome_orevein', x: 20, z: -40, h: 21, layer: 0, dim: 0.38 },
      { t: 'biome_orevein', x: -9, z: -17, h: 10, layer: 1 },
      { t: 'feat_mining', x: 3.5, z: -13, h: 5.2, layer: 1 },
      { t: 'biome_crystals', x: 12, z: -16, h: 7.2, layer: 1 },
      { t: 'biome_brazier', x: -3.4, z: -5, h: 2.9, layer: 2 },
      { t: 'biome_crystals', x: 9.5, z: -3, h: 3.4, layer: 2 },
      { t: 'biome_orevein', x: -14, z: 9, h: 20, layer: 3, dim: 0.18, blur: 2.6 },
      { t: 'biome_orevein', x: 13, z: 11, h: 18, layer: 3, dim: 0.20, blur: 2.6 },
    ],
    particles: [
      { kind: 'ember', n: 22, box: [-3.9, 2.4, -5.4, -2.9, 6.5, -4.6] },
      { kind: 'dust', n: 26, box: [-16, 0.4, -24, 16, 9, 6] },
    ],
  },
  {
    id: 'spirit',
    fog: 0x0d2a2c, fogNear: 14, fogFar: 84, dark: true,
    sky: [0x10222a, 0x21454a],
    ground: 'tile_spirit', groundTint: 0x1e3d3d,
    sprites: [
      { t: 'biome_deadtree', x: -26, z: -46, h: 24, layer: 0, dim: 0.26 },
      { t: 'feat_death_alt', x: 22, z: -42, h: 20, layer: 0, dim: 0.30 },
      { t: 'feat_death_alt', x: -12.5, z: -19, h: 7.6, layer: 1 },
      { t: 'biome_deadtree', x: -3.5, z: -24, h: 9.5, layer: 1, sway: true },
      { t: 'feat_vendetta', x: 1.5, z: -14, h: 7.4, layer: 1 },
      { t: 'feat_death', x: 16, z: -19, h: 7.6, layer: 1 },
      { t: 'biome_brazier', x: 4.5, z: -5, h: 2.7, layer: 2 },
      { t: 'biome_deadtree', x: -12, z: 9, h: 21, layer: 3, dim: 0.18, blur: 2.6 },
    ],
    particles: [{ kind: 'soul', n: 8, box: [-15, 0.6, -26, 15, 8, 6] }],
    // text type A: Vendetta cut into a stone slab
    board: { key: 'spirit', kind: 'stone', x: 5.4, z: -28, h: 7.6, ry: -0.24 },
  },
  {
    id: 'home',
    fog: 0xe08a4a, fogNear: 30, fogFar: 125, dusk: true,
    sky: [0xe78b4a, 0xf4c98a],
    ground: 'tile_grass', groundTint: 0xa8cb53,
    road: 'tile_road',
    sprites: [
      { t: 'hero_tree_a', x: -32, z: -48, h: 27, layer: 0, dim: 0.32 },
      { t: 'biome_pine_b', x: 27, z: -44, h: 25, layer: 0, dim: 0.30 },
      { t: 'hero_house_b', x: -10, z: -16, h: 7.6, layer: 1 },
      { t: 'hero_tree_a', x: -1.5, z: -21, h: 8, layer: 1, sway: true },
      { t: 'hero_house_a', x: 10, z: -14, h: 8.4, layer: 1 },
      { t: 'prop_lantern', x: 3.6, z: -4, h: 3.6, layer: 2 },
      { t: 'hero_tree_b', x: -12, z: 9, h: 10, layer: 3, dim: 0.24, blur: 2.6 },
    ],
    particles: [{ kind: 'leaf', n: 8, box: [-13, 2, -20, 13, 8, 4] }],
  },
];

/* The four transitions. `art` is the opening the camera flies through; the light
   quad sits inside it and floods the frame at the peak. Door leaves are NOT
   animated in this stage — the opening simply glows (polish stage). */
export const GATES = [
  { from: 'village', art: 'hero_house_b', h: 9, warm: 0xffbe6e },
  { from: 'forest', art: 'biome_orevein', h: 12, warm: 0x9ad6ff },
  { from: 'mine', art: 'biome_portal', h: 10, warm: 0x78ffe8 },
  { from: 'spirit', art: 'feat_death', h: 9, warm: 0xffd696 },
];
