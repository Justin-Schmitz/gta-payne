import * as THREE from 'three';
import { circleAABB, segAABB, choice, fmtMoney } from '../util.js';
import { Vehicle, VEHICLE_TYPES } from '../entities/vehicle.js';
import { stockFor, quote } from '../data/dealers.js';

/**
 * Walk-in rooms for the gun shops and car dealers (T14).
 *
 * A room is a THREE.Group built at a far-away offset inside the main scene (the city is culled by the
 * camera far plane and hidden by systems/interiors.js while inside), plus a RoomCollision object with
 * the same method names as City (query, queryRect, resolveCircle, lineOfSight, raycast, pointFree,
 * groundHeight) so game.world can hand either one to ped / combat / camera code.
 */

// ---------------------------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------------------------
export class RoomCollision {
  /** bounds: the walkable floor rectangle {x0,z0,x1,z1} in world coordinates. */
  constructor(bounds) {
    this.bounds = bounds;
    this.boxes = [];
  }
  addBox(b) { this.boxes.push(b); return b; }
  queryRect(x0, z0, x1, z1) {
    return this.boxes.filter((b) => b.x1 >= x0 && b.x0 <= x1 && b.z1 >= z0 && b.z0 <= z1);
  }
  query(x, z, r = 0) { return this.queryRect(x - r, z - r, x + r, z + r); }
  resolveCircle(pos, r, clearY = -Infinity) {
    let hits = 0;
    const boxes = this.query(pos.x, pos.z, r + 1);
    for (let iter = 0; iter < 2; iter++) {
      for (const b of boxes) {
        if (b.h <= clearY) continue;
        const p = circleAABB(pos.x, pos.z, r, b);
        if (p) { pos.x += p.px; pos.z += p.pz; hits++; }
      }
    }
    const B = this.bounds;
    if (pos.x < B.x0 + r) { pos.x = B.x0 + r; hits++; } else if (pos.x > B.x1 - r) { pos.x = B.x1 - r; hits++; }
    if (pos.z < B.z0 + r) { pos.z = B.z0 + r; hits++; } else if (pos.z > B.z1 - r) { pos.z = B.z1 - r; hits++; }
    return hits;
  }
  groundHeight(x, z, maxH = 2.6) {
    let g = 0;
    for (const b of this.boxes) {
      if (b.h > g && b.h <= maxH && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) g = b.h;
    }
    return g;
  }
  lineOfSight(ax, az, bx, bz, minH = 1.2) {
    for (const b of this.queryRect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz))) {
      if (b.h < minH) continue;
      if (segAABB(ax, az, bx, bz, b) !== null) return false;
    }
    return true;
  }
  raycast(ax, az, bx, bz, minH = 0) {
    let best = null;
    for (const b of this.queryRect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz))) {
      if (b.h < minH) continue;
      const t = segAABB(ax, az, bx, bz, b);
      if (t !== null && (best === null || t < best)) best = t;
    }
    return best;
  }
  pointFree(x, z, r = 0.6) {
    const B = this.bounds;
    if (x < B.x0 + r || x > B.x1 - r || z < B.z0 + r || z > B.z1 - r) return false;
    for (const b of this.query(x, z, r)) if (circleAABB(x, z, r, b)) return false;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------------------------
class Builder {
  constructor(ox, oz, W, D, H) {
    this.ox = ox; this.oz = oz; this.W = W; this.D = D; this.H = H;
    this.group = new THREE.Group();
    this.col = new RoomCollision({ x0: ox - W / 2, z0: oz - D / 2, x1: ox + W / 2, z1: oz + D / 2 });
    this.garbage = [];      // things we created and must dispose
    this.cars = [];         // {v, spin}
    this.lights = [];
  }
  keep(o) { this.garbage.push(o); return o; }
  lam(color, o = {}) { return this.keep(new THREE.MeshLambertMaterial({ color, ...o })); }
  basic(color, o = {}) { return this.keep(new THREE.MeshBasicMaterial({ color, ...o })); }
  tex(w, h, draw, rx = 1, ry = 1) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = this.keep(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
  }
  sign(text, w, h, bg, fg, border, font = 54) {
    const px = 512, py = Math.round(512 * h / w);
    return this.tex(px, py, (c) => {
      c.fillStyle = bg; c.fillRect(0, 0, px, py);
      c.strokeStyle = border; c.lineWidth = 7; c.strokeRect(5, 5, px - 10, py - 10);
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      let f = font;
      c.font = `bold ${f}px Arial, sans-serif`;
      while (f > 12 && c.measureText(text).width > px - 36) { f -= 2; c.font = `bold ${f}px Arial, sans-serif`; } // shrink long names to fit
      c.fillText(text, px / 2, py / 2 + 2);
    });
  }
  /** Mesh with its centre at room-local (cx, y0 + h/2, cz). solid: also a collision box up to the top of the mesh. */
  box(cx, y0, cz, w, h, d, mat, solid = false) {
    const m = new THREE.Mesh(this.keep(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(this.ox + cx, y0 + h / 2, this.oz + cz);
    this.group.add(m);
    if (solid) this.solid(cx, cz, w, d, y0 + h);
    return m;
  }
  solid(cx, cz, w, d, h, extra = {}) {
    return this.col.addBox({ x0: this.ox + cx - w / 2, z0: this.oz + cz - d / 2, x1: this.ox + cx + w / 2, z1: this.oz + cz + d / 2, h, ...extra });
  }
  plane(w, h, mat) { return new THREE.Mesh(this.keep(new THREE.PlaneGeometry(w, h)), mat); }
  place(obj, cx, y, cz) { obj.position.set(this.ox + cx, y, this.oz + cz); this.group.add(obj); return obj; }
  panel(cx, cz, w, d, color = '#fff3d0') {
    const m = this.plane(w, d, this.basic(color));
    m.rotation.x = Math.PI / 2;
    return this.place(m, cx, this.H - 0.02, cz);
  }
  light(cx, cz, y, color, intensity, dist) {
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.set(this.ox + cx, y, this.oz + cz);
    this.group.add(l);
    this.lights.push(l);
    return l;
  }

  /** Floor, ceiling, four textured walls with collision boxes, black sky. */
  shell(floorTex, wallStyle, ceilColor) {
    const { W, D, H, ox, oz } = this;
    const floor = this.plane(W, D, this.lam('#ffffff', { map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    this.place(floor, 0, 0, 0);
    const ceil = this.plane(W, D, this.lam(ceilColor));
    ceil.rotation.x = Math.PI / 2;
    this.place(ceil, 0, H, 0);
    const wall = (len, cx, cz, ry) => {
      const t = this.tex(256, 256, (c, w, h) => wallStyle(c, w, h), len / 4, 1);
      const m = this.plane(len, H, this.lam('#ffffff', { map: t }));
      m.rotation.y = ry;
      this.place(m, cx, H / 2, cz);
    };
    wall(W, 0, -D / 2, 0);                 // north (back), faces +z
    wall(W, 0, D / 2, Math.PI);            // south (door), faces -z
    wall(D, -W / 2, 0, Math.PI / 2);       // west, faces +x
    wall(D, W / 2, 0, -Math.PI / 2);       // east, faces -x
    const T = 1;
    const mk = (x0, z0, x1, z1) => this.col.addBox({ x0, z0, x1, z1, h: H, wall: true });
    mk(ox - W / 2 - T, oz - D / 2 - T, ox + W / 2 + T, oz - D / 2);
    mk(ox - W / 2 - T, oz + D / 2, ox + W / 2 + T, oz + D / 2 + T);
    mk(ox - W / 2 - T, oz - D / 2, ox - W / 2, oz + D / 2);
    mk(ox + W / 2, oz - D / 2, ox + W / 2 + T, oz + D / 2);
    // black sky so the city can never show through a gap
    const sky = new THREE.Mesh(this.keep(new THREE.BoxGeometry(W + 60, H + 60, D + 60)), this.basic('#000000', { side: THREE.BackSide }));
    this.place(sky, 0, H / 2, 0);
  }

  /** Exit door on the south wall (x = 0) with a green EXIT sign. */
  door(glass) {
    const { D } = this;
    const frame = this.lam('#2b2b2e');
    this.box(0, 0, D / 2 - 0.05, 2.0, 2.5, 0.1, frame);
    this.box(0, 0.05, D / 2 - 0.1, 1.7, 2.35, 0.06, glass ? this.basic('#5aa6c8', { transparent: true, opacity: 0.55 }) : this.lam('#5a3a22'));
    this.box(0, 2.62, D / 2 - 0.06, 0.9, 0.3, 0.06, this.basic('#2fd36a'));
    this.box(0, 0.01, D / 2 - 0.9, 1.9, 0.02, 1.1, this.lam('#2a2226'));
  }

  update(dt) {
    for (const c of this.cars) {
      c.v.yaw += c.spin * dt;
      c.v.updateMesh();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------
/** Side-on gun silhouette (barrel along +x, thickness along z). Returns a Group centred on the origin. */
function gunProp(b, type, mats) {
  const g = new THREE.Group();
  const add = (w, h, d, x, y, mat) => {
    const m = new THREE.Mesh(b.keep(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, 0); g.add(m);
  };
  const { metal, wood, olive } = mats;
  switch (type) {
    case 'pistol':
      add(0.3, 0.07, 0.05, 0.03, 0.05, metal); add(0.09, 0.2, 0.05, -0.08, -0.08, wood);
      break;
    case 'uzi':
      add(0.5, 0.13, 0.06, 0, 0, metal); add(0.07, 0.24, 0.05, 0.02, -0.17, metal); add(0.26, 0.04, 0.03, -0.36, 0.02, metal);
      break;
    case 'shotgun':
      add(1.0, 0.07, 0.06, 0.15, 0.05, metal); add(0.45, 0.12, 0.07, -0.42, 0, wood); add(0.4, 0.05, 0.05, 0.3, -0.04, wood);
      break;
    case 'rifle':
      add(1.1, 0.06, 0.05, 0.2, 0.06, metal); add(0.5, 0.11, 0.06, -0.45, 0, wood); add(0.3, 0.1, 0.06, 0.05, -0.02, metal); add(0.07, 0.2, 0.05, -0.05, -0.14, metal);
      break;
    case 'rocket': {
      const tube = new THREE.Mesh(b.keep(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8)), olive);
      tube.rotation.z = Math.PI / 2; g.add(tube);
      add(0.12, 0.2, 0.06, 0, -0.14, metal);
      break;
    }
    default: break;
  }
  return g;
}

function ammoBoxes(b, cx, y, cz, n, along = 'x') {
  const colors = ['#c0392b', '#d4a017', '#2e7d32', '#1565c0', '#ef6c00'];
  for (let i = 0; i < n; i++) {
    const c = colors[i % colors.length];
    b.box(cx + (along === 'x' ? i * 0.34 : 0), y, cz + (along === 'z' ? i * 0.34 : 0), 0.28, 0.16, 0.2, b.lam(c));
  }
}

// ---------------------------------------------------------------------------------------------
// Gun shop
// ---------------------------------------------------------------------------------------------
function buildGunShop(game, data, ox, oz) {
  const W = 14, D = 12, H = 3.4;
  const b = new Builder(ox, oz, W, D, H);
  const planks = b.tex(128, 128, (c) => {
    c.fillStyle = '#4a3220'; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = `hsl(28, 36%, ${20 + ((i * 53) % 9)}%)`; c.fillRect(0, i * 16, 128, 15);
      c.fillStyle = '#21140a'; c.fillRect(0, i * 16 + 15, 128, 1); c.fillRect(((i * 61) % 100) + 10, i * 16, 1, 15);
    }
  }, W / 2, D / 2);
  b.shell(planks, (c, w, h) => {
    const wain = h * 0.4;
    c.fillStyle = '#b39a72'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#5a3d25'; c.fillRect(0, h - wain, w, wain);
    c.fillStyle = 'rgba(0,0,0,0.28)'; for (let x = 0; x < w; x += 32) c.fillRect(x, h - wain, 2, wain);
    c.fillStyle = '#2b1b0f'; c.fillRect(0, h - wain - 5, w, 7);
    c.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < 200; i++) c.fillRect(Math.random() * w, Math.random() * (h - wain), 2, 2);
  }, '#6e665a');

  const mats = { metal: b.lam('#2c2e33'), wood: b.lam('#7a4e2a'), olive: b.lam('#3f5a2e') };
  const dark = b.lam('#3a2616'), top = b.lam('#c9a77a');

  // back wall: weapon rack under the shop sign
  b.box(0, 0.7, -D / 2 + 0.07, W - 3, 1.9, 0.1, b.lam('#241a12'));
  const types = ['rifle', 'shotgun', 'pistol', 'uzi', 'rifle', 'shotgun'];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 6; i++) {
      const t = types[(i + row * 2) % types.length];
      const gp = gunProp(b, t, mats);
      gp.scale.setScalar(t === 'pistol' ? 1.3 : 1);
      b.place(gp, -4.9 + i * 1.96, 1.35 + row * 0.8, -D / 2 + 0.18);
    }
  }
  const plate = b.plane(6.4, 1.2, b.basic('#ffffff', { map: b.sign(data.name || 'GUN SHOP', 6.4, 1.2, '#16181c', '#ffe066', '#ff8a1a', 62) }));
  b.place(plate, 0, 3.0, -D / 2 + 0.03);

  // counter (full width: the keeper works behind it)
  b.box(0, 0, -3.1, W, 1.05, 0.9, dark, true);
  b.box(0, 1.05, -3.1, W, 0.08, 1.1, top);
  b.box(3.4, 1.13, -3.15, 0.5, 0.3, 0.4, b.lam('#1b1b1f'));
  b.box(3.4, 1.43, -3.15, 0.3, 0.12, 0.3, b.basic('#4fe0a0'));
  for (const [x, t] of [[-4.6, 'pistol'], [-3.4, 'uzi'], [-2.2, 'pistol']]) {
    const gp = gunProp(b, t, mats);
    gp.rotation.x = Math.PI / 2; // lying flat
    b.place(gp, x, 1.2, -3.0);
  }

  // side shelves with ammo, guns hung above them
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.4);
    b.box(x, 0, 1.6, 0.7, 2.0, 6.0, b.lam('#2c2118'), true);
    for (let i = 0; i < 3; i++) {
      b.box(x - s * 0.05, 0.4 + i * 0.55, 1.6, 0.62, 0.05, 5.8, b.lam('#6b4a2c'));
      ammoBoxes(b, x - s * 0.2, 0.46 + i * 0.55, -0.9, 8, 'z');
    }
    for (let i = 0; i < 4; i++) {
      const gp = gunProp(b, i % 2 ? 'shotgun' : 'rifle', mats);
      gp.rotation.y = s * Math.PI / 2; // lies along the wall, flat side out
      gp.rotation.z = 0.0;
      b.place(gp, s * (W / 2 - 0.12), 2.6 + (i % 2) * 0.3, -0.4 + i * 1.7);
    }
  }

  // glass case in the middle of the floor
  b.box(0, 0, 1.4, 2.8, 1.0, 0.9, dark, true);
  b.box(0, 1.0, 1.4, 2.8, 0.12, 0.9, b.lam('#9fd6ff', { transparent: true, opacity: 0.4 }));
  for (const [x, t] of [[-0.9, 'pistol'], [0, 'uzi'], [0.9, 'pistol']]) {
    const gp = gunProp(b, t, mats);
    gp.rotation.x = Math.PI / 2;
    b.place(gp, x, 1.12, 1.4);
  }
  // crates and a barrel by the door
  b.box(-5.7, 0, 4.7, 1.0, 1.0, 1.0, b.lam('#8d6e3f'), true);
  b.box(-5.6, 1.0, 4.7, 0.7, 0.6, 0.7, b.lam('#7a5d33'));
  b.box(5.7, 0, 4.9, 0.8, 0.95, 0.8, b.lam('#3d4a2a'), true);
  b.door(false);

  for (const x of [-3.5, 3.5]) { b.panel(x, 1.2, 2.4, 0.5); b.light(x, 1.2, H - 0.7, '#ffe2b0', 9, 15); }
  b.panel(0, -4.2, 3, 0.5);
  b.light(0, -4.4, H - 0.7, '#ffd9a0', 6, 10);

  return finish(b, {
    kind: 'gun', key: 'gun:' + (data.name || ''), name: data.name || 'GUN SHOP', data,
    entry: { x: 0, z: D / 2 - 1.8, yaw: Math.PI }, keeper: { x: 0, z: -4.7 },
    counter: { x0: -W / 2, z0: -3.6, x1: W / 2, z1: -2.55 }, reach: 1.9,
    ambient: { hemi: 0.78, sun: 0.28 },
  });
}

// ---------------------------------------------------------------------------------------------
// Car dealer showroom
// ---------------------------------------------------------------------------------------------
/** Three display cars from the stock: cheapest-ish, dearest (centre), upper-middle. Returns type keys. */
export function showcase(dealerId) {
  const s = stockFor(dealerId);
  if (s.length <= 3) return s.slice();
  const pick = [s[Math.floor((s.length - 1) * 0.3)], s[s.length - 1], s[Math.floor((s.length - 1) * 0.65)]];
  return [...new Set(pick)];
}

function buildDealer(game, data, ox, oz) {
  const iron = data.id === 'ironclad';
  const W = 30, D = 20, H = iron ? 5.4 : 5;
  const accent = iron ? '#ff8a1a' : '#1aa3c9', dark = iron ? '#2b2e33' : '#124a5c';
  const b = new Builder(ox, oz, W, D, H);
  const floor = b.tex(64, 64, (c) => {
    const a = iron ? '#585d64' : '#d8dde0', d = iron ? '#4d5158' : '#c4cbd0';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? a : d; c.fillRect(i * 16, j * 16, 16, 16); }
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 4; i++) { c.fillRect(i * 16, 0, 1, 64); c.fillRect(0, i * 16, 64, 1); }
  }, W / 4, D / 4);
  b.shell(floor, (c, w, h) => {
    c.fillStyle = iron ? '#8b9096' : '#eef2f4'; c.fillRect(0, 0, w, h);
    c.fillStyle = dark; c.fillRect(0, h - 28, w, 28);
    c.fillStyle = accent; c.fillRect(0, h - 36, w, 8);
    if (iron) { c.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 2, h - 36); }
  }, iron ? '#4a4d52' : '#dfe4e8');

  // windows on both side walls
  const win = b.basic(iron ? '#27414f' : '#2f6d8c');
  const frame = b.lam('#f2f2f2');
  for (const s of [-1, 1]) {
    for (const z of [-5.5, 1.5, 7.8]) {
      const wp = b.plane(4.4, 2.4, win);
      wp.rotation.y = -s * Math.PI / 2;
      b.place(wp, s * (W / 2 - 0.03), 2.1, z);
      b.box(s * (W / 2 - 0.08), 0.85, z, 0.1, 0.1, 4.6, frame);
      b.box(s * (W / 2 - 0.08), 3.25, z, 0.1, 0.1, 4.6, frame);
      b.box(s * (W / 2 - 0.08), 0.85, z - 2.2, 0.1, 2.5, 0.1, frame);
      b.box(s * (W / 2 - 0.08), 0.85, z + 2.2, 0.1, 2.5, 0.1, frame);
    }
  }
  // back wall sign + reception desk
  const plate = b.plane(11, 1.9, b.basic('#ffffff', { map: b.sign(data.name, 11, 1.9, dark, '#ffffff', accent, 74) }));
  b.place(plate, 0, 3.5, -D / 2 + 0.03);
  const deskMat = b.lam(dark);
  b.box(0, 0, -6.1, 5.2, 1.0, 1.0, deskMat, true);
  b.box(0, 1.0, -6.1, 5.4, 0.08, 1.2, b.lam(accent));
  b.box(-1.4, 1.08, -6.1, 0.45, 0.3, 0.35, b.lam('#1b1b1f'));
  b.box(1.2, 1.08, -6.0, 0.5, 0.04, 0.35, b.lam('#f5f5f0'));

  // display cars on podiums
  const keys = showcase(data.id);
  const order = keys.length === 3 ? [keys[0], keys[1], keys[2]] : keys;
  const xs = order.length === 3 ? [-10, 0, 10] : order.map((_, i) => (i - (order.length - 1) / 2) * 10);
  order.forEach((key, i) => {
    const t = VEHICLE_TYPES[key];
    const R = Math.min(3.9, Math.hypot(t.len / 2, t.wid / 2) + 0.4);
    const px = xs[i], pz = 1.2;
    const pod = new THREE.Mesh(b.keep(new THREE.CylinderGeometry(R, R + 0.15, 0.35, 28)), b.lam(accent));
    b.place(pod, px, 0.175, pz);
    const ring = new THREE.Mesh(b.keep(new THREE.RingGeometry(R - 0.12, R + 0.02, 40)), b.basic('#ffffff'));
    ring.rotation.x = -Math.PI / 2;
    b.place(ring, px, 0.36, pz);
    b.solid(px, pz, R * 2, R * 2, 2.7);
    const v = new Vehicle(game, key, ox + px, oz + pz, 0.6 + i, { color: t.colors[0] });
    v.pos.y = 0.35; v.updateMesh();
    b.group.add(v.mesh);
    b.cars.push({ v, spin: 0.35 });
    // price placard on a little stand in front of the podium
    const price = quote(game, key).price;
    const card = b.plane(1.9, 0.5, b.basic('#ffffff', { map: b.sign(`${t.name}  ${fmtMoney(price)}`, 1.9, 0.5, '#101418', '#ffe066', accent, 40) }));
    card.rotation.x = -0.45;
    b.place(card, px, 0.78, pz + R + 0.35);
    b.box(px, 0, pz + R + 0.35, 0.06, 0.55, 0.06, b.lam('#cfcfcf'));
    b.light(px, pz, H - 0.9, '#fff1d6', 14, 19);
  });

  // plants in the corners
  for (const [x, z] of [[-13.4, 8.8], [13.4, 8.8], [-13.4, -8.8], [13.4, -8.8]]) {
    b.box(x, 0, z, 0.8, 0.6, 0.8, b.lam('#7a4a2a'));
    const leaf = new THREE.Mesh(b.keep(new THREE.IcosahedronGeometry(0.75, 0)), b.lam('#2f7a2f', { flatShading: true }));
    b.place(leaf, x, 1.35, z);
    b.solid(x, z, 0.9, 0.9, 2.7);
  }
  b.door(true);
  for (const x of [-9, 0, 9]) for (const z of [-5, 4]) b.panel(x, z, 5, 0.5);
  b.light(0, -6, H - 0.8, '#ffe9c4', 9, 14);
  b.light(0, 8, H - 0.8, '#ffe9c4', 7, 14);

  return finish(b, {
    kind: 'dealer', key: 'dealer:' + data.id, name: data.name, data,
    entry: { x: 0, z: D / 2 - 1.8, yaw: Math.PI }, keeper: { x: 0, z: -7.5 },
    counter: { x0: -2.7, z0: -6.7, x1: 2.7, z1: -5.5 }, reach: 2.1,
    ambient: { hemi: iron ? 0.62 : 0.85, sun: 0.25 },
  });
}

// ---------------------------------------------------------------------------------------------
function finish(b, o) {
  const { ox, oz, W, D, H } = b;
  const room = {
    ...o, W, D, H, cx: ox, cz: oz,
    group: b.group, collision: b.col, builder: b,
    door: { x: ox, z: oz + D / 2 },
    entry: { x: ox + o.entry.x, z: oz + o.entry.z, yaw: o.entry.yaw },
    keeperPos: { x: ox + o.keeper.x, z: oz + o.keeper.z },
    counter: { x0: ox + o.counter.x0, z0: oz + o.counter.z0, x1: ox + o.counter.x1, z1: oz + o.counter.z1 },
    cars: b.cars,
    keeper: null,
    update: (dt) => b.update(dt),
    dispose() {
      if (this.group.parent) this.group.parent.remove(this.group);
      for (const g of b.garbage) if (g.dispose) g.dispose();
      b.garbage.length = 0;
    },
  };
  return room;
}

/** Build the room for 'gun' (data = city gun-shop location) or 'dealer' (data = city dealer location) at world offset (ox, oz). */
export function buildRoom(game, kind, data, ox, oz) {
  return kind === 'dealer' ? buildDealer(game, data, ox, oz) : buildGunShop(game, data, ox, oz);
}
