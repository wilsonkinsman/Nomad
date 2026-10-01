// Procedural animation for the nomad. Rotations are local to each bone, and in bind pose every
// bone has identity rotation, so: +X on a hanging limb swings it BACKWARD, +X on the spine leans
// FORWARD, arms raise sideways with +Z on the left and -Z on the right.
// While moving the hips glide level (no bob) and two-bone leg IK keeps the stance foot on the ground;
// standing, hip height comes from leg forward kinematics.
import { BONES, LEG } from './nomad.js';
import { clamp, lerp, smoothstep, damp } from './util.js';
import { evalMove } from './swordmoves.js';
import { DOWN, RUN, UP, TOTAL } from './tackle.js';
import { KICK_TIME } from './earth.js';

const TAU = Math.PI * 2;

// Rock Kick, keyed: [seconds, { bone: [x, y, z], hipsY }]. The right leg stomps, then kicks.
const RK_STAND = { thigh_R: [0], shin_R: [0.05], foot_R: [0], thigh_L: [0], shin_L: [0.05], foot_L: [0], spine: [0.05], chest: [0.03], neck: [-0.05], head: [0],
  upperarm_L: [-0.1, 0, 0.15], upperarm_R: [-0.1, 0, -0.15], forearm_L: [-0.3], forearm_R: [-0.3], hipsY: 0 };
const ROCKKICK = [
  [0.0, RK_STAND],
  [0.18, { thigh_R: [-1.3], shin_R: [1.55], foot_R: [0.25], thigh_L: [-0.08], shin_L: [0.15], foot_L: [-0.07], spine: [-0.05], chest: [-0.05], neck: [0.05], head: [0],
    upperarm_L: [-0.3, 0, 0.9], upperarm_R: [-0.3, 0, -0.9], forearm_L: [-0.5], forearm_R: [-0.5], hipsY: 0.02 }],
  [0.28, { thigh_R: [-0.4], shin_R: [0.65], foot_R: [-0.2], thigh_L: [-0.38], shin_L: [0.7], foot_L: [-0.3], spine: [0.28], chest: [0.18], neck: [-0.2], head: [-0.1],
    upperarm_L: [0.25, 0, 0.55], upperarm_R: [0.25, 0, -0.55], forearm_L: [-0.6], forearm_R: [-0.6], hipsY: -0.09 }],
  [0.47, { thigh_R: [0.6], shin_R: [1.4], foot_R: [0.35], thigh_L: [-0.22], shin_L: [0.4], foot_L: [-0.18], spine: [-0.1], chest: [-0.06], neck: [0.05], head: [0.05],
    upperarm_L: [-0.9, 0, 0.45], upperarm_R: [0.6, 0, -0.5], forearm_L: [-0.7], forearm_R: [-0.4], hipsY: -0.05 }],
  [0.6, { thigh_R: [-1.55], shin_R: [0.12], foot_R: [0.45], thigh_L: [0.08], shin_L: [0.22], foot_L: [-0.3], spine: [-0.28], chest: [-0.12], neck: [0.2], head: [0.1],
    upperarm_L: [0.55, 0, 0.6], upperarm_R: [-0.7, 0, -0.6], forearm_L: [-0.4], forearm_R: [-0.6], hipsY: 0 }],
  [0.72, { thigh_R: [-1.3], shin_R: [0.3], foot_R: [0.3], thigh_L: [0.05], shin_L: [0.2], foot_L: [-0.25], spine: [-0.2], chest: [-0.08], neck: [0.15], head: [0.05],
    upperarm_L: [0.4, 0, 0.5], upperarm_R: [-0.5, 0, -0.5], forearm_L: [-0.4], forearm_R: [-0.5], hipsY: 0 }],
  [0.98, RK_STAND],
];

