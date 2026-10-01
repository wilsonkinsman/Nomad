// The skill tree: a few nodes you can learn with skill points, grown along elemental paths (PATHS, one column
// each). It is plain data (SKILLS), so adding a skill is adding an entry; `requires` draws a line from the
// node it grows from, which may sit on another path. What you have learned
// is kept in the browser (localStorage). Open it from the menu or with K.
const SAVE = 'nomad_skills';
const GRANTED = 8;       // skill points in all, so far

// each path is `cols` grid columns wide; a skill's `col` is its place inside its path (0.5: centred over two)
export const PATHS = {
  strength: { name: 'Strength', cols: 1 },
  lightning: { name: 'Lightning', cols: 2 },
  earth: { name: 'Earth', cols: 2 },
};

const ICONS = {
  // a great arrow with a bolt along it
  thunderarrow: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 42L40 8M40 8l-12 2M40 8l-2 12"/><path d="M12 30l6 2-2 4 6 1" opacity=".8"/><path d="M4 46l5-1M3 40l3-3" opacity=".6"/></g></svg>',
  // a blade standing in cracked ground, stones in the air round it
  earth: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M24 4v26M19 10h10"/><path d="M6 36h36M24 36l-5 7M24 36l6 6M14 36l-4 5M34 36l5 4"/><path d="M9 20l4-3 3 3-3 3zM35 16l4-2 2 4-4 2z"/></g></svg>',
  // a foot meeting a boulder, chips flying off it
  rockkick: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 10l7 14 4 12h8"/><path d="M30 20l7-3 6 4 1 7-5 5-7-1-4-6z"/><path d="M24 14l2 3M28 40l1-3M20 26h-3M47 14l-2 2M45 40l-2-2" opacity=".75"/></g></svg>',
  // a wall of piled stones
  wall: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round">' +
    '<path d="M6 42V18l6-6 8 3 8-5 8 4 6 4v24z"/><path d="M6 30h36M15 30v12M27 30v12M21 18v12M33 18v12" stroke-linecap="round"/><path d="M2 44h44" stroke-linecap="round"/></g></svg>',
  // a figure caught mid-blink between two streaks
  // a figure above a ring of shock on the ground
  // a figure low on all fours with a bolt along its back
  tackle: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 31q5-9 17-8l8 3v7M13 31l-3 9M31 33l4 7M18 24l-5-5"/><path d="M40 12l-6 8h6l-5 8"/><path d="M2 22h6M1 30h5M4 38h5" opacity=".7"/></g></svg>',
  // a blade held up with a bolt coming down onto it
  storm: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M28 3l-8 13h7l-6 12"/><path d="M24 31v14M18 37h12"/><path d="M10 14q-4 3 0 7M38 14q4 3 0 7" opacity=".7"/></g></svg>',
  skyslam: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
    '<path d="M24 4v14M18 12l6-8 6 8"/><circle cx="24" cy="24" r="3.2" fill="currentColor" stroke="none"/><path d="M24 28v6M8 40q16-9 32 0M3 44q21-12 42 0" opacity=".85"/></g></svg>',
  flash: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
    '<path d="M4 15h13M2 24h17M6 33h12" opacity=".7"/><circle cx="31" cy="14" r="4.5" fill="currentColor" stroke="none"/>' +
    '<path d="M31 20l-6 9 7 3-4 9M31 20l7 6M25 29l-7 2"/><path d="M42 18l3-3M43 27h4M41 36l3 3" opacity=".7"/></g></svg>',
};

