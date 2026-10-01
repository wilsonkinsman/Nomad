// The ronin's sword. Two parts:
//
// SwordRig: the visible sword. On his back it is the sculpt's sheathed sword (a mesh of the model).
// Once drawn, that mesh disappears and a hand sword appears in his left hand (the hilt over his left
// shoulder is on that side): the same hilt from the sculpt plus a blade built here, with a trail
// that follows the blade through each cut.
//
// Weapon: the combo. Press attack (click, F, gamepad Y): draw and cut -> overhead cut -> thrust ->
// sheathe, and round again. Each move has its own hitbox:
//   cut       a wide fan around the front and both sides, reaching 1.45 m: things close to him
//   overhead  a narrow box straight ahead, 1.6 m, that lands on the ground at the end of the chop
//   thrust    a thin lane straight ahead, 2 m, longer than either of the others
// Hits do what the swing would: the blade cuts the grass and wheat it passes through (they are lopped
// to stubble along the blade's own path and grow back over a minute or two), scatter leaves, throw snow
// and chaff, thud against trees and posts. Press H to see the three volumes.
import * as THREE from 'three';
import { groundY, surfaceAt } from './world.js';
import { clamp, lerp, smoothstep, damp, dampAngle } from './util.js';
import { STUN } from './storm.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const CUT_AT = [0.3, 0.5, 0.7, 0.88, 1.0];      // points along the blade (guard 0, tip 1) that cut

// ---------------------------------------------------------------- the moves
export const MOVES = {
  //            seconds   sword changes hands   active cut     can chain from    next       step forward (at s, m/s)
  draw:     { dur: 0.95, swap: 0.24, hit: [0.44, 0.60], chain: 0.40, cancel: 0.74, next: 'overhead', lunge: [0.36, 1.7], swish: [0.42, 'cut'] },
  overhead: { dur: 0.84, hit: [0.44, 0.58], chain: 0.30, cancel: 0.66, next: 'thrust', lunge: [0.38, 2.6], swish: [0.40, 'overhead'] },
  thrust:   { dur: 0.74, hit: [0.33, 0.45], chain: 0.30, cancel: null, next: null, lunge: [0.30, 4.6], swish: [0.30, 'thrust'] },
  sheathe:  { dur: 0.66, swap: 0.38, hit: null, chain: 0.34, cancel: null, next: null },
  // F: the blade laid flat across his chest. Anything that lands while it is up (PARRY) is turned aside.
  parry:    { dur: 0.62, swap: 0.05, hit: null, chain: 0.28, cancel: 0.5, next: 'overhead' },
  // Sky Slam: the blade over his head while he climbs, pointed down as he plunges, then the landing
  rise:     { dur: 99, swap: 0.05, hit: null, chain: 0, cancel: null, next: null },
  plunge:   { dur: 99, hit: null, chain: 0, cancel: null, next: null },
  slamland: { dur: 0.6, hit: null, chain: 0.3, cancel: null, next: null },
  // Storm Call: the blade held straight up while the sky gathers; the bolt lands on it at STORM_STRIKE
  storm:    { dur: 2.2, swap: 0.08, hit: null, chain: 1.5, cancel: 1.95, next: 'overhead' },
};
const STORM_GATHER = 0.5, STORM_STRIKE = 1.25;
const CHARGED = 1.5;      // what a blow does while the blade holds the storm
const SLAM_RADIUS = 4.8;
export const PARRY_WINDOW = [0.04, 0.34];     // seconds into the move that a blow is turned aside
const PARRY_COOLDOWN = 0.22;
const HURT = { draw: 14, overhead: 28, thrust: 20 };     // what each move does to something that can be hurt
const COMBO_WINDOW = 0.65;      // seconds he waits, blade out, for the next press before sheathing

// the three hitboxes, in his frame: forward (a), left (b), metres; angles in radians
export const HIT = {
  cut: { reach: 1.45, half: 1.85, wedge: 0.55 },        // the fan sweeps from 106 degrees left to 106 degrees right
  overhead: { from: 0.15, to: 1.75, half: 0.5 },
  thrust: { from: 0.25, to: 2.25, half: 0.2 },
};

