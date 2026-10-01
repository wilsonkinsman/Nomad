// CPU particles drawn as soft point sprites: snow spray, kicked dust, water droplets.
import * as THREE from 'three';
import { groundY } from './world.js';

const KINDS = {
  //         colour                 size   grow  drag  grav   life  alpha
  snow:  { col: [0.95, 0.97, 1.0], size: 0.09, grow: 0.25, drag: 2.6, grav: -4.5, life: 1.2, a: 0.85 },
  powder:{ col: [0.95, 0.97, 1.0], size: 0.22, grow: 0.9, drag: 3.5, grav: -0.8, life: 1.8, a: 0.4 },
  dust:  { col: [0.55, 0.47, 0.38], size: 0.14, grow: 0.6, drag: 3.0, grav: -0.6, life: 1.4, a: 0.35 },
  water: { col: [0.7, 0.75, 0.8], size: 0.03, grow: 0.0, drag: 0.8, grav: -9.8, life: 0.7, a: 0.8 },
  seed:  { col: [0.9, 0.8, 0.55], size: 0.02, grow: 0.0, drag: 4.5, grav: -0.9, life: 2.5, a: 0.9 },
  grass: { col: [0.42, 0.6, 0.22], size: 0.03, grow: 0.0, drag: 2.2, grav: -6.5, life: 0.9, a: 0.95 },
};

export class Particles {
  constructor(game, sprite, max = 2500) {
    this.game = game; this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.kind = new Array(max);
    this.size = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('color4', this.aCol); geo.setAttribute('size', this.aSize);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uSprite: { value: sprite }, uScale: { value: 800 }, uLight: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 color4; attribute float size; uniform float uScale; varying vec4 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * uScale / -mv.z, 1.0, 256.0); vC = color4; }`,
      fragmentShader: `uniform sampler2D uSprite; uniform vec3 uLight, uAmb; varying vec4 vC;
        void main(){ float a = texture2D(uSprite, gl_PointCoord).a * vC.a; if (a < 0.01) discard;
          gl_FragColor = vec4(vC.rgb * (uAmb + uLight), a); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    game.scene.add(this.points);
  }

  emit(kind, x, y, z, vx, vy, vz, spread = 0.5, count = 1) {
    const K = KINDS[kind];
    for (let c = 0; c < count; c++) {
      if (this.n >= this.max) return;
      const i = this.n++;
      this.p[i * 3] = x + (Math.random() - 0.5) * spread * 0.3; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z + (Math.random() - 0.5) * spread * 0.3;
      this.v[i * 3] = vx + (Math.random() - 0.5) * spread; this.v[i * 3 + 1] = vy * (0.6 + Math.random() * 0.8); this.v[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.life[i] = K.life * (0.6 + Math.random() * 0.8); this.age[i] = 0; this.kind[i] = K;
      this.size[i] = K.size * (0.6 + Math.random() * 0.9);
    }
  }

  update(dt, game) {
    const sky = game.sky;
    this.uniforms.uLight.value.copy(sky.lightColor).multiplyScalar(0.28 * Math.max(0.2, sky.lightDir.y * 2 + 0.3));
    this.uniforms.uAmb.value.setRGB(0.3, 0.33, 0.4).multiplyScalar(sky.night ? 0.25 : 0.9);
    this.uniforms.uScale.value = game.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(game.camera.fov) / 2));
    const w = game.wind;
    let j = 0;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const K = this.kind[i], k = i * 3;
      const wv = w.at(this.p[k], this.p[k + 2]);
      const dr = Math.exp(-K.drag * dt);
      this.v[k] = wv.x + (this.v[k] - wv.x) * dr;
      this.v[k + 1] = this.v[k + 1] * dr + K.grav * dt;
      this.v[k + 2] = wv.z + (this.v[k + 2] - wv.z) * dr;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      const gy = groundY(this.p[k], this.p[k + 2]) + (K === KINDS.snow || K === KINDS.powder ? (game.snow ? game.snow.topAt(this.p[k], this.p[k + 2]) : 0) : 0);
      if (this.p[k + 1] < gy) { this.p[k + 1] = gy; this.v[k + 1] = 0; this.v[k] *= 0.5; this.v[k + 2] *= 0.5; if (K === KINDS.water) this.age[i] = this.life[i]; }
      // compact alive particles to the front
      if (j !== i) {
        this.p[j * 3] = this.p[k]; this.p[j * 3 + 1] = this.p[k + 1]; this.p[j * 3 + 2] = this.p[k + 2];
        this.v[j * 3] = this.v[k]; this.v[j * 3 + 1] = this.v[k + 1]; this.v[j * 3 + 2] = this.v[k + 2];
        this.life[j] = this.life[i]; this.age[j] = this.age[i]; this.kind[j] = K; this.size[j] = this.size[i];
      }
      const t = this.age[j] / this.life[j];
      P[j * 3] = this.p[j * 3]; P[j * 3 + 1] = this.p[j * 3 + 1]; P[j * 3 + 2] = this.p[j * 3 + 2];
      C[j * 4] = K.col[0]; C[j * 4 + 1] = K.col[1]; C[j * 4 + 2] = K.col[2];
      C[j * 4 + 3] = K.a * Math.min(1, t * 8) * (1 - t) * (1 - t);
      S[j] = this.size[j] * (1 + K.grow * t * 3);
      j++;
    }
    this.n = j;
    this.points.geometry.setDrawRange(0, j);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }
}

