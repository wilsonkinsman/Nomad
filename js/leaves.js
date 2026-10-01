// Fallen leaves with real physics. Every leaf is a small folded card lying on the forest floor.
// Walking through them sweeps them aside: legs and coat push them out and forward so they slide,
// flip and hop; feet kick a few higher; a runner drags a swirl of leaves along in his wake; a dive
// throws a burst. Airborne leaves tumble up edge-on, then flutter and zig-zag down face-first.
// Gusts make resting ones skitter, and the trees keep shedding from a separate small pool.
import * as THREE from 'three';
import { groundY, surfaceAt, ZONES } from './world.js';
import { addTranslucency, GLSL_CULL } from './grass.js';
import { mulberry32, clamp } from './util.js';

const CELL = 2;
const GROUND = 56000, POOL = 320;

function leafGeometry() {
  const h = 0.12;
  const pos = [-0.5, h, -0.5, 0, 0, -0.5, 0.5, h, -0.5, -0.5, h, 0.5, 0, 0, 0.5, 0.5, h, 0.5];
  const uv = [0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]);
  g.computeVertexNormals();
  return g;
}

export class Leaves {
  constructor(game, atlas, trees) {
    this.game = game;
    const rnd = mulberry32(404);
    const MAX = GROUND + POOL;
    this.pos = new Float32Array(MAX * 3); this.vel = new Float32Array(MAX * 3);
    this.rot = new Float32Array(MAX * 3);        // yaw, tiltX, tiltZ
    this.spin = new Float32Array(MAX * 3);       // yaw rate, flutter phase, flutter rate
    this.scale = new Float32Array(MAX);
    this.awake = new Uint8Array(MAX);
    this.rest = new Float32Array(MAX);           // resting height offset (layering)
    this.cellOf = new Int32Array(MAX);
    this.active = [];
    this.trees = trees.filter(t => t.kind !== 'pine');
    const z = ZONES.leaves, s = {};
    const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;\n' + GLSL_CULL)
        // a leaf out of view, or too far off to be more than a speck, is skipped (all 56 000 are drawn in one call)
        .replace('#include <begin_vertex>', `
          vec3 leafAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          if (offView(leafAt, 0.4) || distance(leafAt, cameraPosition) > 85.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          #include <begin_vertex>`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vMapUv = (uv + vec2(mod(aCell, 4.0), 3.0 - floor(aCell / 4.0))) / 4.0;`);
      addTranslucency(sh, '0.7');
    };
    const makeMesh = (n) => {
      const geo = leafGeometry();
      const cell = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      geo.setAttribute('aCell', cell);
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.receiveShadow = true; m.frustumCulled = false;
      return { m, cell };
    };
    const G = makeMesh(GROUND), F = makeMesh(POOL);
    this.mesh = G.m; this.poolMesh = F.m;
    const col = new THREE.Color();
    const init = (i, x, zz, cellArr, ci, mesh) => {
      this.pos[i * 3] = x; this.pos[i * 3 + 2] = zz;
      this.rest[i] = 0.004 + rnd() * 0.022;
      this.pos[i * 3 + 1] = groundY(x, zz) + this.rest[i];
      this.rot[i * 3] = rnd() * Math.PI * 2; this.rot[i * 3 + 1] = (rnd() - 0.5) * 0.25; this.rot[i * 3 + 2] = (rnd() - 0.5) * 0.25;
      this.spin[i * 3 + 1] = rnd() * 6.28; this.spin[i * 3 + 2] = 3 + rnd() * 3;
      this.scale[i] = 0.12 + rnd() * 0.09;
      cellArr[ci] = Math.floor(rnd() * 16);
      const k = 0.55 + rnd() * 0.5;
      mesh.setColorAt(ci, col.setRGB(k, k * (0.85 + rnd() * 0.15), k * (0.8 + rnd() * 0.2)));
    };
    let placed = 0, guard = 0;
    while (placed < GROUND && guard++ < GROUND * 30) {
      const x = z.cx + (rnd() * 2 - 1) * z.rx * 1.25, zz = z.cz + (rnd() * 2 - 1) * z.rz * 1.25;
      const sf = surfaceAt(x, zz, s);
      // denser under the trees
      let near = 0;
      for (const t of this.trees) { const d = Math.hypot(t.x - x, t.z - zz); if (d < 9) near = Math.max(near, 1 - d / 9); }
      const want = sf.leaves * (0.6 + 0.8 * near) * (1 - sf.path * 0.55) + (sf.grass * 0.05 * near);
      if (rnd() > want) continue;
      init(placed, x, zz, G.cell.array, placed, this.mesh);
      placed++;
    }
    this.NG = placed;
    this.mesh.count = placed;
    this.sortSpatially(placed, G.cell.array);
    // the falling pool starts on the ground under the trees
    for (let p = 0; p < POOL; p++) {
      const t = this.trees[(rnd() * this.trees.length) | 0], a = rnd() * 6.28, r = rnd() * (t ? 4 : 1);
      init(this.NG + p, (t ? t.x : z.cx) + Math.cos(a) * r, (t ? t.z : z.cz) + Math.sin(a) * r, F.cell.array, p, this.poolMesh);
    }
    this.N = this.NG + POOL;
    this.grid = new Map();
    for (let i = 0; i < this.N; i++) this.register(i);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    for (let i = 0; i < this.N; i++) this.writeMatrix(i);
    this.mesh.instanceMatrix.needsUpdate = true; this.poolMesh.instanceMatrix.needsUpdate = true;
    game.scene.add(this.mesh, this.poolMesh);
    this.shedT = 0;
    this.gustT = 0;
    this.nextPool = 0;
  }

  // neighbours in space become neighbours in the instance buffer, so kicks upload a small range
  sortSpatially(n, cellArr) {
    const order = [...Array(n).keys()].sort((a, b) => {
      const ka = Math.floor(this.pos[a * 3 + 2] / 4) * 1000 + Math.floor(this.pos[a * 3] / 4);
      const kb = Math.floor(this.pos[b * 3 + 2] / 4) * 1000 + Math.floor(this.pos[b * 3] / 4);
      return ka - kb;
    });
    const re = (arr, k) => { const c = arr.slice(0, n * k); for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) arr[i * k + j] = c[order[i] * k + j]; };
    re(this.pos, 3); re(this.rot, 3); re(this.spin, 3); re(this.scale, 1); re(this.rest, 1); re(cellArr, 1);
    if (this.mesh.instanceColor) re(this.mesh.instanceColor.array, 3);
  }

  // Lightning (or a blade full of it) scorches the litter: every leaf within r of (x, z) flashes to an ember and
  // fades to charcoal, and stays black; the ones nearest the middle burn first. Returns how many caught.
  singe(x, z, r, power = 1) {
    const col = this.mesh.instanceColor; if (!col) return 0;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    this.burning = this.burning || new Map();
    this.game.burn?.stamp(x, z, r * 0.95, Math.min(1, power));          // and the ground under them is blackened
    let n = 0;
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const list = this.grid.get((cx + 1000) * 4096 + (cz + 1000));
      if (!list) continue;
      for (const i of list) {
        if (i >= this.NG) continue;                  // the falling pool is left alone
        const d = Math.hypot(this.pos[i * 3] - x, this.pos[i * 3 + 2] - z);
        if (d > r || Math.random() > power * (1.15 - 0.6 * d / r)) continue;
        const b = this.burning.get(i);
        if (b) { b.t = Math.min(b.t, 0.2); } else { this.burning.set(i, { t: 0, delay: d / r * 0.35 }); n++; }
      }
    }
    return n;
  }
  // embers fading to charcoal
  burn(dt) {
    if (!this.burning || !this.burning.size) return;
    const col = this.mesh.instanceColor.array, G = this.game;
    for (const [i, b] of this.burning) {
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.t += dt;
      const u = Math.min(1, b.t / 1.5), glow = Math.max(0, 1 - u * 1.6);
      // ember orange at first, then charcoal
      col[i * 3] = 0.05 + 0.045 * (1 - u) + 2.4 * glow; col[i * 3 + 1] = 0.04 + 0.03 * (1 - u) + 0.7 * glow; col[i * 3 + 2] = 0.035 + 0.02 * (1 - u) + 0.12 * glow;
      if (b.t < 0.9 && Math.random() < dt * 1.8) G.particles.emit(Math.random() < 0.35 ? 'ember' : 'smoke', this.pos[i * 3], this.pos[i * 3 + 1] + 0.05, this.pos[i * 3 + 2], 0, 0.4 + Math.random() * 0.6, 0, 0.5, 1);
      if (u >= 1) this.burning.delete(i);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  key(x, z) { return (Math.floor(x / CELL) + 1000) * 4096 + (Math.floor(z / CELL) + 1000); }
  register(i) {
    const k = this.key(this.pos[i * 3], this.pos[i * 3 + 2]);
    let a = this.grid.get(k); if (!a) this.grid.set(k, a = []);
    a.push(i); this.cellOf[i] = k;
  }
  unregister(i) {
    const a = this.grid.get(this.cellOf[i]); if (!a) return;
    const j = a.indexOf(i); if (j >= 0) { a[j] = a[a.length - 1]; a.pop(); }
  }
  near(x, z, r, fn) {
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const a = this.grid.get((cx + 1000) * 4096 + (cz + 1000)); if (!a) continue;
      for (let n = a.length - 1; n >= 0; n--) {
        const i = a[n], dx = this.pos[i * 3] - x, dz = this.pos[i * 3 + 2] - z, d = Math.hypot(dx, dz);
        if (d < r) fn(i, dx, dz, d);
      }
    }
  }

  wake(i, vx, vy, vz, spin = 1) {
    if (!this.awake[i]) { this.awake[i] = 1; this.active.push(i); this.unregister(i); }
    this.vel[i * 3] += vx; this.vel[i * 3 + 1] = Math.max(this.vel[i * 3 + 1], vy); this.vel[i * 3 + 2] += vz;
    this.spin[i * 3] = (Math.random() - 0.5) * 9 * spin;
    this.spin[i * 3 + 2] = 3 + Math.random() * 4;
  }

  // a foot sweeping through: radius, how hard, and the mover's velocity
  kick(x, z, r, power, vx, vz) {
    this.near(x, z, r, (i, dx, dz, d) => {
      const q = d / r, f = (1 - q * q) * power;
      if (f < 0.04) return;
      const ox = dx / (d + 1e-3), oz = dz / (d + 1e-3);
      const lift = f * (1.4 + Math.random() * 2.6);
      this.wake(i, vx * 0.45 * f + ox * f * 1.4, lift, vz * 0.45 * f + oz * f * 1.4, f + 0.3);
    });
  }

  // the legs and coat hem ploughing through the litter: leaves are shoved out and forward,
  // flip over and slide, and the faster you go the more of them hop into the air
  sweep(x, z, r, power, vx, vz, sp) {
    const ax = vx / (sp + 1e-3), az = vz / (sp + 1e-3);
    this.near(x, z, r, (i, dx, dz, d) => {
      const f = 1 - d / r;
      const ox = dx / (d + 1e-3), oz = dz / (d + 1e-3);
      const ahead = Math.max(0, ox * ax + oz * az);            // leaves in front get bulldozed along
      const shove = (0.7 + sp * 0.32) * f * (0.6 + Math.random() * 0.8);
      const hx = ox * shove * (1 - ahead * 0.5) + ax * sp * (0.25 + 0.35 * ahead) * f;
      const hz = oz * shove * (1 - ahead * 0.5) + az * sp * (0.25 + 0.35 * ahead) * f;
      const lift = (0.6 + power * 2.6) * f * (0.4 + Math.random());
      this.wake(i, hx, lift, hz, 0.6 + f);
      // flip: resting leaves turned over by the shove
      this.rot[i * 3 + 1] += (Math.random() - 0.5) * 1.6 * f;
    });
  }

  // turbulence behind a runner lifts light leaves and carries them along for a moment
  wakeSwirl(x, z, r, power, vx, vz) {
    this.near(x, z, r, (i, dx, dz, d) => {
      if (Math.random() > 0.55) return;
      const f = 1 - d / r;
      const tx = -dz / (d + 1e-3), tz = dx / (d + 1e-3), s = Math.random() < 0.5 ? 1 : -1;   // swirl sideways
      this.wake(i, vx * 0.55 * f + tx * s * power * 1.3 * f, (0.8 + Math.random() * 2.2) * power * f, vz * 0.55 * f + tz * s * power * 1.3 * f, 1.5);
    });
  }

  burst(x, y, z, r, power) {
    this.near(x, z, r, (i, dx, dz, d) => {
      const q = d / r, f = 1 - q * q, ox = dx / (d + 1e-3), oz = dz / (d + 1e-3);
      this.wake(i, ox * power * f * (0.5 + Math.random()), power * f * (0.8 + Math.random() * 1.2), oz * power * f * (0.5 + Math.random()), 2);
    });
  }

  writeMatrix(i) {
    const e = this._e, q = this._q, m = this._m;
    e.set(this.rot[i * 3 + 1], this.rot[i * 3], this.rot[i * 3 + 2]);
    q.setFromEuler(e);
    const s = this.scale[i];
    m.compose(this._p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]), q, this._s.set(s, s, s));
    if (i < this.NG) this.mesh.setMatrixAt(i, m); else this.poolMesh.setMatrixAt(i - this.NG, m);
  }

  update(dt, game) {
    // the litter is one draw of 56 000 leaves: skip it when the hollow is out of sight or beyond the distance a leaf
    // is more than a speck (the shader drops the far and off-screen ones one by one when it is drawn)
    {
      const c = game.camera.position, Z = ZONES.leaves, R = Math.max(Z.rx, Z.rz) * 1.3;
      if (!this._box) { this._box = new THREE.Box3(new THREE.Vector3(Z.cx - R, -10, Z.cz - R), new THREE.Vector3(Z.cx + R, 25, Z.cz + R)); this._fr = new THREE.Frustum(); this._pm = new THREE.Matrix4(); }
      const gap = Math.hypot(Math.max(0, Math.abs(c.x - Z.cx) - R), Math.max(0, Math.abs(c.z - Z.cz) - R));
      game.camera.updateMatrixWorld();
      this._pm.multiplyMatrices(game.camera.projectionMatrix, game.camera.matrixWorldInverse);
      this._fr.setFromProjectionMatrix(this._pm);
      this.mesh.visible = gap < 85 && this._fr.intersectsBox(this._box);
    }
    if (dt <= 0) return;
    this.burn(dt);
    const P = game.player, W = game.wind;
    const sp = Math.hypot(P.vel.x, P.vel.z);
    const inLeaves = P.surface && P.surface.leaves > 0.2;
    if (inLeaves && P.grounded && sp > 0.3 && P.state === 'ground') {
      const power = clamp(sp / 6.4, 0.12, 1);
      const ax = P.vel.x / sp, az = P.vel.z / sp;
      // feet first (they flick leaves up), then the body shoves the rest aside
      for (const L of ['L', 'R']) {
        const f = P.model.footWorld(L);
        this.kick(f.x, f.z, 0.26 + power * 0.22, 0.75 + power * 0.6, P.vel.x, P.vel.z);
      }
      this.sweep(P.pos.x + ax * 0.15, P.pos.z + az * 0.15, 0.5 + power * 0.45, power, P.vel.x, P.vel.z, sp);
      if (sp > 2.5) this.wakeSwirl(P.pos.x - ax * 0.6, P.pos.z - az * 0.6, 0.55 + power * 0.4, power, P.vel.x, P.vel.z);
    }
    if ((P.state === 'roll' || P.state === 'getup') && inLeaves) this.kick(P.pos.x, P.pos.z, 0.95, 1.2, P.vel.x, P.vel.z);

    // trees shed: recycle the pool round-robin, preferring leaves out of sight of the player
    this.shedT += dt;
    if (this.shedT > 0.1 && this.trees.length) {
      this.shedT = 0;
      const cand = this.trees.filter(t => Math.hypot(t.x - P.pos.x, t.z - P.pos.z) < 35 && t.kind !== 'green');
      if (cand.length) {
        const t = cand[(Math.random() * cand.length) | 0];
        for (let tries = 0; tries < 8; tries++) {
          const i = this.NG + this.nextPool; this.nextPool = (this.nextPool + 1) % POOL;
          if (this.awake[i]) continue;
          if (tries < 6 && Math.hypot(this.pos[i * 3] - P.pos.x, this.pos[i * 3 + 2] - P.pos.z) < 6) continue;
          const a = Math.random() * Math.PI * 2, r = Math.random() * t.canopyR;
          this.unregister(i);
          this.pos[i * 3] = t.x + Math.cos(a) * r; this.pos[i * 3 + 2] = t.z + Math.sin(a) * r;
          this.pos[i * 3 + 1] = groundY(t.x, t.z) + t.canopyY * (0.6 + Math.random() * 0.5);
          this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
          this.awake[i] = 1; this.active.push(i);
          this.spin[i * 3] = (Math.random() - 0.5) * 6; this.spin[i * 3 + 2] = 3 + Math.random() * 4;
          break;
        }
      }
    }
    // gusts make a few resting leaves near the player skitter
    this.gustT += dt;
    if (this.gustT > 0.25) {
      this.gustT = 0;
      const g = W.gust(P.pos.x, P.pos.z);
      if (g > 2.2) {
        const cx = P.pos.x + (Math.random() - 0.5) * 16, cz = P.pos.z + (Math.random() - 0.5) * 16;
        this.near(cx, cz, 2.0, (i) => { if (Math.random() < 0.25) this.wake(i, W.dir.x * g * 0.4, 0.15 + Math.random() * 0.4, W.dir.y * g * 0.4, 0.5); });
      }
    }

    // integrate airborne and sliding leaves
    const A = this.active;
    let lo = 1e9, hi = -1, pool = false;
    for (let n = A.length - 1; n >= 0; n--) {
      const i = A[n], k = i * 3;
      const w = W.at(this.pos[k], this.pos[k + 2]);
      const gy = groundY(this.pos[k], this.pos[k + 2]);
      const h = this.pos[k + 1] - gy;
      let vx = this.vel[k], vy = this.vel[k + 1], vz = this.vel[k + 2];
      const air = h > this.rest[i] + 0.01 || vy > 0.05;
      if (air) {
        // flat-plate drag: strong vertically (face down), weaker sideways; flutter sideways
        this.spin[k + 1] += this.spin[k + 2] * dt;
        const ph = this.spin[k + 1];
        const rx = vx - w.x, rz = vz - w.z;
        vy += -9.8 * dt;
        // tumbling on the way up (edge-on, little drag); face-down on the way down (lots)
        vy *= Math.exp(-(vy > 0 ? 2.2 : 6.5) * dt);
        vx -= rx * (1 - Math.exp(-2.2 * dt)); vz -= rz * (1 - Math.exp(-2.2 * dt));
        const yaw = this.rot[k];
        const sway = Math.cos(ph) * 1.6 * Math.min(1, h * 2);
        vx += Math.cos(yaw) * sway * dt * 3; vz -= Math.sin(yaw) * sway * dt * 3;
        this.rot[k] += this.spin[k] * dt;
        this.rot[k + 1] = Math.sin(ph) * 0.9 + (vy > 0 ? ph * 0.15 : 0);
        this.rot[k + 2] = Math.cos(ph * 0.7) * 0.7;
      } else {
        // on the ground: sliding friction, the leaf yaws as it skids; strong gusts push
        const f = Math.exp(-4.2 * dt);
        vx = vx * f + w.x * 0.05 * dt; vz = vz * f + w.z * 0.05 * dt;
        vy = Math.min(0, vy);
        this.rot[k + 1] *= Math.exp(-7 * dt); this.rot[k + 2] *= Math.exp(-7 * dt);
        this.rot[k] += this.spin[k] * dt * 0.5; this.spin[k] *= Math.exp(-3.5 * dt);
      }
      this.pos[k] += vx * dt; this.pos[k + 1] += vy * dt; this.pos[k + 2] += vz * dt;
      const gy2 = groundY(this.pos[k], this.pos[k + 2]) + this.rest[i];
      if (this.pos[k + 1] < gy2) { this.pos[k + 1] = gy2; if (vy < -0.5) { vx *= 0.5; vz *= 0.5; } vy = 0; }
      this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
      this.writeMatrix(i);
      if (i < this.NG) { if (i < lo) lo = i; if (i > hi) hi = i; } else pool = true;
      if (!air && vx * vx + vz * vz < 0.0025 && Math.abs(this.spin[k]) < 0.2) {
        this.awake[i] = 0;
        A[n] = A[A.length - 1]; A.pop();
        this.register(i);
      }
    }
    if (hi >= 0) {
      const im = this.mesh.instanceMatrix;
      im.clearUpdateRanges(); im.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
      im.needsUpdate = true;
    }
    if (pool) this.poolMesh.instanceMatrix.needsUpdate = true;
  }

  // player events
  onStep(side, p, surf, speed) { if (surf.leaves > 0.2) this.kick(p.x, p.z, 0.3 + speed * 0.05, clamp(speed / 5, 0.25, 1), 0, 0); }
  onImpact(p, kind, speed) {
    const s = surfaceAt(p.x, p.z);
    if (s.leaves < 0.2) return;
    if (kind === 'roll' || kind === 'flop') this.burst(p.x, p.y, p.z, 1.9, 3.2);
    else this.burst(p.x, p.y, p.z, 1.0, Math.min(3, speed * 0.35));
  }
}
