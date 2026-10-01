// Deep snow. A fine mesh sits on the ground of the snow field, raised by the baked snow depth
// and pushed down by a GPU deformation map: boots punch prints, legs plough trenches, a dive
// leaves a crater, and the displaced snow piles into a berm around them. Wind slowly refills it.
// A coarse CPU copy of the same map tells the player how deep he is standing.
import * as THREE from 'three';
import { groundY, groundNormal, surfaceAt, ZONES } from './world.js';
import { StampField } from './stamps.js';
import { GLSL_NOISE, clamp } from './util.js';

const MIN_X = -104, MIN_Z = 2, SIZE = 110, CPU_RES = 256, REFILL = 1 / 150;

export class Snow {
  constructor(game) {
    this.game = game;
    this.field = new StampField(game.renderer, { kind: 'snow', res: 1024, minX: MIN_X, minZ: MIN_Z, size: SIZE, refill: REFILL });
    this.cpu = new Float32Array(CPU_RES * CPU_RES);
    this._s = {};
    this.buildMesh();
    this.buildFlakes();
    this.plowT = 0;
  }

  baseDepth(x, z) {
    if (x < MIN_X || z < MIN_Z || x > MIN_X + SIZE || z > MIN_Z + SIZE) return 0;
    return surfaceAt(x, z, this._s).snowDepth;
  }
  cpuAt(x, z) {
    const fx = (x - MIN_X) / SIZE * CPU_RES, fz = (z - MIN_Z) / SIZE * CPU_RES;
    if (fx < 0 || fz < 0 || fx >= CPU_RES - 1 || fz >= CPU_RES - 1) return 0;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * CPU_RES + ix, c = this.cpu;
    return (c[k] * (1 - tx) + c[k + 1] * tx) * (1 - tz) + (c[k + CPU_RES] * (1 - tx) + c[k + CPU_RES + 1] * tx) * tz;
  }
  topAt(x, z) { return this.baseDepth(x, z); }                            // undisturbed surface above ground
  depthAt(x, z) { return this.baseDepth(x, z) * (1 - 0.88 * this.cpuAt(x, z)); }   // what's left under your feet

  // ellipse stamp in world space (angle = heading)
  stamp(x, z, rx, rz, angle, strength = 1, berm = 1) {
    if (this.baseDepth(x, z) < 0.02) return;
    this.field.stamp(x, z, rx, rz, angle, strength, berm);
    const r = Math.max(rx, rz), c = this.cpu;
    const x0 = Math.floor((x - r - MIN_X) / SIZE * CPU_RES), x1 = Math.ceil((x + r - MIN_X) / SIZE * CPU_RES);
    const z0 = Math.floor((z - r - MIN_Z) / SIZE * CPU_RES), z1 = Math.ceil((z + r - MIN_Z) / SIZE * CPU_RES);
    const cs = Math.cos(angle), sn = Math.sin(angle);
    for (let j = Math.max(0, z0); j <= Math.min(CPU_RES - 1, z1); j++) for (let i = Math.max(0, x0); i <= Math.min(CPU_RES - 1, x1); i++) {
      const wx = MIN_X + (i + 0.5) / CPU_RES * SIZE - x, wz = MIN_Z + (j + 0.5) / CPU_RES * SIZE - z;
      const lx = (cs * wx - sn * wz) / rx, lz = (sn * wx + cs * wz) / rz;
      const e = Math.hypot(lx, lz);
      const f = clamp((1 - e) / 0.5, 0, 1) * strength;
      if (f > c[j * CPU_RES + i]) c[j * CPU_RES + i] = f;
    }
  }