// Fireflies drifting over the meadow on moonlit nights: GPU only, wrapped around the camera.
export class Fireflies {
  constructor(game, sprite) {
    this.game = game;
    const N = 260, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * 50; pos[i * 3 + 1] = 0.3 + Math.random() * 1.6; pos[i * 3 + 2] = Math.random() * 50; seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.U = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uSprite: { value: sprite }, uScale: { value: 800 }, uZone: { value: game.worldTex.zone }, uH: { value: game.worldTex.height } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float seed; uniform float uTime, uAmt, uScale; uniform vec3 uCam; uniform sampler2D uZone, uH; varying float vA;
        void main(){
          vec3 p = position;
          p.xz = mod(p.xz - uCam.xz + 25.0, 50.0) + uCam.xz - 25.0;
          p += vec3(sin(uTime * 0.4 + seed * 30.0), sin(uTime * 0.7 + seed * 11.0) * 0.4, cos(uTime * 0.35 + seed * 17.0)) * 0.8;
          vec2 uv = (p.xz + 200.0) / 400.0;
          float meadow = texture2D(uZone, uv).r + texture2D(uZone, uv).g * 0.7;
          vec2 f = clamp(p.xz + 200.0, vec2(0.0), vec2(399.0));
          p.y += texelFetch(uH, ivec2(f), 0).r;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = smoothstep(0.55, 1.0, sin(uTime * (0.8 + seed * 1.3) + seed * 40.0));
          vA = uAmt * blink * smoothstep(0.3, 0.8, meadow) * smoothstep(45.0, 8.0, -mv.z);
          gl_PointSize = clamp(0.09 * uScale / -mv.z, 1.5, 24.0);
        }`,
      fragmentShader: `uniform sampler2D uSprite; varying float vA; void main(){ float a = texture2D(uSprite, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a * 3.0, 1.0); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    game.scene.add(this.points);
  }
  update(dt, game) {
    const on = game.sky.night ? 1 : 0;
    this.U.uAmt.value += (on - this.U.uAmt.value) * Math.min(1, dt * 0.5);
    this.points.visible = this.U.uAmt.value > 0.01;
    this.U.uTime.value += dt; this.U.uCam.value.copy(game.camera.position);
    this.U.uScale.value = game.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(game.camera.fov) / 2));
  }
}
