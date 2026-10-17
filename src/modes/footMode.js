import * as THREE from 'three';
import { clamp, damp, wrapAngle, dist } from '../util.js';
import { GRAVITY } from '../entities/ped.js';

// Tuning (metres, seconds). Gravity (22 m/s^2) lives in entities/ped.js.
const JUMP_V = 7.5;          // jump launch speed: apex = v^2 / 2g = 1.28 m
const DIVE_VY = 3.6;         // dive launch vertical speed
const DIVE_G = 9;            // gravity while diving (m/s^2): hang time 2 * 3.6 / 9 = 0.8 s, apex 0.72 m (jump keeps the full 22)
const DIVE_V0 = 8.5;         // dive launch horizontal speed (m/s) ...
const DIVE_DECAY = 0.5;      // ... decaying linearly to (1 - DIVE_DECAY) * V0 at DIVE_T, then 0: ~6 m total
const DIVE_T = 0.95;         // horizontal dive motion lasts this long (0.8 s air + a short prone slide)
const KNOCK_R = 1.5;         // diving into a ped closer than this knocks it down ...
const KNOCK_T = 1.5;         // ... for this long
const DIVE_TILT = 0.76;      // body lean in flight as a fraction of lying flat (1.2 rad)
const PRONE_MIN = 0.1;       // lying time before a fresh move press can get you up
const PRONE_HELD = 0.45;     // lying time when a move key is still held from the dive
const PRONE_MAX = Infinity;  // you stay down until a move key (Max Payne); dodge bullet time stops being free 1.5 s after landing
const GETUP = 0.3;           // get-up duration (cannot dodge again until done)
const GETUP_SPEED = 0.6;     // walking speed multiplier while getting up
const SHOULDER_PRONE = 0.4;   // shoulder offset factor when prone (1 = normal)
const PRONE_PIVOT = 1.05;    // camera pivot drop when prone (camera ends ~0.9-1.0 m high)
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
// double-tapped key -> dive direction relative to the camera (f = forward, r = right)
const TAP_DIRS = { KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0], KeyA: [0, -1], ArrowLeft: [0, -1], KeyD: [0, 1], ArrowRight: [0, 1] };
const JUMP_BT_V = Math.sqrt(2 * GRAVITY * 1.6); // Shift+Space bullet-time jump: 1.6 m apex (8.4 m/s)
const AIR_ROLL = 6 * Math.PI / 180;  // camera roll toward the lateral movement while airborne in bullet time
const AIR_FOV = 3;                   // ... and the FOV widens this much (game.updateCamera reads extraFov)
const BLOCKED_R = 3;                 // crosshair greys out when the aim ray hits a wall closer than this to the player

// Aim assist (soft lock). cone: max angle (deg) between the crosshair ray and a hostile's chest; nudge: fraction of
// the way each shot turns toward that chest (Player.fire); sticky: look-sensitivity factor while on a target.
export const AIM_KEY = 'port-harlow-aim';
export const AIM_LEVELS = {
  off: null,
  normal: { id: 'normal', cone: 4, nudge: 0.7, sticky: 0.65 },
  strong: { id: 'strong', cone: 8, nudge: 1, sticky: 0.5 },
};
const AIM_ORDER = ['off', 'normal', 'strong'];
export const AIM_RANGE = 40;         // metres
export const AIM_BT_CONE = 1.5;      // cone multiplier in bullet time
const LOOK_SENS = 0.0022;
const loadAimLevel = (touch) => {
  let v = null;
  try { v = localStorage.getItem(AIM_KEY); } catch (e) { /* private mode */ }
  return AIM_ORDER.includes(v) ? v : touch ? 'strong' : 'normal';
};

