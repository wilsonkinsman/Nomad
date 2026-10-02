// The people of Brackenford. Each is a small skinned figure built here from simple parts (hose and boots, a tunic or
// a long dress, an apron, sleeves, a head with hair, a hat or a hood or a coif) in colours of their own, on a
// skeleton of seventeen bones that is posed by hand every frame: walking, running, standing about, talking with
// their hands, sitting on a bench, leaning over a stall, waving, and working (the smith at his anvil, the innkeeper
// polishing a mug, the stallholders at their wares).
//
// Each of the wanderers has a home. They walk the village's streets and in at its doors (Village.graph: places to
// go, indoors and out, and the straight ways between them), stop at the stalls and the well and the pond, sit on the
// benches, chat when two of them stand close, go home to sit at their own table or warm themselves at the hearth,
// browse in the shops, take a bench at the inn or a pew in the chapel; at night most go home to bed (and lie
// there asleep), and some to the inn. They step round each other and round him, turn their heads to watch him go
// by and greet him, and run home if he swings his sword among them. The stallholders, the smith, and the people
// who keep the inn, the shop counter, the bakehouse, the smithy's showroom and the chapel keep their places, and
// talk to him (in the dialog box at the foot of the screen) when he stops in front of them. And there is a cat.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';
import { groundY } from './world.js';
import { clamp, damp, dampAngle, wrapAngle, mulberry32 } from './util.js';
import { pushOut } from './collide.js';
import { SMITHY, WELL } from './village.js';

const PI = Math.PI, TAU = PI * 2;

