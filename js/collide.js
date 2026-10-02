// Colliders on the plain are circles { x, z, r } (trees, rocks, posts, walls as rows of circles) or, for buildings,
// boxes { box: true, x, z, hw, hd, rot, r }: a rectangle hw by hd half-widths about (x, z), turned by rot (radians,
// as a heading: its local +z faces along (sin rot, cos rot)), with r the radius of a circle round it so that
// anything that only knows circles still treats it roughly right. h, where given, is how high it stands.
import { groundY } from './world.js';

const _o = { x: 0, z: 0, nx: 0, nz: 0, d: 0 };

export function boxCollider(x, z, hw, hd, rot = 0, h = 6) {
  return { box: true, x, z, hw, hd, rot, h, r: Math.hypot(hw, hd), c: Math.cos(rot), s: Math.sin(rot) };
}

// is (x, z) within `pad` of the collider?
export function inside(c, x, z, pad = 0) {
  const dx = x - c.x, dz = z - c.z;
  if (!c.box) { const r = c.r + pad; return dx * dx + dz * dz < r * r; }
  const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
  return Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hd + pad;
}

// how to get (x, z) out of the collider grown by `pad`: the push (x, z), the outward normal (nx, nz) and how deep it
// was (d); null if it is not inside
export function pushOut(c, x, z, pad = 0) {
  const dx = x - c.x, dz = z - c.z;
  if (!c.box) {
    const r = c.r + pad, d2 = dx * dx + dz * dz;
    if (d2 >= r * r || d2 < 1e-10) return null;
    const d = Math.sqrt(d2);
    _o.nx = dx / d; _o.nz = dz / d; _o.d = r - d; _o.x = _o.nx * _o.d; _o.z = _o.nz * _o.d;
    return _o;
  }
  // into the box's own frame (local x along (cos rot, -sin rot), local z along (sin rot, cos rot))
  const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
  const ex = c.hw + pad - Math.abs(lx), ez = c.hd + pad - Math.abs(lz);
  if (ex <= 0 || ez <= 0) return null;
  // out through the nearer side
  let nlx = 0, nlz = 0;
  if (ex < ez) { nlx = Math.sign(lx) || 1; _o.d = ex; } else { nlz = Math.sign(lz) || 1; _o.d = ez; }
  _o.nx = nlx * c.c + nlz * c.s; _o.nz = -nlx * c.s + nlz * c.c;
  _o.x = _o.nx * _o.d; _o.z = _o.nz * _o.d;
  return _o;
}

// the outward normal of the collider's surface nearest (x, z) (for bouncing off it)
export function normalAt(c, x, z) {
  const p = pushOut(c, x, z, 1e3);
  if (p) return [p.nx, p.nz];
  const dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

// does the point (x, y, z) lie in the collider (grown by `pad`), below its top (h metres over the ground, or `h`)?
export function struck(c, x, y, z, pad = 0, h = c.h ?? 2.5) {
  return inside(c, x, z, pad) && y < groundY(c.x, c.z) + h;
}

// how far along the stretch from a to b (0..1) it first enters the box grown by `pad` (1 if it never does, 0 if a is
// already in it): for the camera, which must not see through a wall
export function enters(c, ax, az, bx, bz, pad = 0) {
  const lx = (x, z) => (x - c.x) * c.c - (z - c.z) * c.s, lz = (x, z) => (x - c.x) * c.s + (z - c.z) * c.c;
  const x0 = lx(ax, az), z0 = lz(ax, az), dx = lx(bx, bz) - x0, dz = lz(bx, bz) - z0;
  let t0 = 0, t1 = 1;
  for (const [p, d, e] of [[x0, dx, c.hw + pad], [z0, dz, c.hd + pad]]) {
    if (Math.abs(d) < 1e-9) { if (p < -e || p > e) return 1; continue; }
    let a = (-e - p) / d, b = (e - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return 1;
  }
  return t0;
}
