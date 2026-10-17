import * as THREE from 'three';
import { MISSIONS, BOSSES } from '../data/missions.js';
import { VEHICLE_TYPES } from '../entities/vehicle.js';
import { WEAPONS } from './combat.js';
import { dist, rand, choice, fmtMoney } from '../util.js';

/** Missions in play order (the `order` field), not array / id order. */
const ORDERED = [...MISSIONS].sort((a, b) => a.order - b.order);
/** Seconds of free roaming (no mission, job, wanted level or cooldown) before a boss pages the player. */
const PAGE_WAIT = 60;
const GANG_CAR = { cinelli: '#d9b24c', crows: '#7c4dff', mal: '#ff5e5e', debtors: '#2e8b57' };
const FOOT_PICKUP = 2.0, CAR_PICKUP = 3.8;

let _caseGeo = null;
/** Spinning briefcase (collect step): a brown case with a handle and a tall translucent beam so it reads from a distance. */
function makeCase() {
  if (!_caseGeo) {
    _caseGeo = {
      body: new THREE.BoxGeometry(0.8, 0.55, 0.22), handle: new THREE.BoxGeometry(0.3, 0.12, 0.08), beam: new THREE.CylinderGeometry(0.5, 0.5, 14, 10, 1, true),
      mBody: new THREE.MeshLambertMaterial({ color: '#7a4a1f' }), mHandle: new THREE.MeshLambertMaterial({ color: '#2a2a2a' }),
      mBeam: new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    };
  }
  const G = _caseGeo, g = new THREE.Group();
  g.add(new THREE.Mesh(G.body, G.mBody));
  const h = new THREE.Mesh(G.handle, G.mHandle); h.position.y = 0.32; g.add(h);
  const beam = new THREE.Mesh(G.beam, G.mBeam); beam.position.y = 6; beam.userData.beam = true; g.add(beam);
  return g;
}

/** Payphone / pager mission runner: a play-ordered chain of missions, each a chain of objective steps. */
export class Missions {
  constructor(game) {
    this.g = game;
    this.current = null;
    this.step = -1;
    this.state = null;
    this.vehicle = null;          // the vehicle the mission is about (steal / mission vehicle)
    this.targets = [];            // peds that must die for the current kill / ambush step
    this.mobs = [];               // every ped the mission spawned (cleaned up with the mission)
    this.spawnedVehicles = [];    // every vehicle the mission spawned
    this.stepVehicles = [];       // chasers / wave cars of the current step (turned into traffic when the step ends)
    this.stepPeds = [];           // bailed-out drivers, guards: removed shortly after their step ends
    this.stepMeshes = [];         // briefcases, ghost markers
    this.leftovers = [];          // [{ped, t}] peds to remove after a delay
    this.cooldown = 0;
    this.freeT = 0;               // seconds of free roaming toward the next boss page
    this.timer = null;
    this.markerTarget = null;
    this.lastPos = null;          // where the last destroy / destroyAll target died
    this.killedGangs = new Set(); // gangs whose members the player killed during the current mission
  }

  // ---- the chain ----------------------------------------------------------
  /** First unfinished mission in play order (phone or page). */
  get chainHead() { const d = this.g.save.done; return ORDERED.find((m) => !d.includes(m.id)) || null; }
  /** Next unfinished mission on the payphone chain (paged missions are skipped). */
  get next() { const d = this.g.save.done; return ORDERED.find((m) => m.source !== 'page' && !d.includes(m.id)) || null; }
  /** The paged mission waiting to be started by a boss's pager, if it is next in play order. */
  get paged() { const h = this.chainHead; return h && h.source === 'page' ? h : null; }
  get allDone() { return !this.chainHead; }
  get busy() { return !!this.current; }

  isRinging(phone) {
    const n = this.next;
    // the phones stay quiet while a paged mission is due earlier in the play order
    return !this.current && !this.g.isBusy() && this.cooldown <= 0 && !!n && n === this.chainHead && phone.boss === n.boss && !this.g.player.dead;
  }
  answer(phone) {
    if (!this.isRinging(phone)) return false;
    return this.start(this.next);
  }
  /** Free-roaming for a minute with a paged mission due: the boss pages and the mission starts at once. */
  tickPage(dt) {
    const g = this.g, m = this.paged;
    if (!m || this.cooldown > 0) { this.freeT = 0; return; }
    if (g.isBusy() || g.player.dead || g.wanted.level > 0) return;
    this.freeT += dt;
    if (this.freeT >= PAGE_WAIT) { this.freeT = 0; this.startPaged(m); }
  }
  startPaged(m) {
    const g = this.g;
    if (g.isBusy()) return false;
    g.audio.ring();
    g.say(`${m.id}.page`, m.page || "Pick up. It's urgent.", BOSSES[m.boss].name);
    return this.start(m);
  }