/** Max Payne-style over-the-shoulder camera, mouse aim, bullet time and shoot-dodge. */
export class FootMode {
  constructor(game) {
    this.game = game;
    this.dist = 4.0;
    this.shoulder = 0.75;
    this.camPos = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.first = true;
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._pivot = new THREE.Vector3();
    this.spread = 6;            // crosshair gap in px (tightens when still, loosens while moving), see updateCrosshair
    this.kick = 0;
    this.aimLevel = null;       // 'off' | 'normal' | 'strong' (localStorage port-harlow-aim, K cycles); resolved on first update
    this.aimTarget = null;      // hostile ped under the soft lock this frame (also game.player.aimTarget)
    this.aimBlocked = false;    // the aim ray hits a wall within 3 m of the player
    this.roll = 0;              // camera roll (rad), airborne in bullet time
    this.extraFov = 0;          // added to the FOV by game.updateCamera (airborne in bullet time)
    this.lateral = 0;           // -1..1 sideways component of the current movement (camera right = +)
    this._chest = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._aimDir = new THREE.Vector3();
  }
  /** Current aim-assist parameters ({cone, nudge, sticky}) or null when off. */
  get aimAssist() { return AIM_LEVELS[this.aimLevel] || null; }
  setAimLevel(id, toast = true) {
    if (!AIM_ORDER.includes(id)) return;
    this.aimLevel = id;
    try { localStorage.setItem(AIM_KEY, id); } catch (e) { /* ignore */ }
    if (toast) this.game.hud.toast('AIM ASSIST: ' + id.toUpperCase(), 2);
  }
  cycleAimLevel() { this.setAimLevel(AIM_ORDER[(AIM_ORDER.indexOf(this.aimLevel) + 1) % AIM_ORDER.length]); }
  enter() {
    const g = this.game;
    g.hud.setCrosshair(true);
    this.first = true;
    g.player.ped.landSpeed = 0;
    g.audio.setEngine(false, 0);
    g.input.requestLock();
  }
  exit() {
    const p = this.game.player;
    p.setBulletTime(false);
    p.dodge = null; p.jumpBT = null;
    p.ped.yOffset = 0; p.ped.tilt = 0;
    this.aimTarget = null; p.aimTarget = null; this.aimBlocked = false;
    this.roll = 0; this.extraFov = 0;
    if (this.game.hud.setAimState) this.game.hud.setAimState('idle');
    this.game.hud.setClickToAim(false);
  }

