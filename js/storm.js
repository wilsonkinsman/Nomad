// Storm Call (a skill under Sky Slam). R: he holds the sword straight up, the sky gathers (the screen darkens,
// the blade crackles), and at the top of the cast lightning comes down onto the tip. It burns the leaves
// around him and charges the sword for DURATION seconds: while it lasts every blow does half again as much,
// STUNS whatever it hits (the practice enemy stops dead for a couple of seconds) and arcs a little bolt to it,
// and the blade throws sparks. The weapon (sword.js) drives the cast; this file draws the lightning and keeps
// the charge.
import * as THREE from 'three';
import { groundY } from './world.js';
import { damp } from './util.js';

export const DURATION = 22, STUN = 2.2;
const _a = new THREE.Vector3(), _t = new THREE.Vector3(), _e = new THREE.Vector3(), _s = new THREE.Vector3();

// a jagged line from `a` to `b`: midpoint displacement, wild in the middle and pinned at the ends
function jagged(a, b, segs, amp, rnd = Math.random) {
  let pts = [a.clone(), b.clone()];
  const axis = new THREE.Vector3().subVectors(b, a).normalize();
  const side = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(axis, side);
  let a0 = amp;
  while (pts.length < segs + 1) {
    const next = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().lerp(pts[i + 1], 0.5);
      m.addScaledVector(side, (rnd() - 0.5) * 2 * a0).addScaledVector(up, (rnd() - 0.5) * 2 * a0);
      next.push(pts[i], m);
    }
    next.push(pts[pts.length - 1]); pts = next; a0 *= 0.55;
  }
  return pts;
}

export class Storm {
  constructor(game) {
    this.game = game;
    this.charge = 0; this.gather = 0; this.want = 0;
    this.bolts = []; this.scorches = [];
    this.dimEl = document.getElementById('storm-dim'); this.flashEl = document.getElementById('storm-flash'); this.fillEl = document.getElementById('storm-fill'); this.barEl = document.getElementById('storm');
    this.spark = 0; this.arcT = 0;
  }
  get charged() { return this.charge > 0; }
  setGather(k) { this.want = Math.max(this.want, k); }

