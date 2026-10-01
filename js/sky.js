// Sky, sun, moon and the light they cast.
// A physically based single-scattering atmosphere (Rayleigh + Mie) is rendered into a small
// equirect LUT whenever the sun moves. The sky dome, the fog in post and the image-based
// lighting all read that one LUT, so the mist always matches the sky behind it.
import * as THREE from 'three';
import { SUN_AZ } from './world.js';
import { clamp, lerp, smoothstep, GLSL_NOISE } from './util.js';

const ATMOS = /* glsl */`
const float PI = 3.14159265;
const float Re = 6360e3, Ra = 6420e3, Hr = 7994.0, Hm = 1200.0;
const vec3 betaR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float betaM = 21e-6;
float sphereExit(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd), c = dot(ro, ro) - r*r, d = b*b - c; return d < 0.0 ? -1.0 : -b + sqrt(d); }
bool hitsGround(vec3 ro, vec3 rd){ float b = dot(ro, rd), c = dot(ro, ro) - Re*Re; return b < 0.0 && b*b - c > 0.0; }
vec3 atmosphere(vec3 dir, vec3 L, float I, float mieG, float haze){
  vec3 ro = vec3(0.0, Re + 30.0, 0.0);
  float tmax = sphereExit(ro, dir, Ra);
  if (hitsGround(ro, dir)) { float b = dot(ro, dir), c = dot(ro, ro) - Re*Re; tmax = -b - sqrt(b*b - c); }
  const int N = 16, M = 8;
  float seg = tmax / float(N), odR = 0.0, odM = 0.0;
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  float mu = dot(dir, L), g = mieG;
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu*mu);
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g*g) * (1.0 + mu*mu)) / ((2.0 + g*g) * pow(1.0 + g*g - 2.0*g*mu, 1.5));
  float bM = betaM * haze;
  for (int i = 0; i < N; i++){
    vec3 p = ro + dir * (seg * (float(i) + 0.5));
    float h = length(p) - Re;
    float hr = exp(-h / Hr) * seg, hm = exp(-h / Hm) * seg;
    odR += hr; odM += hm;
    float tl = sphereExit(p, L, Ra), sl = tl / float(M), lR = 0.0, lM = 0.0;
    bool ok = !hitsGround(p, L);
    for (int j = 0; j < M; j++){
      vec3 q = p + L * (sl * (float(j) + 0.5));
      float hh = length(q) - Re;
      lR += exp(-hh / Hr) * sl; lM += exp(-hh / Hm) * sl;
    }
    if (ok) {
      vec3 tau = betaR * (odR + lR) + bM * 1.1 * (odM + lM);
      vec3 att = exp(-tau);
      sR += att * hr; sM += att * hm;
    }
  }
  return I * (sR * betaR * pR + sM * bM * pM);
}
vec2 skyUV(vec3 d){
  float u = atan(d.z, d.x) / 6.2831853 + 0.5;
  float e = asin(clamp(d.y, -1.0, 1.0));
  return vec2(u, 0.5 + 0.5 * sign(e) * sqrt(abs(e) / 1.5707963));
}
vec3 uvDir(vec2 uv){
  float a = (uv.x - 0.5) * 6.2831853;
  float s = uv.y * 2.0 - 1.0; float e = sign(s) * s * s * 1.5707963;
  return vec3(cos(e) * cos(a), sin(e), cos(e) * sin(a));
}
`;

