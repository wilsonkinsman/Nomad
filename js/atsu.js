// A rigged GLB character driven by the same procedural animation as the old nomad: Atsu (MPFB
// body, kimono, hakama, katana, bow, a bandana built at load in bandana.js) or the frog ronin
// (painted and rigged from a sculpt; see BACKLOG.md). Atsu-only pieces switch themselves off when
// their meshes aren't there; `opts.ribbons` turns off the obi and cord tails.
//
// Retargeting: the animation describes rotations for a simple skeleton whose bind pose has every
// bone at identity, arms hanging. For each mapped bone we build its character-space rotation
//   W_anim = W_anim(parent) * R_anim
// and give the GLB bone   W = W_anim * Rest * Bind,
// where Bind is the GLB bone's own bind rotation and Rest swings its bind direction (A-pose arms)
// onto the direction the animation skeleton expects. Unmapped bones (Spine1, fingers, toes) keep
// their bind rotation relative to their parent.
import * as THREE from 'three';
import { BONES, LEG, J, PARENT, END } from './nomad.js';
import { Cloth } from './cloth.js';
import { Secondary } from './secondary.js';
import { buildBandana } from './bandana.js';
import { SwordRig } from './sword.js';

const MAP = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head',
  shoulder_L: 'LeftShoulder', upperarm_L: 'LeftArm', forearm_L: 'LeftForeArm', hand_L: 'LeftHand',
  thigh_L: 'LeftUpLeg', shin_L: 'LeftLeg', foot_L: 'LeftFoot',
  shoulder_R: 'RightShoulder', upperarm_R: 'RightArm', forearm_R: 'RightForeArm', hand_R: 'RightHand',
  thigh_R: 'RightUpLeg', shin_R: 'RightLeg', foot_R: 'RightFoot',
};
// where each animation bone points to, on the GLB skeleton
const END_G = { handEnd_L: 'LeftHandMiddle1', handEnd_R: 'RightHandMiddle1', toe_L: 'LeftToeBase', toe_R: 'RightToeBase' };

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

export class AtsuModel {
  // opts: { ribbons: true, keepSplay: false (keep the model's own sideways limb angles), camHeight,
  //         sword: { ... } (build the drawable sword; see sword.js) }
  constructor(gltf, tx = null, opts = {}) {
    this.opts = opts;
    this.camHeight = opts.camHeight ?? 1.48;     // where the camera aims, above the feet
    this.animStyle = opts.style || {};            // per-character gait tweaks read by anim.js
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.pivot); this.pivot.add(this.body);
    this.scene = gltf.scene;
    this.body.add(this.scene);

    // the ronin's sword comes as three parts: the sheathed sword on his back (a skinned mesh, hidden
    // while he holds the blade) and a loose hilt that sword.js carries to his hand
    this.hiltMesh = this.scene.getObjectByName('Ronin_Hilt') || null;
    if (this.hiltMesh) this.hiltMesh.parent.remove(this.hiltMesh);
    this.backSword = this.scene.getObjectByName('Ronin_Sword') || null;

