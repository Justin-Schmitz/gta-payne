import * as THREE from 'three';
import { clamp, dist, wrapAngle } from '../util.js';
import { buildRoom } from '../world/interior.js';
import { drawIcon } from '../ui/minimap.js';

/** The room group is built here (inside the main scene, far from the city). */
export const ORIGIN = { x: 3000, z: 3000 };
const FADE = 0.3;         // seconds per half of the fade (out, then in)
const CLOSED_S = 60;      // shop closes this long after the keeper is hit
const DOOR_R = 2.6;       // E — LEAVE range from the door (m)

/**
 * Walk-in shops and showrooms (T14). `game.interiors.active` is the current room or null.
 *
 * Inside, the room lives at ORIGIN in the main scene (city hidden, own lights), `game.world` returns the
 * room's collision object instead of the city, and `game.update` hands the frame to `step()` which
 * runs only the player, the keeper, combat, effects, camera, HUD and audio: vehicles, peds, wanted,
 * population, missions, jobs, activities, pickups and phones are not updated, so no timer ticks.
 */
export class Interiors {
  constructor(game) {
    this.game = game;
    this.active = null;        // room object from world/interior.js, or null
    this.closedUntil = {};     // 'gun:HARLOW ARMS' / 'dealer:harlow' -> this.t when the shop reopens
    this.t = 0;                // seconds of game time (only advances while the game updates)
    this.fade = null;          // { phase: 'out' | 'in', t, after }
    this.el = document.getElementById('fade');
    this._saved = null;
  }

  get busy() { return !!this.fade; }

  // ---- transitions ----------------------------------------------------------------------
  /** Fade to black, step into the room of a gun shop (kind 'gun', data = locations.gunShops[i]) or dealer (kind 'dealer', locations.dealers[i]). */
  enter(kind, data) {
    const g = this.game;
    if (this.active || this.fade || g.state !== 'playing' || g.player.dead || !data) return false;
    this.startFade(() => this._doEnter(kind, data));
    return true;
  }
  /** Leave the room. immediate = skip the fade (save load, respawn). */
  exit(immediate = false) {
    if (!this.active) return false;
    if (immediate) { this.fade = null; this._setFade(0); this._doExit(); return true; }
    if (this.fade) return false;
    this.startFade(() => this._doExit());
    return true;
  }
  startFade(after) { this.fade = { phase: 'out', t: 0, after }; }
  _setFade(a) { if (this.el) this.el.style.opacity = String(a); }

  /** Per-frame clock and fade (called first thing in game.update, also while outside). */
  tick(raw) {
    this.t += raw;
    const f = this.fade;
    if (!f) return;
    f.t += raw;
    if (f.phase === 'out') {
      this._setFade(Math.min(1, f.t / FADE));
      if (f.t >= FADE) {
        const after = f.after;
        f.phase = 'in'; f.t = 0;
        this._setFade(1);
        try { after(); } catch (e) { console.error('interiors: transition failed', e); this.active = null; this._restoreWorld(); }
      }
    } else {
      this._setFade(Math.max(0, 1 - f.t / FADE));
      if (f.t >= FADE) { this.fade = null; this._setFade(0); }
    }
  }

  _doEnter(kind, data) {
    const g = this.game, p = g.player, ped = p.ped;
    p.setBulletTime(false);
    p.dodge = null; ped.yOffset = 0; ped.tilt = 0; ped.aim = false;
    g.combat.stopFlame();
    const room = buildRoom(g, kind, data, ORIGIN.x, ORIGIN.z);
    g.scene.add(room.group);
    // where the street door is: one metre out into the sidewalk, facing the road
    let ex = data.x, ez = data.z + 1.0;
    if (!g.city.pointFree(ex, ez, 0.4)) { ex = data.x; ez = data.z; }
    room.exitPoint = { x: ex, z: ez };
    room.exitYaw = 0;
    this._swapWorld(room);
    this.active = room;   // game.world now answers with the room's collision
    // player to the door of the room, looking in
    ped.pos.set(room.entry.x, 0, room.entry.z);
    ped.y = 0; ped.vy = 0; ped.grounded = true;
    ped.resolve();
    p.yaw = room.entry.yaw; p.pitch = 0.12; ped.yaw = p.yaw;
    g.camTransition = null;
    g.footMode.first = true;
    // the shopkeeper: a civilian ped model standing behind the counter, no AI (see _keeper)
    const shirt = kind === 'gun' ? '#7a2e1f' : '#1b3f5f';
    const k = g.spawnPed('civ', room.keeperPos.x, room.keeperPos.z, { colors: { skin: '#d9a77a', shirt, pants: '#2c2c34' } });
    k.yaw = 0; k.hp = k.maxHp = 60; k.isKeeper = true; k.noLoot = true;
    const dmg = k.damage.bind(k);
    k.damage = (n, src, dir) => { if (!k.dead) this._closeShop(room); return dmg(n, src, dir); };
    room.keeper = k;
    g.audio.setSiren(0); g.audio.setEngine(false, 0);
    g.hud.toast(room.name);
    g.last = performance.now();
  }