export class Animator {
  constructor() {
    this.phase = 0;
    this.t = 0;
    this.pose = { bones: {}, hipsX: 0, hipsY: 0, hipsZ: 0, pitch: 0, roll: 0, pivotY: 0.95 };
    this.L = { bones: {}, hipsX: 0, hipsY: 0, hipsZ: 0, pitch: 0, roll: 0, pivotY: 0.95 };
    this.O = { bones: {}, hipsX: 0, hipsY: 0, hipsZ: 0, pitch: 0, roll: 0, pivotY: 0.95 };
    for (const b of BONES) { this.pose.bones[b] = [0, 0, 0]; this.L.bones[b] = [0, 0, 0]; this.O.bones[b] = [0, 0, 0]; }
    this.air = 0; this.land = 0; this.overW = 0; this.roll = 0; this.lean = 0; this.move = 0;
    this.snow = 0; this.wheat = 0; this.lastPhase = 0;
    this.u = 0; this.flight = 0; this.sp = null;
    this.steps = [];      // footstep events produced this frame: 'L' | 'R'
  }

  update(dt, P) {
    this.t += dt;
    const L = this.L, b = L.bones;
    for (const k of BONES) { const r = b[k]; r[0] = r[1] = r[2] = 0; }
    const s = P.speed;
    this.snow = damp(this.snow, P.snow, 4, dt);
    this.wheat = damp(this.wheat, P.wheat, 3, dt);
    const sn = this.snow, wh = this.wheat;
    const move = this.move = damp(this.move, smoothstep(0.05, 0.7, s), 8, dt);
    const run = smoothstep(2.0, 3.3, s), sprint = smoothstep(4.6, 6.2, s);

    // cadence: cycles per second
    let freq = s < 1.4 ? lerp(0.55, 0.92, s / 1.4) : s < 3.5 ? lerp(0.92, 1.32, (s - 1.4) / 2.1) : lerp(1.32, 1.52, clamp((s - 3.5) / 3, 0, 1));
    freq *= 1 - 0.18 * sn;
    // short legs take quicker steps (roughly Froude scaling), so a squat character doesn't skate
    const Lref = Math.min(0.86, (LEG.L1 + LEG.L2) * 1.17), ls = Lref / 0.86;      // Atsu and the nomad: exactly 0.86
    freq *= Math.pow(1 / ls, 0.8);
    this.ls = ls;
    // gait cycle u in [0, 1): 0 is the left heel striking, 0.5 the right. A foot stays on the ground
    // for 60% of its cycle when walking and barely a third when sprinting, so each half of a leg's
    // swing runs at its own speed instead of one even sine wave.
    const prevU = this.u;
    if (P.grounded && move > 0.02) this.u = (this.u + freq * dt) % 1;
    this.steps.length = 0;
    if (P.grounded && move > 0.25) {
      if (prevU > this.u) this.steps.push('L');
      if (prevU < 0.5 && this.u >= 0.5) this.steps.push('R');
    }
    // a level run has almost no flight phase: the next foot is down as the last one leaves
    const stance = lerp(0.6, 0.48, run) - 0.02 * sprint;
    // stance sweeps the leg from front (pi/2) to back (3pi/2); swing carries it forward again
    const legAngle = (u) => (u < stance ? Math.PI / 2 + Math.PI * (u / stance) : Math.PI * 1.5 + Math.PI * ((u - stance) / (1 - stance)));
    // no two strides quite alike
    const vary = 1 + 0.05 * Math.sin(this.t * 0.71) * Math.sin(this.t * 1.33 + 2);
    const stride = s / Math.max(freq, 0.01);
    let A = Math.asin(Math.min(0.98, stride / (4 * Lref))) * (1 - 0.35 * run) * (1 - 0.2 * sn) * vary;
    A = clamp(A, 0, 0.72) * move;
    // a runner drives the knee up in front and folds the heel high behind
    const bias = -(0.07 + 0.14 * run + 0.18 * sprint + 0.22 * sn) * move;
    const kSwing = (0.95 + 0.7 * run + 0.6 * sprint + 1.0 * sn) * move;

    // thigh and knee angles of a leg at gait time u
    const legAt = (u) => {
      const inStance = u < stance;
      const us = inStance ? u / stance : 0, uw = inStance ? 0 : (u - stance) / (1 - stance);
      const thigh = bias - A * Math.sin(legAngle(u));
      // knee: gives a little as the foot takes the weight, folds hard early in the swing, reaches out to land
      const kneeSt = inStance ? Math.sin(Math.PI * us) * (0.12 + 0.45 * run) : 0;
      const kneeSw = inStance ? 0 : Math.pow(Math.sin(Math.PI * Math.min(1, uw * 1.2)), 1.25) * kSwing;
      return { inStance, us, uw, thigh, knee: (0.06 + kneeSt + kneeSw + 0.12 * sn) * move };
    };
    const extOf = (thigh, knee) => LEG.L1 * Math.cos(thigh) + LEG.L2 * Math.cos(thigh + knee);

    const ext = [0, 0], onGround = [0, 0], plant = [0, 0];
    ['L', 'R'].forEach((side, i) => {
      const { inStance, us, uw, thigh, knee } = legAt((this.u + (i ? 0.5 : 0)) % 1);
      // foot: flat while loaded, rolls onto the toes to push off, toes lift clear through the swing
      const push = (inStance ? smoothstep(0.5, 1.0, us) : 1 - smoothstep(0.0, 0.3, uw)) * (0.3 + 0.35 * run);
      const toes = inStance ? 0 : Math.sin(Math.PI * uw) * 0.22;
      const foot = -(thigh + knee) + (push - toes - 0.15 * sn) * move;
      b['thigh_' + side][0] = thigh; b['thigh_' + side][2] = (i ? -1 : 1) * 0.015;
      b['shin_' + side][0] = knee;
      b['foot_' + side][0] = foot;
      ext[i] = extOf(thigh, knee);
      onGround[i] = inStance ? 1 : 0;
      plant[i] = inStance ? smoothstep(0, 0.18, us) * (1 - smoothstep(0.75, 1, us)) : 0;
    });
    // the hip height a level run holds: near the top of the range the stance leg sweeps through, so
    // she runs tall; the stance knee straightens or bends to keep the foot on the ground
    let lo = 1e9, hi = -1e9;
    for (let j = 0; j < 12; j++) { const r = legAt((j + 0.5) / 12 * stance); const e = extOf(r.thigh, r.knee); lo = Math.min(lo, e); hi = Math.max(hi, e); }
    const levelT = lerp(lo, hi, 0.7);
    this.level = this.level == null ? levelT : damp(this.level, levelT, 6, dt);

    // idle: weight shift and breathing
    const idle = 1 - move;
    const breathe = Math.sin(this.t * 1.7);
    const shift = Math.sin(this.t * 0.45);
    const dTL = idle * 0.02 * shift, dSL = idle * (0.06 + 0.04 * Math.max(0, shift));
    const dTR = -idle * 0.02 * shift, dSR = idle * (0.06 + 0.04 * Math.max(0, -shift));
    b.thigh_L[0] += dTL; b.shin_L[0] += dSL; b.foot_L[0] -= dTL + dSL;
    b.thigh_R[0] += dTR; b.shin_R[0] += dSR; b.foot_R[0] -= dTR + dSR;
    ext[0] = LEG.L1 * Math.cos(b.thigh_L[0]) + LEG.L2 * Math.cos(b.thigh_L[0] + b.shin_L[0]);
    ext[1] = LEG.L1 * Math.cos(b.thigh_R[0]) + LEG.L2 * Math.cos(b.thigh_R[0] + b.shin_R[0]);

    // pelvis: airborne between running strides, rotates with the swinging leg, drops on the swing
    // side and shifts over the foot that carries the weight
    this.flight = damp(this.flight, run * (1 - Math.max(onGround[0], onGround[1])), 18, dt);
    // moving, the hips glide level (fully when running, mostly when walking). Two-bone IK in the
    // sagittal plane then puts the feet on the ground: a stance foot reaches down to it (as far as
    // the leg allows), and any foot that would dip below it folds up at the knee
    const flat = move * lerp(0.7, 1, run);
    const hHip = lerp(Math.max(ext[0], ext[1]) + this.flight * 0.06 * ls * move, Math.min(this.level, LEG.L1 + LEG.L2 - 0.004), flat);
    L.hipsY = hHip - (LEG.L1 + LEG.L2);
    ['L', 'R'].forEach((side, i) => {
      const reach = ext[i] > hHip ? hHip : lerp(ext[i], hHip, plant[i] * flat);
      if (Math.abs(reach - ext[i]) < 1e-5) return;
      const T = b['thigh_' + side], K = b['shin_' + side], F = b['foot_' + side];
      const sole = F[0] + T[0] + K[0];
      const x = LEG.L1 * Math.sin(T[0]) + LEG.L2 * Math.sin(T[0] + K[0]);
      const d = Math.min(Math.hypot(x, reach), LEG.L1 + LEG.L2 - 1e-4);
      const kn = Math.PI - Math.acos(clamp((LEG.L1 * LEG.L1 + LEG.L2 * LEG.L2 - d * d) / (2 * LEG.L1 * LEG.L2), -1, 1));
      const al = Math.acos(clamp((LEG.L1 * LEG.L1 + d * d - LEG.L2 * LEG.L2) / (2 * LEG.L1 * d), -1, 1));
      T[0] = Math.atan2(x, reach) - al; K[0] = kn; F[0] = sole - T[0] - K[0];
    });
    const aL = legAngle(this.u), sL = Math.sin(aL), cL = Math.cos(aL);
    L.hipsX = (-0.024 * cL * (1 - run) * move + idle * 0.018 * shift) * ls;
    L.hipsZ = 0;
    b.hips[1] = -0.22 * A * sL;
    b.hips[2] = -(0.03 + 0.03 * run) * cL * move;
    // torso folds forward from the hips: the pelvis tips a quarter of the lean (thighs compensate so
    // the legs stay under the body), spine and chest bend the rest, shoulders counter-rotate the
    // hips and the head stays steady on top
    const leanT = (0.2 + 0.28 * run + 0.16 * sprint + 0.16 * sn) * move + clamp(P.accel * 0.025, -0.08, 0.16);
    this.lean = damp(this.lean, leanT, 5, dt);
    const lean = this.lean, tilt = lean * 0.25;
    b.hips[0] = tilt;
    b.thigh_L[0] -= tilt; b.thigh_R[0] -= tilt;
    b.spine[0] = lean * 0.42 + idle * 0.01 * breathe;
    b.chest[0] = lean * 0.33 + idle * 0.018 * breathe - 0.02;
    b.chest[1] = 0.38 * A * sL;
    b.spine[1] = 0.12 * A * sL;
    b.spine[2] = 0.025 * cL * move;
    b.chest[2] = 0.02 * cL * move;
    b.neck[0] = -lean * 0.36;
    b.head[0] = -lean * 0.28 + 0.05;
    b.head[1] = idle * 0.38 * Math.sin(this.t * 0.21) * Math.sin(this.t * 0.13 + 1) - (b.chest[1] + b.spine[1]) * 0.85;
    b.head[2] = -(b.spine[2] + b.chest[2]) * 0.7;

    // arms: each swings with the opposite leg, a beat behind it; coming forward it crosses a little
    // toward the middle and the elbow closes, going back it opens and flares out
    ['L', 'R'].forEach((side, i) => {
      const sgn = i ? -1 : 1;
      const ang = legAngle((this.u + (i ? 0.5 : 0) + 0.05) % 1);
      const sw = Math.sin(ang), fwd = Math.max(0, -sw), back = Math.max(0, sw);
      const trail = side === 'L' ? wh * (1 - run) * move : 0;     // left hand trails through the wheat heads
      // a character in heavy bell sleeves (style.arm < 1) runs with low, short arm swings
      const armA = (0.3 + 0.36 * run + 0.42 * sprint) * move * (1 - 0.7 * trail) * (1 - 0.5 * sn) * vary * (i ? 1.05 : 1) * (P.style?.arm ?? 1);
      b['upperarm_' + side][0] = armA * sw + (0.06 + lean * 0.28) * move - 0.35 * sn * move - 0.3 * trail;
      b['upperarm_' + side][1] = sgn * 0.22 * run * fwd;
      b['upperarm_' + side][2] = sgn * ((P.style?.armOut ?? 0) + 0.1 + 0.12 * run + 0.12 * sprint + 0.08 * run * back - 0.09 * run * fwd + 0.5 * sn * move + 0.5 * trail + idle * 0.02 * breathe);
      b['forearm_' + side][0] = -(0.32 * move + 1.0 * run + 0.25 * sprint + 0.5 * run * fwd - 0.25 * run * back + 0.55 * sn * move) * (P.style?.elbow ?? 1) - idle * 0.12 + 0.1 * trail;
      b['forearm_' + side][1] = sgn * (0.18 * run + 0.15 * sprint + 0.15 * run * fwd);
      b['hand_' + side][0] = -0.1 - 0.18 * run + 0.12 * run * Math.sin(ang + 0.7);
      b['hand_' + side][2] = sgn * (0.25 * trail + 0.1 * sprint);
      // shoulders ride up as the arm drives forward and roll in when running hard
      b['shoulder_' + side][2] = sgn * ((0.06 * run + 0.06 * sprint) * move + 0.06 * run * fwd);
      b['shoulder_' + side][1] = -sgn * ((0.03 + 0.05 * run + 0.03 * sprint) * move + 0.05 * run * fwd);
    });

    // turning: lean into the curve
    const rollT = clamp(-P.turnRate * s * 0.03, -0.28, 0.28);
    this.roll = damp(this.roll, rollT, 5, dt);
    L.roll = this.roll; L.pitch = 0; L.pivotY = 0.95;

    // airborne / landing layers on top of locomotion
    this.air = damp(this.air, P.grounded ? 0 : 1, P.grounded ? 14 : 7, dt);
    if (P.landImpact > 0) { this.land = Math.min(1, P.landImpact / 9); P.landImpact = 0; }
    this.land = Math.max(0, this.land - dt * 3.2);
    if (this.air > 0.01) {
      const a = this.air, up = P.vy > 0 ? 1 : 0;
      const mix = (arr, v) => { arr[0] = lerp(arr[0], v[0], a); arr[1] = lerp(arr[1], v[1], a); arr[2] = lerp(arr[2], v[2], a); };
      mix(b.thigh_L, [up ? -1.0 : -0.55, 0, 0.04]); mix(b.shin_L, [up ? 1.35 : 0.5, 0, 0]); mix(b.foot_L, [up ? -0.2 : 0.1, 0, 0]);
      mix(b.thigh_R, [up ? -0.1 : -0.3, 0, -0.04]); mix(b.shin_R, [up ? 1.0 : 0.35, 0, 0]); mix(b.foot_R, [0.2, 0, 0]);
      mix(b.upperarm_L, [-0.55, 0, 0.55]); mix(b.upperarm_R, [-0.2, 0, -0.6]);
      mix(b.forearm_L, [-0.7, 0, 0]); mix(b.forearm_R, [-0.5, 0, 0]);
      L.hipsY = lerp(L.hipsY, 0, a);
    }
    if (this.land > 0) {
      const l = Math.sin(Math.min(1, this.land) * Math.PI * 0.5);
      L.hipsY -= 0.2 * ls * l;
      b.thigh_L[0] -= 0.55 * l; b.thigh_R[0] -= 0.55 * l;
      b.shin_L[0] += 0.95 * l; b.shin_R[0] += 0.95 * l;
      b.foot_L[0] -= 0.4 * l; b.foot_R[0] -= 0.4 * l;
      b.spine[0] += 0.25 * l; b.upperarm_L[2] += 0.2 * l; b.upperarm_R[2] -= 0.2 * l;
    }

    // follow-through: the upper body trails its targets on damped springs and overshoots a touch,
    // which is most of the difference between a living run and a mechanical one
    this.springs(dt, b);

    // special states: dive, roll, flop, getup
    this.special(dt, P);
    const w = this.overW;
    const out = this.pose, O = this.O;
    for (const k of BONES) {
      const a = L.bones[k], o = O.bones[k], r = out.bones[k];
      r[0] = lerp(a[0], o[0], w); r[1] = lerp(a[1], o[1], w); r[2] = lerp(a[2], o[2], w);
    }
    out.hipsX = lerp(L.hipsX, O.hipsX, w); out.hipsY = lerp(L.hipsY, O.hipsY, w); out.hipsZ = lerp(L.hipsZ, O.hipsZ, w);
    out.pitch = lerp(L.pitch, O.pitch, w); out.roll = lerp(L.roll, O.roll, w); out.pivotY = lerp(L.pivotY, O.pivotY, w);
    out.grip = 0; out.sp = out.sa = null; out.aim = P.aim || null;
    if (P.attack && P.attack.w > 0.001 && w < 0.5) this.attackLayer(out, P.attack, dt);
    else { this._atkKind = null; this._atkLast = null; this._atkOff = null; this._atkVel = null; }   // layer is off: nothing stale to fade from
    return out;
  }