    // no hat: the kasa and its chin cord come off
    const drop = [];
    this.scene.traverse((o) => { if (o.isMesh && /Kasa/i.test(o.name + ' ' + (o.material?.name || ''))) drop.push(o); });
    for (const o of drop) o.parent.remove(o);
    // materials: cloth is two-sided, hair and lashes are alpha-cut, everything casts shadows
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const m = o.material;
      if (/Hair|Eyebrow|Eyelash/.test(m.name)) { m.alphaTest = 0.45; m.transparent = false; m.depthWrite = true; m.side = THREE.DoubleSide; }
      else if (/Kimono|Hakama|Obi|Kasa|Tabi|RedCord/.test(m.name)) m.side = THREE.DoubleSide;
      if (m.name === 'Juban') { m.color.setRGB(0.62, 0.58, 0.5); m.normalScale?.set(0.35, 0.35); m.roughness = 0.9; }
      if (m.name === 'Skin') { m.roughness = 0.6; }
      if (m.name === 'Eye') { m.roughness = 0.08; }
    });

    // bones by short name ("mixamorig:Hips" arrives sanitised as "mixamorigHips")
    this.g = {};
    this.scene.traverse((o) => { if (o.isBone) this.g[o.name.replace(/^mixamorig:?/, '')] = o; });
    this.order = [];
    this.scene.traverse((o) => { if (o.isBone) this.order.push(o); });
    this.scene.updateMatrixWorld(true);

    // bind data in character space (relative to the gltf scene, which sits at the body origin)
    const inv = new THREE.Matrix4().copy(this.scene.matrixWorld).invert();
    this.bindW = new Map(); this.bindLocalQ = new Map(); this.bindPos = new Map();
    for (const b of this.order) {
      const m = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(p, q, s);
      this.bindW.set(b, q); this.bindPos.set(b, p);
      this.bindLocalQ.set(b, b.quaternion.clone());
    }
    this.hipsBindLocal = this.g.Hips.position.clone();
    const P = (n) => this.bindPos.get(this.g[n]);

    // rest swing per mapped bone: GLB bind direction -> animation skeleton direction
    this.rest = {};
    for (const b of BONES) {
      const gb = this.g[MAP[b]];
      const endName = END[b];
      const gEnd = MAP[endName] ? this.g[MAP[endName]] : this.g[END_G[endName]];
      const mine = new THREE.Vector3(...J[endName]).sub(new THREE.Vector3(...J[b])).normalize();
      const theirs = gEnd ? this.bindPos.get(gEnd).clone().sub(this.bindPos.get(gb)).normalize() : mine.clone();
      // a squat, bow-legged character keeps its stance: only the forward/back and vertical parts of
      // each limb are swung onto the animation skeleton
      if (opts.keepSplay && /thigh|shin|foot|upperarm|forearm|hand/.test(b)) mine.set(theirs.x, mine.y, mine.z).normalize();
      // the torso chain keeps its own lean; only limbs are swung onto the animation's rest pose
      this.rest[b] = /hips|spine|chest|neck|head|shoulder/.test(b) ? new THREE.Quaternion() : new THREE.Quaternion().setFromUnitVectors(theirs, mine);
    }

    // leg lengths for the animation's foot-planting maths
    this.leg = { L1: P('LeftUpLeg').distanceTo(P('LeftLeg')), L2: P('LeftLeg').distanceTo(P('LeftFoot')), ankle: P('LeftFoot').y, hip: P('Hips').y };
    this.activate();
    this.pivotScale = P('Hips').y / 0.97;
    this.pivotY = 0.95 * this.pivotScale;
    this.pivot.position.y = this.pivotY; this.body.position.y = -this.pivotY;

    this.Wm = {}; for (const b of BONES) this.Wm[b] = new THREE.Quaternion();
    this.Wg = new Map();
    this._mid = new THREE.Quaternion();
    // finger joints, for a relaxed curl instead of flat, robotic hands
    this.fingers = [];
    for (const side of ['Left', 'Right']) for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (let j = 1; j <= 3; j++) {
      const b = this.g[side + 'Hand' + f + j]; if (b) this.fingers.push({ b, side, f, j });
    }
    this.curl = 0.55; this.curlAxis = { Left: new THREE.Vector3(0, 0, -1), Right: new THREE.Vector3(0, 0, 1) };   // measured: these bend toward the palm

    this.fixWaistWeights();

    this.colliders = [];
    this.cloths = [];
    this.clothGroup = new THREE.Group();
    this.group.updateMatrixWorld(true);
    this.secondary = new Secondary(this);      // ponytail rope and swinging sleeves
    this.bandana = buildBandana(this, tx);     // after the ponytail is rigged, so the wrap skips it
    this.swordRig = opts.sword && this.hiltMesh ? new SwordRig(this, opts.sword) : null;
    this.buildCloth();
  }

  activate() { Object.assign(LEG, this.leg); }

  // The obi, its cord and the hakama's front panel were auto-weighted in A-pose, where the hands
  // hang beside the hips, so they followed the forearms and thumbs (a few cord loops even followed
  // the head) and flapped about with every arm swing. Re-skin them at load from the garment
  // underneath: average of the nearest vertices, torso and leg bones only.
  fixWaistWeights() {
    const mesh = {};
    this.scene.traverse((o) => { if (o.isSkinnedMesh) mesh[o.name] = o; });
    const torso = /^(Hips|Spine|Spine1)$/, legs = /^(Hips|Spine|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg)$/;
    const jobs = [['Atsu_Obi', 'Atsu_Bodyf_kimono', torso], ['Atsu_Cord', 'Atsu_Bodyf_kimono', torso],
      ['Atsu_HakamaFront', 'Atsu_Bodygi1', legs]];
    for (const [t, r, keep] of jobs) if (mesh[t] && mesh[r]) reskin(mesh[t], mesh[r], keep, this.g.Hips);
  }

  // ---------------------------------------------------------------- pose
  applyPose(pose) {
    for (const b of BONES) {
      const r = pose.bones[b];
      _e.set(r[0], r[1], r[2], 'XYZ');
      _q.setFromEuler(_e);
      const par = PARENT[b];
      if (par) this.Wm[b].copy(this.Wm[par]).multiply(_q); else this.Wm[b].copy(_q);
    }
    const mappedOf = this._mappedOf || (this._mappedOf = new Map(Object.entries(MAP).map(([k, v]) => [this.g[v], k])));
    for (const g of this.order) {
      const parentW = g.parent && g.parent.isBone ? this.Wg.get(g.parent) : null;
      let W = this.Wg.get(g); if (!W) { W = new THREE.Quaternion(); this.Wg.set(g, W); }
      const b = mappedOf.get(g);
      if (g === this.g.Spine1) {
        // halfway between the spine and chest rotations, so the back bends along its length
        W.copy(this._mid.copy(this.Wm.spine).slerp(this.Wm.chest, 0.5)).multiply(this.bindW.get(g));
        g.quaternion.copy(_q2.copy(parentW).invert().multiply(W));
      } else if (b) {
        W.copy(this.Wm[b]).multiply(this.rest[b]).multiply(this.bindW.get(g));
        if (parentW) g.quaternion.copy(_q2.copy(parentW).invert().multiply(W));
        else g.quaternion.copy(W);       // the armature node sits at identity
      } else {
        g.quaternion.copy(this.bindLocalQ.get(g));
        if (parentW) W.copy(parentW).multiply(g.quaternion); else W.copy(g.quaternion);
      }
    }
    // fingers: bind pose plus a curl around each joint's bend axis, stronger at the knuckle
    const curl = pose.curl ?? this.curl;
    for (const F of this.fingers) {
      const k = F.f === 'Thumb' ? 0.35 : (F.j === 1 ? 0.75 : 1.0) * (1 + (F.f === 'Pinky' ? 0.15 : F.f === 'Index' ? -0.12 : 0));
      _q.setFromAxisAngle(this.curlAxis[F.side], curl * k);
      F.b.quaternion.copy(this.bindLocalQ.get(F.b)).multiply(_q);
    }
    const h = this.g.Hips;
    h.position.copy(this.hipsBindLocal);
    h.position.x += pose.hipsX || 0;
    h.position.y += (pose.hipsY || 0);
    h.position.z += pose.hipsZ || 0;
    this.pivotY = (pose.pivotY ?? 0.95) * this.pivotScale;
    this.pivot.position.y = this.pivotY; this.body.position.y = -this.pivotY;
    this.pivot.rotation.set(pose.pitch || 0, 0, pose.roll || 0);
  }

  // ---------------------------------------------------------------- body capsules (cloth + hitboxes)
  wp(name, off) {
    const b = this.g[name];
    return off ? _v.set(off[0], off[1], off[2]).applyMatrix4(b.matrixWorld).clone() : new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  }
  buildColliders() {
    const C = this.colliders; C.length = 0;
    const cap = (a, b, r, name) => C.push({ a, b, r, name });
    cap(this.wp('Hips'), this.wp('Spine2'), 0.15, 'torso');
    cap(this.wp('LeftShoulder'), this.wp('RightShoulder'), 0.09, 'shoulders');
    for (const [L, S] of [['L', 'Left'], ['R', 'Right']]) {
      cap(this.wp(S + 'UpLeg'), this.wp(S + 'Leg'), 0.11, 'thigh_' + L);
      cap(this.wp(S + 'Leg'), this.wp(S + 'Foot'), 0.09, 'shin_' + L);
      cap(this.wp(S + 'Foot'), this.wp(S + 'ToeBase'), 0.045, 'foot_' + L);
      cap(this.wp(S + 'Arm'), this.wp(S + 'ForeArm'), 0.08, 'arm_' + L);
      cap(this.wp(S + 'ForeArm'), this.wp(S + 'Hand'), 0.075, 'forearm_' + L);
    }
    // Blender bones point along their local +Y, so the skull centre is a little way up the head bone
    const c = this.wp('Head', [0, 0.09, 0.01]);
    cap(c, c.clone(), 0.12, 'head');
  }

  // ---------------------------------------------------------------- cloth: sash ends, cord and bandana tails
  buildCloth() {
    const fab = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide });
    const obiM = fab(0x141826), cordM = fab(0x7a1410, 0.6);
    const hipsInv = new THREE.Matrix4().copy(this.g.Hips.matrixWorld).invert();
    const local = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(hipsInv);
    // the obi knot sits at the small of the back; two sash ends hang from it
    for (const [sx, len] of this.opts.ribbons === false ? [] : [[-0.03, 8], [0.035, 7]]) {
      this.addRibbon({ rows: len, width: 0.055, step: 0.06, mat: obiM, wind: 1.0, thick: 0.02,
        a: local(sx - 0.028, 0.985, -0.155), b: local(sx + 0.028, 0.985, -0.155), drop: [0, -1, -0.08] });
    }
    // red cord tails from the knot at the left front of the obi
    for (const [sx, len] of this.opts.ribbons === false ? [] : [[0.11, 8], [0.125, 6]]) {
      this.addRibbon({ rows: len, width: 0.012, step: 0.05, mat: cordM, wind: 1.4, thick: 0.012,
        a: local(sx - 0.006, 0.96, 0.13), b: local(sx + 0.006, 0.96, 0.13), drop: [0.05, -1, 0.06] });
    }
    // two short tails from the bandana knot behind the left ear
    const B = this.bandana;
    if (B && this.opts.ribbons !== false) {
      const headInv = new THREE.Matrix4().copy(this.g.Head.matrixWorld).invert();
      for (const [s, len] of [[-1, 5], [1, 4]]) {
        const c = B.knot.clone().addScaledVector(B.side, s * 0.012).addScaledVector(B.out, 0.004).add(new THREE.Vector3(0, -0.008, 0));
        const half = B.side.clone().multiplyScalar(0.012);
        this.addRibbon({ rows: len, width: 0.024, step: 0.032, mat: B.mat, wind: 0.8, thick: 0.01, bone: this.g.Head,
          a: c.clone().sub(half).applyMatrix4(headInv), b: c.clone().add(half).applyMatrix4(headInv),
          drop: [B.out.x * 0.5 + B.side.x * s * 0.3, -1, B.out.z * 0.5 + B.side.z * s * 0.3] });
      }
    }
  }

  // a two-column strip of cloth pinned at its top edge to a bone (the hips unless o.bone)
  addRibbon(o) {
    const bone = o.bone || this.g.Hips;
    const A = o.a.clone().applyMatrix4(bone.matrixWorld), B = o.b.clone().applyMatrix4(bone.matrixWorld);
    const drop = new THREE.Vector3(...o.drop).normalize();
    const pins = [{ r: 0, c: 0, target: A.clone() }, { r: 0, c: 1, target: B.clone() }];
    const cloth = new Cloth({ rows: o.rows, cols: 2, mat: o.mat, pins, stiff: 1, shear: 0.8, bend: 0.25, wind: o.wind, thick: o.thick, gravity: -13, drag: 0.982,
      init: (r, c, out) => out.copy(c ? B : A).addScaledVector(drop, r * o.step), uvScale: [0.2, 0.8] });
    cloth.localPins = [o.a.clone(), o.b.clone()];
    cloth.bone = bone;
    this.cloths.push(cloth);
    this.clothGroup.add(cloth.mesh);
  }

  update(dt, wind, rolling = false, settle = 0) {
    this.group.updateMatrixWorld(true);
    this.secondary.update(dt);
    this.buildColliders();
    for (const c of this.cloths) {
      const bm = c.bone.matrixWorld;
      c.drag = rolling ? 0.962 : 0.982; c.gravity = -13 * (1 + 1.4 * settle);
      c.pins[0].target.copy(c.localPins[0]).applyMatrix4(bm);
      c.pins[1].target.copy(c.localPins[1]).applyMatrix4(bm);
      c.update(dt, wind, this.colliders, 4);
    }
  }

  footWorld(L, out = new THREE.Vector3()) {
    const f = this.g[L === 'L' ? 'LeftFoot' : 'RightFoot'], t = this.g[L === 'L' ? 'LeftToeBase' : 'RightToeBase'];
    const a = new THREE.Vector3().setFromMatrixPosition(f.matrixWorld), b = new THREE.Vector3().setFromMatrixPosition(t.matrixWorld);
    return out.copy(a).lerp(b, 0.4).add(new THREE.Vector3(0, -0.045, 0));
  }
  handWorld(L, out = new THREE.Vector3()) { return out.setFromMatrixPosition(this.g[L === 'L' ? 'LeftHandMiddle1' : 'RightHandMiddle1'].matrixWorld); }
}

