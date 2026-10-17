import * as THREE from 'three';
import { Ped } from './ped.js';
import { WEAPONS, WEAPON_ORDER, grenadeSpeed } from '../systems/combat.js';
import { clamp } from '../util.js';

// Bullet-time meter and painkiller tuning
export const BT_DRAIN = 1 / 9;        // meter per real second while active (9 s from full)
export const BT_REGEN = 0.045;        // meter per real second while inactive (~22 s from empty)
export const BT_MIN = 0.1;            // below this, entering bullet time is refused
const BT_FREE_PRONE = 1.5;            // dodge-started BT stays free this long after landing
export const PILL_HEAL = 35;          // hp per painkiller
export const PILL_TIME = 1.2;         // seconds the heal takes
export const ASSIST_MAX_MISS = 0.3;   // aim assist: a locked shot ends at most this far (m) from the target's chest

export class Player {
  constructor(game, x, z) {
    this.game = game;
    this.ped = new Ped(game, 'player', x, z);
    this.ped.weapon = 'pistol';
    this.hp = 100;
    this.armor = 0;
    this.armorTier = 0;      // 0 none, 1 vest (100), 2 heavy vest + helmet (150)
    this.weapons = { fist: Infinity, pistol: 40 };
    this.weaponId = 'pistol';
    this.vehicle = null;
    this.bt = 1;             // bullet-time meter 0..1 (hourglass)
    this.btActive = false;
    this.dodgeBT = false;    // bullet time was started by a shoot-dodge (free while airborne, see updateMeters)
    this.jumpBT = null;      // Shift+Space bullet-time jump in progress {engaged} (free while airborne, see FootMode.startJumpBT)
    this.aimTarget = null;   // hostile ped under the aim-assist soft lock (set every frame by FootMode.findAimTarget)
    this.painkillers = 1;    // 0..9, H / PILLS heals 35 hp over 1.2 s
    this.healT = 0;          // seconds of painkiller healing left
    this.dualSide = 0;       // alternating muzzle of the dual pistols
    this.swingSide = 0;      // alternating left / right sword swings
    this._dryT = 0;
    this.dodge = null;       // shoot-dodge state {t, phase:'fly'|'prone'|'getup', low:0..1, dir:{x,z}, ...} (see FootMode)
    this.fireTimer = 0;
    this.yaw = Math.PI;      // camera / facing yaw
    this.pitch = 0.12;
    this.bustProgress = 0;
    this.dead = false;
    this.invuln = 0;
    this.stolenTypes = new Set();
    this.hurtT = 0;
  }
  get weapon() { return WEAPONS[this.weaponId]; }
  /** Rounds for the current weapon (dual pistols read the pistol pool). */
  get ammo() { const w = this.weapon; return this.weapons[w.ammoFrom || this.weaponId] ?? 0; }
  get inVehicle() { return !!this.vehicle; }
  worldPos() { return this.vehicle ? this.vehicle.pos : this.ped.pos; }
  /** 0 = standing, 1 = lying prone (shoot-dodge); drives hit box, muzzle and aim-target heights. */
  get low() { return this.dodge ? this.dodge.low : 0; }
  /** Height of the hit box above the feet (bullets hit between ped.y and ped.y + hitTop()). */
  hitTop() { return 1.9 - 1.2 * this.low; }
  /** Where enemies aim, above the feet. */
  aimHeight() { return 1.15 - 0.65 * this.low; }
  /** Muzzle height above the feet. */
  muzzleHeight() { return 1.3 - 0.7 * this.low; }

