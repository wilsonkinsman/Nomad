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
