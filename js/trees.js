// Procedural trees: recursive branching trunks with bark, foliage made of leaf-cluster cards
// with sphere-like normals (soft, volumetric shading), wind sway, and backlit translucency.
// Autumn maples, oaks and birches in the hollow, green trees and bushes in the meadow, a lone
// tree in the wheat, and snow-laden pines on the rise.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { groundY, surfaceAt, ZONES, SPAWN, cleared } from './world.js';
import { GLSL_WIND } from './wind.js';
import { addTranslucency } from './grass.js';
import { mulberry32, GLSL_NOISE } from './util.js';

const TYPES = {
  maple: { cell: 0, bark: 'bark', h: [9, 12], spread: 0.95, depth: 4, leaf: 1.5, tint: 0xffffff, cards: 13 },
  oak:   { cell: 0, bark: 'bark', h: [8, 11], spread: 1.15, depth: 4, leaf: 1.55, tint: 0xd9a070, cards: 13 },
  birch: { cell: 1, bark: 'birch', h: [10, 13], spread: 0.6, depth: 4, leaf: 1.25, tint: 0xffffff, cards: 11 },
  green: { cell: 2, bark: 'bark', h: [8, 11], spread: 1.0, depth: 4, leaf: 1.6, tint: 0xffffff, cards: 14 },
  lone:  { cell: 2, bark: 'bark', h: [6.5, 7.5], spread: 1.25, depth: 4, leaf: 1.5, tint: 0xf0d890, cards: 14 },
  bush:  { cell: 2, bark: 'bark', h: [1.2, 1.8], spread: 1.6, depth: 2, leaf: 0.9, tint: 0xc8d8a8, cards: 16 },
};

export function cyl(a, b, r0, r1, segs, out) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  // bark uv: v in metres along the branch
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 0.6);
  out.push(g);
}

export function card(center, size, rnd, cell, canopyC, out) {
  const g = new THREE.PlaneGeometry(size, size);
  const e = new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI);
  g.applyQuaternion(new THREE.Quaternion().setFromEuler(e));
  g.translate(center.x, center.y, center.z);
  // atlas cell (2x2)
  const uv = g.attributes.uv, cu = (cell % 2) * 0.5, cv = cell < 2 ? 0.5 : 0;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + uv.getX(i) * 0.5, cv + uv.getY(i) * 0.5);
  // normals point out of the canopy, so the crown shades like one soft volume
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(canopyC).normalize();
    n.setXYZ(i, v.x, v.y * 0.8 + 0.2, v.z);
  }
  out.push(g);
}

function growDeciduous(T, rnd) {
  const bark = [], leaves = [];
  const H = T.h[0] + rnd() * (T.h[1] - T.h[0]);
  const trunkH = H * (T === TYPES.bush ? 0.1 : 0.42);
  const R = H * 0.022 + 0.05;
  const canopyC = new THREE.Vector3(0, trunkH + (H - trunkH) * 0.55, 0);
  const tips = [];
  const grow = (p, dir, len, rad, depth) => {
    let cur = p.clone(), d = dir.clone();
    const n = 3;
    for (let i = 0; i < n; i++) {
      d.add(new THREE.Vector3((rnd() - 0.5) * 0.35, 0.12 + (depth > 1 ? -0.05 : 0.05), (rnd() - 0.5) * 0.35)).normalize();
      const next = cur.clone().addScaledVector(d, len / n);
      const r0 = rad * (1 - i / n * 0.35), r1 = rad * (1 - (i + 1) / n * 0.35);
      cyl(cur, next, r0, r1, depth === 0 ? 9 : depth === 1 ? 6 : 4, bark);
      cur = next;
    }
    if (depth >= T.depth - 1) { tips.push(cur.clone()); return; }
    const kids = depth === 0 ? 3 + ((rnd() * 2) | 0) : 2 + ((rnd() * 2) | 0);
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + rnd() * 1.2;
      const tilt = (0.45 + rnd() * 0.5) * T.spread;
      const nd = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      nd.lerp(d, 0.25).normalize();
      grow(cur, nd, len * (0.62 + rnd() * 0.15), rad * 0.62, depth + 1);
      if (depth >= 1) tips.push(cur.clone().lerp(p, 0.3));
    }
  };
  grow(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3((rnd() - 0.5) * 0.1, 1, (rnd() - 0.5) * 0.1).normalize(), trunkH + 0.3, R, 0);
  for (const t of tips) for (let c = 0; c < T.cards; c++) {
    const off = new THREE.Vector3((rnd() - 0.5), (rnd() - 0.35), (rnd() - 0.5)).multiplyScalar(T.leaf * 1.2);
    card(t.clone().add(off), T.leaf * (0.8 + rnd() * 0.6), rnd, T.cell, canopyC, leaves);
  }
  return { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves), H, canopyY: canopyC.y, canopyR: H * 0.35 * T.spread };
}