export const SKILLS = [
  { id: 'skyslam', name: 'Sky Slam', path: 'strength', cost: 1, requires: null, row: 0, icon: ICONS.skyslam,
    desc: 'Press jump again in the air to leap much higher. At the top, click to plunge: the landing is a shockwave that hurts everything around you and tears up the grass. Under Earth Power the landing raises a ring of stone that traps you in with whoever is near for six seconds.' },
  // lightning: everything grows out of the charged blade
  { id: 'storm', name: 'Storm Call', path: 'lightning', cost: 1, requires: null, row: 0, col: 0.5, icon: ICONS.storm,
    desc: 'Press R. Hold the blade straight up and call down lightning onto it. For forty-five seconds the sword crackles: it hits harder, stuns what it hits and singes the leaves. Once it fades the sky needs ten seconds before it will answer again.' },
  { id: 'flash', name: 'Flash Roll', path: 'lightning', cost: 1, requires: 'storm', row: 1, col: 0, icon: ICONS.flash,
    desc: 'Tap the roll twice, fast (C or right-click). Instead of rolling you vanish in a flash of black lines and appear where the roll would have ended.' },
  { id: 'tackle', name: 'Electrical Tackle', path: 'lightning', cost: 1, requires: 'storm', row: 1, col: 1, icon: ICONS.tackle,
    desc: 'Press T while the storm is on your blade. He drops to all fours and a great cat of lightning forms around him, then the cat pounces: eight metres in a flash, straight at whatever is ahead, and rears up to rake it with both paws. The ground behind is burnt and whatever it catches is stunned.' },
  { id: 'thunderarrow', name: 'Thunder Arrow', path: 'lightning', cost: 1, requires: 'storm', row: 2, col: 0.5, icon: ICONS.thunderarrow,
    desc: 'With the storm on your blade, hold the bow past full draw. The camera pulls far back, you lean into it and the arrow takes the storm; release, and a great arrow of lightning tears a burnt trench sixty metres long through everything in its way. It spends the storm.' },
  // earth
  { id: 'earth', name: 'Earth Power', path: 'earth', cost: 1, requires: null, row: 0, col: 0.5, icon: ICONS.earth,
    desc: 'Press G. Drive the blade into the ground and the earth answers: stones rise and circle you. For forty seconds you take half damage, your blows throw things back, and Sky Slam raises a ring of stone. Ten seconds to recover after it fades.' },
  { id: 'wall', name: 'Earth Wall', path: 'earth', cost: 1, requires: 'earth', row: 1, col: 0, icon: ICONS.wall,
    desc: 'Press Q while Earth Power is on you. A wall of rock tears up out of the ground in front of you (one every second and a half): arrows shatter on it, nothing walks through it, and a dash into it ends with whoever dashed stunned on the ground.' },
  { id: 'rockkick', name: 'Rock Kick', path: 'earth', cost: 1, requires: 'earth', row: 1, col: 1, icon: ICONS.rockkick,
    desc: 'Press E while Earth Power is on you. Stomp, and a boulder bursts up out of the ground in a spray of stones; side-kick it and it flies low and very fast, flattening the field as it passes and shattering on whatever it hits, throwing it back hard.' },
];

