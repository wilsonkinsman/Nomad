// The village's painted textures, drawn once on canvases: whitewashed rubble stone, lime plaster, terracotta roof
// tiles, cobbles, plank doors, leaded windows, striped awning cloth and the shop signs. Each surface that has relief
// comes with a normal map made from its own height.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
// a normal map from a height canvas (grey = height), tiling
function normals(hc, strength) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h); for (let i = 0; i < w * h; i++) H[i] = src[i * 4] / 255;
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), k = (y * w + x) * 4;
    d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, false);
}
// grain: fine speckle over the whole canvas, for weathering
function speckle(ctx, w, h, rnd, n, a, light = false) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = light ? `rgba(255,250,240,${a * rnd()})` : `rgba(40,32,24,${a * rnd()})`; ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
}
// a blob drawn on both canvases, wrapped round the edges so the texture tiles
function wrapped(w, h, x, y, r, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { const px = x + ox, py = y + oy; if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue; fn(px, py); }
}

// Whitewashed rubble: rough courses of stones of every size, bedded in mortar, limewashed over so the colour is
// mostly the wash with the stone showing through where it has worn. 2.5 m of wall to the tile.
export function stoneWall(size = 512) {
  const rnd = mulberry32(11), c = canvas(size), ctx = c.getContext('2d'), hc = canvas(size), hx = hc.getContext('2d');
  ctx.fillStyle = '#b9b2a4'; ctx.fillRect(0, 0, size, size);                 // mortar
  hx.fillStyle = '#303030'; hx.fillRect(0, 0, size, size);
  let y = 0;
  while (y < size) {
    const ch = 22 + rnd() * 26;
    let x = -rnd() * 30;
    while (x < size) {
      const sw = 26 + rnd() * 48, sh = ch * (0.75 + rnd() * 0.3), cx = x + sw / 2, cy = y + ch / 2 + (rnd() - 0.5) * 4;
      const tone = 196 + rnd() * 40, warm = rnd() * 14;
      const draw = (g, fill) => (px, py) => {
        g.beginPath();
        const n = 9;
        for (let k = 0; k <= n; k++) {
          const a = k / n * Math.PI * 2, rr = 0.88 + 0.12 * Math.sin(a * 3 + cx);
          const ex = px + Math.cos(a) * sw / 2 * rr * (0.92 + 0.08 * Math.abs(Math.cos(a))), ey = py + Math.sin(a) * sh / 2 * rr;
          k ? g.lineTo(ex, ey) : g.moveTo(ex, ey);
        }
        g.closePath(); g.fillStyle = fill; g.fill();
      };
      wrapped(size, size, cx, cy, sw, draw(ctx, `rgb(${tone + warm},${tone + warm * 0.6},${tone - 6})`));
      // the height: a dome, highest in the middle of the stone
      wrapped(size, size, cx, cy, sw, (px, py) => {
        const g = hx.createRadialGradient(px - sw * 0.1, py - sh * 0.15, 1, px, py, Math.max(sw, sh) / 2);
        g.addColorStop(0, '#d8d8d8'); g.addColorStop(0.65, '#c4c4c4'); g.addColorStop(1, '#7a7a7a');
        draw(hx, g)(px, py);
      });
      // the stone showing through the wash, here and there
      if (rnd() < 0.35) wrapped(size, size, cx, cy, sw, (px, py) => { ctx.fillStyle = `rgba(${120 + rnd() * 40},${110 + rnd() * 30},${95 + rnd() * 20},${0.25 + rnd() * 0.3})`; ctx.beginPath(); ctx.ellipse(px + (rnd() - 0.5) * sw * 0.3, py, sw * 0.28, sh * 0.25, rnd() * 3, 0, Math.PI * 2); ctx.fill(); });
      x += sw + 2 + rnd() * 4;
    }
    y += ch + 2;
  }
  // the limewash over it all, thicker in some places than others
  for (let i = 0; i < 70; i++) wrapped(size, size, rnd() * size, rnd() * size, 120, (px, py) => {
    const g = ctx.createRadialGradient(px, py, 0, px, py, 40 + rnd() * 80); g.addColorStop(0, 'rgba(246,242,232,0.5)'); g.addColorStop(1, 'rgba(246,242,232,0)');
    ctx.fillStyle = g; ctx.fillRect(px - 120, py - 120, 240, 240);
  });
  ctx.fillStyle = 'rgba(244,240,230,0.38)'; ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, rnd, 9000, 0.18); speckle(ctx, size, size, rnd, 3000, 0.25, true);
  return { map: tex(c), normal: normals(hc, 2.4) };
}

