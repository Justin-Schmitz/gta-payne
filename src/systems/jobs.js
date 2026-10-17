import * as THREE from 'three';
import { dist, rand, choice, fmtMoney } from '../util.js';
import { BLOCKS, HALF, ROAD, P, curb, inter } from '../world/city.js';
import { GANGS, GANG_IDS, gangAtXZ } from '../data/gangs.js';
import { CONTACTS, JOB_LINES, LANDMARKS, HOSPITAL, VEHICLE_JOBS, FARE_CFG, VIGILANTE, EVENTS, CONTACT_REPEAT } from '../data/jobs.js';

/**
 * Jobs beyond the phone: street contacts (named peds with a "!"), vehicle jobs (taxi fares, vigilante,
 * paramedic), and random street events. One job at a time: `game.jobs.current` makes game.isBusy() true,
 * so no phone rings and nothing else starts meanwhile. Kill frenzies and races live in activities.js.
 * Every job removes what it spawned and clears the HUD objective / timer when it ends.
 */

// ---- save helpers (used by game.js getSaveState / applySaveState / saveGame / loadSave) -------------
/** jobsDone {id: times}, frenzies [ids], raceBest {id: seconds} from a save object; always well-formed. */
export function jobSaveFields(save) {
  const s = save || {};
  return { jobsDone: { ...(s.jobsDone || {}) }, frenzies: Array.isArray(s.frenzies) ? [...s.frenzies] : [], raceBest: { ...(s.raceBest || {}) } };
}
/** Copy (defensively) jobsDone / frenzies / raceBest from a loaded snapshot onto game.save. */
export function applyJobSave(save, s) {
  const src = s && typeof s === 'object' ? s : {};
  save.jobsDone = {}; save.frenzies = []; save.raceBest = {};
  if (src.jobsDone && typeof src.jobsDone === 'object' && !Array.isArray(src.jobsDone)) {
    for (const [k, v] of Object.entries(src.jobsDone)) if (typeof v === 'number' && isFinite(v) && v >= 0) save.jobsDone[String(k).slice(0, 40)] = Math.floor(v);
  }
  if (Array.isArray(src.frenzies)) for (const f of src.frenzies.slice(0, 64)) if (typeof f === 'string') save.frenzies.push(f.slice(0, 40));
  if (src.raceBest && typeof src.raceBest === 'object' && !Array.isArray(src.raceBest)) {
    for (const [k, v] of Object.entries(src.raceBest)) if (typeof v === 'number' && isFinite(v) && v > 0) save.raceBest[String(k).slice(0, 40)] = v;
  }
}

// ---- shared helpers (also used by activities.js) ---------------------------------------------------
/** Pulsing ring on the ground at the target plus an arrow over the player pointing to it. */
export class Beacon {
  constructor(scene, color = '#ffe066') {
    this.ring = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.4, 18, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    const cone = new THREE.ConeGeometry(0.5, 1.4, 4);
    cone.rotateX(Math.PI / 2);
    this.arrow = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color }));
    this.ring.visible = false; this.arrow.visible = false;
    scene.add(this.ring); scene.add(this.arrow);
  }
  show(g, x, z, o = {}) {
    const pp = g.player.worldPos(), d = dist(x, z, pp.x, pp.z);
    const r = (o.r || 4) / 3, s = r * (1 + Math.sin(performance.now() * 0.005) * 0.08);
    this.ring.visible = o.ring !== false;
    this.ring.position.set(x, 1.2, z);
    this.ring.scale.set(s, 1, s);
    this.arrow.visible = o.arrow !== false && d > 6;
    this.arrow.position.set(pp.x, g.player.vehicle ? 4.1 : 3.2, pp.z);
    this.arrow.rotation.y = Math.atan2(x - pp.x, z - pp.z);
  }
  hide() { this.ring.visible = false; this.arrow.visible = false; }
}

