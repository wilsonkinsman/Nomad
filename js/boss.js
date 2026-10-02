// The red oni (Akaoni) and the ring of stones in the south-east meadow where he waits. Beating him finishes the
// monk's quest (quests.js), which is worth a skill point; once beaten he is gone for good (admin mode can reset it).
//   dormant  he sits on a boulder in the middle of the ring, head bowed. Come within WAKE metres (or hit him) and he
//            gets up and roars; a bar with his name and life appears.
//   stalk    he walks at you, turning slowly, and attacks when he can. Each blow is marked in red on the ground first:
//   smash    the club raised over his head, then brought down in front of him: 28. Parry it (F) and he reels.
//            The club stays in the ground a moment after: the time to hit him.
//   sweep    the club drawn back to his right and swung round low across his front: 20 and thrown aside. Parry it.
//   leap     from range he crouches and leaps at you, landing where you were: 30 in the middle, less further out.
//            Not parryable: roll or run out of the mark.
//   roar     once, below ENRAGE of his life: a blast that throws you back; from then on he is faster.
//   reel     a parried blow, or one very heavy hit, leaves him off balance for REEL s, taking half as much again.
//   stun     the storm holds him half as long as it would a man, and not again for a few seconds.
//   dead     he sinks to his knees, falls, and burns away to embers and smoke.
// A Gale Slam throws him up (half as high as a man, and not again for a while: updraft.js); he lands staggered.
// His blows miss anyone up in the air out of reach (the Wind Crow). Leave the ring far behind and he goes back to his
// stone and his wounds close. He is one of enemies.targets, so every weapon and skill works on him.
import * as THREE from 'three';
import { groundY, SPAWN } from './world.js';
import { clamp, lerp, smoothstep, damp, dampAngle, wrapAngle } from './util.js';
import { mergeVertices, mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';

export const ARENA = { x: 55, z: 75, R: 15 };
const TO_SPAWN = new THREE.Vector2(SPAWN.x - ARENA.x, SPAWN.z - ARENA.z).normalize();
// the torii, in the gap in the ring that faces the road (top: the height of its roof beam above the ground)
export const GATE = { x: ARENA.x + TO_SPAWN.x * ARENA.R, z: ARENA.z + TO_SPAWN.y * ARENA.R, top: 4.7 };

const MAX_HP = 900, WAKE = 20, LEASH = 42, WALK = 3.0, ENRAGE = 0.4, REEL = 2.2;
const SMASH = { wind: 0.85, strike: 0.14, recover: 0.95, dmg: 28, reach: 3.0, r: 2.3 };
const SWEEP = { wind: 0.62, strike: 0.22, recover: 0.6, dmg: 20, reach: 4.5, arc: 1.75 };
const LEAP = { crouch: 0.5, air: 0.85, recover: 1.0, dmg: 30, r: 4.5, max: 16, h: 4 };
const ROAR = { time: 1.6, at: 0.5, r: 6.5, dmg: 8 };
const TAU = Math.PI * 2;
const _v = new THREE.Vector3();

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o });
const ell = (rx, ry, rz, x, y, z, m, seg = 16) => { const o = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)), m); o.scale.set(rx, ry, rz); o.position.set(x, y, z); return o; };
// a limb hanging down `len` from its pivot
const limb = (r, len, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 12).translate(0, -len / 2, 0), m);
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// a tiger's hide for his loincloth: gold with ragged black stripes
function tigerTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#d29a2a'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#16110c';
  for (let i = 0; i < 14; i++) {
    const x = i * 18.3 + 6, w = 4 + (i * 7) % 5;
    g.beginPath(); g.moveTo(x, -2);
    for (let y = 0; y <= 66; y += 8) g.lineTo(x + Math.sin(y * 0.15 + i) * 5 + (y / 66) * 6, y);
    for (let y = 66; y >= 0; y -= 8) g.lineTo(x + w * (0.4 + 0.6 * Math.sin((y / 66) * Math.PI)) + Math.sin(y * 0.15 + i) * 5 + (y / 66) * 6, y);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
// a rough standing stone: a box pushed about, narrower at the top
function stoneGeometry(w, h, d, seed) {
  let g = new THREE.BoxGeometry(w, h, d, 3, 6, 3).translate(0, h / 2, 0);
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = y / h, n = hash(Math.round(x * 20) + seed, Math.round(y * 20), Math.round(z * 20));
    const k = (1 - 0.35 * v) * (0.85 + 0.3 * n);
    p.setXYZ(i, x * k, y + (v > 0.95 ? (n - 0.5) * 0.4 : 0), z * k);
  }
  g.computeVertexNormals();
  return g;
}

export class Boss {
  constructor(game) {
    this.game = game;
    this.buildArena();
    this.buildOni();
    this.pos = new THREE.Vector3(); this.heading = 0; this.hp = MAX_HP; this.shown = MAX_HP;
    this.state = 'dormant'; this.t = 0; this.cd = 0; this.leapCd = 0; this.stunCd = 0; this.reelCd = 0; this.away = 0;
    this.enraged = false; this.flash = 0; this.walk = 0; this.phase = 0; this.hit = false; this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    const self = this;
    this.target = { x: 0, z: 0, r: 1.05, y1: 3.3, lift: 0, spin: 0, tilt: 0, heavy: true, boss: this, host: this.root, get dead() { return self.down; }, onHit: (k, dmg, dx, dz, fx) => this.hurt(dmg, dx, dz, k, fx),
      onLaunch: () => { this.clearMarkers(); this.mark = null; if (this.state === 'dormant') this.wake(); },
      onLand: () => { this.root.rotation.z = 0; if (!this.down) this.reel(1.6); } };
    this.collider = { x: 0, z: 0, r: 0.95, h: 3.2 };
    game.enemies.targets.push(this.target);
    game.player.colliders.push(this.collider);
    this.markers = [];
    this.barEl = document.getElementById('boss'); this.fillEl = document.getElementById('boss-fill'); this.lagEl = document.getElementById('boss-lag');
    this.onDefeat = null;           // quests.js listens
    this.reset();
    game.skills.onWipe(() => this.reset());
  }
  get down() { return this.state === 'dead' || this.state === 'gone'; }
  get awake() { return !this.down && this.state !== 'dormant'; }

