// Wind Crow (a skill under Wind Call). Hold Z while the wind is with him:
//   summon  he turns to where the camera looks and calls; a great crow of wind forms high up behind him and
//           swoops down over his left shoulder (the camera's side is his right) at the height of his raised
//           hands                                                                                  (SUMMON s)
//   catch   as it goes over he springs up and grabs its feet and it tears him away: for a moment he is dragged
//           along, feet ploughing the ground, before it climbs                                     (DRAG s)
//   flight  it carries him wherever the camera looks for as long as the key is held: A and D bank it round
//           (the view turns with it), W beats harder, S glides slower, a dive gathers speed and a climb spends
//           it. He hangs from its feet and swings below his hands with every turn and change of speed; brought
//           low, his feet drag through the grass, the snow and the leaves, and the downwash of the wings lays the
//           field flat. Trees, rocks and walls are struck and bounced off; bushes are flown through. The view
//           widens with speed (camera.js reads P.fly). The flight burns the wind's charge, FLIGHT_DRAIN seconds
//           of it for every second in the air.
//   throw   let go (or the wind runs out) and he swings his legs through under it, whips over and hurls the crow
//           at whatever is in the middle of the screen (a crosshair shows it while he is carried), and drops
//           free                                                                                   (THROW s)
//   burst   the crow flies on with its wings folded, leaning in toward whatever it was thrown at, through
//           bushes, and bursts on the first thing it meets (or the ground, or after CROW_LIFE s): a blast of
//           wind that hurts and throws back everything within BURST_R, flattens the field, scatters leaves and
//           feathers, and shoves him too if he is close.
// player.js asks drive() for his velocity every frame; the pose is in anim.js (state 'crow', reading the pose
// handed over as P.crow) and the bird in windcrow.js.
import * as THREE from 'three';
import { groundY, surfaceAt, PLAY_RADIUS } from './world.js';
import { clamp, lerp, smoothstep, damp, dampAngle, wrapAngle } from './util.js';
import { WindCrow, NOISE } from './windcrow.js';
import { Streak } from './gale.js';

export const SUMMON = 0.7, THROW = 0.46;
const RELEASE = 0.14;                                         // seconds into the throw that he lets go
const CRUISE = 15, FAST = 27, SLOW = 8, VMIN = 6, VMAX = 36;  // flight speeds, m/s
const TURN = 2.3, CLIMB = 0.75, DIVE = 1.05, CEILING = 45;    // rad/s; steepest climb and dive (rad); metres up
const DRAG = 0.45, MIN_FLIGHT = 0.3, FLIGHT_DRAIN = 2, COOL = 1.2;
const CROW_SPEED = 44, CROW_LIFE = 1.4, HOME = 3.5, LOCK = 50;
const BURST_R = 5.5, BURST_DMG = [18, 46], BURST_KNOCK = 3.2;
const TAU = Math.PI * 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

export class CrowFlight {
  constructor(game) {
    this.game = game;
    this.bird = new WindCrow(game.scene);
    this.phase = null; this.t = 0; this.cool = 0; this.flyT = 0; this.drag = 0; this.touch = false; this.released = false;
    this.dir = new THREE.Vector3(0, 0, 1); this.speed = 0; this.accel = 0; this.yawRate = 0; this.yaw = 0;
    this.from = new THREE.Vector3();
    this.theta = 0; this.thetaV = 0; this.phi = 0; this.phiV = 0; this.lean0 = 0;      // his swing below the hands
    this.flap = 0; this.beat = 0.5; this.tuck = 0; this.k = 0; this.hang = 1.6;
    this.pose = { phase: 'summon', t: 0, lean: 0, roll: 0, run: 0, runPh: 0, reach: 2.05 };
    this.dart = null; this.bursts = [];
    // the wingtips draw thin streaks of wind, faded as they stream back past the camera
    this.trails = [1, -1].map(() => new Streak(game.scene, { max: 30, life: 0.24, width: 0.045, opacity: 0.5, near: [1.5, 4.5] }));
    // a burst throws out rays of wind
    this.rays = Array.from({ length: 12 }, () => ({ s: new Streak(game.scene, { max: 16, life: 0.28, width: 0.09, opacity: 0.8 }), p: new THREE.Vector3(), v: new THREE.Vector3(), t: 9 }));
    this.scrapeT = 0; this.washT = 0; this.taught = false; this._s = {};
    this.shellGeo = new THREE.SphereGeometry(1, 32, 20);
  }

  // how high his hands are above his soles, arms straight up: what he hangs by
  hangOf(P) { return P.model.reachUp ?? 2.07 * (P.model.camHeight ?? 1.48) / 1.48; }
  scaleOf(P) { return clamp((P.model.camHeight ?? 1.48) / 1.18, 0.8, 1.4); }

