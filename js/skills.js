// The skill tree: a few nodes you can learn with skill points. It is plain data (SKILLS), so adding a
// skill is adding an entry; `requires` draws a node under the one it grows from. What you have learned
// is kept in the browser (localStorage). Open it from the menu or with K.
const SAVE = 'nomad_skills';
const GRANTED = 3;       // skill points in all, so far

const ICONS = {
  // a figure caught mid-blink between two streaks
  // a figure above a ring of shock on the ground
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
  { id: 'skyslam', name: 'Sky Slam', cost: 1, requires: null, col: 1, row: 0, icon: ICONS.skyslam,
    desc: 'Press jump again in the air to leap much higher. At the top, click to plunge: the landing is a shockwave that hurts everything around you and tears up the grass.' },
  { id: 'storm', name: 'Storm Call', cost: 1, requires: 'skyslam', col: 1, row: 1, icon: ICONS.storm,
    desc: 'Press R. Hold the blade straight up and call down lightning onto it. For twenty seconds the sword crackles: it hits harder, stuns what it hits and singes the leaves.' },
  { id: 'flash', name: 'Flash Roll', cost: 1, requires: null, col: 0, row: 0, icon: ICONS.flash,
    desc: 'Tap the roll twice, fast (C or right-click). Instead of rolling you vanish in a flash of black lines and appear where the roll would have ended.' },
];

export class Skills {
  constructor() {
    this.learned = new Set();
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) || 'null');
      if (s && Array.isArray(s.learned)) for (const id of s.learned) if (SKILLS.some((k) => k.id === id)) this.learned.add(id);
    } catch { /* private mode: start fresh */ }
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
    const rows = Math.max(...SKILLS.map((k) => k.row)) + 1, cols = Math.max(...SKILLS.map((k) => k.col)) + 1;
    this.tree.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 260px))`;
    this.tree.style.gridTemplateRows = `repeat(${rows}, auto)`;
    this.tree.textContent = '';
    for (const sk of SKILLS) {
      const state = this.has(sk.id) ? 'learned' : this.can(sk) ? 'ready' : 'locked';
      const n = document.createElement('button');
      n.className = 'sk-node ' + state + (sk.requires ? ' has-req' : '');
      n.style.gridColumn = sk.col + 1; n.style.gridRow = sk.row + 1;
      n.disabled = state !== 'ready';
      n.innerHTML = `<span class="sk-icon">${sk.icon}</span><span class="sk-body"><b>${sk.name}</b><i>${sk.desc}</i>` +
        `<em>${state === 'learned' ? 'Learned' : state === 'ready' ? `Learn · ${sk.cost} point` : sk.requires && !this.has(sk.requires) ? 'Needs ' + SKILLS.find((k) => k.id === sk.requires).name : `Needs ${sk.cost} point`}</em></span>`;
      n.onclick = () => this.learn(sk.id);
      this.tree.appendChild(n);
    }
  }
}
