import * as THREE from 'three';
import { rand, segCircle, segAABB, dist, circleAABB } from '../util.js';

export const WEAPONS = {
  fist: { name: 'FISTS', dmg: 18, rate: 0.45, melee: true },
  // Samurai sword: melee, no ammo (Infinity). A swing lasts `swing` s (player time), the hit test is instantaneous at `hitAt` of it:
  // 110 degree arc, 2.2 m reach, every ped in it takes `dmg` (enemies swing for `edmg` at the player), vehicles `vdmg`.
  sword: { name: 'SAMURAI SWORD', dmg: 120, edmg: 26, vdmg: 15, rate: 0.45, swing: 0.45, hitAt: 0.4, reach: 2.2, arc: 110, melee: true, sword: true, sound: 'slash' },
  pistol: { name: 'PISTOL', dmg: 26, rate: 0.26, speed: 150, spread: 0.012, range: 90, ammo: 40, sound: 'pistol' },
  // Dual pistols: two guns firing alternately (twice the rate); `ammoFrom` = they share the pistol ammo pool, `weapons.dual` is a boolean ownership flag.
  dual: { name: 'DUAL PISTOLS', dmg: 26, rate: 0.13, speed: 150, spread: 0.025, range: 90, ammoFrom: 'pistol', sound: 'pistol' },
  uzi: { name: 'MACHINE GUN', dmg: 12, rate: 0.085, speed: 140, spread: 0.045, range: 70, ammo: 120, burst: 5, sound: 'uzi' },
  shotgun: { name: 'SHOTGUN', dmg: 11, rate: 0.85, speed: 120, spread: 0.075, range: 35, ammo: 24, pellets: 8, sound: 'shotgun' },
  // Flamethrower: no projectiles. Combat.fire does a cone test in front of the owner (see flameTick).
  flame: { name: 'FLAMETHROWER', unit: 'FUEL', dmg: 5, vdmg: 3, rate: 0.05, range: 9, cone: 0.35, ammo: 100, burn: 0.5, flame: true, sound: 'flame' },
  rocket: { name: 'ROCKET LAUNCHER', dmg: 120, rate: 1.4, speed: 45, spread: 0.005, range: 120, ammo: 5, rocket: true, sound: 'rocket' },
  // Sticky stick grenade: thrown in an arc (speed 16 m/s + 0.25 up), clings to the first ped / vehicle / wall it touches, explodes `fuse` s after the throw.
  grenade: { name: 'STICK GRENADE', dmg: 140, rate: 0.7, ammo: 6, maxAmmo: 30, grenade: true, throwSpeed: 16, fuse: 2.0, radius: 6, sound: 'throw' },
};
export const GRENADE_G = 22;
/**
 * Throw speed so the arc (launch direction = aim direction with +0.25 up, gravity 22) passes through a target `D` m away horizontally and
 * `H` m above the hand, for an aim direction with vertical component `dy`. Never below the base 16 m/s, capped at 26.
 */
export function grenadeSpeed(D, H = 0, dy = 0) {
  const base = WEAPONS.grenade.throwSpeed;
  const dh = Math.sqrt(Math.max(0, 1 - dy * dy)), len = Math.hypot(dh, dy + 0.25) || 1, uh = dh / len, uy = (dy + 0.25) / len;
  const den = 2 * uh * uh * (D * uy / uh - H);
  if (den < 0.05) return 26;
  return Math.max(base, Math.min(26, Math.sqrt(GRENADE_G * D * D / den)));
}
/** Hit zones by height fraction of the hit box: head shots hurt a lot, limbs less. */
export const ZONE_MULT = { head: 2.6, body: 1, legs: 0.7 };
export const ZONE_MULT_PLAYER = { head: 2.0, body: 1, legs: 0.7 };
export const hitZone = (f) => (f >= 0.78 ? 'head' : f < 0.4 ? 'legs' : 'body');
export const WEAPON_ORDER = ['fist', 'sword', 'pistol', 'dual', 'uzi', 'shotgun', 'flame', 'rocket', 'grenade'];

const TRACERS = 160;
const TRAIL_MAX = 300;      // pooled bullet-trail segments (one instanced mesh)
const TRAIL_LIFE = 0.25;    // seconds (world time) a trail segment takes to fade out
const TRAIL_STEP = 1.2;     // metres of flight per trail segment
const WHIZ_R = 1.2;         // a missing enemy bullet this close to the player's head whizzes
const NEAR_R = 1.0;         // a player bullet this close to a hostile ped makes it strafe

