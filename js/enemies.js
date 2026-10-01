// The training ground: a patch of open field with a straw dummy that shows the damage you do and a
// practice enemy that makes one slow, readable attack so you can learn to parry it.
//   - the enemy winds up (raises the bokken, eyes and blade glow red, a "!" appears): about 0.8 s
//   - then strikes (0.16 s). If your parry is up at any moment of the strike the blow is turned aside, the
//     enemy reels, and your next hit on it counts double. If not, you take 15 damage. A roll or flash
//     through it dodges it.
// Both are targets for the sword, the bow and the slam: anything in `targets` has {x, z, r, onHit()}.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, damp, dampAngle } from './util.js';

export const TRAINING = { x: -78, z: 1 };
const AGGRO = 14, REACH = 2.3, SWING_DAMAGE = 15;

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };

// ------------------------------------------------------------------ the straw dummy
class Dummy {
  constructor(game, x, z) {
    this.game = game; this.pos = new THREE.Vector3(x, groundY(x, z), z);
    this.group = new THREE.Group(); this.group.position.copy(this.pos);
    this.tilt = new THREE.Group(); this.group.add(this.tilt);     // the part that rocks when hit
    const wood = mat(0x6b4a2e), straw = mat(0xb59a5a, { roughness: 1 }), rope = mat(0x4a3a24), sack = mat(0xc9b88a, { roughness: 1 });
    this.mats = [wood, straw, sack];
    this.group.add(mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.14, 12), wood, 0, 0.07, 0));
    this.tilt.add(mesh(new THREE.CylinderGeometry(0.08, 0.09, 1.95, 8), wood, 0, 0.98, 0));
    this.tilt.add(mesh(new THREE.BoxGeometry(1.0, 0.09, 0.09), wood, 0, 1.42, 0));
    this.tilt.add(mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.78, 12), straw, 0, 1.12, 0));
    for (const y of [0.85, 1.12, 1.4]) this.tilt.add(mesh(new THREE.TorusGeometry(0.29, 0.02, 6, 16).rotateX(Math.PI / 2), rope, 0, y, 0));
    this.tilt.add(mesh(new THREE.SphereGeometry(0.19, 14, 10), sack, 0, 1.78, 0));
    this.tilt.add(mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), mat(0x222222), 0.07, 1.82, 0.18));
    this.tilt.add(mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), mat(0x222222), -0.07, 1.82, 0.18));
    game.scene.add(this.group);
    this.rx = 0; this.rz = 0; this.vx = 0; this.vz = 0;
    this.total = 0; this.last = 0; this.hits = 0; this.t0 = 0;
    this.sign = this.buildSign(x, z);
    this.target = { x, z, r: 0.5, y0: 0, y1: 2.0, dummy: this, onHit: (k, dmg, dx, dz) => this.hit(dmg, dx, dz, k) };
    this.collider = { x, z, r: 0.42 };
  }
  buildSign(x, z) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; this.ctx = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), mat(0x6b4a2e), -0.62, 0.55, 0), mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), mat(0x6b4a2e), 0.62, 0.55, 0));
    g.add(mesh(new THREE.BoxGeometry(1.4, 0.7, 0.05), mat(0x5a3d26), 0, 0.85, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    face.position.set(0, 0.85, 0.03); g.add(face);
    g.position.set(x + 2.2, groundY(x + 2.2, z + 1.4), z + 1.4); g.rotation.y = 1.15;
    this.game.scene.add(g); this.drawSign();
    return g;
  }
  drawSign() {
    const g = this.ctx; g.fillStyle = '#d8c79a'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#3a2a1a'; g.font = '600 20px Georgia, serif'; g.textAlign = 'center';
    g.fillText('TRAINING DUMMY', 128, 26);
    g.font = '700 46px Georgia, serif'; g.fillText(this.last ? String(this.last) : '--', 128, 74);
    g.font = '16px Georgia, serif'; g.fillText(`total ${this.total}   ·   hits ${this.hits}   ·   ${this.dps().toFixed(0)} / sec`, 128, 106);
    this.tex.needsUpdate = true;
  }
  dps() { return this.total / Math.max(1, this.game.time - this.t0); }
  hit(dmg, dx, dz, kind) {
    const G = this.game, l = Math.hypot(dx, dz) || 1;
    if (this.game.time - this.lastHitAt > 6 || this.lastHitAt === undefined) { this.total = 0; this.hits = 0; this.t0 = this.game.time; }
    this.lastHitAt = this.game.time;
    this.total += dmg; this.hits++; this.last = dmg;
    this.vx += dz / l * 2.2; this.vz += -dx / l * 2.2;                      // rocks away from the blow
    G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 2.0, this.pos.z), String(dmg), dmg >= 30 ? 'big' : '');
    this.drawSign();
    this.flash = 1;
    return true;
  }
  update(dt) {
    // a damped spring about the base
    this.vx += (-this.rx * 60 - this.vx * 5) * dt; this.vz += (-this.rz * 60 - this.vz * 5) * dt;
    this.rx += this.vx * dt; this.rz += this.vz * dt;
    this.tilt.rotation.set(this.rx, 0, this.rz);
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 5); for (const m of this.mats) m.emissive.setScalar(this.flash * 0.35); }
    if (this.lastHitAt !== undefined && this.game.time - this.lastHitAt > 6 && this.total) { this.total = 0; this.hits = 0; this.last = 0; this.drawSign(); }
  }
}

