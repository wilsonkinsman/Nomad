// Thunder Arrow (a skill under Storm Call): with the storm on his blade and the bow at full draw, keep holding
// and the arrow takes the storm. The camera pulls far back, he leans back into the draw, the sky darkens, arcs
// crawl over the bow and the arrowhead swells blue. Let go at full supercharge and a great arrow of lightning
// tears away low along the ground for RANGE metres: it carves a wide burnt trench (the grass gone, the leaves
// burnt, the ground blackened, the field thrown flat to both sides), runs through everything in its way (hurt,
// stunned, thrown aside, Earth Walls broken) and leaves bolts crackling along the path. It spends the storm.
// The bow (bow.js) builds the charge and calls fire(); this file draws the shot and carves the path.
import * as THREE from 'three';
import { groundY, PLAY_RADIUS } from './world.js';
import { STUN } from './storm.js';

export const SUPER_TIME = 1.1;
const RANGE = 62, SPEED = 115, HEIGHT = 0.9, WIDTH = 1.9, DAMAGE = 85, KNOCK = 3;

// the arrow as in the picture: a long shaft and a broad swept head, flat, in the plane that faces up
function arrowShape() {
  const s = new THREE.Shape();
  // +y is forward; the head is a wide chevron with barbs, the shaft runs back from it
  s.moveTo(0, 0);
  s.lineTo(-0.95, -1.15); s.lineTo(-0.55, -1.05); s.lineTo(-0.75, -1.5);
  s.lineTo(-0.1, -0.85); s.lineTo(-0.07, -4.8); s.lineTo(-0.38, -5.5); s.lineTo(-0.1, -5.25); s.lineTo(0, -5.6);
  s.lineTo(0.1, -5.25); s.lineTo(0.38, -5.5); s.lineTo(0.07, -4.8); s.lineTo(0.1, -0.85);
  s.lineTo(0.75, -1.5); s.lineTo(0.55, -1.05); s.lineTo(0.95, -1.15); s.lineTo(0, 0);
  return s;
}

export class ThunderArrows {
  constructor(game) {
    this.game = game;
    this.shots = [];
    const g = new THREE.ShapeGeometry(arrowShape());
    g.rotateX(-Math.PI / 2);                // lie flat: shape +y becomes world -z
    g.rotateY(Math.PI);                     // and point it along +z
    this.geo = g;
    this.glowGeo = g.clone().scale(1.5, 1, 1.12);
  }

