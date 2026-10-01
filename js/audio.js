// Foley only (no music): footsteps shaped from filtered noise grains per surface, landings,
// the whoosh of a dive, wind that swells with the gusts, and crickets at night.
export class Audio {
  constructor() { this.ctx = null; this.volume = 0.7; }

  resume() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    // footsteps sit well under everything else: a soft, low-passed bus
    this.stepTone = ctx.createBiquadFilter(); this.stepTone.type = 'lowpass'; this.stepTone.frequency.value = 2600;
    this.stepBus = ctx.createGain(); this.stepBus.gain.value = 0.18;
    this.stepTone.connect(this.stepBus).connect(this.master);
    // the sword's foley sits low too
    this.swordBus = ctx.createGain(); this.swordBus.gain.value = 0.5; this.swordBus.connect(this.master);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // wind bed: two bands of looping noise
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 420; this.windLP.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    src.connect(this.windLP).connect(this.windGain).connect(this.master);
    const src2 = ctx.createBufferSource(); src2.buffer = buf; src2.loop = true; src2.playbackRate.value = 0.7;
    this.whistle = ctx.createBiquadFilter(); this.whistle.type = 'bandpass'; this.whistle.frequency.value = 900; this.whistle.Q.value = 6;
    this.whistleGain = ctx.createGain(); this.whistleGain.gain.value = 0;
    src2.connect(this.whistle).connect(this.whistleGain).connect(this.master);
    src.start(); src2.start();
    this.cricketT = 0;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  // one short band-passed noise grain
  grain(t, freq, q, dur, gain, type = 'bandpass') {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.004, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.bus || this.master);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  thump(t, freq, dur, gain) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus || this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  step(s, speed, sprint) {
    if (!this.ctx) return;
    this.bus = this.stepTone;
    try { this.stepSounds(s, speed, sprint); } finally { this.bus = null; }
  }

  stepSounds(s, speed, sprint) {
    const t = this.ctx.currentTime + 0.005, k = Math.min(1.3, 0.45 + speed * 0.13), R = Math.random;
    switch (s.kind) {
      case 'snow':
        for (let i = 0; i < 9; i++) this.grain(t + R() * 0.16, 700 + R() * 1500, 1.4, 0.03 + R() * 0.03, 0.22 * k);
        this.grain(t, 300, 0.7, 0.14, 0.18 * k, 'lowpass');
        break;
      case 'leaves':
        for (let i = 0; i < 16; i++) this.grain(t + R() * 0.14, 2200 + R() * 4000, 2.5, 0.006 + R() * 0.01, 0.3 * k);
        this.grain(t, 1600, 0.6, 0.12, 0.06 * k);
        break;
      case 'wheat':
        this.grain(t, 4200, 0.7, 0.28, 0.12 * k); this.grain(t + 0.05, 2600, 0.8, 0.22, 0.07 * k);
        break;
      case 'puddle':
        this.grain(t, 1300, 0.9, 0.16, 0.3 * k); this.thump(t, 420, 0.09, 0.12 * k);
        for (let i = 0; i < 5; i++) this.grain(t + 0.03 + R() * 0.12, 2500 + R() * 2500, 4, 0.02, 0.08 * k);
        break;
      case 'dirt':
        this.thump(t, 110, 0.07, 0.25 * k);
        for (let i = 0; i < 4; i++) this.grain(t + R() * 0.05, 1800 + R() * 1800, 2, 0.015, 0.12 * k);
        break;
      default:
        this.thump(t, 95, 0.06, 0.18 * k);
        this.grain(t, 3200, 0.8, 0.1, 0.1 * k);
    }
  }

