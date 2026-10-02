// What is inside Brackenford's houses. Each house that can be gone into is furnished here according to what it is:
// a home (a hearth with a fire and a pot over it, a table and chairs on a rug, beds with blankets, a chest, shelves
// of crockery, herbs hung from the beams, sometimes a spinning wheel), the inn (a bar with kegs and shelves of
// bottles, tables and benches, a fire, a candle wheel), the merchant's (a counter, shelves of goods, barrels, sacks,
// bolts of cloth), the bakery (a domed brick oven aglow, a kneading trough, racks of loaves), the smithy's showroom
// (racks of swords, axes and shields, armour on stands, a grindstone, a workbench) and the chapel (pews, an altar
// with candles, a lectern, banners). Everything goes into the village's merged meshes by material, the way the
// houses do; what stands in the way becomes a collider; where people sit, sleep, stand or work becomes a spot for
// the villagers; where fires burn is noted for their light and their sparks.
import * as THREE from 'three';
import { boxCollider } from './collide.js';
import { mulberry32 } from './util.js';

const PI = Math.PI;
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0, r1, h, x, y, z, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n).translate(x, y, z);
const DARK = 0x4a3524, MID = 0x7a5a3a, LIGHT = 0x9a7a52, IRON = 0x2e2e32;
const POT = [[[0, 0], [0.07, 0], [0.1, 0.05], [0.11, 0.13], [0.08, 0.2], [0.045, 0.25], [0.052, 0.28], [0.04, 0.285]],
  [[0, 0], [0.06, 0], [0.13, 0.04], [0.16, 0.09], [0.15, 0.095], [0.11, 0.05], [0, 0.05]],
  [[0, 0], [0.05, 0], [0.06, 0.12], [0.03, 0.2], [0.025, 0.27], [0.03, 0.28], [0, 0.28]]].map((p) => new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 10));
const CROCK = [0xb8643a, 0xe0d2b4, 0x5f84a8, 0x8a4a2a, 0x7a8a5a, 0xd8c8a8];
const BOOKS = [0x6a2a24, 0x2a3a5a, 0x3a5a2a, 0x7a5a2a, 0x4a2a4a];
const CLOTHS = [0x8a3a2a, 0x3a5a7a, 0x56683a, 0xa8844a, 0x6a4a6a, 0xd8c8a0];

export class Furnisher {
  constructor(V, B) {
    this.V = V; this.B = B;
    this.M0 = new THREE.Matrix4(); this.M1 = new THREE.Matrix4();
  }

  // ---------------------------------------------------------------- frames
  // furnish house h (one from Builder.house or .chapel) as `kind`
  furnish(h, kind) {
    this.h = h; this.rnd = mulberry32(Math.round(h.x * 13 + h.z * 7));
    this.IX = h.interior.hw; this.IZ = h.interior.hd;
    this.M0.makeRotationY(h.rot).setPosition(h.x, h.floor, h.z);
    h.spots = []; h.fires = []; h.lamps = []; h.ways = [];
    this[kind](h);
  }
  // put the next pieces at (lx, lz) in the house, turned lrot (their front, +z, faces (sin lrot, cos lrot))
  at(lx, lz, lrot = 0, ly = 0) {
    this.lx = lx; this.lz = lz; this.lrot = lrot;
    this.B.M.copy(this.M0).multiply(this.M1.makeRotationY(lrot).setPosition(lx, ly, lz));
    this.B.ground = this.h.floor - 3;        // no grime indoors
    return this;
  }
  add(bucket, g, color = 0xffffff, s = 0) { this.B.add(bucket, g, s, color); }
  // a point in the current piece's frame, in the world
  world(px, pz) {
    const c = Math.cos(this.lrot), s = Math.sin(this.lrot), lx = this.lx + px * c + pz * s, lz = this.lz - px * s + pz * c;
    const C = Math.cos(this.h.rot), S = Math.sin(this.h.rot);
    return [this.h.x + lx * C + lz * S, this.h.z - lx * S + lz * C];
  }
  // something in the way: a box hw by hd about (px, pz) in the current piece's frame, h high
  block(px, pz, hw, hd, h = 1) { const [x, z] = this.world(px, pz); this.V.colliders.push(boxCollider(x, z, hw, hd, this.h.rot + this.lrot, h)); }
  // a place for a villager: kind 'seat' | 'bed' | 'stand' | 'browse' | 'keeper', facing `lh` in the piece's frame
  spot(kind, px, pz, lh = 0, extra = {}) {
    const [x, z] = this.world(px, pz);
    const s = { kind, x, z, heading: this.h.rot + this.lrot + lh, house: this.h, inside: true, ...extra };
    // (where it is come at from, if not from where it is: beside a bed)
    if (extra.ax != null) s.ap = this.world(px + extra.ax, pz + extra.az);
    if (extra.y != null) s.y = this.h.floor + extra.y;
    this.h.spots.push(s);
    return s;
  }
  // a place to walk through (where the floor between furniture would otherwise have none), in the piece's frame
  way(px, pz) { this.h.ways.push(this.world(px, pz)); }
  // where a piece backed against wall `face` (0 front, 1 the +x end, 2 back, 3 the -x end) goes, `a` along it
  // (in the house's x for the front and back, its z for the ends), `off` out from it: [lx, lz, lrot]
  along(face, a, off) {
    const { IX, IZ } = this;
    if (face === 0) return [a, IZ - off, PI];
    if (face === 2) return [a, -IZ + off, 0];
    if (face === 1) return [IX - off, a, -PI / 2];
    return [-IX + off, a, PI / 2];
  }
  // is the wall clear of windows (and, on the front, of the door) for something `half` wide at a?
  free(face, a, half) {
    const h = this.h;
    for (const w of h.windows) {
      if (w.face !== face) continue;
      const wa = face === 0 || face === 3 ? w.u : -w.u;
      if (Math.abs(wa - a) < half + 0.5) return false;
    }
    if (face === 0 && Math.abs(a - h.doorway.u) < half + 0.95) return false;
    return true;
  }
  // the first of the given places along a wall that is free
  slot(face, list, half) { for (const a of list) if (this.free(face, a, half)) return a; return null; }
  // up to n places along a wall, each free and clear of the others, for things `half` wide (and clear of `avoid`:
  // [a, half] spans already taken)
  slots(face, half, n, avoid = []) {
    const L = face % 2 ? this.IZ : this.IX, out = [];
    for (let a = -L + half + 0.12; a <= L - half - 0.12 && out.length < n; a += 0.2) {
      if (!this.free(face, a, half)) continue;
      if (out.some((b) => Math.abs(a - b) < 2 * half + 0.1) || avoid.some(([b, hb]) => Math.abs(a - b) < half + hb + 0.1)) continue;
      out.push(a);
    }
    return out;
  }

