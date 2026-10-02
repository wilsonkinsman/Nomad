// The skills, learned with skill points along elemental paths (PATHS). Each path is drawn as a tree of its own
// that grows as its skills are learned, from a seed to a full tree (treeart.js): the path's first skill is the
// seed, and each skill that grows from it (`requires`) is a bough. It is plain data (SKILLS), so adding a skill is
// adding an entry. Pick a skill on a tree to see what it does, and learn it from there. Open it from the menu or
// with K.
//
// Skill points are earned: each fairy found on the plain (fairies.js) and each quest finished (quests.js) is
// worth one, through award(key). A key is earned once ('fairy:3', 'quest:oni'), so the ledger is also the record
// of which fairies are found and which quests are done. Skills learned before points had to be earned are kept,
// paid for by `legacy`. Admin mode (a switch at the top) gives unlimited points for testing, and can wipe all
// progress. All of it is kept in the browser (localStorage).
import { TreeArt } from './treeart.js';

const SAVE = 'nomad_skills';
const ADMIN_POINTS = 99;

export const PATHS = {
  strength: { name: 'Strength' },
  lightning: { name: 'Lightning' },
  earth: { name: 'Earth' },
  wind: { name: 'Wind' },
};

const ICONS = {
  // a blade held level inside a whirl of wind
  wind: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 26h28M36 26l5-1.5"/><path d="M12 18q12-9 25 0M38 34q-13 9-26 0" opacity=".85"/><path d="M6 12q7-5 15-3M42 40q-7 4-15 2" opacity=".6"/></g></svg>',
  // a crow, wings spread, streaming wind, a figure hanging from its feet
  crow: '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 14l9 1 6 4 5-1 5 1 6-4 9-1-7 6-6 2h-4l-3-1-3 1h-4l-6-2z"/><path d="M24 18l2-4 3 1"/><path d="M22 23v7M26 23v7"/>' +
    '<circle cx="24" cy="34" r="2.4"/><path d="M24 36v6M21 46l3-4 3 4"/><path d="M2 24h6M40 24h6" opacity=".6"/></g></svg>',
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
  { id: 'skyslam', name: 'Sky Slam', path: 'strength', cost: 1, requires: null, icon: ICONS.skyslam,
    desc: 'Press jump again in the air to leap much higher. At the top, click to plunge: the landing is a shockwave that hurts everything around you and tears up the grass. With the wind on you, a whirlwind throws everyone near high into the air and slams them back down. Under Earth Power the landing raises a ring of stone round you and whoever is near for six seconds, too high to jump: only another Sky Slam gets you over it.' },
  // lightning: everything grows out of the charged blade
  { id: 'storm', name: 'Storm Call', path: 'lightning', cost: 1, requires: null, icon: ICONS.storm,
    desc: 'Press R. Hold the blade straight up and call down lightning onto it. For forty-five seconds the sword crackles: it hits harder, stuns what it hits and singes the leaves. Once it fades the sky needs ten seconds before it will answer again.' },
  { id: 'flash', name: 'Flash Roll', path: 'lightning', cost: 1, requires: 'storm', icon: ICONS.flash,
    desc: 'Tap the roll (or the dodge) twice, fast (C or right-click). Instead of rolling you vanish in a flash of black lines and appear where the roll would have ended.' },
  { id: 'tackle', name: 'Electrical Tackle', path: 'lightning', cost: 1, requires: 'storm', icon: ICONS.tackle,
    desc: 'Press T while the storm is on your blade. He drops to all fours and a great cat of lightning forms around him, then the cat pounces: eight metres in a flash, straight at whatever is ahead, and rears up to rake it with both paws. The ground behind is burnt and whatever it catches is stunned.' },
  { id: 'thunderarrow', name: 'Thunder Arrow', path: 'lightning', cost: 1, requires: 'storm', icon: ICONS.thunderarrow,
    desc: 'With the storm on your blade, hold the bow past full draw. The camera pulls far back, you lean into it and the arrow takes the storm; release, and a great arrow of lightning tears a burnt trench sixty metres long through everything in its way. It spends the storm.' },
  // earth
  { id: 'earth', name: 'Earth Power', path: 'earth', cost: 1, requires: null, icon: ICONS.earth,
    desc: 'Press G. Drive the blade into the ground and the earth answers: stones rise and circle you. For forty seconds you take half damage, your blows throw things back, and Sky Slam raises a ring of stone. Ten seconds to recover after it fades.' },
  { id: 'wall', name: 'Earth Wall', path: 'earth', cost: 1, requires: 'earth', icon: ICONS.wall,
    desc: 'Press Q while Earth Power is on you. A wall of rock tears up out of the ground in front of you (one every second and a half): arrows shatter on it, nothing walks through it, and a dash into it ends with whoever dashed stunned on the ground.' },
  { id: 'rockkick', name: 'Rock Kick', path: 'earth', cost: 1, requires: 'earth', icon: ICONS.rockkick,
    desc: 'Press E while Earth Power is on you. Stomp, and a boulder bursts up out of the ground in a spray of stones; side-kick it and it flies low and very fast, flattening the field as it passes and shattering on whatever it hits, throwing it back hard.' },
  // wind
  { id: 'wind', name: 'Wind Call', path: 'wind', cost: 1, requires: null, icon: ICONS.wind,
    desc: 'Press V. Hold the blade out and turn once on the spot: the wind follows it round into a whirl and settles on you. For forty-five seconds you are light on your feet (you run faster and jump higher) and the crow will come when you call it. Ten seconds to recover after it fades.' },
  { id: 'crow', name: 'Wind Crow', path: 'wind', cost: 1, requires: 'wind', icon: ICONS.crow,
    desc: 'Hold Z while the wind is with you. A great crow of wind swoops past you; you catch its feet and it drags you off the ground and carries you wherever you look (W faster, S slower), the view widening with the speed. Let go and you hurl it where you look: it bursts in a blast of wind that throws back everything near. The flight burns the wind.' },
];

