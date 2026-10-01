// Meadow grass: two rings of blades that wrap around the camera (nothing stored per blade;
// every blade is rebuilt in the vertex shader from its instance id and world position).
// Blades bend with the wind gust fronts, part around the nomad, and stay flattened along his
// trail until they spring back. Backlit blades glow at sunrise.
import * as THREE from 'three';
import { GLSL_WORLD } from './world.js';
import { GLSL_WIND } from './wind.js';
import { GLSL_NOISE } from './util.js';

export const GLSL_TRAMPLE = /* glsl */`
uniform sampler2D uTrample; uniform vec4 uTrampleRect;
vec4 trampleAt(vec2 p){ vec2 uv = (p - uTrampleRect.xy) * uTrampleRect.w; if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0); return texture(uTrample, uv); }
`;

// translucency for thin foliage, added to three's direct light loop (shadowed light only)
export function addTranslucency(shader, amountExpr) {
  shader.fragmentShader = shader.fragmentShader.replace(
    /RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);/g,
    `RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
     reflectedLight.directDiffuse += material.diffuseColor * directLight.color * (${amountExpr}) * pow(saturate(dot(-geometryViewDir, directLight.direction)), 3.0) * 1.6
       + material.diffuseColor * directLight.color * (${amountExpr}) * 0.25 * saturate(-dot(geometryNormal, directLight.direction));`);
}