  update(rawDt, dt) {
    const g = this.game, p = g.player, inp = g.input, ped = p.ped;
    if (g.killCam) { this.updateKillCam(dt); return; } // input is ignored while the kill-cam runs
    g.hud.setClickToAim(!inp.aiming);
    if (this.aimLevel === null) this.aimLevel = loadAimLevel(inp.touch);
    if (inp.wasPressed('KeyK')) this.cycleAimLevel();
    if (inp.aiming) {
      const sens = LOOK_SENS * (this.aimTarget && this.aimAssist ? this.aimAssist.sticky : 1); // sticky: slower look while on a target
      p.yaw -= inp.mouse.dx * sens;
      p.pitch = clamp(p.pitch + inp.mouse.dy * sens, -0.55, 0.95);
    }
    // weapons
    for (let i = 0; i < 9; i++) if (inp.wasPressed('Digit' + (i + 1))) p.selectSlot(i);
    if (inp.wasPressed('KeyH') && !p.usePainkiller() && !p.dead) { // H / touch PILLS
      if (p.painkillers <= 0) g.hud.toast('NO PAINKILLERS'); else if (p.hp >= 100) g.hud.toast('HEALTH FULL');
    }
    if (inp.mouse.wheel !== 0) p.cycleWeapon(inp.mouse.wheel > 0 ? 1 : -1);
    if (inp.wasPressed('KeyQ')) p.cycleWeapon(1);

    // movement intent (camera relative)
    let mx = 0, mz = 0;
    if (inp.down('KeyW') || inp.down('ArrowUp')) mz += 1;
    if (inp.down('KeyS') || inp.down('ArrowDown')) mz -= 1;
    if (inp.down('KeyA') || inp.down('ArrowLeft')) mx -= 1;
    if (inp.down('KeyD') || inp.down('ArrowRight')) mx += 1;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fwd = { x: sy, z: cy }, right = { x: -cy, z: sy };
    mx += inp.axis.x; mz += inp.axis.y;
    let dx = fwd.x * mz + right.x * mx, dz = fwd.z * mz + right.z * mx;
    let ml = Math.hypot(dx, dz);
    if (ml < 0.15) { ml = 0; dx = 0; dz = 0; }
    const walkScale = Math.min(1, ml);
    if (ml > 0) { dx /= ml; dz /= ml; }
    this.lateral = p.dodge ? p.dodge.dir.x * right.x + p.dodge.dir.z * right.z : (dx * right.x + dz * right.z) * walkScale;

    // bullet time toggle
    const btWas = p.btActive;
    const shiftDown = inp.down('ShiftLeft') || inp.down('ShiftRight');
    if (inp.wasPressed('ShiftLeft') || inp.wasPressed('ShiftRight')) {
      if (p.btActive) p.setBulletTime(false); else p.setBulletTime(true);
    }
    // bullet-time jump ends on landing (free while airborne, see Player.updateMeters) unless Shift is held
    if (p.jumpBT && ped.grounded && ped.vy <= 0) this.endJumpBT(shiftDown);
    // jump (Space; Shift+Space or touch JUMP during bullet time = higher bullet-time jump) and shoot-dodge (RMB / touch DODGE / double-tap WASD)
    const justLanded = ped.landSpeed; ped.landSpeed = 0;
    if (!p.dodge && ped.grounded && inp.wasPressed('Space')) {
      if (shiftDown || (inp.touch && p.btActive)) this.startJumpBT(!btWas || inp.wasPressed('ShiftLeft') || inp.wasPressed('ShiftRight'));
      else ped.vy = JUMP_V;
      ped.grounded = false;
      if (g.audio.jump) g.audio.jump(); else g.audio.noise(0.14, { f: 500, g: 0.12, fEnd: 900 });
    }
    if (!p.dodge && inp.wasPressed('Mouse2')) this.startDodge(ml > 0 ? { x: dx, z: dz } : { x: fwd.x, z: fwd.z });
    if (!p.dodge) {
      for (const code in TAP_DIRS) {
        if (!inp.doubleTap(code)) continue;
        const [a, b] = TAP_DIRS[code];
        this.startDodge({ x: fwd.x * a + right.x * b, z: fwd.z * a + right.z * b });
        break;
      }
    }
    if (!p.dodge && justLanded > 4) { if (g.audio.land) g.audio.land(); else g.audio.thud(0); }

    if (p.dodge) this.updateDodge(dt, ml, dx, dz, walkScale, justLanded);
    else if (ml > 0) {
      const sp = 5.4 * walkScale * (g.hero ? g.hero.speed : 1) * (g.cheats && g.cheats.on.speedy ? 2 : 1);
      ped.walk(dx, dz, sp, dt);
      ped.yaw = p.yaw;
    } else {
      ped.yaw = p.yaw;
    }
    ped.aim = p.weaponId !== 'fist';
    if (p.weaponId === 'fist') ped.aim = inp.mouseDown(0);

    // fire
    if (p.fireTimer > 0) p.fireTimer -= dt;
    this.computeAim();
    this.findAimTarget();
    this.updateAirFlair(rawDt);
    this.updateCrosshair(rawDt, ml > 0, !!p.dodge || !ped.grounded);
    if ((p.weaponId === 'grenade' ? inp.wasPressed('Mouse0') : inp.mouseDown(0)) && inp.aiming && !g.paused) {   // grenades: one throw per click / FIRE tap
      const t0 = p.fireTimer;
      p.fire(this.aimPoint);
      if (p.fireTimer > t0) this.kick = Math.min(10, this.kick + 4); // crosshair kick on every shot
    }
  }

  /** Crosshair gap + extra bullet spread: tight when standing still, wider while walking, widest airborne / diving. */
  updateCrosshair(rawDt, moving, airborne) {
    const g = this.game, p = g.player;
    const target = (airborne ? 15 : moving ? 10 : 4) * (this.aimTarget ? 0.6 : 1); // on a target: tighter
    this.spread = damp(this.spread, target, 14, rawDt);
    this.kick = damp(this.kick, 0, 9, rawDt);
    g.hud.setSpread(this.spread + this.kick);
    if (g.hud.setAimState) g.hud.setAimState(this.aimTarget ? 'target' : this.aimBlocked ? 'blocked' : 'idle');
    p.moveSpread = airborne ? 0.016 : moving ? 0.01 : 0;
  }