  // ---------------------------------------------------------------- pieces (each at the current frame, facing +z)
  table(len = 1.5, dep = 0.85, ht = 0.76, col = MID) {
    this.add('wood', box(len, 0.06, dep, 0, ht - 0.03, 0), col, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add('wood', box(0.07, ht - 0.06, 0.07, sx * (len / 2 - 0.08), (ht - 0.06) / 2, sz * (dep / 2 - 0.08)), DARK, 1);
    this.add('wood', box(len - 0.2, 0.05, 0.05, 0, 0.18, 0), DARK, 1);
    this.block(0, 0, len / 2 + 0.05, dep / 2 + 0.05, ht);
  }
  chair(col = MID) {
    this.add('wood', box(0.42, 0.04, 0.42, 0, 0.45, 0), col, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add('wood', box(0.04, 0.45, 0.04, sx * 0.18, 0.225, sz * 0.18), DARK, 1);
    for (const sx of [-1, 1]) this.add('wood', box(0.045, 0.52, 0.045, sx * 0.18, 0.71, -0.19), DARK, 1);
    for (const y of [0.72, 0.88]) this.add('wood', box(0.36, 0.06, 0.03, 0, y, -0.19), col, 1);
  }
  stool() {
    this.add('wood', cyl(0.17, 0.16, 0.05, 0, 0.44, 0, 12), MID, 1);
    for (let k = 0; k < 3; k++) { const a = k / 3 * PI * 2; this.add('wood', box(0.04, 0.44, 0.04).rotateZ(0.12).rotateY(a).translate(Math.sin(a) * 0.1, 0.21, Math.cos(a) * 0.1), DARK, 1); }
  }
  bench(len = 1.5, back = false) {
    this.add('wood', box(len, 0.05, 0.3, 0, 0.44, 0), MID, 1);
    for (const sx of [-1, 1]) this.add('wood', box(0.06, 0.42, 0.26, sx * (len / 2 - 0.12), 0.21, 0), DARK, 1);
    if (back) {
      this.add('wood', box(len, 0.5, 0.04, 0, 0.78, -0.16).rotateX(0), MID, 1);
      for (const sx of [-1, 1]) this.add('wood', box(0.07, 0.95, 0.06, sx * (len / 2 - 0.04), 0.47, -0.15), DARK, 1);
    }
  }
  // a bed: its head at -z; double if wide
  bed(wide = 1.0, len = 2.0) {
    const rnd = this.rnd, blanket = CLOTHS[(rnd() * CLOTHS.length) | 0];
    this.add('wood', box(wide, 0.22, len, 0, 0.24, 0), DARK, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add('wood', box(0.08, 0.3, 0.08, sx * (wide / 2 - 0.04), 0.15, sz * (len / 2 - 0.04)), DARK, 1);
    this.add('wood', box(wide + 0.04, 0.95, 0.07, 0, 0.47, -len / 2), MID, 1);
    this.add('wood', box(wide + 0.04, 0.55, 0.07, 0, 0.3, len / 2), MID, 1);
    this.add('cloth', box(wide - 0.08, 0.16, len - 0.12, 0, 0.43, 0), 0xe8e0cc);
    this.add('cloth', new THREE.SphereGeometry(1, 10, 6).scale(wide * 0.36, 0.07, 0.17).translate(0, 0.55, -len / 2 + 0.28), 0xf4f0e6);
    this.add('cloth', box(wide - 0.02, 0.05, len * 0.62, 0, 0.53, len * 0.17), blanket);
    this.add('cloth', box(wide - 0.02, 0.06, 0.18, 0, 0.56, len * 0.17 - len * 0.31 + 0.09), new THREE.Color(blanket).multiplyScalar(1.15).getHex());
    this.block(0, 0, wide / 2 + 0.04, len / 2 + 0.04, 0.95);
  }
  chest() {
    this.add('wood', box(0.9, 0.42, 0.5, 0, 0.21, 0), 0x6a4a30, 1);
    this.add('wood', new THREE.CylinderGeometry(0.25, 0.25, 0.9, 10, 1, false, 0, PI).rotateZ(PI / 2).rotateX(-PI / 2).scale(1, 0.45, 1).translate(0, 0.42, 0), 0x6a4a30, 1);
    for (const x of [-0.3, 0.3]) this.add('iron', box(0.05, 0.44, 0.52, x, 0.22, 0), IRON);
    this.add('iron', box(0.08, 0.1, 0.02, 0, 0.36, 0.26), 0x8a7a4a);
    this.block(0, 0, 0.48, 0.28, 0.6);
  }
  // shelves against a wall, `n` boards, with what is on them: 'crockery', 'goods', 'books', 'bread', 'bottles'
  shelf(wide = 1.2, ht = 1.8, what = 'crockery', n = 4) {
    const rnd = this.rnd, dep = 0.34;
    for (const sx of [-1, 1]) this.add('wood', box(0.04, ht, dep, sx * wide / 2, ht / 2, 0), DARK, 1);
    this.add('wood', box(wide, ht, 0.02, 0, ht / 2, -dep / 2 + 0.01), 0x5a4430, 1);
    for (let k = 0; k < n; k++) {
      const y = 0.08 + k * (ht - 0.12) / (n - 1);
      this.add('wood', box(wide, 0.03, dep, 0, y, 0), MID, 1);
      if (k === n - 1 && ht > 1.6) continue;
      let x = -wide / 2 + 0.08;
      while (x < wide / 2 - 0.1) {
        const kind = what === 'goods' ? ['crockery', 'books', 'bottles', 'jars', 'cloth'][(rnd() * 5) | 0] : what;
        if (kind === 'books') { const t = 0.04 + rnd() * 0.03, hh = 0.18 + rnd() * 0.08; this.add('clay', box(t, hh, 0.2, x + t / 2, y + 0.015 + hh / 2, 0.02).rotateZ(rnd() < 0.15 ? 0.25 : 0), BOOKS[(rnd() * BOOKS.length) | 0]); x += t + 0.005; continue; }
        if (kind === 'bottles') { const c = rnd() < 0.5 ? 0x2a4a2a : 0x5a3a1a; this.add('clay', cyl(0.04, 0.04, 0.2, x + 0.05, y + 0.115, 0.03, 8), c); this.add('clay', cyl(0.012, 0.02, 0.08, x + 0.05, y + 0.255, 0.03, 6), c); x += 0.11; continue; }
        if (kind === 'bread') { this.add('flowers', new THREE.SphereGeometry(1, 10, 6, 0, PI * 2, 0, PI / 2).scale(0.13, 0.08, 0.08).translate(x + 0.13, y + 0.015, 0.02), rnd() < 0.5 ? 0xb87a3a : 0xc89048); x += 0.28; continue; }
        if (kind === 'cloth') { const c = CLOTHS[(rnd() * CLOTHS.length) | 0]; this.add('cloth', box(0.26, 0.1 + rnd() * 0.08, 0.26, x + 0.13, y + 0.08, 0.02), c); x += 0.29; continue; }
        if (kind === 'jars') { this.add('clay', cyl(0.06, 0.055, 0.16, x + 0.07, y + 0.095, 0.02, 10), 0xc8b898); this.add('cloth', cyl(0.065, 0.065, 0.02, x + 0.07, y + 0.18, 0.02, 10), 0xd8c8a0); x += 0.15; continue; }
        const g = POT[(rnd() * 3) | 0].clone(), s = 0.7 + rnd() * 0.4;
        this.add('clay', g.scale(s, s, s).translate(x + 0.1, y + 0.015, 0.02), CROCK[(rnd() * CROCK.length) | 0]); x += 0.22;
      }
    }
    this.block(0, 0, wide / 2 + 0.03, dep / 2 + 0.03, ht);
  }
  cupboard() {
    this.add('wood', box(1.1, 1.85, 0.5, 0, 0.925, 0), 0x6a4a30, 1);
    for (const sx of [-1, 1]) { this.add('wood', box(0.48, 1.0, 0.03, sx * 0.27, 1.2, 0.26), MID, 1); this.add('iron', box(0.03, 0.1, 0.03, sx * 0.05, 1.2, 0.29), IRON); }
    this.add('wood', box(1.0, 0.5, 0.03, 0, 0.38, 0.26), MID, 1);
    for (let k = 0; k < 3; k++) this.add('clay', cyl(0.12, 0.1, 0.03, -0.3 + k * 0.3, 1.87, 0, 14), 0xe0d2b4);
    this.block(0, 0, 0.58, 0.28, 1.9);
  }
  barrel(s = 1) {
    const prof = [[0.0, 0], [0.27, 0], [0.31, 0.2], [0.33, 0.42], [0.31, 0.66], [0.27, 0.86], [0, 0.86]].map(([r, h]) => new THREE.Vector2(r * s, h * s));
    this.add('wood', new THREE.LatheGeometry(prof, 14), 0x8a6a48, 0.6);
    for (const h of [0.14, 0.72]) this.add('iron', new THREE.TorusGeometry(0.31 * s, 0.014, 4, 18).rotateX(PI / 2).translate(0, h * s, 0), IRON);
    this.block(0, 0, 0.3 * s, 0.3 * s, 0.9 * s);
  }
  // barrels lying on a rack, with taps
  kegs(n = 3) {
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * 0.62, prof = [[0.0, 0], [0.22, 0], [0.26, 0.15], [0.27, 0.3], [0.26, 0.45], [0.22, 0.6], [0, 0.6]].map(([r, h]) => new THREE.Vector2(r, h));
      this.add('wood', new THREE.LatheGeometry(prof, 12).translate(0, -0.3, 0).rotateX(PI / 2).translate(x, 0.62, 0), 0x8a6a48, 0.6);
      this.add('iron', cyl(0.015, 0.015, 0.12, x, 0.62, 0.36, 6).rotateX(0), 0x8a7a4a);
    }
    this.add('wood', box(n * 0.62 + 0.1, 0.32, 0.5, 0, 0.18, 0), DARK, 1);
    this.block(0, 0, n * 0.31 + 0.05, 0.32, 0.9);
  }
  crate(s = 0.55) {
    this.add('wood', box(s, s, s, 0, s / 2, 0), 0x9a7a52, 1);
    for (const y of [0.04, s - 0.04]) this.add('wood', box(s + 0.02, 0.06, s + 0.02, 0, y, 0), 0x6a4a30, 1);
    this.block(0, 0, s / 2, s / 2, s);
  }
  sack(x = 0, z = 0) {
    this.add('cloth', new THREE.SphereGeometry(1, 10, 8).scale(0.22, 0.28, 0.18).translate(x, 0.25, z), this.rnd() < 0.5 ? 0xd8ccb0 : 0xc8b898);
    this.add('cloth', new THREE.ConeGeometry(0.08, 0.14, 8).translate(x, 0.56, z), 0xc8b898);
  }
  rug(wide, len, v = 0) {
    const g = new THREE.BoxGeometry(wide, 0.012, len).translate(0, 0.026, 0);
    g.applyMatrix4(this.B.M);
    this.V.rugs[v % this.V.rugs.length].push(g);
  }
  candle(x, y, z, tall = 0.14) {
    this.add('clay', cyl(0.022, 0.024, tall, x, y + tall / 2, z, 8), 0xf0e6cc);
    this.add('flame', new THREE.ConeGeometry(0.014, 0.05, 6).translate(x, y + tall + 0.03, z), 0xffffff);
    const [wx, wz] = this.world(x, z); this.h.lamps.push(new THREE.Vector3(wx, this.h.floor + y + tall + 0.03, wz));
  }
  // a fireplace against a wall: a stone hearth and cheeks, a beam for a lintel, the chimney breast up to the ceiling,
  // logs and coals and flames, a pot hung over them, and a shelf of things over all
  fireplace(ceil) {
    const S = 0xd8d0c0;
    this.add('stone', box(1.9, 0.12, 0.9, 0, 0.06, 0.05), 0xb8b0a0, 1.2);
    for (const sx of [-1, 1]) this.add('stone', box(0.35, 1.25, 0.7, sx * 0.78, 0.62, -0.05), S, 1.2);
    this.add('dark', box(1.25, 1.2, 0.08, 0, 0.62, -0.38), 0x1a1612);
    this.add('timber', box(1.95, 0.24, 0.32, 0, 1.36, 0.08), 0x3a2a1c, 1);
    this.add('wood', box(2.1, 0.06, 0.34, 0, 1.51, 0.08), MID, 1);
    this.add('stone', box(1.6, ceil - 1.48, 0.62, 0, (ceil + 1.48) / 2, -0.1), S, 1.2);
    // the fire
    for (let k = 0; k < 3; k++) this.add('wood', new THREE.CylinderGeometry(0.06, 0.06, 0.7, 7).rotateZ(PI / 2).rotateY(-0.5 + k * 0.5).translate(0, 0.2, -0.05), 0x5a3a24);
    this.add('coal', box(0.8, 0.05, 0.45, 0, 0.14, -0.08), 0xffffff);
    for (const [x, h, s] of [[0, 0.5, 0.14], [-0.18, 0.36, 0.1], [0.17, 0.4, 0.11], [0.06, 0.3, 0.08]]) this.add('flame', new THREE.ConeGeometry(s, h, 7).translate(x, 0.18 + h / 2, -0.05), 0xffffff);
    this.add('iron', new THREE.SphereGeometry(0.2, 12, 8, 0, PI * 2, PI / 2, PI / 2).translate(0, 0.78, -0.02), IRON);
    this.add('iron', cyl(0.008, 0.008, 0.45, 0, 1.0, -0.02, 4), IRON);
    for (const x of [-0.7, 0.75]) this.candle(x, 1.54, 0.12);
    this.add('clay', POT[0].clone().translate(-0.25, 1.54, 0.1), CROCK[1]);
    this.add('clay', POT[2].clone().translate(0.3, 1.54, 0.1), CROCK[3]);
    const [x, z] = this.world(0, 0); this.h.fires.push(new THREE.Vector3(x, this.h.floor + 0.45, z));
    this.block(0, -0.05, 0.98, 0.42, 2.5);
  }
  // bunches of herbs, garlic and onions hung from a beam at height y, across `len`
  herbs(len, y) {
    const rnd = this.rnd;
    this.add('dark', box(len, 0.02, 0.02, 0, y, 0), 0x6a5a40);
    for (let k = 0; k < Math.floor(len / 0.22); k++) {
      const x = -len / 2 + 0.11 + k * 0.22, kind = rnd();
      this.add('dark', box(0.008, 0.12, 0.008, x, y - 0.06, 0), 0x6a5a40);
      if (kind < 0.5) this.add('flowers', new THREE.ConeGeometry(0.06, 0.24, 6).rotateX(PI).translate(x, y - 0.22, 0), rnd() < 0.5 ? 0x5a7a3a : 0x7a8a4a);
      else this.add('flowers', new THREE.SphereGeometry(0.045, 8, 6).translate(x, y - 0.16, 0), kind < 0.75 ? 0xe8e0d0 : 0xb8783a);
    }
  }
  // a wheel of candles hung from the ceiling on chains
  chandelier(y) {
    this.add('iron', new THREE.TorusGeometry(0.45, 0.025, 6, 24).rotateX(PI / 2).translate(0, y, 0), IRON);
    for (let k = 0; k < 4; k++) { const a = k / 4 * PI * 2 + PI / 4; this.add('iron', cyl(0.006, 0.006, 0.9, Math.sin(a) * 0.22, y + 0.45, Math.cos(a) * 0.22, 4).rotateX(0), IRON); }
    for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2; this.candle(Math.sin(a) * 0.45, y + 0.02, Math.cos(a) * 0.45, 0.1); }
  }
  counter(len, ht = 1.02) {
    this.add('wood', box(len, ht - 0.05, 0.55, 0, (ht - 0.05) / 2, 0), 0x6a4a30, 1);
    this.add('wood', box(len + 0.1, 0.05, 0.65, 0, ht - 0.025, 0), MID, 1);
    for (let k = 0; k <= Math.floor(len / 0.6); k++) this.add('wood', box(0.05, ht - 0.12, 0.02, -len / 2 + 0.05 + k * (len - 0.1) / Math.floor(len / 0.6), (ht - 0.05) / 2, 0.285), DARK, 1);
    this.block(0, 0, len / 2 + 0.05, 0.33, ht);
  }
  mugs(len, y, n) { for (let k = 0; k < n; k++) this.add('clay', cyl(0.045, 0.04, 0.11, -len / 2 + (k + 0.5) * len / n, y + 0.055, (this.rnd() - 0.5) * 0.2, 10), this.rnd() < 0.5 ? 0x8a5a3a : 0xc8b898); }
  plates(len, dep, y, n) {
    for (let k = 0; k < n; k++) {
      const x = -len / 2 + (k + 0.5) * len / n, z = (k % 2 ? 1 : -1) * dep * 0.28;
      this.add('clay', cyl(0.11, 0.09, 0.02, x, y + 0.01, z, 14), 0xe0d2b4);
      if (this.rnd() < 0.5) this.add('flowers', new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.6, 1).translate(x, y + 0.035, z), 0xc8823a);
    }
  }
  spinningWheel() {
    this.add('wood', new THREE.TorusGeometry(0.32, 0.025, 6, 24).rotateY(PI / 2).translate(0, 0.62, 0.2), MID, 1);
    for (let k = 0; k < 6; k++) this.add('wood', box(0.015, 0.62, 0.015).rotateX(k / 6 * PI).translate(0, 0.62, 0.2), DARK, 1);
    this.add('wood', box(0.12, 0.08, 0.9, 0, 0.42, 0), MID, 1);
    for (const [z, h] of [[-0.35, 0.42], [0.35, 0.42], [0.2, 0.95]]) for (const sx of [-1, 1]) this.add('wood', box(0.03, h, 0.03, sx * 0.06, h / 2, z), DARK, 1);
    this.add('cloth', new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8).rotateZ(PI / 2).translate(0, 0.7, -0.3), 0xe8dcc0);
    this.block(0, 0, 0.2, 0.5, 1);
  }
  broom() {
    this.add('wood', cyl(0.015, 0.015, 1.3, 0, 0.75, 0, 6).rotateX(0.18).translate(0, 0, 0.12), LIGHT, 1);
    this.add('flowers', new THREE.ConeGeometry(0.12, 0.35, 8).translate(0, 0.17, 0.0), 0xb8a060);
  }
  // weapons on the wall: swords, axes and shields on a rack
  weaponRack(wide = 1.6) {
    this.add('wood', box(wide, 0.08, 0.1, 0, 1.75, 0.0), DARK, 1);
    this.add('wood', box(wide, 0.08, 0.16, 0, 0.35, 0.04), DARK, 1);
    for (const sx of [-1, 1]) this.add('wood', box(0.08, 1.8, 0.1, sx * wide / 2, 0.9, 0), DARK, 1);
    const n = Math.floor(wide / 0.32);
    for (let k = 0; k < n; k++) {
      const x = -wide / 2 + 0.2 + k * (wide - 0.3) / (n - 1);
      if (k % 3 === 2) {
        // an axe
        this.add('wood', cyl(0.018, 0.02, 1.1, x, 0.95, 0.07, 6), LIGHT, 1);
        this.add('iron', box(0.03, 0.18, 0.2, x, 1.38, 0.15), 0x8a8a90);
      } else {
        this.add('iron', box(0.05, 0.9, 0.012, x, 0.95, 0.08), 0xb8b8c0);
        this.add('iron', box(0.2, 0.03, 0.03, x, 1.42, 0.08), 0x6a5a3a);
        this.add('wood', cyl(0.018, 0.018, 0.16, x, 1.52, 0.08, 6), 0x3a2418, 1);
        this.add('iron', new THREE.SphereGeometry(0.025, 6, 4).translate(x, 1.61, 0.08), 0x8a7a4a);
      }
    }
    this.block(0, 0.05, wide / 2 + 0.05, 0.14, 1.9);
  }
  shield(x, y, z, col) {
    this.add('clay', cyl(0.3, 0.3, 0.04, 0, 0, 0, 18).rotateX(PI / 2).translate(x, y, z), col);
    this.add('iron', new THREE.SphereGeometry(0.07, 10, 6).scale(1, 1, 0.6).translate(x, y, z + 0.02), 0x8a8a90);
    this.add('iron', new THREE.TorusGeometry(0.3, 0.018, 4, 20).translate(x, y, z), 0x5a5a60);
  }
  armour() {
    this.add('wood', box(0.36, 0.06, 0.36, 0, 0.03, 0), DARK, 1);
    this.add('wood', box(0.05, 1.3, 0.05, 0, 0.68, 0), DARK, 1);
    this.add('iron', cyl(0.2, 0.16, 0.55, 0, 1.15, 0, 12).scale(1, 1, 0.75), 0x8a8a92);
    this.add('iron', new THREE.SphereGeometry(0.21, 12, 6, 0, PI * 2, 0, PI / 2).scale(1.15, 0.4, 0.85).translate(0, 1.4, 0), 0x7a7a82);
    this.add('iron', new THREE.SphereGeometry(0.12, 12, 8).scale(1, 1.15, 1).translate(0, 1.66, 0), 0x8a8a92);
    this.add('dark', box(0.14, 0.02, 0.02, 0, 1.68, 0.115), 0x1a1a1a);
    this.add('cloth', cyl(0.2, 0.26, 0.3, 0, 0.78, 0, 12).scale(1, 1, 0.75), 0x6a2a24);
    this.block(0, 0, 0.25, 0.22, 1.8);
  }
  grindstone() {
    this.add('stone', cyl(0.32, 0.32, 0.1, 0, 0, 0, 18).rotateZ(PI / 2).translate(0, 0.62, 0), 0xa8a090, 0.8);
    for (const sx of [-1, 1]) this.add('wood', box(0.06, 0.62, 0.08, sx * 0.1, 0.31, 0), DARK, 1);
    this.add('wood', box(0.3, 0.06, 0.9, 0, 0.3, 0.1), MID, 1);
    this.add('wood', box(0.05, 0.05, 0.5, 0, 0.5, 0.45).rotateX(-0.3), MID, 1);
    this.block(0, 0.05, 0.3, 0.5, 0.9);
  }
  workbench(len = 1.8) {
    this.add('wood', box(len, 0.1, 0.7, 0, 0.85, 0), LIGHT, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add('wood', box(0.1, 0.8, 0.1, sx * (len / 2 - 0.1), 0.4, sz * 0.25), DARK, 1);
    this.add('wood', box(len - 0.2, 0.04, 0.6, 0, 0.25, 0), MID, 1);
    this.add('iron', box(0.16, 0.12, 0.12, len / 2 - 0.2, 0.96, 0.3), IRON);
    for (let k = 0; k < 4; k++) this.add('iron', box(0.03 + k * 0.01, 0.025, 0.28, -0.6 + k * 0.25, 0.92, -0.1 + (k % 2) * 0.15).rotateY(0.2 * k), k % 2 ? IRON : 0x6a4a30);
    this.block(0, 0, len / 2 + 0.05, 0.4, 1);
  }
  // the baker's oven: a brick block with a dome over it, its mouth aglow, the flue up to the ceiling
  oven(ceil) {
    const BR = 0xa85a3a;
    this.add('clay', box(2.0, 0.9, 1.5, 0, 0.45, 0), BR);
    this.add('clay', new THREE.SphereGeometry(0.9, 16, 8, 0, PI * 2, 0, PI / 2).scale(1.05, 0.75, 0.78).translate(0, 0.9, -0.05), 0xb8643a);
    this.add('dark', box(0.7, 0.45, 0.06, 0, 1.12, 0.62), 0x1a1210);
    this.add('coal', box(0.62, 0.05, 0.05, 0, 0.93, 0.62), 0xffffff);
    for (const [x, h] of [[-0.12, 0.22], [0.1, 0.26], [0.0, 0.18]]) this.add('flame', new THREE.ConeGeometry(0.07, h, 6).translate(x, 0.95 + h / 2, 0.6), 0xffffff);
    this.add('stone', box(0.85, 0.08, 0.3, 0, 0.92, 0.82), 0xb8b0a0, 1.2);
    this.add('clay', box(0.45, ceil - 1.4, 0.45, 0, (ceil + 1.4) / 2, -0.3), BR);
    const [x, z] = this.world(0, 0.6); this.h.fires.push(new THREE.Vector3(x, this.h.floor + 1.05, z));
    this.block(0, 0, 1.05, 0.8, 2);
  }
  trough(len = 1.6) {
    this.table(len, 0.75, 0.8, LIGHT);
    for (let k = 0; k < 4; k++) this.add('flowers', new THREE.SphereGeometry(1, 10, 6).scale(0.14, 0.06, 0.12).translate(-len / 2 + 0.3 + k * 0.33, 0.83, (k % 2) * 0.12 - 0.06), 0xf0e2c4);
    this.add('cloth', box(0.5, 0.01, 0.4, len / 2 - 0.3, 0.805, 0), 0xf4ecd8);
  }
  pew(len = 2.2) { this.bench(len, true); this.block(0, 0, len / 2, 0.22, 1); }
  altar() {
    this.add('stone', box(1.7, 0.95, 0.85, 0, 0.475, 0), 0xe8e2d4, 1.2);
    this.add('cloth', box(1.74, 0.02, 0.89, 0, 0.96, 0), 0xf4f0e6);
    this.add('cloth', box(0.5, 0.7, 0.9, 0, 0.64, 0.0), 0x8a1a24);
    this.add('clay', box(0.3, 0.04, 0.22, 0.1, 0.99, 0.05).rotateY(0.1), 0x6a2a24);
    this.add('clay', box(0.28, 0.01, 0.2, 0.1, 1.015, 0.05).rotateY(0.1), 0xf0e8d0);
    for (const sx of [-1, 1]) { this.add('iron', cyl(0.05, 0.08, 0.32, sx * 0.62, 1.12, -0.1, 10), 0xb89a4a); this.candle(sx * 0.62, 1.28, -0.1, 0.22); }
    this.block(0, 0, 0.9, 0.48, 1.2);
  }
  candleStand() {
    this.add('iron', cyl(0.025, 0.03, 1.4, 0, 0.7, 0, 8), 0xb89a4a);
    this.add('iron', cyl(0.18, 0.2, 0.04, 0, 0.02, 0, 10), 0xb89a4a);
    this.add('iron', cyl(0.09, 0.05, 0.06, 0, 1.42, 0, 10), 0xb89a4a);
    this.candle(0, 1.45, 0, 0.26);
  }
  lectern() {
    this.add('wood', box(0.1, 1.05, 0.1, 0, 0.52, 0), DARK, 1);
    this.add('wood', box(0.4, 0.06, 0.4, 0, 0.03, 0), DARK, 1);
    this.add('wood', box(0.55, 0.04, 0.42, 0, 1.12, 0).rotateX(0.35), MID, 1);
    this.add('clay', box(0.42, 0.03, 0.3, 0, 1.16, 0.0).rotateX(0.35), 0xf0e8d0);
  }
  banner(col, ht = 1.6) {
    this.add('iron', new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6).rotateZ(PI / 2).translate(0, ht + 0.1, 0.05), 0x6a5a3a);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.35, ht, 0.06, 0.35, ht, 0.06, -0.35, ht - 1.2, 0.06, 0.35, ht - 1.2, 0.06, 0, ht - 1.45, 0.06], 3));
    g.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3]); g.computeVertexNormals();
    this.add('flags', g, col);
    this.add('flags', new THREE.CircleGeometry(0.16, 16).translate(0, ht - 0.55, 0.065), 0xd8b84a);
  }

  // ---------------------------------------------------------------- the rooms
  // the end wall with the hearth is h.hearth (it has no windows downstairs); the door is in the front wall at
  // h.doorway.u; nothing is put in the way in from the door
  home(h) {
    const { IX, IZ } = this, rnd = this.rnd, hf = h.hearth, side = hf === 1 ? 1 : -1, ceil = h.interior.ceil, opp = hf === 1 ? 3 : 1;
    // the hearth, and room to stand before it
    let [x, z, r] = this.along(hf, 0, 0.35);
    this.at(x, z, r).fireplace(ceil);
    this.spot('stand', 0, 0.95, PI);
    // the table, on a rug, with chairs and a stool round it
    const tx = side * IX * 0.14, tz = IZ * 0.12;
    this.at(tx, tz, 0).rug(2.4, 1.9, (rnd() * 3) | 0);
    this.at(tx, tz, 0).table(1.4, 0.8);
    this.plates(1.2, 0.8, 0.76, 3);
    this.candle(0.1, 0.76, 0.05);
    for (const sz of [-1, 1]) { this.at(tx + 0.3 * sz, tz + sz * 0.68, sz > 0 ? PI : 0).chair(); this.spot('seat', 0, 0.05, 0, { y: 0.47, from: -1 }); }
    this.at(tx - side * 1.0, tz, side > 0 ? PI / 2 : -PI / 2).stool(); this.spot('seat', 0, 0, 0, { y: 0.47, from: -1 });
    this.at(tx, tz, 0).herbs(1.3, ceil - 0.25);
    // beds along the back in the far corner from the hearth, heads to the wall, come at from their feet
    const nb = IX * 2 > 6.4 ? 2 : 1, bw = nb === 2 ? 0.95 : 1.35, gap = 0.6;
    for (let k = 0; k < nb; k++) {
      const bx = -side * (IX - 0.15 - bw / 2 - k * (bw + gap));
      this.at(bx, -IZ + 1.02, 0).bed(bw);
      this.spot('bed', 0, 0.1, 0, { y: 0.58, ax: 0, az: 1.35 });
    }
    // a chest against the end wall, shelves or a cupboard on the back wall between the beds and the hearth, or on
    // the front wall
    [x, z, r] = this.along(opp, 0.9, 0.3); this.at(x, z, r).chest();
    const bedA = -side * (IX - 0.15 - nb * (bw + gap) / 2), bedHalf = nb * (bw + gap) / 2;
    const [sa] = this.slots(2, 0.6, 1, [[bedA, bedHalf], [side * (IX - 0.4), 0.5]]);
    if (sa != null) { [x, z, r] = this.along(2, sa, 0.2); this.at(x, z, r); if (rnd() < 0.5) this.shelf(1.2, 1.8, 'crockery'); else this.cupboard(); }
    const fa = this.slot(0, [side * (IX - 0.9), -side * (IX - 0.9), 0], 0.6);
    if (fa != null) { [x, z, r] = this.along(0, fa, 0.2); this.at(x, z, r).shelf(1.1, 1.5, 'crockery', 3); }
    // odds and ends: a barrel and sacks by the hearth, a broom by the door, sometimes a spinning wheel by the window
    [x, z, r] = this.along(hf, IZ - 0.55, 0.45); this.at(x, z, r).barrel(0.9);
    [x, z, r] = this.along(hf, -IZ + 0.5, 0.4); this.at(x, z, r).sack(0, 0); this.sack(0.35, 0.1);
    this.at(h.doorway.u + (h.doorway.u > 0 ? -0.9 : 0.9), IZ - 0.15, PI).broom();
    if (rnd() < 0.5 && Math.abs(side * (IX - 1.5) - h.doorway.u) > 1.8) this.at(side * (IX - 1.5), IZ - 0.8, side * PI / 2).spinningWheel();
  }

  inn(h) {
    const { IX, IZ } = this, ceil = h.interior.ceil, side = h.hearth === 1 ? 1 : -1;
    // the bar along the back, kegs and shelves of bottles behind it, the barkeep between
    const bx = side * (IX - 3.2), bz = -IZ + 1.75;
    this.at(bx, bz, 0).counter(3.4);
    this.mugs(3.0, 1.02, 7);
    this.at(bx - side * 0.6, -IZ + 0.3, 0).kegs(3);
    const [sh] = this.slots(2, 0.5, 4, [[bx - side * 0.6, 1.0], [bx - side * 1.9, 0.35]]).filter((a) => Math.abs(a - bx) < 2.4);
    if (sh != null) { const [x, z, r] = this.along(2, sh, 0.2); this.at(x, z, r).shelf(1.0, 2.0, 'bottles', 5); }
    this.at(bx, bz, 0); this.spot('keeper', 0, -0.62, 0, { post: 'bar' });
    for (const u of [-1.0, 0.1, 1.2]) this.spot('browse', u, 0.95, PI);
    this.at(bx - side * 1.9, -IZ + 0.45, 0).barrel();
    // the fire at the end, a bench before it
    let [x, z, r] = this.along(h.hearth, 1.1, 0.35);
    this.at(x, z, r).fireplace(ceil);
    this.spot('stand', 0.6, 1.2, PI);
    // tables and benches
    const tables = [[-side * (IX - 2.3), -0.9, PI / 2], [side * 0.2, 0.55, 0], [side * (IX - 3.6), 1.7, 0]];
    for (const [x, z, r] of tables) {
      if (Math.abs(x - h.doorway.u) < 1.4 && z > IZ - 2.4) continue;
      this.at(x, z, r).table(1.6, 0.85);
      this.mugs(1.2, 0.76, 3); this.candle(0, 0.76, 0);
      for (const sz of [-1, 1]) {
        this.at(x, z, r); const [wx, wz] = [0, sz * 0.72];
        this.at(...this.local(wx, wz), r + (sz > 0 ? PI : 0)).bench(1.5);
        for (const u of [-0.4, 0.4]) this.spot('seat', u, 0, 0, { y: 0.46, from: -1 });
      }
    }
    this.at(side * 0.2, 0.55, 0).chandelier(ceil - 0.9);
    this.at(-side * (IX - 0.4), -IZ + 0.4, PI / 4).barrel();
    // shields and a banner on the walls
    [x, z, r] = this.along(h.hearth, -1.6, 0.04); this.at(x, z, r).shield(0, 2.0, 0, 0x6a2a24);
    [x, z, r] = this.along(h.hearth, 2.6, 0.04); this.at(x, z, r).shield(0, 2.0, 0, 0x2a4a6a);
  }
  // the current piece's point (px, pz) in the house's own frame
  local(px, pz) { const c = Math.cos(this.lrot), s = Math.sin(this.lrot); return [this.lx + px * c + pz * s, this.lz - px * s + pz * c]; }

  goods(h) {
    const { IX, IZ } = this, rnd = this.rnd, side = h.hearth === 1 ? 1 : -1;
    // the counter across the room, Agnes behind it
    this.at(-side * 0.4, -0.75, 0).counter(2.6);
    this.add('clay', box(0.3, 0.12, 0.2, -0.6, 1.08, 0), 0x8a6a3a);
    for (const sx of [-1, 1]) this.add('iron', box(0.22, 0.01, 0.12, 0.6 + sx * 0.17, 1.1, 0), 0x9a8a5a);
    this.add('iron', box(0.02, 0.25, 0.02, 0.6, 1.15, 0), 0x9a8a5a);
    this.spot('keeper', 0, -0.7, 0, { post: 'counter' });
    this.spot('browse', 0.3, 0.85, PI);
    // shelves of everything along the back and the windowless end
    for (const a of this.slots(2, 0.6, 3)) { const [x, z, r] = this.along(2, a, 0.2); this.at(x, z, r).shelf(1.2, 2.0, 'goods', 5); }
    for (const a of [-1.5, 0, 1.5]) { const [x, z, r] = this.along(h.hearth, a, 0.2); this.at(x, z, r).shelf(1.3, 2.0, 'goods', 5); this.spot('browse', 0, 0.75, 0); }
    // barrels, sacks and crates by the door's side, bolts of cloth on a table, rope
    const other = h.hearth === 1 ? 3 : 1;
    let [x, z, r] = this.along(other, IZ - 0.6, 0.45);
    this.at(x, z, r).barrel();
    [x, z, r] = this.along(other, -IZ + 0.6, 0.4); this.at(x, z, r).crate(); this.sack(0.55, 0.1); this.sack(0.3, 0.45);
    this.at(side * (IX - 1.6), 1.6, PI / 2).table(1.2, 0.7);
    for (let k = 0; k < 4; k++) this.add('cloth', box(0.25, 0.12, 0.6, -0.4 + k * 0.27, 0.82, 0), CLOTHS[(rnd() * CLOTHS.length) | 0]);
    this.spot('browse', 0, 0.8, PI);
    this.add('flowers', new THREE.TorusGeometry(0.16, 0.05, 6, 14).rotateX(PI / 2).translate(0.35, 0.8, 0), 0xb8a070);
  }

  bakery(h) {
    const { IX, IZ } = this, rnd = this.rnd, side = h.hearth === 1 ? 1 : -1, ceil = h.interior.ceil;
    let [x, z, r] = this.along(h.hearth, -0.3, 0.8);
    this.at(x, z, r).oven(ceil);
    this.spot('stand', 0.6, 1.4, PI);
    // the kneading trough, where Pip works
    this.at(-side * 0.1, -0.9, 0).trough(1.7);
    this.spot('keeper', 0, -0.75, 0, { post: 'trough' });
    // racks of loaves along the back
    for (const a of this.slots(2, 0.6, 3, [[side * (IX - 0.8), 1.0]])) { [x, z, r] = this.along(2, a, 0.2); this.at(x, z, r).shelf(1.2, 1.8, 'bread', 5); }
    // the counter by the door, with baskets of bread on it
    const cx = h.doorway.u - side * 0.2;
    this.at(Math.max(-IX + 1.5, Math.min(IX - 1.5, cx - side * 1.6)), 0.9, 0).counter(1.8);
    for (let k = 0; k < 2; k++) {
      const u = -0.45 + k * 0.9;
      this.add('flowers', new THREE.CylinderGeometry(0.26, 0.2, 0.14, 14, 1, true).translate(u, 1.09, 0), 0xa88a52);
      for (let n = 0; n < 3; n++) this.add('flowers', new THREE.SphereGeometry(1, 10, 6, 0, PI * 2, 0, PI / 2).scale(0.12, 0.07, 0.07).rotateY(rnd() * 3).translate(u + (rnd() - 0.5) * 0.2, 1.12, (rnd() - 0.5) * 0.2), 0xb87a3a);
    }
    this.spot('browse', 0, 0.85, PI);
    // flour sacks and firewood by the oven
    [x, z, r] = this.along(h.hearth, IZ - 0.7, 0.5); this.at(x, z, r); for (let k = 0; k < 3; k++) this.sack(-0.3 + k * 0.32, (k % 2) * 0.2);
    [x, z, r] = this.along(h.hearth, -IZ + 0.6, 0.5); this.at(x, z, r);
    for (let rr = 0; rr < 3; rr++) for (let k = 0; k < 4 - rr; k++) this.add('wood', new THREE.CylinderGeometry(0.08, 0.08, 0.7, 7).rotateX(PI / 2).translate(-0.36 + k * 0.17 + rr * 0.085, 0.09 + rr * 0.15, 0), 0xa88a62, 0.5);
    this.block(0, 0, 0.4, 0.4, 0.5);
  }

  smithy(h) {
    const { IX, IZ } = this, side = h.hearth === 1 ? 1 : -1;
    // weapons along the back wall, a workbench at the end, armour and a grindstone
    for (const a of this.slots(2, 0.85, 3)) { const [x, z, r] = this.along(2, a, 0.15); this.at(x, z, r).weaponRack(1.6); this.spot('browse', 0, 1.0, 0); }
    let [x, z, r] = this.along(h.hearth, -0.6, 0.4); this.at(x, z, r).workbench(2.0);
    this.spot('keeper', 0, 0.75, PI, { post: 'bench' });
    [x, z, r] = this.along(h.hearth, IZ - 0.5, 0.05);
    this.at(x, z, r); for (const [u, y, c] of [[-0.6, 1.9, 0x6a2a24], [0.1, 2.1, 0x2a4a6a]]) this.shield(u, y, 0, c);
    this.at(side * 0.3, -IZ + 1.9, 0).armour();
    this.at(side * 1.3, -IZ + 1.9, 0).armour();
    this.at(-side * (IX - 1.0), 0.6, side * PI / 2).grindstone();
    this.at(side * (IX - 1.2), IZ - 1.0, 0).crate(); this.crate(0.45);
    this.at(-side * (IX - 0.5), -IZ + 0.5, 0).barrel();
    this.at(side * 0.8, 0.4, 0).table(1.4, 0.8);
    for (let k = 0; k < 5; k++) this.add('iron', box(0.12, 0.05, 0.3, -0.5 + k * 0.25, 0.78, 0).rotateY(0.3), 0x8a8a90);
    this.spot('browse', 0, 0.8, PI);
  }

  chapel(h) {
    const { IX, IZ } = this, rnd = this.rnd;
    // the altar at the far end, candles round it, the lectern, the priest before it
    this.at(0, -IZ + 0.75, 0).altar();
    this.at(0, -IZ + 0.75, 0); this.spot('keeper', 0, 1.0, 0, { post: 'altar' });
    for (const sx of [-1, 1]) { this.at(sx * 1.4, -IZ + 0.6, 0).candleStand(); }
    this.at(1.7, -IZ + 2.2, -PI / 2 - 0.3).lectern();
    this.at(0, -IZ + 0.25, 0).banner(0x8a1a24, 3.2);
    // a runner down the aisle, pews either side facing the altar
    this.at(0, 0.6, 0).rug(1.0, IZ * 2 - 2.2, 3);
    for (let k = 0; k < 5; k++) for (const sx of [-1, 1]) {
      const z = -IZ + 3.0 + k * 1.25;
      if (z > IZ - 1.4) continue;
      this.at(sx * 1.55, z, PI).pew(2.0);
      for (const u of [-0.5, 0.5]) if (rnd() < 0.8) this.spot('seat', u, 0, 0, { y: 0.46, from: -1 });
      if (sx > 0) { this.at(0, z, 0); this.way(0, 0.62); this.way(0, -0.62); }
    }
    // banners down the walls between the windows
    for (const sx of [-1, 1]) for (const z of [-IZ * 0.62, IZ * 0.1]) { const [x, zz, r] = this.along(sx > 0 ? 1 : 3, z, 0.04); this.at(x, zz, r).banner(sx > 0 ? 0x1e3a6a : 0x2f5a2a, 3.4); }
  }
}