// ------------------------------------------------------------------------------ the skeleton
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'uaL', 'faL', 'hdL', 'uaR', 'faR', 'hdR', 'thL', 'shL', 'ftL', 'thR', 'shR', 'ftR'];
const PARENT = { spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', uaL: 'chest', faL: 'uaL', hdL: 'faL', uaR: 'chest', faR: 'uaR', hdR: 'faR', thL: 'hips', shL: 'thL', ftL: 'shL', thR: 'hips', shR: 'thR', ftR: 'shR' };
// where each joint is in the bind pose, standing, facing +z (his left is +x), for a figure 1.78 m tall
const JOINT = {
  hips: [0, 0.92, 0], spine: [0, 1.0, 0], chest: [0, 1.2, 0], neck: [0, 1.46, 0], head: [0, 1.55, 0],
  uaL: [0.2, 1.42, 0], faL: [0.2, 1.15, 0], hdL: [0.2, 0.91, 0], uaR: [-0.2, 1.42, 0], faR: [-0.2, 1.15, 0], hdR: [-0.2, 0.91, 0],
  thL: [0.095, 0.88, 0], shL: [0.095, 0.47, 0], ftL: [0.095, 0.07, 0], thR: [-0.095, 0.88, 0], shR: [-0.095, 0.47, 0], ftR: [-0.095, 0.07, 0],
};
const B = Object.fromEntries(BONES.map((b, i) => [b, i]));
const NB = BONES.length, HY = NB * 3;          // the pose: three angles a bone, then how far the hips are lowered

// ------------------------------------------------------------------------------ who they are
const SKIN = [0xe8c0a0, 0xd8a882, 0xc89068, 0xa8704a, 0x7a4a30, 0xf0d0b4];
const HAIR = [0x2a1a10, 0x4a2a14, 0x6a4424, 0x9a7040, 0xc8a464, 0x8a8a86, 0x8a3418, 0xd8d4cc];
const TUNIC = [0x8a3a2a, 0x3a5a7a, 0x56683a, 0x7a6a4a, 0x6a4a6a, 0xa8844a, 0x4a4c56, 0x2e4a4a];
const DRESS = [0x6a3a3a, 0x3a4a6a, 0x5a6a44, 0x8a6a4a, 0x7a5a7a, 0x9a845a, 0x4a5a6a, 0xa05a3a];
const HOSE = [0x4a3a2a, 0x3a3a3a, 0x5a4a3a, 0x6a6a56, 0x3a4234];
const BOOT = [0x3a2a1c, 0x2a2018, 0x4a3424];
const pick = (rnd, a) => a[(rnd() * a.length) | 0];

// the people who keep their places: where they stand comes from the village
const KEEPERS = {
  goods: { name: 'Osric the merchant', man: true, hat: 'cap', apron: 0x8a7a5a, work: 'tend',
    lines: ['Rope, lamp oil, good wool cloth, needles, nails... whatever you need, Osric has it.', 'Mind, I only sell to folk with coin. You look like you sleep in hedges.', 'They say there are fairies out in the meadow. Bright little things. Catch one and you might learn something.'] },
  produce: { name: 'Wenna', man: false, hat: 'kerchief', apron: 0xe8e0cc, work: 'tend',
    lines: ['Apples! Cabbages! Squash as big as your head!', 'All grown right here, in the fields south of the square.', 'Take an apple for the road, love. You look half starved.'] },
  bread: { name: 'Hilde the baker', man: false, hat: 'coif', apron: 0xf2eee4, work: 'tend', dress: 0x8a6a4a,
    lines: ['Fresh loaves! Still warm from the oven.', 'Up before the cock every morning, I am. The bread doesn\'t bake itself.', 'A wanderer, is it? Take a heel of bread. No charge for anyone who keeps the roads safe.'] },
  pottery: { name: 'Edda the potter', man: false, hat: 'none', hair: 'bun', apron: 0xa88a6a, work: 'tend',
    lines: ['Jugs, bowls, pots for the hearth. All thrown on my own wheel.', 'Careful with that sword near my pots, now.', 'The blue glaze? Ground from a stone they bring down from the snowy rise.'] },
  agnes: { name: 'Agnes of Wares & Sundries', man: false, hat: 'coif', apron: 0xd8c8a0, work: 'tend', dress: 0x3a4a6a,
    lines: ['Welcome in. Osric minds the stall outside; I mind everything else.', 'Lamp oil, rope, wool, needles, nails... if we haven\'t got it, you don\'t need it.', 'Mind the barrels by the door. Full of nails, the lot of them.'] },
  pip: { name: 'Pip, the baker\'s boy', man: true, hat: 'cap', apron: 0xf2eee4, work: 'tend',
    lines: ['Hilde has me up at four every morning, kneading.', 'Want to see the oven? Don\'t touch it. I did, once.', 'The trick is to let it rise twice. Don\'t tell her I told you.'] },
  tom: { name: 'Tom, the smith\'s apprentice', man: true, hat: 'none', hair: 'short', apron: 0x4a3424, work: 'tend', bare: true,
    lines: ['Bram made every one of these. One day I\'ll make one half as good.', 'Look all you like. Swords on the wall, armour on the stands.', 'That\'s a fine blade you carry. Don\'t let Bram see it, he\'ll want to take it apart.'] },
  priest: { name: 'Brother Aldous', man: true, hat: 'hood', robe: 0x5a4a3a, top: 0x5a4a3a, work: 'pray', night: true, grey: true,
    lines: ['Peace to you, traveller. Sit a while if you like. It is quiet here.', 'The bell? I ring it when the mood takes me. Folk say it keeps the oni away. It doesn\'t.', 'The windows came from the city, three winters ago. Every one of them carried up the road by hand.'] },
  inn: { name: 'Marta of the Green Frog', man: false, hat: 'coif', apron: 0xece6d8, work: 'wipe', dress: 0x5a6a44, night: true,
    lines: ['Welcome to the Green Frog! The rooms are full, but the ale is cold.', 'Sit yourself down at one of the tables. Mind the bench by the fire, it wobbles.'],
    oni: ['A red oni has made his camp at the old ring of stones, south of here. Folk daren\'t go that way.', 'If you mean to face him, eat something first. Nobody fights well hungry.'],
    oniDone: ['You chased off the oni? Then your first drink is on the house!', 'They\'re already singing about it in the back room. Badly.'] },
  smith: { name: 'Bram the smith', man: true, hat: 'none', hair: 'short', beard: true, apron: 0x4a3424, work: 'hammer', bare: true,
    lines: ['Mind the sparks.', 'That blade of yours... folded steel, from the far east. I couldn\'t make its like.', 'If you fight anything big, don\'t stand where it\'s going to land.'] },
};
const GREET = ['Good morrow.', 'Fair weather today.', 'Traveller.', 'Mind the well, it\'s deep.', 'Have you seen my cat?', 'Lovely day for it.', 'You\'re not from round here.', 'Welcome to Brackenford.', 'Morning!', 'Watch your step.'];
const GREET_NIGHT = ['Evening.', 'Late to be about.', 'Mind how you go.', 'Fine night.'];
const GREET_IN = ['Oh! Come in, then.', 'Shut the door behind you.', 'Make yourself at home.', 'Can I help you?', 'Wipe your feet!'];
// the keepers indoors, by the post the house gave them
const POSTS = { bar: 'inn', counter: 'agnes', trough: 'pip', bench: 'tom', altar: 'priest' };
const SCARED = ['Eek!', 'Put that away!', 'Help!', 'Not in the square!', 'Mind that blade!', 'Mother!', 'Run!'];
const BUMPED = ['Oi!', 'Watch it!', 'Steady on!', 'Hey!'];
const CHAT = [['Did you hear? An oni, out by the stones.', 'Never!', 'Big as a barn, they say.'], ['The well\'s low again.', 'It\'s been a dry month.'],
  ['Hilde\'s bread is better than ever.', 'She won\'t tell anyone her secret.'], ['Bram\'s been hammering since dawn.', 'My head knows it.'],
  ['Have you seen the cat?', 'On the cart again, I expect.'], ['They say there are fairies in the meadow.', 'Fairies! At your age.'],
  ['Market day tomorrow.', 'I\'ll bring the good apples.'], ['Rain coming, I can feel it in my knee.', 'Your knee is always wrong.']];
const SCARY = new Set(['draw', 'cut', 'overhead', 'thrust', 'plunge', 'slamland', 'storm', 'quake', 'gale']);
const TALK = 3.4;            // how near he must stop to a keeper (across a stall) for them to talk

// ------------------------------------------------------------------------------ building a figure
function figure(look, mat) {
  const parts = [], col = new THREE.Color();
  const add = (g, bone, color) => {
    g = g.index ? g.toNonIndexed() : g;
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), c = new Float32Array(n * 3);
    col.set(color);
    for (let i = 0; i < n; i++) { si[i * 4] = B[bone]; sw[i * 4] = 1; c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  };
  // a vertical limb from y0 down to y1 at (x, z), r0 at the top and r1 at the bottom
  const limb = (x, y0, y1, z, r0, r1, seg = 8) => new THREE.CylinderGeometry(r0, r1, y0 - y1, seg).translate(x, (y0 + y1) / 2, z);
  const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz).translate(x, y, z);
  const cap = (r, x, y, z, arc, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 12, 8, 0, TAU, 0, arc).scale(sx, sy, sz).translate(x, y, z);
  // a covering for the head that leaves the face open: a crown down to `top`, and round the back and sides to `low`
  // (both as angles down from the top of the head)
  const shell = (r, y, z, top, low, color, sx = 1, sy = 1.12, sz = 1.05) => {
    add(new THREE.SphereGeometry(r, 14, 6, 0, TAU, 0, top).scale(sx, sy, sz).translate(0, y, z), 'head', color);
    add(new THREE.SphereGeometry(r, 12, 5, PI * 0.9, PI * 1.2, top, low - top).scale(sx, sy, sz).translate(0, y, z), 'head', color);
  };
  const L = look;
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', x = s * 0.095;
    add(limb(x, 0.9, 0.47, 0, 0.074, 0.058), 'th' + S, L.hose);
    add(ball(0.058, x, 0.47, 0), 'sh' + S, L.hose);
    add(limb(x, 0.47, 0.25, 0, 0.056, 0.048), 'sh' + S, L.hose);
    add(limb(x, 0.27, 0.03, 0.005, 0.058, 0.056), 'sh' + S, L.boot);
    add(new THREE.BoxGeometry(0.095, 0.075, 0.22).translate(x, 0.038, 0.045), 'ft' + S, L.boot);
    // arms: the sleeve, and the forearm bare if the sleeves are rolled up
    const ax = s * 0.2;
    add(ball(0.066, ax - s * 0.01, 1.42, 0), 'chest', L.sleeve);
    add(limb(ax, 1.43, 1.15, 0, 0.054, 0.046), 'ua' + S, L.sleeve);
    add(ball(0.045, ax, 1.15, 0), 'fa' + S, L.bare ? L.skin : L.sleeve);
    add(limb(ax, 1.15, 0.94, 0, 0.044, 0.035), 'fa' + S, L.bare ? L.skin : L.sleeve);
    if (!L.bare) add(limb(ax, 0.98, 0.94, 0, 0.047, 0.047), 'fa' + S, L.cuff);
    add(ball(0.044, ax, 0.88, 0.005, 0.8, 1.3, 0.62), 'hd' + S, L.skin);
  }
  // the body: hips, waist and chest, rounded off at the shoulders
  add(limb(0, 1.0, 0.86, 0, 0.145, 0.14, 12).scale(1, 1, 0.78), 'hips', L.dress ? L.top : L.hose);
  add(limb(0, 1.2, 0.98, 0, 0.15, 0.146, 12).scale(1, 1, 0.74), 'spine', L.top);
  add(limb(0, 1.44, 1.19, 0, 0.175, 0.15, 12).scale(1, 1, 0.72), 'chest', L.top);
  add(cap(0.175, 0, 1.43, 0, PI / 2, 1, 0.32, 0.72), 'chest', L.top);
  if (L.dress) {
    add(new THREE.CylinderGeometry(0.155, 0.34, 0.97, 16).scale(1, 1, 0.86).translate(0, 0.53, 0), 'hips', L.dress);
    if (L.apron) add(new THREE.CylinderGeometry(0.164, 0.3, 0.78, 10, 1, true, -0.95, 1.9).scale(1, 1, 0.86).translate(0, 0.62, 0.004), 'hips', L.apron);
  } else {
    // a tunic to mid-thigh over the hose
    add(new THREE.CylinderGeometry(0.162, 0.21, 0.36, 14).scale(1, 1, 0.8).translate(0, 0.84, 0), 'hips', L.top);
    if (L.apron) add(new THREE.CylinderGeometry(0.17, 0.23, 0.62, 10, 1, true, -0.95, 1.9).scale(1, 1, 0.82).translate(0, 0.74, 0.006), 'hips', L.apron);
  }
  if (L.apron) add(new THREE.BoxGeometry(0.22, 0.26, 0.02).translate(0, 1.28, 0.128), 'chest', L.apron);
  add(new THREE.TorusGeometry(0.152, 0.017, 4, 16).rotateX(PI / 2).scale(1, 1, 0.78).translate(0, 1.0, 0), 'hips', L.belt);
  // the neck and the head
  add(limb(0, 1.58, 1.44, 0, 0.046, 0.05), 'neck', L.skin);
  const hy = 1.665;
  add(ball(0.104, 0, hy, 0.005, 1, 1.12, 1, 14, 10), 'head', L.skin);
  add(new THREE.ConeGeometry(0.02, 0.05, 6).rotateX(PI / 2).translate(0, hy - 0.01, 0.12), 'head', L.skinDark);
  for (const s of [-1, 1]) {
    add(ball(0.013, s * 0.036, hy + 0.018, 0.099, 1, 1, 0.6, 6, 4), 'head', 0x1a1410);
    add(ball(0.024, s * 0.104, hy, 0, 0.5, 1, 0.8, 6, 5), 'head', L.skin);
    add(new THREE.BoxGeometry(0.04, 0.008, 0.01).translate(s * 0.037, hy + 0.045, 0.1), 'head', L.hair);
  }
  add(new THREE.BoxGeometry(0.04, 0.008, 0.01).translate(0, hy - 0.05, 0.102), 'head', L.skinDark);
  if (L.beard) add(new THREE.SphereGeometry(0.098, 12, 6, -PI * 0.1, PI * 1.2, PI * 0.5, PI * 0.4).scale(1, 1.15, 1.05).translate(0, hy - 0.005, 0.012), 'head', L.hair);
  // hair, then whatever is on the head
  const hairCap = () => shell(0.112, hy + 0.012, -0.008, PI * 0.33, PI * 0.62, L.hair);
  if (L.hat !== 'hood' && L.hat !== 'coif') {
    if (L.hairStyle !== 'bald') hairCap();
    if (L.hairStyle === 'long') add(new THREE.BoxGeometry(0.2, 0.26, 0.06).translate(0, hy - 0.1, -0.075), 'head', L.hair);
    if (L.hairStyle === 'bun') add(ball(0.055, 0, hy + 0.06, -0.1), 'head', L.hair);
    if (L.hairStyle === 'bald') add(new THREE.TorusGeometry(0.1, 0.022, 4, 14, PI * 1.3).rotateX(PI / 2).rotateY(-PI * 0.15).translate(0, hy + 0.01, -0.01), 'head', L.hair);
  }
  if (L.hat === 'straw') {
    add(new THREE.CylinderGeometry(0.26, 0.26, 0.012, 18).translate(0, hy + 0.09, 0), 'head', L.hatColor);
    add(new THREE.CylinderGeometry(0.06, 0.12, 0.12, 14).translate(0, hy + 0.15, 0), 'head', L.hatColor);
  } else if (L.hat === 'cap') {
    add(cap(0.122, 0, hy + 0.03, -0.01, PI * 0.5, 1.05, 0.9, 1.08), 'head', L.hatColor);
    add(new THREE.TorusGeometry(0.118, 0.016, 4, 16).rotateX(PI / 2).scale(1, 1, 1.05).translate(0, hy + 0.03, -0.01), 'head', L.hatColor);
  } else if (L.hat === 'hood') {
    shell(0.13, hy + 0.01, -0.012, PI * 0.38, PI * 0.78, L.hatColor, 1, 1.1, 1.08);
    add(new THREE.CylinderGeometry(0.13, 0.27, 0.2, 14).scale(1, 1, 0.8).translate(0, 1.47, 0), 'chest', L.hatColor);
  } else if (L.hat === 'coif' || L.hat === 'kerchief') {
    if (L.hat === 'kerchief') { hairCap(); add(cap(0.12, 0, hy + 0.014, -0.02, PI * 0.42, 1, 1.12, 1.06), 'head', L.hatColor); }
    else shell(0.121, hy + 0.012, -0.012, PI * 0.36, PI * 0.66, L.hatColor);
  }
  // what they hold: the smith's hammer and tongs, the innkeeper's mug
  if (L.work === 'hammer') {
    add(new THREE.CylinderGeometry(0.016, 0.018, 0.36, 6).rotateX(PI / 2).translate(-0.2, 0.86, 0.16), 'hdR', 0x6a4a30);
    add(new THREE.BoxGeometry(0.06, 0.06, 0.13).rotateY(PI / 2).translate(-0.2, 0.86, 0.33), 'hdR', 0x3a3a3e);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4).rotateX(PI / 2).translate(0.2, 0.86, 0.2), 'hdL', 0x2a2a2c);
  } else if (L.work === 'wipe') {
    add(new THREE.CylinderGeometry(0.045, 0.04, 0.11, 10).translate(0.2, 0.86, 0.06), 'hdL', 0x8a5a3a);
    add(new THREE.BoxGeometry(0.1, 0.02, 0.14).translate(-0.2, 0.86, 0.05), 'hdR', 0xe8e0d0);
  }
  const geo = mergeGeometries(parts, false);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  const bones = BONES.map((name) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONES.forEach((name, i) => {
    const p = PARENT[name], j = JOINT[name], q = p ? JOINT[p] : [0, 0, 0];
    bones[i].position.set(j[0] - q[0], j[1] - q[1], j[2] - q[2]);
    if (p) bones[B[p]].add(bones[i]);
  });
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
  if (L.kid) bones[B.head].scale.setScalar(1.22);
  return { mesh, bones };
}