// ---------------------------------------------------------------- blade geometry
function buildBlade(len, width = 0.072, thick = 0.019) {
  const N = 28, curve = 0.055;
  const pos = [], col = [], idx = [];
  // [x thickness, z width, shade], edge at +z. The bevel running from the edge up to the ridge line
  // catches the light and the flats and the back are darker, so the blade reads as a blade from any angle.
  const prof = (w, t) => [[0, w / 2, 1.0], [t / 2, w / 2 - w * 0.34, 0.8], [t / 2, -w / 2, 0.6], [-t / 2, -w / 2, 0.6], [-t / 2, w / 2 - w * 0.34, 0.8]];
  for (let i = 0; i <= N; i++) {
    const s = i / N, y = s * len;
    const tip = s > 0.9 ? Math.max(0, 1 - (s - 0.9) / 0.1) : 1;
    const w = width * (1 - 0.18 * s) * (0.12 + 0.88 * tip), t = thick * (1 - 0.35 * s) * tip;
    for (const [px, pz, sh] of prof(w, t)) { pos.push(px, y, pz - curve * s * s); col.push(sh, sh, sh); }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < 5; k++) {
    const a = i * 5 + k, b = i * 5 + (k + 1) % 5, c = a + 5, d = b + 5;
    idx.push(a, c, b, b, c, d);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g = g.toNonIndexed(); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the visible sword
export class SwordRig {
  constructor(model, o = {}) {
    this.model = model;
    this.back = model.backSword;
    this.hand = model.g.LeftHand;
    this.len = o.len ?? 0.74;
    this.gap = o.gap ?? 0.17;                  // how far up the hilt the right hand holds, from the left
    this.group = new THREE.Group();            // origin at the guard, +Y toward the tip
    const hilt = model.hiltMesh;
    hilt.castShadow = true; hilt.receiveShadow = true; hilt.frustumCulled = false;
    this.group.add(hilt);
    this.steel = new THREE.MeshStandardMaterial({ color: 0xe6edf2, metalness: 0.72, roughness: 0.3, vertexColors: true, side: THREE.DoubleSide });
    this.blade = new THREE.Mesh(buildBlade(this.len), this.steel);
    this.blade.castShadow = true; this.blade.frustumCulled = false;
    this.group.add(this.blade);
    this.hand.add(this.group);
    this.mount(o.grip || {});
    this.trail = new Trail(model);
    this.setDrawn(false);
  }

  // Put the sword in the fist. At the bind pose (arm hanging, fist at his side) the blade points along
  // `blade` and its edge faces `edge` (character space: x left, y up, z forward); `at` is how far
  // the guard sits in front of the fist along the hilt.
  mount(g) {
    const M = this.model, hand = this.hand;
    const blade = new THREE.Vector3(...(g.blade || [0, -0.57, 0.82])).normalize();
    let edge = new THREE.Vector3(...(g.edge || [-1, 0, 0]));
    edge.addScaledVector(blade, -edge.dot(blade)).normalize();
    const flat = new THREE.Vector3().crossVectors(blade, edge);          // x axis: the flat of the blade
    const Q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(flat, blade, edge));
    const hp = M.bindPos.get(hand), hq = M.bindW.get(hand);
    const mid = M.g.LeftHandMiddle1 ? M.bindPos.get(M.g.LeftHandMiddle1) : hp;
    const fist = hp.clone().lerp(mid, g.fistK ?? 0.6);
    const at = this.at = g.at ?? 0.34;      // the guard sits this far up the hilt from the fist
    const guard = fist.clone().addScaledVector(blade, at).add(new THREE.Vector3(...(g.shift || [0, 0, 0])));
    const hqi = hq.clone().invert();
    this.group.position.copy(guard).sub(hp).applyQuaternion(hqi);
    this.group.quaternion.copy(hqi).multiply(Q);
  }

  setDrawn(on) {
    this.drawn = on;
    if (this.back) this.back.visible = !on;
    this.group.visible = on;
    if (!on) this.trail.clear();
  }

  // Storm Call: the steel glows blue-white and flickers while it holds the charge (k 0..1, set by the storm)
  applyCharge(time) {
    const k = this.chargeK || 0, e = this.steel.emissive;
    if (k < 0.01) { if (this.wasCharged) { this.wasCharged = false; if (this.glintT == null) e.setScalar(0); } return; }
    this.wasCharged = true;
    const f = k * (0.75 + 0.25 * Math.sin(time * 37) * Math.sin(time * 23)), r = 0.22 * f, g = 0.5 * f, b = 1.1 * f;
    if (this.glintT == null) e.setRGB(r, g, b); else e.setRGB(Math.max(e.r, r), Math.max(e.g, g), Math.max(e.b, b));
  }

  // blade points in world space (origin of the trail ribbon)
  point(k, out) { return this.group.localToWorld(out.set(0, this.len * k, 0)); }

  // A glint runs down the blade: a bright star that slides from the guard to the tip while the steel
  // itself flares. `power` 1 is the ring of a raised guard, 2 a blow turned aside.
  glint(power = 1) { this.glintT = 0; this.glintPow = power; }
  updateGlint(dt, camera) {
    if (!this.star) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const rad = g.createRadialGradient(64, 64, 0, 64, 64, 64); rad.addColorStop(0, 'rgba(255,255,255,1)'); rad.addColorStop(0.12, 'rgba(255,248,225,0.85)'); rad.addColorStop(0.4, 'rgba(255,240,200,0.14)'); rad.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = rad; g.fillRect(0, 0, 128, 128);
      for (const [a, len, w] of [[0, 62, 3.2], [Math.PI / 2, 62, 3.2], [Math.PI / 4, 34, 1.6], [-Math.PI / 4, 34, 1.6]]) {
        g.save(); g.translate(64, 64); g.rotate(a);
        const l = g.createLinearGradient(-len, 0, len, 0); l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.5, 'rgba(255,255,255,1)'); l.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = l; g.beginPath(); g.moveTo(-len, 0); g.lineTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill(); g.restore();
      }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.star = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.star.visible = false; this.star.renderOrder = 14; this.group.add(this.star);
    }
    if (this.glintT == null) return;
    this.glintT += dt;
    const D = 0.26, u = this.glintT / D;
    if (u >= 1 || !this.drawn) { this.glintT = null; this.star.visible = false; this.steel.emissive.setScalar(0); return; }
    const s = Math.sin(Math.PI * u), k = 0.12 + 0.86 * (1 - Math.pow(1 - u, 2.2));
    // slightly toward the camera, so the blade does not hide half of it
    const p = this.point(k, new THREE.Vector3()); p.addScaledVector(camera.position.clone().sub(p).normalize(), 0.06);
    this.star.position.copy(this.group.worldToLocal(p));
    this.star.scale.setScalar((0.28 + 0.34 * this.glintPow) * (0.35 + 0.65 * s));
    this.star.material.rotation = u * 1.6; this.star.material.opacity = Math.min(1, s * 1.6);
    this.star.visible = true;
    this.steel.emissive.setScalar(0.55 * this.glintPow * s);
  }
}