  /** Kill-cam running: no input; gravity / AI keep going at the slowed time scale. */
  updateKillCam(dt) {
    const g = this.game, p = g.player, ped = p.ped;
    ped.landSpeed = 0;
    if (p.dodge) this.updateDodge(dt, 0, 0, 0, 0, 0);
    else ped.yaw = p.yaw;
    ped.aim = p.weaponId !== 'fist';
    if (p.fireTimer > 0) p.fireTimer -= dt;
  }

  /**
   * Shift+Space (touch: JUMP while bullet time is on): a 1.6 m jump with bullet time for the air time at no
   * meter cost (Player.updateMeters). `engaged`: this jump switched bullet time on, so landing switches it off
   * again unless Shift is held.
   */
  startJumpBT(engaged) {
    const g = this.game, p = g.player;
    p.ped.vy = JUMP_BT_V;
    if (!p.btActive) { p.btActive = true; g.onBulletTime(true); engaged = true; } // like the dive: even with an empty meter
    p.jumpBT = { engaged };
  }
  endJumpBT(shiftDown) {
    const p = this.game.player, j = p.jumpBT;
    p.jumpBT = null;
    if (!j || !j.engaged || !p.btActive) return;
    if (p.dodge) { p.dodgeBT = true; return; } // dived out of the jump: the dive's free-BT rules take over
    if (!shiftDown) p.setBulletTime(false);
  }

  /** Enemy the aim assist may lock on to (cops with heat / angry, alerted, mission or hostile-turf gangsters, bosses). */
  isHostile(e) {
    const g = this.game;
    if (e.boss || e.miniBoss) return true;
    if (e.kind === 'cop') return g.wanted.level > 0 || e.angry;
    if (e.kind === 'gang') return e.alerted || e.mission || (e.turf && (g.respect[e.gang] || 0) < g.diff.turfHostile);
    return false;
  }
  /** Chest point of a ped (lower while knocked down); bosses are scaled. */
  chestOf(e, out) {
    return out.set(e.pos.x, e.y + (e.knockT > 0 ? 0.35 : 1.2 * (e.bossScale || 1)), e.pos.z);
  }
  /**
   * Soft lock: the living hostile within 40 m whose chest is closest to the crosshair ray, inside the cone
   * (4 deg normal / 8 deg strong, x1.5 in bullet time), in front of the player and in line of sight.
   */
  findAimTarget() {
    const g = this.game, p = g.player, a = this.aimAssist;
    let best = null;
    if (a && !p.dead) {
      const cam = g.camera, c = cam.position, f = cam.getWorldDirection(this._aimDir), pp = p.ped.pos;
      const fh = Math.hypot(f.x, f.z) || 1;
      let bestCos = Math.cos(a.cone * (p.btActive ? AIM_BT_CONE : 1) * Math.PI / 180);
      for (const e of g.peds) {
        if (e.dead || e.remove || e.vehicle || e.isPlayer || !this.isHostile(e)) continue;
        const hx = e.pos.x - pp.x, hz = e.pos.z - pp.z;
        if (hx * hx + hz * hz > AIM_RANGE * AIM_RANGE || (hx * f.x + hz * f.z) / fh < 0.5) continue; // too far / not in front of us
        const ch = this.chestOf(e, this._chest);
        const vx = ch.x - c.x, vy = ch.y - c.y, vz = ch.z - c.z;
        const cosA = (vx * f.x + vy * f.y + vz * f.z) / (Math.hypot(vx, vy, vz) || 1);
        if (cosA <= bestCos) continue;
        if (!g.world.lineOfSight(pp.x, pp.z, e.pos.x, e.pos.z)) continue;
        bestCos = cosA; best = e;
      }
    }
    this.aimTarget = best; p.aimTarget = best;
  }
  /** Airborne in bullet time (jump or dive): roll the camera toward the sideways movement and widen the FOV. */
  updateAirFlair(rawDt) {
    const p = this.game.player, ped = p.ped;
    const air = p.btActive && !p.dead && (!ped.grounded || (p.dodge && p.dodge.phase === 'fly'));
    this.roll = damp(this.roll, air ? AIR_ROLL * clamp(this.lateral, -1, 1) : 0, 8, rawDt);
    this.extraFov = damp(this.extraFov, air ? AIR_FOV : 0, 10, rawDt);
    if (!air && Math.abs(this.roll) < 1e-4) this.roll = 0;
    if (!air && this.extraFov < 0.01) this.extraFov = 0;
  }

