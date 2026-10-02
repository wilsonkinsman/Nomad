// Procedural textures painted on canvases at load time: ground layers, leaves, bark, fabric,
// leather, straw, fur and wood. Everything tiles, and normal maps come from painted heights.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

// ---------------------------------------------------------------- tileable noise
function thash(x, y, p, seed) {
  x = ((x % p) + p) % p; y = ((y % p) + p) % p;
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = thash(xi, yi, p, seed), b = thash(xi + 1, yi, p, seed), c = thash(xi, yi + 1, p, seed), d = thash(xi + 1, yi + 1, p, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function tfbm(x, y, p, oct, seed) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * tnoise(x, y, p, seed + i * 7); n += a; a *= 0.5; x *= 2; y *= 2; p *= 2; }
  return s / n;
}

function canvas(size, h = size) {
  const c = document.createElement('canvas'); c.width = size; c.height = h;
  return c;
}

// draw something at (x,y) and again across the wrap seams so the texture tiles
function wrapDraw(size, x, y, r, fn) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
    const px = x + ox, py = y + oy;
    if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
    fn(px, py);
  }
}

// per-pixel painter: fn(u, v) -> [r,g,b,height]
function paint(size, fn) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = fn(x / size, y / size, x, y), k = (y * size + x) * 4;
    d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = 255; hgt[y * size + x] = o[3] ?? 0.5;
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx, hgt };
}

function heightFromCanvas(c) {
  const ctx = c.getContext('2d'), { width: w, height: h } = c, d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.5 + d[i * 4 + 2] * 0.2) / 255;
  return out;
}

function normalCanvas(hgt, w, h, strength) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const at = (x, y) => hgt[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * w + x) * 4;
    d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- leaf silhouettes
export function leafPath(ctx, type, s) {
  ctx.beginPath();
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const t = i / N * Math.PI * 2;
    let r;
    if (type === 0) {        // maple: five pointed lobes
      const lobe = Math.pow(Math.abs(Math.cos(t * 2.5)), 0.7);
      r = s * (0.42 + 0.58 * lobe) * (1 + 0.06 * Math.sin(t * 22));
      if (Math.abs(Math.sin(t / 2)) > 0.97) r *= 0.35;   // notch at the stem (t ~ pi)
    } else if (type === 1) { // oak: long, round lobes
      r = s * (0.55 + 0.1 * Math.sin(t * 9)) * (0.62 + 0.38 * Math.abs(Math.sin(t)));
    } else {                 // birch/elm: pointed oval, serrated
      r = s * (0.36 + 0.22 * Math.abs(Math.sin(t))) * (1 + 0.035 * Math.sin(t * 38));
      r *= 1 + 0.35 * Math.max(0, Math.sin(t));    // pointed tip
    }
    const x = Math.cos(t) * r * (type === 0 ? 1 : 0.8), y = -Math.sin(t) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawLeaf(ctx, type, x, y, s, ang, col, rnd, veins = true) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  leafPath(ctx, type, s);
  const g = ctx.createLinearGradient(-s, -s, s, s);
  const [r, gg, b] = col;
  const j = () => (rnd() - 0.5) * 30;
  g.addColorStop(0, `rgb(${r + j() + 20},${gg + j() + 12},${b + j()})`);
  g.addColorStop(1, `rgb(${r + j() - 25},${gg + j() - 20},${b + j() - 10})`);
  ctx.fillStyle = g; ctx.fill();
  if (veins) {
    ctx.strokeStyle = `rgba(${r * 0.55 | 0},${gg * 0.5 | 0},${b * 0.4 | 0},0.55)`;
    ctx.lineWidth = Math.max(0.6, s * 0.05);
    ctx.beginPath(); ctx.moveTo(0, s * 0.9); ctx.lineTo(0, -s * 0.85);
    const n = type === 0 ? 2 : 4;
    for (let i = 1; i <= n; i++) {
      const yy = s * (0.5 - i * 0.28);
      ctx.moveTo(0, yy + s * 0.15); ctx.lineTo(-s * 0.5, yy - s * 0.12);
      ctx.moveTo(0, yy + s * 0.15); ctx.lineTo(s * 0.5, yy - s * 0.12);
    }
    ctx.stroke();
    // stem
    ctx.lineWidth = Math.max(0.8, s * 0.06);
    ctx.beginPath(); ctx.moveTo(0, s * 0.7); ctx.lineTo(0, s * 1.15); ctx.stroke();
  }
  ctx.restore();
}

