// The bow. B takes it out (the sword goes away); hold the attack button to draw: the camera zooms in and
// the look slows, the string comes back to his chin as the charge builds, and at full charge the whole
// screen trembles. Let go to loose the arrow: it goes where the crosshair is, with gravity worked out for
// you, and does more the longer you held. It hits the dummy and the practice enemy and sticks in them.
//
// The arms are solved in AtsuModel.aimIK (the left arm reaches along the aim carrying the bow, the right hand
// brings the string back); this file owns the state, the bow and arrow meshes and the flight of the arrows.
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, damp, dampAngle, wrapAngle } from './util.js';

const CHARGE_TIME = 1.1, MIN_DRAW = 0.14, GRAVITY = 9.5;
const LIMB = 0.4, SAG = 0.14;                       // half the bow's height; how far its tips curve toward the archer
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function buildBow() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 }), grip = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.9 });
  const pts = []; for (let i = -10; i <= 10; i++) { const y = i / 10 * LIMB; pts.push(new THREE.Vector3(0, y, -SAG * (y / LIMB) ** 2)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const limbs = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.014, 6, false), wood); limbs.castShadow = true; g.add(limbs);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 8), grip); wrap.castShadow = true; g.add(wrap);
  for (const s of [-1, 1]) { const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), wood); tip.position.set(0, s * LIMB, -SAG); g.add(tip); }
  // the string: tip, nock, tip
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xe8e0c8 })); string.frustumCulled = false; g.add(string);
  g.userData.string = string;
  return g;
}
function buildArrow(glow = 0) {
  const g = new THREE.Group();
  const shaft = new THREE.MeshStandardMaterial({ color: 0xb08a55, roughness: 0.8 });
  const head = new THREE.MeshStandardMaterial({ color: 0xcfd6dc, metalness: 0.7, roughness: 0.3, emissive: 0xffc060, emissiveIntensity: glow });
  const fl = new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.9, side: THREE.DoubleSide });
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.55, 5).rotateX(Math.PI / 2).translate(0, 0, 0.275), shaft);
  const h = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 6).rotateX(Math.PI / 2).translate(0, 0, 0.585), head);
  g.add(s, h);
  for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.028).translate(0.05, 0, 0).rotateY(Math.PI / 2).translate(0, 0, 0.06), fl); f.rotation.z = k * Math.PI * 2 / 3; g.add(f); }
  for (const m of g.children) m.castShadow = true;
  g.userData.head = head;
  return g;
}

export class Bow {
  constructor(game) {
    this.game = game;
    this.equipped = false; this.aiming = false; this.charge = 0; this.zoom = 0; this.cool = 0; this.full = false;
    this.moveScale = 1;
    this.mesh = buildBow(); this.mesh.visible = false;
    this.nocked = buildArrow(); this.nocked.visible = false; this.mesh.add(this.nocked);
    this.attached = null;                       // the model whose scene the bow is parented to
    this.arrows = [];
    this.state = { w: 0, yaw: 0, pitch: 0, charge: 0 };
    this.wPrev = 0;
  }

  setEquipped(on) {
    const G = this.game, P = G.player;
    if (on && !P.model.aimFrameReady) { G.hud?.hint('The bow needs the ronin or Atsu', 2.5); return; }
    this.equipped = on;
    if (on) { P.weapon?.reset(); G.hud?.hint('Hold click to draw  ·  release to shoot  ·  B puts it away', 4); }
    else { this.aiming = false; this.charge = 0; }
    G.audio?.sword(on ? 'draw' : 'sheathe');
  }

