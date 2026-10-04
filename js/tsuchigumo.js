// Tsuchigumo, the earth spider: the keeper of the abandoned shrine in the Hollow of Falling Leaves.
//
// Come up the steps, through the torii and toward the hall, and it drops out of the sky onto the shrine roof,
// crouches there, turns its head to you and screams; the mist rolls in, and it comes down for you. A gaunt thing
// on eight high-kneed legs hung with old web, a long neck, and a skull of a head full of teeth with one pale eye
// on each side.
//
// The fight:
//   - it walks on a real gait: every foot is planted and steps when the body has moved too far from it. Its knees
//     stand far over your head, so the sword reaches its legs, and its head only when it brings it down. A blow on
//     a leg does 60%, but every one wears down its footing; break that and it collapses, head in the dirt, and
//     everything does double for a few seconds.
//   - leg stab: a foreleg rises and glows red, the spot it will come down on is marked, then it spears down.
//     Parry (F) and the leg is thrown back and its footing suffers; roll clear; or take it.
//   - bite: the head draws back with the jaw open, then lunges. Parry the bite and it reels, head on the ground,
//     open to double damage. Its head hangs low for a moment after any bite.
//   - body slam: get under it and it drops its whole weight on you.
//   - leap: go far and it jumps after you; the landing is a shockwave. The ring on the ground is where.
//   - at half health it screams again, throwing you back, and grows quicker: stabs come in pairs and it adds a sweep
//     of both forelegs low across the ground (jump it or roll through it: it cannot be parried).
// Fall to it and you wake at the foot of the steps, with it back up in the trees. Run from the clearing and it leaps
// back up into the canopy to wait. Kill it and it curls up and goes to black smoke.
//
// Its targets (in game.enemies.targets) are the head, the body and the eight legs; `high` marks a part that is
// out of the sword's reach over your head (arrows still find it, between its y0 and y1).
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { groundY, SHRINE } from './world.js';
import { HALL, shrineToWorld, worldToShrine } from './shrine.js';
import { clamp, lerp, smoothstep, damp, dampAngle, wrapAngle, mulberry32, vnoise } from './util.js';

const S = 1.2;                                     // the creature's scale
const HIP_H = 3.5 * S;                             // how high the body stands
const FEMUR = 6.0 * S, TIBIA = 7.4 * S;
const PAIRS = [[0.52, 7.0], [1.2, 7.7], [1.92, 7.3], [2.55, 6.6]];   // each pair of legs: angle off the front, how far out the foot rests
const STEP = 2.3 * S;                              // a planted foot steps once the body has left it this far behind
const HP = 1100, POSTURE = 150, LEG_SHARE = 0.6;
const TRIGGER = 12.5;                              // how near the middle of the clearing it waits for you
const LEASH = 24, GIVE_UP = 44;                    // how far from the shrine it will follow, and where it gives up
const DMG = { stab: 22, bite: 28, slam: 20, leap: 24, sweep: 18 };
const EYE = [new THREE.Color(0xdde8ff), new THREE.Color(0xff5a2a)];   // its eyes, calm and enraged

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------------------------------------ the model
function fibreTexture() {
  const W = 128, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = mulberry32(5);
  g.fillStyle = '#2e2924'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W, y = rnd() * H, len = 30 + rnd() * 170, dark = rnd() < 0.55;
    g.strokeStyle = dark ? `rgba(8,7,6,${0.35 + rnd() * 0.5})` : `rgba(${95 + rnd() * 40 | 0},${84 + rnd() * 30 | 0},${72 + rnd() * 25 | 0},${0.12 + rnd() * 0.3})`;
    g.lineWidth = 0.6 + rnd() * 2.4;
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (rnd() - 0.5) * 8, y + len * 0.33, x + (rnd() - 0.5) * 8, y + len * 0.66, x + (rnd() - 0.5) * 10, y + len); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const flat = (geos) => mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));

// thin cones off a surface point: ragged fibres. dir is where they point.
function strand(out, at, dir, len, r) {
  const s = new THREE.ConeGeometry(r, len, 3); s.translate(0, len / 2, 0);
  s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_Y, dir.clone().normalize())); s.translate(at.x, at.y, at.z);
  out.push(s);
}

// fibres that hang straight down from where they are rooted, whatever the part they grow on is doing, and sway.
// Each is a thin three-sided tube: its shape is in `position` (x, z across it, y 0..1 along it), its root on the
// part in aRoot, and aHang holds its length and a phase. The vertex shader drops it from the root in world space.
function strandGeometry(list) {
  const pos = [], uv = [], nrm = [], root = [], hang = [], idx = [], N = 4;
  for (const [x, y, z, len, r] of list) {
    const base = pos.length / 3, ph = Math.random() * 6.283;
    for (let k = 0; k <= N; k++) for (let j = 0; j < 3; j++) {
      const a = j / 3 * 6.283 + ph;
      pos.push(Math.cos(a) * r, k / N, Math.sin(a) * r); uv.push(j / 3, k / N); nrm.push(0, 1, 0); root.push(x, y, z); hang.push(len, ph, 0);
    }
    for (let k = 0; k < N; k++) for (let j = 0; j < 3; j++) { const a = base + k * 3 + j, b = base + k * 3 + (j + 1) % 3; idx.push(a, a + 3, b, b, a + 3, b + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3));
  g.setAttribute('aHang', new THREE.Float32BufferAttribute(hang, 3)); g.setIndex(idx);
  return g;
}
function strandMaterial(map, U) {
  const m = new THREE.MeshStandardMaterial({ map, color: 0x7a7066, roughness: 0.9, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoot; attribute vec3 aHang; uniform float uTime, uSway;')
      .replace('#include <project_vertex>', `
        vec3 rootW = (modelMatrix * vec4(aRoot, 1.0)).xyz;
        float s = position.y, L = aHang.x, sw = s * s * L * uSway;
        vec3 wp = rootW + vec3(position.x, 0.0, position.z) * (1.0 - 0.75 * s) - vec3(0.0, L * s, 0.0);
        wp.x += sw * sin(uTime * 1.7 + aHang.y); wp.z += sw * cos(uTime * 1.3 + aHang.y * 1.7);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vNormal = normalize((viewMatrix * vec4(normalize(vec3(position.x, 0.001, position.z)), 0.0)).xyz);`);
  };
  return m;
}
// fibres scattered over a limb segment (along +y, 0..len, radius r0 to r1)
function limbStrands(len, r0, r1, n, l0, l1, seed, from = 0.08, to = 0.95) {
  const rnd = mulberry32(seed), out = [];
  for (let i = 0; i < n; i++) {
    const u = from + rnd() * (to - from), a = rnd() * 6.283, r = lerp(r0, r1, u) * 0.8;
    out.push([Math.cos(a) * r, u * len, Math.sin(a) * r, (l0 + rnd() * (l1 - l0)) * S, (0.012 + rnd() * 0.02) * S]);
  }
  return strandGeometry(out);
}

// a leg or neck segment along +y from 0 to len: gaunt in the middle, knotted, swollen at its joints (nodes:
// where along it), with spines trailing off it (hang -1: toward its root, +1: toward its end)
function limb(len, r0, r1, seed, { knob = 0, claw = false, strands = 0, hang = -1, nodes = [], smooth = false } = {}) {
  const rnd = mulberry32(seed), geos = [];
  const g = new THREE.CylinderGeometry(1, 1, len, 9, Math.max(4, Math.round(len * 1.6)), false);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = y / len, a = Math.atan2(z, x);
    let r = lerp(r0, r1, u) * (smooth ? 1 : 1 - 0.22 * Math.sin(Math.PI * u)) * (0.8 + 0.4 * vnoise(a * 1.6 + seed, y * 2.4)) + 0.04 * S * Math.max(0, Math.sin(a * 3 + y * 0.9 + seed));
    for (const n of nodes) r *= 1 + 0.5 * Math.exp(-((((u - n) * len) / (0.22 * S)) ** 2));
    if (!smooth) r *= 1 + 0.35 * Math.exp(-(((u * len) / (0.3 * S)) ** 2));       // and flared where it leaves the joint above
    p.setXYZ(i, x * r, y, z * r);
  }
  g.computeVertexNormals(); geos.push(g);
  if (knob) { const k = new THREE.IcosahedronGeometry(knob, 1); k.scale(1, 1.25, 1); k.translate(0, len, 0); geos.push(k); }
  if (claw) {
    // the foot ends in a long hooked nail
    const c = new THREE.ConeGeometry(r1 * 1.3, 0.9 * S, 6, 3); c.translate(0, 0.45 * S, 0);
    const q = c.attributes.position;
    for (let i = 0; i < q.count; i++) { const y = q.getY(i); q.setZ(i, q.getZ(i) + 0.12 * y * y); }
    c.computeVertexNormals(); c.translate(0, len - 0.05, 0); geos.push(c);
  }
  for (let i = 0; i < strands; i++) {
    const u = 0.08 + rnd() * 0.84, a = rnd() * Math.PI * 2, r = lerp(r0, r1, u) * 0.85;
    const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    strand(geos, new THREE.Vector3(radial.x * r, u * len, radial.z * r), radial.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, hang * 0.85, 0)), (0.35 + rnd() * 1.0) * S, 0.03 * S);
  }
  return flat(geos);
}

// a lumpy, ridged ellipsoid
function blob(rx, ry, rz, seed, rough = 0.25) {
  const g = new THREE.SphereGeometry(1, 30, 22), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = vnoise(v.x * 2.2 + seed, v.z * 2.2 + v.y * 1.7) - 0.5, ribs = Math.max(0, Math.sin(v.z * 9 + v.x * 2)) * 0.06;
    v.multiplyScalar(1 + n * rough + ribs);
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  g.computeVertexNormals();
  return g;
}