// someone's colours and clothes, from the dice (and what is asked of them)
function lookFor(rnd, o = {}) {
  const man = o.man ?? rnd() < 0.5, skin = pick(rnd, SKIN);
  const L = {
    man, kid: !!o.kid, skin, skinDark: new THREE.Color(skin).multiplyScalar(0.82).getHex(), hair: o.grey ? 0x9a9a96 : pick(rnd, HAIR),
    top: o.top ?? pick(rnd, TUNIC), hose: pick(rnd, HOSE), boot: pick(rnd, BOOT), belt: 0x3a2a1c, bare: !!o.bare,
    dress: o.robe ?? (man ? null : (o.dress ?? pick(rnd, DRESS))), apron: o.apron ?? (rnd() < 0.3 ? 0xe2dccc : null),
    hairStyle: o.hair ?? (man ? (rnd() < 0.2 ? 'bald' : 'short') : pick(rnd, ['long', 'bun', 'long'])),
    hat: o.hat ?? (man ? pick(rnd, ['none', 'cap', 'straw', 'hood', 'none']) : pick(rnd, ['none', 'kerchief', 'coif', 'hood', 'straw'])),
    hatColor: 0, beard: o.beard ?? (man && !o.kid && rnd() < 0.35), work: o.work,
  };
  // (a dress hangs over the knees when she sits: her legs are the dress's colour down to the boots)
  if (L.dress) { L.top = o.robe ? L.dress : new THREE.Color(L.dress).offsetHSL(0, -0.05, 0.08).getHex(); L.hose = L.dress; }
  L.sleeve = L.top; L.cuff = new THREE.Color(L.top).multiplyScalar(0.75).getHex();
  L.hatColor = L.hat === 'straw' ? 0xc8a868 : L.hat === 'coif' ? 0xf0ece2 : L.hat === 'kerchief' ? pick(rnd, [0xa83a2a, 0x3a5a8a, 0xd8c890, 0x6a8a4a]) : pick(rnd, [0x5a3a2a, 0x3a4a3a, 0x4a3a5a, 0x6a2a24, 0x2e3440]);
  return L;
}

