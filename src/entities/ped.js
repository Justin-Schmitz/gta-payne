import * as THREE from 'three';
import { rand, choice, clamp, dist, TAU, wrapAngle } from '../util.js';
import { WEAPONS, grenadeSpeed } from '../systems/combat.js';
import { GANGS, gangAt } from '../data/gangs.js';
import { ASSETS } from '../world/assets.js';

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#5c3a21'];
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#ecf0f1', '#e67e22', '#1abc9c', '#34495e', '#ff69b4'];
const PANTS = ['#2c3e50', '#34495e', '#7f8c8d', '#1f2a44', '#5d4037', '#2d3436'];
const SWING_T = WEAPONS.sword.swing;   // seconds per sword swing
export const GRAVITY = 22; // m/s^2 for ped elevation (jump / dive)
export const GANG_COLORS = { cinelli: '#d9b24c', crows: '#6a3fd6', debtors: '#2e8b57', mal: '#ff5e5e', julpie: '#ff4fa3' };

export class Ped {
  constructor(game, kind, x, z, opts = {}) {
    this.game = game;
    this.kind = kind;                 // civ | cop | gang | player
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = rand(0, TAU);
    this.isPlayer = kind === 'player';
    this.hp = opts.hp || (kind === 'civ' ? 40 : kind === 'cop' ? 70 : 70);
    if (kind === 'cop' || kind === 'gang') this.hp = Math.round(this.hp * game.diff.enemyHp);
    this.maxHp = this.hp;
    this.weapon = opts.weapon !== undefined ? opts.weapon : (kind === 'civ' ? null : 'pistol');
    this.gang = opts.gang || null;
    this.boss = !!opts.boss;
    this.name = opts.name || null;
    this.miniBoss = !!opts.miniBoss;  // named semi-boss (T16): boss bar, $5,000 x mult bounty, always drops its weapon
    this.lootAlways = !!(opts.lootAlways || opts.boss || opts.miniBoss);
    this.bossTint = opts.tint || null;  // colour tint / model scale for bosses and mini-bosses
    this.bossScale = opts.scale || 1;
    this.charge = false;              // boss phase: rush the player instead of strafing (set by Missions.tickBoss)
    this.mission = !!opts.mission;
    this.angry = !!opts.angry;
    this.alerted = !!opts.alerted;
    this.alertRange = opts.alertRange || 30;
    this.accuracy = opts.accuracy || (kind === 'cop' ? 0.09 : this.boss ? 0.06 : opts.miniBoss ? 0.08 : 0.12);
    this.speed = 0;
    this.walkPhase = 0;
    this.dead = false;
    this.deadTime = 0;
    this.remove = false;
    this.panic = 0;
    this.burning = 0;                 // seconds of fire left (flamethrower); burnOwner gets the kill
    this.burnOwner = null;
    this.threat = null;
    this.panicBias = rand(-0.6, 0.6);
    this.fireTimer = rand(0.6, 1.6);
    this.swingT = 0; this.swingSide = 0; this.swingHit = true; this.swingFresh = false; this.mOn = { melee: false, melee2: false };   // sword swing / grenade throw state (see startSwing)
    this.grenades = opts.grenades || 0; this.grenadeCd = rand(2, 5); this.stickPanic = 0;   // spare sticky grenades an enemy lobs (T15), panic time after one sticks to us
    this.burstLeft = 0;
    this.strafeT = 0;
    this.strafeDir = 1;
    this.evadeT = 0; this.evadeDir = null; this.evadeSp = 5.5; // sidestep after a near miss / hop away from a shot (see nearMiss / tryDodge)
    this.dodgeCd = 0; this.knockT = 0; this.knockDur = 0; this.shoutCd = 0;
    this.aim = false;
    this.node = null; this.prevNode = null; this.navTarget = null;
    this.stuckT = 0; this.lastX = x; this.lastZ = z;
    this.walkSpeed = rand(1.3, 1.9);
    this.vehicle = null;
    this.flingVx = 0; this.flingVz = 0;
    this.y = 0; this.vy = 0; this.grounded = true; this.landSpeed = 0; // elevation: feet height, vertical speed, impact speed of the last landing
    this.buildMesh(opts.colors || this.defaultColors());
    this.mesh.position.copy(this.pos);
  }

  defaultColors() {
    switch (this.kind) {
      case 'cop': return { skin: choice(SKINS), shirt: '#1f3a93', pants: '#152a6b', hat: '#0f1f55' };
      case 'player': return { skin: '#e8b88a', shirt: '#1b1b1f', pants: '#2c2c34' };
      case 'gang': return { skin: choice(SKINS), shirt: this.boss ? '#2b2b2b' : ((GANGS[this.gang] && GANGS[this.gang].color) || GANG_COLORS[this.gang] || '#555'), pants: this.boss ? '#1a1a1a' : choice(PANTS), hat: this.boss ? '#111' : null, tie: this.boss ? '#c0392b' : null };
      default: return { skin: choice(SKINS), shirt: choice(SHIRTS), pants: choice(PANTS), hat: Math.random() < 0.15 ? choice(SHIRTS) : null };
    }
  }

