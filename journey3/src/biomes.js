/* Diorama data. One entry per biome, in scroll order along -Z.
 *
 * Sprites are billboarded planes cut from the pack. Stage 1 filled the gaps
 * with darkened, oversized copies of what already existed; stage 2 replaces
 * those stand-ins with dressing generated for the purpose (batch 7) and lays
 * each scene out in depth rows instead of one wall of props.
 *
 * `y` is the CENTRE height, given only for things that do not stand on the
 * ground: clouds, the moon, a lantern on a chain, a beam over the tunnel.
 * `drift` moves a sprite sideways and wraps it, for weather.
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
    fog: 0xd9c79a, fogNear: 52, fogFar: 210,
    sky: [0x7eb8e0, 0xc7e6f2],
    ground: 'tile_grass', groundTint: 0xa8cb53,
    road: 'tile_path',
    tod: true,                          // only this biome follows the visitor's clock
    sprites: [
      // sky — weather crossing slowly behind everything
      { t: 'cloud_a', x: -22, y: 30, z: -86, h: 9, layer: 0, drift: 0.30, span: 110 },
      { t: 'cloud_b', x: 16, y: 35, z: -94, h: 8, layer: 0, drift: 0.22, span: 110 },
      { t: 'cloud_c', x: 40, y: 27, z: -78, h: 7, layer: 0, dim: 0.9, drift: 0.38, span: 110 },
      // layer 0 — the land behind the village
      { t: 'hero_tree_a', x: -34, z: -52, h: 14, layer: 0, dim: 0.74 },
      { t: 'biome_pine_b', x: 31, z: -64, h: 13, layer: 0, dim: 0.70 },
      // layer 1 — the village itself
      { t: 'hero_house_b', x: -11, z: -14, h: 7.4, layer: 1 },
      { t: 'hero_tree_a', x: -7.2, z: -22, h: 8.2, layer: 1, sway: true },
      { t: 'hero_well', x: 1.5, z: -11, h: 4.4, layer: 1 },
      { t: 'hero_house_a', x: 15, z: -16, h: 8.2, layer: 1 },
      { t: 'hero_tree_b', x: 17, z: -20, h: 3.2, layer: 1, sway: true },
      { t: 'barn', x: -19, z: -26, h: 7.6, layer: 1 },
      { t: 'feat_tavern', x: -11.5, z: -32, h: 6.4, layer: 1 },
      { t: 'haystack', x: -13.2, z: -10, h: 2.4, layer: 2 },
      { t: 'prop_crates', x: 16.5, z: -8, h: 2.4, layer: 2 },
      // layer 2 — the roadside, in rows receding from the camera
      { t: 'hero_fence', x: -8.6, z: -6, h: 1.5, layer: 2 },
      { t: 'hero_fence', x: -8.6, z: -12, h: 1.5, layer: 2 },
      { t: 'hero_fence', x: -8.6, z: -18, h: 1.5, layer: 2 },
      { t: 'prop_signpost', x: -6.5, z: -2, h: 3.2, layer: 2 },
      { t: 'prop_lantern', x: 5.2, z: -4, h: 3.6, layer: 2 },
      { t: 'hero_cart', x: 9.5, z: -6, h: 2.2, layer: 2 },
      { t: 'prop_stones', x: -2.2, z: 1.5, h: 0.9, layer: 2 },
      { t: 'grass_tuft_a', x: -5.4, z: -3, h: 0.8, layer: 2 },
      { t: 'grass_tuft_b', x: 5.6, z: -9, h: 0.9, layer: 2 },
      { t: 'grass_tuft_a', x: -5.8, z: -15, h: 0.8, layer: 2 },
      { t: 'rock_s', x: 7.4, z: 0, h: 0.7, layer: 2 },
      // layer 3 — occluder: an oversized darkened tree crown brushing the lens
      { t: 'hero_tree_a', x: -13, z: 9, h: 20, layer: 3, dim: 0.22, blur: 2.6 },
      { t: 'hero_tree_b', x: 12.5, z: 11, h: 9, layer: 3, dim: 0.26, blur: 2.6 },
      // wayside — the run out to the gate, thinning as it goes
      { t: 'grass_tuft_b', x: -4.6, z: -28, h: 0.8, layer: 2 },
      { t: 'rock_s', x: 4.8, z: -34, h: 0.7, layer: 2 },
      { t: 'grass_tuft_a', x: -5.0, z: -42, h: 0.8, layer: 2, dim: 0.95 },
      { t: 'rock_m', x: 5.4, z: -52, h: 1.2, layer: 2, dim: 0.9 },
      { t: 'grass_tuft_b', x: -5.2, z: -62, h: 0.8, layer: 2, dim: 0.85 },
      { t: 'rock_s', x: 5.0, z: -70, h: 0.7, layer: 2, dim: 0.8 },
    ],
    particles: [{ kind: 'leaf', n: 10, box: [-14, 2, -22, 14, 8, 4] }],
    // every stop now speaks from an object standing in the scene (signs.js)
    boards: [
      { key: 'village', kind: 'wood', x: 6.4, z: -18, h: 5.0, ry: -0.24 },
      { key: 'village_world', kind: 'wood', x: -6.4, z: -31, h: 4.8, ry: 0.24 },
    ],
  },
  {
    id: 'forest',
    fog: 0x3c5a34, fogNear: 40, fogFar: 148,
    sky: [0x6f93a6, 0x9fbcb0],
    ground: 'tile_grass', groundTint: 0x6b8f43,
    sprites: [
      { t: 'hill_dark', x: -13, y: -2, z: -78, h: 32, layer: 0, dim: 0.34 },
      { t: 'hill_dark', x: 13, y: -2, z: -78, h: 32, layer: 0, dim: 0.34 },
      { t: 'cloud_c', x: -18, y: 32, z: -90, h: 8, layer: 0, dim: 0.7, drift: 0.20, span: 110 },
      { t: 'biome_pine_a', x: -31, z: -44, h: 16, layer: 0, dim: 0.66 },
      { t: 'biome_pine_b', x: 27, z: -36, h: 14, layer: 0, dim: 0.72 },
      { t: 'biome_deadtree', x: -17, z: -50, h: 12, layer: 0, dim: 0.60 },
      { t: 'biome_pine_b', x: -17, z: -15, h: 12, layer: 1, sway: true },
      { t: 'biome_deadtree', x: 1.5, z: -20, h: 9, layer: 1, sway: true },
      { t: 'biome_pine_a', x: 11, z: -16, h: 13.5, layer: 1, sway: true },
      { t: 'rock_m', x: -8.5, z: -13, h: 1.9, layer: 2 },
      { t: 'fern', x: -5.2, z: -9, h: 1.2, layer: 2 },
      { t: 'mushrooms', x: -3.4, z: -4, h: 0.8, layer: 2 },
      { t: 'biome_stump', x: 1.2, z: -6, h: 1.9, layer: 2 },
      { t: 'fern', x: 4.6, z: -11, h: 1.1, layer: 2 },
      { t: 'mushrooms', x: 6.2, z: -3, h: 0.9, layer: 2 },
      { t: 'rock_s', x: 8.4, z: -17, h: 1.0, layer: 2 },
      { t: 'biome_pine_a', x: -11, z: 8, h: 22, layer: 3, dim: 0.20, blur: 2.6 },
      { t: 'biome_pine_b', x: 10.5, z: 10, h: 19, layer: 3, dim: 0.22, blur: 2.6 },
      { t: 'mushrooms', x: -4.6, z: -24, h: 0.8, layer: 2 },
      { t: 'rock_s', x: 4.8, z: -31, h: 0.9, layer: 2 },
      { t: 'fern', x: -5.0, z: -39, h: 1.0, layer: 2, dim: 0.95 },
      { t: 'rock_m', x: 5.2, z: -48, h: 1.3, layer: 2, dim: 0.9 },
      { t: 'mushrooms', x: -5.0, z: -58, h: 0.8, layer: 2, dim: 0.85 },
      { t: 'fern', x: 4.8, z: -68, h: 1.0, layer: 2, dim: 0.8 },
    ],
    particles: [{ kind: 'fly', n: 16, box: [-16, 0.5, -26, 16, 6, 6] }],
    boards: [{ key: 'forest', kind: 'wood', x: -6.6, z: -17, h: 4.8, ry: 0.24 }],
  },
  {
    id: 'mine',
    fog: 0x121826, fogNear: 26, fogFar: 130, dark: true,
    sky: [0x0d0b14, 0x1b1826],
    ground: 'tile_dirt', groundTint: 0x3d3a45,
    sprites: [
      { t: 'biome_orevein', x: -13, z: -44, h: 24, layer: 0, dim: 0.58 },
      { t: 'biome_orevein', x: 12, z: -40, h: 21, layer: 0, dim: 0.54 },
      { t: 'biome_orevein', x: -15, z: -15, h: 10, layer: 1 },
      { t: 'feat_mining', x: 3.5, z: -13, h: 5.2, layer: 1 },
      { t: 'biome_crystals', x: 15.5, z: -15, h: 7.2, layer: 1 },
      // beams spanning the tunnel — the camera flies under them
      { t: 'beam_frame', x: 0, y: 8.2, z: -9, h: 5.6, layer: 2 },
      { t: 'beam_frame', x: 0, y: 8.6, z: -25, h: 5.8, layer: 2, dim: 0.8 },
      { t: 'lantern_chain', x: -4.4, y: 5.0, z: -19, h: 2.4, layer: 2 },
      { t: 'lantern_chain', x: 4.8, y: 5.4, z: -31, h: 2.4, layer: 2, dim: 0.9 },
      { t: 'stalagmite_a', x: -7.2, z: -11, h: 2.6, layer: 2 },
      { t: 'stalagmite_b', x: -5.6, z: -7, h: 1.5, layer: 2 },
      { t: 'stalagmite_a', x: 7.8, z: -21, h: 2.4, layer: 2 },
      { t: 'stalagmite_b', x: 6.4, z: -8, h: 1.4, layer: 2 },
      { t: 'minecart', x: -5.8, z: -14, h: 1.9, layer: 2 },
      { t: 'feat_craft', x: 10.5, z: -33, h: 4.0, layer: 1 },
      { t: 'ore_pile', x: 5.4, z: -11, h: 1.1, layer: 2 },
      { t: 'ore_pile', x: -2.6, z: -24, h: 1.0, layer: 2, dim: 0.9 },
      { t: 'biome_brazier', x: -3.4, z: -5, h: 2.9, layer: 2 },
      { t: 'biome_crystals', x: 12, z: -3, h: 3.4, layer: 2 },
      { t: 'biome_orevein', x: -14, z: 9, h: 20, layer: 3, dim: 0.18, blur: 2.6 },
      { t: 'biome_orevein', x: 13, z: 11, h: 18, layer: 3, dim: 0.20, blur: 2.6 },
      { t: 'ore_pile', x: -4.6, z: -30, h: 0.9, layer: 2, dim: 0.95 },
      { t: 'stalagmite_b', x: 5.0, z: -38, h: 1.2, layer: 2, dim: 0.9 },
      { t: 'ore_pile', x: -5.2, z: -48, h: 0.9, layer: 2, dim: 0.85 },
      { t: 'stalagmite_a', x: 5.4, z: -58, h: 1.6, layer: 2, dim: 0.8 },
      { t: 'ore_pile', x: -4.8, z: -68, h: 0.8, layer: 2, dim: 0.75 },
    ],
    particles: [
      { kind: 'ember', n: 22, box: [-3.9, 2.4, -5.4, -2.9, 6.5, -4.6] },
      { kind: 'dust', n: 26, box: [-16, 0.4, -24, 16, 9, 6] },
    ],
    boards: [
      { key: 'mine_mining', kind: 'wood', x: -6.2, z: -13, h: 4.6, ry: 0.26 },
      { key: 'mine_pvp', kind: 'wood', x: 6.4, z: -23, h: 4.6, ry: -0.26 },
      { key: 'mine_craft', kind: 'wood', x: -6.4, z: -32, h: 4.6, ry: 0.26 },
    ],
  },
  {
    id: 'spirit',
    fog: 0x123437, fogNear: 30, fogFar: 145, dark: true,
    sky: [0x10222a, 0x21454a],
    ground: 'tile_spirit', groundTint: 0x3e6a63,
    sprites: [
      { t: 'biome_deadtree', x: -25, z: -50, h: 13, layer: 0, dim: 0.58 },
      { t: 'feat_death_alt', x: 24, z: -58, h: 11, layer: 0, dim: 0.56 },
      { t: 'feat_death_alt', x: -16.5, z: -17, h: 7.6, layer: 1 },
      { t: 'biome_deadtree', x: -1.5, z: -18, h: 9.5, layer: 1, sway: true },
      { t: 'feat_vendetta', x: 1.5, z: -14, h: 7.4, layer: 1 },
      { t: 'feat_death', x: 16, z: -19, h: 7.6, layer: 1 },
      // gravestones in two clusters, not a row
      { t: 'grave_a', x: -8.2, z: -11, h: 1.9, layer: 2 },
      { t: 'grave_b', x: -6.4, z: -8, h: 1.6, layer: 2 },
      { t: 'grave_c', x: -9.6, z: -7, h: 1.7, layer: 2, dim: 0.9 },
      { t: 'grave_a', x: -3.0, z: -20, h: 1.8, layer: 2, dim: 0.9 },
      { t: 'grave_b', x: -1.2, z: -23, h: 1.5, layer: 2, dim: 0.85 },
      { t: 'candles', x: -7.0, z: -5, h: 0.9, layer: 2 },
      { t: 'candles', x: 2.6, z: -17, h: 0.8, layer: 2 },
      { t: 'rock_l', x: 10.5, z: -9, h: 2.6, layer: 2, dim: 0.9 },
      { t: 'biome_brazier', x: 4.5, z: -5, h: 2.7, layer: 2 },
      { t: 'biome_deadtree', x: -12, z: 9, h: 21, layer: 3, dim: 0.18, blur: 2.6 },
      { t: 'grave_b', x: -4.8, z: -30, h: 1.3, layer: 2, dim: 0.95 },
      { t: 'candles', x: 4.6, z: -37, h: 0.7, layer: 2 },
      { t: 'grave_a', x: -5.2, z: -46, h: 1.4, layer: 2, dim: 0.9 },
      { t: 'grave_c', x: 5.0, z: -56, h: 1.3, layer: 2, dim: 0.85 },
      { t: 'grave_b', x: -4.8, z: -66, h: 1.2, layer: 2, dim: 0.8 },
    ],
    particles: [{ kind: 'soul', n: 8, box: [-15, 0.6, -26, 15, 8, 6] }],
    boards: [
      { key: 'spirit_vendetta', kind: 'stone', x: -6.2, z: -15, h: 4.8, ry: 0.24 },
      { key: 'spirit_death', kind: 'stone', x: 6.6, z: -24, h: 4.8, ry: -0.24 },
    ],
  },
  {
    id: 'home',
    fog: 0xe09a5e, fogNear: 48, fogFar: 200, dusk: true,
    sky: [0xe78b4a, 0xf4c98a],
    ground: 'tile_grass', groundTint: 0xa8cb53,
    road: 'tile_path',
    sprites: [
      // dusk: the moon is already up behind the warm haze
      { t: 'moon', x: 15, y: 31, z: -92, h: 5.5, layer: 0, nofog: true },
      { t: 'cloud_b', x: -20, y: 28, z: -84, h: 9, layer: 0, drift: 0.24, span: 110 },
      { t: 'cloud_a', x: 22, y: 33, z: -90, h: 8, layer: 0, dim: 0.9, drift: 0.18, span: 110 },
      { t: 'hero_tree_a', x: -31, z: -56, h: 14, layer: 0, dim: 0.70 },
      { t: 'biome_pine_b', x: 26, z: -46, h: 13, layer: 0, dim: 0.68 },
      { t: 'hero_house_b', x: -10, z: -16, h: 7.6, layer: 1 },
      { t: 'hero_tree_a', x: -1.5, z: -21, h: 8, layer: 1, sway: true },
      { t: 'hero_house_a', x: 14.5, z: -15, h: 8.4, layer: 1 },
      { t: 'prop_lantern', x: 1.4, z: -3, h: 3.6, layer: 2 },
      { t: 'chest', x: -3.6, z: -6, h: 1.4, layer: 2 },
      { t: 'hero_fence', x: -8.2, z: -10, h: 1.5, layer: 2 },
      { t: 'hero_fence', x: -8.2, z: -16, h: 1.5, layer: 2 },
      { t: 'haystack', x: 10.8, z: -5, h: 2.3, layer: 2 },
      { t: 'grass_tuft_b', x: -5.4, z: -3, h: 0.9, layer: 2 },
      { t: 'grass_tuft_a', x: 5.8, z: -13, h: 0.8, layer: 2 },
      { t: 'hero_tree_b', x: -12, z: 9, h: 10, layer: 3, dim: 0.24, blur: 2.6 },
      { t: 'grass_tuft_a', x: -4.8, z: -26, h: 0.8, layer: 2 },
      { t: 'rock_s', x: 5.0, z: -33, h: 0.7, layer: 2 },
      { t: 'grass_tuft_b', x: -5.2, z: -43, h: 0.8, layer: 2, dim: 0.95 },
      { t: 'rock_m', x: 5.4, z: -54, h: 1.2, layer: 2, dim: 0.9 },
    ],
    particles: [{ kind: 'leaf', n: 8, box: [-13, 2, -20, 13, 8, 4] }],
    boards: [
      { key: 'home_factions', kind: 'stone', x: -6.4, z: -4, h: 4.6, ry: 0.22 },
      { key: 'home', kind: 'wood', x: 6.2, z: -19, h: 5.0, ry: -0.24 },
    ],
    // the resource strip, as a market counter standing in the world
    counter: {
      stall: { t: 'feat_world', x: -8.6, z: -25, h: 6.0, layer: 1 },
      items: ['res_iron', 'res_gold', 'res_diamond', 'res_wood',
              'res_herbs', 'res_fish', 'res_sword', 'res_staff'],
      x0: -10.8, step: 0.62, y: 3.15, z: -24.2, h: 0.72,
    },
  },
];

/* The four transitions. `art` is the opening the camera flies through; the
   light quad sits inside it and floods the frame at the peak.

   `door` is where the leaves are, as a fraction of the art (x0, y0, x1, y1 from
   the top-left). Where it is given, the doorway swings open as the camera
   arrives: two leaves cut out of the art itself by texture offset — no extra
   texture — hinged at the jambs. The cave mouth and the portal have no leaves,
   so they simply glow. */
export const GATES = [
  { from: 'village', art: 'hero_house_b', h: 9, warm: 0xffbe6e,
    door: [0.408, 0.700, 0.575, 0.915] },
  { from: 'forest', art: 'biome_orevein', h: 12, warm: 0x9ad6ff },
  { from: 'mine', art: 'biome_portal', h: 10, warm: 0x78ffe8 },
  { from: 'spirit', art: 'feat_death', h: 9, warm: 0xffd696,
    door: [0.400, 0.185, 0.617, 0.495] },
];