export class Skills {
  constructor() {
    this.learned = new Set();
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) || 'null');
      if (s && Array.isArray(s.learned)) for (const id of s.learned) if (SKILLS.some((k) => k.id === id)) this.learned.add(id);
    } catch { /* private mode: start fresh */ }
    // the tree has changed shape over time: a skill whose root is no longer learned is given back
    for (let again = true; again;) {
      again = false;
      for (const id of this.learned) { const sk = SKILLS.find((k) => k.id === id); if (sk.requires && !this.learned.has(sk.requires)) { this.learned.delete(id); again = true; } }
    }
    this.root = document.getElementById('skills');
    this.tree = document.getElementById('sk-tree');
    this.info = document.getElementById('sk-points');
    document.getElementById('sk-close').onclick = () => this.close();
    document.getElementById('sk-reset').onclick = () => this.reset();
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    this.render();
  }

  // points left: what has been granted, less what the learned skills cost
  get points() { let spent = 0; for (const id of this.learned) spent += SKILLS.find((k) => k.id === id).cost; return Math.max(0, GRANTED - spent); }
  has(id) { return this.learned.has(id); }
  get isOpen() { return !this.root.hidden; }
  can(sk) { return !this.has(sk.id) && this.points >= sk.cost && (!sk.requires || this.has(sk.requires)); }

  learn(id) {
    const sk = SKILLS.find((k) => k.id === id);
    if (!sk || !this.can(sk)) return;
    this.learned.add(id); this.save(); this.render();
  }
  // give every point back
  reset() { this.learned.clear(); this.save(); this.render(); }
  save() { try { localStorage.setItem(SAVE, JSON.stringify({ learned: [...this.learned] })); } catch { /* ignore */ } }

  open() { this.root.hidden = false; this.render(); }
  close() { this.root.hidden = true; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  render() {
    this.info.textContent = this.points + (this.points === 1 ? ' skill point' : ' skill points');
    const paths = Object.entries(PATHS);
    // two grid tracks per column, so a node can sit centred over two columns
    let at = 0; for (const [, p] of paths) { p.at = at; at += p.cols; }
    this.tree.style.gridTemplateColumns = `repeat(${at * 2}, minmax(0, 96px))`;
    this.tree.textContent = '';
    // a heading for each path, then its skills (row 0 is the heading)
    for (const [id, p] of paths) {
      const h = document.createElement('div');
      h.className = 'sk-path ' + id; h.textContent = p.name; h.style.gridColumn = `${p.at * 2 + 1} / span ${p.cols * 2}`; h.style.gridRow = 1;
      this.tree.appendChild(h);
    }
    // a place held for what the Strength path will grow into
    const soon = document.createElement('div');
    soon.className = 'sk-node soon'; soon.textContent = 'More to come'; soon.style.gridColumn = `${PATHS.strength.at * 2 + 1} / span 2`; soon.style.gridRow = 3;
    this.tree.appendChild(soon);
    const nodes = {};
    for (const sk of SKILLS) {
      const state = this.has(sk.id) ? 'learned' : this.can(sk) ? 'ready' : 'locked';
      const n = document.createElement('button');
      nodes[sk.id] = n;
      n.className = 'sk-node ' + sk.path + ' ' + state;
      n.style.gridColumn = `${(PATHS[sk.path].at + (sk.col || 0)) * 2 + 1} / span 2`; n.style.gridRow = sk.row + 2;
      n.disabled = state !== 'ready';
      n.innerHTML = `<span class="sk-icon">${sk.icon}</span><span class="sk-body"><b>${sk.name}</b><i>${sk.desc}</i>` +
        `<em>${state === 'learned' ? 'Learned' : state === 'ready' ? `Learn · ${sk.cost} point` : sk.requires && !this.has(sk.requires) ? 'Needs ' + SKILLS.find((k) => k.id === sk.requires).name : `Needs ${sk.cost} point`}</em></span>`;
      n.onclick = () => this.learn(sk.id);
      this.tree.appendChild(n);
    }
    this.links(nodes);
  }

  // a line from each skill up to the one it grows from, once the grid has been laid out (it may cross to another path)
  links(nodes) {
    const draw = () => {
      const old = this.tree.querySelector('svg.sk-links'); if (old) old.remove();
      if (this.root.hidden) return;
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'sk-links');
      const T = this.tree.getBoundingClientRect();
      for (const sk of SKILLS) {
        if (!sk.requires) continue;
        const a = nodes[sk.requires].getBoundingClientRect(), b = nodes[sk.id].getBoundingClientRect();
        const x1 = a.left + a.width / 2 - T.left, y1 = a.bottom - T.top, x2 = b.left + b.width / 2 - T.left, y2 = b.top - T.top, ym = (y1 + y2) / 2;
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', `M${x1} ${y1}V${ym}H${x2}V${y2}`);
        p.setAttribute('class', this.has(sk.requires) ? 'on' : '');
        svg.appendChild(p);
      }
      this.tree.appendChild(svg);
    };
    requestAnimationFrame(draw);
  }
}