  update(dt, game) {
    const P = game.player, input = game.input, cam = game.camera;
    // follow the character: the bow lives inside the model's scene so it moves with him exactly
    const model = P.model, host = model.scene || null;
    if (this.attached !== host) {
      this.mesh.parent?.remove(this.mesh);
      if (host) host.add(this.mesh);
      this.attached = host;
      if (this.equipped && !model.aimFrameReady) this.equipped = false;
    }
    const inPlay = game.state === 'play';
    if (inPlay && input.bowKey()) this.setEquipped(!this.equipped);
    this.cool = Math.max(0, this.cool - dt);
    const can = this.equipped && inPlay && P.state === 'ground' && P.grounded;
    const holding = can && input.attackHeld() && this.cool <= 0;
    if (holding && !this.aiming) { this.aiming = true; this.charge = 0; this.full = false; game.audio?.bow('draw'); }
    if (this.aiming) {
      if (holding) {
        this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
        if (this.charge >= 1) {
          if (!this.full) { this.full = true; game.audio?.bow('full'); }
          game.rig.shake = Math.max(game.rig.shake, 0.5);       // at full draw the screen trembles
        }
      } else {
        if (can && this.charge >= MIN_DRAW) this.shoot(this.charge);
        this.aiming = false; this.charge = 0; this.full = false;
        this.cool = 0.25;
      }
    }
    this.moveScale = this.aiming ? 0.45 : 1;
    // the camera zooms in as he draws
    const zt = this.aiming ? 0.55 + 0.45 * this.charge : 0;
    this.zoom = damp(this.zoom, zt, this.aiming ? 7 : 9, dt);
    P.aimZoom = this.zoom;
    game.hud?.setCrosshair(this.equipped && this.zoom > 0.2, this.charge);
    // the pose he is asked to take (applied by the animator on the next frame)
    const w = damp(this.wPrev, this.aiming ? 1 : 0, this.aiming ? 12 : 9, dt); this.wPrev = w;
    if (this.aiming) {
      const d = cam.getWorldDirection(_v);
      const yaw = Math.atan2(d.x, d.z);
      P.heading = dampAngle(P.heading, yaw, 14, dt);
      this.state.yaw = wrapAngle(yaw - P.heading); this.state.pitch = Math.asin(clamp(d.y, -0.95, 0.95));
    }
    this.state.w = this.equipped ? w : 0; this.state.charge = this.charge;
    P.aimState = this.equipped && w > 0.002 ? this.state : null;
    // the meshes
    this.place(w);
    for (let i = this.arrows.length - 1; i >= 0; i--) if (!this.flyArrow(this.arrows[i], dt)) this.arrows.splice(i, 1);
  }

