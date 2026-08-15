/* Biome settings — atmosphere, floor, weather. One entry per biome, in scroll
 * order along -Z.
 *
 * WHERE THINGS STAND IS NOT HERE. Placement lives in assets/layout.json and is
 * edited with ?editor=1; this file holds only what a person does not drag with
 * a mouse. Seeded once from this file by tools/dump_layout.mjs.
 *
 * Original notes on the diorama, kept because they explain the numbers below:
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
    fog: 0xd9c79a, fogNear: 58, fogFar: 150,
    sky: [0x7eb8e0, 0xc7e6f2],
    ground: 'tile_grass', groundTint: 0xa8cb53,
    road: 'tile_path',
    tod: true,                          // only this biome follows the visitor's clock
    particles: [{ kind: 'leaf', n: 10, box: [-14, 2, -22, 14, 8, 4] }],
  },
  {
    id: 'forest',
    fog: 0x3c5a34, fogNear: 44, fogFar: 132,
    sky: [0x6f93a6, 0x9fbcb0],
    ground: 'tile_grass', groundTint: 0x6b8f43,
    particles: [{ kind: 'fly', n: 16, box: [-16, 0.5, -26, 16, 6, 6] }],
  },
  {
    id: 'mine',
    fog: 0x121826, fogNear: 30, fogFar: 118, dark: true,
    sky: [0x0d0b14, 0x1b1826],
    ground: 'tile_dirt', groundTint: 0x3d3a45,
    particles: [
      { kind: 'ember', n: 22, box: [-3.9, 2.4, -5.4, -2.9, 6.5, -4.6] },
      { kind: 'dust', n: 26, box: [-16, 0.4, -24, 16, 9, 6] },
    ],
  },
  {
    id: 'spirit',
    fog: 0x123437, fogNear: 34, fogFar: 128, dark: true,
    sky: [0x10222a, 0x21454a],
    ground: 'tile_spirit', groundTint: 0x3e6a63,
    particles: [{ kind: 'soul', n: 8, box: [-15, 0.6, -26, 15, 8, 6] }],
  },
  {
    id: 'home',
    fog: 0xe09a5e, fogNear: 54, fogFar: 148, dusk: true,
    sky: [0xe78b4a, 0xf4c98a],
    ground: 'tile_grass', groundTint: 0xa8cb53,
    road: 'tile_path',
    particles: [{ kind: 'leaf', n: 8, box: [-13, 2, -20, 13, 8, 4] }],
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
