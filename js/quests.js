// Quests, and the old monk who gives them. A quest is plain data (QUESTS): what it asks, where it is (for the compass
// and the tracker) and what the monk says about it. Finishing one earns its key in the skill ledger ('quest:<id>',
// one skill point). The monk stands by the road near where you start, a gold ! over his head while he has something
// for you; walk up to him and he talks (the lines run on their own in a box at the foot of the screen) and gives you
// the quest. While it is open its tracker sits at the top right with how far you have to go, and the compass marks
// the place. A quest is finished by its own system (the oni's defeat calls complete()), whether or not it was taken.
import * as THREE from 'three';
import { groundY, SPAWN } from './world.js';
import { dampAngle } from './util.js';
import { ARENA } from './boss.js';

export const MONK = { x: SPAWN.x + 7, z: SPAWN.z - 4.5 };
const SAVE = 'nomad_quests', TALK = 3.6, LINE = 3.8;

const QUESTS = [
  { id: 'oni', title: 'The Red Oni', goal: 'Defeat the oni at the ring of stones', at: ARENA, mark: '鬼',
    give: ['Ah, a wanderer. Stay a moment and listen.',
      'A red oni has come down out of the hills to the ring of stones, out in the south-east meadow.',
      'He breaks the old stones and frightens the fairies away. Drive him out, and I will teach you what I know.',
      'Keep an eye out for fairies on your way, too. Each one you find carries a lesson with it.'],
    remind: ['The oni waits at the ring of stones, out in the south-east meadow.', 'When he lifts that club, be somewhere else, or turn the blow aside with your blade (F).'],
    thanks: ['You drove him out. The fairies will come back to the ring now.', 'Go well, wanderer.'] },
];