const QUAD_V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ---------------------------------------------------------------- CPU transmittance for light colour
function sunTransmittance(el) {
  // optical depth from an observer 30 m up toward a light at elevation el
  const Re = 6360e3, Ra = 6420e3, Hr = 7994, Hm = 1200;
  const dir = [Math.cos(el), Math.sin(el)], ro = [0, Re + 30];
  const b = ro[1] * dir[1], c = ro[1] * ro[1] - Ra * Ra;
  const t = -b + Math.sqrt(b * b - c);
  let oR = 0, oM = 0; const N = 48, s = t / N;
  for (let i = 0; i < N; i++) {
    const x = dir[0] * s * (i + 0.5), y = ro[1] + dir[1] * s * (i + 0.5);
    const h = Math.hypot(x, y) - Re;
    if (h < 0) return new THREE.Vector3(0, 0, 0);
    oR += Math.exp(-h / Hr) * s; oM += Math.exp(-h / Hm) * s;
  }
  const bR = [5.8e-6, 13.5e-6, 33.1e-6], bM = 21e-6 * 1.1 * 1.6;
  return new THREE.Vector3(...bR.map(v => Math.exp(-(v * oR + bM * oM))));
}

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.night = false;
    this.progress = 0;                 // 0..1 sunrise progression
    this.riseSeconds = 720;            // sun climbs for twelve minutes, then holds
    this.time = 0;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(); // whichever body lights the scene
    this.lightColor = new THREE.Color();
    this.sunDiskColor = new THREE.Vector3();
    this.fog = { haze: new THREE.Vector4(), mist: new THREE.Vector4(), scatter: 1, rays: 0 };
    this.exposure = 1;
    this._lastLutDir = new THREE.Vector3(9, 9, 9);
    this._envTimer = 0;
    // art-direction knobs (tuned against captures)
    this.tune = { startEl: 3.2, endEl: 17, lightI: 3.2, desat: 0.42, exposure: 2.1, haze: 2.4, envBoost: 1.6, nightExposure: 5.5 };

    // ---- LUT
    this.lut = new THREE.WebGLRenderTarget(256, 128, { type: THREE.HalfFloatType, depthBuffer: false });
    this.lut.texture.wrapS = THREE.RepeatWrapping;
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: { uL: { value: new THREE.Vector3(0, 1, 0) }, uI: { value: 22 }, uG: { value: 0.76 }, uHaze: { value: 1.6 }, uFloor: { value: new THREE.Vector3() } },
      vertexShader: QUAD_V,
      fragmentShader: `${ATMOS} uniform vec3 uL; uniform float uI, uG, uHaze; uniform vec3 uFloor; varying vec2 vUv;
        void main(){ vec3 d = uvDir(vUv); d.y = max(d.y, 0.0); d = normalize(d + vec3(0.0, 0.001, 0.0));
          gl_FragColor = vec4(atmosphere(d, uL, uI, uG, uHaze) + uFloor, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat);
    this.quad.frustumCulled = false;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // ---- dome
    this.uniforms = {
      uLut: { value: this.lut.texture },
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uSunDisk: { value: this.sunDiskColor },
      uNight: { value: 0 }, uTime: { value: 0 },
      uCloudLight: { value: new THREE.Vector3() }, uCloudAmb: { value: new THREE.Vector3() },
      uEnv: { value: 0 }, uEnvBoost: { value: 1 },
    };
    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `${ATMOS} ${GLSL_NOISE}
        uniform sampler2D uLut; uniform vec3 uSunDir, uMoonDir, uSunDisk, uCloudLight, uCloudAmb; uniform float uNight, uTime, uEnv, uEnvBoost;
        varying vec3 vDir;
        float stars(vec3 d){
          vec3 p = d * 260.0; vec3 c = floor(p); float h = nHash12(c.xy + c.z * 17.13);
          if (h < 0.992) return 0.0;
          vec3 j = c + 0.5 + (vec3(nHash12(c.yz), nHash12(c.zx), nHash12(c.xy + 3.1)) - 0.5) * 0.7;
          float r = length(p - j);
          float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h * 9.0) + h * 80.0);
          return smoothstep(0.35, 0.0, r) * (h - 0.992) * 125.0 * tw;
        }
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = texture2D(uLut, skyUV(vec3(d.x, max(d.y, 0.0), d.z))).rgb;
          float up = max(d.y, 0.0);
          // sun disk with limb darkening
          float cs = dot(d, uSunDir);
          float disk = smoothstep(0.99992, 0.99996, cs);
          float limb = sqrt(max(0.0, 1.0 - (1.0 - cs) / (1.0 - 0.99992)));
          float sunI = uEnv > 0.5 ? 3.0 : 900.0;
          col += uSunDisk * disk * (0.55 + 0.45 * limb) * sunI * (1.0 - uNight);
          col += uSunDisk * pow(max(cs, 0.0), 900.0) * 6.0 * (1.0 - uNight);
          // clouds: a thin layer 2.4 km up, lit from below at dawn
          if (d.y > 0.0) {
            float t = 2400.0 / (d.y + 0.03);
            vec2 p = d.xz * t * 0.00018 + vec2(uTime * 0.0035, uTime * 0.001);
            float n = nFbm(p * vec2(1.0, 2.2)) * 0.65 + nFbm(p * 3.1 + 7.0) * 0.35;
            float cov = smoothstep(0.52, 0.82, n) * smoothstep(0.0, 0.12, d.y);
            float thick = smoothstep(0.55, 0.95, n);
            float mu = max(dot(d, uSunDir), 0.0);
            vec3 lit = uCloudAmb * (1.0 - thick * 0.5) + uCloudLight * (0.35 + 1.8 * pow(mu, 8.0) + 0.6 * (1.0 - thick));
            float far = 1.0 - exp(-t * 0.00005);
            vec3 cloud = mix(lit, col, far * 0.8);
            col = mix(col, cloud, cov * 0.9);
          }
          if (uNight > 0.0 && uEnv < 0.5) {
            float mw = exp(-pow(dot(d, normalize(vec3(0.35, 0.25, 0.9))), 2.0) * 18.0) * (0.4 + 0.6 * nFbm(d.xz * 9.0 + d.y * 4.0));
            col += vec3(0.022, 0.026, 0.04) * mw * uNight * smoothstep(0.0, 0.25, d.y);
            col += vec3(0.9, 0.95, 1.1) * stars(d) * uNight * smoothstep(0.0, 0.18, d.y) * (1.0 + mw * 2.0);
            float cm = dot(d, uMoonDir);
            float moon = smoothstep(0.99975, 0.9998, cm);
            vec3 mp = d - uMoonDir * cm;
            float maria = nFbm(mp.xz * 900.0 + mp.y * 500.0);
            vec3 mcol = vec3(1.0, 0.97, 0.9) * (0.62 + 0.38 * smoothstep(0.35, 0.7, maria));
            col = mix(col, mcol * 1.3, moon);
            col += vec3(0.5, 0.6, 0.8) * pow(max(cm, 0.0), 1500.0) * 0.8 + vec3(0.12, 0.15, 0.22) * pow(max(cm, 0.0), 60.0) * 0.12;
          }
          if (uEnv > 0.5) col *= uEnvBoost;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 64, 32), domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    // env copy of the dome for PMREM (sun clamped, no stars)
    this.envScene = new THREE.Scene();
    const envMat = domeMat.clone();
    envMat.uniforms = { ...this.uniforms, uEnv: { value: 1 } };
    this.envU = envMat.uniforms;
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
    // a dark ground so IBL from below is earth, not sky
    const ground = new THREE.Mesh(new THREE.CircleGeometry(49, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }));
    ground.position.y = -2;
    this.envGround = ground;
    this.envScene.add(ground);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    // ---- light
    this.light = new THREE.DirectionalLight(0xffffff, 3);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const sc = this.light.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 260;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.03;
    scene.add(this.light, this.light.target);

    this.setNight(false);
  }

  setNight(on) {
    this.night = on;
    this._lastLutDir.set(9, 9, 9);
    this._envTimer = 0;
    // art-direction knobs (tuned against captures)
    this.tune = { startEl: 3.2, endEl: 17, lightI: 3.2, desat: 0.42, exposure: 2.1, haze: 2.4, envBoost: 1.6, nightExposure: 5.5 };
    this.update(0, new THREE.Vector3(), true);
  }

  update(dt, focus, force = false) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (!this.night) this.progress = clamp(this.progress + dt / this.riseSeconds, 0, 1);
    const p = this.progress;

    // sun: from just above the horizon to a golden morning angle
    const tn = this.tune;
    const el = THREE.MathUtils.degToRad(lerp(tn.startEl, tn.endEl, smoothstep(0, 1, p)));
    const az = SUN_AZ;
    this.sunDir.set(az.x * Math.cos(el), Math.sin(el), az.y * Math.cos(el)).normalize();
    // moon: high in the south-east
    const mel = THREE.MathUtils.degToRad(31);
    const ma = new THREE.Vector2(0.62, 0.35).normalize();
    this.moonDir.set(ma.x * Math.cos(mel), Math.sin(mel), ma.y * Math.cos(mel)).normalize();

    const n = this.night ? 1 : 0;
    this.uniforms.uNight.value = n;
    const L = this.night ? this.moonDir : this.sunDir;
    this.lightDir.copy(L);

    const T = sunTransmittance(this.night ? mel : el);
    this.sunDiskColor.copy(T).multiplyScalar(1.0);
    if (this.night) {
      // moonlight: silver-blue, soft
      this.lightColor.setRGB(0.55, 0.68, 1.0).multiplyScalar(0.55);
      this.uniforms.uCloudLight.value.set(0.035, 0.042, 0.06);
      this.uniforms.uCloudAmb.value.set(0.006, 0.008, 0.014);
      this.fog.haze.set(0.0019, 0.03, 0, 0);
      this.fog.mist.set(0.022, 0.5, -0.5, 0);
      this.fog.scatter = 0.25;
      this.fog.rays = 0.55;          // moonbeams through the trees
      this.exposure = tn.nightExposure;
    } else {
      const warm = T.clone();
      const k = 1 / Math.max(0.0001, Math.max(warm.x, warm.y, warm.z));
      // keep the hue of the transmitted light, but let brightness fall off gently as it gets redder
      const bright = lerp(0.55, 1.0, smoothstep(0.02, 0.6, T.x));
      this.lightColor.setRGB(warm.x * k, warm.y * k, warm.z * k).lerp(new THREE.Color(1, 0.86, 0.66), tn.desat).multiplyScalar(tn.lightI * bright);
      this.uniforms.uCloudLight.value.set(warm.x * k * 2.2, warm.y * k * 1.8, warm.z * k * 1.5).multiplyScalar(bright);
      this.uniforms.uCloudAmb.value.set(0.16, 0.14, 0.18);
      const mist = lerp(1.0, 0.45, p);
      this.fog.haze.set(lerp(0.0032, 0.0019, p), 0.028, 0, 0);
      this.fog.mist.set(0.05 * mist, 0.42, -0.5, 0);
      this.fog.scatter = 1.0;
      this.fog.rays = lerp(1.0, 0.55, p);
      this.exposure = tn.exposure * lerp(1.0, 0.8, p);
    }

    // re-render the LUT when the light moved enough
    if (force || this._lastLutDir.distanceTo(L) > 0.0015) {
      this._lastLutDir.copy(L);
      this.lutMat.uniforms.uL.value.copy(L);
      this.lutMat.uniforms.uI.value = this.night ? 22 * 0.0105 : 22;
      this.lutMat.uniforms.uHaze.value = this.night ? 1.0 : tn.haze;
      this.envU.uEnvBoost.value = this.night ? 2.0 : tn.envBoost;
      // IBL from below: the ground bounces a little of the light it gets
      const lc = this.night ? new THREE.Color(0.02, 0.025, 0.04) : this.lightColor.clone().multiplyScalar(0.05 * Math.max(0.2, L.y * 3)).add(new THREE.Color(0.02, 0.03, 0.015));
      this.envGround.material.color.copy(lc);
      this.lutMat.uniforms.uFloor.value.set(0.0015, 0.002, 0.0035).multiplyScalar(this.night ? 1 : 0);
      const r = this.renderer, old = r.getRenderTarget();
      r.setRenderTarget(this.lut); r.render(this.quad, this.quadCam); r.setRenderTarget(old);
      this._envDirty = true;
    }
    this._envTimer -= dt;
    if (this._envDirty && (force || this._envTimer <= 0)) this.rebuildEnv();

    // light follows the player; shadow camera snapped to texels to stop shimmer
    const dist = 120;
    const sc = this.light.shadow.camera;
    const texel = (sc.right - sc.left) / this.light.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.light.target.position.set(fx, focus.y, fz);
    this.light.position.set(fx + L.x * dist, focus.y + L.y * dist, fz + L.z * dist);
    this.light.color.copy(this.lightColor);
    this.light.intensity = 1;
  }

  rebuildEnv() {
    this._envDirty = false;
    this._envTimer = 8;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  followCamera(cam) { this.dome.position.copy(cam.position); }
}