function growPine(rnd, H) {
  const bark = [], leaves = [];
  cyl(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H, 0), 0.26, 0.03, 8, bark);
  const canopyC = new THREE.Vector3(0, H * 0.45, 0);
  for (let y = 1.2; y < H - 0.3; y += 0.3 + rnd() * 0.1) {
    const u = (y - 1.2) / (H - 1.5);
    const L = (1 - u) * H * 0.32 + 0.4;
    const n = Math.max(4, Math.round(9 * (1 - u) + 4));
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + rnd() * 0.5;
      const droop = -0.35 - rnd() * 0.2;
      const d = new THREE.Vector3(Math.cos(a), droop, Math.sin(a)).normalize();
      const s = new THREE.Vector3(0, y, 0), e = s.clone().addScaledVector(d, L);
      cyl(s, e, 0.035 * (1 - u) + 0.01, 0.008, 3, bark);
      const cards = Math.max(2, Math.round(L / 0.3));
      for (let c = 0; c < cards; c++) {
        const p = s.clone().lerp(e, (c + 0.5) / cards);
        const g = new THREE.PlaneGeometry(1.25, 1.25);
        // needle sprays lie roughly flat along the branch, drooping
        g.rotateX(-Math.PI / 2 + 0.25 + (rnd() - 0.5) * 0.4);
        g.rotateY(-a + Math.PI / 2 + (rnd() - 0.5) * 0.6);
        g.translate(p.x, p.y, p.z);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + uv.getX(i) * 0.5, uv.getY(i) * 0.5);
        const pp = g.attributes.position, nn = g.attributes.normal;
        for (let i = 0; i < pp.count; i++) { const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i)).sub(canopyC).normalize(); nn.setXYZ(i, v.x * 0.6, 0.8, v.z * 0.6); }
        leaves.push(g);
      }
    }
  }
  // tip
  const top = new THREE.PlaneGeometry(0.7, 1.0); top.translate(0, H - 0.2, 0);
  const uv = top.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  leaves.push(top, top.clone().rotateY(Math.PI / 2).translate(0, 0, 0));
  return { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves.map(g => g.index ? g : g)), H, canopyY: H * 0.5, canopyR: H * 0.25 };
}

export class Trees {
  constructor(game, tx) {
    this.game = game;
    this.list = [];            // {x, z, kind, canopyY, canopyR}
    this.colliders = [];
    const rnd = mulberry32(77);
    const place = (kind, n, area, minGap, test) => {
      let guard = 0;
      while (n > 0 && guard++ < 4000) {
        const x = area.x0 + rnd() * (area.x1 - area.x0), z = area.z0 + rnd() * (area.z1 - area.z0);
        if (!test(x, z)) continue;
        if (this.list.some(t => Math.hypot(t.x - x, t.z - z) < minGap)) continue;
        if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 6) continue;
        this.list.push({ x, z, kind, rot: rnd() * Math.PI * 2, s: 0.85 + rnd() * 0.3 }); n--;
      }
    };
    const s = {};
    const box = (Z, k = 1.1) => ({ x0: Z.cx - Z.rx * k, x1: Z.cx + Z.rx * k, z0: Z.cz - Z.rz * k, z1: Z.cz + Z.rz * k });
    const zone = (key, lo) => (x, z) => { surfaceAt(x, z, s); return s[key] > lo && s.path < 0.2; };
    // the lone tree in the wheat, straight toward the sunrise from the spawn
    this.list.push({ x: 42, z: -21, kind: 'lone', rot: 1.2, s: 1 });
    place('maple', 7, box(ZONES.leaves), 7.5, zone('leaves', 0.55));
    place('oak', 5, box(ZONES.leaves), 7.5, zone('leaves', 0.5));
    place('birch', 6, box(ZONES.leaves), 6, zone('leaves', 0.4));
    place('pine', 16, box(ZONES.snow, 1.15), 6.5, zone('snow', 0.35));
    place('birch', 3, box(ZONES.snow), 8, zone('snow', 0.2));
    place('green', 9, { x0: -120, x1: 120, z0: -40, z1: 120 }, 16, (x, z) => { surfaceAt(x, z, s); return s.grass > 0.9 && s.path < 0.05 && Math.hypot(x, z) < 125; });
    place('bush', 26, { x0: -70, x1: 60, z0: -20, z1: 60 }, 3, (x, z) => { surfaceAt(x, z, s); return s.grass > 0.7 && s.path < 0.1; });
    // a few bushes line the path like hedgerows
    for (let x = -60; x < 20; x += 5 + rnd() * 6) {
      const z = 10 + (x < -30 ? 3.5 : 3.0) - x * 0.17 - 4.5 - rnd() * 2;
      surfaceAt(x, z, s);
      if (s.path < 0.2 && s.grass > 0.5) this.list.push({ x, z, kind: 'bush', rot: rnd() * 6, s: 0.7 + rnd() * 0.5 });
    }