// ------------------------------------------------------------------ the practice enemy
class Trainee {
  constructor(game, x, z) {
    this.game = game; this.home = new THREE.Vector2(x, z);
    this.pos = new THREE.Vector3(x, groundY(x, z), z); this.heading = Math.PI;
    this.maxHp = 100; this.hp = this.maxHp;
    this.state = 'idle'; this.t = 0; this.resolved = false; this.cool = 1; this.bonus = false;
    this.flash = 0; this.pulse = 0;
    const robe = mat(0x2b3150), sash = mat(0x8a2d24), maskM = mat(0xe8e0d0, { roughness: 0.6 }), straw = mat(0x9a8250, { roughness: 1 }), wood = mat(0x7a5632), dark = mat(0x1d1a22);
    this.eyeM = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.5 });
    this.bladeM = new THREE.MeshStandardMaterial({ color: 0x9a7a52, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.7 });
    this.mats = [robe, sash, maskM, straw, dark];
    this.group = new THREE.Group();
    this.body = new THREE.Group(); this.group.add(this.body);
    this.body.add(mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.85, 12), robe, 0, 0.43, 0));
    this.torso = new THREE.Group(); this.torso.position.y = 0.85; this.body.add(this.torso);
    this.torso.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 12), robe, 0, 0.3, 0));
    this.torso.add(mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.1, 12), sash, 0, 0.02, 0));
    this.torso.add(mesh(new THREE.SphereGeometry(0.17, 14, 12), maskM, 0, 0.8, 0));
    this.torso.add(mesh(new THREE.ConeGeometry(0.36, 0.2, 14), straw, 0, 0.98, 0));
    for (const s of [-1, 1]) this.torso.add(mesh(new THREE.BoxGeometry(0.06, 0.025, 0.03), this.eyeM, s * 0.065, 0.83, 0.155));
    const arm = (s) => {
      const p = new THREE.Group(); p.position.set(s * 0.27, 0.56, 0); this.torso.add(p);
      p.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 8), robe, 0, -0.25, 0)); p.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), dark, 0, -0.52, 0));
      return p;
    };
    this.armL = arm(-1); this.armR = arm(1);
    this.sword = mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), this.bladeM, 0, -0.52, 0.45);
    this.armR.add(this.sword); this.armR.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6).rotateX(Math.PI / 2), wood, 0, -0.52, 0));
    game.scene.add(this.group);
    this.target = { x, z, r: 0.5, y0: 0, y1: 1.9, enemy: this, get dead() { return this.enemy.state === 'dead'; }, onHit: (k, dmg, dx, dz) => this.hurt(dmg, dx, dz, k) };
    this.collider = { x, z, r: 0.4 };
    this.setState('idle');
  }
  setState(s) { this.state = s; this.t = 0; this.resolved = false; }

  hurt(dmg, dx, dz, kind) {
    if (this.state === 'dead') return false;
    const G = this.game, l = Math.hypot(dx, dz) || 1;
    let crit = false;
    if (this.state === 'stagger') { dmg *= 2; crit = true; }
    this.hp -= dmg; this.flash = 1;
    if (kind === 'slam' && this.hp > 0) this.setState('stagger');          // the shockwave throws him off his feet
    this.pos.x += dx / l * 0.25; this.pos.z += dz / l * 0.25;
    G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 2.1, this.pos.z), (crit ? 'CRIT ' : '') + dmg, crit || dmg >= 30 ? 'big' : '');
    if (this.hp <= 0) { this.setState('dead'); G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 2.4, this.pos.z), 'DEFEATED', 'gold word'); }
    else if (this.state === 'windup' && kind !== 'arrow' && dmg >= 25) this.setState('stagger');      // a heavy blow breaks its wind-up
    return true;
  }
  parried() {
    const G = this.game;
    this.setState('stagger'); this.resolved = true;
    G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z), 'STAGGERED', 'gold word');
  }

  update(dt, G) {
    const P = G.player, dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    this.t += dt; this.cool -= dt;
    const face = (rate = 9) => { this.heading = dampAngle(this.heading, Math.atan2(dx, dz), rate, dt); };
    let windK = 0, strikeK = 0, lean = 0, glow = 0;
    switch (this.state) {
      case 'idle':
        if (dist < AGGRO) { face(5); if (this.cool <= 0) this.setState('chase'); }
        break;
      case 'chase':
        face(8);
        if (dist > REACH - 0.2) { const sp = 2.3, ux = dx / dist, uz = dz / dist; this.pos.x += ux * sp * dt; this.pos.z += uz * sp * dt; }
        else if (this.cool <= 0) { this.setState('windup'); G.hud?.floatText(new THREE.Vector3(this.pos.x, this.pos.y + 2.3, this.pos.z), '!', 'red big'); G.audio?.sword('draw'); }
        if (dist > AGGRO + 8) this.setState('idle');
        break;
      case 'windup': {
        face(3.5);
        windK = clamp(this.t / 0.7, 0, 1); glow = windK; lean = -0.25 * windK;
        if (this.t >= 0.8) { this.setState('strike'); G.audio?.sword('overhead'); }
        break;
      }
      case 'strike': {
        windK = 1 - clamp(this.t / 0.1, 0, 1) * 1.6; strikeK = clamp(this.t / 0.1, 0, 1); glow = 1; lean = 0.35 * strikeK - 0.25 * (1 - strikeK);
        if (!this.resolved) {
          // is he within the blow (a cone in front of the enemy)?
          const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
          const inCone = dist < REACH + 0.3 && (dx * fx + dz * fz) / Math.max(dist, 1e-3) > 0.45;
          if (inCone) {
            if (P.weapon && P.weapon.deflect(this.pos)) this.parried();
            else if (this.t >= 0.09) {
              this.resolved = true;
              const r = P.hurt(SWING_DAMAGE, this.pos);
              if (r === 'dodged') G.hud?.floatText(new THREE.Vector3(P.pos.x, P.pos.y + 1.6, P.pos.z), 'DODGE', 'gold word');
            }
          } else if (this.t >= 0.09) this.resolved = true;
        }
        if (this.t >= 0.18) this.setState('recover');
        break;
      }
      case 'recover':
        face(2); windK = 0; strikeK = 1 - clamp(this.t / 0.5, 0, 1); lean = 0.35 * strikeK;
        if (this.t >= 1.0) { this.cool = 0.5 + Math.random() * 0.6; this.setState(dist < REACH + 1 ? 'chase' : 'idle'); }
        break;
      case 'stagger': {
        const k = Math.sin(clamp(this.t / 1.5, 0, 1) * Math.PI);
        lean = -0.5 * k; windK = 0.2 * k; strikeK = 0;
        this.pos.x -= (dx / Math.max(dist, 1e-3)) * 1.2 * Math.max(0, 0.5 - this.t) * dt * 4;
        this.pos.z -= (dz / Math.max(dist, 1e-3)) * 1.2 * Math.max(0, 0.5 - this.t) * dt * 4;
        if (this.t >= 1.5) { this.cool = 0.3; this.setState(dist < REACH + 1 ? 'chase' : 'idle'); }
        break;
      }
      case 'dead': {
        if (this.t > 4) { this.hp = this.maxHp; this.pos.set(this.home.x, 0, this.home.y); this.cool = 1.5; this.setState('idle'); }
        break;
      }
    }
    // keep him near his ground; the rest of the world is not his
    const hx = this.pos.x - this.home.x, hz = this.pos.z - this.home.y, hl = Math.hypot(hx, hz);
    if (hl > 16) { this.pos.x = this.home.x + hx / hl * 16; this.pos.z = this.home.y + hz / hl * 16; }
    // keep out of the player
    if (this.state !== 'dead' && dist < 0.8) { this.pos.x -= dx / Math.max(dist, 1e-3) * (0.8 - dist); this.pos.z -= dz / Math.max(dist, 1e-3) * (0.8 - dist); }
    this.pos.y = groundY(this.pos.x, this.pos.z);
    this.target.x = this.collider.x = this.pos.x; this.target.z = this.collider.z = this.pos.z;
    // pose
    const g = this.group; g.position.copy(this.pos); g.rotation.y = this.heading;
    const fall = this.state === 'dead' ? clamp(this.t / 0.5, 0, 1) : 0;
    this.body.rotation.x = -fall * 1.45; this.body.position.y = -fall * 0.15;
    this.torso.rotation.x = lean;
    const walk = this.state === 'chase' && dist > REACH - 0.2 ? Math.sin(G.time * 9) * 0.05 : 0;
    this.body.position.y += Math.abs(walk) * 0.5;
    // arms: wind-up lifts the bokken over his head, the strike brings it down in front of him
    const up = -2.55 * windK, down = 0.15;
    this.armR.rotation.x = this.state === 'strike' || this.state === 'recover' ? lerp(up, down, strikeK) : up + (this.state === 'idle' || this.state === 'chase' ? -0.9 : 0);
    this.armL.rotation.x = this.armR.rotation.x * 0.8; this.armL.rotation.z = 0.12; this.armR.rotation.z = -0.12;
    // glow
    this.pulse = glow > 0 ? 0.6 + 0.4 * Math.sin(G.time * 30) : 0;
    this.eyeM.emissiveIntensity = glow * 2.5 * (0.7 + 0.3 * this.pulse); this.bladeM.emissiveIntensity = glow * 1.4;
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 5); for (const m of this.mats) m.emissive.setScalar(this.flash * 0.4); }
  }
}
const lerp = (a, b, t) => a + (b - a) * t;

