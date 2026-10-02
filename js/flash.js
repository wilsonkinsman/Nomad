// Flash Roll (a skill, see skills.js). Tap the roll twice and he does not roll: he is gone, in a burst of
// black lines, and he reappears at the place the roll would have carried him to; the screen is never blacked out.
//   out   he fades away as black streaks sweep in           (OUT s)
//   hold  streaks at their thickest; he is moved, the camera snaps  (HOLD s)
//   in    the streaks sweep away as he fades back in        (IN s)
// The destination is worked out from the roll itself (the dive's launch speed, the flight and the
// tumble that follows), then stopped short of trees and rocks and the edge of the plain.
import * as THREE from 'three';
import { groundY, PLAY_RADIUS } from './world.js';
import { clamp, smoothstep } from './util.js';
import { inside } from './collide.js';

const OUT = 0.15, HOLD = 0.06, IN = 0.26, COOLDOWN = 1.4;
const GRAV = 13, ROLL_DRAG = 1.6;

export class Flash {
  constructor(game) {
    this.game = game;
    this.canvas = document.getElementById('flash-fx'); this.ctx = this.canvas.getContext('2d');
    this.t = -1; this.cd = 0; this.moved = false; this.k = 0;
    this.seed = 1; this.seedT = 0; this.angle = 0;
    this.mats = [];
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3(); this.dir = new THREE.Vector2();
    addEventListener('resize', () => this.size());
    this.size();
  }
  size() { this.canvas.width = innerWidth; this.canvas.height = innerHeight; }
  get active() { return this.t >= 0; }

  // where the roll that has just begun would end: the flight, then the tumble as it slows
  plan(P) {
    const v = P.diveSpeed, vy = P.diveVy;
    const flight = v * (2 * vy / GRAV);
    const tumble = v * (1 - Math.exp(-ROLL_DRAG * P.rollTime)) / ROLL_DRAG;
    const reach = flight + tumble, dir = P.diveDir, o = P.diveFrom;
    let d = 0;
    for (let s = 0.25; s <= reach; s += 0.25) {
      const x = o.x + dir.x * s, z = o.z + dir.y * s;
      if (Math.hypot(x, z) > PLAY_RADIUS - 0.5 || this.blocked(P, x, z)) break;
      d = s;
    }
    const x = o.x + dir.x * d, z = o.z + dir.y * d;
    return new THREE.Vector3(x, groundY(x, z), z);
  }
  blocked(P, x, z) {
    for (const c of P.colliders) if (inside(c, x, z, 0.34)) return true;
    return false;
  }

  // the second tap of the roll: returns true if the flash began
  trigger(P) {
    const G = this.game;
    if (!G.skills.has('flash')) { G.hud?.hint('Learn Flash Roll in the skill tree (K)', 3); return false; }
    if (this.active || this.cd > 0) return false;
    this.from.copy(P.pos); this.to.copy(this.plan(P));
    this.dir.copy(P.diveDir);
    this.t = 0; this.moved = false; this.k = 0; this.cd = COOLDOWN;
    P.vel.set(0, 0, 0); P.grounded = true; P.setState('flash');
    // where the streaks run on the screen: the direction he is going, as the camera sees it
    const m = G.camera.matrixWorld.elements;
    const dx = this.dir.x * m[0] + this.dir.y * m[2], dy = this.dir.x * m[4] + this.dir.y * m[6];
    this.angle = Math.hypot(dx, dy) > 0.05 ? Math.atan2(-dy, dx) : 0;
    this.holdMaterials(P);
    G.audio?.flash('out');
    return true;
  }

