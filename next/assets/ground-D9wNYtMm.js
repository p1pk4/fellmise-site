const n=`
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
`;function i(a,e){const t=new a.MeshBasicMaterial({map:e.groundMap,fog:!0,vertexColors:!0,transparent:!0,depthWrite:!1});t.color.setHex(16777215);const o={uRoad:{value:e.roadMap||e.groundMap},uHasRoad:{value:e.roadMap?1:0},uTint:{value:new a.Color(e.tint)},uRoadTint:{value:new a.Color(e.roadTint||14470058)},uTile:{value:new a.Vector3(6,9.5,34)},uRoadTile:{value:new a.Vector3(4,6.5,22)},uHalf:{value:e.halfWidth},uCam:{value:new a.Vector3}};return t.userData.uniforms=o,t.onBeforeCompile=r=>{Object.assign(r.uniforms,o),r.vertexShader=r.vertexShader.replace("#include <common>",`#include <common>
varying vec3 vWorld;`).replace("#include <project_vertex>",`vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#include <project_vertex>`),r.fragmentShader=r.fragmentShader.replace("#include <common>",`#include <common>
        varying vec3 vWorld;
        uniform sampler2D uRoad;
        uniform int uHasRoad;
        uniform vec3 uTint, uRoadTint, uTile, uRoadTile, uCam;
        uniform float uHalf;
        ${n}

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
        }`).replace("#include <map_fragment>",`
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
        diffuseColor.rgb = col;`)},t.customProgramCacheKey=()=>`ground${e.roadMap?1:0}`,t}export{i as makeGroundMaterial};
