// The cloak of the Electrical Tackle: a great cat made of blue lightning wrapped round him while he is on all
// fours. Its skin is a flame: it flickers outward (taller along the back), rims bright where it turns away
// from the eye, and dark swirling marks drift through it. Ears, a head that lowers while it gathers itself and
// thrusts forward on the dash, four legs that stretch out in the leap, and two tails that sway and stream
// behind. All of it is one transparent material; set(k) fades it, pose() moves the parts.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';

const NOISE = /* glsl */`
  float cHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float cNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(cHash(i), cHash(i + vec3(1, 0, 0)), f.x), mix(cHash(i + vec3(0, 1, 0)), cHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(cHash(i + vec3(0, 0, 1)), cHash(i + vec3(1, 0, 1)), f.x), mix(cHash(i + vec3(0, 1, 1)), cHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

const VERT = /* glsl */`
  uniform float uTime, uK, uFlame; varying vec3 vN, vV, vW;
  ${NOISE}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 nw = normalize(mat3(modelMatrix) * normal);
    // the skin is a flame: it licks outward, and up off the back
    float fl = cNoise(w.xyz * 3.2 + vec3(0.0, -uTime * 6.0, 0.0)) * 0.7 + cNoise(w.xyz * 7.0 + vec3(0.0, -uTime * 11.0, 0.0)) * 0.3;
    float up = max(nw.y, 0.0);
    float sp = cNoise(w.xyz * 9.0 + vec3(0.0, -uTime * 14.0, 0.0));
    w.xyz += nw * (fl - 0.3) * (0.05 + 0.2 * up) * uFlame;
    w.y += up * up * (fl * 0.22 + sp * sp * 0.2) * uFlame;      // tongues of flame off the back
    vW = w.xyz; vN = nw; vV = cameraPosition - w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAG = /* glsl */`
  uniform float uTime, uK; varying vec3 vN, vV, vW;
  ${NOISE}
  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float rim = pow(1.0 - abs(dot(N, V)), 1.6);
    float n1 = cNoise(vW * 2.2 + vec3(0.0, -uTime * 3.0, 0.0)), n2 = cNoise(vW * 5.5 + vec3(uTime * 1.3, -uTime * 7.0, 0.0));
    // dark swirling marks, like brush strokes across the body
    float sw = cNoise(vW * 1.5 + vec3(0.0, uTime * 0.25, uTime * 0.35));
    float band = abs(fract(sw * 3.5 + n1 * 0.55) - 0.5);
    float mark = smoothstep(0.13, 0.06, band) * (1.0 - rim * 0.85);
    // now and then a thread of white current runs across it
    float arc = smoothstep(0.975, 0.995, 1.0 - abs(cNoise(vW * 4.0 + vec3(uTime * 8.0, uTime * 5.0, 0.0)) - 0.5) * 2.0);
    vec3 deep = vec3(0.02, 0.1, 0.62), mid = vec3(0.08, 0.36, 1.0), pale = vec3(0.45, 0.78, 1.3);
    float g = clamp(rim * 1.1 + n2 * 0.35 - 0.1, 0.0, 1.0);
    vec3 c = g < 0.5 ? mix(deep, mid, g * 2.0) : mix(mid, pale, g * 2.0 - 1.0);
    c = mix(c, vec3(0.0, 0.01, 0.06), mark);
    c += vec3(0.7, 0.88, 1.0) * arc;
    float a = clamp(0.3 + rim * 0.6 + n2 * 0.15 + mark * 0.55 + arc * 0.5, 0.0, 0.92) * uK;
    gl_FragColor = vec4(c, a);
  }`;

const ell = (rx, ry, rz, x, y, z, seg = 20) => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)).scale(rx, ry, rz).translate(x, y, z);
const cone = (r, h, x, y, z, rx = 0, rz = 0) => new THREE.ConeGeometry(r, h, 10, 1).rotateX(rx).rotateZ(rz).translate(x, y, z);

// a tail: a tube along a curve that thins to a tip
function tail(side) {
  const pts = [[0, 0, 0], [side * 0.18, 0.35, -0.45], [side * 0.42, 0.95, -0.7], [side * 0.55, 1.55, -0.45], [side * 0.42, 1.9, 0.0]].map((p) => new THREE.Vector3(...p));
  const curve = new THREE.CatmullRomCurve3(pts), n = 28, rad = 8;
  const g = new THREE.TubeGeometry(curve, n, 1, rad, false), pos = g.attributes.position;
  for (let i = 0; i <= n; i++) {
    const u = i / n, c = curve.getPointAt(u), r = 0.2 * (1 - u * 0.8);
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j;
      pos.setXYZ(k, c.x + (pos.getX(k) - c.x) * r, c.y + (pos.getY(k) - c.y) * r, c.z + (pos.getZ(k) - c.z) * r);
    }
  }
  g.deleteAttribute('uv'); g.computeVertexNormals();
  return g;
}
const strip = (g) => { g.deleteAttribute('uv'); return g; };

