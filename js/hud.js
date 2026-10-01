// Minimal HUD in the spirit of the reference: a compass strip with the four lands marked,
// a quiet stamina ring, and a title card when you walk into a new land.
import { ZONES } from './world.js';

const TITLES = {
  grass: { en: 'Whisper Meadow', jp: '<ruby>風<rt>かぜ</rt></ruby>の<ruby>草原<rt>そうげん</rt></ruby>' },
  wheat: { en: 'The Golden Reach', jp: '<ruby>黄金<rt>おうごん</rt></ruby>の<ruby>麦畑<rt>むぎばたけ</rt></ruby>' },
  leaves: { en: 'Hollow of Falling Leaves', jp: '<ruby>落<rt>お</rt></ruby>ち<ruby>葉<rt>ば</rt></ruby>の<ruby>谷<rt>たに</rt></ruby>' },
  snow: { en: 'Frostveil Rise', jp: '<ruby>雪<rt>ゆき</rt></ruby>の<ruby>丘<rt>おか</rt></ruby>' },
};

export class Hud {
  constructor(game) {
    this.game = game;
    this.strip = document.getElementById('compass-strip');
    this.compass = document.getElementById('compass');
    this.marks = [];
    const add = (label, bearing, cls) => {
      const el = document.createElement('div'); el.className = 'cmark ' + (cls || ''); el.textContent = label;
      this.strip.appendChild(el); const m = { el, bearing }; this.marks.push(m); return m;
    };
    ['N', 'E', 'S', 'W'].forEach((l, i) => add(l, i * 90));
    for (let b = 0; b < 360; b += 15) if (b % 90) add(b % 45 ? '·' : '|', b, 'minor');
    this.zoneMarks = [
      { m: add('❋', 0, 'zone'), z: ZONES.wheat }, { m: add('❦', 0, 'zone'), z: ZONES.leaves }, { m: add('❄', 0, 'zone'), z: ZONES.snow },
    ];
    this.sunMark = add('☼', 0, 'zone');
    this.title = document.getElementById('zone-title');
    this.zone = null; this.pending = null; this.pendingT = 0; this.titleT = 0;
    this.stam = document.getElementById('stamina'); this.stamFg = document.getElementById('st-fg');
    this.hintEl = document.getElementById('hint'); this.hintT = 0;
    this.lookEl = document.getElementById('click-to-look');
  }

  hint(text, secs = 3) {
    if (this.hintEl.textContent !== text || this.hintT <= 0) { this.hintEl.textContent = text; }
    this.hintEl.classList.add('show'); this.hintT = secs;
  }

  showTitle(kind) {
    const t = TITLES[kind]; if (!t) return;
    this.title.querySelector('.zt-en').textContent = t.en;
    this.title.querySelector('.zt-jp').innerHTML = t.jp;
    this.title.classList.add('show'); this.titleT = 4.5;
  }

  update(dt, game) {
    this.lookEl.hidden = game.state !== 'play' || game.input.locked || game.input.pad.active;
    if (game.state !== 'play') return;
    const cam = game.rig, P = game.player;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const heading = (Math.atan2(fx, -fz) * 180 / Math.PI + 360) % 360;   // 0 = north (-z), 90 = east (+x)
    const W = this.compass.clientWidth, ppd = W / 150;
    const bearingTo = (x, z) => (Math.atan2(x - P.pos.x, -(z - P.pos.z)) * 180 / Math.PI + 360) % 360;
    for (const zm of this.zoneMarks) zm.m.bearing = bearingTo(zm.z.cx, zm.z.cz);
    const L = game.sky.lightDir; this.sunMark.bearing = (Math.atan2(L.x, -L.z) * 180 / Math.PI + 360) % 360;
    this.sunMark.el.textContent = game.sky.night ? '☾' : '☼';
    for (const m of this.marks) {
      let rel = ((m.bearing - heading + 540) % 360) - 180;
      const vis = Math.abs(rel) < 80;
      m.el.style.display = vis ? '' : 'none';
      if (vis) m.el.style.left = (W / 2 + rel * ppd) + 'px';
    }
    // lands: title when you've been in a new one for a moment
    const s = P.surface;
    const kind = s.snow > 0.55 ? 'snow' : s.wheat > 0.6 ? 'wheat' : s.leaves > 0.6 ? 'leaves' : (s.grass > 0.85 && s.path < 0.3 ? 'grass' : null);
    if (kind && kind !== this.zone) {
      if (this.pending !== kind) { this.pending = kind; this.pendingT = 0; }
      this.pendingT += dt;
      if (this.pendingT > 1.2) { this.zone = kind; this.showTitle(kind); }
    }
    if (this.titleT > 0) { this.titleT -= dt; if (this.titleT <= 0) this.title.classList.remove('show'); }
    // stamina
    const st = P.stamina / 100;
    this.stam.classList.toggle('show', st < 0.995);
    this.stamFg.style.strokeDashoffset = (100.5 * (1 - st)).toFixed(1);
    this.stamFg.style.stroke = P.exhausted ? '#c96a4a' : '';
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
  }
}
