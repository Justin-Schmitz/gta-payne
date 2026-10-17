import * as THREE from 'three';
import { segCircle, dist } from '../util.js';

// Kill-cam tuning (seconds are real time, distances metres)
export const KC_SCALE = 0.12;       // world (and player) time scale while it runs
export const KC_COOLDOWN = 8;       // minimum seconds between two kill-cams
export const KC_BEHIND = 1.2;       // camera sits this far behind the bullet ...
export const KC_ABOVE = 0.3;        // ... and this far above it
export const KC_BLEND = 0.15;       // blend from the shoulder camera into the bullet camera
export const KC_FOLLOW_MAX = 1.9;   // follow phase gives up after this long (bullet too slow / far)
export const KC_HOLD = 0.7;         // hold on the falling body
export const KC_HOLD_MISS = 0.25;   // hold when the bullet hit something else
export const KC_RETURN = 0.4;       // ease back to the shoulder camera (game.camTransition)
export const KC_HARD = 3.0;         // hard timeout for the whole thing (camera can never stay detached)
export const KC_MAX_DIST = 32;      // the target must be at most this far (the bullet needs <= ~1.8 s)
export const KC_MIN_DIST = 4;
export const KC_HOSTILE_RADIUS = 45;

/** Is this ped an enemy that wants the player dead (mission target, alerted gang member, angry cop)? */
export function isHostile(game, p) {
  if (p.dead || p.kind === 'civ' || p.isPlayer) return false;
  if (p.kind === 'cop') return p.angry || game.wanted.level > 0 || p.mission;
  return p.alerted || p.mission;
}

/**
 * Max Payne style kill-cam. While `game.killCam = {bullet, t, phase, ...}` is set, game.updateCamera calls
 * `apply()` instead of the mode camera; `update()` ends it on impact / expiry / bullet removal / timeout.
 * phases: 'follow' (camera trails the bullet) -> 'hold' (static camera on the falling body) -> ends with a 0.4 s
 * ease back to the shoulder camera through game.camTransition.
 */
export class KillCam {
  constructor(game) {
    this.game = game;
    this.cd = 0;
    this._m = new THREE.Matrix4();
    this._eye = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this.count = 0;   // how many kill-cams have run (for tests)
  }

  /**
   * Called by Player.fire with the projectiles of a shot. Starts a kill-cam when the shot is a single
   * non-rocket bullet that would kill the only living hostile within 45 m and flies straight at it.
   */
  tryStart(shots, weaponId, from) {
    const g = this.game, p = g.player;
    if (this.cd > 0 || g.killCam || g.state !== 'playing' || g.paused || g.mode !== 'foot') return false;
    if (p.dead || p.vehicle || shots.length !== 1 || (g.interiors && g.interiors.active)) return false;
    const w = g.player.weapon;
    if (!w || w.rocket || w.flame || w.melee) return false;
    const b = shots[0];
    let target = null, n = 0;
    for (const e of g.peds) {
      if (!isHostile(g, e)) continue;
      if (dist(e.pos.x, e.pos.z, p.ped.pos.x, p.ped.pos.z) > KC_HOSTILE_RADIUS) continue;
      target = e; n++;
      if (n > 1) return false;
    }
    if (!target) return false;
    const d = dist(target.pos.x, target.pos.z, b.x, b.z);
    if (d < KC_MIN_DIST || d > KC_MAX_DIST || target.hp > b.dmg) return false;   // the shot has to kill
    // the straight path must hit the ped's body, with nothing solid in between
    const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
    const len = Math.min(KC_MAX_DIST + 6, b.life * sp);
    const ex = b.x + (b.vx / sp) * len, ey = b.y + (b.vy / sp) * len, ez = b.z + (b.vz / sp) * len;
    const t = segCircle(b.x, b.z, ex, ez, target.pos.x, target.pos.z, 0.4);
    if (t === null) return false;
    const hy = b.y + (ey - b.y) * t;
    if (hy < target.y + 0.15 || hy > target.y + 1.75) return false;
    if (!g.world.lineOfSight(b.x, b.z, target.pos.x, target.pos.z, 0.8)) return false;
    // nothing else may stand in the way: parked cars and other people would soak up the bullet
    for (const v of g.vehicles) {
      if (dist(v.pos.x, v.pos.z, b.x, b.z) > d + v.type.len) continue;
      for (const c of v.circles()) {
        const tc = segCircle(b.x, b.z, ex, ez, c.x, c.z, c.r);
        if (tc !== null && tc < t && b.y + (ey - b.y) * tc <= v.type.h + 0.4) return false;
      }
    }
    for (const e of g.peds) {
      if (e === target || e.dead || e.isPlayer) continue;
      const tc = segCircle(b.x, b.z, ex, ez, e.pos.x, e.pos.z, 0.5);
      if (tc !== null && tc < t) return false;
    }

    this.cd = KC_COOLDOWN;
    b.noTrail = true;   // the camera sits right behind the bullet: its own trail would be a white smear
    this.count++;
    g.killCam = {
      bullet: b, t: 0, phase: 'follow', target, holdT: 0,
      fromPos: g.camera.position.clone(), fromQuat: g.camera.quaternion.clone(),
      pos: g.camera.position.clone(), quat: g.camera.quaternion.clone(), dir: new THREE.Vector3(b.vx / sp, b.vy / sp, b.vz / sp),
    };
    g.timeScale = g.playerScale = KC_SCALE;
    g.hud.setCrosshair(false);
    g.canvas.classList.add('bt');
    g.audio.setBulletTime(true);
    if (!p.btActive) g.audio.btIn();
    return true;
  }

