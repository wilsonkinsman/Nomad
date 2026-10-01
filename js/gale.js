// The Wind path.
//   Wind Call (V): he holds the blade out level and turns once on the spot. The air follows the blade round into
//     a whirl (the grass swept flat in a spiral, leaves and dust drawn in, streaks of wind racing round him), and
//     as he brings the blade up the whirl settles on him with a burst that lays the field flat in a ring. For
//     DURATION seconds he is light on his feet (he runs SPEED_UP faster and jumps JUMP_UP higher), a few streaks
//     of wind drift round him, and the crow will come when he calls it. COOLDOWN seconds after it fades before it
//     can be called again. The sword (the 'gale' move in sword.js) drives the spin; this file keeps the charge
//     and draws the wind.
//   Wind Crow (Z, while the wind is with him): see crowflight.js. The flight burns the charge.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, lerp, damp, smoothstep } from './util.js';

export const DURATION = 45, COOLDOWN = 10;
export const SPEED_UP = 1.12, JUMP_UP = 1.2;
const _t = new THREE.Vector3(), _e = new THREE.Vector3(), _s = new THREE.Vector3();

// A streak of wind: a thin ribbon through the last few places a point has been, turned to face the camera, soft at
// its edges and fading toward its tail (and, if `near` is given, as it comes within near[1] metres of the camera,
// so a ribbon streaming back past the lens does not fill the screen). Push a point every frame; stop pushing and
// it drains away.
export class Streak {
  constructor(scene, { max = 32, life = 0.4, width = 0.03, color = 0xeaf8ff, opacity = 0.5, near = null } = {}) {
    this.max = max; this.life = life; this.width = width;
    this.pts = [];                 // { p, age, a }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.al = new THREE.BufferAttribute(new Float32Array(max * 2), 1).setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(max * 2); for (let i = 0; i < max; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
    g.setAttribute('position', this.pos); g.setAttribute('alpha', this.al); g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    const idx = []; for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx); g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOp: { value: opacity }, uNear: { value: new THREE.Vector2(...(near || [-2, -1])) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute float alpha, side; varying float vA, vS, vD;
        void main() { vA = alpha; vS = side; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOp; uniform vec2 uNear; varying float vA, vS, vD;
        void main() { float a = vA * uOp * (1.0 - vS * vS) * smoothstep(uNear.x, uNear.y, vD); gl_FragColor = vec4(uColor * a, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 12;
    scene.add(this.mesh);
  }
  // a new head for the ribbon; a (0..1) dims it
  push(p, a = 1) {
    const last = this.pts[this.pts.length - 1];
    if (last && last.p.distanceToSquared(p) > 64) this.pts.length = 0;       // it jumped: start again
    const s = this.pts.length >= this.max ? this.pts.shift() : { p: new THREE.Vector3() };
    s.p.copy(p); s.age = 0; s.a = a;
    this.pts.push(s);
  }
  clear() { this.pts.length = 0; this.mesh.geometry.setDrawRange(0, 0); }
  update(dt, camera) {
    for (const s of this.pts) s.age += dt;
    while (this.pts.length && this.pts[0].age > this.life) this.pts.shift();
    const n = this.pts.length;
    if (n < 2) { this.mesh.geometry.setDrawRange(0, 0); return; }
    const P = this.pos.array, A = this.al.array, cam = camera.position;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i].p, f = 1 - this.pts[i].age / this.life, u = i / (n - 1);
      _t.subVectors(this.pts[Math.min(n - 1, i + 1)].p, this.pts[Math.max(0, i - 1)].p);
      _e.subVectors(cam, p);
      _s.crossVectors(_t, _e);
      const l = _s.length();
      if (l > 1e-6) _s.multiplyScalar(this.width * Math.sin(Math.PI * (0.05 + 0.5 * u)) / l); else _s.set(0, 0, 0);     // thin at the tail
      P[i * 6] = p.x - _s.x; P[i * 6 + 1] = p.y - _s.y; P[i * 6 + 2] = p.z - _s.z;
      P[i * 6 + 3] = p.x + _s.x; P[i * 6 + 4] = p.y + _s.y; P[i * 6 + 5] = p.z + _s.z;
      A[i * 2] = A[i * 2 + 1] = f * f * this.pts[i].a;
    }
    this.pos.needsUpdate = this.al.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6);
  }
}