  // the bow: held at his side when idle, out along the aim when drawn; the string follows his right hand
  place(w) {
    const m = this.mesh, P = this.game.player.model;
    m.visible = this.equipped && !!P.scene;
    if (!m.visible) return;
    const F = P.aimFrame;
    // at rest: in his left hand, upright
    const inv = new THREE.Matrix4().copy(P.scene.matrixWorld).invert();
    const hand = _w.setFromMatrixPosition(P.g.LeftHand.matrixWorld).applyMatrix4(inv);
    const rest = new THREE.Vector3(hand.x + 0.03, hand.y + 0.06, hand.z + 0.08);
    if (w > 0.002 && F) {
      m.position.copy(rest).lerp(F.G, w);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.s, F.u, F.a));
      m.quaternion.identity().slerp(q, w);
    } else { m.position.copy(rest); m.quaternion.identity(); }
    // string: tips, and the nock back by the draw
    const back = 0.08 + 0.2 * this.charge * w, p = m.userData.string.geometry.attributes.position;
    p.setXYZ(0, 0, LIMB, -SAG); p.setXYZ(1, 0, 0, -SAG - back * (w > 0.002 ? 1 : 0.0) - 0.0); p.setXYZ(2, 0, -LIMB, -SAG); p.needsUpdate = true;
    this.nocked.visible = this.aiming;
    if (this.aiming) { this.nocked.position.set(0, 0, -SAG - back); this.nocked.userData.head.emissiveIntensity = this.full ? 1.6 : 0; }
  }

  // where the arrow should go: the first thing the crosshair is on, else far off
  aimPoint(out) {
    const G = this.game, cam = G.camera, d = cam.getWorldDirection(new THREE.Vector3()), o = cam.position;
    for (let s = 2; s < 90; s += 0.4) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (y < groundY(x, z)) return out.set(x, y, z);
      for (const c of G.enemies?.targets || []) if (!c.dead) {
        const gy = groundY(c.x, c.z);
        if (Math.hypot(x - c.x, z - c.z) < c.r + 0.1 && y > gy && y < gy + (c.y1 || 1.9)) return out.set(x, y, z);
      }
    }
    return out.set(o.x + d.x * 90, o.y + d.y * 90, o.z + d.z * 90);
  }

  shoot(c) {
    const G = this.game, F = G.player.model.aimFrame, scene = G.player.model.scene;
    if (!F) return;
    // start at the front of the bow, in the world
    const start = F.G.clone().addScaledVector(F.a, 0.15).applyMatrix4(scene.matrixWorld);
    const target = this.aimPoint(new THREE.Vector3());
    const speed = 30 + 42 * c, dist = start.distanceTo(target), t = dist / speed;
    target.y += 0.5 * GRAVITY * t * t * 0.9;                   // aim a little high: the arrow will fall onto the mark
    const dir = target.sub(start).normalize();
    const mesh = buildArrow(c >= 1 ? 1.6 : 0); mesh.position.copy(start); mesh.lookAt(start.clone().add(dir));
    G.scene.add(mesh);
    this.arrows.push({ mesh, pos: start.clone(), vel: dir.multiplyScalar(speed), charge: c, life: 6, stuck: false, age: 0 });
    G.audio?.bow('release', c);
    G.rig.shake = Math.max(G.rig.shake, 0.15 + 0.3 * c);
    for (let i = 0; i < 4; i++) G.particles.emit('dust', start.x, start.y, start.z, dir.x, 0.2, dir.z, 0.5, 1);
  }

  // one arrow for one frame; false when it is finished with
  flyArrow(a, dt) {
    const G = this.game;
    a.age += dt;
    if (a.stuck) {
      a.life -= dt;
      if (a.life < 1 && !a.parent) a.mesh.scale.setScalar(Math.max(0.001, a.life));
      if (a.life <= 0) { (a.mesh.parent || G.scene).remove(a.mesh); return false; }
      return true;
    }
    const steps = Math.max(1, Math.ceil(a.vel.length() * dt / 0.4)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      a.vel.y -= GRAVITY * h;
      a.pos.addScaledVector(a.vel, h);
      const gy = groundY(a.pos.x, a.pos.z);
      // things that take damage
      for (const c of G.enemies?.targets || []) {
        if (c.dead) continue;
        const cy = groundY(c.x, c.z);
        if (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < c.r && a.pos.y > cy && a.pos.y < cy + (c.y1 || 1.9)) { this.hit(a, c, a.pos.y - cy); return true; }
      }
      // trees, rocks, posts
      for (const L of [G.trees?.colliders, G.props?.colliders]) if (L) for (const c of L) {
        const dx = a.pos.x - c.x, dz = a.pos.z - c.z;
        if (dx * dx + dz * dz < c.r * c.r && a.pos.y < gy + 4) { this.stick(a, null); return true; }
      }
      if (a.pos.y <= gy) { a.pos.y = gy; this.stick(a, null); G.particles.emit('dust', a.pos.x, gy + 0.05, a.pos.z, 0, 0.5, 0, 0.8, 4); return true; }
    }
    a.mesh.position.copy(a.pos);
    if (a.vel.lengthSq() > 1) a.mesh.lookAt(_v.copy(a.pos).add(a.vel));
    if ((a.life -= dt) <= 0) { G.scene.remove(a.mesh); return false; }
    return true;
  }
  stick(a, host) {
    a.stuck = true; a.life = host ? 5 : 8; a.parent = host;
    a.mesh.position.copy(a.pos);
    this.game.audio?.bow('stick');
  }
  hit(a, c, height) {
    const G = this.game, head = height > 1.6;
    let dmg = Math.round(6 + 34 * a.charge * a.charge);
    if (head) dmg = Math.round(dmg * 1.5);
    c.onHit?.('arrow', dmg, a.vel.x, a.vel.z);
    if (head) G.hud?.floatText(new THREE.Vector3(c.x, groundY(c.x, c.z) + 2.5, c.z), 'HEADSHOT', 'gold word');
    G.audio?.bow('hit'); G.rig.shake = Math.max(G.rig.shake, 0.18);
    for (let i = 0; i < 6; i++) G.particles.emit('dust', a.pos.x, a.pos.y, a.pos.z, -a.vel.x * 0.04, 0.8, -a.vel.z * 0.04, 1.2, 1);
    // it stays in what it hit, and moves with it
    const host = (c.dummy && c.dummy.tilt) || (c.enemy && c.enemy.group) || null;
    if (host) { host.add(a.mesh); a.mesh.position.copy(host.worldToLocal(a.pos.clone())); a.mesh.quaternion.copy(host.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(a.mesh.quaternion)); }
    this.stick(a, host);
  }
}
