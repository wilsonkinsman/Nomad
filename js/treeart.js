// The skill trees. Each path of the skill tree (skills.js) is drawn as a tree of its own, which grows as its skills
// are learned. With nothing learned it is a seed with a sprout in a mound of earth (the path's first skill sits on
// the seed). Learn that skill and a young trunk comes up; learn a skill that grows from it and the bough that skill
// sits on grows out of the trunk with its twigs and leaves; learn them all and the tree fills out into a full crown
// and comes into its own: a glow, and something of its element (golden fruit on Strength, arcs crackling through
// Lightning, blossom and stones on Earth, leaves blown off Wind). The faint shape of the whole tree is always there
// behind it, so you can see what it will become.
// Each tree is generated from its own seed, so it is the same tree every time, drawn in SVG, and grows by CSS: a
// branch draws itself along its length (stroke-dashoffset) and a leaf opens (scale), each a little after the one
// below it. Each skill is a button on the tree (TreeArt.nodes), which skills.js styles and listens to.
import { mulberry32 } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
export const W = 240, H = 350, GROUND = 292;
const CX = 120, TAU = Math.PI * 2;

// the habit of each tree: how its trunk and boughs bend, how wide it forks, the shape and colours of its leaves
const STYLES = {
  // a broad oak, autumn-gold
  strength: { seed: 7, color: '#d9a066', bark: '#a98c6a', leaves: ['#e3a865', '#d48a4c', '#f1c47e', '#c9763e'], height: 176, trunk: 13, bough: 1.0, fork: 0.55, spread: 1.0,
    leaf: { rx: 5.6, ry: 3.3 }, bend: (rnd) => (i, a) => a + (rnd() - 0.5) * 0.28 },
  // forked like lightning, its leaves shards of light
  lightning: { seed: 19, color: '#9cc2ff', bark: '#8195bb', leaves: ['#9cc2ff', '#c9ddff', '#6e9bf2', '#e6f0ff'], height: 196, trunk: 10, bough: 0.95, fork: 0.62, spread: 0.95,
    leaf: { rx: 5, ry: 2.6, shard: true }, bend: (rnd) => { let a0 = null; return (i, a) => { if (a0 === null) a0 = a; return a0 + (i % 2 ? 0.42 : -0.42) * (0.7 + rnd() * 0.6); }; } },
  // gnarled and squat, rooted among stones
  earth: { seed: 31, color: '#b7c27a', bark: '#94896f', leaves: ['#b7c27a', '#93a556', '#cfd697', '#7d8f45'], height: 160, trunk: 16, bough: 1.08, fork: 0.6, spread: 1.15,
    leaf: { rx: 3.9, ry: 3.6 }, roots: true, bend: (rnd) => (i, a) => a + (rnd() - 0.5) * 0.5 },
  // a willow leaning in the wind, its long leaves hanging
  wind: { seed: 43, color: '#a8dccf', bark: '#8aaba2', leaves: ['#a8dccf', '#d2f1ea', '#79bba9', '#bfe9df'], height: 188, trunk: 9, bough: 0.8, fork: 0.5, spread: 1.0,
    leaf: { rx: 7.5, ry: 1.9, hang: true }, droop: 0.3, bend: (rnd) => (i, a) => a + 0.035 + (rnd() - 0.5) * 0.12 },
};

const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const f2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- the shape of a tree
// A run of n segments from (x, y) heading `a` (0 is straight up, + leans right), the width easing from w0 to w1,
// turned at each step by bend(i, a). Each segment is { x0, y0, x1, y1, w, l, t }: t is how far up the tree it
// starts, measured along the wood, which orders the growth. Returns the points along it ({ x, y, a, w, t }).
function grow(segs, x, y, a, len, w0, w1, n, t0, bend) {
  const pts = [{ x, y, a, w: w0, t: t0 }], l = len / n;
  for (let i = 0; i < n; i++) {
    a = bend(i, a);
    const nx = x + Math.sin(a) * l, ny = y - Math.cos(a) * l, w = w0 + (w1 - w0) * (i + 1) / n;
    segs.push({ x0: x, y0: y, x1: nx, y1: ny, w: w0 + (w1 - w0) * i / n, l, t: t0 + l * i });
    x = nx; y = ny; pts.push({ x, y, a, w, t: t0 + l * (i + 1) });
  }
  return pts;
}