  // a bolt: a bright core and a wide soft glow, flickering for a moment. Each is a ribbon turned to face the
  // camera as it is made (a bolt is gone in half a second), widened with distance so the far end of an
  // 80 m strike is still a few pixels across.
  bolt(a, b, { life = 0.5, core = 0.03, glow = 0.18, segs = 40, amp = 3, branches = 3 } = {}) {
    const G = this.game, group = new THREE.Group(), cam = G.camera.position;
    const mk = (pts, w, color, op) => {
      const n = pts.length, pos = new Float32Array(n * 6), idx = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        _t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
        _e.subVectors(cam, p); const d = _e.length(); _e.divideScalar(d || 1);
        _s.crossVectors(_t, _e).normalize().multiplyScalar(w * (1 + d * 0.05));
        pos.set([p.x - _s.x, p.y - _s.y, p.z - _s.z, p.x + _s.x, p.y + _s.y, p.z + _s.z], i * 6);
        if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.frustumCulled = false; m.renderOrder = 15; m.userData.op = op; group.add(m); return m;
    };
    const main = jagged(a, b, segs, amp);
    mk(main, glow, 0x5a8cff, 0.32); mk(main, core, 0xf2f8ff, 1);
    for (let i = 0; i < branches; i++) {
      const at = main[Math.floor((0.2 + Math.random() * 0.6) * main.length)];
      const end = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * amp * 5, -amp * (2 + Math.random() * 3), (Math.random() - 0.5) * amp * 5));
      mk(jagged(at, end, 12, amp * 0.4), core * 0.5, 0xdbe8ff, 0.8);
    }
    G.scene.add(group);
    this.bolts.push({ group, t: 0, life });
  }
  // a short arc, blade to a target
  zap(from, to) { this.bolt(from, to, { life: 0.2, core: 0.012, glow: 0.05, segs: 10, amp: 0.18, branches: 1 }); }

  // the lightning arrives at the tip of the blade
  strike(tip, P) {
    const G = this.game, top = tip.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 80, (Math.random() - 0.5) * 6));
    this.bolt(top, tip, { life: 0.55, core: 0.035, glow: 0.2, segs: 48, amp: 4, branches: 4 });
    // the whole sky flashes, the world shakes, the ground is scorched
    this.flashEl.classList.remove('on'); void this.flashEl.offsetWidth; this.flashEl.classList.add('on');
    G.rig.shake = 1; G.hitStop = Math.max(G.hitStop, 0.14);
    G.audio?.thunder();
    const px = P.pos.x, pz = P.pos.z, py = P.pos.y, pz2 = G.particles;
    G.leaves.singe(px, pz, 6, 1);                                     // the litter round him burns, and the ground under it is blackened
    G.cut.stamp(px, pz, 1.7, 1);                                      // the grass underfoot is scorched down too
    for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 6; pz2.emit('zap', px, py + 0.3, pz, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 1, 1); }
    for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28, r = Math.random() * 3; pz2.emit(i % 3 ? 'smoke' : 'ember', px + Math.cos(a) * r, py + 0.1, pz + Math.sin(a) * r, 0, 1 + Math.random() * 2, 0, 0.8, 1); }
    this.scorch(px, pz);
    this.charge = DURATION;
    G.hud?.callout('STORM-CHARGED', 'blue');
  }
  // a dark mark on the ground that fades away over a while
  scorch(x, z) {
    if (!this.scorchTex) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(0,0,0,0.85)'); r.addColorStop(0.5, 'rgba(8,6,4,0.55)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3;
      for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28 + Math.random() * 0.4; g.beginPath(); g.moveTo(64, 64); let px = 64, py = 64; for (let s = 0; s < 4; s++) { px += Math.cos(a + (Math.random() - 0.5) * 0.7) * 14; py += Math.sin(a + (Math.random() - 0.5) * 0.7) * 14; g.lineTo(px, py); } g.stroke(); }
      this.scorchTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true }));
    m.position.set(x, groundY(x, z) + 0.04, z); m.renderOrder = 2; this.game.scene.add(m);
    this.scorches.push({ m, t: 0 });
  }

  update(dt, game) {
    this.gather = damp(this.gather, this.want, this.want > this.gather ? 3 : 9, dt); this.want = 0;
    const dim = (this.gather * 0.8).toFixed(2);
    if (dim !== this._dim) { this._dim = dim; this.dimEl.style.opacity = dim; }
    // the charge on the sword
    const P = game.player, rig = P.weapon && P.weapon.rig;
    if (this.charge > 0) {
      this.charge -= dt;
      if (this.charge <= 0) { this.charge = 0; game.audio?.storm('fizzle'); game.hud?.hint('The storm fades from the blade', 2.5); }
    }
    const fade = this.charge > 0 ? Math.min(1, this.charge / 1.5) : 0;
    const fill = (this.charge / DURATION * 100).toFixed(1) + '%';
    if (fill !== this._fill) { this._fill = fill; this.fillEl.style.width = fill; }
    this.barEl.classList.toggle('on', this.charge > 0);
    if (rig) {
      rig.chargeK = Math.max(fade, this.gather * 0.7);
      if (rig.drawn && rig.chargeK > 0.05) {
        // sparks along the blade, and now and then a little arc off it
        this.spark += dt * (60 * rig.chargeK);
        while (this.spark >= 1) { this.spark -= 1; const p = rig.point(Math.random(), _a); game.particles.emit('zap', p.x, p.y, p.z, (Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5, 0.8, 1); }
        this.arcT -= dt;
        if (this.arcT <= 0 && rig.chargeK > 0.4) {
          this.arcT = 0.12 + Math.random() * 0.3;
          const a = rig.point(0.3 + Math.random() * 0.7, new THREE.Vector3()), b = a.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.3) * 0.7, (Math.random() - 0.5) * 0.9));
          this.bolt(a, b, { life: 0.1, core: 0.008, glow: 0.03, segs: 6, amp: 0.1, branches: 0 });
        }
        if (this.gather < 0.05 && Math.random() < dt * 4) game.audio?.storm('crackle', rig.chargeK * 0.6);
      }
    }
    // bolts flicker and go
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.t += dt;
      const u = b.t / b.life;
      if (u >= 1) { this.game.scene.remove(b.group); b.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); this.bolts.splice(i, 1); continue; }
      const flick = u < 0.12 ? 1 : u < 0.2 ? 0.25 : u < 0.34 ? 0.95 : 1 - (u - 0.34) / 0.66;
      for (const m of b.group.children) m.material.opacity = m.userData.op * flick;
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i]; s.t += dt;
      s.m.material.opacity = Math.max(0, 1 - s.t / 28);
      if (s.t > 28) { this.game.scene.remove(s.m); s.m.material.dispose(); s.m.geometry.dispose(); this.scorches.splice(i, 1); }
    }
  }
}
