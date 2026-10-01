// The Earth path.
//   Earth Power (G): he drives the blade into the ground (the 'quake' move in sword.js); the ground cracks in a ring,
//     rocks burst up, and stones rise to circle him. For DURATION seconds he takes half damage, his blows throw
//     things back, and Sky Slam raises a cage of stone. COOLDOWN seconds after it fades before it can be called again.
//   Earth Wall (Q, while Earth Power is on): a wall of rock tears up out of the ground in front of him. Arrows
//     shatter on it, nothing walks through it, a dash stops at it, and the Electrical Tackle driven into it leaves
//     him stunned on the ground.
//   The cage: Sky Slam under Earth Power raises a ring of walls round the landing, wide enough to take in whoever
//     is near, for CAGE seconds.
// Walls stand in the world as rows of circles (Wall.circles), the same shape as tree and rock colliders, so the
// player, the dashes and the practice enemy all stop at them.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, smoothstep } from './util.js';
import { mergeVertices } from '../lib/utils/BufferGeometryUtils.js';

export const DURATION = 40, COOLDOWN = 10, CAGE = 6, WALL_LIFE = 10;
const MAX_WALLS = 3, RISE = 0.28, FALL = 0.55;

const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// a lumpy stone: an icosahedron pushed in and out
function stoneGeometry(r, seed) {
  let g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + 0.45 * hash(p.getX(i) + seed, p.getY(i), p.getZ(i));
    p.setXYZ(i, p.getX(i) * r * k, p.getY(i) * r * k * 0.8, p.getZ(i) * r * k);
  }
  g.computeVertexNormals();
  return g;
}

// a slab of rock len wide, h tall: boxy, with a broken top and rough faces
function wallGeometry(len, h, thick) {
  const g = new THREE.BoxGeometry(len, h, thick, Math.max(3, Math.round(len * 3.5)), 7, 3).translate(0, h / 2, 0);
  const p = g.attributes.position, seed = Math.random() * 100;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = y / h, e = Math.abs(x) / (len / 2);
    const n1 = hash(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50)), n2 = hash(Math.round(x * 50) + 7, Math.round(y * 50), 3);
    // the skyline: big slow humps and broken teeth, lower toward the ends
    const sky = 0.32 * Math.sin(x * 1.7 + seed) + 0.18 * Math.sin(x * 4.3 + seed * 2) + 0.22 * (hash(Math.round(x * 3.5), 1, seed) - 0.5) - 0.35 * e * e;
    let ny = y + sky * v * v;
    // thick at the foot, narrower up top, bulging and dented all over
    const bulge = 1 + 0.25 * Math.sin(y * 3.1 + x * 2.3 + seed) + 0.2 * (n1 - 0.5);
    let nz = z * (1.25 - 0.55 * v) * bulge;
    let nx = x + (n2 - 0.5) * 0.12 * v - Math.sign(x) * 0.25 * v * e * e;
    p.setXYZ(i, nx, ny, nz);
  }
  g.computeVertexNormals();
  return g;
}

