// GPU "memory" textures updated by stamping: one for trampled vegetation (grass/wheat bend
// direction, fresh and lasting flattening) and one for snow (how much depth was pushed out, and
// the berm of displaced snow around it). Both relax over time: grass springs back, wheat stays
// bent longer, and wind slowly refills footprints in the snow.
import * as THREE from 'three';

const V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MAX = 24;
const TICK = 0.1;
const CUT_MAX = 48;

const FRAG = {
  veg: `
    uniform sampler2D tPrev; uniform vec4 uRect; uniform float uDt; uniform int uCount; uniform vec4 uS[${MAX}]; uniform vec4 uS2[${MAX}]; varying vec2 vUv;
    void main(){
      vec4 p = texture2D(tPrev, vUv);
      vec2 w = uRect.xy + vUv * uRect.z;
      p.b = max(0.0, p.b - uDt * 0.22);       // fresh bend springs back in ~5 s
      p.a = max(0.0, p.a - uDt * 0.016);      // lasting lodging fades in about a minute
      for (int i = 0; i < ${MAX}; i++) {
        if (i >= uCount) break;
        vec4 s = uS[i]; vec2 d = w - s.xy; float r = length(d);
        float f = (1.0 - smoothstep(s.z * 0.45, s.z, r)) * s.w;
        if (f > 0.001) {
          vec2 out2 = d / max(r, 1e-3);
          vec2 dir = normalize(out2 * 0.55 + uS2[i].xy + 1e-4);
          p.xy = normalize(mix(p.xy, dir, clamp(f * 1.5, 0.0, 1.0)) + 1e-5);
          p.b = max(p.b, f);
          p.a = max(p.a, f * uS2[i].z);
        }
      }
      gl_FragColor = p;
    }`,
  snow: `
    uniform sampler2D tPrev; uniform vec4 uRect; uniform float uDt; uniform float uRefill; uniform int uCount; uniform vec4 uS[${MAX}]; uniform vec4 uS2[${MAX}]; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec4 p = texture2D(tPrev, vUv);
      vec2 w = uRect.xy + vUv * uRect.z;
      // drifting snow refills prints unevenly
      float drift = 0.4 + 1.2 * vn(w * 0.35);
      p.r = max(0.0, p.r - uDt * uRefill * drift);
      p.g = max(0.0, p.g - uDt * uRefill * 1.4);
      for (int i = 0; i < ${MAX}; i++) {
        if (i >= uCount) break;
        vec4 s = uS[i]; vec4 s2 = uS2[i];
        vec2 d = w - s.xy;
        float c = cos(s2.x), sn = sin(s2.x);
        vec2 l = vec2(c * d.x - sn * d.y, sn * d.x + c * d.y) / s.zw;
        float e = length(l);
        float f = (1.0 - smoothstep(0.5, 1.0, e)) * s2.y;
        float ring = smoothstep(0.85, 1.1, e) * (1.0 - smoothstep(1.15, 1.9, e)) * s2.y * s2.z;
        p.r = max(p.r, f);
        p.g = max(p.g, ring);
      }
      p.g *= 1.0 - p.r;
      gl_FragColor = p;
    }`,
};

// Where a blade has passed through grass and wheat: one value per texel, 1 is freshly cut down to
// stubble and 0 is uncut. It falls back toward 0 as the stalks grow again (GROW_TIME seconds from
// stubble to full height). The map wraps around the world every SIZE metres, so it stays sharp (SIZE /
// RES, about 12 cm a texel) wherever the player is: the grass and wheat only draw within 46 m of the
// camera, so two copies of one cut are never in view together.
// The regrowth is applied in coarse ticks, not every frame: the texture is half-float, and a single
// frame's worth of regrowth is smaller than the smallest step it can hold near 1.
const CUT = `
  uniform sampler2D tPrev; uniform float uSize, uDecay; uniform int uCount; uniform vec4 uS[${CUT_MAX}]; varying vec2 vUv;
  void main(){
    vec4 p = texture2D(tPrev, vUv);
    vec2 w = vUv * uSize;
    p.r = max(0.0, p.r - uDecay);
    for (int i = 0; i < ${CUT_MAX}; i++) {
      if (i >= uCount) break;
      vec4 s = uS[i]; vec2 d = w - s.xy; d -= uSize * floor(d / uSize + 0.5);
      float f = (1.0 - smoothstep(s.z * 0.6, s.z, length(d))) * s.w;
      p.r = max(p.r, f);
    }
    gl_FragColor = p;
  }`;

