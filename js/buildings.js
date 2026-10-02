// Houses for the village, made from parts: a stone ground floor (whitewashed rubble on a buried footing), an upper
// floor in stone or in lime plaster framed with dark timber and jettied out over the street, gables, a steep roof of
// clay tiles with a ridge of round tiles, eaves and bargeboards, dormers, chimneys, an arched plank door in a stone
// surround, leaded windows with frames, sills, shutters and flower boxes, a timber gallery on posts, and a square
// tower with a pyramid roof. Everything is gathered into buckets by material (Builder.parts) so the whole village
// draws in a handful of merged meshes; each house reports what the village needs to know of it (its collider,
// where its door is, where its chimneys smoke).
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { groundY } from './world.js';
import { mulberry32 } from './util.js';
import { boxCollider } from './collide.js';

const BUCKETS = ['stone', 'plaster', 'timber', 'roof', 'ridge', 'wood', 'door', 'window', 'windowDark', 'windowIn', 'shutter', 'iron', 'flowers', 'cloth', 'dark', 'water', 'glow', 'coal', 'clay', 'flame', 'stained', 'flags'];
// a house you can go into: its ground-floor walls are WALL thick and lined with plaster; the doorway is an arch,
// DOORWAY.r either side of the middle, springing at DOORWAY.hs (so it is hs + r high in the middle)
export const WALL = 0.3, LINING = 0.05;
export const DOORWAY = { r: 0.64, hs: 1.6, leaf: 0.62 };
const SHUTTERS = [0x4d6f8a, 0x6a7d4a, 0x8a3e30, 0x5a4a3a, 0x3e5a6a];
const FLOWERS = [0x9a5ac8, 0xc84a6a, 0xe8d050, 0xf2f0e8, 0xd86a3a];

