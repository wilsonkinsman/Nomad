// Keyboard, mouse (pointer lock) and gamepad, folded into one small state object.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();       // edge-triggered this frame
    this.lookX = 0; this.lookY = 0; // accumulated mouse delta
    this.wheel = 0;
    this.locked = false;
    this.enabled = false;
    this.walkToggle = false;
    this.mouseDown = false;          // the left button, held
    this.pad = { x: 0, y: 0, lx: 0, ly: 0, sprint: false, active: false };
    this._padPrev = [];

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) { this.pressed.add(e.code); if (e.code === 'KeyC') this.tapDive(); }
      this.keys.add(e.code);
      if (e.code === 'KeyX') this.walkToggle = !this.walkToggle;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { canvas.requestPointerLock?.(); return; }
      if (e.button === 2) { this.pressed.add('Dive'); this.tapDive(); }
      if (e.button === 0) { this.pressed.add('Attack'); this.mouseDown = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) this.mouseDown = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX; this.lookY += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && [...pads].find(p => p && p.connected);
    const P = this.pad;
    if (!g) { P.active = false; P.x = P.y = P.lx = P.ly = 0; P.sprint = false; return; }
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    P.x = dz(g.axes[0] || 0); P.y = dz(g.axes[1] || 0);
    P.lx = dz(g.axes[2] || 0); P.ly = dz(g.axes[3] || 0);
    const b = (i) => !!(g.buttons[i] && g.buttons[i].pressed);
    const edge = (i, name) => { if (b(i) && !this._padPrev[i]) this.pressed.add(name); };
    edge(0, 'Space'); edge(1, 'Dive'); edge(2, 'Dive'); if ((b(1) && !this._padPrev[1]) || (b(2) && !this._padPrev[2])) this.tapDive();
     edge(3, 'Attack'); edge(4, 'Parry'); edge(8, 'KeyB'); edge(6, 'Storm'); edge(11, 'Tackle'); edge(12, 'Earth'); edge(13, 'Wall'); edge(9, 'Escape');
    if (b(10) && !this._padPrev[10]) P.sprintLatch = !P.sprintLatch;
    P.sprint = b(5) || b(7) || (P.sprintLatch && Math.hypot(P.x, P.y) > 0.5);
    if (Math.hypot(P.x, P.y) < 0.2) P.sprintLatch = false;
    this._padPrev = g.buttons.map(x => x.pressed);
    P.active = P.active || Math.abs(P.x) + Math.abs(P.y) + Math.abs(P.lx) + Math.abs(P.ly) > 0 || this._padPrev.some(Boolean);
  }

  // movement intent in camera space: x right, y forward, 0..1 magnitude
  move() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 0) { x /= l; y /= l; }
    if (this.pad.active && Math.hypot(this.pad.x, this.pad.y) > 0) { x = this.pad.x; y = -this.pad.y; }
    return { x, y, mag: Math.min(1, Math.hypot(x, y)) };
  }

  sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.pad.sprint; }
  jump() { return this.pressed.has('Space'); }
  dive() { return this.pressed.has('KeyC') || this.pressed.has('Dive'); }
  // the roll tapped twice within a third of a second
  tapDive() { const now = performance.now(); if (now - (this._lastDive || -1e9) < 320) { this.pressed.add('DiveDouble'); this._lastDive = 0; } else this._lastDive = now; }
  diveDouble() { return this.pressed.has('DiveDouble'); }
  attack() { return this.pressed.has('Attack'); }
  parry() { return this.pressed.has('KeyF') || this.pressed.has('Parry'); }
  stormKey() { return this.pressed.has('KeyR') || this.pressed.has('Storm'); }
  earthKey() { return this.pressed.has('KeyG') || this.pressed.has('Earth'); }
  wallKey() { return this.pressed.has('KeyQ') || this.pressed.has('Wall'); }
  tackleKey() { return this.pressed.has('KeyT') || this.pressed.has('Tackle'); }
  bowKey() { return this.pressed.has('KeyB'); }
  // the attack button held down (drawing the bow)
  attackHeld() { return this.mouseDown; }
  endFrame() { this.pressed.clear(); this.lookX = 0; this.lookY = 0; this.wheel = 0; }
}
