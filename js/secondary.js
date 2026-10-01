// Secondary motion for the Atsu model: extra bones grafted onto the GLB skeleton.
// - Ponytail: a 4-bone chain simulated as a rope (gravity, inertia, a weak memory of its combed
//   shape), kept outside the skull and the back of the neck.
// - Kimono sleeve pouches: one spring bone per sleeve that lags behind the arm, overshoots and
//   settles, so the wide sleeves swing as the arms pump.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

function smooth01(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// rebuild a mesh's skeleton with extra bones: old inverse-bind matrices are kept exactly, the new
// bones take theirs from the current (bind) pose
function extendSkeleton(mesh, extra) {
  const old = mesh.skeleton;
  const bones = old.bones.concat(extra);
  const inv = old.boneInverses.map((m) => m.clone()).concat(extra.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert()));
  mesh.bind(new THREE.Skeleton(bones, inv), mesh.bindMatrix);
  return old.bones.length;
}

// blend extra influences into one vertex, keeping the 4 strongest
function reweight(mesh, i, adds) {
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const tot = adds.reduce((s, a) => s + a[1], 0);
  const list = [];
  for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k) * (1 - tot); if (w > 1e-4) list.push([si.getComponent(i, k), w]); }
  for (const a of adds) if (a[1] > 1e-4) list.push(a);
  list.sort((x, y) => y[1] - x[1]);
  const top = list.slice(0, 4), sum = top.reduce((s, a) => s + a[1], 0) || 1;
  for (let k = 0; k < 4; k++) {
    si.setComponent(i, k, top[k] ? top[k][0] : 0);
    sw.setComponent(i, k, top[k] ? top[k][1] / sum : 0);
  }
  si.needsUpdate = sw.needsUpdate = true;
}

export class Secondary {
  // model: AtsuModel (needs .scene, .g bones, .bindPos/.bindW maps, .group), built in bind pose
  constructor(model) {
    this.M = model;
    let hair = null, kimono = null;
    model.scene.traverse((o) => {
      if (o.isSkinnedMesh && o.material.name === 'Hair') hair = o;
      if (o.isSkinnedMesh && o.material.name === 'Kimono') kimono = o;
    });
    model.scene.updateMatrixWorld(true);
    this.sleeves = [];
    if (hair) this.buildPonytail(hair);
    if (kimono) for (const side of ['Left', 'Right']) this.buildSleeve(kimono, side);
  }

  // bind-pose helpers in character space
  bp(b) { return this.M.bindPos.get(b); }
  bq(b) { return this.M.bindW.get(b); }
  toLocalOf(bone, p) { return p.clone().sub(this.bp(bone)).applyQuaternion(_q.copy(this.bq(bone)).invert()); }

