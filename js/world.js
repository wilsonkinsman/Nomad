// The plain itself: heights, the four ground zones (grass, wheat, leaves, snow), the dirt paths,
// puddles and snow depth. Everything is baked once into typed arrays so the CPU (physics,
// footsteps, placement) and the GPU (terrain, grass, wheat shaders) read exactly the same data.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, fbm, ridge, vnoise, smoothPath } from './util.js';

export const HALF = 200;            // baked area is [-HALF, HALF] on x and z
export const HRES = 401;            // height samples (1 m spacing)
export const ZRES = 512;            // zone texture resolution
export const PLAY_RADIUS = 138;     // soft wall

// where the sun comes up: east, a little north (−z is north)
export const SUN_AZ = new THREE.Vector2(0.92, -0.39).normalize();

export const ZONES = {
  wheat:  { cx: 52,  cz: -38, rx: 42, rz: 31, rot: 0.25 },
  leaves: { cx: -50, cz: -40, rx: 38, rz: 34, rot: -0.3 },
  snow:   { cx: -46, cz: 58,  rx: 46, rz: 40, rot: 0.4 },
};

// the abandoned shrine in the hollow: a raised clearing, level out to `terrace` metres from its middle, then
// `slope` metres of bank down to the hollow; its front, `face` (a heading: sin, cos), looks down a flight of
// stone steps to a side trail
export const SHRINE = { x: -63, z: -47, face: 1.645, terrace: 13, slope: 4.5, lift: 1.6 };
const shrineFront = (d) => [SHRINE.x + Math.sin(SHRINE.face) * d, SHRINE.z + Math.cos(SHRINE.face) * d];

// a path may be narrower (`width`) or fainter (`wear`) than the roads
const trail = (pts, width, wear) => Object.assign(smoothPath(pts, 10), { width, wear });
export const PATHS = [
  smoothPath([[-160, 36], [-110, 27], [-66, 17], [-30, 11], [0, 5], [30, -1], [62, -2], [96, -10], [160, -20]], 10),
  smoothPath([[0, 5], [-7, -14], [-22, -33], [-38, -52], [-50, -78], [-58, -112]], 10),
  smoothPath([[-30, 11], [-34, 28], [-41, 46], [-49, 66], [-58, 92], [-66, 124]], 10),
  // the old way to the shrine, half lost under the leaves
  trail([[-34.2, -46.8], [-39.5, -47.4], shrineFront(SHRINE.terrace + SHRINE.slope + 0.5)], 0.6, 0.75),
];

export const SPAWN = { x: -24, z: 10.5 };

function ellipseE(z, x, zz) {
  const dx = x - z.cx, dz = zz - z.cz;
  const c = Math.cos(z.rot), s = Math.sin(z.rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.hypot(lx / z.rx, lz / z.rz);
}

function zoneWeight(z, x, zz, seed) {
  const warp = (fbm(x * 0.035 + seed, zz * 0.035 - seed, 3) - 0.5) * 0.42;
  return 1 - smoothstep(0.82, 1.06, ellipseE(z, x, zz) + warp);
}

function naturalHeight(x, z) {
  let low = (fbm(x * 0.011 + 3.1, z * 0.011 - 7.7, 4) - 0.5) * 7.0;
  let h = low + (fbm(x * 0.045, z * 0.045, 3) - 0.5) * 1.1;
  // snow sits on a broad rise that keeps climbing toward the south-west
  const se = ellipseE(ZONES.snow, x, z);
  const rise = smoothstep(1.5, 0.2, se);
  h += rise * 4.2 + Math.max(0, (-(x + 46) * 0.4 + (z - 58) * 0.6)) * 0.07 * rise;
  low += rise * 4.2;
  // wheat field is flatter, farmed land
  const we = smoothstep(1.2, 0.6, ellipseE(ZONES.wheat, x, z));
  h = lerp(h, low * 0.6 + 0.2, we * 0.7);
  low = lerp(low, low * 0.6 + 0.2, we * 0.7);
  // hills and mountains ring the plain
  const r = Math.hypot(x, z);
  const rim = smoothstep(128, 205, r);
  const rimH = rim * rim * (26 + 44 * ridge(x * 0.012 + 5, z * 0.012 - 2, 4));
  return { h: h + rimH, low: low + rimH };
}

let terraceY = null;
function rawHeight(x, z) {
  const r = naturalHeight(x, z);
  // the shrine's clearing is levelled and raised a little above the hollow, and banks down on every side
  const ds = Math.hypot(x - SHRINE.x, z - SHRINE.z), edge = SHRINE.terrace + SHRINE.slope;
  if (ds < edge) {
    if (terraceY === null) terraceY = naturalHeight(SHRINE.x, SHRINE.z).h + SHRINE.lift;
    const k = smoothstep(edge, SHRINE.terrace, ds);
    r.h = lerp(r.h, terraceY, k); r.low = lerp(r.low, terraceY, k);
  }
  return r;
}

// ------------------------------------------------------------------------------ baking

export const H = new Float32Array(HRES * HRES);
export const Z = new Uint8Array(ZRES * ZRES * 4);   // grass, wheat, leaves, snow
export const P = new Uint8Array(ZRES * ZRES * 4);   // path, puddle, snow depth, dryness
let pathField = null;                                // float distance-ish mask at ZRES

function bakePathField() {
  pathField = new Float32Array(ZRES * ZRES);
  const texel = (HALF * 2) / ZRES;
  for (const pts of PATHS) {
    const W = pts.width ?? 1, wear = pts.wear ?? 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const pad = 5;
      const x0 = Math.floor((Math.min(ax, bx) - pad + HALF) / texel), x1 = Math.ceil((Math.max(ax, bx) + pad + HALF) / texel);
      const z0 = Math.floor((Math.min(az, bz) - pad + HALF) / texel), z1 = Math.ceil((Math.max(az, bz) + pad + HALF) / texel);
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      for (let tz = Math.max(0, z0); tz <= Math.min(ZRES - 1, z1); tz++) {
        for (let tx = Math.max(0, x0); tx <= Math.min(ZRES - 1, x1); tx++) {
          const px = (tx + 0.5) * texel - HALF, pz = (tz + 0.5) * texel - HALF;
          const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
          const d = Math.hypot(ax + dx * t - px, az + dz * t - pz);
          const hw = (1.15 + (vnoise(px * 0.15, pz * 0.15) - 0.5) * 0.7) * W;
          const m = (1 - smoothstep(hw, hw + 1.3 * W, d)) * wear;
          const k = tz * ZRES + tx;
          if (m > pathField[k]) pathField[k] = m;
        }
      }
    }
  }
}