  startDodge(dir) {
    const g = this.game, p = g.player, ped = p.ped, inp = g.input;
    // t: total time, pt: time in the current phase, low: 0 standing .. 1 prone (hit box / muzzle / camera)
    p.dodge = { t: 0, pt: 0, phase: 'fly', dir, low: 0, f: 0, fg0: 1, released: false, blocked: false, yaw0: Math.atan2(dir.x, dir.z) };
    if (ped.grounded) { ped.vy = DIVE_VY; ped.grounded = false; }
    if (!p.btActive) { p.btActive = true; g.onBulletTime(true); p.dodgeBT = true; } // free: see Player.updateMeters
    g.audio.noise(0.25, { f: 300, g: 0.25, fEnd: 80 });
  }

  /** Move along the dive in <= 0.2 m steps (no tunnelling); flags `blocked` when a wall stops us. */
  diveMove(d, len) {
    const ped = this.game.player.ped;
    const n = Math.max(1, Math.ceil(len / 0.2)), step = len / n;
    for (let i = 0; i < n; i++) {
      const x0 = ped.pos.x, z0 = ped.pos.z;
      ped.move(d.dir.x * step, d.dir.z * step);
      if (Math.hypot(ped.pos.x - x0, ped.pos.z - z0) < step * 0.4) { d.blocked = true; return; }
    }
  }

  updateDodge(dt, ml, dx, dz, walkScale, justLanded) {
    const g = this.game, p = g.player, inp = g.input, ped = p.ped, d = p.dodge;
    d.t += dt; d.pt += dt;
    if (ml === 0) d.released = true;
    ped.speed = 0;
    // horizontal dive motion: fast, decaying, stops on a wall; continues as a prone slide after landing
    if (d.t < DIVE_T && !d.blocked) this.diveMove(d, DIVE_V0 * (1 - DIVE_DECAY * d.t / DIVE_T) * dt);

    if (!ped.grounded && d.phase === 'fly') ped.vy += (GRAVITY - DIVE_G) * dt; // floaty dive: ped.update applies the full GRAVITY after us
    if (d.t < DIVE_T) this.knockNearby();
    if (d.phase === 'fly') {
      d.f = Math.min(DIVE_TILT, d.f + dt * 4);
      if (ped.grounded && d.t > 0.06) { // landed (on the ground or on a crate)
        d.phase = 'prone'; d.pt = 0;
        g.audio.thud(0);
        if (justLanded <= 4) g.effects.dust(ped.pos.x, ped.y + 0.1, ped.pos.z);
      }
    } else if (d.phase === 'prone') {
      d.f = Math.min(1, d.f + dt * 8);
      const newPress = !g.killCam && MOVE_KEYS.some((k) => inp.wasPressed(k)) || (ml > 0 && d.released);
      if ((d.pt > PRONE_MIN && newPress) || (d.pt > PRONE_HELD && ml > 0) || d.pt >= PRONE_MAX) { d.phase = 'getup'; d.pt = 0; d.fg0 = d.f; }
    }
    if (d.phase === 'getup') {
      d.f = d.fg0 * Math.max(0, 1 - d.pt / GETUP);
      if (ml > 0) ped.walk(dx, dz, 5.4 * walkScale * GETUP_SPEED, dt);
    }
    d.low = d.f;
    ped.tilt = d.f * Math.PI / 2;
    ped.yOffset = 0.15 * Math.min(1, d.f / DIVE_TILT);
    // face the dive direction while diving, blend back to the camera yaw while getting up
    if (d.phase === 'getup') ped.yaw += wrapAngle(p.yaw - ped.yaw) * Math.min(1, dt * 14);
    else ped.yaw = d.yaw0;

    if (d.phase === 'getup' && d.pt >= GETUP) {
      p.dodge = null; ped.yOffset = 0; ped.tilt = 0; ped.yaw = p.yaw;
      if (p.dodgeBT) { p.dodgeBT = false; if (!inp.down('ShiftLeft') && !inp.down('ShiftRight')) { p.btActive = false; g.onBulletTime(false); } }
    }
  }