  buildMesh() {
    const step = 0.25, n = Math.round(SIZE / step) + 1;
    const pos = new Float32Array(n * n * 3), base = new Float32Array(n * n * 2), nrm = new Float32Array(n * n * 3);
    const N = new THREE.Vector3(), keep = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = MIN_X + i * step, z = MIN_Z + j * step, k = j * n + i;
      const d = this.baseDepth(x, z);
      const g = groundY(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = g; pos[k * 3 + 2] = z;
      base[k * 2] = g; base[k * 2 + 1] = d > 0.015 ? d : -0.06;
      groundNormal(x, z, N); nrm[k * 3] = N.x; nrm[k * 3 + 1] = N.y; nrm[k * 3 + 2] = N.z;
      keep[k] = d > 0.015 ? 1 : 0;
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if (!(keep[a] || keep[b] || keep[c] || keep[d])) continue;
      idx.push(a, c, b, d, b, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('aBase', new THREE.BufferAttribute(base, 2));
    geo.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(MIN_X + SIZE / 2, 0, MIN_Z + SIZE / 2), SIZE);
    const U = { uSnowTex: this.field.uniform, uRect: { value: this.field.rect }, uTexel: { value: 1 / 1024 }, uTime: { value: 0 }, uSunDir: { value: this.game.sky.lightDir } };
    this.U = U;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, U);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aBase; uniform sampler2D uSnowTex; uniform vec4 uRect; uniform float uTexel;
          varying vec2 vSUv; varying float vDepth; varying vec3 vWp; varying vec2 vDrift;
          ${GLSL_NOISE}
          float snowH(vec2 uv){ vec4 d = texture(uSnowTex, uv); return aBase.y * (1.0 - 0.9 * d.r) + d.g * 0.09 * step(0.0, aBase.y); }`)
        .replace('#include <begin_vertex>', `
          vec2 suv = (position.xz - uRect.xy) * uRect.w;
          vSUv = suv;
          vec3 transformed = vec3(position.x, aBase.x + snowH(suv), position.z);
          vDepth = aBase.y;
          vWp = transformed;
          vec2 dp = position.xz * 0.18;
          float d0 = nFbm(dp);
          vDrift = vec2(nFbm(dp + vec2(0.04, 0.0)) - d0, nFbm(dp + vec2(0.0, 0.04)) - d0) / 0.04 * 0.1;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uSnowTex; uniform float uTexel; uniform vec3 uSunDir; uniform vec4 uRect;
          varying vec2 vSUv; varying float vDepth; varying vec3 vWp; varying vec2 vDrift;
          ${GLSL_NOISE}
          vec4 gSnow;`)
        .replace('#include <map_fragment>', `
          gSnow = texture2D(uSnowTex, vSUv);
          if (vDepth < 0.0) discard;
          float press = gSnow.r;
          // blue light scatters inside prints and trenches; untouched powder is bright
          vec3 fresh = vec3(0.86, 0.9, 0.96);
          vec3 packed = vec3(0.62, 0.72, 0.88);
          float ripple = nNoise(vWp.xz * vec2(1.8, 0.7)) * 0.5 + nNoise(vWp.xz * 6.0) * 0.5;
          diffuseColor.rgb = mix(fresh, packed, smoothstep(0.1, 0.9, press) * 0.8) * (0.94 + 0.06 * ripple);
          // trenches hold shadow: less sky reaches the bottom of a deep print
          diffuseColor.rgb *= 1.0 - 0.32 * smoothstep(0.2, 1.0, press) * smoothstep(0.1, 0.4, vDepth);
          diffuseColor.rgb *= 1.0 + 0.06 * gSnow.g;
          float edge = smoothstep(0.0, 0.08, vDepth);
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.85, diffuseColor.rgb, edge);`)
        .replace('#include <normal_fragment_maps>', `
          {
            // normals from the deformation map (prints) and wind-sculpted ripples
            float e = uTexel * 1.5;
            vec2 tl = texture2D(uSnowTex, vSUv - vec2(e, 0.0)).rg, tr = texture2D(uSnowTex, vSUv + vec2(e, 0.0)).rg;
            vec2 td = texture2D(uSnowTex, vSUv - vec2(0.0, e)).rg, tu = texture2D(uSnowTex, vSUv + vec2(0.0, e)).rg;
            float hl = tl.x, hr = tr.x, hd = td.x, hu = tu.x, bl = tl.y, br = tr.y, bd = td.y, bu = tu.y;
            float world = e * uRect.z * 2.0;
            float dx = (-(hr - hl) * vDepth * 0.9 + (br - bl) * 0.09) / world;
            float dz = (-(hu - hd) * vDepth * 0.9 + (bu - bd) * 0.09) / world;
            vec2 rp = vWp.xz * vec2(1.8, 0.7);
            float r0 = nNoise(rp), rx = nNoise(rp + vec2(0.05, 0.0)), rz = nNoise(rp + vec2(0.0, 0.05));
            dx += (rx - r0) / 0.05 * 0.07 * (1.0 - gSnow.r);
            dz += (rz - r0) / 0.05 * 0.03 * (1.0 - gSnow.r);
            dx += vDrift.x; dz += vDrift.y;
            vec3 wn = normalize(vec3(-dx, 1.0, -dz));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // glints: tiny facets catching the sun
            vec2 gp = vWp.xz * 70.0, cell = floor(gp);
            float h = nHash12(cell);
            float pt = 1.0 - smoothstep(0.08, 0.2, length(fract(gp) - 0.5 - (nHash22(cell) - 0.5) * 0.5));
            vec3 V = normalize(cameraPosition - vWp);
            float camD = length(cameraPosition - vWp);
            float align = max(dot(normalize(V + uSunDir), vec3(0.0, 1.0, 0.0)), 0.0);
            float spark = step(0.985, h) * pt * smoothstep(0.75, 1.0, align) * (1.0 - gSnow.r * 0.7) * smoothstep(1.5, 4.0, camD) * (1.0 - smoothstep(18.0, 30.0, camD));
            float fl = 0.6 + 0.4 * sin(h * 400.0 + dot(V, vec3(40.0)));
            totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * spark * fl * 6.0 * smoothstep(0.02, 0.2, uSunDir.y + 0.1);
          }`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.game.scene.add(this.mesh);
  }

  buildFlakes() {
    const N = 3500, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * 40; pos[i * 3 + 1] = Math.random() * 20; pos[i * 3 + 2] = Math.random() * 40; seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.flakeU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uLight: { value: new THREE.Color() }, uWind: { value: new THREE.Vector2() }, uScale: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.flakeU, transparent: true, depthWrite: false,
      vertexShader: `attribute float seed; uniform float uTime, uAmt, uScale; uniform vec3 uCam; uniform vec2 uWind; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * (0.6 + seed * 0.5), 20.0);
          p.xz += uWind * uTime * 0.6 + vec2(sin(uTime * 0.9 + seed * 20.0), cos(uTime * 0.7 + seed * 13.0)) * 0.4;
          p.xz = mod(p.xz - uCam.xz + 20.0, 40.0) + uCam.xz - 20.0;
          p.y += uCam.y - 8.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((0.012 + seed * 0.012) * uScale / -mv.z, 1.0, 12.0);
          vA = uAmt * smoothstep(40.0, 4.0, -mv.z) * step(seed, uAmt * 1.4);
        }`,
      fragmentShader: `uniform vec3 uLight; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(d)) * vA; if (a < 0.01) discard; gl_FragColor = vec4(uLight, a); }`,
    });
    this.flakes = new THREE.Points(geo, mat);
    this.flakes.frustumCulled = false;
    this.game.scene.add(this.flakes);
  }

  update(dt, game) {
    this.field.update(dt);
    // CPU mirror relaxes at the same average rate
    this._decT = (this._decT || 0) + dt;
    if (this._decT > 0.25) {
      const c = this.cpu, dec = this._decT * REFILL;
      this._decT = 0;
      for (let i = 0; i < c.length; i++) if (c[i] > 0) c[i] = Math.max(0, c[i] - dec);
    }
    // snowfall only where the snow is
    const cam = game.camera.position;
    const zs = ZONES.snow;
    const near = 1 - clamp((Math.hypot(cam.x - zs.cx, cam.z - zs.cz) - 40) / 30, 0, 1);
    const F = this.flakeU;
    F.uTime.value += dt; F.uCam.value.copy(cam); F.uAmt.value = near * (game.sky.night ? 0.8 : 0.55);
    F.uLight.value.setRGB(1, 1, 1).lerp(game.sky.lightColor, 0.25).multiplyScalar(game.sky.night ? 0.25 : 1.1);
    F.uWind.value.copy(game.wind.dir).multiplyScalar(game.wind.base);
    F.uScale.value = game.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(game.camera.fov) / 2));
    this.flakes.visible = near > 0.01;

    // the nomad ploughs through deep snow
    const P = game.player;
    const depth = this.baseDepth(P.pos.x, P.pos.z);
    if (depth > 0.05 && P.grounded && P.model) {
      const sp = Math.hypot(P.vel.x, P.vel.z);
      if (sp > 0.3 && P.state === 'ground') {
        for (const L of ['L', 'R']) {
          const f = P.model.footWorld(L);
          this.stamp(f.x, f.z, 0.13, 0.17, P.heading, 0.8, 0.8);
        }
        this.plowT += dt * sp;
        if (this.plowT > 0.35) {
          this.plowT = 0;
          const pz = game.particles;
          const fx = P.pos.x + Math.sin(P.heading) * 0.35, fz = P.pos.z + Math.cos(P.heading) * 0.35;
          pz.emit('snow', fx, P.pos.y + depth * 0.9, fz, P.vel.x * 0.5, 0.8 + sp * 0.2, P.vel.z * 0.5, 0.8, Math.round(2 + sp * 1.5));
          if (sp > 4) pz.emit('powder', fx, P.pos.y + depth, fz, P.vel.x * 0.3, 0.6, P.vel.z * 0.3, 1.0, 2);
        }
      }
    }
  }

  // events from the player
  onStep(side, p, surf, speed, sprint, heading) {
    if (this.baseDepth(p.x, p.z) < 0.05) return;
    this.stamp(p.x, p.z, 0.1, 0.17, heading, 1, 1);
  }
  onImpact(p, heading, kind) {
    const d = this.baseDepth(p.x, p.z);
    if (d < 0.05) return;
    const pz = this.game.particles;
    if (kind === 'flop') {
      const fx = p.x + Math.sin(heading) * 0.55, fz = p.z + Math.cos(heading) * 0.55;
      this.stamp(fx, fz, 0.42, 1.05, heading, 1, 1);
      pz.emit('snow', fx, p.y + d, fz, 0, 2.6, 0, 2.6, 110);
      pz.emit('powder', fx, p.y + d, fz, 0, 1.2, 0, 2.5, 30);
    } else {
      this.stamp(p.x, p.z, 0.32, 0.36, heading, 1, 1);
      pz.emit('snow', p.x, p.y + d, p.z, 0, 1.8, 0, 1.6, 40);
      pz.emit('powder', p.x, p.y + d, p.z, 0, 0.8, 0, 1.6, 10);
    }
  }
}
