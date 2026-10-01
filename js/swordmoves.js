// Keyframed poses for the sword moves, applied by anim.js as a layer over the walk and run.
// Each key is [seconds, { bone: [x, y, z] }] in the animation skeleton's own angles (see anim.js:
// +x on a hanging arm swings it back, forward is negative; +z raises the left arm sideways, -z the
// right; +y on the hips and spine turns toward his left). Only the bones a move names are touched.
// `stance` is [left foot, right foot, hip drop] in metres, feet measured forward of the hips.
// The sword is drawn from over his LEFT shoulder, with that hand.
//
// While `grip` is 1 he holds the sword in both hands, and the arms are not keyed at all: `sp` and `sa`
// say where the sword is, in the frame of his chest (x left, y up, z forward, metres from the middle of
// his back), and both arms are solved to the hilt (see AtsuModel.gripIK).
//   sp  [x, y, z]            the left fist, the lower hand, at the pommel end of the hilt
//   sa  [yaw, tilt, roll]    yaw turns the blade to his left; tilt 0 is the blade straight up with its edge
//                            forward, and the blade leans forward as tilt grows (about 1.57 is level,
//                            above 2 points down); roll turns the blade about its own length
// His arms are short (the wrists reach about 0.39 m from the shoulders), so the hands stay close to the
// chest and the blade turns about them; the torso and the legs do the swinging.
const R = (x, y = 0, z = 0) => [x, y, z];

// the pose he returns to between swings: blade out, held in front of his belly, tip toward his throat height
const READY = {
  hips: R(0.06), spine: R(0.1), chest: R(0.08), neck: R(-0.1), head: R(-0.05),
  stance: [0.1, -0.14, 0.05], grip: R(1), sp: R(0, -0.1, 0.2), sa: R(0, 1.15, 0),
};

export const POSES = { READY };

