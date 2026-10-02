// The Wind Crow: a great crow made of wind, about four metres across the wings. Its body is dark as ink and
// nearly solid, brushed over with darker strokes; toward the wingtips it thins and pales to glowing air. Streaks
// of wind run back over it from beak to tail and its outline shivers as if in a gale. Wings in two parts each (the
// arm and the hand, with six fingered primaries), a fan tail, a head that turns into the bank, and legs whose
// talons close round his hands. All of it is one transparent material; update() poses it, then place() hangs it
// from a point (his hands) or setAt() puts it free.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';

export const NOISE = /* glsl */`
  float cHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float cNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(cHash(i), cHash(i + vec3(1, 0, 0)), f.x), mix(cHash(i + vec3(0, 1, 0)), cHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(cHash(i + vec3(0, 0, 1)), cHash(i + vec3(1, 0, 1)), f.x), mix(cHash(i + vec3(0, 1, 1)), cHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

const VERT = /* glsl */`
  attribute float aTip;
  uniform float uTime, uK; varying vec3 vN, vV, vO; varying float vTip;
  ${NOISE}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 nw = normalize(mat3(modelMatrix) * normal);
    // the outline shivers like cloth in a gale, more toward the wingtips
    float rip = cNoise(position * 5.0 + vec3(0.0, 0.0, uTime * 10.0));
    w.xyz += nw * (rip - 0.5) * 0.035 * (0.4 + aTip);
    vO = position; vTip = aTip; vN = nw; vV = cameraPosition - w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAG = /* glsl */`
  uniform float uTime, uK, uGlow; varying vec3 vN, vV, vO; varying float vTip;
  ${NOISE}
  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float rim = pow(1.0 - abs(dot(N, V)), 1.5);
    float n = cNoise(vO * 3.5 + vec3(0.0, uTime * 0.6, uTime * 2.2));
    // streaks of wind running back over it, long and thin
    float streak = smoothstep(0.66, 0.92, cNoise(vec3(vO.x * 10.0, vO.y * 10.0, vO.z * 1.1 + uTime * 6.0)));
    // brush strokes of ink that flow back over the feathers, as if it were painted in one go
    float sw = cNoise(vec3(vO.x * 2.4, vO.y * 2.4, vO.z * 1.3 + uTime * 0.9));
    float mark = smoothstep(0.13, 0.04, abs(fract(sw * 3.0 + n * 0.45) - 0.5)) * (1.0 - 0.8 * rim);
    // a crow's dark body, paling to glowing air toward the wingtips and wherever it turns from the eye
    vec3 ink = vec3(0.02, 0.03, 0.05), slate = vec3(0.11, 0.16, 0.21), air = vec3(1.0, 1.15, 1.2);
    vec3 c = mix(slate, air, clamp(rim * 0.9 + streak * 0.5 + vTip * vTip * 0.75 + n * 0.15 - 0.2, 0.0, 1.0));
    c = mix(c, ink, max(mark * 0.8, (1.0 - vTip) * (1.0 - rim) * 0.5));
    c += air * uGlow * (0.25 + 0.75 * rim);
    // nearly solid in the body, thinning to wisps of air at the tips
    float a = mix(0.9, 0.4 + 0.35 * n, smoothstep(0.4, 1.0, vTip));
    a = max(max(a, streak * 0.7), mark * 0.9) * (0.85 + 0.15 * rim);
    gl_FragColor = vec4(c, clamp(a, 0.0, 0.95) * uK);
  }`;

// every part carries aTip: 0 in the body, rising to 1 at the wingtips and the end of the tail
function tipped(g, f) {
  g.deleteAttribute('uv');
  const p = g.attributes.position, a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = f(p.getX(i), p.getY(i), p.getZ(i));
  g.setAttribute('aTip', new THREE.BufferAttribute(a, 1));
  return g;
}
const ell = (rx, ry, rz, x, y, z, seg = 16) => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)).scale(rx, ry, rz).translate(x, y, z);
const body = (g) => tipped(g, () => 0);
// a flat piece of wing lying in the x-z plane: points are [out along the wing, forward]
function plate(pts) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))));
  return g.rotateX(Math.PI / 2);        // the shape's y becomes forward (+z)
}
// one long feather: a leaf L long and w wide, from (x, z) pointing at angle a (from +x toward +z)
function feather(x, z, a, L, w) {
  const N = 9, top = [], bot = [], c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i <= N; i++) {
    const u = i / N, half = w * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.95)), 0.6) * (1 - 0.35 * u);
    top.push([u * L, half]); bot.push([u * L, -half]);
  }
  const pts = [...top, ...bot.reverse()].map(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c]);
  return plate(pts);
}