// the body: the fore-body the legs and neck grow from, a narrow waist, the great hanging abdomen, a ridge of
// spines down its back. Returns the mesh's geometry and the fibres that hang off its belly.
function buildBody() {
  const geos = [], hang = [], rnd = mulberry32(31);
  geos.push(blob(1.5 * S, 1.15 * S, 1.9 * S, 3));
  const ab = blob(2.4 * S, 2.0 * S, 3.2 * S, 7, 0.32); ab.rotateX(0.3); ab.translate(0, 0.8 * S, -3.7 * S); geos.push(ab);
  const ped = new THREE.CylinderGeometry(0.7 * S, 0.9 * S, 1.4 * S, 10); ped.rotateX(Math.PI / 2); ped.translate(0, 0.35 * S, -1.6 * S); geos.push(ped);
  const abY = (x, z, s) => 0.8 * S + s * 1.9 * S * Math.sqrt(Math.max(0, 1 - ((z + 3.7 * S) / (3.2 * S)) ** 2) * Math.max(0, 1 - (x / (2.4 * S)) ** 2));
  for (let i = 0; i < 30; i++) {
    const z = -6.2 * S + rnd() * 7.6 * S, x = (rnd() - 0.5) * 1.2 * S, top = z < -1.8 * S ? abY(x, z, 1) : 1.05 * S;
    strand(geos, new THREE.Vector3(x, top - 0.15 * S, z), new THREE.Vector3((rnd() - 0.5) * 0.6, 1, -0.6), (0.4 + rnd() * 1.0) * S, 0.05 * S);
  }
  for (let i = 0; i < 110; i++) {
    const z = -6.6 * S + rnd() * 8.2 * S, x = (rnd() - 0.5) * 3.6 * S;
    const y = z < -1.8 * S ? abY(x, z, -1) + 0.25 * S : -0.85 * S;
    hang.push([x, y, z, (0.5 + rnd() * 2.6) * S, (0.015 + rnd() * 0.025) * S]);
  }
  return { geo: flat(geos), hang: strandGeometry(hang) };
}

// the head: a long skull, the upper jaw part of it and the lower one hinged (buildJaw). Groups: skin, teeth, eyes, gullet.
const HS = 1.3 * S;
function buildHead() {
  const skin = [], teeth = [], eyes = [], gullet = [], hang = [], rnd = mulberry32(41);
  const cr = blob(0.95 * HS, 0.8 * HS, 1.1 * HS, 11, 0.2); cr.translate(0, 0.15 * HS, -0.25 * HS); skin.push(cr);
  const sn = roundBox(new THREE.BoxGeometry(1.25 * HS, 0.62 * HS, 2.7 * HS, 6, 4, 12), 0.625 * HS, 0.31 * HS, 1.35 * HS), p = sn.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getZ(i) + 1.35 * HS) / (2.7 * HS), top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * (1 - 0.58 * u));
    p.setY(i, p.getY(i) * (1 - 0.4 * u) - 0.28 * HS * u * u + (top ? 0.07 * HS * Math.sin(u * 13) * (1 - u) : 0));
  }
  sn.computeVertexNormals(); sn.translate(0, 0.02 * HS, 1.7 * HS); skin.push(sn);
  const ridge = blob(0.16 * HS, 0.14 * HS, 1.2 * HS, 19, 0.4); ridge.translate(0, 0.33 * HS, 1.3 * HS); skin.push(ridge);
  for (const s of [-1, 1]) {
    const ck = blob(0.34 * HS, 0.26 * HS, 0.65 * HS, 15 + s, 0.3); ck.translate(s * 0.62 * HS, -0.08 * HS, 0.55 * HS); skin.push(ck);
    const br = blob(0.32 * HS, 0.16 * HS, 0.55 * HS, 13 + s, 0.3); br.translate(s * 0.46 * HS, 0.44 * HS, 0.5 * HS); skin.push(br);
    const e = new THREE.SphereGeometry(0.13 * HS, 12, 8); e.translate(s * 0.6 * HS, 0.24 * HS, 0.66 * HS); eyes.push(e);
    // teeth along the upper jaw, ragged; the fangs at the front
    for (let u = 0.08; u < 0.98; u += 0.075) {
      const fang = u > 0.86, L = (fang ? 0.72 : 0.16 + rnd() * 0.26) * HS;
      const x = s * 0.56 * HS * (1 - 0.58 * u), y = -0.29 * HS * (1 - 0.4 * u) - 0.28 * HS * u * u + 0.04 * HS, z = 0.4 * HS + u * 2.65 * HS;
      const t = new THREE.ConeGeometry((fang ? 0.07 : 0.035 + rnd() * 0.02) * HS, L, 5); t.rotateX(Math.PI); t.translate(0, -L / 2, 0);
      t.rotateZ(-s * (0.08 + rnd() * 0.15)); t.rotateX((rnd() - 0.5) * 0.3); t.translate(x, y, z); teeth.push(t);
    }
  }
  const gl = new THREE.SphereGeometry(0.6 * HS, 14, 10); gl.scale(0.8, 0.45, 1.8); gl.translate(0, -0.32 * HS, 0.85 * HS); gullet.push(gl);
  for (let i = 0; i < 18; i++) hang.push([(rnd() - 0.5) * 1.3 * HS, -0.35 * HS, -0.8 * HS + rnd() * 1.2 * HS, (0.5 + rnd() * 1.5) * S, (0.012 + rnd() * 0.02) * S]);
  return { geo: mergeGeometries([skin, teeth, eyes, gullet].map(flat), true), hang: strandGeometry(hang) };
}
function buildJaw() {
  const skin = [], teeth = [], hang = [], rnd = mulberry32(43);
  const j = roundBox(new THREE.BoxGeometry(1.05 * HS, 0.34 * HS, 2.55 * HS, 6, 3, 10), 0.525 * HS, 0.17 * HS, 1.275 * HS), p = j.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = (p.getZ(i) + 1.275 * HS) / (2.55 * HS); p.setX(i, p.getX(i) * (1 - 0.52 * u)); p.setY(i, p.getY(i) * (1 - 0.3 * u) - 0.12 * HS * u * u); }
  j.computeVertexNormals(); j.translate(0, -0.17 * HS, 1.5 * HS); skin.push(j);
  for (const s of [-1, 1]) for (let u = 0.1; u < 0.98; u += 0.08) {
    const fang = u > 0.86, L = (fang ? 0.55 : 0.14 + rnd() * 0.2) * HS;
    const t = new THREE.ConeGeometry((fang ? 0.06 : 0.032 + rnd() * 0.015) * HS, L, 5); t.translate(0, L / 2, 0); t.rotateZ(s * (0.06 + rnd() * 0.12));
    t.translate(s * 0.45 * HS * (1 - 0.52 * u), -0.02 * HS - 0.12 * HS * u * u, 0.25 * HS + u * 2.5 * HS); teeth.push(t);
  }
  // drool and old web strung from the jaw
  for (let i = 0; i < 12; i++) hang.push([(rnd() - 0.5) * 0.7 * HS, -0.32 * HS, 0.5 * HS + rnd() * 1.9 * HS, (0.4 + rnd() * 1.7) * S, (0.008 + rnd() * 0.012) * S]);
  return { geo: mergeGeometries([skin, teeth].map(flat), true), hang: strandGeometry(hang) };
}

// round off a tapered box's square cross-section into an ellipse, and its far end (+z) into a blunt nose
function roundBox(g, hw, hh, hl) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let nx = p.getX(i) / hw, ny = p.getY(i) / hh;
    const m = Math.max(Math.abs(nx), Math.abs(ny)), l = Math.hypot(nx, ny);
    if (l > 1e-6) { nx *= m / l; ny *= m / l; }
    p.setX(i, nx * hw); p.setY(i, ny * hh);
    const z = p.getZ(i);
    if (z > hl * 0.8) p.setZ(i, z - 0.18 * hl * (nx * nx + ny * ny) * (z - hl * 0.8) / (hl * 0.2));
  }
  return g;
}