/** Random sidewalk spot (on a block edge) at least minD and at most maxD metres from the player, or null. */
export function curbSpot(g, minD, maxD) {
  const p = g.player.worldPos(), R = Math.ceil(maxD / P) + 1;
  const bi = (v) => Math.max(0, Math.min(BLOCKS - 1, Math.floor((v + HALF - ROAD) / P)));
  const bx0 = bi(p.x), bz0 = bi(p.z);
  for (let i = 0; i < 120; i++) {
    const bx = Math.max(0, Math.min(BLOCKS - 1, bx0 + Math.floor(rand(-R, R + 1)))), bz = Math.max(0, Math.min(BLOCKS - 1, bz0 + Math.floor(rand(-R, R + 1))));
    const c = curb(bx, bz, choice(['n', 's', 'e', 'w']), rand(0.2, 0.8));
    const d = dist(c.x, c.z, p.x, p.z);
    if (d >= minD && d <= maxD && g.city.pointFree(c.x, c.z, 0.5)) return c;
  }
  return null;
}
/** Any walkable spot at a random bearing minD..maxD metres from the player (sidewalk or road), or null. */
export function nearSpot(g, minD, maxD) {
  const p = g.player.worldPos();
  for (let i = 0; i < 40; i++) {
    const a = rand(0, Math.PI * 2), d = rand(minD, maxD), x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
    if (g.city.pointFree(x, z, 0.5)) return { x, z };
  }
  return null;
}
/** Random free lane position {a, b, t, x, z} between minD and maxD metres from the player, or null. */
export function laneSpot(g, minD, maxD, clearD = 12) {
  const p = g.player.worldPos(), city = g.city;
  for (let i = 0; i < 50; i++) {
    const [a, b] = city.randomEdge();
    const t = rand(0.15, 0.85), s = city.laneStart(a, b), e = city.laneEnd(a, b);
    const x = s.x + (e.x - s.x) * t, z = s.z + (e.z - s.z) * t, d = dist(x, z, p.x, p.z);
    if (d < minD || d > maxD) continue;
    if (g.vehicles.some((v) => dist(v.pos.x, v.pos.z, x, z) < clearD)) continue;
    return { a, b, t, x, z };
  }
  return null;
}
/** Keep a ped standing at `home` (turns to face the player when close); it still runs when panicked. */
export function holdPed(g, ped, home) {
  ped.home = home;
  ped.updateAI = function holdAI(dt) {
    if (this.panic > 0 && this.threat) { this.updateCiv(dt); return; }
    const hx = home.x - this.pos.x, hz = home.z - this.pos.z, hl = Math.hypot(hx, hz);
    if (hl > 0.8) { this.walk(hx / hl, hz / hl, 2.2, dt); this.yaw = Math.atan2(hx, hz); return; }
    const pp = g.player.worldPos(), dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
    if (Math.hypot(dx, dz) < 14) this.yaw = Math.atan2(dx, dz);
  };
}
/** Put a car on a lane and drive it by 'route' (road-graph waypoints that the job extends every frame). */
export function startOnRoad(v, spot, limit) {
  v.initTraffic(spot.a, spot.b, spot.t);
  v.route = v.route.slice(0, 1);
  v.nodeA = spot.a; v.nodeB = spot.b;
  v.route[0].limit = limit;
  v.controller = 'route'; v.routeEnd = null;
  v.hasDriver = true;
}
/** Keep a 'route' car supplied with lane waypoints; `pick(neighbourNodes, atNode)` chooses where it turns next. */
export function extendRoad(g, v, pick, limit) {
  const city = g.city;
  let guard = 0;
  while (v.route.length < 3 && guard++ < 4) {
    const a = v.nodeA, b = v.nodeB;
    let opts = city.neighbors(b[0], b[1]).filter((n) => !(n[0] === a[0] && n[1] === a[1]));
    if (!opts.length) opts = [a];
    const c = pick(opts, b);
    const s = city.laneStart(b, c), e = city.laneEnd(b, c);
    v.route.push({ x: s.x, z: s.z, limit: limit * 0.55 }, { x: e.x, z: e.z, limit });
    v.nodeA = b; v.nodeB = c;
  }
}
const interXZ = (n) => inter(n[0], n[1]);
/** Pursue the player: the shared 'chase' controller when a vehicle has it, else greedy lane-graph chasing. */
export function pursue(g, v, limit) {
  if (v.wrecked) return;
  const pl = g.player;
  if (typeof v.updateChase === 'function') { v.controller = 'chase'; v.chaseTarget = pl.vehicle || pl.ped; return; }
  const tp = pl.worldPos();
  extendRoad(g, v, (opts) => opts.reduce((best, n) => { const d = dist(interXZ(n).x, interXZ(n).z, tp.x, tp.z) + rand(0, 8); return !best || d < best.d ? { n, d } : best; }, null).n, limit);
}
/** Flee from the player along the road graph. */
export function flee(g, v, limit) {
  if (v.wrecked || v.controller !== 'route') return;
  const tp = g.player.worldPos();
  extendRoad(g, v, (opts) => (Math.random() < 0.3 ? choice(opts) : opts.reduce((best, n) => { const d = dist(interXZ(n).x, interXZ(n).z, tp.x, tp.z) + rand(0, 20); return !best || d > best.d ? { n, d } : best; }, null).n), limit);
}

function makeExclaim(color) {
  const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color });
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.1, 0.42), mat); stem.position.y = 0.95; grp.add(stem);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat); dot.position.y = 0.2; grp.add(dot);
  grp.userData.mat = mat;
  return grp;
}

// ---- jobs ------------------------------------------------------------------------------------------
class Job {
  constructor(jobs, key, title) {
    this.J = jobs; this.key = key; this.title = title;
    this.vehicles = []; this.peds = [];
    this.timer = null; this.t = 0; this.over = false;
    this.timeoutText = 'Out of time.';
  }
  get g() { return this.J.g; }
  car(type, x, z, yaw, opts = {}) { const v = this.g.spawnVehicle(type, x, z, yaw, { mission: true, marked: true, ...opts }); this.vehicles.push(v); return v; }
  ped(kind, x, z, opts = {}) { const p = this.g.spawnPed(kind, x, z, { mission: true, ...opts }); this.peds.push(p); return p; }
  obj(text) { this.g.hud.setObjective(text); }
  begin() { return true; }
  tick() {}
  onEnd() {}
  onTimeout() { this.J.fail(this, this.timeoutText); }
  guide() { return null; }
  pts() { return []; }
}

/** One-off job offered by a street contact. */
class ContactJob extends Job {
  constructor(jobs, contact) {
    super(jobs, contact.def.id, contact.def.title);
    this.c = contact; this.def = contact.def; this.p = contact.def.p;
  }
  begin() {
    const g = this.g;
    if (this.setup() === false) return false;
    g.hud.big(this.def.title, this.def.name, 3);
    g.audio.cash();
    this.J.speak(this.def.lines.offer);
    return true;
  }
  setup() { return true; }
  timeLimit(sec) { this.timer = sec * this.g.diff.timeLimit; }
  /** First completion pays in full, repeats pay CONTACT_REPEAT of it. */
  win(lineId, label = this.def.title, mult = 1) {
    const first = !(this.g.save.jobsDone && this.g.save.jobsDone[this.key]);
    const amount = this.def.reward * (first ? 1 : CONTACT_REPEAT) * mult * this.g.diff.reward;
    this.J.complete(this, label, amount, lineId);
  }
}