// the grip, where the talons close, in the crow's own frame (metres before scaling)
export const GRIP = new THREE.Vector3(0, -0.43, 0.05);
const TIP = new THREE.Vector3(0.98, 0, -0.2);         // the far end of the hand, in the wrist's frame

export class WindCrow {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uGlow: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const mk = (geo) => { const m = new THREE.Mesh(geo, this.mat); m.frustumCulled = false; m.renderOrder = 13; return m; };
    this.root = new THREE.Group(); this.root.visible = false; this.root.rotation.order = 'YXZ';
    this.body = new THREE.Group(); this.root.add(this.body);
    // the body: back and belly, a deep chest, and a ruff of feathers at the throat
    const torso = [ell(0.2, 0.18, 0.5, 0, 0, -0.02), ell(0.22, 0.21, 0.3, 0, -0.03, 0.18)];
    for (let i = 0; i < 4; i++) torso.push(new THREE.ConeGeometry(0.05, 0.2, 6).rotateX(Math.PI * 0.62).translate((i - 1.5) * 0.06, -0.1, 0.38 - Math.abs(i - 1.5) * 0.03));
    this.body.add(mk(mergeGeometries(torso.map(body))));
    // the head on its own pivot at the neck, so it can turn into a bank
    this.head = new THREE.Group(); this.head.position.set(0, 0.05, 0.42); this.body.add(this.head);
    this.head.add(mk(mergeGeometries([ell(0.13, 0.13, 0.17, 0, 0.0, 0.08), ell(0.135, 0.125, 0.16, 0, 0.04, 0.2),
      new THREE.ConeGeometry(0.058, 0.3, 8).rotateX(Math.PI / 2 + 0.12).translate(0, 0.01, 0.46)].map(body))));
    const eyeM = this.eyeM = new THREE.MeshBasicMaterial({ color: 0xd8fff4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), eyeM); e.scale.set(0.024, 0.02, 0.03); e.position.set(s * 0.1, 0.08, 0.27); e.renderOrder = 14; this.head.add(e); }
    // the tail: five long feathers in a fan that spreads and tips
    this.tail = new THREE.Group(); this.tail.position.set(0, 0.02, -0.42); this.body.add(this.tail);
    this.tail.add(mk(mergeGeometries([-0.32, -0.16, 0, 0.16, 0.32].map((a) =>
      tipped(ell(0.065, 0.012, 0.32, 0, 0, -0.3, 12).rotateY(a), (x, y, z) => Math.min(1, 0.25 + Math.hypot(x, z) * 0.9))))));
    // legs, and the feet that close round his hands
    this.legs = new THREE.Group(); this.legs.position.set(0, -0.12, 0.03); this.body.add(this.legs);
    const leg = [];
    for (const s of [-1, 1]) leg.push(new THREE.CylinderGeometry(0.022, 0.018, 0.29, 6).translate(s * 0.065, -0.155, 0.01), ell(0.04, 0.03, 0.075, s * 0.07, -0.31, 0.02, 10));
    this.legs.add(mk(mergeGeometries(leg.map(body))));
    // the wings: the arm (with the ragged trailing edge of the secondaries) and the hand (six fingered primaries)
    this.wings = [];
    for (const side of [1, -1]) {
      const shoulder = new THREE.Group(); shoulder.position.set(side * 0.15, 0.06, 0.1); this.body.add(shoulder);
      const arm = plate([[0, 0.1], [0.2, 0.15], [0.45, 0.14], [0.78, 0.08], [0.78, -0.22], [0.66, -0.36], [0.58, -0.3], [0.48, -0.4], [0.38, -0.33],
        [0.27, -0.42], [0.16, -0.34], [0.05, -0.4], [0, -0.28]]);
      tipped(arm, (x) => 0.1 + 0.35 * x / 0.78);
      const wrist = new THREE.Group(); wrist.position.set(side * 0.76, 0, 0); shoulder.add(wrist);
      const roots = [[0.28, 0.0, 0.12, 0.52], [0.3, -0.04, -0.02, 0.66], [0.31, -0.08, -0.16, 0.7], [0.3, -0.12, -0.3, 0.66], [0.27, -0.16, -0.46, 0.58], [0.22, -0.2, -0.62, 0.5]];
      const hand = mergeGeometries([plate([[0, 0.08], [0.18, 0.06], [0.34, 0.0], [0.36, -0.12], [0.25, -0.24], [0, -0.22]]),
        ...roots.map(([x, z, a, L]) => feather(x, z, a, L, 0.06))].map((g) => tipped(g, (x, y, z) => Math.min(1, 0.45 + Math.hypot(x, z) * 0.55))));
      if (side < 0) { arm.scale(-1, 1, 1); hand.scale(-1, 1, 1); }
      shoulder.add(mk(arm)); wrist.add(mk(hand));
      this.wings.push({ side, shoulder, wrist });
    }
    this.S = 1;
    this._v = new THREE.Vector3();
    scene.add(this.root);
  }

  // s: { k: how much of it there is (0 gone, 1 whole), flap: the wingbeat's phase (radians), beat: how hard it is
  // beating (0 a glide, 1 flat out), tuck: how far the wings are swept back (a fast dive), dart: folded right back
  // for the throw, look: the head turned into the bank (radians), glow: a flare, scale: its size }
  update(time, s) {
    const R = this.root, k = s.k;
    R.visible = k > 0.01;
    if (!R.visible) return;
    const U = this.mat.uniforms;
    U.uTime.value = time; U.uK.value = k; U.uGlow.value = s.glow || 0;
    this.eyeM.opacity = k;
    const dart = s.dart || 0, tuck = s.tuck || 0, beat = (s.beat ?? 0.5) * (1 - dart), ph = s.flap || 0;
    this.S = s.scale ?? 1;
    R.scale.set(this.S, this.S, this.S * (1 + 0.15 * dart));
    // the wings: a strong downstroke and a quicker recovery, the hand lagging the arm so the tip whips through;
    // swept back in a dive, folded back along the body for the throw
    const amp = 0.15 + 0.75 * beat, sw = Math.sin(ph);
    for (const W of this.wings) {
      W.shoulder.rotation.set(0, W.side * (0.15 * tuck + 1.05 * dart), W.side * (0.1 + amp * sw - 0.25 * dart));
      W.wrist.rotation.set(0, W.side * (0.55 * tuck + 1.9 * dart), W.side * (0.06 + amp * 0.55 * Math.sin(ph - 0.8) - 0.1 * tuck));
    }
    // the body rises and falls against the wings, the tail spreads to steer and tips with the beat
    this.body.position.y = -0.045 * sw * beat;
    this.body.rotation.x = 0.04 * Math.sin(ph + 1.2) * beat;
    this.tail.rotation.x = -0.12 * beat * Math.sin(ph + 0.6) + 0.15 * tuck;
    this.tail.scale.set(1 + 0.5 * beat * (1 - tuck), 1, 1 - 0.15 * dart);
    this.head.rotation.set(-0.05 * Math.sin(ph) * beat, s.look || 0, 0);
    // the legs hang (their feet round his hands) and swing back under the tail once it lets go
    this.legs.rotation.x = 1.25 * dart;
  }

  // hang it so its talons are at `at`, flying along yaw (radians, as the player's heading), pitch (positive: nose
  // down) and roll (positive: its left wing up)
  place(at, yaw, pitch, roll) {
    const R = this.root;
    R.rotation.set(pitch, yaw, roll);
    this._v.copy(GRIP).multiplyScalar(this.S).applyEuler(R.rotation);
    R.position.copy(at).sub(this._v);
    R.updateMatrixWorld(true);
  }
  setAt(p, yaw, pitch, roll) { this.root.rotation.set(pitch, yaw, roll); this.root.position.copy(p); this.root.updateMatrixWorld(true); }
  // where its talons are now, in the world
  grip(out) { return out.copy(GRIP).applyMatrix4(this.root.matrixWorld); }
  // the far tip of a wing (side 1: its left, -1: its right), in the world
  tip(side, out) { const W = this.wings[side > 0 ? 0 : 1]; return out.set(TIP.x * W.side, TIP.y, TIP.z).applyMatrix4(W.wrist.matrixWorld); }
}
