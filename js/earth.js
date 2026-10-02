// The Earth path.
//   Earth Power (G): he drives the blade into the ground (the 'quake' move in sword.js); the ground cracks in a ring,
//     rocks burst up, and stones rise to circle him. For DURATION seconds he takes half damage, his blows throw
//     things back, and Sky Slam raises a cage of stone. COOLDOWN seconds after it fades before it can be called again.
//   Earth Wall (Q, while Earth Power is on): a wall of rock tears up out of the ground in front of him. Arrows
//     shatter on it, nothing walks through it, a dash stops at it, and the Electrical Tackle driven into it leaves
//     him stunned on the ground.
//   Rock Kick (E, while Earth Power is on): he stomps, a boulder bursts up out of the ground in front of him
//     (throwing out a spray of small stones as it tears free), hangs at knee height for a breath, and he kicks it
//     away. It flies low and hard, ploughing the grass where it skims, and shatters on the first thing it meets:
//     an enemy takes KICK_DMG and is thrown back, a wall, a tree or the ground breaks it to gravel.
//   The cage: Sky Slam under Earth Power raises a ring of walls round the landing, wide enough to take in whoever
//     is near, for CAGE seconds. The walls stand too high to jump (2.6 m), but not too high to clear with a Sky Slam:
//     getting out over the top is hard, not impossible.
// Walls stand in the world as rows of circles (Wall.circles), the same shape as tree and rock colliders, so the
// player, the dashes and the practice enemy all stop at them; only up to their tops (Wall.top), so what goes over
// them is not held back.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, smoothstep } from './util.js';
import { mergeVertices } from '../lib/utils/BufferGeometryUtils.js';

export const DURATION = 40, COOLDOWN = 10, CAGE = 6, WALL_LIFE = 10, WALL_COOL = 1.5;
export const KICK_TIME = 1.05;                       // the whole Rock Kick, stomp to standing
const STOMP_AT = 0.26, KICK_AT = 0.56, KICK_SPEED = 44, KICK_DMG = 42, KICK_KNOCK = 2.8;
const MAX_WALLS = 3, RISE = 0.28, FALL = 0.55;

