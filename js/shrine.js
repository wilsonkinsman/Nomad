// The abandoned shrine in the Hollow of Falling Leaves. A weathered hall with a thick bark roof on a stone base,
// a mossy stone torii at the top of a flight of steps, stone lanterns (one fallen), a row of small red torii
// up to a little side shrine, a straw rope with paper streamers across the hall's front, and webs: in the
// torii, under the eaves, across the broken door, between the cedars. Someone's hat and sword lie by the steps.
// Something lives here (tsuchigumo.js).
//
// Everything is built in the shrine's own frame (x to the right, z out of the front, y up from the terrace),
// then merged into a few meshes by material. The roof is kept apart so it can give when something lands on it.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { groundY, SHRINE } from './world.js';
import { mulberry32, vnoise, GLSL_NOISE } from './util.js';

const CF = Math.cos(SHRINE.face), SF = Math.sin(SHRINE.face);
// shrine frame <-> world
export const shrineToWorld = (lx, lz) => [SHRINE.x + lx * CF + lz * SF, SHRINE.z - lx * SF + lz * CF];
export const worldToShrine = (x, z) => { const dx = x - SHRINE.x, dz = z - SHRINE.z; return [dx * CF - dz * SF, dx * SF + dz * CF]; };

// the hall, in the shrine frame
export const HALL = { z: -5, w: 5.2, d: 4.4, floor: 0.75, wall: 2.7, ridge: 5.65, eaveX: 3.55, eaveZ: 3.5 };
const TORII_Z = SHRINE.terrace + 0.3;