export const MOVE_KEYS = {
  // reach over the left shoulder, pull the blade out, bring the right hand to it and sweep it low across
  // the front, left to right, the way a scythe goes through grass
  draw: [
    [0.00, { upperarm_L: R(0.1, 0, 0.12), forearm_L: R(-0.3), hand_L: R(0), spine: R(0), chest: R(0), hips: R(0), stance: [0, 0, 0], grip: R(0) }],
    [0.18, { upperarm_L: R(-3.3, 0, 0.75), forearm_L: R(-0.6), hand_L: R(0), spine: R(-0.1, 0.2), chest: R(-0.1, 0.5), hips: R(0, 0.25), upperarm_R: R(0.1, 0, -0.2), forearm_R: R(-0.5), stance: [0.05, -0.05, 0.03], grip: R(0) }],
    [0.30, { upperarm_L: R(-3.5, 0, 1.0), forearm_L: R(-0.4), hand_L: R(0.2), spine: R(-0.15, 0.3), chest: R(-0.15, 0.6), hips: R(0, 0.4), stance: [0.1, -0.12, 0.06], grip: R(0), sp: R(0.12, 0.1, 0.16), sa: R(0.4, 1.9, 0) }],
    [0.42, { upperarm_L: R(0, 0.9, 1.4), forearm_L: R(-0.2), hand_L: R(0.1), spine: R(0.1, 0.3), chest: R(0.1, 0.5), hips: R(0.04, 0.4), upperarm_R: R(-0.2, 0, -0.5), stance: [0.2, -0.22, 0.1], grip: R(1), sp: R(0.1, -0.02, 0.2), sa: R(0.2, 1.95, 0) }],
    [0.50, { spine: R(0.18, 0.0), chest: R(0.2, 0.0), hips: R(0.08, 0.0), stance: [0.3, -0.28, 0.14], grip: R(1), sp: R(0.0, -0.06, 0.22), sa: R(0.0, 2.0, 0) }],
    [0.58, { spine: R(0.16, -0.3), chest: R(0.16, -0.35), hips: R(0.08, -0.35), stance: [0.32, -0.3, 0.14], grip: R(1), sp: R(-0.1, -0.06, 0.2), sa: R(-0.3, 1.95, 0) }],
    [0.68, { spine: R(0.14, -0.34), chest: R(0.14, -0.4), hips: R(0.06, -0.4), stance: [0.3, -0.3, 0.13], grip: R(1), sp: R(-0.12, -0.04, 0.2), sa: R(-0.45, 1.9, 0) }],
    [0.95, READY],
  ],
  // raise the blade over his head, hold it a breath, then drop everything into the chop: the hips sink,
  // the chest folds over and the blade goes into the ground
  overhead: [
    [0.00, READY],
    [0.12, { spine: R(0.05), chest: R(0.0), hips: R(0.02), stance: [0.1, -0.15, 0.09], grip: R(1), sp: R(0, 0.12, 0.2), sa: R(0, 0.5, 0) }],
    [0.30, { spine: R(-0.2), chest: R(-0.35), hips: R(-0.05), neck: R(0.12), head: R(0.1), stance: [0.1, -0.2, 0.02], grip: R(1), sp: R(0, 0.36, 0.12), sa: R(0, -0.4, 0) }],
    [0.38, { spine: R(-0.24), chest: R(-0.4), hips: R(-0.07), neck: R(0.14), stance: [0.1, -0.22, 0.0], grip: R(1), sp: R(0, 0.38, 0.1), sa: R(0, -0.5, 0) }],
    [0.52, { spine: R(0.26), chest: R(0.36), hips: R(0.1), neck: R(-0.25), head: R(-0.1), stance: [0.38, -0.3, 0.17], grip: R(1), sp: R(0, -0.1, 0.24), sa: R(0, 1.95, 0) }],
    [0.60, { spine: R(0.3), chest: R(0.4), hips: R(0.12), neck: R(-0.28), stance: [0.38, -0.3, 0.19], grip: R(1), sp: R(0, -0.14, 0.22), sa: R(0, 2.02, 0) }],
    [0.84, READY],
  ],
  // draw the blade back to the hip, hold, then drive it straight out
  thrust: [
    [0.00, READY],
    [0.22, { spine: R(0.06, 0.15), chest: R(0.0, 0.25), hips: R(0.02, 0.2), stance: [0.05, -0.2, 0.09], grip: R(1), sp: R(0.05, -0.12, 0.08), sa: R(-0.5, 1.4, 0) }],
    [0.30, { spine: R(0.08, 0.18), chest: R(0.02, 0.3), hips: R(0.02, 0.24), stance: [0.04, -0.21, 0.1], grip: R(1), sp: R(0.06, -0.13, 0.07), sa: R(-0.6, 1.38, 0) }],
    [0.42, { spine: R(0.2, -0.1), chest: R(0.2, -0.15), hips: R(0.1, -0.15), stance: [0.48, -0.3, 0.19], grip: R(1), sp: R(-0.02, 0.0, 0.31), sa: R(0.6, 1.55, 0) }],
    [0.74, READY],
  ],
  // Sky Slam. The blade over his head while he climbs (the same place as the top of the overhead), turned
  // straight down as he plunges, then the crouch of the landing
  rise: [
    [0.00, READY],
    [0.14, { grip: R(1), sp: R(0, 0.36, 0.12), sa: R(0, -0.35, 0), spine: R(-0.15), chest: R(-0.3), hips: R(-0.04), neck: R(0.1) }],
  ],
  plunge: [
    [0.00, { grip: R(1), sp: R(0, 0.36, 0.12), sa: R(0, -0.35, 0), spine: R(-0.15), chest: R(-0.3), hips: R(-0.04), neck: R(0.1) }],
    [0.10, { grip: R(1), sp: R(0, 0.3, 0.16), sa: R(0, 3.05, 0), spine: R(0.2), chest: R(0.3), hips: R(0.1), neck: R(-0.2) }],
  ],
  slamland: [
    [0.00, { grip: R(1), sp: R(0, 0.3, 0.16), sa: R(0, 3.05, 0), spine: R(0.2), chest: R(0.3), hips: R(0.1), neck: R(-0.2) }],
    [0.12, { grip: R(1), sp: R(0, -0.1, 0.24), sa: R(0, 2.5, 0), spine: R(0.36), chest: R(0.5), hips: R(0.16), neck: R(-0.25), stance: [0.36, -0.3, 0.2] }],
    [0.6, READY],
  ],
  // F: bring the blade up flat across his chest, the hilt on his right and the tip out past his left
  // shoulder, and hold it there; it comes back down to the ready pose
  parry: [
    [0.00, READY],
    [0.06, { grip: R(1), sp: R(-0.04, 0.0, 0.19), sa: R(1.5, 1.35, 0), spine: R(0.06), chest: R(0.05), hips: R(0.04), stance: [0.08, -0.12, 0.05] }],
    [0.36, { grip: R(1), sp: R(-0.04, 0.0, 0.19), sa: R(1.5, 1.35, 0), spine: R(0.06), chest: R(0.05), hips: R(0.04), stance: [0.08, -0.12, 0.05] }],
    [0.62, READY],
  ],
  // Storm Call: the blade goes straight up over his head and he leans back under it while the sky gathers,
  // holds it there through the strike (1.25 s) and the crackle, then brings it down to the ready pose
  storm: [
    [0.00, READY],
    [0.30, { grip: R(1), sp: R(0, 0.22, 0.2), sa: R(0, 0.55, 0), spine: R(-0.05), chest: R(-0.12), hips: R(0.0), neck: R(0.1), stance: [0.1, -0.2, 0.04] }],
    [0.60, { grip: R(1), sp: R(0, 0.33, 0.28), sa: R(0, 0.0, 0), spine: R(-0.18), chest: R(-0.3), hips: R(-0.05), neck: R(0.3), head: R(0.2), stance: [0.14, -0.26, 0.0] }],
    [1.25, { grip: R(1), sp: R(0, 0.34, 0.29), sa: R(0, 0.0, 0), spine: R(-0.2), chest: R(-0.34), hips: R(-0.06), neck: R(0.32), head: R(0.22), stance: [0.14, -0.26, 0.0] }],
    [1.34, { grip: R(1), sp: R(0, 0.32, 0.26), sa: R(0, 0.0, 0), spine: R(-0.12), chest: R(-0.22), hips: R(-0.03), neck: R(0.25), head: R(0.15), stance: [0.14, -0.26, 0.0] }],
    [1.7, { grip: R(1), sp: R(0, 0.24, 0.2), sa: R(0, 0.6, 0), spine: R(0.0), chest: R(-0.08), hips: R(0.0), neck: R(0.05), stance: [0.1, -0.2, 0.04] }],
    [2.2, READY],
  ],
  // Earth Power: the blade comes up point down over the ground in front of him, then both hands drive it in;
  // he stays crouched over it while the ground answers, then pulls it out to the ready pose
  quake: [
    [0.00, READY],
    [0.28, { grip: R(1), sp: R(0, 0.3, 0.2), sa: R(0, 2.9, 0), spine: R(-0.1), chest: R(-0.15), hips: R(0.0), neck: R(0.05), stance: [0.15, -0.2, 0.03] }],
    [0.44, { grip: R(1), sp: R(0, -0.02, 0.3), sa: R(0, 2.98, 0), spine: R(0.4), chest: R(0.45), hips: R(0.16), neck: R(-0.35), head: R(-0.1), stance: [0.38, -0.32, 0.24] }],
    [0.95, { grip: R(1), sp: R(0, 0.0, 0.3), sa: R(0, 2.98, 0), spine: R(0.38), chest: R(0.42), hips: R(0.15), neck: R(-0.32), head: R(-0.1), stance: [0.38, -0.32, 0.23] }],
    [1.2, { grip: R(1), sp: R(0, 0.1, 0.24), sa: R(0, 2.2, 0), spine: R(0.15), chest: R(0.15), hips: R(0.06), stance: [0.2, -0.22, 0.1] }],
    [1.55, READY],
  ],
  // Wind Call: the blade comes out level to his right front and he winds up to the right; he turns once on the
  // spot (sword.js turns him) with the blade held out leading, then sweeps it up overhead as the wind settles on
  // him, holds it there a breath and brings it down to the ready pose
  gale: [
    [0.00, READY],
    [0.20, { grip: R(1), sp: R(-0.06, -0.04, 0.24), sa: R(-0.9, 1.55, 0), spine: R(0.08, -0.25), chest: R(0.05, -0.35), hips: R(0.04, -0.2), neck: R(-0.1, 0.2), stance: [0.12, -0.2, 0.1] }],
    [0.55, { grip: R(1), sp: R(-0.08, -0.02, 0.25), sa: R(-1.0, 1.5, 0), spine: R(0.1, -0.1), chest: R(0.06, -0.15), hips: R(0.05, 0), neck: R(-0.1, 0.1), stance: [0.14, -0.22, 0.12] }],
    [0.90, { grip: R(1), sp: R(-0.08, 0.0, 0.25), sa: R(-1.1, 1.45, 0), spine: R(0.08, -0.05), chest: R(0.05, -0.1), hips: R(0.04, 0), neck: R(-0.08), stance: [0.14, -0.22, 0.12] }],
    [1.02, { grip: R(1), sp: R(0, 0.3, 0.26), sa: R(0, 0.15, 0), spine: R(-0.15), chest: R(-0.25), hips: R(-0.03), neck: R(0.25), head: R(0.15), stance: [0.14, -0.26, 0.02] }],
    [1.30, { grip: R(1), sp: R(0, 0.31, 0.26), sa: R(0, 0.12, 0), spine: R(-0.16), chest: R(-0.27), hips: R(-0.03), neck: R(0.26), head: R(0.16), stance: [0.14, -0.26, 0.02] }],
    [1.75, READY],
  ],
  // return the blade to the sheath over the left shoulder: both hands carry it out to his left and round
  // behind the shoulder (the sword's path, in the chest's frame, ends exactly where the arm-keyed pose
  // below begins), then the right hand lets go and the left slides the blade home
  sheathe: [
    [0.00, READY],
    [0.11, { grip: R(1), sp: R(0.35, 0.15, 0.2), sa: R(1.3, 1.4, 1.2), stance: [0.08, -0.1, 0.04] }],
    [0.22, { upperarm_L: R(-3.3, 0, 0.8), forearm_L: R(-0.5), hand_L: R(0.1), spine: R(-0.1, 0.2), chest: R(-0.1, 0.5), hips: R(0, 0.25), stance: [0.05, -0.05, 0.03], grip: R(1), sp: R(0.54, 0.28, -0.14), sa: R(2.76, 1.56, 2.37) }],
    [0.27, { grip: R(0) }],
    [0.38, { upperarm_L: R(-3.4, 0, 0.9), forearm_L: R(-0.4), hand_L: R(0.1), spine: R(-0.1, 0.2), chest: R(-0.1, 0.5), hips: R(0, 0.25), stance: [0.03, -0.03, 0.02] }],
    [0.66, { upperarm_L: R(0.1, 0, 0.12), forearm_L: R(-0.3), hand_L: R(0), spine: R(0), chest: R(0), hips: R(0), stance: [0, 0, 0] }],
  ],
};

