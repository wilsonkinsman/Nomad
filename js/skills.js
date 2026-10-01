// The skill tree: a few nodes you can learn with skill points. It is plain data (SKILLS), so adding a
// skill is adding an entry; `requires` draws a node under the one it grows from. What you have learned
// is kept in the browser (localStorage). Open it from the menu or with K.
const SAVE = 'nomad_skills';
const START_POINTS = 1;

const ICONS = {
  // a figure caught mid-blink between two streaks
  flash: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
    '<path d="M4 15h13M2 24h17M6 33h12" opacity=".7"/><circle cx="31" cy="14" r="4.5" fill="currentColor" stroke="none"/>' +
    '<path d="M31 20l-6 9 7 3-4 9M31 20l7 6M25 29l-7 2"/><path d="M42 18l3-3M43 27h4M41 36l3 3" opacity=".7"/></g></svg>',
};

export const SKILLS = [
  { id: 'flash', name: 'Flash Roll', cost: 1, requires: null, col: 0, row: 0, icon: ICONS.flash,
    desc: 'Tap the roll twice, fast (C or right-click). Instead of rolling you vanish in a flash of black lines and appear where the roll would have ended.' },
];

export class Skills {
  constructor() {
    this.learned = new Set(); this.points = START_POINTS;
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) || 'null');
      if (s && Array.isArray(s.learned)) { for (const id of s.learned) if (SKILLS.some((k) => k.id === id)) this.learned.add(id); this.points = Math.max(0, s.points | 0); }
    } catch { /* private mode: start fresh */ }
    this.root = document.getElementById('skills');
    this.tree = document.getElementById('sk-tree');
    this.info = document.getElementById('sk-points');
    document.getElementById('sk-close').onclick = () => this.close();
    document.getElementById('sk-reset').onclick = () => this.reset();
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    this.render();
  }

  has(id) { return this.learned.has(id); }
  get isOpen() { return !this.root.hidden; }
  can(sk) { return !this.has(sk.id) && this.points >= sk.cost && (!sk.requires || this.has(sk.requires)); }

  learn(id) {
    const sk = SKILLS.find((k) => k.id === id);
    if (!sk || !this.can(sk)) return;
    this.learned.add(id); this.points -= sk.cost; this.save(); this.render();
  }
  // give every point back
  reset() {
    let back = 0; for (const id of this.learned) back += SKILLS.find((k) => k.id === id).cost;
    this.learned.clear(); this.points += back; this.save(); this.render();
  }
  save() { try { localStorage.setItem(SAVE, JSON.stringify({ learned: [...this.learned], points: this.points })); } catch { /* ignore */ } }

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
        `<em>${state === 'learned' ? 'Learned' : state === 'ready' ? `Learn · ${sk.cost} point` : sk.requires ? 'Needs an earlier skill' : `Needs ${sk.cost} point`}</em></span>`;
      n.onclick = () => this.learn(sk.id);
      this.tree.appendChild(n);
    }
  }
}