const AUTUMN = [[178, 44, 22], [214, 92, 24], [226, 148, 36], [201, 164, 58], [140, 64, 28], [186, 70, 30], [232, 176, 64], [120, 48, 26]];

// ---------------------------------------------------------------- ground layers (array texture)
function groundGrass(size) {
  const { c, ctx } = paint(size, (u, v) => {
    const n = tfbm(u * 8, v * 8, 8, 4, 3), m = tfbm(u * 3, v * 3, 3, 3, 9);
    return [58 + n * 40 + m * 20, 62 + n * 40 + m * 10, 30 + n * 16, n];
  });
  const rnd = mulberry32(5);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * size, y = rnd() * size, len = 4 + rnd() * 10, a = rnd() * Math.PI * 2;
    const dry = rnd() < 0.25;
    const l = 0.6 + rnd() * 0.6;
    ctx.strokeStyle = dry ? `rgba(${150 * l | 0},${140 * l | 0},${70 * l | 0},0.8)` : `rgba(${70 * l | 0},${(96 + rnd() * 40) * l | 0},${34 * l | 0},0.85)`;
    ctx.lineWidth = 1 + rnd();
    wrapDraw(size, x, y, len, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke(); });
  }
  return c;
}

function groundDirt(size) {
  const { c, ctx } = paint(size, (u, v) => {
    const n = tfbm(u * 6, v * 6, 6, 5, 21), r = tfbm(u * 24, v * 24, 24, 2, 5);
    const k = 0.75 + n * 0.45 + (r - 0.5) * 0.15;
    return [104 * k, 82 * k, 60 * k, n * 0.7 + r * 0.3];
  });
  const rnd = mulberry32(11);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size, y = rnd() * size, r = 0.8 + rnd() * rnd() * 3.2;
    const l = 70 + rnd() * 60;
    wrapDraw(size, x, y, r, (px, py) => {
      ctx.fillStyle = `rgb(${l * 0.95 | 0},${l * 0.88 | 0},${l * 0.78 | 0})`;
      ctx.beginPath(); ctx.ellipse(px, py, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,245,225,0.12)';
      ctx.beginPath(); ctx.ellipse(px - r * 0.25, py - r * 0.25, r * 0.45, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    });
  }
  return c;
}

function groundLeaves(size) {
  const { c, ctx } = paint(size, (u, v) => {
    const n = tfbm(u * 10, v * 10, 10, 3, 31);
    return [44 + n * 30, 30 + n * 20, 20 + n * 10, n * 0.3];
  });
  const rnd = mulberry32(17);
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * size, y = rnd() * size, s = 7 + rnd() * 9, type = (rnd() * 3) | 0;
    const col = AUTUMN[(rnd() * AUTUMN.length) | 0].map(v => v * (0.55 + rnd() * 0.5));
    const a = rnd() * Math.PI * 2;
    wrapDraw(size, x, y, s * 1.3, (px, py) => {
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3;
      drawLeaf(ctx, type, px, py, s, a, col, rnd, s > 11);
      ctx.shadowBlur = 0;
    });
  }
  return c;
}

function groundRock(size) {
  const { c } = paint(size, (u, v) => {
    const n = tfbm(u * 5, v * 5, 5, 5, 41), cr = Math.abs(tfbm(u * 9, v * 9, 9, 3, 43) - 0.5);
    const crack = cr < 0.025 ? 0.55 : 1;
    const lichen = Math.max(0, tfbm(u * 7, v * 7, 7, 3, 47) - 0.62) * 3;
    const k = (0.6 + n * 0.55) * crack;
    return [(112 + lichen * 60) * k, (112 + lichen * 70) * k, (108 + lichen * 10) * k, n * crack];
  });
  return c;
}