/** Projectiles (visible tracers, dodgeable in bullet time) and melee. */
export class Combat {
  constructor(game) {
    this.game = game;
    this.bullets = [];
    this.pool = [];
    const geo = new THREE.BoxGeometry(0.07, 0.07, 1);
    const mat = new THREE.MeshBasicMaterial({ color: '#fff3b0' });
    const rgeo = new THREE.CylinderGeometry(0.12, 0.12, 0.8, 6);
    rgeo.rotateX(Math.PI / 2);
    const rmat = new THREE.MeshLambertMaterial({ color: '#777' });
    for (let i = 0; i < TRACERS; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      game.scene.add(m);
      this.pool.push(m);
    }
    this.rocketGeo = rgeo; this.rocketMat = rmat;
    this._v = new THREE.Vector3();
    // fading bullet trails: one instanced, additive mesh; colour is scaled by the remaining life (additive = fade)
    this.trailMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), TRAIL_MAX);
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.count = 0;
    game.scene.add(this.trailMesh);
    this.trails = [];
    for (let i = 0; i < TRAIL_MAX; i++) this.trails.push({ life: 0, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, r: 1, g: 1, b: 1 });
    this.trailIdx = 0; this.trailLive = 0;
    this._tm = new THREE.Matrix4(); this._tq = new THREE.Quaternion(); this._tp = new THREE.Vector3(); this._ts = new THREE.Vector3(); this._tc = new THREE.Color(); this._tz = new THREE.Vector3(0, 0, 1); this._td = new THREE.Vector3();
    this.shots = 0;
    // sticky grenades: {x,y,z,vx,vy,vz,t,owner,mesh,led,state:'fly'|'stuck',stuckTo,sKind,oa,ob,oy,beeps,world}
    this.grenades = [];
    const M = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.gGeo = {
      handle: new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), can: new THREE.CylinderGeometry(0.08, 0.08, 0.16, 8), cap: new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), led: new THREE.SphereGeometry(0.025, 6, 4),
    };
    this.gMat = { wood: M('#8a5a2b'), metal: M('#4d5a4a'), band: M('#222') };
    this.grenadeLive = 0;
  }
  /** Number of trail segments currently visible (for tests / profiling). */
  get trailCount() { return this.trailLive; }
  addTrail(x0, y0, z0, x1, y1, z1, enemy) {
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) + Math.abs(z1 - z0) < 0.05) return;
    const t = this.trails[this.trailIdx];
    this.trailIdx = (this.trailIdx + 1) % TRAIL_MAX;
    t.life = TRAIL_LIFE; t.x0 = x0; t.y0 = y0; t.z0 = z0; t.x1 = x1; t.y1 = y1; t.z1 = z1;
    if (enemy) { t.r = 1; t.g = 0.5; t.b = 0.3; } else { t.r = 1; t.g = 0.85; t.b = 0.45; }
  }
  updateTrails(dt) {
    const m = this.trailMesh, ts = this.trails;
    let live = 0;
    for (let i = 0; i < TRAIL_MAX; i++) {
      const t = ts[i];
      if (t.life > 0) t.life -= dt;
      if (t.life <= 0) { if (t.life > -1) { this._tm.makeScale(0, 0, 0); m.setMatrixAt(i, this._tm); this._tc.setRGB(0, 0, 0); m.setColorAt(i, this._tc); t.life = -1; } continue; }
      live++;
      const a = (t.life / TRAIL_LIFE) * 0.7;
      const d = this._td.set(t.x1 - t.x0, t.y1 - t.y0, t.z1 - t.z0);
      const len = d.length() || 0.001;
      this._tq.setFromUnitVectors(this._tz, d.multiplyScalar(1 / len));
      this._tp.set((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2);
      this._ts.set(0.05, 0.05, len);
      this._tm.compose(this._tp, this._tq, this._ts);
      m.setMatrixAt(i, this._tm);
      this._tc.setRGB(t.r * a, t.g * a, t.b * a);
      m.setColorAt(i, this._tc);
    }
    this.trailLive = live;
    m.count = live > 0 || this._trailDirty ? TRAIL_MAX : 0;
    this._trailDirty = live > 0;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  acquireTracer(rocket) {
    if (rocket) {
      const m = new THREE.Mesh(this.rocketGeo, this.rocketMat);
      this.game.scene.add(m);
      return m;
    }
    for (const m of this.pool) if (!m.visible) { m.visible = true; return m; }
    return null;
  }
  releaseTracer(b) {
    if (!b.mesh) return;
    if (b.rocket) this.game.scene.remove(b.mesh);
    else b.mesh.visible = false;
    b.mesh = null;
  }

  /** owner: Ped. from: Vector3. dir: Vector3 (normalised). Returns the projectiles created (empty for the flamethrower). */
  fire(owner, from, dir, weaponId, opts = {}) {
    const w = WEAPONS[weaponId];
    const g = this.game;
    if (w.flame) { this.flameTick(owner, from, dir, w); return []; }
    if (w.grenade) { this.throwGrenade(owner, from, dir, { speed: opts.speed }); return []; }
    if (w.melee) return [];   // swords / fists are swung (Ped.startSwing / melee), never fired
    const n = w.pellets || 1;
    const spread = w.spread + (opts.spread || 0);
    const made = [];
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(dir.x + rand(-spread, spread), dir.y + rand(-spread, spread) * 0.6, dir.z + rand(-spread, spread)).normalize();
      const b = {
        x: from.x, y: from.y, z: from.z,
        vx: d.x * w.speed, vy: d.y * w.speed, vz: d.z * w.speed,
        life: w.range / w.speed, dmg: w.dmg, owner, rocket: !!w.rocket, mesh: this.acquireTracer(w.rocket), smokeT: 0,
        tx: from.x, ty: from.y, tz: from.z, enemy: !(owner && owner.isPlayer), whizzed: false, done: false, hit: null,
      };
      this.bullets.push(b);
      made.push(b);
    }
    this.shots++;
    g.effects.muzzle(from.x, from.y, from.z);
    const pl = g.player.worldPos();
    g.audio.gunshot(w.sound, dist(pl.x, pl.z, from.x, from.z));
    g.noise(from.x, from.z, 40, owner);
    if (owner && owner.isPlayer && !w.rocket) this.alertTargets(from, dir);
    return made;
  }

  /** The player fired along `dir`: some hostile gang members in the line of fire (> 8 m away) hop sideways (see Ped.tryDodge). */
  alertTargets(from, dir) {
    const hl = Math.hypot(dir.x, dir.z);
    if (hl < 0.05) return;
    const hx = dir.x / hl, hz = dir.z / hl;
    for (const p of this.game.peds) {
      if (p.dead || p.kind !== 'gang' || !p.alerted) continue;
      const vx = p.pos.x - from.x, vz = p.pos.z - from.z, d = Math.hypot(vx, vz);
      if (d < 8 || d > 45) continue;
      const along = vx * hx + vz * hz;
      if (along <= 0 || Math.abs(vx * -hz + vz * hx) > 1.2 + d * 0.04) continue; // within ~1.2 m + a little of the line of fire
      p.tryDodge(hx, hz);
    }
  }

  /** One flamethrower tick: spawn fire particles along the cone and damage everything inside it. */
  flameTick(owner, from, dir, w) {
    const g = this.game, fx = g.effects;
    let hx = dir.x, hz = dir.z;
    const hl = Math.hypot(hx, hz);
    if (hl < 0.05) { hx = Math.sin(owner.yaw || 0); hz = Math.cos(owner.yaw || 0); } else { hx /= hl; hz /= hl; }
    const now = performance.now();
    // fire particles: a stream of short-lived embers fanned across the cone
    const colors = ['#ff7a1a', '#ff7a1a', '#ffd23a', '#ffd23a', '#333333'];
    for (let i = 0; i < 7; i++) {
      const sp = rand(9, 15), a = rand(-w.cone, w.cone) * 0.8, e = rand(-w.cone, w.cone) * 0.6;
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = hx * ca - hz * sa, dz = hx * sa + hz * ca;
      const col = colors[Math.floor(Math.random() * colors.length)];
      fx.spawn(from.x + dx * 0.6, from.y - 0.1, from.z + dz * 0.6, dx * sp, (dir.y + e) * sp * 0.9 + 0.8, dz * sp, rand(0.28, 0.6), col, col === '#333333' ? rand(0.2, 0.4) : rand(0.25, 0.5), 1.5, 0.6);
    }
    // damage in the cone
    const cone = w.cone, range = w.range;
    const inCone = (x, z, r) => {
      const vx = x - from.x, vz = z - from.z;
      const d = Math.hypot(vx, vz);
      if (d > range + r) return false;
      if (d < r + 0.6) return true;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * hx + vz * hz) / d)));
      return ang < cone + Math.atan(r / d);
    };
    for (const p of g.peds) {
      if (p.dead || p === owner || p.isPlayer) continue;
      if (owner && p.kind === owner.kind && p.kind !== 'civ') continue;
      if (!inCone(p.pos.x, p.pos.z, 0.45)) continue;
      if (!g.world.lineOfSight(from.x, from.z, p.pos.x, p.pos.z)) continue;
      p.burning = 3; p.burnOwner = owner;
      if (!(p._flameAt > now - 200)) {
        p._flameAt = now;
        p.damage(w.dmg, owner, { x: hx * 20, z: hz * 20 });
      }
    }
    for (const v of g.vehicles) {
      if (v.wrecked || (owner && owner.vehicle === v)) continue;
      if (dist(v.pos.x, v.pos.z, from.x, from.z) > range + v.type.len) continue;
      let hit = false;
      for (const c of v.circles()) if (inCone(c.x, c.z, c.r)) { hit = true; break; }
      if (!hit || v._flameAt > now - 200) continue;
      v._flameAt = now;
      v.damage(w.vdmg, owner);
      g.effects.smoke(v.pos.x, 1.2, v.pos.z, true);
    }
    // sound + mild noise (throttled)
    this.flameOn = 0.15;
    if (!this.flameLoop) { this.flameLoop = true; if (g.audio.flame) g.audio.flame(true); }
    if (!g.audio.flame && !(this._flameSnd > now - 120)) { this._flameSnd = now; g.audio.noise(0.14, { f: 1400, g: 0.22, type: 'bandpass', q: 0.7 }); }
    if (!(this._flameNoise > now - 400)) { this._flameNoise = now; g.noise(from.x, from.z, 14, owner); }
  }

  stopFlame() {
    if (!this.flameLoop) return;
    this.flameLoop = false; this.flameOn = 0;
    if (this.game.audio.flame) this.game.audio.flame(false);
  }

  melee(owner, dir) {
    const g = this.game;
    const fx = owner.pos.x + dir.x * 1.1, fz = owner.pos.z + dir.z * 1.1;
    let hit = false;
    for (const p of g.peds) {
      if (p.dead || p === owner) continue;
      if (dist(p.pos.x, p.pos.z, fx, fz) < 1.1) {
        p.damage(WEAPONS.fist.dmg * (owner && owner.isPlayer && g.hero ? g.hero.meleeMult : 1) * (owner && owner.isPlayer && g.cheats && g.cheats.on.superpunch ? 10 : 1), owner, dir);
        g.effects.blood(p.pos.x, 1.2, p.pos.z);
        hit = true;
      }
    }
    for (const v of g.vehicles) {
      if (!v.wrecked && v.containsPoint(fx, fz, 0.3)) { v.damage(4, owner); g.effects.spark(fx, 1, fz); hit = true; }
    }
    g.audio.gunshot(hit ? 'fist' : 'fist');
    return hit;
  }

  /**
   * Sword hit test, called once at 40% of a swing: everything within `reach` and the 110 degree arc in front of `owner`
   * (facing `yaw`, `side` 0 right / 1 left) is hit at the same instant. The player's sword hits every ped (120 dmg) and vehicles (15);
   * an enemy's only hits the player (and his car). Returns { hits, kills }.
   */
  slash(owner, yaw, side = 0) {
    const g = this.game, w = WEAPONS.sword, pl = g.player;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = -fz * (side ? -1 : 1), lz = fx * (side ? -1 : 1);   // lateral = the way the blade travels
    const half = (w.arc / 2) * Math.PI / 180, ox = owner.pos.x, oz = owner.pos.z;
    const inArc = (x, z, r) => {
      const vx = x - ox, vz = z - oz, d = Math.hypot(vx, vz);
      if (d > w.reach + r) return false;
      if (d < r + 0.5) return true;
      return Math.acos(Math.max(-1, Math.min(1, (vx * fx + vz * fz) / d))) < half + Math.atan(r / d);
    };
    const isPl = !!owner.isPlayer;
    let hits = 0, kills = 0;
    g.effects.slashArc(ox, owner.y + 0.9, oz, yaw, side);
    if (isPl) {
      const mult = (g.hero ? g.hero.meleeMult : 1) * (g.cheats && g.cheats.on.superpunch ? 10 : 1);
      for (const p of g.peds) {
        if (p.dead || p === owner || p.vehicle) continue;
        if (Math.abs(p.y - owner.y) > 1.5 || !inArc(p.pos.x, p.pos.z, 0.4)) continue;
        if (!g.world.lineOfSight(ox, oz, p.pos.x, p.pos.z)) continue;
        const dx = p.pos.x - ox, dz = p.pos.z - oz, dl = Math.hypot(dx, dz) || 1;
        // flung along the swing: forward plus the blade's lateral sweep
        const fling = { x: (fx * 0.8 + lx * 0.5 + dx / dl * 0.4) * 230, z: (fz * 0.8 + lz * 0.5 + dz / dl * 0.4) * 230 };
        const wasDead = p.dead;
        p.damage(w.dmg * mult, owner, fling, 'slash');
        g.effects.blood(p.pos.x, p.y + 1.2, p.pos.z);
        hits++;
        if (p.hp <= 0 && !wasDead) {
          kills++;
          g.effects.blood(p.pos.x, p.y + 1.0, p.pos.z); g.effects.blood(p.pos.x + fx * 0.3, p.y + 1.4, p.pos.z + fz * 0.3);
          g.effects.burst(p.pos.x, p.y + 1.2, p.pos.z, 14, 7, '#b3121b', 0.7, 0.14, { grav: 18 });
          if (p.dismember && Math.random() < 0.45) p.dismember(fling);
        }
      }
      if (kills && pl.btActive) pl.addBullet(0.2);   // bullet time: a slash kill refills the hourglass
    } else if (!pl.dead && !pl.vehicle && Math.abs(pl.ped.y - owner.y) < 1.5 && inArc(pl.ped.pos.x, pl.ped.pos.z, 0.4) && g.world.lineOfSight(ox, oz, pl.ped.pos.x, pl.ped.pos.z)) {
      pl.damage(w.edmg, owner);
      g.effects.blood(pl.ped.pos.x, pl.ped.y + 1.2, pl.ped.pos.z);
      hits++;
    }
    for (const v of g.vehicles) {
      if (v.wrecked || owner.vehicle === v || (!isPl && pl.vehicle !== v)) continue;
      if (dist(v.pos.x, v.pos.z, ox, oz) > v.type.len + w.reach) continue;
      for (const c of v.circles()) {
        if (!inArc(c.x, c.z, c.r)) continue;
        v.damage(w.vdmg, owner);
        g.effects.spark(c.x, owner.y + 1, c.z); g.effects.spark(c.x, owner.y + 0.8, c.z);
        hits++;
        break;
      }
    }
    if (hits) g.audio.thud(0);
    g.noise(ox, oz, 10, owner);
    return { hits, kills };
  }

  /** Bullet-time sword block: an enemy bullet from the front (within 60 degrees) has a 35% chance to be deflected while the player stands still with the sword. */
  deflects(b) {
    const pl = this.game.player;
    if (!b.enemy || b.rocket || pl.weaponId !== 'sword' || !pl.btActive || pl.dodge || pl.ped.speed > 0.6) return false;
    const sp = Math.hypot(b.vx, b.vz) || 1;
    const cos = -(b.vx * Math.sin(pl.yaw) + b.vz * Math.cos(pl.yaw)) / sp;
    return cos >= 0.5 && Math.random() < 0.35;
  }

  // ---- sticky stick grenades ----------------------------------------------------------------
  /** Throw a grenade from `from` along `dir` (an extra 0.25 is added to the up component). opts.speed overrides the 16 m/s. */
  throwGrenade(owner, from, dir, opts = {}) {
    const g = this.game, w = WEAPONS.grenade;
    const v = new THREE.Vector3(dir.x, dir.y + 0.25, dir.z).normalize().multiplyScalar(opts.speed || w.throwSpeed);
    const mesh = new THREE.Group();
    const handle = new THREE.Mesh(this.gGeo.handle, this.gMat.wood); handle.rotation.x = Math.PI / 2; mesh.add(handle);
    const can = new THREE.Mesh(this.gGeo.can, this.gMat.metal); can.rotation.x = Math.PI / 2; can.position.z = 0.18; mesh.add(can);
    const band = new THREE.Mesh(this.gGeo.cap, this.gMat.band); band.rotation.x = Math.PI / 2; band.position.z = 0.18; band.scale.set(1.7, 1.4, 1.7); mesh.add(band);
    const ledMat = new THREE.MeshBasicMaterial({ color: '#3a0000' });
    const led = new THREE.Mesh(this.gGeo.led, ledMat); led.position.set(0, 0.085, 0.18); mesh.add(led);
    mesh.scale.setScalar(1.6);
    g.scene.add(mesh);
    const gr = { x: from.x, y: from.y, z: from.z, vx: v.x, vy: v.y, vz: v.z, t: 0, owner, mesh, ledMat, state: 'fly', stuckTo: null, sKind: '', oa: 0, ob: 0, oy: 0, beeps: 0, ledT: 0, spin: 0, yaw: Math.atan2(v.x, v.z), world: g.world };
    mesh.position.set(gr.x, gr.y, gr.z);
    this.grenades.push(gr);
    const pp = g.player.worldPos();
    g.audio.gunshot('throw', dist(pp.x, pp.z, from.x, from.z));
    g.noise(from.x, from.z, 14, owner);
    return gr;
  }

  /** Attach `gr` where it is: kind 'ped' | 'vehicle' (rides along via a local offset) or 'wall' | 'ground' (stays put). */
  stickGrenade(gr, kind, target) {
    const g = this.game;
    gr.state = 'stuck'; gr.vx = gr.vy = gr.vz = 0; gr.sKind = kind; gr.stuckTo = target || null;
    if (kind === 'ped') {
      const p = target, dx = gr.x - p.pos.x, dz = gr.z - p.pos.z, d = Math.hypot(dx, dz) || 1, k = Math.min(1, 0.32 / d);
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      gr.oa = (dx * fx + dz * fz) * k; gr.ob = (dx * -fz + dz * fx) * k;   // body-local offset, kept on the surface
      gr.oy = Math.max(0.5, Math.min(1.6, gr.y - p.y));
      p.stickPanic = Math.max(p.stickPanic || 0, 2.2);   // panic: the ped runs (Ped.updateStickyRun)
      if (p.kind === 'civ') { p.panic = Math.max(p.panic, 4); p.threat = { x: gr.x - gr.vx, z: gr.z - gr.vz }; }
      p.alerted = true;
      if (p.isPlayer) g.hud.toast('STUCK!', 1.2);
    } else if (kind === 'vehicle') {
      const v = target, f = v.forward, r = v.right, dx = gr.x - v.pos.x, dz = gr.z - v.pos.z;
      gr.oa = Math.max(-v.type.len / 2, Math.min(v.type.len / 2, dx * f.x + dz * f.z));
      gr.ob = Math.max(-v.type.wid / 2, Math.min(v.type.wid / 2, dx * r.x + dz * r.z));
      gr.oy = Math.max(0.3, Math.min(v.type.h, gr.y));
    }
    g.effects.spark(gr.x, gr.y, gr.z);
    if (g.audio.thud) g.audio.thud(0);
  }

  flyGrenade(gr, dt) {
    const g = this.game, w = g.world, pl = g.player;
    const sp = Math.hypot(gr.vx, gr.vy, gr.vz);
    const n = Math.max(1, Math.ceil(sp * dt / 0.3)), h = dt / n;
    for (let s = 0; s < n && gr.state === 'fly'; s++) {
      const py = gr.y;
      gr.vy -= GRENADE_G * h;
      gr.x += gr.vx * h; gr.y += gr.vy * h; gr.z += gr.vz * h;
      // walls (buildings, fences, crates): clings at the surface
      for (const b of w.query(gr.x, gr.z, 0.5)) {
        if (b.h <= gr.y - 0.1) continue;
        const p = circleAABB(gr.x, gr.z, 0.18, b);
        if (p) { gr.x += p.px; gr.z += p.pz; this.stickGrenade(gr, 'wall'); return; }
      }
      // ground / a roof or crate top it came down onto
      const gh = w.groundHeight(gr.x, gr.z, 1e3);
      if (gr.vy <= 0 && gr.y <= gh + 0.1 && py >= gh - 0.05) { gr.y = gh + 0.1; this.stickGrenade(gr, 'ground'); return; }
      if (gr.y <= 0.1) { gr.y = 0.1; this.stickGrenade(gr, 'ground'); return; }
      // peds
      for (const p of g.peds) {
        if (p.dead || p === gr.owner || p.vehicle) continue;
        if (Math.abs(p.pos.x - gr.x) > 0.7 || Math.abs(p.pos.z - gr.z) > 0.7) continue;
        if (Math.hypot(p.pos.x - gr.x, p.pos.z - gr.z) < 0.6 && gr.y >= p.y - 0.1 && gr.y <= p.y + 1.9) { this.stickGrenade(gr, 'ped', p); return; }
      }
      if (!pl.vehicle && !pl.dead && gr.owner !== pl.ped && Math.hypot(pl.ped.pos.x - gr.x, pl.ped.pos.z - gr.z) < 0.6 && gr.y >= pl.ped.y - 0.1 && gr.y <= pl.ped.y + pl.hitTop()) { this.stickGrenade(gr, 'ped', pl.ped); return; }
      // vehicles
      for (const v of g.vehicles) {
        if (gr.owner && gr.owner.vehicle === v) continue;
        if (Math.abs(v.pos.x - gr.x) > v.type.len || Math.abs(v.pos.z - gr.z) > v.type.len) continue;
        if (gr.y <= v.type.h + 0.2 && v.containsPoint(gr.x, gr.z, 0.2)) { this.stickGrenade(gr, 'vehicle', v); return; }
      }
    }
  }

  followGrenade(gr) {
    const t = gr.stuckTo;
    if (!t) return;
    if (gr.sKind === 'ped') {
      const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw), lie = t.dead ? Math.min(1, t.deadTime * 3.5) : 0;
      gr.x = t.pos.x + fx * gr.oa - fz * gr.ob; gr.z = t.pos.z + fz * gr.oa + fx * gr.ob;
      gr.y = t.y + (t.yOffset || 0) + gr.oy * (1 - lie) + 0.25 * lie;
    } else if (gr.sKind === 'vehicle') {
      const f = t.forward, r = t.right;
      gr.x = t.pos.x + f.x * gr.oa + r.x * gr.ob; gr.z = t.pos.z + f.z * gr.oa + r.z * gr.ob; gr.y = gr.oy;
    }
  }

  updateGrenades(dt) {
    const g = this.game, W = WEAPONS.grenade, gs = this.grenades;
    this.grenadeLive = gs.length;
    for (let i = gs.length - 1; i >= 0; i--) {
      const gr = gs[i];
      if (gr.world !== g.world) { gr.mesh.visible = false; continue; }   // thrown in the city while the player is inside a shop: frozen until back
      gr.mesh.visible = true;
      gr.t += dt;
      if (gr.state === 'fly') {
        this.flyGrenade(gr, dt);
        gr.spin += dt * 14;
      } else this.followGrenade(gr);
      // two beeps with a red blink before the bang
      if (gr.beeps < 2 && gr.t >= (gr.beeps ? 1.6 : 1.1)) {
        gr.beeps++; gr.ledT = 0.14;
        const pp = g.player.worldPos();
        g.audio.beep(dist(pp.x, pp.z, gr.x, gr.z));
      }
      if (gr.ledT > 0) { gr.ledT -= dt; gr.ledMat.color.set(gr.ledT > 0 ? '#ff2a1a' : '#3a0000'); }
      if (gr.t >= W.fuse) {
        gs.splice(i, 1);
        g.scene.remove(gr.mesh); gr.ledMat.dispose();
        g.explode(gr.x, Math.max(0.4, gr.y), gr.z, W.radius, W.dmg, gr.owner, null);
        if (gr.sKind === 'vehicle' && gr.stuckTo && !gr.stuckTo.wrecked) gr.stuckTo.damage(120, gr.owner);   // a bomb on the bodywork wrecks it
        continue;
      }
      const m = gr.mesh;
      m.position.set(gr.x, gr.y, gr.z);
      if (gr.state === 'fly') { m.rotation.set(gr.spin, gr.yaw, 0, 'YXZ'); }
      else if (gr.sKind === 'wall' || gr.sKind === 'ground') m.rotation.set(Math.PI / 2 * (gr.sKind === 'ground' ? 1 : 0.5), gr.yaw, 0, 'YXZ');
    }
  }

  update(dt) {
    const g = this.game, city = g.world; // city, or the room while inside a shop
    if (this.flameLoop) {
      this.flameOn -= dt;
      if (this.flameOn <= 0) { this.flameLoop = false; if (g.audio.flame) g.audio.flame(false); }
    }
    const bs = this.bullets;
    const plr = g.player, head = this._head || (this._head = new THREE.Vector3());
    head.set(plr.ped.pos.x, plr.ped.y + 1.65 - 1.2 * plr.low, plr.ped.pos.z);
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      const px = b.x, py = b.y, pz = b.z;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.life -= dt;
      let hit = null; // {x,y,z,kind}
      let tBest = 1;
      // ground
      if (b.y <= 0) { const t = py / (py - b.y || 1e-6); hit = { t, kind: 'ground' }; tBest = t; }
      // buildings
      const boxes = city.queryRect(Math.min(px, b.x), Math.min(pz, b.z), Math.max(px, b.x), Math.max(pz, b.z));
      for (const box of boxes) {
        const t = segAABB(px, pz, b.x, b.z, box);
        if (t !== null && t < tBest) {
          const hy = py + (b.y - py) * t;
          if (hy <= box.h) { tBest = t; hit = { t, kind: 'wall' }; }
        }
      }
      // peds
      if (b.y < 5 && b.y > -0.5) { // ped feet can be elevated (jump / crates), so the gate is generous
        for (const p of g.peds) {
          if (p.dead || p === b.owner) continue;
          if (b.owner && !b.rocket && p.kind === b.owner.kind && p.kind !== 'civ') continue; // no friendly fire among cops / gangs
          const t = segCircle(px, pz, b.x, b.z, p.pos.x, p.pos.z, 0.5);
          if (t !== null && t < tBest) { const hy = py + (b.y - py) * t; if (hy >= p.y && hy <= p.y + 1.9) { tBest = t; hit = { t, kind: 'ped', ped: p, zone: hitZone((hy - p.y) / 1.9) }; } }
        }
        const pl = g.player;
        if (!pl.vehicle && !pl.dead && b.owner !== pl.ped) {
          const t = segCircle(px, pz, b.x, b.z, pl.ped.pos.x, pl.ped.pos.z, 0.5);
          if (t !== null && t < tBest) {
            const hy = py + (b.y - py) * t;
            const top = pl.ped.y + pl.hitTop(); // 0.7 m when prone, 1.9 m standing; measured from the feet height
            if (hy >= pl.ped.y && hy <= top) { tBest = t; hit = { t, kind: 'player', zone: hitZone((hy - pl.ped.y) / (top - pl.ped.y)) }; }
          }
        }
      }
      // vehicles
      if (b.y < 3.2) {
        for (const v of g.vehicles) {
          if (b.owner && b.owner.vehicle === v) continue;
          if (dist(v.pos.x, v.pos.z, b.x, b.z) > v.type.len + 2) continue;
          for (const c of v.circles()) {
            const t = segCircle(px, pz, b.x, b.z, c.x, c.z, c.r);
            if (t !== null && t < tBest) { const hy = py + (b.y - py) * t; if (hy <= v.type.h + 0.4) { tBest = t; hit = { t, kind: 'vehicle', vehicle: v }; } }
          }
        }
      }
      if (!b.rocket) this.bulletPasses(b, px, py, pz, hit ? hit.t : 1, hit, head);
      if (hit) {
        const hx = px + (b.x - px) * hit.t, hy = py + (b.y - py) * hit.t, hz = pz + (b.z - pz) * hit.t;
        b.done = true; b.hit = hit; b.hx = hx; b.hy = hy; b.hz = hz;
        if (!b.rocket) if (!b.noTrail) this.addTrail(b.tx, b.ty, b.tz, hx, hy, hz, b.enemy);
        if (b.rocket) {
          g.explode(hx, hy, hz, 6.5, b.dmg, b.owner, null);
        } else {
          switch (hit.kind) {
            case 'ped': {
              const m = ZONE_MULT[hit.zone] || 1;
              hit.ped.damage(b.dmg * m, b.owner, { x: b.vx, z: b.vz });
              g.effects.blood(hx, hy, hz);
              if (hit.zone === 'head') { g.effects.blood(hx, hy + 0.15, hz); if (b.owner && b.owner.isPlayer) g.onHeadshot(hit.ped); }
              break;
            }
            case 'player': {
              if (this.deflects(b)) { g.effects.spark(hx, hy, hz); g.effects.spark(hx, hy + 0.1, hz); if (g.audio.whiz) g.audio.whiz(); break; }
              let m = ZONE_MULT_PLAYER[hit.zone] || 1;
              if (hit.zone === 'head' && g.player.armorTier >= 2 && g.player.armor > 0) m = 1.3; // helmet
              g.player.damage(b.dmg * m, b.owner);
              g.effects.blood(hx, hy, hz);
              if (hit.zone === 'head') g.hud.toast('HEADSHOT!', 1.2);
              break;
            }
            case 'vehicle': hit.vehicle.damage(b.dmg * 0.45, b.owner, 'bullet'); g.effects.spark(hx, hy, hz); break;
            case 'ground': g.effects.dust(hx, 0.1, hz); break;
            default: g.effects.spark(hx, hy, hz);
          }
        }
        this.releaseTracer(b);
        bs.splice(i, 1);
        continue;
      }
      if (b.life <= 0) { b.done = true; b.hx = b.x; b.hy = b.y; b.hz = b.z; if (b.rocket) g.explode(b.x, b.y, b.z, 6.5, b.dmg, b.owner, null); else if (!b.noTrail) this.addTrail(b.tx, b.ty, b.tz, b.x, b.y, b.z, b.enemy); this.releaseTracer(b); bs.splice(i, 1); continue; }
      if (!b.rocket && (b.x - b.tx) ** 2 + (b.y - b.ty) ** 2 + (b.z - b.tz) ** 2 >= TRAIL_STEP * TRAIL_STEP) {
        if (!b.noTrail) this.addTrail(b.tx, b.ty, b.tz, b.x, b.y, b.z, b.enemy);
        b.tx = b.x; b.ty = b.y; b.tz = b.z;
      }
      if (b.mesh) {
        b.mesh.position.set(b.x, b.y, b.z);
        this._v.set(b.x + b.vx, b.y + b.vy, b.z + b.vz);
        b.mesh.lookAt(this._v);
        if (!b.rocket) b.mesh.scale.z = 0.9 + Math.min(1.6, 0.012 * Math.hypot(b.vx, b.vy, b.vz));
        else { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.03; g.effects.smoke(b.x, b.y, b.z); } }
      }
    }
    this.updateTrails(dt);
    this.updateGrenades(dt);
  }

  /**
   * Per-step flyby effects for a bullet that moved (px,py,pz) -> (b.x,b.y,b.z), clipped to fraction `t`:
   * an enemy bullet that misses the player's head by < 1.2 m whizzes (once) and leaves an air ripple;
   * a player bullet passing < 1 m from a hostile ped makes it strafe.
   */
  bulletPasses(b, px, py, pz, t, hit, head) {
    const g = this.game;
    const ex = px + (b.x - px) * t, ey = py + (b.y - py) * t, ez = pz + (b.z - pz) * t;
    const sx = ex - px, sy = ey - py, sz = ez - pz;
    const l2 = sx * sx + sy * sy + sz * sz || 1e-6;
    const pl = g.player;
    if (b.enemy && !b.whizzed && !pl.vehicle && !pl.dead && !(hit && hit.kind === 'player')) {
      const u = clampT(((head.x - px) * sx + (head.y - py) * sy + (head.z - pz) * sz) / l2);
      const cx = px + sx * u, cy = py + sy * u, cz = pz + sz * u;
      if ((cx - head.x) ** 2 + (cy - head.y) ** 2 + (cz - head.z) ** 2 < WHIZ_R * WHIZ_R) {
        b.whizzed = true;
        if (g.audio.whiz) g.audio.whiz();
        g.effects.ripple(cx, cy, cz, b.vx, b.vy, b.vz);
      }
    } else if (!b.enemy && b.owner && b.owner.isPlayer) {
      for (const p of g.peds) {
        if (p.dead || p.kind === 'civ' || p === b.owner || (hit && hit.ped === p)) continue;
        if (!(p.alerted || p.angry || p.mission)) continue;
        if (Math.abs(p.pos.x - px) > 70 || Math.abs(p.pos.z - pz) > 70) continue;
        const u = clampT(((p.pos.x - px) * sx + (p.pos.z - pz) * sz) / ((sx * sx + sz * sz) || 1e-6));
        const cx = px + sx * u, cz = pz + sz * u;
        if ((cx - p.pos.x) ** 2 + (cz - p.pos.z) ** 2 < NEAR_R * NEAR_R) p.nearMiss(b.vx, b.vz);
      }
    }
  }
}
const clampT = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