/** Sal Bruno: a thief drove off in his cab. Ram the thief out of it, then bring the cab back. */
class CabbieJob extends ContactJob {
  setup() {
    const g = this.g;
    const spot = laneSpot(g, 85, 150) || laneSpot(g, 30, 320);
    if (!spot) { g.hud.toast('NO CAB TO CHASE RIGHT NOW. TRY AGAIN.'); return false; }
    this.cab = this.car('taxi', spot.x, spot.z, 0, { hasDriver: true, driverKind: 'civ' });
    startOnRoad(this.cab, spot, 21);
    this.step = 0; this.timeLimit(this.p.time);
    this.obj("Catch the thief in SAL'S TAXI and ram him out of the cab.");
    return true;
  }
  tick(dt) {
    const g = this.g, v = this.cab;
    if (v.wrecked) return this.J.fail(this, 'The cab is wrecked. Sal is not impressed.');
    if (this.step === 0) {
      flee(g, v, 21);
      if (g.player.vehicle === v) this.next(1);
      else if (v.hasDriver && v.hp < v.type.hp * 0.62) { v.abandon(); this.J.speak(this.def.lines.caught); this.next(1); }
    } else if (this.step === 1 && g.player.vehicle === v) this.next(2);
    else if (this.step === 2 && g.player.vehicle === v && dist(v.pos.x, v.pos.z, this.p.home.x, this.p.home.z) < 8) this.win(this.def.lines.done);
  }
  next(s) {
    this.step = s;
    if (s === 1) this.obj('Get in the cab.');
    if (s === 2) this.obj("Bring the cab back to Sal's stand.");
  }
  guide() { return this.step === 2 ? { ...this.p.home, r: 6 } : { x: this.cab.pos.x, z: this.cab.pos.z, r: 3, ring: false }; }
  pts() { return [this.step === 2 ? this.p.home : this.cab.pos]; }
}

/** Pete Okafor: take a hauler with a crate across town before the timer ends. */
class DockJob extends ContactJob {
  setup() {
    const T = this.p.truck;
    this.truck = this.car('pickup', T.x, T.z, T.yaw, { color: '#8e6e3f' });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.6), new THREE.MeshLambertMaterial({ color: '#a97c3f' }));
    crate.position.set(0, 2.25, -1.1);
    this.truck.mesh.add(crate);
    this.step = 0;
    this.obj('Get in the HAULER with the crate.');
    return true;
  }
  tick() {
    const g = this.g, v = this.truck;
    if (v.wrecked) return this.J.fail(this, 'The truck is wrecked. So is the crate.');
    if (this.step === 0 && g.player.vehicle === v) {
      this.step = 1; this.timeLimit(this.p.time);
      this.timeoutText = 'The crate was late. Pete is not paying.';
      this.obj(`Deliver the crate to ${this.p.destName} before the clock runs out.`);
    } else if (this.step === 1 && g.player.vehicle === v && dist(v.pos.x, v.pos.z, this.p.dest.x, this.p.dest.z) < 9) {
      if (v.hp < v.type.hp * 0.5) this.win(this.def.lines.damaged, 'CRATE DAMAGED', 0.5);
      else this.win(this.def.lines.done);
    }
  }
  guide() { return this.step === 0 ? { x: this.truck.pos.x, z: this.truck.pos.z, r: 3, ring: false } : { ...this.p.dest, r: 7 }; }
  pts() { return [this.step === 0 ? this.truck.pos : this.p.dest]; }
}

/** Lenny Vasco: give him a ride to the courthouse while the cops chase you. */
class WitnessJob extends ContactJob {
  setup() { this.step = 0; this.away = 0; this.obj('Pull up in a car beside LENNY.'); return true; }
  tick(dt) {
    const g = this.g, pl = g.player;
    if (this.step === 0) {
      if (pl.vehicle && dist(pl.vehicle.pos.x, pl.vehicle.pos.z, this.def.at.x, this.def.at.z) < 10) {
        this.step = 1; this.veh = pl.vehicle; this.c.hidden = true;
        if (this.c.ped) { this.c.ped.remove = true; this.c.ped = null; }
        g.wanted.force(this.p.heat);
        this.timeLimit(this.p.time);
        this.timeoutText = 'Too slow. Lenny jumped out and ran.';
        this.J.speak(this.def.lines.board);
        this.obj('Get Lenny to the COURTHOUSE. The cops are on you!');
      }
    } else {
      if (this.veh.wrecked) return this.J.fail(this, 'The car is wrecked. Lenny did not make it.');
      this.away = pl.vehicle === this.veh ? 0 : this.away + dt;
      if (this.away > 6) return this.J.fail(this, 'You left Lenny behind.');
      if (pl.vehicle === this.veh && dist(this.veh.pos.x, this.veh.pos.z, this.p.dest.x, this.p.dest.z) < 9) this.win(this.def.lines.done);
    }
  }
  onEnd(ok) { this.c.hidden = false; this.g.wanted.force(0); if (ok) this.g.wanted.clear(); }
  guide() { return this.step === 0 ? { ...this.def.at, r: 5 } : { ...this.p.dest, r: 7 }; }
  pts() { return [this.step === 0 ? this.def.at : this.p.dest]; }
}

