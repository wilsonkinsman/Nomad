// Player controller: weighty acceleration, surface-dependent speed (deep snow drags, wheat
// slows a little), stamina for sprinting and diving, jump with coyote time, and a dive that
// rolls out on firm ground or belly-flops into snow. Emits events for footsteps and impacts.
import * as THREE from 'three';
import { groundY, surfaceAt, PLAY_RADIUS, SPAWN, SUN_AZ } from './world.js';
import { Nomad } from './nomad.js';
import { Animator } from './anim.js';
import { Weapon } from './sword.js';
import { clamp, damp, dampAngle, wrapAngle } from './util.js';

const GRAV = -13;

export class Player {
  // model: a ready character (the Atsu GLB); without one, the procedural nomad is built
  constructor(game, tx, model = null) {
    this.game = game;
    this.model = model || new Nomad(tx);
    this.anim = new Animator();
    game.scene.add(this.model.group);
    game.scene.add(this.model.clothGroup);
    this.pos = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    this.pos.y = groundY(this.pos.x, this.pos.z);
    this.vel = new THREE.Vector3();
    this.heading = Math.atan2(SUN_AZ.x, SUN_AZ.y);
    this.grounded = true; this.coyote = 0;
    this.state = 'ground'; this.stateT = 0;
    this.stamina = 100; this.staminaDelay = 0; this.exhausted = false;
    this.sprinting = false;
    this.surface = surfaceAt(this.pos.x, this.pos.z);
    this.snowTop = 0;          // height of undisturbed snow above the ground here
    this.snowDepth = 0;        // snow still under/around the feet (0 on a trodden trail)
    this.visualY = this.pos.y;
    this.turnRate = 0; this.accel = 0; this.landImpact = 0;
    this.rollTime = 0.62; this.getupTime = 0.75;
    this.listeners = {};
    this.colliders = [];       // {x, z, r} circles from trees, rocks, posts
    this.walkMode = false;
    this._prevSpeed = 0;
    this.wind = new THREE.Vector3();
    this.bindWeapon();
    this.syncModel(0);
  }

  // models that carry a sword get the combo; moving to another character puts the sword away
  bindWeapon() {
    const m = this.model;
    if (this.weapon && this.weapon.rig !== m.swordRig) this.weapon.reset();
    this.weapon = m.swordRig ? (m.weapon || (m.weapon = new Weapon(this.game, this, m.swordRig))) : null;
    if (this.weapon) this.weapon.player = this;
  }