  buildPonytail(mesh) {
    const M = this.M, pos = mesh.geometry.attributes.position;
    // centreline of the tail from the tie at the back of the head down to the tip
    const ys = [1.465, 1.4, 1.335, 1.27, 1.215];
    const pts = ys.map((y) => {
      let x = 0, z = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) < -0.04 && Math.abs(pos.getY(i) - y) < 0.03) { x += pos.getX(i); z += pos.getZ(i); n++; }
      }
      return n ? new THREE.Vector3(x / n, y, z / n) : new THREE.Vector3(0, y, -0.1);
    });
    const head = M.g.Head;
    const bones = [];
    let parent = head, ppos = this.bp(head), pq = this.bq(head).clone();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Bone(); b.name = 'tail' + i;
      // bind: no rotation in character space, sitting on the centreline
      b.position.copy(pts[i]).sub(ppos).applyQuaternion(_q.copy(pq).invert());
      b.quaternion.copy(pq).invert();
      parent.add(b); bones.push(b);
      parent = b; ppos = pts[i]; pq = new THREE.Quaternion();
    }
    M.scene.updateMatrixWorld(true);
    const base = extendSkeleton(mesh, bones);
    const span = pts[0].y - pts[4].y;
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i), vz = pos.getZ(i);
      if (vz > -0.035 || vy > pts[0].y + 0.02) continue;
      const s = (pts[0].y - vy) / span * 4;                  // 0 at the tie, 4 at the tip
      const w = smooth01(-0.15, 0.55, s);
      const f = Math.min(3, Math.max(0, s - 0.5)), i0 = Math.min(3, Math.floor(f)), i1 = Math.min(3, i0 + 1), t = f - i0;
      reweight(mesh, i, i0 === i1 ? [[base + i0, w]] : [[base + i0, w * (1 - t)], [base + i1, w * t]]);
    }
    this.tail = {
      bones,
      restLocal: pts.map((p) => this.toLocalOf(head, p)),
      len: pts.slice(1).map((p, i) => p.distanceTo(pts[i])),
      dirs: pts.slice(1).map((p, i) => p.clone().sub(pts[i]).normalize()),
      p: pts.map((p) => p.clone()), o: pts.map((p) => p.clone()), init: false,
    };
  }

  buildSleeve(mesh, side) {
    const M = this.M, pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
    const arm = M.g[side + 'Arm'], fore = M.g[side + 'ForeArm'], hand = M.g[side + 'Hand'];
    const armIdx = new Set([mesh.skeleton.bones.indexOf(arm), mesh.skeleton.bones.indexOf(fore)]);
    const sh = this.bp(arm), el = this.bp(fore), wr = this.bp(hand);
    const b = new THREE.Bone(); b.name = 'sleeve' + side;
    b.position.copy(this.toLocalOf(fore, el));
    b.quaternion.copy(this.bq(fore)).invert();
    fore.add(b);
    M.scene.updateMatrixWorld(true);
    const base = extendSkeleton(mesh, [b]);
    const closestY = (p) => {
      let best = 0, bd = 1e9;
      for (const [a, c] of [[sh, el], [el, wr]]) {
        _a.subVectors(c, a);
        const t = Math.min(1, Math.max(0, _b.subVectors(p, a).dot(_a) / _a.lengthSq()));
        _c.copy(a).addScaledVector(_a, t);
        const d = _c.distanceTo(p);
        if (d < bd) { bd = d; best = _c.y; }
      }
      return best;
    };
    const v = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      let dom = -1, dw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > dw) { dw = w; dom = si.getComponent(i, k); } }
      if (!armIdx.has(dom)) continue;
      v.fromBufferAttribute(pos, i);
      const w = smooth01(0.025, 0.15, closestY(v) - v.y) * 0.95;   // how far the pouch hangs under the arm
      if (w > 0.01) { reweight(mesh, i, [[base, w]]); n++; }
    }
    this.sleeves.push({
      bone: b, parent: fore, bind: b.quaternion.clone(),
      restDir: new THREE.Vector3(0, -1, 0).applyQuaternion(_q.copy(this.bq(fore)).invert()),   // straight down at bind, in the forearm's frame
      len: 0.16, bob: null, vel: new THREE.Vector3(), verts: n,
    });
  }

  // after the pose is applied and world matrices are fresh
  update(dt) {
    if (dt <= 0) return;
    const M = this.M;
    const gInv = _m.copy(M.group.matrixWorld).invert();
    const gQ = new THREE.Quaternion(); M.group.getWorldQuaternion(gQ);
    const T = this.tail;
    if (T) {
      const head = M.g.Head;
      const hm = head.matrixWorld;
      const attach = new THREE.Vector3().copy(T.restLocal[0]).applyMatrix4(hm);
      if (!T.init || T.p[0].distanceTo(attach) > 1) {
        for (let i = 0; i < 5; i++) { T.p[i].copy(T.restLocal[i]).applyMatrix4(hm); T.o[i].copy(T.p[i]); }
        T.init = true;
      }
      const n = Math.max(1, Math.ceil(dt * 90)), h = dt / n;
      const neck = new THREE.Vector3().setFromMatrixPosition(M.g.Neck.matrixWorld);
      const back = new THREE.Vector3().setFromMatrixPosition(M.g.Spine1.matrixWorld);
      const skull = M.wp('Head', [0, 0.09, 0.01]);
      for (let s = 0; s < n; s++) {
        T.p[0].copy(attach); T.o[0].copy(attach);
        for (let i = 1; i < 5; i++) {
          const p = T.p[i], o = T.o[i];
          const vx = (p.x - o.x) * 0.93, vy = (p.y - o.y) * 0.93, vz = (p.z - o.z) * 0.93;
          o.copy(p);
          _b.copy(T.restLocal[i]).applyMatrix4(hm);      // where it would hang if combed stiff
          p.x += vx + (_b.x - p.x) * 0.012;
          p.y += vy - 11 * h * h + (_b.y - p.y) * 0.012;
          p.z += vz + (_b.z - p.z) * 0.012;
        }
        for (let it = 0; it < 4; it++) {
          for (let i = 0; i < 4; i++) {
            const a = T.p[i], c = T.p[i + 1];
            _c.subVectors(c, a);
            const d = _c.length() || 1e-6, k = (d - T.len[i]) / d;
            if (i === 0) c.addScaledVector(_c, -k); else { a.addScaledVector(_c, k * 0.5); c.addScaledVector(_c, -k * 0.5); }
          }
          for (let i = 1; i < 5; i++) {
            const p = T.p[i];
            _c.subVectors(p, skull); let d = _c.length();
            if (d < 0.115) p.copy(skull).addScaledVector(_c, 0.115 / (d || 1));
            _a.subVectors(back, neck);
            const t = Math.min(1, Math.max(0, _b.subVectors(p, neck).dot(_a) / _a.lengthSq()));
            _b.copy(neck).addScaledVector(_a, t); _c.subVectors(p, _b); d = _c.length();
            if (d < 0.1) p.copy(_b).addScaledVector(_c, 0.1 / (d || 1));
          }
        }
      }
      // each chain bone points from its particle to the next (character space)
      const headQ = new THREE.Quaternion(); head.getWorldQuaternion(headQ);
      let parentQ = gQ.clone().invert().multiply(headQ);
      for (let i = 0; i < 4; i++) {
        _a.subVectors(T.p[i + 1], T.p[i]).transformDirection(gInv);
        const W = new THREE.Quaternion().setFromUnitVectors(T.dirs[i], _a);
        T.bones[i].quaternion.copy(parentQ.clone().invert().multiply(W));
        parentQ = W;
      }
    }
    for (const S of this.sleeves) {
      const anchor = new THREE.Vector3().setFromMatrixPosition(S.bone.matrixWorld);
      const pq = new THREE.Quaternion(); S.parent.getWorldQuaternion(pq);
      const target = _b.copy(S.restDir).applyQuaternion(pq).multiplyScalar(S.len).add(anchor);
      if (!S.bob || S.bob.distanceTo(target) > 0.5) { S.bob = target.clone(); S.vel.set(0, 0, 0); }
      // stiff and close to critically damped: the sleeves follow the arms with a little weight, no bounce
      const k = 220, c = 26, n = Math.ceil(dt / 0.01), h = dt / n;
      for (let i = 0; i < n; i++) {
        S.vel.x += ((target.x - S.bob.x) * k - S.vel.x * c) * h;
        S.vel.y += ((target.y - S.bob.y) * k - S.vel.y * c - 2) * h;
        S.vel.z += ((target.z - S.bob.z) * k - S.vel.z * c) * h;
        S.bob.addScaledVector(S.vel, h);
      }
      _c.subVectors(S.bob, anchor).setLength(S.len);
      S.bob.copy(anchor).add(_c);
      // swing the rigid pouch direction onto the simulated one, in the forearm's frame
      const cur = _c.clone().applyQuaternion(pq.clone().invert()).normalize();
      S.bone.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(S.restDir, cur)).multiply(S.bind);
    }
  }
}