/** Dani Reyes: head-to-head race against an AI Viper along a route; first to the finish wins. */
class RacerJob extends ContactJob {
  setup() {
    const g = this.g, city = g.city, R = this.p.route;
    const s = city.laneStart(R[0], R[1]), e = city.laneEnd(R[0], R[1]);
    this.start = { x: s.x, z: s.z };
    const f = city.laneEnd(R[R.length - 2], R[R.length - 1]);
    this.finish = { x: f.x, z: f.z };
    this.rival = this.car('sports', s.x, s.z, Math.atan2(e.x - s.x, e.z - s.z), { color: '#e3202a', hasDriver: true, driverKind: 'civ' });
    this.step = 0; this.cd = 3; this.left = 0;
    this.obj("Line up beside DANI'S red Viper in any car.");
    return true;
  }
  tick(dt) {
    const g = this.g, pl = g.player, rv = this.rival;
    if (this.step === 0) {
      if (pl.vehicle && dist(pl.vehicle.pos.x, pl.vehicle.pos.z, this.start.x, this.start.z) < 14) { this.step = 1; this.cd = 3.4; this.cdN = 4; this.obj('Get ready...'); }
    } else if (this.step === 1) {
      if (!pl.vehicle) { this.step = 0; this.obj("Line up beside DANI'S red Viper in any car."); return; }
      this.cd -= dt;
      const n = Math.ceil(this.cd);
      if (n < this.cdN && n >= 1) { this.cdN = n; g.hud.toast(String(n), 0.8); }
      if (this.cd <= 0) {
        this.step = 2;
        g.hud.toast('GO!', 1.5);
        this.J.speak(this.def.lines.go);
        rv.setRoute(this.p.route, this.p.speed / Math.sqrt(g.diff.timeLimit));
        this.timeLimit(this.p.time);
        this.timeoutText = 'Nobody finished. Dani calls it a draw.';
        this.obj("RACE! Beat Dani's Viper to the finish line.");
      }
    } else {
      if (rv.wrecked) return this.win(this.def.lines.done); // the rival crashed out
      if (dist(rv.pos.x, rv.pos.z, this.finish.x, this.finish.z) < 11) return this.J.fail(this, 'Dani beat you to the line.');
      this.left = pl.vehicle ? 0 : this.left + dt;
      if (this.left > 8) return this.J.fail(this, 'You bailed out of the race.');
      if (pl.vehicle && dist(pl.vehicle.pos.x, pl.vehicle.pos.z, this.finish.x, this.finish.z) < 11) this.win(this.def.lines.done);
    }
  }
  guide() { return this.step === 2 ? { ...this.finish, r: 10 } : { ...this.start, r: 6 }; }
  pts() { return [this.step === 2 ? this.finish : this.start]; }
}