  /** Peds within 1.5 m of the diving player get knocked down for 1.5 s. */
  knockNearby() {
    const g = this.game, ped = g.player.ped;
    for (const e of g.peds) {
      if (e.dead || e.knockT > 0 || e.vehicle) continue;
      if (Math.abs(e.pos.x - ped.pos.x) > KNOCK_R || Math.abs(e.pos.z - ped.pos.z) > KNOCK_R) continue;
      if (dist(e.pos.x, e.pos.z, ped.pos.x, ped.pos.z) < KNOCK_R && Math.abs(e.y - ped.y) < 1.5) { e.knockDown(KNOCK_T); g.audio.thud(0); }
    }
  }

  computeAim() {
    const g = this.game, cam = g.camera;
    cam.getWorldDirection(this._f);
    let t = 60;
    if (this._f.y < -0.001) t = Math.min(t, -cam.position.y / this._f.y);
    // stop at first building hit
    const ex = cam.position.x + this._f.x * t, ez = cam.position.z + this._f.z * t;
    const py = g.player.ped.y;
    const ht = g.world.raycast(cam.position.x, cam.position.z, ex, ez, py > 0 ? py + 0.06 : 0); // boxes below our feet (the crate we stand on) don't block aim
    this.aimBlocked = false;
    if (ht !== null) {
      const hy = cam.position.y + this._f.y * t * ht;
      if (hy >= 0) {
        // crosshair greys out when that wall is within 3 m in front of the player (the shot would hit it)
        const pp = g.player.ped.pos, wx = cam.position.x + this._f.x * t * ht - pp.x, wz = cam.position.z + this._f.z * t * ht - pp.z;
        const along = wx * Math.sin(g.player.yaw) + wz * Math.cos(g.player.yaw);
        this.aimBlocked = along > 0 && Math.hypot(wx, wz) < BLOCKED_R;
        t = Math.max(1.5, t * ht);
      }
    }
    this.aimPoint.copy(cam.position).addScaledVector(this._f, t);
  }

  cameraTarget(dt, outPos, outQuat) {
    const g = this.game, p = g.player, ped = p.ped, cam = g.cam;
    const pitch = Math.min(1.2, p.pitch + cam.tilt * (1 - p.low));
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = this._f.set(sy * cp, -sp, cy * cp);
    const r = this._r.set(-cy, 0, sy);
    const pivotY = 1.55 + (cam.pivotY - 1.55) * (1 - p.low);
    const pivot = this._pivot.set(ped.pos.x, pivotY + ped.y + (ped.yOffset || 0) * 0.5 - PRONE_PIVOT * p.low, ped.pos.z);
    pivot.addScaledVector(r, cam.shoulder * (1 - (1 - SHOULDER_PRONE) * p.low)); // lying down: lower and closer to the body
    // camera collision: shorten against buildings
    let d = cam.dist - 0.8 * p.low;
    const bx = pivot.x - f.x * d, bz = pivot.z - f.z * d;
    const t = g.world.raycast(pivot.x, pivot.z, bx, bz, Math.max(0.5, ped.y + 0.5));
    if (t !== null) d = Math.max(0.8, d * t - 0.4);
    const desired = new THREE.Vector3().copy(pivot).addScaledVector(f, -d);
    if (desired.y < 0.4) desired.y = 0.4;
    if (this.first) { this.camPos.copy(desired); this.first = false; }
    else {
      const k = p.dodge ? 45 : 18; // tight follow during the dive so the body never lags behind the view
      this.camPos.x = damp(this.camPos.x, desired.x, k, dt);
      this.camPos.y = damp(this.camPos.y, desired.y, k, dt);
      this.camPos.z = damp(this.camPos.z, desired.z, k, dt);
    }
    outPos.copy(this.camPos);
    const look = new THREE.Vector3().copy(pivot).addScaledVector(f, 8);
    const m = new THREE.Matrix4();
    // roll (airborne in bullet time): tilt the up vector toward the camera's right (+) / left (-)
    const up = this._up.set(0, Math.cos(this.roll), 0).addScaledVector(r, Math.sin(this.roll));
    m.lookAt(outPos, look, up);
    outQuat.setFromRotationMatrix(m);
  }
}
