// One wind field for everything: cloth, leaves, snow drift, grass and wheat waves.
// Gust fronts roll across the plain along the wind direction; the GLSL copy has the same shape.
import * as THREE from 'three';
import { vnoise } from './util.js';

export class Wind {
  constructor() {
    this.dir = new THREE.Vector2(-0.62, 0.78).normalize();
    this.base = 1.5;
    this.time = 0;
    this.uniforms = { uWindDir: { value: this.dir }, uWindTime: { value: 0 }, uWindBase: { value: this.base } };
    this._v = new THREE.Vector3();
  }
  update(dt) {
    this.time += dt;
    // the overall mood of the wind drifts slowly
    this.base = 1.3 + 0.9 * vnoise(this.time * 0.05, 3.7);
    this.uniforms.uWindTime.value = this.time;
    this.uniforms.uWindBase.value = this.base;
  }
  gust(x, z) {
    const s = x * this.dir.x + z * this.dir.y, c = -x * this.dir.y + z * this.dir.x;
    const front = Math.sin(s * 0.09 - this.time * 1.1 + Math.sin(c * 0.05) * 1.5) * 0.5 + 0.5;
    const n = vnoise(s * 0.05 - this.time * 0.5, c * 0.05);
    return this.base * (0.45 + 1.1 * front * front * n + 0.3 * n);
  }
  at(x, z, out = this._v) {
    const g = this.gust(x, z);
    return out.set(this.dir.x * g, 0, this.dir.y * g);
  }
}

export const GLSL_WIND = /* glsl */`
uniform vec2 uWindDir; uniform float uWindTime; uniform float uWindBase;
float wHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1,0)), u.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), u.x), u.y); }
float windGust(vec2 p){
  float s = dot(p, uWindDir), c = dot(p, vec2(-uWindDir.y, uWindDir.x));
  float front = sin(s * 0.09 - uWindTime * 1.1 + sin(c * 0.05) * 1.5) * 0.5 + 0.5;
  float n = wNoise(vec2(s * 0.05 - uWindTime * 0.5, c * 0.05));
  return uWindBase * (0.45 + 1.1 * front * front * n + 0.3 * n);
}
`;