const costOf = (id) => SKILLS.find((k) => k.id === id).cost;

export class Skills {
  constructor() {
    this.learned = new Set();
    this.earned = new Set();         // what has paid a point: 'fairy:<n>', 'quest:<id>'
    this.legacy = 0;                 // points for skills learned before points had to be earned
    this.admin = false;
    this.totals = { fairy: 0, quest: 0 };      // how many there are to find, set by fairies.js and quests.js
    this.listeners = [];
    let old = false;
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) || 'null');
      if (s && Array.isArray(s.learned)) for (const id of s.learned) if (SKILLS.some((k) => k.id === id)) this.learned.add(id);
      if (s && Array.isArray(s.earned)) for (const k of s.earned) this.earned.add(String(k));
      this.legacy = s && s.v >= 2 ? Math.max(0, s.legacy | 0) : 0;
      old = !!(s && !(s.v >= 2));
      this.admin = !!(s && s.admin);
    } catch { /* private mode: start fresh */ }
    // the tree has changed shape over time: a skill whose root is no longer learned is given back
    for (let again = true; again;) {
      again = false;
      for (const id of this.learned) { const sk = SKILLS.find((k) => k.id === id); if (sk.requires && !this.learned.has(sk.requires)) { this.learned.delete(id); again = true; } }
    }
    // a save from before points were earned: what was learned then stays paid for
    if (old) for (const id of this.learned) this.legacy += costOf(id);
    this.save();
    this.root = document.getElementById('skills');
    this.tree = document.getElementById('sk-tree');
    this.info = document.getElementById('sk-points');
    this.srcEl = document.getElementById('sk-sources');
    this.adminEl = document.getElementById('sk-admin');
    this.wipeEl = document.getElementById('sk-wipe');
    document.getElementById('sk-close').onclick = () => this.close();
    document.getElementById('sk-reset').onclick = () => this.reset();
    this.adminEl.onclick = () => this.setAdmin(!this.admin);
    this.wipeEl.onclick = () => this.wipe();
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    this.render();
  }

  // points left: what has been earned, less what the learned skills cost
  get spent() { let n = 0; for (const id of this.learned) n += costOf(id); return n; }
  get points() { return this.admin ? ADMIN_POINTS : Math.max(0, this.legacy + this.earned.size - this.spent); }
  // how many of a kind have been earned ('fairy', 'quest')
  count(kind) { let n = 0; for (const k of this.earned) if (k.startsWith(kind + ':')) n++; return n; }
  got(key) { return this.earned.has(key); }
  // a point for `key`, once: true if it was new
  award(key) {
    if (this.earned.has(key)) return false;
    this.earned.add(key); this.save(); this.render();
    return true;
  }
  setAdmin(on) { this.admin = !!on; this.save(); this.render(); }
  // admin: forget every fairy and quest and every skill, as if the game were new (the world is told, so the
  // fairies come back and the oni returns)
  wipe() {
    this.learned.clear(); this.earned.clear(); this.legacy = 0; this.save(); this.render();
    for (const fn of this.listeners) fn();
  }
  onWipe(fn) { this.listeners.push(fn); }
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
  save() { try { localStorage.setItem(SAVE, JSON.stringify({ v: 2, learned: [...this.learned], earned: [...this.earned], legacy: this.legacy, admin: this.admin })); } catch { /* ignore */ } }

  // the forest is regrown from its seeds each time it is opened
  open() {
    this.root.hidden = false;
    this.build();
    for (const t of this.trees) t.update(new Set(), 0, true);
    this.render(true);
    requestAnimationFrame(() => { if (!this.root.hidden) for (const t of this.trees) t.update(this.learned, 900); });
  }
  close() { this.root.hidden = true; }
  toggle() { this.isOpen ? this.close() : this.open(); }

  // the trees, one for each path, and the panel that tells of the skill picked on one (made once)
  build() {
    if (this.trees) return;
    this.tree.textContent = '';
    const forest = document.createElement('div'); forest.className = 'sk-forest';
    this.trees = Object.entries(PATHS).map(([id, p]) => {
      // the seed: the path's skill that grows from nothing on it
      const mine = SKILLS.filter((k) => k.path === id), root = mine.filter((k) => !k.requires || !mine.some((m) => m.id === k.requires));
      const t = new TreeArt(id, p.name, [...root, ...mine.filter((k) => !root.includes(k))]);
      for (const [sid, b] of Object.entries(t.nodes)) {
        b.onclick = () => { this.sel = sid; this.render(); };
        b.onmouseenter = () => this.show(sid);
        b.onmouseleave = () => this.show(this.sel);
        b.onfocus = () => { this.sel = sid; this.render(); };
      }
      forest.appendChild(t.el);
      return t;
    });
    this.detail = document.createElement('div'); this.detail.id = 'sk-detail';
    this.tree.append(forest, this.detail);
  }

  render(skipTrees = false) {
    this.info.textContent = this.admin ? 'Unlimited skill points (admin)' : this.points + (this.points === 1 ? ' skill point' : ' skill points');
    const T = this.totals;
    this.srcEl.textContent = `Fairies found ${this.count('fairy')} of ${T.fairy}  ·  Quests done ${this.count('quest')} of ${T.quest}` +
      (!this.admin && this.points === 0 && this.learned.size < SKILLS.length ? '  ·  find fairies across the plain, or finish quests, to earn more' : '');
    this.adminEl.setAttribute('aria-pressed', this.admin ? 'true' : 'false');
    this.wipeEl.hidden = !this.admin;
    if (!this.trees || this.root.hidden) return;
    if (!skipTrees) for (const t of this.trees) t.update(this.learned);
    // what is picked: kept while it stands, else the first skill that can be learned, else the first there is
    if (!SKILLS.some((k) => k.id === this.sel)) this.sel = (SKILLS.find((k) => this.can(k)) || SKILLS[0]).id;
    for (const t of this.trees) for (const [id, b] of Object.entries(t.nodes)) {
      const sk = SKILLS.find((k) => k.id === id), state = this.state(sk);
      b.className = 'tr-node ' + state + (id === this.sel ? ' sel' : '');
      b.setAttribute('aria-label', `${sk.name}: ${state === 'ready' ? 'can be learned' : state}`);
    }
    this.show(this.sel);
  }
  state(sk) { return this.has(sk.id) ? 'learned' : this.can(sk) ? 'ready' : 'locked'; }

  // the panel: the skill's name, its path, what it does, and a button to learn it
  show(id) {
    const sk = SKILLS.find((k) => k.id === id); if (!sk || !this.detail) return;
    const state = this.state(sk), from = sk.requires && SKILLS.find((k) => k.id === sk.requires);
    const D = this.detail, c = getComputedStyle(this.trees.find((t) => t.id === sk.path).el).getPropertyValue('--c');
    D.style.setProperty('--c', c);
    const label = state === 'learned' ? 'Learned' : state === 'ready' ? `Learn  ·  ${sk.cost} point` : from && !this.has(from.id) ? 'Needs ' + from.name : `Needs ${sk.cost} point`;
    D.innerHTML = `<span class="sk-icon">${sk.icon}</span><div class="sk-body"><span class="sk-where">${PATHS[sk.path].name}${from ? '  ·  grows from ' + from.name : '  ·  the seed of the tree'}</span>` +
      `<b>${sk.name}</b><i>${sk.desc}</i></div><button class="sk-learn${state === 'ready' ? ' go' : state === 'learned' ? ' done' : ''}"${state === 'ready' ? '' : ' disabled'}>${label}</button>`;
    D.querySelector('.sk-learn').onclick = () => this.learn(sk.id);
  }
}