function groundStubble(size) {
  const { c, ctx } = paint(size, (u, v) => {
    const n = tfbm(u * 8, v * 8, 8, 4, 51);
    return [110 + n * 40, 92 + n * 34, 58 + n * 20, n * 0.4];
  });
  const rnd = mulberry32(23);
  for (let i = 0; i < 5000; i++) {
    const x = rnd() * size, y = rnd() * size, len = 5 + rnd() * 12, a = rnd() * Math.PI * 2, l = 0.7 + rnd() * 0.5;
    ctx.strokeStyle = `rgba(${214 * l | 0},${178 * l | 0},${96 * l | 0},0.8)`; ctx.lineWidth = 1 + rnd() * 0.8;
    wrapDraw(size, x, y, len, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke(); });
  }
  return c;
}

// the floor of the deep wood: dark humus under old needles and twigs, moss in patches, a few dead leaves
function groundForest(size) {
  const { c, ctx } = paint(size, (u, v) => {
    const n = tfbm(u * 9, v * 9, 9, 4, 61), m = tfbm(u * 4, v * 4, 4, 3, 67);
    const moss = Math.max(0, m - 0.5) * 2.4;
    return [50 + n * 36 - moss * 16, 42 + n * 28 + moss * 42, 28 + n * 16 - moss * 8, n * 0.5 + moss * 0.25];
  });
  const rnd = mulberry32(37);
  for (let i = 0; i < 6500; i++) {                       // needles and twigs
    const x = rnd() * size, y = rnd() * size, len = 5 + rnd() * 13, a = rnd() * Math.PI * 2, l = 0.55 + rnd() * 0.75;
    ctx.strokeStyle = rnd() < 0.18 ? `rgba(${86 * l | 0},${58 * l | 0},${34 * l | 0},0.85)` : `rgba(${70 * l | 0},${52 * l | 0},${34 * l | 0},0.8)`;
    ctx.lineWidth = 0.9 + rnd() * 0.9;
    wrapDraw(size, x, y, len, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke(); });
  }
  for (let i = 0; i < 90; i++) {                         // dead leaves, long since gone dull
    const x = rnd() * size, y = rnd() * size, s = 5 + rnd() * 6, type = (rnd() * 3) | 0;
    const col = AUTUMN[(rnd() * AUTUMN.length) | 0].map(v => v * (0.32 + rnd() * 0.3));
    wrapDraw(size, x, y, s * 1.3, (px, py) => { drawLeaf(ctx, type, px, py, s, rnd() * Math.PI * 2, col, rnd, false); });
  }
  return c;
}