// ------------------------------------------------------------------------------ the village's people
export class Villagers {
  constructor(game) {
    this.game = game;
    const V = this.V = game.village, rnd = this.rnd = mulberry32(1212);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
    this.list = [];
    this.bubbles = document.getElementById('floats');
    // the keepers at their stalls, the smith at his anvil, and those who keep their places indoors
    for (const st of V.stalls) this.spawn(KEEPERS[st.kind], { x: st.keeper.x, z: st.keeper.z, heading: st.keeper.heading });
    const [sx, sz] = SMITHY.spot, [ax, az] = SMITHY.anvil;
    this.spawn(KEEPERS.smith, { x: sx, z: sz, heading: Math.atan2(ax - sx, az - sz) });
    for (const h of V.houses) for (const sp of h.spots) if (sp.kind === 'keeper' && POSTS[sp.post]) { sp.by = 'keeper'; this.spawn(KEEPERS[POSTS[sp.post]], { x: sp.x, z: sp.z, heading: sp.heading }); }
    // and the people who wander, two of them children: every one with a home, two to a house where there are beds
    // enough, the children with the last of them
    const homes = V.houses.filter((h) => h.kind === 'home');
    this.homes = homes;
    for (let i = 0; i < 18; i++) {
      const kid = i >= 16;
      const look = lookFor(rnd, { kid, grey: !kid && rnd() < 0.15, hat: kid ? 'none' : undefined });
      const v = this.make(look, kid ? 0.62 : 0.9 + rnd() * 0.14);
      v.role = kid ? 'kid' : 'wander';
      v.home = kid ? homes[(i * 5) % homes.length] : homes[i % homes.length];
      const s = V.spots.filter((p) => p.kind === 'stand' || p.kind === 'well')[(i * 7) % 20];
      v.pos.set(s.x + (rnd() - 0.5), 0, s.z + (rnd() - 0.5)); v.heading = rnd() * TAU;
      v.state = 'stop'; v.timer = 1 + rnd() * 6;
      this.list.push(v);
    }
    for (const v of this.list) { v.collider = { x: v.pos.x, z: v.pos.z, r: 0.28 * Math.max(0.8, v.scale), h: 1.8 * v.scale, soft: true }; game.player.colliders.push(v.collider); }
    this.cat = new Cat(game, V);
    this.greetT = 0; this.talkCool = 0;
  }

  make(look, scale) {
    const f = figure(look, this.mat);
    f.mesh.scale.setScalar(scale);
    this.game.scene.add(f.mesh);
    return {
      mesh: f.mesh, bones: f.bones, look, scale, pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, speed: 0,
      state: 'stop', timer: 0, path: null, pi: 0, goal: null, phase: Math.random() * TAU, R: new Float32Array(HY + 1), T: new Float32Array(HY + 1),
      lookYaw: 0, lookPitch: 0, greeted: -99, bubble: null, bubbleT: 0, stuck: 0, last: new THREE.Vector3(), anim: 'idle', seed: Math.random() * 100,
      walk: (1.05 + Math.random() * 0.3) * (look.kid ? 1.5 : 1),
    };
  }
  // someone who keeps a place
  spawn(K, at) {
    const look = lookFor(this.rnd, { man: K.man, hat: K.hat, hair: K.hair, apron: K.apron, beard: K.beard, work: K.work, bare: K.bare, dress: K.dress, robe: K.robe, top: K.top, grey: K.grey });
    const v = this.make(look, K.man ? 1.02 : 0.95);
    v.role = 'keeper'; v.K = K; v.post = at; v.pos.set(at.x, 0, at.z); v.heading = at.heading; v.state = 'work'; v.talked = -99;
    this.list.push(v);
  }

  // ---------------------------------------------------------------- choosing where to go
  choose(v, G) {
    const V = this.V, r = Math.random(), night = G.sky.night, R = Math.random;
    this.release(v);
    const free = (list) => list.filter((s) => !s.by);
    const at = (house, kinds) => free(house.spots.filter((s) => kinds.includes(s.kind)));
    const inn = V.houses.find((h) => h.kind === 'inn'), chapel = V.chapel;
    const shops = V.houses.filter((h) => h.kind === 'goods' || h.kind === 'bakery' || h.kind === 'smithy');
    let goal = null;
    if (v.role === 'kid') {
      // the children run from place to place, and now and then after the cat; at night, to bed
      if (night) goal = pick(R, at(v.home, ['bed'])) || pick(R, at(v.home, ['stand', 'seat']));
      else goal = R() < 0.3 ? { x: this.cat.pos.x, z: this.cat.pos.z, kind: 'cat' } : R() < 0.15 ? pick(R, at(v.home, ['stand', 'seat'])) : this.near(v, V.spots.filter((s) => s.kind === 'stand' || s.kind === 'well'), 20);
    } else if (night) {
      if (r < 0.62) goal = pick(R, at(v.home, ['bed'])) || pick(R, at(v.home, ['seat', 'stand']));
      else if (r < 0.85) goal = pick(R, at(inn, ['seat', 'browse', 'stand']));
      else goal = this.near(v, free(V.spots.filter((s) => s.kind === 'stand' || s.kind === 'well')));
    } else if (r < 0.18) goal = pick(R, at(v.home, ['seat', 'stand']));
    else if (r < 0.28) goal = this.near(v, shops.flatMap((h) => at(h, ['browse'])));
    else if (r < 0.34) goal = pick(R, at(inn, ['seat', 'browse']));
    else if (r < 0.38) goal = pick(R, at(chapel, ['seat']));
    else if (r < 0.54) goal = this.near(v, free(V.spots.filter((s) => s.kind === 'stall' || s.kind === 'browse')));
    else if (r < 0.62) goal = this.near(v, free(V.spots.filter((s) => s.kind === 'well')));
    else if (r < 0.75) goal = this.near(v, free(V.seats));
    if (!goal) goal = this.near(v, V.spots.filter((s) => s.kind === 'stand'));
    this.go(v, goal);
  }
  // one of `list`, the nearer the likelier
  near(v, list, scale = 26) {
    if (!list.length) return null;
    let sum = 0;
    const w = list.map((s) => { const k = Math.exp(-Math.hypot(s.x - v.pos.x, s.z - v.pos.z) / scale); sum += k; return k; });
    let r = Math.random() * sum;
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }
  // off to `goal`: a spot (outdoors or in), a seat or a bed, or just somewhere ({ x, z, kind })
  go(v, goal) {
    const V = this.V;
    // a seat or a bed is walked to from beside it; the spot itself is kept for whoever has it
    if ((goal.kind === 'seat' || goal.kind === 'bed') && !goal.place) goal = { place: goal, kind: goal.kind, x: goal.node.x, z: goal.node.z, node: goal.node, heading: goal.heading };
    const from = V.nearest(v.pos.x, v.pos.z), to = goal.node || V.nearest(goal.x, goal.z);
    const route = from && to ? V.route(from, to) : null;
    v.goal = goal; v.path = (route || []).map((n) => ({ x: n.x, z: n.z }));
    if (route && v.path.length > 1 && Math.hypot(route[0].x - v.pos.x, route[0].z - v.pos.z) < 1.2) v.path.shift();
    v.path.push({ x: goal.x, z: goal.z });
    v.pi = 0; v.state = 'walk'; v.stuck = 0;
    (goal.place || goal).by = v;
  }
  release(v) {
    const g = v.goal; if (!g) return;
    if (g.by === v) g.by = null;
    if (g.place?.by === v) g.place.by = null;
    if (v.mesh.rotation.x) { v.mesh.rotation.x = 0; }
  }

