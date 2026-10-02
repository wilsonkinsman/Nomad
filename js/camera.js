// Third-person camera: over-the-shoulder spring arm with lag, terrain avoidance, a slow pull-back
// and wider lens while running, a lens that widens with speed while the Wind Crow carries him,
// plus a slow cinematic orbit for the title screen. Walls (the village's houses, in `blockers`) bring the lens in
// in front of them, so he is never seen through one.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, damp, smoothstep } from './util.js';
import { enters } from './collide.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0; this.pitch = 0.12;
    this.dist = 3.6; this.distTarget = 3.6;
    this.pull = 0;            // extra arm length while running
    this.focus = new THREE.Vector3();
    this.fov = 52;
    this.shake = 0;
    this.menuT = 0;
    this.clip = 1;            // how much of the arm is left when a trunk is in the way
    this.obstacles = null;    // {x, z, r} circles the arm must not pass through (the wide trunks of the old trees)
    this.blend = 0;           // 0 = menu orbit, 1 = gameplay
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this.blockers = [];       // boxes the lens may not pass behind
    this.ceiling = null;      // (x, z) => how high the ceiling is over him indoors, or null outdoors
    this.indoor = 0;
    this.reach = 1;           // how much of the arm is clear of them (eases back out, snaps in)
  }

  update(dt, player, input, inMenu) {
    const cam = this.cam;
    // look input
    if (!inMenu) {
      const sens = 0.0022 * (1 - 0.55 * (player.aimZoom || 0));      // slower while the bow is drawn
      this.yaw -= input.lookX * sens;
      this.pitch += input.lookY * sens;
      if (input.pad.active) { this.yaw -= input.pad.lx * 2.6 * dt; this.pitch += input.pad.ly * 1.8 * dt; }
      this.pitch = clamp(this.pitch, -0.5, 1.1);
      this.distTarget = clamp(this.distTarget + input.wheel * 0.4, 1.8, 7);
    }
    this.blend = damp(this.blend, inMenu ? 0 : 1, 1.6, dt);
    this.dist = damp(this.dist, this.distTarget, 6, dt);
    // running eases the camera back and up to show more of the land ahead; stopping brings it in
    const hs = player.state === 'ground' || player.state === 'tackle' ? Math.hypot(player.vel.x, player.vel.z) : 0;
    const run = smoothstep(2.2, 3.4, hs), sprint = smoothstep(4.4, 6.2, hs);
    const pullT = inMenu ? 0 : 1.0 * run + 0.5 * sprint;
    this.pull = damp(this.pull, pullT, pullT > this.pull ? 0.9 : 1.4, dt);
    const eye = player.model.camHeight ?? 1.48, hs1 = eye / 1.48;     // shorter characters: lower, closer camera
    const zoom = player.aimZoom || 0;
    const far = player.aimPull || 0;          // a Thunder Arrow being charged: the camera pulls far back
    // the Wind Crow: the arm lengthens to take in the bird, and more the faster it goes
    const fly = player.fly || 0, spd = Math.hypot(player.vel.x, player.vel.y, player.vel.z);
    // indoors the arm is shorter and the lens stays under the ceiling
    const roof = this.ceiling ? this.ceiling(player.pos.x, player.pos.z) : null;
    this.indoor = damp(this.indoor, roof != null ? 1 : 0, 4, dt);
    const arm = (1 - 0.3 * this.indoor) * (this.dist + this.pull) * Math.sqrt(hs1) * (1 - 0.35 * zoom) * (1 + 1.9 * far) * (1 + fly * (0.3 + 0.012 * spd));

    // focus trails the body a little: feels like a heavy camera operator
    const target = new THREE.Vector3(player.pos.x, player.visualY + eye + 0.6 * fly * hs1, player.pos.z);     // carried: between him and the bird
    if (this.focus.lengthSq() === 0) this.focus.copy(target);
    const follow = (player.dashFov || 0) > 0.5 || fly > 0.3 ? 16 : 9;           // the tackle's dash, or a flight: keep up with him
    this.focus.x = damp(this.focus.x, target.x, follow, dt);
    this.focus.z = damp(this.focus.z, target.z, follow, dt);
    this.focus.y = damp(this.focus.y, target.y, fly > 0.3 ? 12 : 5, dt);

    // gameplay arm
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const shoulder = 0.55 * Math.min(1, this.dist / 3.6) + 0.6 * zoom;
    const gp = this.focus.clone().addScaledVector(back, arm).addScaledVector(right, shoulder);
    gp.y += this.pull * 0.3 + far * 1.6;
    const gl = this.focus.clone().addScaledVector(right, shoulder * 0.85).add(new THREE.Vector3(0, -0.05, 0));

    // menu orbit: slow drift around the nomad, sun behind them
    this.menuT += dt;
    const a = player.heading + Math.PI * 0.82 + Math.sin(this.menuT * 0.05) * 0.5;
    const mr = 4.2 + Math.sin(this.menuT * 0.07) * 0.6;
    const mp = new THREE.Vector3(player.pos.x + Math.sin(a) * mr, player.visualY + (1.25 + Math.sin(this.menuT * 0.09) * 0.25) * hs1, player.pos.z + Math.cos(a) * mr);
    const ml = new THREE.Vector3(player.pos.x, player.visualY + 1.2 * hs1, player.pos.z);
    // push the look point sideways so the nomad sits left of centre, toward the menu text's other side
    const side = new THREE.Vector3().subVectors(ml, mp).normalize().cross(new THREE.Vector3(0, 1, 0));
    ml.addScaledVector(side, -1.1);

    const b = this.blend * this.blend * (3 - 2 * this.blend);
    this._pos.lerpVectors(mp, gp, b);
    this._look.lerpVectors(ml, gl, b);

    // a trunk between the nomad and the camera: the arm shortens to stop in front of it (quickly in, slowly out),
    // rather than put the lens inside the tree. It is walked from the nomad himself, who is never inside a trunk,
    // and not from the look point, which sits off his shoulder and can be.
    let free = 1;
    if (this.obstacles) {
      for (let i = 1; i <= 12 && free === 1; i++) {
        const t = i / 12, x = THREE.MathUtils.lerp(player.pos.x, this._pos.x, t), z = THREE.MathUtils.lerp(player.pos.z, this._pos.z, t);
        const y = THREE.MathUtils.lerp(this._look.y, this._pos.y, t);
        for (const c of this.obstacles) {
          const dx = x - c.x, dz = z - c.z, r = c.r + 0.25;
          if (dx * dx + dz * dz < r * r && y < groundY(c.x, c.z) + c.h) { free = (i - 1) / 12; break; }
        }
      }
    }
    this.clip = damp(this.clip, free, free < this.clip ? 16 : 2.5, dt);
    if (this.clip < 0.999) this._pos.lerpVectors(this._look, this._pos, Math.max(0.3, this.clip));

    // keep above ground along the arm
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const x = THREE.MathUtils.lerp(this._look.x, this._pos.x, t), z = THREE.MathUtils.lerp(this._look.z, this._pos.z, t);
      const minY = groundY(x, z) + 0.35 + player.snowTop * 0.9;
      const y = THREE.MathUtils.lerp(this._look.y, this._pos.y, t);
      if (y < minY) this._pos.y += (minY - y) / t;
    }
    if (roof != null && this._pos.y > roof - 0.3) this._pos.y = roof - 0.3;
    // and in front of any wall between him and the lens
    let reach = 1;
    const L = this._look, Q = this._pos, len = Math.hypot(Q.x - L.x, Q.z - L.z) + 1e-6;
    for (const c of this.blockers) {
      const mx = (L.x + Q.x) / 2 - c.x, mz = (L.z + Q.z) / 2 - c.z, near = c.r + len / 2 + 0.5;
      if (mx * mx + mz * mz > near * near) continue;
      const t = enters(c, L.x, L.z, Q.x, Q.z, 0.3);
      if (t >= reach) continue;
      if (L.y + (Q.y - L.y) * t > groundY(c.x, c.z) + c.h) continue;       // over the roof
      reach = Math.max(0.08, t - 0.1 / len);
    }
    this.reach = reach < this.reach ? reach : damp(this.reach, reach, 2.5, dt);
    if (this.reach < 0.999) this._pos.lerpVectors(L, Q, this.reach);

    cam.position.copy(this._pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.05, t = performance.now() * 0.03;
      cam.position.x += Math.sin(t * 1.3) * s; cam.position.y += Math.sin(t * 1.7 + 1) * s;
    }
    cam.lookAt(this._look);
    // in flight the lens widens with speed: about 9 degrees at a cruise, 20 flat out, 26 in the fastest dive
    const flyFov = fly * clamp((spd - 5) * 0.85, 0, 26);
    const fovT = inMenu ? 42 : 52 + 2 * run + 3 * sprint + (player.state === 'dive' ? 4 : 0) + (player.state === 'tackle' ? 4 : 0) + (player.dashFov || 0) + 10 * far - 26 * zoom + flyFov;      // the bow zooms in
    this.fov = damp(this.fov, fovT, zoom > 0.02 || far > 0.02 || this.fov < 50 || (player.dashFov || 0) > 0.5 ? 7 : fly > 0.02 ? 4 : 1.5, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  // camera-relative movement basis
  basis() {
    return { fx: -Math.sin(this.yaw), fz: -Math.cos(this.yaw), rx: Math.cos(this.yaw), rz: -Math.sin(this.yaw) };
  }
}