function arrayTex(canvases, srgb) {
  const size = canvases[0].width, n = canvases.length;
  const data = new Uint8Array(size * size * 4 * n);
  canvases.forEach((c, i) => data.set(c.getContext('2d').getImageData(0, 0, size, size).data, i * size * size * 4));
  const t = new THREE.DataArrayTexture(data, size, size, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// layers: 0 grass, 1 dirt, 2 leaf litter, 3 rock, 4 stubble, 5 forest floor
export function groundTextures() {
  const S = 512;
  const cols = [groundGrass(S), groundDirt(S), groundLeaves(S), groundRock(S), groundStubble(S), groundForest(S)];
  const nrm = cols.map((c, i) => normalCanvas(heightFromCanvas(c), S, S, [3, 5, 4, 6, 3, 4][i]));
  return { albedo: arrayTex(cols, true), normal: arrayTex(nrm, false) };
}

export function rockTextures() {
  const c = groundRock(256);
  return { map: tex(c), normal: tex(normalCanvas(heightFromCanvas(c), 256, 256, 6), false) };
}

// ---------------------------------------------------------------- leaves atlas (4x4 single leaves)
export function leafAtlas() {
  const S = 512, cell = 128, c = canvas(S), ctx = c.getContext('2d'), rnd = mulberry32(77);
  for (let i = 0; i < 16; i++) {
    const cx = (i % 4) * cell + cell / 2, cy = ((i / 4) | 0) * cell + cell / 2;
    const type = i % 3, col = AUTUMN[i % AUTUMN.length];
    drawLeaf(ctx, type, cx, cy - 4, cell * 0.36, 0, col, rnd, true);
  }
  return tex(c, true, false);
}

// ---------------------------------------------------------------- foliage clusters for tree cards
// 2x2 atlas: 0 autumn maple, 1 yellow birch, 2 green summer, 3 pine needles
export function foliageAtlas() {
  const S = 1024, cell = 512, c = canvas(S), ctx = c.getContext('2d'), rnd = mulberry32(99);
  const palettes = [
    [[184, 46, 22], [210, 84, 26], [226, 128, 34], [160, 40, 24], [232, 160, 50]],
    [[222, 170, 48], [236, 196, 80], [200, 150, 40], [210, 120, 36], [244, 214, 110]],
    [[62, 96, 36], [80, 116, 44], [98, 128, 50], [54, 84, 32], [120, 140, 58]],
  ];
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * cell, oy = ((q / 2) | 0) * cell;
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, cell, cell); ctx.clip();
    const cx = ox + cell / 2, cy = oy + cell / 2;
    if (q < 3) {
      // twigs
      ctx.strokeStyle = 'rgb(60,44,32)'; ctx.lineCap = 'round';
      const tips = [];
      for (let b = 0; b < 7; b++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6, L = cell * (0.25 + rnd() * 0.2);
        ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy + cell * 0.3);
        const ex = cx + Math.cos(a) * L, ey = cy + cell * 0.3 + Math.sin(a) * L * 1.5;
        ctx.lineTo(ex, ey); ctx.stroke(); tips.push([ex, ey]);
      }
      const pal = palettes[q];
      for (let i = 0; i < 95; i++) {
        const t = tips[(rnd() * tips.length) | 0];
        const x = t[0] + (rnd() - 0.5) * cell * 0.35, y = t[1] + (rnd() - 0.5) * cell * 0.3;
        if (Math.hypot(x - cx, y - cy) > cell * 0.47) continue;
        const col = pal[(rnd() * pal.length) | 0].map(v => v * (0.6 + rnd() * 0.5));
        drawLeaf(ctx, q === 1 ? 2 : q === 0 ? 0 : (rnd() < 0.5 ? 1 : 2), x, y, cell * (0.05 + rnd() * 0.035), rnd() * 6.28, col, rnd, true);
      }
    } else {
      // pine: sprays of needles off a central twig
      for (let b = 0; b < 9; b++) {
        const x0 = cx + (rnd() - 0.5) * cell * 0.5, y0 = cy + (rnd() - 0.5) * cell * 0.6;
        const a0 = -Math.PI / 2 + (rnd() - 0.5) * 1.2, L = cell * (0.28 + rnd() * 0.12);
        ctx.strokeStyle = 'rgb(70,52,36)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x0, y0 + L / 2); ctx.lineTo(x0 + Math.cos(a0) * L * 0.2, y0 - L / 2); ctx.stroke();
        for (let n = 0; n < 70; n++) {
          const t = rnd(), px = x0 + Math.cos(a0) * L * 0.2 * t, py = y0 + L / 2 - L * t;
          const side = rnd() < 0.5 ? -1 : 1, na = a0 + side * (0.6 + rnd() * 0.5), nl = cell * (0.05 + rnd() * 0.04);
          const l = 0.6 + rnd() * 0.5;
          ctx.strokeStyle = `rgb(${34 * l | 0},${62 * l | 0},${40 * l | 0})`; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  const t = tex(c, true, false);
  t.generateMipmaps = true;
  return t;
}

// ---------------------------------------------------------------- fern frond (alpha cut-out, tip at the top)
export function fernTexture() {
  const W = 256, Hh = 512, c = canvas(W, Hh), ctx = c.getContext('2d'), rnd = mulberry32(131);
  const cx = W / 2, N = 26;
  ctx.lineCap = 'round';
  // the rachis, with a faint curve
  ctx.strokeStyle = 'rgb(46,66,28)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx, Hh - 4); ctx.quadraticCurveTo(cx + 3, Hh * 0.5, cx, 10); ctx.stroke();
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N, y = Hh - 10 - t * (Hh - 34);
    const L = 112 * Math.pow(Math.sin(Math.PI * (0.07 + 0.9 * t)), 0.8);       // long in the middle, short at both ends
    for (const side of [-1, 1]) {
      const th = 0.62 + (rnd() - 0.5) * 0.12;                                  // swept forward, toward the tip
      const dx = side * Math.cos(th), dy = -Math.sin(th);
      const bx = cx, by = y;
      const lobes = 6, w = 6 + L * 0.075;
      const k = 0.7 + t * 0.5;                                                 // young growth at the tip is paler
      for (let j = 0; j < lobes; j++) {
        const f = (j + 0.6) / lobes, px = bx + dx * L * f, py = by + dy * L * f;
        const rl = (L / lobes) * 0.95, rw = w * (1 - f * 0.75);
        const r = (70 + 80 * k * f) * (0.85 + rnd() * 0.3), g = (120 + 70 * k) * (0.85 + rnd() * 0.3), b = (36 + 34 * k * f) * (0.85 + rnd() * 0.3);
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.beginPath(); ctx.ellipse(px, py, rl, Math.max(2, rw), Math.atan2(dy, dx), 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(40,64,24,0.75)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + dx * L, by + dy * L); ctx.stroke();
    }
  }
  const t = tex(c, true, false);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------------------------------------------------------------- bark
export function barkTextures(birch = false) {
  const W = 256, Hh = 512;
  const c = canvas(W, Hh), ctx = c.getContext('2d'), img = ctx.createImageData(W, Hh), d = img.data;
  const hgt = new Float32Array(W * Hh);
  const rnd = mulberry32(birch ? 5 : 3);
  const marks = [];
  if (birch) for (let i = 0; i < 70; i++) marks.push([rnd() * W, rnd() * Hh, 6 + rnd() * 30, 1.5 + rnd() * 3]);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / Hh;
    let r, g, b, h;
    if (!birch) {
      const f = tfbm(u * 12, v * 3, 12, 4, 61), ff = Math.abs(f - 0.5) * 2;
      const furrow = Math.pow(1 - ff, 3);
      h = 1 - furrow * 0.8 + tfbm(u * 30, v * 30, 30, 2, 63) * 0.2;
      const k = 0.45 + h * 0.5;
      r = 96 * k; g = 80 * k; b = 66 * k;
    } else {
      const n = tfbm(u * 6, v * 10, 6, 3, 65);
      h = 0.7 + n * 0.3; r = 222 * (0.85 + n * 0.15); g = 216 * (0.85 + n * 0.15); b = 204 * (0.85 + n * 0.15);
      for (const m of marks) {
        let dx = Math.abs(x - m[0]); dx = Math.min(dx, W - dx);
        let dy = Math.abs(y - m[1]); dy = Math.min(dy, Hh - dy);
        if (dx < m[2] && dy < m[3]) { r = 50; g = 44; b = 40; h = 0.3; }
      }
    }
    const k = (y * W + x) * 4; d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255; hgt[y * W + x] = h;
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c), normal: tex(normalCanvas(hgt, W, Hh, 6), false) };
}

// ---------------------------------------------------------------- clothing materials
// woven fabric: over-under threads, returns a normal map + subtle albedo variation map
export function fabricTextures() {
  // coarse wool: small over-under weave plus soft vertical folds and wear; tiles twice per metre
  const S = 512, hgt = new Float32Array(S * S);
  const threads = 96;
  const { c } = paint(S, (u, v, x, y) => {
    const tu = u * threads, tv = v * threads;
    const iu = Math.floor(tu), iv = Math.floor(tv);
    const fu = tu - iu, fv = tv - iv;
    const over = (iu + iv) % 2 === 0;
    const warp = Math.sin(fu * Math.PI), weft = Math.sin(fv * Math.PI);
    const weave = over ? warp * 0.8 + weft * 0.2 : weft * 0.8 + warp * 0.2;
    const fold = tfbm(u * 6, v * 1.5, 6, 3, 73);
    const crease = Math.pow(Math.abs(Math.sin((u * 5 + tfbm(u * 3, v * 3, 3, 2, 75) * 1.5) * Math.PI)), 0.6);
    hgt[y * S + x] = weave * 0.12 + fold * 0.55 + crease * 0.35;
    const n = tfbm(u * 4, v * 4, 4, 4, 71), fleck = tnoise(u * 180, v * 180, 180, 9);
    const k = 196 + (n - 0.5) * 80 + (fleck - 0.5) * 26 + weave * 14 + (crease - 0.5) * 24;
    return [k, k, k];
  });
  return { map: tex(c), normal: tex(normalCanvas(hgt, S, S, 3.2), false) };
}

export function leatherTextures() {
  const S = 256, hgt = new Float32Array(S * S);
  const { c } = paint(S, (u, v, x, y) => {
    const cell = tnoise(u * 40, v * 40, 40, 81), n = tfbm(u * 5, v * 5, 5, 4, 83);
    const scratch = Math.abs(tnoise(u * 3, v * 60, 3, 85) - 0.5) < 0.01 ? 0.7 : 1;
    const h = cell * 0.6 + n * 0.4;
    hgt[y * S + x] = h * scratch;
    const k = (150 + n * 90 + cell * 20) * scratch;
    return [k, k, k];
  });
  return { map: tex(c), normal: tex(normalCanvas(hgt, S, S, 3), false) };
}

export function strawTextures() {
  const S = 256, hgt = new Float32Array(S * S);
  const { c } = paint(S, (u, v, x, y) => {
    // plaited strips: diagonal weave
    const a = (u + v) * 16, b = (u - v + 1) * 16;
    const ia = Math.floor(a), ib = Math.floor(b);
    const over = (ia + ib) % 2 === 0;
    const fa = a - ia, fb = b - ib;
    const h = over ? Math.sin(fa * Math.PI) : Math.sin(fb * Math.PI) * 0.8;
    const fiber = tnoise(over ? a * 12 : u * 40, over ? u * 40 : b * 12, 192, 91);
    hgt[y * S + x] = h * 0.8 + fiber * 0.2;
    const k = 0.7 + h * 0.25 + fiber * 0.15;
    return [196 * k, 158 * k, 96 * k];
  });
  return { map: tex(c), normal: tex(normalCanvas(hgt, S, S, 3), false) };
}

export function furTexture() {
  // long strands with alpha, for fur-collar cards
  const W = 256, Hh = 256, c = canvas(W, Hh), ctx = c.getContext('2d'), rnd = mulberry32(13);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W, len = Hh * (0.45 + rnd() * 0.55), l = 0.55 + rnd() * 0.6;
    const bend = (rnd() - 0.5) * 30;
    ctx.strokeStyle = `rgba(${150 * l | 0},${128 * l | 0},${104 * l | 0},${0.5 + rnd() * 0.5})`;
    ctx.lineWidth = 1 + rnd() * 2.2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + bend * 0.5, len * 0.5, x + bend, len); ctx.stroke();
  }
  const t = tex(c, true, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function woodTextures() {
  const W = 128, Hh = 512, hgt = new Float32Array(W * Hh);
  const c = canvas(W, Hh), ctx = c.getContext('2d'), img = ctx.createImageData(W, Hh), d = img.data;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / Hh;
    const grain = tfbm(u * 18, v * 2, 18, 3, 101), ring = Math.abs(Math.sin((u * 18 + grain * 6) * Math.PI));
    const crack = tnoise(u * 10, v * 1.5, 10, 103) < 0.08 ? 0.5 : 1;
    const h = (0.5 + ring * 0.3 + grain * 0.2) * crack;
    const k = (0.55 + h * 0.45);
    const k4 = (y * W + x) * 4;
    d[k4] = 128 * k; d[k4 + 1] = 116 * k; d[k4 + 2] = 100 * k; d[k4 + 3] = 255; hgt[y * W + x] = h;
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c), normal: tex(normalCanvas(hgt, W, Hh, 4), false) };
}

// soft round sprite for snow puffs, dust and fireflies
export function softSprite() {
  const S = 64, c = canvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, false, false);
}