  arrive(v, G) {
    const g = v.goal, p = g.place;
    v.vel.set(0, 0, 0);
    if (g.kind === 'seat') { v.state = 'sit'; v.timer = 20 + Math.random() * 30; v.face = p.heading; return; }
    if (g.kind === 'bed') { v.state = 'sleep'; v.timer = G.sky.night ? 80 + Math.random() * 120 : 20 + Math.random() * 20; v.face = p.heading; return; }
    if (g.kind === 'stall' || g.kind === 'browse') { v.state = 'browse'; v.timer = 8 + Math.random() * 12; v.face = g.heading; return; }
    v.state = 'stop'; v.timer = (v.role === 'kid' ? 1.5 : 6) + Math.random() * 9; v.face = g.kind === 'well' || g.kind === 'stand' && (g.inside || g.pond) ? g.heading : null;
  }

  // ---------------------------------------------------------------- what the player does to them
  frighten(v, G, from) {
    if (v.state === 'flee' || v.role === 'keeper' || v.state === 'sleep') return;
    this.release(v);
    // into a house away from the trouble, and not too far to run: home if it is near, else any
    const score = (h) => Math.hypot(h.door.x - from.x, h.door.z - from.z) - 0.8 * Math.hypot(h.door.x - v.pos.x, h.door.z - v.pos.z) + (h === v.home ? 6 : 0);
    let best = v.home;
    for (const h of this.V.houses) if (score(h) > score(best)) best = h;
    const spots = best.spots.filter((s) => !s.by && (s.kind === 'stand' || s.kind === 'seat' || s.kind === 'browse'));
    this.go(v, spots.length ? pick(Math.random, spots) : { x: best.inNode.x, z: best.inNode.z, node: best.inNode, kind: 'in' });
    v.state = 'flee';
    if (Math.random() < 0.7) this.say(v, pick(Math.random, SCARED), 2);
  }

  say(v, text, secs = 3) {
    if (!text) { if (v.bubble) { v.bubble.remove(); v.bubble = null; } return; }
    if (!v.bubble) { v.bubble = document.createElement('div'); v.bubble.className = 'bubble'; this.bubbles.appendChild(v.bubble); }
    v.bubble.textContent = text; v.bubbleT = secs;
  }

  // ---------------------------------------------------------------- every frame
  update(dt, G) {
    const P = G.player, cam = G.camera, night = !!G.sky.night, t = G.time;
    if (this.bubbles.hidden !== (G.state !== 'play')) this.bubbles.hidden = G.state !== 'play';
    const far = Math.hypot(P.pos.x - this.V.houses[0].spec.x, P.pos.z - this.V.houses[0].spec.z) > 140;
    this.cat.update(dt, G, far);
    if (far) return;
    if (!this.welcomed && G.state === 'play' && Math.hypot(P.pos.x - 48, P.pos.z - 21) < 14) {
      this.welcomed = true; G.hud?.hint('Doors open as you walk up to them. Stop by a stall or a counter and its keeper will talk to you', 6);
    }
    const sword = P.weapon && SCARY.has(P.weapon.kind) && G.state === 'play';
    this.greetT = Math.max(0, this.greetT - dt); this.talkCool = Math.max(0, this.talkCool - dt);
    const pspeed = Math.hypot(P.vel.x, P.vel.z);
    for (const v of this.list) {
      if (v.role === 'keeper') { this.keeper(v, dt, G, P, pspeed, night); continue; }
      const dxp = P.pos.x - v.pos.x, dzp = P.pos.z - v.pos.z, dp = Math.hypot(dxp, dzp);
      // a sword swung close by, or barged into
      if (sword && dp < 6.5) this.frighten(v, G, P.pos);
      if (P.state === 'tackle' && dp < 1.0 && v.state !== 'flee') { this.frighten(v, G, P.pos); this.say(v, pick(Math.random, BUMPED), 1.6); }
      this.think(v, dt, G);
      this.move(v, dt, G, P, dp);
      // look at him when he is near (and greet him, now and then)
      const watch = dp < 7 && v.state !== 'flee';
      if (watch) {
        const want = wrapAngle(Math.atan2(dxp, dzp) - v.heading);
        v.lookYaw = damp(v.lookYaw, clamp(want, -1.2, 1.2), 5, dt);
        v.lookPitch = damp(v.lookPitch, clamp(-Math.atan2(P.pos.y + 1.3 - (groundY(v.pos.x, v.pos.z) + 1.6 * v.scale), dp) * 0.6, -0.4, 0.4), 5, dt);
        if (dp < 3.2 && t - v.greeted > 40 && this.greetT <= 0 && v.state !== 'chat' && v.state !== 'sleep' && G.state === 'play') {
          const home = this.V.houseAt(v.pos.x, v.pos.z) === v.home && this.V.houseAt(P.pos.x, P.pos.z) === v.home;
          v.greeted = t; this.greetT = 3; this.say(v, pick(Math.random, home ? GREET_IN : night ? GREET_NIGHT : GREET), 2.6);
          if (v.state === 'stop' && Math.abs(want) > 1) v.face = Math.atan2(dxp, dzp);
        }
      } else { v.lookYaw = damp(v.lookYaw, v.state === 'stop' ? 0.5 * Math.sin(t * 0.3 + v.seed) : 0, 2, dt); v.lookPitch = damp(v.lookPitch, 0, 2, dt); }
      if (v.state === 'sleep') { v.lookYaw = 0; v.lookPitch = 0; if (dp < 6 && Math.random() < dt * 0.15 && !v.bubble) this.say(v, 'Zzz…', 2.5); }
      this.animate(v, dt, t);
      this.place(v, cam, dt);
    }
  }

  think(v, dt, G) {
    if (v.state === 'walk' || v.state === 'flee') return;
    v.timer -= dt;
    if (v.state === 'chat') {
      // they take turns
      v.chatT -= dt;
      if (v.chatT <= 0 && v.lines && v.lines.length) { this.say(v, v.lines.shift(), 2.6); v.chatT = 5.2; }
    }
    if (v.timer > 0) return;
    if (v.state === 'sit' || v.state === 'browse' || v.state === 'stop' || v.state === 'chat' || v.state === 'sleep') {
      // two standing close may stop for a word before going on
      if (v.state === 'stop' && v.role !== 'kid' && Math.random() < 0.55) {
        const u = this.list.find((o) => o !== v && o.role === 'wander' && o.state === 'stop' && o.pos.distanceTo(v.pos) < 3.5);
        if (u) {
          const lines = pick(Math.random, CHAT);
          v.state = u.state = 'chat'; v.timer = u.timer = 6 + lines.length * 5;
          v.face = Math.atan2(u.pos.x - v.pos.x, u.pos.z - v.pos.z); u.face = Math.atan2(v.pos.x - u.pos.x, v.pos.z - u.pos.z);
          v.lines = lines.filter((_, i) => i % 2 === 0); u.lines = lines.filter((_, i) => i % 2 === 1);
          v.chatT = 0.3; u.chatT = 2.9;
          return;
        }
      }
      this.choose(v, G);
    }
  }