class Shape {
  constructor(id, style, kids) {
    this.S = style; this.id = id;
    this.items = [];                  // { kind: 'seg' | 'leaf' | 'pop', group, f, ... }
    this.kidAt = [];                  // where each child skill's bough leaves the trunk (fraction up it)
    this.nodes = [];                  // [x, y] of the root skill, then each child skill
    this.make(kids.length);
  }
  rng(k) { return mulberry32(this.S.seed * 977 + k * 131); }
  add(list, group, f) { for (const s of list) this.items.push(Object.assign(s, { group, f: f ?? s.f })); }
  // a leaf at p, turned along angle a (radians), coloured from the tree's own
  leaf(out, p, a, rnd, scale = 1) {
    const S = this.S, L = S.leaf;
    // (SVG turns clockwise from +x, the long axis of the leaf; a branch's angle is from straight up)
    const rot = L.hang ? 90 + (rnd() - 0.5) * 50 : (a + (rnd() - 0.5) * 1.6) * 180 / Math.PI - 90;
    out.push({ kind: 'leaf', x: p.x + (rnd() - 0.5) * 7, y: p.y + (rnd() - 0.5) * 7, rot, rx: L.rx * scale * (0.75 + rnd() * 0.5), ry: L.ry * scale * (0.8 + rnd() * 0.4),
      shard: L.shard, color: S.leaves[(rnd() * S.leaves.length) | 0], t: p.t + 4 });
  }
  // a twig, forking `depth` more times, leaves at its tips
  twig(segs, leaves, p, a, len, w, depth, rnd, side) {
    const S = this.S;
    const bend = S.droop ? (i, b) => b + Math.sign(b || side) * S.droop + (rnd() - 0.5) * 0.1 : S.bend(rnd);
    const pts = grow(segs, p.x, p.y, a, len, w, w * 0.6, depth > 0 ? 3 : 2, p.t, bend);
    const end = pts[pts.length - 1];
    if (depth === 0) { for (let i = 0, n = 3 + ((rnd() * 2) | 0); i < n; i++) this.leaf(leaves, end, end.a, rnd); this.leaf(leaves, pts[1], pts[1].a, rnd, 0.85); return end; }
    for (const s of [-1, 1]) this.twig(segs, leaves, end, end.a + s * S.fork * (0.8 + rnd() * 0.4), len * 0.7, w * 0.62, depth - 1, rnd, s);
    const m = pts[1], s = rnd() < 0.5 ? -1 : 1;
    this.twig(segs, leaves, m, m.a + s * S.fork, len * 0.6, w * 0.6, depth - 1, rnd, s);
    return end;
  }