  holdMaterials(P) {
    const seen = new Set(); this.mats.length = 0;
    const each = (root) => root && root.traverse((o) => {
      if (!o.isMesh || o === P.weapon?.rig.trail.mesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || seen.has(m)) continue; seen.add(m);
        this.mats.push({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
        m.transparent = true; m.needsUpdate = true;
      }
    });
    each(P.model.group); each(P.model.clothGroup);
  }
  fade(P, a) {
    for (const r of this.mats) { r.m.opacity = r.opacity * a; r.m.depthWrite = a > 0.98 ? r.depthWrite : false; }
    const vis = a > 0.02;
    P.model.group.visible = vis; P.model.clothGroup.visible = vis;
  }
  release(P) {
    for (const r of this.mats) { r.m.transparent = r.transparent; r.m.opacity = r.opacity; r.m.depthWrite = r.depthWrite; r.m.needsUpdate = true; }
    this.mats.length = 0; P.model.group.visible = true; P.model.clothGroup.visible = true;
  }

  // at the darkest moment: move him, snap the camera, leave a streak in the grass and dust at both ends
  jump(P) {
    const G = this.game, from = this.from, to = this.to;
    const n = Math.min(22, Math.ceil(from.distanceTo(to) / 0.35));
    for (let i = 0; i <= n; i++) { const f = i / Math.max(1, n); G.trample.stamp(from.x + (to.x - from.x) * f, from.z + (to.z - from.z) * f, 0.45, 0.8, this.dir.x, this.dir.y, 0.6); }
    for (const p of [from, to]) G.particles.emit('dust', p.x, p.y + 0.15, p.z, 0, 0.8, 0, 1.6, 14);
    P.pos.copy(to); P.visualY = to.y;
    P.heading = Math.atan2(this.dir.x, this.dir.y);
    const eye = P.model.camHeight ?? 1.48;
    G.rig.focus.set(to.x, to.y + eye, to.z);
    G.audio?.flash('in');
  }

  update(dt, game) {
    this.cd = Math.max(0, this.cd - dt);
    const P = game.player;
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    if (!this.moved && t >= OUT) { this.moved = true; this.jump(P); }
    // 0 = clear, 1 = black
    this.k = t < OUT ? smoothstep(0, OUT, t) : t < OUT + HOLD ? 1 : 1 - smoothstep(OUT + HOLD, OUT + HOLD + IN, t);
    this.fade(P, clamp(1 - this.k * 1.15, 0, 1));
    if (t >= OUT + HOLD + IN) {
      this.t = -1; this.k = 0; this.release(P);
      P.setState('ground'); P.landImpact = 5;
      P.vel.x = this.dir.x * 2.5; P.vel.z = this.dir.y * 2.5;      // he comes out of it still moving
    }
    this.draw(dt);
  }

  // black streaks in the direction of travel, coming in as k rises and going out as it falls, redrawn at
  // about 20 frames a second so they flicker like ink; the screen itself is never blacked out
  draw(dt) {
    const c = this.canvas, g = this.ctx, W = c.width, H = c.height, k = this.k;
    g.clearRect(0, 0, W, H);
    if (k < 0.002) return;
    this.seedT -= dt; if (this.seedT <= 0) { this.seedT = 0.05; this.seed = (Math.random() * 1e6) | 0; }
    const rnd = (() => { let s = this.seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const D = Math.hypot(W, H);
    // the streaks
    g.save(); g.translate(W / 2, H / 2); g.rotate(this.angle); g.fillStyle = '#000';
    const count = Math.round(150 * Math.min(1, k * 1.3));
    for (let i = 0; i < count; i++) {
      const off = (rnd() - 0.5) * D * 1.1, len = D * (0.15 + 0.7 * rnd()) * (0.35 + 0.65 * k), at = (rnd() - 0.5) * D * (1 - 0.5 * k);
      const w = (0.6 + 4 * rnd() * rnd()) * (0.4 + 1.2 * k);
      g.beginPath(); g.moveTo(at - len / 2, off); g.lineTo(at + len / 2, off - w / 2); g.lineTo(at + len / 2, off + w / 2); g.closePath(); g.fill();
    }
    g.restore();
  }
}
