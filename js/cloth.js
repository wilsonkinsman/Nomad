// Position-based (Verlet) cloth for the nomad's cloak, coat tails, scarf and sash ends,
// and the prayer flag at the crossroads. Pins follow bones; capsules keep cloth off the body;
// wind pushes on each particle along its surface normal so fabric flutters instead of sliding.
import * as THREE from 'three';
import { groundY } from './world.js';

const _d = new THREE.Vector3(), _c = new THREE.Vector3();

export class Cloth {
  // opts: { rows, cols, init(r, c, out), pins: [{ r, c, target: Vector3 }], stiff, shear, bend, drag, wind, thick, mat, uvScale }
  constructor(opts) {
    const { rows, cols } = opts;
    this.rows = rows; this.cols = cols;
    const n = rows * cols;
    this.n = n;
    this.p = new Float32Array(n * 3);
    this.o = new Float32Array(n * 3);
    this.w = new Float32Array(n).fill(1);   // inverse mass; 0 = pinned
    this.nrm = new Float32Array(n * 3);
    this.drag = opts.drag ?? 0.985;
    this.windK = opts.wind ?? 1;
    this.thick = opts.thick ?? 0.012;
    this.gravity = opts.gravity ?? -9.81;
    const v = new THREE.Vector3();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      opts.init(r, c, v);
      const i = (r * cols + c) * 3;
      this.p[i] = this.o[i] = v.x; this.p[i + 1] = this.o[i + 1] = v.y; this.p[i + 2] = this.o[i + 2] = v.z;
    }
    this.pins = (opts.pins || []).map(pn => ({ i: pn.r * cols + pn.c, target: pn.target, prev: pn.target.clone() }));
    for (const pn of this.pins) this.w[pn.i] = 0;

