// Brackenford: a market village on the level ground south of the road, east of the crossroads. Whitewashed stone
// houses and timbered upper floors under orange tile roofs stand round a cobbled square with a well in the middle;
// a lane runs up to the road and alleys out the other three ways. There is an inn (the Green Frog), a smithy with
// an open forge, a bakery and a merchant's, market stalls under striped awnings, tables of pottery, benches,
// barrels and crates, a hay cart, flowers at the windows, bunting across the square, smoke from the chimneys, and
// at night lit windows and lanterns. Everything is built here from parts (buildings.js) and painted textures
// (villagetex.js), and merged by material into a few meshes. The villagers who live here are in villagers.js; this
// gives them their streets (a graph of places to walk between), their doors and the spots where they stop.
import * as THREE from 'three';
import { groundY, VILLAGE, setPaving, P as PATH, ZRES, HALF, H, HRES } from './world.js';
import { Builder } from './buildings.js';
import { stoneWall, plaster, roofTiles, cobbles, doorTex, windowTex, stripes, signTex } from './villagetex.js';
import { boxCollider, inside } from './collide.js';
import { mulberry32, smoothstep, vnoise, GLSL_NOISE } from './util.js';

const PI = Math.PI;
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// the houses (rot is the way the front faces: 0 south, PI north, PI/2 east, -PI/2 west), each with what it is
export const HOUSES = [
  { name: 'inn', x: 39, z: 7.5, rot: 0, w: 12, d: 8, floors: 2, upper: 'timber', dormers: 3, chimneys: [[-4.3, -1.4], [3.9, 1.2]], door: -1.6, seed: 1, flowers: 0.7, sign: ['inn', 'The Green Frog', 3.4] },
  { name: 'smithy', x: 56, z: 7.8, rot: 0, w: 10, d: 7.6, floors: 1, pitch: 0.72, chimneys: [[3.4, -1.2]], door: -2.4, seed: 2, flowers: 0.15, tint: 0xf2ece0, sign: ['smith', 'Smithy', -4.2] },
  { name: 'goods', x: 31, z: 16, rot: PI / 2, w: 7, d: 8, floors: 2, upper: 'stone', balcony: true, chimneys: [[2.2, -2.2]], door: 0, seed: 3, flowers: 0.6, tint: 0xfff6e8, sign: ['goods', 'Wares & Sundries', 2.9] },
  { name: 'house', x: 31, z: 26.8, rot: PI / 2, w: 7.2, d: 8, floors: 2, upper: 'timber', chimneys: [[-2, 1.6]], door: 1.2, seed: 4, flowers: 0.5 },
  { name: 'bakery', x: 41, z: 35.2, rot: PI, w: 9, d: 8, floors: 2, upper: 'timber', dormers: 2, chimneys: [[-3, 1.8]], door: 1.6, seed: 5, flowers: 0.4, sign: ['bread', 'Bakery', -3.4] },
  { name: 'house', x: 55.2, z: 35, rot: PI, w: 8, d: 7, floors: 2, upper: 'stone', chimneys: [[2.5, 0.4]], door: -1, seed: 6, flowers: 0.8, tint: 0xf6ead8 },
  { name: 'house', x: 66.2, z: 15.3, rot: -PI / 2, w: 7, d: 8, floors: 2, upper: 'stone', balcony: true, door: 1.6, seed: 7, flowers: 0.6 },
  { name: 'house', x: 66.2, z: 26.2, rot: -PI / 2, w: 8, d: 8, floors: 2, upper: 'timber', chimneys: [[-2.5, -1.5]], door: -1.5, seed: 8, flowers: 0.4 },
];
export const SQUARE = { x0: 35, x1: 62.2, z0: 11.6, z1: 31.2, r: 2.5 };
export const WELL = { x: 48, z: 21.5 };
// the lane to the road and the alleys: [from, to, half width]
const LANES = [[[48, -1.8], [48, 12], 2.4], [[24, 21.3], [36, 21.3], 1.5], [[61, 20.5], [73, 20.5], 1.5], [[48.3, 30], [48.3, 42], 2.2]];
// where the smith works, and his forge
export const SMITHY = { anvil: [63.25, 8.7], spot: [62.35, 8.7], forge: [62.3, 5.9] };

// ------------------------------------------------------------------------------ the cobbles
function sdRect(x, z, R) {
  const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, hx = (R.x1 - R.x0) / 2 - R.r, hz = (R.z1 - R.z0) / 2 - R.r;
  const qx = Math.abs(x - cx) - hx, qz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R.r;
}
function sdSeg(x, z, [ax, az], [bx, bz], hw) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(ax + dx * t - x, az + dz * t - z) - hw;
}
// how far (x, z) is outside the paving (negative inside)
export function paveSDF(x, z) {
  let d = sdRect(x, z, SQUARE);
  for (const [a, b, hw] of LANES) d = Math.min(d, sdSeg(x, z, a, b, hw));
  return d + (vnoise(x * 1.7, z * 1.7) - 0.5) * 0.35;
}
const paving = (x, z) => 1 - smoothstep(-0.2, 0.2, paveSDF(x, z));
const MASK = { x0: 20, z0: -6, size: 58, res: 256 };
// bare earth: the floor of the smithy's lean-to, round the hay, at the foot of the tower ([x0, x1, z0, z1])
const BARE = [[60.6, 65.6, 3.8, 11.8], [27.6, 31.6, 5.2, 7.4], [67.8, 73.4, 31.2, 36.4]];

// ------------------------------------------------------------------------------ small things
const POTS = [
  [[0, 0], [0.07, 0], [0.1, 0.05], [0.11, 0.13], [0.08, 0.2], [0.045, 0.25], [0.052, 0.28], [0.04, 0.285]],      // a jug
  [[0, 0], [0.06, 0], [0.13, 0.04], [0.16, 0.09], [0.15, 0.095], [0.11, 0.05], [0, 0.05]],                      // a bowl
  [[0, 0], [0.08, 0], [0.14, 0.12], [0.15, 0.24], [0.1, 0.36], [0.055, 0.42], [0.075, 0.46], [0.06, 0.465]],     // a tall jar
  [[0, 0], [0.045, 0], [0.05, 0.1], [0.046, 0.12], [0.04, 0.12], [0.04, 0.02], [0, 0.02]],                      // a mug
];
const POT_COLORS = [0xb8643a, 0xa85a34, 0xe0d2b4, 0x5f84a8, 0x8a4a2a, 0xc87a4a, 0x7a8a5a];
const potGeo = POTS.map((p) => new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 12));

