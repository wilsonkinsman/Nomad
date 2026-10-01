// Fairies: twelve of them live across the plain, each worth a skill point (skills.js keeps which have been found).
// A fairy is a mote of warm light on two pairs of gossamer wings, looping and bobbing about the place she lives and
// trailing sparkles. A faint column of light rises from her so she can be picked out from across the field, a
// chime rings as you come near, and the compass shows her within SEE metres (all of them in admin mode). Walk into
// her and she bursts into sparks: a skill point. Most float at head height. A few are harder: one on top of a great
// rock (jump for her), one in the crown of the lone tree and one on the top of the gate to the oni's ring (a Sky Slam
// or the Wind Crow reaches them).
import * as THREE from 'three';
import { groundY } from './world.js';
import { clamp, lerp } from './util.js';
import { GATE } from './boss.js';

const SEE = 60, CHIME = 26, REACH = 1.4, AWAKE = 140;
const TAU = Math.PI * 2;

// where they live: [x, z, height above the ground, the place]
export const FAIRIES = [
  [3.4, 9.6, 2.0, 'round the prayer flag at the crossroads cairn'],
  [19.6, 25.5, 1.1, 'behind the big rock in the meadow'],
  [52, -38, 0.8, 'down in the heart of the wheat'],
  [110.8, -6.6, 2.75, 'on top of the great rock by the east road'],
  [40.5, -20.25, 5.6, 'in the crown of the lone tree'],
  [-50, -40, 1.3, 'among the trees of the hollow'],
  [-56, -106, 1.2, 'where the north road leaves the plain'],
  [-46, 58, 1.4, 'up on the snowy rise'],
  [-82, 92, 1.3, 'at the top of the far snowfield'],
  [-124, 26, 1.2, 'at the west end of the road, in the mist'],
  [10, 72, 1.2, 'out in the southern meadow'],
  [GATE.x, GATE.z, GATE.top + 0.5, 'on the top of the gate to the ring of stones'],
];