  _doExit() {
    const g = this.game, room = this.active;
    if (!room) return;
    const p = g.player, ped = p.ped;
    if (room.keeper) g.removePed(room.keeper);
    // drop anything that landed in the room (loot from the keeper) so it does not linger out of sight
    for (let i = g.pickups.length - 1; i >= 0; i--) {
      const pk = g.pickups[i];
      if (pk && Math.abs((pk.x ?? 0) - ORIGIN.x) < 200 && Math.abs((pk.z ?? 0) - ORIGIN.z) < 200) {
        if (pk.mesh && pk.mesh.parent) pk.mesh.parent.remove(pk.mesh);
        g.pickups.splice(i, 1);
      }
    }
    this.active = null;
    this._restoreWorld();
    room.dispose();
    p.dodge = null; ped.yOffset = 0; ped.tilt = 0; ped.aim = false;
    ped.pos.set(room.exitPoint.x, 0, room.exitPoint.z);
    ped.y = 0; ped.vy = 0; ped.grounded = true;
    ped.resolve();
    p.yaw = room.exitYaw; p.pitch = 0.12; ped.yaw = p.yaw;
    g.camTransition = null;
    g.footMode.first = true;
    g.last = performance.now();
  }

  /** Hide the city, black background, dim the sun, lit by the room's own lights. */
  _swapWorld(room) {
    const g = this.game, s = g.scene;
    this._saved = {
      bg: s.background, fogColor: s.fog ? s.fog.color.clone() : null, cityVisible: g.city.group.visible,
      lights: s.children.filter((o) => o.isHemisphereLight || o.isDirectionalLight).map((o) => ({ o, i: o.intensity })),
    };
    s.background = new THREE.Color('#000000');
    if (s.fog) s.fog.color.set('#000000');
    g.city.group.visible = false;
    for (const l of this._saved.lights) l.o.intensity = l.o.isHemisphereLight ? room.ambient.hemi : room.ambient.sun;
  }
  _restoreWorld() {
    const g = this.game, s = g.scene, sv = this._saved;
    if (!sv) return;
    s.background = sv.bg;
    if (s.fog && sv.fogColor) s.fog.color.copy(sv.fogColor);
    g.city.group.visible = sv.cityVisible;
    for (const l of sv.lights) l.o.intensity = l.i;
    this._saved = null;
  }

  // ---- shop rules -----------------------------------------------------------------------
  isClosed(room = this.active) { return !!room && this.t < (this.closedUntil[room.key] || 0); }
  _closeShop(room) {
    const was = this.isClosed(room);
    this.closedUntil[room.key] = this.t + CLOSED_S;
    if (!was) this.game.hud.toast('SHOP CLOSED');
  }

  // ---- interaction ----------------------------------------------------------------------
  _near(room) {
    const pp = this.game.player.ped.pos, c = room.counter;
    const dx = Math.max(c.x0 - pp.x, 0, pp.x - c.x1), dz = Math.max(c.z0 - pp.z, 0, pp.z - c.z1);
    return { door: dist(pp.x, pp.z, room.door.x, room.door.z) < DOOR_R, counter: Math.hypot(dx, dz) < room.reach };
  }
  /** HUD prompt text for the current spot ('' when nothing is in reach). */
  prompt() {
    const room = this.active;
    if (!room || this.fade) return '';
    const n = this._near(room);
    if (n.counter) return this.isClosed(room) ? 'CLOSED' : 'E — BROWSE';
    if (n.door) return 'E — LEAVE';
    return '';
  }
  /** E / F pressed while inside. */
  interact() {
    const room = this.active, g = this.game;
    if (!room || this.fade || g.player.dead) return;
    const n = this._near(room);
    if (n.counter) {
      if (this.isClosed(room)) { g.hud.toast('CLOSED'); return; }
      if (room.kind === 'dealer') g.dealer.open(room.data); else g.shop.open(room.data);
    } else if (n.door) this.exit();
  }