  // The sword moves (swordmoves.js) on top of whatever the walk or run produced. The layer's weight
  // ramps in and out. When one move hands over to the next, the gap between where the last one was
  // and where the next begins is kept as an offset on a critically damped spring that starts with the
  // arm's own speed, so nothing jumps and nothing stops dead at the join. The stance (feet and hip
  // drop) is written for a person with 0.86 m legs and scaled to his.
  attackLayer(out, A, dt) {
    const pose = this._atkPose = evalMove(A.kind, A.t, this._atkPose || {});
    const last = this._atkLast, vel = this._atkVel || (this._atkVel = {});
    if (this._atkKind !== A.kind) {
      this._atkKind = A.kind;
      const off = this._atkOff = {};
      if (last) for (const k in pose) if (last[k]) off[k] = pose[k].map((v, i) => ({ x: last[k][i] - v, v: vel[k] ? vel[k][i] : 0 }));
    }
    const off = this._atkOff, wt = A.w;
    const val = (k, i) => pose[k][i] + (off && off[k] ? off[k][i].x : 0);
    for (const k in pose) {
      if (k === 'stance') continue;
      const r = out.bones[k]; if (!r) continue;
      for (let i = 0; i < 3; i++) r[i] = lerp(r[i], val(k, i), wt);
    }
    out.grip = (pose.grip ? pose.grip[0] : 0) * wt;     // how much both hands are on the hilt (a two-handed hold)
    // and where the sword is, in the chest's frame (it gets the same smoothed hand-over as the bones)
    const swordAt = pose.sp && pose.sa ? [0, 1, 2].map((i) => val('sp', i)).concat([0, 1, 2].map((i) => val('sa', i))) : null;
    if (out.grip > 0.002 && swordAt) { out.sp = swordAt.slice(0, 3); out.sa = swordAt.slice(3); }
    // legs: planted in a stance that suits the move (only when he is not walking)
    const st = pose.stance ? [val('stance', 0), val('stance', 1), val('stance', 2)] : null, wl = wt * (A.legs ?? 1);
    if (st && wl > 0.001) {
      const full = LEG.L1 + LEG.L2, sc = this.ls || 1, hNow = out.hipsY + full;
      const hHip = hNow - st[2] * sc * wl;
      out.hipsY = lerp(out.hipsY, hHip - full, wl);
      ['L', 'R'].forEach((side, i) => {
        const T = out.bones['thigh_' + side], K = out.bones['shin_' + side], F = out.bones['foot_' + side];
        const foot = st[i] * sc, x = -foot;                  // x: how far behind the hip the foot is
        const d = Math.min(Math.hypot(x, hHip), full - 1e-4);
        const kn = Math.PI - Math.acos(clamp((LEG.L1 * LEG.L1 + LEG.L2 * LEG.L2 - d * d) / (2 * LEG.L1 * LEG.L2), -1, 1));
        const al = Math.acos(clamp((LEG.L1 * LEG.L1 + d * d - LEG.L2 * LEG.L2) / (2 * LEG.L1 * d), -1, 1));
        const t = Math.atan2(x, hHip) - al, heel = foot < 0 ? Math.min(0.5, -foot * 2) : 0;
        T[0] = lerp(T[0], t, wl); K[0] = lerp(K[0], kn, wl); F[0] = lerp(F[0], -(t + kn) + heel, wl);
      });
    }
    // the offsets settle (critically damped, about 0.4 s)
    if (off && dt > 0) for (const k in off) for (const o of off[k]) { o.v += (-20 * o.v - 100 * o.x) * dt; o.x += o.v * dt; }
    // remember what was shown and how fast it was moving, for the next hand-over
    const L = last || (this._atkLast = {});
    for (const k in out.bones) {
      const cur = out.bones[k], prev = L[k];
      vel[k] = prev && dt > 0 ? cur.map((v, i) => (v - prev[i]) / dt) : [0, 0, 0];
      L[k] = cur.slice();
    }
    const prevS = L.stance;
    vel.stance = prevS && st && dt > 0 ? st.map((v, i) => (v - prevS[i]) / dt) : [0, 0, 0];
    L.stance = st ? st.slice() : null;
    // the sword's path as one six-number channel pair, so the next move can start from where this one was
    for (const [k, o] of [['sp', 0], ['sa', 3]]) {
      const cur = swordAt ? swordAt.slice(o, o + 3) : null, prev = L[k];
      vel[k] = prev && cur && dt > 0 ? cur.map((v, i) => (v - prev[i]) / dt) : [0, 0, 0];
      L[k] = cur;
    }
  }