function pathFieldAt(x, z) {
  const texel = (HALF * 2) / ZRES;
  const fx = clamp((x + HALF) / texel - 0.5, 0, ZRES - 1.001), fz = clamp((z + HALF) / texel - 0.5, 0, ZRES - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const a = pathField[iz * ZRES + ix], b = pathField[iz * ZRES + ix + 1];
  const c = pathField[(iz + 1) * ZRES + ix], d = pathField[(iz + 1) * ZRES + ix + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function zonesRaw(x, z) {
  const wheat = zoneWeight(ZONES.wheat, x, z, 11.3);
  const leaves = zoneWeight(ZONES.leaves, x, z, 4.7);
  const snowZ = zoneWeight(ZONES.snow, x, z, 8.9);
  // snow gets patchy at its edge: drifts linger in hollows
  const patch = fbm(x * 0.08 + 2, z * 0.08 - 5, 3);
  const snow = clamp(snowZ * 1.35 - (1 - snowZ) * 0.2 + (patch - 0.5) * 0.9 * (1 - snowZ) * snowZ * 4, 0, 1);
  let path = pathFieldAt(x, z) * (1 - smoothstep(0.35, 0.75, snow));
  const other = Math.max(wheat, leaves, snow);
  const grass = clamp(1 - other, 0, 1);
  const puddle = path > 0.55 ? smoothstep(0.6, 0.72, fbm(x * 0.21 + 9, z * 0.21 - 3, 3)) * smoothstep(0.55, 0.9, path) : 0;
  const snowDepth = smoothstep(0.25, 0.85, snow) * (0.36 + 0.14 * fbm(x * 0.05, z * 0.05, 2));
  const dry = fbm(x * 0.03 - 4, z * 0.03 + 8, 3);
  return { grass, wheat, leaves, snow, path, puddle, snowDepth, dry };
}

export function bake(onProgress) {
  bakePathField();
  for (let j = 0; j < HRES; j++) {
    for (let i = 0; i < HRES; i++) {
      const x = i - HALF, z = j - HALF;
      const { h, low } = rawHeight(x, z);
      const p = pathFieldAt(x, z);
      // paths are worn a little into the ground and follow the smoother landform
      H[j * HRES + i] = lerp(h, low, p * 0.85) - 0.13 * p;
    }
  }
  onProgress?.(0.5);
  const texel = (HALF * 2) / ZRES;
  for (let j = 0; j < ZRES; j++) {
    for (let i = 0; i < ZRES; i++) {
      const x = (i + 0.5) * texel - HALF, z = (j + 0.5) * texel - HALF;
      const r = zonesRaw(x, z), k = (j * ZRES + i) * 4;
      Z[k] = r.grass * 255; Z[k + 1] = r.wheat * 255; Z[k + 2] = r.leaves * 255; Z[k + 3] = r.snow * 255;
      P[k] = r.path * 255; P[k + 1] = r.puddle * 255; P[k + 2] = clamp(r.snowDepth / 0.5, 0, 1) * 255; P[k + 3] = r.dry * 255;
    }
  }
  onProgress?.(1);
}

// ------------------------------------------------------------------------------ sampling

export function groundY(x, z) {
  const fx = clamp(x + HALF, 0, HRES - 1.001), fz = clamp(z + HALF, 0, HRES - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const k = iz * HRES + ix;
  // same split as the mesh triangles, so feet sit exactly on the rendered surface
  if (tx + tz <= 1) return H[k] + (H[k + 1] - H[k]) * tx + (H[k + HRES] - H[k]) * tz;
  return H[k + HRES + 1] + (H[k + HRES] - H[k + HRES + 1]) * (1 - tx) + (H[k + 1] - H[k + HRES + 1]) * (1 - tz);
}

export function groundNormal(x, z, out = new THREE.Vector3()) {
  const e = 0.5;
  return out.set(groundY(x - e, z) - groundY(x + e, z), 2 * e, groundY(x, z - e) - groundY(x, z + e)).normalize();
}

function sample4(arr, x, z, out) {
  const texel = (HALF * 2) / ZRES;
  const fx = clamp((x + HALF) / texel - 0.5, 0, ZRES - 1.001), fz = clamp((z + HALF) / texel - 0.5, 0, ZRES - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const k00 = (iz * ZRES + ix) * 4, k10 = k00 + 4, k01 = k00 + ZRES * 4, k11 = k01 + 4;
  for (let c = 0; c < 4; c++) {
    out[c] = lerp(lerp(arr[k00 + c], arr[k10 + c], tx), lerp(arr[k01 + c], arr[k11 + c], tx), tz) / 255;
  }
  return out;
}

const _z = [0, 0, 0, 0], _p = [0, 0, 0, 0];
export function surfaceAt(x, z, out = {}) {
  sample4(Z, x, z, _z); sample4(P, x, z, _p);
  out.grass = _z[0]; out.wheat = _z[1]; out.leaves = _z[2]; out.snow = _z[3];
  out.path = _p[0]; out.puddle = _p[1]; out.snowDepth = _p[2] * 0.5; out.dry = _p[3];
  let best = 'grass', bw = out.grass * (1 - out.path);
  if (out.path > 0.5 && out.snow < 0.4) { best = out.puddle > 0.4 ? 'puddle' : 'dirt'; bw = 2; }
  if (out.wheat > bw) { best = 'wheat'; bw = out.wheat; }
  if (out.leaves > bw) { best = 'leaves'; bw = out.leaves; }
  if (out.snow > Math.max(0.35, bw * 0.8)) { best = 'snow'; }
  out.kind = best;
  return out;
}

// ------------------------------------------------------------------------------ GPU textures

export function makeTextures() {
  const height = new THREE.DataTexture(H, HRES, HRES, THREE.RedFormat, THREE.FloatType);
  height.minFilter = height.magFilter = THREE.NearestFilter;
  height.needsUpdate = true;
  const zone = new THREE.DataTexture(Z, ZRES, ZRES, THREE.RGBAFormat, THREE.UnsignedByteType);
  zone.minFilter = zone.magFilter = THREE.LinearFilter;
  zone.needsUpdate = true;
  const path = new THREE.DataTexture(P, ZRES, ZRES, THREE.RGBAFormat, THREE.UnsignedByteType);
  path.minFilter = path.magFilter = THREE.LinearFilter;
  path.needsUpdate = true;
  return { height, zone, path };
}

// GLSL to read the same data (world xz -> uv)
export const GLSL_WORLD = /* glsl */`
uniform sampler2D uHeightTex; uniform sampler2D uZoneTex; uniform sampler2D uPathTex;
float worldHeight(vec2 p){
  vec2 f = clamp(p + ${HALF.toFixed(1)}, vec2(0.0), vec2(${(HRES - 1.001).toFixed(3)}));
  ivec2 i = ivec2(floor(f)); vec2 t = f - vec2(i);
  float a = texelFetch(uHeightTex, i, 0).r, b = texelFetch(uHeightTex, i + ivec2(1,0), 0).r;
  float c = texelFetch(uHeightTex, i + ivec2(0,1), 0).r, d = texelFetch(uHeightTex, i + ivec2(1,1), 0).r;
  return (t.x + t.y <= 1.0) ? a + (b - a) * t.x + (c - a) * t.y : d + (c - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
}
vec2 worldUV(vec2 p){ return (p + ${HALF.toFixed(1)}) / ${(HALF * 2).toFixed(1)}; }
vec4 worldZone(vec2 p){ return texture(uZoneTex, worldUV(p)); }
vec4 worldPath(vec2 p){ return texture(uPathTex, worldUV(p)); }
`;