export class Village {
  constructor(game) {
    this.game = game;
    this.colliders = [];        // houses and the tower are boxes; everything else small is a circle
    this.blockers = [];         // what the camera keeps in front of
    this.seats = []; this.spots = []; this.stalls = []; this.doors = [];
    this.signs = []; this.lanterns = []; this.chimneys = [];
    const rnd = this.rnd = mulberry32(404);
    this.T = { stone: stoneWall(), plaster: plaster(), roof: roofTiles(), cob: cobbles(), door: doorTex(), win: windowTex() };
    this.pave(game);
    const B = this.B = new Builder();
    // the houses, and the tower behind the last of them
    this.houses = HOUSES.map((spec) => {
      const h = B.house(spec);
      h.spec = spec; h.name = spec.name;
      this.colliders.push(h.collider); this.blockers.push(h.collider);
      this.doors.push({ x: h.door.x, z: h.door.z, heading: h.door.heading, house: h });
      this.chimneys.push(...h.smoke.map((p) => ({ p, k: spec.name === 'bakery' || spec.name === 'inn' ? 1 : 0.6 })));
      return h;
    });
    const tw = B.tower({ x: 70.6, z: 33.8, size: 4.2, height: 11, seed: 9 });
    this.colliders.push(tw.collider); this.blockers.push(tw.collider);
    this.smithy(B);
    this.well(B, WELL.x, WELL.z);
    this.market(B);
    this.dressing(B, rnd);
    for (const h of this.houses) if (h.spec.sign) this.hangSign(B, h, ...h.spec.sign);
    this.bunting(B, [38.5, 11.9], [52.5, 31.0], 5.2, [0xc8423a, 0xe8c050, 0x3a6aa8, 0xf2ede0, 0x4a8a4a]);
    this.bunting(B, [35.2, 25.2], [62.0, 17.2], 5.0, [0xe8c050, 0xc8423a, 0xf2ede0, 0x3a6aa8]);
    this.build(game, B.merged());
    for (const c of this.colliders) c.village = true;
    this.graph();
    this.mark = game.hud.addMark('⌂', 'zone');
    this.smokeT = 0; this.night = null;
  }

