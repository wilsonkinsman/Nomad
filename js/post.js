// Frame pipeline: HDR scene (MSAA, with depth) -> light shafts through the canopy (marched through the shadow
// map and the wood's fog) -> height fog + ground mist + sun scattering + the deep wood's fog -> crepuscular rays ->
// bloom -> exposure, ACES, grade, vignette -> screen.
import * as THREE from 'three';
import { GLSL_SHADOW_LIT, GLSL_WOOD_FOG, bindShadow, woodFogUniforms } from './shafts.js';
import { ZONES } from './world.js';

const V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const quadGeo = new THREE.PlaneGeometry(2, 2);
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class Quad {
  constructor(mat) { this.mesh = new THREE.Mesh(quadGeo, mat); this.mesh.frustumCulled = false; this.mat = mat; }
  render(r, target) { r.setRenderTarget(target); r.render(this.mesh, quadCam); }
}
const shader = (uniforms, frag, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: V, fragmentShader: frag, depthTest: false, depthWrite: false, ...extra });

const WOOD_TINT_DAY = new THREE.Vector3(0.42, 0.52, 0.5), WOOD_TINT_NIGHT = new THREE.Vector3(0.9, 1.0, 1.2);
const SKYUV = `vec2 skyUV(vec3 d){ float u = atan(d.z, d.x) / 6.2831853 + 0.5; float e = asin(clamp(d.y, -1.0, 1.0)); return vec2(u, 0.5 + 0.5 * sign(e) * sqrt(abs(e) / 1.5707963)); }`;

export class Pipeline {
  constructor(renderer, scene, camera, sky, tex) {
    this.r = renderer; this.scene = scene; this.camera = camera; this.sky = sky; this.tex = tex;
    this.msaa = 4;
    this.shaftDiv = 2;            // the shafts are marched at 1/2 size (1/4 on low)
    this.woodFog = 0.07;          // how thick the fog on the floor of the deep wood is, per metre (0.02: a haze; 0.12: you can't see 15 m)
    this.shaftGain = 1.6;         // how brightly that fog lights up where the sun or the moon gets through the canopy
    this.bloomStrength = 0.07;
    this.w = 1; this.h = 1;
    const hf = { type: THREE.HalfFloatType, depthBuffer: false };
    this.hdr = new THREE.WebGLRenderTarget(1, 1, hf);
    this.rayA = new THREE.WebGLRenderTarget(1, 1, hf);
    this.rayB = new THREE.WebGLRenderTarget(1, 1, hf);
    this.shaftRT = new THREE.WebGLRenderTarget(1, 1, hf);
    this.mips = [];
    for (let i = 0; i < 6; i++) this.mips.push(new THREE.WebGLRenderTarget(1, 1, hf));
    this._makeScene(1, 1);

    this.sunUV = new THREE.Vector2();
    this.fogU = {
      tColor: { value: null }, tDepth: { value: null }, tRays: { value: this.rayB.texture }, tSky: { value: sky.lut.texture },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: sky.lightDir }, uSunCol: { value: new THREE.Vector3() },
      uHaze: { value: sky.fog.haze }, uMist: { value: sky.fog.mist }, uScatter: { value: 1 }, uRays: { value: 0 }, uTime: { value: 0 }, uIndoor: { value: 0 },
      tShafts: { value: this.shaftRT.texture }, uShafts: { value: 0 }, uForest: { value: 0 }, uShaftTexel: { value: new THREE.Vector2() },
      uWoodTint: { value: new THREE.Vector3() },
    };
    const fogW = tex ? woodFogUniforms(tex, ZONES.forest) : null;
    if (fogW) Object.assign(this.fogU, fogW);
    // light shafts: for every pixel, walk the view ray out to what it hits and add up the light scattered by the
    // haze at the steps that are in the sun (or the moon), asking the shadow map whether each step is
    this.shaftU = {
      tDepth: { value: null }, tShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uLightDir: { value: sky.lightDir }, uLightCol: { value: new THREE.Vector3() },
      uAmt: { value: 0 }, uMaxDist: { value: 56 }, ...fogW,
    };
    this.shafts = new Quad(shader(this.shaftU, `
      ${GLSL_SHADOW_LIT}
      ${GLSL_WOOD_FOG}
      uniform sampler2D tDepth; uniform mat4 uInvProj, uCamWorld; uniform vec3 uCamPos, uLightDir, uLightCol;
      uniform float uAmt, uMaxDist; varying vec2 vUv;
      void main(){
        float z = texture2D(tDepth, vUv).r;
        vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vp /= vp.w;
        vec3 rd = (uCamWorld * vp).xyz - uCamPos; float d = length(rd); rd /= d;
        d = min(z >= 0.9999999 ? uMaxDist : d, uMaxDist);
        // only the stretch of the ray that is in the wood's air is walked
        vec2 ws = woodSpan(uCamPos, rd);
        float t0 = max(ws.x, 0.0), t1 = min(ws.y, d);
        if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        const int N = 30;
        float stepL = (t1 - t0) / float(N), j = ign(gl_FragCoord.xy);
        // looking toward the light the fog glares; from the side it still shows
        float mu = dot(rd, uLightDir), g = 0.55;
        float hg = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
        float phase = 0.5 * 0.0796 + 0.5 * hg;
        // the light the fog scatters toward the eye where it is lit, less what the fog in front takes away again
        float acc = 0.0, T = 1.0;
        for (int i = 0; i < N; i++){
          vec3 p = uCamPos + rd * (t0 + (float(i) + j) * stepL);
          float s = woodFog(p) * stepL;
          if (s <= 0.0) continue;
          acc += shadowLit(p) * T * (1.0 - exp(-s));
          T *= exp(-s);
          if (T < 0.01) break;
        }
        gl_FragColor = vec4(uLightCol * (acc * phase * uAmt), 1.0);
      }`));

