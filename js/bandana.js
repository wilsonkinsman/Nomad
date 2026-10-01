// A cloth bandana over Atsu's nose and mouth, built at load from her own face. The head is sampled
// in cylindrical slices; each slice is wrapped taut (a convex hull), the way tied cloth bridges the
// nose and cheekbones instead of following every dip; below the chin it hangs in a soft point
// rather than clinging to the throat. It is skinned on the body's skeleton (head, and a little
// neck toward the hem), so it moves exactly with the face. A knot sits behind the left ear; its
// two tails are simulated cloth (see AtsuModel.buildCloth).
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';

const NB = 120, Y0 = 1.18, DY = 0.004, NY = 90;     // surface bins: angle x height
const NC = 96, NR = 26;                               // cloth grid: around x down
const KNOT = Math.PI - 0.45;                          // behind the left ear, clear of the ponytail

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildBandana(model, tx) {
  const mesh = {};
  model.scene.traverse((o) => { if (o.isSkinnedMesh) mesh[o.material.name] = o; });
  const body = mesh.Skin, eyes = mesh.Eye;
  if (!body || !eyes) return null;
  const toBody = new THREE.Matrix4().copy(body.bindMatrix).invert();
  const v = new THREE.Vector3();
  const each = (m, fn) => {
    const p = m.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(toBody, m.bindMatrix);
    for (let i = 0; i < p.count; i++) fn(v.fromBufferAttribute(p, i).applyMatrix4(M), i);
  };

  // landmarks: the bottom of the eyes, and the head's vertical axis through the middle of the skull
  let eyeY = 1e9; each(eyes, (p) => { eyeY = Math.min(eyeY, p.y); });
  let zlo = 1e9, zhi = -1e9;
  each(body, (p) => { if (Math.abs(p.y - (eyeY - 0.01)) < 0.012 && Math.abs(p.x) < 0.03) { zlo = Math.min(zlo, p.z); zhi = Math.max(zhi, p.z); } });
  const cz = (zlo + zhi) / 2, chinY = eyeY - 0.085;

  // outermost surface per (angle, height) bin: skin, hair (not the ponytail, which swings free),
  // and the collars underneath the hanging point
  const R = new Float32Array(NB * NY);
  const bin = (p) => {
    const by = Math.round((p.y - Y0) / DY); if (by < 0 || by >= NY) return;
    const dz = p.z - cz, r = Math.hypot(p.x, dz);
    if (r > 0.17) return;
    const bt = Math.floor((Math.atan2(p.x, dz) + Math.PI) / (Math.PI * 2) * NB) % NB;
    if (r > R[by * NB + bt]) R[by * NB + bt] = r;
  };
  each(body, bin);
  for (const name of ['Kimono', 'Juban']) if (mesh[name]) each(mesh[name], bin);
  const hair = mesh.Hair;
  if (hair) {
    const si = hair.geometry.attributes.skinIndex, sw = hair.geometry.attributes.skinWeight, bones = hair.skeleton.bones;
    each(hair, (p, i) => {
      let tail = 0;
      for (let k = 0; k < 4; k++) if (/^tail/.test(bones[si.getComponent(i, k)].name)) tail += sw.getComponent(i, k);
      if (tail < 0.2) bin(p);
    });
  }
  // fill holes with the largest neighbour, a few passes
  for (let pass = 0; pass < 6; pass++) {
    const src = R.slice();
    for (let y = 0; y < NY; y++) for (let t = 0; t < NB; t++) {
      if (src[y * NB + t] > 0) continue;
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dt = -1; dt <= 1; dt++) {
        const yy = y + dy; if (yy < 0 || yy >= NY) continue;
        m = Math.max(m, src[yy * NB + (t + dt + NB) % NB]);
      }
      R[y * NB + t] = m;
    }
  }
  const surf = (th, y) => {
    const by = Math.round((y - Y0) / DY), bt = Math.floor((th + Math.PI) / (Math.PI * 2) * NB);
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dt = -1; dt <= 1; dt++) {
      const yy = Math.min(NY - 1, Math.max(0, by + dy));
      m = Math.max(m, R[yy * NB + ((bt + dt) % NB + NB) % NB]);
    }
    return m;
  };

  // outline: just under the eyes in front, sloping a little down toward the knot; a deep point
  // under the chin, a narrow strap round the back
  const yTop = (th) => eyeY - 0.007 - 0.012 * (1 - Math.cos(th)) / 2;
  const yBot = (th) => {
    const w = Math.pow(Math.max(0, 1 - Math.abs(th) / 1.9), 1.3);
    return yTop(th) - 0.045 - (eyeY - 0.007 - 0.045 - (eyeY - 0.16)) * w + 0.003 * Math.sin(th * 7);
  };
  const TH = [], Y = [], Rr = [];
  for (let i = 0; i <= NR; i++) {
    Y.push(new Float32Array(NC + 1)); Rr.push(new Float32Array(NC + 1));
    for (let j = 0; j <= NC; j++) {
      const th = -Math.PI + (j / NC) * Math.PI * 2;
      if (i === 0) TH.push(th);
      Y[i][j] = THREE.MathUtils.lerp(yTop(th), yBot(th), i / NR);
      Rr[i][j] = surf(th, Y[i][j]);
    }
  }
  // taut across each slice: radius of the convex hull of the slice along every ray
  const hull = (i) => {
    const pts = []; for (let j = 0; j < NC; j++) pts.push([Rr[i][j] * Math.sin(TH[j]), Rr[i][j] * Math.cos(TH[j])]);
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let k = pts.length - 1; k >= 0; k--) { const p = pts[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    const H = lo.slice(0, -1).concat(up.slice(0, -1));
    for (let j = 0; j <= NC; j++) {
      const dx = Math.sin(TH[j]), dz = Math.cos(TH[j]);
      let best = Rr[i][j];
      for (let k = 0; k < H.length; k++) {
        const a = H[k], b = H[(k + 1) % H.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (a[0] * ez - a[1] * ex) / den, s = (a[0] * dz - a[1] * dx) / den;
        if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t);
      }
      Rr[i][j] = best;
    }
  };
  for (let i = 0; i <= NR; i++) hull(i);
  // hanging: going down, cloth can only move inward slowly, so it drops from the nose and chin
  for (let i = 1; i <= NR; i++) for (let j = 0; j <= NC; j++) Rr[i][j] = Math.max(Rr[i][j], Rr[i - 1][j] - (Y[i - 1][j] - Y[i][j]) * 0.45);
  for (let i = 0; i <= NR; i++) hull(i);

  // geometry, with soft folds radiating down from the chin
  const hi = body.skeleton.bones.indexOf(model.g.Head), ni = body.skeleton.bones.indexOf(model.g.Neck);
  let yMin = 1e9; for (let j = 0; j <= NC; j++) yMin = Math.min(yMin, Y[NR][j]);
  const pos = [], uv = [], sIdx = [], sW = [], idx = [];
  for (let i = 0; i <= NR; i++) for (let j = 0; j <= NC; j++) {
    const th = TH[j], y = Y[i][j];
    const hang = sstep(0, 0.09, chinY - y);
    const r = Rr[i][j] + 0.005 + 0.004 * (i / NR) + hang * 0.004 * (Math.sin(th * 11 + 0.6) * 0.7 + Math.sin(th * 5.3 + 2) * 0.3);
    pos.push(r * Math.sin(th), y, cz + r * Math.cos(th));
    uv.push((j / NC) * 4, (yTop(th) - y) / 0.15);
    const wh = y >= chinY ? 1 : THREE.MathUtils.lerp(0.6, 1, (y - yMin) / (chinY - yMin));
    sIdx.push(hi, ni, 0, 0); sW.push(wh, 1 - wh, 0, 0);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) {
    const a = i * (NC + 1) + j, b = a + 1, c = a + NC + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  band.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
  band.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sW, 4));
  band.setIndex(idx);
  band.computeVertexNormals();

  // the knot: two squashed lobes on the strap
  const kj = Math.round((KNOT + Math.PI) / (Math.PI * 2) * NC), km = Math.round(NR / 2);
  const kr = Rr[km][kj] + 0.012, ky = Y[km][kj];
  const out = new THREE.Vector3(Math.sin(KNOT), 0, Math.cos(KNOT)), side = new THREE.Vector3(Math.cos(KNOT), 0, -Math.sin(KNOT));
  const knotAt = new THREE.Vector3(kr * Math.sin(KNOT), ky, cz + kr * Math.cos(KNOT));
  const parts = [band];
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(1, 10, 8);
    const m = new THREE.Matrix4().makeBasis(side, new THREE.Vector3(0, 1, 0), out)
      .multiply(new THREE.Matrix4().makeScale(0.017, 0.013, 0.01));
    m.setPosition(knotAt.clone().addScaledVector(side, s * 0.011));
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n).fill(0).flatMap(() => [hi, 0, 0, 0]), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
    parts.push(g);
  }
  const geo = mergeGeometries(parts);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a5d8c, map: tx?.fabric?.map || null, normalMap: tx?.fabric?.normal || null,
    roughness: 0.93, side: THREE.DoubleSide,
  });
  mat.name = 'Bandana';
  if (mat.normalMap) mat.normalScale = new THREE.Vector2(0.6, 0.6);
  const m = new THREE.SkinnedMesh(geo, mat);
  m.name = 'Atsu_Bandana';
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  body.parent.add(m);
  m.position.copy(body.position); m.quaternion.copy(body.quaternion); m.scale.copy(body.scale);
  m.updateMatrixWorld(true);
  m.bind(body.skeleton, body.bindMatrix);
  return { mesh: m, mat, knot: knotAt, out, side };
}