  /** Put on a vest: tier 1 = 100 points, tier 2 = 150 points + helmet (head shots hurt far less). */
  giveArmor(tier) {
    const cap = tier >= 2 ? 150 : 100;
    this.armorTier = Math.max(this.armorTier, tier);
    this.armor = Math.max(this.armor, cap);
  }
  get armorMax() { return this.armorTier >= 2 ? 150 : 100; }
  giveWeapon(id, ammo) {
    const had = this.weapons[id] !== undefined;
    const src = WEAPONS[id] && WEAPONS[id].ammoFrom;
    if (src) { // dual pistols: an ownership flag; the rounds go to the shared pool
      this.weapons[id] = true;
      this.weapons[src] = Math.min(999, (this.weapons[src] || 0) + (ammo || 20));
    } else if (WEAPONS[id] && WEAPONS[id].melee) this.weapons[id] = Infinity;   // sword: no ammo
    else this.weapons[id] = Math.min(WEAPONS[id].maxAmmo || 999, (this.weapons[id] || 0) + ammo);
    if (!had || this.weaponId === 'fist') this.selectWeapon(id);
  }
  selectWeapon(id) {
    if (this.weapons[id] === undefined) return;
    this.weaponId = id;
    this.ped.weapon = id === 'fist' ? null : id;
  }
  cycleWeapon(dir) {
    const owned = WEAPON_ORDER.filter((w) => this.weapons[w] !== undefined);
    let i = owned.indexOf(this.weaponId);
    i = (i + dir + owned.length) % owned.length;
    this.selectWeapon(owned[i]);
  }
  selectSlot(n) {
    const id = WEAPON_ORDER[n];
    if (id) this.selectWeapon(id);
  }
  resetWeapons() {
    this.weapons = { fist: Infinity, pistol: 30 };
    this.selectWeapon('pistol');
  }

  /** Fire the current weapon from the ped toward a world-space aim point. */
  fire(aimPoint) {
    if (this.dead || this.fireTimer > 0) return;
    const w = this.weapon;
    const g = this.game;
    const ped = this.ped;
    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    if (w.sword) { // samurai sword: alternate left / right swings; the arc hit test happens at 40% of the swing (Ped.tickSwing, player time)
      if (ped.swingT > 0) return;
      this.fireTimer = w.rate;
      this.swingSide ^= 1;
      ped.startSwing(this.swingSide, true);
      g.audio.slash();
      return;
    }
    if (w.melee) {
      this.fireTimer = w.rate;
      g.combat.melee(ped, f);
      g.noise(ped.pos.x, ped.pos.z, 8, ped);
      return;
    }
    const pool = w.ammoFrom || this.weaponId;
    if (this.ammo <= 0) {
      this.fireTimer = 0.3;
      if (g.audio.dryfire) g.audio.dryfire();
      if (this._dryT <= 0) { g.hud.toast('OUT OF AMMO'); this._dryT = 2; }
      return;
    }
    this.fireTimer = w.rate;
    const my = this.dodge ? ped.yaw : this.yaw; // the muzzle stays with the body while diving (the camera / aim turn freely)
    const mf = { x: Math.sin(my), z: Math.cos(my) };
    const r = { x: -Math.cos(my), z: Math.sin(my) };
    let side = 0.3;
    if (this.weaponId === 'dual') { this.dualSide ^= 1; side = this.dualSide ? 0.32 : -0.32; } // left / right pistol
    const from = new THREE.Vector3(ped.pos.x + mf.x * 0.5 + r.x * side, ped.y + (ped.yOffset || 0) + this.muzzleHeight(), ped.pos.z + mf.z * 0.5 + r.z * side);
    const dir = new THREE.Vector3().subVectors(aimPoint, from).normalize();
    const lock = this.assistAim(from, dir);   // aim assist: bend the shot toward the locked target's chest
    if (lock) aimPoint = lock;
    const fopts = { spread: this.moveSpread || 0 };
    if (w.grenade) { fopts.speed = grenadeSpeed(Math.hypot(aimPoint.x - from.x, aimPoint.z - from.z), aimPoint.y - from.y, dir.y); ped.startSwing(0, false); }   // lob: throw animation, no sword hit
    const shots = g.combat.fire(ped, from, dir, this.weaponId, fopts);
    if (this.weapons[pool] !== Infinity) this.weapons[pool] = Math.max(0, this.weapons[pool] - (w.burn || 1));
    if (g.kc && shots && shots.length) g.kc.tryStart(shots, this.weaponId, from);
  }

