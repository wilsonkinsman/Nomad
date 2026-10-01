// Keyframed poses for the sword moves, applied by anim.js as a layer over the walk and run.
// Each key is [seconds, { bone: [x, y, z] }] in the animation skeleton's own angles (see anim.js:
// +x on a hanging arm swings it back, forward is negative; +z raises the left arm sideways, -z the
// right; +y on the hips and spine turns toward his left). Only the bones a move names are touched.
// `stance` is [left foot, right foot, hip drop] in metres, feet measured forward of the hips.
// The sword is in his LEFT hand: the hilt rides over his left shoulder.
const R = (x, y = 0, z = 0) => [x, y, z];

// the pose he returns to between swings: blade out, held low in front
const READY = {
  hips: R(0.08, 0.15), spine: R(0.12, 0.1), chest: R(0.1, 0.1), neck: R(-0.1), head: R(-0.05),
  shoulder_L: R(0, 0, 0.05), upperarm_L: R(-1.0, 0, 0.45), forearm_L: R(-1.2), hand_L: R(0.4),
  shoulder_R: R(0, 0, 0), upperarm_R: R(-0.35, 0, -0.45), forearm_R: R(-0.8), hand_R: R(0),
  stance: [0.08, -0.14, 0.04],
};

export const POSES = { READY };

export const MOVE_KEYS = {
  // reach over the left shoulder, pull the blade out and across in one cut, left to right
  draw: [
    [0.00, { upperarm_L: R(0.1, 0, 0.12), forearm_L: R(-0.3), hand_L: R(0), spine: R(0), chest: R(0), hips: R(0), stance: [0, 0, 0] }],
    [0.18, { upperarm_L: R(-3.3, 0, 0.75), forearm_L: R(-0.6), hand_L: R(0), spine: R(-0.1, 0.2), chest: R(-0.1, 0.5), hips: R(0, 0.25), upperarm_R: R(0.1, 0, -0.2), forearm_R: R(-0.5), stance: [0.05, -0.05, 0.03] }],
    [0.30, { upperarm_L: R(-3.5, 0, 1.0), forearm_L: R(-0.4), hand_L: R(0.2), spine: R(-0.15, 0.3), chest: R(-0.15, 0.6), hips: R(0, 0.4), stance: [0.1, -0.12, 0.06] }],
    [0.40, { upperarm_L: R(0, 0.9, 1.4), forearm_L: R(-0.2), hand_L: R(0.1), spine: R(0.05, 0.4), chest: R(0, 0.7), hips: R(0, 0.6), upperarm_R: R(-0.2, 0, -0.5), stance: [0.18, -0.2, 0.1] }],
    [0.60, { upperarm_L: R(0, -2.6, 1.3), forearm_L: R(-0.15), hand_L: R(0.1), spine: R(0.1, -0.4), chest: R(0.05, -0.6), hips: R(0, -0.7), upperarm_R: R(-0.5, 0, -0.4), stance: [0.28, -0.26, 0.1] }],
    [0.84, READY],
  ],
  // raise the blade over his head and chop straight down
  overhead: [
    [0.00, READY],
    [0.18, { upperarm_L: R(-3.0, 0, 0.35), forearm_L: R(-1.5), hand_L: R(0.2), spine: R(-0.1), chest: R(-0.25), hips: R(0, 0.1), neck: R(0.1), upperarm_R: R(-2.6, 0, -0.35), forearm_R: R(-1.3), stance: [0.1, -0.15, 0.03] }],
    [0.32, { upperarm_L: R(-3.3, 0, 0.3), forearm_L: R(-1.8), hand_L: R(0.3), spine: R(-0.15), chest: R(-0.35), stance: [0.14, -0.2, 0.02] }],
    [0.46, { upperarm_L: R(-1.35, 0, 0.12), forearm_L: R(-0.2), hand_L: R(0.5), spine: R(0.3), chest: R(0.4), hips: R(0.1), neck: R(-0.2), upperarm_R: R(-1.3, 0, -0.2), forearm_R: R(-0.3), stance: [0.35, -0.28, 0.14] }],
    [0.70, READY],
  ],
  // draw the blade back to the hip, then drive it straight out
  thrust: [
    [0.00, READY],
    [0.18, { upperarm_L: R(-0.6, 0, 0.5), forearm_L: R(-1.9), hand_L: R(0.2), spine: R(0.05, 0.3), chest: R(0, 0.5), hips: R(0, 0.4), upperarm_R: R(-1.0, 0, -0.5), forearm_R: R(-0.7), stance: [0.05, -0.2, 0.08] }],
    [0.34, { upperarm_L: R(-1.5, 0, 0.12), forearm_L: R(-0.1), hand_L: R(0.8), spine: R(0.25, -0.2), chest: R(0.25, -0.35), hips: R(0.1, -0.35), upperarm_R: R(0.2, 0, -0.5), forearm_R: R(-0.4), stance: [0.45, -0.3, 0.18] }],
    [0.66, READY],
  ],
  // return the blade to the sheath over the left shoulder
  sheathe: [
    [0.00, READY],
    [0.22, { upperarm_L: R(-3.3, 0, 0.8), forearm_L: R(-0.5), hand_L: R(0.1), spine: R(-0.1, 0.2), chest: R(-0.1, 0.5), hips: R(0, 0.25), stance: [0.05, -0.05, 0.03] }],
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