    // constraints: [a, b, rest, k]
    const con = [];
    const add = (r1, c1, r2, c2, k) => {
      if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols) return;
      const a = r1 * cols + c1, b = r2 * cols + c2;
      const rest = Math.hypot(this.p[a * 3] - this.p[b * 3], this.p[a * 3 + 1] - this.p[b * 3 + 1], this.p[a * 3 + 2] - this.p[b * 3 + 2]);
      con.push(a, b, rest, k);
    };
    const st = opts.stiff ?? 1, sh = opts.shear ?? 0.5, bd = opts.bend ?? 0.15;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      add(r, c, r, c + 1, st); add(r, c, r + 1, c, st);
      add(r, c, r + 1, c + 1, sh); add(r, c + 1, r + 1, c, sh);
      add(r, c, r, c + 2, bd); add(r, c, r + 2, c, bd);
    }
    // the shear pass adds (r, c+1)-(r+1, c) which is out of range at the last column; filtered by add()
    const nc = con.length / 4;
    this.ca = new Int32Array(nc); this.cb = new Int32Array(nc); this.cr = new Float32Array(nc); this.ck = new Float32Array(nc);
    for (let i = 0; i < nc; i++) { this.ca[i] = con[i * 4]; this.cb[i] = con[i * 4 + 1]; this.cr[i] = con[i * 4 + 2]; this.ck[i] = con[i * 4 + 3]; }
    this.gy = new Float32Array(n);

    // geometry
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.p, 3); this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3); this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    const uv = new Float32Array(n * 2), us = opts.uvScale || [1, 1];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; uv[i * 2] = c / (cols - 1) * us[0]; uv[i * 2 + 1] = 1 - r / (rows - 1) * us[1];
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, opts.mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this._acc = 0;
    this.normals();
  }

  // move everything rigidly (teleports)
  shift(dx, dy, dz) {
    for (let i = 0; i < this.n; i++) {
      this.p[i * 3] += dx; this.p[i * 3 + 1] += dy; this.p[i * 3 + 2] += dz;
      this.o[i * 3] += dx; this.o[i * 3 + 1] += dy; this.o[i * 3 + 2] += dz;
    }
  }

  normals() {
    const { rows, cols, p, nrm } = this;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const l = r * cols + Math.max(0, c - 1), rr = r * cols + Math.min(cols - 1, c + 1);
      const u = Math.max(0, r - 1) * cols + c, d = Math.min(rows - 1, r + 1) * cols + c;
      const ax = p[rr * 3] - p[l * 3], ay = p[rr * 3 + 1] - p[l * 3 + 1], az = p[rr * 3 + 2] - p[l * 3 + 2];
      const bx = p[d * 3] - p[u * 3], by = p[d * 3 + 1] - p[u * 3 + 1], bz = p[d * 3 + 2] - p[u * 3 + 2];
      // same orientation as the triangles' winding (down x across)
      let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
      const L = Math.hypot(nx, ny, nz) || 1;
      nrm[i * 3] = nx / L; nrm[i * 3 + 1] = ny / L; nrm[i * 3 + 2] = nz / L;
    }
  }

  // pins must be updated (pin.target) before calling. colliders: [{a, b, r}]
  update(dt, wind, colliders, iters = 6) {
    const H = 1 / 90;
    // teleport guard: carry the whole cloth along instead of dragging it across the world
    for (const pn of this.pins) {
      const i = pn.i * 3;
      const jump = Math.hypot(pn.target.x - this.p[i], pn.target.y - this.p[i + 1], pn.target.z - this.p[i + 2]);
      if (jump > 1.5) {
        this.shift(pn.target.x - this.p[i], pn.target.y - this.p[i + 1], pn.target.z - this.p[i + 2]);
        for (const q of this.pins) q.prev.copy(q.target);
        break;
      }
    }
    this._acc = Math.min(this._acc + dt, H * 4);
    const steps = Math.floor(this._acc / H);
    if (steps === 0) return;
    this._acc -= steps * H;
    this._frame = (this._frame || 0) + 1;
    for (let s = 0; s < steps; s++) {
      const f = (s + 1) / steps;
      for (const pn of this.pins) {
        const i = pn.i * 3;
        this.p[i] = pn.prev.x + (pn.target.x - pn.prev.x) * f;
        this.p[i + 1] = pn.prev.y + (pn.target.y - pn.prev.y) * f;
        this.p[i + 2] = pn.prev.z + (pn.target.z - pn.prev.z) * f;
      }
      this.step(H, wind, colliders, iters);
    }
    for (const pn of this.pins) pn.prev.copy(pn.target);
    this.normals();
    this.posAttr.needsUpdate = true; this.nrmAttr.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  step(h, wind, colliders, iters) {
    const { p, o, w, nrm, n, ca, cb, cr, ck, gy } = this;
    const nc = ca.length;
    const h2 = h * h, dr = this.drag, g = this.gravity, wk = this.windK;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0) continue;
      const k = i * 3;
      const vx = (p[k] - o[k]) * dr, vy = (p[k + 1] - o[k + 1]) * dr, vz = (p[k + 2] - o[k + 2]) * dr;
      o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2];
      // aerodynamic push: relative air speed along the surface normal
      const rx = wind.x - vx / h, ry = wind.y - vy / h, rz = wind.z - vz / h;
      const dn = (rx * nrm[k] + ry * nrm[k + 1] + rz * nrm[k + 2]) * wk;
      p[k] += vx + (nrm[k] * dn) * h2;
      p[k + 1] += vy + (g + nrm[k + 1] * dn) * h2;
      p[k + 2] += vz + (nrm[k + 2] * dn) * h2;
    }
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < nc; c++) {
        const ia = ca[c], ib = cb[c], a = ia * 3, b = ib * 3, rest = cr[c], kk = ck[c];
        const wa = w[ia], wb = w[ib], ws = wa + wb;
        if (ws === 0) continue;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (len - rest) / len * kk / ws;
        p[a] += dx * diff * wa; p[a + 1] += dy * diff * wa; p[a + 2] += dz * diff * wa;
        p[b] -= dx * diff * wb; p[b + 1] -= dy * diff * wb; p[b + 2] -= dz * diff * wb;
      }
      if (it === (iters >> 1) || it === iters - 1) this.collide(colliders);
    }
    // ground (height sampled once per frame per particle; cloth moves little between substeps)
    if (this._gyFresh !== this._frame) { this._gyFresh = this._frame; for (let i = 0; i < n; i++) gy[i] = groundY(p[i * 3], p[i * 3 + 2]) + 0.015 + (this.floor || 0); }
    for (let i = 0; i < n; i++) {
      if (w[i] === 0) continue;
      const k = i * 3, g = gy[i];
      if (p[k + 1] < g) { p[k + 1] = g; o[k] = p[k] - (p[k] - o[k]) * 0.3; o[k + 2] = p[k + 2] - (p[k + 2] - o[k + 2]) * 0.3; }
    }
  }

  collide(colliders) {
    const { p, w, n } = this, t = this.thick;
    // this cloth's bounds, to skip capsules that can't touch it
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < n * 3; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    for (const col of colliders) {
      const ax = col.a.x, ay = col.a.y, az = col.a.z;
      const abx = col.b.x - ax, aby = col.b.y - ay, abz = col.b.z - az;
      const ab2 = abx * abx + aby * aby + abz * abz || 1e-6;
      const r = col.r + t, r2 = r * r;
      if (Math.min(ax, col.b.x) - r > x1 || Math.max(ax, col.b.x) + r < x0 || Math.min(ay, col.b.y) - r > y1 || Math.max(ay, col.b.y) + r < y0 ||
          Math.min(az, col.b.z) - r > z1 || Math.max(az, col.b.z) + r < z0) continue;
      const cx = ax + abx * 0.5, cy = ay + aby * 0.5, cz = az + abz * 0.5, br = Math.sqrt(ab2) * 0.5 + r, br2 = br * br;
      for (let i = 0; i < n; i++) {
        if (w[i] === 0) continue;
        const k = i * 3;
        const qx = p[k] - cx, qy = p[k + 1] - cy, qz = p[k + 2] - cz;
        if (qx * qx + qy * qy + qz * qz > br2) continue;
        const px = p[k] - ax, py = p[k + 1] - ay, pz = p[k + 2] - az;
        let s = (px * abx + py * aby + pz * abz) / ab2; s = s < 0 ? 0 : s > 1 ? 1 : s;
        const dx = px - abx * s, dy = py - aby * s, dz = pz - abz * s;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r2 && d2 > 1e-10) {
          const d = Math.sqrt(d2), m = (r - d) / d;
          p[k] += dx * m; p[k + 1] += dy * m; p[k + 2] += dz * m;
        }
      }
    }
  }
}
