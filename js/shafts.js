// Light through the canopy. The sun (or the moon) is a directional light with a shadow map, and the shadow
// map already knows exactly where the crowns and trunks stand, so the shafts are not drawn: they are found.
// The post pass marches along each view ray and asks the shadow map, step by step, whether the air there is
// in the light (post.js), and the motes below drift through the same lookup so they only glow inside a beam.
import * as THREE from 'three';
import { clamp } from './util.js';

// Is this point in the air lit by the light? 1 in the beam, 0 in shade, and 0 beyond the edge of the shadow
// map (which only covers the ground around the player), faded in over the last tenth so a beam never ends in a line.
export const GLSL_SHADOW_LIT = /* glsl */`
#include <packing>
uniform sampler2D tShadow; uniform mat4 uShadowMat;
float shadowLit(vec3 p){
  vec4 sc = uShadowMat * vec4(p, 1.0);
  vec3 q = sc.xyz / sc.w;
  vec2 e = min(q.xy, 1.0 - q.xy);
  float edge = smoothstep(0.0, 0.1, min(e.x, e.y)) * step(q.z, 1.0) * step(0.0, q.z);
  float sd = unpackRGBAToDepth(texture2D(tShadow, clamp(q.xy, 0.001, 0.999)));
  return step(q.z - 0.0005, sd) * edge;
}`;

// The deep wood's fog: thick on the floor, thinning upward, drifting in slow banks, and only over the wood (thinner in
// the glades, where the sun gets in). The fog pass asks it how much of what lies behind can still be seen; the shaft
// pass asks the same thing at every step of its march, so the beams form in exactly the fog that hides the far trunks
// and dim with it. uFogDensity is per metre at the floor in the heart of the wood.
export const GLSL_WOOD_FOG = /* glsl */`
uniform sampler2D uFogHeight, uFogZone; uniform float uFogDensity, uFogTime; uniform vec4 uFogBox;
float fN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 k = vec2(127.1, 311.7);
  float a = fract(sin(dot(i, k)) * 43758.55), b = fract(sin(dot(i + vec2(1.0, 0.0), k)) * 43758.55);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), k)) * 43758.55), d = fract(sin(dot(i + vec2(1.0, 1.0), k)) * 43758.55);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }
float woodFog(vec3 p){
  vec4 z2 = texture(uFogZone, (p.xz + 200.0) / 400.0);
  float wood = z2.r * (1.0 - 0.4 * z2.g);
  if (wood < 0.003) return 0.0;
  float h = max(p.y - texelFetch(uFogHeight, ivec2(clamp(p.xz + 200.0, vec2(0.0), vec2(399.0))), 0).r, 0.0);
  vec2 q = p.xz * 0.045 + vec2(uFogTime * 0.018, uFogTime * 0.007);
  float banks = 0.3 + 1.4 * fN(q) * fN(q * 2.7 + 5.3);
  return uFogDensity * wood * (exp(-h / 4.0) * banks + 0.45 * exp(-h / 22.0));
}
// the stretch (t0, t1) of the ray from o along d that is inside the wood's bounds; t0 >= t1 when it misses them
vec2 woodSpan(vec3 o, vec3 d){
  vec3 lo = vec3(uFogBox.x, -12.0, uFogBox.y), hi = vec3(uFogBox.z, 40.0, uFogBox.w);
  vec3 inv = 1.0 / mix(d, vec3(1e-6), vec3(lessThan(abs(d), vec3(1e-6))));
  vec3 a = (lo - o) * inv, b = (hi - o) * inv, mn = min(a, b), mx = max(a, b);
  return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
}
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

// the wood's fog, as uniforms both passes share (the same objects, so the banks drift in step)
export function woodFogUniforms(tex, zone) {
  const c = Math.cos(zone.rot), s = Math.sin(zone.rot);
  const hx = Math.hypot(zone.rx * c, zone.rz * s) * 1.15, hz = Math.hypot(zone.rx * s, zone.rz * c) * 1.15;
  return {
    uFogHeight: { value: tex.height }, uFogZone: { value: tex.zone2 }, uFogDensity: { value: 0 }, uFogTime: { value: 0 },
    uFogBox: { value: new THREE.Vector4(zone.cx - hx, zone.cz - hz, zone.cx + hx, zone.cz + hz) },
  };
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;

// where the light's shadow map is this frame (it is made on the first render and again after a quality change)
export function bindShadow(U, light) {
  const map = light.shadow.map;
  U.tShadow.value = map ? map.texture : WHITE;
  U.uShadowMat.value.copy(light.shadow.matrix);
  return !!map;
}

// Dust, pollen and bits of leaf hanging in the air, wrapped around the camera. Each one is lit only where a beam
// touches it, so they appear and vanish as they drift through the shafts.
export class Motes {
  constructor(game, sprite, count = 900) {
    this.game = game; this.count = count; this.max = count;
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.U = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBase: { value: 0 }, uAmt: { value: 0 }, uScale: { value: 800 },
      uSprite: { value: sprite }, uLightCol: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() },
      tShadow: { value: WHITE }, uShadowMat: { value: new THREE.Matrix4() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 seed; uniform float uTime, uBase, uAmt, uScale; uniform vec3 uCam; uniform vec2 uWind;
        ${GLSL_SHADOW_LIT}
        varying float vA;
        void main(){
          vec3 p = vec3(seed.x * 46.0, pow(seed.y, 1.4) * 17.0, seed.z * 46.0);
          float ph = seed.x * 61.0 + seed.z * 37.0;
          p.xz += uWind * uTime * 0.12 + vec2(sin(uTime * 0.31 + ph), cos(uTime * 0.27 + ph * 1.3)) * 1.1;
          p.y += sin(uTime * 0.23 + ph * 0.7) * 0.8 - uTime * 0.02;
          p.xz = mod(p.xz - uCam.xz + 23.0, 46.0) + uCam.xz - 23.0;
          p.y = mod(p.y, 17.0) + uBase;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.55 + 0.45 * sin(uTime * (0.9 + seed.y * 2.0) + ph * 3.0);
          vA = uAmt * shadowLit(p) * tw * (0.35 + 0.65 * seed.y) * smoothstep(38.0, 5.0, -mv.z);
          gl_PointSize = clamp((0.03 + seed.z * 0.05) * uScale / -mv.z, 1.5, 11.0);
        }`,
      fragmentShader: `uniform sampler2D uSprite; uniform vec3 uLightCol; varying float vA;
        void main(){ float a = texture2D(uSprite, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(uLightCol * a, 1.0); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    game.scene.add(this.points);
  }

  setQuality(q) { this.count = Math.round(this.max * q.veg); this.points.geometry.setDrawRange(0, this.count); }

  update(dt, game, amt) {
    const U = this.U, sky = game.sky;
    U.uTime.value += dt; U.uCam.value.copy(game.camera.position);
    U.uBase.value = game.player.pos.y - 1;
    U.uWind.value.copy(game.wind.dir).multiplyScalar(game.wind.base);
    U.uScale.value = game.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(game.camera.fov) / 2));
    // the light's own colour, brightened: a speck of dust is brighter than the air around it
    U.uLightCol.value.set(sky.lightColor.r, sky.lightColor.g, sky.lightColor.b).multiplyScalar(sky.night ? 0.9 : 0.55);
    const ok = bindShadow(U, sky.light);
    U.uAmt.value = ok ? clamp(amt, 0, 1) : 0;
    this.points.visible = U.uAmt.value > 0.01;
  }
}