// a floating mark drawn on a canvas: a gold "!" with a dark outline
function markTexture(text) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.font = '700 96px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(20,14,6,0.9)'; g.strokeText(text, 64, 68);
  g.fillStyle = '#f0c46a'; g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Quests {
  constructor(game) {
    this.game = game;
    game.skills.totals.quest = QUESTS.length;
    this.taken = new Set();
    try { const s = JSON.parse(localStorage.getItem(SAVE) || 'null'); if (s && Array.isArray(s.taken)) for (const id of s.taken) this.taken.add(id); } catch { /* fresh */ }
    this.buildMonk();
    this.dlg = document.getElementById('dialog'); this.dlgName = document.getElementById('dlg-name'); this.dlgText = document.getElementById('dlg-text');
    this.box = document.getElementById('quest'); this.boxTitle = document.getElementById('quest-title'); this.boxGoal = document.getElementById('quest-goal');
    this.monkMark = game.hud.addMark('!', 'quest');
    for (const q of QUESTS) q.cmark = game.hud.addMark(q.mark, 'oni');
    this.monkWho = { name: 'The old monk', x: MONK.x, z: MONK.z };
    this.talk = null; this.cool = 0; this.played = 0; this.nudged = false; this.doneT = 0; this.pending = [];
    game.boss.onDefeat = () => this.complete('oni');
    game.skills.onWipe(() => { this.taken.clear(); this.save(); this.close(); this.pending.length = 0; this.doneT = 0; this.nudged = false; this.played = 0; });
  }
  save() { try { localStorage.setItem(SAVE, JSON.stringify({ taken: [...this.taken] })); } catch { /* ignore */ } }
  done(q) { return this.game.skills.got('quest:' + q.id); }
  open(q) { return this.taken.has(q.id) && !this.done(q); }

  // the old monk: a grey robe and a saffron stole, a broad straw hat, a white beard, and a ringed staff
  buildMonk() {
    const G = this.game, M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
    const robe = M(0x4b505c), stole = M(0xc0822e), skin = M(0xd6b08a), straw = M(0xa88a52, { roughness: 1 }), wood = M(0x5e4128), metal = M(0x9a8a62, { metalness: 0.6, roughness: 0.4 }), white = M(0xe8e4dc);
    const g = this.monk = new THREE.Group(), mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    mesh(new THREE.CylinderGeometry(0.22, 0.42, 1.05, 16), robe, 0, 0.52, 0);
    this.torso = new THREE.Group(); this.torso.position.y = 1.0; g.add(this.torso);
    const tm = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; this.torso.add(o); return o; };
    tm(new THREE.CylinderGeometry(0.2, 0.23, 0.55, 14), robe, 0, 0.26, 0);
    tm(new THREE.BoxGeometry(0.1, 0.62, 0.48), stole, 0.02, 0.25, 0.02).rotation.z = 0.55;
    tm(new THREE.SphereGeometry(0.14, 14, 12), skin, 0, 0.66, 0.02);
    tm(new THREE.ConeGeometry(0.1, 0.24, 10).rotateX(Math.PI), white, 0, 0.5, 0.1);
    tm(new THREE.ConeGeometry(0.46, 0.22, 20), straw, 0, 0.84, 0);
    for (const s of [-1, 1]) { const a = tm(new THREE.CylinderGeometry(0.07, 0.11, 0.5, 10), robe, s * 0.24, 0.12, 0.08); a.rotation.x = -0.6; a.rotation.z = s * 0.15; }
    // the staff, planted at his right with rings at the head
    const st = new THREE.Group(); st.position.set(-0.32, 0, 0.2); g.add(st);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 2.05, 8).translate(0, 1.02, 0), wood); pole.castShadow = true; st.add(pole);
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16), metal); head.position.y = 2.12; st.add(head);
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 10), metal); r.position.set(s * 0.1, 2.05, 0); st.add(r); }
    this.staff = st;
    // the ! over his head
    this.bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTexture('!'), transparent: true, depthWrite: false, fog: false }));
    this.bang.scale.setScalar(0.55); this.bang.renderOrder = 15; g.add(this.bang);
    const y = groundY(MONK.x, MONK.z);
    g.position.set(MONK.x, y, MONK.z); this.face = Math.atan2(SPAWN.x - MONK.x, SPAWN.z - MONK.z); g.rotation.y = this.face;
    G.scene.add(g);
    G.player.colliders.push({ x: MONK.x, z: MONK.z, r: 0.45, h: 2 });
  }

  // someone talks (the monk, unless `who` says otherwise: { name, x, z }): lines one after another; then() runs when
  // the line at `at` comes up; walking away from them ends it
  say(lines, then, at = 0, who = this.monkWho) { this.talk = { lines, i: -1, t: 0, then, at, who }; this.next(); }
  next() {
    const k = this.talk; k.i++; k.t = 0;
    if (k.i >= k.lines.length) { this.close(); return; }
    this.dlgName.textContent = k.who.name; this.dlgText.textContent = k.lines[k.i];
    this.dlg.hidden = false; this.dlg.classList.remove('in'); void this.dlg.offsetWidth; this.dlg.classList.add('in');
    if (k.then && k.i === k.at) { const f = k.then; k.then = null; f(); }
  }
  close() { this.talk = null; this.dlg.hidden = true; this.cool = 6; }

  take(q) {
    const G = this.game;
    this.taken.add(q.id); this.save();
    G.hud?.callout('NEW QUEST', 'gold'); G.audio?.quest('new');
  }
  // a quest's work is done: its point is earned (the cheer comes a moment later, after the fight's own)
  complete(id) {
    const q = QUESTS.find((k) => k.id === id); if (!q) return;
    if (!this.game.skills.award('quest:' + id)) return;
    this.taken.add(id); this.save();
    this.pending.push({ q, t: 2.4 });
  }

  update(dt, G) {
    const P = G.player, t = G.time;
    this.cool = Math.max(0, this.cool - dt);
    const mx = MONK.x - P.pos.x, mz = MONK.z - P.pos.z, d = Math.hypot(mx, mz);
    const q = QUESTS[0], fresh = !this.taken.has(q.id) && !this.done(q);
    // the monk turns to watch you as you come near; he sways a little on his staff
    this.face = dampAngle(this.face, d < 9 ? Math.atan2(-mx, -mz) : this.face, 2.5, dt);
    this.monk.rotation.y = this.face;
    this.torso.rotation.z = 0.025 * Math.sin(t * 0.7); this.torso.rotation.x = 0.06 + 0.02 * Math.sin(t * 1.1);
    this.bang.visible = fresh; this.bang.position.y = 2.35 + 0.08 * Math.sin(t * 2.5);
    // he speaks when you come up to him
    if (!this.talk && this.cool <= 0 && d < TALK && G.state === 'play') {
      if (fresh) this.say(q.give, () => this.take(q), 2);
      else if (this.open(q)) this.say(q.remind);
      else this.say(q.thanks);
    }
    if (this.talk && G.state === 'play') {
      this.talk.t += dt;
      if (Math.hypot(this.talk.who.x - P.pos.x, this.talk.who.z - P.pos.z) > TALK + 5) this.close();
      else if (this.talk.t > LINE) this.next();
    }
    // a nudge toward him at the start, once
    this.played += G.state === 'play' ? dt : 0;
    if (!this.nudged && fresh && this.played > 11) { this.nudged = true; G.hud?.hint('An old monk waits by the road: the gold ! on the compass', 5); }
    // the compass: him while he has something for you, the quest's place while it is open
    this.monkMark.off = !fresh;
    if (fresh) this.monkMark.bearing = (Math.atan2(MONK.x - P.pos.x, -(MONK.z - P.pos.z)) * 180 / Math.PI + 360) % 360;
    for (const k of QUESTS) {
      k.cmark.off = !this.open(k);
      if (!k.cmark.off) k.cmark.bearing = (Math.atan2(k.at.x - P.pos.x, -(k.at.z - P.pos.z)) * 180 / Math.PI + 360) % 360;
    }
    // the tracker: the open quest and how far, or a moment of "complete"
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]; p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      G.hud?.callout('QUEST COMPLETE', 'gold'); G.audio?.quest('done');
      G.hud?.floatText(new THREE.Vector3(P.pos.x, P.pos.y + 1.9, P.pos.z), '+1 skill point', 'gold word');
      G.hud?.hint(`Quest complete: ${p.q.title}. Press K to learn a skill`, 5);
      this.boxTitle.textContent = p.q.title; this.boxGoal.textContent = 'Complete  ·  +1 skill point'; this.doneT = 5;
    }
    this.doneT = Math.max(0, this.doneT - dt);
    const show = G.state === 'play' && (this.doneT > 0 || this.open(q));
    if (this.box.hidden === show) this.box.hidden = !show;
    if (show && this.doneT <= 0) {
      const gd = Math.round(Math.hypot(q.at.x - P.pos.x, q.at.z - P.pos.z));
      const text = `${q.goal}  ·  ${gd} m`;
      if (this.boxGoal.textContent !== text) { this.boxTitle.textContent = q.title; this.boxGoal.textContent = text; }
    }
    this.box.classList.toggle('done', this.doneT > 0);
  }
}