  // ---------------------------------------------------------------- the ring of stones
  buildArena() {
    const G = this.game, A = ARENA, rock = G.tx?.rock;
    const stoneM = mat(0x8d877c, { map: rock?.map || null, normalMap: rock?.normal || null, roughness: 0.95, flatShading: true });
    const gateA = Math.atan2(TO_SPAWN.y, TO_SPAWN.x);
    this.stones = [];
    // eleven standing stones round the ring, a gap left for the gate
    for (let i = 0; i < 12; i++) {
      const a = gateA + (i / 12) * TAU;
      if (i === 0) continue;
      const x = A.x + Math.cos(a) * A.R, z = A.z + Math.sin(a) * A.R, h = 2.2 + hash(i, 2, 3) * 1.1;
      const m = new THREE.Mesh(stoneGeometry(1.0, h, 0.75, i * 7), stoneM);
      m.position.set(x, groundY(x, z) - 0.2, z); m.rotation.y = -a + (hash(i, 5, 1) - 0.5) * 0.4; m.rotation.z = (hash(i, 9, 4) - 0.5) * 0.12;
      m.castShadow = m.receiveShadow = true; G.scene.add(m);
      const c = { x, z, r: 0.6, h }; G.player.colliders.push(c); this.stones.push(c);
    }
    this.ring = this.stones.slice();
    // the boulder he sits on, in the middle
    this.seat = new THREE.Vector3(A.x - TO_SPAWN.x * 0.25, 0, A.z - TO_SPAWN.y * 0.25);
    const seatM = new THREE.Mesh(stoneGeometry(1.5, 0.85, 1.3, 99), stoneM);
    seatM.position.set(this.seat.x, groundY(this.seat.x, this.seat.z) - 0.1, this.seat.z); seatM.rotation.y = gateA;
    seatM.castShadow = seatM.receiveShadow = true; G.scene.add(seatM);
    const sc = { x: this.seat.x, z: this.seat.z, r: 0.75, h: 0.8 }; G.player.colliders.push(sc); this.stones.push(sc);
    // the torii: two vermilion pillars, a tie beam and a black-capped top beam that lifts at its ends
    const red = mat(0xb5352a, { roughness: 0.7 }), black = mat(0x1c1817, { roughness: 0.8 });
    const gx = GATE.x, gz = GATE.z, gy = groundY(gx, gz), tx = -TO_SPAWN.y, tz = TO_SPAWN.x;
    const torii = new THREE.Group(); torii.position.set(gx, gy, gz); torii.rotation.y = Math.atan2(-tz, tx);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 4.3, 14).translate(0, 2.15, 0), red); p.position.x = s * 1.65; torii.add(p);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.3, 14).translate(0, 0.15, 0), black); foot.position.x = s * 1.65; torii.add(foot);
      G.player.colliders.push({ x: gx + tx * s * 1.65, z: gz + tz * s * 1.65, r: 0.25, h: GATE.top });
    }
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.2, 0.16), red); nuki.position.y = 3.5; torii.add(nuki);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.14), red); strut.position.y = 3.9; torii.add(strut);
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.26, 0.34), red); top.position.y = 4.4; torii.add(top);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.14, 0.42), black); cap.position.y = GATE.top - 0.07; torii.add(cap);
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.42), black); end.position.set(s * 2.75, GATE.top + 0.0, 0); end.rotation.z = s * 0.25; torii.add(end);
    }
    torii.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    G.scene.add(torii);
    // the grass inside the ring is trodden short
    G.cut?.stamp(A.x, A.z, A.R - 1, 0.35);
  }

  // ---------------------------------------------------------------- the oni
  // A figure of jointed groups about three and a half metres tall, facing +z, its origin between the feet:
  // hips > (legs: thigh > knee) and spine > (arms: shoulder > elbow, the club in the right fist) and head > jaw.
  buildOni() {
    const skin = this.skin = mat(0xa3342a, { roughness: 0.68 }), dark = mat(0x6e1f19, { roughness: 0.8 });
    const bone = mat(0xe6dcc2, { roughness: 0.55 }), hair = mat(0xd9d3c7, { roughness: 0.9 }), rope = mat(0xc4ac72, { roughness: 0.95 });
    const tiger = mat(0xffffff, { map: tigerTexture(), roughness: 0.9, side: THREE.DoubleSide });
    const iron = mat(0x2d2a28, { metalness: 0.6, roughness: 0.45 }), steel = mat(0x8a8580, { metalness: 0.8, roughness: 0.35 }), gold = mat(0xb08a3a, { metalness: 0.7, roughness: 0.4 });
    this.eyeM = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xffc040, emissiveIntensity: 1.6, roughness: 0.4 });
    this.mats = [skin, dark, bone, hair, rope, tiger, iron, steel, gold, this.eyeM];
    const root = this.root = new THREE.Group(), J = this.J = {};
    const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    J.hips = grp(root, 0, 1.35, 0);
    J.hips.add(ell(0.5, 0.32, 0.38, 0, 0, 0, skin));
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.74, 0.55, 20, 1, true), tiger); skirt.position.y = -0.14; J.hips.add(skirt);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.04), tiger); flap.position.set(0, -0.42, 0.44); J.hips.add(flap);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.055, 6, 24).rotateX(Math.PI / 2), rope); belt.position.y = 0.14; J.hips.add(belt);
    for (const s of [-1, 1]) {
      const k = s > 0 ? 'L' : 'R';
      const th = J['thigh' + k] = grp(J.hips, s * 0.28, -0.1, 0);
      th.add(limb(0.22, 0.68, skin));
      const kn = J['knee' + k] = grp(th, 0, -0.66, 0);
      kn.add(limb(0.18, 0.6, skin));
      const ft = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.13, 0.44), dark); ft.position.set(0, -0.6, 0.08); kn.add(ft);
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), rope); wrap.position.y = -0.45; kn.add(wrap);
    }
    J.spine = grp(J.hips, 0, 0.18, 0);
    J.spine.add(ell(0.55, 0.42, 0.48, 0, 0.22, 0.06, skin), ell(0.72, 0.5, 0.48, 0, 0.66, 0, skin));
    for (const s of [-1, 1]) J.spine.add(ell(0.3, 0.2, 0.15, s * 0.22, 0.72, 0.36, skin), ell(0.32, 0.26, 0.3, s * 0.6, 0.92, -0.02, skin));
    for (const s of [-1, 1]) {
      const k = s > 0 ? 'L' : 'R';
      const sh = J['arm' + k] = grp(J.spine, s * 0.82, 0.86, 0);
      sh.add(limb(0.2, 0.62, skin));
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 16).rotateX(Math.PI / 2), gold); band.position.y = -0.18; sh.add(band);
      const el = J['elbow' + k] = grp(sh, 0, -0.6, 0);
      el.add(limb(0.18, 0.56, skin), ell(0.2, 0.22, 0.2, 0, -0.62, 0.02, skin));
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.05, 6, 16).rotateX(Math.PI / 2), iron); cuff.position.y = -0.44; el.add(cuff);
    }
    // the kanabo: an iron club studded with steel, held by its handle in the right fist and pointing on from the forearm
    const club = J.club = grp(J.elbowR, 0, -0.62, 0.02);
    club.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.55, 10).translate(0, 0.0, 0), iron));
    club.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.45, 14).translate(0, -1.0, 0), iron));
    club.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8).translate(0, -1.72, 0), iron));
    const studs = [];
    for (let i = 0; i < 40; i++) {
      const y = -0.4 - (i % 10) / 9 * 1.25, a = (i * 2.39) % TAU, r = lerp(0.13, 0.2, (-0.25 - y) / 1.45);
      studs.push(new THREE.ConeGeometry(0.035, 0.09, 6).rotateZ(-Math.PI / 2).rotateY(-a).translate(Math.cos(a) * (r + 0.03), y, Math.sin(a) * (r + 0.03)));
    }
    club.add(new THREE.Mesh(mergeGeometries(studs), steel));
    // the head: a heavy skull, a jutting brow, burning eyes, horns, a mane of white hair and tusks in a jaw that drops
    J.head = grp(J.spine, 0, 1.12, 0.06);
    J.head.add(ell(0.26, 0.2, 0.26, 0, 0.05, 0, skin), ell(0.4, 0.42, 0.4, 0, 0.36, 0.04, skin), ell(0.36, 0.1, 0.17, 0, 0.47, 0.32, dark), ell(0.1, 0.08, 0.1, 0, 0.32, 0.43, skin));
    for (const s of [-1, 1]) {
      J.head.add(ell(0.065, 0.045, 0.04, s * 0.14, 0.4, 0.4, this.eyeM, 10));
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.2, 0.66, 0.02), new THREE.Vector3(s * 0.32, 0.86, 0.0), new THREE.Vector3(s * 0.38, 1.02, -0.06), new THREE.Vector3(s * 0.33, 1.16, -0.14)]);
      const horn = new THREE.TubeGeometry(curve, 12, 1, 8, false), hp = horn.attributes.position;
      for (let i = 0; i <= 12; i++) {
        const c = curve.getPointAt(i / 12), r = 0.095 * (1 - (i / 12) * 0.9);
        for (let j = 0; j <= 8; j++) { const q = i * 9 + j; hp.setXYZ(q, c.x + (hp.getX(q) - c.x) * r, c.y + (hp.getY(q) - c.y) * r, c.z + (hp.getZ(q) - c.z) * r); }
      }
      horn.computeVertexNormals(); J.head.add(new THREE.Mesh(horn, bone));
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 15 - 0.5) * 3.6, up = 0.35 + (i % 3) * 0.12;
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55 + (i % 4) * 0.08, 6), hair);
      m.position.set(Math.sin(a) * 0.36, 0.5 + up * 0.25, -0.2 + Math.cos(a) * -0.12); m.rotation.set(-1.9 + up, 0, -Math.sin(a) * 0.9);
      J.head.add(m);
    }
    J.jaw = grp(J.head, 0, 0.22, 0.12);
    J.jaw.add(ell(0.3, 0.14, 0.28, 0, -0.04, 0.12, skin));
    for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 6), bone); t.position.set(s * 0.13, 0.06, 0.32); J.jaw.add(t); }
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.04), bone); teeth.position.set(0, 0.25, 0.42); J.head.add(teeth);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.game.scene.add(root);
    this.pose = {}; this.goal = {};
    for (const k of POSE_KEYS) this.pose[k] = this.goal[k] = 0;
  }

  // sit him down on his stone (or take him away, if he has been beaten)
  reset() {
    const G = this.game;
    for (const m of this.mats) { m.transparent = false; m.opacity = 1; m.depthWrite = true; m.needsUpdate = true; }
    this.clearMarkers();
    this.hp = this.shown = MAX_HP; this.enraged = false; this.flash = 0; this.cd = 1; this.leapCd = 2; this.target.air = false; this.target.lift = 0;
    if (G.skills.got('quest:oni')) {
      this.state = 'gone'; this.root.visible = false;
      this.collider.x = this.target.x = 1e4; this.collider.z = this.target.z = 1e4;
      this.showBar(false);
      return;
    }
    this.root.visible = true; this.root.rotation.set(0, 0, 0);
    this.pos.set(ARENA.x, 0, ARENA.z); this.pos.y = groundY(this.pos.x, this.pos.z);
    this.heading = Math.atan2(TO_SPAWN.x, TO_SPAWN.y);
    this.setState('dormant');
    sitPose(this.pose);
    this.showBar(false);
  }
  setState(s) { this.state = s; this.t = 0; this.hit = false; }

  showBar(on) { if (this.barEl.hidden === on) this.barEl.hidden = !on; }

  // ---------------------------------------------------------------- taking blows
  hurt(dmg, dx, dz, kind, fx) {
    if (this.down) return false;
    const G = this.game, l = Math.hypot(dx, dz) || 1;
    if (this.state === 'dormant') this.wake();
    let crit = false;
    if (this.state === 'reel') { dmg = Math.round(dmg * 1.5); crit = true; }
    this.hp -= dmg; this.flash = 1;
    // he is heavy: blows barely move him
    const knock = fx && fx.knock ? fx.knock * 0.2 : 0.04;
    this.pos.x += dx / l * knock; this.pos.z += dz / l * knock;
    G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + this.target.lift + 3.4, this.pos.z), (crit ? 'CRIT ' : '') + dmg, crit || dmg >= 30 ? 'big' : '');
    if (Math.random() < 0.35) G.audio?.oni('hurt');
    if (this.hp <= 0) { this.die(); return true; }
    if (dmg >= 60 && this.reelCd <= 0 && this.state !== 'reel') this.reel(1.2);
    if (fx && fx.stun && this.stunCd <= 0 && this.state !== 'reel') {
      this.stunFor = fx.stun * 0.5; this.stunCd = 5; this.setState('stun');
      G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 3.8, this.pos.z), 'STUNNED', 'zap word');
    }
    return true;
  }
  reel(secs) {
    const G = this.game;
    this.clearMarkers(); this.setState('reel'); this.reelFor = secs; this.reelCd = 3;
    G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 3.8, this.pos.z), 'STAGGERED', 'gold word');
  }
  wake() {
    const G = this.game;
    this.setState('wake'); this.showBar(true);
    G.hud?.callout('AKAONI', 'red');
    G.hud?.hint('The red oni wakes. When he lifts the club, get out of the red, or turn the blow aside with F', 5);
  }
  die() {
    const G = this.game;
    this.hp = 0; this.clearMarkers(); this.setState('dead');
    for (const m of this.mats) { m.transparent = true; m.needsUpdate = true; }
    G.audio?.oni('die'); G.rig.shake = 1; G.hitStop = Math.max(G.hitStop, 0.2);
    G.hud?.callout('ONI DEFEATED', 'gold');
    this.onDefeat?.();
  }

  // ---------------------------------------------------------------- red marks on the ground
  // a ring from r0 to r1 round (x, z), or an arc of it from angle a0 to a1 (radians, as the RingGeometry counts
  // them), laid over the shape of the ground; it pulses until `life`, then fades
  danger(x, z, r0, r1, a0 = 0, a1 = TAU, life = 1) {
    const g = new THREE.RingGeometry(Math.max(0.001, r0), r1, 48, 4, a0, a1 - a0).rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const vx = p.getX(i) + x, vz = p.getZ(i) + z; p.setXYZ(i, vx, groundY(vx, vz) + 0.08, vz); }
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff3018, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.renderOrder = 3; m.frustumCulled = false; this.game.scene.add(m);
    const mk = { m, t: 0, life }; this.markers.push(mk); return mk;
  }
  clearMarkers() { for (const k of this.markers) { this.game.scene.remove(k.m); k.m.geometry.dispose(); k.m.material.dispose(); } this.markers.length = 0; }
  updateMarkers(dt) {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const k = this.markers[i]; k.t += dt;
      const fade = k.t < k.life ? Math.min(1, k.t / 0.15) * (0.32 + 0.14 * Math.sin(k.t * 18)) : 0.46 * (1 - (k.t - k.life) / 0.35);
      k.m.material.opacity = Math.max(0, fade);
      if (k.t > k.life + 0.35) { this.game.scene.remove(k.m); k.m.geometry.dispose(); k.m.material.dispose(); this.markers.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- his blows land on the player
  // true if the player is low enough to be struck (not carried off up in the air)
  reachable(P) { return P.pos.y - groundY(P.pos.x, P.pos.z) < 1.9; }
  strike(dmg, from, knock, parryable) {
    const G = this.game, P = G.player;
    if (parryable && P.weapon && P.weapon.deflect(from)) { this.reel(REEL); return 'parried'; }
    const r = P.hurt(dmg, from);
    if (r === 'dodged') G.hud?.floatText(new THREE.Vector3(P.pos.x, P.pos.y + 1.6, P.pos.z), 'DODGE', 'gold word');
    else if (knock) { const dx = P.pos.x - from.x, dz = P.pos.z - from.z, l = Math.hypot(dx, dz) || 1; P.vel.x += dx / l * knock; P.vel.z += dz / l * knock; P.vel.y = Math.max(P.vel.y, 2.5); P.grounded = false; }
    return r;
  }
  // the ground takes the club: a crater of dust, the grass torn, the leaves thrown, a ring racing out
  quake(x, z, r, power) {
    const G = this.game, y = groundY(x, z);
    G.cut.stamp(x, z, r * 0.6, 1); G.trample.stamp(x, z, r * 1.4, 1, 0, 0, 1);
    G.leaves.burst?.(x, y, z, r * 1.3, 4 * power);
    G.snow.onImpact(_v.set(x, y, z), this.heading, 'land');
    for (let i = 0; i < 36; i++) { const a = i / 36 * TAU; G.particles.emit('dust', x + Math.cos(a) * 0.5, y + 0.1, z + Math.sin(a) * 0.5, Math.cos(a) * 6 * power, 0.8, Math.sin(a) * 6 * power, 1.2, 1); }
    for (let i = 0; i < 14; i++) G.particles.emit('clip', x, y + 0.2, z, (Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6, 1, 1);
    G.gale?.ring(x, y, z, r * 1.6, 0.5, 0.45);
    const cd = G.camera.position.distanceTo(_v.set(x, y, z));
    G.rig.shake = Math.max(G.rig.shake, clamp(1.2 - cd / 30, 0.2, 1) * power);
    G.hitStop = Math.max(G.hitStop, 0.06 * power);
  }

  // ---------------------------------------------------------------- every frame
  // thrown up by a Gale Slam: he flails, turning in the wind, and does nothing else until he lands
  airborne(dt, G) {
    const goal = this.goal, c = this.target;
    reelPose(goal, 0.3); goal.armLZ = 1.35; goal.armRZ = -1.25; goal.thighL = -0.7; goal.kneeL = 1.1; goal.kneeR = 0.7; goal.jaw = 0.7;
    for (const k of POSE_KEYS) this.pose[k] = damp(this.pose[k], goal[k], 8, dt);
    this.collider.x = 1e4;          // nothing to walk into under him
    this.apply();
    this.root.position.y += c.lift; this.root.rotation.y = this.heading + c.spin; this.root.rotation.z = c.tilt;
    this.bars(dt, G);
  }

  update(dt, G) {
    this.updateMarkers(dt);
    if (this.state === 'gone') return;
    if (this.target.air) { this.airborne(dt, G); return; }
    const P = G.player, t = (this.t += dt);
    this.cd -= dt; this.leapCd -= dt; this.stunCd -= dt; this.reelCd -= dt;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    const toP = Math.atan2(dx, dz), off = wrapAngle(toP - this.heading);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const fromArena = Math.hypot(P.pos.x - ARENA.x, P.pos.z - ARENA.z);
    const speed = this.enraged ? 1.3 : 1;          // the enraged oni does everything faster
    const goal = this.goal;
    idlePose(goal, G.time);
    let rate = 9, moving = 0;
    // left far behind: he gives up and goes back to his stone
    if (this.awake && this.state !== 'return' && this.state !== 'leap') {
      this.away = fromArena > LEASH ? this.away + dt : 0;
      if (this.away > 3) { this.clearMarkers(); this.setState('return'); this.showBar(false); G.hud?.hint('The oni goes back to his stone, and his wounds close', 3); }
    }
    switch (this.state) {
      case 'dormant':
        sitPose(goal); rate = 4;
        if (fromArena < WAKE) this.wake();
        break;
      case 'wake': {
        // up off the stone, then a roar
        if (t < 0.9) { sitPose(goal); blendPose(goal, idle0, smoothstep(0, 0.9, t)); rate = 6; }
        else { roarPose(goal, t - 0.9); if (!this.hit) { this.hit = true; G.audio?.oni('roar'); G.rig.shake = Math.max(G.rig.shake, 0.8); } }
        this.heading = dampAngle(this.heading, toP, 2, dt);
        if (t > 2.0) { this.setState('stalk'); this.cd = 0.6; }
        break;
      }
      case 'stalk': {
        if (!this.enraged && this.hp < MAX_HP * ENRAGE) { this.enraged = true; this.setState('roar'); break; }
        this.heading = dampAngle(this.heading, toP, (this.enraged ? 3.2 : 2.3), dt);
        if (dist > 3.3) moving = WALK * speed;
        if (this.cd <= 0 && this.reachable(P)) {
          if (dist < 4.1 && Math.abs(off) < 1.2) this.begin(Math.abs(off) > 0.45 || Math.random() < 0.4 ? 'sweep' : 'smash');
          else if (dist > 8 && this.leapCd <= 0) this.begin('leap');
        }
        break;
      }
      case 'smash': {
        const w = SMASH.wind / speed;
        if (t < w) { this.heading = dampAngle(this.heading, toP, 1.4, dt); smashPose(goal, 0); rate = 7;
          if (this.mark) this.placeSmash(this.mark); }
        else if (t < w + SMASH.strike) { smashPose(goal, 1); rate = 30; }
        else if (t < w + SMASH.strike + SMASH.recover) { smashPose(goal, 1); goal.spineX += 0.05; rate = 12; }
        else this.done(0.9);
        if (!this.hit && t >= w + SMASH.strike * 0.7) {
          this.hit = true; this.mark = null;
          const ix = this.pos.x + fx * SMASH.reach, iz = this.pos.z + fz * SMASH.reach;
          G.audio?.oni('smash'); this.quake(ix, iz, 2.2, 1);
          if (Math.hypot(P.pos.x - ix, P.pos.z - iz) < SMASH.r && this.reachable(P)) this.strike(SMASH.dmg, _v.set(this.pos.x, this.pos.y, this.pos.z), 5, true);
        }
        break;
      }
      case 'sweep': {
        const w = SWEEP.wind / speed;
        if (t < w) { sweepPose(goal, 0); rate = 8; }          // set where he stands: the red arc is where it will go
        else if (t < w + SWEEP.strike) { sweepPose(goal, (t - w) / SWEEP.strike); rate = 26; }
        else if (t < w + SWEEP.strike + SWEEP.recover) { sweepPose(goal, 1); rate = 10; }
        else this.done(0.8);
        if (t < w && !this.mark) {
          const c = this.heading - Math.PI / 2;      // the ring's own angle for the way he faces
          this.mark = this.danger(this.pos.x, this.pos.z, 1.0, SWEEP.reach, c - SWEEP.arc, c + SWEEP.arc, w);
        }
        if (!this.hit && t >= w + SWEEP.strike * 0.5) {
          this.hit = true; this.mark = null;
          G.audio?.oni('swing');
          if (dist < SWEEP.reach && dist > 0.5 && Math.abs(off) < SWEEP.arc && this.reachable(P)) this.strike(SWEEP.dmg, _v.set(this.pos.x, this.pos.y, this.pos.z), 9, true);
          for (let a = -SWEEP.arc; a <= SWEEP.arc; a += 0.25) { const h = this.heading + a; G.trample.stamp(this.pos.x + Math.sin(h) * 3, this.pos.z + Math.cos(h) * 3, 1.2, 0.8, Math.cos(h), -Math.sin(h), 0.6); }
        }
        break;
      }
      case 'leap': {
        const c = LEAP.crouch / speed;
        if (t < c) {
          this.heading = dampAngle(this.heading, toP, 4, dt); crouchPose(goal); rate = 10;
          // he picks his spot as he goes: where you are, and a little where you are going, not too far
          let lx = P.pos.x + P.vel.x * 0.3, lz = P.pos.z + P.vel.z * 0.3;
          const ex = lx - this.pos.x, ez = lz - this.pos.z, el = Math.hypot(ex, ez);
          if (el > LEAP.max) { lx = this.pos.x + ex / el * LEAP.max; lz = this.pos.z + ez / el * LEAP.max; }
          this.to.set(lx, groundY(lx, lz), lz); this.from.copy(this.pos);
        } else if (t < c + LEAP.air) {
          if (!this.mark) { this.mark = this.danger(this.to.x, this.to.z, 0, LEAP.r, 0, TAU, LEAP.air); G.audio?.oni('leap'); }
          const u = (t - c) / LEAP.air;
          this.pos.set(lerp(this.from.x, this.to.x, u), lerp(this.from.y, this.to.y, u) + 4 * LEAP.h * u * (1 - u), lerp(this.from.z, this.to.z, u));
          this.heading = dampAngle(this.heading, Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z), 6, dt);
          airPose(goal, u); rate = 12;
        } else if (t < c + LEAP.air + LEAP.recover) {
          if (!this.hit) {
            this.hit = true; this.mark = null; this.pos.copy(this.to);
            G.audio?.oni('land'); this.quake(this.to.x, this.to.z, LEAP.r, 1.4);
            const d = Math.hypot(P.pos.x - this.to.x, P.pos.z - this.to.z);
            if (d < LEAP.r && this.reachable(P)) this.strike(Math.round(lerp(LEAP.dmg, LEAP.dmg * 0.5, d / LEAP.r)), _v.copy(this.to), 8, false);
          }
          smashPose(goal, 1); rate = 14;
        } else { this.leapCd = 7; this.done(1.0); }
        break;
      }
      case 'roar': {
        roarPose(goal, t); rate = 8;
        if (!this.hit && t >= ROAR.at) {
          this.hit = true; G.audio?.oni('roar'); G.hud?.callout('ENRAGED', 'red');
          G.gale?.ring(this.pos.x, this.pos.y, this.pos.z, ROAR.r * 1.4, 0.6, 0.6);
          G.rig.shake = 1;
          if (dist < ROAR.r && this.reachable(P)) this.strike(ROAR.dmg, _v.copy(this.pos), 12, false);
          for (const k of [this.eyeM]) k.emissive.setHex(0xff5020);
        }
        if (t > ROAR.time) { this.setState('stalk'); this.cd = 0.4; }
        break;
      }
      case 'reel': {
        reelPose(goal, t); rate = 10;
        moving = -1.2 * Math.max(0, 1 - t / 0.6);
        if (t > this.reelFor) this.done(0.4);
        break;
      }
      case 'stun': {
        if (Math.random() < dt * 40) G.particles.emit('zap', this.pos.x + (Math.random() - 0.5) * 1.2, this.pos.y + 0.5 + Math.random() * 2.8, this.pos.z + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 0.6, 1);
        goal.spineX += 0.04 * Math.sin(G.time * 50); goal.headY += 0.06 * Math.sin(G.time * 43);
        if (t > this.stunFor) this.done(0.3);
        break;
      }
      case 'return': {
        const sx = ARENA.x - this.pos.x, sz = ARENA.z - this.pos.z, sd = Math.hypot(sx, sz);
        this.heading = dampAngle(this.heading, sd > 0.3 ? Math.atan2(sx, sz) : Math.atan2(TO_SPAWN.x, TO_SPAWN.y), 3, dt);
        if (sd > 0.4) moving = WALK; else { this.hp = MAX_HP; this.enraged = false; this.eyeM.emissive.setHex(0xffc040); this.setState('dormant'); }
        if (fromArena < WAKE * 0.8) { this.setState('stalk'); this.showBar(true); }
        break;
      }
      case 'dead': {
        // down onto his knees, forward onto his face, and burned away
        kneelPose(goal); rate = 6;
        this.root.rotation.x = 1.45 * smoothstep(0.9, 1.7, t);
        const fade = 1 - smoothstep(2.0, 3.4, t);
        for (const m of this.mats) m.opacity = fade;
        if (t > 1.6 && t < 3.4) for (let i = 0; i < 4; i++) G.particles.emit(i % 2 ? 'ember' : 'smoke', this.pos.x + (Math.random() - 0.5) * 2, this.pos.y + Math.random() * 1.2, this.pos.z + (Math.random() - 0.5) * 2, 0, 1 + Math.random(), 0, 0.6, 1);
        if (t > 3.5) { this.state = 'gone'; this.root.visible = false; this.collider.x = this.target.x = 1e4; this.collider.z = this.target.z = 1e4; this.showBar(false); return; }
        break;
      }
    }
    // walking: forward along his heading (back when he reels), kept out of walls, stones and the player
    if (moving) {
      this.pos.x += Math.sin(this.heading) * moving * dt; this.pos.z += Math.cos(this.heading) * moving * dt;
      const before = this.phase; this.phase += dt * Math.abs(moving) * 1.9;
      if (Math.floor(before / Math.PI) !== Math.floor(this.phase / Math.PI)) { G.audio?.oni('step'); G.rig.shake = Math.max(G.rig.shake, clamp(0.35 - dist / 60, 0, 0.3)); }
    }
    this.walk = damp(this.walk, Math.abs(moving) > 0.1 ? 1 : 0, 6, dt);
    if (this.walk > 0.01) walkPose(goal, this.phase, this.walk);
    if (this.state !== 'leap' && this.state !== 'dead') {
      const solid = this.ring.slice();         // the standing stones (not his own seat: he sits on it)
      for (const c of G.earth ? G.earth.circles() : []) solid.push(c);
      for (const c of solid) {
        const ex = this.pos.x - c.x, ez = this.pos.z - c.z, r = c.r + 0.9, d2 = ex * ex + ez * ez;
        if (d2 < r * r && d2 > 1e-8) { const d = Math.sqrt(d2); this.pos.x += ex / d * (r - d); this.pos.z += ez / d * (r - d); }
      }
      if (this.awake && dist < 1.5 && dist > 1e-3) { this.pos.x -= dx / dist * (1.5 - dist); this.pos.z -= dz / dist * (1.5 - dist); }
      this.pos.y = groundY(this.pos.x, this.pos.z);
    }
    this.target.x = this.collider.x = this.pos.x; this.target.z = this.collider.z = this.pos.z;
    // the pose, eased toward this frame's goal (fast for the blows themselves)
    for (const k of POSE_KEYS) this.pose[k] = damp(this.pose[k], goal[k], rate, dt);
    this.apply();
    this.bars(dt, G);
  }

  // a blow lands: he flushes; enraged, his eyes burn hotter. And his life on the bar
  bars(dt, G) {
    this.flash = Math.max(0, this.flash - dt * 5);
    this.skin.emissive.setRGB(0.5 * this.flash, 0.12 * this.flash, 0.08 * this.flash);
    this.eyeM.emissiveIntensity = (this.enraged ? 2.6 : 1.6) + 0.5 * Math.sin(G.time * (this.enraged ? 14 : 4));
    // the bar: his life, and a pale trail where he has just lost some
    this.shown = Math.max(this.hp, this.shown - MAX_HP * 0.35 * dt);
    const w1 = (Math.max(0, this.hp) / MAX_HP * 100).toFixed(1) + '%', w2 = (this.shown / MAX_HP * 100).toFixed(1) + '%';
    if (w1 !== this._w1) { this._w1 = w1; this.fillEl.style.width = w1; }
    if (w2 !== this._w2) { this._w2 = w2; this.lagEl.style.width = w2; }
  }

  // an attack begins
  begin(kind) {
    this.setState(kind); this.mark = null;
    const G = this.game;
    if (kind === 'smash') { this.mark = this.danger(0, 0, 0, SMASH.r, 0, TAU, SMASH.wind / (this.enraged ? 1.3 : 1)); this.placeSmash(this.mark); G.audio?.oni('raise'); }
    if (kind === 'sweep') G.audio?.oni('raise');
  }
  // the smash's mark follows where the club will land while he turns
  placeSmash(mk) {
    const ix = this.pos.x + Math.sin(this.heading) * SMASH.reach, iz = this.pos.z + Math.cos(this.heading) * SMASH.reach;
    if (mk.at && Math.hypot(mk.at[0] - ix, mk.at[1] - iz) < 0.15) return;
    // laid again over the ground where it now is
    const g = new THREE.RingGeometry(0.001, SMASH.r, 40, 3).rotateX(-Math.PI / 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const vx = p.getX(i) + ix, vz = p.getZ(i) + iz; p.setXYZ(i, vx, groundY(vx, vz) + 0.08, vz); }
    mk.m.geometry.dispose(); mk.m.geometry = g; mk.at = [ix, iz];
  }
  done(cool) { this.setState('stalk'); this.cd = (cool + Math.random() * 0.5) / (this.enraged ? 1.6 : 1); }

  apply() {
    const J = this.J, p = this.pose;
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z); this.root.rotation.y = this.heading;
    J.hips.position.y = 1.35 + p.hipsY; J.hips.rotation.set(0, p.hipsYaw, 0);
    J.spine.rotation.set(p.spineX, p.spineY, 0);
    J.head.rotation.set(p.headX, p.headY, 0); J.jaw.rotation.x = p.jaw;
    J.armL.rotation.set(p.armLX, 0, p.armLZ); J.armR.rotation.set(p.armRX, p.armRY, p.armRZ);
    J.elbowL.rotation.x = p.elbowL; J.elbowR.rotation.x = p.elbowR;
    J.thighL.rotation.x = p.thighL; J.thighR.rotation.x = p.thighR; J.kneeL.rotation.x = p.kneeL; J.kneeR.rotation.x = p.kneeR;
    J.club.rotation.x = p.club;
  }
}

