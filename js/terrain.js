// Ground mesh for the plain plus the distant mountain ring.
// The ground shader blends six painted layers (meadow soil, dirt path, leaf litter, rock,
// wheat stubble, the mossy floor of the deep wood) from the baked zone maps, adds puddles that mirror
// the sky, and snow.
import * as THREE from 'three';
import { H, HALF, HRES, GLSL_WORLD } from './world.js';
import { GLSL_NOISE, ridge, fbm, smoothstep } from './util.js';

const GLSL_TRAIL = /* glsl */`
uniform sampler2D uTrample; uniform vec4 uTrampleRect;
uniform sampler2D uBurn; uniform float uBurnSize;
vec4 trailAt(vec2 p){ vec2 uv = (p - uTrampleRect.xy) * uTrampleRect.w; if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0); return texture(uTrample, uv); }
`;

// extra: uniforms filled in later (the trample map is created after the terrain)
export function buildTerrain(tex, ground, extra = {}) {
  const n = HRES, pos = new Float32Array(n * n * 3), nrm = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    pos[k * 3] = i - HALF; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = j - HALF;
    const hl = H[j * n + Math.max(0, i - 1)], hr = H[j * n + Math.min(n - 1, i + 1)];
    const hd = H[Math.max(0, j - 1) * n + i], hu = H[Math.min(n - 1, j + 1) * n + i];
    const nx = hl - hr, nz = hd - hu, ny = 2, l = Math.hypot(nx, ny, nz);
    nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    // split along b-c so it matches groundY()
    idx[o++] = a; idx[o++] = c; idx[o++] = b;
    idx[o++] = d; idx[o++] = b; idx[o++] = c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const U = {
    uHeightTex: { value: tex.height }, uZoneTex: { value: tex.zone }, uPathTex: { value: tex.path }, uZone2Tex: { value: tex.zone2 },
    uAlb: { value: ground.albedo }, uNrm: { value: ground.normal },
  };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U, extra);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normal;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWN; uniform highp sampler2DArray uAlb; uniform highp sampler2DArray uNrm;
        ${GLSL_WORLD} ${GLSL_NOISE} ${GLSL_TRAIL}
        vec4 gW; float gPuddle; float gSnow; vec3 gNrm; float gRough;
        // two scales, blended with noise, to hide tiling
        vec4 layer(sampler2DArray t, float l, vec2 p, float s, float blend){
          vec4 a = texture(t, vec3(p / s, l));
          vec4 b = texture(t, vec3(mat2(0.8, -0.6, 0.6, 0.8) * p / (s * 2.7), l));
          return mix(a, b, blend);
        }`)
      .replace('#include <map_fragment>', `
        vec2 wp = vWPos.xz;
        vec4 zn = worldZone(wp), pt = worldPath(wp), z2 = worldZone2(wp);
        float path = pt.r, dry = pt.a;
        float blend = smoothstep(0.3, 0.7, nNoise(wp * 0.07));
        // mountains: rock on steep ground, snow up high
        float hgt = vWPos.y;
        float highSnow = smoothstep(46.0, 58.0, hgt + nNoise(wp * 0.05) * 10.0) * 0.8;
        float rockW = smoothstep(0.22, 0.42, 1.0 - normalize(vWN).y);
        rockW = max(rockW, smoothstep(12.0, 30.0, hgt) * 0.8);
        // the canopy opens over a glade and a little meadow grows in the light
        float wGrass = (zn.r + z2.g * 0.5) * (1.0 - path), wWheat = zn.g * (1.0 - path), wLeaf = zn.b * (1.0 - path);
        float wForest = z2.r * (1.0 - z2.g * 0.5) * (1.0 - path);
        float wDirt = path;
        float snow = max(zn.a, highSnow);
        vec4 W0 = vec4(wGrass, wDirt, wLeaf, rockW); float W4 = wWheat;
        float W5 = wForest;
        W0.xyz *= (1.0 - rockW); W4 *= (1.0 - rockW); W5 *= (1.0 - rockW);
        float sum = W0.x + W0.y + W0.z + W0.w + W4 + W5 + 1e-4;
        W0 /= sum; W4 /= sum; W5 /= sum;
        vec3 alb = vec3(0.0); vec3 tn = vec3(0.0);
        if (W0.x > 0.01) { alb += layer(uAlb, 0.0, wp, 3.0, blend).rgb * W0.x; tn += (layer(uNrm, 0.0, wp, 3.0, blend).rgb * 2.0 - 1.0) * W0.x; }
        if (W0.y > 0.01) { alb += layer(uAlb, 1.0, wp, 4.0, blend).rgb * W0.y; tn += (layer(uNrm, 1.0, wp, 4.0, blend).rgb * 2.0 - 1.0) * W0.y; }
        if (W0.z > 0.01) { alb += layer(uAlb, 2.0, wp, 2.6, blend).rgb * W0.z; tn += (layer(uNrm, 2.0, wp, 2.6, blend).rgb * 2.0 - 1.0) * W0.z; }
        if (W0.w > 0.01) { alb += layer(uAlb, 3.0, wp, 7.0, blend).rgb * W0.w; tn += (layer(uNrm, 3.0, wp, 7.0, blend).rgb * 2.0 - 1.0) * W0.w; }
        if (W4 > 0.01)   { alb += layer(uAlb, 4.0, wp, 3.0, blend).rgb * W4;   tn += (layer(uNrm, 4.0, wp, 3.0, blend).rgb * 2.0 - 1.0) * W4; }
        if (W5 > 0.01)   { alb += layer(uAlb, 5.0, wp, 2.4, blend).rgb * W5;   tn += (layer(uNrm, 5.0, wp, 2.4, blend).rgb * 2.0 - 1.0) * W5; }
        // moss, thick in the hollows of the wood and over the older ground
        float mossN = nNoise(wp * 0.35) * 0.6 + nNoise(wp * 2.1) * 0.4;
        alb = mix(alb, vec3(0.075, 0.17, 0.045) * (0.75 + 0.6 * nNoise(wp * 5.0)), clamp((0.25 + z2.a) * W5 * (0.3 + 0.9 * mossN), 0.0, 1.0) * 0.75);
        // a path kicked through the leaf litter shows the damp soil underneath for a while
        vec4 tr = trailAt(wp);
        float kicked = clamp(max(tr.b * 0.55, tr.a) * 1.3, 0.0, 1.0) * (W0.z + W5 * 0.7) * smoothstep(0.25, 0.75, nNoise(wp * 5.0) * 0.6 + 0.55);
        alb = mix(alb, vec3(0.085, 0.066, 0.05) * (0.8 + 0.4 * nNoise(wp * 11.0)), kicked * 0.75);
        // ground scorched by lightning: charred black in a ragged patch, whatever grew or lay there
        float bn = texture(uBurn, fract(wp / uBurnSize)).r;
        float burnt = smoothstep(0.05, 0.45, bn * 1.2 + (nNoise(wp * 2.3) - 0.5) * 0.45) * (W0.x * 0.8 + W0.y * 0.55 + W0.z * 0.95 + W4 * 0.8 + W5 * 0.95);
        alb = mix(alb, vec3(0.024, 0.02, 0.018) * (0.7 + 0.6 * nNoise(wp * 9.0)), clamp(burnt, 0.0, 1.0) * 0.93);
        // big, soft colour drifts so the meadow isn't one flat green
        float macro = nFbm(wp * 0.02);
        alb *= mix(0.82, 1.12, macro);
        alb = mix(alb, alb * vec3(1.18, 1.08, 0.72), dry * 0.55 * W0.x);
        // wet ground around puddles
        float puddle = pt.g;
        float wet = smoothstep(0.0, 0.5, puddle + path * 0.25 * nNoise(wp * 0.4));
        alb *= mix(1.0, 0.55, wet);
        float pd = smoothstep(0.35, 0.55, puddle);
        alb = mix(alb, vec3(0.05, 0.045, 0.04), pd);
        // snow on the ground (the deformable snow surface sits on top of this)
        float sn = smoothstep(0.15, 0.6, snow + (nNoise(wp * 0.9) - 0.5) * 0.3);
        alb = mix(alb, vec3(0.86, 0.9, 0.96), sn);
        tn = mix(tn, vec3(0.0, 0.0, 1.0), max(pd, sn * 0.7));
        gNrm = normalize(tn + vec3(0.0, 0.0, 1.0));
        gRough = mix(mix(0.92, 0.7, wet), 0.04, pd);
        gRough = mix(gRough, 0.62, sn);
        diffuseColor.rgb *= alb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `
        {
          // tangent-space detail -> world (terrain uv follows world xz) -> view space
          vec3 N = normalize(vNormal);
          vec3 wN = normalize((vec4(N, 0.0) * viewMatrix).xyz);
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - wN * wN.x);
          vec3 B = normalize(cross(T, wN));
          vec3 wn = normalize(T * gNrm.x * 0.9 + B * -gNrm.y * 0.9 + wN * gNrm.z);
          // puddles: tiny ripples
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// distant ring: hills, a dominant volcano in the north (a nod to Yotei) and ridges beyond
export function buildMountains() {
  const rings = 90, segs = 256;
  const pos = [], col = [];
  const volcano = new THREE.Vector2(-260, -980);
  const hAt = (x, z) => {
    const r = Math.hypot(x, z);
    let h = smoothstep(180, 900, r) * (35 + 120 * ridge(x * 0.0022, z * 0.0022, 5));
    h += smoothstep(900, 2200, r) * 160 * ridge(x * 0.001 + 3, z * 0.001, 4);
    const dv = Math.hypot(x - volcano.x, z - volcano.y);
    h = Math.max(h, 620 * Math.pow(Math.max(0, 1 - dv / 900), 1.6) - Math.max(0, 40 - dv * 0.4) + fbm(x * 0.01, z * 0.01, 3) * 20);
    return h - 3;
  };
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, r = 170 + Math.pow(t, 1.6) * 2600;
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, hAt(x, z), z);
    }
  }
  const idx = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normal;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWN; ${GLSL_NOISE}`)
      .replace('#include <map_fragment>', `
        float h = vWPos.y, sl = 1.0 - normalize(vWN).y;
        float n = nFbm(vWPos.xz * 0.01);
        vec3 forest = mix(vec3(0.07, 0.09, 0.05), vec3(0.16, 0.13, 0.08), n);
        vec3 rock = mix(vec3(0.22, 0.21, 0.2), vec3(0.34, 0.32, 0.3), n);
        vec3 c = mix(forest, rock, smoothstep(0.35, 0.6, sl + (h - 140.0) * 0.002));
        float snowLine = 300.0 + n * 140.0;
        c = mix(c, vec3(0.72, 0.75, 0.8), smoothstep(snowLine, snowLine + 60.0, h) * smoothstep(0.8, 0.35, sl));
        diffuseColor.rgb *= c;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