  move(v, dt, G, P, dp) {
    const going = v.state === 'walk' || v.state === 'flee';
    let vx = 0, vz = 0;
    if (going) {
      if (v.goal?.kind === 'cat') { v.path[v.path.length - 1].x = this.cat.pos.x; v.path[v.path.length - 1].z = this.cat.pos.z; }
      const w = v.path[v.pi], dx = w.x - v.pos.x, dz = w.z - v.pos.z, d = Math.hypot(dx, dz);
      const last = v.pi === v.path.length - 1;
      if (d < (last ? 0.25 : 0.6)) {
        v.pi++;
        if (v.pi >= v.path.length) { this.arrive(v, G); return this.settle(v, dt); }
      } else {
        const sp = v.state === 'flee' ? 3.6 * (v.look.kid ? 0.85 : 1) : v.walk * (last ? clamp(d / 0.8, 0.35, 1) : 1);
        vx = dx / d * sp; vz = dz / d * sp;
      }
    }
    // step round each other, and round him
    for (const u of this.list) {
      if (u === v || !u.mesh.visible || u.state === 'sleep') continue;
      const ex = v.pos.x - u.pos.x, ez = v.pos.z - u.pos.z, e = Math.hypot(ex, ez), R = 0.75;
      if (e < R && e > 1e-4) { const k = (R - e) / R * (going ? 1.6 : 0.8); vx += ex / e * k; vz += ez / e * k; }
    }
    if (dp < 1.3 && dp > 1e-4) {
      const ex = v.pos.x - P.pos.x, ez = v.pos.z - P.pos.z, k = (1.3 - dp) / 1.3;
      vx += ex / dp * k * 2.2; vz += ez / dp * k * 2.2;
      if (going && v.state !== 'flee') { vx *= 0.85; vz *= 0.85; }
    }
    v.vel.x = damp(v.vel.x, vx, 8, dt); v.vel.z = damp(v.vel.z, vz, 8, dt);
    v.pos.x += v.vel.x * dt; v.pos.z += v.vel.z * dt;
    // never through a wall, a stall or the well (but they sit down on the benches and lie down on the beds)
    if (v.state !== 'sit' && v.state !== 'sleep') for (const c of this.V.colliders) {
      const mx = v.pos.x - c.x, mz = v.pos.z - c.z, rr = c.r + 0.5;
      if (mx * mx + mz * mz > rr * rr) continue;
      const o = pushOut(c, v.pos.x, v.pos.z, 0.26);
      if (o) { v.pos.x += o.x; v.pos.z += o.z; }
    }
    v.speed = v.state === 'sleep' ? 0 : Math.hypot(v.vel.x, v.vel.z);
    // turn to where they are going, or to what they face
    if (v.speed > 0.25) v.heading = dampAngle(v.heading, Math.atan2(v.vel.x, v.vel.z), 7, dt);
    else if (v.face != null) v.heading = dampAngle(v.heading, v.face, 4, dt);
    // stuck behind something: find the way again
    if (going) {
      v.stuck += dt;
      if (v.stuck > 2) { if (v.pos.distanceTo(v.last) < 0.6) this.go(v, v.goal); v.stuck = 0; v.last.copy(v.pos); }
    }
    this.settle(v, dt);
  }
  settle(v, dt) {
    const s = v.goal?.place;
    if ((v.state === 'sit' || v.state === 'sleep') && s) { v.pos.x = damp(v.pos.x, s.x, 6, dt); v.pos.z = damp(v.pos.z, s.z, 6, dt); v.vel.set(0, 0, 0); }
    v.collider.x = v.pos.x; v.collider.z = v.pos.z;
  }

  // the keepers: at their places, working, turning to talk when he stops in front of them
  keeper(v, dt, G, P, pspeed, night) {
    const K = v.K, closed = night && !K.night;
    if (closed !== !v.mesh.visible) v.mesh.visible = !closed;
    if (closed) { v.collider.x = 1e5; return; }
    const dx = P.pos.x - v.pos.x, dz = P.pos.z - v.pos.z, d = Math.hypot(dx, dz), t = G.time, Q = G.quests;
    const near = d < 6 && G.state === 'play';
    v.face = near && d < 4 ? Math.atan2(dx, dz) : v.post.heading;
    v.heading = dampAngle(v.heading, v.face, 3, dt);
    v.lookYaw = damp(v.lookYaw, near ? clamp(wrapAngle(Math.atan2(dx, dz) - v.heading), -1.1, 1.1) : 0, 4, dt);
    v.lookPitch = damp(v.lookPitch, 0, 4, dt);
    v.talking = Q?.talk?.who === v.K;
    if (near && d < TALK && pspeed < 2.6 && !Q.talk && t - v.talked > 40 && this.talkCool <= 0) {
      v.talked = t; this.talkCool = 2;
      let lines = K.lines;
      if (K.oni) lines = [...K.lines.slice(0, 1), ...(G.skills.got('quest:oni') ? K.oniDone : K.oni)];
      Q.say(lines, null, 0, Object.assign(K, { x: v.pos.x, z: v.pos.z }));
      v.waveT = 1.6;
    }
    v.waveT = Math.max(0, (v.waveT || 0) - dt);
    v.speed = 0; v.state = 'work';
    v.collider.x = v.pos.x; v.collider.z = v.pos.z;
    // the smith's hammer on the anvil: a ring and a spray of sparks on each blow
    if (K.work === 'hammer') {
      const u = ((t + v.seed) % 1.25) / 1.25, prev = v.hu ?? u; v.hu = u;
      if (prev < 0.62 && u >= 0.62 && !v.talking) {
        const a = this.V.anvil;
        for (let i = 0; i < 9; i++) G.particles.emit('spark', a.x, a.y + 0.02, a.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.1, 1);
        const cd = G.camera.position.distanceTo(a);
        if (cd < 30) G.audio?.anvil?.(clamp(1.2 - cd / 25, 0.1, 1));
      }
    }
    this.animate(v, dt, t);
    this.place(v, G.camera, dt);
  }