// planar texture coordinates for each face of a piece, from its own (local) position: walls by their run and
// height, floors and tops by their plan; `s` metres to the texture
function planar(g, s) {
  g = g.index ? g.toNonIndexed() : g;
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) { uv[i * 2] = x / s; uv[i * 2 + 1] = z / s; }
    else if (ax >= az) { uv[i * 2] = z / s; uv[i * 2 + 1] = y / s; }
    else { uv[i * 2] = x / s; uv[i * 2 + 1] = y / s; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export class Builder {
  constructor() {
    this.parts = {}; for (const b of BUCKETS) this.parts[b] = [];
    this.M = new THREE.Matrix4();
  }

  // a piece in the current house's frame: textured by plan (`s` metres a tile; 0 keeps its own UVs), tinted
  // `color`, darkened near the ground (grime), and moved into the world
  add(bucket, g, s = 2.5, color = 0xffffff) {
    g = s ? planar(g, s) : (g.index ? g.toNonIndexed() : g);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(this.M);
    const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      const up = p.getY(i) - this.ground, k = 0.62 + 0.38 * Math.min(1, Math.max(0, (up + 0.2) / 1.4));
      c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    this.parts[bucket].push(g);
  }

  // work from here on in a frame at (x, z) on the ground (or at height y), turned by rot
  place(x, z, rot = 0, y = groundY(x, z)) { this.ground = y; this.M.makeRotationY(rot).setPosition(x, y, z); return this; }

  // a flat piece of roof: `w` along x, `l` down the slope from (0, y, z0) toward +z at pitch `p` (facing up, or
  // facing down for its underside)
  slope(w, l, p, x, y, z0, flip, s = 2, under = false) {
    const g = new THREE.PlaneGeometry(w, l, 1, 1), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / s, uv.getY(i) * l / s);
    if (under) g.rotateY(Math.PI);
    g.rotateX(-(Math.PI / 2 - p));
    g.translate(x, y - Math.sin(p) * l / 2, z0 + Math.cos(p) * l / 2);
    if (flip) g.rotateY(Math.PI);
    return g;
  }

  // ---------------------------------------------------------------- a house
  // spec: { x, z, rot (radians: its front faces (sin rot, cos rot)), w (along its front), d (front to back),
  //   floors (1 or 2), upper ('stone' | 'timber'), pitch, door (offset along the front), seed, dormers, chimneys
  //   ([[x, z] in its own frame]), balcony, flowers, windows ('few' | 'many') }
  house(spec) {
    const S = Object.assign({ floors: 2, upper: 'stone', pitch: 0.82, floorH: 2.9, door: 0, seed: 1, dormers: 0, chimneys: [], balcony: false, rot: 0, overhang: 0.45, open: true }, spec);
    const rnd = mulberry32(S.seed * 7919), { w, d, floorH: fh, pitch: p } = S;
    // the floor is at the highest ground under it; the walls go down past the lowest
    let lo = Infinity, hi = -Infinity;
    const c = Math.cos(S.rot), s = Math.sin(S.rot);
    const world = (lx, lz) => [S.x + lx * c + lz * s, S.z - lx * s + lz * c];
    for (let i = -1; i <= 1; i += 0.5) for (let j = -1; j <= 1; j += 0.5) { const [x, z] = world(i * w / 2, j * d / 2); const y = groundY(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    // (a house that can be gone into stands on ground levelled for it, and its floor is the ground)
    const fl = S.open ? hi : hi + 0.08;
    this.ground = lo; this.M.makeRotationY(S.rot).setPosition(S.x, fl, S.z);
    const shutter = SHUTTERS[(rnd() * SHUTTERS.length) | 0], down = fl - lo + 0.9, tint = S.tint ?? 0xffffff;
    const timber = S.floors > 1 && S.upper === 'timber', jetty = timber ? 0.2 : 0;
    const E = S.floors * fh, hd = d / 2 + jetty, R = E + hd * Math.tan(p);
    // ground floor, on its footing
    this.add('stone', box(w + 0.16, 0.5, d + 0.16, 0, -down + 0.25 + (down - 0.5) / 2 - 0.25, 0), 2.5, 0xc8c0b0);
    if (S.open) this.shell(S, w, d, fh, down, tint, S.floors > 1 ? fh - 0.02 : null);
    else this.add('stone', box(w, fh + down, d, 0, (fh - down) / 2, 0), 2.5, tint);
    // the upper floor
    if (S.floors > 1) {
      if (timber) this.timbered(w, d + jetty * 2, fh, fh, rnd);
      else this.add('stone', box(w, fh, d, 0, fh * 1.5, 0), 2.5, tint);
    }
    // gables: the wall under each end of the roof
    const tri = new THREE.Shape([new THREE.Vector2(-hd, 0), new THREE.Vector2(hd, 0), new THREE.Vector2(0, R - E)]);
    for (const sx of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(tri, { depth: 0.3, bevelEnabled: false }).rotateY(Math.PI / 2).translate(sx * w / 2 - 0.15, E, 0);
      this.add(timber ? 'plaster' : 'stone', g, timber ? 2 : 2.5, tint);
      if (timber) {
        // a king post and a collar in the gable
        this.add('timber', box(0.06, R - E - 0.2, 0.16, sx * (w / 2 + 0.02), E + (R - E) / 2 - 0.1, 0).rotateY(Math.PI / 2).rotateY(-Math.PI / 2), 1, 0x2a1d14);
        this.add('timber', box(0.06, 0.14, hd * 1.1, sx * (w / 2 + 0.02), E + (R - E) * 0.42, 0), 1, 0x2a1d14);
      }
    }
    // the roof: two slopes of tile, the ridge, the eaves and verges
    const oh = S.overhang, ohg = 0.35, L = (hd + oh) / Math.cos(p), W = w + ohg * 2, t = 0.12;
    for (const flip of [false, true]) {
      this.add('roof', this.slope(W, L, p, 0, R + t, 0, flip), 0);
      this.add('wood', this.slope(W, L, p, 0, R, 0, flip, 2, true), 0, 0x4a3a2c);           // the underside
      const ez = (flip ? -1 : 1) * (hd + oh), ey = R + t - (hd + oh) * Math.tan(p);
      this.add('wood', box(W, 0.2, 0.08, 0, ey - 0.06, ez), 1, 0x3a2a1c);                    // the eaves board
    }
    this.add('ridge', new THREE.CylinderGeometry(0.15, 0.15, W + 0.1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(0, R + t + 0.02, 0), 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // the bargeboards along the verges
      const len = L, g = box(0.08, 0.22, len, 0, 0, 0).translate(0, 0, len / 2).rotateX(p).translate(sx * (w / 2 + ohg), R + t - 0.05, 0);
      if (sz < 0) g.rotateY(Math.PI);
      this.add('wood', g, 1, 0x3a2a1c);
    }
    // the door, its stone arch, a step
    this.door(S.door, d / 2, S.open);
    // windows on every side, upstairs and down, never over the door, nor downstairs on the wall with the hearth
    // (the end wall farther from the door); downstairs each has its inside too
    const hearth = S.open ? (S.door <= 0 ? 1 : 3) : -1, low = [];
    for (let f = 0; f < S.floors; f++) {
      const y = f * fh + 1.05 + (f ? 0.15 : 0), jet = f && timber ? jetty : 0;
      for (const [face, len] of [[0, w], [1, d], [2, w], [3, d]]) {
        // (fewer downstairs in a house that can be gone into, to leave its walls for furniture)
        const n = f === 0 && S.open ? Math.max(1, Math.floor((len - 1.5) / 3.2)) : Math.max(1, Math.floor((len - 1) / 2.3));
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n * len - len / 2;
          if (f === 0 && face === 0 && Math.abs(u - S.door) < 1.3) continue;
          if (f === 0 && face === hearth) continue;
          if (face % 2 === 1 && f === 0 && rnd() < 0.4) continue;
          this.window(face, u, y, face % 2 ? w / 2 : d / 2 + jet, shutter, f === 0 && !timber, rnd, (S.flowers ?? 0.35));
          if (f === 0 && S.open) { this.inPane(face, u, y, (face % 2 ? w / 2 : d / 2) - WALL - LINING); low.push({ face, u }); }
        }
      }
    }
    // dormers in the front slope
    for (let k = 0; k < S.dormers; k++) this.dormer((k + 0.5) / S.dormers * w * 0.7 - w * 0.35, p, R, E, hd, t, shutter, rnd);
    // chimneys, through the roof to above the ridge
    const smoke = [];
    for (const [cx, cz] of S.chimneys) {
      const top = R + 1.1;
      this.add('stone', box(0.75, top - E + 0.5, 0.75, cx, (top + E - 0.5) / 2, cz), 2.5, 0xcfc6b4);
      this.add('dark', box(0.95, 0.12, 0.95, cx, top + 0.06, cz), 1, 0x3a3430);
      const [x, z] = world(cx, cz); smoke.push(new THREE.Vector3(x, fl + top + 0.2, z));
    }
    if (S.balcony) this.gallery(w, d, fh, rnd);
    const [dx, dz] = world(S.door, d / 2 + 0.9), top = R + t;
    // what stands in the way: the walls (round the doorway) of a house that can be gone into, else the whole of it
    const wc = (lx, lz, a, b) => { const [x, z] = world(lx, lz); return boxCollider(x, z, a, b, S.rot, top); };
    const dl = S.door - DOORWAY.r, dr = S.door + DOORWAY.r, T = WALL;
    const walls = S.open ? [wc(0, -d / 2 + T / 2, w / 2, T / 2), wc(-w / 2 + T / 2, 0, T / 2, d / 2), wc(w / 2 - T / 2, 0, T / 2, d / 2),
      wc((dl - w / 2) / 2, d / 2 - T / 2, (dl + w / 2) / 2, T / 2), wc((dr + w / 2) / 2, d / 2 - T / 2, (w / 2 - dr) / 2, T / 2)]
      : [boxCollider(S.x, S.z, w / 2 + 0.05, d / 2 + jetty + 0.05, S.rot, top)];
    return {
      walls, open: S.open, hearth, windows: low, w, d, fh,
      interior: { hw: w / 2 - T - LINING, hd: d / 2 - T - LINING, ceil: S.floors > 1 ? fh - 0.05 : E + (R - E) * 0.5 },
      doorway: { u: S.door, z: d / 2 - T / 2 },
      door: { x: dx, z: dz, heading: S.rot }, smoke, floor: fl, ridge: fl + top, front: world(0, d / 2), rot: S.rot, x: S.x, z: S.z,
      sign: (u, h) => { const [x, z] = world(u, d / 2 + 0.05); return new THREE.Vector3(x, fl + h, z); },
      at: (lx, ly, lz) => { const [x, z] = world(lx, lz); return new THREE.Vector3(x, fl + ly, z); },
    };
  }

  // the ground floor of a house that can be gone into: stone walls round an arched doorway, lined inside with
  // plaster, a floor of boards, and a ceiling of boards on beams (`ceil`, if there is a floor above), or tie beams
  // across under the open roof
  shell(S, w, d, fh, down, tint, ceil) {
    const T = WALL, Ln = LINING, y0 = -down, H = fh - y0, cy = (y0 + fh) / 2, zf = d / 2 - T / 2, u = S.door, R = DOORWAY.r, hs = DOORWAY.hs;
    const dl = u - R, dr = u + R, P = 0xf2eadb;
    this.add('stone', box(w, H, T, 0, cy, -d / 2 + T / 2), 2.5, tint);
    for (const sx of [-1, 1]) this.add('stone', box(T, H, d - 2 * T, sx * (w / 2 - T / 2), cy, 0), 2.5, tint);
    this.add('stone', box(dl + w / 2, H, T, (dl - w / 2) / 2, cy, zf), 2.5, tint);
    this.add('stone', box(w / 2 - dr, H, T, (dr + w / 2) / 2, cy, zf), 2.5, tint);
    // over the doorway: a piece of wall with the arch cut out of it
    const arch = (depth) => {
      const sh = new THREE.Shape();
      sh.moveTo(-R, hs); sh.lineTo(-R, fh); sh.lineTo(R, fh); sh.lineTo(R, hs); sh.absarc(0, hs, R, 0, Math.PI, false);
      return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 10 });
    };
    this.add('stone', arch(T).translate(u, 0, d / 2 - T), 2.5, tint);
    // the lining
    const zi = d / 2 - T - Ln / 2, xi = w / 2 - T - Ln / 2, iw = w - 2 * T, id = d - 2 * T;
    this.add('plaster', box(iw, fh, Ln, 0, fh / 2, -zi), 2, P);
    for (const sx of [-1, 1]) this.add('plaster', box(Ln, fh, id - 2 * Ln, sx * xi, fh / 2, 0), 2, P);
    this.add('plaster', box(dl + w / 2 - T, fh, Ln, (dl - w / 2 + T) / 2, fh / 2, zi), 2, P);
    this.add('plaster', box(w / 2 - T - dr, fh, Ln, (dr + w / 2 - T) / 2, fh / 2, zi), 2, P);
    this.add('plaster', arch(Ln).translate(u, 0, d / 2 - T - Ln), 2, P);
    // a skirting of dark boards, the floor of planks
    for (const sz of [-1, 1]) this.add('wood', box(iw - 0.1, 0.14, 0.03, 0, 0.07, sz * (zi - Ln / 2 - 0.015)), 1, 0x3a2a1c);
    for (const sx of [-1, 1]) this.add('wood', box(0.03, 0.14, id - 0.1, sx * (xi - Ln / 2 - 0.015), 0.07, 0), 1, 0x3a2a1c);
    this.add('wood', box(iw, 0.06, id, 0, -0.01, 0), 1.6, 0x9a7a58);
    // overhead
    const nb = Math.max(2, Math.round(iw / 1.5));
    if (ceil != null) {
      this.add('wood', box(iw, 0.04, id, 0, ceil + 0.02, 0), 1.6, 0x7a5a3c);
      for (let k = 1; k < nb; k++) this.add('timber', box(0.16, 0.2, id, -iw / 2 + iw * k / nb, ceil - 0.1, 0), 1, 0x3a2a1c);
    } else {
      for (let k = 1; k < nb; k++) this.add('timber', box(0.18, 0.22, d, -iw / 2 + iw * k / nb, fh - 0.11, 0), 1, 0x3a2a1c);
    }
  }

  // the inside of a downstairs window: daylight through the glass (its own material), a deep sill and a frame;
  // `out` is how far the inside of the wall is from the middle
  inPane(face, u, y, out) {
    const ww = 0.78, wh = 1.05, place = (g) => {
      // as window() places on `face`, but facing in
      if (face === 0) g.rotateY(Math.PI).translate(u, y, out);
      else if (face === 2) g.translate(-u, y, -out);
      else if (face === 1) g.rotateY(-Math.PI / 2).translate(out, y, -u);
      else g.rotateY(Math.PI / 2).translate(-out, y, u);
      return g;
    };
    this.add('windowIn', place(new THREE.PlaneGeometry(ww, wh).translate(0, wh / 2, 0.01)), 0);
    this.add('wood', place(box(ww + 0.2, 0.06, 0.24, 0, -0.03, 0.1)), 1, 0x5a4430);
    this.add('wood', place(box(ww + 0.12, 0.07, 0.05, 0, wh + 0.03, 0.02)), 1, 0x4a3524);
    for (const sx of [-1, 1]) this.add('wood', place(box(0.06, wh, 0.05, sx * (ww / 2 + 0.03), wh / 2, 0.02)), 1, 0x4a3524);
  }

  // an upper storey of lime plaster in a frame of dark oak: posts, rails and braces (w by d, from y0, h tall)
  timbered(w, d, y0, h, rnd) {
    this.add('plaster', box(w, h, d, 0, y0 + h / 2, 0), 2);
    const T = 0x2a1d14, out = 0.03;
    for (const [face, len] of [[0, w], [1, d], [2, w], [3, d]]) {
      const ax = face % 2 === 0, sgn = face < 2 ? 1 : -1, off = (ax ? d : w) / 2 + out;
      const piece = (u, v, lu, lv, rotz = 0) => {
        const g = box(lu, lv, 0.12).rotateZ(rotz).translate(u, v, 0);
        if (ax) g.translate(0, 0, sgn * off); else g.rotateY(Math.PI / 2).translate(sgn * off, 0, 0);
        this.add('timber', g, 1, T);
      };
      piece(0, y0 + 0.09, len, 0.18); piece(0, y0 + h - 0.08, len, 0.16);       // sill beam, wall plate
      const n = Math.max(2, Math.round(len / 1.15));
      for (let k = 0; k <= n; k++) piece(-len / 2 + len * k / n, y0 + h / 2, 0.15, h);
      // braces at the corners
      for (const sx of [-1, 1]) { const bl = Math.hypot(len / n, h * 0.6); piece(sx * (len / 2 - len / n / 2), y0 + h * 0.45, 0.12, bl, sx * Math.atan2(len / n, h * 0.6)); }
    }
  }

  // an arched plank door in the front wall at u, with a stone arch and jambs, and a step (in a house that can be
  // gone into the door itself is hung by the village, to open)
  door(u, z, open = false) {
    const r = 0.62, hs = 1.6, sh = new THREE.Shape();
    sh.moveTo(-r, 0); sh.lineTo(r, 0); sh.lineTo(r, hs); sh.absarc(0, hs, r, 0, Math.PI, false); sh.lineTo(-r, 0);
    const g = new THREE.ShapeGeometry(sh, 12), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + r) / (2 * r), uv.getY(i) / (hs + r));
    if (!open) this.add('door', g.translate(u, 0, z + 0.02), 0);
    for (let k = 0; k <= 8; k++) {
      const a = k / 8 * Math.PI, vx = u + Math.cos(a) * (r + 0.12), vy = hs + Math.sin(a) * (r + 0.12);
      this.add('stone', box(0.3, 0.22, 0.12).rotateZ(a - Math.PI / 2).translate(vx, vy, z + 0.05), 1.2, 0xe8e2d4);
    }
    for (const sx of [-1, 1]) this.add('stone', box(0.24, hs, 0.12, u + sx * (r + 0.12), hs / 2, z + 0.05), 1.2, 0xe2dccc);
    this.add('stone', box(1.8, 0.16, 0.6, u, -0.04, z + 0.3), 1.2, 0xbab2a2);
  }

  // a window on a face (0 front, 1 the +x end, 2 back, 3 the -x end) at u along it, sill at y; `out` is how far the
  // face is from the middle
  window(face, u, y, out, shutterColor, stoneLintel, rnd, flowerChance) {
    const ww = 0.78, wh = 1.05, place = (g) => {
      if (face === 0) g.translate(u, y, out);
      else if (face === 2) g.rotateY(Math.PI).translate(-u, y, -out);
      else if (face === 1) g.rotateY(Math.PI / 2).translate(out, y, -u);
      else g.rotateY(-Math.PI / 2).translate(-out, y, u);
      return g;
    };
    const lit = rnd() < 0.7;
    const pane = new THREE.PlaneGeometry(ww, wh).translate(0, wh / 2, 0.015);
    this.add(lit ? 'window' : 'windowDark', place(pane), 0);
    const F = 0x3a2a1c;
    this.add('wood', place(box(ww + 0.16, 0.08, 0.08, 0, wh + 0.04, 0.04)), 1, F);
    this.add('wood', place(box(ww + 0.24, 0.08, 0.2, 0, -0.04, 0.09)), 1, F);
    for (const sx of [-1, 1]) this.add('wood', place(box(0.08, wh, 0.08, sx * (ww / 2 + 0.04), wh / 2, 0.04)), 1, F);
    if (stoneLintel) this.add('stone', place(box(ww + 0.5, 0.2, 0.08, 0, wh + 0.2, 0.04)), 1.2, 0xe8e2d4);
    if (rnd() < 0.75) for (const sx of [-1, 1]) this.add('shutter', place(box(ww / 2 + 0.04, wh + 0.04, 0.04, sx * (ww * 0.78 + 0.06), wh / 2, 0.05)), 0.6, shutterColor);
    if (rnd() < flowerChance) {
      this.add('wood', place(box(ww + 0.1, 0.2, 0.22, 0, -0.2, 0.2)), 1, 0x4a3524);
      for (let k = 0; k < 9; k++) {
        const fx = (k / 8 - 0.5) * ww, g = new THREE.IcosahedronGeometry(0.06 + rnd() * 0.04, 0).translate(fx, -0.05 + rnd() * 0.12, 0.2 + (rnd() - 0.5) * 0.12);
        this.add('flowers', place(g), 0, k % 3 ? FLOWERS[(rnd() * FLOWERS.length) | 0] : 0x4a6a2a);
      }
    }
  }

  // a dormer standing out of the front slope at u: a little gabled box with a window
  dormer(u, p, R, E, hd, t, shutterColor, rnd) {
    const zf = hd * 0.45, ys = R - zf * Math.tan(p) + t, dw = 1.3, dh = 1.15, dd = 1.6;
    this.add('plaster', box(dw, dh + 0.6, dd, u, ys + dh / 2 - 0.3, zf - dd / 2), 2);
    const sh = new THREE.Shape([new THREE.Vector2(-dw / 2 - 0.1, 0), new THREE.Vector2(dw / 2 + 0.1, 0), new THREE.Vector2(0, 0.6)]);
    this.add('plaster', new THREE.ExtrudeGeometry(sh, { depth: dd, bevelEnabled: false }).translate(u, ys + dh, zf - dd), 2);
    const L = (dw / 2 + 0.25) / Math.cos(0.85);
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(dd + 0.2, L);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (dd + 0.2) / 2, uv.getY(i) * L / 2);
      g.rotateZ(Math.PI / 2).rotateX(0).rotateY(0);
      g.rotateX(-Math.PI / 2).rotateZ(sx * 0.85).translate(u + sx * (Math.cos(0.85) * L / 2), ys + dh + 0.66 - Math.sin(0.85) * L / 2, zf - dd / 2 + 0.05);
      this.add('roof', g, 0);
    }
    this.add('ridge', new THREE.CylinderGeometry(0.1, 0.1, dd + 0.2, 8, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateZ(-Math.PI / 2).translate(u, ys + dh + 0.68, zf - dd / 2 + 0.05), 0);
    this.window(0, u, ys + 0.12, zf, shutterColor, false, rnd, 0.3);
  }

  // a timber gallery along the front at the upper floor, on posts, with a rail and balusters
  gallery(w, d, fh, rnd) {
    const W = 0x5a4430, z = d / 2, deep = 1.15, len = Math.min(w - 0.6, 4.2), y = fh;
    this.add('wood', box(len, 0.14, deep, 0, y, z + deep / 2), 1, W);
    for (const sx of [-1, 1]) {
      this.add('wood', box(0.16, y + 0.9, 0.16, sx * (len / 2 - 0.1), (y - 0.9) / 2, z + deep - 0.1), 1, W);
      this.add('wood', box(0.12, 0.12, deep, sx * (len / 2 - 0.1), y - 0.3, z + deep / 2).rotateX(0), 1, W);
    }
    this.add('wood', box(len, 0.08, 0.1, 0, y + 0.95, z + deep - 0.05), 1, W);
    for (let k = 0; k <= Math.round(len / 0.16); k++) this.add('wood', box(0.05, 0.9, 0.05, -len / 2 + k * 0.16, y + 0.5, z + deep - 0.05), 1, W);
    for (const sx of [-1, 1]) for (let k = 0; k <= 6; k++) this.add('wood', box(0.05, 0.9, 0.05, sx * len / 2, y + 0.5, z + k * deep / 6), 1, W);
  }

  // a square tower: stone walls, slit windows, a pyramid of tiles and an iron finial
  tower(spec) {
    const { x, z, size, height, seed = 3 } = spec, rnd = mulberry32(seed);
    const y0 = groundY(x, z);
    this.ground = y0 - 0.5; this.M.makeTranslation(x, y0, z);
    this.add('stone', box(size, height + 0.8, size, 0, height / 2 - 0.4, 0));
    this.add('stone', box(size + 0.2, 0.25, size + 0.2, 0, height - 0.1, 0), 2.5, 0xe0d8c8);
    const cone = new THREE.ConeGeometry(size * 0.78, size * 1.35, 4, 1, true).rotateY(Math.PI / 4).translate(0, height + size * 0.675, 0);
    const uv = cone.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size * 2.2 / 2, uv.getY(i) * size * 1.5 / 2);
    this.add('roof', cone, 0);
    this.add('iron', new THREE.CylinderGeometry(0.03, 0.05, 1.2, 6).translate(0, height + size * 1.35 + 0.5, 0), 0, 0x2a2a2c);
    this.add('iron', new THREE.SphereGeometry(0.09, 8, 6).translate(0, height + size * 1.35 + 0.15, 0), 0, 0x2a2a2c);
    for (let f = 0; f < 3; f++) for (let face = 0; face < 4; face++) if (rnd() < 0.7) {
      const g = new THREE.PlaneGeometry(0.28, 0.7).translate(0, 0, size / 2 + 0.015).rotateY(face * Math.PI / 2).translate(0, 1.4 + f * (height / 3), 0);
      this.add('windowDark', g, 0);
    }
    return { collider: boxCollider(x, z, size / 2 + 0.05, size / 2 + 0.05, 0, height + size * 1.35) };
  }

  // ---------------------------------------------------------------- the chapel
  // a stone nave you go into at its gable end: spec { x, z, rot (the way its door faces), W (wide), L (long), H (how
  // high its walls are) }. Tall pointed windows of stained glass down both sides, a round one over the door, a little
  // bellcote with its bell on the front gable, a steep tiled roof open to the rafters inside, and a floor of flags.
  chapel(spec) {
    const S = Object.assign({ W: 7, L: 12.5, H: 4.6, pitch: 0.95, rot: 0, seed: 11 }, spec);
    const { W, L, H: wh, pitch: p } = S, c = Math.cos(S.rot), s = Math.sin(S.rot);
    const world = (lx, lz) => [S.x + lx * c + lz * s, S.z - lx * s + lz * c];
    let lo = Infinity, hi = -Infinity;
    for (let i = -1; i <= 1; i += 0.5) for (let j = -1; j <= 1; j += 0.5) { const [x, z] = world(i * W / 2, j * L / 2); const y = groundY(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const fl = hi; this.ground = lo; this.M.makeRotationY(S.rot).setPosition(S.x, fl, S.z);
    const T = WALL, Ln = LINING, down = fl - lo + 0.9, y0 = -down, Hh = wh - y0, cy = (y0 + wh) / 2, R = DOORWAY.r, hs = DOORWAY.hs;
    const tint = 0xf6f0e4, P = 0xf2eadb, rise = W / 2 * Math.tan(p), top = wh + rise, t = 0.12;
    this.add('stone', box(W + 0.2, 0.6, L + 0.2, 0, y0 + 0.3, 0), 2.5, 0xc8c0b0);
    for (const sx of [-1, 1]) this.add('stone', box(T, Hh, L, sx * (W / 2 - T / 2), cy, 0), 2.5, tint);
    this.add('stone', box(W - 2 * T, Hh, T, 0, cy, -L / 2 + T / 2), 2.5, tint);
    const side = W / 2 - T - R;
    for (const sx of [-1, 1]) this.add('stone', box(side, Hh, T, sx * (R + side / 2), cy, L / 2 - T / 2), 2.5, tint);
    const arch = (depth, h) => {
      const sh = new THREE.Shape();
      sh.moveTo(-R, hs); sh.lineTo(-R, h); sh.lineTo(R, h); sh.lineTo(R, hs); sh.absarc(0, hs, R, 0, Math.PI, false);
      return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 10 });
    };
    this.add('stone', arch(T, wh).translate(0, 0, L / 2 - T), 2.5, tint);
    // buttresses down the sides
    for (const sx of [-1, 1]) for (const k of [-1, 0, 1]) this.add('stone', box(0.5, wh * 0.8, 0.45, sx * (W / 2 + 0.2), wh * 0.4 - 0.2, k * L / 3.2).translate(0, 0, 0), 2.5, 0xe8e0d0);
    // the gables, open inside to the roof
    const tri = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, rise)]);
    this.add('stone', new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false }).translate(0, wh, L / 2 - T), 2.5, tint);
    this.add('stone', new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false }).translate(0, wh, -L / 2), 2.5, tint);
    // inside: plaster, a floor of flags, tie beams across under the rafters
    const xi = W / 2 - T - Ln / 2, zi = L / 2 - T - Ln / 2, iw = W - 2 * T, id = L - 2 * T;
    for (const sx of [-1, 1]) this.add('plaster', box(Ln, wh, id, sx * xi, wh / 2, 0), 2, P);
    this.add('plaster', box(iw, wh, Ln, 0, wh / 2, -zi), 2, P);
    for (const sx of [-1, 1]) this.add('plaster', box(side - Ln, wh, Ln, sx * (R + (side - Ln) / 2), wh / 2, zi), 2, P);
    this.add('plaster', arch(Ln, wh).translate(0, 0, L / 2 - T - Ln), 2, P);
    this.add('stone', box(iw, 0.06, id, 0, -0.01, 0), 1.3, 0x9a948a);
    for (let k = -2; k <= 2; k++) this.add('timber', box(iw, 0.24, 0.2, 0, wh - 0.12, k * id / 5.2), 1, 0x3a2a1c);
    // the roof, its ridge running front to back
    const oh = 0.5, ohg = 0.4, Ls = (W / 2 + oh) / Math.cos(p), RW = L + ohg * 2;
    for (const flip of [false, true]) {
      this.add('roof', this.slope(RW, Ls, p, 0, top + t, 0, flip).rotateY(Math.PI / 2), 0);
      this.add('wood', this.slope(RW, Ls, p, 0, top, 0, flip, 2, true).rotateY(Math.PI / 2), 0, 0x4a3a2c);
      const ex = (flip ? -1 : 1) * (W / 2 + oh), ey = top + t - (W / 2 + oh) * Math.tan(p);
      this.add('wood', box(0.08, 0.2, RW, ex, ey - 0.06, 0), 1, 0x3a2a1c);
    }
    this.add('ridge', new THREE.CylinderGeometry(0.15, 0.15, RW + 0.1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(0, top + t + 0.02, 0), 0);
    for (const sz of [-1, 1]) for (const flip of [false, true]) {
      const g = box(0.08, 0.22, Ls, 0, 0, 0).translate(0, 0, Ls / 2).rotateX(p).translate(sz * (L / 2 + ohg), top + t - 0.05, 0);
      if (flip) g.rotateY(Math.PI);
      this.add('wood', g.rotateY(Math.PI / 2), 1, 0x3a2a1c);
    }
    // the bellcote over the door, and its bell
    const bz = L / 2 - T / 2;
    this.add('stone', box(1.1, 1.7, 0.55, 0, top + 0.55, bz), 1.6, 0xeee6d6);
    this.add('dark', box(0.62, 0.8, 0.58, 0, top + 0.75, bz), 1, 0x2a2420);
    for (const flip of [false, true]) this.add('roof', this.slope(0.9, 0.85, 0.8, 0, top + 2.0, 0, flip).rotateY(Math.PI / 2).translate(0, 0, bz), 0);
    const bell = new THREE.LatheGeometry([[0, 0.42], [0.08, 0.42], [0.12, 0.36], [0.14, 0.18], [0.22, 0.04], [0.24, 0], [0.2, 0.0]].map(([r, h]) => new THREE.Vector2(r, h)), 14);
    this.add('iron', bell.translate(0, top + 0.42, bz + 0.05), 0, 0x9a7a3a);
    // stained glass: three tall pointed windows down each side, a round one over the door
    const lancet = () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.36, 0); sh.lineTo(0.36, 0); sh.lineTo(0.36, 1.7); sh.quadraticCurveTo(0.36, 2.2, 0, 2.45); sh.quadraticCurveTo(-0.36, 2.2, -0.36, 1.7); sh.lineTo(-0.36, 0);
      const g = new THREE.ShapeGeometry(sh, 8), uv = g.attributes.uv, q = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (q.getX(i) + 0.36) / 0.72, q.getY(i) / 2.45);
      return g;
    };
    for (const sx of [-1, 1]) for (const k of [-1, 0, 1]) {
      const z = k * L / 3.2 + L / 6.4, y = 1.5;
      this.add('stained', lancet().rotateY(sx * Math.PI / 2).translate(sx * (W / 2 + 0.012), y, z), 0);
      this.add('stained', lancet().rotateY(-sx * Math.PI / 2).translate(sx * (W / 2 - T - Ln - 0.012), y, z), 0);
      this.add('stone', box(0.1, 2.7, 0.95, sx * (W / 2 + 0.03), y + 1.22, z), 1.2, 0xe2dccc);
    }
    const rose = () => { const g = new THREE.CircleGeometry(0.62, 20), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i)); return g; };
    this.add('stained', rose().translate(0, wh + rise * 0.32, L / 2 + 0.012), 0);
    this.add('stained', rose().rotateY(Math.PI).translate(0, wh + rise * 0.32, L / 2 - T - 0.012), 0);
    this.add('stone', new THREE.TorusGeometry(0.66, 0.08, 6, 24).translate(0, wh + rise * 0.32, L / 2 + 0.02), 1.2, 0xe2dccc);
    // the door's arch, and steps up to it
    this.door(0, L / 2, true);
    this.add('stone', box(2.6, 0.12, 1.1, 0, -0.06, L / 2 + 0.85), 1.2, 0xbab2a2);
    const [dx, dz] = world(0, L / 2 + 1.4), [bx, bzz] = world(0, bz);
    const wc = (lx, lz, a, b) => { const [x, z] = world(lx, lz); return boxCollider(x, z, a, b, S.rot, top + t); };
    const walls = [wc(-W / 2 + T / 2, 0, T / 2 + 0.25, L / 2), wc(W / 2 - T / 2, 0, T / 2 + 0.25, L / 2), wc(0, -L / 2 + T / 2, W / 2, T / 2),
      wc(-(R + side / 2), L / 2 - T / 2, side / 2, T / 2), wc(R + side / 2, L / 2 - T / 2, side / 2, T / 2)];
    return {
      walls, open: true, hearth: -1, windows: [], w: W, d: L, fh: wh, chapel: true,
      interior: { hw: W / 2 - T - Ln, hd: L / 2 - T - Ln, ceil: wh - 0.3 },
      doorway: { u: 0, z: L / 2 - T / 2 }, door: { x: dx, z: dz, heading: S.rot }, smoke: [], floor: fl, ridge: fl + top + 1.8,
      front: world(0, L / 2), rot: S.rot, x: S.x, z: S.z, bell: new THREE.Vector3(bx, fl + top + 0.6, bzz),
      sign: (u, h) => { const [x, z] = world(u, L / 2 + 0.05); return new THREE.Vector3(x, fl + h, z); },
      at: (lx, ly, lz) => { const [x, z] = world(lx, lz); return new THREE.Vector3(x, fl + ly, z); },
    };
  }

  // merge each bucket into one geometry (null where nothing went in)
  merged() {
    const out = {};
    for (const b of BUCKETS) out[b] = this.parts[b].length ? mergeGeometries(this.parts[b], false) : null;
    return out;
  }
}

// the leaf of an arched door, hinged at its left edge (x = 0), 6 cm thick, its texture across its face
export function doorLeaf() {
  const r = DOORWAY.leaf, hs = DOORWAY.hs, sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(2 * r, 0); sh.lineTo(2 * r, hs); sh.absarc(r, hs, r, 0, Math.PI, false); sh.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -0.03);
  const q = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, q.getX(i) / (2 * r), q.getY(i) / (hs + r));
  return g;
}