export class CutField {
  constructor(renderer, { res = 1024, size = 128, growTime = 90 } = {}) {
    this.r = renderer; this.size = size; this.res = res; this.growTime = growTime;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping };
    this.a = new THREE.WebGLRenderTarget(res, res, opts);
    this.b = new THREE.WebGLRenderTarget(res, res, opts);
    this.S = Array.from({ length: CUT_MAX }, () => new THREE.Vector4());
    this.count = 0; this.acc = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tPrev: { value: null }, uSize: { value: size }, uDecay: { value: 0 }, uCount: { value: 0 }, uS: { value: this.S } },
      vertexShader: V, fragmentShader: CUT, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const old = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of [this.a, this.b]) { renderer.setRenderTarget(t); renderer.clear(); }
    renderer.setRenderTarget(old); renderer.setClearColor(cc, ca);
    this.uniform = { value: this.a.texture };
    this.sizeUniform = { value: size };
  }

  // one disc of cut stalks at (x, z): radius in metres, strength 0..1
  stamp(x, z, r, strength = 1) {
    if (this.count >= CUT_MAX) return false;
    this.S[this.count++].set(x, z, r, strength);
    return true;
  }

  update(dt) {
    this.acc += dt;
    let decay = 0;
    if (this.acc >= 0.25) { decay = this.acc / this.growTime; this.acc = 0; }
    if (!this.count && !decay) return;
    this.mat.uniforms.tPrev.value = this.a.texture;
    this.mat.uniforms.uDecay.value = decay;
    this.mat.uniforms.uCount.value = this.count;
    const old = this.r.getRenderTarget();
    this.r.setRenderTarget(this.b); this.r.render(this.quad, this.cam); this.r.setRenderTarget(old);
    [this.a, this.b] = [this.b, this.a];
    this.uniform.value = this.a.texture;
    this.count = 0;
  }
}

export class StampField {
  constructor(renderer, { kind, res, minX, minZ, size, refill = 0 }) {
    this.r = renderer; this.kind = kind;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.a = new THREE.WebGLRenderTarget(res, res, opts);
    this.b = new THREE.WebGLRenderTarget(res, res, opts);
    this.rect = new THREE.Vector4(minX, minZ, size, 1 / size);
    this.S = Array.from({ length: MAX }, () => new THREE.Vector4());
    this.S2 = Array.from({ length: MAX }, () => new THREE.Vector4());
    this.count = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tPrev: { value: null }, uRect: { value: this.rect }, uDt: { value: 0 }, uRefill: { value: refill }, uCount: { value: 0 }, uS: { value: this.S }, uS2: { value: this.S2 } },
      vertexShader: V, fragmentShader: FRAG[kind], depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // clear both
    const old = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of [this.a, this.b]) { renderer.setRenderTarget(t); renderer.clear(); }
    renderer.setRenderTarget(old); renderer.setClearColor(cc, ca);
    this.uniform = { value: this.a.texture };
  }

  // veg: stamp(x, z, radius, strength, dirx, dirz, lasting)
  // snow: stamp(x, z, rx, rz, angle, strength, berm)
  stamp(...a) {
    if (this.count >= MAX) return;
    const i = this.count++;
    if (this.kind === 'veg') { this.S[i].set(a[0], a[1], a[2], a[3]); this.S2[i].set(a[4] || 0, a[5] || 0, a[6] || 0, 0); }
    else { this.S[i].set(a[0], a[1], a[2], a[3]); this.S2[i].set(a[4] || 0, a[5] ?? 1, a[6] ?? 1, 0); }
  }

  // The pass runs when there is something to stamp; otherwise the slow relaxing is saved up and applied every
  // TICK seconds (it is linear in time, so the result is the same; it just costs one pass in six, not every frame).
  update(dt) {
    this.acc = (this.acc || 0) + dt;
    if (!this.count && this.acc < TICK) return;
    dt = this.acc; this.acc = 0;
    this.mat.uniforms.tPrev.value = this.a.texture;
    this.mat.uniforms.uDt.value = dt;
    this.mat.uniforms.uCount.value = this.count;
    const old = this.r.getRenderTarget();
    this.r.setRenderTarget(this.b); this.r.render(this.quad, this.cam); this.r.setRenderTarget(old);
    [this.a, this.b] = [this.b, this.a];
    this.uniform.value = this.a.texture;
    this.count = 0;
  }
}