// stone: the rock texture laid on from above and both sides, moss on whatever faces up
function stoneMaterial(tx, color = 0xb0aaa0, moss = 0.9) {
  const m = new THREE.MeshStandardMaterial({ map: tx.rock.map, normalMap: tx.rock.normal, color, roughness: 0.95 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMossFloor = { value: groundY(SHRINE.x, SHRINE.z) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSN; varying vec3 vSP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSP = worldPosition.xyz; vSN = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vSN; varying vec3 vSP; uniform float uMossFloor;\n${GLSL_NOISE}`)
      .replace('#include <map_fragment>', `
        vec3 tp = abs(vSN); tp /= tp.x + tp.y + tp.z;
        vec3 rc = texture2D(map, vSP.yz * 0.45).rgb * tp.x + texture2D(map, vSP.xz * 0.45).rgb * tp.y + texture2D(map, vSP.xy * 0.45).rgb * tp.z;
        diffuseColor.rgb *= rc;
        float n = nNoise(vSP.xz * 2.3 + vSP.y * 1.7);
        float top = smoothstep(0.25, 0.8, vSN.y + (n - 0.5) * 0.6) * smoothstep(0.3, 0.62, nNoise(vSP.xz * 0.8 + 7.0) * 0.7 + n * 0.3);
        // moss on top, and creeping up from the ground in patches
        float creep = smoothstep(0.55, 0.0, vSP.y - uMossFloor) * smoothstep(0.35, 0.7, nNoise(vSP.xz * 1.1 + vSP.y * 0.8));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.13, 0.04) * (0.7 + 0.6 * n), clamp(max(top, creep), 0.0, 1.0) * ${moss.toFixed(2)});`);
  };
  return m;
}

// a web on a canvas: spokes from the hub between angles a0 and a1, the spiral strung between them, a few torn
function webTexture(corner) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), rnd = mulberry32(corner ? 17 : 23);
  const hx = corner ? 6 : S / 2, hy = corner ? 6 : S / 2, R = corner ? S * 0.97 : S * 0.48;
  const a0 = corner ? 0 : 0, a1 = corner ? Math.PI / 2 : Math.PI * 2, n = corner ? 9 : 22;
  const spokes = [];
  for (let i = 0; i < n; i++) spokes.push(a0 + (a1 - a0) * (corner ? i / (n - 1) : i / n) + (rnd() - 0.5) * 0.12);
  g.strokeStyle = 'rgba(236,238,242,0.95)'; g.lineCap = 'round';
  const len = spokes.map(() => R * (0.82 + rnd() * 0.18));
  g.lineWidth = 1.6;
  spokes.forEach((a, i) => { g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a) * len[i], hy + Math.sin(a) * len[i]); g.stroke(); });
  g.lineWidth = 2.4;
  for (let r = R * 0.07; r < R * 0.92; r += R * (0.035 + rnd() * 0.012)) {
    for (let i = 0; i < (corner ? n - 1 : n); i++) {
      if (rnd() < 0.07 || r > len[i] || r > len[(i + 1) % n]) continue;        // torn, or past the spoke
      const a = spokes[i], b = spokes[(i + 1) % n], sag = 0.93;
      const x0 = hx + Math.cos(a) * r, y0 = hy + Math.sin(a) * r, x1 = hx + Math.cos(b) * r, y1 = hy + Math.sin(b) * r;
      g.beginPath(); g.moveTo(x0, y0);
      g.quadraticCurveTo(hx + (x0 + x1 - 2 * hx) * 0.5 * sag, hy + (y0 + y1 - 2 * hy) * 0.5 * sag, x1, y1); g.stroke();
    }
  }
  // a few loose threads trailing off
  g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) { const a = a0 + rnd() * (a1 - a0), r = R * (0.3 + rnd() * 0.5); g.beginPath(); g.moveTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r); g.lineTo(hx + Math.cos(a + 0.5) * r * 1.3, hy + Math.sin(a + 0.5) * r * 1.3 + 40); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Shrine {
  constructor(game, tx) {
    this.game = game;
    this.colliders = [];
    this.baseY = groundY(SHRINE.x, SHRINE.z);
    const rnd = mulberry32(808);
    const M = {
      wood: new THREE.MeshStandardMaterial({ map: tx.wood.map, normalMap: tx.wood.normal, color: 0x7a6a5a, roughness: 0.93 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 1 }),
      roof: new THREE.MeshStandardMaterial({ map: tx.wood.map, normalMap: tx.wood.normal, color: 0x5c524a, roughness: 0.97, vertexColors: true }),
      stone: stoneMaterial(tx),
      red: new THREE.MeshStandardMaterial({ map: tx.wood.map, normalMap: tx.wood.normal, color: 0xc0472a, roughness: 0.75 }),
      black: new THREE.MeshStandardMaterial({ map: tx.wood.map, color: 0x2a2522, roughness: 0.8 }),
      rope: new THREE.MeshStandardMaterial({ map: tx.straw.map, normalMap: tx.straw.normal, color: 0xb8a070, roughness: 0.95 }),
      paper: new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.9, side: THREE.DoubleSide }),
      bone: new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.55, metalness: 0.6 }),
    };
    this.M = M;
    this.group = new THREE.Group();
    this.group.position.set(SHRINE.x, this.baseY, SHRINE.z); this.group.rotation.y = SHRINE.face;
    game.scene.add(this.group);

    // parts are laid out under `root` (the shrine frame), then merged by material
    const root = new THREE.Group(), roofRoot = new THREE.Group();
    const part = (parent, kind, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo); m.userData.kind = kind; m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    // the ground height under a point of the shrine frame, in the frame
    const gy = (lx, lz) => { const [x, z] = shrineToWorld(lx, lz); return groundY(x, z) - this.baseY; };
    const collide = (lx, lz, r) => { const [x, z] = shrineToWorld(lx, lz); this.colliders.push({ x, z, r }); };

    this.buildHall(root, roofRoot, part, box, rnd, collide);
    this.buildTorii(root, part, box, rnd, collide, gy);
    this.buildSteps(root, part, gy, rnd);
    this.buildLanterns(root, part, box, rnd, collide, gy);
    this.buildRedTorii(root, part, box, rnd, collide, gy);
    this.buildRemains(root, part, box, rnd, gy);

    const merge = (src, into) => {
      src.updateMatrixWorld(true);
      const lists = {};
      src.traverse((o) => {
        if (!o.isMesh) return;
        const k = o.userData.kind, c = o.geometry.clone().applyMatrix4(o.matrixWorld);
        if (k === 'roof' && !c.attributes.color) {                  // moss on the roof: green where the noise says
          const p = c.attributes.position, col = new Float32Array(p.count * 3);
          for (let i = 0; i < p.count; i++) {
            const n = vnoise(p.getX(i) * 0.9 + 3, p.getZ(i) * 0.9 + p.getY(i) * 0.6), m = Math.max(0, Math.min(1, (n - 0.42) * 3.2));
            col[i * 3] = 1 - 0.45 * m; col[i * 3 + 1] = 1 + 0.12 * m; col[i * 3 + 2] = 1 - 0.55 * m;
          }
          c.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        (lists[k] = lists[k] || []).push(c);
      });
      for (const [k, geos] of Object.entries(lists)) {
        const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), M[k]);
        mesh.castShadow = k !== 'dark'; mesh.receiveShadow = true;
        into.add(mesh);
      }
    };
    merge(root, this.group);
    this.roof = new THREE.Group(); this.roof.position.z = HALL.z; this.group.add(this.roof);
    merge(roofRoot, this.roof);
    this.sag = 0; this.sagV = 0;

    this.buildRope(M);
    this.buildWebs();
    this.debris = [];
    this.debrisGeo = box(0.5, 0.05, 0.22);
  }

  // ---------------------------------------------------------------- the hall
  buildHall(root, roofRoot, part, box, rnd, collide) {
    const H = HALL, hz = H.z, top = H.floor + H.wall;
    // stone base, plank floor and the veranda in front
    part(root, 'stone', box(H.w + 2.0, 0.62, H.d + 2.4), 0, 0.28, hz);
    part(root, 'wood', box(H.w + 1.3, 0.12, H.d + 1.0), 0, H.floor - 0.06, hz + 0.3);
    for (let i = 0; i < 3; i++) part(root, 'wood', box(1.8, 0.1, 0.42), 0, H.floor - 0.25 * (i + 1) + 0.05, hz + H.d / 2 + 0.95 + i * 0.36);
    part(root, 'wood', box(0.09, 0.8, 1.2), -0.92, 0.38, hz + H.d / 2 + 1.25, 0.6, 0, 0);
    part(root, 'wood', box(0.09, 0.8, 1.2), 0.92, 0.38, hz + H.d / 2 + 1.25, 0.6, 0, 0);
    // the dark inside (so the gaps in the walls show nothing but black)
    part(root, 'dark', box(H.w - 0.25, H.wall - 0.1, H.d - 0.25), 0, H.floor + H.wall / 2, hz);
    // posts
    const px = [-H.w / 2, -H.w / 6, H.w / 6, H.w / 2];
    for (const x of px) for (const z of [-H.d / 2, H.d / 2]) part(root, 'wood', box(0.24, H.wall + 0.15, 0.24), x, H.floor + H.wall / 2, hz + z);
    for (const s of [-1, 1]) part(root, 'wood', box(0.24, H.wall + 0.15, 0.24), s * H.w / 2, H.floor + H.wall / 2, hz);
    // beams round the top and the foot of the walls
    for (const y of [top - 0.05, H.floor + 0.12, top - 0.75]) {
      for (const s of [-1, 1]) part(root, 'wood', box(H.w + 0.5, 0.16, 0.16), 0, y, hz + s * (H.d / 2 + 0.02));
      for (const s of [-1, 1]) part(root, 'wood', box(0.16, 0.16, H.d + 0.5), s * (H.w / 2 + 0.02), y, hz);
    }
    // plank walls on three sides: some boards missing, some broken off short
    const planks = (len, along, place) => {
      for (let u = -len / 2 + 0.16; u < len / 2 - 0.1; u += 0.3) {
        const r = rnd();
        if (r < 0.07) continue;
        const h = r < 0.16 ? H.wall * (0.35 + rnd() * 0.4) : H.wall - 0.1;
        place(u, h, 0.27 + (rnd() - 0.5) * 0.02);
      }
    };
    planks(H.d, 'z', (u, h, w) => { for (const s of [-1, 1]) part(root, 'wood', box(0.06, h, w), s * H.w / 2, H.floor + h / 2, hz + u, 0, 0, (rnd() - 0.5) * 0.02); });
    planks(H.w, 'x', (u, h, w) => part(root, 'wood', box(w, h, 0.06), u, H.floor + h / 2, hz - H.d / 2, (rnd() - 0.5) * 0.02, 0, 0));
    // the front: lattice doors in the side bays; the middle pair hangs open, one door half off its runner
    const lattice = (x0, x1, z, tilt = 0, ox = 0) => {
      const g = new THREE.Group(); g.position.set((x0 + x1) / 2 + ox, H.floor, hz + z); g.rotation.z = tilt; root.add(g);
      const w = x1 - x0;
      part(g, 'wood', box(w, 0.08, 0.06), 0, 0.06, 0); part(g, 'wood', box(w, 0.08, 0.06), 0, H.wall - 0.15, 0);
      for (let x = -w / 2 + 0.04; x <= w / 2; x += w / Math.round(w / 0.14)) part(g, 'wood', box(0.035, H.wall - 0.2, 0.04), x, H.wall / 2 - 0.05, 0);
      for (let y = 0.4; y < H.wall - 0.2; y += 0.38) part(g, 'wood', box(w, 0.035, 0.04), 0, y, 0);
    };
    lattice(-H.w / 2 + 0.12, -H.w / 6 - 0.12, H.d / 2 + 0.03);
    lattice(H.w / 6 + 0.12, H.w / 2 - 0.12, H.d / 2 + 0.03);
    lattice(-H.w / 6 + 0.1, -0.02, H.d / 2 + 0.12, 0, -0.55);
    lattice(0.02, H.w / 6 - 0.1, H.d / 2 + 0.2, -0.16, 0.25);
    // an offering box before the steps, its lid split
    part(root, 'wood', box(1.0, 0.5, 0.55), 0, 0.25, hz + H.d / 2 + 2.3);
    part(root, 'wood', box(0.5, 0.05, 0.6), -0.26, 0.53, hz + H.d / 2 + 2.3, 0, 0, 0.08);
    part(root, 'wood', box(0.5, 0.05, 0.6), 0.3, 0.6, hz + H.d / 2 + 2.25, 0.1, 0.2, -0.35);
    // gable ends: a triangle of boards under the roof
    const run = H.eaveZ, rise = H.ridge - (top - 0.15), L = Math.hypot(run, rise) + 0.25, pitch = Math.atan2(rise, run);
    const hw = H.d / 2 + 0.1, apex = H.ridge - top - 0.4, tri = new THREE.Shape();
    tri.moveTo(-hw, 0); tri.lineTo(hw, 0); tri.lineTo(hw, Math.max(0.05, apex - hw * Math.tan(pitch))); tri.lineTo(0, apex); tri.lineTo(-hw, Math.max(0.05, apex - hw * Math.tan(pitch))); tri.closePath();
    for (const s of [-1, 1]) part(root, 'wood', new THREE.ExtrudeGeometry(tri, { depth: 0.08, bevelEnabled: false }), s * (H.w / 2 + 0.06), top, hz, 0, s * Math.PI / 2, 0);

    // ---- the roof (its own group, so it can give): two thick sagging slabs of bark, a ridge, crossed boards
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(H.eaveX * 2, 0.28, L, 18, 1, 12);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = (p.getZ(i) + L / 2) / L, ax = Math.abs(p.getX(i)) / H.eaveX;
        p.setY(i, p.getY(i) - 0.24 * Math.sin(Math.PI * u) + 0.22 * Math.pow(ax, 4) * u * u + (vnoise(p.getX(i) * 2.1, u * 9) - 0.5) * 0.05);
      }
      g.computeVertexNormals();
      g.rotateX(pitch); g.translate(0, H.ridge - (L / 2) * Math.sin(pitch), (L / 2) * Math.cos(pitch) - 0.12);
      if (s < 0) g.rotateY(Math.PI);
      part(roofRoot, 'roof', g);
    }
    part(roofRoot, 'black', box(H.eaveX * 2 + 0.3, 0.36, 0.5), 0, H.ridge + 0.12, 0);
    for (const x of [-2.4, -0.8, 0.8, 2.4]) part(roofRoot, 'black', new THREE.CylinderGeometry(0.15, 0.15, 0.95, 10), x, H.ridge + 0.42, 0, Math.PI / 2, 0, 0);
    for (const s of [-1, 1]) for (const t of [-1, 1]) part(roofRoot, 'black', box(0.12, 0.3, 2.2), s * (H.eaveX + 0.05), H.ridge + 0.35, 0, t * pitch, 0, 0);
    this.ridgeY = H.ridge + 0.5;

    // nothing walks into the hall: a ring of circles round the base and its steps
    const x0 = -(H.w + 2.0) / 2 + 0.45, x1 = -x0, z0 = hz - (H.d + 2.4) / 2 + 0.45, z1 = hz + (H.d + 2.4) / 2 - 0.45;
    for (let x = x0; x <= x1 + 1e-3; x += (x1 - x0) / 6) { collide(x, z0, 0.62); collide(x, z1, 0.62); }
    for (let z = z0; z <= z1 + 1e-3; z += (z1 - z0) / 5) { collide(x0, z, 0.62); collide(x1, z, 0.62); }
    for (const x of [-0.5, 0.5]) collide(x, hz + H.d / 2 + 1.5, 0.55);
    collide(0, hz + H.d / 2 + 2.3, 0.55);
  }

  // ---------------------------------------------------------------- the stone torii at the head of the steps
  buildTorii(root, part, box, rnd, collide, gy) {
    this.toriiBase = gy(0, TORII_Z);
    const g = new THREE.Group(); g.position.set(0, this.toriiBase, TORII_Z); g.rotation.z = 0.03; g.rotation.y = 0.04; root.add(g);
    const X = 2.0, Hh = 4.3;
    for (const s of [-1, 1]) {
      const p = new THREE.BoxGeometry(0.52, Hh, 0.52, 1, 6, 1);
      // a little taper and a carved, uneven face
      const a = p.attributes.position;
      for (let i = 0; i < a.count; i++) { const y = a.getY(i) / Hh + 0.5, k = 1 - 0.12 * y; a.setX(i, a.getX(i) * k); a.setZ(i, a.getZ(i) * k); }
      p.computeVertexNormals();
      part(g, 'stone', p, s * X, Hh / 2 - 0.15, 0, 0, 0, s * -0.012);
      part(g, 'stone', box(0.8, 0.35, 0.8), s * X, 0.05, 0);            // the plinth
      collide(s * X, TORII_Z, 0.42);
    }
    part(g, 'stone', box(X * 2 + 1.0, 0.34, 0.36), 0, Hh - 1.05, 0);    // nuki
    part(g, 'stone', box(0.34, 0.6, 0.34), 0, Hh - 0.62, 0);            // the strut where the name plate was
    const k = new THREE.BoxGeometry(X * 2 + 2.0, 0.42, 0.62, 16, 1, 1), a = k.attributes.position;
    for (let i = 0; i < a.count; i++) { const u = a.getX(i) / (X + 1.0); a.setY(i, a.getY(i) + 0.22 * Math.pow(Math.abs(u), 3)); }
    k.computeVertexNormals();
    part(g, 'stone', k, 0, Hh - 0.15, 0);                               // kasagi
    part(g, 'stone', box(X * 2 + 1.5, 0.22, 0.5), 0, Hh - 0.45, 0);     // shimaki
    // a broken corner of the kasagi lying at the foot of the right pillar
    part(g, 'stone', box(0.7, 0.36, 0.55), X + 0.9, 0.12, 0.7, 0.3, 0.7, 0.2);
    this.toriiTop = Hh;
  }

  // ---------------------------------------------------------------- the steps down to the trail
  buildSteps(root, part, gy, rnd) {
    const z0 = TORII_Z + 0.4, z1 = SHRINE.terrace + SHRINE.slope + 0.3, n = Math.max(4, Math.round((z1 - z0) / 0.46)), d = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      const zf = z0 + i * d;                         // back edge (uphill) of the tread
      const top = gy(0, zf) + 0.04, h = 0.5 + d * 0.6;
      const w = 3.2 + (rnd() - 0.5) * 0.2;
      part(root, 'stone', new THREE.BoxGeometry(w, h, d + 0.04), (rnd() - 0.5) * 0.08, top - h / 2, zf + d / 2, (rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.03);
      // the stones along the sides, sunk and tilted
      for (const s of [-1, 1]) if (rnd() < 0.7) part(root, 'stone', new THREE.BoxGeometry(0.42, 0.5, d * 0.9), s * (w / 2 + 0.25), gy(s * (w / 2 + 0.25), zf + d / 2) - 0.08, zf + d / 2, rnd() * 0.2, rnd(), rnd() * 0.3);
    }
    // flagstones from the torii to the hall
    for (let z = TORII_Z - 1.2, i = 0; z > HALL.z + HALL.d / 2 + 3.0; z -= 0.95 + rnd() * 0.25, i++) {
      const g = new THREE.CylinderGeometry(0.45 + rnd() * 0.12, 0.5, 0.14, 7);
      const a = g.attributes.position;
      for (let k = 0; k < a.count; k++) if (Math.abs(a.getY(k)) > 0.01) { const f = 1 + (vnoise(a.getX(k) * 4 + i, a.getZ(k) * 4) - 0.5) * 0.35; a.setX(k, a.getX(k) * f); a.setZ(k, a.getZ(k) * f); }
      g.computeVertexNormals();
      const x = (i % 2 ? 0.25 : -0.25) + (rnd() - 0.5) * 0.2;
      part(root, 'stone', g, x, gy(x, z) + 0.01, z, 0, rnd() * 3, 0);
    }
  }

  // ---------------------------------------------------------------- stone lanterns, one fallen
  buildLanterns(root, part, box, rnd, collide, gy) {
    const lantern = (lx, lz, fallen) => {
      const g = new THREE.Group(); root.add(g);
      g.position.set(lx, gy(lx, lz), lz); g.rotation.y = rnd() * 0.3;
      const P = (geo, y, ry = 0) => part(g, 'stone', geo, 0, y, 0, 0, ry, 0);
      P(new THREE.CylinderGeometry(0.42, 0.48, 0.24, 6), 0.12);
      P(new THREE.CylinderGeometry(0.14, 0.17, 1.0, 10), 0.74);
      P(new THREE.CylinderGeometry(0.38, 0.3, 0.16, 6), 1.3);
      P(box(0.5, 0.42, 0.5), 1.59);
      for (const ry of [0, Math.PI / 2]) part(g, 'dark', box(0.26, 0.24, 0.52), 0, 1.6, 0, 0, ry, 0);
      const cap = new THREE.Group(); g.add(cap); cap.position.y = 1.8;
      part(cap, 'stone', new THREE.ConeGeometry(0.6, 0.34, 6), 0, 0.17, 0);
      part(cap, 'stone', new THREE.SphereGeometry(0.11, 8, 6), 0, 0.42, 0);
      if (fallen) {
        // over on its side, the cap rolled off a little way
        g.rotation.set(0, 0.6, Math.PI / 2 - 0.08); g.position.y += 0.4; g.position.x += 0.7;
        g.remove(cap); root.add(cap); cap.position.set(lx + 2.6, gy(lx + 2.6, lz + 0.8) + 0.2, lz + 0.8); cap.rotation.set(0.5, 0.3, 2.4);
      } else collide(lx, lz, 0.45);
    };
    const fz = HALL.z + HALL.d / 2 + 3.6;
    lantern(-2.9, fz, false); lantern(2.9, fz, true);
    lantern(-3.0, TORII_Z - 2.2, false); lantern(3.0, TORII_Z - 2.2, false);
  }

  // ---------------------------------------------------------------- the row of small red torii and the side shrine
  buildRedTorii(root, part, box, rnd, collide, gy) {
    const a = [-6.6, -2.4], b = [-9.6, -8.4], n = 6;
    const dir = Math.atan2(b[0] - a[0], b[1] - a[1]);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const g = new THREE.Group(); g.position.set(x, gy(x, z), z); g.rotation.y = dir + (rnd() - 0.5) * 0.06; g.rotation.z = (rnd() - 0.5) * 0.05; root.add(g);
      const H = 2.45 - t * 0.25, X = 0.78;
      for (const s of [-1, 1]) {
        part(g, 'red', new THREE.CylinderGeometry(0.1, 0.11, H, 10), s * X, H / 2 - 0.05, 0);
        part(g, 'black', new THREE.CylinderGeometry(0.13, 0.13, 0.28, 10), s * X, 0.1, 0);
        const [wx, wz] = shrineToWorld(x + Math.sin(dir + Math.PI / 2) * s * X, z + Math.cos(dir + Math.PI / 2) * s * X);
        this.colliders.push({ x: wx, z: wz, r: 0.16 });
      }
      part(g, 'red', box(X * 2 + 0.5, 0.14, 0.15), 0, H - 0.5, 0);
      const k = new THREE.BoxGeometry(X * 2 + 0.95, 0.16, 0.24, 10, 1, 1), p = k.attributes.position;
      for (let j = 0; j < p.count; j++) p.setY(j, p.getY(j) + 0.08 * Math.pow(Math.abs(p.getX(j)) / (X + 0.47), 2));
      k.computeVertexNormals();
      part(g, 'black', k, 0, H + 0.02, 0);
      part(g, 'red', box(X * 2 + 0.7, 0.12, 0.2), 0, H - 0.14, 0);
    }
    // the little shrine at the end of the row
    const hx = b[0] + Math.sin(dir) * 1.5, hzz = b[1] + Math.cos(dir) * 1.5;
    const g = new THREE.Group(); g.position.set(hx, gy(hx, hzz), hzz); g.rotation.y = dir + Math.PI; root.add(g);
    part(g, 'stone', box(1.2, 0.5, 1.0), 0, 0.25, 0);
    part(g, 'wood', box(0.75, 0.65, 0.6), 0, 0.82, 0);
    part(g, 'dark', box(0.4, 0.4, 0.05), 0, 0.82, 0.29);
    for (const s of [-1, 1]) part(g, 'roof', box(1.05, 0.08, 0.6), 0, 1.3, s * 0.21, s * 0.55, 0, 0);
    collide(hx, hzz, 0.7);
  }

  // ---------------------------------------------------------------- what's left of the last one who came
  buildRemains(root, part, box, rnd, gy) {
    // a straw hat by the top of the steps, a sword in the ground, bones
    const hx = 3.6, hz = TORII_Z - 3.6;
    part(root, 'rope', new THREE.ConeGeometry(0.42, 0.17, 18, 1, true), hx, gy(hx, hz) + 0.08, hz, 0.35, 0.4, 0.12);
    const sx = -2.4, sz = HALL.z + HALL.d / 2 + 5.4;
    const s = new THREE.Group(); s.position.set(sx, gy(sx, sz), sz); s.rotation.set(0.22, 0.6, 0.12); root.add(s);
    part(s, 'steel', box(0.035, 0.75, 0.01), 0, 0.22, 0);
    part(s, 'black', new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), 0, 0.6, 0);
    part(s, 'black', box(0.04, 0.26, 0.03), 0, 0.75, 0);
    for (let i = 0; i < 7; i++) {
      const bx = 1.5 + rnd() * 4, bz = HALL.z + HALL.d / 2 + 1.2 + rnd() * 5.5;
      part(root, 'bone', new THREE.CapsuleGeometry(0.03 + rnd() * 0.02, 0.22 + rnd() * 0.3, 3, 6), bx, gy(bx, bz) + 0.03, bz, Math.PI / 2, rnd() * 3, 0);
    }
    const sk = new THREE.SphereGeometry(0.11, 10, 8); sk.scale(1, 0.85, 1.25);
    part(root, 'bone', sk, 4.4, gy(4.4, HALL.z + 6) + 0.07, HALL.z + 6, 0.3, 1.2, 0.2);
  }

  // ---------------------------------------------------------------- the rope and its streamers across the front
  buildRope(M) {
    const H = HALL, z = H.z + H.d / 2 + 0.2, y = H.floor + H.wall - 0.25;
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, x = (t - 0.5) * (H.w + 0.2); pts.push(new THREE.Vector3(x, y - 0.42 * Math.sin(Math.PI * t), z)); }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.1, 8), M.rope);
    rope.castShadow = true; this.group.add(rope);
    // shide: zigzag paper, hung at four points; they sway (and leap when the roof is hit)
    this.shide = [];
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const x = (t - 0.5) * (H.w + 0.2), yy = y - 0.42 * Math.sin(Math.PI * t) - 0.08;
      const g = new THREE.Group(); g.position.set(x, yy, z + 0.02); this.group.add(g);
      const geos = [];
      for (let k = 0; k < 4; k++) { const q = new THREE.PlaneGeometry(0.14, 0.13); q.rotateY((k % 2 ? 1 : -1) * 0.5); q.translate((k % 2 ? 0.05 : -0.05), -0.07 - k * 0.12, 0); geos.push(q); }
      const m = new THREE.Mesh(mergeGeometries(geos), M.paper); m.castShadow = true; g.add(m);
      this.shide.push({ g, ph: Math.random() * 6, kick: 0 });
    }
  }

  // ---------------------------------------------------------------- webs
  buildWebs() {
    const G = this.game, orb = webTexture(false), corner = webTexture(true);
    const mat = (t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.5, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide, roughness: 0.5, emissive: 0x08080a, color: 0xc8ccd2 });
    const orbM = mat(orb), cornerM = mat(corner);
    this.webs = [];
    const web = (parent, m, w, h, x, y, z, ry = 0, rz = 0) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.set(0, ry, rz); p.renderOrder = 3;
      parent.add(p); this.webs.push(p); return p;
    };
    // the torii: the upper corners of the way through (the hub sits in the corner)
    const ty = this.toriiBase + this.toriiTop - 1.22;          // under the nuki, against the left pillar
    web(this.group, cornerM, 1.3, 1.3, -1.77 + 0.65, ty - 0.65, TORII_Z);
    // under the hall's eaves, at both front corners, and across the broken door
    const H = HALL, fz = H.z + H.d / 2 + 0.16, top = H.floor + H.wall;
    web(this.group, cornerM, 1.2, 1.2, -H.w / 2 + 0.72, top - 0.72, fz);
    web(this.group, cornerM, 1.2, 1.2, H.w / 2 - 0.72, top - 0.72, fz, 0, -Math.PI / 2);
    web(this.group, orbM, 1.6, 1.6, -0.05, H.floor + 1.55, fz + 0.12);
    web(this.group, cornerM, 1.4, 1.4, H.w / 2 + 0.2, top - 0.72, H.z - 0.2, Math.PI / 2);
    // between the cedars that stand close together round the clearing
    const cedars = (G.trees?.list || []).filter((t) => t.kind === 'cedar');
    let n = 0;
    for (let i = 0; i < cedars.length && n < 7; i++) for (let j = i + 1; j < cedars.length && n < 7; j++) {
      const a = cedars[i], b = cedars[j], d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 3.6 || d > 8) continue;
      const s = d - 0.9, y = Math.min(groundY(a.x, a.z), groundY(b.x, b.z)) + s * 0.5 + 1.2 + (n % 3) * 0.7;
      const p = web(G.scene, orbM, s, s, (a.x + b.x) / 2, y, (a.z + b.z) / 2, Math.atan2(-(b.z - a.z), b.x - a.x), n * 0.7);
      p.scale.y = 0.85; n++;
    }
  }

  // ---------------------------------------------------------------- something heavy lands on the roof
  impact(power = 1) {
    const G = this.game;
    this.sagV -= 1.6 * power;
    for (const s of this.shide) s.kick = 1;
    const [cx, cz] = shrineToWorld(0, HALL.z);
    // boards and bark thrown off the eaves, and dust off the whole roof
    for (let i = 0; i < 14; i++) {
      const lx = (Math.random() - 0.5) * HALL.eaveX * 2, lz = HALL.z + (Math.random() < 0.5 ? -1 : 1) * HALL.eaveZ * (0.7 + Math.random() * 0.3);
      const [x, z] = shrineToWorld(lx, lz), m = new THREE.Mesh(this.debrisGeo, this.M.black);
      m.position.set(x, this.baseY + 3.6 + Math.random() * 0.6, z); m.castShadow = true; G.scene.add(m);
      const ox = x - cx, oz = z - cz, l = Math.hypot(ox, oz) || 1;
      this.debris.push({ m, v: new THREE.Vector3(ox / l * (2 + Math.random() * 3), 2 + Math.random() * 3, oz / l * (2 + Math.random() * 3)), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), t: 0, rest: 0 });
    }
    for (let i = 0; i < 40; i++) {
      const [x, z] = shrineToWorld((Math.random() - 0.5) * 7, HALL.z + (Math.random() - 0.5) * 7);
      G.particles.emit('dust', x, this.baseY + 3.8 + Math.random() * 1.6, z, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 3, 1.5, 1);
    }
  }

  update(dt, game) {
    const t = game.time;
    // the roof springs back from a blow, settling a little lower each time
    this.sagV += (-this.sag * 140 - this.sagV * 9) * dt; this.sag += this.sagV * dt;
    this.roof.position.y = this.sag * 0.12 - (this.settled || 0);
    if (this.sagV < -1 && !this.settled) this.settled = 0.1;
    const w = game.wind.at(SHRINE.x, SHRINE.z);
    for (const s of this.shide) {
      s.kick = Math.max(0, s.kick - dt * 0.7);
      s.g.rotation.x = Math.sin(t * 2.3 + s.ph) * (0.1 + 0.04 * Math.hypot(w.x, w.z)) + Math.sin(t * 13 + s.ph) * 0.6 * s.kick;
      s.g.rotation.z = Math.sin(t * 1.7 + s.ph * 2) * 0.06 + Math.sin(t * 11 + s.ph) * 0.3 * s.kick;
    }
    for (const p of this.webs) p.rotation.x = Math.sin(t * 1.3 + p.position.x) * 0.04;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.t += dt;
      if (!d.rest) {
        d.v.y -= 13 * dt; d.m.position.addScaledVector(d.v, dt);
        d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
        const gy = groundY(d.m.position.x, d.m.position.z);
        if (d.m.position.y < gy + 0.03) { d.m.position.y = gy + 0.03; d.m.rotation.x = 0; d.m.rotation.z = 0; d.rest = d.t; }
      } else if (d.t - d.rest > 20) { d.m.position.y -= dt * 0.05; if (d.t - d.rest > 24) { game.scene.remove(d.m); this.debris.splice(i, 1); } }
    }
  }
}