  springs(dt, b) {
    const SP = { spine: 9, chest: 8, neck: 7, head: 6.5, shoulder_L: 7, shoulder_R: 7, upperarm_L: 6, upperarm_R: 6, forearm_L: 5.5, forearm_R: 5.5, hand_L: 5, hand_R: 5 };
    if (!this.sp) { this.sp = {}; for (const k in SP) this.sp[k] = { x: b[k].slice(), v: [0, 0, 0] }; }
    const n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n, z = 0.6;
    for (const k in SP) {
      const S = this.sp[k], w = SP[k] * Math.PI * 2, w2 = w * w, c = 2 * z * w;
      for (let j = 0; j < 3; j++) {
        let x = S.x[j], v = S.v[j];
        const t = b[k][j];
        for (let i = 0; i < n; i++) { v += (w2 * (t - x) - c * v) * h; x += v * h; }
        S.x[j] = x; S.v[j] = v; b[k][j] = x;
      }
    }
  }

  special(dt, P) {
    const O = this.O, b = O.bones;
    let target = 0;
    const set = (k, x, y = 0, z = 0) => { b[k][0] = x; b[k][1] = y; b[k][2] = z; };
    for (const k of BONES) set(k, 0);
    O.hipsX = O.hipsY = O.hipsZ = 0; O.roll = 0;
    const t = P.stateT;
    if (P.state === 'dive') {
      target = 1;
      const k = smoothstep(0, 0.22, t);
      O.pitch = 1.35 * k; O.pivotY = lerp(0.95, 0.3, smoothstep(0.1, 0.5, t));
      set('spine', -0.15 * k); set('chest', -0.1 * k); set('neck', -0.55 * k); set('head', -0.45 * k);
      set('upperarm_L', -2.75 * k, 0, 0.18); set('upperarm_R', -2.75 * k, 0, -0.18);
      set('forearm_L', -0.15); set('forearm_R', -0.15);
      set('thigh_L', 0.12 * k, 0, 0.05); set('thigh_R', 0.2 * k, 0, -0.05);
      set('shin_L', 0.25); set('shin_R', 0.45); set('foot_L', 0.5 * k); set('foot_R', 0.5 * k);
    } else if (P.state === 'roll') {
      target = 1;
      const u = clamp(t / P.rollTime, 0, 1);
      const e = u * u * (3 - 2 * u);
      // keep the angle in (-pi, pi] so blending out near the end goes the short way to upright
      let ang = lerp(1.35, TAU, e); if (ang > Math.PI) ang -= TAU;
      O.pitch = ang;
      O.pivotY = 0.3 + 0.22 * smoothstep(0, 0.3, u) + 0.43 * smoothstep(0.62, 1, u);
      const tuck = Math.sin(clamp(u * 1.15, 0, 1) * Math.PI);
      set('spine', 0.55 * tuck); set('chest', 0.35 * tuck); set('neck', 0.45 * tuck); set('head', 0.3 * tuck);
      set('thigh_L', -2.0 * tuck, 0, 0.1); set('thigh_R', -2.0 * tuck, 0, -0.1);
      set('shin_L', 2.3 * tuck); set('shin_R', 2.3 * tuck);
      set('foot_L', -0.2 * tuck); set('foot_R', -0.2 * tuck);
      set('upperarm_L', -1.1 * tuck, 0, 0.3); set('upperarm_R', -1.1 * tuck, 0, -0.3);
      set('forearm_L', -1.6 * tuck); set('forearm_R', -1.6 * tuck);
      target = u > 0.85 ? 1 - smoothstep(0.85, 1, u) : 1;
    } else if (P.state === 'flop') {
      target = 1;
      O.pitch = 1.42; O.pivotY = 0.2;
      set('neck', -0.5); set('head', -0.3);
      set('upperarm_L', -2.5, 0, 0.5); set('upperarm_R', -2.5, 0, -0.5);
      set('forearm_L', -0.5); set('forearm_R', -0.5);
      set('thigh_L', 0.1, 0, 0.12); set('thigh_R', 0.15, 0, -0.12); set('shin_L', 0.3); set('shin_R', 0.2); set('foot_L', 0.6); set('foot_R', 0.6);
    } else if (P.state === 'tackle') {
      // all fours: the body tipped well forward and low, hands planted, knees tucked under. While the charge
      // builds he coils lower and trembles; in the dash he is stretched out flat, arms thrown forward and legs
      // driven back
      target = 1;
      const dn = smoothstep(0, DOWN * 0.55, t) * (1 - smoothstep(UP, TOTAL, t));
      const rn = smoothstep(DOWN - 0.04, DOWN + 0.02, t) * (1 - smoothstep(DOWN + RUN, DOWN + RUN + 0.16, t));
      const cn = smoothstep(0.1, DOWN, t) * (1 - rn), tr = 0.03 * cn * Math.sin(this.t * 70);
      O.pitch = 1.12 * dn + 0.18 * rn; O.pivotY = lerp(0.95, 0.46, dn) - 0.07 * cn;
      set('spine', 0.12 * dn - 0.14 * rn + tr); set('chest', 0.1 * dn - 0.1 * rn + tr);
      set('neck', -1.05 * dn - 0.1 * rn); set('head', -0.6 * dn);
      for (const [side, sg] of [['L', 1], ['R', -1]]) {
        set('shoulder_' + side, 0, 0, sg * 0.05 * dn);
        set('upperarm_' + side, -1.12 * dn - 0.8 * rn, 0, sg * 0.1 * dn);
        set('forearm_' + side, -0.15 * dn);
        set('hand_' + side, 0.5 * dn - 0.4 * rn);
        set('thigh_' + side, -1.6 * dn + 1.15 * rn - 0.12 * cn, 0, sg * 0.1 * dn);
        set('shin_' + side, 2.1 * dn - 1.4 * rn + 0.15 * cn);
        set('foot_' + side, -0.3 * dn + 0.5 * rn);
      }
      O.hipsY = -0.02 * dn;
    } else if (P.state === 'rockkick') {
      // Rock Kick: knee up, stomp, draw the leg back as the boulder comes up, kick it away, follow through
      target = 1 - smoothstep(KICK_TIME - 0.2, KICK_TIME, t);
      O.pitch = 0; O.pivotY = 0.95;
      const K = ROCKKICK;
      let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
      const [t0, a] = K[i], [t1, c] = K[i + 1], u = smoothstep(0, 1, clamp((t - t0) / (t1 - t0), 0, 1));
      for (const k in a) {
        if (k === 'hipsY') { O.hipsY = lerp(a[k], c[k], u); continue; }
        const v = a[k], w = c[k] || v;
        set(k, lerp(v[0], w[0], u), lerp(v[1] || 0, w[1] || 0, u), lerp(v[2] || 0, w[2] || 0, u));
      }
    } else if (P.state === 'getup') {
      const u = clamp(t / P.getupTime, 0, 1), e = u * u * (3 - 2 * u);
      target = 1 - smoothstep(0.8, 1, u);
      O.pitch = lerp(1.42, 0, e); O.pivotY = lerp(0.2, 0.95, e);
      const kneel = Math.sin(u * Math.PI);
      set('spine', 0.3 * kneel); set('neck', lerp(-0.5, 0, e)); set('head', lerp(-0.3, 0.05, e));
      set('upperarm_L', lerp(-1.4, 0, e), 0, 0.3 * (1 - e)); set('upperarm_R', lerp(-1.4, 0, e), 0, -0.3 * (1 - e));
      set('forearm_L', -0.9 * kneel); set('forearm_R', -0.9 * kneel);
      set('thigh_L', -1.5 * kneel); set('thigh_R', -0.4 * kneel); set('shin_L', 1.9 * kneel); set('shin_R', 1.2 * kneel);
      set('foot_L', -0.4 * kneel); set('foot_R', 0.2 * kneel);
    }
    const rate = target > this.overW ? 16 : 8;
    this.overW = damp(this.overW, target, rate, dt);
    if (P.state === 'roll' || P.state === 'flop' || P.state === 'getup') this.overW = Math.max(this.overW, target);
  }
}