  // Z. Returns true if the crow was called.
  trigger(P) {
    const G = this.game;
    if (!G.skills?.has('crow') || !G.skills.has('wind')) { G.hud?.hint('Learn Wind Crow in the skill tree (K), under Wind Call', 3); return false; }
    if (!G.gale?.active) { G.hud?.hint('The crow needs the wind with you: call it with V first', 3); return false; }
    if (P.state !== 'ground' || G.bow?.equipped || this.phase || this.dart || this.cool > 0) return false;
    const b = G.rig.basis();
    this.yaw = Math.atan2(b.fx, b.fz);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.hang = this.hangOf(P);
    this.phase = 'summon'; this.t = 0; this.hopped = false; this.released = false;
    P.setState('crow'); P.vel.x *= 0.3; P.vel.z *= 0.3;
    // it forms behind him and high, off to his left
    this.from.set(P.pos.x - fx * 16 + fz * 4, P.pos.y + this.hang + 6, P.pos.z - fz * 16 - fx * 4);
    this.k = 0; this.flap = 0;
    for (const s of this.trails) s.clear();
    G.audio?.wind('summon');
    // the wind draws together where it will be
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, e = Math.random() * 2 - 1, r = 2 + Math.random() * 2;
      G.particles.emit('gust', this.from.x + Math.cos(a) * r, this.from.y + e * r, this.from.z + Math.sin(a) * r, -Math.cos(a) * r * 3, -e * r * 3, -Math.sin(a) * r * 3, 0.3, 1);
    }
    return true;
  }

  // every frame he is in the move, before he moves: his velocity and heading
  drive(P, dt) {
    const G = this.game;
    if (!this.phase) { P.floating = false; P.setState('ground'); return; }
    this.t += dt;
    if (this.phase === 'summon') {
      // rooted while it comes, turning to where he will go, and a hop up to meet it at the end
      const k = Math.exp(-8 * dt); P.vel.x *= k; P.vel.z *= k;
      P.heading = dampAngle(P.heading, this.yaw, 10, dt);
      if (!this.hopped && this.t >= SUMMON - 0.14) { this.hopped = true; if (P.grounded) { P.vel.y = 3.2; P.grounded = false; } }
      if (this.t >= SUMMON) this.grab(P);
      return;
    }
    if (this.phase === 'carry') {
      this.flyT += dt;
      const held = G.state === 'play' && G.input.crowHeld();
      const fuel = G.gale ? G.gale.spend(FLIGHT_DRAIN * dt) : true;
      if (this.flyT < MIN_FLIGHT || (held && fuel)) { this.fly(P, dt, true); return; }
      if (!fuel) G.hud?.hint('The wind is spent: the crow will carry you no further', 2.5);
      this.phase = 'throw'; this.t = 0; this.released = false; this.lean0 = this.pose.lean;
    }
    if (this.phase === 'throw') {
      if (!this.released) {
        this.fly(P, dt, false);                     // still carried through the swing
        if (this.t >= RELEASE) this.release(P);
      } else {
        // he drops free; the air takes a little of his speed, the ground a lot of it
        const k = Math.exp(-(P.grounded ? 6 : 0.5) * dt); P.vel.x *= k; P.vel.z *= k;
      }
      if (this.t >= THROW) { this.phase = null; P.floating = false; P.setState('ground'); }
    }
  }

  // carried: steer toward the look, trade height for speed, keep off the ground and out of trees
  fly(P, dt, steer) {
    const G = this.game, rig = G.rig;
    const m = steer && G.state === 'play' ? G.input.move() : { x: 0, y: 0 };
    // where it is asked to go: where the camera looks (A and D bank it round, turning the view with it), climbing
    // or diving with the look
    if (steer) rig.yaw -= m.x * 1.5 * dt;
    let yaw = steer ? rig.yaw + Math.PI : Math.atan2(this.dir.x, this.dir.z);
    let climb = steer ? clamp(-(rig.pitch - 0.15) * 1.5, -DIVE, CLIMB) : Math.asin(clamp(this.dir.y, -1, 1));
    if (this.drag > 0) climb = Math.min(climb, 0);          // dragged along a moment before it climbs
    const alt = P.pos.y - groundY(P.pos.x, P.pos.z);
    if (alt > CEILING) climb = Math.min(climb, (CEILING - alt) * 0.08);
    // it will not fly into the mist at the edge of the plain: it turns back in
    const r = Math.hypot(P.pos.x, P.pos.z);
    if (r > PLAY_RADIUS - 14) {
      const w = smoothstep(PLAY_RADIUS - 14, PLAY_RADIUS - 3, r);
      yaw += wrapAngle(Math.atan2(-P.pos.x, -P.pos.z) - yaw) * w;
      if (w > 0.35) G.hud?.hint('The crow will not fly into the mist', 1.2);
    }
    const cc = Math.cos(climb), prevYaw = Math.atan2(this.dir.x, this.dir.z);
    _a.set(Math.sin(yaw) * cc, Math.sin(climb), Math.cos(yaw) * cc);
    // turn toward it, more slowly the faster it goes (asked to go straight back, it turns level)
    const ang = Math.acos(clamp(this.dir.dot(_a), -1, 1)), rate = TURN * lerp(1.3, 0.65, clamp((this.speed - VMIN) / (VMAX - VMIN), 0, 1));
    if (ang > 1e-4) {
      const axis = _b.crossVectors(this.dir, _a), al = axis.length();
      if (al < 1e-4) axis.set(0, 1, 0); else axis.divideScalar(al);
      this.dir.applyAxisAngle(axis, Math.min(ang, rate * dt)).normalize();
    }
    this.yawRate = damp(this.yawRate, wrapAngle(Math.atan2(this.dir.x, this.dir.z) - prevYaw) / Math.max(dt, 1e-4), 10, dt);
    // speed: what the wings are asked for, and the dive or the climb trading height for it
    const want = m.y >= 0 ? lerp(CRUISE, FAST, m.y) : lerp(CRUISE, SLOW, -m.y), before = this.speed;
    this.speed = clamp(this.speed + (want - this.speed) * (1 - Math.exp(-0.9 * dt)) - 11 * this.dir.y * dt, VMIN, VMAX);
    this.accel = damp(this.accel, (this.speed - before) / Math.max(dt, 1e-4), 8, dt);
    // the wings: hard beats when it is asked for speed or height, a glide otherwise, swept back in a fast dive
    this.beat = damp(this.beat, clamp(0.25 + (want - this.speed) * 0.1 + this.dir.y * 1.6 + (this.drag > 0 ? 0.5 : 0), 0.12, 1), 4, dt);
    this.tuck = damp(this.tuck, clamp(-this.dir.y * 1.3 + (this.speed - 24) / 14, 0, 1), 3, dt);
    // the next step. His body swings below his hands, which lifts his feet off the bottom of the swing.
    const feet = this.hang * (1 - Math.cos(clamp(this.pose.lean, -1.3, 1.3)) * Math.cos(clamp(this.pose.roll, -1.3, 1.3)));
    const step = this.speed * dt;
    let nx = P.pos.x + this.dir.x * step, nz = P.pos.z + this.dir.z * step, ny = P.pos.y + this.dir.y * step;
    const hit = this.obstacle(P, P.pos.x, P.pos.z, nx, nz, Math.min(P.pos.y, ny) + feet);
    if (hit) { this.bump(P, hit); nx = P.pos.x; nz = P.pos.z; }
    // kept off the ground: his feet may touch it, and are dragged through it, but go no lower
    const floor = groundY(nx, nz) - feet;
    if (this.drag > 0) { this.drag -= dt; ny = Math.max(floor + 0.02, Math.min(ny, P.pos.y) - 4 * dt); }
    if (ny < floor + 0.02) { ny = floor + 0.02; if (this.dir.y < 0) { this.dir.y *= 0.3; this.dir.normalize(); } }
    this.touch = ny <= floor + 0.08;
    P.vel.set((nx - P.pos.x) / dt, (ny - P.pos.y) / dt, (nz - P.pos.z) / dt);
    P.grounded = false; P.floating = true;
    P.heading = Math.atan2(this.dir.x, this.dir.z);
    // the swing: the air pushes his body back the faster it goes (more while his feet drag), speeding up swings
    // him back and slowing swings him forward under it; in a turn he is flung out wide
    const eqT = Math.atan2(0.011 * this.speed * this.speed + this.accel, 9.8) + (this.touch ? 0.3 : 0);
    this.thetaV += (-16 * (this.theta - eqT) - 2.2 * this.thetaV) * dt;
    this.theta = clamp(this.theta + this.thetaV * dt, -0.9, 1.35);
    const eqP = -Math.atan2(this.speed * this.yawRate, 9.8);
    this.phiV += (-14 * (this.phi - eqP) - 2.6 * this.phiV) * dt;
    this.phi = clamp(this.phi + this.phiV * dt, -0.9, 0.9);
  }

  // the first tree, rock or wall the stretch from (x0, z0) to (x1, z1) runs into, with his feet at height y
  obstacle(P, x0, z0, x1, z1, y) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 0.4));
    for (const c of P.colliders) {
      if (c.soft || c.bush) continue;
      const mx = (x0 + x1) / 2 - c.x, mz = (z0 + z1) / 2 - c.z, near = c.r + 0.5 + len / 2;
      if (mx * mx + mz * mz > near * near) continue;
      const top = c.wall ? c.wall.top : groundY(c.x, c.z) + (c.h ?? 2.5);
      if (y > top) continue;
      const r = c.r + 0.4, d0 = Math.hypot(x0 - c.x, z0 - c.z);
      for (let i = 1; i <= n; i++) {
        const dx = x0 + (x1 - x0) * i / n - c.x, dz = z0 + (z1 - z0) * i / n - c.z, d = Math.hypot(dx, dz);
        if (d < r && d < d0) return c;            // going in (never held inside one he is already leaving)
      }
    }
    return null;
  }
  // struck: the way into it is taken out of the flight, the crow loses feathers and half its speed
  bump(P, c) {
    const G = this.game, ex = P.pos.x - c.x, ez = P.pos.z - c.z, el = Math.hypot(ex, ez) || 1, nx = ex / el, nz = ez / el;
    const vn = this.dir.x * nx + this.dir.z * nz;
    if (vn < 0) { this.dir.x -= 1.7 * vn * nx; this.dir.z -= 1.7 * vn * nz; this.dir.normalize(); }
    this.speed = Math.max(VMIN, this.speed * 0.55);
    this.thetaV -= 3; this.phiV += (Math.random() - 0.5) * 4;
    const x = c.x + nx * c.r, z = c.z + nz * c.r, y = P.pos.y + this.hang * 0.6;
    c.wall?.jolt(x, y, z);
    for (let i = 0; i < 14; i++) G.particles.emit('feather', x, y, z, nx * 3 + (Math.random() - 0.5) * 3, Math.random() * 2, nz * 3 + (Math.random() - 0.5) * 3, 1, 1);
    G.particles.emit('dust', x, y, z, nx * 2, 0.5, nz * 2, 1, 8);
    G.audio?.wind('bump'); G.audio?.sword('hit');
    G.rig.shake = Math.max(G.rig.shake, 0.7); G.hitStop = Math.max(G.hitStop, 0.06);
  }

  // it is over him: he catches its feet and is torn away
  grab(P) {
    const G = this.game;
    this.phase = 'carry'; this.t = 0; this.flyT = 0;
    this.dir.set(Math.sin(this.yaw), 0.05, Math.cos(this.yaw)).normalize(); this.speed = CRUISE;
    this.drag = P.pos.y - groundY(P.pos.x, P.pos.z) < 0.7 ? DRAG : 0;
    this.theta = 0.1; this.thetaV = 4.5;           // the yank: his body is left behind as his hands are carried off
    this.phi = this.phiV = this.accel = this.yawRate = 0; this.beat = 1; this.tuck = 0;
    P.floating = true; P.grounded = false;
    G.audio?.wind('grab'); G.audio?.wind('caw');
    G.rig.shake = Math.max(G.rig.shake, 0.6); G.hitStop = Math.max(G.hitStop, 0.05);
    G.hud?.callout('WIND CROW', 'wind');
    const hy = P.pos.y + this.hang;
    for (let i = 0; i < 30; i++) { const a = Math.random() * TAU, s = 2 + Math.random() * 4; G.particles.emit('gust', P.pos.x, hy, P.pos.z, Math.cos(a) * s, (Math.random() - 0.3) * 3, Math.sin(a) * s, 0.5, 1); }
    for (let i = 0; i < 10; i++) G.particles.emit('feather', P.pos.x, hy + 0.3, P.pos.z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 1, 1);
    G.trample.stamp(P.pos.x, P.pos.z, 1.4, 1, this.dir.x, this.dir.z, 1);
    G.particles.emit('dust', P.pos.x, P.pos.y + 0.05, P.pos.z, this.dir.x * 3, 0.8, this.dir.z * 3, 1, 14);
    if (!this.taught) { this.taught = true; G.hud?.hint('Steer with the mouse (A and D bank)  ·  W faster, S slower  ·  let go of Z to throw the crow', 5); }
  }

  // what is in the middle of the screen: the first thing the camera's line of sight meets past him (the ground or
  // something that can be hit), else a point far off along it
  aimPoint(out) {
    const G = this.game, cam = G.camera, d = cam.getWorldDirection(_b), o = cam.position;
    const from = o.distanceTo(G.player.pos) + 1;
    for (let s = from; s < 120; s += 0.5) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (y < groundY(x, z)) return out.set(x, y, z);
      for (const c of G.enemies?.targets || []) if (!c.dead) {
        const gy = groundY(c.x, c.z) + (c.lift || 0);          // (up in the air, if a Gale Slam threw it)
        if (Math.hypot(x - c.x, z - c.z) < c.r + 0.2 && y > gy && y < gy + (c.y1 || 1.9)) return out.set(x, y, z);
      }
    }
    return out.set(o.x + d.x * 120, o.y + d.y * 120, o.z + d.z * 120);
  }

  // he lets go: the crow is hurled at what the camera is on, and he drops
  release(P) {
    const G = this.game, o = this.bird.root.position, d = this.aimPoint(_d).sub(o).normalize();
    this.released = true;
    // the nearest thing ahead along the throw, if any: the crow leans in toward it as it flies
    let target = null, best = LOCK;
    for (const c of G.enemies?.targets || []) {
      if (c.dead) continue;
      _c.set(c.x - o.x, groundY(c.x, c.z) + (c.lift || 0) + 1 - o.y, c.z - o.z);
      const dist = _c.length();
      if (dist < best && _c.dot(d) / dist > 0.93) { best = dist; target = c; }
    }
    // something near the crosshair: it is thrown straight at it
    if (target) d.set(target.x - o.x, groundY(target.x, target.z) + (target.lift || 0) + 1 - o.y, target.z - o.z).normalize();
    this.dart = { pos: o.clone(), vel: d.clone().multiplyScalar(CROW_SPEED).addScaledVector(P.vel, 0.25), t: 0, target };
    for (const s of this.trails) s.clear();          // the folded wings draw new streaks from where their tips now are
    P.floating = false;
    P.vel.x *= 0.45; P.vel.z *= 0.45; P.vel.y = P.vel.y * 0.3 + 3;
    this.cool = COOL;
    G.audio?.wind('throw'); G.audio?.wind('caw');
    G.rig.shake = Math.max(G.rig.shake, 0.5);
    for (let i = 0; i < 12; i++) G.particles.emit('feather', o.x, o.y, o.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 1, 1);
  }

  // he was taken out of it (the menu's training ground, or anything else that set his state): it comes apart
  abort(P) {
    const G = this.game, o = this.bird.root.position;
    this.phase = null; P.floating = false;
    for (let i = 0; i < 30; i++) G.particles.emit(i % 3 ? 'gust' : 'feather', o.x, o.y, o.z, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, 1, 1);
  }

  // effects and the bird, after he has moved
  update(dt, G) {
    const P = G.player;
    this.cool = Math.max(0, this.cool - dt);
    if (this.phase && P.state !== 'crow') this.abort(P);
    // the camera takes the flight's wider, faster view while he is carried, and eases out of it after
    P.fly = damp(P.fly || 0, this.phase && this.phase !== 'summon' ? 1 : 0, this.phase ? 6 : 0.8, dt);
    this.updatePose(dt, P);
    if (this.dart) this.updateDart(dt, G, P); else this.updateBird(dt, G, P);
    this.updateBursts(dt);
    for (const s of this.trails) s.update(dt, G.camera);
    const carried = this.phase === 'carry' || (this.phase === 'throw' && !this.released);
    if (carried) this.ground(dt, G, P);
    if (this.phase === 'carry') G.hud?.setCrosshair(true, 0.6);          // where the throw will go (the bow sets it before us)
    if (this.phase === 'carry') {
      // the air rushing past: wisps of it stream by, and the faster it goes the more it buffets
      const n = Math.max(0, (this.speed - 12) * 0.12) * dt * 60;
      for (let i = 0, c = Math.floor(n + Math.random()); i < c; i++) {
        const s = 2 + Math.random() * 10;
        G.particles.emit('gust', P.pos.x + this.dir.x * s + (Math.random() - 0.5) * 7, P.pos.y + this.hang * 0.5 + this.dir.y * s + (Math.random() - 0.5) * 5, P.pos.z + this.dir.z * s + (Math.random() - 0.5) * 7, 0, 0, 0, 0.2, 1);
      }
      G.rig.shake = Math.max(G.rig.shake, clamp((this.speed - 22) / 45, 0, 0.3));
    }
  }

  // what the animator needs (P.crowPose)
  updatePose(dt, P) {
    const C = this.pose;
    C.phase = this.phase || 'summon'; C.t = this.t; C.reach = this.hang / (P.model.pivotScale || 1);
    if (this.phase === 'carry' || this.phase === 'throw') {
      let lean = this.theta, roll = this.phi;
      if (this.phase === 'throw') {
        // his legs swing through under it (he leans back), he whips over and lets go, and the swing settles to
        // upright as he drops
        const u = this.t / THROW;
        lean = u < 0.3 ? lerp(this.lean0, -0.6, smoothstep(0, 0.3, u)) : u < 0.55 ? lerp(-0.6, 0.35, smoothstep(0.3, 0.55, u)) : lerp(0.35, 0, smoothstep(0.55, 0.8, u));
        roll *= 1 - smoothstep(0.3, 0.7, u);
      }
      C.lean = lean; C.roll = roll;
      C.run = damp(C.run, this.phase === 'carry' && this.touch ? 1 : 0, 10, dt);
      C.runPh += dt * 16 * C.run;
    } else { C.lean = 0; C.roll = 0; C.run = 0; }
  }

  // the bird while it is coming for him, and while it carries him
  updateBird(dt, G, P) {
    const B = this.bird, S = this.scaleOf(P);
    const showing = !!this.phase && !(this.phase === 'throw' && this.released);
    this.k = damp(this.k, showing ? 1 : 0, showing ? 7 : 5, dt);
    if (!showing) { if (this.k > 0.01) B.update(G.time, { k: this.k, flap: this.flap, beat: 0.3, scale: S }); else B.update(G.time, { k: 0 }); return; }
    if (this.phase === 'summon') {
      // the swoop: down from where it formed, low past his left shoulder, to where his hands will be, and on
      // along his way (a cubic: it arrives at about the speed it will carry him)
      const u = clamp(this.t / SUMMON, 0, 1), v = 1 - u, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), p0 = this.from;
      const hx = P.pos.x, hy = P.pos.y + this.hang, hz = P.pos.z;
      const p1 = _a.set(hx - fx * 9 + fz * 3, hy + 1.8, hz - fz * 9 - fx * 3), p2 = _b.set(hx - fx * 3.5 + fz, hy + 0.4, hz - fz * 3.5 - fx);
      const w0 = v * v * v, w1 = 3 * v * v * u, w2 = 3 * v * u * u, w3 = u * u * u;
      const at = _c.set(w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * hx, w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * hy, w0 * p0.z + w1 * p1.z + w2 * p2.z + w3 * hz);
      const d0 = v * v, d1 = 2 * v * u, d2 = u * u;
      const dx = d0 * (p1.x - p0.x) + d1 * (p2.x - p1.x) + d2 * (hx - p2.x), dy = d0 * (p1.y - p0.y) + d1 * (p2.y - p1.y) + d2 * (hy - p2.y), dz = d0 * (p1.z - p0.z) + d1 * (p2.z - p1.z) + d2 * (hz - p2.z);
      this.flap += dt * 10;
      B.update(G.time, { k: this.k, flap: this.flap, beat: lerp(0.9, 0.35, u), tuck: 0.35 * u, glow: 0.5 * (1 - u), scale: S * (0.7 + 0.3 * this.k) });
      B.place(at, Math.atan2(dx, dz), -0.6 * Math.atan2(dy, Math.hypot(dx, dz)), 0);
      this.wingTrails(B, 0.6 * this.k);
      if (u < 0.5 && Math.random() < 0.6) G.particles.emit('gust', B.root.position.x, B.root.position.y, B.root.position.z, -dx, -dy, -dz, 1.5, 2);
      return;
    }
    // carried, or the swing before he lets go: its talons round his hands
    const L = P.model.handWorld?.('L', _a), R = P.model.handWorld?.('R', _b);
    const at = L && R ? _c.copy(L).add(R).multiplyScalar(0.5) : _c.set(P.pos.x, P.pos.y + this.hang, P.pos.z);
    at.y += 0.03 * S;
    // a wingbeat sound at the top of each stroke
    const stroke = Math.floor((this.flap - Math.PI / 2) / TAU);
    this.flap += dt * (5.5 + 8 * this.beat);
    if (Math.floor((this.flap - Math.PI / 2) / TAU) !== stroke && this.beat > 0.35) G.audio?.wind('flap', this.beat);
    const pitch = -Math.asin(clamp(this.dir.y, -1, 1)) - 0.18 * this.beat * (1 - this.tuck);     // nose up a little while it labours
    B.update(G.time, { k: this.k, flap: this.flap, beat: this.beat, tuck: this.tuck, look: clamp(this.yawRate * 0.3, -0.6, 0.6), glow: 0, scale: S });
    B.place(at, Math.atan2(this.dir.x, this.dir.z), pitch, clamp(-this.yawRate * 0.35, -0.9, 0.9));
    this.wingTrails(B, clamp((this.speed - 8) / 16, 0.15, 1));
  }
  wingTrails(B, a) { this.trails.forEach((s, i) => s.push(B.tip(i ? -1 : 1, _d), a)); }

  // his feet dragged through whatever is underfoot, and the downwash of the wings when it flies low
  ground(dt, G, P) {
    if (this.touch || this.pose.run > 0.3) {
      for (const side of ['L', 'R']) {
        const f = P.model.footWorld(side, _a), gy = groundY(f.x, f.z);
        if (f.y - gy > 0.25) continue;
        const s = surfaceAt(f.x, f.z, this._s);
        G.cut.stamp(f.x, f.z, 0.3, 1);
        G.trample.stamp(f.x, f.z, 0.55, 1, this.dir.x, this.dir.z, 1);
        G.snow.stamp(f.x, f.z, 0.18, 0.35, P.heading, 1, 1);
        if (s.leaves > 0.15) G.leaves.kick?.(f.x, f.z, 0.6, 1.4, P.vel.x * 0.4, P.vel.z * 0.4);
        if (Math.random() < 0.7) {
          const kind = s.snow > 0.4 ? 'snow' : s.wheat > 0.4 ? 'chaff' : s.grass > 0.4 && s.path < 0.4 ? 'clip' : 'dust';
          G.particles.emit(kind, f.x, gy + 0.08, f.z, P.vel.x * 0.25, 1.2 + Math.random() * 1.5, P.vel.z * 0.25, 1, kind === 'dust' ? 2 : 3);
        }
      }
      this.scrapeT -= dt;
      if (this.scrapeT <= 0) { this.scrapeT = 0.09; G.audio?.step(P.surface, 6, true); }
    }
    const gy = groundY(P.pos.x, P.pos.z), alt = P.pos.y + this.hang - gy;
    if (alt < 7) {
      this.washT -= dt;
      if (this.washT <= 0) {
        this.washT = 0.05;
        const k = 1 - alt / 7, r = 1.5 + 2 * k, fx = this.dir.x, fz = this.dir.z;
        G.trample.stamp(P.pos.x, P.pos.z, r, 0.85 * k, fx, fz, 0.4);
        G.leaves.kick?.(P.pos.x, P.pos.z, r, 1.5 * k, fx * this.speed * 0.3, fz * this.speed * 0.3);
        const snow = (P.surface?.snow || 0) > 0.4;
        if (Math.random() < k) G.particles.emit(snow ? 'powder' : 'dust', P.pos.x - fx * 1.5, gy + 0.1, P.pos.z - fz * 1.5, fx * 4, 1, fz * 4, 2, snow ? 3 : 1);
      }
    }
  }

  // the thrown crow, folded into a dart
  updateDart(dt, G, P) {
    const s = this.dart, B = this.bird, S = this.scaleOf(P);
    s.t += dt;
    if (s.target && !s.target.dead) {
      // it leans in toward what it was thrown at
      _a.set(s.target.x, groundY(s.target.x, s.target.z) + (s.target.lift || 0) + 1.0, s.target.z).sub(s.pos).normalize();
      const sp = s.vel.length(); _b.copy(s.vel).divideScalar(sp || 1);
      const ang = Math.acos(clamp(_b.dot(_a), -1, 1));
      if (ang > 1e-4) _b.lerp(_a, Math.min(1, HOME * dt / ang)).normalize();
      s.vel.copy(_b).multiplyScalar(sp);
    }
    s.vel.y -= 2.5 * dt;
    // stepped, so a fast frame cannot carry it through anything
    const n = Math.max(1, Math.ceil(s.vel.length() * dt / 0.4)), h = dt / n;
    for (let i = 0; i < n; i++) {
      s.pos.addScaledVector(s.vel, h);
      const hit = this.dartHit(s.pos);
      if (hit) { this.burst(s.pos.x, s.pos.y, s.pos.z); return; }
    }
    if (s.t > CROW_LIFE || Math.hypot(s.pos.x, s.pos.z) > PLAY_RADIUS) { this.burst(s.pos.x, s.pos.y, s.pos.z); return; }
    // skimming low it lays the field flat along its way
    const gy = groundY(s.pos.x, s.pos.z), sp = Math.hypot(s.vel.x, s.vel.z) || 1;
    if (s.pos.y - gy < 3) { G.trample.stamp(s.pos.x, s.pos.z, 1.6, 0.9, s.vel.x / sp, s.vel.z / sp, 0.6); G.leaves.kick?.(s.pos.x, s.pos.z, 1.8, 1.4, s.vel.x * 0.25, s.vel.z * 0.25); }
    this.flap += dt * 3;
    B.update(G.time, { k: 1, flap: this.flap, beat: 0, dart: smoothstep(0, 0.12, s.t), glow: 0.35 + 0.65 * smoothstep(0, CROW_LIFE, s.t), scale: S });
    B.setAt(s.pos, Math.atan2(s.vel.x, s.vel.z), -Math.atan2(s.vel.y, sp), 0);
    this.wingTrails(B, 0.9);
    for (let i = 0; i < 3; i++) G.particles.emit('gust', s.pos.x, s.pos.y, s.pos.z, -s.vel.x * 0.1, -s.vel.y * 0.1, -s.vel.z * 0.1, 1.2, 1);
    if (Math.random() < 0.3) G.particles.emit('feather', s.pos.x, s.pos.y, s.pos.z, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2, 0.5, 1);
  }
  // what the dart has flown into, if anything
  dartHit(p) {
    const G = this.game;
    if (p.y - groundY(p.x, p.z) < 0.3) return 'ground';
    for (const c of G.enemies?.targets || []) {
      if (c.dead) continue;
      const cy = groundY(c.x, c.z) + (c.lift || 0);
      if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.45 && p.y > cy - 0.2 && p.y < cy + (c.y1 || 1.9) + 0.3) return c;
    }
    if (G.earth?.blockArrow(p)) return 'wall';
    for (const L of [G.trees?.colliders, G.props?.colliders]) if (L) for (const c of L) {
      if (c.bush) continue;
      const dx = p.x - c.x, dz = p.z - c.z, r = c.r + 0.3;
      if (dx * dx + dz * dz < r * r && p.y < groundY(c.x, c.z) + (c.h ?? 2.5)) return 'tree';
    }
    return null;
  }

  // the crow bursts at (x, y, z): a blast of wind
  burst(x, y, z) {
    const G = this.game, P = G.player, gy = groundY(x, z), low = y - gy < 3.5;
    this.dart = null; this.k = 0; this.bird.update(G.time, { k: 0 });
    // a shell of air thrown out, and a ring over the ground under it
    // (torn into wisps that swirl as it spreads, so it reads as air and not as glass)
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 }, uT: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN, vV, vP; void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uA, uT; varying vec3 vN, vV, vP; ${NOISE}
        void main() {
          float r = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
          float a = atan(vP.z, vP.x) + uT * 4.0 + vP.y * 2.0;
          float w = smoothstep(0.45, 0.85, cNoise(vec3(cos(a) * 2.5, vP.y * 3.0 - uT * 2.0, sin(a) * 2.5)));
          gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * r * uA * (0.04 + w), 1.0);
        }`,
    });
    const shell = new THREE.Mesh(this.shellGeo, mat); shell.position.set(x, y, z); shell.renderOrder = 14; shell.frustumCulled = false;
    G.scene.add(shell); this.bursts.push({ shell, mat, t: 0 });
    if (low) G.gale?.ring(x, y, z, BURST_R * 1.3, 0.55, 0.8 * (1 - (y - gy) / 3.5));
    // everything within reach is hurt and thrown back, hardest at the middle
    for (const c of G.enemies?.targets || []) {
      if (c.dead) continue;
      const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, groundY(c.x, c.z) + (c.lift || 0) + 1 - y, dz);
      if (d > BURST_R + c.r) continue;
      const f = 1 - clamp((d - c.r) / BURST_R, 0, 1), dh = Math.hypot(dx, dz) || 1;
      c.onHit?.('gale', Math.round(lerp(BURST_DMG[0], BURST_DMG[1], f)), dx / dh, dz / dh, { knock: 0.6 + BURST_KNOCK * f });
      const cy = groundY(c.x, c.z) + (c.lift || 0) + 1;
      for (let i = 0; i < 12; i++) G.particles.emit('feather', c.x, cy, c.z, dx / dh * 4 + (Math.random() - 0.5) * 3, Math.random() * 3, dz / dh * 4 + (Math.random() - 0.5) * 3, 1, 1);
    }
    for (const w of G.earth?.walls || []) if (w.up && !w.falling && w.circles.some((c) => Math.hypot(c.x - x, c.z - z) < BURST_R)) w.jolt(w.x, Math.min(y, w.top - 0.3), w.z);
    // the ground under it: flattened outward in a ring, torn at the middle, leaves blown away, snow thrown up
    const pz = G.particles;
    if (low) {
      const k = 1 - clamp((y - gy) / 3.5, 0, 1);
      G.cut.stamp(x, z, 0.4 + 1.4 * k, 1);
      for (let a = 0; a < TAU; a += 0.35) { const cx = Math.cos(a), cz = Math.sin(a); for (const r of [1.5, 3, 4.5, 6]) G.trample.stamp(x + cx * r, z + cz * r, 1.3, k, cx, cz, 0.9); }
      G.leaves.burst?.(x, gy, z, BURST_R * 1.3, 7 * k);
      const snow = surfaceAt(x, z, this._s).snow > 0.4;
      if (snow) G.snow.stamp(x, z, 1.5 * k, 1.5 * k, 0, 1, 1);
      for (let i = 0; i < 40; i++) { const a = i / 40 * TAU; pz.emit(snow ? 'powder' : 'dust', x + Math.cos(a) * 0.8, gy + 0.1, z + Math.sin(a) * 0.8, Math.cos(a) * 9 * k, 0.8, Math.sin(a) * 9 * k, 1, 1); }
    }
    // the blast itself: rays of wind, air and feathers thrown out every way
    this.rays.forEach((r, i) => {
      const a = i / this.rays.length * TAU + Math.random() * 0.4, e = (Math.random() - 0.3) * 0.7, s = 16 + Math.random() * 8;
      r.p.set(x, y, z); r.v.set(Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s); r.t = 0; r.s.clear();
    });
    for (let i = 0; i < 90; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * TAU, q = Math.sqrt(1 - u * u), s = 7 + Math.random() * 8;
      pz.emit('gust', x, y, z, Math.cos(a) * q * s, u * s * 0.6 + 1, Math.sin(a) * q * s, 0.5, 1);
    }
    for (let i = 0; i < 40; i++) { const a = Math.random() * TAU, s = 2 + Math.random() * 6; pz.emit('feather', x, y, z, Math.cos(a) * s, 1 + Math.random() * 4, Math.sin(a) * s, 1, 1); }
    // it shoves him too, if he is close
    const ex = P.pos.x - x, ey = P.pos.y + 0.8 - y, ez = P.pos.z - z, pd = Math.hypot(ex, ey, ez), reach = BURST_R * 1.3;
    if (pd < reach && P.state !== 'crow') {
      const f = 1 - pd / reach, l = pd || 1;
      P.vel.x += ex / l * 10 * f; P.vel.z += ez / l * 10 * f; P.vel.y = Math.max(P.vel.y, 0) + 6 * f;
      if (P.grounded && f > 0.15) { P.grounded = false; P.pos.y += 0.05; }
    }
    // felt by the camera and heard by distance
    const cd = G.camera.position.distanceTo(_a.set(x, y, z));
    G.rig.shake = Math.max(G.rig.shake, clamp(1.15 - cd / 35, 0, 1));
    if (cd < 18) G.hitStop = Math.max(G.hitStop, 0.07);
    G.audio?.wind('burst', clamp(1.2 - cd / 60, 0.25, 1));
  }
  updateBursts(dt) {
    // the rays curl as they go, and slow
    for (const r of this.rays) {
      if (r.t < 0.22) {
        r.t += dt;
        r.v.applyAxisAngle(_a.set(0, 1, 0), dt * 5).multiplyScalar(Math.exp(-4 * dt));
        r.p.addScaledVector(r.v, dt); r.s.push(r.p, 1 - r.t / 0.22);
      }
      r.s.update(dt, this.game.camera);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]; b.t += dt;
      const u = b.t / 0.45;
      b.shell.scale.setScalar(0.4 + BURST_R * 1.15 * (1 - Math.pow(1 - Math.min(1, u), 3)));
      b.mat.uniforms.uA.value = 0.8 * Math.pow(Math.max(0, 1 - u), 1.5); b.mat.uniforms.uT.value = b.t;
      if (u >= 1) { this.game.scene.remove(b.shell); b.mat.dispose(); this.bursts.splice(i, 1); }
    }
  }
}
