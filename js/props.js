// Rocks (mossy in the meadow, leaf-strewn in the hollow, snow-capped on the rise), a weathered
// split-rail fence along the road, a stone cairn at the crossroads and a prayer flag on a post
// that flutters in the wind (real cloth).
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { groundY, surfaceAt, PATHS, SPAWN } from './world.js';
import { Cloth } from './cloth.js';
import { mulberry32, vnoise, GLSL_NOISE } from './util.js';

function rockGeometry(rnd, flat = 0.6) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position, v = new THREE.Vector3();
  const sx = rnd() * 10, sz = rnd() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = vnoise(v.x * 1.6 + sx, v.z * 1.6 + v.y * 1.3 + sz) * 0.45 + vnoise(v.x * 4 + sz, v.y * 4 + sx) * 0.15;
    v.multiplyScalar(0.75 + n);
    v.y *= flat; if (v.y < -0.15) v.y = -0.15 - (v.y + 0.15) * 0.2;
    // a few flat facets, like fractured stone
    if (v.x > 0.55) v.x = 0.55 + (v.x - 0.55) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Props {
  constructor(game, tx) {
    this.game = game;
    this.colliders = [];
    const rnd = mulberry32(55), s = {};
    // ------------------------------------------------ rocks
    const rockMat = new THREE.MeshStandardMaterial({ map: tx.rock.map, normalMap: tx.rock.normal, roughness: 0.92 });
    rockMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN2; varying vec3 vWP2;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWP2 = worldPosition.xyz;
          #ifdef USE_INSTANCING
            vWN2 = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz);
          #else
            vWN2 = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
          #endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWN2; varying vec3 vWP2;\n${GLSL_NOISE}`)
        .replace('#include <map_fragment>', `
          vec3 tp = abs(vWN2); tp /= tp.x + tp.y + tp.z;
          vec3 rc = texture2D(map, vWP2.yz * 0.35).rgb * tp.x + texture2D(map, vWP2.xz * 0.35).rgb * tp.y + texture2D(map, vWP2.xy * 0.35).rgb * tp.z;
          diffuseColor.rgb *= rc;
          float top = smoothstep(0.45, 0.85, vWN2.y + (nNoise(vWP2.xz * 3.0) - 0.5) * 0.4);
          // vColor.r = moss, vColor.g = snow
          #ifdef USE_COLOR
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.14, 0.04), top * vColor.r);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.96), top * vColor.g);
          #endif`)
        .replace('#include <color_fragment>', '');
    };
    const rocks = [0, 1, 2, 3].map(() => rockGeometry(rnd, 0.45 + rnd() * 0.35));
    const spots = [];
    let guard = 0;
    while (spots.length < 90 && guard++ < 5000) {
      const x = (rnd() * 2 - 1) * 125, z = (rnd() * 2 - 1) * 125;
      if (Math.hypot(x, z) > 128 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 5) continue;
      surfaceAt(x, z, s);
      if (s.path > 0.15 || s.wheat > 0.4) continue;
      const big = rnd() < 0.18;
      spots.push({ x, z, r: big ? 0.9 + rnd() * 1.4 : 0.2 + rnd() * 0.45, v: (rnd() * 4) | 0, moss: s.grass + s.leaves * 0.5, snow: s.snow });
    }
    const byV = [[], [], [], []];
    for (const sp of spots) byV[sp.v].push(sp);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    byV.forEach((list, v) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(rocks[v], rockMat, list.length);
      list.forEach((sp, i) => {
        q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3));
        m4.compose(new THREE.Vector3(sp.x, groundY(sp.x, sp.z) - sp.r * 0.12, sp.z), q, new THREE.Vector3(sp.r, sp.r, sp.r * (0.8 + rnd() * 0.4)));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, c.setRGB(Math.min(1, sp.moss), sp.snow > 0.3 ? 1 : 0, 0));
        if (sp.r > 0.5) this.colliders.push({ x: sp.x, z: sp.z, r: sp.r * 0.85, h: sp.r * 1.1 });
      });
      im.castShadow = true; im.receiveShadow = true;
      game.scene.add(im);
    });

    // ------------------------------------------------ fence along the road, south side, west of the crossroads
    const woodM = new THREE.MeshStandardMaterial({ map: tx.wood.map, normalMap: tx.wood.normal, roughness: 0.9 });
    const posts = [], rails = [];
    const road = PATHS[0];
    let last = null, broken = 0;
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i], [bx, bz] = road[i + 1];
      if (ax < -62 || ax > 14) continue;
      const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let t = 0; t < len; t += 2.6) {
        const x = ax + dx * t - dz * 3.1, z = az + dz * t + dx * 3.1;   // offset to the right-hand side looking east
        const h = 1.05 + rnd() * 0.25, lean = (rnd() - 0.5) * 0.12;
        const y = groundY(x, z);
        const g = new THREE.CylinderGeometry(0.06, 0.075, h + 0.3, 7);
        g.translate(0, (h + 0.3) / 2 - 0.3, 0); g.rotateZ(lean); g.rotateX((rnd() - 0.5) * 0.1); g.translate(x, y, z);
        posts.push(g);
        this.colliders.push({ x, z, r: 0.12 });
        const p = new THREE.Vector3(x, y, z);
        if (last && rnd() > 0.1) {
          for (const [ry, miss] of [[0.45, 0.08], [0.85, 0.12]]) {
            if (rnd() < miss) { broken++; continue; }
            const a = last.clone().setY(last.y + ry + (rnd() - 0.5) * 0.06), b = p.clone().setY(p.y + ry + (rnd() - 0.5) * 0.06);
            const d = new THREE.Vector3().subVectors(b, a), L = d.length();
            const rg = new THREE.CylinderGeometry(0.045, 0.05, L + 0.25, 6);
            rg.rotateZ(Math.PI / 2);
            rg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize()));
            rg.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            rails.push(rg);
            const mid = a.clone().lerp(b, 0.5);
            this.colliders.push({ x: mid.x, z: mid.z, r: 0.2 });
          }
        }
        last = p;
      }
    }
    const fence = new THREE.Mesh(mergeGeometries([...posts, ...rails]), woodM);
    fence.castShadow = true; fence.receiveShadow = true;
    game.scene.add(fence);

    // ------------------------------------------------ cairn and prayer flag at the crossroads
    const cx = 4.5, cz = 8.5, cy = groundY(cx, cz);
    const stones = [];
    let y = cy;
    for (let i = 0; i < 6; i++) {
      const r = 0.42 - i * 0.055, g = rockGeometry(rnd, 0.35);
      g.scale(r, r, r); g.rotateY(rnd() * 6);
      g.translate(cx + (rnd() - 0.5) * 0.05, y + r * 0.3, cz + (rnd() - 0.5) * 0.05);
      stones.push(g); y += r * 0.5;
    }
    const cairn = new THREE.Mesh(mergeGeometries(stones), rockMat);
    cairn.castShadow = cairn.receiveShadow = true;
    game.scene.add(cairn);
    this.colliders.push({ x: cx, z: cz, r: 0.45 });
    const fx = cx - 1.3, fz = cz + 0.6, fy = groundY(fx, fz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.6, 7).translate(fx, fy + 1.1, fz), woodM);
    pole.castShadow = true; game.scene.add(pole);
    this.colliders.push({ x: fx, z: fz, r: 0.08 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.85, side: THREE.DoubleSide, map: tx.fabric.map });
    const top = fy + 2.3;
    const pins = [0, 1, 2, 3].map(r => ({ r, c: 0, target: new THREE.Vector3(fx, top - r * 0.1, fz) }));
    this.flag = new Cloth({ rows: 4, cols: 10, mat: flagMat, pins, stiff: 1, shear: 0.6, bend: 0.1, wind: 1.4, thick: 0.01,
      init: (r, cc, out) => out.set(fx + cc * 0.09, top - r * 0.1, fz), uvScale: [2, 0.6] });
    game.scene.add(this.flag.mesh);
    this.flagColliders = [];
  }

  update(dt, game) {
    const p = this.flag.pins[0].target;
    if (Math.hypot(p.x - game.camera.position.x, p.z - game.camera.position.z) < 70) {
      const w = game.wind.at(p.x, p.z);
      this.flag.update(dt, new THREE.Vector3(w.x * 2.2, 0.3, w.z * 2.2), this.flagColliders, 4);
    }
  }
}