  // swap the character the player controls (menu choice); physics state carries over
  setModel(model) {
    const s = this.game.scene;
    s.remove(this.model.group, this.model.clothGroup);
    this.model = model;
    model.activate?.();
    s.add(model.group, model.clothGroup);
    this.bindWeapon();
    this.syncModel(0);
  }

  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) fn(...a); }

  teleport(x, z) {
    this.pos.set(x, groundY(x, z), z); this.vel.set(0, 0, 0);
    this.state = 'ground'; this.grounded = true;
    this.syncModel(0);
  }

  setState(s) { this.state = s; this.stateT = 0; }

  update(dt, inMenu) {
    const g = this.game, input = g.input;
    this.stateT += dt;
    const W = this.weapon;
    if (W) W.tick(dt, inMenu);
    const S = this.surface = surfaceAt(this.pos.x, this.pos.z, this.surface);
    const snowSys = g.snow;
    this.snowTop = snowSys ? snowSys.topAt(this.pos.x, this.pos.z) : 0;
    this.snowDepth = snowSys ? snowSys.depthAt(this.pos.x, this.pos.z) : 0;
    const deep = clamp(this.snowDepth / 0.4, 0, 1);

    // ---------------------------------------------------------------- intent
    let mx = 0, mz = 0, mag = 0;
    const busy = this.state === 'dive' || this.state === 'roll' || this.state === 'flop' || this.state === 'getup' || this.state === 'flash';
    if (!inMenu && !busy) {
      const m = input.move(), b = g.rig.basis();
      mx = b.fx * m.y + b.rx * m.x; mz = b.fz * m.y + b.rz * m.x;
      mag = m.mag;
      const l = Math.hypot(mx, mz); if (l > 0) { mx /= l; mz /= l; }
    }
    const wantSprint = !inMenu && input.sprint() && mag > 0.3 && !this.exhausted && !(W && W.kind);
    const walk = input.walkToggle || (input.pad.active && mag < 0.55);
    let speed = walk ? 1.55 : 3.5;
    if (wantSprint && !walk) speed = 6.4;
    if (input.pad.active && !wantSprint) speed *= clamp(mag * 1.2, 0.3, 1);
    // surfaces
    if (W) speed *= W.moveScale;
    speed *= 1 - 0.48 * deep;
    speed *= 1 - 0.1 * S.wheat * (1 - S.path);
    if (S.kind === 'puddle') speed *= 0.95;
    this.sprinting = wantSprint && Math.hypot(this.vel.x, this.vel.z) > 4;

    // ---------------------------------------------------------------- stamina
    if (this.sprinting) { this.stamina -= 15 * dt; this.staminaDelay = 0.9; }
    else if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else this.stamina = Math.min(100, this.stamina + 24 * dt);
    if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    if (this.exhausted && this.stamina > 30) this.exhausted = false;

    // ---------------------------------------------------------------- horizontal motion
    const hv = new THREE.Vector2(this.vel.x, this.vel.z);
    if (this.state === 'ground') {
      const tx = mx * speed * mag, tz = mz * speed * mag;
      const rate = this.grounded ? (mag > 0 ? 7.5 : 9) * (1 - 0.45 * deep) : 1.2;
      this.vel.x = damp(this.vel.x, tx, rate, dt);
      this.vel.z = damp(this.vel.z, tz, rate, dt);
    } else if (this.state === 'roll') {
      this.vel.x *= Math.exp(-1.6 * dt); this.vel.z *= Math.exp(-1.6 * dt);
    } else if (this.state === 'flop') {
      this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt);
    } else if (this.state === 'getup') {
      this.vel.x *= Math.exp(-10 * dt); this.vel.z *= Math.exp(-10 * dt);
    } else if (this.state === 'flash') {
      this.vel.x = this.vel.z = 0;
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // heading follows travel direction, slower at speed (momentum)
    const prevHeading = this.heading;
    if (this.state === 'ground' && sp > 0.25 && mag > 0 && !(W && W.faceLock)) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.heading = dampAngle(this.heading, want, this.grounded ? (sp > 5 ? 7 : 11) : 3, dt);
    }
    this.turnRate = dt > 0 ? wrapAngle(this.heading - prevHeading) / dt : 0;
    this.accel = dt > 0 ? (sp - this._prevSpeed) / dt : 0;
    this._prevSpeed = sp;

    // ---------------------------------------------------------------- flash roll: the roll tapped twice
    if (!inMenu && input.diveDouble() && (this.state === 'dive' || this.state === 'roll') && this.diveFrom) g.flash?.trigger(this);

    // ---------------------------------------------------------------- jump & dive
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (!inMenu && this.state === 'ground') {
      if (input.jump() && this.coyote > 0 && !(W && W.busy)) {
        this.vel.y = 4.5 - 1.2 * deep;
        this.grounded = false; this.coyote = 0;
        this.emit('jump', this.pos.clone(), S);
      } else if (input.dive() && this.grounded && this.stamina >= 12) {
        this.stamina -= 16; this.staminaDelay = 0.8;
        const dir = new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
        if (mag > 0) { dir.set(mx, mz); this.heading = Math.atan2(mx, mz); }
        const v = clamp(sp + 2.4, 4.6, 8.2) * (1 - 0.25 * deep);
        this.vel.set(dir.x * v, 3.6 - 0.6 * deep, dir.y * v);
        this.diveFrom = this.pos.clone(); this.diveDir = dir.clone(); this.diveSpeed = v; this.diveVy = this.vel.y;     // what the flash roll works from
        this.grounded = false;
        this.setState('dive');
        this.emit('dive', this.pos.clone(), S);
      }
    }

    // ---------------------------------------------------------------- vertical
    if (!this.grounded) this.vel.y += GRAV * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    this.collide();
    const gy = groundY(this.pos.x, this.pos.z);
    if (this.grounded) {
      // stick to the ground when walking downhill
      if (this.pos.y - gy < 0.35) { this.pos.y = gy; this.vel.y = 0; }
      else { this.grounded = false; }
    } else if (this.pos.y <= gy) {
      const impact = -this.vel.y;
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
      if (this.state === 'dive') {
        if (deep > 0.25) { this.setState('flop'); this.emit('flop', this.pos.clone(), S, impact); }
        else { this.setState('roll'); this.emit('roll', this.pos.clone(), S, impact); }
        this.game.rig.shake = Math.max(this.game.rig.shake, 0.35);
      } else {
        this.landImpact = impact;
        this.emit('land', this.pos.clone(), S, impact);
        if (impact > 8) this.game.rig.shake = Math.max(this.game.rig.shake, 0.3);
      }
    }
    // state timeouts
    if (this.state === 'roll' && this.stateT > this.rollTime) {
      this.setState('ground');
      this.emit('rollEnd', this.pos.clone(), this.heading, Math.hypot(this.vel.x, this.vel.z));
    }
    if (this.state === 'flop' && this.stateT > 0.55) this.setState('getup');
    if (this.state === 'getup' && this.stateT > this.getupTime) {
      this.setState('ground');
      this.emit('rollEnd', this.pos.clone(), this.heading, 1.5);
    }
    if (this.state === 'dive' && this.stateT > 2.5) this.setState('ground');

    this.visualY = this.pos.y;
    this.syncModel(dt);
  }

  collide() {
    for (const c of this.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z, r = c.r + 0.28;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        this.pos.x += dx * push; this.pos.z += dz * push;
        // kill velocity into the obstacle
        const nx = dx / d, nz = dz / d, vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
      }
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > PLAY_RADIUS) {
      const k = PLAY_RADIUS / r;
      this.pos.x *= k; this.pos.z *= k;
      this.game.hud?.hint('The mist thickens. The plain ends here.');
    }
  }

  syncModel(dt) {
    const m = this.model;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const P = {
      speed: this.state === 'ground' ? (this.weapon ? this.weapon.animSpeed(hs) : hs) : 0, vy: this.vel.y, grounded: this.grounded,
      state: this.state, stateT: this.stateT, turnRate: this.turnRate, accel: this.weapon && this.weapon.w > 0.01 ? 0 : this.accel,
      snow: clamp(this.snowDepth / 0.35, 0, 1), wheat: this.surface ? this.surface.wheat * (1 - this.surface.path) : 0,
      landImpact: this.landImpact, rollTime: this.rollTime, getupTime: this.getupTime, style: m.animStyle || {},
      attack: this.weapon && this.weapon.rig === m.swordRig ? this.weapon.layer : null,
    };
    const pose = this.anim.update(dt, P);
    this.landImpact = P.landImpact;
    m.applyPose(pose);
    m.group.position.copy(this.pos);
    m.group.rotation.y = this.heading;
    // wind felt by the cloth: world wind plus the air we run through
    const w = this.game.wind ? this.game.wind.at(this.pos.x, this.pos.z) : new THREE.Vector3();
    this.wind.set(w.x - this.vel.x, w.y - this.vel.y * 0.5, w.z - this.vel.z);
    const rolling = this.state === 'roll' || this.state === 'getup' || this.state === 'flop';
    const late = (this.state === 'roll' && this.stateT > this.rollTime * 0.6) || (this.state === 'getup' && this.stateT > this.getupTime * 0.5);
    this._settle = late ? 1 : rolling ? (this._settle || 0) : Math.max(0, (this._settle || 0) - dt * 1.6);
    m.update(dt, this.wind, rolling, this._settle);
    if (this.weapon && dt > 0) this.weapon.after(dt);
    for (const side of this.anim.steps) {
      const p = m.footWorld(side);
      this.emit('step', side, p, this.surface, hs, this.sprinting);
    }
  }
}