  /** Advance the state machine with real dt; call once per game update after combat.update. */
  update(raw) {
    if (this.cd > 0) this.cd -= raw;
    const g = this.game, k = g.killCam;
    if (!k) return;
    k.t += raw;
    const p = g.player;
    if (p.dead || p.vehicle || g.state !== 'playing' || k.t >= KC_HARD) { this.end(); return; }
    if (k.phase === 'follow') {
      const b = k.bullet;
      const gone = b.done || !g.combat.bullets.includes(b);
      if (gone || k.t > KC_FOLLOW_MAX) {
        k.phase = 'hold';
        const hitPed = b.hit && b.hit.kind === 'ped' ? b.hit.ped : null;
        if (hitPed) k.target = hitPed;
        k.holdT = k.target && k.target.dead && hitPed ? KC_HOLD : KC_HOLD_MISS;
        k.holdPos = k.pos.clone();
        if (b.hx !== undefined) { k.impact = new THREE.Vector3(b.hx, b.hy, b.hz); }
      }
    } else {
      k.holdT -= raw;
      if (k.holdT <= 0) this.end();
    }
  }

  /** Write the kill-cam camera pose into pos / q (replaces the mode camera). */
  apply(raw, pos, q) {
    const g = this.game, k = g.killCam;
    if (k.phase === 'follow') {
      const b = k.bullet;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const nx = b.vx / sp, ny = b.vy / sp, nz = b.vz / sp;
      k.dir.set(nx, ny, nz);
      const e = this._eye.set(b.x - nx * KC_BEHIND, Math.max(0.3, b.y - ny * KC_BEHIND + KC_ABOVE), b.z - nz * KC_BEHIND);
      const s = Math.min(1, k.t / KC_BLEND), bl = s * s * (3 - 2 * s);
      pos.lerpVectors(k.fromPos, e, bl);
      this._look.set(b.x + nx * 6, b.y + ny * 6, b.z + nz * 6);
      this._m.lookAt(pos, this._look, this._up);
      q.setFromRotationMatrix(this._m);
      if (bl < 1) q.slerpQuaternions(k.fromQuat, q, bl);
      k.pos.copy(pos);
    } else {
      // hold: the camera stays where the bullet camera was, drifting slowly in, looking at the falling body
      const t = k.target;
      pos.copy(k.holdPos).addScaledVector(k.dir, 0.25 * (KC_HOLD - Math.max(0, k.holdT)));
      if (t) this._look.set(t.pos.x, t.y + (t.dead ? 0.6 : 1.0), t.pos.z);
      else this._look.copy(k.impact || pos);
      this._m.lookAt(pos, this._look, this._up);
      q.setFromRotationMatrix(this._m);
    }
  }

  /** Give the camera back: ease from the current kill-cam pose to the shoulder camera over 0.4 s. */
  end() {
    const g = this.game, k = g.killCam;
    if (!k) return;
    g.killCam = null;
    g.camTransition = { t: 0, dur: KC_RETURN, fromPos: g.camera.position.clone(), fromQuat: g.camera.quaternion.clone() };
    g.footMode.first = true;
    g.canvas.classList.toggle('bt', g.player.btActive);
    g.audio.setBulletTime(g.player.btActive);
    if (!g.player.btActive) g.audio.btOut();
    g.hud.setCrosshair(g.mode === 'foot' && !g.player.dead);
  }
}
