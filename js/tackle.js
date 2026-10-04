// Electrical Tackle (a skill under Storm Call). T, only while the storm is on his blade:
//   gather   he drops onto all fours and a great cat of lightning forms round him; sparks are drawn in and the
//            ground under him starts to smoulder. You can still turn him.                  (GATHER s)
//   dash     he is across DIST metres almost at once, along a line worked out at the moment he goes: it stops
//            short of trees and rocks and the edge of the plain. Everything under that line is scorched (grass
//            cut away, leaf litter burnt, ground blackened, snow melted), whatever is near it is hurt, stunned
//            and thrown aside, and a bolt is left hanging along the path for a moment. The cat pounces with
//            him, in an arc, and if something is ahead (within LOCK metres, in a cone) the dash goes for it
//            and stops right on top of it.                                                   (DASH s)
//   claw     the cat rears up and rakes twice, right paw then left: each swipe leaves glowing claw marks in
//            the air and burnt into the ground and hurts and stuns whatever is in front.     (CLAW s)
//   rise     the cat fades and he gets up                                                  (RISE s)
// The pose is in anim.js (state 'tackle'); player.js asks drive() for his velocity every frame.
import * as THREE from 'three';
import { groundY, PLAY_RADIUS } from './world.js';
import { smoothstep, dampAngle } from './util.js';
import { STUN } from './storm.js';
import { CatCloak } from './catcloak.js';