  // ---------------------------------------------------------------- the ground: cobbles laid, grass worn away
  pave(game) {
    // the paving mask, fine enough for the edge of the cobbles to be drawn from it
    const R = MASK.res, data = new Uint8Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const x = MASK.x0 + (i + 0.5) / R * MASK.size, z = MASK.z0 + (j + 0.5) / R * MASK.size;
      data[j * R + i] = paving(x, z) * 255;
    }
    this.mask = new THREE.DataTexture(data, R, R, THREE.RedFormat, THREE.UnsignedByteType);
    this.mask.minFilter = this.mask.magFilter = THREE.LinearFilter; this.mask.needsUpdate = true;
    setPaving(paving);
    // the ground's own channels: dirt under and round the cobbles, the rest of the village trodden, no puddles on
    // the stones, and nothing growing under the houses
    const texel = HALF * 2 / ZRES, footprint = HOUSES.map((s) => boxCollider(s.x, s.z, s.w / 2 + 0.3, s.d / 2 + 0.5, s.rot));
    for (let j = 0; j < ZRES; j++) {
      const z = (j + 0.5) * texel - HALF;
      if (z < VILLAGE.z0 - 8 || z > VILLAGE.z1 + 8) continue;
      for (let i = 0; i < ZRES; i++) {
        const x = (i + 0.5) * texel - HALF;
        if (x < VILLAGE.x0 - 8 || x > VILLAGE.x1 + 8) continue;
        const k = (j * ZRES + i) * 4, d = paveSDF(x, z);
        const edge = Math.max(0, Math.max(VILLAGE.x0 - x, x - VILLAGE.x1, VILLAGE.z0 - z, z - VILLAGE.z1));
        const worn = 0.14 * (1 - smoothstep(0, 5, edge)) * (0.5 + vnoise(x * 0.3, z * 0.3));
        let p = Math.max(PATH[k] / 255, 1 - smoothstep(-0.8, 1.1, d), worn);
        if (footprint.some((c) => inside(c, x, z)) || BARE.some(([a, b, c, e]) => x > a && x < b && z > c && z < e)) p = 1;
        PATH[k] = Math.min(1, p) * 255;
        if (d < 1) PATH[k + 1] = 0;
      }
    }
    game.worldTex.path.needsUpdate = true;
    // the cobbles themselves: the ground's own grid, where it is paved, a few centimetres up, cut to the mask's edge
    const x0 = Math.floor(VILLAGE.x0 - 2), x1 = Math.ceil(VILLAGE.x1 + 2), z0 = Math.floor(VILLAGE.z0 - 4), z1 = Math.ceil(VILLAGE.z1 + 2);
    const nx = x1 - x0 + 1, nz = z1 - z0 + 1, pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i, z = z0 + j, k = j * nx + i, hi = (z + HALF) * HRES + (x + HALF);
      pos[k * 3] = x; pos[k * 3 + 1] = H[hi] + 0.035; pos[k * 3 + 2] = z;
      uv[k * 2] = x / 2.2; uv[k * 2 + 1] = z / 2.2;
    }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const x = x0 + i, z = z0 + j;
      if (Math.min(paveSDF(x, z), paveSDF(x + 1, z), paveSDF(x, z + 1), paveSDF(x + 1, z + 1)) > 0.9) continue;
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, d, b, c);         // the same split as the ground's
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: this.T.cob.map, normalMap: this.T.cob.normal, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const U = { uPave: { value: this.mask }, uPaveRect: { value: new THREE.Vector3(MASK.x0, MASK.z0, 1 / MASK.size) } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vVP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvVP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vVP; uniform sampler2D uPave; uniform vec3 uPaveRect;\n${GLSL_NOISE}`)
        .replace('#include <map_fragment>', `
          float pm = texture2D(uPave, (vVP.xz - uPaveRect.xy) * uPaveRect.z).r;
          if (pm < 0.5) discard;
          // the edge: a row of bigger, darker setts, earth worked in between them
          float edge = 1.0 - smoothstep(0.55, 0.8, pm);
          vec4 tc = mix(texture2D(map, vMapUv), texture2D(map, vVP.xz / 3.3 + 0.37), edge);
          diffuseColor *= tc;
          diffuseColor.rgb *= mix(0.74, 1.12, nFbm(vVP.xz * 0.16)) * (1.0 - 0.25 * edge);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.14, 0.1), smoothstep(0.55, 0.85, nNoise(vVP.xz * 0.9)) * 0.35);`);
    };
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    game.scene.add(mesh);
    this.cobbles = mesh;
  }

  // ---------------------------------------------------------------- the smithy's open forge, under a lean-to
  smithy(B) {
    // the lean-to against the smithy's east wall: posts and a tiled roof sloping away
    const x0 = 61, x1 = 64.8, zA = 4.4, zB = 11.2, yT = 3.25, yB = 2.35, gy = groundY(62.8, 7.8);
    B.place(0, 0, 0, gy);
    const p = Math.atan2(yT - yB, x1 - x0), L = Math.hypot(yT - yB, x1 - x0) + 0.4;
    // a slope runs along +z from z0: turned a quarter so it runs east
    B.place(x0, (zA + zB) / 2, PI / 2, gy);
    B.add('roof', B.slope(zB - zA + 0.6, L, p, 0, yT + 0.1, 0, false), 0);
    B.add('wood', B.slope(zB - zA + 0.6, L, p, 0, yT, 0, false, 2, true), 0, 0x4a3a2c);
    B.add('wood', box(zB - zA + 0.6, 0.18, 0.12, 0, yT - 0.12, 0.05), 1, 0x3a2a1c);
    B.place(0, 0, 0, gy);
    for (const z of [zA, (zA + zB) / 2, zB]) {
      B.add('wood', box(0.2, yB + 0.05, 0.2, x1 - 0.1, yB / 2, z), 1, 0x5a4430);
      B.add('wood', box(x1 - x0, 0.16, 0.14, (x0 + x1) / 2, yB - 0.1 + (yT - yB) * 0.5, z).rotateZ(0), 1, 0x4a3524);
    }
    B.add('wood', box(0.16, 0.2, zB - zA, x1 - 0.1, yB - 0.05, (zA + zB) / 2), 1, 0x4a3524);
    this.colliders.push({ x: x1 - 0.1, z: zA, r: 0.2, h: yB }, { x: x1 - 0.1, z: (zA + zB) / 2, r: 0.2, h: yB }, { x: x1 - 0.1, z: zB, r: 0.2, h: yB });
    // the forge: a stone hearth with a bed of coals, a hood and its flue up through the roof, the bellows
    const [fx, fz] = SMITHY.forge, fy = groundY(fx, fz);
    B.place(fx, fz, 0, fy);
    B.add('stone', box(1.5, 0.9, 1.2, 0, 0.45, 0), 1.2, 0xbab0a0);
    B.add('coal', box(0.9, 0.06, 0.7, 0, 0.92, 0.05), 0, 0xffffff);
    const hood = new THREE.CylinderGeometry(0.25, 0.85, 0.9, 4, 1, true).rotateY(PI / 4).translate(0, 1.95, 0);
    B.add('stone', hood, 1.2, 0x9a9488);
    B.add('stone', box(0.5, 2.3, 0.5, 0, 3.4, 0), 1.2, 0x9a9488);
    for (const s of [-1, 1]) B.add('stone', box(0.2, 1.05, 0.2, s * 0.65, 1.42, 0.5), 1, 0xb0a898);
    B.add('wood', box(0.5, 0.18, 0.9, 1.05, 0.75, 0.1).rotateZ(-0.25), 1, 0x6a4a30);
    B.add('cloth', box(0.48, 0.2, 0.8, 1.05, 0.62, 0.1).rotateZ(-0.25), 0, 0x5a4030);
    this.forge = new THREE.Vector3(fx, fy + 1.0, fz);
    this.colliders.push({ x: fx, z: fz, r: 0.85, h: 1.5 });
    // the anvil on its block, a tub to quench in, tongs and hammers on a rack
    const [ax, az] = SMITHY.anvil, ay = groundY(ax, az);
    B.place(ax, az, PI / 2, ay);
    B.add('wood', new THREE.CylinderGeometry(0.28, 0.32, 0.55, 10).translate(0, 0.27, 0), 1, 0x5a4430);
    B.add('iron', box(0.24, 0.18, 0.5, 0, 0.64, 0), 0, 0x3a3a3e);
    B.add('iron', box(0.16, 0.08, 0.26, 0, 0.52, 0), 0, 0x3a3a3e);
    B.add('iron', new THREE.ConeGeometry(0.1, 0.32, 8).rotateX(PI / 2).scale(1, 0.8, 1).translate(0, 0.66, 0.4), 0, 0x3a3a3e);
    this.anvil = new THREE.Vector3(ax, ay + 0.74, az);
    this.colliders.push({ x: ax, z: az, r: 0.38, h: 0.8 });
    this.barrel(B, 63.9, 10.4, 0.62, true);
    B.place(63.9, 5.2, -PI / 2);
    B.add('wood', box(1.4, 0.08, 0.06, 0, 1.6, 0), 1, 0x5a4430);
    for (let k = 0; k < 5; k++) {
      const u = -0.55 + k * 0.27;
      B.add('iron', box(0.03, 0.6, 0.03, u, 1.28, 0.05), 0, 0x2e2e32);
      B.add(k % 2 ? 'iron' : 'wood', box(k % 2 ? 0.12 : 0.1, 0.07, 0.07, u, 0.98, 0.05), 1, k % 2 ? 0x2e2e32 : 0x6a4a30);
    }
    for (const s of [-1, 1]) B.add('wood', box(0.08, 1.7, 0.08, s * 0.72, 0.85, 0), 1, 0x5a4430);
    // a stack of firewood along the back
    this.logs(B, 64.2, 6.6, PI / 2, 1.6, 3);
  }

  // ---------------------------------------------------------------- the well in the middle of the square
  well(B, x, z) {
    const y = groundY(x, z);
    B.place(x, z, 0, y);
    const ring = new THREE.LatheGeometry([[0.98, -0.3], [1.0, 0.86], [1.3, 0.86], [1.32, 0.94], [1.36, 0.88], [1.36, -0.3]].map(([r, h]) => new THREE.Vector2(r, h)).reverse(), 24);
    B.add('stone', ring, 1.6, 0xf0ebe0);
    B.add('stone', new THREE.LatheGeometry([[1.5, 0.0], [1.5, 0.12], [1.36, 0.14]].map(([r, h]) => new THREE.Vector2(r, h)), 24), 1.6, 0xb8b0a0);
    B.add('water', new THREE.CircleGeometry(1.0, 20).rotateX(-PI / 2).translate(0, 0.3, 0), 0, 0xffffff);
    // posts, the beam and its crank, a little tiled roof, the bucket on its rope
    for (const s of [-1, 1]) B.add('wood', box(0.16, 2.5, 0.16, s * 1.18, 1.25, 0), 1, 0x5a4430);
    B.add('wood', new THREE.CylinderGeometry(0.09, 0.09, 2.5, 8).rotateZ(PI / 2).translate(0, 1.95, 0), 1, 0x6a5038);
    B.add('iron', box(0.04, 0.4, 0.04, 1.32, 1.8, 0), 0, 0x2a2a2c);
    B.add('iron', box(0.04, 0.04, 0.3, 1.32, 1.62, 0.13), 0, 0x2a2a2c);
    const p = 0.62, L = 1.25;
    for (const flip of [false, true]) B.add('roof', B.slope(2.9, L, p, 0, 2.95, 0, flip), 0);
    for (const flip of [false, true]) B.add('wood', B.slope(2.9, L, p, 0, 2.88, 0, flip, 2, true), 0, 0x4a3a2c);
    B.add('ridge', new THREE.CylinderGeometry(0.09, 0.09, 3, 8, 1, false, 0, PI).rotateZ(PI / 2).rotateX(-PI / 2).translate(0, 2.97, 0), 0);
    for (const s of [-1, 1]) B.add('wood', box(0.12, 0.7, 0.12, s * 1.18, 2.6, 0), 1, 0x5a4430);
    B.add('dark', new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4).translate(0, 1.55, 0), 0, 0x8a7a5a);
    B.add('wood', new THREE.CylinderGeometry(0.16, 0.13, 0.28, 10).translate(0, 1.05, 0), 1, 0x6a4a30);
    B.add('iron', new THREE.TorusGeometry(0.15, 0.012, 4, 12).rotateX(PI / 2).translate(0, 1.15, 0), 0, 0x2a2a2c);
    this.colliders.push({ x, z, r: 1.5, h: 1 });
    // people stop round it
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * PI * 2 + 0.3;
      this.spots.push({ kind: 'well', x: x + Math.sin(a) * 2.05, z: z + Math.cos(a) * 2.05, heading: a + PI });
    }
  }

  // ---------------------------------------------------------------- the market: stalls, and tables of pottery
  market(B) {
    this.stall(B, 37.9, 16.2, PI / 2, 'goods', ['#7a2a24', '#e8dcc0']);
    this.stall(B, 55.8, 15.4, -PI / 2 + 0.25, 'produce', ['#2f5a3a', '#e8dcc0']);
    this.stall(B, 41.4, 29.4, PI, 'bread', ['#b8822e', '#f0e6cc']);
    this.stall(B, 39.6, 24.6, PI / 2, 'pottery', ['#3a5a8a', '#efe6d0']);
    // the inn's tables out on the cobbles, and a bench at its wall
    this.table(B, 36.4, 13.9, 0, true);
    this.table(B, 42.3, 14.2, 0.08, true);
    this.bench(B, 34.8, 12.3, 0);
    // tables of pottery set out on the square, the way they do on market day
    this.table(B, 44.6, 27.3, PI / 2 - 0.1, false, 'pottery');
    this.table(B, 58.4, 23.0, -0.2, false, 'pottery');
    // benches by the well and along the house fronts
    this.bench(B, 52.6, 18.2, -PI / 2 - 0.5);
    this.bench(B, 43.6, 18.6, PI / 2 + 0.4);
    this.bench(B, 57.0, 30.5, PI);
    this.bench(B, 61.7, 25.4, -PI / 2);
  }

  // a stall: a table under a striped awning on four posts, its goods on it; the keeper stands behind it
  stall(B, x, z, rot, kind, cols) {
    const y = groundY(x, z), W = 2.5, D = 1.05, rnd = this.rnd;
    B.place(x, z, rot, y);
    const T = 0x8a6a48;
    B.add('wood', box(W, 0.07, D, 0, 0.86, 0), 1, T);
    B.add('wood', box(W, 0.62, 0.04, 0, 0.5, D / 2 - 0.02), 1, 0x6a4a30);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('wood', box(0.07, 0.84, 0.07, sx * (W / 2 - 0.06), 0.42, sz * (D / 2 - 0.06)), 1, 0x5a4430);
    const zf = D / 2 + 0.35, zb = -D / 2 - 0.3, yf = 2.05, yb = 2.5;
    for (const sx of [-1, 1]) {
      B.add('wood', box(0.08, yf, 0.08, sx * W / 2, yf / 2, zf), 1, 0x5a4430);
      B.add('wood', box(0.08, yb, 0.08, sx * W / 2, yb / 2, zb), 1, 0x5a4430);
      B.add('wood', box(0.06, 0.06, zf - zb, sx * W / 2, (yf + yb) / 2 - 0.04, (zf + zb) / 2).rotateX(0), 1, 0x5a4430);
    }
    // the awning (its own mesh, for its own stripes), with a valance along the front
    const L = Math.hypot(zf - zb + 0.5, yb - yf + 0.1), tex = stripes(cols[0], cols[1]);
    tex.repeat.set(1.5, 1);
    const cloth = new THREE.PlaneGeometry(W + 0.35, L).rotateX(-PI / 2);
    cloth.rotateX(Math.atan2(yb - yf + 0.1, zf - zb + 0.5)).translate(0, (yf + yb) / 2 + 0.06, (zf + zb) / 2);
    const val = new THREE.PlaneGeometry(W + 0.35, 0.28).translate(0, yf - 0.06, zf + 0.25);
    const geo = mergeGeo([cloth, val]).applyMatrix4(B.M);
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
    this.game.scene.add(mesh);
    // the goods
    const top = 0.9;
    if (kind === 'pottery') {
      for (let k = 0; k < 9; k++) this.pot(B, (k % 4 === 3) ? 1 : k % 3 === 0 ? 2 : 0, -W / 2 + 0.25 + k * 0.25, top, -0.15 + (k % 2) * 0.3, POT_COLORS[(rnd() * POT_COLORS.length) | 0]);
    } else if (kind === 'produce') {
      const fruit = [[0xb8322a, 0.05], [0x6a9a3a, 0.09], [0xe08a2a, 0.07], [0xd8c040, 0.045]];
      for (let k = 0; k < 4; k++) this.crate(B, -W / 2 + 0.35 + k * 0.6, top, -0.05, 0.5, 0.36, fruit[k], rnd);
    } else if (kind === 'bread') {
      for (let k = 0; k < 3; k++) {
        const u = -0.8 + k * 0.8;
        B.add('flowers', new THREE.CylinderGeometry(0.3, 0.24, 0.14, 14, 1, true).translate(u, top + 0.07, 0), 0, 0xa88a52);
        B.add('flowers', new THREE.CircleGeometry(0.24, 14).rotateX(-PI / 2).translate(u, top + 0.02, 0), 0, 0x8a6a3a);
        for (let n = 0; n < 4; n++) this.loaf(B, u + (rnd() - 0.5) * 0.25, top + 0.1 + n * 0.03, (rnd() - 0.5) * 0.25, rnd() * PI, rnd);
      }
      for (const u of [-0.4, 0.4]) B.add('flowers', new THREE.TorusGeometry(0.07, 0.025, 6, 12).rotateX(PI / 2).translate(u, top + 0.03, 0.35), 0, 0xa8642a);
    } else {
      // cloth in folded bolts, and a sack and a jar
      const C = [0x7a2a24, 0x3a5a8a, 0xd8c8a0, 0x5a7a3a, 0x8a5a9a];
      for (let k = 0; k < 5; k++) B.add('cloth', box(0.36, 0.12 + (k % 2) * 0.06, 0.5, -W / 2 + 0.3 + k * 0.4, top + 0.08, 0), 0, C[k]);
      for (let k = 0; k < 3; k++) B.add('cloth', box(0.36, 0.12, 0.5, -W / 2 + 0.5 + k * 0.8, top + 0.22, 0.02), 0, C[(k + 2) % 5]);
      B.add('cloth', new THREE.PlaneGeometry(0.5, 0.9).translate(-0.6, yf - 0.55, zf + 0.02), 0, 0x8a5a9a);
      B.add('cloth', new THREE.PlaneGeometry(0.5, 0.75).translate(0.3, yf - 0.48, zf + 0.02), 0, 0xd8c8a0);
    }
    // a sack or a basket on the ground beside it
    this.sack(B, W / 2 + 0.35, 0.2, rnd);
    const c = Math.cos(rot), s = Math.sin(rot), w = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    this.colliders.push(boxCollider(...w(0, (zf + zb) / 2), W / 2 + 0.12, (zf - zb) / 2 + 0.1, rot, 2.4));
    const [kx, kz] = w(0, zb - 0.45), [cx, cz] = w(0, zf + 0.75);
    const st = { kind, keeper: { x: kx, z: kz, heading: rot }, customer: { x: cx, z: cz, heading: rot + PI } };
    this.stalls.push(st);
    this.spots.push({ kind: 'stall', x: cx, z: cz, heading: rot + PI, stall: st });
  }

  // a trestle table, with benches along it (and things on it: mugs and a jug, or pottery set out to sell)
  table(B, x, z, rot, benches, goods) {
    const y = groundY(x, z), rnd = this.rnd;
    B.place(x, z, rot, y);
    B.add('wood', box(1.9, 0.07, 0.82, 0, 0.78, 0), 1, 0x7a5a3a);
    for (const s of [-1, 1]) { B.add('wood', box(0.08, 0.74, 0.62, s * 0.72, 0.38, 0), 1, 0x5a4430); B.add('wood', box(0.1, 0.06, 0.8, s * 0.72, 0.06, 0), 1, 0x5a4430); }
    if (goods === 'pottery') {
      for (let k = 0; k < 8; k++) this.pot(B, [2, 0, 1, 2, 0, 3, 1, 0][k], -0.75 + k * 0.21, 0.82, (k % 2 ? 0.18 : -0.15), POT_COLORS[(rnd() * POT_COLORS.length) | 0]);
      this.colliders.push(boxCollider(x, z, 1.0, 0.48, rot, 1.2));
      const c = Math.cos(rot), s = Math.sin(rot);
      this.spots.push({ kind: 'browse', x: x + 1.15 * s, z: z + 1.15 * c, heading: rot + PI });
      return;
    }
    for (let k = 0; k < 4; k++) this.pot(B, 3, -0.6 + k * 0.4 + (rnd() - 0.5) * 0.1, 0.82, (k % 2 ? 0.2 : -0.2), [0x8a5a3a, 0xc8b898][k % 2]);
    this.pot(B, 0, 0.1, 0.82, 0, 0xb8643a);
    this.loaf(B, -0.25, 0.86, 0.05, 0.4, rnd);
    if (benches) for (const sz of [-1, 1]) {
      B.add('wood', box(1.8, 0.06, 0.3, 0, 0.45, sz * 0.72), 1, 0x7a5a3a);
      for (const sx of [-1, 1]) B.add('wood', box(0.07, 0.43, 0.24, sx * 0.7, 0.21, sz * 0.72), 1, 0x5a4430);
      for (const u of [-0.45, 0.45]) {
        const c = Math.cos(rot), s = Math.sin(rot), lz = sz * 0.72;
        this.seats.push({ x: x + u * c + lz * s, z: z - u * s + lz * c, heading: rot + (sz > 0 ? PI : 0), y: y + 0.48, from: -1 });
      }
    }
    this.colliders.push(boxCollider(x, z, 1.0, benches ? 0.9 : 0.45, rot, 1.0));
  }

  bench(B, x, z, rot) {
    const y = groundY(x, z);
    B.place(x, z, rot, y);
    B.add('wood', box(1.7, 0.07, 0.36, 0, 0.45, 0), 1, 0x7a5a3a);
    B.add('wood', box(1.7, 0.3, 0.05, 0, 0.75, -0.18).rotateX(-0.12), 1, 0x7a5a3a);
    for (const sx of [-1, 1]) { B.add('wood', box(0.08, 0.45, 0.3, sx * 0.72, 0.22, 0), 1, 0x5a4430); B.add('wood', box(0.07, 0.75, 0.06, sx * 0.72, 0.5, -0.2), 1, 0x5a4430); }
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const u of [-0.42, 0.42]) this.seats.push({ x: x + u * c + 0.05 * s, z: z - u * s + 0.05 * c, heading: rot, y: y + 0.48, from: 1 });
    this.colliders.push(boxCollider(x, z, 0.88, 0.24, rot, 1.0));
  }

  pot(B, kind, x, y, z, color) {
    const s = 0.9 + this.rnd() * 0.25;
    B.add('clay', potGeo[kind].clone().scale(s, s, s).translate(x, y, z), 0, color);
  }
  loaf(B, x, y, z, a, rnd) {
    B.add('flowers', new THREE.SphereGeometry(1, 10, 6, 0, PI * 2, 0, PI / 2).scale(0.13, 0.07, 0.07).rotateY(a).translate(x, y, z), 0, rnd() < 0.5 ? 0xb87a3a : 0xc89048);
  }
  crate(B, x, y, z, w, d, [color, r], rnd) {
    B.add('wood', box(w, 0.04, d, x, y + 0.02, z), 1, 0x8a6a48);
    for (const s of [-1, 1]) { B.add('wood', box(w, 0.2, 0.03, x, y + 0.1, z + s * d / 2), 1, 0x9a7a52); B.add('wood', box(0.03, 0.2, d, x + s * w / 2, y + 0.1, z), 1, 0x9a7a52); }
    const n = Math.max(2, Math.floor(w / (r * 2.1))), m = Math.max(2, Math.floor(d / (r * 2.1)));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const g = new THREE.IcosahedronGeometry(r, 1).translate(x - w / 2 + (i + 0.5) * w / n + (rnd() - 0.5) * r * 0.3, y + 0.14 + rnd() * 0.04, z - d / 2 + (j + 0.5) * d / m + (rnd() - 0.5) * r * 0.3);
      B.add('flowers', g, 0, new THREE.Color(color).offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.08).getHex());
    }
  }
  sack(B, x, z, rnd) {
    const g = new THREE.SphereGeometry(1, 10, 8).scale(0.24, 0.3, 0.2).translate(x, 0.27, z);
    B.add('cloth', g, 0, rnd() < 0.5 ? 0xb09a70 : 0xa08a62);
    B.add('cloth', new THREE.ConeGeometry(0.1, 0.16, 8).translate(x, 0.6, z), 0, 0xa08a62);
  }
  barrel(B, x, z, s = 1, open = false) {
    const y = groundY(x, z);
    B.place(x, z, this.rnd() * 6, y);
    const prof = [[0.0, 0], [0.27, 0], [0.31, 0.2], [0.33, 0.42], [0.31, 0.66], [0.27, 0.86], [open ? 0.25 : 0.0, 0.86]].map(([r, h]) => new THREE.Vector2(r * s, h * s));
    B.add('wood', new THREE.LatheGeometry(prof, 14), 0.6, 0x8a6a48);
    for (const h of [0.14, 0.72]) B.add('iron', new THREE.TorusGeometry(0.31 * s, 0.014, 4, 18).rotateX(PI / 2).translate(0, h * s, 0), 0, 0x2a2a2c);
    if (open) B.add('water', new THREE.CircleGeometry(0.25 * s, 14).rotateX(-PI / 2).translate(0, 0.78 * s, 0), 0, 0xffffff);
    this.colliders.push({ x, z, r: 0.34 * s, h: 0.9 * s });
  }
  crates(B, x, z, rot) {
    const y = groundY(x, z);
    B.place(x, z, rot, y);
    for (const [u, v, h] of [[0, 0, 0], [0.62, 0.05, 0], [0.3, 0, 0.6]]) {
      B.add('wood', box(0.58, 0.58, 0.58, u, h + 0.29, v), 1, 0x9a7a52);
      for (const s of [-1, 1]) B.add('wood', box(0.6, 0.06, 0.6, u, h + 0.29 + s * 0.26, v), 1, 0x6a4a30);
    }
    const c = Math.cos(rot), s = Math.sin(rot);
    this.colliders.push({ x: x + 0.3 * c, z: z - 0.3 * s, r: 0.65, h: 1.2 });
  }
  logs(B, x, z, rot, len, rows) {
    const y = groundY(x, z);
    B.place(x, z, rot, y);
    for (let r = 0; r < rows; r++) for (let k = 0; k < 6 - r; k++) {
      const lz = -0.65 + k * 0.25 + r * 0.125, ly = 0.12 + r * 0.21;
      B.add('wood', new THREE.CylinderGeometry(0.12, 0.12, len, 8, 1, true).rotateZ(PI / 2).translate(0, ly, lz), 0.5, 0xb89a72);
      for (const s of [-1, 1]) B.add('clay', new THREE.CircleGeometry(0.12, 8).rotateY(s * PI / 2).translate(s * len / 2, ly, lz), 0, 0xc8a878);
    }
    this.colliders.push(boxCollider(x, z, len / 2, 0.8, rot, 0.8));
  }
  planter(B, x, z, rot, rnd) {
    const y = groundY(x, z);
    B.place(x, z, rot, y);
    B.add('wood', box(1.1, 0.4, 0.4, 0, 0.2, 0), 1, 0x6a4a30);
    for (let k = 0; k < 14; k++) {
      const u = -0.45 + rnd() * 0.9, v = (rnd() - 0.5) * 0.25;
      B.add('flowers', new THREE.IcosahedronGeometry(0.12 + rnd() * 0.06, 0).translate(u, 0.48 + rnd() * 0.12, v), 0, 0x4a6a2a);
      if (rnd() < 0.7) B.add('flowers', new THREE.IcosahedronGeometry(0.05, 0).translate(u, 0.6 + rnd() * 0.12, v), 0, [0xc84a6a, 0xe8d050, 0x9a5ac8, 0xf2f0e8][(rnd() * 4) | 0]);
    }
    this.colliders.push(boxCollider(x, z, 0.6, 0.25, rot, 0.6));
  }
  lantern(B, x, z, rot) {
    const y = groundY(x, z);
    B.place(x, z, rot, y);
    B.add('iron', new THREE.CylinderGeometry(0.05, 0.07, 2.9, 8).translate(0, 1.45, 0), 0, 0x2a2a2c);
    B.add('iron', new THREE.CylinderGeometry(0.14, 0.18, 0.2, 8).translate(0, 0.1, 0), 0, 0x2a2a2c);
    B.add('iron', box(0.04, 0.04, 0.55, 0, 2.75, 0.25), 0, 0x2a2a2c);
    B.add('iron', new THREE.TorusGeometry(0.18, 0.015, 4, 10, PI / 2).rotateY(PI / 2).translate(0, 2.55, 0.18), 0, 0x2a2a2c);
    this.lamp(B, 0, 2.38, 0.48);
    this.colliders.push({ x, z, r: 0.18, h: 2.9 });
  }
  // a lantern hanging at (lx, ly, lz) in the current frame
  lamp(B, lx, ly, lz) {
    B.add('iron', new THREE.ConeGeometry(0.18, 0.16, 4).rotateY(PI / 4).translate(lx, ly + 0.1, lz), 0, 0x2a2a2c);
    B.add('glow', box(0.2, 0.26, 0.2, lx, ly - 0.12, lz), 0, 0xffffff);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('iron', box(0.025, 0.28, 0.025, lx + sx * 0.1, ly - 0.12, lz + sz * 0.1), 0, 0x2a2a2c);
    B.add('iron', box(0.24, 0.03, 0.24, lx, ly - 0.26, lz), 0, 0x2a2a2c);
    const p = new THREE.Vector3(lx, ly - 0.12, lz).applyMatrix4(B.M);
    this.lanterns.push(p);
  }

  // ---------------------------------------------------------------- the rest of the village's clutter
  dressing(B, rnd) {
    // lanterns round the square and at the lane's mouth
    for (const [x, z, r] of [[35.6, 30.4, PI * 0.75], [61.5, 30.6, -PI * 0.75], [61.5, 12.3, -PI * 0.25], [45.3, 11.9, 0], [50.8, 11.9, 0], [35.7, 19.4, PI / 2]]) this.lantern(B, x, z, r);
    // lanterns by the doors of the inn and the bakery
    for (const name of ['inn', 'bakery', 'goods']) {
      const h = this.houses.find((k) => k.name === name), u = h.spec.door + 1.15;
      B.M.makeRotationY(h.rot).setPosition(...h.at(0, 0, 0).toArray()); B.ground = h.floor;
      B.add('iron', box(0.04, 0.04, 0.4, u, 2.45, h.spec.d / 2 + 0.2), 0, 0x2a2a2c);
      this.lamp(B, u, 2.3, h.spec.d / 2 + 0.38);
    }
    // barrels and crates by the inn and the merchant's, a stack outside the bakery
    this.barrel(B, 45.4, 12.4); this.barrel(B, 44.7, 13.0, 0.9); this.barrel(B, 34.1, 13.4, 1.05);
    this.crates(B, 35.6, 19.0, PI / 2 + 0.2); this.crates(B, 46.2, 31.6, PI + 0.1);
    this.barrel(B, 36.3, 31.7); this.sack(B, 36.0, 32.5, rnd);
    this.barrel(B, 51.7, 12.4, 0.95); this.barrel(B, 61.3, 19.2, 0.85);
    // flowers along the house fronts
    this.planter(B, 60.4, 13.6, -PI / 2, rnd); this.planter(B, 53.1, 31.4, PI, rnd); this.planter(B, 57.6, 31.4, PI, rnd);
    this.planter(B, 61.6, 28.8, -PI / 2, rnd); this.planter(B, 35.6, 28.6, PI / 2, rnd);
    // the hay cart at the square's edge
    this.cart(B, 59.2, 27.4, 0.35, rnd);
    // the garden in the south-west corner: a fence round rows of greens
    this.garden(B, 26.5, 32.5, 34.5, 39.5, rnd);
    // hay and a woodpile to the north-west, by the road
    for (const [x, z, r] of [[28.8, 6.2, 0.2], [30.3, 6.4, -0.1], [29.5, 6.3, 0.05]]) {
      const y = groundY(x, z); B.place(x, z, r, y);
      B.add('flowers', box(1.1, 0.5, 0.55, 0, 0.25 + (x === 29.5 ? 0.5 : 0), 0), 0, 0xc8a85a);
      this.colliders.push(boxCollider(x, z, 0.58, 0.32, r, 1.0));
    }
    this.logs(B, 50.6, 37.2, PI / 2, 1.5, 3);
    // people stand about the square
    for (const [x, z] of [[44, 16.5], [52.5, 25.6], [41.2, 21.8], [55.5, 21], [48.5, 27.5], [47.8, 14.6], [56, 27], [38.6, 19.6]]) this.spots.push({ kind: 'stand', x, z, heading: rnd() * PI * 2 });
  }

  cart(B, x, z, rot, rnd) {
    const y = groundY(x, z);
    B.place(x, z, rot, y);
    B.add('wood', box(1.3, 0.08, 2.2, 0, 0.72, 0), 1, 0x7a5a3a);
    for (const s of [-1, 1]) { B.add('wood', box(0.06, 0.32, 2.2, s * 0.65, 0.9, 0), 1, 0x6a4a30); B.add('wood', box(1.3, 0.32, 0.06, 0, 0.9, s * 1.1), 1, 0x6a4a30); }
    for (const s of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.52, 0.52, 0.08, 18, 1, true).rotateZ(PI / 2).translate(s * 0.8, 0.52, -0.2);
      B.add('wood', wheel, 0.5, 0x5a4430);
      B.add('iron', new THREE.TorusGeometry(0.53, 0.025, 4, 20).rotateY(PI / 2).translate(s * 0.8, 0.52, -0.2), 0, 0x2a2a2c);
      for (let k = 0; k < 6; k++) B.add('wood', box(0.04, 0.95, 0.05).rotateX(k / 6 * PI).translate(s * 0.8, 0.52, -0.2), 1, 0x5a4430);
      B.add('wood', box(0.08, 0.08, 2.2, s * 0.35, 0.6, 2.0).rotateX(0.18), 1, 0x6a4a30);
    }
    B.add('wood', box(1.8, 0.12, 0.12, 0, 0.52, -0.2), 1, 0x4a3524);
    // a load of hay heaped up in it
    const hay = new THREE.SphereGeometry(1, 12, 8, 0, PI * 2, 0, PI / 2).scale(0.7, 0.55, 1.15).translate(0, 0.8, 0);
    const p = hay.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + (rnd() - 0.5) * 0.06);
    hay.computeVertexNormals();
    B.add('flowers', hay, 0, 0xc8a85a);
    this.colliders.push(boxCollider(x, z, 0.85, 1.25, rot, 1.6));
    const c = Math.cos(rot), s = Math.sin(rot);
    this.colliders.push({ x: x + 2.1 * s, z: z + 2.1 * c, r: 0.25, h: 0.7 });
  }

  garden(B, x0, z0, x1, z1, rnd) {
    const y = groundY((x0 + x1) / 2, (z0 + z1) / 2);
    B.place(0, 0, 0, y);
    const post = (x, z) => B.add('wood', box(0.09, 1.0, 0.09, x, groundY(x, z) - y + 0.4, z), 1, 0x6a5038);
    const rail = (ax, az, bx, bz, h) => {
      const L = Math.hypot(bx - ax, bz - az), g = box(L, 0.06, 0.04).rotateY(-Math.atan2(bz - az, bx - ax)).translate((ax + bx) / 2, groundY((ax + bx) / 2, (az + bz) / 2) - y + h, (az + bz) / 2);
      B.add('wood', g, 1, 0x7a5a3a);
    };
    const edge = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
    for (let e = 0; e < 4; e++) {
      const [ax, az] = edge[e], [bx, bz] = edge[e + 1], L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.6);
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, px = ax + (bx - ax) * t0, pz = az + (bz - az) * t0, qx = ax + (bx - ax) * t1, qz = az + (bz - az) * t1;
        post(px, pz);
        // a gap for a gate on the side toward the square
        if (e === 0 && k === n - 1) continue;
        rail(px, pz, qx, qz, 0.35); rail(px, pz, qx, qz, 0.75);
        this.colliders.push({ x: (px + qx) / 2, z: (pz + qz) / 2, r: 0.45, h: 1 }, { x: px, z: pz, r: 0.12, h: 1 });
      }
    }
    // rows of cabbages and leeks
    for (let r = 0; r < 4; r++) for (let k = 0; k < 9; k++) {
      const x = x0 + 0.9 + k * (x1 - x0 - 1.8) / 8, z = z0 + 1.2 + r * 1.6;
      const g = new THREE.IcosahedronGeometry(0.17 + rnd() * 0.05, 1).scale(1, 0.75, 1).translate(x, groundY(x, z) - y + 0.12, z);
      B.add('flowers', g, 0, r % 2 ? 0x5a8a3a : 0x7aa04a);
    }
  }

  // a sign on an iron bracket out from a house's front, swinging a little in the wind
  hangSign(B, h, kind, label, u) {
    const hy = h.spec.floors > 1 ? 3.25 : 2.75, base = h.sign(u, hy);
    B.M.makeRotationY(h.rot).setPosition(...h.at(0, 0, 0).toArray()); B.ground = h.floor;
    const fz = h.spec.d / 2 + (h.spec.upper === 'timber' && h.spec.floors > 1 ? 0.0 : 0);
    B.add('iron', box(0.05, 0.05, 1.45, u, hy, fz + 0.7), 0, 0x2a2a2c);
    B.add('iron', box(0.035, 0.035, 0.95, u, hy - 0.32, fz + 0.4).rotateX(0), 0, 0x2a2a2c);
    const brace = box(0.035, 0.035, 0.85).rotateX(-0.72).translate(u, hy - 0.27, fz + 0.36);
    B.add('iron', brace, 0, 0x2a2a2c);
    const map = signTex(kind, label);
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.8 });
    const board = new THREE.Group();
    for (const flip of [0, PI]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.75), mat);
      m.rotation.y = flip; m.position.set(0, -0.48, 0); m.position.x += 0; m.castShadow = true;
      if (flip) m.position.z = -0.012; else m.position.z = 0.012;
      board.add(m);
    }
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.79, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.9 }));
    edge.position.y = -0.48; board.add(edge);
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ'; pivot.rotation.y = h.rot - PI / 2;
    const out = new THREE.Vector3(Math.sin(h.rot), 0, Math.cos(h.rot));
    pivot.position.copy(base).addScaledVector(out, 0.88);
    pivot.add(board);
    this.game.scene.add(pivot);
    this.signs.push({ pivot, ph: this.rnd() * 6 });
  }

  // a string of pennants across the square from a to b, sagging, at height y
  bunting(B, [ax, az], [bx, bz], y, cols) {
    const ya = groundY(ax, az) + y, yb = groundY(bx, bz) + y, L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / 0.55);
    B.place(0, 0, 0, 0); B.ground = -10;
    const at = (t) => new THREE.Vector3(ax + (bx - ax) * t, ya + (yb - ya) * t - Math.sin(t * PI) * L * 0.06, az + (bz - az) * t);
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    for (let k = 0; k < n; k++) {
      const p = at(k / n), q = at((k + 1) / n), mid = p.clone().lerp(q, 0.5);
      const seg = new THREE.CylinderGeometry(0.008, 0.008, p.distanceTo(q), 3).translate(0, p.distanceTo(q) / 2, 0);
      seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize())).translate(p.x, p.y, p.z);
      B.add('dark', seg, 0, 0x6a5a40);
      const g = new THREE.BufferGeometry();
      const w = 0.2, hgt = 0.34;
      g.setAttribute('position', new THREE.Float32BufferAttribute([mid.x - dx * w, mid.y, mid.z - dz * w, mid.x + dx * w, mid.y, mid.z + dz * w, mid.x, mid.y - hgt, mid.z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
      g.computeVertexNormals();
      B.add('cloth', g, 0, cols[k % cols.length]);
    }
  }

  // ---------------------------------------------------------------- the meshes, one per material
  build(game, parts) {
    const tx = game.tx, T = this.T;
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.9 }, o));
    const M = this.mats = {
      stone: std({ map: T.stone.map, normalMap: T.stone.normal, normalScale: new THREE.Vector2(0.6, 0.6) }),
      plaster: std({ map: T.plaster.map }),
      timber: std({ map: tx.wood.map, roughness: 0.85 }),
      roof: std({ map: T.roof.map, normalMap: T.roof.normal, roughness: 0.72 }),
      ridge: std({ color: 0xb4603a, roughness: 0.7 }),
      wood: std({ map: tx.wood.map, normalMap: tx.wood.normal }),
      door: std({ map: T.door, roughness: 0.8 }),
      window: std({ map: T.win.map, emissiveMap: T.win.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.22, metalness: 0.1 }),
      windowDark: std({ map: T.win.map, roughness: 0.22, metalness: 0.1 }),
      shutter: std({ map: tx.wood.map, roughness: 0.8 }),
      iron: std({ roughness: 0.5, metalness: 0.55 }),
      flowers: std({ roughness: 0.8 }),
      cloth: std({ map: tx.fabric.map, side: THREE.DoubleSide, roughness: 0.95 }),
      dark: std({}),
      water: std({ color: 0x24343c, roughness: 0.06, metalness: 0.3 }),
      glow: std({ emissive: 0xffb860, emissiveIntensity: 0.2, roughness: 0.4 }),
      coal: std({ color: 0x1a1210, emissive: 0xff5a14, emissiveIntensity: 2.2, roughness: 0.9 }),
      clay: std({ roughness: 0.65 }),
    };
    this.meshes = {};
    for (const [k, g] of Object.entries(parts)) {
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, M[k]);
      m.castShadow = !['window', 'windowDark', 'water', 'glow', 'coal', 'door'].includes(k);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      game.scene.add(m);
      this.meshes[k] = m;
    }
    // halos round the lanterns at night
    const sprite = new THREE.SpriteMaterial({ map: this.haloTex(), color: 0xffb060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.halos = this.lanterns.map((p) => { const s = new THREE.Sprite(sprite); s.position.copy(p); s.scale.setScalar(1.6); game.scene.add(s); return s; });
    this.haloMat = sprite;
    const fg = new THREE.SpriteMaterial({ map: sprite.map, color: 0xff7a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
    this.forgeGlow = new THREE.Sprite(fg); this.forgeGlow.position.copy(this.forge); this.forgeGlow.scale.setScalar(1.8); game.scene.add(this.forgeGlow);
  }
  haloTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // ---------------------------------------------------------------- the streets, as a graph for the villagers
  // nodes are the places to walk through and to; two are joined if one can walk straight from one to the other
  graph() {
    const N = this.nodes = [];
    const add = (x, z, tag) => { const n = { x, z, tag, id: N.length, links: [] }; N.push(n); return n; };
    // through the square and down the lanes
    for (const x of [38, 43, 48, 53, 58.5]) for (const z of [14.2, 18, 25, 28.6]) add(x, z);
    for (const [x, z] of [[48, 9], [48, 4], [48, 0], [33, 21.3], [26.5, 21.3], [64, 20.5], [70.5, 20.5], [48.3, 33.5], [48.3, 39.5], [52.5, 21.5], [43.5, 21.5], [48, 24.6], [48, 18.4]]) add(x, z);
    for (const d of this.doors) d.node = add(d.x, d.z, 'door');
    for (const s of this.spots) s.node = add(s.x, s.z, s.kind);
    // a seat is come at from the front (a bench) or from behind (a bench at a table)
    for (const s of this.seats) s.node = add(s.x + Math.sin(s.heading) * 0.62 * s.from, s.z + Math.cos(s.heading) * 0.62 * s.from, 'seat');
    const clear = (a, b) => {
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 0.3);
      for (let i = 1; i < n; i++) {
        const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
        for (const c of this.colliders) if (inside(c, x, z, 0.32)) return false;
      }
      return true;
    };
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const a = N[i], b = N[j], d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 9 || !clear(a, b)) continue;
      a.links.push([b, d]); b.links.push([a, d]);
    }
  }
  // the shortest way through the graph from node a to node b (a list of nodes, a first), or null
  route(a, b) {
    const N = this.nodes, dist = new Float32Array(N.length).fill(Infinity), prev = new Int32Array(N.length).fill(-1), done = new Uint8Array(N.length);
    dist[a.id] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < N.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) return null;
      if (u === b.id) break;
      done[u] = 1;
      for (const [v, d] of N[u].links) if (dist[u] + d < dist[v.id]) { dist[v.id] = dist[u] + d; prev[v.id] = u; }
    }
    const out = []; for (let u = b.id; u >= 0; u = prev[u]) out.unshift(N[u]);
    return out;
  }
  // the node nearest (x, z) that can be walked to straight from there
  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd && n.links.length) { bd = d; best = n; }
    }
    return best;
  }

  // ---------------------------------------------------------------- every frame
  update(dt, G) {
    const night = !!G.sky.night, t = G.time;
    if (night !== this.night) {
      this.night = night;
      this.mats.window.emissiveIntensity = night ? 1.6 : 0;
      this.mats.glow.emissiveIntensity = night ? 3.5 : 0.15;
      this.haloMat.opacity = night ? 0.55 : 0;
    }
    // the forge breathes
    const f = 0.75 + 0.25 * Math.sin(t * 2.3) * Math.sin(t * 3.7 + 1);
    this.mats.coal.emissiveIntensity = 1.6 + 1.2 * f;
    this.forgeGlow.material.opacity = (night ? 0.7 : 0.3) * f;
    const P = G.player, near = Math.hypot(P.pos.x - VILLAGE.x, P.pos.z - VILLAGE.z) < 120;
    if (!near) return;
    // the signs swing in the wind
    const w = G.wind.at ? G.wind.at(VILLAGE.x, VILLAGE.z) : { x: 0.5, z: 0 }, ws = Math.hypot(w.x, w.z);
    for (const s of this.signs) s.pivot.rotation.x = (0.05 + 0.08 * ws) * Math.sin(t * 1.3 + s.ph) + 0.03 * Math.sin(t * 3.1 + s.ph * 2);
    // smoke from the chimneys, leaning with the wind
    this.smokeT += dt;
    if (this.smokeT > 0.12) {
      this.smokeT = 0;
      for (const c of this.chimneys) if (Math.random() < c.k) G.particles.emit('chimney', c.p.x, c.p.y, c.p.z, w.x * 0.6 + (Math.random() - 0.5) * 0.2, 0.7 + Math.random() * 0.3, w.z * 0.6 + (Math.random() - 0.5) * 0.2, 0.3, 1);
      if (Math.random() < 0.5) G.particles.emit('ember', this.forge.x, this.forge.y, this.forge.z, (Math.random() - 0.5) * 0.4, 0.8 + Math.random(), (Math.random() - 0.5) * 0.4, 0.4, 1);
    }
    // the compass
    if (this.mark) this.mark.bearing = (Math.atan2(VILLAGE.x - P.pos.x, -(VILLAGE.z - P.pos.z)) * 180 / PI + 360) % 360;
  }
}

function mergeGeo(list) {
  const out = [];
  for (const g of list) { const n = g.index ? g.toNonIndexed() : g; out.push(n); }
  const pos = [], nrm = [], uv = [];
  for (const g of out) { pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
