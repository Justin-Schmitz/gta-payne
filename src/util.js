export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleLerp = (a, b, t) => a + wrapAngle(b - a) * t;
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const fmtMoney = (n) => '$' + Math.floor(n).toLocaleString('en-US');

/** Circle vs axis-aligned box in XZ. Returns a push-out vector or null. box = {x0,z0,x1,z1} */
export function circleAABB(cx, cz, r, box) {
  const nx = clamp(cx, box.x0, box.x1);
  const nz = clamp(cz, box.z0, box.z1);
  const dx = cx - nx, dz = cz - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const p = (r - d) / d;
    return { px: dx * p, pz: dz * p };
  }
  // centre is inside the box: push out along the nearest face
  const l = cx - box.x0, rr = box.x1 - cx, t = cz - box.z0, b = box.z1 - cz;
  const m = Math.min(l, rr, t, b);
  if (m === l) return { px: -(l + r), pz: 0 };
  if (m === rr) return { px: rr + r, pz: 0 };
  if (m === t) return { px: 0, pz: -(t + r) };
  return { px: 0, pz: b + r };
}

/** Segment vs AABB in XZ (slab test). Returns entry t in [0,1] or null. */
export function segAABB(ax, az, bx, bz, box) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  // x slab
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.x0 || ax > box.x1) return null;
  } else {
    let ta = (box.x0 - ax) / dx, tb = (box.x1 - ax) / dx;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  // z slab
  if (Math.abs(dz) < 1e-9) {
    if (az < box.z0 || az > box.z1) return null;
  } else {
    let ta = (box.z0 - az) / dz, tb = (box.z1 - az) / dz;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return t0;
}

/** Segment vs circle in XZ. Returns t in [0,1] of first contact or null. */
export function segCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return fx * fx + fz * fz <= r * r ? 0 : null;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t = (-b - disc) / (2 * a);
  if (t >= 0 && t <= 1) return t;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return 0; // started inside
  return null;
}

/** Point inside oriented rectangle (XZ) with centre (cx,cz), yaw, half extents hw (sideways) hl (forward). */
export function pointInOBB(px, pz, cx, cz, yaw, hw, hl) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const dx = px - cx, dz = pz - cz;
  const fwd = dx * s + dz * c;        // along forward (sin,cos)
  const side = -dx * c + dz * s;      // along right (-cos, sin)
  return Math.abs(fwd) <= hl && Math.abs(side) <= hw;
}
