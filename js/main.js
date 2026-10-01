// Nomad: boot, main loop, menu.
import * as THREE from 'three';
import * as World from './world.js';
import { Sky } from './sky.js';
import { Pipeline } from './post.js';
import { buildTerrain, buildMountains } from './terrain.js';
import { groundTextures, fabricTextures, leatherTextures, strawTextures, furTexture, leafAtlas, foliageAtlas, barkTextures, woodTextures, rockTextures, softSprite } from './textures.js';
import { StampField, CutField } from './stamps.js';
import { Grass } from './grass.js';
import { Wheat } from './wheat.js';
import { Snow } from './snow.js';
import { Leaves } from './leaves.js';
import { Trees } from './trees.js';
import { Props } from './props.js';
import { Particles, Fireflies } from './particles.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { BodyContact } from './contact.js';
import { AtsuModel, loadAtsu } from './atsu.js';
import { GLTFLoader } from '../lib/addons/GLTFLoader.js';
import { Player } from './player.js';
import { Nomad } from './nomad.js';
import { Wind } from './wind.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Skills } from './skills.js';
import { Flash } from './flash.js';
import { Enemies, TRAINING } from './enemies.js';
import { Bow } from './bow.js';

const QUALITY = {
  low:    { ratio: 0.6,  msaa: 0, shadow: 1024, veg: 0.5 },
  medium: { ratio: 0.75, msaa: 2, shadow: 2048, veg: 0.75 },
  high:   { ratio: 1.0,  msaa: 4, shadow: 2048, veg: 1.0 },
};
const SAVE = 'nomad_settings';
const settings = Object.assign({ night: false, quality: 'medium', volume: 0.7, character: 'ronin' }, (() => { try { return JSON.parse(localStorage.getItem(SAVE)) || {}; } catch { return {}; } })());
// the frog ronin became the main character: older saves that picked Atsu start as the ronin once
if (settings.charV !== 2) { settings.character = 'ronin'; settings.charV = 2; }
const saveSettings = () => { try { localStorage.setItem(SAVE, JSON.stringify(settings)); } catch { /* private mode */ } };

const $ = (id) => document.getElementById(id);
const frame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 50); });
async function progress(p, text) { $('load-fill').style.width = (p * 100).toFixed(0) + '%'; if (text) $('load-text').textContent = text; await frame(); }

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 6000);
const input = new Input(canvas);
const rig = new CameraRig(camera);

const game = {
  THREE, renderer, scene, camera, input, rig, settings,
  state: 'loading', systems: [], time: 0, fade: 0, hitStop: 0,
  player: null, sky: null, post: null,
};
window.__nomad = game;

function applyQuality() {
  const q = QUALITY[settings.quality] || QUALITY.medium;
  const w = innerWidth, h = innerHeight;
  const ratio = Math.min(devicePixelRatio || 1, 1.5) * q.ratio;
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (game.post) {
    if (game.post.msaa !== q.msaa) game.post.setQuality(q.msaa);
    game.post.setSize(Math.floor(w * ratio), Math.floor(h * ratio));
  }
  if (game.sky && game.sky.light.shadow.mapSize.x !== q.shadow) {
    game.sky.light.shadow.mapSize.set(q.shadow, q.shadow);
    game.sky.light.shadow.map?.dispose(); game.sky.light.shadow.map = null;
  }
  for (const s of game.systems) s.setQuality?.(q);
}
addEventListener('resize', applyQuality);