// a red ring on the ground: where something is about to land
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.12)'); r.addColorStop(0.78, 'rgba(255,255,255,0.22)'); r.addColorStop(0.9, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------------------------------------------ the creature
export class Tsuchigumo {
  constructor(game) {
    this.game = game;
    const fibre = fibreTexture();
    this.skin = new THREE.MeshStandardMaterial({ map: fibre, color: 0x8a8076, roughness: 0.85, metalness: 0 });
    this.bone = new THREE.MeshStandardMaterial({ color: 0xb3a88c, roughness: 0.5 });
    this.strandU = { uTime: { value: 0 }, uSway: { value: 0.08 } };
    this.strandM = strandMaterial(fibre, this.strandU);
    const hangs = (geo) => { const m = new THREE.Mesh(geo, this.strandM); m.frustumCulled = false; return m; };
    this.eyeM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: EYE[0].clone(), emissiveIntensity: 0, roughness: 0.3 });
    this.gullet = new THREE.MeshStandardMaterial({ color: 0x2a0806, emissive: 0x3a0603, emissiveIntensity: 0.5, roughness: 0.6 });
    const shade = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    this.root = new THREE.Group(); this.root.visible = false; game.scene.add(this.root);
    this.body = new THREE.Group(); this.body.rotation.order = 'YXZ'; this.root.add(this.body);
    const B = buildBody(), Hd = buildHead(), J = buildJaw();
    this.body.add(shade(new THREE.Mesh(B.geo, this.skin)), hangs(B.hang));
    this.head = new THREE.Group(); this.head.rotation.order = 'YXZ'; this.root.add(this.head);
    this.head.add(shade(new THREE.Mesh(Hd.geo, [this.skin, this.bone, this.eyeM, this.gullet])), hangs(Hd.hang));
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.3 * HS, 0.05 * HS); this.head.add(this.jaw);
    this.jaw.add(shade(new THREE.Mesh(J.geo, [this.skin, this.bone])), hangs(J.hang));
    this.neck = [];
    for (let i = 0; i < 5; i++) {
      const r0 = lerp(0.8, 0.55, i / 4) * S, r1 = lerp(0.75, 0.5, i / 4) * S, m = shade(new THREE.Mesh(limb(1, r0, r1, 60 + i, { smooth: true }), this.skin));
      m.add(hangs(limbStrands(1, r0, r1, 7, 0.4, 1.5, 70 + i))); this.root.add(m); this.neck.push(m);
    }
    this.np = Array.from({ length: 6 }, () => new THREE.Vector3());
    // the legs: a femur up to a knee far over your head, a tibia down to a hooked foot
    this.legs = [];
    this.targets = []; this.colliders = [];
    const femurGeo = [0, 1].map((k) => limb(FEMUR, 0.32 * S, 0.22 * S, 80 + k, { knob: 0.36 * S, strands: 8, hang: -1 }));
    const tibiaGeo = [0, 1].map((k) => limb(TIBIA, 0.25 * S, 0.06 * S, 90 + k, { claw: true, strands: 5, hang: 1, nodes: [0.4] }));
    const femurHang = [0, 1].map((k) => limbStrands(FEMUR, 0.32 * S, 0.22 * S, 26, 0.5, 2.3, 100 + k));
    const tibiaHang = [0, 1].map((k) => limbStrands(TIBIA, 0.25 * S, 0.06 * S, 9, 0.3, 1.1, 110 + k, 0.04, 0.55));
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? 1 : -1, pair = i % 4, [ang, reach] = PAIRS[pair], a = side * ang;
      const mat = this.skin.clone();
      const L = {
        i, side, pair, group: (pair + (side > 0 ? 0 : 1)) % 2,
        hip: new THREE.Vector3(Math.sin(a) * 0.95 * S, 0.15 * S, Math.cos(a) * 0.8 * S + 0.35 * S),
        rest: new THREE.Vector3(Math.sin(a) * reach * S, 0, Math.cos(a) * reach * S + 0.8 * S),
        tuck: new THREE.Vector3(Math.sin(a) * 2.6 * S, -2.4 * S, Math.cos(a) * 2.4 * S + 0.4 * S),
        foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.3, arc: 1,
        lock: null, lockRate: 8, hipW: new THREE.Vector3(), knee: new THREE.Vector3(), glow: 0, glowCol: new THREE.Color(1, 0.16, 0.06),
        femur: shade(new THREE.Mesh(femurGeo[i % 2], this.skin)), tibia: shade(new THREE.Mesh(tibiaGeo[(i + 1) % 2], mat)), mat,
      };
      L.femur.add(hangs(femurHang[i % 2])); L.tibia.add(hangs(tibiaHang[(i + 1) % 2]));
      this.root.add(L.femur, L.tibia);
      L.target = this.part('leg', L, 0.5 * S, L.tibia);
      L.collider = { x: 1e6, z: 1e6, r: 0.38, soft: true };
      this.colliders.push(L.collider);
      this.legs.push(L);
    }
    this.headT = this.part('head', null, 1.25 * S, this.head); this.headT.head = true;
    this.bodyT = this.part('body', null, 2.1 * S, this.body);
    this.abdT = this.part('body', null, 2.5 * S, this.body);
    this.targets.unshift(this.headT, this.bodyT, this.abdT);        // a blow that catches the head and a leg at once counts on the head
    this.bodyC = { x: 1e6, z: 1e6, r: 2.0 * S }; this.colliders.push(this.bodyC);
    // markers on the ground
    const ring = ringTexture();
    this.marks = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ring, color: 0xff3418, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: false }));
      m.renderOrder = 4; m.visible = false; game.scene.add(m); return m;
    });
    // where it lands on the shrine, and where it stands on it
    const [hx, hz] = shrineToWorld(0, HALL.z);
    this.hall = new THREE.Vector3(hx, groundY(SHRINE.x, SHRINE.z), hz);
    this.perch = new THREE.Vector3(hx, this.hall.y + HALL.ridge + 1.5 * S, hz);
    // state
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = SHRINE.face; this.pitch = 0; this.roll = 0;
    this.headPos = new THREE.Vector3(); this.headWant = new THREE.Vector3(); this.hf = new THREE.Vector3(0, 0, 1); this.bitePos = new THREE.Vector3(); this.headRate = 5; this.look = new THREE.Vector3();
    this.headYaw = 0; this.headPitch = 0; this.headTilt = 0; this.headRoll = 0;
    this.jawOpen = 0; this.jawWant = 0; this.eye = 0; this.flash = 0; this.zap = 0;
    this.crouch = 0; this.lift = 0; this.rear = 0; this.splay = 1; this.heightRate = 6;
    this.airborne = false; this.perched = false; this.gaitGroup = 0; this.stepSound = 0; this.stepT = 0.3;
    this.aim = new THREE.Vector3(); this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    this.state = 'dormant'; this.t = 0; this.rest = 0; this.slain = false;
    this.hp = HP; this.posture = 0; this.phase = 1; this.cool = 1.2; this.stunResist = 0; this.lastHit = {}; this.lastHitAt = -9;
    this.camK = 0; this.camOn = false; this.shotPos = new THREE.Vector3(); this.shotLook = new THREE.Vector3(); this.shotFov = 60;
    this.gloom = 0; this.history = [];
    game.player.on('defeated', () => { if (this.engaged) this.enter('lost'); });
  }

  // one of its parts as a target for the blade, the arrows and the rest
  part(kind, leg, r, host) {
    const self = this;
    const t = { x: 1e6, z: 1e6, r, y0: 0, y1: 2, high: true, host, get dead() { return !self.hittable; },
      onHit: (k, dmg, dx, dz, fx) => self.hurt(kind, leg, k, dmg, dx, dz, fx, t) };
    this.targets.push(t);
    return t;
  }

  get engaged() { return !['dormant', 'intro', 'dying', 'dead', 'lost', 'retreat'].includes(this.state); }
  get hittable() { return this.engaged; }

  enter(s) { this.state = s; this.t = 0; this.sub = 0; this.done = false; }

  // ------------------------------------------------------------------------------------------ frames
  // a point in the body's frame turned by its yaw only (the frame the feet are planned in)
  flat(lx, lz, out) { const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return out.set(this.pos.x + lx * c + lz * s, 0, this.pos.z - lx * s + lz * c); }
  localX(x, z) { return (x - this.pos.x) * Math.cos(this.yaw) - (z - this.pos.z) * Math.sin(this.yaw); }
  localZ(x, z) { return (x - this.pos.x) * Math.sin(this.yaw) + (z - this.pos.z) * Math.cos(this.yaw); }
  fwd(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  // under the hall's roof? then the roof is what is underfoot (it walks over the shrine)
  under(x, z) {
    const [lx, lz] = worldToShrine(x, z), dz = Math.abs(lz - HALL.z);
    const g = groundY(x, z);
    if (Math.abs(lx) < HALL.eaveX + 0.3 && dz < HALL.eaveZ + 0.3) return Math.max(g, this.hall.y + HALL.ridge - dz * 0.65 + 0.2);
    return g;
  }
  // feet never come down inside the hall
  offHall(p) {
    const [lx, lz] = worldToShrine(p.x, p.z), hx = HALL.w / 2 + 1.5, hz = HALL.d / 2 + 1.6, dz = lz - HALL.z;
    if (Math.abs(lx) < hx && Math.abs(dz) < hz) {
      let nx = lx, nz = lz;
      if (hx - Math.abs(lx) < hz - Math.abs(dz)) nx = Math.sign(lx || 1) * (hx + 0.3); else nz = HALL.z + Math.sign(dz || 1) * (hz + 0.3);
      const [x, z] = shrineToWorld(nx, nz); p.x = x; p.z = z;
    }
    return p;
  }

  // ------------------------------------------------------------------------------------------ the legs
  ideal(L, out) {
    this.flat(L.rest.x * this.splay, L.rest.z * this.splay, out);
    out.x += this.vel.x * 0.42; out.z += this.vel.z * 0.42;
    this.offHall(out); out.y = groundY(out.x, out.z);
    return out;
  }
  step(L, to, dur, arc) { L.from.copy(L.foot); L.to.copy(to); L.t = 0; L.dur = dur; L.arc = arc; }
  // every leg out to the ground at once (landing)
  plant(dur = 0.12, arc = 0.25 * S) { for (const L of this.legs) if (!L.lock) { this.ideal(L, _v); this.step(L, _v, dur + Math.random() * 0.06, arc); } }
  footDown(L) {
    const G = this.game, p = L.foot;
    for (let i = 0; i < 3; i++) G.particles.emit('dust', p.x, p.y + 0.05, p.z, (Math.random() - 0.5) * 1.5, 0.4, (Math.random() - 0.5) * 1.5, 0.5, 1);
    G.leaves?.kick?.(p.x, p.z, 0.9, 1.1, 0, 0);
    if (this.stepSound <= 0) { const d = p.distanceTo(G.player.pos); G.audio?.boss('step', clamp(1.4 - d / 25, 0.15, 1)); this.stepSound = 0.11; }
  }
  gait(dt) {
    let busy = false;
    for (const L of this.legs) if (L.t < 1 && L.group === this.gaitGroup && !L.lock) busy = true;
    if (!busy) this.gaitGroup ^= 1;
    for (const L of this.legs) {
      if (L.lock) { L.t = 1; L.foot.lerp(L.lock, 1 - Math.exp(-L.lockRate * dt)); continue; }
      if (this.airborne) { this.body.localToWorld(_v.copy(L.tuck)); L.foot.lerp(_v, 1 - Math.exp(-9 * dt)); L.t = 1; continue; }
      if (L.t < 1) {
        L.t = Math.min(1, L.t + dt / L.dur);
        L.foot.lerpVectors(L.from, L.to, smoothstep(0, 1, L.t)); L.foot.y += Math.sin(Math.PI * L.t) * L.arc;
        if (L.t >= 1) this.footDown(L);
        continue;
      }
      this.ideal(L, _v);
      const d = Math.hypot(_v.x - L.foot.x, _v.z - L.foot.z);
      if ((d > STEP && L.group === this.gaitGroup) || d > STEP * 2.2) this.step(L, _v, this.stepT, 1.3 * S);
      else L.foot.y = damp(L.foot.y, groundY(L.foot.x, L.foot.z), 10, dt);
    }
  }
  // two bones from hip to foot, the knee thrown up and out
  ik(hip, foot, knee) {
    const d = _d.subVectors(foot, hip); let D = d.length();
    const max = (FEMUR + TIBIA) * 0.995;
    if (D > max) { d.multiplyScalar(max / D); D = max; }
    d.divideScalar(D || 1);
    const ca = clamp((FEMUR * FEMUR + D * D - TIBIA * TIBIA) / (2 * FEMUR * D), -1, 1), al = Math.acos(ca);
    const n = _n.copy(_Y).addScaledVector(d, -d.y);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    n.normalize();
    knee.copy(hip).addScaledVector(d, ca * FEMUR).addScaledVector(n, Math.sin(al) * FEMUR);
    return _u.copy(hip).addScaledVector(d, D);       // where the foot can actually reach
  }
  aimSeg(mesh, a, b) {
    const d = _w.subVectors(b, a), l = d.length();
    mesh.position.copy(a); mesh.quaternion.setFromUnitVectors(_Y, d.divideScalar(l || 1));
    return l;
  }

  // ------------------------------------------------------------------------------------------ hurt
  hurt(kind, leg, how, dmg, dx, dz, fx, t) {
    const G = this.game;
    if (!this.hittable) return false;
    if (G.time - (this.lastHit[how] ?? -9) < 0.22) return true;       // one blow lands once, however many legs it crosses
    this.lastHit[how] = G.time; this.lastHitAt = G.time;
    const crit = kind !== 'leg' && (this.state === 'reel' || this.state === 'collapse');
    const d = Math.max(1, Math.round(dmg * (kind === 'leg' ? LEG_SHARE : kind === 'body' ? 1.15 : 1) * (crit ? 2 : 1)));
    this.hp -= d; this.flash = 1;
    this.posture += kind === 'leg' ? dmg : dmg * 0.35;
    if (fx && fx.knock) this.posture += 14;
    const at = _v.set(t.x, groundY(t.x, t.z) + (t.y0 + t.y1) * 0.5, t.z);
    if (kind === 'leg') at.y = Math.min(at.y, groundY(t.x, t.z) + 2.2);
    G.hud?.floatText(at, (crit ? 'CRIT ' : '') + d, crit || d >= 30 ? 'big' : fx && fx.zap ? 'zap' : '');
    for (let i = 0; i < 5; i++) G.particles.emit('smoke', at.x, at.y, at.z, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, 0.6, 1);
    if (this.hp <= 0) { this.hp = 0; this.die(); return true; }
    if (this.phase === 1 && this.hp <= HP / 2) this.pendingScream = true;
    const busy = ['collapse', 'reel', 'scream', 'dying'].includes(this.state) || (this.state === 'leap' && this.airborne);
    if (this.posture >= POSTURE && !busy) { this.posture = 0; this.release(); this.enter('collapse'); G.hud?.floatText(_v.copy(this.pos).setY(this.pos.y + 2.5), 'BROKEN', 'gold word'); G.audio?.boss('shriek'); }
    else if (fx && fx.stun && this.stunResist <= 0 && !busy) { this.release(); this.enter('stun'); this.stunResist = 7; G.hud?.floatText(_v.copy(this.headPos).setY(this.headPos.y + 1.5), 'STUNNED', 'zap word'); }
    if (fx && fx.zap) this.zap = 1;
    return true;
  }
  // let go of whatever a move was doing: the legs, the lift, the markers, and the air (it drops to its feet)
  release() {
    for (const L of this.legs) { L.lock = null; L.glow = 0; }
    this.lift = 0; this.marker(0, 0, 0, 0, 0); this.marker(1, 0, 0, 0, 0);
    if (this.airborne) { this.airborne = false; this.plant(0.12, 0.1 * S); }
  }
  die() {
    const G = this.game;
    this.release(); this.enter('dying');
    G.audio?.boss('die'); G.audio?.drone(false);
    G.hud?.callout('VANQUISHED', 'gold'); G.hud?.boss(false, 0);
    G.hitStop = Math.max(G.hitStop, 0.25); G.rig.shake = Math.max(G.rig.shake, 1);
  }

  // ------------------------------------------------------------------------------------------ helpers for the fight
  marker(i, x, z, r, a) {
    const m = this.marks[i];
    m.visible = a > 0.01;
    if (!m.visible) return;
    m.position.set(x, groundY(x, z) + 0.1, z); m.scale.set(r, 1, r); m.material.opacity = a;
  }
  dustRing(x, z, r, n, speed) {
    const G = this.game, y = groundY(x, z);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; G.particles.emit('dust', x + Math.cos(a) * r, y + 0.15, z + Math.sin(a) * r, Math.cos(a) * speed, 0.8, Math.sin(a) * speed, 1.4, 1); }
  }
  shake(x, z, k) { const G = this.game, d = Math.hypot(G.player.pos.x - x, G.player.pos.z - z); G.rig.shake = Math.max(G.rig.shake, k * clamp(1.2 - d / 30, 0.25, 1)); }
  // a heavy blow on the ground at (x, z): it throws up the ground and hurts whoever is within r
  quake(x, z, r, dmg) {
    const G = this.game, P = G.player, y = groundY(x, z);
    this.dustRing(x, z, r * 0.4, 28, 6); G.leaves?.burst?.(x, y, z, r * 1.6, 5);
    G.earth?.crack(x, z); this.shake(x, z, 1);
    if (dmg && Math.hypot(P.pos.x - x, P.pos.z - z) < r && P.pos.y - groundY(P.pos.x, P.pos.z) < 1.2) {
      const res = P.hurt(dmg, _w.set(x, y, z));
      if (res === 'dodged') G.hud?.floatText(_w.copy(P.pos).setY(P.pos.y + 1.6), 'DODGE', 'gold word');
    }
  }
  // the head's resting place in front of and above the body
  headHome(out, up = 3.2, fwd = 4.6) { return this.body.localToWorld(out.set(0, up * S, fwd * S)); }

  // ------------------------------------------------------------------------------------------ the fight's moves
  startIntro() {
    const G = this.game, P = G.player;
    this.enter('intro');
    G.cutscene = true; P.vel.set(0, 0, 0);
    P.heading = Math.atan2(this.hall.x - P.pos.x, this.hall.z - P.pos.z);
    this.root.visible = true; this.root.position.y = 0;
    this.hp = HP; this.posture = 0; this.phase = 1; this.pendingScream = false;
    this.yaw = SHRINE.face; this.pitch = 0; this.roll = 0;
    this.pos.copy(this.perch).y += 48; this.vel.set(0, -5, 0);
    this.airborne = true; this.perched = false; this.crouch = 0.4; this.splay = 1.1;
    this.body.position.copy(this.pos); this.body.rotation.set(0, this.yaw, 0); this.body.updateMatrixWorld(true);
    for (const L of this.legs) { this.body.localToWorld(L.foot.copy(L.tuck)); L.t = 1; L.lock = null; }
    this.headHome(this.headPos, 2.2, 4); this.headWant.copy(this.headPos);
    this.jawWant = 0; this.eye = 0; this.headTilt = 0;
    this.camOn = true; this.camK = 0;
    G.audio?.boss('creak');
    this.history.length = 0;
  }

  leapTo(x, z, { harm = true, apex = 7, next = 'stalk' } = {}) {
    this.release(); this.enter('leap');
    this.to.set(x, 0, z); this.offHall(this.to); this.to.y = this.under(this.to.x, this.to.z) + HIP_H;
    this.leapNext = next; this.leapHarm = harm; this.leapApex = apex;
  }

  // what to do next, from where the wanderer is
  choose(dist, under) {
    if (under) return 'slam';
    if (dist > 15) return 'leap';
    if (dist > 10.5) return Math.random() < 0.3 ? 'leap' : null;
    const opts = [['stab', 4], ['bite', dist > 3.5 ? 3.5 : 1.2]];
    if (this.phase === 2) opts.push(['sweep', 2.6]);
    const last2 = this.history.slice(-2);
    const pool = opts.filter(([k]) => !(last2.length === 2 && last2[0] === k && last2[1] === k));
    let sum = 0; for (const o of pool) sum += o[1];
    let r = Math.random() * sum;
    for (const [k, w] of pool) { if ((r -= w) <= 0) return k; }
    return pool[0][0];
  }

  update(dt, G) {
    if (this.state === 'dormant') { this.watch(dt, G); this.weather(dt, G); return; }
    if (G.state !== 'play') return;            // the world waits while the menu is up
    const P = G.player;
    this.t += dt; this.cool -= dt; this.stepSound -= dt; this.stunResist -= dt;
    if (G.time - this.lastHitAt > 3) this.posture = Math.max(0, this.posture - 8 * dt);
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    const toYaw = Math.atan2(dx, dz), p2 = this.phase === 2;
    const fwd = this.fwd(_n.set(0, 0, 0)).clone();
    // defaults each frame; the states below change what they need
    this.look.set(P.pos.x, P.pos.y + 0.8, P.pos.z);
    this.headRate = 5; this.jawWant = 0.08 + 0.06 * Math.sin(G.time * 3); this.headTilt = 0; this.headRoll = damp(this.headRoll, 0.12 * Math.sin(G.time * 0.7), 2, dt);
    this.stepT = p2 ? 0.24 : 0.3;
    let wantCrouch = 0, wantRear = 0, wantSplay = 1, move = null, turn = p2 ? 3.2 : 2.2;
    this.headHome(this.headWant, 3.2 + 0.2 * Math.sin(G.time * 1.3), 4.6);

    if (this.engaged && Math.hypot(P.pos.x - SHRINE.x, P.pos.z - SHRINE.z) > GIVE_UP) { this.retreat(); }

    switch (this.state) {
      case 'intro': this.intro(dt, G, P); break;

      case 'leap': {
        // crouch, spring, fly, land
        if (this.sub === 0) {
          wantCrouch = 1; turn = 6;
          this.yaw = dampAngle(this.yaw, Math.atan2(this.to.x - this.pos.x, this.to.z - this.pos.z), 6, dt);
          this.headHome(this.headWant, 1.8, 4.2);
          if (this.leapHarm) this.marker(0, this.to.x, this.to.z, 4.2 * smoothstep(0, 0.5, this.t), 0.9 * smoothstep(0, 0.4, this.t));
          if (this.t > 0.5) {
            this.sub = 1; this.t = 0; this.airborne = true; this.perched = false; this.from.copy(this.pos);
            this.flightT = clamp(0.75 + this.from.distanceTo(this.to) * 0.035, 0.85, 1.35);
            G.audio?.boss('hiss'); G.audio?.whoosh();
            this.dustRing(this.pos.x, this.pos.z, 3, 18, 4);
          }
          turn = 0;
        } else if (this.sub === 1) {
          const k = clamp(this.t / this.flightT, 0, 1);
          this.pos.lerpVectors(this.from, this.to, k); this.pos.y += this.leapApex * 4 * k * (1 - k);
          this.vel.set(0, 0, 0);
          this.headHome(this.headWant, 2.6, 4.2); this.headRate = 8;
          this.pitch = damp(this.pitch, lerp(-0.25, 0.2, k), 4, dt);
          if (this.leapHarm) this.marker(0, this.to.x, this.to.z, 4.2, 0.9);
          turn = 0;
          if (k >= 1) {
            this.sub = 2; this.t = 0; this.airborne = false; this.crouch = 1;
            this.plant(0.1, 0.1 * S); this.marker(0, 0, 0, 0, 0);
            G.audio?.boss('land'); G.hitStop = Math.max(G.hitStop, 0.06);
            this.quake(this.pos.x, this.pos.z, 4.2 * S, this.leapHarm ? DMG.leap : 0);
          }
        } else {
          wantCrouch = lerp(1, 0, clamp(this.t / 0.7, 0, 1));
          if (this.t > 0.75) { this.cool = p2 ? 0.7 : 1.1; this.enter(this.leapNext); }
        }
        break;
      }

      case 'stalk': {
        // keep at a striking distance, edge round, turn to face; pick something to do
        this.look.y += 0.3;
        if (this.pendingScream && this.cool <= 0.6) { this.pendingScream = false; this.enter('scream'); break; }
        const under = dist < 3.4 * S;
        let want = 0;
        if (dist > 10) want = 1; else if (dist < 6.5 && !under) want = -0.8;
        this.strafe = this.strafe ?? 1;
        if (Math.random() < dt * 0.25) this.strafe *= -1;
        const sp = p2 ? 4.0 : 3.1, ux = dx / (dist || 1), uz = dz / (dist || 1);
        move = [ux * want * sp + -uz * this.strafe * sp * 0.35, uz * want * sp + ux * this.strafe * sp * 0.35];
        if (this.cool <= 0) {
          const k = this.choose(dist, under);
          if (!k) this.cool = 0.5;
          else if (k === 'leap') {
            const l = Math.max(0, dist - 4.5);
            this.leapTo(this.pos.x + ux * l, this.pos.z + uz * l, { apex: 5 + dist * 0.15 });
          } else if (k) { this.history.push(k); if (this.history.length > 4) this.history.shift(); this.release(); this.enter(k); this.attack = { leg: null, n: 0 }; }
        }
        break;
      }

      case 'stab': {
        // a foreleg rises, glowing; the spot is marked; it comes down
        const A = this.attack, W = A.n === 0 ? (p2 ? 0.65 : 0.85) : 0.48;
        if (!A.leg) {
          A.leg = this.legs[(this.localX(P.pos.x, P.pos.z) >= 0) !== (A.n === 1) ? 0 : 4];
          G.audio?.boss('hiss');
          G.hud?.floatText(_v.copy(A.leg.knee).setY(A.leg.knee.y + 0.5), '!', 'red big');
        }
        const L = A.leg;
        turn = 2.5; wantCrouch = 0.2;
        if (this.sub === 0) {
          // the foot rises over the wanderer, a little back, following
          if (this.t < W - 0.22) { this.aim.set(P.pos.x + P.vel.x * 0.18, 0, P.pos.z + P.vel.z * 0.18); }
          const hip = L.hipW, up = _w.copy(hip); up.y += 3.4 * S;
          up.x += (this.aim.x - hip.x) * 0.35; up.z += (this.aim.z - hip.z) * 0.35;
          L.lock = (L.lockV || (L.lockV = new THREE.Vector3())).copy(up); L.lockRate = 7;
          L.glow = smoothstep(0, W, this.t); L.glowCol.setRGB(1, 0.16, 0.06);
          this.marker(0, this.aim.x, this.aim.z, 1.6, 0.25 + 0.65 * smoothstep(0, W, this.t));
          this.headHome(this.headWant, 2.8, 4.0);
          if (this.t >= W) { this.sub = 1; this.t = 0; }
        } else if (this.sub === 1) {
          this.aim.y = groundY(this.aim.x, this.aim.z);
          L.lock.copy(this.aim); L.lockRate = 45; L.glow = 1;
          if (this.t > 0.09 && !this.done) {
            this.done = true; this.marker(0, 0, 0, 0, 0);
            if (Math.hypot(P.pos.x - this.aim.x, P.pos.z - this.aim.z) < 1.6 && P.pos.y - groundY(P.pos.x, P.pos.z) < 1.4 && P.weapon && P.weapon.deflect(this.aim)) {
              // turned aside: the leg is thrown up and back
              this.posture += 45; L.lock.copy(L.hipW).y += 2.5 * S; L.lockRate = 9; L.glow = 0;
              G.hud?.floatText(_v.copy(this.aim).setY(this.aim.y + 2), 'STAGGERED', 'gold word');
              this.enter('recoil'); break;
            }
            G.audio?.boss('stab'); this.quake(this.aim.x, this.aim.z, 1.7, DMG.stab);
            this.sub = 2; this.t = 0;
          }
        } else {
          // it stays in the ground a moment: the time to cut at it
          L.glow = Math.max(0, L.glow - dt * 3);
          if (this.t > (p2 ? 0.55 : 0.75)) {
            L.lock = null; L.foot.copy(this.aim);
            if (p2 && A.n === 0) { A.n = 1; A.leg = null; this.sub = 0; this.t = 0; }
            else { this.cool = p2 ? 1.0 : 1.6; this.enter('stalk'); }
          }
        }
        break;
      }

      case 'recoil':
        wantCrouch = 0.3; turn = 0.5; this.jawWant = 0.5;
        this.headHome(this.headWant, 3.8, 3.6); this.headTilt = -0.3;
        if (this.t > 1.0) { this.release(); this.cool = 0.8; this.enter('stalk'); }
        break;

      case 'bite': {
        const W = p2 ? 0.72 : 0.95;
        if (this.sub === 0) {
          // the head draws back and down, the jaw opens
          turn = 4.5; wantCrouch = 0.35;
          if (this.t < dt * 1.5) { G.audio?.boss('rattle'); G.hud?.floatText(_v.copy(this.headPos).setY(this.headPos.y + 1.2), '!', 'red big'); }
          this.headHome(this.headWant, 1.5, 2.4); this.headRate = 6;
          this.jawWant = smoothstep(0, W, this.t) * 0.9; this.eyeFlare = 1;
          if (this.t < W - 0.15) {
            this.aim.set(P.pos.x + P.vel.x * 0.2, 0, P.pos.z + P.vel.z * 0.2);
            const ax = this.aim.x - this.pos.x, az = this.aim.z - this.pos.z, l = Math.hypot(ax, az), max = 9.5 * S;
            if (l > max) { this.aim.x = this.pos.x + ax / l * max; this.aim.z = this.pos.z + az / l * max; }
            this.aim.y = groundY(this.aim.x, this.aim.z) + 0.9;
          }
          if (this.t >= W) {
            // the skull goes to just short of him, so the jaws close where he stands
            this.sub = 1; this.t = 0; this.from.copy(this.headPos); G.audio?.boss('shriek');
            const ux = this.aim.x - this.from.x, uz = this.aim.z - this.from.z, ul = Math.hypot(ux, uz) || 1;
            this.bitePos.set(this.aim.x - ux / ul * 1.5 * S, this.aim.y + 0.2, this.aim.z - uz / ul * 1.5 * S);
          }
        } else if (this.sub === 1) {
          // the lunge
          const k = clamp(this.t / 0.2, 0, 1), e = k * k * (3 - 2 * k);
          this.headPos.lerpVectors(this.from, this.bitePos, e); this.headWant.copy(this.headPos); this.headRate = 0;
          this.look.copy(this.aim).addScaledVector(fwd, 3); this.look.y = this.aim.y - 0.5;
          this.jawWant = k < 0.75 ? 1 : 0; turn = 0; wantCrouch = 0.6;
          move = [fwd.x * 6, fwd.z * 6];
          const jaws = _w.copy(this.headPos).addScaledVector(this.hf, 1.5 * S);
          if (!this.done && jaws.distanceTo(_v.set(P.pos.x, P.pos.y + 0.7, P.pos.z)) < 1.5 * S) {
            this.done = true;
            if (P.weapon && P.weapon.deflect(jaws)) {
              G.hud?.floatText(_v.copy(this.headPos).setY(this.headPos.y + 1.4), 'STAGGERED', 'gold word');
              this.enter('reel'); G.audio?.boss('shriek'); break;
            }
            const r = P.hurt(DMG.bite, jaws);
            if (r === 'dodged') G.hud?.floatText(_v.copy(P.pos).setY(P.pos.y + 1.6), 'DODGE', 'gold word');
          }
          if (k >= 0.75 && !this.snapped) { this.snapped = true; G.audio?.boss('bite'); }
          if (k >= 1) { this.sub = 2; this.t = 0; this.snapped = false; }
        } else {
          // it lingers low with its head out: in reach
          this.headWant.copy(this.bitePos); this.headRate = this.t < 0.85 ? 8 : 2.5; turn = 0.8; wantCrouch = 0.5;
          if (this.t > 0.85) this.headHome(this.headWant, 3.2, 4.6);
          this.look.copy(this.aim).addScaledVector(fwd, 3);
          if (this.t > 1.4) { this.cool = p2 ? 0.9 : 1.5; this.enter('stalk'); }
        }
        break;
      }

      case 'reel':
        // the parried bite: head in the dirt, dazed, everything does double
        wantCrouch = 0.85; turn = 0;
        this.headWant.copy(this.pos).addScaledVector(fwd, 5.2 * S); this.headWant.y = groundY(this.headWant.x, this.headWant.z) + 0.75 * S; this.headRate = 6;
        this.look.copy(this.headWant).addScaledVector(fwd, 3); this.look.y -= 1.2; this.jawWant = 0.35; this.headRoll = 0.5;
        if (Math.random() < dt * 30) { const a = G.time * 7, h = this.headPos; G.particles.emit('spark', h.x + Math.cos(a) * 0.9, h.y + 1.0, h.z + Math.sin(a) * 0.9, 0, 0.3, 0, 0.05, 1); }
        if (this.t > 2.8) { this.cool = 0.6; this.enter('stalk'); }
        break;

      case 'collapse':
        // its footing broken: belly down, legs splayed, the head on the ground
        wantCrouch = 1; wantSplay = 1.3; turn = 0; this.lift = -0.75 * S * smoothstep(0, 0.3, this.t) * (1 - smoothstep(3.8, 4.4, this.t));
        this.headWant.copy(this.pos).addScaledVector(fwd, 4.6 * S); this.headWant.y = groundY(this.headWant.x, this.headWant.z) + 0.7 * S; this.headRate = 5;
        this.look.copy(this.headWant).addScaledVector(fwd, 3); this.look.y -= 1; this.jawWant = 0.45; this.headRoll = -0.4;
        if (this.t < dt * 1.5) { this.plant(0.16, 0.4 * S); this.shake(this.pos.x, this.pos.z, 0.8); G.audio?.boss('slam'); this.dustRing(this.pos.x, this.pos.z, 2.5, 26, 4); }
        if (this.t > 4.4) { this.lift = 0; this.cool = 0.5; this.enter('stalk'); }
        break;

      case 'stun':
        turn = 0; wantCrouch = 0.4; this.zap = Math.max(this.zap, 0.6);
        this.headRoll = 0.15 * Math.sin(G.time * 50);
        if (Math.random() < dt * 40) { const p = this.legs[(Math.random() * 8) | 0].knee; G.particles.emit('zap', p.x, p.y, p.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.6, 1); }
        if (this.t > 1.1) { this.cool = 0.4; this.enter('stalk'); }
        break;

      case 'sweep': {
        // both forelegs out to one side, then raked low across the front: jump it or roll
        const W = 0.8, A = this.attack, side = A.dir ?? (A.dir = Math.random() < 0.5 ? 1 : -1);
        turn = this.sub === 0 ? 3 : 0;
        const legsUsed = [this.legs[0], this.legs[4]];
        const angAt = (k) => lerp(1.7, -1.7, k) * side;
        const placeLegs = (ang, h, rate) => legsUsed.forEach((L, j) => {
          const a = ang + (j ? 0.3 : -0.3) * side, r = 6.6 * S;
          L.lock = (L.lockV || (L.lockV = new THREE.Vector3())); this.flat(Math.sin(a) * r, Math.cos(a) * r, L.lock);
          L.lock.y = groundY(L.lock.x, L.lock.z) + h; L.lockRate = rate;
        });
        if (this.sub === 0) {
          if (this.t < dt * 1.5) { G.audio?.boss('hiss'); G.hud?.floatText(_v.copy(this.pos).setY(this.pos.y + 3), '!!', 'red big'); }
          placeLegs(angAt(0), 2.6, 6);
          for (const L of legsUsed) { L.glow = smoothstep(0, W, this.t); L.glowCol.setRGB(0.7, 0.07, 0.42); }
          this.headHome(this.headWant, 2.6, 3.8);
          if (this.t >= W) { this.sub = 1; this.t = 0; G.audio?.boss('sweep'); }
        } else if (this.sub === 1) {
          const k = clamp(this.t / 0.42, 0, 1), ang = angAt(k);
          placeLegs(ang, 0.45, 30);
          // does the rake pass where he stands?
          const pa = Math.atan2(this.localX(P.pos.x, P.pos.z), this.localZ(P.pos.x, P.pos.z));
          if (!this.done && (side > 0 ? ang <= pa : ang >= pa) && dist > 1.0 * S && dist < 8.6 * S && Math.abs(pa) < 1.9) {
            this.done = true;
            if (P.pos.y - groundY(P.pos.x, P.pos.z) > 0.42) G.hud?.floatText(_v.copy(P.pos).setY(P.pos.y + 1.6), 'JUMPED', 'gold word');
            else {
              const r = P.hurt(DMG.sweep, this.pos);
              if (r === 'dodged') G.hud?.floatText(_v.copy(P.pos).setY(P.pos.y + 1.6), 'DODGE', 'gold word');
              else { const sx = -Math.cos(this.yaw) * side, sz = Math.sin(this.yaw) * side; P.vel.x += sx * 7; P.vel.z += sz * 7; }
            }
          }
          if (this.t > 0.2 && Math.random() < 0.6) for (const L of legsUsed) G.particles.emit('dust', L.foot.x, L.foot.y, L.foot.z, 0, 0.6, 0, 1.4, 1);
          if (k >= 1) { this.sub = 2; this.t = 0; }
        } else {
          for (const L of legsUsed) L.glow = Math.max(0, L.glow - dt * 3);
          if (this.t > 0.5) { this.release(); this.cool = 1.0; this.enter('stalk'); }
        }
        break;
      }

      case 'slam': {
        // he is under it: it rises on its legs and drops its whole weight
        turn = 0;
        if (this.sub === 0) {
          this.lift = 1.6 * S * smoothstep(0, 0.6, this.t); this.jawWant = 0.5;
          if (this.t < dt * 1.5) { G.audio?.boss('rattle'); }
          this.marker(1, this.pos.x, this.pos.z, 3.6 * S, 0.3 + 0.6 * smoothstep(0, 0.6, this.t));
          if (this.t > 0.62) { this.sub = 1; this.t = 0; }
        } else if (this.sub === 1) {
          this.lift = lerp(1.6 * S, -2.2 * S, smoothstep(0, 0.14, this.t)); this.heightRate = 40;
          if (this.t > 0.14 && !this.done) { this.done = true; this.marker(1, 0, 0, 0, 0); G.audio?.boss('slam'); this.quake(this.pos.x, this.pos.z, 3.6 * S, DMG.slam); this.dustRing(this.pos.x, this.pos.z, 3, 30, 5); }
          if (this.t > 1.05) { this.sub = 2; this.t = 0; }
        } else {
          this.lift = lerp(-2.2 * S, 0, smoothstep(0, 0.5, this.t)); this.heightRate = 6;
          if (this.t > 0.5) { this.lift = 0; this.cool = 0.9; this.enter('stalk'); }
        }
        break;
      }

      case 'scream': {
        // half its life gone: it rears and screams, and comes back quicker
        turn = 1.5; wantRear = this.t < 1.9 ? 1 : 0; this.headHome(this.headWant, 4.4, 3.4); this.jawWant = this.t > 0.2 && this.t < 1.9 ? 1 : 0.2;
        if (this.t < 1.9) { this.look.copy(this.headPos).addScaledVector(fwd, 4); this.look.y += 4.5; }
        this.headRoll = 0.08 * Math.sin(G.time * 40);
        if (this.t > 0.2 && !this.done) {
          this.done = true; this.phase = 2; G.audio?.boss('scream');
          G.hud?.callout('ENRAGED', 'red'); G.rig.shake = Math.max(G.rig.shake, 1.2);
          G.leaves?.burst?.(this.pos.x, groundY(this.pos.x, this.pos.z), this.pos.z, 16, 4);
          this.dustRing(this.pos.x, this.pos.z, 4, 36, 9);
          if (dist < 11) { const k = 1 - dist / 11; P.vel.x += dx / (dist || 1) * 10 * k; P.vel.z += dz / (dist || 1) * 10 * k; P.vel.y = Math.max(P.vel.y, 2.5 * k); P.grounded = k < 0.2; }
        }
        if (this.t > 0.2 && this.t < 1.8) G.rig.shake = Math.max(G.rig.shake, 0.5);
        if (this.t > 2.4) { this.cool = 0.5; this.enter('stalk'); }
        break;
      }

      case 'dying': this.dying(dt, G); turn = 0; break;

      case 'retreat':
        // back up into the canopy
        this.airborne = true; this.vel.y += 18 * dt; this.pos.addScaledVector(this.vel, dt);
        this.headHome(this.headWant, 2.5, 3.5); turn = 0;
        if (this.t > 1.6) this.sleep();
        break;

      case 'lost':
        // the wanderer fell: the world goes dark, and he wakes at the foot of the steps
        G.cutscene = true; G.fade = Math.min(G.fade, 1 - smoothstep(0, 0.9, this.t));
        this.headHome(this.headWant, 3.8, 4); this.headTilt = -0.3; this.jawWant = 0.6;
        if (this.t > 1.0) {
          const [sx, sz] = shrineToWorld(0, SHRINE.terrace + SHRINE.slope + 2.2);
          P.teleport(sx, sz); P.heading = SHRINE.face + Math.PI; P.hp = P.maxHp;
          G.rig.yaw = SHRINE.face; G.rig.focus.set(0, 0, 0);
          this.sleep(); G.fade = 0; G.cutscene = false;
          G.hud?.hint('You wake at the foot of the steps. Above, the shrine waits.', 5);
        }
        break;
    }

    // ---------------------------------------------------------------- motion
    if (!this.airborne && this.state !== 'intro') {
      if (move) { this.vel.x = damp(this.vel.x, move[0], 3, dt); this.vel.z = damp(this.vel.z, move[1], 3, dt); }
      else { this.vel.x = damp(this.vel.x, 0, 6, dt); this.vel.z = damp(this.vel.z, 0, 6, dt); }
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      // it keeps to its clearing
      const ox = this.pos.x - SHRINE.x, oz = this.pos.z - SHRINE.z, ol = Math.hypot(ox, oz);
      if (ol > LEASH) { this.pos.x = SHRINE.x + ox / ol * LEASH; this.pos.z = SHRINE.z + oz / ol * LEASH; }
      if (turn) this.yaw = dampAngle(this.yaw, toYaw, turn, dt);
      this.crouch = damp(this.crouch, wantCrouch, 5, dt);
      this.rear = damp(this.rear, wantRear, 4, dt);
      this.splay = damp(this.splay, wantSplay, 4, dt);
      const base = this.perched ? this.perch.y - HIP_H * 0.15 : this.under(this.pos.x, this.pos.z) + HIP_H * (1 - 0.45 * this.crouch) + this.lift + 0.15 * Math.sin(G.time * 2.1);
      this.pos.y = damp(this.pos.y, base, this.heightRate, dt);
      this.heightRate = damp(this.heightRate, 6, 4, dt);
      this.pitch = damp(this.pitch, -0.42 * this.rear + 0.06 * Math.sin(G.time * 1.1), 5, dt);
      this.roll = damp(this.roll, (this.state === 'dying' ? 0.3 : 0) + 0.03 * Math.sin(G.time * 1.7), 3, dt);
      // forelegs off the ground while it rears
      if (this.rear > 0.05 && this.state !== 'stab' && this.state !== 'sweep') for (const L of [this.legs[0], this.legs[4]]) {
        L.lock = (L.lockV || (L.lockV = new THREE.Vector3())); this.body.localToWorld(L.lock.copy(L.hip).multiplyScalar(1).add(_w.set(L.side * 2.6 * S, 3.4 * S * this.rear, 3.2 * S)));
        L.lockRate = 6;
      } else if (this.rear <= 0.05 && this.wasRearing) { this.legs[0].lock = null; this.legs[4].lock = null; }
      this.wasRearing = this.rear > 0.05;
    }
    this.pose(dt, G);
    this.weather(dt, G);
    if (this.engaged) G.hud?.boss(true, this.hp / HP, this.phase === 2);
    P.camPull = damp(P.camPull || 0, this.engaged ? 0.32 : 0, 1.5, dt);
    P.camLift = damp(P.camLift || 0, this.engaged ? 1.3 : 0, 1.5, dt);
  }

  // ------------------------------------------------------------------------------------------ waiting, and the intro
  watch(dt, G) {
    this.rest -= dt;
    const P = G.player;
    P.camPull = damp(P.camPull || 0, 0, 1.5, dt); P.camLift = damp(P.camLift || 0, 0, 1.5, dt);
    if (this.slain || this.rest > 0 || G.state !== 'play' || G.cutscene || P.state !== 'ground') return;
    const [lx, lz] = worldToShrine(P.pos.x, P.pos.z);
    if (Math.hypot(lx, lz) < TRIGGER && lz > HALL.z + HALL.d / 2 + 2.5) this.startIntro();
  }
  sleep() {
    const G = this.game;
    this.release(); this.enter('dormant'); this.root.visible = false; this.airborne = false; this.perched = false;
    this.hp = HP; this.posture = 0; this.phase = 1; this.rest = 2.5; this.camOn = false; this.vel.set(0, 0, 0);
    G.hud?.boss(false, 1); G.audio?.drone(false);
    for (const t of this.targets) { t.x = t.z = 1e6; }
    for (const c of this.colliders) { c.x = c.z = 1e6; }
  }
  retreat() {
    const G = this.game;
    this.release(); this.enter('retreat'); this.airborne = true; this.vel.set(0, 12, 0);
    G.hud?.boss(false, this.hp / HP); G.audio?.drone(false); G.audio?.boss('hiss');
    G.hud?.hint('The spider goes back up into the trees to wait.', 4);
  }

  intro(dt, G, P) {
    const t = this.t;
    P.vel.x *= 0.8; P.vel.z *= 0.8;
    if (!this.landT) {
      // high above: still for a breath (a creak, leaves coming down), then the fall
      if (t > 0.9) {
        if (!this.falling) { this.falling = true; G.audio?.boss('fall'); }
        this.vel.y -= 26 * dt; this.pos.addScaledVector(this.vel, dt);
        this.yaw = SHRINE.face + 0.4 * Math.max(0, this.pos.y - this.perch.y) / 48;
      }
      if (t < 0.9 && Math.random() < dt * 30) { const [x, z] = shrineToWorld((Math.random() - 0.5) * 10, HALL.z + (Math.random() - 0.5) * 8); G.particles.emit('dust', x, this.hall.y + 9 + Math.random() * 6, z, 0, -1, 0, 0.6, 1); }
      this.headHome(this.headWant, 2.2, 4); this.headRate = 10; this.eye = 0;
      if (this.falling && this.pos.y <= this.perch.y) {
        // onto the roof
        this.pos.y = this.perch.y; this.vel.set(0, 0, 0); this.yaw = SHRINE.face;
        this.landT = t; this.airborne = false; this.perched = true; this.crouch = 1;
        this.plant(0.13, 0.2 * S);
        G.shrine?.impact(1.2); G.audio?.boss('land');
        G.rig.shake = 1.5; G.hitStop = Math.max(G.hitStop, 0.12);
        G.leaves?.burst?.(this.hall.x, this.hall.y, this.hall.z, 12, 6);
        this.dustRing(this.hall.x, this.hall.z, 5, 40, 7);
      }
      return;
    }
    const k = t - this.landT;
    this.crouch = damp(this.crouch, k < 2.2 ? 0.8 : 0.5, 3, dt);
    this.pos.y = damp(this.pos.y, this.perch.y - this.crouch * 0.6, 8, dt);
    this.look.set(P.pos.x, P.pos.y + 0.8, P.pos.z);
    if (k < 1.3) {
      // crouched on the roof: the head comes down and round to him, and the eyes open
      this.headHome(this.headWant, 0.6, 4.4); this.headRate = 2.2; this.headRoll = 0.35;
      this.eye = smoothstep(0.4, 1.2, k) * (0.75 + 0.25 * Math.sin(k * 40));
      if (k > 0.5 && !this.rattled) { this.rattled = true; G.audio?.boss('rattle'); }
      G.audio && (G.audio.hush = Math.min(1, (G.audio.hush || 0) + dt));
    } else if (k < 1.65) {
      this.headHome(this.headWant, 3.4, 3.4); this.headRate = 4; this.headRoll = damp(this.headRoll, 0, 4, dt); this.eye = 1; this.jawWant = 0.25;
    } else if (k < 3.6) {
      // the scream
      if (!this.screamed) {
        this.screamed = true; G.audio?.boss('scream'); G.audio?.drone(true);
        G.hud?.showTitle('tsuchigumo'); G.hud?.boss(true, 1);
        G.leaves?.burst?.(P.pos.x, P.pos.y, P.pos.z, 14, 3);
        this.dustRing(this.hall.x, this.hall.z, 6, 40, 10);
        P.vel.x -= Math.sin(P.heading) * 3; P.vel.z -= Math.cos(P.heading) * 3;
      }
      // jaws to the sky
      this.headHome(this.headWant, 4.1, 3.6); this.headRate = 6; this.headTilt = -0.1; this.jawWant = 1;
      this.look.copy(this.headPos).addScaledVector(this.fwd(_w), 3); this.look.y += 4.5;
      this.look.x += Math.cos(this.yaw) * 3.5; this.look.z -= Math.sin(this.yaw) * 3.5;     // to one side: we see it in three-quarter
      this.headRoll = 0.07 * Math.sin(G.time * 45); this.rear = damp(this.rear, 0.6, 4, dt);
      this.gloom = Math.max(this.gloom, smoothstep(1.65, 3.4, k));
      G.rig.shake = Math.max(G.rig.shake, 0.7);
      for (const L of [this.legs[0], this.legs[4]]) { L.lock = (L.lockV || (L.lockV = new THREE.Vector3())); this.body.localToWorld(L.lock.set(L.side * 3.4 * S, 3.0 * S, 4.4 * S)); L.lockRate = 4; }
    } else {
      // it settles, and comes down off the roof at him
      this.jawWant = 0.2; this.rear = damp(this.rear, 0, 5, dt); this.legs[0].lock = null; this.legs[4].lock = null;
      this.headHome(this.headWant, 2.4, 4.4); this.headRate = 4;
      if (k > 4.0) {
        G.cutscene = false; this.camOn = false;
        G.rig.yaw = Math.atan2(-(this.hall.x - P.pos.x), -(this.hall.z - P.pos.z)); G.rig.pitch = -0.05;
        G.hud?.hint('Its legs are in reach of your blade. Parry the bite (F) to bring its head down.', 7);
        const lx = (P.pos.x + this.hall.x) * 0.5, lz = (P.pos.z + this.hall.z) * 0.5;
        const ux = P.pos.x - lx, uz = P.pos.z - lz, l = Math.hypot(ux, uz) || 1, back = Math.max(0, 5.5 - l);
        this.landT = 0; this.falling = false; this.rattled = false; this.screamed = false;
        this.leapTo(lx - ux / l * back, lz - uz / l * back, { apex: 4 });
      }
    }
    this.pitch = damp(this.pitch, -0.42 * this.rear, 5, dt);
  }

  // ------------------------------------------------------------------------------------------ death
  dying(dt, G) {
    const t = this.t;
    if (t < 1.5) {
      // it thrashes
      this.jawWant = 1; this.headTilt = -0.6 + 0.3 * Math.sin(t * 9); this.headRoll = 0.4 * Math.sin(t * 7);
      this.headHome(this.headWant, 3.5 + Math.sin(t * 5), 3.5); this.headRate = 6;
      for (const L of this.legs) {
        if (Math.random() < dt * 4 || !L.lock) {
          L.lock = (L.lockV || (L.lockV = new THREE.Vector3()));
          this.body.localToWorld(L.lock.copy(L.rest).multiplyScalar(0.55 + Math.random() * 0.4)); L.lock.y += (Math.random() * 4 + 1) * S; L.lockRate = 5;
        }
      }
      this.lift = 0.5 * S * Math.sin(t * 6);
    } else {
      // the legs curl in under it, as a dead spider's do, and it comes down
      this.lift = damp(this.lift, -2.3 * S, 3, dt);
      for (const L of this.legs) {
        L.lock = (L.lockV || (L.lockV = new THREE.Vector3()));
        this.body.localToWorld(L.lock.copy(L.tuck).multiplyScalar(0.8)); L.lock.y = Math.max(L.lock.y + 1.4 * S, groundY(L.lock.x, L.lock.z) + 0.3); L.lockRate = 2.5;
      }
      this.jawWant = 0.55; this.headTilt = 0.4; this.headRate = 2.5;
      this.headWant.copy(this.pos).addScaledVector(this.fwd(_w), 3.6 * S); this.headWant.y = groundY(this.headWant.x, this.headWant.z) + 0.6 * S;
      this.eye = Math.max(0, 1 - (t - 1.5) / 2.5);
      if (t > 2.6) {
        // and goes to smoke
        const k = smoothstep(2.6, 7, t);
        this.root.position.y = -k * 3.2 * S;
        const n = Math.round(dt * 160 * (1 - k * 0.6));
        for (let i = 0; i < n; i++) {
          const L = this.legs[(Math.random() * 8) | 0], p = Math.random() < 0.4 ? this.pos : Math.random() < 0.5 ? L.knee : L.foot;
          G.particles.emit(Math.random() < 0.85 ? 'smoke' : 'ember', p.x + (Math.random() - 0.5) * 2, p.y - k * 3.2 * S + Math.random(), p.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.6, 1 + Math.random(), (Math.random() - 0.5) * 0.6, 1, 1);
        }
        this.gloom = Math.min(this.gloom, 1 - smoothstep(3.5, 7.5, t));
      }
      if (t > 7.5) {
        this.root.visible = false; this.root.position.y = 0; this.enter('dead'); this.slain = true;
        for (const c of this.colliders) { c.x = c.z = 1e6; }
        G.hud?.showTitle('quiet'); if (G.audio) G.audio.hush = 0;
      }
    }
  }

  // ------------------------------------------------------------------------------------------ the mist
  weather(dt, G) {
    const want = this.engaged || this.state === 'retreat' ? (this.phase === 2 ? 1 : 0.85) : this.state === 'intro' || this.state === 'dying' || this.state === 'lost' ? this.gloom : 0;
    if (this.state !== 'intro' && this.state !== 'dying') this.gloom = damp(this.gloom, want, this.state === 'dormant' ? 0.5 : 1.2, dt);
    if (G.sky) { G.sky.gloom = this.gloom; G.sky.gloomY = this.hall.y - 0.5; }
    if (G.audio && this.state !== 'intro') G.audio.hush = damp(G.audio.hush || 0, this.engaged ? 0.6 : 0, 0.8, dt);
  }

  // ------------------------------------------------------------------------------------------ the camera in the intro
  directCamera(dt) {
    const G = this.game, cam = G.camera;
    if (G.state !== 'play') return;
    this.camK = this.camOn ? Math.min(1, this.camK + dt * 3) : Math.max(0, this.camK - dt / 1.1);
    if (this.camK <= 0.001) return;
    const P = G.player, k = this.camK * this.camK * (3 - 2 * this.camK);
    const hx = this.hall.x - P.pos.x, hz = this.hall.z - P.pos.z, hl = Math.hypot(hx, hz) || 1, fx = hx / hl, fz = hz / hl, rx = -fz, rz = fx;
    if (!this.camOn) { this.blendCam(cam, this.camK * this.camK * (3 - 2 * this.camK)); return; }      // easing back to the rig: hold the last shot
    const lt = this.landT ? this.t - this.landT : -1;
    let back = 2.7, side = 1.35, up = 0.55, fov = 64;
    const look = _w;
    if (lt < 0.25) look.set(this.hall.x, this.hall.y + 7.2, this.hall.z);                       // the roof, and the sky it will come out of
    else if (lt < 1.65) { look.lerpVectors(_v.set(this.hall.x, this.hall.y + 7.2, this.hall.z), this.headPos, 0.55); back = 2.3; side = 1.2; up = 0.75; fov = 58; }
    else { look.copy(this.headPos); look.y -= 1.2; back = 2.6; side = 1.1; up = 0.35; fov = lerp(60, 50, smoothstep(1.65, 3.4, lt)); }
    const pos = _d.set(P.pos.x - fx * back + rx * side, P.pos.y + 1.0 + up, P.pos.z - fz * back + rz * side);
    pos.y = Math.max(pos.y, groundY(pos.x, pos.z) + 0.4);
    if (this.shotPos.lengthSq() === 0 || this.camK < 0.05) { this.shotPos.copy(pos); this.shotLook.copy(look); this.shotFov = fov; }
    this.shotPos.lerp(pos, 1 - Math.exp(-3 * dt)); this.shotLook.lerp(look, 1 - Math.exp(-4 * dt)); this.shotFov = damp(this.shotFov, fov, 3, dt);
    this.blendCam(cam, k);
  }
  blendCam(cam, k) {
    const G = this.game;
    cam.position.lerp(this.shotPos, k);
    const s = G.rig.shake * G.rig.shake * 0.06 * k, tt = performance.now() * 0.03;
    cam.position.x += Math.sin(tt * 1.3) * s; cam.position.y += Math.sin(tt * 1.7 + 1) * s;
    cam.lookAt(_v.lerpVectors(G.rig._look, this.shotLook, k));
    cam.fov = lerp(cam.fov, this.shotFov, k); cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------------------------------ pose
  pose(dt, G) {
    const b = this.body;
    b.position.copy(this.pos); b.rotation.set(this.pitch, this.yaw, this.roll); b.updateMatrixWorld(true);
    this.gait(dt);
    this.strandU.uTime.value = G.time;
    this.strandU.uSway.value = damp(this.strandU.uSway.value, 0.06 + 0.05 * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4) + (this.airborne ? 0.12 : 0), 3, dt);
    // the head: toward where it is wanted, facing what it looks at
    if (this.headRate > 0) this.headPos.lerp(this.headWant, 1 - Math.exp(-this.headRate * dt));
    const lx = this.look.x - this.headPos.x, ly = this.look.y - this.headPos.y, lz = this.look.z - this.headPos.z;
    let hy = Math.atan2(lx, lz);
    hy = this.yaw + clamp(wrapAngle(hy - this.yaw), -1.2, 1.2);
    this.headYaw = dampAngle(this.headYaw, hy, 6, dt);
    this.headPitch = damp(this.headPitch, clamp(Math.atan2(-ly, Math.hypot(lx, lz)), -0.9, 1.2) + this.headTilt, 6, dt);
    const h = this.head;
    h.position.copy(this.headPos); h.rotation.set(this.headPitch, this.headYaw, this.headRoll);
    this.jawOpen = damp(this.jawOpen, this.jawWant, this.jawWant > this.jawOpen ? 14 : 22, dt);
    this.jaw.rotation.x = this.jawOpen * 1.1;
    h.updateMatrixWorld(true);
    // the neck: a curve from the front of the body up and over to the back of the skull
    const base = b.localToWorld(_v.set(0, 0.55 * S, 1.7 * S));
    const hf = this.hf.copy(_Z).applyQuaternion(h.quaternion), end = this.np[5].copy(this.headPos).addScaledVector(hf, -0.75 * S);
    const ctrl = _u.copy(base).lerp(end, 0.5); ctrl.y += 1.6 * S;
    for (let i = 0; i <= 5; i++) {
      const t = i / 5, a = (1 - t) * (1 - t), m = 2 * t * (1 - t), c = t * t;
      if (i < 5) this.np[i].set(base.x * a + ctrl.x * m + end.x * c, base.y * a + ctrl.y * m + end.y * c, base.z * a + ctrl.z * m + end.z * c);
    }
    for (let i = 0; i < 5; i++) { const l = this.aimSeg(this.neck[i], this.np[i], this.np[i + 1]); this.neck[i].scale.y = l + 0.25; }
    // legs
    for (const L of this.legs) {
      b.localToWorld(L.hipW.copy(L.hip));
      const foot = this.ik(L.hipW, L.foot, L.knee);
      this.aimSeg(L.femur, L.hipW, L.knee);
      this.aimSeg(L.tibia, L.knee, foot);
      // its target: the lower shin; and the foot is something to walk round
      const tx = foot.x + (L.knee.x - foot.x) * 0.12, tz = foot.z + (L.knee.z - foot.z) * 0.12, gy = groundY(tx, tz);
      const T = L.target; T.x = tx; T.z = tz; T.y0 = Math.max(0, foot.y - gy); T.y1 = T.y0 + 3.2; T.high = T.y0 > 2.0;
      const C = L.collider, onGround = foot.y - groundY(foot.x, foot.z) < 0.6 && this.root.visible;
      C.x = onGround ? foot.x : 1e6; C.z = onGround ? foot.z : 1e6;
      // telegraph glow and hit flash
      const f = this.flash * 0.5, z = this.zap * (0.6 + 0.4 * Math.sin(G.time * 50)), g = L.glow * (1.6 + 0.6 * Math.sin(G.time * 30));
      L.mat.emissive.setRGB(f + L.glowCol.r * g + 0.15 * z, f + L.glowCol.g * g + 0.45 * z, f + L.glowCol.b * g + 1.0 * z);
    }
    const f = this.flash * 0.5, z = this.zap * (0.6 + 0.4 * Math.sin(G.time * 50));
    this.skin.emissive.setRGB(f + 0.15 * z, f + 0.45 * z, f + 1.0 * z);
    this.flash = Math.max(0, this.flash - dt * 5); this.zap = Math.max(0, this.zap - dt * (this.state === 'stun' ? 0.2 : 1.2));
    // eyes: pale, or hot when it is enraged; they flare before a bite
    this.eyeFlare = Math.max(0, (this.eyeFlare || 0) - dt * 2);
    if (this.state !== 'intro' && this.state !== 'dying') this.eye = damp(this.eye, 1, 3, dt);
    this.eyeM.emissive.copy(EYE[0]).lerp(EYE[1], this.phase === 2 ? 1 : 0);
    this.eyeM.emissiveIntensity = this.eye * (5 + 5 * this.eyeFlare + (this.phase === 2 ? 2 : 0) * Math.sin(G.time * 9) ** 2);
    // targets for the head and the body
    const hc = _v.copy(this.headPos).addScaledVector(hf, 1.0 * S), hg = groundY(hc.x, hc.z);
    Object.assign(this.headT, { x: hc.x, z: hc.z, y0: hc.y - 0.8 * S - hg, y1: hc.y + 0.8 * S - hg });
    this.headT.high = this.headT.y0 > 2.2;
    const bg = groundY(this.pos.x, this.pos.z);
    Object.assign(this.bodyT, { x: this.pos.x, z: this.pos.z, y0: this.pos.y - 1.1 * S - bg, y1: this.pos.y + 1.2 * S - bg });
    this.bodyT.high = this.bodyT.y0 > 2.1;
    const ab = b.localToWorld(_w.set(0, 0.8 * S, -3.7 * S)), ag = groundY(ab.x, ab.z);
    Object.assign(this.abdT, { x: ab.x, z: ab.z, y0: ab.y - 1.9 * S - ag, y1: ab.y + 2.0 * S - ag });
    this.abdT.high = this.abdT.y0 > 2.1;
    // when the belly is down it is something to walk round too
    const low = this.root.visible && this.pos.y - bg < 2.2 * S;
    this.bodyC.x = low ? this.pos.x : 1e6; this.bodyC.z = low ? this.pos.z : 1e6;
  }
}