const _k = new THREE.Vector3();
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
    this.charge = 0; this.cool = 0; this.wallCool = 0;
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
    this.rocks = [];          // kicked boulders: rising, hanging, then flying
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
    if (this.wallCool > 0) { G.hud?.hint('The ground needs a moment: ' + this.wallCool.toFixed(1) + ' s', 0.8); return false; }
    this.wallCool = WALL_COOL;
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

  // ---------------------------------------------------------------- Rock Kick
  // E: the stomp begins (true if it did)
  rockKick(P) {
    const G = this.game;
    if (!G.skills?.has('rockkick')) { G.hud?.hint('Learn Rock Kick in the skill tree (K), under Earth Power', 3); return false; }
    if (!this.active) { G.hud?.hint('Rock Kick needs the earth with you: call it with G first', 3); return false; }
    if (P.state !== 'ground' || !P.grounded || G.bow?.equipped) return false;
    const b = G.rig.basis();
    P.heading = Math.atan2(b.fx, b.fz);
    P.setState('rockkick'); P.vel.set(0, 0, 0);
    this.stomped = false; this.kicked = false; this.kickRock = null;
    return true;
  }
  // every frame of the move, from the player before he moves: he stays rooted; the stomp and the kick land on time
  kickDrive(P, dt) {
    const G = this.game, t = P.stateT;
    P.vel.x *= Math.exp(-12 * dt); P.vel.z *= Math.exp(-12 * dt);
    if (!this.stomped && t >= STOMP_AT) { this.stomped = true; this.stomp(P); }
    if (!this.kicked && t >= KICK_AT) { this.kicked = true; this.kick(P); }
    if (t >= KICK_TIME) P.setState('ground');
  }
  // the boulder's size for this character (radius, metres): big, about his hip height across
  rockR(P) { return 0.46 * (P.model.camHeight ?? 1.48) / 1.18; }
  // where the boulder hangs, ready for the foot: in front of him at hip height, just past where the side kick lands
  kickSpot(P, out) {
    const s = (P.model.camHeight ?? 1.48), fx = Math.sin(P.heading), fz = Math.cos(P.heading), d = 0.4 * s + this.rockR(P) * 0.95;
    return out.set(P.pos.x + fx * d, P.pos.y + 0.4 * s, P.pos.z + fz * d);
  }
  stomp(P) {
    const G = this.game, at = this.kickSpot(P, new THREE.Vector3()), gy = groundY(at.x, at.z);
    G.rig.shake = Math.max(G.rig.shake, 0.6); G.hitStop = Math.max(G.hitStop, 0.05);
    G.audio?.earth('stomp');
    // the stomp: a ring of dust round his foot, the grass pressed flat
    const fx = Math.sin(P.heading), fz = Math.cos(P.heading);
    for (let i = 0; i < 18; i++) { const a = i / 18 * 6.28; G.particles.emit('dust', P.pos.x + fx * 0.15 + Math.cos(a) * 0.25, P.pos.y + 0.05, P.pos.z + fz * 0.15 + Math.sin(a) * 0.25, Math.cos(a) * 3, 0.4, Math.sin(a) * 3, 0.5, 1); }
    G.trample.stamp(P.pos.x, P.pos.z, 1.0, 1, 0, 0, 1);
    // the boulder: it bursts up out of the ground where the stomp sent the shock
    const m = new THREE.Mesh(this.stoneGeos[(Math.random() * 4) | 0], this.stoneMat);
    const R = this.rockR(P);
    m.scale.setScalar(R); m.castShadow = true; m.frustumCulled = false;
    m.position.set(at.x, gy - R * 1.6, at.z);
    G.scene.add(m);
    const r = { m, state: 'rise', t: 0, from: gy - R * 1.6, vel: new THREE.Vector3(), spin: new THREE.Vector3(1 + Math.random() * 2, 2 + Math.random() * 3, 0), r: m.scale.x };
    this.rocks.push(r); this.kickRock = r;
    // tearing free: a spray of small stones and a puff of dirt, a hole torn in the grass
    this.chips(at.x, gy + 0.1, at.z, 24, 4, 7);
    G.particles.emit('dust', at.x, gy + 0.1, at.z, 0, 2.6, 0, 1.1, 26);
    G.cut.stamp(at.x, at.z, R + 0.4, 1); G.trample.stamp(at.x, at.z, R + 1.2, 1, 0, 0, 1);
    G.leaves.burst?.(at.x, gy, at.z, 0.9, 3);
  }
  // small stones thrown out from (x, y, z): n of them, sideways speed up to `out`, up to `up` upward
  chips(x, y, z, n, out, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = 0.03 + Math.random() * 0.05;
      const m = new THREE.Mesh(this.stoneGeos[i % 4], this.stoneMat); m.scale.setScalar(s); m.castShadow = s > 0.05;
      m.position.set(x + Math.cos(a) * 0.15, y, z + Math.sin(a) * 0.15); this.game.scene.add(m);
      const sp = out * (0.3 + 0.7 * Math.random());
      this.debris.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, up * (0.5 + 0.5 * Math.random()), Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 14, Math.random() * 14, 0), t: 0, rest: 0, small: true });
    }
  }
  kick(P) {
    const G = this.game, r = this.kickRock;
    G.audio?.earth('kick'); G.rig.shake = Math.max(G.rig.shake, 0.5); G.hitStop = Math.max(G.hitStop, 0.06);
    if (!r || r.state !== 'rise') return;
    const fx = Math.sin(P.heading), fz = Math.cos(P.heading), rx = fz, rz = -fx, p = r.m.position;
    // along where he faces, tipped up a touch toward where the camera looks
    const up = clamp(-Math.sin(G.rig.pitch) * 0.4 + 0.02, -0.04, 0.18);
    r.state = 'fly'; r.t = 0; r.vel.set(fx * KICK_SPEED, up * KICK_SPEED + 1.0, fz * KICK_SPEED);
    r.spin.set(-26, 3, 0);
    // the hit: a freeze, the camera kicked, a ring of dust and grit blown out round the point of contact
    G.hitStop = Math.max(G.hitStop, 0.13); G.rig.shake = 1; P.dashFov = 12;
    P.vel.x += fx * 2.5; P.vel.z += fz * 2.5;
    G.audio?.sword('slam');
    const cx = p.x - fx * r.r, cy = p.y, cz = p.z - fz * r.r;
    for (let i = 0; i < 28; i++) { const a = i / 28 * 6.28, c = Math.cos(a), s = Math.sin(a); G.particles.emit('dust', cx, cy, cz, (rx * c) * 7 + fx * 2, s * 7, (rz * c) * 7 + fz * 2, 0.2, 1); }
    this.chips(cx, cy, cz, 14, 4, 3);
    G.trample.stamp(p.x, p.z, 1.6, 1, fx, fz, 1);
  }
  // a boulder breaks: gravel, dust, a crack of sound
  shatter(r, x, y, z) {
    const G = this.game;
    r.state = 'gone'; G.scene.remove(r.m);
    this.chips(x, y, z, 26, 6, 5);
    G.particles.emit('dust', x, y, z, 0, 1.5, 0, 1.4, 30);
    G.leaves.burst?.(x, groundY(x, z), z, 1.5, 4);
    G.audio?.earth('crumble'); G.audio?.sword('slam');
    G.rig.shake = Math.max(G.rig.shake, 0.4);
  }
  updateRocks(dt, P) {
    const G = this.game;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i]; r.t += dt;
      const m = r.m;
      if (r.state === 'rise') {
        if (P.state !== 'rockkick') { this.shatter(r, m.position.x, m.position.y, m.position.z); this.rocks.splice(i, 1); continue; }   // he was knocked out of it
        // shoots up out of the ground, overshoots, settles where the foot will meet it, and turns slowly
        const spot = this.kickSpot(P, _k), u = Math.min(1, r.t / 0.16);
        const y = u < 1 ? r.from + (spot.y + 0.35 - r.from) * (1 - (1 - u) * (1 - u)) : m.position.y + (spot.y - m.position.y) * Math.min(1, dt * 12);
        m.position.set(spot.x, y, spot.z);
        m.rotation.x += r.spin.x * dt * 0.4; m.rotation.y += r.spin.y * dt * 0.4;
        if (u < 1 && Math.random() < 0.7) G.particles.emit('dust', spot.x, groundY(spot.x, spot.z) + 0.1, spot.z, 0, 1.5, 0, 0.4, 1);
        continue;
      }
      if (r.state !== 'fly') { this.rocks.splice(i, 1); continue; }
      // flying: a little gravity, and stepped so a fast frame can't jump through anything
      const steps = Math.max(1, Math.ceil(r.vel.length() * dt / 0.25)), h = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        r.vel.y -= 6 * h;
        m.position.addScaledVector(r.vel, h);
        const p = m.position, gy = groundY(p.x, p.z);
        // skimming low: it ploughs the grass, and the air it pushes lays the field flat to either side
        if (p.y - gy < r.r + 0.6) { G.cut.stamp(p.x, p.z, r.r + 0.2, 1); if (Math.random() < 0.3) G.particles.emit('clip', p.x, gy + 0.2, p.z, r.vel.x * 0.1, 2, r.vel.z * 0.1, 0.6, 1); }
        if (p.y - gy < r.r + 1.5 && Math.random() < 0.5) { const sp = Math.hypot(r.vel.x, r.vel.z) || 1; G.trample.stamp(p.x, p.z, r.r + 1.0, 0.9, r.vel.x / sp, r.vel.z / sp, 0.5); }
        if (Math.random() < 0.4) G.leaves.kick?.(p.x, p.z, r.r + 0.8, 1.2, r.vel.x * 0.3, r.vel.z * 0.3);
        for (const c of G.enemies?.targets || []) {
          if (c.dead) continue;
          const cy = groundY(c.x, c.z) + (c.lift || 0), dx = c.x - p.x, dz = c.z - p.z;
          if (Math.hypot(dx, dz) < c.r + r.r && p.y > cy - 0.2 && p.y < cy + (c.y1 || 1.9)) {
            c.onHit?.('rock', KICK_DMG, r.vel.x, r.vel.z, { knock: KICK_KNOCK });
            G.hitStop = Math.max(G.hitStop, 0.12); G.audio?.sword('hit'); G.rig.shake = 1;
            this.shatter(r, p.x, p.y, p.z); done = true; break;
          }
        }
        if (done) break;
        const w = this.blockArrow(p);
        if (w) { w.jolt(p.x, p.y, p.z); this.shatter(r, p.x, p.y, p.z); done = true; break; }
        for (const L of [G.trees?.colliders, G.props?.colliders]) if (L && !done) for (const c of L) {
          const dx = p.x - c.x, dz = p.z - c.z, rr = c.r + r.r;
          if (dx * dx + dz * dz < rr * rr && p.y < gy + 3) { this.shatter(r, p.x, p.y, p.z); done = true; break; }
        }
        if (!done && (p.y - r.r < gy || r.t > 2.5)) { this.shatter(r, p.x, Math.max(p.y, gy + 0.1), p.z); G.cut.stamp(p.x, p.z, 0.9, 1); done = true; }
      }
      if (done) { this.rocks.splice(i, 1); continue; }
      m.rotation.x += r.spin.x * dt; m.rotation.y += r.spin.y * dt;
      if (Math.random() < 0.5) G.particles.emit('dust', m.position.x, m.position.y, m.position.z, 0, 0.3, 0, 0.15, 1);
    }
  }

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
    this.wallCool = Math.max(0, this.wallCool - dt);
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
      } else if (d.t - d.rest > (d.small ? 1.5 : 4)) {
        d.m.position.y -= dt * 0.15;
        if (d.t - d.rest > (d.small ? 2.5 : 6)) { this.game.scene.remove(d.m); this.debris.splice(i, 1); }
      }
    }
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i]; c.t += dt;
      c.m.material.opacity = Math.max(0, 1 - c.t / 25);
      if (c.t > 25) { this.game.scene.remove(c.m); c.m.material.dispose(); c.m.geometry.dispose(); this.cracks.splice(i, 1); }
    }
    for (let i = this.walls.length - 1; i >= 0; i--) if (!this.walls[i].update(dt)) this.walls.splice(i, 1);
    this.updateRocks(dt, P);
    // dazed: grit and sparks circling his head while he lies there
    if (this.dazed > 0) {
      this.dazed -= dt;
      const a = t * 9, hx = P.pos.x + Math.sin(P.heading) * 0.5, hz = P.pos.z + Math.cos(P.heading) * 0.5;
      for (const o of [0, 2.1, 4.2]) game.particles.emit('spark', hx + Math.cos(a + o) * 0.3, P.pos.y + 0.55, hz + Math.sin(a + o) * 0.3, 0, 0.3, 0, 0.05, 1);
    }
  }
}
