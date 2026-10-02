// The deep wood: a hush of old, very tall trees, a floor of moss and ferns, a canopy so high that the low sun slants in
// under it and the moon reaches the floor through the gaps, and leaves coming down through the light.
//  - the trees are grown once (a few variants, 32-52 m) and instanced; their crowns are cards of foliage far overhead
//  - the ferns part around the nomad and lie pressed where he has walked
//  - the canopy takes the sky's ambient light away under it (the sun and moon are untouched), so the beams stand out
//  - the light shafts themselves are found in post.js from the shadow map; the falling leaves and the motes are here
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { groundY, surfaceAt, ZONES, ellipseE } from './world.js';
import { GLSL_WIND } from './wind.js';
import { addTranslucency, GLSL_TRAMPLE } from './grass.js';
import { cyl, card } from './trees.js';
import { LeafFall } from './leaffall.js';
import { Motes } from './shafts.js';
import { mulberry32, clamp, damp, smoothstep, GLSL_NOISE } from './util.js';
import { softSprite } from './textures.js';

const SIDES = 14, RINGS = 22;
const TREES = 160;              // asked for: the glades, the trail and the spacing thin out what actually fits
const FERNS = 1500;
const AMBIENT_SHADE = 0.55;     // how much of the sky's ambient light the canopy takes away

// One old tree: a trunk with a root flare and a slow lean, bare for the first sixty percent of its height, then limbs that
// reach out and up and end in clusters of foliage cards. H is its height in metres, R0 the trunk radius above the flare.
function growGiant(rnd, H, R0, cell) {
  const bark = [], leaves = [];
  const ph1 = rnd() * 6.283, ph2 = rnd() * 6.283, lean = (rnd() - 0.5) * 1.6;
  const centre = (y, out) => {
    const u = y / H;
    return out.set(H * 0.012 * u * (Math.sin(u * 5.2 + ph1) + lean), y, H * 0.012 * u * Math.sin(u * 4.3 + ph2));
  };
  const radius = (y) => R0 * (1 - 0.72 * Math.pow(Math.max(0, y) / H, 0.85)) * (1 + 0.55 * Math.exp(-Math.max(0, y) / 1.3));

  // ---- the trunk: rings of vertices from just under the ground to the top, closely spaced where the flare is
  const pos = [], nrm = [], uv = [], idx = [];
  const ucount = Math.max(3, Math.round(Math.PI * 2 * R0 / 1.5)), c = new THREE.Vector3();
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS, y = (t * t * 0.55 + t * 0.45) * H * 0.99 - 0.4;
    centre(Math.max(0, y), c);
    const slope = Math.max(0, (radius(y) - radius(y + 0.6)) / 0.6);
    for (let j = 0; j <= SIDES; j++) {
      const a = j / SIDES * Math.PI * 2, yy = Math.max(0, y);
      const buttress = 1 + 0.24 * Math.exp(-yy / 2.2) * Math.pow(Math.abs(Math.sin(a * 2.5 + ph1)), 1.4);
      const ripple = 1 + 0.04 * Math.sin(a * 9 + yy * 0.33 + ph2) + 0.025 * Math.sin(a * 16 - yy * 0.55 + ph1);
      const r = radius(y) * buttress * ripple;
      pos.push(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
      const l = Math.hypot(1, slope); nrm.push(Math.cos(a) / l, slope / l, Math.sin(a) / l);
      uv.push(j / SIDES * ucount, (y + 0.4) / 3.2);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SIDES; j++) {
    const a = i * (SIDES + 1) + j, b = a + 1, d = a + SIDES + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  bark.push(trunk);

  // ---- limbs: three bends each, two or three branches off the end of every one, foliage at the tips
  const tips = [];
  const limb = (p, dir, len, rad, depth) => {
    const segs = depth === 0 ? 3 : 2;
    let cur = p.clone(); const d = dir.clone();
    for (let i = 0; i < segs; i++) {
      d.add(new THREE.Vector3((rnd() - 0.5) * 0.3, depth === 0 ? 0.1 : -0.03, (rnd() - 0.5) * 0.3)).normalize();
      const next = cur.clone().addScaledVector(d, len / segs);
      cyl(cur, next, rad * (1 - i / segs * 0.4), rad * (1 - (i + 1) / segs * 0.4), depth === 0 ? 7 : 5, bark);
      cur = next;
    }
    if (depth >= 1) { tips.push(cur.clone()); return; }
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + rnd() * 1.4, tilt = 0.5 + rnd() * 0.5;
      const nd = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt) * 0.6 + 0.1, Math.sin(a) * Math.sin(tilt)).addScaledVector(d, 0.8).normalize();
      limb(cur.clone().addScaledVector(d, -len * 0.18 * k), nd, len * (0.55 + rnd() * 0.2), rad * 0.5, depth + 1);
    }
  };
  const LIMBS = 11;
  for (let k = 0; k < LIMBS; k++) {
    const y = H * (0.58 + 0.4 * (k / LIMBS) + rnd() * 0.02);
    const u = clamp((y / H - 0.55) / 0.45, 0, 1);
    const bell = Math.pow(Math.sin(Math.PI * (0.1 + 0.85 * u)), 0.8);            // the crown is widest a little above its middle
    const a = k * 2.399963 + rnd() * 0.6, el = 0.3 + rnd() * 0.45;               // golden angle: no two limbs on one side
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const start = centre(y, new THREE.Vector3()).addScaledVector(dir, radius(y) * 0.6);
    limb(start, dir, H * (0.05 + 0.075 * bell) * (0.8 + rnd() * 0.4), radius(y) * 0.5, 0);
  }
  tips.push(centre(H * 0.985, new THREE.Vector3()), centre(H * 0.93, new THREE.Vector3()).add(new THREE.Vector3(1.2, 0, 0.6)));
  const canopyC = new THREE.Vector3(0, H * 0.8, 0);
  for (const t of tips) for (let k = 0; k < 9; k++) {
    const off = new THREE.Vector3(rnd() - 0.5, rnd() - 0.35, rnd() - 0.5).multiplyScalar(3.0);
    card(t.clone().add(off), 2.6 + rnd() * 1.5, rnd, cell, canopyC, leaves);
  }
  return { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves), H, R0 };
}