  make(nKids) {
    const S = this.S, rnd = this.rng(0);
    // the sprout: a seed in the earth, a stem and two first leaves (only until the first skill is learned)
    const sprout = [];
    const sp = grow(sprout, CX, GROUND, -0.1, 34, 2.4, 1.6, 3, 0, (i, a) => a + 0.09);
    for (const s of [-1, 1]) sprout.push({ kind: 'leaf', x: sp[3].x + s * 5, y: sp[3].y - 1, rot: s * 60 - 90, rx: 6, ry: 3, color: S.leaves[0], t: 36 });
    sprout.push({ kind: 'pop', shape: 'seed', x: CX, y: GROUND + 1, t: 0 });
    for (const s of sprout) s.kind = s.kind || 'seg';
    this.add(sprout, 'sprout');
    // the trunk, and leaves along it that come with it as it rises
    const trunk = [];
    const T = this.trunkPts = grow(trunk, CX, GROUND, 0, S.height, S.trunk, S.trunk * 0.35, 10, 0, S.bend(rnd));
    trunk.forEach((s, i) => { s.kind = 'seg'; s.f = (i + 1) / 10; });
    this.add(trunk, 'trunk');
    const tl = [];
    for (const f of [0.24, 0.31, 0.37, 0.5, 0.63, 0.76, 0.88, 0.97]) {
      const p = T[Math.round(f * 10)];
      for (let k = 0; k < 2; k++) { this.leaf(tl, { x: p.x + (rnd() < 0.5 ? -1 : 1) * p.w * 0.8, y: p.y, t: p.t }, p.a + (rnd() < 0.5 ? -1 : 1) * 0.9, rnd, 0.8); tl[tl.length - 1].f = f; }
    }
    this.add(tl, 'trunk');
    // roots spread over the ground (Earth)
    if (S.roots) {
      const roots = [];
      for (const [a, len] of [[-1.75, 30], [-1.35, 22], [1.4, 26], [1.8, 34], [-2.1, 16], [2.15, 18]]) grow(roots, CX + Math.sign(a) * 3, GROUND - 2, a, len, S.trunk * 0.45, 1, 3, 0, S.bend(rnd));
      roots.forEach((s) => { s.kind = 'seg'; s.f = 0.01; });
      this.add(roots, 'trunk');
    }
    this.nodes.push([CX, GROUND + 10]);
    // a bough for each skill that grows from the first: alternately left and right up the trunk, the last at the
    // crown if there is an odd one out
    const crownKid = nKids % 2 === 1 ? nKids - 1 : -1, sides = nKids - (crownKid >= 0 ? 1 : 0);
    let side = -1;
    for (let k = 0; k < nKids; k++) {
      const crown = k === crownKid;
      const f = crown ? 1 : 0.36 + (sides > 1 ? (0.58 - 0.36) * k / (sides - 1) : 0.15);
      const j = Math.round(f * 10), P = T[j], A = T[Math.max(0, j - 2)], B = T[Math.min(10, j + 1)];
      const up = Math.atan2(B.x - A.x, A.y - B.y);      // the way the trunk runs here (over a zigzag, its general way)
      const len0 = (crown ? 62 : 74) * S.spread;
      let segs, leaves, end;
      // turned a little either way, or shortened, until its end (where the skill sits) is well inside the picture
      // and clear of the others
      const TRY = [[0, 1], [-0.2, 1], [0.2, 1], [0, 0.88], [-0.35, 0.95], [0.35, 0.95], [-0.2, 0.82], [0.2, 0.82], [-0.5, 0.85], [0.5, 0.85], [0, 1.12], [-0.3, 1.1]];
      for (let tries = 0; tries < TRY.length; tries++) {
        const [turn, ls] = TRY[tries], len = len0 * ls;
        const r = this.rng(k + 1);
        segs = []; leaves = [];
        const a = (crown ? up + (r() - 0.5) * 0.25 : up + side * S.bough * (0.95 + r() * 0.2)) + turn;
        const bend = S.droop && !crown ? (i, b) => b + side * S.droop * 0.55 + (r() - 0.5) * 0.08 : S.bend(r);
        const pts = grow(segs, P.x, P.y, a, len, P.w * (crown ? 0.95 : 0.62), P.w * 0.3, 5, P.t, bend);
        end = pts[5];
        // (each skill's name hangs under it: clear of that too)
        const clear = this.nodes.every(([x, y]) => Math.abs(end.x - x) > 92 || Math.abs(end.y - y) > 74);
        if (end.x > 30 && end.x < W - 30 && end.y > 30 && end.y < GROUND - 60 && (clear || tries === TRY.length - 1)) {
          // twigs off it, and two from its end round the place where the skill sits
          for (const [i, s] of [[2, -side || -1], [3, side || 1], [4, -side || 1]]) this.twig(segs, leaves, pts[i], pts[i].a + s * S.fork * 1.2, 27 * S.spread, pts[i].w * 0.7, 1, r, s);
          for (const s of [-1, 1]) this.twig(segs, leaves, end, end.a + s * S.fork, 22 * S.spread, end.w * 0.8, 1, r, s);
          for (const i of [2, 3, 4]) this.leaf(leaves, pts[i], pts[i].a, r, 0.9);
          break;
        }
      }
      segs.forEach((s) => { s.kind = 'seg'; });
      this.add(segs, 'kid' + k); this.add(leaves, 'kid' + k);
      this.kidAt.push(f);
      this.nodes.push([end.x, end.y]);
      if (!crown) side = -side;
    }
    // the full crown: more twigs from the top of the trunk and from each bough, the canopy filled in with leaves,
    // and the tree's own fruit, blossom or light
    const r = this.rng(99), segs = [], leaves = [], top = T[10];
    for (const a of crownKid >= 0 ? [-0.85, 0.85] : [-0.8, 0, 0.8]) this.twig(segs, leaves, top, top.a + a, 34 * S.spread, top.w, 2, r, Math.sign(a) || 1);
    for (const it of this.items) if (it.group.startsWith('kid') && it.kind === 'seg' && r() < 0.12) this.twig(segs, leaves, { x: it.x1, y: it.y1, t: it.t + it.l }, Math.atan2(it.x1 - it.x0, it.y0 - it.y1) + (r() - 0.5) * 1.4, 16 * S.spread, Math.max(1, it.w * 0.6), 0, r, 1);
    const canopy = this.items.filter((it) => it.kind === 'leaf' && it.group !== 'sprout' && it.group !== 'trunk').concat(leaves);
    for (let i = 0; i < 34 && canopy.length; i++) { const c = canopy[(r() * canopy.length) | 0]; this.leaf(leaves, { x: c.x + (r() - 0.5) * 12, y: c.y + (r() - 0.5) * 10, t: c.t + 6 }, (r() - 0.5) * 2, r); }
    segs.forEach((s) => { s.kind = 'seg'; });
    this.add(segs, 'crown'); this.add(leaves, 'crown');
    const all = canopy.concat(leaves);
    const pops = [];
    for (let i = 0; i < 10 && all.length; i++) { const c = all[(r() * all.length) | 0]; pops.push({ kind: 'pop', shape: this.id === 'strength' ? 'fruit' : this.id === 'earth' ? 'bloom' : this.id === 'lightning' ? 'spark' : 'bud', x: c.x, y: c.y, t: c.t + 10 }); }
    this.add(pops, 'crown');
    // the canopy's middle and size, for the glow behind it
    let mx = 0, my = 0; for (const c of all) { mx += c.x; my += c.y; }
    mx /= all.length || 1; my /= all.length || 1;
    let rx = 30, ry = 30; for (const c of all) { rx = Math.max(rx, Math.abs(c.x - mx)); ry = Math.max(ry, Math.abs(c.y - my)); }
    this.canopy = { x: mx, y: my, rx: Math.min(rx + 14, W * 0.55), ry: Math.min(ry + 14, 130), leaves: all };
  }
}