  // a band of noise whose pitch rises then falls: swishes, steel sliding on steel
  sweep(t, f0, f1, f2, q, dur, gain) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5); f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.bus || this.master);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  ping(t, freq, dur, gain) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus || this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  sword(kind) {
    if (!this.ctx) return;
    this.bus = this.swordBus;
    try {
      const t = this.ctx.currentTime + 0.005, R = Math.random;
      switch (kind) {
        case 'draw':                                     // steel sliding out of the sheath
          this.sweep(t, 2600, 6200, 4200, 5, 0.3, 0.16); this.sweep(t + 0.02, 1500, 3200, 2400, 3, 0.26, 0.1);
          this.ping(t + 0.24, 2350 + R() * 120, 0.5, 0.05); break;
        case 'sheathe':
          this.sweep(t, 4200, 2200, 1500, 4, 0.26, 0.1); this.thump(t + 0.27, 260, 0.05, 0.12); this.grain(t + 0.27, 3400, 1.5, 0.04, 0.08); break;
        case 'cut': this.sweep(t, 600, 2300, 700, 1.0, 0.24, 0.22); break;
        case 'overhead': this.sweep(t, 500, 1800, 420, 0.9, 0.26, 0.24); break;
        case 'thrust': this.sweep(t, 1200, 3600, 2400, 1.4, 0.16, 0.2); break;
        case 'parry':                                    // the blade comes up: a bright ring
          this.sweep(t, 1800, 5200, 3800, 4, 0.14, 0.12);
          this.ping(t + 0.02, 2640, 0.9, 0.09); this.ping(t + 0.02, 3970, 0.7, 0.05); this.ping(t + 0.03, 5310, 0.5, 0.03); break;
        case 'clang':                                    // a blow turned aside: steel on steel
          this.grain(t, 2400, 0.7, 0.06, 0.34); this.thump(t, 190, 0.1, 0.34);
          this.ping(t, 1830, 1.3, 0.2); this.ping(t, 2760, 1.1, 0.16); this.ping(t + 0.005, 4310, 0.9, 0.11); this.ping(t + 0.01, 6120, 0.6, 0.06); break;
        case 'slam': this.thump(t, 85, 0.2, 0.32); this.grain(t, 500, 0.6, 0.22, 0.2, 'lowpass'); break;
        case 'hit': this.thump(t, 150, 0.09, 0.3); this.grain(t, 1800, 1.0, 0.07, 0.16); break;
      }
    } finally { this.bus = null; }
  }

  impact(s, kind, v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = Math.min(1.5, 0.4 + v * 0.1);
    this.thump(t, 80, 0.16, 0.45 * k);
    if (kind !== 'land') this.grain(t, 700, 0.6, 0.35, 0.2 * k, 'lowpass');
    this.step(s, 5, true);
    if (s.kind === 'snow') for (let i = 0; i < 14; i++) this.grain(t + Math.random() * 0.3, 600 + Math.random() * 1400, 1.2, 0.05, 0.2 * k);
    if (s.kind === 'leaves') for (let i = 0; i < 30; i++) this.grain(t + Math.random() * 0.35, 2500 + Math.random() * 4000, 2.5, 0.008, 0.25 * k);
  }

  // the bow: the creak of a draw, a ping at full draw, the twang, a thunk in the target
  bow(kind, power = 1) {
    if (!this.ctx) return;
    this.bus = this.swordBus;
    try {
      const t = this.ctx.currentTime + 0.005;
      if (kind === 'draw') this.sweep(t, 160, 420, 520, 6, 0.9, 0.07);
      else if (kind === 'full') { this.ping(t, 1760, 0.35, 0.1); this.thump(t, 140, 0.08, 0.2); }
      else if (kind === 'release') {
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(260 + 140 * power, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.16);
        g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.22);
        this.sweep(t, 900, 3400 + 2000 * power, 1500, 1.2, 0.2, 0.18);
      } else if (kind === 'hit') { this.thump(t, 170, 0.1, 0.4); this.grain(t, 1600, 1.0, 0.06, 0.2); }
      else if (kind === 'stick') this.thump(t, 220, 0.06, 0.18);
    } finally { this.bus = null; }
  }

  // lightning: a crack right overhead, then the rolling rumble of the thunder
  thunder() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    this.bus = this.swordBus;
    try {
      this.grain(t, 3200, 0.5, 0.18, 0.7, 'highpass'); this.grain(t, 900, 0.5, 0.3, 0.6, 'lowpass'); this.thump(t, 60, 0.5, 0.7);
      // the rumble: low noise that swells and dies away over a couple of seconds
      const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(420, t + 0.1); f.frequency.exponentialRampToValueAtTime(70, t + 2.6);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + 0.1); g.gain.linearRampToValueAtTime(0.55, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      s.connect(f).connect(g).connect(this.master); s.start(t + 0.1); s.stop(t + 2.9);
    } finally { this.bus = null; }
  }
  // the cast: a rising whine and crackle while the lightning gathers
  storm(kind, k = 1) {
    if (!this.ctx) return;
    this.bus = this.swordBus;
    try {
      const t = this.ctx.currentTime + 0.005;
      if (kind === 'gather') this.sweep(t, 180, 2400, 3200, 5, 1.0, 0.1);
      else if (kind === 'crackle') for (let i = 0; i < 3; i++) this.grain(t + Math.random() * 0.06, 2500 + Math.random() * 3500, 3, 0.012, 0.05 + 0.1 * k);
      else if (kind === 'zap') { this.grain(t, 4000, 0.6, 0.07, 0.4); this.sweep(t, 6000, 1200, 400, 1.5, 0.18, 0.22); this.thump(t, 150, 0.09, 0.3); }
      else if (kind === 'tackle') { this.sweep(t, 120, 1100, 1800, 3, 0.55, 0.18); this.thump(t, 90, 0.35, 0.5); this.grain(t, 3500, 1, 0.12, 0.2); }
      else if (kind === 'dash') { this.grain(t, 2600, 0.8, 0.22, 0.55, 'highpass'); this.thump(t, 70, 0.4, 0.85); this.sweep(t, 5000, 1400, 300, 1.2, 0.32, 0.3); }
      else if (kind === 'fizzle') this.sweep(t, 3000, 600, 200, 2, 0.5, 0.1);
    } finally { this.bus = null; }
  }

  // the earth: the blade going in and the ground answering, a wall tearing up, stone crumbling
  earth(kind) {
    if (!this.ctx) return;
    this.bus = this.swordBus;
    try {
      const t = this.ctx.currentTime + 0.005;
      if (kind === 'quake') { this.thump(t, 55, 0.9, 0.9); this.thump(t + 0.05, 38, 1.2, 0.7); this.grain(t, 300, 0.7, 1.1, 0.5, 'lowpass'); this.grain(t, 1400, 1, 0.25, 0.25); }
      else if (kind === 'wall') { this.sweep(t, 120, 380, 160, 2, 0.45, 0.5); this.grain(t, 500, 0.8, 0.5, 0.45, 'lowpass'); this.thump(t + 0.22, 70, 0.4, 0.6); }
      else if (kind === 'stomp') { this.thump(t, 65, 0.45, 0.85); this.grain(t, 400, 0.8, 0.35, 0.4, 'lowpass'); this.grain(t + 0.05, 900, 1, 0.3, 0.3); }
      else if (kind === 'kick') { this.thump(t, 95, 0.3, 1.0); this.thump(t, 50, 0.5, 0.7); this.grain(t, 1800, 1.2, 0.1, 0.5); this.grain(t, 500, 0.8, 0.3, 0.45, 'lowpass'); this.sweep(t + 0.03, 700, 2600, 400, 1.2, 0.45, 0.35); }
      else if (kind === 'crumble') { for (let i = 0; i < 6; i++) this.grain(t + i * 0.06 + Math.random() * 0.04, 600 + Math.random() * 1500, 1.5, 0.12, 0.18); this.grain(t, 250, 0.7, 0.6, 0.25, 'lowpass'); }
    } finally { this.bus = null; }
  }

  // a crow's caw: a harsh nasal call, its pitch rasping and falling away, and a second one close behind
  caw(t, gain) {
    const ctx = this.ctx;
    for (const [at, f0] of [[0, 640], [0.26, 590]]) {
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t + at); o.frequency.linearRampToValueAtTime(f0 * 1.08, t + at + 0.04); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + at + 0.22);
      lfo.frequency.value = 72; lg.gain.value = 45; lfo.connect(lg).connect(o.frequency);       // the rasp
      f.type = 'bandpass'; f.frequency.value = 1350; f.Q.value = 2.2;
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(gain, t + at + 0.02); g.gain.setValueAtTime(gain, t + at + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.24);
      o.connect(f).connect(g).connect(this.bus || this.master);
      o.start(t + at); lfo.start(t + at); o.stop(t + at + 0.26); lfo.stop(t + at + 0.26);
      this.grain(t + at, 2200, 1.5, 0.18, gain * 0.35);
    }
  }
  // the wind: the spin and the burst of the call, the crow coming, its wingbeats, the throw and the blast
  wind(kind, k = 1) {
    if (!this.ctx) return;
    this.bus = this.swordBus;
    try {
      const t = this.ctx.currentTime + 0.005;
      if (kind === 'spin') { this.sweep(t, 180, 900, 380, 1.2, 0.85, 0.3); this.grain(t + 0.1, 260, 0.7, 0.8, 0.25, 'lowpass'); }
      else if (kind === 'call') { this.grain(t, 500, 0.5, 0.9, 0.55, 'lowpass'); this.sweep(t, 300, 2600, 700, 0.8, 0.75, 0.38); this.thump(t, 70, 0.4, 0.5); }
      else if (kind === 'fade') this.sweep(t, 1400, 500, 200, 0.8, 0.7, 0.15);
      else if (kind === 'summon') { this.sweep(t, 250, 1500, 900, 0.9, 0.65, 0.32); this.caw(t + 0.08, 0.07); }
      else if (kind === 'grab') { this.thump(t, 90, 0.25, 0.55); this.sweep(t, 500, 2400, 700, 1.0, 0.45, 0.35); this.grain(t, 300, 0.6, 0.4, 0.3, 'lowpass'); }
      else if (kind === 'caw') this.caw(t, 0.12);
      else if (kind === 'flap') { this.grain(t, 380, 0.8, 0.14, 0.22 * k, 'lowpass'); this.thump(t, 60, 0.12, 0.18 * k); }
      else if (kind === 'bump') { this.thump(t, 110, 0.15, 0.5); this.grain(t, 1600, 1.2, 0.12, 0.25); }
      else if (kind === 'throw') { this.sweep(t, 600, 3200, 1100, 1.0, 0.32, 0.38); this.thump(t, 120, 0.1, 0.25); }
      else if (kind === 'burst') {
        this.thump(t, 55, 0.7, 0.9 * k); this.thump(t + 0.02, 110, 0.3, 0.5 * k);
        this.grain(t, 500, 0.5, 1.1, 0.6 * k, 'lowpass'); this.sweep(t, 2400, 700, 220, 0.7, 0.9, 0.38 * k);
      }
    } finally { this.bus = null; }
  }

  // the Sky Slam landing: the ground booms
  slam() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.005;
    this.thump(t, 70, 0.5, 0.7); this.thump(t + 0.02, 130, 0.25, 0.4); this.grain(t, 400, 0.5, 0.5, 0.45, 'lowpass'); this.grain(t, 1800, 0.8, 0.12, 0.2);
  }

  // taking a hit: a dull thud and a rasp
  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.005;
    this.thump(t, 90, 0.2, 0.5); this.grain(t, 700, 0.6, 0.2, 0.3, 'lowpass'); this.grain(t, 2200, 1.0, 0.07, 0.14);
  }

  // Flash Roll: a sharp rising hiss as he goes, a low thump and a falling hiss as he arrives
  flash(kind) {
    if (!this.ctx) return;
    this.bus = this.swordBus;
    try {
      const t = this.ctx.currentTime + 0.005;
      if (kind === 'out') this.sweep(t, 400, 5200, 7800, 1.1, 0.17, 0.3);
      else { this.sweep(t, 7000, 1800, 500, 1.0, 0.26, 0.26); this.thump(t + 0.03, 130, 0.16, 0.32); }
    } finally { this.bus = null; }
  }

  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.25); f.frequency.exponentialRampToValueAtTime(500, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 0.6);
  }

  update(dt, game) {
    if (!this.ctx) return;
    // the wind bed swells with his speed: in a flight (the Wind Crow) it is a roar and a whistle
    const P = game.player, g = game.wind.gust(P.pos.x, P.pos.z), sp = Math.min(24, Math.hypot(P.vel.x, P.vel.z, (P.fly || 0) * P.vel.y));
    const t = this.ctx.currentTime;
    const menu = game.state !== 'play';
    const lvl = (0.05 + g * 0.05 + sp * 0.012) * (menu ? 0.6 : 1);
    this.windGain.gain.setTargetAtTime(lvl, t, 0.3);
    this.windLP.frequency.setTargetAtTime(300 + g * 160 + sp * 60, t, 0.3);
    this.whistleGain.gain.setTargetAtTime(Math.max(0, g - 1.8) * 0.02 + Math.max(0, sp - 12) * 0.004, t, 0.5);
    this.whistle.frequency.setTargetAtTime(700 + g * 180 + Math.max(0, sp - 12) * 40, t, 0.5);
    // crickets on moonlit nights, only away from the snow
    if (game.sky.night && P.surface && P.surface.snow < 0.3) {
      this.cricketT -= dt;
      if (this.cricketT <= 0) {
        this.cricketT = 0.5 + Math.random() * 0.9;
        const base = t + 0.02, f = 4200 + Math.random() * 400, pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.master); }
        for (let i = 0; i < 3; i++) {
          const o = this.ctx.createOscillator(), gg = this.ctx.createGain();
          o.frequency.value = f; gg.gain.setValueAtTime(0, base + i * 0.06); gg.gain.linearRampToValueAtTime(0.018, base + i * 0.06 + 0.008); gg.gain.linearRampToValueAtTime(0, base + i * 0.06 + 0.035);
          o.connect(gg).connect(pan || this.master); o.start(base + i * 0.06); o.stop(base + i * 0.06 + 0.05);
        }
      }
    }
  }
}