  start(m) {
    const g = this.g;
    if (!m || g.isBusy() || g.player.dead) return false;
    this.current = m; this.step = -1; this.vehicle = null; this.lastPos = null;
    this.targets = []; this.mobs = []; this.spawnedVehicles = []; this.stepVehicles = []; this.stepPeds = []; this.stepMeshes = [];
    this.killedGangs = new Set(); this.freeT = 0;
    g.hud.big(m.title, BOSSES[m.boss].name, 3);
    g.say(`${m.id}.intro`, m.intro, BOSSES[m.boss].name);
    g.audio.cash();
    this.nextStep();
    return true;
  }
  nextStep() {
    this.endStep(false);
    this.step++;
    const s = this.current.steps[this.step];
    if (!s) { this.pass(); return; }
    this.initStep(s);
  }
  /** Leave the current step: clear HUD, markers, briefcases; chasers become traffic, bailed drivers vanish soon. */
  endStep(failed) {
    const g = this.g;
    this.timer = null;
    g.hud.setTimer(null);
    this.markerTarget = null;
    for (const m of this.stepMeshes) g.scene.remove(m);
    this.stepMeshes = [];
    if (!failed) {
      for (const v of this.stepVehicles) {
        v.mission = false; v.marked = false; v.chaseTarget = null; v.onBail = null;
        if (!v.wrecked && v.controller === 'chase' && g.player.vehicle !== v) v.becomeTraffic();
      }
      for (const p of this.stepPeds) if (!p.dead) { p.mission = false; this.leftovers.push({ ped: p, t: 4 }); }
    }
    this.stepVehicles = []; this.stepPeds = [];
  }