// ---------------------------------------------------------------- poses
// Angles of his joints (radians): hipsY lowers the hips, spineX leans forward, spineY / hipsYaw turn to his left;
// arm X swings an arm back (negative: forward and up), Z out to the side (left arm +, right arm -); elbow and
// knee bend; thigh X negative lifts the leg forward; jaw opens; club tips the club in the fist.
const POSE_KEYS = ['hipsY', 'hipsYaw', 'spineX', 'spineY', 'headX', 'headY', 'jaw', 'armLX', 'armLZ', 'armRX', 'armRY', 'armRZ', 'elbowL', 'elbowR', 'thighL', 'thighR', 'kneeL', 'kneeR', 'club'];
const set = (o, v) => { for (const k of POSE_KEYS) o[k] = v[k] ?? 0; return o; };
const idle0 = set({}, { spineX: 0.08, armLZ: 0.22, armLX: -0.05, elbowL: -0.25, armRX: -0.2, armRZ: -0.28, elbowR: -0.35, club: -0.9, kneeL: 0.12, kneeR: 0.12, thighL: -0.06, thighR: -0.06, hipsY: -0.03 });
function blendPose(o, b, k) { for (const key of POSE_KEYS) o[key] = lerp(o[key], b[key], k); }
function idlePose(o, time) { set(o, idle0); o.spineX += 0.025 * Math.sin(time * 1.6); o.headY = 0.1 * Math.sin(time * 0.4); }
function sitPose(o) {
  set(o, { hipsY: -0.62, thighL: -1.45, thighR: -1.45, kneeL: 1.45, kneeR: 1.45, spineX: 0.38, headX: 0.45,
    armLX: -0.85, armLZ: 0.15, elbowL: -1.0, armRX: -0.7, armRZ: -0.25, elbowR: -0.5, club: -0.4 });
}
function walkPose(o, ph, k) {
  const s = Math.sin(ph), c = Math.cos(ph);
  o.thighL += -0.5 * s * k; o.thighR += 0.5 * s * k;
  o.kneeL += 0.65 * Math.max(0, -c) * k; o.kneeR += 0.65 * Math.max(0, c) * k;
  o.armLX += 0.35 * s * k; o.armRX += -0.15 * s * k;
  o.hipsY += -0.05 * Math.abs(c) * k; o.hipsYaw += 0.1 * s * k; o.spineY += -0.08 * s * k; o.spineX += 0.08 * k;
}
// the overhead smash: 0 the club up and back over his head, 1 brought down into the ground in front of him
function smashPose(o, u) {
  if (u < 0.5) set(o, { armLX: -2.6, armLZ: 0.45, armRX: -2.75, armRZ: -0.05, elbowL: -0.9, elbowR: -0.35, club: 0.35, spineX: -0.28, headX: -0.25, kneeL: 0.25, kneeR: 0.25, thighL: -0.12, thighR: -0.05, hipsY: -0.06, jaw: 0.25 });
  else set(o, { armLX: -0.9, armLZ: 0.25, armRX: -0.95, armRZ: -0.02, elbowL: -0.45, elbowR: -0.1, club: -0.6, spineX: 0.6, headX: 0.15, kneeL: 0.55, kneeR: 0.4, thighL: -0.55, thighR: 0.1, hipsY: -0.22, jaw: 0.4 });
}
// the sweep: 0 the club drawn back out to his right, 1 swung round across his front to his left, low
function sweepPose(o, u) {
  const e = u * u * (3 - 2 * u);
  set(o, { spineY: lerp(-1.05, 1.15, e), hipsYaw: lerp(-0.45, 0.45, e), spineX: 0.3, armRX: lerp(-0.4, -0.9, e), armRY: 0, armRZ: lerp(-1.15, -1.05, e), elbowR: -0.12, club: -1.2,
    armLX: -0.6, armLZ: lerp(0.5, 0.2, e), elbowL: -0.6, kneeL: 0.35, kneeR: 0.35, thighL: -0.2, thighR: 0.05, hipsY: -0.12, headY: lerp(-0.5, 0.5, e), jaw: 0.3 });
}
function crouchPose(o) { set(o, { hipsY: -0.42, thighL: -0.95, thighR: -0.85, kneeL: 1.55, kneeR: 1.45, spineX: 0.55, armLX: 0.55, armRX: 0.5, armLZ: 0.3, armRZ: -0.3, elbowL: -0.3, elbowR: -0.3, club: -0.9, headX: -0.3 }); }
function airPose(o, u) { smashPose(o, 0); o.thighL = -1.0; o.thighR = -0.7; o.kneeL = 1.5; o.kneeR = 1.2; if (u > 0.75) blendPose(o, set({}, { armLX: -1.2, armRX: -1.2, spineX: 0.4, thighL: -0.5, thighR: -0.3, kneeL: 0.6, kneeR: 0.5 }), (u - 0.75) * 4); }
function roarPose(o, t) {
  const k = smoothstep(0, 0.35, t) * (1 - smoothstep(1.3, 1.6, t));
  set(o, idle0); blendPose(o, set({}, { armLZ: 1.25, armLX: -0.3, elbowL: -0.5, armRZ: -1.2, armRX: -0.4, elbowR: -0.4, club: -0.3, spineX: -0.35, headX: -0.55, jaw: 0.75, hipsY: -0.1, kneeL: 0.25, kneeR: 0.25 }), k);
  o.headY += 0.06 * Math.sin(t * 40) * k;
}
function reelPose(o, t) {
  const k = 1 - smoothstep(0.6, 2.0, t);
  set(o, idle0); blendPose(o, set({}, { spineX: -0.45, headX: -0.35, headY: 0.3, armLZ: 0.95, armLX: -0.4, armRZ: -0.75, armRX: -0.7, elbowR: -0.6, club: -0.2, thighL: -0.35, kneeL: 0.5, kneeR: 0.3, hipsY: -0.1, jaw: 0.5 }), k);
}
function kneelPose(o) { set(o, { hipsY: -0.72, thighL: 0.05, thighR: 0.1, kneeL: 1.55, kneeR: 1.55, spineX: 0.35, headX: 0.5, armLX: 0.1, armLZ: 0.15, armRX: 0.05, armRZ: -0.2, elbowL: -0.2, elbowR: -0.2, club: -0.9, jaw: 0.3 }); }