// ------------------------------------------------------------------ weight transfer
const shortName = (b) => b.name.replace(/^mixamorig:?/, '');

// copy skin weights onto `target` from the nearest vertices of `ref` (inverse-distance average of
// the k closest), using only bones whose names match `keep`; reference vertices that lean on any
// other bone are skipped
function reskin(target, ref, keep, fallback, k = 6) {
  const rp = ref.geometry.attributes.position, rsi = ref.geometry.attributes.skinIndex, rsw = ref.geometry.attributes.skinWeight;
  target.geometry.computeBoundingBox();
  const box = target.geometry.boundingBox.clone().applyMatrix4(target.bindMatrix).expandByScalar(0.12);
  const cand = [], v = new THREE.Vector3();
  for (let i = 0; i < rp.count; i++) {
    v.fromBufferAttribute(rp, i).applyMatrix4(ref.bindMatrix);
    if (!box.containsPoint(v)) continue;
    const ws = []; let other = 0;
    for (let j = 0; j < 4; j++) {
      const w = rsw.getComponent(i, j); if (w <= 0) continue;
      const bone = ref.skeleton.bones[rsi.getComponent(i, j)];
      if (keep.test(shortName(bone))) ws.push([bone, w]); else other += w;
    }
    if (other < 0.05 && ws.length) cand.push({ x: v.x, y: v.y, z: v.z, ws });
  }
  const tp = target.geometry.attributes.position, si = target.geometry.attributes.skinIndex, sw = target.geometry.attributes.skinWeight;
  const bones = target.skeleton.bones, near = [];
  for (let i = 0; i < tp.count; i++) {
    v.fromBufferAttribute(tp, i).applyMatrix4(target.bindMatrix);
    near.length = 0;
    for (const c of cand) {
      const d = (c.x - v.x) ** 2 + (c.y - v.y) ** 2 + (c.z - v.z) ** 2;
      if (near.length < k || d < near[near.length - 1][0]) {
        near.push([d, c]); near.sort((a, b) => a[0] - b[0]); if (near.length > k) near.pop();
      }
    }
    const acc = new Map();
    for (const [d, c] of near) {
      const f = 1 / (Math.sqrt(d) + 0.01);
      for (const [bone, w] of c.ws) acc.set(bone, (acc.get(bone) || 0) + w * f);
    }
    if (!acc.size) acc.set(fallback, 1);
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, a) => s + a[1], 0);
    for (let j = 0; j < 4; j++) {
      si.setComponent(i, j, top[j] ? Math.max(0, bones.indexOf(top[j][0])) : 0);
      sw.setComponent(i, j, top[j] ? top[j][1] / sum : 0);
    }
  }
  si.needsUpdate = sw.needsUpdate = true;
}

