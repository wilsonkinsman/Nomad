// Third-person camera: over-the-shoulder spring arm with lag, terrain avoidance, a slow pull-back
// and wider lens while running,
// plus a slow cinematic orbit for the title screen.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, damp, smoothstep } from './util.js';

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
    this.blend = 0;           // 0 = menu orbit, 1 = gameplay
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  update(dt, player, input, inMenu) {
    const cam = this.cam;
    // look input
    if (!inMenu) {
      const sens = 0.0022;
      this.yaw -= input.lookX * sens;
      this.pitch += input.lookY * sens;
      if (input.pad.active) { this.yaw -= input.pad.lx * 2.6 * dt; this.pitch += input.pad.ly * 1.8 * dt; }
      this.pitch = clamp(this.pitch, -0.5, 1.1);
      this.distTarget = clamp(this.distTarget + input.wheel * 0.4, 1.8, 7);
    }
    this.blend = damp(this.blend, inMenu ? 0 : 1, 1.6, dt);
    this.dist = damp(this.dist, this.distTarget, 6, dt);
    // running eases the camera back and up to show more of the land ahead; stopping brings it in
    const hs = player.state === 'ground' ? Math.hypot(player.vel.x, player.vel.z) : 0;
    const run = smoothstep(2.2, 3.4, hs), sprint = smoothstep(4.4, 6.2, hs);
    const pullT = inMenu ? 0 : 1.0 * run + 0.5 * sprint;
    this.pull = damp(this.pull, pullT, pullT > this.pull ? 0.9 : 1.4, dt);
    const eye = player.model.camHeight ?? 1.48, hs1 = eye / 1.48;     // shorter characters: lower, closer camera
    const arm = (this.dist + this.pull) * Math.sqrt(hs1);

    // focus trails the body a little: feels like a heavy camera operator
    const target = new THREE.Vector3(player.pos.x, player.visualY + eye, player.pos.z);
    if (this.focus.lengthSq() === 0) this.focus.copy(target);
    this.focus.x = damp(this.focus.x, target.x, 9, dt);
    this.focus.z = damp(this.focus.z, target.z, 9, dt);
    this.focus.y = damp(this.focus.y, target.y, 5, dt);

    // gameplay arm
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const back = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const shoulder = 0.55 * Math.min(1, this.dist / 3.6);
    const gp = this.focus.clone().addScaledVector(back, arm).addScaledVector(right, shoulder);
    gp.y += this.pull * 0.3;
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

    // keep above ground along the arm
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const x = THREE.MathUtils.lerp(this._look.x, this._pos.x, t), z = THREE.MathUtils.lerp(this._look.z, this._pos.z, t);
      const minY = groundY(x, z) + 0.35 + player.snowTop * 0.9;
      const y = THREE.MathUtils.lerp(this._look.y, this._pos.y, t);
      if (y < minY) this._pos.y += (minY - y) / t;
    }

    cam.position.copy(this._pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.05, t = performance.now() * 0.03;
      cam.position.x += Math.sin(t * 1.3) * s; cam.position.y += Math.sin(t * 1.7 + 1) * s;
    }
    cam.lookAt(this._look);
    const fovT = inMenu ? 42 : 52 + 2 * run + 3 * sprint + (player.state === 'dive' ? 4 : 0);
    this.fov = damp(this.fov, fovT, 1.5, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  // camera-relative movement basis
  basis() {
    return { fx: -Math.sin(this.yaw), fz: -Math.cos(this.yaw), rx: Math.cos(this.yaw), rz: -Math.sin(this.yaw) };
  }
}