  /**
   * Aim assist (FootMode soft lock): turn `dir` (unit, in place) toward the locked target's chest. The un-assisted
   * direction is taken as the crosshair ray at the target's depth (no shoulder / muzzle parallax), then moved
   * `nudge` of the way to the chest (0.7 normal, 1.0 strong), and never left more than ASSIST_MAX_MISS metres off
   * the chest, so a red crosshair means the shot lands on the body (weapon spread aside).
   * Returns the nudged aim point at the target's distance, or null when there is no lock.
   */
  assistAim(from, dir) {
    const t = this.aimTarget, g = this.game, fm = g.footMode, a = fm && fm.aimAssist;
    if (!t || !a || t.dead || this.vehicle) return null;
    const chest = fm.chestOf(t, new THREE.Vector3());
    const to = chest.clone().sub(from);
    const d = to.length();
    if (d < 0.5) return null;
    to.divideScalar(d);
    const cam = g.camera, cd = cam.getWorldDirection(new THREE.Vector3());
    const base = cam.position.clone().addScaledVector(cd, chest.clone().sub(cam.position).dot(cd)).sub(from).normalize();
    if (base.dot(to) < 0.7 || dir.dot(to) < 0.7) return null;   // never bend a shot by more than ~45 deg
    const off = base.angleTo(to);
    const keep = off > 1e-5 ? Math.min(1 - a.nudge, Math.atan(ASSIST_MAX_MISS / d) / off) : 0; // fraction of the error left
    dir.copy(to).lerp(base, keep).normalize();
    return from.clone().addScaledVector(dir, d);
  }

  damage(n, src) {
    if (this.dead || this.invuln > 0) return;
    if (this.game.cheats && this.game.cheats.on.god) return;
    if (src && src.kind && !src.isPlayer) n *= this.game.diff.enemyDamage; // enemy gunfire / explosions
    if (this.game.hero) n *= this.game.hero.damageTaken;
    if (this.armor > 0) {
      const a = Math.min(this.armor, n * (this.armorTier >= 2 ? 0.8 : 0.7));
      this.armor -= a; n -= a;
      if (this.armor <= 0) { this.armor = 0; this.game.hud.toast('ARMOR GONE', 1.5); }
    }
    this.hp -= n;
    this.hurtT = 0.25;
    if (this.hp <= 0) { this.hp = 0; this.game.wasted(src); }
    else if (n > 2) this.game.audio.hurt();
  }

  /**
   * Called with real (unscaled) dt: bullet-time meter, painkiller healing, timers.
   * The hourglass drains in 9 s of continuous use (x difficulty btDrain) and refills in ~22 s (x btRegen);
   * bullet time started by a shoot-dodge costs nothing while airborne and for the first 1.5 s of lying prone.
   */
  updateMeters(rawDt) {
    if (this.btActive) {
      const d = this.dodge;
      const free = (this.dodgeBT && d && (d.phase !== 'prone' || d.pt < BT_FREE_PRONE)) || (this.jumpBT && !this.ped.grounded); // dives / BT jumps: free in the air
      if (!free) this.bt -= rawDt * BT_DRAIN * this.game.diff.btDrain;
      if (this.bt <= 0) { this.bt = 0; this.setBulletTime(false); }
    } else {
      this.bt = Math.min(1, this.bt + rawDt * BT_REGEN * this.game.diff.btRegen * (this.game.hero ? this.game.hero.btRegen : 1));
    }
    if (this.healT > 0) {
      const h = Math.min(rawDt, this.healT);
      this.healT -= h;
      if (!this.dead) this.hp = Math.min(100, this.hp + PILL_HEAL * h / PILL_TIME);
    }
    if (this.invuln > 0) this.invuln -= rawDt;
    if (this.hurtT > 0) this.hurtT -= rawDt;
    if (this._dryT > 0) this._dryT -= rawDt;
  }
  /** Turn bullet time on/off. Refused (dry click) with less than 10% in the meter. */
  setBulletTime(on) {
    if (on && this.bt < BT_MIN) { if (this.btActive === false && this.game.audio.dryfire) this.game.audio.dryfire(); return; }
    if (this.btActive === on) return;
    this.btActive = on;
    if (!on) { this.dodgeBT = false; this.jumpBT = null; }
    this.game.onBulletTime(on);
  }
  /** Use a painkiller (H / PILLS): +35 hp over 1.2 s. Returns true when one was used. */
  usePainkiller() {
    if (this.dead || this.vehicle || this.painkillers <= 0 || this.healT > 0 || this.hp >= 100) return false;
    this.painkillers--;
    this.healT = PILL_TIME;
    if (this.game.audio.pickup) this.game.audio.pickup();
    return true;
  }
  /** Meter refill for a kill: +15%, +30% when the player is mid shoot-dodge (Max Payne style); civilians give less. */
  onKill(ped) {
    this.addBullet(ped && ped.kind === 'civ' ? 0.05 : this.dodge ? 0.30 : 0.15);
  }
  addBullet(n) { this.bt = clamp(this.bt + n, 0, 1); }
}