  // ---- spawn helpers ------------------------------------------------------
  playerPos() { const p = this.g.player.worldPos(); return { x: p.x, z: p.z }; }
  freeSpot(at, r) {
    for (let i = 0; i < 25; i++) {
      const x = at.x + rand(-r, r), z = at.z + rand(-r, r);
      if (this.g.city.pointFree(x, z, 0.7)) return { x, z };
    }
    return { x: at.x, z: at.z };
  }
  /** Random free point between rMin and rMax metres from `at` (optionally inside bounds {x0,z0,x1,z1}). */
  ringSpot(at, rMin, rMax, bounds) {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2), r = rand(rMin, rMax);
      const x = at.x + Math.sin(a) * r, z = at.z + Math.cos(a) * r;
      if (bounds && (x < bounds.x0 || x > bounds.x1 || z < bounds.z0 || z > bounds.z1)) continue;
      if (this.g.city.pointFree(x, z, 0.7)) return { x, z };
    }
    return this.freeSpot(at, rMin);
  }
  /** A lane position on the road network between dMin and dMax metres from `near` (clear of other cars). */
  roadSpot(near, dMin, dMax) {
    const g = this.g, c = g.city;
    for (let i = 0; i < 30; i++) {
      const [a, b] = c.randomEdge();
      const t = rand(0.1, 0.9), s = c.laneStart(a, b), e = c.laneEnd(a, b);
      const x = s.x + (e.x - s.x) * t, z = s.z + (e.z - s.z) * t;
      const d = dist(x, z, near.x, near.z);
      if (d < dMin || d > dMax) continue;
      if (g.vehicles.some((v) => dist(v.pos.x, v.pos.z, x, z) < 8)) continue;
      return { x, z };
    }
    return null;
  }
  scaled(n, boss) { return boss ? n : Math.max(1, Math.round(n * this.g.diff.enemyCount)); }   // bosses and mini-bosses stay single
  /** Spawn the peds of one spawn spec around `at`; `opts.ring` = [min, max] places them on a ring instead of a scatter. */
  spawnGroup(sp, at, opts = {}) {
    const g = this.g, out = [];
    for (let i = 0, n = this.scaled(sp.n, sp.boss || sp.miniBoss); i < n; i++) {
      const pos = opts.ring ? this.ringSpot(at, opts.ring[0], opts.ring[1], opts.bounds) : this.freeSpot(at, sp.radius || 8);
      const weapon = Array.isArray(sp.weapon) ? choice(sp.weapon) : sp.weapon;
      const p = g.spawnPed(sp.kind || 'gang', pos.x, pos.z, { gang: sp.gang, weapon, hp: sp.hp, boss: sp.boss, miniBoss: sp.miniBoss, tint: sp.tint, scale: sp.scale, name: sp.name, mission: true, alertRange: sp.alertRange || 34, alerted: !!(sp.alerted || opts.alerted) });
      if (sp.lootWeapon) p.lootWeapon = sp.lootWeapon;
      this.mobs.push(p); out.push(p);
    }
    return out;
  }
  /** Gang cars with the 'chase' controller that ram `target` (the Player, or a Vehicle for escort waves). */
  spawnChasers(sp, target) {
    const g = this.g, out = [];
    const near = target.worldPos ? target.worldPos() : target.pos;
    for (let i = 0, n = this.scaled(sp.n); i < n; i++) {
      const spot = this.roadSpot(near, 65, 125) || { x: near.x + 70, z: near.z };
      const type = Array.isArray(sp.vehicle) ? choice(sp.vehicle) : (sp.vehicle || 'sedan');
      const v = g.spawnVehicle(type, spot.x, spot.z, Math.atan2(near.x - spot.x, near.z - spot.z), { color: GANG_CAR[sp.gang], mission: true, hasDriver: true, driverKind: 'gang' });
      v.controller = 'chase'; v.chaseTarget = target; v.chaseGang = sp.gang; v.chaseWeapon = sp.weapon || 'pistol';
      v.onBail = (p) => { this.mobs.push(p); this.stepPeds.push(p); };
      this.spawnedVehicles.push(v); this.stepVehicles.push(v); out.push(v);
    }
    if (sp.duration && this.state) this.later(sp.duration, () => { for (const v of out) if (!v.wrecked && v.controller === 'chase') v.becomeTraffic(); });
    return out;
  }
  /** Run fn `sec` seconds from now, as long as the current step is still the current step. */
  later(sec, fn) { if (this.state) this.state.timers.push({ t: sec, fn }); }
  addCase(x, z) {
    const m = makeCase();
    m.position.set(x, 1, z);
    this.g.scene.add(m);
    this.stepMeshes.push(m);
    return m;
  }

  // ---- step setup ---------------------------------------------------------
  initStep(s) {
    const g = this.g, mid = this.current.id;
    this.state = { s, t: 0, hinted: false, away: 0, timers: [], counter: '' };
    if (s.timeLimit) this.timer = s.timeLimit * g.diff.timeLimit;
    if (s.wanted != null) g.wanted.set(s.wanted);
    if (s.message) g.say(`${mid}.step${this.step}.message`, s.message, s.who || BOSSES[this.current.boss].name);
    g.hud.setObjective(s.text);
    if (s.give) for (const [id, n] of Object.entries(s.give)) g.player.giveWeapon(id, n);
    if (s.select) g.player.selectWeapon(s.select);
    const at = (sp) => (sp.at === 'prev' ? (this.lastPos || this.playerPos()) : sp.at);
    switch (s.type) {
      case 'steal':
        if (s.spawn) {
          const v = g.spawnVehicle(s.vehicle, s.spawn.x, s.spawn.z, s.spawn.yaw, { color: s.color, mission: true, marked: true });
          this.state.vehicle = v; this.spawnedVehicles.push(v); this.markerTarget = v;
        }
        break;
      case 'goto': this.markerTarget = s.at; break;
      case 'kill':
        for (const sp of s.spawns) this.targets.push(...this.spawnGroup(sp, at(sp)));
        this.announceMinis(s);
        break;
      case 'ambush': {
        // alerted gunmen close in on the player's current position (or `at`); a spawn with its own `at` is scattered there instead of ringed
        const centre = s.at || this.playerPos(), r = s.radius || 18;
        for (const sp of s.spawns) this.targets.push(...(sp.at ? this.spawnGroup(sp, sp.at, { alerted: true }) : this.spawnGroup(sp, centre, { ring: [Math.max(10, r * 0.6), r], alerted: true })));
        this.announceMinis(s);
        break;
      }
      case 'destroy': {
        const type = VEHICLE_TYPES[s.vehicle] ? s.vehicle : (s.fallback || 'sedan');
        const v = g.spawnVehicle(type, 0, 0, 0, { color: s.color, mission: true, marked: true, hasDriver: true, driverKind: 'gang' });
        v.setRoute(s.route, s.speed || 16);
        if (s.hp) v.hp = s.hp;
        v.routeEnd = () => { if (this.state && this.state.s === s) this.state.escaped = true; };
        this.state.vehicle = v; this.spawnedVehicles.push(v); this.markerTarget = v;
        for (let i = 0; i < (s.escorts || 0); i++) {
          const f = v.forward;
          const e = g.spawnVehicle('police', v.pos.x - f.x * 9 * (i + 1), v.pos.z - f.z * 9 * (i + 1), v.yaw, { hasDriver: true, driverKind: 'cop', mission: true });
          e.leader = v; e.controller = 'follow'; e.sirenOn = true;
          this.spawnedVehicles.push(e);
        }
        if (s.gift) { // a spare car for the chase, parked where the player is likely to be
          const gv = g.spawnVehicle(s.gift.vehicle, s.gift.at.x, s.gift.at.z, s.gift.at.yaw || 0, {});
          this.spawnedVehicles.push(gv); gv.mission = false;
        }
        break;
      }
      case 'destroyAll': {
        this.state.cars = s.vehicles.map((d) => {
          const type = VEHICLE_TYPES[d.type] ? d.type : 'van';
          const v = g.spawnVehicle(type, d.at.x, d.at.z, d.yaw != null ? d.yaw : (d.at.yaw || 0), { color: d.color, mission: true, marked: true });
          if (d.hp) v.hp = d.hp;
          this.spawnedVehicles.push(v);
          return v;
        });
        break;
      }
      case 'escort': {
        const v = g.spawnVehicle(s.vehicle, 0, 0, 0, { color: s.color, mission: true, marked: true, hasDriver: true, driverKind: 'civ' });
        v.setRoute(s.route, s.speed || 11);
        if (s.hp) v.hp = s.hp;
        v.routeEnd = () => { if (this.state && this.state.s === s) this.state.arrived = true; };
        this.state.vehicle = v; this.spawnedVehicles.push(v); this.markerTarget = v;
        (s.waves || []).forEach((w, k) => this.later(w.after, () => {
          if (w.message) g.say(`${mid}.step${this.step}.wave${k}`, w.message, w.who || s.who || BOSSES[this.current.boss].name);
          g.hud.toast('ATTACKERS INCOMING!');
          this.spawnChasers({ ...w, vehicle: w.vehicle || 'sedan' }, v);
        }));
        break;
      }
      case 'collect': {
        this.state.items = s.items.map((p) => ({ x: p.x, z: p.z, guards: p.guards, got: false, mesh: null, active: false }));
        this.state.got = 0;
        if (!s.sequential) for (let i = 0; i < this.state.items.length; i++) this.activateCase(i);
        else this.activateCase(0);
        break;
      }
      case 'race': {
        this.state.cp = 0;
        this.state.ghost = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.4, 18, 1, true), new THREE.MeshBasicMaterial({ color: '#7fd1ff', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        this.g.scene.add(this.state.ghost); this.stepMeshes.push(this.state.ghost);
        this.raceMarkers();
        break;
      }
      case 'bombEscape': this.state.fuse = s.fuse; break;
      case 'loseWanted': this.markerTarget = g.city.locations.respray; break;
      case 'survive': case 'defend': {
        if (s.type === 'survive' || s.wanted != null) g.wanted.force(s.wanted != null ? s.wanted : 4);
        this.markerTarget = s.at;
        (s.waves || []).forEach((w, k) => this.later(w.after, () => {
          if (w.message) g.say(`${mid}.step${this.step}.wave${k}`, w.message, w.who || s.who || BOSSES[this.current.boss].name);
          const r = (s.radius || 35) * 0.9;
          for (const p of this.spawnGroup({ kind: 'gang', radius: 6, ...w }, s.at || this.playerPos(), { ring: [r * 0.85, r], alerted: true })) this.stepPeds.push(p);
          g.hud.toast('GUNMEN INCOMING!');
        }));
        break;
      }
      default: break;
    }
    if (s.chasers) {
      const c = s.chasers;
      if (c.after) this.later(c.after, () => { this.spawnChasers(c, g.player); g.hud.toast('CARS ON YOUR TAIL!'); });
      else this.spawnChasers(c, g.player);
    }
  }
  /** Mini-bosses / bosses of a kill or ambush step say their `line` (pager + voice id `mX.stepN.miniK`) a moment after they appear. */
  announceMinis(s) {
    const g = this.g, id = `${this.current.id}.step${this.step}.mini`;
    s.spawns.forEach((sp, k) => { if (sp.line) this.later(sp.lineAfter != null ? sp.lineAfter : 1.5, () => g.say(id + k, sp.line, sp.name || 'Boss')); });
  }
  /**
   * Boss script of a kill / ambush step (step.bossScript = [{at: hp fraction, say, toast, weapon, charge, guards}], step.grenades):
   * when the boss ped's hp fraction drops to a phase's `at` the phase fires once: a spoken line (voice id `mX.bossN`), a weapon
   * swap (`weapon` is an id or a list; the first one that exists in WEAPONS wins, so a sword falls back to a shotgun),
   * `charge` (the boss rushes the player), `guards` (spawn() spec: gunmen ring in around the boss, inside the mansion walls
   * when the step has `bounds: 'mansion'`, and must be killed too). `grenades` = {first, every, dmg, radius, fuse}: the boss lobs
   * a telegraphed grenade at the player (red ring on the ground, dodgeable) whenever it has a clear throw.
   */
  tickBoss(s, dt) {
    const g = this.g, st = this.state;
    if (!st.bossPed) st.bossPed = this.targets.find((t) => t.boss) || null;
    const b = st.bossPed;
    this.tickGrenades(dt);
    if (!b || b.dead) return;
    const frac = b.hp / b.maxHp, ph = s.bossScript || [];
    st.phase = st.phase || 0;
    while (st.phase < ph.length && frac <= ph[st.phase].at) this.bossPhase(s, b, ph[st.phase], st.phase++);
    const gr = s.grenades;
    if (gr && b.alerted) {
      st.nadeT = (st.nadeT == null ? (gr.first || 6) : st.nadeT) - dt;
      if (st.nadeT <= 0) {
        const pp = g.player.worldPos(), d = dist(b.pos.x, b.pos.z, pp.x, pp.z);
        if (d > 4 && d < 40 && g.city.lineOfSight(b.pos.x, b.pos.z, pp.x, pp.z)) { st.nadeT = gr.every || 9; this.throwGrenade(b, pp, gr); }
        else st.nadeT = 1; // no clear throw: look again in a second
      }
    }
  }
  bossPhase(s, b, p, n) {
    const g = this.g, mid = this.current.id;
    if (p.say) g.say(`${mid}.boss${n + 1}`, p.say, b.name || 'Boss');
    if (p.toast) g.hud.toast(p.toast, 2.5);
    if (p.weapon) {
      const list = Array.isArray(p.weapon) ? p.weapon : [p.weapon];
      const id = list.find((w) => WEAPONS[w]);
      if (id) { if (!b.lootWeapon) b.lootWeapon = b.weapon; b.weapon = id; }
    }
    if (p.charge) b.charge = true;
    if (p.guards) {
      let bounds = null;
      const H = g.city.mansion;
      if (s.bounds === 'mansion' && H) bounds = { x0: H.ix0 + 1.2, x1: H.ix1 - 1.2, z0: H.iz0 + 1.2, z1: H.iz1 - 1.2 };
      const crowd = this.spawnGroup({ kind: 'gang', radius: 5, ...p.guards }, { x: b.pos.x, z: b.pos.z }, { ring: [p.guards.ringMin || 3, p.guards.ringMax || 8], alerted: true, bounds });
      this.targets.push(...crowd);
    }
  }
  /** Lob a grenade from `b` to `to`: arcs over `fuse` seconds, a red ring marks the blast, then game.explode. */
  throwGrenade(b, to, gr) {
    const g = this.g, st = this.state;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshLambertMaterial({ color: '#3d4a2c' }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(gr.radius * 0.82, gr.radius, 28), new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(to.x, 0.3, to.z);
    g.scene.add(body); g.scene.add(ring);
    this.stepMeshes.push(body, ring);
    (st.nades = st.nades || []).push({ body, ring, from: { x: b.pos.x, z: b.pos.z }, to: { x: to.x, z: to.z }, t: 0, dur: gr.fuse || 1.7, gr, owner: b });
    g.hud.toast('GRENADE! MOVE!', 1.6);
  }
  tickGrenades(dt) {
    const g = this.g, list = this.state && this.state.nades;
    if (!list || !list.length) return;
    for (const n of list) {
      n.t += dt;
      const u = Math.min(1, n.t / n.dur);
      n.body.position.set(n.from.x + (n.to.x - n.from.x) * u, 1.5 + Math.sin(Math.PI * u) * 4.5 - u * 1.2, n.from.z + (n.to.z - n.from.z) * u);
      n.ring.material.opacity = 0.35 + 0.3 * Math.abs(Math.sin(n.t * 9));
      if (u >= 1) {
        g.scene.remove(n.body); g.scene.remove(n.ring);
        g.explode(n.to.x, 0.6, n.to.z, n.gr.radius, n.gr.dmg, n.owner);
        n.done = true;
      }
    }
    this.state.nades = list.filter((n) => !n.done);
  }
  activateCase(i) {
    const it = this.state.items[i], s = this.state.s;
    it.active = true;
    it.mesh = this.addCase(it.x, it.z);
    const gd = it.guards || s.guards;
    if (gd) for (const p of this.spawnGroup({ kind: 'gang', radius: 6, alertRange: 26, ...gd }, it)) this.stepPeds.push(p);
    if (gd && gd.line) this.later(1.2, () => this.g.say(`${this.current.id}.step${this.step}.item${i}.mini`, gd.line, gd.name || 'Boss'));
  }
  raceMarkers() {
    const st = this.state, cps = st.s.checkpoints;
    this.markerTarget = cps[st.cp];
    const nx = cps[st.cp + 1];
    st.ghost.visible = !!nx;
    if (nx) st.ghost.position.set(nx.x, 1.2, nx.z);
  }

  markerPos() {
    const t = this.markerTarget;
    if (!t) return null;
    return t.pos ? t.pos : t;
  }
  /** Append a progress counter to the objective text (only touches the DOM when the text changes). */
  counter(txt) {
    if (this.state.counter === txt) return;
    this.state.counter = txt;
    this.g.hud.setObjective(this.state.s.text + (txt ? `  [${txt}]` : ''));
  }

  // ---- per frame ----------------------------------------------------------
  update(dt) {
    const g = this.g;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.leftovers.length) {
      for (const l of this.leftovers) { l.t -= dt; if (l.t <= 0) l.ped.remove = true; }
      this.leftovers = this.leftovers.filter((l) => l.t > 0 && !l.ped.remove);
    }
    if (!this.current) { this.tickPage(dt); return; }
    const s = this.state.s;
    this.state.t += dt;
    const tm = this.state.timers;
    if (tm.length) {
      const due = [];
      for (const e of tm) { e.t -= dt; if (e.t <= 0) due.push(e); }
      if (due.length) {
        this.state.timers = tm.filter((e) => e.t > 0);
        for (const e of due) { e.fn(); if (!this.current || this.state.s !== s) return; }
      }
    }
    if (this.timer != null) {
      this.timer -= dt;
      g.hud.setTimer(this.timer);
      if (this.timer <= 0) { this.fail(s.failText || 'Out of time.'); return; }
    }
    if (this.vehicle && this.vehicle.wrecked && s.inVehicle === 'mission') { this.fail(this.current.vehicleLost || 'The vehicle is wrecked.'); return; }
    const p = g.player.worldPos();
    switch (s.type) {
      case 'steal': {
        const v = this.state.vehicle;
        if (v) {
          if (v.wrecked) { this.fail(this.current.vehicleLost || 'The car is a wreck.'); return; }
          if (g.player.vehicle === v) { this.vehicle = v; this.complete(s); }
        } else if (g.player.vehicle && (!s.vehicle || g.player.vehicle.typeKey === s.vehicle)) {
          this.vehicle = g.player.vehicle; this.vehicle.mission = true; this.complete(s);
        }
        break;
      }
      case 'goto': {
        const d = dist(p.x, p.z, s.at.x, s.at.z);
        const R = s.radius || 6;
        const vehOk = !s.inVehicle || (s.inVehicle === 'any' ? !!g.player.vehicle : g.player.vehicle === this.vehicle);
        if (d < R) {
          if (vehOk) {
            if (s.inVehicle === 'any') { this.vehicle = g.player.vehicle; this.vehicle.mission = true; }
            this.complete(s);
          } else if (!this.state.hinted) {
            this.state.hinted = true;
            g.hud.toast(s.inVehicle === 'mission' ? 'YOU NEED THE MISSION VEHICLE' : 'YOU NEED A VEHICLE');
          }
        }
        break;
      }
      case 'kill': case 'ambush': {
        if (s.bossScript || s.grenades) this.tickBoss(s, dt);
        const alive = this.targets.filter((t) => !t.dead);
        if (!alive.length) { this.lastPos = this.playerPos(); this.complete(s); break; }
        let best = null, bd = Infinity;
        for (const t of alive) { const d = dist(t.pos.x, t.pos.z, p.x, p.z); if (d < bd) { bd = d; best = t; } }
        this.markerTarget = best;
        this.counter(`${alive.length} LEFT`);
        break;
      }
      case 'destroy': {
        const v = this.state.vehicle;
        if (v.wrecked) { this.lastPos = { x: v.pos.x, z: v.pos.z }; this.complete(s); }
        else if (this.state.escaped) this.fail(s.failText || 'The target got away.');
        break;
      }
      case 'destroyAll': {
        const left = this.state.cars.filter((v) => !v.wrecked && !v.removed);
        if (!left.length) { this.complete(s); break; }
        let best = null, bd = Infinity;
        for (const v of left) { const d = dist(v.pos.x, v.pos.z, p.x, p.z); if (d < bd) { bd = d; best = v; } }
        this.markerTarget = best;
        this.lastPos = { x: best.pos.x, z: best.pos.z };
        this.counter(`${this.state.cars.length - left.length}/${this.state.cars.length}`);
        break;
      }
      case 'escort': {
        const v = this.state.vehicle;
        if (v.wrecked) { this.fail(s.failText || 'The escorted vehicle was destroyed.'); return; }
        if (this.state.arrived) { this.lastPos = { x: v.pos.x, z: v.pos.z }; this.complete(s); break; }
        // the convoy waits for the player instead of driving off alone
        const far = dist(p.x, p.z, v.pos.x, v.pos.z) > 55;
        for (const w of v.route) { if (w._l0 === undefined) w._l0 = w.limit; w.limit = far ? 2 : w._l0; } // far: creep, never stop dead (seek() reverses a car that sits still)
        if (far && !this.state.hinted) { this.state.hinted = true; g.hud.toast('STAY CLOSE TO THE TRUCK'); }
        if (!far) this.state.hinted = false;
        this.counter(`${Math.max(0, v.route.length >> 1)} LEGS LEFT`);
        break;
      }
      case 'collect': {
        const st = this.state, now = performance.now() * 0.001;
        const reach = g.player.vehicle ? CAR_PICKUP : (s.radius || FOOT_PICKUP);
        let near = null, nd = Infinity;
        st.items.forEach((it, i) => {
          if (!it.active || it.got) return;
          it.mesh.rotation.y += dt * 2.2;
          it.mesh.position.y = 1 + Math.sin(now * 3 + i) * 0.15;
          const d = dist(p.x, p.z, it.x, it.z);
          if (d < nd) { nd = d; near = it; }
        });
        if (near && nd < reach) {
          near.got = true; near.active = false; st.got++;
          g.scene.remove(near.mesh);
          g.audio.pickup();
          g.hud.toast(`CASE ${st.got}/${st.items.length}`);
          near = null;
          if (s.sequential && st.got < st.items.length) this.activateCase(st.got);
        }
        if (st.got >= st.items.length) { this.complete(s); break; }
        if (near) this.markerTarget = near;
        else { // nothing active within reach: point at the nearest active case
          let b = null, bd = Infinity;
          for (const it of st.items) if (it.active && !it.got) { const d = dist(p.x, p.z, it.x, it.z); if (d < bd) { bd = d; b = it; } }
          this.markerTarget = b;
        }
        this.counter(`${st.got}/${st.items.length}`);
        break;
      }
      case 'race': {
        const st = this.state, cps = s.checkpoints, cp = cps[st.cp];
        const inV = !s.inVehicle || (s.inVehicle === 'mission' ? g.player.vehicle === this.vehicle : !!g.player.vehicle);
        if (st.ghost) st.ghost.rotation.y += dt;
        if (!inV) {
          if (!st.hinted) { st.hinted = true; g.hud.toast(s.inVehicle === 'mission' ? 'GET BACK IN THE RACE CAR' : 'GET BACK IN A CAR'); }
        } else st.hinted = false;
        this.counter(`${st.cp}/${cps.length}`);
        if (inV && dist(p.x, p.z, cp.x, cp.z) < (s.radius || 10)) {
          st.cp++;
          g.audio.pickup();
          if (st.cp >= cps.length) { this.complete(s); break; }
          g.hud.toast(`GATE ${st.cp}/${cps.length}`, 1.5);
          this.raceMarkers();
        }
        break;
      }
      case 'bombEscape': {
        this.state.fuse -= dt;
        g.hud.setTimer(this.state.fuse);
        if (this.state.fuse <= 0) {
          const v = this.vehicle;
          g.hud.setTimer(null);
          if (v && !v.wrecked) v.explode(null);
          if (!this.current) break; // player was inside: mission already failed
          this.complete(s);
        }
        break;
      }
      case 'loseWanted': if (g.wanted.level === 0) this.complete(s); break;
      case 'survive': case 'defend': {
        g.hud.setTimer(s.duration - this.state.t);
        if (s.at && dist(p.x, p.z, s.at.x, s.at.z) > (s.radius || 35)) {
          this.state.away += dt;
          if (!this.state.hinted) { this.state.hinted = true; g.hud.toast('STAY NEAR THE BANK!'); }
          if (this.state.away > 12) { this.fail('You left the crew behind.'); return; }
        } else this.state.away = 0;
        if (this.state.t >= s.duration) { if (s.type === 'survive' || s.wanted != null) g.wanted.force(0); this.complete(s); }
        break;
      }
      default: break;
    }
  }

  complete(s) {
    const g = this.g;
    if (s.onDone === 'crush') {
      const v = this.vehicle;
      if (v) {
        g.exitVehicle(true);
        g.effects.burst(v.pos.x, 1, v.pos.z, 40, 7, '#9a9a9a', 0.9, 0.35);
        g.audio.carHit(25);
        g.removeVehicle(v);
        this.vehicle = null;
      }
    }
    if (s.doneMessage) g.say(`${this.current.id}.step${this.step}.done`, s.doneMessage, s.doneWho || BOSSES[this.current.boss].name);
    if (s.heat) g.wanted.addHeat(s.heat);
    this.nextStep();
  }
  fail(reason) {
    const g = this.g;
    g.hud.big('MISSION FAILED', reason, 4, 'fail');
    g.audio.missionFail();
    this.cleanup(true);
    this.cooldown = 6;
  }
  pass() {
    const g = this.g, m = this.current;
    const reward = Math.round(m.reward * g.mult * g.diff.reward);
    g.addScore(reward, null);
    g.mult += 1;
    g.save.done.push(m.id);
    // respect: +25 with the boss's gang, -15 with every gang whose members died during the job
    if (g.respect) {
      g.addRespect(m.boss, 25);
      for (const id of this.killedGangs) g.addRespect(id, -15);
    }
    g.saveGame();
    g.hud.big('MISSION PASSED!', `${fmtMoney(reward)}   ·   MULTIPLIER x${g.mult}`, 5, 'pass');
    g.audio.missionPass();
    g.say(`${m.id}.outro`, m.outro, BOSSES[m.boss].name);
    this.cleanup(false);
    this.cooldown = 8;
    if (this.allDone) g.allMissionsDone();
  }
  /** End the mission. Failed: every spawned vehicle and ped is removed (except a car the player is sitting in). */
  cleanup(failed) {
    const g = this.g;
    this.endStep(failed);
    g.hud.setObjective('');
    g.wanted.force(0);
    for (const v of this.spawnedVehicles) {
      v.mission = false; v.marked = false; v.chaseTarget = null; v.onBail = null; v.routeEnd = null;
      if (g.player.vehicle === v) continue;
      if (failed) g.removeVehicle(v);
      else if (v.controller === 'route' || v.controller === 'follow' || v.controller === 'chase') { if (!v.wrecked) v.becomeTraffic(); }
    }
    for (const t of this.mobs) {
      t.mission = false;
      if (t.dead) continue;
      if (failed) t.remove = true; else this.leftovers.push({ ped: t, t: 4 });
    }
    if (this.vehicle) this.vehicle.mission = false;
    this.current = null; this.state = null; this.vehicle = null; this.targets = []; this.mobs = []; this.spawnedVehicles = []; this.stepVehicles = []; this.stepPeds = [];
  }
  onPlayerLost(reason) { if (this.current) this.fail(reason); }
}
