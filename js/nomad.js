// The nomad: a procedural skinned body under many layers.
// Straw kasa over a deep hood, a face wrap, fur collar and wool cowl, an oxblood coat with
// crossed collar, indigo sash, leather belt, bandolier and pouches, baggy trousers, linen leg
// wraps, tall boots, bracers and gloves, a bedroll, a katana and a gourd. The cloak, the coat
// tails, the scarf and the sash ends are simulated cloth.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { Cloth } from './cloth.js';
import { mulberry32, smoothstep } from './util.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ------------------------------------------------------------------ skeleton (bind pose, faces +Z)
const J = {
  hips: [0, 0.97, 0], spine: [0, 1.09, -0.01], chest: [0, 1.27, -0.02], neck: [0, 1.47, -0.02], head: [0, 1.57, 0.0], headEnd: [0, 1.79, 0.0],
};
for (const s of [1, -1]) {
  const L = s > 0 ? 'L' : 'R';
  Object.assign(J, {
    ['shoulder_' + L]: [s * 0.05, 1.43, -0.02], ['upperarm_' + L]: [s * 0.185, 1.42, -0.03], ['forearm_' + L]: [s * 0.215, 1.14, -0.04],
    ['hand_' + L]: [s * 0.235, 0.895, -0.025], ['handEnd_' + L]: [s * 0.243, 0.77, -0.005],
    ['thigh_' + L]: [s * 0.092, 0.94, 0.0], ['shin_' + L]: [s * 0.098, 0.52, 0.012], ['foot_' + L]: [s * 0.1, 0.085, -0.01], ['toe_' + L]: [s * 0.1, 0.02, 0.15],
  });
}
const PARENT = { hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck' };
const END = { hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: 'headEnd' };
for (const L of ['L', 'R']) {
  Object.assign(PARENT, { ['shoulder_' + L]: 'chest', ['upperarm_' + L]: 'shoulder_' + L, ['forearm_' + L]: 'upperarm_' + L, ['hand_' + L]: 'forearm_' + L,
    ['thigh_' + L]: 'hips', ['shin_' + L]: 'thigh_' + L, ['foot_' + L]: 'shin_' + L });
  Object.assign(END, { ['shoulder_' + L]: 'upperarm_' + L, ['upperarm_' + L]: 'forearm_' + L, ['forearm_' + L]: 'hand_' + L, ['hand_' + L]: 'handEnd_' + L,
    ['thigh_' + L]: 'shin_' + L, ['shin_' + L]: 'foot_' + L, ['foot_' + L]: 'toe_' + L });
}
export const BONES = Object.keys(PARENT);
export const LEG = { L1: 0.42, L2: 0.435, ankle: 0.085, hip: 0.97 };
const LEG_NOMAD = { ...LEG };
// the rig tables are shared with atsu.js, which retargets this skeleton onto a Mixamo-style one
export { J, PARENT, END };

// ------------------------------------------------------------------ geometry helpers
// tube along a polyline with elliptical sections; rx along the side axis, rz along the "front" axis
function tube(pts, radii, segs = 14, o = {}) {
  const P = pts.map(V3), n = P.length;
  const fwdRef = o.fwd ? V3(o.fwd) : new THREE.Vector3(0, 0, 1);
  const a0 = o.arc ? o.arc[0] : 0, a1 = o.arc ? o.arc[1] : Math.PI * 2, closed = !o.arc;
  const ring = closed ? segs : segs + 1;
  const pos = [], uv = [], idx = [];
  let len = 0;
  for (let j = 0; j < n; j++) {
    if (j > 0) len += P[j].distanceTo(P[j - 1]);
    const t = new THREE.Vector3().subVectors(P[Math.min(n - 1, j + 1)], P[Math.max(0, j - 1)]).normalize();
    const Z = fwdRef.clone().addScaledVector(t, -t.dot(fwdRef)).normalize();
    const X = new THREE.Vector3().crossVectors(t, Z);
    const r = Array.isArray(radii[0]) ? radii[j] : radii;
    const rx = typeof r === 'number' ? r : r[0], rz = typeof r === 'number' ? r : r[1];
    for (let i = 0; i < ring; i++) {
      const th = a0 + (a1 - a0) * i / (closed ? segs : segs);
      const k = o.shape ? o.shape(th, j) : 1;
      const p = P[j].clone().addScaledVector(X, Math.cos(th) * rx * k).addScaledVector(Z, Math.sin(th) * rz * k);
      pos.push(p.x, p.y, p.z);
      uv.push(th / (Math.PI * 2) * (rx + rz) * Math.PI, len);
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < (closed ? segs : segs); i++) {
    const i2 = closed ? (i + 1) % segs : i + 1;
    const a = j * ring + i, b = (j + 1) * ring + i, c = j * ring + i2, d = (j + 1) * ring + i2;
    idx.push(a, b, c, c, b, d);
  }
  const addCap = (j, flip) => {
    const ci = pos.length / 3; pos.push(P[j].x, P[j].y, P[j].z); uv.push(0, len * (j ? 1 : 0));
    for (let i = 0; i < segs; i++) {
      const a = j * ring + i, c = j * ring + (i + 1) % segs;
      flip ? idx.push(ci, c, a) : idx.push(ci, a, c);
    }
  };
  if (o.capStart) addCap(0, false);
  if (o.capEnd) addCap(n - 1, true);
  return finish(pos, uv, idx);
}

function finish(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function ellipsoid(c, r, ws = 18, hs = 12) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(r[0], r[1], r[2]); g.translate(c[0], c[1], c[2]);
  return g;
}

function box(c, s, rot = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(s[0], s[1], s[2], 2, 2, 2);
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

// closed loop tube (collar ring)
function loop(center, rx, rz, r, segs = 28, rsegs = 8) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = i / segs * Math.PI * 2;
    pts.push([center[0] + Math.cos(a) * rx, center[1], center[2] + Math.sin(a) * rz]);
  }
  return tube(pts, r, rsegs, { fwd: [0, 1, 0] });
}

// ------------------------------------------------------------------ automatic skin weights
const boneIndex = Object.fromEntries(BONES.map((b, i) => [b, i]));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();
function segDist(p, a, b) {
  _a.copy(b).sub(a); const t = Math.max(0, Math.min(1, _p.copy(p).sub(a).dot(_a) / _a.lengthSq()));
  return _p.copy(a).addScaledVector(_a, t).distanceTo(p);
}
// bones: list of names; side: filter so left pieces never pull right bones
function skin(g, bones, o = {}) {
  const pos = g.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
  const p = new THREE.Vector3();
  const segs = bones.map(b => ({ b, i: boneIndex[b], a: V3(J[b]), e: V3(J[END[b]]) }));
  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(pos, v);
    let cand = segs;
    if (o.sided) cand = segs.filter(s => !/_([LR])$/.test(s.b) || (s.b.endsWith('_L') ? p.x > -0.02 : p.x < 0.02));
    const ds = cand.map(s => ({ i: s.i, d: segDist(p, s.a, s.e) })).sort((x, y) => x.d - y.d).slice(0, 3);
    let tot = 0;
    for (const d of ds) { d.w = 1 / Math.pow(Math.max(d.d, 0.004), o.power || 5); tot += d.w; }
    ds.forEach((d, k) => { si[v * 4 + k] = d.i; sw[v * 4 + k] = d.w / tot; });
    // dust gathers toward the hems
    const dust = o.nodust ? 0 : smoothstep(0.75, 0.05, p.y) * (o.dust ?? 0.35);
    col[v * 3] = 1 - dust * 0.28; col[v * 3 + 1] = 1 - dust * 0.34; col[v * 3 + 2] = 1 - dust * 0.42;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
function rigid(g, bone, o = {}) {
  const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3).fill(1);
  for (let v = 0; v < n; v++) { si[v * 4] = boneIndex[bone]; sw[v * 4] = 1; }
  if (!g.index) g = g.toNonIndexed ? g : g;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const norm = (g) => { if (!g.index) { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); } for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color'].includes(k)) g.deleteAttribute(k); return g; };

// ------------------------------------------------------------------ textures only the nomad uses
function cloakAlpha() {
  // weave detail in rgb, ragged hem in alpha
  const W = 256, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data, rnd = mulberry32(3);
  const cuts = []; for (let i = 0; i < 26; i++) cuts.push([rnd() * W, 18 + rnd() * 60, 4 + rnd() * 14]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4, v = 255 - (((x * 7) ^ (y * 5)) & 15) - (rnd() * 18 | 0);
    d[k] = d[k + 1] = d[k + 2] = v;
    let a = 255;
    const fromBottom = y;   // canvas top = uv v 1 (flipY) ... bottom rows of the cloth are v≈0 -> canvas bottom
    const yy = H - 1 - fromBottom;
    for (const [cx, depth, w] of cuts) {
      const dx = Math.abs(x - cx);
      if (dx < w && yy < depth * (1 - dx / w)) a = 0;
    }
    if (yy < 6 + 5 * Math.sin(x * 0.3) + 4 * Math.sin(x * 0.11)) a = 0;
    d[k + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function wrapTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cfc4ad'; ctx.fillRect(0, 0, S, S);
  for (let i = -S; i < S * 2; i += 16) {
    const g = ctx.createLinearGradient(0, i, 0, i + 16);
    g.addColorStop(0, 'rgba(60,50,40,0.45)'); g.addColorStop(0.2, 'rgba(255,255,255,0.05)'); g.addColorStop(0.8, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(60,50,40,0.35)');
    ctx.save(); ctx.translate(0, 0); ctx.transform(1, 0.35, 0, 1, 0, 0); ctx.fillStyle = g; ctx.fillRect(-S, i, S * 3, 16); ctx.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ the model
export class Nomad {
  constructor(tx) {
    this.activate();
    this.group = new THREE.Group();          // world position (feet) + heading
    this.pivot = new THREE.Group();          // whole-body pitch/roll for dives and rolls
    this.body = new THREE.Group();
    this.group.add(this.pivot); this.pivot.add(this.body);
    this.pivotY = 0.95;
    this.pivot.position.y = this.pivotY; this.body.position.y = -this.pivotY;

    // bones
    this.bones = {};
    for (const b of BONES) {
      const bone = new THREE.Bone(); bone.name = b;
      const par = PARENT[b];
      const w = J[b], pw = par ? J[par] : [0, 0, 0];
      bone.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
      this.bones[b] = bone;
      if (par) this.bones[par].add(bone);
    }
    this.body.add(this.bones.hips);
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(BONES.map(b => this.bones[b]));
    this.rest = Object.fromEntries(BONES.map(b => [b, this.bones[b].position.clone()]));

    const M = this.materials(tx);
    this.M = M;
    const parts = {};
    const put = (mat, g) => { (parts[mat] = parts[mat] || []).push(norm(g)); };
    const S = (g, bones, o) => skin(g, bones, o);

    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      const x = (v) => s * v;
      // boots
      put('leather', S(tube([[x(0.1), 0.41, 0.006], [x(0.1), 0.3, 0.0], [x(0.1), 0.18, -0.006], [x(0.1), 0.11, 0.0]], [[0.068, 0.072], [0.059, 0.063], [0.055, 0.058], [0.057, 0.066]], 14), ['shin_' + L, 'foot_' + L]));
      put('leather', S(tube([[x(0.1), 0.445, 0.006], [x(0.1), 0.395, 0.006]], [[0.077, 0.081], [0.073, 0.077]], 14, { capStart: true }), ['shin_' + L]));
      put('leather', S(tube([[x(0.1), 0.078, -0.075], [x(0.1), 0.072, -0.02], [x(0.1), 0.062, 0.06], [x(0.1), 0.046, 0.13], [x(0.1), 0.036, 0.168]],
        [[0.046, 0.056], [0.051, 0.06], [0.053, 0.046], [0.046, 0.034], [0.028, 0.02]], 12, { fwd: [0, 1, 0], capStart: true, capEnd: true }), ['foot_' + L, 'shin_' + L]));
      // leg wraps over the shin
      put('wrap', S(tube([[x(0.099), 0.6, 0.014], [x(0.099), 0.52, 0.014], [x(0.1), 0.43, 0.008]], [[0.072, 0.077], [0.068, 0.073], [0.071, 0.075]], 14), ['thigh_' + L, 'shin_' + L]));
      // baggy trousers
      put('trousers', S(tube([[x(0.088), 1.01, 0.0], [x(0.094), 0.88, 0.006], [x(0.097), 0.74, 0.012], [x(0.099), 0.63, 0.02], [x(0.099), 0.57, 0.016]],
        [[0.108, 0.118], [0.104, 0.114], [0.094, 0.104], [0.083, 0.091], [0.074, 0.079]], 14), ['hips', 'thigh_' + L, 'shin_' + L], { sided: true }));
      // sleeves
      put('coat', S(tube([[x(0.13), 1.445, -0.03], [x(0.19), 1.41, -0.03], [x(0.205), 1.28, -0.035], [x(0.214), 1.15, -0.04], [x(0.226), 1.03, -0.035], [x(0.234), 0.955, -0.03]],
        [[0.075, 0.074], [0.076, 0.077], [0.072, 0.074], [0.068, 0.07], [0.066, 0.068], [0.071, 0.073]], 14), ['chest', 'shoulder_' + L, 'upperarm_' + L, 'forearm_' + L], { sided: true, power: 4 }));
      // bracers
      put('leather', S(tube([[x(0.219), 1.1, -0.04], [x(0.228), 1.01, -0.035], [x(0.236), 0.935, -0.03]], [[0.074, 0.076], [0.072, 0.074], [0.069, 0.071]], 14), ['forearm_' + L]));
      put('metal', S(tube([[x(0.228), 1.03, -0.035], [x(0.229), 1.02, -0.035]], [[0.076, 0.078], [0.076, 0.078]], 14), ['forearm_' + L]));
      // gloved hands
      put('glove', S(tube([[x(0.236), 0.91, -0.026], [x(0.24), 0.862, -0.018], [x(0.242), 0.812, -0.01], [x(0.243), 0.772, -0.005]],
        [[0.029, 0.044], [0.028, 0.049], [0.026, 0.047], [0.019, 0.035]], 10, { capEnd: true }), ['hand_' + L, 'forearm_' + L]));
      put('glove', S(tube([[x(0.228), 0.875, 0.02], [x(0.232), 0.845, 0.032], [x(0.236), 0.822, 0.036]], [0.013, 0.013], 8, { capEnd: true }), ['hand_' + L]));
      // pouches on the belt
      put('leather', rigid(box([x(0.155), 0.875, 0.085], [0.075, 0.095, 0.045], [0, x(0.6), 0]), 'hips'));
      put('metal', rigid(box([x(0.155), 0.905, 0.108], [0.02, 0.02, 0.008], [0, x(0.6), 0]), 'hips'));
      // eyes
      put('eye', rigid(ellipsoid([x(0.031), 1.686, 0.087], [0.011, 0.008, 0.008], 10, 8), 'head'));
    }
    // pelvis of the trousers
    put('trousers', S(tube([[0, 1.05, -0.005], [0, 0.95, -0.005], [0, 0.87, 0.0]], [[0.172, 0.132], [0.178, 0.136], [0.14, 0.11]], 20, { capEnd: true }), ['hips', 'thigh_L', 'thigh_R'], { sided: true }));
    // coat torso
    put('coat', S(tube([[0, 0.9, -0.01], [0, 1.0, -0.01], [0, 1.12, -0.015], [0, 1.26, -0.02], [0, 1.38, -0.025], [0, 1.445, -0.03], [0, 1.49, -0.025], [0, 1.525, -0.015]],
      [[0.176, 0.136], [0.17, 0.13], [0.164, 0.127], [0.18, 0.14], [0.19, 0.137], [0.186, 0.122], [0.122, 0.096], [0.074, 0.076]], 24), ['hips', 'spine', 'chest', 'neck']));
    // crossed kimono collar in pale linen
    put('linen', S(tube([[-0.058, 1.515, 0.045], [-0.012, 1.425, 0.125], [0.048, 1.29, 0.148], [0.1, 1.13, 0.138], [0.125, 1.0, 0.13]], [0.02, 0.006], 8), ['neck', 'chest', 'spine', 'hips']));
    put('linen', S(tube([[0.058, 1.515, 0.045], [0.032, 1.445, 0.115], [0.0, 1.38, 0.14]], [0.018, 0.006], 8), ['neck', 'chest']));
    // sash, belt, buckle, knot
    put('sash', S(tube([[0, 1.075, -0.012], [0, 0.955, -0.012]], [[0.183, 0.143], [0.185, 0.145]], 24), ['hips', 'spine']));
    put('sash', rigid(ellipsoid([0.085, 1.0, -0.148], [0.07, 0.05, 0.035]), 'hips'));
    put('leather', S(tube([[0, 0.948, -0.01], [0, 0.915, -0.01]], [0.19, 0.15], 24), ['hips']));
    put('metal', rigid(box([0, 0.932, 0.151], [0.05, 0.038, 0.012]), 'hips'));
    // bandolier, front and back
    put('leather', S(tube([[0.135, 1.445, 0.07], [0.06, 1.33, 0.148], [-0.04, 1.2, 0.145], [-0.12, 1.06, 0.12], [-0.18, 0.97, 0.0]], [0.022, 0.006], 6), ['chest', 'spine', 'hips']));
    put('leather', S(tube([[0.135, 1.445, -0.1], [0.04, 1.32, -0.168], [-0.07, 1.18, -0.162], [-0.15, 1.04, -0.105], [-0.18, 0.97, 0.0]], [0.022, 0.006], 6, { fwd: [0, 0, -1] }), ['chest', 'spine', 'hips']));
    // head, face wrap, hood, cowl
    put('skin', S(ellipsoid([0, 1.665, 0.008], [0.083, 0.108, 0.097]), ['head', 'neck']));
    put('skin', S(tube([[0, 1.47, -0.02], [0, 1.6, -0.01]], 0.052, 12), ['neck', 'head']));
    put('mask', S(tube([[0, 1.668, 0.02], [0, 1.64, 0.018], [0, 1.6, 0.01], [0, 1.555, 0.0], [0, 1.5, -0.005]],
      [[0.09, 0.118], [0.092, 0.116], [0.088, 0.106], [0.08, 0.092], [0.09, 0.1]], 16, { arc: [0.15, Math.PI - 0.15] }), ['head', 'neck']));
    // crimson neck wrap under the fur, the scarf's tails hang from it
    put('scarfWrap', S(loop([0, 1.515, -0.025], 0.1, 0.1, 0.035, 24, 8), ['neck', 'chest']));
    put('hood', S(tube([[0, 1.828, -0.005], [0, 1.818, 0.0], [0, 1.795, 0.006], [0, 1.765, 0.01], [0, 1.735, 0.012]],
      [[0.015, 0.015], [0.06, 0.066], [0.094, 0.106], [0.113, 0.126], [0.121, 0.134]], 22, { capStart: true }), ['head']));
    put('hood', S(tube([[0, 1.735, 0.012], [0, 1.69, 0.008], [0, 1.64, -0.002], [0, 1.595, -0.012], [0, 1.55, -0.02], [0, 1.515, -0.025]],
      [[0.121, 0.134], [0.124, 0.136], [0.119, 0.13], [0.108, 0.118], [0.112, 0.114], [0.135, 0.125]], 22,
      { arc: [Math.PI * 0.7, Math.PI * 2.3], shape: (th, j) => 1 + 0.06 * Math.max(0, -Math.sin(th)) * (j / 5) }), ['head', 'neck']));
    // brow ridge and nose under the wrap so the face has form in the shadow of the hat
    put('skin', S(ellipsoid([0, 1.707, 0.083], [0.058, 0.014, 0.018]), ['head']));
    put('skin', S(ellipsoid([0, 1.672, 0.098], [0.013, 0.024, 0.014]), ['head']));
    put('hood', S(tube([[0, 1.54, -0.025], [0, 1.49, -0.03], [0, 1.44, -0.035], [0, 1.395, -0.035]], [[0.13, 0.12], [0.2, 0.15], [0.262, 0.168], [0.278, 0.176]], 26),
      ['neck', 'chest', 'shoulder_L', 'shoulder_R', 'upperarm_L', 'upperarm_R'], { sided: true, power: 3 }));
    // fur collar ring
    put('fur', S(loop([0, 1.5, -0.03], 0.15, 0.135, 0.05), ['neck', 'chest']));
    // bedroll across the back
    const roll = new THREE.CylinderGeometry(0.072, 0.072, 0.34, 16, 1).rotateZ(Math.PI / 2).translate(0, 1.3, -0.21);
    put('roll', rigid(roll, 'chest'));
    for (const sx of [-0.1, 0.1]) put('leather', rigid(new THREE.CylinderGeometry(0.076, 0.076, 0.022, 16).rotateZ(Math.PI / 2).translate(sx, 1.3, -0.21), 'chest'));

    // build one skinned mesh per material
    this.meshes = [];
    for (const [mat, list] of Object.entries(parts)) {
      const g = mergeGeometries(list, false);
      if (!g) { console.warn('merge failed', mat); continue; }
      const m = new THREE.SkinnedMesh(g, M[mat]);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      m.bind(this.skeleton, new THREE.Matrix4());
      this.body.add(m);
      this.meshes.push(m);
    }

    // fur cards around the collar, the straw hat, the katana, the gourd: rigid props on bones
    this.addFur(tx);
    this.addHat(tx);
    this.addKatana();
    this.addGourd();

    // cloth
    this.cloths = [];
    this.clothGroup = new THREE.Group();
    this.colliders = [];
    this.buildCloth(tx);
  }

  materials(tx) {
    const fab = (color, o = {}) => {
      const m = new (o.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
        color, roughness: o.rough ?? 0.92, metalness: 0, map: tx.fabric.map, normalMap: tx.fabric.normal, vertexColors: true,
        normalScale: new THREE.Vector2(0.7, 0.7), ...(o.physical ? { sheen: 0.35, sheenRoughness: 0.85, sheenColor: new THREE.Color(o.sheen ?? color).multiplyScalar(1.1) } : {}),
      });
      return m;
    };
    const rep = (t, r) => { const c = t.clone(); c.repeat.set(r, r); c.needsUpdate = true; return c; };
    const fabric = { map: rep(tx.fabric.map, 2.2), normal: rep(tx.fabric.normal, 2.2) };
    const tx2 = { ...tx, fabric };
    tx = tx2;
    const leatherMap = rep(tx.leather.map, 5), leatherN = rep(tx.leather.normal, 5);
    const leather = (color, rough = 0.62) => new THREE.MeshStandardMaterial({ color, roughness: rough, map: leatherMap, normalMap: leatherN, vertexColors: true });
    return {
      leather: leather(0x3a2819), glove: leather(0x2a1e16, 0.7),
      wrap: new THREE.MeshStandardMaterial({ color: 0x9a9384, roughness: 0.95, map: (() => { const w = wrapTexture(); w.repeat.set(6, 8); return w; })(), normalMap: fabric.normal, vertexColors: true }),
      trousers: fab(0x232834), coat: fab(0x3e3129, { physical: true, sheen: 0x6a584a }), linen: fab(0x6a2019), sash: fab(0x1c2030, { rough: 0.8 }),
      scarfWrap: fab(0x7a1d17, { physical: true, sheen: 0xb04a40 }),
      hood: fab(0x2e2c2b, { physical: true, sheen: 0x4a4744 }), mask: fab(0x17181c), roll: fab(0x4a3f36),
      metal: new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.38, metalness: 1 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x9a6a4e, roughness: 0.6 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.08 }),
      fur: new THREE.MeshStandardMaterial({ color: 0x5e5246, roughness: 1, map: tx.fur, vertexColors: true }),
      cloak: new THREE.MeshPhysicalMaterial({ color: 0x2c2a29, roughness: 0.95, map: this._cloakTex = cloakAlpha(), alphaTest: 0.5, side: THREE.DoubleSide,
        normalMap: fabric.normal, normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.25, sheenRoughness: 0.9, sheenColor: new THREE.Color(0x3a3836) }),
      coatCloth: new THREE.MeshPhysicalMaterial({ color: 0x3e3129, roughness: 0.9, side: THREE.DoubleSide, map: fabric.map, normalMap: fabric.normal, sheen: 0.7, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x6a584a) }),
      scarf: new THREE.MeshPhysicalMaterial({ color: 0x7e1c17, roughness: 0.85, side: THREE.DoubleSide, map: fabric.map, sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xc0504a) }),
      sashCloth: new THREE.MeshStandardMaterial({ color: 0x1c2030, roughness: 0.8, side: THREE.DoubleSide, map: fabric.map }),
      straw: new THREE.MeshStandardMaterial({ color: 0xb0905a, roughness: 0.85, map: rep(tx.straw.map, 3), normalMap: rep(tx.straw.normal, 3), side: THREE.DoubleSide }),
      strawFringe: new THREE.MeshStandardMaterial({ color: 0x8a6e44, roughness: 1, map: tx.fur, alphaTest: 0.35, side: THREE.DoubleSide }),
      furCard: new THREE.MeshStandardMaterial({ color: 0x6a5c4e, roughness: 1, map: tx.fur, alphaTest: 0.4, side: THREE.DoubleSide }),
      lacquer: new THREE.MeshStandardMaterial({ color: 0x151313, roughness: 0.25 }),
      hilt: new THREE.MeshStandardMaterial({ color: 0x2c2520, roughness: 0.8, map: rep(tx.fabric.map, 4) }),
      gourd: new THREE.MeshStandardMaterial({ color: 0x9a6a36, roughness: 0.45 }),
      cord: new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 }),
    };
  }

  addFur() {
    const geos = [], rnd = mulberry32(21);
    for (let i = 0; i < 110; i++) {
      const a = i / 110 * Math.PI * 2 + rnd() * 0.05;
      const w = 0.08 + rnd() * 0.04, h = 0.08 + rnd() * 0.06;
      const g = new THREE.PlaneGeometry(w, h);
      g.translate(0, -h * 0.5 + 0.02, 0);
      g.rotateX(-0.9 - rnd() * 0.4);   // lean outward and down
      g.rotateY(Math.PI / 2 - a);
      const cx = Math.cos(a) * 0.17, cz = Math.sin(a) * 0.15 - 0.03;
      g.translate(cx, 1.525 + (rnd() - 0.5) * 0.02, cz);
      geos.push(g);
    }
    const g = mergeGeometries(geos);
    const m = new THREE.Mesh(g, this.M.furCard);
    m.castShadow = true;
    this.attach(m, 'chest');
  }

  addHat() {
    const prof = [[0.001, 0.132], [0.05, 0.122], [0.13, 0.085], [0.22, 0.045], [0.3, 0.013], [0.345, 0.0], [0.35, -0.006]].map(([r, y]) => new THREE.Vector2(r, y));
    const hat = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), this.M.straw);
    cone.castShadow = true; cone.receiveShadow = true;
    hat.add(cone);
    // knot on top and a frayed straw fringe around the brim
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), this.M.straw); knob.position.y = 0.135; hat.add(knob);
    const geos = [], rnd = mulberry32(8);
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2, h = 0.035 + rnd() * 0.03;
      const g = new THREE.PlaneGeometry(0.05, h); g.translate(0, -h / 2, 0); g.rotateX(0.25); g.rotateY(-a + Math.PI / 2);
      g.translate(Math.cos(a) * 0.345, -0.004, Math.sin(a) * 0.345); geos.push(g);
    }
    const fringe = new THREE.Mesh(mergeGeometries(geos), this.M.strawFringe); hat.add(fringe);
    // chin cords
    const cordGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.1, 0.02, 0.0), new THREE.Vector3(0.085, -0.1, 0.07), new THREE.Vector3(0.0, -0.2, 0.1), new THREE.Vector3(-0.085, -0.1, 0.07), new THREE.Vector3(-0.1, 0.02, 0.0)]), 16, 0.004, 5);
    hat.add(new THREE.Mesh(cordGeo, this.M.cord));
    hat.position.set(0, 1.79, 0.012);
    hat.rotation.x = 0.1;
    this.hat = hat;
    this.attach(hat, 'head');
  }

  addKatana() {
    const k = new THREE.Group();
    const saya = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.74, 10).rotateX(Math.PI / 2).translate(0, 0, -0.37), this.M.lacquer);
    const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.008, 18).rotateX(Math.PI / 2), this.M.metal);
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.25, 10).rotateX(Math.PI / 2).translate(0, 0, 0.13), this.M.hilt);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6).translate(0, 0, 0.255), this.M.metal);
    for (const m of [saya, tsuba, hilt, cap]) { m.castShadow = true; k.add(m); }
    k.position.set(0.2, 0.96, 0.03);
    k.lookAt(new THREE.Vector3(0.25, 1.55, 0.85)); // hilt forward and up; saya trails behind and down
    this.katana = k;
    this.attach(k, 'hips');
  }

  addGourd() {
    const pivot = new THREE.Group();
    pivot.position.set(-0.185, 0.94, 0.06);
    const g = new THREE.Group();
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.046, 14, 10), this.M.gourd); b1.position.y = -0.14; b1.scale.y = 1.1;
    const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), this.M.gourd); b2.position.y = -0.075;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 5).translate(0, -0.03, 0), this.M.cord);
    for (const m of [b1, b2, cord]) { m.castShadow = true; g.add(m); }
    pivot.add(g);
    this.gourd = { pivot, bob: g, ax: 0, az: 0, vx: 0, vz: 0, last: new THREE.Vector3() };
    this.attach(pivot, 'hips');
  }

  activate() { Object.assign(LEG, LEG_NOMAD); }

  attach(obj, bone) {
    const b = J[bone];
    obj.position.sub(new THREE.Vector3(b[0], b[1], b[2]));
    this.bones[bone].add(obj);
  }

  // ---------------------------------------------------------------- cloth
  buildCloth() {
    const M = this.M;
    this.group.updateMatrixWorld(true);
    // cloak: pinned around the back of the shoulders
    const cols = 13, rows = 16;
    const arc = (u) => { const t = u * Math.PI; return [Math.cos(t) * 0.215, 1.465 + Math.sin(t) * 0.015, -Math.sin(t) * 0.165 - 0.02]; };
    const cloakPins = [];
    for (let c = 0; c < cols; c++) cloakPins.push({ r: 0, c, bone: 'chest', local: arc(c / (cols - 1)) });
    this.addCloth({ rows, cols, mat: M.cloak, pins: cloakPins, stiff: 1, shear: 0.6, bend: 0.12, wind: 0.9, thick: 0.02, uvScale: [1, 1],
      init: (r, c) => { const a = arc(c / (cols - 1)); const k = r / (rows - 1); return [a[0] * (1 + k * 0.55), a[1] - r * 0.072, (a[2] - 0.05) * (1 + k * 0.35) - k * 0.1]; } });

    // coat tails: four panels hanging from the belt line
    const waist = (a, drop = 0, flare = 0) => [Math.cos(a) * (0.182 + flare), 0.905 - drop, Math.sin(a) * (0.142 + flare) - 0.01];
    const panels = [[0.26, 1.53], [1.61, 2.88], [3.42, 4.62], [4.8, 6.02]];
    for (const [a0, a1] of panels) {
      const pc = 4, pr = 8, pins = [];
      for (let c = 0; c < pc; c++) pins.push({ r: 0, c, bone: 'hips', local: waist(a0 + (a1 - a0) * c / (pc - 1)) });
      this.addCloth({ rows: pr, cols: pc, mat: M.coatCloth, pins, stiff: 1, shear: 0.7, bend: 0.25, wind: 0.5, thick: 0.014, uvScale: [0.5, 0.8],
        init: (r, c) => waist(a0 + (a1 - a0) * c / (pc - 1), r * 0.066, r * 0.012) });
    }
    // scarf tails from the back of the neck
    for (const [sx, len] of [[0.045, 13], [-0.02, 10]]) {
      const pins = [{ r: 0, c: 0, bone: 'chest', local: [sx - 0.04, 1.49, -0.14] }, { r: 0, c: 1, bone: 'chest', local: [sx + 0.04, 1.49, -0.14] }];
      this.addCloth({ rows: len, cols: 2, mat: M.scarf, pins, stiff: 1, shear: 0.8, bend: 0.2, wind: 1.6, thick: 0.035, uvScale: [0.2, 0.9],
        init: (r, c) => [sx + (c ? 0.04 : -0.04), 1.49 - r * 0.066, -0.18 - r * 0.01] });
    }
    // sash ends from the knot
    for (const [sx, len] of [[0.06, 8], [0.11, 7]]) {
      const pins = [{ r: 0, c: 0, bone: 'hips', local: [sx - 0.028, 0.99, -0.16] }, { r: 0, c: 1, bone: 'hips', local: [sx + 0.028, 0.99, -0.16] }];
      this.addCloth({ rows: len, cols: 2, mat: M.sashCloth, pins, stiff: 1, shear: 0.8, bend: 0.3, wind: 1.0, thick: 0.02, uvScale: [0.2, 0.6],
        init: (r, c) => [sx + (c ? 0.028 : -0.028), 0.99 - r * 0.058, -0.17 - r * 0.004] });
    }
  }

  addCloth(o) {
    const local = new THREE.Vector3();
    const pins = o.pins.map(p => ({ r: p.r, c: p.c, target: new THREE.Vector3(), bone: p.bone, local: new THREE.Vector3(...p.local).sub(V3(J[p.bone])) }));
    const cloth = new Cloth({
      gravity: -13, drag: 0.982, ...o, pins,
      init: (r, c, out) => { const v = o.init(r, c); local.set(v[0], v[1], v[2]); out.copy(this.body.localToWorld(local)); },
    });
    cloth.pinDefs = pins;
    cloth.pins.forEach((p, i) => { p.def = pins[i]; });
    this.cloths.push(cloth);
    this.clothGroup.add(cloth.mesh);
    this.updatePins(cloth);
    for (const p of cloth.pins) p.prev.copy(p.target);
  }

  updatePins(cloth) {
    for (const p of cloth.pins) p.target.copy(p.def.local).applyMatrix4(this.bones[p.def.bone].matrixWorld);
  }

  boneWorld(name, out = new THREE.Vector3()) { return out.setFromMatrixPosition(this.bones[name].matrixWorld); }

  // capsules from the posed skeleton
  buildColliders() {
    const C = this.colliders; C.length = 0;
    const W = (b, off) => { const v = off ? new THREE.Vector3(...off).applyMatrix4(this.bones[b].matrixWorld) : this.boneWorld(b); return v; };
    // named capsules: the cloth collides with them, and they are the body's hitboxes against the world
    const cap = (a, b, r, name) => C.push({ a, b, r, name });
    cap(W('hips', [0, -0.04, -0.01]), W('chest', [0, 0.1, -0.02]), 0.155, 'torso');
    cap(W('chest', [0.15, 0.13, -0.02]), W('chest', [-0.15, 0.13, -0.02]), 0.1, 'shoulders');
    cap(W('chest', [0.15, 0.03, -0.19]), W('chest', [-0.15, 0.03, -0.19]), 0.085, 'bedroll');
    for (const L of ['L', 'R']) {
      cap(W('thigh_' + L), W('shin_' + L), 0.1, 'thigh_' + L);
      cap(W('shin_' + L), W('foot_' + L), 0.078, 'shin_' + L);
      cap(W('foot_' + L), W('foot_' + L, [0, -0.05, 0.15]), 0.05, 'foot_' + L);
      cap(W('upperarm_' + L), W('forearm_' + L), 0.078, 'arm_' + L);
      cap(W('forearm_' + L), W('hand_' + L), 0.07, 'forearm_' + L);
    }
    cap(W('head', [0, 0.1, 0]), W('head', [0, 0.1, 0]), 0.14, 'head');
    const k0 = new THREE.Vector3(0, 0, -0.1).applyMatrix4(this.katana.matrixWorld), k1 = new THREE.Vector3(0, 0, -0.72).applyMatrix4(this.katana.matrixWorld);
    cap(k0, k1, 0.03, 'katana');
  }

  // pose: { bones: {name: [x,y,z]}, hipsY, hipsZ, pitch, roll, pivotY }
  applyPose(pose) {
    for (const b of BONES) {
      const r = pose.bones[b];
      if (r) this.bones[b].rotation.set(r[0], r[1], r[2]);
    }
    const h = this.bones.hips;
    h.position.copy(this.rest.hips);
    h.position.y += pose.hipsY || 0;
    h.position.z += pose.hipsZ || 0;
    h.position.x += pose.hipsX || 0;
    this.pivotY = pose.pivotY ?? 0.95;
    this.pivot.position.y = this.pivotY; this.body.position.y = -this.pivotY;
    this.pivot.rotation.set(pose.pitch || 0, 0, pose.roll || 0);
  }

  // rolling: extra air damping while tumbling; settle: 0..1 after a roll, the cloth falls back
  // into place faster instead of hanging over the head
  update(dt, wind, rolling = false, settle = 0) {
    this.group.updateMatrixWorld(true);
    for (const c of this.cloths) { c.drag = rolling ? 0.962 : 0.982; c.gravity = -13 * (1 + 1.4 * settle); }
    // gourd: damped pendulum driven by hip acceleration
    const G = this.gourd, wp = new THREE.Vector3().setFromMatrixPosition(G.pivot.matrixWorld);
    if (dt > 0) {
      const v = wp.clone().sub(G.last).divideScalar(dt);
      G.acc = G.vel ? v.clone().sub(G.vel).divideScalar(dt) : new THREE.Vector3();
      G.vel = v;
      const inv = new THREE.Matrix4().copy(this.bones.hips.matrixWorld).invert();
      const am = Math.min(G.acc.length(), 40);
      const a = am > 1e-4 ? G.acc.clone().transformDirection(inv).multiplyScalar(am) : new THREE.Vector3();
      G.vx += (-G.ax * 60 - G.vx * 4 + a.z * 1.6) * dt; G.vz += (-G.az * 60 - G.vz * 4 - a.x * 1.6) * dt;
      G.ax = Math.max(-1, Math.min(1, G.ax + G.vx * dt)); G.az = Math.max(-1, Math.min(1, G.az + G.vz * dt));
      G.bob.rotation.set(G.ax, 0, G.az);
    }
    G.last.copy(wp);
    this.buildColliders();
    for (const c of this.cloths) { this.updatePins(c); c.update(dt, wind, this.colliders, c.n > 100 ? 5 : 3); }
  }

  // footprints and snow stamps need to know where the soles are
  footWorld(L, out = new THREE.Vector3()) { return out.set(0, -0.06, 0.05).applyMatrix4(this.bones['foot_' + L].matrixWorld); }
  handWorld(L, out = new THREE.Vector3()) { return out.set(0, -0.08, 0).applyMatrix4(this.bones['hand_' + L].matrixWorld); }
}