// A fern: a rosette of arching fronds, each a strip of quads that rises and then bends over, all lit from above
function fernGeometry(rnd, fronds = 8) {
  const pos = [], nrm = [], uv = [], idx = [], SEG = 5;
  for (let f = 0; f < fronds; f++) {
    const az = f / fronds * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const L = 0.75 + rnd() * 0.45, W = L * (0.34 + rnd() * 0.08), rise = 0.7 + rnd() * 0.5, arch = 0.55 + rnd() * 0.3;
    const dx = Math.cos(az), dz = Math.sin(az), sx = -dz, sz = dx, roll = (rnd() - 0.5) * 0.5;
    const b = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG, r = L * 0.9 * s, y = L * (rise * s - arch * s * s) + 0.03, hw = W * 0.5 * (1 - 0.3 * s);
      for (const side of [-1, 1]) {
        pos.push(dx * r + sx * hw * side, y + roll * hw * side, dz * r + sz * hw * side);
        const n = new THREE.Vector3(dx * 0.18, 0.85, dz * 0.18).normalize(); nrm.push(n.x, n.y, n.z);
        uv.push(side < 0 ? 0 : 1, s);
      }
      if (i < SEG) { const a = b + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Forest {
  constructor(game, tx) {
    this.game = game;
    this.list = [];            // {x, z, kind, canopyY, canopyR}: the trees that let their leaves go (leaves.js)
    this.colliders = [];
    this.inside = 0;           // 0..1: how deep in the wood the nomad is, eased
    this.near = 0;             // 0..1: how close to the wood, for whatever shows from outside
    this._s = {}; this._s2 = {};
    const rnd = mulberry32(5150), s = {};
    const Z = ZONES.forest;
    const area = { x0: Z.cx - Z.rx * 1.1, x1: Z.cx + Z.rx * 1.1, z0: Z.cz - Z.rz * 1.1, z1: Z.cz + Z.rz * 1.1 };

    // ---------------------------------------------------------------- where the trees stand
    const CELL = 8, grid = new Map();
    const gk = (x, z) => Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
    const anyNear = (x, z, r, fn) => {
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const a = grid.get(cx * 4096 + cz); if (a) for (const t of a) if (fn(t)) return true;
      }
      return false;
    };
    const trees = [];
    let guard = 0;
    while (trees.length < TREES && guard++ < 60000) {
      const x = area.x0 + rnd() * (area.x1 - area.x0), z = area.z0 + rnd() * (area.z1 - area.z0);
      surfaceAt(x, z, s);
      if (s.forest < 0.25) continue;
      // thinner toward the rim, open over the glades, never on the trail (trunks flare, so it is checked all round)
      if (rnd() > Math.pow(s.forest, 1.6) * (1 - s.glade * 0.97)) continue;
      if (s.path > 0.04) continue;
      let onTrail = false;
      for (const [ox, oz] of [[2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6]]) if (surfaceAt(x + ox, z + oz, this._s).path > 0.25) onTrail = true;
      if (onTrail) continue;
      const gap = 7.0 + rnd() * 2.2;
      if (anyNear(x, z, gap, (t) => Math.hypot(t.x - x, t.z - z) < gap)) continue;
      const t = { x, z, rot: rnd() * Math.PI * 2, s: 0.85 + rnd() * 0.35, v: trees.length };
      trees.push(t);
      const k = gk(x, z); (grid.get(k) || grid.set(k, []).get(k)).push(t);
    }

    // ---------------------------------------------------------------- the trees
    const nVar = 6, cells = [2, 2, 2, 2, 2, 1];                          // green crowns, and one in six turning gold
    const variants = [];
    for (let v = 0; v < nVar; v++) {
      const H = 32 + rnd() * 20;
      variants.push(growGiant(rnd, H, 0.6 + (H - 32) * 0.015 + rnd() * 0.15, cells[v]));
    }
    const windU = game.wind.uniforms;
    const barkM = new THREE.MeshStandardMaterial({ map: tx.bark.map, normalMap: tx.bark.normal, roughness: 0.96, color: 0xd6ad98 });
    barkM.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vWP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvH = position.y; vWP = worldPosition.xyz;');
      // moss climbs the foot of every trunk, thickest on the flare and thinning out as it goes up
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vH; varying vec3 vWP;\n${GLSL_NOISE}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float mn = nNoise(vWP.xz * 1.3 + vWP.y * 0.45) * 0.6 + nNoise(vWP.xz * 5.0 + vWP.y * 1.7) * 0.4;
          float moss = (1.0 - smoothstep(0.6, 6.5, vH + (mn - 0.5) * 5.0)) * smoothstep(0.25, 0.6, mn + 0.2);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.105, 0.03) * (0.7 + 0.8 * mn), clamp(moss, 0.0, 1.0) * 0.82);`);
    };
    const leafM = new THREE.MeshStandardMaterial({ map: tx.foliage, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, alphaToCoverage: true });
    leafM.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, windU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_WIND}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec4 ip = vec4(0.0, 0.0, 0.0, 1.0);
            #ifdef USE_INSTANCING
              ip = instanceMatrix * ip;
            #endif
            // the crowns are forty metres up: a slow sway that grows with height, and a flutter in the leaves
            float hk = clamp(transformed.y / 42.0, 0.0, 1.2);
            float g = windGust(ip.xz);
            float sway = sin(uWindTime * 0.8 + ip.x * 0.21 + ip.z * 0.13) * 0.5 + 0.5;
            transformed.xz += uWindDir * (g * 0.34 + sway * 0.22) * hk * hk;
            transformed += vec3(sin(uWindTime * 3.1 + position.x * 1.7 + position.z), cos(uWindTime * 2.7 + position.y * 1.3), sin(uWindTime * 3.4 + position.z * 1.9)) * 0.06 * (0.4 + g * 0.3) * hk;
          }`);
      addTranslucency(sh, '0.9');
    };

    const group = new THREE.Group();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), p3 = new THREE.Vector3(), sc = new THREE.Vector3();
    // the wood is built in blocks of trees, so the parts out of view (and out of reach of the shadow map) are skipped whole
    const BLOCK = 36, blocks = new Map();
    for (const t of trees) { const k = Math.floor(t.x / BLOCK) * 1000 + Math.floor(t.z / BLOCK); (blocks.get(k) || blocks.set(k, []).get(k)).push(t); }
    for (const block of blocks.values()) variants.forEach((V, v) => {
      const mine = block.filter(t => t.v % nVar === v);
      if (!mine.length) return;
      const bm = new THREE.InstancedMesh(V.bark, barkM, mine.length), lm = new THREE.InstancedMesh(V.leaves, leafM, mine.length);
      mine.forEach((t, i) => {
        m4.compose(p3.set(t.x, groundY(t.x, t.z) - 0.1, t.z), q.setFromAxisAngle(up, t.rot), sc.setScalar(t.s));
        bm.setMatrixAt(i, m4); lm.setMatrixAt(i, m4);
        bm.setColorAt(i, col.setScalar(0.8 + rnd() * 0.35));
        // each crown a little different: deeper green, bluer, or yellower
        lm.setColorAt(i, cells[v] === 1 ? col.setRGB(1.0, 0.85 + rnd() * 0.15, 0.7 + rnd() * 0.2) : col.setRGB(0.7 + rnd() * 0.3, 0.82 + rnd() * 0.25, 0.7 + rnd() * 0.3));
        this.list.push({ x: t.x, z: t.z, kind: 'forest', canopyY: V.H * 0.85 * t.s, canopyR: V.H * 0.2 * t.s });
        this.colliders.push({ x: t.x, z: t.z, r: V.R0 * 1.4 * t.s + 0.1, tall: true });
      });
      for (const m of [bm, lm]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    });
    game.scene.add(group);
    this.group = group;

    // ---------------------------------------------------------------- ferns
    const fernGeo = fernGeometry(rnd);
    const fernM = new THREE.MeshStandardMaterial({ map: tx.fern, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.75, alphaToCoverage: true });
    this.uPlayer = { value: new THREE.Vector3() };
    fernM.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, windU, { uPlayer: this.uPlayer, uTrample: game.trample.uniform, uTrampleRect: { value: game.trample.rect } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${GLSL_WIND} ${GLSL_TRAMPLE}\nuniform vec3 uPlayer;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float hx = clamp(length(position.xz) / 0.9, 0.0, 1.0);                    // how far out along its frond this vertex is
            float g = windGust(ip.xz);
            transformed.xz += uWindDir * (0.03 + 0.07 * g) * hx * (0.6 + 0.4 * sin(uWindTime * 1.7 + ip.x * 2.1 + ip.z * 1.7));
            // they part around the nomad ...
            vec2 toP = ip.xz - uPlayer.xz; float pd = length(toP);
            float push = (1.0 - smoothstep(0.25, 1.5, pd)) * step(abs(uPlayer.y - ip.y), 1.2);
            transformed.xz += toP / max(pd, 1e-3) * push * 0.55 * hx;
            transformed.y *= 1.0 - 0.45 * push * hx;
            // ... and lie pressed where he has been
            vec4 tr = trampleAt(ip.xz); float pressed = clamp(max(tr.z, tr.w * 0.5), 0.0, 1.0);
            transformed.y *= 1.0 - 0.55 * pressed; transformed.xz += tr.xy * 0.25 * pressed * hx;
          }`);
      addTranslucency(sh, '0.8');
    };
    const ferns = [];
    guard = 0;
    while (ferns.length < FERNS && guard++ < 60000) {
      const x = area.x0 + rnd() * (area.x1 - area.x0), z = area.z0 + rnd() * (area.z1 - area.z0);
      surfaceAt(x, z, s);
      if (s.forest < 0.2 || s.path > 0.25 || rnd() > s.fern * 0.95) continue;
      if (anyNear(x, z, 3.2, (t) => Math.hypot(t.x - x, t.z - z) < 1.7 * t.s + 0.7)) continue;      // not on a trunk's flare
      ferns.push({ x, z, rot: rnd() * 6.283, s: (0.38 + rnd() * 0.42) * (1 + s.glade * 0.35) });
    }
    const fm = new THREE.InstancedMesh(fernGeo, fernM, ferns.length);
    ferns.forEach((f, i) => {
      m4.compose(p3.set(f.x, groundY(f.x, f.z) - 0.03, f.z), q.setFromAxisAngle(up, f.rot), sc.setScalar(f.s));
      fm.setMatrixAt(i, m4);
      fm.setColorAt(i, col.setRGB(0.9 + rnd() * 0.4, 1.0 + rnd() * 0.3, 0.8 + rnd() * 0.3));
    });
    fm.receiveShadow = true;
    game.scene.add(fm);
    this.ferns = fm; this.fernMax = ferns.length;

    // ---------------------------------------------------------------- what falls and what floats
    this.leafFall = new LeafFall(game, tx.leaf);
    this.motes = new Motes(game, softSprite());
    this.mats = new Set(); this._scanAt = -1e9; this._k = 1;
  }

  setQuality(q) {
    this.ferns.count = Math.round(this.fernMax * q.veg);
    this.leafFall.setQuality(q); this.motes.setQuality(q);
  }

  update(dt, game) {
    const P = game.player, cam = game.camera.position;
    // how deep in the wood the nomad stands (and the camera, which may be out in the meadow looking in): eased,
    // so walking in under the trees brings the shade down like a slow breath rather than a switch
    const a = surfaceAt(P.pos.x, P.pos.z, this._s).forest, b = surfaceAt(cam.x, cam.z, this._s2).forest;
    this.inside = damp(this.inside, smoothstep(0.15, 0.85, (a + b) * 0.5), 1.4, dt);
    // for what can be seen from the edge: shafts, falling leaves, the tall shadows
    this.near = damp(this.near, 1 - smoothstep(1.0, 1.9, ellipseE(ZONES.forest, cam.x, cam.z)), 1.2, dt);
    const sky = game.sky;
    sky.forest = this.inside; sky.forestNear = this.near;
    this.uPlayer.value.copy(P.pos);
    this.leafFall.update(dt, game, this.near);
    this.motes.update(dt, game, this.near);
  }

  // Under the canopy the sky is mostly leaves: every standard material gets less of the sky's ambient light (the sun
  // and the moon are direct lights and keep all of theirs). Called just before each frame is drawn.
  prepare() {
    const now = performance.now(), sc = this.game.scene;
    if (now - this._scanAt > 3000) {                              // things come and go (walls, arrows): look again now and then
      this._scanAt = now; this.mats.clear();
      sc.traverse((o) => { const m = o.material; if (m) for (const x of Array.isArray(m) ? m : [m]) if (x.isMeshStandardMaterial) this.mats.add(x); });
    }
    const k = 1 - AMBIENT_SHADE * this.inside;
    for (const m of this.mats) {
      if (m.userData.envBase === undefined) m.userData.envBase = m.envMapIntensity;
      m.envMapIntensity = m.userData.envBase * k;
    }
  }
}