    this.fog = new Quad(shader(this.fogU, `
      uniform sampler2D tColor, tDepth, tRays, tSky, tShafts; uniform mat4 uInvProj, uCamWorld; uniform vec3 uCamPos, uSunDir, uSunCol;
      uniform vec4 uHaze, uMist; uniform float uScatter, uRays, uTime, uIndoor, uShafts, uForest; uniform vec2 uShaftTexel; uniform vec3 uWoodTint; varying vec2 vUv;
      ${SKYUV}
      ${GLSL_WOOD_FOG}
      float od(vec4 f, float y0, float dy, float d){
        float k = f.y * dy; float base = f.x * exp(-f.y * (y0 - f.z));
        return abs(k) > 1e-4 ? base * (1.0 - exp(-k * d)) / k : base * d;
      }
      float nh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(nh(i), nh(i+vec2(1,0)), f.x), mix(nh(i+vec2(0,1)), nh(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec3 col = texture2D(tColor, vUv).rgb;
        float z = texture2D(tDepth, vUv).r;
        vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vp /= vp.w;
        vec3 wp = (uCamWorld * vp).xyz;
        vec3 rd = wp - uCamPos; float d = length(rd); rd /= d;
        bool isSky = z >= 0.9999999;
        if (isSky) d = 5000.0;
        // mist drifts: thicker in slow-moving banks
        vec2 mp = (uCamPos.xz + rd.xz * min(d, 60.0)) * 0.03 + uTime * vec2(0.012, 0.004);
        float bank = 0.55 + 0.9 * vn(mp) * vn(mp * 2.3 + 4.0);
        vec4 mist = uMist; mist.x *= bank;
        // (indoors there is no mist, and the haze is only what lies beyond the doorway)
        float o = od(uHaze, uCamPos.y, rd.y, d) + od(mist, uCamPos.y, rd.y, min(d, 900.0)) * (1.0 - uIndoor * smoothstep(12.0, 4.0, d));
        float T = exp(-o);
        if (isSky) T = mix(T, 1.0, 0.55);
        vec3 fogCol = texture2D(tSky, skyUV(normalize(vec3(rd.x, max(rd.y, 0.02), rd.z)))).rgb;
        float mu = dot(rd, uSunDir), g = 0.62;
        float hg = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*mu, 1.5) / 12.566;
        vec3 ins = fogCol * 0.95 + uSunCol * hg * uScatter * 0.32;
        ins *= mix(vec3(1.0), vec3(0.3, 0.52, 0.6), uForest);         // under the canopy the haze is shade, not sunrise
        col = col * T + ins * (1.0 - T);
        // the deep wood's fog, walked through wherever the ray crosses the wood: lit by the sky through the canopy
        // (the beams of sun and moon in it are added below, from the shaft pass)
        vec2 ws = woodSpan(uCamPos, rd);
        float t0 = max(ws.x, 0.0), t1 = min(ws.y, min(d, 320.0));
        if (t1 > t0 && uFogDensity > 0.0) {
          const int NW = 16;
          float st = (t1 - t0) / float(NW), jw = ign(gl_FragCoord.xy), odw = 0.0;
          for (int i = 0; i < NW; i++) odw += woodFog(uCamPos + rd * (t0 + (float(i) + jw) * st));
          float Tw = exp(-odw * st);
          vec3 sky = texture2D(tSky, skyUV(vec3(0.0, 1.0, 0.0))).rgb * 0.5 + texture2D(tSky, skyUV(normalize(vec3(rd.x, 0.08, rd.z)))).rgb * 0.5;
          col = col * Tw + sky * uWoodTint * (1.0 - Tw);
        }
        col += texture2D(tRays, vUv).rgb * uRays;
        // the shafts come from a small, jittered buffer: four taps between its texels smooth the grain away
        vec3 sh4 = (texture2D(tShafts, vUv + uShaftTexel * vec2(-0.75, -0.75)).rgb + texture2D(tShafts, vUv + uShaftTexel * vec2(0.75, -0.75)).rgb
                  + texture2D(tShafts, vUv + uShaftTexel * vec2(-0.75, 0.75)).rgb + texture2D(tShafts, vUv + uShaftTexel * vec2(0.75, 0.75)).rgb) * 0.25;
        col += sh4 * uShafts;
        gl_FragColor = vec4(col, 1.0);
      }`));

