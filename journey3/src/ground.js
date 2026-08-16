/* The floor: one material for grass and road together.
 *
 * What it replaces, and why each part exists:
 *
 *  UV from world coordinates, not from the plane.
 *      `repeat` on a texture is in plane-space, so a 170x190 plane and a 11x190
 *      plane with the same repeat get different tile sizes, and changing a
 *      plane's length silently restretched its ground. Here the UV is
 *      worldPos.xz divided by a tile size in METRES, so a tile is the same size
 *      everywhere and stays that size whatever the geometry does.
 *
 *  Three samples at different scales and angles, mixed by noise.
 *      One tile repeated is a grid, and the eye finds a grid in about a second.
 *      A second sample at a different scale and rotation, blended along a noise
 *      boundary, breaks the period without needing a second texture.
 *
 *  A third, much larger sample that fades in with distance.
 *      Far away the small tile is below a pixel and mips average it to mush.
 *      The large sample carries the far field, where its own repeat is too big
 *      to notice.
 *
 *  The road is drawn INTO the floor rather than laid on top of it.
 *      A separate road plane can only have the straight edge of its geometry.
 *      As a mask inside the floor, the edge is a noise-perturbed threshold, so
 *      grass runs into the dirt in ragged tongues, which is what a path that
 *      people walk actually looks like.
 *
 * Implemented through onBeforeCompile on MeshBasicMaterial rather than a
 * ShaderMaterial, so three's own fog and vertex-colour chunks keep working —
 * the floor still fades to the sky and still crossfades between biomes.
 */

const NOISE = `
  // value noise: hash per lattice point, smoothstep between. Cheap, and enough
  // to break a tiling pattern — this is not terrain, it is a mixing mask.
  float h21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x),
               mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    return vnoise(p) * 0.6 + vnoise(p * 2.3 + 17.0) * 0.3 + vnoise(p * 5.1) * 0.1;
  }
  vec2 rot(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }
`;

/**
 * @param {object} THREE
 * @param {object} o
 *   groundMap, roadMap  textures (roadMap may be null for a biome with no path)
 *   tint                base colour of the ground
 *   roadTint            base colour of the path
 *   halfWidth           metres from the centre to the middle of the verge
 */
export function makeGroundMaterial(THREE, o) {
  const mat = new THREE.MeshBasicMaterial({
    map: o.groundMap, fog: true, vertexColors: true,
    transparent: true, depthWrite: false,
  });
  mat.color.setHex(0xffffff);   // tinting happens in the shader, per layer

  const u = {
    uRoad: { value: o.roadMap || o.groundMap },
    uHasRoad: { value: o.roadMap ? 1 : 0 },
    uTint: { value: new THREE.Color(o.tint) },
    uRoadTint: { value: new THREE.Color(o.roadTint || 0xdccbaa) },
    // tile sizes in METRES: near, the rotated second layer, and the far one
    uTile: { value: new THREE.Vector3(6.0, 9.5, 34.0) },
    uRoadTile: { value: new THREE.Vector3(4.0, 6.5, 22.0) },
    uHalf: { value: o.halfWidth },
    uCam: { value: new THREE.Vector3() },
  };
  mat.userData.uniforms = u;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <project_vertex>',
        'vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorld;
        uniform sampler2D uRoad;
        uniform int uHasRoad;
        uniform vec3 uTint, uRoadTint, uTile, uRoadTile, uCam;
        uniform float uHalf;
        ${NOISE}

        // Three samples of one texture: near, a rotated second scale, and a big
        // one for the distance. Mixed by noise, then by camera distance.
        vec3 layered(sampler2D t, vec2 w, vec3 tile, float d) {
          vec3 a = texture2D(t, w / tile.x).rgb;
          vec3 b = texture2D(t, rot(w, 0.9) / tile.y).rgb;
          vec3 c = texture2D(t, rot(w, -0.4) / tile.z).rgb;
          float n = smoothstep(0.35, 0.65, fbm(w * 0.06));
          vec3 near = mix(a, b, n);
          // the far mix starts where the near tile stops resolving
          float far = smoothstep(45.0, 130.0, d);
          return mix(near, c, far);
        }`)
      .replace('#include <map_fragment>', `
        vec2 w = vWorld.xz;
        float dist = length(vWorld - uCam);
        vec3 grass = layered(map, w, uTile, dist) * uTint;
        vec3 col = grass;
        if (uHasRoad == 1) {
          vec3 road = layered(uRoad, w, uRoadTile, dist) * uRoadTint;
          // The edge is a threshold on |x| pushed around by noise, so the verge
          // is torn rather than ruled. Two frequencies: a slow wander for the
          // shape of the path, a fast one for the grass tufts biting into it.
          float edge = uHalf
                     + (fbm(vec2(w.y * 0.035, 0.0)) - 0.5) * 2.2
                     + (fbm(vec2(w.y * 0.31, w.x * 0.12)) - 0.5) * 1.1;
          float m = 1.0 - smoothstep(edge - 0.9, edge + 0.9, abs(w.x));
          col = mix(grass, road, m);
        }
        diffuseColor.rgb *= col / max(diffuseColor.rgb, vec3(0.0001));
        diffuseColor.rgb = col;`);
  };
  mat.customProgramCacheKey = () => `ground${o.roadMap ? 1 : 0}`;
  return mat;
}

/** The camera has to reach the shader for the distance blend. */
export function updateGroundCamera(state) {
  for (const m of state.groundMats || []) {
    m.userData.uniforms.uCam.value.copy(state.camera.position);
  }
}