export class CatCloak {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uFlame: { value: 1 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
    });
    const mk = (geo) => { const m = new THREE.Mesh(geo, this.mat); m.frustumCulled = false; m.renderOrder = 13; return m; };
    this.root = new THREE.Group(); this.root.visible = false;
    this.body = new THREE.Group(); this.root.add(this.body);
    // torso: haunch, back, chest, neck, and flame tufts along the spine
    const torso = [ell(0.5, 0.5, 0.55, 0, 0.72, -0.55), ell(0.47, 0.45, 0.95, 0, 0.8, 0.0), ell(0.52, 0.58, 0.55, 0, 0.9, 0.6), ell(0.3, 0.36, 0.38, 0, 1.12, 0.95)];
    for (let i = 0; i < 6; i++) { const z = 0.85 - i * 0.32; torso.push(cone(0.13, 0.42, 0, 1.28 - Math.abs(z - 0.2) * 0.15, z, -0.75)); }
    this.body.add(mk(mergeGeometries(torso.map(strip))));
    // head on its own pivot at the neck: it lowers and shakes while the cat gathers itself
    this.head = new THREE.Group(); this.head.position.set(0, 1.12, 0.95); this.body.add(this.head);
    const H = (g) => g.translate(0, -1.12, -0.95);
    this.head.add(mk(mergeGeometries([ell(0.4, 0.36, 0.42, 0, 1.32, 1.22), ell(0.22, 0.17, 0.26, 0, 1.2, 1.56), ell(0.2, 0.12, 0.2, 0, 1.08, 1.42),
      cone(0.16, 0.44, 0.25, 1.68, 1.12, 0, -0.35), cone(0.16, 0.44, -0.25, 1.68, 1.12, 0, 0.35)].map((g) => strip(H(g))))));
    // eyes: two hot points
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.eyeM = eyeM;
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), eyeM); e.scale.set(0.085, 0.045, 0.04); e.position.set(s * 0.17, 1.4 - 1.12, 1.56 - 0.95); e.rotation.z = s * 0.3; e.renderOrder = 14; this.head.add(e); }
    // legs: a pivot at each shoulder and hip, the leg hanging from it with a paw at the end
    this.legs = [];
    for (const [x, y, z, front] of [[0.3, 0.8, 0.7, 1], [-0.3, 0.8, 0.7, 1], [0.32, 0.72, -0.62, 0], [-0.32, 0.72, -0.62, 0]]) {
      const p = new THREE.Group(); p.position.set(x, y, z); this.body.add(p);
      p.add(mk(mergeGeometries([new THREE.CylinderGeometry(0.19, 0.12, 0.62, 10, 1).translate(0, -0.33, 0), ell(0.19, 0.19, 0.19, 0, 0, 0, 12), ell(0.18, 0.11, 0.24, 0, -0.72, 0.06, 12)].map(strip))));
      p.userData.front = front; this.legs.push(p);
    }
    // two tails from the base of the spine
    this.tails = [];
    for (const s of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(s * 0.12, 0.95, -1.0); this.body.add(p);
      p.add(mk(tail(s))); p.userData.s = s; this.tails.push(p);
    }
    scene.add(this.root);
  }

  // k: how much of it there is (0 gone, 1 whole); gather: 0..1 while it builds; dash: 0..1 in the leap
  update(time, pos, heading, k, gather, dash) {
    const R = this.root;
    R.visible = k > 0.01;
    if (!R.visible) return;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uK.value = k;
    this.mat.uniforms.uFlame.value = 1 + gather * 0.6 + dash * 0.25;
    this.eyeM.opacity = k;
    R.position.copy(pos); R.rotation.set(0, heading, 0);
    // it grows out of him, crouches as it gathers, and stretches long in the leap
    const grow = (0.55 + 0.45 * Math.min(1, k * 1.4)) * 0.88;
    R.scale.set(grow * (1 - 0.08 * dash), grow * (1 - 0.12 * gather - 0.1 * dash), grow * (1 + 0.4 * dash));
    this.body.position.y = -0.12 * gather + 0.05 * dash;
    this.head.rotation.set(0.35 * gather - 0.25 * dash + 0.04 * Math.sin(time * 40) * gather, 0.05 * Math.sin(time * 31) * gather, 0);
    for (const L of this.legs) {
      const f = L.userData.front;
      // gathering: the forepaws knead; the leap: forelegs thrown forward, hind legs driven back
      L.rotation.x = f ? -0.25 * gather + 0.06 * Math.sin(time * 26 + L.position.x * 9) * gather - 0.7 * dash : 0.3 * gather + 0.75 * dash;
    }
    for (const T of this.tails) {
      const s = T.userData.s;
      T.rotation.set(-0.2 * gather + 0.95 * dash + 0.08 * Math.sin(time * 3.1 + s), 0, s * 0.18 * Math.sin(time * 2.3 + s * 1.7) * (1 - dash));
    }
  }
}