// ---------------------------------------------------------------- slash trail
class Trail {
  constructor(model, max = 22) {
    this.model = model; this.max = max; this.s = [];    // samples {a: Vector3, b: Vector3, t}
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('color', this.col);
    const idx = []; for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx); g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'attribute vec4 color; varying vec4 vC; void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec4 vC; void main() { gl_FragColor = vec4(vC.rgb, vC.a); }',
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 12;
    this.life = 0.13;
  }
  clear() { this.s.length = 0; this.mesh.geometry.setDrawRange(0, 0); }
  update(dt, rig, active) {
    for (const p of this.s) p.age += dt;
    while (this.s.length && this.s[0].age > this.life) this.s.shift();
    if (active) {
      rig.point(0.86, _v); const a = _v.clone(); rig.point(1.0, _v); const b = _v.clone();
      // the blade jumped (the sword was just drawn, or the move changed): start a fresh ribbon
      const last = this.s[this.s.length - 1];
      if (last && last.b.distanceTo(b) > 1.1) this.s.length = 0;
      this.s.push({ a, b, age: 0 });
      if (this.s.length > this.max) this.s.shift();
    }
    const n = this.s.length;
    if (n < 2) { this.mesh.geometry.setDrawRange(0, 0); return; }
    const P = this.pos.array, C = this.col.array;
    const ch = clamp((rig.chargeK || 0) * 1.5, 0, 1);
    this.s.forEach((p, i) => {
      const f = Math.pow(1 - p.age / this.life, 1.6);
      P.set([p.a.x, p.a.y, p.a.z, p.b.x, p.b.y, p.b.z], i * 6);
      C.set([lerp(0.62, 0.3, ch), lerp(0.74, 0.58, ch), lerp(0.92, 1.0, ch), 0.0, lerp(0.85, 0.7, ch), lerp(0.92, 0.9, ch), 1.0, (0.24 + 0.3 * ch) * f], i * 8);
    });
    this.pos.needsUpdate = this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6);
  }
}

// ---------------------------------------------------------------- the combo
export class Weapon {
  constructor(game, player, rig) {
    this.game = game; this.player = player; this.rig = rig;
    this.kind = null; this.t = 0; this.swapped = false;
    this.lastKind = 'draw'; this.w = 0;
    this.queued = null; this.buffer = 0; this.waiting = 0; this.waitingOn = false;
    this.moveScale = 1; this.busy = false; this.faceLock = false;
    this.aim = 0; this.prevS = 0; this.struck = new Set(); this.lunged = false; this.swished = false;
    this.legs = 1; this._s = {};
    this.parryCool = 0; this.glinted = false; this.deflected = 0; this.plungeReq = 0; this.apexCue = false;
    this.gathered = false; this.bolted = false;
    this.waves = [];         // the rings of a slam spreading over the ground
    this._bp = Array.from({ length: CUT_AT.length }, () => new THREE.Vector3()); this._bpOk = false;   // where the blade was last frame
    this.debug = null;
    game.scene.add(rig.trail.mesh);
  }

  // --- input -------------------------------------------------------------------------------
  press() {
    const P = this.player;
    if (this.kind === 'rise') { this.plungeReq = 0.4; return; }       // click at the top of a Sky Slam leap
    if (!P.grounded || P.state !== 'ground') return;
    if (!this.kind) return this.begin('draw');
    const M = MOVES[this.kind];
    if (this.kind === 'sheathe') { if (this.swapped) this.begin('draw'); else this.queued = 'draw'; return; }
    if (this.waitingOn) return this.begin(M.next);
    this.buffer = 0.35;                         // remembered a moment, so an early press still chains
  }