  // ---------------------------------------------------------------- the pose
  animate(v, dt, t) {
    const T = v.T; T.fill(0);
    const set = (b, x, y, z) => { const i = B[b] * 3; T[i] += x; T[i + 1] += y; T[i + 2] += z; };
    const sp = v.speed / v.scale, k = clamp(sp / 1.25, 0, 1), run = clamp((sp - 1.9) / 1.4, 0, 1);
    // the gait: a step every ~0.7 m (a little longer running), so the phase goes round once in two steps
    v.phase += dt * sp / (0.68 + 0.25 * run) * PI;
    const ph = v.phase;
    // arms at rest
    set('uaL', 0, 0, 0.07); set('uaR', 0, 0, -0.07); set('faL', -0.12, 0, 0); set('faR', -0.12, 0, 0);
    if (k > 0.01) {
      const A = 0.4 * k + 0.32 * run;
      for (const s of [1, -1]) {
        const S = s > 0 ? 'L' : 'R', lp = ph + (s > 0 ? 0 : PI), sw = Math.sin(lp), cs = Math.cos(lp);
        set('th' + S, -A * sw - 0.08 * run, 0, 0);
        set('sh' + S, k * (0.12 + 0.75 * Math.max(0, cs)) + run * 0.9 * Math.max(0, cs), 0, 0);
        set('ft' + S, -0.25 * k * Math.max(0, -cs) * sw, 0, 0);
        set('ua' + S, A * 0.85 * sw, 0, s * 0.03 * k);
        set('fa' + S, -(0.15 + 0.3 * k * Math.max(0, -sw)) - run * 1.1, 0, 0);
      }
      T[HY] = -0.02 * k + 0.024 * k * Math.cos(2 * ph) - 0.04 * run;
      set('hips', 0, 0.1 * k * Math.sin(ph), 0.03 * k * Math.sin(ph));
      set('chest', 0, -0.16 * k * Math.sin(ph), 0);
      set('spine', 0.05 * k + 0.16 * run, 0, 0);
      set('head', -0.04 * k - 0.1 * run, 0, 0);
    }
    const idle = 1 - k;
    set('chest', 0.02 * Math.sin(t * 1.7 + v.seed) * idle, 0, 0);
    set('hips', 0, 0, 0.025 * Math.sin(t * 0.37 + v.seed) * idle);
    set('spine', 0, 0, -0.02 * Math.sin(t * 0.37 + v.seed) * idle);
    const st = v.state, work = v.K?.work;
    if (st === 'flee') {
      // hands up, running
      for (const s of [1, -1]) { const S = s > 0 ? 'L' : 'R'; set('ua' + S, -2.3 - 0.85 * Math.sin(v.phase + (s > 0 ? 0 : PI)) * 0.4, 0, s * 0.25); set('fa' + S, -0.4 + 0.3 * Math.sin(t * 13 + s), 0, 0); }
    } else if (st === 'chat' || (v.talking && work !== 'hammer')) {
      const g = Math.sin(t * 2.3 + v.seed), side = Math.sin(t * 0.4 + v.seed) > 0 ? 'R' : 'L', sg = side === 'R' ? -1 : 1;
      set('ua' + side, -0.5 - 0.22 * g, 0, sg * 0.18);
      set('fa' + side, -1.0 + 0.3 * Math.sin(t * 2.3 + v.seed + 1), 0, 0);
      set('head', 0.06 * Math.sin(t * 3.4 + v.seed), 0, 0.04 * Math.sin(t * 1.1));
    } else if (st === 'browse') {
      set('spine', 0.16, 0, 0); set('head', 0.32, 0, 0);
      const reach = Math.max(0, Math.sin(t * 0.8 + v.seed));
      set('uaR', -0.35 - 0.5 * reach, 0, -0.1); set('faR', -0.4 - 0.3 * reach, 0, 0);
    } else if (st === 'sit') {
      for (const s of ['L', 'R']) { set('th' + s, -1.5, 0, s === 'L' ? 0.06 : -0.06); set('sh' + s, 1.45, 0, 0); set('ua' + s, -0.5, 0, 0); set('fa' + s, -0.75, 0, 0); }
      set('spine', -0.08, 0, 0);
      T[HY] = (v.goal?.place ? v.goal.place.y - groundY(v.pos.x, v.pos.z) + 0.04 : 0.48) / v.scale - JOINT.hips[1];
    } else if (st === 'sleep') {
      // flat on the back, arms by the sides, breathing slow
      set('chest', 0.03 * Math.sin(t * 1.1 + v.seed), 0, 0); set('uaL', 0, 0, 0.12); set('uaR', 0, 0, -0.12); set('faL', -0.2, 0, 0); set('faR', -0.2, 0, 0);
      set('head', -0.15, 0.25 * Math.sin(v.seed), 0);
    } else if (st === 'work') {
      if (work === 'hammer') {
        const u = ((t + v.seed) % 1.25) / 1.25;
        let a, f;
        if (u < 0.55) { const e = u / 0.55; a = -0.7 - 1.9 * e * e * (3 - 2 * e); f = -0.5 - 0.9 * e; }
        else if (u < 0.64) { const e = (u - 0.55) / 0.09; a = -2.6 + 2.0 * e; f = -1.4 + 1.1 * e; }
        else { const e = (u - 0.64) / 0.36; a = -0.6 - 0.1 * Math.sin(e * PI); f = -0.3 - 0.2 * e; }
        if (v.talking) { a = -0.5; f = -0.6; }
        set('uaR', a, 0, -0.05); set('faR', f, 0, 0);
        set('uaL', -0.75, 0, 0.12); set('faL', -0.85, 0, 0);
        set('spine', 0.14 + (u > 0.55 && u < 0.7 ? 0.08 : 0), 0, 0); set('head', v.talking ? 0 : 0.3, 0, 0);
        set('thL', -0.2, 0, 0.05); set('shL', 0.25, 0, 0); set('thR', 0.15, 0, -0.04);
      } else if (work === 'pray') {
        // hands together before him, head bowed, a slow nod now and then
        set('uaL', -0.55, 0, -0.32); set('uaR', -0.55, 0, 0.32); set('faL', -1.35, 0.35, 0); set('faR', -1.35, -0.35, 0);
        set('head', v.talking ? 0.05 : 0.32 + 0.05 * Math.sin(t * 0.4 + v.seed), 0, 0);
      } else if (work === 'wipe') {
        const c = Math.cos(t * 3.2 + v.seed), s = Math.sin(t * 3.2 + v.seed);
        set('uaL', -0.55, 0, 0.18); set('faL', -1.25, 0, 0);
        set('uaR', -0.72 + 0.08 * s, 0, -0.12 + 0.06 * c); set('faR', -1.15 + 0.1 * c, 0, 0);
        set('head', 0.22, 0, 0);
      } else {
        // a stallholder at the wares: reaching, setting things straight, now and then looking up
        const g = Math.sin(t * 0.9 + v.seed), h = Math.sin(t * 1.7 + v.seed * 2);
        set('spine', 0.12 + 0.05 * g, 0, 0); set('head', 0.2 + 0.12 * Math.max(0, g), 0, 0);
        set('uaR', -0.6 - 0.25 * Math.max(0, h), 0, -0.05); set('faR', -0.55 - 0.3 * Math.max(0, -h), 0, 0);
        set('uaL', -0.45 - 0.2 * Math.max(0, -h), 0, 0.06); set('faL', -0.6, 0, 0);
      }
      if ((v.waveT || 0) > 0 && work !== 'hammer') { set('uaR', 0, 0, -2.5); T[B.uaR * 3] = -0.3; T[B.faR * 3] = -0.3; set('faR', 0, 0, 0.4 * Math.sin(t * 9)); }
    }
    set('neck', v.lookPitch * 0.3, v.lookYaw * 0.35, 0);
    set('head', v.lookPitch * 0.7, v.lookYaw * 0.65, 0);
    // ease into it
    const R = v.R, e = 1 - Math.exp(-(st === 'sit' || v.wasSit ? 7 : 12) * dt);
    v.wasSit = st === 'sit';
    for (let i = 0; i <= HY; i++) R[i] += (T[i] - R[i]) * e;
    const bs = v.bones;
    for (let i = 0; i < NB; i++) bs[i].rotation.set(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]);
    bs[0].position.y = JOINT.hips[1] + R[HY];
  }

  place(v, cam, dt) {
    const y = groundY(v.pos.x, v.pos.z);
    v.mesh.position.set(v.pos.x, y, v.pos.z);
    v.mesh.rotation.y = v.heading;
    // asleep: laid along the bed, the head to its head (the bed's heading points to its foot), the feet at its foot
    const lie = v.state === 'sleep' && v.goal?.place;
    if (lie) {
      const b = v.goal.place, h = b.heading, L = 0.86 * v.scale * 1.78;
      v.mesh.rotation.order = 'YXZ'; v.mesh.rotation.set(-PI / 2, h, 0);
      v.lieK = Math.min(1, (v.lieK || 0) + dt * 2);
      v.mesh.position.set(b.x + Math.sin(h) * L / 2, b.y + 0.13 * v.scale, b.z + Math.cos(h) * L / 2);
      v.heading = h;
    } else if (v.mesh.rotation.x) { v.mesh.rotation.x = 0; v.lieK = 0; }
    // the speech bubble over the head
    if (v.bubble) {
      v.bubbleT -= dt;
      if (v.bubbleT <= 0) { v.bubble.remove(); v.bubble = null; return; }
      const p = _p.set(v.pos.x, y + 2.05 * v.scale + (v.state === 'sit' ? -0.4 : 0), v.pos.z), d = p.distanceTo(cam.position);
      p.project(cam);
      const on = p.z < 1 && d < 28 && v.mesh.visible;
      v.bubble.style.display = on ? '' : 'none';
      if (on) {
        v.bubble.style.transform = `translate(${((p.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%, -100%) scale(${clamp(9 / d, 0.6, 1.1).toFixed(3)})`;
        v.bubble.style.opacity = Math.min(1, v.bubbleT * 2).toFixed(2);
      }
    }
  }
}
const _p = new THREE.Vector3();