async function boot() {
  await progress(0.05, 'Shaping the land…');
  World.bake();
  await progress(0.3, 'Painting the ground…');
  const tex = World.makeTextures();
  game.worldTex = tex;
  const ground = groundTextures();
  await progress(0.45, 'Raising the mountains…');
  game.terrainExtra = {};
  scene.add(buildTerrain(tex, ground, game.terrainExtra));
  scene.add(buildMountains());
  game.sky = new Sky(renderer, scene);
  game.post = new Pipeline(renderer, scene, camera, game.sky);
  await progress(0.6, 'Dressing the wanderer…');
  game.wind = new Wind();
  const tx = { fabric: fabricTextures(), leather: leatherTextures(), straw: strawTextures(), fur: furTexture(),
    bark: barkTextures(false), birch: barkTextures(true), foliage: foliageAtlas(), wood: woodTextures(), rock: rockTextures() };
  game.tx = tx;
  game.player = new Player(game, tx, await characterModel(settings.character));
  syncMenu();
  await progress(0.7, 'Growing the meadow…');
  game.trample = new StampField(renderer, { kind: 'veg', res: 512, minX: -128, minZ: -128, size: 256 });
  Object.assign(game.terrainExtra, { uTrample: game.trample.uniform, uTrampleRect: { value: game.trample.rect } });
  game.cut = new CutField(renderer);          // where the sword has cut the grass and wheat, which then grows back
  game.particles = new Particles(game, softSprite());
  game.trees = new Trees(game, tx);
  game.props = new Props(game, tx);
  game.grass = new Grass(game);
  game.wheat = new Wheat(game);
  await progress(0.8, 'Letting the snow settle…');
  game.snow = new Snow(game);
  await progress(0.88, 'Scattering the leaves…');
  game.leaves = new Leaves(game, leafAtlas(), game.trees.list);
  game.player.colliders = [...game.trees.colliders, ...game.props.colliders];
  game.audio = new Audio(); game.audio.volume = settings.volume;
  game.hud = new Hud(game);
  game.fireflies = new Fireflies(game, softSprite());
  game.contact = new BodyContact(game);
  game.skills = new Skills();
  game.flash = new Flash(game);
  game.enemies = new Enemies(game);
  game.player.colliders.push(...game.enemies.colliders);
  game.bow = new Bow(game);
  game.systems.push(game.grass, game.wheat, game.snow, game.leaves, game.props, game.particles, game.fireflies, game.hud, game.audio);
  game.systems.push(game.flash, game.enemies, game.bow);
  game.systems.unshift(game.contact);    // body hitboxes stamp before the snow and leaves update
  wireEvents();
  game.sky.setNight(settings.night);
  applyQuality();
  await progress(1, 'The sun is coming up…');
  // warm up shaders so the first real frame doesn't hitch
  update(1 / 60); renderer.compile(scene, camera);
  game.post.render(0.016, 0);
  $('loading').classList.add('gone');
  setTimeout(() => $('loading').remove(), 1400);
  showMenu(true);
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------------------ menu
function showMenu(on) {
  $('menu').hidden = false;
  $('menu').classList.toggle('fading', !on);
  $('hud').hidden = on;
  input.enabled = !on;
  game.state = on ? 'menu' : 'play';
  if (on && document.pointerLockElement) document.exitPointerLock();
  if (!on) canvas.requestPointerLock?.();
  $('btn-start').textContent = game.started ? 'Continue' : 'Wander';
}
// characters load the first time they're picked: the frog ronin (default), Atsu, or the procedural nomad
const CHARACTERS = {
  ronin: { label: 'The ronin', file: 'ronin', opts: { ribbons: false, keepSplay: true, camHeight: 1.18, style: { arm: 0.5, elbow: 0.55, armOut: 0.1 }, sword: {} } },
  atsu: { label: 'Atsu', file: 'atsu', opts: {} },
};
game.models = {};
async function characterModel(c) {
  if (c === 'nomad' || !CHARACTERS[c]) return game.models.nomad || null;
  if (game.models[c]) return game.models[c];
  const C = CHARACTERS[c];
  try {
    game.models[c] = new AtsuModel(await loadAtsu(GLTFLoader, 'assets/', C.file), game.tx, C.opts);
    game.charError = null;
  } catch (e) {
    console.error(C.label + ' failed to load', e);
    game.charError = C.label + ' could not load here (' + (e.message || String(e)) + '), so the nomad walks instead.';
    return game.models.nomad || null;
  }
  game.atsu = game.models.atsu;      // dev tools look for it
  return game.models[c];
}
function currentCharacter() {
  const m = game.player?.model;
  for (const c in game.models) if (game.models[c] === m) return c;
  return game.player ? 'nomad' : settings.character;
}
function syncMenu() {
  $('btn-night').setAttribute('aria-pressed', settings.night ? 'true' : 'false');
  const cur = currentCharacter();
  for (const b of $('seg-character').children) b.classList.toggle('on', b.dataset.c === cur);
  $('char-note').hidden = !game.charError;
  $('char-note').textContent = game.charError || '';
  for (const b of $('seg-quality').children) b.classList.toggle('on', b.dataset.q === settings.quality);
  $('vol').value = settings.volume;
}
$('btn-start').onclick = () => {
  const first = !game.started;
  game.started = true; showMenu(false);
  game.audio?.resume(); game.audio?.setVolume(settings.volume);
  if (first) setTimeout(() => game.hud?.hint('WASD move · Shift sprint · Space jump · C dive · X walk', 7), 1200);
};
$('btn-night').onclick = () => {
  settings.night = !settings.night; saveSettings(); syncMenu();
  game.sky.setNight(settings.night);
  for (const s of game.systems) s.setNight?.(settings.night);
};
$('seg-character').onclick = async (e) => {
  const c = e.target.dataset.c; if (!c || !game.player) return;
  settings.character = c; saveSettings();
  if (!game.models.nomad && !Object.values(game.models).includes(game.player.model)) game.models.nomad = game.player.model;
  let m = await characterModel(c);
  if (!m) m = game.models.nomad || (game.models.nomad = new Nomad(game.tx));
  if (m !== game.player.model) game.player.setModel(m);
  syncMenu();
};
$('seg-quality').onclick = (e) => { const q = e.target.dataset.q; if (!q) return; settings.quality = q; saveSettings(); syncMenu(); applyQuality(); };
$('btn-skills').onclick = () => game.skills.open();
// the training ground: the empty field to the west, with a dummy and an enemy to practise on
$('btn-train').onclick = () => {
  game.player.weapon?.reset(); game.player.teleport(TRAINING.x + 6.5, TRAINING.z - 1.5); game.player.heading = -Math.PI / 2;
  game.rig.yaw = Math.PI / 2; game.rig.focus.set(0, 0, 0);
  $('btn-start').click();
};
$('vol').oninput = (e) => { settings.volume = +e.target.value; saveSettings(); game.audio?.setVolume(settings.volume); };
syncMenu();
addEventListener('keydown', (e) => {
  if (!game.skills) return;
  // K opens the skill tree (from the game it opens the menu behind it); Esc or K closes it again
  if (e.code === 'KeyK' && !e.repeat) { if (game.state === 'play') showMenu(true); game.skills.toggle(); return; }
  if (e.code === 'Escape' && game.skills.isOpen) { game.skills.close(); e.stopImmediatePropagation(); return; }
}, true);
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game.state === 'play' && !input.locked) showMenu(true);
});
document.addEventListener('pointerlockchange', () => {
  // leaving pointer lock with Esc opens the menu
  if (!document.pointerLockElement && game.state === 'play') showMenu(true);
});