    // the village has been built where these stood (they are still placed, so that everything placed after them
    // stays where it was, but never grown)
    for (const t of this.list) t.gone = cleared(t.x, t.z);

    // materials
    const barkM = new THREE.MeshStandardMaterial({ map: tx.bark.map, normalMap: tx.bark.normal, roughness: 0.95 });
    const birchM = new THREE.MeshStandardMaterial({ map: tx.birch.map, normalMap: tx.birch.normal, roughness: 0.8 });
    const windU = game.wind.uniforms;
    const leafMat = (snowy) => {
      const m = new THREE.MeshStandardMaterial({ map: tx.foliage, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, alphaToCoverage: true });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, windU);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_WIND}\nvarying vec3 vWN; varying vec3 vWP;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              vec4 ip = vec4(0.0, 0.0, 0.0, 1.0);
              #ifdef USE_INSTANCING
                ip = instanceMatrix * ip;
              #endif
              float hk = max(0.0, transformed.y) / 10.0;
              float g = windGust(ip.xz);
              float sway = sin(uWindTime * 1.1 + ip.x * 0.3) * 0.5 + 0.5;
              transformed.xz += uWindDir * (g * 0.06 + sway * 0.05) * hk * hk * 10.0;
              transformed += vec3(sin(uWindTime * 5.0 + position.x * 3.0 + position.z), cos(uWindTime * 4.3 + position.y * 2.0), sin(uWindTime * 4.7 + position.z * 3.0)) * 0.015 * (0.4 + g * 0.3);
            }`)
          .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            vWP = worldPosition.xyz;
            #ifdef USE_INSTANCING
              vWN = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz);
            #else
              vWN = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
            #endif`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWN; varying vec3 vWP;\n${GLSL_NOISE}`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            ${snowy ? `float sn = smoothstep(0.35, 0.75, vWN.y + (nNoise(vWP.xz * 2.0 + vWP.y) - 0.5) * 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.97), sn * 0.85);` : ''}`);
        addTranslucency(sh, snowy ? '0.25' : '0.65');
      };
      return m;
    };
    const leafM = leafMat(false), pineM = leafMat(true);
    // one material per foliage tint, shared by every tree of that kind
    const tinted = {};
    const tintedLeaf = (base, kind) => {
      if (kind === 'pine') return base;
      if (!tinted[kind]) { const m = base.clone(); m.onBeforeCompile = base.onBeforeCompile; m.color.set(TYPES[kind].tint); tinted[kind] = m; }
      return tinted[kind];
    };
    const barkSnowM = barkM;

    // a few variants per kind, instanced
    const variants = {};
    const byKind = {};
    for (const t of this.list) (byKind[t.kind] = byKind[t.kind] || []).push(t);
    const group = new THREE.Group();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (const [kind, trees] of Object.entries(byKind)) {
      const nVar = kind === 'lone' ? 1 : Math.min(3, trees.length);
      variants[kind] = [];
      for (let v = 0; v < nVar; v++) variants[kind].push(kind === 'pine' ? growPine(rnd, 9 + rnd() * 5) : growDeciduous(TYPES[kind], rnd));
      for (let v = 0; v < nVar; v++) {
        const mine = trees.filter((_, i) => i % nVar === v);
        if (!mine.length) continue;
        const V = variants[kind][v];
        V.bark.computeBoundingSphere(); V.leaves.computeBoundingSphere();
        mine.forEach((t, i) => {
          if (t.gone) return;
          const y = groundY(t.x, t.z);
          const bm = new THREE.Mesh(V.bark, kind === 'birch' ? birchM : barkSnowM);
          const lm = new THREE.Mesh(V.leaves, tintedLeaf(kind === 'pine' ? pineM : leafM, kind));
          for (const m of [bm, lm]) {
            m.position.set(t.x, y, t.z); m.rotation.y = t.rot; m.scale.setScalar(t.s);
            m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
            group.add(m);
          }
          t.canopyY = V.canopyY * t.s; t.canopyR = V.canopyR * t.s; t.H = V.H * t.s;
          // h: how high it stands, for what flies (the Wind Crow, which goes through bushes)
          if (kind !== 'bush') this.colliders.push({ x: t.x, z: t.z, r: (kind === 'pine' ? 0.28 : 0.3) * t.s * (V.H / 10) + 0.12, h: t.H });
          else this.colliders.push({ x: t.x, z: t.z, r: 0.35 * t.s, h: 1.4 * t.s, bush: true });
        });
      }
    }
    game.scene.add(group);
    this.group = group;
    this.list = this.list.filter((t) => !t.gone);
  }
}