// ------------------------------------------------------------------------------ the cat
// a ginger tabby that naps on the cart and the benches, strolls between them, and runs off if he comes too close
class Cat {
  constructor(game, V) {
    this.game = game; this.V = V;
    const M = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
    const fur = M(0xc8782e), pale = M(0xf0dcc0), dark = M(0x1a1410);
    const g = this.g = new THREE.Group(), mesh = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    this.body = mesh(new THREE.SphereGeometry(0.1, 10, 8).scale(0.9, 0.85, 2.0), fur, 0, 0.2, 0);
    mesh(new THREE.SphereGeometry(0.07, 8, 6).scale(1, 0.8, 1.6), pale, 0, 0.17, 0.04);
    this.head = new THREE.Group(); this.head.position.set(0, 0.3, 0.2); g.add(this.head);
    mesh(new THREE.SphereGeometry(0.075, 10, 8).scale(1.05, 0.95, 1), fur, 0, 0, 0, this.head);
    mesh(new THREE.SphereGeometry(0.04, 8, 6).scale(1, 0.7, 0.8), pale, 0, -0.025, 0.055, this.head);
    for (const s of [-1, 1]) {
      mesh(new THREE.ConeGeometry(0.03, 0.06, 4), fur, s * 0.042, 0.07, -0.005, this.head).rotation.z = -s * 0.25;
      mesh(new THREE.SphereGeometry(0.011, 6, 4), dark, s * 0.03, 0.012, 0.066, this.head);
    }
    this.legs = [];
    for (const [x, z] of [[0.05, 0.13], [-0.05, 0.13], [0.05, -0.13], [-0.05, -0.13]]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.17, z); g.add(pivot);
      mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.17, 6).translate(0, -0.085, 0), fur, 0, 0, 0, pivot);
      this.legs.push(pivot);
    }
    this.tail = new THREE.Group(); this.tail.position.set(0, 0.24, -0.19); g.add(this.tail);
    mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.3, 6).translate(0, 0.15, 0), fur, 0, 0, 0, this.tail);
    game.scene.add(g);
    // where it likes to be: on the cart's hay, the benches, by the well, on the inn's barrels
    this.perches = [{ x: 59.2, z: 27.4, y: 1.35 }, ...V.seats.map((s) => ({ x: s.x, z: s.z, y: s.y - groundY(s.x, s.z) })), { x: WELL.x + 2.1, z: WELL.z, y: 0 }, { x: 45.4, z: 12.4, y: 0.9 }];
    this.pos = new THREE.Vector3(this.perches[0].x, 0, this.perches[0].z); this.y = this.perches[0].y; this.heading = 1;
    this.state = 'nap'; this.timer = 8; this.target = null; this.phase = 0; this.speed = 0;
  }
  update(dt, G, far) {
    if (far) return;
    const P = G.player, dp = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z), t = G.time;
    this.timer -= dt;
    if (dp < 2.2 && this.state !== 'run') { this.state = 'run'; this.target = this.away(P); G.audio?.meow?.(); }
    if (this.state === 'nap' || this.state === 'sit') {
      if (this.timer <= 0) { this.state = 'walk'; this.target = this.perches[(Math.random() * this.perches.length) | 0]; }
    } else {
      const to = this.target, dx = to.x - this.pos.x, dz = to.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.25) { this.state = Math.random() < 0.6 ? 'nap' : 'sit'; this.timer = 10 + Math.random() * 25; this.speed = 0; }
      else {
        const sp = this.state === 'run' ? 4.5 : 0.7;
        this.speed = damp(this.speed, sp, 6, dt);
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 8, dt);
        this.pos.x += Math.sin(this.heading) * this.speed * dt; this.pos.z += Math.cos(this.heading) * this.speed * dt;
        for (const c of this.V.colliders) { const o = pushOut(c, this.pos.x, this.pos.z, 0.15); if (o && !(to.y > 0 && d < 1.2)) { this.pos.x += o.x; this.pos.z += o.z; } }
      }
    }
    // up onto its perch as it gets there, down to the ground away from it
    const to = this.target, onIt = to && Math.hypot(to.x - this.pos.x, to.z - this.pos.z) < 0.9;
    this.y = damp(this.y, onIt || this.state === 'nap' || this.state === 'sit' ? (to?.y ?? this.y) : 0, 8, dt);
    const g = this.g;
    g.position.set(this.pos.x, groundY(this.pos.x, this.pos.z) + this.y, this.pos.z); g.rotation.y = this.heading;
    this.phase += dt * this.speed * 9;
    const nap = this.state === 'nap', sit = this.state === 'sit';
    this.legs.forEach((l, i) => { l.rotation.x = this.speed > 0.1 ? Math.sin(this.phase + (i % 2 ? PI : 0) + (i > 1 ? PI / 2 : 0)) * 0.7 : nap ? -1.4 * (i < 2 ? 1 : -1) : sit && i > 1 ? -1.2 : 0; });
    this.body.position.y = nap ? 0.1 : sit ? 0.16 : 0.2; this.body.rotation.x = sit ? -0.5 : 0;
    this.head.position.y = nap ? 0.15 : sit ? 0.36 : 0.3; this.head.rotation.y = nap ? 0.6 : 0.4 * Math.sin(t * 0.5);
    this.tail.rotation.x = nap ? 1.9 : sit ? 1.6 : -0.6 + 0.2 * Math.sin(t * 2); this.tail.rotation.z = 0.4 * Math.sin(t * (this.speed > 0.1 ? 4 : 1.2));
  }
  away(P) {
    let best = null, bd = -1;
    for (const p of this.perches) { const d = Math.hypot(p.x - P.pos.x, p.z - P.pos.z); if (d > bd && d < 30) { bd = d; best = p; } }
    return best || this.perches[0];
  }
}
