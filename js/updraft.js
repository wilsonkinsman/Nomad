// The Gale Slam: Sky Slam with the wind on him (sword.js calls launch() as he lands). A whirlwind spins up out of
// the landing, and everything within LIFT_R is caught in it and thrown straight up (RISE s), held there turning
// (HOLD s), then the wind turns over and hurls it back down (DROP s): IMPACT damage, a ring of dust, the grass
// flattened, and it is knocked off its feet. The farther out it stood, the later the wind reaches it and the less
// high it goes. Something heavy (the oni: target.heavy) goes about half as high, and not again for HEAVY_COOL s.
// A target carries how high it is off the ground as `lift` (and `spin`, `tilt`, and `air` while it is up), which
// the enemies read to draw themselves and the weapons read to aim at it; while it is up it does nothing else.
// target.onLaunch() and target.onLand() are called, if it has them, as it goes up and as it comes down.
import * as THREE from 'three';
import { groundY, surfaceAt } from './world.js';
import { clamp } from './util.js';
import { Streak } from './gale.js';

export const LIFT_R = 6.5;
const RISE = 0.55, HOLD = 0.4, DROP = 0.16, HEIGHT = 5, IMPACT = 28, HEAVY_COOL = 8, SPREAD = 0.03;
const TAU = Math.PI * 2;
const _p = new THREE.Vector3();

