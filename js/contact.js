// Body hitboxes against the world. While the nomad dives, rolls, flops or gets up, every body
// capsule that touches the ground (or the snow surface) pushes on whatever is there: it flattens
// grass and wheat in the shape of the body, presses snow, shoves and throws leaves in the
// direction the limb is moving, and kicks up dust, powder or chaff. When a roll ends, the body
// unfurls and the feet plant: one bigger impact along the roll's last metre.
// Press H in game to see the hitboxes.
import * as THREE from 'three';
import { groundY, surfaceAt } from './world.js';
import { clamp } from './util.js';

const SAMPLES = [0, 0.5, 1];

export class BodyContact {
  constructor(game) {
    this.game = game;
    this.prev = new Map();        // capsule name + sample -> last world position
    this.after = 0;               // keep hitboxes live for a moment after a roll ends
    this.touching = 0;
    this._s = {};
    this.debug = null;
    this.showing = false;
    addEventListener('keydown', (e) => { if (e.code === 'KeyH' && game.state === 'play') this.toggleDebug(); });
  }

  // height of the surface the body lands on: ground, or what is left of the snow
  surfaceY(x, z) {
    const snow = this.game.snow;
    return groundY(x, z) + (snow ? snow.depthAt(x, z) : 0);
  }

  update(dt, game) {
    const P = game.player, st = P.state;
    const live = st === 'dive' || st === 'roll' || st === 'flop' || st === 'getup' || this.after > 0;
    if (this.after > 0) this.after -= dt;
    this.updateDebug();
    if (!live || dt <= 0) { this.prev.clear(); this.touching = 0; return; }
    const caps = P.model.colliders;
    const p = new THREE.Vector3();
    let budget = 12;
    this.touching = 0;
    for (const c of caps) {
      if (c.name === 'katana' || c.name === 'shoulders') continue;
      for (const t of SAMPLES) {
        if (c.a === c.b && t > 0) break;            // spheres need one sample
        p.lerpVectors(c.a, c.b, t);
        const key = c.name + t;
        const last = this.prev.get(key);
        const vx = last ? (p.x - last.x) / dt : P.vel.x, vy = last ? (p.y - last.y) / dt : P.vel.y, vz = last ? (p.z - last.z) / dt : P.vel.z;
        if (last) last.copy(p); else this.prev.set(key, p.clone());
        const gap = p.y - c.r - this.surfaceY(p.x, p.z);
        if (gap > 0.1 || budget <= 0) continue;
        budget--; this.touching++;
        const speed = Math.hypot(vx, vz), press = clamp((0.1 - gap) / 0.15, 0.3, 1);
        this.hit(p.x, p.z, c.r, vx, vz, speed, -vy, press);
      }
    }
  }

  // one point of the body pressing on the ground with a velocity
  hit(x, z, r, vx, vz, speed, down, press) {
    const G = this.game, s = surfaceAt(x, z, this._s);
    const dir = speed > 0.05 ? [vx / speed, vz / speed] : [Math.sin(G.player.heading), Math.cos(G.player.heading)];
    const force = clamp(speed / 5 + down / 6, 0.2, 1.4);
    // grass and wheat: flattened in the body's shape, laid over in the direction it moved
    G.trample.stamp(x, z, r * 1.8 + 0.18, clamp(0.6 + force * 0.4, 0, 1) * press, dir[0], dir[1], 1);
    // snow: pressed down where the body lies
    G.snow.stamp(x, z, r + 0.07, r + 0.1, Math.atan2(dir[0], dir[1]), press, 1);
    // leaves: shoved along with the limb, the fast ones fly
    if (s.leaves > 0.15) G.leaves.kick(x, z, r + 0.3, 0.5 + force * 0.8, vx * 0.9, vz * 0.9);
    // a little of whatever the ground is made of goes up
    if (Math.random() < 0.25 * force) {
      const pz = G.particles, y = groundY(x, z);
      if (s.snow > 0.4) pz.emit('snow', x, y + G.snow.depthAt(x, z), z, vx * 0.3, 1.2 + force, vz * 0.3, 0.9, 4);
      else if (s.wheat > 0.4) pz.emit('seed', x, y + 0.5, z, vx * 0.2, 0.8, vz * 0.2, 0.8, 3);
      else if (s.path > 0.4) pz.emit(s.puddle > 0.4 ? 'water' : 'dust', x, y + 0.03, z, vx * 0.2, 1.0, vz * 0.2, 0.8, 3);
      else if (s.grass > 0.4) pz.emit('dust', x, y + 0.05, z, vx * 0.15, 0.5, vz * 0.15, 0.6, 1);
    }
  }