// ------------------------------------------------------------------ loading
// Locally the binary GLB is served. Published artifacts can't serve .glb, so there is a JSON copy
// with the buffer inlined as base64; we rebuild the GLB in memory instead of letting the loader
// fetch a data: URL (sandboxes block that), and load textures through <img> elements.
export async function loadAtsu(GLTFLoader, base = 'assets/', name = 'atsu') {
  let buf = null;
  try {
    const r = await fetch(base + name + '.glb');
    if (r.ok) buf = await r.arrayBuffer();
  } catch { /* fall through to the JSON copy */ }
  if (!buf) {
    const r = await fetch(base + name + '.json');
    if (!r.ok) throw new Error(name + '.json: HTTP ' + r.status);
    const json = await r.json();
    const b64 = json.buffers[0].uri.slice(json.buffers[0].uri.indexOf(',') + 1);
    delete json.buffers[0].uri;
    const raw = atob(b64), bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    buf = packGLB(json, bin);
  }
  const loader = new GLTFLoader();
  const cib = globalThis.createImageBitmap;
  return new Promise((resolve, reject) => {
    try {
      try { globalThis.createImageBitmap = undefined; } catch { /* read-only: keep the default */ }
      loader.parse(buf, base, resolve, reject);
    } catch (e) { reject(e); } finally {
      try { globalThis.createImageBitmap = cib; } catch { /* nothing to restore */ }
    }
  });
}

function packGLB(json, bin) {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jl = (enc.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const out = new ArrayBuffer(12 + 8 + jl + 8 + bl), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(enc, 20); for (let i = enc.length; i < jl; i++) u8[20 + i] = 0x20;
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true);
  u8.set(bin, 28 + jl);
  return out;
}