// Lime plaster for the upper floors: warm cream, faint trowel marks and a few hairline cracks
export function plaster(size = 256) {
  const rnd = mulberry32(5), c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#ddd2bb'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,248,232' : '150,130,100'},${0.05 + rnd() * 0.06})`; ctx.beginPath(); ctx.ellipse(rnd() * size, rnd() * size, 8 + rnd() * 26, 4 + rnd() * 10, rnd() * 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = 'rgba(90,75,55,0.35)'; ctx.lineWidth = 0.8;
  for (let i = 0; i < 6; i++) { let x = rnd() * size, y = rnd() * size; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 18; y += rnd() * 14; ctx.lineTo(x, y); } ctx.stroke(); }
  speckle(ctx, size, size, rnd, 4000, 0.15);
  return { map: tex(c) };
}

// Terracotta roof tiles: rows of curved pantiles, each row lapping the one below it, the colours ranging from orange
// to brick, a few darker and mossy. A tile is 0.25 m across and the rows 0.3 m apart; the texture is 2 m square.
export function roofTiles(size = 512) {
  const rnd = mulberry32(23), c = canvas(size), ctx = c.getContext('2d'), hc = canvas(size), hx = hc.getContext('2d');
  const cols = 8, rows = 7, tw = size / cols, th = size / rows;
  ctx.fillStyle = '#4a2a1c'; ctx.fillRect(0, 0, size, size);
  hx.fillStyle = '#202020'; hx.fillRect(0, 0, size, size);
  for (let r = rows; r >= -1; r--) {
    for (let k = -1; k <= cols; k++) {
      const x = k * tw + (r % 2) * tw * 0.5, y = r * th;
      const hue = 14 + rnd() * 12, sat = 50 + rnd() * 20, lit = 36 + rnd() * 14 - (rnd() < 0.08 ? 10 : 0);
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        const px = x + ox, py = y + oy;
        if (px + tw < 0 || px > size || py + th * 1.3 < 0 || py > size) continue;
        // a curved tile: lit across its crown, shadowed at its edges and darker at its lower lip
        const g = ctx.createLinearGradient(px, 0, px + tw, 0);
        g.addColorStop(0, `hsl(${hue},${sat}%,${lit - 14}%)`); g.addColorStop(0.45, `hsl(${hue},${sat}%,${lit + 8}%)`); g.addColorStop(1, `hsl(${hue},${sat}%,${lit - 16}%)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(px + 1, py, tw - 2, th * 1.25, [2, 2, tw * 0.45, tw * 0.45]); ctx.fill();
        ctx.fillStyle = 'rgba(30,12,6,0.45)'; ctx.fillRect(px + 1, py + th * 1.12, tw - 2, th * 0.13);
        if (rnd() < 0.12) { ctx.fillStyle = `rgba(${70 + rnd() * 30},${80 + rnd() * 30},40,0.45)`; ctx.beginPath(); ctx.ellipse(px + tw * rnd(), py + th * 0.4, tw * 0.3, th * 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
        const hg = hx.createLinearGradient(px, 0, px + tw, 0);
        hg.addColorStop(0, '#505050'); hg.addColorStop(0.45, '#e8e8e8'); hg.addColorStop(1, '#505050');
        hx.fillStyle = hg; hx.beginPath(); hx.roundRect(px + 1, py, tw - 2, th * 1.25, [2, 2, tw * 0.45, tw * 0.45]); hx.fill();
      }
    }
  }
  speckle(ctx, size, size, rnd, 6000, 0.2);
  return { map: tex(c), normal: normals(hc, 4) };
}

// Cobbles: rounded stones set close in rows, grey to buff, the joints dark with earth. 2 m to the tile.
export function cobbles(size = 512) {
  const rnd = mulberry32(37), c = canvas(size), ctx = c.getContext('2d'), hc = canvas(size), hx = hc.getContext('2d');
  ctx.fillStyle = '#4c4438'; ctx.fillRect(0, 0, size, size);
  hx.fillStyle = '#202020'; hx.fillRect(0, 0, size, size);
  const n = 26, cs = size / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5 + (j % 2) * 0.5) * cs + (rnd() - 0.5) * cs * 0.25, y = (j + 0.5) * cs + (rnd() - 0.5) * cs * 0.25;
    const rx = cs * (0.38 + rnd() * 0.1), ry = cs * (0.36 + rnd() * 0.1), a = rnd() * 3, tone = 120 + rnd() * 70, w = rnd() * 18;
    wrapped(size, size, x, y, cs, (px, py) => {
      ctx.fillStyle = `rgb(${tone + w},${tone + w * 0.7},${tone - 4})`; ctx.beginPath(); ctx.ellipse(px, py, rx, ry, a, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,235,0.18)'; ctx.beginPath(); ctx.ellipse(px - rx * 0.2, py - ry * 0.25, rx * 0.5, ry * 0.4, a, 0, Math.PI * 2); ctx.fill();
      const g = hx.createRadialGradient(px, py, 0, px, py, Math.max(rx, ry)); g.addColorStop(0, '#f0f0f0'); g.addColorStop(1, '#606060');
      hx.fillStyle = g; hx.beginPath(); hx.ellipse(px, py, rx, ry, a, 0, Math.PI * 2); hx.fill();
    });
  }
  speckle(ctx, size, size, rnd, 8000, 0.3);
  return { map: tex(c), normal: normals(hc, 6) };
}

// a plank door with iron bands and studs (the texture covers the whole door)
export function doorTex() {
  const rnd = mulberry32(3), c = canvas(128, 256), ctx = c.getContext('2d');
  for (let i = 0; i < 5; i++) {
    const t = 70 + rnd() * 25; ctx.fillStyle = `rgb(${t + 20},${t},${t - 25})`; ctx.fillRect(i * 25.6, 0, 25.6, 256);
    ctx.fillStyle = 'rgba(20,12,6,0.6)'; ctx.fillRect(i * 25.6, 0, 2, 256);
    for (let k = 0; k < 30; k++) { ctx.fillStyle = `rgba(30,18,8,${rnd() * 0.25})`; ctx.fillRect(i * 25.6 + rnd() * 24, rnd() * 256, 1, 10 + rnd() * 40); }
  }
  ctx.fillStyle = '#2a2a2c';
  for (const y of [40, 200]) { ctx.fillRect(0, y, 128, 10); for (let x = 8; x < 128; x += 20) { ctx.beginPath(); ctx.arc(x, y + 5, 3, 0, Math.PI * 2); ctx.fillStyle = '#4a4a4c'; ctx.fill(); ctx.fillStyle = '#2a2a2c'; } }
  ctx.beginPath(); ctx.arc(100, 128, 7, 0, Math.PI * 2); ctx.strokeStyle = '#3a3a3c'; ctx.lineWidth = 3; ctx.stroke();
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// a leaded window: dark glass in a diamond lattice; its emissive twin glows warm behind the glass at night
export function windowTex() {
  const c = canvas(64, 96), ctx = c.getContext('2d'), e = canvas(64, 96), ex = e.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 96); g.addColorStop(0, '#2c3238'); g.addColorStop(1, '#14181c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 96);
  ex.fillStyle = '#ffb860'; ex.fillRect(0, 0, 64, 96);
  for (const k of [ctx, ex]) {
    k.strokeStyle = k === ctx ? '#0c0c0c' : '#3a2010'; k.lineWidth = 2;
    for (let d = -96; d < 160; d += 16) { k.beginPath(); k.moveTo(d, 0); k.lineTo(d + 96, 96); k.stroke(); k.beginPath(); k.moveTo(d + 96, 0); k.lineTo(d, 96); k.stroke(); }
    k.lineWidth = 6; k.strokeRect(0, 0, 64, 96); k.beginPath(); k.moveTo(32, 0); k.lineTo(32, 96); k.stroke();
  }
  ctx.fillStyle = 'rgba(200,220,240,0.12)'; ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(26, 6); ctx.lineTo(6, 40); ctx.fill();
  const a = tex(c), b = tex(e); for (const t of [a, b]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { map: a, emissive: b };
}

// awning cloth in broad stripes of two colours
export function stripes(a, b) {
  const c = canvas(128, 32), ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? b : a; ctx.fillRect(i * 16, 0, 16, 32); }
  const rnd = mulberry32(a.length * 7); speckle(ctx, 128, 32, rnd, 500, 0.18);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * 16, 26); ctx.quadraticCurveTo(i * 16 + 8, 34, i * 16 + 16, 26); ctx.lineTo(i * 16 + 16, 32); ctx.lineTo(i * 16, 32); ctx.fill(); }
  return tex(c);
}

// a shop's hanging sign: a weathered board, a picture and the trade's name
export function signTex(kind, label) {
  const c = canvas(256, 192), ctx = c.getContext('2d'), rnd = mulberry32(kind.length * 13);
  ctx.fillStyle = '#5a3c22'; ctx.beginPath(); ctx.roundRect(4, 4, 248, 184, 14); ctx.fill();
  ctx.fillStyle = '#7a5532'; ctx.beginPath(); ctx.roundRect(14, 14, 228, 164, 10); ctx.fill();
  for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(40,24,10,${rnd() * 0.25})`; ctx.fillRect(14 + rnd() * 228, 14 + rnd() * 164, 30 + rnd() * 60, 1.5); }
  ctx.fillStyle = '#e9d9b0'; ctx.strokeStyle = '#e9d9b0'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.save(); ctx.translate(128, 78);
  if (kind === 'smith') {         // an anvil and a hammer
    ctx.beginPath(); ctx.moveTo(-60, -18); ctx.lineTo(40, -18); ctx.quadraticCurveTo(66, -16, 70, -4); ctx.lineTo(28, -4); ctx.lineTo(20, 14); ctx.lineTo(34, 30); ctx.lineTo(-34, 30); ctx.lineTo(-20, 14); ctx.lineTo(-28, -4); ctx.lineTo(-60, -4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-10, -30); ctx.lineTo(30, -62); ctx.stroke(); ctx.fillRect(14, -76, 34, 18);
  } else if (kind === 'bread') {  // a loaf and a pretzel
    ctx.beginPath(); ctx.ellipse(-26, 6, 46, 26, 0, Math.PI, 0); ctx.lineTo(20, 14); ctx.lineTo(-72, 14); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7a5532'; ctx.lineWidth = 4; for (const x of [-50, -30, -10]) { ctx.beginPath(); ctx.moveTo(x, -14); ctx.lineTo(x + 8, 2); ctx.stroke(); }
    ctx.strokeStyle = '#e9d9b0'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(50, -2, 22, 0.3, Math.PI * 2 - 0.3); ctx.moveTo(32, -8); ctx.lineTo(68, 18); ctx.moveTo(68, -8); ctx.lineTo(32, 18); ctx.stroke();
  } else if (kind === 'inn') {    // a tankard with a frog on it
    ctx.beginPath(); ctx.roundRect(-40, -34, 60, 70, 6); ctx.fill(); ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(26, 0, 18, -1.3, 1.3); ctx.stroke();
    ctx.fillStyle = '#f6efe0'; ctx.beginPath(); ctx.ellipse(-10, -38, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5f7a3a'; ctx.beginPath(); ctx.ellipse(-10, 4, 16, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(-18, -8, 5, 0, Math.PI * 2); ctx.arc(-2, -8, 5, 0, Math.PI * 2); ctx.fill();
  } else {                        // goods: a sack and a pair of scales
    ctx.beginPath(); ctx.moveTo(-60, 30); ctx.quadraticCurveTo(-72, -10, -46, -28); ctx.lineTo(-30, -28); ctx.quadraticCurveTo(-4, -10, -16, 30); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(40, -40); ctx.lineTo(40, 30); ctx.moveTo(10, -28); ctx.lineTo(70, -28); ctx.stroke();
    for (const x of [10, 70]) { ctx.beginPath(); ctx.moveTo(x, -28); ctx.lineTo(x - 12, -2); ctx.lineTo(x + 12, -2); ctx.closePath(); ctx.stroke(); }
  }
  ctx.restore();
  ctx.fillStyle = '#f2e6c4'; ctx.font = '600 25px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText(label, 128, 168);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