  /** Rigged Kenney character (when loaded): same public fields as the box model. */
  buildModelMesh(md) {
    const g = md.group;
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.45, 8), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.03; g.add(sh);
    this.model = md;
    this.mixer = md.mixer;
    this.mw = { idle: 1, walk: 0, run: 0, jump: 0, shoot: 0, shoot2: 0, melee: 0, melee2: 0 };   // shoot2: two-handed aim (dual pistols)
    this.legL = this.legR = this.armL = this.armR = null;
    this.gun = md.gun;
    this.torso = md.torso;
    this.aimPitch = 0;                // radians the spine is tilted for aiming (+ = barrel down); set every frame in updateModel
    this.mesh = g;
  }

  buildMesh(c) {
    this.model = null;
    const tint = this.bossTint ? new THREE.Color(this.bossTint) : this.kind === 'gang' && !this.boss && c.shirt ? new THREE.Color('#ffffff').lerp(new THREE.Color(c.shirt), 0.55) : null;
    const hero = this.isPlayer && this.game.hero ? this.game.hero : null;
    const md = ASSETS.makePed(this.kind, { boss: this.boss, gang: this.gang, tint: hero ? hero.tint : tint, model: hero ? hero.model : null, scale: hero ? hero.scale : this.bossScale });
    if (md) return this.buildModelMesh(md);
    const M = (w, h, d, col) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }));
    const g = new THREE.Group();
    const torso = M(0.5, 0.6, 0.28, c.shirt); torso.position.y = 1.05; g.add(torso);
    const head = M(0.28, 0.28, 0.28, c.skin); head.position.y = 1.5; g.add(head);
    if (c.hat) { const hat = M(0.34, 0.1, 0.34, c.hat); hat.position.y = 1.68; g.add(hat); }
    if (c.tie) { const tie = M(0.08, 0.4, 0.04, c.tie); tie.position.set(0, 1.1, 0.16); g.add(tie); }
    const limb = (w, h, d, col, x, y) => {
      const piv = new THREE.Group(); piv.position.set(x, y, 0);
      const m = M(w, h, d, col); m.position.y = -h / 2; piv.add(m); g.add(piv); return piv;
    };
    this.legL = limb(0.2, 0.72, 0.22, c.pants, -0.13, 0.75);
    this.legR = limb(0.2, 0.72, 0.22, c.pants, 0.13, 0.75);
    this.armL = limb(0.14, 0.6, 0.16, c.shirt, -0.33, 1.33);
    this.armR = limb(0.14, 0.6, 0.16, c.shirt, 0.33, 1.33);
    head.name = 'head';
    this.gun = M(0.08, 0.36, 0.1, '#222'); this.gun.position.set(0, -0.68, 0.06); this.gun.visible = false; this.armR.add(this.gun);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.45, 8), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.03; g.add(sh);
    this.mesh = g;
    this.torso = torso;
  }

  /** Body armour worn by the player: tier 1 vest, tier 2 heavy vest with shoulder pads and helmet. Rebuilt on tier change. */
  setArmorVisual(tier) {
    if ((this.armorVisualTier || 0) === tier) return;
    this.armorVisualTier = tier;
    if (this.armorGroup) { this.mesh.remove(this.armorGroup); this.armorGroup = null; }
    if (!tier) return;
    const M = (w, h, d, col) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }));
    const s = (this.game.hero && this.isPlayer ? this.game.hero.scale : 1) * (this.model ? 1 : 1);
    const g = new THREE.Group();
    const vest = M(0.58, 0.5, 0.36, tier >= 2 ? '#2b3a2b' : '#3a3a3a'); vest.position.y = 1.05 * s; g.add(vest);
    const strap = M(0.6, 0.08, 0.38, '#111'); strap.position.y = 1.22 * s; g.add(strap);
    if (tier >= 2) {
      for (const sx of [-1, 1]) { const pad = M(0.2, 0.14, 0.3, '#2b3a2b'); pad.position.set(sx * 0.36, 1.33 * s, 0); g.add(pad); }
      const helmet = M(0.36, 0.2, 0.36, '#2b3a2b'); helmet.position.y = 1.66 * s; g.add(helmet);
      const visor = M(0.3, 0.06, 0.1, '#111'); visor.position.set(0, 1.58 * s, 0.17); g.add(visor);
    }
    g.scale.setScalar(s);
    this.armorGroup = g;
    this.mesh.add(g);
  }
  /** Rebuild the visual model (e.g. after the playable character changes on load). */
  rebuildModel() {
    const parent = this.mesh.parent;
    if (parent) parent.remove(this.mesh);
    const visible = this.mesh.visible;
    this.buildMesh(this.defaultColors());
    this.mesh.visible = visible;
    if (parent) parent.add(this.mesh);
  }
  /** Bring a ped back to life (player respawn): clears the death pose on both model paths. */
  revive() {
    this.dead = false; this.deadTime = 0; this.deathStarted = false;
    this.y = 0; this.vy = 0; this.yOffset = 0; this.tilt = 0;
    this.mesh.rotation.x = 0; this.mesh.position.y = 0;
    this.swingT = 0; this.stickPanic = 0;
    if (this.headGone) { this.headGone = false; this.mesh.traverse((o) => { if (o.name === 'head') o.visible = true; }); }
    if (this.model) {
      const A = this.model.actions;
      if (A.death) A.death.stop();
      if (this.mw) for (const k of Object.keys(this.mw)) this.mw[k] = k === 'idle' ? 1 : 0;
      if (A.idle) { A.idle.reset(); A.idle.setEffectiveWeight(1); A.idle.play(); }
      for (const n of ['idleU', 'walk', 'walkU', 'run', 'runU']) if (A[n]) { A[n].reset(); A[n].setEffectiveWeight(n === 'idleU' ? 1 : 0); A[n].play(); }   // stopped when the death clip started
    }
  }

  updateModel(dt) {
    const m = this.mesh, md = this.model, A = md.actions;
    if (this.dead) {
      md.setWeapon(null);
      m.rotation.y = this.yaw;
      this.aimPitch = 0;
      if (A.death) {
        if (!this.deathStarted) {
          this.deathStarted = true;
          for (const k of ['idle', 'walk', 'run', 'jump', 'shoot', 'idleU', 'walkU', 'runU', 'jumpU', 'shoot2', 'melee', 'melee2']) if (A[k]) A[k].stop();
          A.death.reset().play();
        }
        md.beforeMix();
        md.mixer.update(dt);
        md.afterMix(dt, 0, false, m);
        m.rotation.x = 0;
        m.position.set(this.pos.x, this.y, this.pos.z);
      } else {
        const t = Math.min(1, this.deadTime * 3.5);
        md.beforeMix(); md.afterMix(dt, 0, false, m);
        m.rotation.x = -Math.PI / 2 * t;
        m.position.set(this.pos.x, 0.16 * t + this.y, this.pos.z);
      }
      return;
    }
    m.position.set(this.pos.x, (this.yOffset || 0) + this.y, this.pos.z);
    m.rotation.y = this.yaw;
    m.rotation.x = this.tilt || 0;
    const sp = this.speed;
    this.walkPhase += sp * dt * 2.4;
    const air = !!A.jump && this.y > 0.2 && !this.tilt;
    const moving = sp > 0.4;
    const wantRun = sp > 4.2;
    const walkA = A.walk || A.run, runA = A.run || A.walk;
    const armed = !!this.weapon && this.weapon !== 'fist';
    const gunLike = armed && this.weapon !== 'sword';   // the sword is carried at the side, not aimed
    const swingOn = this.swingT > 0;
    const mkey = swingOn ? (this.swingSide && A.melee2 ? 'melee2' : A.melee ? 'melee' : null) : null;   // no melee clip in the pack: fall back to the shoot pose
    const target = {
      idle: !air && !moving ? 1 : 0,
      walk: !air && moving && !wantRun && walkA ? 1 : 0,
      run: !air && moving && wantRun && runA ? 1 : 0,
      jump: air ? 1 : 0,
      shoot: (this.aim && gunLike && !(this.weapon === 'dual' && A.shoot2)) || (swingOn && !mkey && armed) ? 1 : 0,
      shoot2: this.aim && this.weapon === 'dual' && A.shoot2 ? 1 : 0,
      melee: mkey === 'melee' ? 1 : 0,
      melee2: mkey === 'melee2' ? 1 : 0,
    };
    if (!air && moving && !walkA) target.idle = 1;
    if (runA === walkA) { target.walk = Math.max(target.walk, target.run); target.run = 0; }
    const k = 1 - Math.exp(-dt * 12);
    const w = this.mw;
    // locomotion clips come in a lower part (A.walk) and an upper-body part (A.walkU) so the aim pose replaces the arms
    const walkU = A.walk ? A.walkU : A.runU, runU = A.run ? A.runU : A.walkU;
    const upperOf = (n) => (n === 'walk' ? walkU : n === 'run' ? runU : A[n + 'U']);
    // one-shot melee swing (upper body only): restarted when a swing begins, timed to SWING_T, weight snaps in quickly
    const km = 1 - Math.exp(-dt * 28);
    for (const n of ['melee', 'melee2']) {
      const a = A[n];
      w[n] += (target[n] - w[n]) * km;
      if (!a) continue;
      if (this.swingFresh && n === mkey) { a.reset(); a.timeScale = a.getClip().duration / SWING_T; a.play(); this.mOn[n] = true; }
      if (w[n] > 0.02) a.setEffectiveWeight(w[n]);
      else if (this.mOn[n]) { a.stop(); this.mOn[n] = false; }
    }
    this.swingFresh = false;
    const upperOff = Math.max(0, 1 - w.shoot - w.shoot2 - w.melee - w.melee2);
    for (const n of ['shoot', 'shoot2', 'idle', 'walk', 'run', 'jump']) {
      w[n] += (target[n] - w[n]) * k;
      const a = n === 'walk' ? walkA : n === 'run' ? runA : A[n];
      if (!a || (n === 'run' && runA === walkA)) continue;
      const au = upperOf(n), wu = w[n] * (A.shoot || A.melee ? upperOff : 1);
      if (n === 'jump' || n === 'shoot' || n === 'shoot2') {
        if (w[n] > 0.02) {
          if (!a.isRunning()) { a.reset(); a.play(); if (au) { au.reset(); au.play(); } }
          a.setEffectiveWeight(w[n]);
          if (au) au.setEffectiveWeight(wu);
        } else if (a.isRunning()) { a.stop(); if (au) au.stop(); }
      } else { a.setEffectiveWeight(w[n]); if (au) au.setEffectiveWeight(wu); }
    }
    if (walkA) { walkA.timeScale = clamp(sp / 1.5, 0.6, 2); if (walkU) walkU.timeScale = walkA.timeScale; }
    if (runA && runA !== walkA) { runA.timeScale = clamp(sp / 5.2, 0.7, 1.6); if (runU) runU.timeScale = runA.timeScale; }
    const hasGun = gunLike;
    // upper-body aim: spine pitch follows the crosshair (player) or the target's chest (NPCs); + = barrel down
    let pitch = 0;
    const aimOn = this.aim && hasGun;
    if (aimOn) {
      const pl = this.game.player;
      if (this.isPlayer) pitch = pl.pitch;
      else if (pl) {
        const tp = pl.worldPos();
        pitch = Math.atan2((this.y || 0) + 1.3 - (pl.vehicle ? 0.8 : pl.ped.y + pl.aimHeight()), Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) || 1);
      }
    }
    this.aimPitch = pitch;
    md.beforeMix();
    md.mixer.update(dt);
    md.afterMix(dt, pitch, aimOn, m);
    md.setWeapon(armed && (this.aim || this.isPlayer || swingOn) ? this.weapon : null);
    this.speed *= 0.6;
  }

  updateMesh(dt) {
    if (this.model) return this.updateModel(dt);
    const m = this.mesh;
    if (this.dead) {
      const t = Math.min(1, this.deadTime * 3.5);
      m.rotation.x = -Math.PI / 2 * t;
      m.position.set(this.pos.x, 0.16 * t + this.y, this.pos.z);
      m.rotation.y = this.yaw;
      return;
    }
    m.position.set(this.pos.x, (this.yOffset || 0) + this.y, this.pos.z);
    m.rotation.y = this.yaw;
    m.rotation.x = this.tilt || 0;
    const s = clamp(this.speed / 3, 0, 1);
    this.walkPhase += this.speed * dt * 2.4;
    const sw = Math.sin(this.walkPhase);
    this.legL.rotation.x = sw * 0.75 * s;
    this.legR.rotation.x = -sw * 0.75 * s;
    const hasGun = !!this.weapon && this.weapon !== 'fist';
    this.gun.visible = !!this.weapon && this.weapon !== 'fist' && (this.aim || this.isPlayer || this.swingT > 0);
    this.gun.scale.y = this.weapon === 'sword' ? 2.6 : 1;
    if (this.weapon === 'dual' || this.gun2) { // dual pistols: a second gun in the left hand (box model only)
      if (!this.gun2) { this.gun2 = this.gun.clone(); this.armL.add(this.gun2); }
      this.gun2.visible = this.gun.visible && this.weapon === 'dual';
    }
    if (this.swingT > 0) { // sword swing / throw: the right arm sweeps from overhead down across the body
      const u = 1 - this.swingT / SWING_T;
      this.armR.rotation.x = -2.5 + 2.7 * u; this.armR.rotation.z = (this.swingSide ? -1 : 1) * (0.5 - u) * 1.2;
      this.armL.rotation.x = -sw * 0.5 * s; this.armL.rotation.z = 0;
    } else if (this.weapon === 'sword') {
      this.armR.rotation.x = -0.9; this.armR.rotation.z = 0; this.armL.rotation.x = sw * 0.5 * s; this.armL.rotation.z = 0;
    } else if (this.aim && hasGun) {
      this.armR.rotation.x = -Math.PI / 2; this.armR.rotation.z = 0;
      this.armL.rotation.x = -Math.PI / 2 + 0.1; this.armL.rotation.z = 0.35;
    } else if (this.aim) {
      this.armR.rotation.x = -1.2; this.armL.rotation.x = -1.2; this.armL.rotation.z = 0;
    } else {
      this.armR.rotation.x = -sw * 0.5 * s; this.armL.rotation.x = sw * 0.5 * s; this.armL.rotation.z = 0; this.armR.rotation.z = 0;
    }
    this.speed *= 0.6;
  }

  /** Move by a world-space delta and resolve collisions. */
  move(dx, dz) {
    this.pos.x += dx; this.pos.z += dz;
    this.resolve();
  }
  resolve() {
    const g = this.game;
    g.world.resolveCircle(this.pos, 0.4, this.y + this.stepReach());
    for (const v of g.vehicles) {
      if (dist(v.pos.x, v.pos.z, this.pos.x, this.pos.z) > v.type.len / 2 + 1.5) continue;
      for (const c of v.circles()) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz), rr = c.r + 0.4;
        if (d < rr) {
          const sp = v.speedAbs;
          if (sp > 4 && !this.dead && !this.isPlayer) { this.runOver(v); return; }
          if (sp > 6 && this.isPlayer && !g.player.vehicle) { g.player.damage(sp * 3, v.driver === g.player ? null : v); }
          const n = d > 1e-5 ? { x: dx / d, z: dz / d } : { x: 1, z: 0 };
          this.pos.x += n.x * (rr - d); this.pos.z += n.z * (rr - d);
        }
      }
    }
  }
  runOver(v) {
    const g = this.game;
    this.flingVx = v.vx * 0.5; this.flingVz = v.vz * 0.5;
    g.effects.blood(this.pos.x, 0.5, this.pos.z);
    g.audio.thud(dist(g.player.worldPos().x, g.player.worldPos().z, this.pos.x, this.pos.z));
    this.die(v.driver === g.player ? g.player.ped : null, 'runover');
  }
  walk(mx, mz, sp, dt) {
    const l = Math.hypot(mx, mz);
    if (l < 1e-6) return;
    this.move((mx / l) * sp * dt, (mz / l) * sp * dt);
    this.speed = sp;
  }
  damage(n, src, dir, cause = 'shot') {
    if (this.dead) return;
    this.hp -= n;
    this.alerted = true;
    if (this.hp > 0 && this.kind !== 'civ' && !this.isPlayer && Math.random() < 0.45) this.shout('hurt');
    if (this.kind === 'cop') this.angry = true;
    if (this.kind === 'civ') { this.panic = 6; this.threat = src ? { x: src.pos.x, z: src.pos.z } : { x: this.pos.x, z: this.pos.z }; }
    if (this.hp <= 0) {
      if (dir) { this.flingVx = dir.x * 0.02; this.flingVz = dir.z * 0.02; }
      this.die(src, cause);
    }
  }
  die(src, cause) {
    if (this.dead) return;
    this.dead = true;
    this.burning = 0; this.swingT = 0;
    this.aim = false;
    this.deadTime = 0;
    this.speed = 0;
    if (this.kind !== 'civ' && this.game.shouts) this.game.shouts.onDeath(this);
    this.game.onPedDeath(this, src, cause);
  }

  /** How far above the feet a box top may be and still count as "below me" (stand on it / pass over it). */
  stepReach() { return this.grounded ? 0.05 : 0.35; }
  /** Gravity + standing on low boxes (crates, low walls). Cheap no-op for peds walking on the ground. */
  updateElevation(dt) {
    if (this.grounded && this.y === 0 && this.vy === 0) return;
    const gh = this.game.world.groundHeight(this.pos.x, this.pos.z, Math.min(2.6, this.y + this.stepReach()));
    if (this.grounded) {
      if (gh < this.y - 0.001) this.grounded = false; // walked off an edge
      else { this.y = gh; this.vy = 0; return; }
    }
    this.vy -= GRAVITY * (this.game.cheats ? this.game.cheats.gravity : 1) * dt;
    this.y += this.vy * dt;
    if (this.y <= gh) {
      // landed (or mantled onto a box top while rising)
      if (this.vy < -0.5) {
        this.landSpeed = -this.vy;
        if (this.vy < -4) this.game.effects.dust(this.pos.x, gh + 0.1, this.pos.z);
      }
      this.y = gh; this.vy = 0; this.grounded = true;
    }
  }

  update(dt) {
    this.updateElevation(dt);
    if (this.dead) {
      this.deadTime += dt;
      if (this.deadTime < 0.4) { this.pos.x += this.flingVx * dt; this.pos.z += this.flingVz * dt; this.game.world.resolveCircle(this.pos, 0.3); }
      if (this.deadTime > 14 && !this.mission) this.remove = true;
      if (this.deadTime > 40) this.remove = true;
      this.updateMesh(dt);
      return;
    }
    if (this.swingT > 0) this.tickSwing(dt);
    if (this.knockT > 0 && !this.isPlayer) this.updateKnock(dt);
    else if (this.burning > 0 && !this.isPlayer) this.updateBurning(dt);
    else if (this.stickPanic > 0 && !this.isPlayer) this.updateStickyRun(dt);
    else if (!this.isPlayer) this.updateAI(dt);
    this.updateMesh(dt);
  }

  // ---- sword swing / throw (T15) ---------------------------------------------------------------
  /**
   * Start a 0.45 s swing (side 0 = right, 1 = left; plays attack-melee-right / -left). With `hit` the sword's arc test runs at 40% of it
   * (Combat.slash); a grenade throw reuses the animation with hit = false. The timer runs on this ped's own dt: the player's ped is
   * updated with player time, everybody else with world time, so swings slow down in bullet time as intended.
   */
  startSwing(side = 0, hit = true) {
    this.swingT = SWING_T; this.swingSide = side ? 1 : 0; this.swingHit = !hit; this.swingFresh = true;
  }
  tickSwing(dt) {
    if (this.knockT > 0) { this.swingT = 0; return; }
    this.swingT -= dt;
    if (!this.swingHit && SWING_T - this.swingT >= SWING_T * WEAPONS.sword.hitAt) {
      this.swingHit = true;
      this.game.combat.slash(this, this.isPlayer ? this.game.player.yaw : this.yaw, this.swingSide);
    }
    if (this.swingT <= 0) { this.swingT = 0; this.swingHit = true; }
  }
  /** Severed head: hides the head node and flings a skin-coloured ball (sword kills, 45%). */
  dismember(dir) {
    if (this.headGone || this.isPlayer) return;
    let found = false;
    this.mesh.traverse((o) => { if (o.name === 'head') { o.visible = false; found = true; } });
    if (!found) return;
    this.headGone = true;
    const l = Math.hypot(dir.x, dir.z) || 1;
    this.game.effects.gib(this.pos.x, this.y + 1.55, this.pos.z, dir.x / l * 5, dir.z / l * 5);
    this.game.effects.burst(this.pos.x, this.y + 1.5, this.pos.z, 10, 5, '#b3121b', 0.6, 0.14, { grav: 18 });
  }
  /** A sticky grenade is stuck to us: sprint in random directions (like burning, without the damage). */
  updateStickyRun(dt) {
    this.stickPanic -= dt;
    this.aim = false;
    this._burnT = (this._burnT || 0) - dt;
    if (this._burnT <= 0 || this._burnA === undefined) { this._burnT = rand(0.5, 1.0); this._burnA = rand(0, TAU); }
    const before = this.pos.x * 1000 + this.pos.z;
    this.walk(Math.sin(this._burnA), Math.cos(this._burnA), 6.4, dt);
    if (this.pos.x * 1000 + this.pos.z === before) this._burnT = 0;
    this.yaw = this._burnA;
  }

  // ---- reactions to the player's shooting (T12) ----------------------------------
  /** Knocked over (the player dived into us): lies on the back for `t` seconds, no AI, no shooting. Uses the shared tilt / yOffset pose fields. */
  knockDown(t = 1.5) {
    if (this.dead || this.isPlayer || this.knockT > 0) return;
    this.knockT = this.knockDur = t;
    this.aim = false; this.speed = 0;
    if (this.kind !== 'civ') this.shout('hurt');
  }
  updateKnock(dt) {
    this.knockT -= dt;
    this.aim = false;
    const e = Math.min(1, (this.knockDur - this.knockT) * 7, this.knockT * 4);
    this.tilt = -Math.PI / 2 * Math.max(0, e);
    this.yOffset = 0.2 * Math.max(0, e);
    if (this.knockT <= 0) { this.knockT = 0; this.tilt = 0; this.yOffset = 0; }
    this.fireTimer = Math.max(this.fireTimer, 0.4);
  }
  /** A player bullet passed within 1 m: strafe sideways for 0.6 s. */
  nearMiss(vx, vz) {
    if (this.dead || this.evadeT > 0.2 || this.knockT > 0) return;
    const l = Math.hypot(vx, vz) || 1;
    const s = Math.random() < 0.5 ? -1 : 1;
    this.evadeDir = { x: (-vz / l) * s, z: (vx / l) * s };
    this.evadeT = 0.6; this.evadeSp = 5.5;
    if (Math.random() < 0.3) this.shout('hurt');
  }
  /** The player fired at us from > 8 m: 25% of gang members (a fixed trait) hop sideways, at most every 2.2 s. */
  tryDodge(hx, hz) {
    if (this.dead || this.dodgeCd > 0 || this.knockT > 0) return;
    if (this.dodger === undefined) this.dodger = Math.random() < 0.25;
    if (!this.dodger) return;
    this.dodgeCd = 2.2;
    const s = Math.random() < 0.5 ? -1 : 1;
    this.evadeDir = { x: -hz * s, z: hx * s };
    this.evadeT = 0.35; this.evadeSp = 7.5;
    if (this.grounded) { this.vy = 3.4; this.grounded = false; }
  }
  /** Floating shout above the head (pooled, max 3 on screen): kind 'alert' | 'hurt' | 'buddy'. */
  shout(kind) {
    if (this.shoutCd > 0 || this.dead || !this.game.shouts) return false;
    if (!this.game.shouts.say(this, kind)) return false;
    this.shoutCd = 2.5;
    return true;
  }

  /** On fire: 12 dmg/s, panic-run in random directions, flame particles. Death counts as a kill for burnOwner. */
  updateBurning(dt) {
    const fx = this.game.effects, y0 = this.y || 0;
    this.burning -= dt;
    this.hp -= 12 * dt;
    this._fireT = (this._fireT || 0) - dt;
    if (this._fireT <= 0) {
      this._fireT = 0.05;
      for (let i = 0; i < 2; i++) {
        const hot = Math.random() < 0.6;
        fx.spawn(this.pos.x + rand(-0.25, 0.25), y0 + rand(0.2, 1.7), this.pos.z + rand(-0.25, 0.25), rand(-0.6, 0.6), rand(1.5, 3.2), rand(-0.6, 0.6), rand(0.25, 0.5), hot ? '#ff7a1a' : '#ffd23a', rand(0.18, 0.34), -2, 0.8);
      }
      if (Math.random() < 0.25) fx.spawn(this.pos.x, y0 + 1.8, this.pos.z, rand(-0.4, 0.4), rand(1.5, 2.5), rand(-0.4, 0.4), 0.7, '#333333', rand(0.2, 0.35), -1.5, 0.8);
    }
    if (this.hp <= 0) { this.die(this.burnOwner, 'fire'); return; }
    this._burnT = (this._burnT || 0) - dt;
    if (this._burnT <= 0 || this._burnA === undefined) { this._burnT = rand(0.5, 1.1); this._burnA = rand(0, TAU); }
    this.aim = false;
    const before = this.pos.x * 1000 + this.pos.z;
    this.walk(Math.sin(this._burnA), Math.cos(this._burnA), 6.2, dt);
    if (this.pos.x * 1000 + this.pos.z === before) this._burnT = 0; // blocked: pick a new direction
    this.yaw = this._burnA;
  }

  // ---- AI ---------------------------------------------------------------
  updateAI(dt) {
    const g = this.game, pl = g.player;
    const tp = pl.worldPos();
    const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 0.001;
    if (this.evadeT > 0) this.evadeT -= dt;
    if (this.dodgeCd > 0) this.dodgeCd -= dt;
    if (this.shoutCd > 0) this.shoutCd -= dt;
    if (this.kind === 'civ') return this.updateCiv(dt);

    let hostile;
    if (this.kind === 'cop') hostile = (g.wanted.level > 0 || this.angry) && !pl.dead;
    else {
      if (this.turf) {
        // street members only turn on the player when respect is bad (or after being attacked / seeing a crewmate die)
        const rs = g.respect ? (g.respect[this.gang] || 0) : 0;
        if (!this.alerted && rs < g.diff.turfHostile && d < 30 && g.city.lineOfSight(this.pos.x, this.pos.z, tp.x, tp.z)) this.alerted = true;
      } else if (!this.alerted && d < this.alertRange && g.city.lineOfSight(this.pos.x, this.pos.z, tp.x, tp.z)) this.alerted = true;
      hostile = this.alerted && !pl.dead;
    }
    if (!hostile) {
      this.aim = false;
      if (this.mission) { this.yaw += Math.sin(performance.now() * 0.0007 + this.panicBias) * dt * 0.4; return; } // guards hold their post
      return this.updateCiv(dt, !this.turf);
    }

    this.aim = !!this.weapon;
    if (!this.shoutedAlert) { // first notice: shout once (retry for a few seconds when the pool / spacing was busy)
      this.alertTry = (this.alertTry === undefined ? 3 : this.alertTry) - dt;
      if (d >= 45 || this.alertTry <= 0 || this.shout('alert')) this.shoutedAlert = true;
    }
    const inCar = !!pl.vehicle;
    const los = d < 70 && g.city.lineOfSight(this.pos.x, this.pos.z, tp.x, tp.z);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = rand(0.8, 2.2); this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    const nx = dx / d, nz = dz / d;
    let mx = 0, mz = 0, sp = 0;
    const isCop = this.kind === 'cop';
    const isSword = this.weapon === 'sword';
    if (!los) { mx = nx; mz = nz; sp = 4.6; }
    else if (isSword) { if (d > 1.7) { mx = nx; mz = nz; sp = 4.9; } }   // swordsmen close to melee range and stand their ground
    else if (inCar) {
      if (d < 9) { mx = -nz * this.strafeDir; mz = nx * this.strafeDir; sp = 5.5; } // get out of the way
      else if (d > 22) { mx = nx; mz = nz; sp = 4; }
    } else if (isCop && g.wanted.level < 3) {
      // close in to bust
      if (d > 1.4) { mx = nx; mz = nz; sp = 4.4; }
      if (d < 1.8) pl.bustProgress += dt * 1.6;
    } else if (d > 16) { mx = nx; mz = nz; sp = 4; }
    else if (d < 5) { mx = -nx; mz = -nz; sp = 3; }
    else { mx = -nz * this.strafeDir; mz = nx * this.strafeDir; sp = 2.6; }
    if (this.charge && los && !inCar && d > 1.6) { mx = nx; mz = nz; sp = 5.8; } // boss phase: rush the player
    if (this.evadeT > 0 && this.evadeDir) { mx = this.evadeDir.x; mz = this.evadeDir.z; sp = this.evadeSp; } // sidestep / hop away from a shot
    if (sp > 0) this.walk(mx, mz, sp, dt);
    this.yaw = Math.atan2(dx, dz);

    // spare sticky grenades: lob one at the player from mid range every 5-8 s
    if (this.grenades > 0 && !isSword) {
      this.grenadeCd -= dt;
      if (this.grenadeCd <= 0 && los && d > 8 && d < 26 && !pl.dead) {
        this.grenadeCd = rand(5, 8); this.grenades--;
        const from = new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 0.5, 1.3, this.pos.z + Math.cos(this.yaw) * 0.5);
        const ty = (inCar ? 0.8 : pl.ped.y + 1.0) - from.y;
        const tdir = new THREE.Vector3(tp.x - from.x, ty, tp.z - from.z).normalize();
        g.combat.throwGrenade(this, from, tdir, { speed: grenadeSpeed(d, ty, tdir.y) });
        this.startSwing(0, false);
      }
    }
    if (isSword) { // melee: swing whenever the target is inside the arc's reach (the hit lands at 40% of the swing, so it can be dodged)
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && this.swingT <= 0 && los && d < WEAPONS.sword.reach - 0.2 && !pl.dead) {
        this.swingSide ^= 1;
        this.startSwing(this.swingSide, true);
        g.audio.slash(d);
        this.fireTimer = (WEAPONS.sword.rate + rand(0.3, 0.7)) / g.diff.enemyFireRate;
      } else if (this.fireTimer < 0) this.fireTimer = 0;
      return;
    }
    const canShoot = this.weapon && los && d < 50 && (this.weapon !== 'grenade' || (d > 8 && d < 26)) && (!isCop || g.wanted.level >= 2 || inCar || this.angry);
    if (canShoot) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.shootAt(tp, inCar, d);
        const w = WEAPONS[this.weapon];
        if (w.burst) {
          if (this.burstLeft <= 0) this.burstLeft = w.burst;
          this.burstLeft--;
          this.fireTimer = this.burstLeft > 0 ? w.rate * 1.3 : rand(1.0, 1.8) / g.diff.enemyFireRate;
        } else this.fireTimer = (w.rate + rand(0.5, 1.1)) * (isCop ? 1.25 : 1) * (this.boss ? 0.7 : 1) * (w.grenade ? 5 : 1) / g.diff.enemyFireRate;
      }
    } else this.fireTimer = Math.max(this.fireTimer, 0.35);
  }

  shootAt(tp, inCar, d) {
    const g = this.game, pl = g.player;
    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const from = new THREE.Vector3(this.pos.x + f.x * 0.5, 1.3, this.pos.z + f.z * 0.5);
    const ty = inCar ? 0.8 : pl.ped.y + pl.aimHeight();
    const dir = new THREE.Vector3(tp.x - from.x, ty - from.y, tp.z - from.z).normalize();
    const spread = this.accuracy * g.diff.enemySpread * (pl.dodge ? 2.4 : 1) * (pl.btActive ? 1.3 : 1) * (1 + d / 45);
    const o = { spread };
    if (this.weapon === 'grenade') o.speed = grenadeSpeed(d, ty - from.y, dir.y);
    g.combat.fire(this, from, dir, this.weapon, o);
  }

  updateCiv(dt, calm = false) {
    const g = this.game;
    if (this.panic > 0 && this.threat) {
      this.panic -= dt;
      const ax = this.pos.x - this.threat.x, az = this.pos.z - this.threat.z;
      const l = Math.hypot(ax, az) || 1;
      const c = Math.cos(this.panicBias), s = Math.sin(this.panicBias);
      const mx = (ax / l) * c - (az / l) * s, mz = (ax / l) * s + (az / l) * c;
      this.walk(mx, mz, 6, dt);
      this.yaw = Math.atan2(mx, mz);
      this.aim = false;
      this.stuckCheck(dt, true);
      return;
    }
    const bud = this.buddy;
    if (this.follow && bud && !bud.dead && !bud.remove) {
      // turf pairs: the follower walks beside its buddy
      const tx = bud.pos.x - Math.cos(bud.yaw) * 1.1 - Math.sin(bud.yaw) * 0.3, tz = bud.pos.z + Math.sin(bud.yaw) * 1.1 - Math.cos(bud.yaw) * 0.3;
      const bx = tx - this.pos.x, bz = tz - this.pos.z, bl = Math.hypot(bx, bz);
      if (bl < 25) {
        if (bl > 0.3) { this.walk(bx / bl, bz / bl, Math.min(6, bud.walkSpeed * (1 + bl * 0.5)), dt); this.yaw = bl > 1.2 ? Math.atan2(bx, bz) : bud.yaw; }
        else this.yaw = bud.yaw;
        this.stuckCheck(dt, true);
        return;
      }
    }
    if (!this.navTarget) this.pickNav();
    const t = this.navTarget;
    const tx = t.x - this.pos.x, tz = t.z - this.pos.z;
    const l = Math.hypot(tx, tz);
    if (l < 0.9) { this.pickNav(); return; }
    this.walk(tx / l, tz / l, calm ? 1.2 : this.walkSpeed, dt);
    this.yaw = Math.atan2(tx, tz);
    this.stuckCheck(dt, false);
  }
  stuckCheck(dt, panic) {
    this.stuckT += dt;
    if (this.stuckT > 2) {
      const moved = dist(this.lastX, this.lastZ, this.pos.x, this.pos.z);
      if (moved < 1) { if (panic) this.panicBias = rand(-2, 2); else this.pickNav(true); }
      this.lastX = this.pos.x; this.lastZ = this.pos.z; this.stuckT = 0;
    }
  }
  pickNav(randomize = false) {
    const nodes = this.game.city.pedNodes;
    if (this.node == null || randomize) { this.node = this.game.city.nearestPedNode(this.pos.x, this.pos.z); this.prevNode = null; this.navTarget = nodes[this.node]; return; }
    const n = nodes[this.node];
    let opts = n.n.filter((i) => i !== this.prevNode);
    if (this.turf) { const home = opts.filter((i) => gangAt(nodes[i].bx, nodes[i].bz) === this.gang); if (home.length) opts = home; } // stay on home turf
    const next = choice(opts.length ? opts : n.n);
    this.prevNode = this.node;
    this.node = next;
    this.navTarget = nodes[next];
  }
}
