import * as THREE from 'three';
import { clamp, wrapAngle, rand, choice, circleAABB, dist } from '../util.js';
import { HALF } from '../world/city.js';
import { ASSETS } from '../world/assets.js';

/**
 * Vehicle catalogue. Physical size (len/wid/h) is the collision box; art models are scaled to `len`.
 * Extra fields: cls (HUD class name), price (dealer base price in $), shopOnly (never spawns as traffic or
 * parked cars - only the dealers sell it), dealer (which lot stocks it), model (Kenney Car Kit file the
 * asset loader maps to, see world/assets.js), bulletMul (bullet damage taken), ramOut (damage dealt to
 * the other car in a car-car collision), ramIn (collision damage taken, also from walls), healOnEnter,
 * cannon (rocket cannon on LMB / touch FIRE).
 */
export const VEHICLE_TYPES = {
  compact: { name: 'MINNOW', cls: 'COMPACT', model: 'hatchback-sports', price: 3500, dealer: 'harlow', len: 3.6, wid: 1.7, h: 1.3, maxSpeed: 26, accel: 9, grip: 7, turn: 2.6, hp: 90, mass: 1, colors: ['#e74c3c', '#3498db', '#f1c40f', '#ecf0f1', '#2ecc71', '#e67e22'] },
  sedan: { name: 'STALLARD', cls: 'SEDAN', model: 'sedan', price: 6000, dealer: 'harlow', len: 4.6, wid: 1.9, h: 1.4, maxSpeed: 32, accel: 10, grip: 7, turn: 2.3, hp: 110, mass: 1.2, colors: ['#7f8c8d', '#2c3e50', '#8e44ad', '#c0392b', '#bdc3c7', '#1abc9c', '#6d4c41'] },
  coupe: { name: 'MERIDIAN', cls: 'COUPE', model: 'sedan-sports', price: 14000, dealer: 'harlow', len: 4.4, wid: 1.8, h: 1.2, maxSpeed: 37, accel: 12, grip: 7.5, turn: 2.5, hp: 100, mass: 1.1, colors: ['#c0392b', '#2c3e50', '#16a085', '#ecf0f1', '#8e44ad', '#d35400'] },
  sports: { name: 'VIPER GT', cls: 'SPORTS', model: 'race', price: 30000, dealer: 'harlow', len: 4.3, wid: 1.9, h: 1.1, maxSpeed: 44, accel: 16, grip: 9, turn: 2.6, hp: 90, mass: 1.1, colors: ['#e74c3c', '#f39c12', '#2980b9', '#ffffff', '#111111'] },
  hyper: { name: 'VANTA R1', cls: 'HYPERCAR', model: 'race-future', price: 120000, shopOnly: true, dealer: 'harlow', len: 4.4, wid: 1.9, h: 1.0, maxSpeed: 58, accel: 22, grip: 11, turn: 2.7, hp: 80, mass: 1.1, colors: ['#00e5ff', '#ff2d95', '#fdd835', '#ffffff', '#111111'] },
  taxi: { name: 'TAXI', cls: 'TAXI', model: 'taxi', price: 5000, dealer: 'harlow', len: 4.6, wid: 1.9, h: 1.4, maxSpeed: 30, accel: 10, grip: 7, turn: 2.3, hp: 110, mass: 1.2, colors: ['#f1c40f'] },
  van: { name: 'BOXER VAN', cls: 'VAN', model: 'van', price: 8000, dealer: 'harlow', len: 5.0, wid: 2.1, h: 2.1, maxSpeed: 27, accel: 7, grip: 6, turn: 2.0, hp: 160, mass: 1.6, colors: ['#ecf0f1', '#95a5a6', '#2c3e50', '#d35400'], cabin: 0.75 },
  boxtruck: { name: 'PARCEL HAULER', cls: 'BOX TRUCK', model: 'delivery', price: 11000, dealer: 'ironclad', len: 6.0, wid: 2.2, h: 2.7, maxSpeed: 25, accel: 6.5, grip: 5.5, turn: 1.8, hp: 220, mass: 2.5, colors: ['#ecf0f1', '#2980b9', '#c0392b', '#7f8c8d'], cabin: 0.8 },
  flatbed: { name: 'LONGBED', cls: 'FLATBED', model: 'delivery-flat', price: 12000, dealer: 'ironclad', len: 6.0, wid: 2.2, h: 2.0, maxSpeed: 26, accel: 6.5, grip: 5.5, turn: 1.8, hp: 200, mass: 2.3, colors: ['#e67e22', '#7f8c8d', '#2c3e50', '#27ae60'], cabin: 0.5 },
  pickup: { name: 'HAULER', cls: 'PICKUP', model: 'truck', price: 9000, dealer: 'harlow', len: 5.2, wid: 2.1, h: 1.7, maxSpeed: 28, accel: 8, grip: 6, turn: 2.0, hp: 170, mass: 1.7, colors: ['#8e6e3f', '#c0392b', '#2c3e50', '#7f8c8d'] },
  suv: { name: 'TRAILBOSS', cls: 'SUV', model: 'suv', price: 16000, dealer: 'harlow', len: 4.8, wid: 2.0, h: 1.7, maxSpeed: 31, accel: 9.5, grip: 6.5, turn: 2.1, hp: 150, mass: 1.5, colors: ['#2c3e50', '#7f8c8d', '#c0392b', '#ecf0f1', '#27ae60', '#d35400'] },
  limo: { name: 'CINELLI LIMO', cls: 'LIMO', model: 'suv-luxury', price: 40000, dealer: 'harlow', len: 6.2, wid: 1.9, h: 1.4, maxSpeed: 34, accel: 9, grip: 7, turn: 1.9, hp: 160, mass: 1.8, colors: ['#111111'] },
  bus: { name: 'HARLOW TRANSIT', cls: 'BUS', model: null, price: 25000, dealer: 'ironclad', len: 10, wid: 2.4, h: 3, maxSpeed: 22, accel: 5, grip: 5, turn: 1.6, hp: 320, mass: 4, colors: ['#e67e22'], cabin: 0.9 },
  police: { name: 'HPD CRUISER', cls: 'POLICE', model: 'police', price: 18000, dealer: 'ironclad', len: 4.7, wid: 1.9, h: 1.4, maxSpeed: 38, accel: 13, grip: 8, turn: 2.5, hp: 130, mass: 1.3, colors: ['#ffffff'] },
  ambulance: { name: 'HARLOW EMS', cls: 'AMBULANCE', model: 'ambulance', price: 15000, shopOnly: true, dealer: 'ironclad', healOnEnter: true, len: 5.6, wid: 2.1, h: 2.4, maxSpeed: 33, accel: 10, grip: 6.5, turn: 2.0, hp: 200, mass: 2.2, colors: ['#ffffff'] },
  firetruck: { name: 'ENGINE 9', cls: 'FIRE TRUCK', model: 'firetruck', price: 45000, shopOnly: true, dealer: 'ironclad', len: 7.4, wid: 2.5, h: 3.0, maxSpeed: 24, accel: 6, grip: 5.5, turn: 1.6, hp: 500, mass: 5, colors: ['#d62828'] },
  garbage: { name: 'DUMPSTER KING', cls: 'GARBAGE', model: 'garbage-truck', price: 30000, shopOnly: true, dealer: 'ironclad', ramOut: 3, len: 7.0, wid: 2.4, h: 2.8, maxSpeed: 21, accel: 5, grip: 5, turn: 1.5, hp: 450, mass: 5, colors: ['#2e7d32', '#546e7a'] },
  tractor: { name: 'FIELD MULE', cls: 'TRACTOR', model: 'tractor', price: 4000, shopOnly: true, dealer: 'ironclad', len: 3.6, wid: 1.9, h: 2.2, maxSpeed: 11, accel: 4, grip: 6, turn: 1.9, hp: 120, mass: 2, colors: ['#43a047', '#e53935', '#fb8c00', '#1e88e5'] },
  kart: { name: 'SPRITE KART', cls: 'GO-KART', model: 'kart-*', price: 2500, shopOnly: true, dealer: 'ironclad', len: 2.4, wid: 1.4, h: 0.9, maxSpeed: 30, accel: 14, grip: 9, turn: 3.2, hp: 40, mass: 0.5, colors: ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ab47bc'] },
  armoured: { name: 'BASTION', cls: 'ARMOURED', model: 'suv-luxury', price: 60000, shopOnly: true, dealer: 'ironclad', bulletMul: 0.15, len: 5.2, wid: 2.1, h: 1.7, maxSpeed: 33, accel: 9, grip: 6.5, turn: 1.9, hp: 700, mass: 3, colors: ['#15171a'] },
  tank: { name: 'JUGGERNAUT', cls: 'TANK', model: null, price: 250000, shopOnly: true, dealer: 'ironclad', procedural: true, cannon: true, bulletMul: 0, ramOut: 10, ramIn: 0, len: 7.0, wid: 3.0, h: 2.1, maxSpeed: 16, accel: 6, grip: 8, turn: 1.5, hp: 3000, mass: 12, colors: ['#4b5320', '#3d4a2a', '#5a5a48'] },
};
/** Normal traffic and parked cars (never shopOnly types). */
export const TRAFFIC_TYPES = ['compact', 'compact', 'sedan', 'sedan', 'sedan', 'coupe', 'sports', 'taxi', 'taxi', 'van', 'pickup', 'suv', 'suv', 'boxtruck', 'flatbed', 'bus'];
/** HUD line for a type: "NAME · CLASS" (the class is dropped when it repeats the name). */
export const vehicleLabel = (type) => (type.cls && type.cls !== type.name ? `${type.name} · ${type.cls}` : type.name);
export const CANNON_COOLDOWN = 1.5;

const _tmp = { x: 0, z: 0 };
const DAMAGE_COLOR = new THREE.Color('#2a2a2a');

export class Vehicle {
  constructor(game, typeKey, x, z, yaw = 0, opts = {}) {
    this.game = game;
    this.typeKey = typeKey;
    this.type = VEHICLE_TYPES[typeKey];
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = yaw;
    this.vx = 0; this.vz = 0;
    this.speed = 0;
    this.hp = this.type.hp;
    this.wrecked = false;
    this.wreckTime = 0;
    this.controller = opts.controller || 'none';
    this.hasDriver = !!opts.hasDriver;
    this.driverKind = opts.driverKind || 'civ';
    this.driver = null;             // player when the player drives
    this.mission = !!opts.mission;
    this.marked = !!opts.marked;
    this.controls = { throttle: 0, steer: 0, brake: false, handbrake: false };
    this.route = [];
    this.routeEnd = null;
    this.leader = null;
    this.stuckT = 0; this.reverseT = 0;
    this.smokeT = 0;
    this.lightT = 0;
    this.sirenOn = false;
    this.deployed = false;
    this.lastHitT = 0;
    this.nodeA = null; this.nodeB = null;
    this.owned = !!opts.owned;      // bought at a dealer: never despawned, saved with the game
    this.cannonT = 0;               // tank cannon cooldown (s)
    this.color = opts.color || choice(this.type.colors);
    this.buildMesh(this.color);
    this.updateMesh();
  }

  /** Loaded (Kenney) model if one exists for this type; returns false to use the procedural box car. */
  buildAssetMesh(color) {
    const t = this.type;
    const car = ASSETS.makeCar(this.typeKey, t.len, color);
    if (!car) return false;
    const g = car.group;
    const M = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c }));
    this.bodyMat = car.bodyMat || new THREE.MeshLambertMaterial({ color });
    this.wheels = car.wheels;
    const top = car.height;
    if (this.typeKey === 'taxi' && !/taxi/i.test(car.file)) { const s = M(0.9, 0.25, 0.4, '#f1c40f'); s.position.y = top + 0.12; g.add(s); }
    if (this.typeKey === 'police') {
      this.lightR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.35), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
      this.lightB = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.35), new THREE.MeshBasicMaterial({ color: '#2060ff' }));
      this.lightR.position.set(-0.3, top + 0.08, 0); this.lightB.position.set(0.3, top + 0.08, 0);
      g.add(this.lightR); g.add(this.lightB);
    }
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(t.wid + 0.7, t.len + 0.7), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.025; g.add(sh);
    this.mesh = g;
    return true;
  }

  buildMesh(color) {
    this.bodyBase = new THREE.Color(color);
    this.dmgApplied = null;
    if (this.typeKey === 'tank') { this.buildTank(color); return; }   // always procedural
    if (this.buildAssetMesh(color)) return;
    const t = this.type, g = new THREE.Group();
    const M = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c }));
    this.bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(t.wid, t.h * 0.5, t.len), this.bodyMat);
    body.position.y = 0.3 + t.h * 0.25;
    g.add(body);
    const cab = t.cabin || 0.5;
    const cabinH = t.h * 0.5;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.wid * 0.86, cabinH, t.len * cab), new THREE.MeshLambertMaterial({ color: '#1f2a36' }));
    cabin.position.set(0, 0.3 + t.h * 0.5 + cabinH / 2, -t.len * (0.5 - cab / 2) * 0.35);
    g.add(cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.32, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: '#111' });
    this.wheels = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * t.wid / 2, 0.34, sz * t.len * 0.33);
      g.add(w); this.wheels.push(w);
    }
    for (const sx of [-1, 1]) {
      const hl = M(0.3, 0.2, 0.1, '#fff6c0'); hl.position.set(sx * t.wid * 0.35, 0.3 + t.h * 0.3, t.len / 2 + 0.02); g.add(hl);
      const tl = M(0.3, 0.2, 0.1, '#ff2a2a'); tl.position.set(sx * t.wid * 0.35, 0.3 + t.h * 0.3, -t.len / 2 - 0.02); g.add(tl);
    }
    if (this.typeKey === 'taxi') { const s = M(0.9, 0.25, 0.4, '#f1c40f'); s.position.y = 0.3 + t.h + 0.15; g.add(s); }
    if (this.typeKey === 'police') {
      const stripe = M(t.wid + 0.02, t.h * 0.2, t.len * 0.5, '#111'); stripe.position.y = 0.3 + t.h * 0.25; g.add(stripe);
      this.lightR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
      this.lightB = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: '#2060ff' }));
      this.lightR.position.set(-0.4, 0.3 + t.h + 0.15, 0); this.lightB.position.set(0.4, 0.3 + t.h + 0.15, 0);
      g.add(this.lightR); g.add(this.lightB);
    }
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(t.wid + 0.7, t.len + 0.7), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.025; g.add(sh);
    this.mesh = g;
  }

  /** Procedural tank: tracks, hull, turret and a long barrel. The turret turns with the hull. */
  buildTank(color) {
    const t = this.type, g = new THREE.Group();
    const M = (w, h, d, c, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshLambertMaterial({ color: c }));
    this.bodyMat = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: '#23251f' });
    for (const sx of [-1, 1]) {
      const tr = M(0.85, 0.95, t.len, null, dark); tr.position.set(sx * (t.wid / 2 - 0.45), 0.5, 0); g.add(tr);
      for (let i = 0; i < 5; i++) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 10), new THREE.MeshLambertMaterial({ color: '#3a3d33' }));
        w.rotation.z = Math.PI / 2; w.position.set(sx * (t.wid / 2 - 0.45), 0.48, -t.len * 0.38 + i * (t.len * 0.76 / 4)); g.add(w);
      }
    }
    const hull = M(t.wid - 1.3, 0.85, t.len - 0.5, null, this.bodyMat); hull.position.set(0, 1.05, 0); g.add(hull);
    const glacis = M(t.wid - 1.3, 0.6, 1.6, null, this.bodyMat); glacis.position.set(0, 1.2, t.len / 2 - 0.55); glacis.rotation.x = 0.45; g.add(glacis);
    const turret = new THREE.Group(); turret.position.set(0, 1.5, -0.4); g.add(turret);
    const tb = M(2.1, 0.85, 2.5, null, this.bodyMat); tb.position.set(0, 0.42, 0); turret.add(tb);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 10), dark); hatch.position.set(-0.45, 0.95, -0.4); turret.add(hatch);
    const mantlet = M(0.7, 0.55, 0.5, null, dark); mantlet.position.set(0, 0.5, 1.35); turret.add(mantlet);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 4.4, 8), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.5, 3.4); turret.add(barrel);
    const brake = M(0.36, 0.5, 0.36, null, dark); brake.position.set(0, 2.1, 0); barrel.add(brake);   // barrel is rotated: local y runs along the barrel
    this.turret = turret; this.barrel = barrel; this.barrelZ = 3.4;
    this.muzzleDist = t.len / 2 + 1.75;   // barrel tip, from the hull centre
    this.wheels = [];
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(t.wid + 0.7, t.len + 0.7), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.025; g.add(sh);
    this.mesh = g;
  }

  /** Tank cannon: one rocket from the barrel tip along the hull heading. Returns true when it fired. */
  fireCannon() {
    if (!this.type.cannon || this.wrecked || this.cannonT > 0) return false;
    const g = this.game, f = this.forward;
    this.cannonT = CANNON_COOLDOWN;
    const from = new THREE.Vector3(this.pos.x + f.x * this.muzzleDist, 1.45, this.pos.z + f.z * this.muzzleDist);
    const owner = this.driver === g.player ? g.player.ped : null;
    g.combat.fire(owner, from, new THREE.Vector3(f.x, 0, f.z).normalize(), 'rocket');
    // big muzzle blast: flash, sparks and a smoke puff; the hull rocks back a little
    g.effects.flash(from.x, from.y, from.z, '#ffb347', 14, 0.14);
    g.effects.burst(from.x, from.y, from.z, 16, 9, '#ffcf66', 0.22, 0.2, { grav: 4 });
    for (let i = 0; i < 4; i++) g.effects.smoke(from.x + f.x * i * 0.5, from.y, from.z + f.z * i * 0.5);
    this.vx -= f.x * 1.2; this.vz -= f.z * 1.2;
    g.shake = Math.max(g.shake, 0.3);
    return true;
  }

  updateMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }
  get forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  get right() { return { x: -Math.cos(this.yaw), z: Math.sin(this.yaw) }; }
  get speedAbs() { return Math.hypot(this.vx, this.vz); }
  /** Collision circles along the body. */
  circles() {
    const t = this.type, r = t.wid / 2, n = Math.max(2, Math.ceil(t.len / t.wid));
    const f = this.forward, out = [];
    const span = t.len - t.wid;
    for (let i = 0; i < n; i++) {
      const d = -span / 2 + (span * i) / (n - 1);
      out.push({ x: this.pos.x + f.x * d, z: this.pos.z + f.z * d, r });
    }
    return out;
  }
  containsPoint(x, z, pad = 0) {
    const t = this.type, f = this.forward, r = this.right;
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const a = dx * f.x + dz * f.z, b = dx * r.x + dz * r.z;
    return Math.abs(a) <= t.len / 2 + pad && Math.abs(b) <= t.wid / 2 + pad;
  }

  // ---- AI -------------------------------------------------------------
  /** Start following lanes from intersection a toward b. */
  initTraffic(a, b, t = 0.3) {
    const city = this.game.city;
    this.nodeA = a; this.nodeB = b;
    const s = city.laneStart(a, b), e = city.laneEnd(a, b);
    this.pos.x = s.x + (e.x - s.x) * t; this.pos.z = s.z + (e.z - s.z) * t;
    this.yaw = Math.atan2(e.x - s.x, e.z - s.z);
    this.route = [{ x: e.x, z: e.z, limit: 13 }];
    this.controller = 'npc';
    this.hasDriver = true;
    this.extendRoute();
  }
  extendRoute() {
    const city = this.game.city;
    while (this.route.length < 3) {
      const a = this.nodeA, b = this.nodeB;
      let opts = city.neighbors(b[0], b[1]).filter((n) => !(n[0] === a[0] && n[1] === a[1]));
      if (!opts.length) opts = [a];
      const c = choice(opts);
      const d1x = Math.sign(b[0] - a[0]), d1z = Math.sign(b[1] - a[1]);
      const d2x = Math.sign(c[0] - b[0]), d2z = Math.sign(c[1] - b[1]);
      const turning = d1x !== d2x || d1z !== d2z;
      if (turning && this.route.length) this.route[this.route.length - 1].limit = 6.5;
      const s = city.laneStart(b, c), e = city.laneEnd(b, c);
      this.route.push({ x: s.x, z: s.z, limit: turning ? 8 : 13 }, { x: e.x, z: e.z, limit: 13 });
      this.nodeA = b; this.nodeB = c;
    }
  }
  /** Convert any car into lane-following traffic from its current position. */
  becomeTraffic() {
    const city = this.game.city;
    const n = city.nearestInter(this.pos.x, this.pos.z);
    const f = this.forward;
    // pick the neighbour most aligned with our heading
    let best = null, bd = -2;
    for (const nb of city.neighbors(n[0], n[1])) {
      const dx = Math.sign(nb[0] - n[0]), dz = Math.sign(nb[1] - n[1]);
      const d = dx * f.x + dz * f.z;
      if (d > bd) { bd = d; best = nb; }
    }
    this.nodeA = n; this.nodeB = best;
    const e = city.laneEnd(n, best);
    this.route = [{ x: e.x, z: e.z, limit: 13 }];
    this.extendRoute();
    this.controller = 'npc';
    this.sirenOn = false;
  }
  /** Set an explicit route through intersections [[i,j],...]; calls routeEnd when finished. */
  setRoute(nodes, limit = 16) {
    const city = this.game.city;
    this.route = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const s = city.laneStart(nodes[i], nodes[i + 1]), e = city.laneEnd(nodes[i], nodes[i + 1]);
      if (i === 0) { this.pos.x = s.x; this.pos.z = s.z; this.yaw = Math.atan2(e.x - s.x, e.z - s.z); }
      this.route.push({ x: s.x, z: s.z, limit: limit * 0.6 }, { x: e.x, z: e.z, limit });
    }
    this.controller = 'route';
    this.hasDriver = true;
  }

  seek(tx, tz, limit, dt, avoid = false) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const ang = wrapAngle(Math.atan2(dx, dz) - this.yaw);
    const d = Math.hypot(dx, dz);
    let steer = clamp(ang * 2.2, -1, 1);
    let throttle = 1;
    const sp = this.speed;
    if (Math.abs(ang) > 1.2 && sp > 6) throttle = -0.5;
    if (sp > limit) throttle = sp > limit + 3 ? -0.4 : 0;
    if (avoid) {
      const f = this.forward, look = 7 + Math.abs(sp) * 0.5;
      const probe = (a) => {
        const s = Math.sin(this.yaw + a), c = Math.cos(this.yaw + a);
        return this.game.city.raycast(this.pos.x, this.pos.z, this.pos.x + s * look, this.pos.z + c * look, 1);
      };
      const c0 = probe(0), cl = probe(0.5), cr = probe(-0.5);
      if (c0 !== null) {
        if (cl === null && cr !== null) steer = 1;
        else if (cr === null && cl !== null) steer = -1;
        else if (cl === null && cr === null) steer = steer >= 0 ? 1 : -1;
        else { steer = this.reverseT > 0 ? -steer : steer; throttle = 0.3; }
        if (c0 < 0.35 && sp > 4) throttle = -0.6;
      }
      void f;
    }
    if (this.reverseT > 0) { this.reverseT -= dt; throttle = -1; steer = -steer; }
    else if (Math.abs(sp) < 0.6 && d > 4) { this.stuckT += dt; if (this.stuckT > 1.5) { this.reverseT = 1.1; this.stuckT = 0; } }
    else this.stuckT = 0;
    this.controls.throttle = throttle;
    this.controls.steer = steer;
    this.controls.brake = false;
    this.controls.handbrake = false;
    return d;
  }

  blockedAhead() {
    const f = this.forward, r = this.right, g = this.game;
    const look = this.type.len / 2 + 5 + Math.abs(this.speed) * 0.6;
    for (const v of g.vehicles) {
      if (v === this) continue;
      const dx = v.pos.x - this.pos.x, dz = v.pos.z - this.pos.z;
      const a = dx * f.x + dz * f.z, b = dx * r.x + dz * r.z;
      if (a > 0 && a < look + v.type.len / 2 && Math.abs(b) < 2.4) return true;
    }
    for (const p of g.peds) {
      if (p.dead) continue;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      const a = dx * f.x + dz * f.z, b = dx * r.x + dz * r.z;
      if (a > 0 && a < this.type.len / 2 + 4.5 && Math.abs(b) < 1.5) return true;
    }
    const pl = g.player;
    if (!pl.vehicle && !pl.dead) {
      const dx = pl.ped.pos.x - this.pos.x, dz = pl.ped.pos.z - this.pos.z;
      const a = dx * f.x + dz * f.z, b = dx * r.x + dz * r.z;
      if (a > 0 && a < this.type.len / 2 + 5 && Math.abs(b) < 1.6) return true;
    }
    return false;
  }

  updateNpc(dt) {
    if (!this.route.length) this.extendRoute();
    const w = this.route[0];
    const d = this.seek(w.x, w.z, Math.min(w.limit, this.type.maxSpeed * 0.55), dt);
    if (d < 3) { this.route.shift(); this.extendRoute(); }
    if (this.blockedAhead()) { this.controls.throttle = this.speed > 0.5 ? -1 : 0; }
  }
  updateRoute(dt) {
    if (!this.route.length) { this.controller = 'none'; if (this.routeEnd) this.routeEnd(this); return; }
    const w = this.route[0];
    const d = this.seek(w.x, w.z, w.limit, dt);
    if (d < 3.5) this.route.shift();
  }
  updateFollow(dt) {
    const l = this.leader;
    if (!l || l.wrecked) { this.becomeTraffic(); return; }
    const f = l.forward;
    const tx = l.pos.x - f.x * 9, tz = l.pos.z - f.z * 9;
    const d = dist(tx, tz, this.pos.x, this.pos.z);
    this.seek(tx, tz, d > 12 ? l.type.maxSpeed : Math.abs(l.speed) + (d - 2), dt, true);
    if (d < 3) { this.controls.throttle = this.speed > l.speed ? -0.5 : 0; }
  }
  /**
   * 'chase' controller: seek and ram this.chaseTarget (a Vehicle, a Ped, or the Player: anything with `pos` or `worldPos()`).
   * Target wrecked/removed -> becomes traffic. Hurt below 30% hp, or parked up next to a target on foot: the driver bails
   * out and fights (a gang ped of this.chaseGang with this.chaseWeapon, alerted), reported through this.onBail(ped).
   */
  updateChase(dt) {
    const t = this.chaseTarget, g = this.game;
    const tp = t && (t.worldPos ? t.worldPos() : t.pos);
    if (!tp || t.wrecked || t.removed) { this.becomeTraffic(); return; }
    if (t.dead) { this.controls.throttle = 0; this.controls.steer = 0; this.controls.brake = true; return; }
    const ts = t.speedAbs !== undefined ? t.speedAbs : (t.vehicle ? t.vehicle.speedAbs : 0); // close in, but keep the ram speed survivable
    const d = this.seek(tp.x, tp.z, Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) < 45 ? Math.min(this.type.maxSpeed, ts + 12) : this.type.maxSpeed, dt, true);
    const onFoot = t.vehicle === null; // Ped / Player on foot (a Vehicle target has no `vehicle` field)
    if (this.hp < this.type.hp * 0.3 || (onFoot && d < 9 && Math.abs(this.speed) < 3)) {
      this.hasDriver = false; this.controller = 'none';
      const r = this.right, side = -(this.type.wid / 2 + 0.9);
      const p = g.spawnPed('gang', this.pos.x + r.x * side, this.pos.z + r.z * side, { gang: this.chaseGang || null, weapon: this.chaseWeapon || 'pistol', alerted: true, mission: this.mission, alertRange: 60 });
      if (this.onBail) this.onBail(p);
    }
  }
  updatePolice(dt) {
    const g = this.game, pl = g.player;
    this.sirenOn = true;
    const tp = pl.worldPos();
    const d = dist(tp.x, tp.z, this.pos.x, this.pos.z);
    if (pl.vehicle) {
      // ram
      this.seek(tp.x, tp.z, this.type.maxSpeed, dt, true);
    } else {
      if (d < 16 && Math.abs(this.speed) < 3) { this.deploy(); return; }
      this.seek(tp.x, tp.z, d < 30 ? 7 : this.type.maxSpeed, dt, true);
      if (d < 10) { this.controls.throttle = this.speed > 1 ? -1 : 0; this.controls.brake = true; }
    }
  }
  deploy() {
    this.deployed = true;
    this.controller = 'none';
    this.hasDriver = false;
    this.sirenOn = false;
    const r = this.right;
    for (const s of [-1, 1]) {
      const x = this.pos.x + r.x * s * (this.type.wid / 2 + 0.8), z = this.pos.z + r.z * s * (this.type.wid / 2 + 0.8);
      const cop = this.game.spawnPed('cop', x, z, { angry: true });
      this.game.wanted.cops.push(cop);
    }
  }

  // ---- physics ---------------------------------------------------------
  update(dt) {
    const g = this.game;
    if (this.wrecked) {
      this.wreckTime += dt;
      this.smokeT -= dt;
      if (this.smokeT <= 0 && this.wreckTime < 25) { this.smokeT = 0.12; g.effects.smoke(this.pos.x, 1.2, this.pos.z, true); }
      const k = Math.exp(-3 * dt);
      this.vx *= k; this.vz *= k;
      this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
      this.speed = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
      this.updateMesh();
      return;
    }
    this.updateDamageTint();
    if (this.cannonT > 0) {
      this.cannonT = Math.max(0, this.cannonT - dt);
      if (this.barrel) {   // recoil: snaps back, then creeps forward again
        const e = CANNON_COOLDOWN - this.cannonT, r = e < 0.1 ? e / 0.1 : Math.max(0, 1 - (e - 0.1) / 0.7);
        this.barrel.position.z = this.barrelZ - 0.8 * r;
      }
    }
    if (this.hp < this.type.hp * 0.35) { this.smokeT -= dt; if (this.smokeT <= 0) { this.smokeT = 0.25; const f = this.forward; g.effects.smoke(this.pos.x + f.x * this.type.len * 0.4, 1, this.pos.z + f.z * this.type.len * 0.4); } }

    switch (this.controller) {
      case 'npc': this.updateNpc(dt); break;
      case 'route': this.updateRoute(dt); break;
      case 'police': this.updatePolice(dt); break;
      case 'follow': this.updateFollow(dt); break;
      case 'chase': this.updateChase(dt); break;
      case 'player': break; // controls set by the drive mode
      default: this.controls.throttle = 0; this.controls.steer = 0; this.controls.brake = true; this.controls.handbrake = false;
    }
    const t = this.type, c = this.controls;
    const f = this.forward, r = this.right;
    let vf = this.vx * f.x + this.vz * f.z;
    let vr = this.vx * r.x + this.vz * r.z;
    // throttle / brake
    if (c.throttle > 0) vf += t.accel * c.throttle * dt;
    else if (c.throttle < 0) {
      if (vf > 0.5) vf -= 22 * dt;                // braking
      else vf = Math.max(vf - t.accel * 0.6 * dt, -t.maxSpeed * 0.3); // reverse
    } else {
      // engine braking
      const k = Math.exp(-0.9 * dt);
      vf *= k;
    }
    if (c.brake && Math.abs(vf) < 0.6) vf = 0;
    if (c.handbrake) { vf *= Math.exp(-1.4 * dt); }
    // drag
    vf *= Math.exp(-0.12 * dt);
    const turbo = this.driver === this.game.player && this.game.cheats && this.game.cheats.on.turbo ? 1.8 : 1;
    vf = clamp(vf, -t.maxSpeed * 0.35, t.maxSpeed * turbo);
    // lateral grip
    vr *= Math.exp(-(c.handbrake ? 1.4 : t.grip) * dt);
    // steering
    const sf = clamp(Math.abs(vf) / 7, 0, 1) * (1 - 0.45 * clamp(Math.abs(vf) / t.maxSpeed, 0, 1));
    this.yaw += c.steer * t.turn * sf * dt * Math.sign(vf || 1);
    const f2 = this.forward, r2 = this.right;
    this.vx = f2.x * vf + r2.x * vr;
    this.vz = f2.z * vf + r2.z * vr;
    this.speed = vf;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.collideWorld();
    // wheels spin
    const spin = vf * dt / 0.34;
    for (const w of this.wheels) w.rotation[w.userData.ax || 'x'] += spin * (w.userData.sg || 1);
    // police lights
    if (this.lightR) {
      this.lightT += dt * 8;
      const on = Math.floor(this.lightT) % 2 === 0;
      this.lightR.material.color.set(on ? '#ff2020' : '#500000');
      this.lightB.material.color.set(on ? '#101040' : '#3070ff');
    }
    this.lastHitT += dt;
    this.updateMesh();
  }

  collideWorld() {
    const city = this.game.city;
    const cs = this.circles();
    const boxes = city.query(this.pos.x, this.pos.z, this.type.len / 2 + 1);
    let hitN = { x: 0, z: 0 }, hit = false;
    for (const c of cs) {
      for (const b of boxes) {
        const p = circleAABB(c.x, c.z, c.r, b);
        if (p) { this.pos.x += p.px; this.pos.z += p.pz; c.x += p.px; c.z += p.pz; hitN.x += p.px; hitN.z += p.pz; hit = true; }
      }
    }
    // world bounds
    const h = HALF - 1;
    if (this.pos.x < -h) { this.pos.x = -h; hitN.x += 1; hit = true; } else if (this.pos.x > h) { this.pos.x = h; hitN.x -= 1; hit = true; }
    if (this.pos.z < -h) { this.pos.z = -h; hitN.z += 1; hit = true; } else if (this.pos.z > h) { this.pos.z = h; hitN.z -= 1; hit = true; }
    if (hit) {
      const l = Math.hypot(hitN.x, hitN.z);
      if (l > 1e-6) {
        const nx = hitN.x / l, nz = hitN.z / l;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= nx * vn * 1.25; this.vz -= nz * vn * 1.25;
          const impact = -vn;
          if (impact > 5) {
            this.damage(impact * 1.6 * (this.type.ramIn ?? 1), null);
            if (this.lastHitT > 0.3) {
              this.lastHitT = 0;
              const pl = this.game.player.worldPos();
              this.game.audio.carHit(impact, dist(pl.x, pl.z, this.pos.x, this.pos.z));
              this.game.effects.spark(this.pos.x + nx * -1, 0.8, this.pos.z + nz * -1);
              if (this.controller === 'npc' && impact > 9) this.abandon();
            }
          }
        }
      }
    }
  }

  /** Paintwork darkens toward #2a2a2a below 60% hp (all models); respray / external colour changes are respected. */
  updateDamageTint() {
    const m = this.bodyMat;
    if (!m) return;
    if (this.dmgApplied && !m.color.equals(this.dmgApplied)) { this.bodyBase.copy(m.color); this.dmgApplied = null; }
    const frac = this.hp / this.type.hp;
    const k = frac < 0.6 ? clamp((0.6 - frac) / 0.6, 0, 1) * 0.75 : 0;
    if (k === 0 && !this.dmgApplied) return;
    const key = Math.round(k * 20) / 20;
    if (this.dmgKey === key && this.dmgApplied) return;
    this.dmgKey = key;
    if (key === 0) { m.color.copy(this.bodyBase); this.dmgApplied = null; return; }
    m.color.copy(this.bodyBase).lerp(DAMAGE_COLOR, key);
    this.dmgApplied = m.color.clone();
  }

  /** NPC driver bails out and runs. */
  abandon() {
    if (!this.hasDriver || this.controller === 'player') return;
    this.hasDriver = false;
    const wasCop = this.driverKind === 'cop';
    this.controller = 'none';
    this.sirenOn = false;
    const r = this.right;
    const x = this.pos.x + r.x * -(this.type.wid / 2 + 0.9), z = this.pos.z + r.z * -(this.type.wid / 2 + 0.9);
    if (wasCop) {
      const cop = this.game.spawnPed('cop', x, z, { angry: true });
      this.game.wanted.cops.push(cop);
    } else {
      const p = this.game.spawnPed('civ', x, z);
      p.panic = 8; p.threat = { x: this.pos.x, z: this.pos.z };
    }
  }

  /** kind 'bullet' applies the type's bulletMul (armoured SUV 0.15, tank 0). */
  damage(n, src, kind) {
    if (this.wrecked) return;
    if (kind === 'bullet') n *= this.type.bulletMul ?? 1;
    if (n <= 0) return;
    if (this.driver === this.game.player) n *= this.game.diff.vehicleDamage;
    this.hp -= n;
    if (this.hp <= 0) this.explode(src);
  }
  explode(src) {
    if (this.wrecked) return;
    this.wrecked = true;
    this.hp = 0;
    this.bodyMat.color.set('#1c1c1c');
    this.sirenOn = false;
    const g = this.game;
    if (this.driver === g.player) { g.player.damage(1000, src); }
    else if (this.hasDriver) { this.hasDriver = false; }
    this.controller = 'none';
    g.explode(this.pos.x, 1, this.pos.z, 7, 110, src, this);
    if (src === g.player.ped || src === g.player) g.onVehicleDestroyed(this);
  }
}