// ---------------------------------------------------------------- the drawing
export class TreeArt {
  constructor(id, name, skills, rootIcon) {
    this.id = id; this.skills = skills;              // the path's skills: the root first
    const S = STYLES[id] || STYLES.strength;
    this.S = S;
    this.shape = new Shape(id, S, skills.slice(1));
    const box = this.el = document.createElement('div');
    box.className = 'tr-box ' + id; box.style.setProperty('--c', S.color);
    const svg = this.svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tr-svg', 'aria-hidden': 'true' }, box);
    const defs = el('defs', {}, svg);
    const grad = el('radialGradient', { id: 'tr-halo-' + id }, defs);
    el('stop', { offset: '0', 'stop-color': S.color, 'stop-opacity': '0.32' }, grad);
    el('stop', { offset: '1', 'stop-color': S.color, 'stop-opacity': '0' }, grad);
    // the ground: a mound of earth under the tree
    el('ellipse', { cx: CX, cy: GROUND + 7, rx: 84, ry: 12, fill: S.color, 'fill-opacity': '0.06', stroke: S.color, 'stroke-opacity': '0.16' }, svg);
    // the glow behind a full crown, and the faint shape of the whole tree
    const C = this.shape.canopy;
    this.halo = el('ellipse', { cx: f2(C.x), cy: f2(C.y), rx: f2(C.rx * 1.25), ry: f2(C.ry * 1.25), fill: `url(#tr-halo-${id})`, class: 'tr-halo' }, svg);
    const ghost = el('g', { class: 'tr-ghost', stroke: S.bark }, svg);
    for (const it of this.shape.items) if (it.kind === 'seg' && it.group !== 'sprout') el('line', { x1: f2(it.x0), y1: f2(it.y0), x2: f2(it.x1), y2: f2(it.y1), 'stroke-width': f2(Math.max(0.6, it.w * 0.55)) }, ghost);
    const wood = el('g', { class: 'tr-wood', stroke: S.bark }, svg), foliage = el('g', { class: 'tr-leaves' }, svg), extra = el('g', { class: 'tr-extra' }, svg);
    this.items = [];
    for (const it of this.shape.items) {
      let node;
      if (it.kind === 'seg') {
        const l = f2(it.l + it.w);
        node = el('line', { x1: f2(it.x0), y1: f2(it.y0), x2: f2(it.x1), y2: f2(it.y1), 'stroke-width': f2(it.w), 'stroke-dasharray': `${l} ${l * 2}`, 'stroke-dashoffset': l, class: 'tr-seg' }, wood);
        if (it.group === 'sprout') node.setAttribute('stroke', S.leaves[2]);
      } else {
        node = el('g', { class: 'tr-pop' }, it.kind === 'leaf' ? foliage : extra);
        if (it.kind === 'leaf') {
          if (it.shard) el('path', { d: `M${f2(-it.rx)} 0L0 ${f2(-it.ry)}L${f2(it.rx)} 0L0 ${f2(it.ry)}Z`, fill: it.color, transform: `translate(${f2(it.x)} ${f2(it.y)}) rotate(${f2(it.rot)})` }, node);
          else el('ellipse', { cx: 0, cy: 0, rx: f2(it.rx), ry: f2(it.ry), fill: it.color, transform: `translate(${f2(it.x)} ${f2(it.y)}) rotate(${f2(it.rot)})` }, node);
          if (this.id === 'wind' && it.group === 'crown' && Math.random() < 0.3) node.classList.add('tr-flutter');
        } else this.popShape(node, it);
      }
      node.style.setProperty('--sw', ((it.x * 7 + it.y * 3) % 10 / 10 * 2).toFixed(2) + 's');     // where in its sway each leaf starts
      this.items.push({ it, node, on: false });
    }
    // what only a full tree has: arcs through Lightning, stones at the foot of Earth, leaves blown off Wind
    this.flourish = el('g', { class: 'tr-flourish' }, svg);
    this.makeFlourish();
    // a button for each skill, where it sits on the tree
    this.nodes = {};
    skills.forEach((sk, i) => {
      const [x, y] = this.shape.nodes[i];
      const b = document.createElement('button');
      b.className = 'tr-node'; b.style.left = (x / W * 100).toFixed(2) + '%'; b.style.top = (y / H * 100).toFixed(2) + '%';
      b.innerHTML = `<span class="tr-ring">${sk.icon}</span><span class="tr-name">${sk.name}</span>`;
      box.appendChild(b); this.nodes[sk.id] = b;
    });
    this.label = document.createElement('div'); this.label.className = 'tr-label';
    box.appendChild(this.label);
    this.label.innerHTML = `<b>${name}</b><span></span>`;
    this.count = this.label.querySelector('span');
    this.full = false;
  }