// Bones a move doesn't name still need a calm value, or they would pick up the walk's springs.
const BASE = {
  hips: R(0), spine: R(0.05), chest: R(0.03), neck: R(-0.05), head: R(-0.03),
  shoulder_L: R(0, 0, 0.04), shoulder_R: R(0), upperarm_R: R(-0.2, 0, -0.3), forearm_R: R(-0.6), hand_R: R(0), hand_L: R(0),
};

// Cubic Hermite through a bone's keys. Tangents come from the neighbouring keys (Catmull-Rom), so the arm
// keeps moving through a key instead of stopping on it; they are zero at the first and last key and are
// limited so a curve never overshoots the keys it joins.
function channel(keys, name, a, t) {
  const pts = [];
  for (const k of keys) if (name in k[1]) pts.push([k[0], k[1][name][a]]);
  if (pts.length === 1 || t <= pts[0][0]) return pts[0][1];
  const n = pts.length;
  if (t >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0; while (i < n - 2 && t > pts[i + 1][0]) i++;
  const [t0, p0] = pts[i], [t1, p1] = pts[i + 1], h = t1 - t0, d = (p1 - p0) / h;
  const slope = (j) => {
    if (j === 0 || j === n - 1) return 0;
    const m = (pts[j + 1][1] - pts[j - 1][1]) / (pts[j + 1][0] - pts[j - 1][0]);
    const dl = (pts[j][1] - pts[j - 1][1]) / (pts[j][0] - pts[j - 1][0]), dr = (pts[j + 1][1] - pts[j][1]) / (pts[j + 1][0] - pts[j][0]);
    if (dl * dr <= 0) return 0;                                   // a turning point: flat
    return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.abs(dl), 3 * Math.abs(dr));
  };
  const m0 = slope(i) * h, m1 = slope(i + 1) * h, u = (t - t0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

// the pose of one move at time t: { bone: [x, y, z], stance: [..] }
export function evalMove(kind, t, out = {}) {
  const keys = MOVE_KEYS[kind];
  if (!keys) return out;
  const names = new Set(Object.keys(BASE));
  for (const [, p] of keys) for (const k in p) names.add(k);
  for (const name of names) {
    if (!keys.some((k) => name in k[1])) { out[name] = BASE[name].slice(); continue; }
    const v = out[name] || (out[name] = [0, 0, 0]);
    for (let a = 0; a < v.length; a++) v[a] = channel(keys, name, a, t);
  }
  return out;
}