  // F: bring the blade up across the chest (drawing it first if it is on his back)
  parry() {
    const P = this.player, G = this.game;
    if (!P.grounded || P.state !== 'ground' || this.parryCool > 0) return;
    if (G.bow?.equipped) return;
    if (this.kind === 'parry' && this.t < MOVES.parry.cancel) return;
    this.begin('parry');
  }
  // R: hold the blade straight up and call the lightning down onto it (a skill that grows from Sky Slam)
  storm() {
    const P = this.player, G = this.game, S = G.skills;
    if (!S || !S.has('storm') || !S.has('skyslam')) { G.hud?.hint('Learn Storm Call in the skill tree (K), under Sky Slam', 3); return; }
    if (!P.grounded || P.state !== 'ground' || G.bow?.equipped || this.kind === 'storm') return;
    if (G.storm && G.storm.charged) { G.hud?.hint('The storm is already on the blade', 1.5); return; }
    if (G.storm && G.storm.cool > 0) { G.hud?.hint('The sky is still settling: ' + Math.ceil(G.storm.cool) + ' s', 1.5); return; }
    if (this.kind && !this.waitingOn && !(MOVES[this.kind].cancel != null && this.t >= MOVES[this.kind].cancel)) return;
    this.begin('storm');
  }
  // the blade is up and a blow lands: turn it aside
  get parrying() { return this.kind === 'parry' && this.t >= PARRY_WINDOW[0] && this.t <= PARRY_WINDOW[1]; }
  // called by whatever is hitting him; true if the blow was turned aside (and the effects have played)
  deflect(from) {
    if (!this.parrying || this.t - this.deflected < 0.12) return false;
    const G = this.game, p = this.rig.point(0.55, new THREE.Vector3());
    this.deflected = this.t;
    G.audio?.sword('clang');
    this.rig.glint(2);
    for (let i = 0; i < 18; i++) G.particles.emit('spark', p.x, p.y, p.z, (Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6, 3, 1);
    G.rig.shake = Math.max(G.rig.shake, 0.4); G.hitStop = Math.max(G.hitStop, 0.1);
    G.hud?.callout('PARRY', 'gold');
    return true;
  }

  begin(kind) {
    const P = this.player, G = this.game, M = MOVES[kind];
    this.glinted = false; this.plungeReq = 0; this.apexCue = false; this.gathered = false; this.bolted = false;
    this.kind = kind; this.lastKind = kind; this.t = 0; this.swapped = (kind === 'parry' || kind === 'rise' || kind === 'storm') && this.rig.drawn || kind === 'plunge' || kind === 'slamland'; this.queued = null;
    this.waitingOn = false; this.waiting = 0; this.struck.clear(); this.lunged = false; this.swished = false; this.landed = false; this.prevS = 0;
    // face where the camera looks
    const b = G.rig.basis();
    this.aim = Math.atan2(b.fx, b.fz);
    if (kind === 'draw') this.rig.trail.clear();
  }

  reset() {
    this.kind = null; this.t = 0; this.w = 0; this.queued = null; this.waitingOn = false; this.buffer = 0;
    this.moveScale = 1; this.busy = false; this.faceLock = false;
    this.rig.setDrawn(false);
  }

  // dev: hold a move at an exact time (captures), and let go again
  force(kind, t) {
    const M = MOVES[kind];
    this.freeze = true; this.kind = kind; this.lastKind = kind; this.t = t; this.w = 1;
    this.rig.setDrawn(kind === 'sheathe' ? !(t >= M.swap) : (M.swap == null || t >= M.swap));
  }
  release() { this.freeze = false; this.reset(); }

  // Sky Slam: he has jumped again in the air: the blade goes up over his head
  beginRise() {
    const b = this.game.rig.basis();
    this.begin('rise'); this.aim = Math.atan2(b.fx, b.fz);
  }
  // Sky Slam: the leap and the plunge (the player's vertical motion is in player.js)
  airTick(dt) {
    const P = this.player, G = this.game, M = MOVES[this.kind];
    this.t += dt; this.busy = true; this.faceLock = true; this.moveScale = 0.8;
    this.w = Math.min(1, this.w + dt * 12);
    P.heading = dampAngle(P.heading, this.aim, 10, dt);
    if (!this.swapped && this.t >= M.swap) { this.swapped = true; this.rig.setDrawn(true); G.audio?.sword('draw'); }
    this.plungeReq = Math.max(0, this.plungeReq - dt);
    if (this.kind === 'rise') {
      if (P.grounded) { this.begin('sheathe'); return; }              // came down without slamming
      if (!this.apexCue && P.vel.y < 2.6) { this.apexCue = true; this.rig.glint(1); G.hud?.hint('Click to slam!', 1.3); }
      if (this.plungeReq > 0 && P.vel.y < 3.4) this.plunge();
    } else {
      if (P.vel.y > -26) P.vel.y = -28;
      if (P.grounded && this.t > 0.04) this.slam();
    }
  }
  plunge() {
    const P = this.player, G = this.game, b = G.rig.basis();
    this.begin('plunge'); this.aim = Math.atan2(b.fx, b.fz);
    P.vel.set(Math.sin(this.aim) * 2.5, -28, Math.cos(this.aim) * 2.5);
    G.audio?.whoosh(); G.hud?.hint('', 0);
  }
  // he lands: a shockwave. Hurts what is near, tears up the grass and throws up the ground.
  slam() {
    const P = this.player, G = this.game, R = SLAM_RADIUS, px = P.pos.x, pz = P.pos.z, py = P.pos.y;
    const surf = surfaceAt(px, pz, this._s);
    // the grass and the wheat are cut down in a wide disc and the rest of the field is flattened outward
    G.cut.stamp(px, pz, R * 0.6, 1); G.cut.stamp(px, pz, R, 1);
    G.trample.stamp(px, pz, R * 1.1, 1, 0, 0, 1);
    for (let a = 0; a < 6.28; a += 0.5) G.cut.stamp(px + Math.cos(a) * R * 0.8, pz + Math.sin(a) * R * 0.8, R * 0.45, 1);
    // everything hurt in reach, hardest at the middle
    const charged = !!(G.storm && G.storm.charged);
    for (const c of G.enemies?.targets || []) {
      if (c.dead) continue;
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < R + c.r) {
        c.onHit?.('slam', Math.round(lerp(48, 22, clamp(d / R, 0, 1)) * (charged ? CHARGED : 1)), c.x - px, c.z - pz, charged ? { zap: true, stun: STUN } : null);
        if (charged) G.storm.zap(new THREE.Vector3(px, py + 0.3, pz), new THREE.Vector3(c.x, groundY(c.x, c.z) + 1.2, c.z));
      }
    }
    if (charged) {         // the shockwave is full of lightning: arcs run out over the ground and the litter burns
      G.leaves.singe(px, pz, R, 1);
      for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, r = R * (0.5 + Math.random() * 0.5), x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r; G.storm.zap(new THREE.Vector3(px, py + 0.25, pz), new THREE.Vector3(x, groundY(x, z) + 0.2, z)); }
      G.audio?.storm('zap');
    }
    // the ground
    G.snow.onImpact(new THREE.Vector3(px, py, pz), this.aim, 'land'); G.snow.stamp(px, pz, 2.4, 2.4, 0, 1, 1);
    G.leaves.burst(px, py, pz, 3.4, 6);
    const pz2 = G.particles;
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; pz2.emit('dust', px + Math.cos(a) * 0.8, py + 0.1, pz + Math.sin(a) * 0.8, Math.cos(a) * 7, 0.8, Math.sin(a) * 7, 1.2, 1); }
    for (let i = 0; i < 46; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.8; pz2.emit(surf.wheat > 0.35 ? 'chaff' : 'clip', px + Math.cos(a) * r, py + 0.2, pz + Math.sin(a) * r, Math.cos(a) * 3, 3 + Math.random() * 4, Math.sin(a) * 3, 1.5, 1); }
    this.waves.push({ x: px, y: py + 0.05, z: pz, t: 0 });
    G.audio?.slam(); G.rig.shake = 1; G.hitStop = Math.max(G.hitStop, 0.12);
    G.hud?.callout(charged ? 'STORM SLAM' : 'SKY SLAM', charged ? 'blue' : 'gold');
    this.begin('slamland'); this.w = 1;
  }

  // --- per frame, before the player moves --------------------------------------------------
  tick(dt, inMenu) {
    const P = this.player, G = this.game, input = G.input;
    if (this.freeze) { P.vel.set(0, 0, 0); this.moveScale = 0; this.faceLock = true; return; }
    if (inMenu) { if (this.kind) this.reset(); return; }
    if (P.state === 'dive' || P.state === 'roll' || P.state === 'flop' || P.state === 'getup' || P.state === 'flash' || P.state === 'tackle') { if (this.kind) this.reset(); this.w = 0; return; }
    if (G.bow?.equipped) { if (this.kind) this.reset(); this.w = 0; return; }
    this.parryCool = Math.max(0, this.parryCool - dt);
    if (input.attack()) this.press();
    if (input.parry()) this.parry();
    if (input.stormKey()) this.storm();
    if (this.kind === 'rise' || this.kind === 'plunge') { this.airTick(dt); return; }
    // the legs take the sword stance only while he is not walking; blended, never switched
    this.legs = damp(this.legs, input.move().mag > 0.2 ? 0 : 1, 9, dt);
    this.buffer = Math.max(0, this.buffer - dt);

    if (!this.kind) {
      this.w = Math.max(0, this.w - dt * 9);
      this.moveScale = 1; this.busy = false; this.faceLock = false;
      return;
    }
    const M = MOVES[this.kind];
    this.t += dt;
    this.busy = this.kind !== 'sheathe';
    this.faceLock = this.kind !== 'sheathe';
    this.moveScale = this.kind === 'sheathe' ? 0.7 : this.waitingOn ? 0.55 : 0.3;
    if (this.faceLock) P.heading = dampAngle(P.heading, this.aim, 16, dt);

    if (this.kind === 'parry') {
      this.moveScale = 0.35;
      if (!this.glinted && this.t >= PARRY_WINDOW[0]) { this.glinted = true; this.rig.glint(1); G.audio?.sword('parry'); }
      if (this.t >= M.dur - 0.01) this.parryCool = PARRY_COOLDOWN;
    }
    if (this.kind === 'storm') {
      this.moveScale = 0.1;
      if (!this.gathered && this.t >= STORM_GATHER) { this.gathered = true; G.audio?.storm('gather'); }
    }
    // the sword changes places
    if (M.swap != null && !this.swapped && this.t >= M.swap) {
      this.swapped = true;
      this.rig.setDrawn(this.kind !== 'sheathe');
      G.audio?.sword(this.kind === 'sheathe' ? 'sheathe' : 'draw');
    }
    // step forward with the swing
    if (M.lunge && !this.lunged && this.t >= M.lunge[0]) {
      this.lunged = true;
      const fx = Math.sin(this.aim), fz = Math.cos(this.aim);
      P.vel.x += fx * M.lunge[1]; P.vel.z += fz * M.lunge[1];
    }
    if (M.swish && !this.swished && this.t >= M.swish[0]) { this.swished = true; G.audio?.sword(M.swish[1]); }

    // chaining: a press during the move is held until the move allows it
    if (this.buffer > 0 && M.next && this.t >= M.chain && !this.queued) { this.queued = M.next; this.buffer = 0; }
    if (this.queued && (M.cancel != null ? this.t >= M.cancel : this.t >= M.dur)) {
      const q = this.queued;
      if (this.kind === 'sheathe' && !this.swapped) { /* wait for the sword to be back */ } else return this.begin(q);
    }
    if (this.t >= M.dur) {
      if (this.kind === 'sheathe') { this.kind = null; this.t = 0; return; }
      if (M.next) {
        if (!this.waitingOn) { this.waitingOn = true; this.waiting = 0; }
        this.waiting += dt;
        if (this.waiting >= COMBO_WINDOW) this.begin('sheathe');
      } else this.begin('sheathe');      // the thrust ends the combo
    }
    // layer weight: in quickly, out as the sheathing finishes
    const tgt = this.kind === 'sheathe' && this.t > M.dur - 0.16 ? 0 : 1;
    if (tgt > this.w) this.w = Math.min(1, this.w + dt * 12);
    else if (tgt < this.w) this.w = Math.max(0, this.w - dt * 8);
  }

  // what the animator needs
  get layer() {
    const kind = this.kind || this.lastKind;
    const t = this.kind ? Math.min(this.t, MOVES[kind].dur) : MOVES[kind].dur;
    return { kind, t, w: this.w, legs: this.legs };
  }

  // The lunge throws him forward at several m/s, which would spin the walk cycle up under the swing.
  // The gait sees only what he is doing on purpose.
  animSpeed(hs) {
    if (!this.kind && this.w < 0.01) return hs;
    return this.legs < 0.5 ? Math.min(hs, 1.3) : 0;
  }

  // --- per frame, after the pose is applied --------------------------------------------------
  after(dt) {
    const M = this.kind ? MOVES[this.kind] : null;
    const cutting = !!(M && M.hit && this.t >= M.hit[0] && this.t <= M.hit[1] + 0.04);
    this.rig.trail.update(dt, this.rig, this.rig.drawn && (cutting || (M && M.hit && this.t > M.hit[0] - 0.08 && this.t < M.hit[1] + 0.1)));
    this.cutSweep(dt, M);
    this.rig.updateGlint(dt, this.game.camera);
    this.rig.applyCharge(this.game.time);
    if (this.kind === 'storm' && !this.freeze && dt > 0) this.stormTick();
    this.updateWaves(dt);
    if (M && M.hit && dt > 0 && !this.freeze) {
      const s = clamp((this.t - M.hit[0]) / (M.hit[1] - M.hit[0]), 0, 1);
      if (this.t >= M.hit[0] && this.t <= M.hit[1] + 1e-4) this.scan(this.kind, s);
      this.prevS = s;
    }
    this.updateDebug();
  }

  // Storm Call: the sky darkens while the blade is up; at the top of the cast the bolt lands on the tip
  stormTick() {
    const G = this.game, S = G.storm;
    if (!S) return;
    if (this.t < STORM_STRIKE) {
      const k = smoothstep(STORM_GATHER, STORM_STRIKE, this.t);
      S.setGather(k); G.rig.shake = Math.max(G.rig.shake, 0.12 * k);
    } else if (!this.bolted) {
      this.bolted = true;
      S.strike(this.rig.point(1, new THREE.Vector3()), this.player);
    }
  }

  // ---------------------------------------------------------------- hit scan
  frame() {
    const P = this.player, h = this.aim;
    return { x: P.pos.x, y: P.pos.y, z: P.pos.z, fx: Math.sin(h), fz: Math.cos(h), lx: Math.cos(h), lz: -Math.sin(h) };
  }
  at(F, a, b) { return [F.x + F.fx * a + F.lx * b, F.z + F.fz * a + F.lz * b]; }

  scan(kind, s) {
    const F = this.frame(), G = this.game;
    // sample every part of the swing since the last frame, so a slow frame doesn't skip anything
    const steps = Math.max(1, Math.ceil(Math.abs(s - this.prevS) / 0.12));
    for (let i = 1; i <= steps; i++) {
      const si = lerp(this.prevS, s, i / steps);
      if (kind === 'draw') this.scanCut(F, si);
      else if (kind === 'overhead') this.scanOverhead(F, si);
      else if (kind === 'thrust') this.scanThrust(F, si);
    }
  }

  // cut: a fan that sweeps from his left, round the front, to his right
  cutAngle(s) { return lerp(HIT.cut.half, -HIT.cut.half, s * s * (3 - 2 * s)); }
  scanCut(F, s) {
    const phi = this.cutAngle(s), cs = Math.cos(phi), sn = Math.sin(phi);
    // the blade moves toward decreasing phi: tangent = f sin(phi) - l cos(phi)
    const tx = F.fx * sn - F.lx * cs, tz = F.fz * sn - F.lz * cs;
    for (const r of [0.55, 0.95, 1.35]) {
      const [x, z] = this.at(F, r * cs, r * sn);
      this.strike(x, z, 0.4, tx, tz, 1, 'cut');
    }
    this.hitObjects('draw', F, (c, dx, dz, dist) => {
      if (dist > HIT.cut.reach + c.r) return false;
      const a = dx * F.fx + dz * F.fz, b = dx * F.lx + dz * F.lz;
      return Math.abs(Math.atan2(b, a) - phi) <= HIT.cut.wedge + Math.asin(Math.min(1, c.r / Math.max(dist, 0.01)));
    });
  }

  // overhead: lands on the ground straight ahead
  scanOverhead(F, s) {
    if (s < 0.55) return;
    if (!this.landed) {
      this.landed = true;
      const [x, z] = this.at(F, 1.2, 0);
      this.impact(F, x, z);
    }
    this.hitObjects('overhead', F, (c, dx, dz) => {
      const a = dx * F.fx + dz * F.fz, b = dx * F.lx + dz * F.lz;
      return a >= HIT.overhead.from - c.r && a <= HIT.overhead.to + c.r && Math.abs(b) <= HIT.overhead.half + c.r;
    });
  }

  // thrust: a thin lane that gets longer as the point goes out
  scanThrust(F, s) {
    const e = s * s * (3 - 2 * s), reach = lerp(0.45, HIT.thrust.to, e);
    for (let a = HIT.thrust.from + 0.1; a <= reach; a += 0.3) {
      const [x, z] = this.at(F, a, 0);
      this.strike(x, z, 0.2, F.fx, F.fz, 1.2, 'thrust');
    }
    const [tx, tz] = this.at(F, reach, 0);
    this.tip(tx, tz, F);
    this.hitObjects('thrust', F, (c, dx, dz) => {
      const a = dx * F.fx + dz * F.fz, b = dx * F.lx + dz * F.lz;
      return a >= HIT.thrust.from - c.r && a <= reach + c.r && Math.abs(b) <= HIT.thrust.half + c.r;
    });
  }

  // the shockwave: two rings of light racing out over the ground
  updateWaves(dt) {
    const G = this.game;
    if (!this.waveMat) {
      this.waveGeo = new THREE.RingGeometry(0.94, 1.0, 64).rotateX(-Math.PI / 2);
      this.waveMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]; w.t += dt;
      if (!w.meshes) { w.meshes = [0, 1].map(() => { const m = new THREE.Mesh(this.waveGeo, this.waveMat.clone()); m.renderOrder = 13; m.frustumCulled = false; G.scene.add(m); return m; }); }
      const u = w.t / 0.55;
      w.meshes.forEach((m, k) => {
        const uu = clamp(u - k * 0.12, 0, 1), s = 0.3 + (SLAM_RADIUS * 1.1) * (1 - Math.pow(1 - uu, 3));
        m.position.set(w.x, groundY(w.x, w.z) + 0.08, w.z); m.scale.set(s, 1, s); m.material.opacity = (1 - uu) * (k ? 0.5 : 0.9);
      });
      if (u >= 1.2) { for (const m of w.meshes) { G.scene.remove(m); m.material.dispose(); } this.waves.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- the blade cuts what grows
  // While a move is live, follow several points along the blade through the world and, wherever one is
  // low enough to be among the stalks, cut a disc there. A fast swing moves a point further than a
  // disc is wide in one frame, so each point is stepped from where it was to where it is.
  cutSweep(dt, M) {
    const G = this.game, rig = this.rig;
    const live = !!(M && M.hit && rig.drawn && !this.freeze && dt > 0 && this.t >= M.hit[0] - 0.05 && this.t <= M.hit[1] + 0.12);
    if (!live) { this._bpOk = false; return; }
    for (let i = 0; i < CUT_AT.length; i++) {
      const cur = rig.point(CUT_AT[i], _v), prev = this._bp[i];
      if (!this._bpOk) prev.copy(cur);
      const dx = cur.x - prev.x, dz = cur.z - prev.z, dy = cur.y - prev.y;
      const steps = clamp(Math.ceil(Math.hypot(dx, dy, dz) / 0.12), 1, 8);
      // the speed of the blade here, for the flying cuttings
      const sp = Math.hypot(dx, dz) / dt, k = sp > 7 ? 7 / sp : 1, vx = dx / dt * k, vz = dz / dt * k;
      for (let j = 1; j <= steps; j++) this.cutAt(prev.x + dx * j / steps, prev.y + dy * j / steps, prev.z + dz * j / steps, vx, vz, CUT_AT[i]);
      prev.copy(cur);
    }
    this._bpOk = true;
  }

  // a point of the blade at (x, y, z): cut the stalks under it if it is within their height
  cutAt(x, y, z, vx, vz, along) {
    const G = this.game, s = surfaceAt(x, z, this._s), gy = groundY(x, z), h = y - gy;
    const wheat = s.wheat > 0.35, grass = !wheat && s.grass > 0.3 && s.path < 0.6;
    if (!wheat && !grass) return;
    if (h > (wheat ? 1.15 : 0.8) || h < -0.3) return;
    G.cut.stamp(x, z, 0.24 + 0.08 * along, 1);
    if (Math.random() < 0.6) {
      const up = clamp(h, 0.1, 0.7);
      G.particles.emit(wheat ? 'chaff' : 'clip', x, gy + up, z, vx * 0.35, 1.4 + Math.random() * 1.2, vz * 0.35, 1.3, wheat ? 3 : 3);
    }
  }

  // ---------------------------------------------------------------- effects
  // the blade passes over a point on the ground heading (dx, dz)
  strike(x, z, r, dx, dz, power, kind) {
    const G = this.game, s = surfaceAt(x, z, this._s), y = groundY(x, z), pz = G.particles;
    // grass and wheat are cut where the blade really is (cutSweep), not pushed flat; other ground is shoved
    if (s.grass < 0.3 && s.wheat < 0.3) G.trample.stamp(x, z, r, clamp(0.55 + power * 0.4, 0, 1), dx, dz, 1);
    if (s.leaves > 0.15) G.leaves.kick(x, z, r + 0.3, 0.8 + power, dx * (kind === 'thrust' ? 9 : 6), dz * (kind === 'thrust' ? 9 : 6));
    if (s.leaves > 0.15 && G.storm && G.storm.charged) G.leaves.singe(x, z, r + 0.4, 0.5);
    if (Math.random() < 0.7) {
      if (s.wheat > 0.35) pz.emit('seed', x, y + 0.55, z, dx * 3, 1.5, dz * 3, 1.2, kind === 'cut' ? 4 : 2);
      else if (s.snow > 0.4) pz.emit('powder', x, y + G.snow.depthAt(x, z), z, dx * 2, 1.0, dz * 2, 1.0, 2);
      else if (s.grass > 0.35 && s.path < 0.4) pz.emit('grass', x, y + 0.25, z, dx * 3, 2.0, dz * 3, 1.3, kind === 'cut' ? 4 : 2);
      else if (s.path > 0.4) pz.emit('dust', x, y + 0.05, z, dx * 1.5, 0.6, dz * 1.5, 0.6, 1);
    }
  }

  // the overhead cut lands: a crater and a burst
  impact(F, x, z) {
    const G = this.game, s = surfaceAt(x, z, this._s), y = groundY(x, z), pz = G.particles;
    const p = new THREE.Vector3(x, y, z);
    // the chop lands on the ground: whatever grows there is cut down along the blade and where it struck
    for (let a = 0.35; a <= 1.7; a += 0.3) {
      const [px, pzz] = this.at(F, a, 0);
      const sp = surfaceAt(px, pzz, this._s);
      if (sp.grass > 0.3 || sp.wheat > 0.3) G.cut.stamp(px, pzz, 0.34, 1); else G.trample.stamp(px, pzz, 0.55, 1, F.fx, F.fz, 1);
    }
    if (s.grass > 0.3 || s.wheat > 0.3) G.cut.stamp(x, z, 0.55, 1); else G.trample.stamp(x, z, 0.9, 1, F.fx * 0.4, F.fz * 0.4, 1);
    G.snow.onImpact(p, this.aim, 'land');
    G.snow.stamp(x, z, 0.5, 0.45, this.aim, 1, 1);
    G.leaves.onImpact(p, 'roll', 8);
    if (s.leaves > 0.15) G.leaves.kick(x, z, 1.3, 1.6, F.fx * 5, F.fz * 5);
    if (s.wheat > 0.35) pz.emit('seed', x, y + 0.5, z, F.fx * 2, 2.2, F.fz * 2, 1.6, 22);
    else if (s.snow > 0.4) pz.emit('snow', x, y + G.snow.depthAt(x, z), z, F.fx * 1.5, 2.6, F.fz * 1.5, 2.0, 40);
    else if (s.grass > 0.3 && s.path < 0.4) pz.emit('grass', x, y + 0.2, z, F.fx * 2, 3.0, F.fz * 2, 2.0, 14);
    pz.emit('dust', x, y + 0.05, z, F.fx * 1.2, 1.0, F.fz * 1.2, 1.4, 12);
    if (G.storm && G.storm.charged) {
      G.leaves.singe(x, z, 2.6, 1);
      for (let i = 0; i < 20; i++) { const a = Math.random() * 6.28, s2 = 2 + Math.random() * 5; pz.emit('zap', x, y + 0.2, z, Math.cos(a) * s2, 1 + Math.random() * 3, Math.sin(a) * s2, 1, 1); }
      G.audio?.storm('zap');
    }
    G.audio?.sword('slam');
    G.rig.shake = Math.max(G.rig.shake, 0.32);
    G.hitStop = Math.max(G.hitStop, 0.09);
  }

  // the point of the thrust
  tip(x, z, F) {
    const G = this.game, y = groundY(x, z), pz = G.particles, s = surfaceAt(x, z, this._s);
    if (Math.random() < 0.8) {
      if (s.snow > 0.4) pz.emit('powder', x, y + G.snow.depthAt(x, z), z, F.fx * 3, 1.2, F.fz * 3, 1.2, 3);
      else pz.emit('dust', x, y + 0.1, z, F.fx * 3, 0.7, F.fz * 3, 0.8, 2);
    }
  }

  // a charged blow: a little bolt from the blade to what it hit, and the leaves around that spot catch
  zapHit(x, z, y) {
    const G = this.game, S = G.storm, pz = G.particles;
    S.zap(this.rig.point(0.8, new THREE.Vector3()), new THREE.Vector3(x, y, z));
    G.audio?.storm('zap'); G.leaves.singe(x, z, 2.2, 0.9);
    for (let i = 0; i < 14; i++) pz.emit('zap', x, y, z, (Math.random() - 0.5) * 5, Math.random() * 3.5, (Math.random() - 0.5) * 5, 0.8, 1);
  }

  // trees, rocks, posts the volume touches (once per swing each)
  hitObjects(kind, F, test) {
    const G = this.game, list = [G.trees?.colliders, G.props?.colliders, G.enemies?.targets];
    for (const L of list) {
      if (!L) continue;
      for (const c of L) {
        if (c.dead) continue;
        const dx = c.x - F.x, dz = c.z - F.z, d2 = dx * dx + dz * dz;
        if (d2 > 3.6 * 3.6) continue;
        if (this.struck.has(c)) continue;
        const dist = Math.sqrt(d2);
        if (!test(c, dx, dz, dist)) continue;
        this.struck.add(c);
        const charged = !!(G.storm && G.storm.charged);
        if (c.onHit) {                 // something that takes damage (the dummy, the practice enemy)
          c.onHit(kind === 'draw' ? 'cut' : kind, Math.round((HURT[kind] ?? 15) * (charged ? CHARGED : 1)), dx, dz, charged ? { zap: true, stun: STUN } : null);
          if (charged) this.zapHit(c.x, c.z, groundY(c.x, c.z) + 1.2);
          G.audio?.sword('hit'); G.rig.shake = Math.max(G.rig.shake, 0.2); G.hitStop = Math.max(G.hitStop, 0.07);
          const hp = new THREE.Vector3(c.x, groundY(c.x, c.z) + 1.1, c.z);
          for (let i = 0; i < 8; i++) G.particles.emit('dust', hp.x, hp.y, hp.z, -dx / dist * 1.5, 0.8, -dz / dist * 1.5, 1.4, 1);
          continue;
        }
        const k = Math.max(0.01, dist - c.r), px = F.x + dx / dist * k, pz = F.z + dz / dist * k, y = groundY(px, pz) + 0.9;
        G.particles.emit('dust', px, y, pz, -dx / dist, 0.9, -dz / dist, 1.2, 9);
        G.particles.emit('seed', px, y, pz, -dx / dist, 1.0, -dz / dist, 1.2, 5);
        if (charged) this.zapHit(px, pz, y);
        G.audio?.sword('hit');
        G.rig.shake = Math.max(G.rig.shake, 0.12);
        G.hitStop = Math.max(G.hitStop, 0.06);
      }
    }
  }

  // ---------------------------------------------------------------- H: the three hitboxes
  buildDebug() {
    const g = new THREE.Group(); g.renderOrder = 999;
    const mk = (pts, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5, depthTest: false }));
      m.renderOrder = 999; m.frustumCulled = false; m.userData.base = color; return m;
    };
    const box = (a0, a1, b0, b1, y0, y1) => {                    // forward a, left b
      const c = [[b0, y0, a0], [b1, y0, a0], [b1, y0, a1], [b0, y0, a1], [b0, y1, a0], [b1, y1, a0], [b1, y1, a1], [b0, y1, a1]].map(p => new THREE.Vector3(...p));
      const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      return e.flatMap(([i, j]) => [c[i], c[j]]);
    };
    const fan = [], R = HIT.cut.reach, H = HIT.cut.half, N = 24;
    for (const y of [0.15, 1.1]) for (let i = 0; i < N; i++) {
      const a0 = lerp(-H, H, i / N), a1 = lerp(-H, H, (i + 1) / N);
      fan.push(new THREE.Vector3(Math.sin(a0) * R, y, Math.cos(a0) * R), new THREE.Vector3(Math.sin(a1) * R, y, Math.cos(a1) * R));
    }
    for (const y of [0.15, 1.1]) for (const a of [-H, H]) fan.push(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.sin(a) * R, y, Math.cos(a) * R));
    fan.push(new THREE.Vector3(Math.sin(-H) * R, 0.15, Math.cos(-H) * R), new THREE.Vector3(Math.sin(-H) * R, 1.1, Math.cos(-H) * R), new THREE.Vector3(Math.sin(H) * R, 0.15, Math.cos(H) * R), new THREE.Vector3(Math.sin(H) * R, 1.1, Math.cos(H) * R));
    g.add(this.dCut = mk(fan, 0x7fe0ff));
    g.add(this.dOver = mk(box(HIT.overhead.from, HIT.overhead.to, -HIT.overhead.half, HIT.overhead.half, 0, 2.0), 0xff8de1));
    g.add(this.dThrust = mk(box(HIT.thrust.from, HIT.thrust.to, -HIT.thrust.half, HIT.thrust.half, 0.35, 1.0), 0xffe27f));
    this.game.scene.add(g);
    return g;
  }
  updateDebug() {
    const on = !!(this.game.contact && this.game.contact.showing);
    if (!on) { if (this.debug) this.debug.visible = false; return; }
    if (!this.debug) this.debug = this.buildDebug();
    const P = this.player;
    this.debug.visible = true;
    this.debug.position.copy(P.pos); this.debug.rotation.y = this.kind && this.faceLock ? this.aim : P.heading;
    const act = this.kind === 'draw' ? this.dCut : this.kind === 'overhead' ? this.dOver : this.kind === 'thrust' ? this.dThrust : null;
    const M = this.kind ? MOVES[this.kind] : null;
    const live = !!(M && M.hit && this.t >= M.hit[0] && this.t <= M.hit[1] + 0.05);
    for (const d of [this.dCut, this.dOver, this.dThrust]) {
      d.material.color.setHex(d === act && live ? 0xff7a2a : d.userData.base);
      d.material.opacity = d === act ? (live ? 1 : 0.8) : 0.3;
    }
  }
}
