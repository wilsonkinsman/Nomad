// Leaves coming down through the deep wood. A few thousand cards wrap around the camera and are placed entirely in
// the vertex shader from their instance number and the clock: each one sinks at its own pace, drifts with the wind,
// swings side to side like a pendulum and rocks on that swing, so it flutters and tips the way a real leaf does.
// They are lit and shadowed like everything else, so a leaf slides out of the dark and flares gold as it crosses a beam.
// Only the air over the wood has them, there are more when the nomad runs (he shakes the branches and stirs the
// air) and they scatter out of his way.
import * as THREE from 'three';
import { GLSL_WORLD } from './world.js';
import { addTranslucency } from './grass.js';
import { leafGeometry } from './leaves.js';
import { GLSL_NOISE, clamp, damp } from './util.js';

const COUNT = 1700, SPAN = 38, HEIGHT = 15;

export class LeafFall {
  constructor(game, atlas) {
    this.game = game; this.max = COUNT; this.boost = 0;
    const base = leafGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setIndex(base.index);
    geo.instanceCount = COUNT;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const tex = game.worldTex;
    this.U = {
      uHeightTex: { value: tex.height }, uZone2Tex: { value: tex.zone2 },
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2() }, uAmt: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          ${GLSL_WORLD} ${GLSL_NOISE}
          uniform float uTime, uAmt; uniform vec3 uCam, uPlayer; uniform vec2 uWind;
          vec3 gLeafC; mat3 gLeafR; float gLeafS;
          mat3 rotAxis(vec3 a, float c, float s){
            float t = 1.0 - c;
            return mat3(t*a.x*a.x + c,       t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                        t*a.x*a.y - s*a.z,   t*a.y*a.y + c,     t*a.y*a.z + s*a.x,
                        t*a.x*a.z + s*a.y,   t*a.y*a.z - s*a.x, t*a.z*a.z + c);
          }`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          float fi = float(gl_InstanceID);
          float cell = floor(nHash12(vec2(fi, 3.3)) * 16.0);
          vMapUv = (uv + vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0))) / 4.0;`)
        .replace('#include <beginnormal_vertex>', `
          {
            vec4 r = vec4(nHash12(vec2(fi, 1.1)), nHash12(vec2(fi, 2.3)), nHash12(vec2(fi, 3.7)), nHash12(vec2(fi, 5.9)));
            vec3 r2 = vec3(nHash12(vec2(fi, 7.1)), nHash12(vec2(fi, 8.3)), nHash12(vec2(fi, 9.7)));
            float fall = 0.5 + 0.55 * r.w;                                    // metres a second
            float yy = mod(r.y * ${HEIGHT.toFixed(1)} - uTime * fall, ${HEIGHT.toFixed(1)});     // height above the ground, falling
            float ph = uTime * (1.1 + 1.3 * r2.x) + r.x * 40.0;
            vec2 sd = normalize(vec2(r2.y - 0.5, r2.z - 0.5) + 1e-3);         // the way this leaf swings
            vec2 xz = r.xz * ${SPAN.toFixed(1)} + uWind * uTime * 0.4;
            xz += sd * sin(ph) * (0.35 + 0.55 * r2.z) + vec2(-sd.y, sd.x) * cos(ph * 0.7) * 0.25;
            vec2 rel = mod(xz - uCam.xz + ${(SPAN / 2).toFixed(1)}, ${SPAN.toFixed(1)}) - ${(SPAN / 2).toFixed(1)};          // metres from the camera
            rel = sign(rel) * ${(SPAN / 2).toFixed(1)} * pow(abs(rel) / ${(SPAN / 2).toFixed(1)}, vec2(1.5));                      // crowded toward it: that is where they are seen
            xz = uCam.xz + rel;
            // out of the way of the nomad
            vec2 toP = xz - uPlayer.xz; float pd = length(toP);
            xz += toP / max(pd, 1e-3) * (1.0 - smoothstep(0.3, 2.6, pd)) * 1.1 * step(abs(uPlayer.y - worldHeight(xz) - yy), 2.5);
            gLeafC = vec3(xz.x, worldHeight(xz) + yy + 0.05, xz.y);
            // only over the wood; out at the rim of the ring around the camera, near the top and at the floor, a leaf shrinks away
            float inWood = smoothstep(0.2, 0.6, worldZone2(xz).r);
            float edge = max(abs(xz.x - uCam.x), abs(xz.y - uCam.z)) / ${(SPAN / 2).toFixed(1)};
            float fade = inWood * (1.0 - smoothstep(0.72, 1.0, edge)) * (1.0 - smoothstep(${(HEIGHT - 3).toFixed(1)}, ${HEIGHT.toFixed(1)}, yy)) * smoothstep(0.0, 0.3, yy);
            fade *= 1.0 - smoothstep(uAmt - 0.12, uAmt, nHash12(vec2(fi, 11.3)));       // how many of them there are right now
            gLeafS = (0.22 + 0.16 * r2.y) * fade;
            // it rocks on its swing and spins slowly as it comes down
            float tilt = cos(ph) * 0.95 + (r2.z - 0.5) * 0.5;
            vec3 ax = vec3(cos(r.z * 6.2832), 0.0, sin(r.z * 6.2832));
            float yaw = ph * 0.45 + r2.y * 6.2832;
            gLeafR = rotAxis(vec3(0.0, 1.0, 0.0), cos(yaw), sin(yaw)) * rotAxis(ax, cos(tilt), sin(tilt));
          }
          vec3 objectNormal = gLeafR * vec3(normal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`)
        .replace('#include <begin_vertex>', 'vec3 transformed = gLeafR * (position * gLeafS) + gLeafC;');
      // a leaf glows when the light comes through it
      addTranslucency(sh, '0.85');
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= 1.2;`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    game.scene.add(this.mesh);
  }

  setQuality(q) { this.mesh.geometry.instanceCount = Math.round(this.max * q.veg); }

  // near: how close the nomad is to the wood (0 far, 1 in it)
  update(dt, game, near) {
    const U = this.U, P = game.player;
    U.uTime.value += dt;
    U.uCam.value.copy(game.camera.position); U.uPlayer.value.copy(P.pos);
    U.uWind.value.copy(game.wind.dir).multiplyScalar(game.wind.base);
    // running shakes more down, and so does a gust
    this.boost = damp(this.boost, clamp(Math.hypot(P.vel.x, P.vel.z) / 6, 0, 1), 1.4, dt);
    const gust = clamp((game.wind.gust(P.pos.x, P.pos.z) - 1.3) / 2, 0, 1);
    U.uAmt.value = near * (0.62 + 0.26 * this.boost + 0.14 * gust);
    this.mesh.visible = U.uAmt.value > 0.02;
  }
}