export const GATHER = 0.42, DASH = 0.16, CLAW = 0.5, RISE = 0.35;
export const DOWN = GATHER, RUN = DASH, UP = GATHER + DASH + CLAW, TOTAL = UP + RISE;     // the names the animator reads
const DIST = 8.5, LOCK = 10, DAMAGE = 38, REACH = 1.25, KNOCK = 1.4;
const SWIPES = [0.03 + 0.12, 0.2 + 0.12], SWIPE_DMG = 14, SWIPE_REACH = 2.6;   // when each paw lands (s into the claw), what it does
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Tackle {
  constructor(game) {
    this.game = game;
    this.dir = new THREE.Vector2(0, 1);
    this.hit = new Set();
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3(); this.len = 0; this.blocked = false;
    this.last = new THREE.Vector3(); this.arc = 0; this.snd = 0; this.went = false; this.landed = false; this.smoulder = false;
    this.cat = new CatCloak(game.scene);
    this.swiped = 0; this.slashes = []; this.target = null;
  }

  // T. Returns true if the tackle began.
  trigger(P) {
    const G = this.game;
    if (!G.skills || !G.skills.has('tackle') || !G.skills.has('storm')) { G.hud?.hint('Learn Electrical Tackle in the skill tree (K), under Storm Call', 3); return false; }
    if (!G.storm || !G.storm.charged) { G.hud?.hint('The tackle needs the storm on your blade: call it with R first', 3); return false; }
    if (P.state !== 'ground' || !P.grounded || G.bow?.equipped) return false;
    this.aimAt(P, true);
    this.hit.clear(); this.arc = 0; this.snd = 0; this.went = false; this.landed = false; this.smoulder = false; this.swiped = 0; this.target = null;
    P.setState('tackle');
    P.vel.set(0, 0, 0);
    G.audio?.storm('tackle');
    G.rig.shake = Math.max(G.rig.shake, 0.25);
    return true;
  }

  // the way he will go: where the stick points, else where he faces
  aimAt(P, snap) {
    const G = this.game, m = G.input.move(), b = G.rig.basis();
    if (m.mag > 0.2 || snap) {
      let dx = Math.sin(P.heading), dz = Math.cos(P.heading);
      if (m.mag > 0.2) { dx = b.fx * m.y + b.rx * m.x; dz = b.fz * m.y + b.rz * m.x; }
      const l = Math.hypot(dx, dz) || 1;
      this.dir.set(dx / l, dz / l);
    }
  }

  // how far the dash can go before something hard (a tree, a rock, the edge of the plain) is in the way
  plan(P) {
    // something to pounce on? the nearest target ahead, inside a cone and LOCK metres: go straight for it
    // and stop on top of it
    let want = DIST, best = null, bd = LOCK;
    for (const c of this.game.enemies?.targets || []) {
      if (c.dead || c.high) continue;
      const dx = c.x - P.pos.x, dz = c.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && d > 0.3 && (dx * this.dir.x + dz * this.dir.y) / d > 0.77) { bd = d; best = c; }
    }
    this.target = best;
    if (best) {
      const dx = best.x - P.pos.x, dz = best.z - P.pos.z, d = Math.hypot(dx, dz);
      this.dir.set(dx / d, dz / d); want = Math.max(0, d - best.r - 0.75);
    }
    let d = 0;
    this.blocked = false; this.wall = null;
    for (let s = 0.25; s <= want + 1e-6; s += 0.25) {
      const x = P.pos.x + this.dir.x * s, z = P.pos.z + this.dir.y * s;
      let hard = Math.hypot(x, z) > PLAY_RADIUS - 0.5;
      for (const c of P.colliders) { if (c.soft) continue; const dx = x - c.x, dz = z - c.z, r = c.r + 0.34; if (dx * dx + dz * dz < r * r) { hard = true; if (c.wall) this.wall = c.wall; break; } }
      if (hard) { this.blocked = true; break; }
      d = s;
    }
    this.from.copy(P.pos);
    this.to.set(P.pos.x + this.dir.x * d, 0, P.pos.z + this.dir.y * d); this.to.y = groundY(this.to.x, this.to.z);
    this.len = d;
  }

  // called by the player every frame he is tackling, before he moves: sets his velocity and heading
  drive(P, dt) {
    const G = this.game, t = P.stateT;
    if (t >= TOTAL) { this.end(P); return; }
    if (t < GATHER) {
      // gathering: rooted, but he can still be turned
      this.aimAt(P, false);
      P.heading = dampAngle(P.heading, Math.atan2(this.dir.x, this.dir.y), 14, dt);
      P.vel.x = P.vel.z = 0;
      return;
    }
    if (!this.went) this.go(P);
    P.heading = Math.atan2(this.dir.x, this.dir.y);
    if (t < GATHER + DASH + dt) {
      // the dash: the body is put where it should be at the end of this frame, along the planned line
      const u = Math.min(1, (t + dt - GATHER) / DASH), e = 1 - (1 - u) * (1 - u);
      const tx = this.from.x + this.dir.x * this.len * e, tz = this.from.z + this.dir.y * this.len * e;
      P.vel.x = (tx - P.pos.x) / Math.max(dt, 1e-4); P.vel.z = (tz - P.pos.z) / Math.max(dt, 1e-4);
      P.dashFov = 16;
    } else {
      if (!this.landed) this.land(P);
      // he skids to a stop on his hands
      const k = Math.exp(-9 * dt); P.vel.x *= k; P.vel.z *= k;
    }
  }

  // the moment he goes
  go(P) {
    const G = this.game;
    this.went = true;
    this.plan(P);
    this.last.copy(P.pos);
    G.audio?.storm('dash');
    G.rig.shake = Math.max(G.rig.shake, 0.85); G.hitStop = Math.max(G.hitStop, 0.03);
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 6; G.particles.emit('zap', P.pos.x, P.pos.y + 0.3, P.pos.z, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 0.8, 1); }
    G.particles.emit('dust', P.pos.x, P.pos.y + 0.05, P.pos.z, -this.dir.x * 3, 0.8, -this.dir.y * 3, 1.2, 18);
  }

  // the far end of the dash: a bolt hangs along the path he took, and he hits the ground
  land(P) {
    const G = this.game, S = G.storm;
    this.landed = true;
    if (this.wall) { this.intoWall(P); return; }
    P.vel.set(this.dir.x * 3, P.vel.y, this.dir.y * 3);         // the dash is over: what is left is a skid
    const a = this.from.clone(), b = P.pos.clone(); a.y += 0.55; b.y += 0.55;
    if (this.len > 0.5) {
      S.bolt(a, b, { life: 0.45, core: 0.03, glow: 0.16, segs: 28, amp: 0.4, branches: 4 });
      S.bolt(a, b, { life: 0.3, core: 0.015, glow: 0.07, segs: 20, amp: 0.6, branches: 2 });
    }
    G.particles.emit('dust', P.pos.x, P.pos.y + 0.05, P.pos.z, this.dir.x * 3, 0.9, this.dir.y * 3, 1.4, 22);
    for (let i = 0; i < 24; i++) { const r = Math.random() * 6.28, s = 2 + Math.random() * 5; G.particles.emit('zap', P.pos.x, P.pos.y + 0.4, P.pos.z, Math.cos(r) * s + this.dir.x * 4, 1 + Math.random() * 3, Math.sin(r) * s + this.dir.y * 4, 1, 1); }
    G.leaves.burst?.(P.pos.x, P.pos.y, P.pos.z, 1.6, 4);
    G.leaves.singe(P.pos.x, P.pos.z, 1.8, 1);
    G.rig.shake = Math.max(G.rig.shake, this.blocked ? 1 : 0.55);
    if (this.blocked) { G.audio?.sword('slam'); G.hitStop = Math.max(G.hitStop, 0.08); }
    G.audio?.storm('zap');
  }

  // the dash met an Earth Wall: the stone takes it, the cat breaks apart and he is thrown down, stunned
  intoWall(P) {
    const G = this.game, w = this.wall;
    const hx = P.pos.x + this.dir.x * 0.6, hz = P.pos.z + this.dir.y * 0.6, hy = P.pos.y + 0.7;
    w.jolt(hx, hy, hz);
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 5; G.particles.emit('zap', hx, hy, hz, Math.cos(a) * s - this.dir.x * 3, Math.random() * 4, Math.sin(a) * s - this.dir.y * 3, 1, 1); }
    G.audio?.storm('zap');
    G.earth.daze(P, 1.7);
  }

  end(P) { P.setState('ground'); P.vel.multiplyScalar(0.2); }

  // effects, after he has moved
  update(dt, G) {
    const P = G.player;
    P.dashFov = Math.max(0, (P.dashFov || 0) - dt * 40);
    this.updateSlashes(dt);
    const on = P.state === 'tackle', t = on ? P.stateT : 99;
    // how much cat there is: it forms over the gather, holds through the pounce and the claws, fades as he rises
    const k = on ? smoothstep(0, GATHER * 0.8, t) * (1 - smoothstep(UP, TOTAL, t)) : 0;
    const gather = on && t < GATHER ? smoothstep(0.05, GATHER, t) : 0;
    const leap = on && t >= GATHER && t < GATHER + DASH ? (t - GATHER) / DASH : -1;
    const stretch = on && t >= GATHER ? 1 - smoothstep(GATHER + DASH, GATHER + DASH + 0.12, t) : 0;
    const claw = on && t >= GATHER + DASH && t < UP ? t - GATHER - DASH : -1;
    this.cat.update(G.time, P.pos, P.heading, { k, gather, leap, stretch, claw });
    if (!on || k <= 0.02) return;
    // the paws land
    while (claw >= 0 && this.swiped < SWIPES.length && claw >= SWIPES[this.swiped]) this.swipe(P, this.swiped++ % 2 ? -1 : 1);
    const dash = stretch;
    const fx = this.dir.x, fz = this.dir.y, px = P.pos.x, pz = P.pos.z, py = P.pos.y;
    // arcs crawling over the cat
    this.arc -= dt;
    while (this.arc <= 0) {
      this.arc += 0.045 / Math.max(0.3, k);
      const u = Math.random() * 6.28, v = (Math.random() - 0.4) * 2.2, side = Math.cos(u) * 0.55;
      _a.set(px + fx * v + side * fz, py + 0.45 + Math.random() * 0.9, pz + fz * v - side * fx);
      _b.copy(_a).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 0.8, (Math.random() - 0.5) * 1.2));
      G.storm.bolt(_a, _b, { life: 0.1, core: 0.012, glow: 0.05, segs: 8, amp: 0.22, branches: 0 });
    }
    this.snd -= dt; if (this.snd <= 0) { this.snd = 0.08; G.audio?.storm('crackle', 0.6 + gather); }
    if (gather > 0) {
      // the charge: sparks drawn in from round about, the ground under him smouldering, a tremble
      for (let n = 0, c = Math.floor(dt * 110 + Math.random()); n < c; n++) {
        const a = Math.random() * 6.28, r = 1.6 + Math.random() * 1.4, sx = px + Math.cos(a) * r, sz = pz + Math.sin(a) * r;
        G.particles.emit('zap', sx, py + 0.2 + Math.random() * 1.2, sz, (px - sx) * 3.2, 0.5, (pz - sz) * 3.2, 0.3, 1);
      }
      if (!this.smoulder && t > 0.2) { this.smoulder = true; G.leaves.singe(px, pz, 1.2, 0.8); }
      G.rig.shake = Math.max(G.rig.shake, 0.08 + 0.18 * gather);
      return;
    }
    // the path: scorched every 35 cm (the stamps overlap so the swath has no gaps), and anything near it is hit
    const dx = px - this.last.x, dz = pz - this.last.z, dist = Math.hypot(dx, dz), steps = Math.min(30, Math.ceil(dist / 0.35));
    for (let i = 1; i <= steps; i++) this.scorch(this.last.x + dx * i / steps, this.last.z + dz * i / steps, fx, fz);
    if (dist > 0.01) this.strike(this.last, P.pos);
    if (dash > 0.5) for (let n = 0; n < 6; n++) G.particles.emit('zap', px - fx * Math.random() * dist, py + 0.2 + Math.random() * 0.8, pz - fz * Math.random() * dist, -fx * 4 + (Math.random() - 0.5) * 3, Math.random() * 2, -fz * 4 + (Math.random() - 0.5) * 3, 0.6, 1);
    this.last.copy(P.pos);
  }

  // one paw rakes down across the front (side 1: the right paw, -1: the left)
  swipe(P, side) {
    const G = this.game, fx = Math.sin(P.heading), fz = Math.cos(P.heading), rx = fz, rz = -fx;
    // what is in front of the cat takes it
    let at = null;
    for (const c of G.enemies?.targets || []) {
      if (c.dead || c.high) continue;
      const ex = c.x - P.pos.x, ez = c.z - P.pos.z, d = Math.hypot(ex, ez);
      if (d > SWIPE_REACH + c.r || (ex * fx + ez * fz) / Math.max(d, 1e-3) < 0.2) continue;
      c.onHit?.('claw', SWIPE_DMG, ex, ez, { zap: true, stun: STUN, knock: 0.35 });
      const cy = groundY(c.x, c.z) + 1.0;
      for (let i = 0; i < 16; i++) G.particles.emit('zap', c.x, cy, c.z, (Math.random() - 0.5) * 6 + rx * side * 3, Math.random() * 3 - 1, (Math.random() - 0.5) * 6 + rz * side * 3, 0.8, 1);
      if (!at) at = new THREE.Vector3(c.x - fx * 0.3, cy, c.z - fz * 0.3);
    }
    // the slash hangs in the air where the paw went through: on what it hit, else in front of the cat
    const p = at || new THREE.Vector3(P.pos.x + fx * 1.75, P.pos.y + 1.05, P.pos.z + fz * 1.75);
    this.slash(p, P.heading, side);
    // and the claws catch the ground: three burnt furrows raked across the front, the grass torn up
    for (let k = -1; k <= 1; k++) for (let s = 0; s <= 6; s++) {
      const a = s / 6, w = (a - 0.5) * 1.1 * side, x = P.pos.x + fx * (1.15 + a * 0.9) + rx * (w + k * 0.2), z = P.pos.z + fz * (1.15 + a * 0.9) + rz * (w + k * 0.2);
      G.burn.stamp(x, z, 0.16, 1); G.cut.stamp(x, z, 0.2, 1);
    }
    G.leaves.kick(P.pos.x + fx * 1.6, P.pos.z + fz * 1.6, 1.2, 1.4, (fx - rx * side) * 4, (fz - rz * side) * 4);
    G.leaves.singe(P.pos.x + fx * 1.6, P.pos.z + fz * 1.6, 0.9, 0.8);
    G.audio?.sword('cut'); if (at) { G.audio?.storm('zap'); G.audio?.sword('hit'); G.hitStop = Math.max(G.hitStop, 0.06); }
    G.rig.shake = Math.max(G.rig.shake, at ? 0.5 : 0.25);
  }

  // three glowing claw marks, drawn in as the paw rakes through and fading
  slash(p, heading, side) {
    if (!this.slashGeo) {
      const ribbon = (off, w0) => {
        const pos = [], idx = [], N = 14;
        for (let i = 0; i <= N; i++) {
          const s = i / N, x = 0.55 - 1.1 * s + off, y = 0.6 - 1.2 * s + off * 0.4, z = 0.25 * Math.sin(Math.PI * s), w = w0 * Math.sin(Math.PI * Math.min(1, s * 1.15 + 0.04));
          // across the stroke: perpendicular to its (diagonal) direction
          pos.push(x - w * 0.74, y + w * 0.67, z, x + w * 0.74, y - w * 0.67, z);
          if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
      };
      this.slashGeo = [-0.2, 0, 0.2].map((o) => ribbon(o, 0.035));
      this.slashGlow = [-0.2, 0, 0.2].map((o) => ribbon(o, 0.1));
    }
    const g = new THREE.Group();
    const core = new THREE.MeshBasicMaterial({ color: 0xe6f2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const glow = new THREE.MeshBasicMaterial({ color: 0x3f7dff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const geo of this.slashGlow) g.add(new THREE.Mesh(geo, glow));
    for (const geo of this.slashGeo) g.add(new THREE.Mesh(geo, core));
    g.children.forEach((m) => { m.frustumCulled = false; m.renderOrder = 15; });
    g.position.copy(p); g.rotation.set(0, heading, 0); g.scale.set(side * 1.5, 1.5, 1.5);
    this.game.scene.add(g);
    this.slashes.push({ g, core, glow, t: 0 });
  }
  updateSlashes(dt) {
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]; s.t += dt;
      const draw = Math.min(1, s.t / 0.05), fade = 1 - Math.max(0, (s.t - 0.08) / 0.3);
      s.g.scale.y = Math.abs(s.g.scale.x) * (0.25 + 0.75 * draw);
      s.core.opacity = fade; s.glow.opacity = 0.6 * fade;
      if (fade <= 0) { this.game.scene.remove(s.g); s.core.dispose(); s.glow.dispose(); this.slashes.splice(i, 1); }
    }
  }

  // everything within reach of the stretch of path from a to b
  strike(a, b) {
    const G = this.game, abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
    for (const c of G.enemies?.targets || []) {
      if (c.dead || c.high || this.hit.has(c)) continue;
      const u = Math.max(0, Math.min(1, ((c.x - a.x) * abx + (c.z - a.z) * abz) / L2));
      const qx = a.x + abx * u, qz = a.z + abz * u, ex = c.x - qx, ez = c.z - qz;
      if (Math.hypot(ex, ez) > c.r + REACH) continue;
      this.hit.add(c);
      // thrown aside from the line, and along it
      c.onHit?.('tackle', DAMAGE, ex + this.dir.x * 0.6, ez + this.dir.y * 0.6, { zap: true, stun: STUN, knock: KNOCK });
      const cy = groundY(c.x, c.z) + 1.0;
      G.storm.bolt(new THREE.Vector3(qx, groundY(qx, qz) + 0.6, qz), new THREE.Vector3(c.x, cy, c.z), { life: 0.22, core: 0.02, glow: 0.08, segs: 12, amp: 0.3, branches: 2 });
      G.leaves.singe(c.x, c.z, 2.4, 1);
      for (let i = 0; i < 24; i++) G.particles.emit('zap', c.x, cy, c.z, (Math.random() - 0.5) * 7, Math.random() * 4, (Math.random() - 0.5) * 7, 1, 1);
      G.audio?.storm('zap'); G.audio?.sword('hit');
      G.rig.shake = Math.max(G.rig.shake, 0.8); G.hitStop = Math.max(G.hitStop, 0.09);
    }
  }

  // one patch of the swath
  scorch(x, z, fx, fz) {
    const G = this.game, y = groundY(x, z);
    G.leaves.singe(x, z, 1.05, 1);                 // the litter ignites, and the ground under it is blackened (burn map)
    G.cut.stamp(x, z, 0.85, 1);                    // grass and wheat are burnt away
    G.snow.stamp(x, z, 0.75, 0.75, 0, 1, 0.25);    // snow melts to a dark strip
    const pz = G.particles;
    if (Math.random() < 0.8) pz.emit('ember', x + (Math.random() - 0.5) * 0.7, y + 0.1, z + (Math.random() - 0.5) * 0.7, -fx * 0.5, 0.8 + Math.random() * 1.5, -fz * 0.5, 0.6, 1);
    if (Math.random() < 0.5) pz.emit('smoke', x + (Math.random() - 0.5) * 0.8, y + 0.15, z + (Math.random() - 0.5) * 0.8, 0, 0.5 + Math.random(), 0, 0.6, 1);
  }
}