// a soft round glow, white at the middle
function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, inner); r.addColorStop(0.25, outer); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// a gossamer wing: a pale teardrop with a few veins, brightest at its edge
function wingTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
  g.beginPath(); g.moveTo(32, 124); g.bezierCurveTo(-6, 90, 2, 10, 32, 4); g.bezierCurveTo(62, 10, 70, 90, 32, 124); g.closePath();
  const f = g.createLinearGradient(0, 124, 0, 4); f.addColorStop(0, 'rgba(255,240,250,0.15)'); f.addColorStop(1, 'rgba(255,235,250,0.55)');
  g.fillStyle = f; g.fill();
  g.strokeStyle = 'rgba(255,250,255,0.9)'; g.lineWidth = 2.5; g.stroke();
  g.strokeStyle = 'rgba(255,245,255,0.5)'; g.lineWidth = 1.2;
  for (const dx of [-12, 0, 12]) { g.beginPath(); g.moveTo(32, 120); g.quadraticCurveTo(32 + dx * 0.5, 60, 32 + dx, 14); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Fairies {
  constructor(game) {
    this.game = game;
    game.skills.totals.fairy = FAIRIES.length;
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
    this.haloM = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,250,235,1)', 'rgba(255,190,220,0.45)'), ...add });
    this.coreM = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(255,240,200,0.9)'), ...add });
    this.wingM = new THREE.MeshBasicMaterial({ map: wingTexture(), side: THREE.DoubleSide, ...add });
    // the column of light: brightest at the foot, gone at the top, soft at its edges
    this.beamM = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } }, ...add, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vU; varying vec3 vN, vV; void main() { vU = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uT; varying vec2 vU; varying vec3 vN, vV;
        void main() {
          float face = abs(dot(normalize(vN), normalize(vV)));
          float shimmer = 0.75 + 0.25 * sin(vU.y * 18.0 - uT * 3.0 + vU.x * 6.2832);
          float a = pow(1.0 - vU.y, 2.0) * face * face * shimmer * 0.16;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.95) * a, 1.0);
        }`,
    });
    const beamGeo = new THREE.CylinderGeometry(0.22, 0.45, 9, 14, 1, true).translate(0, 4.5, 0);
    const wingGeo = new THREE.PlaneGeometry(0.11, 0.2).translate(0, 0.1, 0);
    this.list = FAIRIES.map(([x, z, h, where], i) => {
      const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
      const halo = new THREE.Sprite(this.haloM); halo.scale.setScalar(0.6); halo.renderOrder = 15;
      const core = new THREE.Sprite(this.coreM); core.scale.setScalar(0.13); core.renderOrder = 16;
      body.add(halo, core);
      // two pairs of wings, the upper pair larger, each on a pivot at her back
      const wings = [];
      for (const [side, up, s] of [[1, 1, 1], [-1, 1, 1], [1, -1, 0.7], [-1, -1, 0.7]]) {
        const p = new THREE.Group(); p.position.set(side * 0.015, 0.01 * up, -0.02);
        const m = new THREE.Mesh(wingGeo, this.wingM); m.scale.setScalar(s); m.rotation.z = -side * (up > 0 ? 0.9 : 2.3); m.renderOrder = 14;
        p.add(m); body.add(p); wings.push({ p, side });
      }
      const beam = new THREE.Mesh(beamGeo, this.beamM); beam.renderOrder = 11; beam.frustumCulled = false;
      const gy = groundY(x, z);
      beam.position.set(x, gy, z);
      game.scene.add(group, beam);
      const mark = game.hud.addMark('✦', 'fairy');
      return { i, x, z, gy, h, where, group, body, wings, beam, mark, ph: i * 2.3, pull: 0, chime: 0, near: false, spark: 0, pos: new THREE.Vector3(x, gy + h, z) };
    });
    this.sync();
    game.skills.onWipe(() => this.sync());
  }

  // show the ones still to be found
  sync() {
    for (const f of this.list) { f.found = this.game.skills.got('fairy:' + f.i); f.group.visible = f.beam.visible = !f.found; f.mark.off = true; }
  }

  update(dt, G) {
    const P = G.player, t = G.time, admin = G.skills.admin;
    this.beamM.uniforms.uT.value = t;
    const cx = P.pos.x, cz = P.pos.z;
    for (const f of this.list) {
      if (f.found) continue;
      const d = Math.hypot(f.x - cx, f.z - cz);
      f.mark.off = !(admin || d < SEE);
      if (!f.mark.off) f.mark.bearing = (Math.atan2(f.x - cx, -(f.z - cz)) * 180 / Math.PI + 360) % 360;
      const awake = d < AWAKE;
      f.group.visible = awake;
      if (!awake) continue;
      // she loops about her place, bobbing; close by she comes to meet you (part of the way: down no more than a
      // metre, so the high ones still want a jump or a leap)
      const ph = f.ph;
      const hx = f.x + Math.sin(t * 0.9 + ph) * 0.45 + Math.sin(t * 2.3 + ph) * 0.08, hz = f.z + Math.sin(t * 1.3 + ph * 1.7) * 0.3;
      const hy = f.gy + f.h + Math.sin(t * 2.1 + ph) * 0.14;
      f.pull = clamp(f.pull + (d < 5 ? dt : -dt) * 1.5, 0, 0.55);
      const before = f.pos.clone();
      f.pos.set(lerp(hx, cx, f.pull), lerp(hy, Math.max(hy - 1, P.pos.y + 1.2), f.pull), lerp(hz, cz, f.pull));
      f.group.position.copy(f.pos);
      const mvx = f.pos.x - before.x, mvz = f.pos.z - before.z;
      if (mvx * mvx + mvz * mvz > 1e-6) f.group.rotation.y = Math.atan2(mvx, mvz) + Math.PI / 2;
      // wings a blur of beats, her light pulsing
      const beat = Math.sin(t * 46 + ph);
      for (const w of f.wings) w.p.rotation.y = w.side * (0.35 + 0.55 * beat);
      f.body.children[0].scale.setScalar(0.55 + 0.08 * Math.sin(t * 5 + ph));
      // sparkles trailing behind
      if (d < 45) {
        f.spark += dt * 14;
        while (f.spark >= 1) { f.spark -= 1; G.particles.emit('fairy', f.pos.x, f.pos.y, f.pos.z, (Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4, 0.3, 1); }
      }
      // a chime as you come near, and now and then while you are close, softer the further off
      f.chime -= dt;
      if (d < CHIME && (f.chime <= 0 || !f.near)) { f.chime = 2.2 + Math.random(); G.audio?.fairy('near', 1 - d / CHIME); }
      f.near = d < CHIME;
      // found: within reach of his body
      if (Math.hypot(f.pos.x - cx, f.pos.z - cz) < REACH && f.pos.y > P.pos.y - 0.3 && f.pos.y < P.pos.y + 1.9) this.find(f);
    }
  }

  find(f) {
    const G = this.game, p = f.pos;
    f.found = true; f.group.visible = f.beam.visible = false; f.mark.off = true;
    G.skills.award('fairy:' + f.i);
    for (let i = 0; i < 60; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * TAU, q = Math.sqrt(1 - u * u), s = 1.5 + Math.random() * 3;
      G.particles.emit('fairy', p.x, p.y, p.z, Math.cos(a) * q * s, u * s + 1, Math.sin(a) * q * s, 0.3, 1);
    }
    G.gale?.ring(p.x, p.y, p.z, 3, 0.6, 0.5);
    G.audio?.fairy('found');
    G.hud?.callout('SKILL POINT', 'gold');
    G.hud?.floatText(p.clone().setY(p.y + 0.4), '+1 skill point', 'gold word');
    const n = G.skills.count('fairy');
    G.hud?.hint(`A fairy, ${f.where}: ${n} of ${FAIRIES.length} found  ·  press K to learn a skill`, 5);
  }
}
