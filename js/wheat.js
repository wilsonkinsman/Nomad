// Waist-high wheat: stalks with nodding ears, drawn like the grass (wrapped rings, rebuilt per
// vertex) but only inside the wheat field. Gust fronts roll across it as visible waves, the
// stalks part around the nomad and stay lodged along his path for a long while.
import * as THREE from 'three';
import { GLSL_WORLD, ZONES } from './world.js';
import { GLSL_WIND } from './wind.js';
import { GLSL_NOISE } from './util.js';
import { GLSL_TRAMPLE, addTranslucency } from './grass.js';

function stalkGeometry(stemSegs = 4) {
  // part 0: stem ribbon, part 1/2: two crossed planes of the ear, part 3: a leaf
  const pos = [], part = [], idx = [];
  let v = 0;
  const stemTop = 0.8;
  for (let i = 0; i <= stemSegs; i++) { const t = i / stemSegs * stemTop; pos.push(-0.5, t, 0, 0.5, t, 0); part.push(0, 0); }
  for (let i = 0; i < stemSegs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  v = (stemSegs + 1) * 2;
  for (const pl of [1, 2]) {
    const prof = [[0.8, 0.0], [0.84, 1.0], [0.92, 1.0], [0.99, 0.55], [1.0, 0.0]];
    const base = v;
    for (const [t, w] of prof) { pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0); part.push(pl, pl); v += 2; }
    for (let i = 0; i < prof.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  // one leaf blade off the stem
  const lb = v;
  for (const [t, w] of [[0.25, 1], [0.42, 0.8], [0.55, 0]]) { pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0); part.push(3, 3); v += 2; }
  idx.push(lb, lb + 1, lb + 2, lb + 1, lb + 3, lb + 2, lb + 2, lb + 3, lb + 4, lb + 3, lb + 5, lb + 4);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export class Wheat {
  constructor(game) {
    this.game = game;
    const tex = game.worldTex;
    this.shared = {
      uHeightTex: { value: tex.height }, uZoneTex: { value: tex.zone }, uPathTex: { value: tex.path },
      uTrample: game.trample.uniform, uTrampleRect: { value: game.trample.rect },
      uPlayer: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector2() },
      ...game.wind.uniforms,
    };
    this.defs = [
      { grid: 270, size: 27, near: 0, far: 13.5, width: 0.022, ear: 0.03 },
      { grid: 210, size: 92, near: 11.5, far: 46, width: 0.05, ear: 0.07 },
    ];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.rings = [];
    this.build(1);
  }

  build(q) {
    for (const r of this.rings) { this.group.remove(r); r.geometry.dispose(); r.material.dispose(); }
    this.rings = [];
    for (const d of this.defs) {
      const grid = Math.round(d.grid * Math.sqrt(q));
      const geo = stalkGeometry(d.near < 0.5 ? 4 : 2);
      geo.instanceCount = grid * grid;
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
      const U = { ...this.shared, uGrid: { value: grid }, uSize: { value: d.size }, uSpacing: { value: d.size / grid },
        uNear: { value: d.near }, uFar: { value: d.far }, uWidth: { value: d.width / Math.sqrt(q) }, uEar: { value: d.ear / Math.sqrt(q) } };
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, U);
        s.vertexShader = s.vertexShader
          .replace('#include <common>', `#include <common>
            ${GLSL_WORLD} ${GLSL_WIND} ${GLSL_NOISE} ${GLSL_TRAMPLE}
            attribute float part;
            uniform int uGrid; uniform float uSize, uSpacing, uNear, uFar, uWidth, uEar; uniform vec2 uCenter; uniform vec3 uPlayer;
            varying float vT; varying float vPart; varying vec3 vTint;`)
          .replace('#include <beginnormal_vertex>', `
            int gid = gl_InstanceID;
            vec2 cell = vec2(float(gid % uGrid), float(gid / uGrid));
            vec2 local = (cell + nHash22(cell * 0.91 + 2.3)) * uSpacing;
            vec2 wxz = local + uSize * floor((uCenter - local) / uSize + 0.5);
            vec2 wcell = floor(wxz / uSpacing);
            float r1 = nHash12(wcell * 1.73 + 5.1), r2 = nHash12(wcell * 0.37 + 1.3), r3 = nHash12(wcell + 21.7);
            vec4 zn = worldZone(wxz); vec4 pt = worldPath(wxz);
            float dens = smoothstep(0.35, 0.75, zn.g) * (1.0 - smoothstep(0.1, 0.4, pt.r));
            float dist = length(wxz - uCenter);
            float fade = smoothstep(uNear * 0.85, uNear, dist) * (1.0 - smoothstep(uFar * 0.75, uFar, dist));
            if (uNear < 0.5) fade = 1.0 - smoothstep(uFar * 0.75, uFar, dist);
            float k = clamp((dens * fade - r3 * 0.35) * 5.0, 0.0, 1.0);
            float field = nNoise(wxz * 0.09);
            float hgt = mix(0.95, 1.25, r1) * (0.85 + 0.3 * field) * mix(0.75, 1.0, smoothstep(0.35, 0.8, zn.g)) * k;
            float t = position.y;
            float yaw = r2 * 6.2831;
            // ears nod away from the stalk's lean; leaves point sideways
            vec2 fdir = vec2(sin(yaw), cos(yaw));
            vec2 bend = fdir * (0.06 + 0.1 * r1);
            float gust = windGust(wxz);
            float wave = 0.1 + 0.42 * gust + 0.07 * sin(uWindTime * 1.9 + dot(wxz, uWindDir) * 0.6 + r1 * 4.0);
            bend += uWindDir * wave;
            vec4 tr = trampleAt(wxz);
            float lodge = max(tr.z, tr.w * 0.75);
            bend = mix(bend, tr.xy * 1.35, clamp(lodge, 0.0, 1.0));
            vec2 toP = wxz - uPlayer.xz; float pd = length(toP);
            float push = (1.0 - smoothstep(0.2, 0.85, pd)) * step(abs(uPlayer.y - worldHeight(wxz)), 1.0);
            bend += toP / max(pd, 1e-3) * push * 1.1;
            float bl = length(bend); vec2 bd = bend / max(bl, 1e-4);
            // stiff stems: bending grows with the square of height
            float th = min(bl, 1.45) * t * t * 1.25;
            vec3 base = vec3(wxz.x, worldHeight(wxz) - 0.03, wxz.y);
            vec3 up = vec3(0.0, 1.0, 0.0), b3 = vec3(bd.x, 0.0, bd.y);
            vec3 spine = base + up * (hgt * t * cos(th)) + b3 * (hgt * t * sin(th));
            vec3 tang = normalize(up * cos(th) + b3 * sin(th));
            float pa = part;
            vec3 side;
            float w;
            if (pa < 0.5) { side = vec3(fdir.y, 0.0, -fdir.x); w = uWidth * (1.0 - t * 0.5); }
            else if (pa < 1.5) { side = normalize(cross(tang, vec3(fdir.x, 0.0, fdir.y)) + vec3(1e-4)); w = uEar; }
            else if (pa < 2.5) { side = vec3(fdir.x, 0.0, fdir.y); w = uEar; }
            else {
              side = vec3(fdir.y, 0.0, -fdir.x);
              w = uWidth * 1.6;
              // leaf arcs out from the stem
              float lt = (t - 0.25) / 0.3;
              spine += (side * 0.0 + vec3(fdir.x, 0.0, fdir.y) * 0.18 * lt + up * -0.05 * lt * lt) * hgt;
            }
            w *= step(0.001, k);
            vec3 bladeP = spine + side * position.x * w;
            vec3 objectNormal = normalize(cross(side, tang) + up * 0.3 + side * position.x * 1.2);
            vT = t; vPart = pa;
            vTint = vec3(r1, field, smoothstep(0.35, 0.8, zn.g));`)
          .replace('#include <begin_vertex>', 'vec3 transformed = bladeP;');
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vT; varying float vPart; varying vec3 vTint;')
          .replace('#include <map_fragment>', `
            vec3 straw = mix(vec3(0.16, 0.12, 0.04), vec3(0.52, 0.38, 0.13), smoothstep(0.0, 0.7, vT));
            vec3 ear = vec3(0.6, 0.44, 0.16) * mix(0.8, 1.15, vTint.x);
            vec3 green = mix(vec3(0.06, 0.08, 0.025), vec3(0.2, 0.2, 0.06), vT);
            vec3 c = vPart > 0.5 && vPart < 2.5 ? ear : straw;
            if (vPart > 2.5) c = mix(straw, green, 0.4);
            c = mix(c, green, (1.0 - vTint.z) * 0.35 * (1.0 - step(0.5, vPart)));
            c *= mix(0.85, 1.12, vTint.y);
            diffuseColor.rgb = c * mix(0.4, 1.0, smoothstep(0.0, 0.45, vT));`);
        addTranslucency(s, '0.8 * smoothstep(0.2, 0.9, vT)');
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.receiveShadow = true;
      this.group.add(mesh);
      this.rings.push(mesh);
    }
  }

  setQuality(q) { if (q.veg !== this.q) { this.q = q.veg; this.build(q.veg); } }

  update(dt, game) {
    const c = game.camera.position;
    this.shared.uCenter.value.set(c.x, c.z);
    this.shared.uPlayer.value.copy(game.player.pos);
    // skip entirely when the field is out of reach
    const z = ZONES.wheat, dx = Math.max(0, Math.abs(c.x - z.cx) - z.rx * 1.2), dz = Math.max(0, Math.abs(c.z - z.cz) - z.rx * 1.2);
    if (!this._box) { this._box = new THREE.Box3(new THREE.Vector3(z.cx - z.rx * 1.3, -10, z.cz - z.rx * 1.3), new THREE.Vector3(z.cx + z.rx * 1.3, 15, z.cz + z.rx * 1.3)); this._fr = new THREE.Frustum(); this._pm = new THREE.Matrix4(); }
    game.camera.updateMatrixWorld();
    this._pm.multiplyMatrices(game.camera.projectionMatrix, game.camera.matrixWorldInverse);
    this._fr.setFromProjectionMatrix(this._pm);
    this.group.visible = Math.hypot(dx, dz) < 50 && this._fr.intersectsBox(this._box);
  }
}