function bladeGeometry(segs) {
  const pos = [], idx = [];
  for (let i = 0; i < segs; i++) { const t = i / segs; pos.push(-0.5, t, 0, 0.5, t, 0); }
  pos.push(0, 1, 0);
  for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const a = (segs - 1) * 2; idx.push(a, a + 1, segs * 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export class Grass {
  constructor(game) {
    this.game = game;
    const tex = game.worldTex;
    this.shared = {
      uHeightTex: { value: tex.height }, uZoneTex: { value: tex.zone }, uPathTex: { value: tex.path },
      uTrample: game.trample.uniform, uTrampleRect: { value: game.trample.rect },
      uCut: game.cut.uniform, uCutSize: game.cut.sizeUniform,       // where the blade has cut (and how recently)
      uPlayer: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector2() },
      ...game.wind.uniforms,
    };
    this.rings = [];
    // near: dense short blades; far: sparser, wider blades that fade out into the ground colour
    this.defs = [
      { grid: 300, size: 30, near: 0, far: 15, width: 0.034, segs: 5 },
      { grid: 230, size: 84, near: 13, far: 40, width: 0.075, segs: 3 },
    ];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.build(1);
  }

  build(q) {
    for (const r of this.rings) { this.group.remove(r); r.geometry.dispose(); r.material.dispose(); }
    this.rings = [];
    for (const d of this.defs) {
      const grid = Math.round(d.grid * Math.sqrt(q));
      const spacing = d.size / grid;
      const geo = bladeGeometry(d.segs);
      geo.instanceCount = grid * grid;
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
      const U = { ...this.shared, uGrid: { value: grid }, uSize: { value: d.size }, uSpacing: { value: spacing },
        uNear: { value: d.near }, uFar: { value: d.far }, uWidth: { value: d.width * Math.sqrt(1 / q) } };
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, U);
        s.vertexShader = s.vertexShader
          .replace('#include <common>', `#include <common>
            ${GLSL_WORLD} ${GLSL_WIND} ${GLSL_NOISE} ${GLSL_TRAMPLE}
            uniform int uGrid; uniform float uSize, uSpacing, uNear, uFar, uWidth, uCutSize; uniform vec2 uCenter; uniform vec3 uPlayer; uniform sampler2D uCut;
            varying float vT, vCut; varying vec3 vTint;`)
          .replace('#include <beginnormal_vertex>', `
            int gid = gl_InstanceID;
            vec2 cell = vec2(float(gid % uGrid), float(gid / uGrid));
            vec2 local = (cell + nHash22(cell * 1.13 + 0.7)) * uSpacing;
            vec2 wxz = local + uSize * floor((uCenter - local) / uSize + 0.5);
            vec2 wcell = floor(wxz / uSpacing);
            float r1 = nHash12(wcell * 1.37 + 3.1), r2 = nHash12(wcell * 0.71 + 7.3), r3 = nHash12(wcell + 11.1);
            vec4 zn = worldZone(wxz); vec4 pt = worldPath(wxz);
            float dens = zn.r * (1.0 - smoothstep(0.2, 0.6, pt.r)) * (1.0 - smoothstep(0.05, 0.35, zn.a));
            dens = max(dens, zn.b * 0.1 * (1.0 - pt.r));     // a few tufts poke through the leaves
            float dist = length(wxz - uCenter);
            float fade = smoothstep(uNear * 0.85, uNear, dist) * (1.0 - smoothstep(uFar * 0.72, uFar, dist));
            if (uNear < 0.5) fade = 1.0 - smoothstep(uFar * 0.72, uFar, dist);
            float k = clamp((dens * fade - r3 * 0.55) * 4.0, 0.0, 1.0);
            float patchN = nNoise(wxz * 0.13);
            float hgt = mix(0.22, 0.6, r1) * (0.6 + 0.8 * patchN) * k * (1.0 + pt.a * 0.3);
            // cut: stubble stays low for a while and then grows back, each blade a little out of step
            float cutK = smoothstep(0.04, 0.6, texture(uCut, fract(wxz / uCutSize)).r + (r3 - 0.5) * 0.3);
            hgt *= 1.0 - 0.88 * cutK;
            float wid = uWidth * mix(0.7, 1.35, r2) * step(0.001, k);
            float yaw = r2 * 6.2831;
            vec2 fdir = vec2(sin(yaw), cos(yaw)), sdir = vec2(fdir.y, -fdir.x);
            float t = position.y;
            vec2 bend = fdir * (0.25 + 0.4 * r1);
            float gust = windGust(wxz);
            bend += uWindDir * (0.12 + 0.24 * gust + 0.1 * sin(uWindTime * 2.6 + dot(wxz, vec2(0.8, 0.5)) * 1.4 + r1 * 6.0));
            vec4 tr = trampleAt(wxz);
            float flat_ = max(tr.z, tr.w * 0.5);
            bend = mix(bend, tr.xy * 1.55, clamp(flat_, 0.0, 1.0));
            vec2 toP = wxz - uPlayer.xz; float pd = length(toP);
            float push = (1.0 - smoothstep(0.12, 0.6, pd)) * step(abs(uPlayer.y - worldHeight(wxz)), 0.6);
            bend += toP / max(pd, 1e-3) * push * 1.3;
            bend *= 1.0 - 0.7 * cutK;                 // stubble stands stiff
            float bl = length(bend); vec2 bd = bend / max(bl, 1e-4);
            float th = min(bl, 1.5) * (0.3 + 0.7 * t);
            vec3 base = vec3(wxz.x, worldHeight(wxz) - 0.02, wxz.y);
            vec3 up = vec3(0.0, 1.0, 0.0), b3 = vec3(bd.x, 0.0, bd.y), s3 = vec3(sdir.x, 0.0, sdir.y);
            vec3 bladeP = base + up * (hgt * t * cos(th)) + b3 * (hgt * t * sin(th)) + s3 * position.x * wid * (1.0 - t * mix(0.88, 0.3, cutK));
            vec3 tang = normalize(up * cos(th) + b3 * sin(th));
            vec3 objectNormal = normalize(cross(s3, tang));
            objectNormal = normalize(objectNormal + s3 * position.x * 1.4 + up * 0.35);
            vT = t; vCut = cutK;
            float dry = smoothstep(0.35, 0.8, pt.a + (r3 - 0.5) * 0.4);
            vTint = vec3(r1, dry, patchN);
            #ifdef USE_TANGENT
              vec3 objectTangent = vec3( tangent.xyz );
            #endif`)
          .replace('#include <begin_vertex>', 'vec3 transformed = bladeP;');
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vT, vCut; varying vec3 vTint;')
          .replace('#include <map_fragment>', `
            vec3 lush = mix(vec3(0.035, 0.07, 0.014), vec3(0.13, 0.2, 0.045), vT);
            vec3 dryc = mix(vec3(0.07, 0.06, 0.02), vec3(0.3, 0.25, 0.1), vT);
            vec3 gc = mix(lush, dryc, vTint.y * 0.7);
            gc *= mix(0.75, 1.2, vTint.x) * mix(0.85, 1.1, vTint.z);
            gc = mix(gc, gc * vec3(1.4, 1.3, 0.85) + vec3(0.025, 0.03, 0.0), vCut * 0.75);     // the cut ends show pale
            diffuseColor.rgb = gc * mix(0.45, 1.0, smoothstep(0.0, 0.5, vT));`);
        addTranslucency(s, '0.55 * vT');
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.rings.push(mesh);
    }
  }

  setQuality(q) { if (q.veg !== this.q) { this.q = q.veg; this.build(q.veg); } }

  update(dt, game) {
    const c = game.camera.position;
    this.shared.uCenter.value.set(c.x, c.z);
    this.shared.uPlayer.value.copy(game.player.pos);
  }
}