// ------------------------------------------------------------------------------ the world reacts
function interact(dt) {
  const P = game.player, sp = Math.hypot(P.vel.x, P.vel.z);
  if (P.grounded && sp > 0.3 && P.state === 'ground') {
    const s = P.surface, veg = s.grass + s.wheat + s.leaves;
    if (veg > 0.2) {
      const dx = P.vel.x / sp, dz = P.vel.z / sp;
      const lasting = s.leaves > 0.4 ? 0.9 : s.wheat > 0.4 ? 0.8 : 0.35;
      game.trample.stamp(P.pos.x, P.pos.z, 0.42 + (P.sprinting ? 0.15 : 0), Math.min(1, 0.55 + sp * 0.08), dx, dz, lasting);
    }
  }
}

function wireEvents() {
  const P = game.player, pz = game.particles;
  const bodyStamp = (p, r, strength) => game.trample.stamp(p.x, p.z, r, strength, Math.sin(P.heading), Math.cos(P.heading), 1);
  P.on('step', (side, p, s, speed, sprint) => {
    game.snow.onStep(side, p, s, speed, sprint, P.heading);
    game.leaves.onStep(side, p, s, speed);
    if (s.kind === 'dirt' && speed > 3) pz.emit('dust', p.x, p.y + 0.03, p.z, P.vel.x * 0.1, 0.4, P.vel.z * 0.1, 0.4, sprint ? 3 : 1);
    if (s.kind === 'puddle') pz.emit('water', p.x, p.y + 0.02, p.z, P.vel.x * 0.25, 1.6 + speed * 0.25, P.vel.z * 0.25, 1.0, 8 + Math.round(speed * 2));
    if (s.wheat > 0.5 && speed > 2.5 && Math.random() < 0.5) pz.emit('seed', p.x, p.y + 0.9, p.z, P.vel.x * 0.2, 0.3, P.vel.z * 0.2, 0.6, 2);
    game.audio?.step(s, speed, sprint);
  });
  const impact = (kind) => (p, s, v) => {
    game.snow.onImpact(p, P.heading, kind);
    game.leaves.onImpact(p, kind, v);
    if (kind !== 'land' || v > 5) bodyStamp(p, kind === 'land' ? 0.8 : 1.3, 1);
    const firm = s.kind === 'dirt' || s.kind === 'grass';
    if (firm && (kind !== 'land' || v > 6)) pz.emit('dust', p.x, p.y + 0.05, p.z, 0, 0.6, 0, 1.2, kind === 'land' ? 6 : 12);
    if (s.kind === 'puddle') pz.emit('water', p.x, p.y + 0.02, p.z, 0, 2.4, 0, 2.0, 30);
    game.audio?.impact(s, kind, v);
  };
  P.on('land', impact('land'));
  P.on('roll', impact('roll'));
  P.on('flop', impact('flop'));
  P.on('dive', (p, s) => game.audio?.whoosh());
  P.on('rollEnd', (p, heading, speed) => game.contact.endImpact(p, heading, speed));
  P.on('jump', (p, s) => game.audio?.step(s, 3, false));
}

// ------------------------------------------------------------------------------ loop
function update(dt) {
  game.time += dt;
  input.pollPad();
  if (input.pressed.has('Escape') && game.state === 'play') showMenu(true);
  const inMenu = game.state !== 'play';
  game.wind.update(dt);
  game.player.update(dt, inMenu);
  interact(dt);
  for (const s of game.systems) s.update?.(dt, game);
  game.trample.update(dt);
  game.cut.update(dt);
  rig.update(dt, game.player, input, inMenu);
  game.sky.update(dt, game.player.pos);
  game.sky.followCamera(camera);
  input.endFrame();
}
game.update = update;
game.render = (dt = 0.016) => game.post.render(dt, game.fade);

let last = performance.now();
function loop(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!game.paused) {
    // a heavy hit stops the world for a breath: it crawls for a few frames, and the blow lands with weight
    if (game.hitStop > 0) { game.hitStop -= dt; dt *= 0.1; }
    game.fade = Math.min(1, game.fade + dt * 0.5);
    update(dt);
    game.render(dt);
  }
  requestAnimationFrame(loop);
}

boot().catch((e) => { console.error(e); $('load-text').textContent = 'Something went wrong: ' + e.message; });