/** Greta Holm: get rid of the hoods leaning on her shop window. */
class ShopJob extends ContactJob {
  setup() {
    const g = this.g, city = g.city, S = this.p.spot;
    const n = Math.max(this.p.hoods, Math.round(this.p.hoods * g.diff.enemyCount));
    for (let i = 0; i < n; i++) {
      let pos = { x: S.x, z: S.z };
      for (let k = 0; k < 25; k++) {
        const x = S.x + rand(-6, 6), z = S.z + rand(-5, 2);
        if (city.pointFree(x, z, 0.7)) { pos = { x, z }; break; }
      }
      this.ped('gang', pos.x, pos.z, { gang: 'crows', weapon: choice(['pistol', 'pistol', 'uzi']), alertRange: 28 });
    }
    this.total = n;
    this.obj(`Scare the ${n} hoods off the front of GRETA'S shop.`);
    return true;
  }
  tick() {
    const alive = this.peds.filter((p) => !p.dead);
    this.obj(alive.length ? `Scare the hoods off the front of GRETA'S shop (${alive.length} left).` : 'Done. Tell Greta.');
    const pp = this.g.player.worldPos();
    if (dist(pp.x, pp.z, this.p.spot.x, this.p.spot.z) > 240) return this.J.fail(this, 'You wandered off. The hoods stayed.');
    if (!alive.length) this.win(this.def.lines.done);
  }
  nearest() {
    const pp = this.g.player.worldPos();
    let best = null, bd = Infinity;
    for (const p of this.peds) if (!p.dead) { const d = dist(p.pos.x, p.pos.z, pp.x, pp.z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  guide() { const p = this.nearest(); return p ? { x: p.pos.x, z: p.pos.z, r: 3, ring: false } : null; }
  pts() { return this.peds.filter((p) => !p.dead).map((p) => ({ x: p.pos.x, z: p.pos.z })); }
}
const CONTACT_JOBS = { cabbie: CabbieJob, dock: DockJob, witness: WitnessJob, racer: RacerJob, shop: ShopJob };

/** Taxi fares / paramedic: pick up, deliver before the timer, up to five in a row. */
class FareJob extends Job {
  constructor(jobs, kind, veh) {
    super(jobs, kind, FARE_CFG[kind].title);
    this.kind = kind; this.cfg = FARE_CFG[kind]; this.veh = veh;
    this.n = 0; this.earned = 0; this.prevMission = veh.mission;
  }
  begin() {
    const g = this.g;
    this.veh.mission = true;
    this.veh.sirenOn = this.kind === 'paramedic';
    g.hud.big(this.cfg.title, 'Leave the vehicle to end the job', 3);
    this.J.speak(this.cfg.start);
    return this.nextFare();
  }
  nextFare() {
    const g = this.g;
    const spot = curbSpot(g, 70, 170) || curbSpot(g, 25, 320);
    if (!spot) return false;
    const ped = this.ped('civ', spot.x, spot.z, {});
    holdPed(g, ped, spot);
    if (this.kind === 'paramedic') { ped.dead = true; ped.deadTime = 1; ped.patient = true; }
    this.fare = ped; this.state = 'pickup'; this.timer = null; this.dest = null;
    g.hud.setTimer(null);
    this.obj(this.kind === 'taxi' ? `Pick up fare ${this.n + 1}/${this.cfg.fares}. Look for the waving passenger.` : `Reach the injured person ${this.n + 1}/${this.cfg.fares} and load them up.`);
    return true;
  }
  tick() {
    const g = this.g, v = this.veh;
    if (g.player.vehicle !== v) return this.J.fail(this, this.earned ? `You left the vehicle. Earned ${fmtMoney(this.earned)}.` : 'You left the vehicle.');
    if (v.wrecked) return this.J.fail(this, 'Your vehicle is wrecked.');
    if (this.state === 'pickup') {
      const f = this.fare;
      if (!f || f.remove || !g.peds.includes(f)) { this.nextFare(); return; }
      if (f.patient) f.deadTime = 1;
      if (dist(v.pos.x, v.pos.z, f.pos.x, f.pos.z) < 9 && v.speedAbs < 4.5) this.board();
    } else if (dist(v.pos.x, v.pos.z, this.dest.x, this.dest.z) < 9 && v.speedAbs < 9) this.arrive();
  }
  board() {
    const g = this.g, f = this.fare;
    this.pickup = { x: f.pos.x, z: f.pos.z };
    f.remove = true; this.fare = null;
    let dest = HOSPITAL;
    if (this.kind === 'taxi') {
      const ok = LANDMARKS.filter((l) => { const d = dist(l.x, l.z, this.pickup.x, this.pickup.z); return d > 150 && d < 450; });
      dest = ok.length ? choice(ok) : LANDMARKS.reduce((b, l) => (dist(l.x, l.z, this.pickup.x, this.pickup.z) > dist(b.x, b.z, this.pickup.x, this.pickup.z) ? l : b));
    }
    this.dest = dest;
    this.legD = dist(dest.x, dest.z, this.pickup.x, this.pickup.z);
    this.state = 'deliver';
    this.timer = (this.legD * 1.3 / 10 + 18) * g.diff.timeLimit;
    this.timeoutText = this.kind === 'taxi' ? 'The fare gave up and walked.' : 'Too late for the patient.';
    this.obj(this.kind === 'taxi' ? `Take the fare to ${dest.name.toUpperCase()}. (${this.n + 1}/${this.cfg.fares})` : `Rush the patient to ${dest.name.toUpperCase()}. (${this.n + 1}/${this.cfg.fares})`);
    this.J.speak(choice(this.cfg.board));
    g.audio.pickup();
  }
  arrive() {
    const g = this.g, c = this.cfg;
    const pay = Math.round((c.base + this.legD * c.perM + Math.max(0, this.timer) * 4) * (1 + 0.1 * this.n) * g.diff.reward);
    this.earned += pay; this.n++;
    const d = (g.save.jobsDone = g.save.jobsDone || {});
    d[this.kind] = (d[this.kind] || 0) + 1;
    g.addScore(pay, `FARE ${this.n}/${c.fares}`);
    this.J.speak(choice(c.arrive));
    if (this.n >= c.fares) {
      const bonus = Math.round(c.bonus * g.diff.reward);
      this.earned += bonus;
      this.J.complete(this, `SHIFT OVER   ${this.n} fares`, bonus, c.done, false);
    } else if (!this.nextFare()) this.J.complete(this, `SHIFT OVER   ${this.n} fares`, 0, c.done, false);
  }
  onEnd() { this.veh.mission = this.prevMission; this.veh.sirenOn = false; }
  guide() {
    if (this.state === 'pickup') return this.fare ? { x: this.fare.pos.x, z: this.fare.pos.z, r: 5 } : null;
    return { x: this.dest.x, z: this.dest.z, r: 8 };
  }
  pts() { return this.state === 'pickup' ? (this.fare ? [this.fare.pos] : []) : [this.dest]; }
}

/** Police car: chase and wreck a marked gang car within 90 s, chain up to five. */
class VigilanteJob extends Job {
  constructor(jobs, veh) { super(jobs, 'vigilante', VIGILANTE.title); this.veh = veh; this.kills = 0; this.earned = 0; this.prevMission = veh.mission; }
  begin() {
    this.veh.mission = true; this.veh.sirenOn = true;
    this.g.hud.big(VIGILANTE.title, 'Leave the vehicle to end the job', 3);
    this.J.speak(VIGILANTE.start);
    return this.spawnTarget();
  }
  spawnTarget() {
    const g = this.g;
    const spot = laneSpot(g, 80, 150) || laneSpot(g, 35, 320);
    if (!spot) return false;
    const gang = gangAtXZ(spot.x, spot.z) || choice(GANG_IDS);
    this.gang = gang;
    this.target = this.car(choice(['sedan', 'compact', 'pickup', 'van']), spot.x, spot.z, 0, { hasDriver: true, driverKind: 'gang', color: GANGS[gang].color });
    startOnRoad(this.target, spot, 20);
    this.timer = VIGILANTE.time * this.g.diff.timeLimit;
    this.timeoutText = 'The gang car got away.';
    this.obj(`Chase and WRECK the marked ${GANGS[gang].name.toUpperCase()} car. (${this.kills + 1}/${VIGILANTE.targets})`);
    return true;
  }
  tick() {
    const g = this.g;
    if (g.player.vehicle !== this.veh) return this.J.fail(this, this.earned ? `You left your cruiser. Earned ${fmtMoney(this.earned)}.` : 'You left your cruiser.');
    if (this.veh.wrecked) return this.J.fail(this, 'Your cruiser is wrecked.');
    const t = this.target;
    if (!t.wrecked) { flee(g, t, 20); return; }
    const pay = Math.round(VIGILANTE.reward * (1 + 0.2 * this.kills) * g.diff.reward);
    this.earned += pay; this.kills++;
    const d = (g.save.jobsDone = g.save.jobsDone || {});
    d.vigilante = (d.vigilante || 0) + 1;
    g.addScore(pay, `GANG CAR DOWN ${this.kills}/${VIGILANTE.targets}`);
    const w = g.wanted; // wrecking it for the law should not make you a criminal
    if (w.forced === 0 && w.heat > 0) { w.heat = Math.max(0, w.heat - 0.5); w.level = Math.floor(w.heat); }
    this.vehicles = this.vehicles.filter((v) => v !== t); t.mission = false; t.marked = false;
    if (this.kills >= VIGILANTE.targets) {
      const bonus = Math.round(VIGILANTE.bonus * g.diff.reward);
      this.J.complete(this, `SHIFT OVER   ${this.kills} cars`, bonus, VIGILANTE.done, false);
    } else { this.J.speak(VIGILANTE.down); if (!this.spawnTarget()) this.J.complete(this, `SHIFT OVER   ${this.kills} cars`, 0, VIGILANTE.done, false); }
  }
  onEnd() { this.veh.mission = this.prevMission; this.veh.sirenOn = false; }
  guide() { return this.target && !this.target.wrecked ? { x: this.target.pos.x, z: this.target.pos.z, r: 3, ring: false } : null; }
  pts() { return this.target && !this.target.wrecked ? [this.target.pos] : []; }
}

// ---- random street events ------------------------------------------------------------------------
/** A stranger who runs up to the player and stands there (spawned near, speaks via the pager). */
function stranger(job) {
  const g = job.g, spot = nearSpot(g, 8, 16);
  if (!spot) return null;
  const p = job.ped('civ', spot.x, spot.z, {});
  p.updateAI = function runUp(dt) {
    if (this.panic > 0 && this.threat) { this.updateCiv(dt); return; }
    const pp = g.player.worldPos(), dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, d = Math.hypot(dx, dz);
    this.yaw = Math.atan2(dx, dz);
    if (d > 3) this.walk(dx / d, dz / d, 6, dt);
  };
  return p;
}

class EventJob extends Job {
  /** Quietly drop the event (player walked away). */
  drop(text) { this.J.cancel(this, text); }
}

/** A gang car comes for you: survive 45 s or wreck it. */
class DriveByJob extends EventJob {
  constructor(jobs) { super(jobs, 'driveby', 'DRIVE-BY'); this.fireT = 2; this.burst = 0; this.far = 0; }
  begin() {
    const g = this.g, E = EVENTS.driveby;
    const spot = laneSpot(g, 55, 75);
    if (!spot) return false;
    const gang = choice(GANG_IDS);
    this.car_ = this.car('sedan', spot.x, spot.z, 0, { hasDriver: true, driverKind: 'gang', color: GANGS[gang].color });
    startOnRoad(this.car_, spot, 24);
    this.owner = { kind: 'gang', isPlayer: false, vehicle: this.car_, yaw: 0, pos: this.car_.pos };
    stranger(this);
    this.J.speak(E.warn);
    this.timer = E.time;
    this.timeoutText = '';
    this.obj('A gang car is coming for you! Survive, or wreck it.');
    return true;
  }
  tick(dt) {
    const g = this.g, v = this.car_, E = EVENTS.driveby;
    if (v.wrecked) return this.J.complete(this, 'DRIVE-BY STOPPED', E.killReward * g.diff.reward, null, false);
    pursue(g, v, 24);
    const pp = g.player.worldPos(), d = dist(pp.x, pp.z, v.pos.x, v.pos.z);
    this.far = d > 80 ? this.far + dt : 0;
    if (this.far > 3) return this.drop('THEY LOST YOU.');
    this.fireT -= dt;
    if (d < 40 && d > 5 && this.fireT <= 0 && g.city.lineOfSight(v.pos.x, v.pos.z, pp.x, pp.z)) {
      if (this.burst <= 0) this.burst = 3;
      this.shoot(d); this.burst--;
      this.fireT = this.burst > 0 ? 0.13 : rand(1.4, 2.2) / g.diff.enemyFireRate;
    }
  }
  shoot(d) {
    const g = this.g, v = this.car_, f = v.forward, pl = g.player, pp = pl.worldPos();
    const from = new THREE.Vector3(v.pos.x + f.x * 1.2, 1.2, v.pos.z + f.z * 1.2);
    const ty = pl.vehicle ? 0.8 : pl.ped.y + pl.aimHeight();
    const dir = new THREE.Vector3(pp.x - from.x, ty - from.y, pp.z - from.z).normalize();
    this.owner.yaw = Math.atan2(dir.x, dir.z);
    g.combat.fire(this.owner, from, dir, 'uzi', { spread: 0.05 * g.diff.enemySpread * (1 + d / 45) });
  }
  onTimeout() { this.J.complete(this, 'SURVIVED THE DRIVE-BY', EVENTS.driveby.reward * this.g.diff.reward, null, false); }
  guide() { return { x: this.car_.pos.x, z: this.car_.pos.z, r: 3, ring: false }; }
  pts() { return [this.car_.pos]; }
}

/** A mugger snatched a bag and is running: bring him down within 60 s. */
class MuggingJob extends EventJob {
  constructor(jobs) { super(jobs, 'mugging', 'MUGGING'); }
  begin() {
    const g = this.g, E = EVENTS.mugging;
    const ms = curbSpot(g, 28, 50);
    if (!ms || !stranger(this)) return false;
    this.mugger = this.ped('gang', ms.x, ms.z, { gang: null, weapon: null, hp: 45, colors: { skin: '#c68642', shirt: '#1a1a1a', pants: '#222222', hat: '#111111' } });
    this.mugger.updateAI = function flee(dt) {
      const pp = g.player.worldPos();
      this.panic = 5; this.threat = { x: pp.x, z: pp.z };
      this.updateCiv(dt);
    };
    this.J.speak(E.help);
    this.timer = E.time;
    this.timeoutText = 'The mugger got away.';
    this.obj('Stop the MUGGER and get the bag back!');
    return true;
  }
  tick() {
    const g = this.g, m = this.mugger, pp = g.player.worldPos();
    if (m.dead) return this.J.complete(this, 'BAG RECOVERED', EVENTS.mugging.reward * g.diff.reward, EVENTS.mugging.thanks, false);
    if (dist(pp.x, pp.z, m.pos.x, m.pos.z) > 80) this.drop('THE MUGGER GOT AWAY.');
  }
  guide() { return { x: this.mugger.pos.x, z: this.mugger.pos.z, r: 3, ring: false }; }
  pts() { return [this.mugger.pos]; }
}

/** A stranger pays you to draw a tail car off him: get 85 m clear for 4 s, or wreck it. */
class TailJob extends EventJob {
  constructor(jobs) { super(jobs, 'tail', 'LOSE THE TAIL'); this.clear = 0; }
  begin() {
    const g = this.g, E = EVENTS.tail;
    const spot = laneSpot(g, 35, 55);
    if (!spot) return false;
    this.tail = this.car('sedan', spot.x, spot.z, 0, { hasDriver: true, driverKind: 'gang', color: '#555a60' });
    startOnRoad(this.tail, spot, 25);
    stranger(this);
    this.J.speak(E.ask);
    this.timer = E.time;
    this.timeoutText = 'They stayed on you the whole way.';
    this.obj('Lose the GREY CAR on your tail: get 85 m clear.');
    return true;
  }
  tick(dt) {
    const g = this.g, v = this.tail, E = EVENTS.tail;
    if (v.wrecked) return this.J.complete(this, 'TAIL WRECKED', E.reward * g.diff.reward, E.thanks, false);
    pursue(g, v, 25);
    const pp = g.player.worldPos();
    this.clear = dist(pp.x, pp.z, v.pos.x, v.pos.z) > 85 ? this.clear + dt : 0;
    if (this.clear > 4) this.J.complete(this, 'TAIL LOST', E.reward * g.diff.reward, E.thanks, false);
  }
  guide() { return { x: this.tail.pos.x, z: this.tail.pos.z, r: 3, ring: false }; }
  pts() { return [this.tail.pos]; }
}
const EVENT_JOBS = { driveby: DriveByJob, mugging: MuggingJob, tail: TailJob };

// ---- the system ------------------------------------------------------------------------------------
class Contact {
  constructor(game, def) {
    this.def = def; this.id = def.id;
    this.ped = null; this.deadT = 0; this.respawnT = 0; this.hidden = false;
    this.mesh = makeExclaim('#ffe066');
    this.mesh.position.set(def.at.x, 3.6, def.at.z);
    game.scene.add(this.mesh);
  }
  get available() { return !this.hidden && this.respawnT <= 0 && !(this.ped && this.ped.dead); }
}

export class Jobs {
  constructor(game) {
    this.g = game;
    this.current = null;     // running Job (makes game.isBusy() true)
    this.offer = null;       // {def, vehicle, t}: vehicle job offered after entering a car
    this.eventT = rand(100, 200);
    this.beacon = new Beacon(game.scene, '#ffe066');
    this.contacts = CONTACTS.map((d) => new Contact(game, d));
  }
  speak(id) { const l = JOB_LINES[id]; if (l) this.g.say(id, l.text, l.who); }

  // -- job lifecycle
  start(job) {
    this.current = job; this.offer = null;
    let ok = false;
    try { ok = job.begin() !== false; } catch (e) { console.warn('job failed to start', e); }
    if (!ok) { this.finish(job, false); return false; }
    return true;
  }
  /** Pay out and end a job successfully. `count` bumps game.save.jobsDone[job.key]. */
  complete(job, label, amount, lineId, count = true) {
    if (job.over) return;
    const g = this.g;
    amount = Math.round(amount);
    if (count) { const d = (g.save.jobsDone = g.save.jobsDone || {}); d[job.key] = (d[job.key] || 0) + 1; }
    if (amount > 0) g.addScore(amount, null);
    if (!(job instanceof EventJob)) g.hud.big('JOB COMPLETE', `${label}   ${amount > 0 ? fmtMoney(amount) : ''}`, 4, 'pass');
    else g.hud.toast(`${label}   ${fmtMoney(amount)}`, 4);
    g.audio.missionPass();
    if (lineId) this.speak(lineId);
    this.finish(job, true);
    g.saveGame();
  }
  fail(job, reason) {
    if (job.over) return;
    if (job instanceof EventJob) this.g.hud.toast(reason, 4);
    else { this.g.hud.big('JOB FAILED', reason, 4, 'fail'); this.g.audio.missionFail(); }
    this.finish(job, false);
  }
  /** End a job without a banner (walked away, loaded a save, died). */
  cancel(job = this.current, text = '') {
    if (!job || job.over) return;
    if (text) this.g.hud.toast(text);
    this.finish(job, false);
  }
  finish(job, ok) {
    const g = this.g;
    job.over = true;
    try { job.onEnd(ok); } catch (e) { console.warn('job cleanup', e); }
    g.hud.setObjective('');
    g.hud.setTimer(null);
    this.beacon.hide();
    for (const p of job.peds) if (!(p.dead && !p.patient)) p.remove = true; // corpses of targets expire on their own
    for (const v of job.vehicles) {
      v.mission = false; v.marked = false;
      if (g.player.vehicle === v || v.wrecked || v.removed) continue;
      if (v.hasDriver && v.controller !== 'player') v.becomeTraffic();
      else if (!ok || job.removeVehicles) g.removeVehicle(v);
    }
    if (this.current === job) this.current = null;
  }
  /** game.wasted / busted. */
  onPlayerLost(reason) {
    this.offer = null;
    if (this.current) this.cancel(this.current, 'JOB FAILED' + (reason ? ' — ' + reason : ''));
  }

  // -- vehicle jobs
  onEnterVehicle(v) {
    this.offer = null;
    if (this.g.isBusy()) return;
    const def = VEHICLE_JOBS[v.typeKey];
    if (def) this.offer = { def, vehicle: v, t: 5 };
  }
  /** E pressed in a vehicle: accept the pending offer. */
  tryAccept() {
    const o = this.offer, g = this.g;
    if (!o) return false;
    this.offer = null;
    if (g.isBusy() || g.player.vehicle !== o.vehicle) return false;
    const v = o.vehicle;
    const job = o.def.kind === 'vigilante' ? new VigilanteJob(this, v) : new FareJob(this, o.def.kind, v);
    if (!this.start(job)) g.hud.toast('NOTHING TO DO RIGHT NOW. TRY AGAIN.');
    return true;
  }

  // -- contacts
  /** E pressed on foot at (x, z): start the nearby contact's job. Returns true if the press was used. */
  tryTalk(x, z) {
    const c = this.contactNear(x, z);
    if (!c) return false;
    if (this.g.isBusy()) { this.g.hud.toast('FINISH WHAT YOU ARE DOING FIRST.'); return true; }
    this.start(new CONTACT_JOBS[c.id](this, c));
    return true;
  }
  contactNear(x, z) {
    for (const c of this.contacts) {
      if (!c.available || !c.ped || c.ped.dead) continue;
      if (dist(x, z, c.ped.pos.x, c.ped.pos.z) < 2.5) return c;
    }
    return null;
  }
  /** Prompt text contribution (empty string when none). */
  prompt() {
    const g = this.g, p = g.player;
    if (p.dead) return '';
    if (p.vehicle) return this.offer && this.offer.vehicle === p.vehicle ? this.offer.def.prompt : '';
    if (g.isBusy()) return '';
    const pp = p.ped.pos, c = this.contactNear(pp.x, pp.z);
    return c ? 'E — TALK TO ' + c.def.name.toUpperCase() : '';
  }
  markers() {
    const out = [];
    for (const c of this.contacts) if (c.available) out.push({ x: c.def.at.x, z: c.def.at.z, kind: 'contact' });
    if (this.current && !this.current.over) for (const q of this.current.pts()) out.push({ x: q.x, z: q.z, kind: 'job' });
    return out;
  }

  // -- per frame
  update(dt) {
    const g = this.g, p = g.player;
    this.updateContacts(dt);
    if (this.offer && (p.vehicle !== this.offer.vehicle || (this.offer.t -= dt) <= 0 || p.dead)) this.offer = null;
    const j = this.current;
    if (j && !j.over) {
      j.t += dt;
      if (j.timer != null) {
        j.timer -= dt;
        g.hud.setTimer(j.timer);
        if (j.timer <= 0) { j.onTimeout(); }
      }
      if (this.current === j && !j.over) j.tick(dt);
    } else if (!j) this.updateEvents(dt);
    const cur = this.current;
    const gd = cur && !cur.over ? cur.guide() : null;
    if (gd) this.beacon.show(g, gd.x, gd.z, gd); else this.beacon.hide();
  }
  updateEvents(dt) {
    const g = this.g, p = g.player;
    if (g.isBusy() || p.dead || g.state !== 'playing' || g.wanted.level > 0 || this.offer) return;
    this.eventT -= dt;
    if (this.eventT > 0) return;
    this.eventT = rand(120, 240);
    const kinds = ['driveby', 'mugging', 'tail'].sort(() => Math.random() - 0.5);
    for (const k of kinds) if (this.start(new EVENT_JOBS[k](this))) return;
    this.eventT = 20; // nothing could spawn here; look again soon
  }
  updateContacts(dt) {
    const g = this.g, pp = g.player.worldPos(), busy = g.isBusy(), now = performance.now();
    for (const c of this.contacts) {
      const at = c.def.at, d = dist(pp.x, pp.z, at.x, at.z);
      if (c.ped && (c.ped.remove || !g.peds.includes(c.ped))) c.ped = null;
      if (c.respawnT > 0) c.respawnT -= dt;
      if (!c.ped) {
        if (!c.hidden && c.respawnT <= 0 && d < 140) {
          c.deadT = 0;
          c.ped = g.spawnPed('civ', at.x, at.z, { mission: true, colors: c.def.colors, name: c.def.name });
          holdPed(g, c.ped, at);
        }
      } else if (c.ped.dead) {
        c.deadT += dt;
        if (c.deadT > 40) { c.ped.remove = true; c.ped = null; c.respawnT = 60; }
      } else if (d > 180) { c.ped.remove = true; c.ped = null; }
      const first = !(g.save.jobsDone && g.save.jobsDone[c.id]);
      c.mesh.userData.mat.color.set(first ? '#ffe066' : '#7fd6a4');
      c.mesh.visible = c.available && !busy;
      if (c.mesh.visible) {
        c.mesh.rotation.y += dt * 2.2;
        c.mesh.position.y = 3.6 + Math.sin(now * 0.004 + at.x) * 0.2;
      }
    }
  }
  /** Drop everything (save loaded, new run). */
  reset() { this.offer = null; if (this.current) this.cancel(this.current); this.eventT = rand(100, 200); }
}
