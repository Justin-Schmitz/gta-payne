import { CHEATS, CHEAT_BY_CODE, MAX_CODE_LEN } from '../data/cheats.js';
import { MISSIONS } from '../data/missions.js';
import { WEAPONS, WEAPON_ORDER } from './combat.js';
import { VEHICLE_TYPES } from '../entities/vehicle.js';
import { rand } from '../util.js';

const STORE_KEY = 'port-harlow-cheats';

/**
 * Cheat-code system: typed codes during play, a console (backtick / pause-menu button, touch
 * friendly), persistent toggles, and the per-frame enforcement of the toggles.
 */
export class Cheats {
  constructor(game) {
    this.game = game;
    this.buffer = '';
    this.on = { god: false, matrix: false, neverwanted: false, turbo: false, speedy: false, moon: false, superpunch: false, bighead: false, katana: false };
    this.used = false;
    this.open = false;
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.on) Object.assign(this.on, s.on); if (s && s.used) this.used = true; } catch (e) { /* ignore */ }
    this.buildConsole();
    game.input.onKeyFirst((code, e) => this.onKey(code, e));
  }
  get gravity() { return this.on.moon ? 0.35 : 1; }

  // ---- typed codes ----------------------------------------------------------
  onKey(code, e) {
    const g = this.game;
    if (this.open) return;
    if (g.state !== 'playing' || g.paused) return;
    if (code === 'Backquote') { this.show(true); return; }
    const k = e && e.key && e.key.length === 1 ? e.key.toUpperCase() : null;
    if (!k || k < 'A' || k > 'Z') return;
    const now = performance.now();
    if (now - (this.lastKeyT || 0) > 2500) this.buffer = ''; // a pause ends the attempt
    this.lastKeyT = now;
    this.buffer = (this.buffer + k).slice(-MAX_CODE_LEN);
    for (const c of CHEATS) if (this.buffer.endsWith(c.code)) { this.activate(c); this.buffer = ''; return true; }
    // while a code is being typed (2+ letters that start some code), swallow the key so M / E / V / H / K do not fire
    for (let n = Math.min(this.buffer.length, MAX_CODE_LEN); n >= 2; n--) {
      const tail = this.buffer.slice(-n);
      if (CHEATS.some((c) => c.code.startsWith(tail))) return true;
    }
    return false;
  }
  activate(c) {
    const g = this.game;
    let msg;
    if (c.kind === 'toggle') {
      this.on[c.key] = !this.on[c.key];
      this.applyToggle(c.key, this.on[c.key]);
      msg = `CHEAT ${c.name.toUpperCase()}: ${this.on[c.key] ? 'ON' : 'OFF'}`;
    } else msg = c.run(g, this) || `CHEAT: ${c.name.toUpperCase()}`;
    this.used = true;
    this.persist();
    g.hud.toast(msg, 3);
    g.audio.pickup();
    const el = document.getElementById('pause-cheats'); if (el) el.textContent = 'CHEATS USED';
    this.renderList();
  }
  persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ on: this.on, used: this.used })); } catch (e) { /* ignore */ } }

  // ---- console ------------------------------------------------------------------
  buildConsole() {
    const root = document.createElement('div');
    root.id = 'cheats';
    root.innerHTML = `<div class="panel cheats-panel"><h1>CHEATS</h1>
      <div class="cheats-row"><input id="cheat-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="TYPE A CODE" /><button id="cheat-go">GO</button></div>
      <div id="cheat-msg"></div>
      <div id="cheat-list"></div>
      <p class="hint">Codes also work typed straight into the game. Toggles stay on until you turn them off.</p>
      <button id="cheat-close">CLOSE</button></div>`;
    document.body.appendChild(root);
    const input = root.querySelector('#cheat-input');
    const submit = () => { const v = input.value.trim().toUpperCase().replace(/[^A-Z]/g, ''); input.value = ''; const c = CHEAT_BY_CODE[v]; if (c) { this.activate(c); this.msg(`${c.name.toUpperCase()} ✓`); } else this.msg('UNKNOWN CODE'); };
    root.querySelector('#cheat-go').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); if (e.key === 'Escape') this.show(false); });
    root.querySelector('#cheat-close').addEventListener('click', () => this.show(false));
    root.addEventListener('click', (e) => { if (e.target === root) this.show(false); });
    const btn = document.getElementById('btn-cheats');
    if (btn) btn.addEventListener('click', () => { this.game.resume(); this.show(true); });
    this.root = root; this.input = input;
  }
  msg(t) { const m = document.getElementById('cheat-msg'); if (m) m.textContent = t; }
  renderList() {
    const list = document.getElementById('cheat-list');
    if (!list) return;
    list.innerHTML = '';
    for (const c of CHEATS) {
      const row = document.createElement('button');
      row.className = 'cheat-row' + (c.kind === 'toggle' && this.on[c.key] ? ' on' : '');
      row.innerHTML = `<span class="ccode">${c.code}</span><span class="cdesc">${c.desc}</span><span class="cstate">${c.kind === 'toggle' ? (this.on[c.key] ? 'ON' : 'OFF') : 'RUN'}</span>`;
      row.addEventListener('click', () => { this.activate(c); this.msg(`${c.name.toUpperCase()} ✓`); });
      list.appendChild(row);
    }
  }
  show(on) {
    const g = this.game;
    if (on) {
      if (g.state !== 'playing' || g.paused) return;
      this.open = true;
      g.state = 'cheats';
      g.input.exitLock();
      const t = document.getElementById('touch'); if (t) t.style.display = 'none';
      this.renderList(); this.msg('');
      this.root.style.display = 'flex';
      if (!g.touch) setTimeout(() => this.input.focus(), 50);
    } else {
      if (!this.open) return;
      this.open = false;
      this.root.style.display = 'none';
      g.state = 'playing';
      g.last = performance.now();
      if (g.touch) { const t = document.getElementById('touch'); if (t) t.style.display = 'block'; }
      else if (g.mode === 'foot') g.input.requestLock();
    }
  }

  // ---- per-frame enforcement ----------------------------------------------------
  update(raw) {
    const g = this.game, p = g.player;
    if (!p) return;
    if (this.on.god) { p.hp = 100; if (p.armor <= 0 && p.armorTier) p.armor = p.armorMax; }
    if (this.on.matrix) p.bt = 1;
    if (this.on.neverwanted && (g.wanted.level > 0 || g.wanted.heat > 0)) { g.wanted.forced = 0; g.wanted.clear(); }
  }
  applyToggle(key, on) {
    const g = this.game;
    if (key === 'bighead') for (const pd of [g.player.ped, ...g.peds]) this.bigHead(pd, on);
    if (key === 'katana' && on) for (const pd of g.peds) if (pd.kind !== 'civ' && !pd.dead && pd.weapon !== 'sword') { pd.weapon = 'sword'; if (pd.model && pd.model.setWeapon) pd.model.setWeapon('sword'); }
  }
  /** Scale any node called head (box model) or a head bone (rigged model). */
  bigHead(pd, on) {
    const s = on ? 2.2 : 1;
    pd.mesh.traverse((o) => { if (/^head$/i.test(o.name || '') || /(^|[_:-])head$/i.test(o.name || '')) o.scale.setScalar(s); });
    pd.bigHead = on;
  }
  /** Called by game.spawnPed so new peds honour the toggles. */
  onSpawnPed(pd) {
    if (this.on.bighead) this.bigHead(pd, true);
    if (this.on.katana && pd.kind !== 'civ' && pd.weapon && pd.weapon !== 'sword') { pd.weapon = 'sword'; if (pd.model && pd.model.setWeapon) pd.model.setWeapon('sword'); }
  }

  // ---- one-shot helpers -----------------------------------------------------------------
  giveAllWeapons() {
    const p = this.game.player;
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      if (!w) continue;
      if (id === 'dual') { p.weapons.dual = true; continue; }
      if (w.melee) { p.weapons[id] = Infinity; continue; }
      p.weapons[id] = w.maxAmmo || 999;
    }
    p.painkillers = Math.max(p.painkillers, 5);
    p.selectWeapon('dual');
  }
  spawnCar(type) {
    const g = this.game, p = g.player.worldPos();
    const t = VEHICLE_TYPES[type];
    if (!t) return 'NO SUCH CAR';
    const yaw = g.player.vehicle ? g.player.vehicle.yaw : g.player.yaw;
    const f = { x: Math.sin(yaw), z: Math.cos(yaw) }, r = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    const tries = [[6, 0], [8, 0], [0, 5], [0, -5], [10, 3], [10, -3], [-8, 0], [12, 0]];
    for (const [a, b] of tries) {
      const x = p.x + f.x * a + r.x * b, z = p.z + f.z * a + r.z * b;
      let ok = true;
      for (const v of g.vehicles) if (Math.hypot(v.pos.x - x, v.pos.z - z) < (v.type.len + t.len) / 2 + 1) { ok = false; break; }
      if (!ok) continue;
      const n = Math.max(2, Math.ceil(t.len / t.wid));
      let free = true;
      for (let i = 0; i < n; i++) { const d = -t.len / 2 + (t.len * i) / (n - 1); if (!g.city.pointFree(x + f.x * d, z + f.z * d, t.wid / 2 + 0.3)) { free = false; break; } }
      if (!free) continue;
      const v = g.spawnVehicle(type, x, z, yaw, { owned: true });
      v.owned = true;
      g.effects.burst(x, 1, z, 30, 6, '#ffe066', 0.8, 0.3);
      return `CHEAT: ${t.name} DELIVERED`;
    }
    return 'NO ROOM FOR A CAR HERE';
  }
  boom() {
    const g = this.game, p = g.player.worldPos();
    let n = 0;
    for (const v of [...g.vehicles]) {
      if (v.wrecked || v === g.player.vehicle) continue;
      if (Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < 40) { v.explode(g.player.ped); n++; }
    }
    return n ? `CHEAT: ${n} CARS GONE` : 'NO CARS NEARBY';
  }
  riot() {
    const g = this.game;
    let n = 0;
    for (const pd of g.peds) {
      if (pd.dead || pd.kind !== 'civ' || pd.mission || pd.isKeeper) continue;
      pd.kind = 'gang'; pd.gang = 'riot'; pd.alerted = true; pd.turf = false; pd.panic = 0;
      pd.weapon = ['pistol', 'uzi', 'shotgun', 'sword'][Math.floor(rand(0, 4))];
      pd.hp = Math.max(pd.hp, 60); pd.maxHp = pd.hp;
      if (pd.model && pd.model.setWeapon) pd.model.setWeapon(pd.weapon);
      n++;
    }
    g.wanted.set(2);
    return `CHEAT: RIOT! ${n} CITIZENS ARMED`;
  }
  allJobs() {
    const g = this.game;
    if (g.missions.current) g.missions.cleanup(true);
    g.save.done = MISSIONS.map((m) => m.id);
    g.saveGame();
    return 'CHEAT: ALL MISSIONS DONE';
  }
  spawnJulpie() {
    const g = this.game, p = g.player.worldPos();
    const yaw = g.player.yaw;
    const x = p.x + Math.sin(yaw) * 10, z = p.z + Math.cos(yaw) * 10;
    const spot = g.city.pointFree(x, z, 0.7) ? { x, z } : { x: p.x + 4, z: p.z + 4 };
    const b = g.spawnPed('gang', spot.x, spot.z, { gang: 'julpie', boss: true, name: 'Julpie', hp: 900, weapon: 'dual', alerted: true, mission: true, scale: 1.25, tint: '#ff9ad5' });
    b.bossName = 'Julpie'; b.boss = true;
    g.say('cheat.julpie', 'You RANG? Nobody rings Julpie. Julpie rings YOU.', 'Julpie');
    return 'CHEAT: JULPIE HAS ARRIVED';
  }
}