  popShape(g, it) {
    const S = this.S, t = `translate(${f2(it.x)} ${f2(it.y)})`;
    if (it.shape === 'seed') el('ellipse', { cx: 0, cy: 0, rx: 5, ry: 3.2, fill: '#6b5a3f', transform: t }, g);
    else if (it.shape === 'fruit') { el('circle', { r: 4.2, fill: '#f6c76c', transform: t }, g); el('circle', { r: 1.4, fill: '#fff4cf', transform: t + ' translate(-1.3 -1.3)' }, g); }
    else if (it.shape === 'bloom') { for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; el('circle', { r: 2.3, cx: f2(Math.cos(a) * 2.6), cy: f2(Math.sin(a) * 2.6), fill: '#f4e6ee', transform: t }, g); } el('circle', { r: 1.5, fill: '#e8c27a', transform: t }, g); }
    else if (it.shape === 'spark') el('path', { d: 'M0 -5L1.3 -1.3L5 0L1.3 1.3L0 5L-1.3 1.3L-5 0L-1.3 -1.3Z', fill: '#eef5ff', transform: t }, g);
    else el('ellipse', { rx: 3, ry: 4.2, fill: S.leaves[1], transform: t }, g);
  }

  makeFlourish() {
    const S = this.S, C = this.shape.canopy, r = mulberry32(S.seed * 31), L = C.leaves, F = this.flourish;
    if (!L.length) return;
    const pick = () => L[(r() * L.length) | 0];
    if (this.id === 'lightning') {
      for (let i = 0; i < 6; i++) {
        const a = pick(), b = pick(), n = 5, pts = [];
        for (let k = 0; k <= n; k++) { const u = k / n; pts.push(`${f2(a.x + (b.x - a.x) * u + (k % n ? (r() - 0.5) * 12 : 0))},${f2(a.y + (b.y - a.y) * u + (k % n ? (r() - 0.5) * 12 : 0))}`); }
        const p = el('polyline', { points: pts.join(' '), class: 'tr-arc' }, F);
        p.style.animationDelay = (r() * 2.4).toFixed(2) + 's'; p.style.animationDuration = (1.8 + r() * 1.6).toFixed(2) + 's';
      }
    } else if (this.id === 'earth') {
      for (const [x, s] of [[CX - 58, 9], [CX - 40, 6], [CX + 44, 8], [CX + 62, 5.5], [CX - 70, 4.5], [CX + 25, 4]]) {
        const pts = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; pts.push(`${f2(x + Math.cos(a) * s * (0.8 + r() * 0.4))},${f2(GROUND + 4 + Math.sin(a) * s * 0.6 * (0.8 + r() * 0.4))}`); }
        el('polygon', { points: pts.join(' '), class: 'tr-stone' }, F);
      }
    } else if (this.id === 'wind') {
      for (let i = 0; i < 7; i++) {
        const c = pick(), g = el('g', { class: 'tr-drift' }, F);
        el('ellipse', { rx: 5.5, ry: 1.6, fill: S.leaves[(r() * 4) | 0], transform: `translate(${f2(c.x)} ${f2(c.y)}) rotate(${f2(r() * 360)})` }, g);
        g.style.animationDelay = (r() * 4).toFixed(2) + 's'; g.style.animationDuration = (3.2 + r() * 2).toFixed(2) + 's';
      }
    } else {
      for (let i = 0; i < 5; i++) {
        const c = pick(), g = el('circle', { cx: f2(c.x), cy: f2(c.y), r: 1.6, class: 'tr-mote' }, F);
        g.style.animationDelay = (r() * 3).toFixed(2) + 's';
      }
    }
  }

  // Show the tree for the skills learned. Whatever appears grows in order up the tree at `speed` (units of wood a
  // second); whatever goes, goes at once. `instant`: no growing at all.
  update(learned, speed = 320, instant = false) {
    const [root, ...kids] = this.skills, rootOn = learned.has(root.id);
    const kidOn = kids.map((k) => learned.has(k.id)), all = rootOn && kidOn.every(Boolean);
    let reach = 0;
    if (rootOn) { reach = 0.38; kidOn.forEach((on, i) => { if (on) reach = Math.max(reach, this.shape.kidAt[i]); }); if (all) reach = 1; }
    const shows = (it) => it.group === 'sprout' ? !rootOn : it.group === 'trunk' ? rootOn && it.f <= reach + 1e-6
      : it.group === 'crown' ? all : kidOn[+it.group.slice(3)];
    this.svg.classList.toggle('instant', instant);
    const fresh = [];
    for (const e of this.items) {
      const want = shows(e.it);
      if (want === e.on) continue;
      e.on = want;
      if (want) fresh.push(e);
      else { e.node.style.setProperty('--d', '0s'); e.node.style.setProperty('--g', '0.18s'); e.node.classList.remove('on'); }
    }
    let t0 = Infinity; for (const e of fresh) t0 = Math.min(t0, e.it.t);
    for (const e of fresh) {
      const d = instant ? 0 : (e.it.t - t0) / speed + (e.it.kind === 'seg' ? 0 : 0.06);
      e.node.style.setProperty('--d', d.toFixed(3) + 's');
      if (e.it.kind === 'seg') e.node.style.setProperty('--g', instant ? '0s' : (e.it.l / speed).toFixed(3) + 's');
      e.node.classList.add('on');
    }
    // the glory of a finished tree comes once it has grown
    let last = 0; for (const e of fresh) last = Math.max(last, (e.it.t - t0) / speed);
    this.el.style.setProperty('--full-d', (instant || !isFinite(last) ? 0 : last).toFixed(2) + 's');
    this.el.classList.toggle('full', all);
    this.full = all;
    if (instant) { void this.svg.getBoundingClientRect(); this.svg.classList.remove('instant'); }
    const n = (rootOn ? 1 : 0) + kidOn.filter(Boolean).length;
    this.count.textContent = all ? 'full grown' : `${n} / ${this.skills.length}`;
  }
}