class Wall {
  constructor(G, mat, x, z, angle, len, h, life, delay = 0) {
    this.G = G; this.x = x; this.z = z; this.angle = angle; this.len = len; this.h = h; this.life = life; this.t = -delay;
    this.mesh = new THREE.Mesh(wallGeometry(len, h, 0.75), mat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.rotation.y = angle;
    // the base follows the lowest point of the ground under it, so no end hangs in the air
    const ax = Math.cos(angle), az = -Math.sin(angle);
    let low = Infinity; for (let s = -0.5; s <= 0.5; s += 0.25) low = Math.min(low, groundY(x + ax * len * s, z + az * len * s));
    this.base = low - 0.15;
    this.mesh.position.set(x, this.base - h, z); this.mesh.visible = false;
    G.scene.add(this.mesh);
    this.circles = [];
    const n = Math.max(2, Math.ceil(len / 0.35));
    for (let i = 0; i <= n; i++) { const s = -len / 2 + len * i / n; this.circles.push({ x: x + ax * s, z: z + az * s, r: 0.4, wall: this }); }
    this.up = false; this.gone = false; this.shook = 0;
  }
  // the ground tears open where it rises
  rise() {
    const G = this.G, ax = Math.cos(this.angle), az = -Math.sin(this.angle);
    this.up = true; this.mesh.visible = true;
    G.player.colliders.push(...this.circles);
    for (let s = -0.5; s <= 0.5; s += 0.12) {
      const x = this.x + ax * this.len * s, z = this.z + az * this.len * s, y = groundY(x, z);
      G.cut.stamp(x, z, 0.75, 1); G.trample.stamp(x, z, 1.2, 1, 0, 0, 1);
      G.particles.emit('dust', x, y + 0.1, z, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.8, 3);
      if (Math.random() < 0.5) G.particles.emit('clip', x, y + 0.2, z, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3, 1, 2);
    }
    G.leaves.burst?.(this.x, groundY(this.x, this.z), this.z, this.len * 0.5, 4);
  }
  fall() {
    if (this.falling) return;
    this.falling = true; this.t = Math.max(this.t, this.life);
    const G = this.G, i = G.player.colliders; for (const c of this.circles) { const k = i.indexOf(c); if (k >= 0) i.splice(k, 1); }
    G.audio?.earth('crumble');
    const ax = Math.cos(this.angle), az = -Math.sin(this.angle);
    for (let s = -0.5; s <= 0.5; s += 0.15) { const x = this.x + ax * this.len * s, z = this.z + az * this.len * s; G.particles.emit('dust', x, this.base + this.h * 0.6, z, 0, 0.4, 0, 1.4, 3); }
  }
  // something hit it hard (a dash): it shudders and spits grit
  jolt(x, y, z) {
    this.shook = 0.35;
    for (let i = 0; i < 18; i++) this.G.particles.emit('dust', x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.6, 1);
  }
  update(dt) {
    this.t += dt;
    if (this.t < 0) return true;
    if (!this.up) this.rise();
    const m = this.mesh;
    if (this.t < RISE) {
      // tearing up out of the ground, overshooting a little
      const u = this.t / RISE, e = 1 - Math.pow(1 - u, 3) + 0.06 * Math.sin(u * Math.PI);
      m.position.y = this.base - this.h * (1 - e);
      if (Math.random() < 0.6) { const s = (Math.random() - 0.5) * this.len, ax = Math.cos(this.angle), az = -Math.sin(this.angle); this.G.particles.emit('dust', this.x + ax * s, this.base + 0.2, this.z + az * s, 0, 2, 0, 0.6, 1); }
    } else if (this.t < this.life) {
      m.position.y = this.base;
    } else {
      if (!this.falling) this.fall();
      const u = (this.t - this.life) / FALL;
      m.position.y = this.base - this.h * u * u; m.rotation.z = 0.12 * u * (this.x > 0 ? 1 : -1);
      if (u >= 1) { this.G.scene.remove(m); m.geometry.dispose(); this.gone = true; return false; }
    }
    if (this.shook > 0) { this.shook = Math.max(0, this.shook - dt); const k = this.shook * 0.2; m.position.x = this.x + (Math.random() - 0.5) * k; m.position.z = this.z + (Math.random() - 0.5) * k; }
    else { m.position.x = this.x; m.position.z = this.z; }
    return true;
  }
  // the top of the wall here, for arrows
  get top() { return this.mesh.position.y + this.h; }
}

export class Earth {
  constructor(game) {
    this.game = game;
    this.charge = 0; this.cool = 0;
    this.walls = []; this.debris = []; this.cracks = []; this.dazed = 0;
    const rock = game.tx?.rock;
    const tex = rock ? rock.map.clone() : null;
    if (tex) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2, 1.2); tex.needsUpdate = true; }
    this.wallMat = new THREE.MeshStandardMaterial({ map: tex, normalMap: rock?.normal || null, color: 0x9a9182, roughness: 0.95, flatShading: true });
    this.stoneMat = new THREE.MeshStandardMaterial({ map: rock?.map || null, color: 0x8f8574, roughness: 0.9, flatShading: true, emissive: 0x5a4a20, emissiveIntensity: 0 });
    this.stoneGeos = [0, 1, 2, 3].map((i) => stoneGeometry(1, i * 3.1));
    // the stones that circle him while the power lasts
    this.orbit = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.stoneGeos[i % 4], this.stoneMat);
      m.castShadow = true; m.visible = false; m.frustumCulled = false;
      m.userData = { a: i / 6 * Math.PI * 2, r: 0.85 + 0.15 * (i % 2), h: 0.45 + 0.5 * ((i * 7) % 5) / 4, s: 0.07 + 0.04 * ((i * 3) % 4) / 3, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()) };
      game.scene.add(m); this.orbit.push(m);
    }
    this.k = 0; this.form = 0;
    this.fillEl = document.getElementById('earth-fill'); this.barEl = document.getElementById('earth');
  }
  get active() { return this.charge > 0; }

  // can it be called now? (the sword checks this before the move starts)
  ready(G) {
    if (this.active) { G.hud?.hint('The earth is already with you', 1.5); return false; }
    if (this.cool > 0) { G.hud?.hint('The ground is still settling: ' + Math.ceil(this.cool) + ' s', 1.5); return false; }
    return true;
  }

  // the blade goes into the ground (called by the sword at the moment it lands)
  quake(tip, P) {
    const G = this.game, x = P.pos.x, z = P.pos.z, y = groundY(x, z);
    this.charge = DURATION; this.form = 0;
    G.rig.shake = 1; G.hitStop = Math.max(G.hitStop, 0.12);
    G.audio?.earth('quake');
    G.hud?.callout('EARTH POWER', 'earth');
    // a ring of cracks, the grass torn, the litter thrown, a ring of dust
    this.crack(tip.x, tip.z);
    for (let a = 0; a < 6.28; a += 0.4) { const r = 1.4 + Math.random() * 1.2; G.trample.stamp(x + Math.cos(a) * r, z + Math.sin(a) * r, 1.2, 1, Math.cos(a), Math.sin(a), 1); }
    G.cut.stamp(tip.x, tip.z, 1.1, 1);
    G.leaves.burst?.(x, y, z, 3, 5);
    G.snow.onImpact(new THREE.Vector3(x, y, z), P.heading, 'land');
    for (let i = 0; i < 40; i++) { const a = i / 40 * 6.28; G.particles.emit('dust', x + Math.cos(a) * 0.7, y + 0.1, z + Math.sin(a) * 0.7, Math.cos(a) * 6, 0.6, Math.sin(a) * 6, 1.2, 1); }
    // rocks burst up out of the cracks and fall back
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.28, r = 0.6 + Math.random() * 1.8, s = 0.08 + Math.random() * 0.12;
      const m = new THREE.Mesh(this.stoneGeos[i % 4], this.stoneMat); m.scale.setScalar(s); m.castShadow = true;
      m.position.set(tip.x + Math.cos(a) * r, groundY(tip.x + Math.cos(a) * r, tip.z + Math.sin(a) * r), tip.z + Math.sin(a) * r);
      G.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 4 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 2)), spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, 0), t: 0, rest: 0 });
    }
    // the orbit stones come up out of the ground round him
    for (const m of this.orbit) { m.position.set(x + Math.cos(m.userData.a) * 1.3, y - 0.3, z + Math.sin(m.userData.a) * 1.3); }
  }

  // a cracked ring burnt into the ground: a decal that fades
  crack(x, z) {
    if (!this.crackTex) {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
      const r = g.createRadialGradient(128, 128, 6, 128, 128, 70); r.addColorStop(0, 'rgba(20,14,8,0.75)'); r.addColorStop(1, 'rgba(20,14,8,0)');
      g.fillStyle = r; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(14,10,6,0.85)'; g.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        let a = i / 14 * 6.28 + Math.random() * 0.3, px = 128, py = 128; g.lineWidth = 4;
        g.beginPath(); g.moveTo(px, py);
        for (let s = 0; s < 7; s++) {
          a += (Math.random() - 0.5) * 0.8; px += Math.cos(a) * 16; py += Math.sin(a) * 16; g.lineTo(px, py);
          if (Math.random() < 0.3) { g.stroke(); g.lineWidth *= 0.75; g.beginPath(); g.moveTo(px, py); }
        }
        g.stroke();
      }
      this.crackTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.position.set(x, groundY(x, z) + 0.05, z); m.rotation.y = Math.random() * 6.28; m.renderOrder = 2;
    this.game.scene.add(m); this.cracks.push({ m, t: 0 });
  }

  // Q: a wall in front of him
  raiseWall(P) {
    const G = this.game;
    if (!G.skills?.has('wall')) { G.hud?.hint('Learn Earth Wall in the skill tree (K), under Earth Power', 3); return false; }
    if (!this.active) { G.hud?.hint('The wall needs the earth with you: call it with G first', 3); return false; }
    if (P.state !== 'ground' || !P.grounded || G.bow?.equipped) return false;
    const b = G.rig.basis(), h = Math.atan2(b.fx, b.fz), fx = Math.sin(h), fz = Math.cos(h);
    const free = this.walls.filter((w) => !w.cage && !w.falling);
    if (free.length >= MAX_WALLS) free[0].fall();
    const w = new Wall(G, this.wallMat, P.pos.x + fx * 2.4, P.pos.z + fz * 2.4, h, 4.6, 2.3, WALL_LIFE);      // turned by h, its length runs across his facing
    this.walls.push(w);
    P.heading = h;
    G.audio?.earth('wall'); G.rig.shake = Math.max(G.rig.shake, 0.55); G.hitStop = Math.max(G.hitStop, 0.04);
    return true;
  }

  // Sky Slam under Earth Power: a ring of walls round (x, z), wide enough to take in the nearest target
  cage(x, z) {
    const G = this.game;
    let R = 5.5;
    for (const c of G.enemies?.targets || []) { if (c.dead) continue; const d = Math.hypot(c.x - x, c.z - z); if (d < 10) R = Math.max(R, Math.min(8.5, d + 1.8)); }
    const n = Math.ceil(2 * Math.PI * R / 2.3), chord = 2 * R * Math.sin(Math.PI / n) + 0.5;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2, wx = x + Math.cos(a) * R, wz = z + Math.sin(a) * R;
      // tangent to the ring: the wall's length (its local x, (cos y, -sin y) once turned by y) runs along (-sin a, cos a)
      const w = new Wall(G, this.wallMat, wx, wz, Math.atan2(-Math.cos(a), -Math.sin(a)), chord, 2.6, CAGE, 0.02 * i);
      w.cage = true; this.walls.push(w);
    }
    G.audio?.earth('wall'); G.audio?.earth('quake');
    G.hud?.callout('STONE CAGE', 'earth');
  }

  // does the segment of an arrow's flight end in a wall? returns the wall it shattered on
  blockArrow(p) {
    for (const w of this.walls) {
      if (!w.up || w.falling || p.y > w.top || p.y < w.base - 0.2) continue;
      for (const c of w.circles) { const dx = p.x - c.x, dz = p.z - c.z; if (dx * dx + dz * dz < c.r * c.r) return w; }
    }
    return null;
  }
  // the wall standing at (x, z), if any (for the dashes, which check points along their line)
  wallAt(x, z) {
    for (const w of this.walls) { if (!w.up || w.falling) continue; for (const c of w.circles) { const dx = x - c.x, dz = z - c.z, r = c.r + 0.34; if (dx * dx + dz * dz < r * r) return w; } }
    return null;
  }
  // circles the practice enemy must keep out of
  *circles() { for (const w of this.walls) if (w.up && !w.falling) yield* w.circles; }

  // a hard stop against stone: he is flat on the ground, dazed
  daze(P, secs = 1.6) {
    const G = this.game;
    P.vel.set(-Math.sin(P.heading) * 2.5, 0, -Math.cos(P.heading) * 2.5);
    P.flopTime = secs; P.setState('flop');
    this.dazed = secs + 0.5;
    G.hud?.callout('STUNNED', 'red');
    G.rig.shake = 1; G.hitStop = Math.max(G.hitStop, 0.12);
    G.audio?.sword('slam'); G.audio?.hurt();
  }

  update(dt, game) {
    const P = game.player;
    if (this.charge > 0) {
      this.charge -= dt;
      if (this.charge <= 0) { this.charge = 0; this.cool = COOLDOWN; game.audio?.earth('crumble'); game.hud?.hint('The earth lets go of you', 2.5); }
    } else if (this.cool > 0) {
      this.cool -= dt;
      if (this.cool <= 0) { this.cool = 0; game.hud?.hint('The ground is ready to answer again (G)', 2.5); }
    }
    const fill = (this.charge > 0 ? this.charge / DURATION : this.cool > 0 ? 1 - this.cool / COOLDOWN : 0) * 100;
    const fs = fill.toFixed(1) + '%';
    if (fs !== this._fill) { this._fill = fs; this.fillEl.style.width = fs; }
    this.barEl.classList.toggle('on', this.charge > 0 || this.cool > 0);
    this.barEl.classList.toggle('cool', this.cool > 0);
    // the circling stones: rise into orbit, float round him, drop away when it ends
    this.form = Math.min(1, this.form + dt / 0.6);
    const want = this.charge > 0 ? 1 : 0;
    this.k += (want - this.k) * Math.min(1, dt * (want ? 6 : 3));
    const t = game.time;
    for (const m of this.orbit) {
      const u = m.userData;
      m.visible = this.k > 0.02;
      if (!m.visible) continue;
      const a = u.a + t * 1.1, r = u.r * (0.6 + 0.4 * this.k), hy = u.h + 0.08 * Math.sin(t * 2 + u.a * 3);
      const tx = P.pos.x + Math.cos(a) * r, tz = P.pos.z + Math.sin(a) * r, ty = P.pos.y + hy * this.k - 0.4 * (1 - this.k);
      const e = smoothstep(0, 1, this.form);
      m.position.set(m.position.x + (tx - m.position.x) * Math.min(1, dt * (4 + 20 * e)), m.position.y + (ty - m.position.y) * Math.min(1, dt * (3 + 20 * e)), m.position.z + (tz - m.position.z) * Math.min(1, dt * (4 + 20 * e)));
      m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt;
      m.scale.setScalar(u.s * clamp(this.k * 1.3, 0, 1));
    }
    this.stoneMat.emissiveIntensity = 0.25 + 0.15 * Math.sin(t * 3);
    // debris from the quake
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]; d.t += dt;
      if (!d.rest) {
        d.v.y -= 13 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt;
        const gy = groundY(d.m.position.x, d.m.position.z);
        if (d.m.position.y < gy && d.v.y < 0) { d.m.position.y = gy; d.rest = d.t; this.game.particles.emit('dust', d.m.position.x, gy + 0.05, d.m.position.z, 0, 0.5, 0, 0.4, 2); }
      } else if (d.t - d.rest > 4) {
        d.m.position.y -= dt * 0.15;
        if (d.t - d.rest > 6) { this.game.scene.remove(d.m); this.debris.splice(i, 1); }
      }
    }
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i]; c.t += dt;
      c.m.material.opacity = Math.max(0, 1 - c.t / 25);
      if (c.t > 25) { this.game.scene.remove(c.m); c.m.material.dispose(); c.m.geometry.dispose(); this.cracks.splice(i, 1); }
    }
    for (let i = this.walls.length - 1; i >= 0; i--) if (!this.walls[i].update(dt)) this.walls.splice(i, 1);
    // dazed: grit and sparks circling his head while he lies there
    if (this.dazed > 0) {
      this.dazed -= dt;
      const a = t * 9, hx = P.pos.x + Math.sin(P.heading) * 0.5, hz = P.pos.z + Math.cos(P.heading) * 0.5;
      for (const o of [0, 2.1, 4.2]) game.particles.emit('spark', hx + Math.cos(a + o) * 0.3, P.pos.y + 0.55, hz + Math.sin(a + o) * 0.3, 0, 0.3, 0, 0.05, 1);
    }
  }
}