  // ---- per frame while inside -------------------------------------------------------------
  /** Replaces the rest of game.update while a room is active. dt = world time, pdt = player time, raw = real time. */
  step(raw, dt, pdt) {
    const g = this.game, room = this.active, p = g.player;
    p.ped.update(pdt);
    this._keeper(room, dt);
    room.update(dt);
    g.combat.update(dt);
    g.effects.update(dt);
    g.updateCamera(raw);
    g.syncHud();
    g.audio.setSiren(0);
    g.audio.setEngine(false, 0);
    g.audio.update(raw);
  }

  /** Keeper: faces the customer; when shot at (panic) he edges away from the threat; dead / burning use the normal ped update. */
  _keeper(room, dt) {
    const k = room.keeper, pp = this.game.player.ped.pos;
    if (!k) return;
    if (k.dead || k.burning > 0) { k.update(dt); return; }
    k.updateElevation(dt);
    if (k.panic > 0) {
      k.panic -= dt;
      const th = k.threat || pp;
      const ax = k.pos.x - th.x, az = k.pos.z - th.z, l = Math.hypot(ax, az) || 1;
      k.walk(ax / l, az / l, 3.2, dt);
      k.yaw += wrapAngle(Math.atan2(ax, az) - k.yaw) * Math.min(1, dt * 6);
    } else {
      k.yaw += wrapAngle(Math.atan2(pp.x - k.pos.x, pp.z - k.pos.z) - k.yaw) * Math.min(1, dt * 4);
    }
    k.updateMesh(dt);
  }

  /** Keep the camera inside the room (walls are one-sided planes) and below the ceiling. */
  fixCamera(cam) {
    const room = this.active;
    if (!room) return;
    const b = room.collision.bounds, m = 0.3;
    cam.position.x = clamp(cam.position.x, b.x0 + m, b.x1 - m);
    cam.position.z = clamp(cam.position.z, b.z0 + m, b.z1 - m);
    cam.position.y = clamp(cam.position.y, 0.3, room.H - 0.25);
  }

  /** Minimap replacement: flat room outline, furniture, door, keeper and the player arrow. */
  drawMinimap(mm) {
    const ctx = mm.ctx, room = this.active, size = mm.size, dpr = mm.dpr;
    if (!ctx || !room) return;
    const c = size / 2, R = c - 1.5;
    const B = room.collision.bounds;
    const s = (R - 9) / (Math.hypot(room.W, room.D) / 2);
    const sx = (x) => c + (x - room.cx) * s, sy = (z) => c + (z - room.cz) * s;
    const ped = this.game.player.ped;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#0c0e13'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#2b303a'; ctx.fillRect(sx(B.x0), sy(B.z0), room.W * s, room.D * s);
    for (const b of room.collision.boxes) {
      if (b.wall) continue;
      ctx.fillStyle = '#6b7384'; ctx.fillRect(sx(b.x0), sy(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(sx(b.x0) + 0.5, sy(b.z0) + 0.5, (b.x1 - b.x0) * s - 1, (b.z1 - b.z0) * s - 1);
    }
    ctx.strokeStyle = '#d7dbe3'; ctx.lineWidth = 3;
    ctx.strokeRect(sx(B.x0), sy(B.z0), room.W * s, room.D * s);
    ctx.fillStyle = '#2fd36a'; ctx.fillRect(sx(room.door.x) - 1.0 * s, sy(B.z1) - 2.5, 2.0 * s, 5);
    const k = room.keeper;
    if (k) {
      ctx.beginPath(); ctx.arc(sx(k.pos.x), sy(k.pos.z), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = k.dead ? '#555' : '#ff8a1f'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#000'; ctx.stroke();
    }
    drawIcon(ctx, 'player', sx(ped.pos.x), sy(ped.pos.z), mm.iconR, { yaw: ped.yaw });
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = '#0b0b0b';
    ctx.beginPath(); ctx.arc(c, c, c - 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,224,102,0.8)';
    ctx.beginPath(); ctx.arc(c, c, c - 3.5, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 10px Oswald, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(room.name, c, size - 14);
    ctx.fillStyle = '#ffe066'; ctx.fillText(room.name, c, size - 14);
  }
}