export class Updraft {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pool = [];               // the ribbons of wind wound round each thing in the air
    this.whirls = [];
    // the funnel that spins up out of the landing
    this.funnel = Array.from({ length: 6 }, (_, i) => ({ s: new Streak(game.scene, { max: 34, life: 0.35, width: 0.09, opacity: 0.75, near: [1.5, 4.5] }), ph: i / 6 * TAU }));
    this._s = {};
  }
  ribbon() {
    return this.pool.pop() || new Streak(this.game.scene, { max: 26, life: 0.3, width: 0.06, opacity: 0.8, near: [1.5, 4] });
  }

  // he lands at (x, z) with the wind on him
  launch(x, z) {
    const G = this.game, gy = groundY(x, z);
    this.whirls.push({ x, z, gy, t: 0 });
    for (const f of this.funnel) f.s.clear();
    G.gale?.ring(x, gy, z, LIFT_R * 1.3, 0.55, 0.85);
    G.audio?.wind('lift');
    for (const c of G.enemies?.targets || []) {
      if (c.dead || c.air || (c.liftReady || 0) > G.time) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > LIFT_R + c.r) continue;
      c.air = true; c.lift = 0; c.spin = 0; c.tilt = 0;
      c.liftReady = G.time + (c.heavy ? HEAVY_COOL : 0);
      const H = HEIGHT * (c.heavy ? 0.5 : 1) * (1 - 0.3 * clamp(d / LIFT_R, 0, 1)) * (0.92 + Math.random() * 0.16);
      this.list.push({ c, t: -d * SPREAD, H, turn: Math.random() < 0.5 ? -1 : 1, ph: Math.random() * TAU, ribbons: [this.ribbon(), this.ribbon()], started: false });
    }
  }

  update(dt, G) {
    // the funnel: ribbons spiralling up and out of the landing, and the air thrown up with them
    for (let i = this.whirls.length - 1; i >= 0; i--) {
      const w = this.whirls[i]; w.t += dt;
      if (w.t < 0.75) {
        const u = w.t / 0.75;
        for (const f of this.funnel) {
          const a = f.ph + w.t * 11, r = 0.8 + 3.6 * u;
          f.s.push(_p.set(w.x + Math.cos(a) * r, w.gy + 0.2 + 8 * u * u + 1.5 * u, w.z + Math.sin(a) * r), 1 - u);
        }
        for (let n = 0, c = Math.floor(dt * 120 + Math.random()); n < c; n++) {
          const a = Math.random() * TAU, r = 0.5 + Math.random() * 3.5 * (0.3 + u);
          G.particles.emit('gust', w.x + Math.cos(a) * r, w.gy + 0.2 + Math.random() * 2, w.z + Math.sin(a) * r, -Math.sin(a) * 8, 5 + Math.random() * 6, Math.cos(a) * 8, 0.4, 1);
        }
      } else if (w.t > 1.2) this.whirls.splice(i, 1);
    }
    for (const f of this.funnel) f.s.update(dt, G.camera);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i], c = e.c;
      e.t += dt;
      if (e.t < 0) { for (const r of e.ribbons) r.update(dt, G.camera); continue; }
      if (!e.started) { e.started = true; c.onLaunch?.(); }
      const t = e.t, gy = groundY(c.x, c.z), heavy = c.heavy ? 1.6 : 1;
      let up = 0, spin = 0;
      if (t < RISE) {
        // thrown up, slowing as it goes
        const u = t / RISE; c.lift = e.H * (1 - Math.pow(1 - u, 3)); spin = 9; up = 1;
        c.tilt = 0.35 * u * Math.sin(t * 7 + e.ph);
      } else if (t < RISE + HOLD) {
        // held up there, turning in the wind
        c.lift = e.H + 0.18 * Math.sin((t - RISE) * 9); spin = 6;
        c.tilt = 0.35 * Math.sin(t * 7 + e.ph);
      } else if (t < RISE + HOLD + DROP) {
        // and hurled back down
        const u = (t - RISE - HOLD) / DROP; c.lift = e.H * (1 - u * u); spin = 2; up = -1;
        c.tilt *= 0.8;
      } else { this.land(e, gy); this.list.splice(i, 1); continue; }
      c.spin += dt * spin * e.turn;
      // the wind wound round it: two ribbons circling it, and the air it rides
      const y = gy + c.lift;
      e.ribbons.forEach((r, k) => {
        const a = e.ph + k * Math.PI + t * 13 * e.turn, rr = (0.75 + 0.15 * Math.sin(t * 5 + k)) * heavy;
        r.push(_p.set(c.x + Math.cos(a) * rr, y + (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 6 + k * 2))) * 1.6 * heavy, c.z + Math.sin(a) * rr));
        r.update(dt, G.camera);
      });
      if (Math.random() < dt * 40) {
        const a = Math.random() * TAU;
        G.particles.emit('gust', c.x + Math.cos(a) * 0.6 * heavy, y + (up < 0 ? 2.5 : 0.1) * heavy, c.z + Math.sin(a) * 0.6 * heavy, -Math.sin(a) * 3, up < 0 ? -16 : up > 0 ? 8 : 1, Math.cos(a) * 3, 0.3, 1);
      }
    }
  }

  // it hits the ground
  land(e, gy) {
    const G = this.game, c = e.c, x = c.x, z = c.z, heavy = c.heavy ? 1.5 : 1;
    c.air = false; c.lift = 0; c.tilt = 0;
    for (const r of e.ribbons) { r.clear(); this.pool.push(r); }
    if (!c.dead) c.onHit?.('slam', IMPACT, 0, 0, null);
    c.onLand?.();
    // a crater of dust, the grass flattened round it and torn under it, the leaves and the snow thrown up
    const s = surfaceAt(x, z, this._s), snow = s.snow > 0.4;
    G.cut.stamp(x, z, 0.9 * heavy, 1); G.trample.stamp(x, z, 2.2 * heavy, 1, 0, 0, 1);
    G.leaves.burst?.(x, gy, z, 2.6 * heavy, 4);
    if (snow) { G.snow.stamp(x, z, 0.9 * heavy, 0.9 * heavy, 0, 1, 1); G.particles.emit('snow', x, gy + 0.2, z, 0, 3, 0, 2.5, 50); }
    for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; G.particles.emit(snow ? 'powder' : 'dust', x + Math.cos(a) * 0.4, gy + 0.1, z + Math.sin(a) * 0.4, Math.cos(a) * 6 * heavy, 0.7, Math.sin(a) * 6 * heavy, 1, 1); }
    for (let i = 0; i < 16; i++) { const a = Math.random() * TAU; G.particles.emit('gust', x, gy + 0.3, z, Math.cos(a) * 7, 0.5 + Math.random(), Math.sin(a) * 7, 0.4, 1); }
    G.gale?.ring(x, gy, z, 3.2 * heavy, 0.45, 0.6);
    const cd = G.camera.position.distanceTo(_p.set(x, gy, z));
    G.rig.shake = Math.max(G.rig.shake, clamp(1 - cd / 30, 0.15, 0.8));
    if (cd < 14) G.hitStop = Math.max(G.hitStop, 0.05);
    G.audio?.wind('drop', clamp(1.2 - cd / 50, 0.3, 1));
  }
}