export class Enemies {
  constructor(game) {
    this.game = game;
    const { x, z } = TRAINING;
    this.dummy = new Dummy(game, x, z);
    this.enemy = new Trainee(game, x + 8, z + 2);
    this.targets = [this.dummy.target, this.enemy.target];
    this.colliders = [this.dummy.collider, this.enemy.collider];
    this.markers(x, z);
    this.mow = 0;
  }
  // a ring of low stakes round the ground, so it reads as a place
  markers(x, z) {
    const wood = mat(0x6b4a2e), rope = mat(0x8a7a52);
    const R = 11, N = 22, ps = [];
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, px = x + 4 + Math.cos(a) * R, pz = z + 1 + Math.sin(a) * R;
      const s = mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.75, 6), wood, px, groundY(px, pz) + 0.37, pz); this.game.scene.add(s); ps.push(s.position);
    }
    for (let i = 0; i < N; i++) {
      const a = ps[i], b = ps[(i + 1) % N], len = a.distanceTo(b);
      const r = mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4), rope); r.castShadow = false;
      r.position.copy(a).lerp(b, 0.5); r.position.y += 0.22 - Math.sin(Math.PI * 0.5) * 0.04;
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).setY(0).normalize()); this.game.scene.add(r);
    }
  }
  update(dt, game) {
    this.dummy.update(dt); this.enemy.update(dt, game);
    // the grass on the practice ground is kept short: it is stamped as freshly cut every few seconds, so it never grows back
    this.mow -= dt;
    if (this.mow <= 0) { this.mow = 8; game.cut.stamp(TRAINING.x + 4, TRAINING.z + 1, 10, 0.9); }
  }
}