  // the roll unfurls and the feet plant: the whole last metre of the roll pushes on the world
  endImpact(pos, heading, speed) {
    const G = this.game, s = surfaceAt(pos.x, pos.z, this._s);
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const v = Math.max(speed, 2.5);
    for (let d = -1.1; d <= 0.8; d += 0.38) {
      const x = pos.x + fx * d, z = pos.z + fz * d;
      G.trample.stamp(x, z, 0.62, 1, fx, fz, 1);
      G.snow.stamp(x, z, 0.3, 0.36, heading, 1, 1);
    }
    // feet: plant hard, grass is pushed out in a ring
    G.trample.stamp(pos.x + fx * 0.45, pos.z + fz * 0.45, 1.05, 1, fx * 0.5, fz * 0.5, 1);
    if (s.leaves > 0.15) {
      // momentum carries forward into litter the roll hasn't touched yet
      G.leaves.burst(pos.x + fx * 0.6, pos.y, pos.z + fz * 0.6, 1.6, 3.3);
      G.leaves.kick(pos.x + fx * 1.0, pos.z + fz * 1.0, 1.15, 1.4, fx * v * 1.8, fz * v * 1.8);
    }
    const pz = G.particles, y = groundY(pos.x, pos.z);
    if (s.snow > 0.4) {
      const top = y + G.snow.depthAt(pos.x, pos.z);
      pz.emit('snow', pos.x, top, pos.z, fx * v * 0.4, 2.2, fz * v * 0.4, 1.8, 50);
      pz.emit('powder', pos.x, top, pos.z, fx, 0.9, fz, 1.6, 12);
    } else if (s.wheat > 0.4) {
      pz.emit('seed', pos.x, y + 0.6, pos.z, fx * v * 0.3, 1.2, fz * v * 0.3, 1.4, 26);
    } else if (s.path > 0.4 && s.puddle > 0.4) {
      pz.emit('water', pos.x, y + 0.02, pos.z, fx * v * 0.3, 2.6, fz * v * 0.3, 2.0, 36);
    } else if (s.leaves < 0.3) {
      pz.emit('dust', pos.x, y + 0.05, pos.z, fx * v * 0.2, 0.8, fz * v * 0.2, 1.5, 14);
    }
    G.audio?.impact(s.snow > 0.4 ? { ...s, kind: 'snow' } : s, 'roll', v + 2);
    G.rig.shake = Math.max(G.rig.shake, 0.22);
    this.after = 0.3;
  }

  // ---------------------------------------------------------------- H: show hitboxes
  toggleDebug() {
    this.showing = !this.showing;
    if (!this.debug) {
      this.debug = new THREE.Group();
      this.mat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, wireframe: true, transparent: true, opacity: 0.55, depthTest: false });
      this.hotMat = new THREE.MeshBasicMaterial({ color: 0xffb14a, wireframe: true, transparent: true, opacity: 0.8, depthTest: false });
      this.debug.renderOrder = 999;
      this.game.scene.add(this.debug);
    }
    this.debug.visible = this.showing;
    this.game.hud?.hint(this.showing ? 'Hitboxes shown (H to hide) · orange = touching the ground' : 'Hitboxes hidden', 2.5);
  }

  updateDebug() {
    if (!this.showing || !this.debug) return;
    const caps = this.game.player.model.colliders;
    while (this.debug.children.length < caps.length) {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 3, 10), this.mat);
      m.renderOrder = 999; m.frustumCulled = false; this.debug.add(m);
    }
    const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
    caps.forEach((c, i) => {
      const m = this.debug.children[i];
      d.subVectors(c.b, c.a);
      const len = d.length();
      m.position.lerpVectors(c.a, c.b, 0.5);
      if (len > 1e-4) m.quaternion.setFromUnitVectors(up, d.normalize()); else m.quaternion.identity();
      // CapsuleGeometry(1, 1): radius 1, straight part 1 -> scale to r and len
      m.scale.set(c.r, (len + 2 * c.r) / 3, c.r);
      const low = Math.min(c.a.y, c.b.y) - c.r - this.surfaceY(m.position.x, m.position.z);
      m.material = low < 0.1 ? this.hotMat : this.mat;
    });
  }
}