    this.maskU = { tColor: { value: null }, tDepth: { value: null }, uSun: { value: this.sunUV }, uAspect: { value: 1 } };
    this.mask = new Quad(shader(this.maskU, `
      uniform sampler2D tColor, tDepth; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
      void main(){
        float z = texture2D(tDepth, vUv).r;
        vec3 c = texture2D(tColor, vUv).rgb;
        vec2 dd = vUv - uSun; dd.x *= uAspect;
        float w = exp(-dot(dd, dd) * 9.0);
        float sky = step(0.9999999, z);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(min(c, vec3(8.0)) * sky * w * smoothstep(0.2, 3.0, l), 1.0);
      }`));
    this.blurU = { tDiffuse: { value: null }, uSun: { value: this.sunUV }, uStep: { value: 1 } };
    this.blur = new Quad(shader(this.blurU, `
      uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStep; varying vec2 vUv;
      void main(){
        vec2 delta = (vUv - uSun) * (uStep / 40.0);
        vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 40; i++){ acc += texture2D(tDiffuse, uv).rgb * decay; wsum += decay; uv -= delta; decay *= 0.96; }
        gl_FragColor = vec4(acc / wsum * 1.6, 1.0);
      }`));

    // bloom
    this.preU = { tDiffuse: { value: null }, uThresh: { value: 1.2 } };
    this.pre = new Quad(shader(this.preU, `uniform sampler2D tDiffuse; uniform float uThresh; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float b = max(c.r, max(c.g, c.b));
        float soft = clamp(b - uThresh * 0.5, 0.0, uThresh); soft = soft * soft / (4.0 * uThresh + 1e-4);
        float k = max(soft, b - uThresh) / max(b, 1e-4); gl_FragColor = vec4(min(c * k, vec3(60.0)), 1.0); }`));
    this.downU = { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } };
    this.down = new Quad(shader(this.downU, `uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec3 s = texture2D(tDiffuse, vUv).rgb * 4.0;
        s += texture2D(tDiffuse, vUv + uTexel * vec2(-1,-1)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(1,-1)).rgb;
        s += texture2D(tDiffuse, vUv + uTexel * vec2(-1,1)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(1,1)).rgb;
        gl_FragColor = vec4(s / 8.0, 1.0); }`));
    this.upU = { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } };
    this.up = new Quad(shader(this.upU, `uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec2 t = uTexel; vec3 s = vec3(0.0);
        s += texture2D(tDiffuse, vUv + vec2(-2.0*t.x, 0)).rgb + texture2D(tDiffuse, vUv + vec2(2.0*t.x, 0)).rgb;
        s += texture2D(tDiffuse, vUv + vec2(0, -2.0*t.y)).rgb + texture2D(tDiffuse, vUv + vec2(0, 2.0*t.y)).rgb;
        s += (texture2D(tDiffuse, vUv + vec2(-t.x, t.y)).rgb + texture2D(tDiffuse, vUv + vec2(t.x, t.y)).rgb
            + texture2D(tDiffuse, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tDiffuse, vUv + vec2(t.x, -t.y)).rgb) * 2.0;
        gl_FragColor = vec4(s / 12.0, 1.0); }`, { blending: THREE.AdditiveBlending, transparent: true }));

    // eye adaptation: average log luminance of the frame, eased over time (all on the GPU)
    this.lumA = new THREE.WebGLRenderTarget(1, 1, hf);
    this.lumB = new THREE.WebGLRenderTarget(1, 1, hf);
    this.adaptRef = 0.1;
    this.lumU = { tHdr: { value: null }, tPrev: { value: null }, uRate: { value: 1 } };
    this.lum = new Quad(shader(this.lumU, `uniform sampler2D tHdr, tPrev; uniform float uRate; varying vec2 vUv;
      void main(){
        float acc = 0.0, wsum = 0.0;
        for (int y = 0; y < 10; y++) for (int x = 0; x < 10; x++) {
          vec2 uv = (vec2(float(x), float(y)) + 0.5) / 10.0;
          float w = 1.0 - 0.6 * length(uv - 0.5);
          float l = dot(texture2D(tHdr, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
          acc += log(max(l, 1e-4)) * w; wsum += w;
        }
        float cur = exp(acc / wsum);
        float prev = texture2D(tPrev, vec2(0.5)).r;
        float v = prev <= 0.0 ? cur : mix(prev, cur, uRate);
        gl_FragColor = vec4(v, cur, 0.0, 1.0);
      }`));
    this.finalU = {
      tHdr: { value: this.hdr.texture }, tBloom: { value: this.mips[0].texture }, tLum: { value: this.lumA.texture }, uRef: { value: 0.9 }, uAdapt: { value: 1 },
      uBloom: { value: this.bloomStrength }, uExposure: { value: 1 }, uTime: { value: 0 }, uNight: { value: 0 },
      uFade: { value: 1 }, uSat: { value: 1.0 }, uForest: { value: 0 },
    };
    this.final = new Quad(shader(this.finalU, `
      uniform sampler2D tHdr, tBloom, tLum; uniform float uBloom, uExposure, uTime, uNight, uFade, uSat, uRef, uAdapt, uForest; varying vec2 vUv;
      vec3 aces(vec3 v){
        const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        v = i * v; vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return clamp(o * (a / b), 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        // faint chromatic fringe toward the edges, like a real lens
        vec2 ca = d * dot(d, d) * 0.012;
        vec3 c = vec3(texture2D(tHdr, vUv - ca).r, texture2D(tHdr, vUv).g, texture2D(tHdr, vUv + ca).b);
        c += texture2D(tBloom, vUv).rgb * uBloom;
        float lum = texture2D(tLum, vec2(0.5)).r;
        c *= uExposure * mix(1.0, clamp(pow(uRef / max(lum, 1e-4), 0.55), 0.55, 1.5), uAdapt);
        c = aces(c);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        // split tone: warm highlights, cool shadows (moonlit nights go blue)
        vec3 sh = mix(vec3(0.96, 0.99, 1.06), vec3(0.9, 0.97, 1.12), uNight);
        vec3 hi = mix(vec3(1.05, 1.0, 0.93), vec3(0.97, 1.0, 1.04), uNight);
        c *= mix(sh, hi, smoothstep(0.05, 0.6, l));
        // under the canopy the shade goes cool and green
        c *= mix(vec3(1.0), vec3(0.93, 1.02, 1.0), uForest * 0.7);
        c *= 1.0 - dot(d, d) * 0.75;
        c = toSRGB(clamp(c, 0.0, 1.0));
        c += (h(vUv * 1000.0) - 0.5) * (1.5 / 255.0) + (h(vUv * 777.0 + 3.0) - 0.5) * 0.012;
        gl_FragColor = vec4(c * uFade, 1.0);
      }`));
  }

  _makeScene(w, h) {
    if (this.sceneRT) this.sceneRT.dispose();
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.msaa, depthTexture: depth });
  }

  readLum() {
    const b = new Uint16Array(4);
    this.r.readRenderTargetPixels(this.lumA, 0, 0, 1, 1, b);
    return [THREE.DataUtils.fromHalfFloat(b[0]), THREE.DataUtils.fromHalfFloat(b[1])];
  }

  setQuality(msaa) { this.msaa = msaa; this._makeScene(this.w, this.h); }

  setSize(w, h) {
    this.w = w; this.h = h;
    this._makeScene(w, h);
    this.hdr.setSize(w, h);
    this.rayA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.rayB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.shaftRT.setSize(Math.max(1, Math.floor(w / this.shaftDiv)), Math.max(1, Math.floor(h / this.shaftDiv)));
    this.fogU.uShaftTexel.value.set(1 / this.shaftRT.width, 1 / this.shaftRT.height);
    let mw = w >> 1, mh = h >> 1;
    for (const m of this.mips) { m.setSize(Math.max(1, mw), Math.max(1, mh)); mw >>= 1; mh >>= 1; }
    this.maskU.uAspect.value = w / Math.max(1, h);
  }

  render(dt, fade = 1) {
    const r = this.r, cam = this.camera, sky = this.sky;
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);

    // sun position on screen for the rays
    const L = sky.lightDir;
    const p = new THREE.Vector3().copy(cam.position).addScaledVector(L, 1000).project(cam);
    this.sunUV.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const facing = new THREE.Vector3(); cam.getWorldDirection(facing);
    const inView = THREE.MathUtils.smoothstep(facing.dot(L), 0.1, 0.6) * (p.z < 1 ? 1 : 0);
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    const rays = sky.fog.rays * inView * (1 - THREE.MathUtils.smoothstep(edge, 1.1, 1.8));
    if (rays > 0.001) {
      this.maskU.tColor.value = this.sceneRT.texture; this.maskU.tDepth.value = this.sceneRT.depthTexture;
      this.mask.render(r, this.rayA);
      this.blurU.tDiffuse.value = this.rayA.texture; this.blurU.uStep.value = 0.9; this.blur.render(r, this.rayB);
      this.blurU.tDiffuse.value = this.rayB.texture; this.blurU.uStep.value = 0.35; this.blur.render(r, this.rayA);
      this.fogU.tRays.value = this.rayA.texture;
    }
    this.fogU.uRays.value = rays * 0.9;

    // the deep wood's fog (its uniforms are shared by the shaft pass and the fog pass)
    const f = this.fogU;
    if (f.uFogDensity) {
      f.uFogDensity.value = this.woodFog;                          // (seen from anywhere: only rays that cross the wood walk it)
      f.uFogTime.value += dt;
      // the fog under the trees is lit by the sky through the leaves: grey-green by day, a cold blue under the moon
      f.uWoodTint.value.copy(sky.night ? WOOD_TINT_NIGHT : WOOD_TINT_DAY);
    }

    // the shafts the canopy cuts (only where there is a wood to cut them), found through the light's shadow map
    const sf = this.shaftU;
    let shafts = 0;
    if (sky.fog.shafts > 0.01 && this.tex) {
      sf.tDepth.value = this.sceneRT.depthTexture;
      if (bindShadow(sf, sky.light)) {
        sf.uInvProj.value.copy(cam.projectionMatrixInverse); sf.uCamWorld.value.copy(cam.matrixWorld); sf.uCamPos.value.copy(cam.position);
        sf.uLightCol.value.set(sky.lightColor.r, sky.lightColor.g, sky.lightColor.b);
        sf.uAmt.value = sky.fog.shafts * this.shaftGain * (sky.night ? 1.8 : 1);       // the moon is a thin light: its beams get a little help
        this.shafts.render(r, this.shaftRT);
        shafts = 1;
      }
    }

    f.uShafts.value = shafts; f.uForest.value = sky.forest;
    f.tColor.value = this.sceneRT.texture; f.tDepth.value = this.sceneRT.depthTexture;
    f.uInvProj.value.copy(cam.projectionMatrixInverse); f.uCamWorld.value.copy(cam.matrixWorld);
    f.uCamPos.value.copy(cam.position);
    f.uSunCol.value.set(sky.lightColor.r, sky.lightColor.g, sky.lightColor.b);
    f.uScatter.value = sky.fog.scatter;
    f.uIndoor.value = this.indoor || 0;           // (set by the camera: how far indoors it is)
    f.uTime.value += dt;
    this.fog.render(r, this.hdr);

    // eye adaptation
    this.lumU.tHdr.value = this.hdr.texture; this.lumU.tPrev.value = this.lumA.texture;
    this.lumU.uRate.value = this.snapAdapt ? 1 : 1 - Math.exp(-dt * 1.6);
    this.snapAdapt = false;
    this.lum.render(r, this.lumB);
    [this.lumA, this.lumB] = [this.lumB, this.lumA];
    this.finalU.tLum.value = this.lumA.texture;

    // bloom chain
    this.preU.tDiffuse.value = this.hdr.texture;
    this.pre.render(r, this.mips[0]);
    for (let i = 1; i < this.mips.length; i++) {
      const src = this.mips[i - 1];
      this.downU.tDiffuse.value = src.texture;
      this.downU.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      this.down.render(r, this.mips[i]);
    }
    const ac = r.autoClear; r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const src = this.mips[i];
      this.upU.tDiffuse.value = src.texture;
      this.upU.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      this.up.render(r, this.mips[i - 1]);
    }
    r.autoClear = ac;

    const u = this.finalU;
    u.uExposure.value = sky.exposure;
    u.uRef.value = sky.night ? this.adaptRef * 0.12 : this.adaptRef;
    u.uBloom.value = this.bloomStrength;
    u.uTime.value = (u.uTime.value + 0.618) % 100;
    u.uNight.value = sky.night ? 1 : 0;
    u.uSat.value = sky.night ? 0.6 : 1.0;
    u.uForest.value = sky.forest;
    u.uFade.value = fade;
    this.final.render(r, null);
  }
}