export class Gale {
  constructor(game) {
    this.game = game;
    this.charge = 0; this.cool = 0; this.gather = 0; this.want = 0; this.k = 0;
    this.fillEl = document.getElementById('wind-fill'); this.barEl = document.getElementById('wind');
    // streaks of wind circling him: all five race round in a tightening whirl while it gathers, three drift
    // round him lazily while it lasts
    this.orbit = [0, 1, 2, 3, 4].map((i) => ({ s: new Streak(game.scene, { max: 30, life: 0.42, width: 0.035, opacity: 0.6 }), a: i / 5 * Math.PI * 2, ph: i * 1.7, p: new THREE.Vector3() }));
    this.rings = [];
    this.swirlT = 0; this.sndT = 0;
    this.ringGeo = new THREE.RingGeometry(0.93, 1.0, 64).rotateX(-Math.PI / 2);
  }
  get active() { return this.charge > 0; }

  // can it be called now? (the sword checks before the move starts)
  ready(G) {
    if (this.active) { G.hud?.hint('The wind is already with you', 1.5); return false; }
    if (this.cool > 0) { G.hud?.hint('The air is still: ' + Math.ceil(this.cool) + ' s', 1.5); return false; }
    return true;
  }
  setGather(k) { this.want = Math.max(this.want, k); }
  // the flight burns the charge; true while there is any left
  spend(s) { if (this.charge > 0) this.charge = Math.max(1e-4, this.charge - s); return this.charge > 1e-3; }

  // the whirl settles on him (called by the sword as the blade comes up)
  call(tip, P) {
    const G = this.game, x = P.pos.x, z = P.pos.z, y = P.pos.y;
    this.charge = DURATION;
    G.rig.shake = Math.max(G.rig.shake, 0.7); G.hitStop = Math.max(G.hitStop, 0.08);
    G.audio?.wind('call');
    G.hud?.callout('WIND-CHARGED', 'wind');
    // the field is laid flat outward in a ring, swirled the way the wind went round
    for (let a = 0; a < 6.28; a += 0.3) {
      const cx = Math.cos(a), cz = Math.sin(a);
      for (const r of [1.3, 2.5, 3.7, 4.9]) G.trample.stamp(x + cx * r, z + cz * r, 1.1, 0.95, cx * 0.7 - cz * 0.7, cz * 0.7 + cx * 0.7, 0.8);
    }
    G.leaves.burst?.(x, y, z, 5.5, 5);
    const pz = G.particles, snow = (P.surface?.snow || 0) > 0.4;
    for (let i = 0; i < 80; i++) {
      const a = i / 80 * 6.28, s = 6 + Math.random() * 6, cx = Math.cos(a), cz = Math.sin(a);
      pz.emit('gust', x + cx * 0.6, y + 0.2 + Math.random() * 1.4, z + cz * 0.6, cx * s - cz * 3, 0.6 + Math.random() * 1.5, cz * s + cx * 3, 0.5, 1);
    }
    for (let i = 0; i < 36; i++) { const a = i / 36 * 6.28; pz.emit(snow ? 'powder' : 'dust', x + Math.cos(a) * 0.8, y + 0.1, z + Math.sin(a) * 0.8, Math.cos(a) * 6, 0.7, Math.sin(a) * 6, 1, 1); }
    // and a plume of it straight up off the blade
    for (let i = 0; i < 24; i++) pz.emit('gust', tip.x, tip.y, tip.z, (Math.random() - 0.5) * 2, 4 + Math.random() * 5, (Math.random() - 0.5) * 2, 0.4, 1);
    this.ring(x, y, z, 6.5, 0.6);
  }