  // let it go: from `start`, heading `dir` (flattened onto the ground)
  fire(start, dir) {
    const G = this.game, P = G.player;
    const d = new THREE.Vector2(dir.x, dir.z); if (d.lengthSq() < 1e-6) d.set(Math.sin(P.heading), Math.cos(P.heading)); d.normalize();
    const group = new THREE.Group();
    const core = new THREE.MeshBasicMaterial({ color: 0xe8f3ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const glow = new THREE.MeshBasicMaterial({ color: 0x2f6dff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    // two crossed planes of each, so it reads from the side as well as from above
    for (const rz of [0, Math.PI / 2]) {
      const a = new THREE.Mesh(this.glowGeo, glow), b = new THREE.Mesh(this.geo, core);
      a.rotation.z = rz; b.rotation.z = rz; b.scale.setScalar(0.92);
      for (const m of [a, b]) { m.frustumCulled = false; m.renderOrder = 16; group.add(m); }
    }
    group.scale.setScalar(1.4);
    G.scene.add(group);
    const shot = { group, core, glow, x: start.x, z: start.z, y: start.y, d, dist: 0, t: 0, hit: new Set(), path: [], done: false, fade: 0, arc: 0 };
    this.shots.push(shot);
    // the release: the sky flashes, the world shakes, he is thrown back by it
    const S = G.storm;
    S.flashEl.classList.remove('on'); void S.flashEl.offsetWidth; S.flashEl.classList.add('on');
    G.audio?.thunder(); G.audio?.storm('dash');
    G.rig.shake = 1; G.hitStop = Math.max(G.hitStop, 0.16);
    P.vel.x -= d.x * 7; P.vel.z -= d.y * 7;
    S.bolt(new THREE.Vector3(start.x, start.y, start.z), new THREE.Vector3(start.x + d.x * 6, groundY(start.x + d.x * 6, start.z + d.y * 6) + HEIGHT, start.z + d.y * 6), { life: 0.3, core: 0.05, glow: 0.3, segs: 20, amp: 0.5, branches: 3 });
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 8; G.particles.emit('zap', start.x, start.y, start.z, Math.cos(a) * s + d.x * 6, (Math.random() - 0.3) * 5, Math.sin(a) * s + d.y * 6, 1, 1); }
    // spends the storm
    if (S.charge > 0) { S.charge = 0.001; }
    G.hud?.callout('THUNDER ARROW', 'blue');
  }

  update(dt) {
    const G = this.game;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.t += dt;
      if (!s.done) this.fly(s, dt);
      else {
        // the shot is gone; its path keeps crackling and smoking for a while
        s.fade += dt;
        const k = Math.max(0, 1 - s.fade / 0.3);
        s.core.opacity = k; s.glow.opacity = 0.75 * k; s.group.scale.setScalar(1.4 * (1 + s.fade * 2));
        if (s.fade < 2.2) {
          for (let n = 0; n < 4; n++) {
            const p = s.path[(Math.random() * s.path.length) | 0]; if (!p) break;
            const ox = (Math.random() - 0.5) * WIDTH * 1.4, oz = (Math.random() - 0.5) * WIDTH * 1.4;
            G.particles.emit(Math.random() < 0.6 ? 'ember' : 'smoke', p.x + ox, groundY(p.x + ox, p.z + oz) + 0.1, p.z + oz, 0, 0.6 + Math.random(), 0, 0.4, 1);
          }
          s.arc -= dt;
          if (s.arc <= 0 && s.path.length > 2 && s.fade < 1.4) {
            s.arc = 0.06;
            const j = (Math.random() * (s.path.length - 1)) | 0, a = s.path[j], b = s.path[Math.min(s.path.length - 1, j + 2)];
            G.storm.bolt(new THREE.Vector3(a.x, groundY(a.x, a.z) + 0.3, a.z), new THREE.Vector3(b.x, groundY(b.x, b.z) + 0.3 + Math.random() * 0.6, b.z), { life: 0.12, core: 0.015, glow: 0.07, segs: 10, amp: 0.4, branches: 1 });
          }
        }
        if (s.fade > 2.4) { G.scene.remove(s.group); s.core.dispose(); s.glow.dispose(); this.shots.splice(i, 1); }
      }
    }
  }

  fly(s, dt) {
    const G = this.game, step = Math.min(SPEED * dt, RANGE - s.dist), n = Math.max(1, Math.ceil(step / 0.5));
    for (let k = 1; k <= n; k++) {
      const x = s.x + s.d.x * step * k / n, z = s.z + s.d.y * step * k / n;
      if (Math.hypot(x, z) > PLAY_RADIUS) { s.dist = RANGE; break; }
      this.carve(s, x, z);
    }
    s.x += s.d.x * step; s.z += s.d.y * step; s.dist += step;
    // it settles down to skim the ground and follows it
    const gy = groundY(s.x, s.z);
    s.y += (gy + HEIGHT - s.y) * Math.min(1, dt * 10);
    const g = s.group;
    g.position.set(s.x, s.y, s.z); g.rotation.set(0, Math.atan2(s.d.x, s.d.y), 0);
    g.children.forEach((m, j) => { m.rotation.y = Math.sin(s.t * 60 + j) * 0.02; });      // it shivers
    s.core.opacity = 0.85 + 0.15 * Math.sin(s.t * 70); s.glow.opacity = 0.6 + 0.2 * Math.sin(s.t * 47);
    // lightning wrapped round it and trailing behind
    const tip = new THREE.Vector3(s.x + s.d.x * 0.5, s.y, s.z + s.d.y * 0.5), tail = new THREE.Vector3(s.x - s.d.x * 7, s.y + 0.1, s.z - s.d.y * 7);
    G.storm.bolt(tail, tip, { life: 0.06, core: 0.03, glow: 0.18, segs: 16, amp: 0.45, branches: 2 });
    for (let j = 0; j < 8; j++) G.particles.emit('zap', s.x - s.d.x * Math.random() * 5, s.y + (Math.random() - 0.5) * 0.8, s.z - s.d.y * Math.random() * 5, (Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6, 0.6, 1);
    G.rig.shake = Math.max(G.rig.shake, 0.35);
    if (s.dist >= RANGE - 1e-3) this.end(s);
  }

  // one stretch of the trench, and whatever is standing in it
  carve(s, x, z) {
    const G = this.game, gy = groundY(x, z), last = s.path[s.path.length - 1];
    if (!last || Math.hypot(x - last.x, z - last.z) > 0.6) {
      s.path.push({ x, z });
      G.cut.stamp(x, z, WIDTH, 1);
      G.burn.stamp(x, z, WIDTH * 0.8, 1);
      G.trample.stamp(x, z, WIDTH * 2.4, 1, 0, 0, 1);        // the field is thrown flat to both sides
      G.leaves.singe(x, z, WIDTH * 1.1, 1);
      G.leaves.kick?.(x, z, WIDTH * 1.8, 2, s.d.x * 6, s.d.y * 6);
      G.snow.stamp(x, z, WIDTH, WIDTH, 0, 1, 0.6);
      if (Math.random() < 0.7) G.particles.emit('dust', x, gy + 0.1, z, s.d.x * 4, 2.5, s.d.y * 4, 1.4, 3);
      if (Math.random() < 0.5) G.particles.emit('clip', x, gy + 0.2, z, (Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6, 1.2, 2);
    }
    for (const c of G.enemies?.targets || []) {
      if (c.dead || c.high || s.hit.has(c)) continue;
      const ex = c.x - x, ez = c.z - z;
      if (Math.hypot(ex, ez) > c.r + WIDTH) continue;
      s.hit.add(c);
      // thrown aside, off the line, and along it
      const side = ex * -s.d.y + ez * s.d.x >= 0 ? 1 : -1;
      c.onHit?.('thunder', DAMAGE, -s.d.y * side + s.d.x * 0.7, s.d.x * side + s.d.y * 0.7, { zap: true, stun: STUN * 1.5, knock: KNOCK });
      const cy = groundY(c.x, c.z) + 1;
      for (let i = 0; i < 30; i++) G.particles.emit('zap', c.x, cy, c.z, (Math.random() - 0.5) * 9, Math.random() * 5, (Math.random() - 0.5) * 9, 1, 1);
      G.storm.bolt(new THREE.Vector3(c.x, cy + 6, c.z), new THREE.Vector3(c.x, cy, c.z), { life: 0.25, core: 0.03, glow: 0.15, segs: 16, amp: 0.6, branches: 2 });
      G.audio?.storm('zap'); G.audio?.sword('hit');
      G.hitStop = Math.max(G.hitStop, 0.1);
    }
    // Earth Walls break before it
    for (const w of G.earth?.walls || []) {
      if (!w.up || w.falling) continue;
      if (w.circles.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + WIDTH * 0.6)) { w.jolt(x, gy + 1, z); w.fall(); G.audio?.sword('slam'); }
    }
  }

  end(s) {
    const G = this.game;
    s.done = true;
    const gy = groundY(s.x, s.z);
    // it bursts at the end of its run
    G.burn.stamp(s.x, s.z, WIDTH * 1.6, 1); G.cut.stamp(s.x, s.z, WIDTH * 1.8, 1); G.leaves.singe(s.x, s.z, WIDTH * 2, 1);
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, v = 3 + Math.random() * 7; G.particles.emit('zap', s.x, gy + 0.6, s.z, Math.cos(a) * v, 1 + Math.random() * 4, Math.sin(a) * v, 1, 1); }
    G.particles.emit('dust', s.x, gy + 0.2, s.z, 0, 2, 0, 2, 30);
    G.storm.bolt(new THREE.Vector3(s.x, gy + 40, s.z), new THREE.Vector3(s.x, gy, s.z), { life: 0.4, core: 0.04, glow: 0.25, segs: 30, amp: 2, branches: 3 });
    G.storm.scorch(s.x, s.z);
    G.audio?.thunder();
  }
}