/** Circle-circle collision between two vehicles with mass-weighted separation and impulse. */
export function collideVehicles(a, b) {
  if (dist(a.pos.x, a.pos.z, b.pos.x, b.pos.z) > (a.type.len + b.type.len) / 2 + 1) return;
  const ca = a.circles(), cb = b.circles();
  const ma = a.type.mass, mb = b.type.mass, mt = ma + mb;
  for (const p of ca) for (const q of cb) {
    const dx = q.x - p.x, dz = q.z - p.z;
    const d = Math.hypot(dx, dz), rr = p.r + q.r;
    if (d >= rr || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d, pen = rr - d;
    a.pos.x -= nx * pen * (mb / mt); a.pos.z -= nz * pen * (mb / mt);
    b.pos.x += nx * pen * (ma / mt); b.pos.z += nz * pen * (ma / mt);
    const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      const j = -(1 + 0.3) * vn / (1 / ma + 1 / mb);
      a.vx -= j * nx / ma; a.vz -= j * nz / ma;
      b.vx += j * nx / mb; b.vz += j * nz / mb;
      const impact = -vn;
      if (impact > 3) {
        const g = a.game;
        const srcA = a.driver === g.player ? g.player.ped : null, srcB = b.driver === g.player ? g.player.ped : null;
        // ramIn: damage a type takes from rams (tank 0); ramOut: damage it deals (garbage truck x3, tank x10)
        const ka = (a.type.ramIn ?? 1) * (b.type.ramOut || 1), kb = (b.type.ramIn ?? 1) * (a.type.ramOut || 1);
        a.damage(impact * 1.2 * (mb / ma) * ka, srcB);
        b.damage(impact * 1.2 * (ma / mb) * kb, srcA);
        if (a.lastHitT > 0.3 || b.lastHitT > 0.3) {
          a.lastHitT = 0; b.lastHitT = 0;
          const pl = g.player.worldPos();
          g.audio.carHit(impact, dist(pl.x, pl.z, a.pos.x, a.pos.z));
          g.effects.spark(p.x + nx * p.r, 0.8, p.z + nz * p.r);
          if (impact > 7) { if (a.controller === 'npc') a.abandon(); if (b.controller === 'npc') b.abandon(); }
          if (impact > 4) g.onVehicleBump(a, b);
        }
      }
    }
    return; // one contact per pair per frame is enough
  }
}
