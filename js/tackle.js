// Electrical Tackle (a skill under Storm Call). T, only while the storm is on his blade: he drops onto all fours,
// wrapped in lightning, and bounds ahead (you can bend the line a little while he runs). Everything under him
// is scorched: the grass is cut away, the leaf litter burns and the ground is blackened (the same burn map
// Storm Call writes), snow melts. Whatever he runs into is hurt, stunned and thrown back; trees stop him.
//   down     he gets onto his hands          (DOWN s)
//   charge   the run                          (RUN s)
//   rise     he slows and stands again        (RISE s)
// The pose is in anim.js (state 'tackle'); player.js asks drive() for his velocity every frame.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, smoothstep, dampAngle, wrapAngle } from './util.js';
import { STUN } from './storm.js';

export const DOWN = 0.28, RUN = 1.4, RISE = 0.42;
export const TOTAL = DOWN + RUN + RISE;
const SPEED = 11.5, TURN = 1.7, DAMAGE = 38, REACH = 1.05, KNOCK = 1.4;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Tackle {
  constructor(game) {
    this.game = game;
    this.dir = new THREE.Vector2(0, 1);
    this.hit = new Set();
    this.speedSet = 0; this.last = new THREE.Vector3(); this.arc = 0; this.snd = 0; this.fx = 0;
    // a faint blue skin of light round the body while he runs
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'varying vec3 vN, vV; void main() { vN = normalize(normalMatrix * normal); vec4 m = modelViewMatrix * vec4(position, 1.0); vV = -m.xyz; gl_Position = projectionMatrix * m; }',
      fragmentShader: 'uniform float uK; varying vec3 vN, vV; void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(vec3(0.42, 0.65, 1.3) * f * uK, 1.0); }',
    }));
    this.aura.visible = false; this.aura.renderOrder = 14; this.aura.frustumCulled = false;
    game.scene.add(this.aura);
  }

  // T. Returns true if the tackle began.
  trigger(P) {
    const G = this.game;
    if (!G.skills || !G.skills.has('tackle') || !G.skills.has('storm')) { G.hud?.hint('Learn Electrical Tackle in the skill tree (K), under Storm Call', 3); return false; }
    if (!G.storm || !G.storm.charged) { G.hud?.hint('The tackle needs the storm on your blade: call it with R first', 3); return false; }
    if (P.state !== 'ground' || !P.grounded || G.bow?.equipped) return false;
    // the way he runs: where the stick points, else where he faces
    const m = G.input.move(), b = G.rig.basis();
    let dx = Math.sin(P.heading), dz = Math.cos(P.heading);
    if (m.mag > 0.2) { dx = b.fx * m.y + b.rx * m.x; dz = b.fz * m.y + b.rz * m.x; }
    const l = Math.hypot(dx, dz) || 1;
    this.dir.set(dx / l, dz / l);
    P.heading = Math.atan2(this.dir.x, this.dir.y);
    this.hit.clear(); this.speedSet = 0; this.arc = 0; this.snd = 0; this.last.copy(P.pos); this.fx = 0;
    P.setState('tackle');
    P.vel.set(this.dir.x * 2.5, 0, this.dir.y * 2.5);
    G.audio?.storm('tackle');
    G.hud?.callout('ELECTRICAL TACKLE', 'blue');
    G.rig.shake = Math.max(G.rig.shake, 0.3);
    return true;
  }

  // called by the player every frame he is tackling, before he moves: sets his velocity and heading
  drive(P, dt) {
    const G = this.game, t = P.stateT;
    if (t >= TOTAL) { this.end(P); return; }
    const running = t >= DOWN && t < DOWN + RUN;
    // bend the line a little toward where the stick points
    if (t < DOWN + RUN) {
      const m = G.input.move(), b = G.rig.basis();
      if (m.mag > 0.2) {
        const want = Math.atan2(b.fx * m.y + b.rx * m.x, b.fz * m.y + b.rz * m.x), cur = Math.atan2(this.dir.x, this.dir.y);
        const d = clamp(wrapAngle(want - cur), -TURN * dt, TURN * dt);
        this.dir.set(Math.sin(cur + d), Math.cos(cur + d));
      }
    }
    P.heading = dampAngle(P.heading, Math.atan2(this.dir.x, this.dir.y), 12, dt);
    const sp = t < DOWN + RUN ? SPEED * smoothstep(0, DOWN + 0.3, t) : SPEED * (1 - smoothstep(DOWN + RUN, TOTAL, t)) * 0.5;
    // he ran into something that would not give (a tree, a rock): the charge ends there
    const now = Math.hypot(P.vel.x, P.vel.z);
    if (running && t > DOWN + 0.35 && this.speedSet > 6 && now < this.speedSet * 0.4) { this.crash(P); return; }
    this.speedSet = sp;
    P.vel.x = this.dir.x * sp; P.vel.z = this.dir.y * sp;
  }

  crash(P) {
    const G = this.game;
    P.stateT = DOWN + RUN;                      // straight to getting up
    P.vel.set(0, 0, 0); this.speedSet = 0;
    G.rig.shake = 1; G.hitStop = Math.max(G.hitStop, 0.1);
    G.audio?.storm('zap'); G.audio?.sword('slam');
    for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 5; G.particles.emit('zap', P.pos.x, P.pos.y + 0.4, P.pos.z, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 1, 1); }
    G.leaves.singe(P.pos.x + this.dir.x, P.pos.z + this.dir.y, 2.2, 1);
  }
  end(P) { P.setState('ground'); P.vel.multiplyScalar(0.2); this.aura.visible = false; }

  // effects, after he has moved
  update(dt, G) {
    const P = G.player;
    if (P.state !== 'tackle') { this.aura.visible = false; return; }
    const t = P.stateT, running = t >= DOWN * 0.7 && t < DOWN + RUN + 0.15;
    const k = running ? smoothstep(DOWN * 0.7, DOWN + 0.2, t) * (1 - smoothstep(DOWN + RUN, DOWN + RUN + 0.15, t)) : 0;
    const fx = this.dir.x, fz = this.dir.y, px = P.pos.x, pz = P.pos.z, py = P.pos.y;
    // the aura
    const a = this.aura;
    a.visible = k > 0.02;
    a.position.set(px, py + 0.5, pz); a.rotation.set(0, P.heading, 0); a.scale.set(0.5, 0.42, 0.95);
    a.material.uniforms.uK.value = k * (1.0 + 0.5 * Math.sin(G.time * 55));
    if (k <= 0.02) return;
    // arcs round the body and sparks off it
    this.arc -= dt;
    while (this.arc <= 0) {
      this.arc += 0.05;
      const u = Math.random() * 6.28, v = (Math.random() - 0.5) * 1.4;
      _a.set(px + fx * v + Math.cos(u) * 0.3 * fz, py + 0.25 + Math.random() * 0.55, pz + fz * v - Math.cos(u) * 0.3 * fx);
      _b.copy(_a).add(new THREE.Vector3((Math.random() - 0.5) * 1.1, Math.random() * 0.7, (Math.random() - 0.5) * 1.1));
      G.storm.bolt(_a, _b, { life: 0.11, core: 0.012, glow: 0.05, segs: 8, amp: 0.2, branches: 0 });
    }
    for (let n = 0, c = Math.floor(dt * 90 + Math.random()); n < c; n++) G.particles.emit('zap', px - fx * 0.3 + (Math.random() - 0.5) * 0.7, py + 0.2 + Math.random() * 0.7, pz - fz * 0.3 + (Math.random() - 0.5) * 0.7, -fx * 2 + (Math.random() - 0.5) * 3, Math.random() * 2, -fz * 2 + (Math.random() - 0.5) * 3, 0.6, 1);
    this.snd -= dt; if (this.snd <= 0) { this.snd = 0.09; G.audio?.storm('crackle', 1); }
    G.rig.shake = Math.max(G.rig.shake, 0.16 * k);
    // the path: burn every 35 cm he covers (the stamps overlap so the swath has no gaps)
    const dx = px - this.last.x, dz = pz - this.last.z, dist = Math.hypot(dx, dz), steps = Math.min(8, Math.ceil(dist / 0.35));
    for (let i = 1; i <= steps; i++) this.scorch(this.last.x + dx * i / steps, this.last.z + dz * i / steps, fx, fz, k);
    this.last.copy(P.pos);
    // what he runs into
    for (const c of G.enemies?.targets || []) {
      if (c.dead || this.hit.has(c)) continue;
      const ex = c.x - px, ez = c.z - pz, d = Math.hypot(ex, ez);
      if (d > c.r + REACH) continue;
      this.hit.add(c);
      c.onHit?.('tackle', DAMAGE, ex, ez, { zap: true, stun: STUN, knock: KNOCK });
      const cy = groundY(c.x, c.z) + 1.0;
      G.storm.bolt(new THREE.Vector3(px, py + 0.5, pz), new THREE.Vector3(c.x, cy, c.z), { life: 0.2, core: 0.02, glow: 0.08, segs: 12, amp: 0.3, branches: 2 });
      G.leaves.singe(c.x, c.z, 2.4, 1);
      for (let i = 0; i < 24; i++) G.particles.emit('zap', c.x, cy, c.z, (Math.random() - 0.5) * 7, Math.random() * 4, (Math.random() - 0.5) * 7, 1, 1);
      G.audio?.storm('zap'); G.audio?.sword('hit');
      G.rig.shake = Math.max(G.rig.shake, 0.7); G.hitStop = Math.max(G.hitStop, 0.1);
    }
  }

  // one patch of the swath under him
  scorch(x, z, fx, fz, k) {
    const G = this.game, y = groundY(x, z);
    G.leaves.singe(x, z, 1.05, 1);                 // the litter ignites, and the ground under it is blackened (burn map)
    G.cut.stamp(x, z, 0.85, 1);                    // grass and wheat are burnt away
    G.snow.stamp(x, z, 0.75, 0.75, 0, 1, 0.25);    // snow melts to a dark strip
    const pz = G.particles;
    if (Math.random() < 0.8) pz.emit('ember', x + (Math.random() - 0.5) * 0.7, y + 0.1, z + (Math.random() - 0.5) * 0.7, -fx * 0.5, 0.8 + Math.random() * 1.5, -fz * 0.5, 0.6, 1);
    if (Math.random() < 0.5) pz.emit('smoke', x + (Math.random() - 0.5) * 0.8, y + 0.15, z + (Math.random() - 0.5) * 0.8, 0, 0.5 + Math.random(), 0, 0.6, 1);
  }
}