  // a pale ring racing out over the ground from (x, z), R metres across, for `life` seconds
  ring(x, y, z, R, life, op = 0.7) {
    const mats = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0xe6f7ff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0 }));
    const meshes = mats.map((m) => { const o = new THREE.Mesh(this.ringGeo, m); o.renderOrder = 13; o.frustumCulled = false; o.position.set(x, groundY(x, z) + 0.08, z); this.game.scene.add(o); return o; });
    this.rings.push({ meshes, mats, R, life, op, t: 0 });
  }

  update(dt, game) {
    const P = game.player, t = game.time;
    game.input.windOn = this.charge > 0;
    if (this.charge > 0) {
      this.charge -= dt;
      if (this.charge <= 0) { this.charge = 0; this.cool = COOLDOWN; game.audio?.wind('fade'); game.hud?.hint('The wind drops away', 2.5); }
    } else if (this.cool > 0) {
      this.cool -= dt;
      if (this.cool <= 0) { this.cool = 0; game.hud?.hint('The wind is ready to answer again (V)', 2.5); }
    }
    const fill = (this.charge > 0 ? this.charge / DURATION : this.cool > 0 ? 1 - this.cool / COOLDOWN : 0) * 100;
    const fs = fill.toFixed(1) + '%';
    if (fs !== this._fill) { this._fill = fs; this.fillEl.style.width = fs; }
    this.barEl.classList.toggle('on', this.charge > 0 || this.cool > 0);
    this.barEl.classList.toggle('cool', this.cool > 0);

    this.gather = damp(this.gather, this.want, this.want > this.gather ? 6 : 10, dt); this.want = 0;
    this.k = damp(this.k, this.charge > 0 ? 1 : 0, 3, dt);
    const g = this.gather, hs = (P.model.camHeight ?? 1.48) / 1.48, flying = P.state === 'crow';
    // the streaks round him (not while the crow has him: they would be strung out behind for metres)
    this.orbit.forEach((o, i) => {
      const on = flying ? 0 : Math.max(g, i < 3 ? this.k * 0.7 : 0);
      if (on > 0.02) {
        o.a += dt * (2.0 + 9 * g) * (i % 2 ? 1 : 1.2);
        const r = lerp(0.8 + 0.15 * Math.sin(t * 1.3 + o.ph), 2.8 - 1.7 * smoothstep(0, 1, g), g) * hs;
        const h = (0.2 + 1.2 * (0.5 + 0.5 * Math.sin(t * (0.8 + i * 0.27) + o.ph))) * hs;
        o.p.set(P.pos.x + Math.cos(o.a) * r, P.pos.y + h, P.pos.z + Math.sin(o.a) * r);
        o.s.push(o.p, on);
      }
      o.s.update(dt, game.camera);
    });
    if (g > 0.02) this.whirl(dt, game, P, g);
    else if (this.k > 0.5 && !flying && Math.random() < dt * 2.5) {
      // now and then a breath of it lifts round his feet
      const a = Math.random() * 6.28;
      game.particles.emit('gust', P.pos.x + Math.cos(a) * 0.5, P.pos.y + 0.2, P.pos.z + Math.sin(a) * 0.5, -Math.sin(a) * 2, 0.8, Math.cos(a) * 2, 0.3, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      const u = r.t / r.life;
      r.meshes.forEach((m, k) => {
        const uu = clamp(u - k * 0.15, 0, 1), s = 0.3 + r.R * (1 - Math.pow(1 - uu, 3));
        m.scale.set(s, 1, s); r.mats[k].opacity = (1 - uu) * r.op * (k ? 0.5 : 1);
      });
      if (u >= 1.3) { for (const m of r.meshes) this.game.scene.remove(m); for (const m of r.mats) m.dispose(); this.rings.splice(i, 1); }
    }
  }

  // while it gathers: the grass swept round in a spiral, leaves and dust drawn into the whirl, and a rising roar
  whirl(dt, game, P, g) {
    const pz = game.particles, x = P.pos.x, z = P.pos.z, y = P.pos.y;
    for (let n = 0, c = Math.floor(dt * 90 * g + Math.random()); n < c; n++) {
      const a = Math.random() * 6.28, r = 1.2 + Math.random() * 2.2, cx = Math.cos(a), cz = Math.sin(a);
      pz.emit('gust', x + cx * r, y + 0.1 + Math.random() * 1.6, z + cz * r, -cz * 7 - cx * 2.5, 0.4 + Math.random(), cx * 7 - cz * 2.5, 0.3, 1);
    }
    this.swirlT -= dt;
    if (this.swirlT <= 0) {
      this.swirlT = 0.07;
      const a = Math.random() * 6.28, r = 1 + Math.random() * 2.5, cx = Math.cos(a), cz = Math.sin(a);
      game.trample.stamp(x + cx * r, z + cz * r, 0.9, 0.6 * g, -cz, cx, 0.5);
      game.leaves.kick?.(x + cx * r, z + cz * r, 1.4, 1.2 * g, -cz * 6 - cx * 2, cx * 6 - cz * 2);
      if ((P.surface?.snow || 0) > 0.4) pz.emit('powder', x + cx * r, y + 0.1, z + cz * r, -cz * 5, 1.2, cx * 5, 0.8, 2);
      else if (Math.random() < 0.5) pz.emit('dust', x + cx * r, y + 0.05, z + cz * r, -cz * 5, 0.6, cx * 5, 0.6, 2);
    }
    game.rig.shake = Math.max(game.rig.shake, 0.1 * g);
  }
}
