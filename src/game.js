import * as THREE from 'three';
import { Input } from './input.js';
import { buildTextures } from './world/textures.js';
import { City } from './world/city.js';
import { Effects } from './systems/effects.js';
import { AudioSys } from './systems/audio.js';
import { loadAssets } from './world/assets.js';
import { Combat, WEAPONS } from './systems/combat.js';
import { HUD } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { Vehicle, collideVehicles, VEHICLE_TYPES, vehicleLabel } from './entities/vehicle.js';
import { Ped } from './entities/ped.js';
import { Player } from './entities/player.js';
import { Wanted } from './systems/wanted.js';
import { Population } from './systems/population.js';
import { Missions } from './systems/missions.js';
import { Jobs, jobSaveFields, applyJobSave } from './systems/jobs.js';
import { Activities } from './systems/activities.js';
import { DriveMode } from './modes/driveMode.js';
import { FootMode } from './modes/footMode.js';
import { clamp, dist, rand, fmtMoney } from './util.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import { getDifficulty } from './data/difficulty.js';
import { getCharacter } from './data/characters.js';
import { getCameraPreset, CAMERA_ORDER } from './data/camera.js';
import { Cheats } from './systems/cheats.js';
import { GamepadInput } from './gamepad.js';
import { VOICE_LINES } from './data/voiceLines.js';
import { Shop } from './ui/shop.js';
import { Dealer } from './ui/dealer.js';
import { Interiors } from './systems/interiors.js';
import { KillCam, KC_SCALE } from './systems/killcam.js';
import { Shouts } from './systems/shouts.js';
import { MapOverlay } from './ui/map.js';
import { GANGS, GANG_IDS, gangAtXZ } from './data/gangs.js';

const SAVE_KEY = 'port-harlow-save';
export const TARGET_SCORE = 1000000;

// Time and camera tuning (T12)
export const BT_WORLD = 0.2;          // world time scale in bullet time
export const BT_PLAYER = 0.5;         // player movement / fire-rate scale in bullet time (aim stays real-time)
const FOV_BASE = 55, FOV_BT = 47, FOV_KILLCAM = 52;
/** Ease a time scale toward its target (~60 ms time constant); snaps when close. */
function easeScale(cur, target, raw) {
  if (Math.abs(cur - target) < 0.004) return target;
  return cur + (target - cur) * (1 - Math.exp(-raw * 16));
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(0.6);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#86a7c2');
    this.scene.fog = new THREE.Fog('#86a7c2', 150, 480);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 900);
    this.scene.add(new THREE.HemisphereLight('#dfefff', '#4a4a40', 0.95));
    const sun = new THREE.DirectionalLight('#fff4de', 1.3);
    sun.position.set(80, 140, 60);
    this.scene.add(sun);

    this.input = new Input(canvas);
    this.hud = new HUD();
    this.touch = isTouchDevice() ? new TouchControls(this) : null;
    this.cheats = new Cheats(this);
    this.gamepad = new GamepadInput(this);
    this.audio = new AudioSys();
    this.assetsReady = false;
    this.assetsPromise = this.preloadAssets();
    buildTextures();
    this.city = new City();
    this.city.build(this.scene);
    this.effects = new Effects(this.scene);
    this.combat = new Combat(this);
    this.vehicles = [];
    this.peds = [];
    this.pickups = [];
    this.phones = [];
    this.wanted = new Wanted(this);
    this.population = new Population(this);
    this.missions = new Missions(this);
    this.jobs = new Jobs(this);             // street contacts, vehicle jobs, random events (systems/jobs.js)
    this.activities = new Activities(this); // kill frenzies and time-trial races (systems/activities.js)
    this.driveMode = new DriveMode(this);
    this.footMode = new FootMode(this);
    this.kc = new KillCam(this);            // Max Payne kill-cam logic (systems/killcam.js); `killCam` below is the active state
    this.shouts = new Shouts(this);         // floating enemy shouts (systems/shouts.js)
    this.killCam = null;                    // {bullet, t, phase, ...} while the kill-cam owns the camera
    this.timeScale = 1;                     // world time scale (1; 0.2 in bullet time; 0.12 in the kill-cam), read by other systems
    this.playerScale = 1;                   // player time scale (1; 0.5 in bullet time; 0.12 in the kill-cam)
    this.fov = 55;
    this.shop = new Shop(this);
    this.dealer = new Dealer(this);
    this.interiors = new Interiors(this);   // walk-in gun shops / showrooms (systems/interiors.js)

    this.state = 'title';
    this.difficultyId = 'normal';
    this.characterId = 'mike';
    this.cameraId = 'medium';
    try { this.cameraId = getCameraPreset(localStorage.getItem('port-harlow-camera')).id; } catch (e) { /* ignore */ }
    this.mode = 'foot';
    this.paused = false;
    this.score = 0;
    this.mult = 1;
    this.respect = { cinelli: 0, crows: 0, mal: 0 }; // -100..100 per gang
    this.turfGang = null; this.turfToastT = 0;
    this.save = { done: [] };
    this.levelDone = false;
    this.camTransition = null;
    this.shake = 0;
    this.resprayT = 0;
    this.deadT = 0;
    this.respawnAt = 'hospital';
    this.shotHeatT = 0;
    this.ringT = 0;
    this._cp = new THREE.Vector3();
    this._cq = new THREE.Quaternion();
    this.last = performance.now();

    this.buildPhones();
    this.buildPickups();
    this.buildMarkers();
    this.minimap = new Minimap(this); // static city layer is rendered once here
    this.map = new MapOverlay(this);  // full-screen map (M / minimap click / touch MAP); needs the minimap's static layer
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.input.onKey((code) => this.onKey(code));
    this.input.onClick((button) => {
      if (this.state === 'playing' && !this.paused && this.mode === 'foot' && !this.input.aiming && button === 0) {
        this.audio.resume();
        this.input.requestLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.state === 'playing' && this.mode === 'foot' && !this.input.aiming && !this.paused && !this.player.dead) this.pause();
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.minimap) this.minimap.resize();
  }

  // ---- world objects ------------------------------------------------------
  buildPhones() {
    for (const ph of this.city.phoneSpots) {
      const g = new THREE.Group();
      const booth = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.5, 1.2), new THREE.MeshLambertMaterial({ color: '#2f6fd6' }));
      booth.position.y = 1.25; g.add(booth);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), new THREE.MeshLambertMaterial({ color: '#ffe066' }));
      top.position.y = 2.65; g.add(top);
      const ind = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: '#ffe066' }));
      ind.position.y = 3.8; ind.visible = false; g.add(ind);
      g.position.set(ph.x, 0, ph.z);
      this.scene.add(g);
      this.city.addBox({ x0: ph.x - 0.6, z0: ph.z - 0.6, x1: ph.x + 0.6, z1: ph.z + 0.6, h: 2.5 });
      this.phones.push({ ...ph, mesh: g, ind, ringing: false });
    }
  }
  makePickupMesh(type) {
      const M = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c }));
      const g = new THREE.Group();
      switch (type) {
        case 'cash': g.add(M(0.6, 0.3, 0.12, '#2e8b57')); { const s = M(0.2, 0.2, 0.14, '#ffe066'); g.add(s); } break;
        case 'dual': { const a = M(0.5, 0.35, 0.15, '#444'); a.position.x = -0.3; g.add(a); const b = M(0.5, 0.35, 0.15, '#444'); b.position.x = 0.3; g.add(b); break; }
        case 'flame': { const t = M(0.5, 0.6, 0.3, '#8b1a1a'); g.add(t); const n = M(0.6, 0.12, 0.12, '#333'); n.position.set(0.5, -0.1, 0); g.add(n); break; }
        case 'pistol': g.add(M(0.5, 0.35, 0.15, '#444')); { const b = M(0.3, 0.15, 0.15, '#444'); b.position.set(0.1, -0.2, 0); g.add(b); } break;
        case 'uzi': g.add(M(0.7, 0.3, 0.18, '#222')); { const m = M(0.12, 0.35, 0.12, '#222'); m.position.set(0.05, -0.3, 0); g.add(m); } break;
        case 'shotgun': g.add(M(1.1, 0.16, 0.16, '#5d3a1a')); { const b = M(0.6, 0.12, 0.12, '#333'); b.position.set(0.3, 0.12, 0); g.add(b); } break;
        case 'rocket': { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 8), new THREE.MeshLambertMaterial({ color: '#2f5f2f' })); r.rotation.z = Math.PI / 2; g.add(r); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 8), new THREE.MeshLambertMaterial({ color: '#c0392b' })); tip.rotation.z = -Math.PI / 2; tip.position.x = 0.75; g.add(tip); break; }
        case 'sword': { const bl = M(1.3, 0.07, 0.04, '#dfe7ee'); bl.position.x = 0.15; g.add(bl); const gd = M(0.05, 0.22, 0.12, '#c9a227'); gd.position.x = -0.5; g.add(gd); const hd = M(0.4, 0.08, 0.08, '#1c1c24'); hd.position.x = -0.72; g.add(hd); g.rotation.z = 0.5; break; }
        case 'grenade': { const hn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), new THREE.MeshLambertMaterial({ color: '#8a5a2b' })); hn.rotation.z = Math.PI / 2; g.add(hn); const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 8), new THREE.MeshLambertMaterial({ color: '#4d5a4a' })); cn.rotation.z = Math.PI / 2; cn.position.x = 0.38; g.add(cn); break; }
        case 'health': g.add(M(0.7, 0.7, 0.2, '#ffffff')); { const a = M(0.5, 0.14, 0.22, '#e5322d'); g.add(a); const b = M(0.14, 0.5, 0.22, '#e5322d'); g.add(b); } break;
        case 'armor': g.add(M(0.7, 0.8, 0.25, '#2f6fd6')); { const s = M(0.5, 0.5, 0.27, '#9fc5ff'); g.add(s); } break;
        default: g.add(M(0.5, 0.35, 0.15, '#666'));
      }
      return g;
  }
  /** Temporary loot dropped by the dead: weapon (with some ammo) or cash; vanishes after `life` seconds. */
  spawnLoot(type, x, z, opts = {}) {
    const temps = this.pickups.filter((k) => k.temp);
    if (temps.length >= 14) this.removePickup(temps[0]);
    const mesh = this.makePickupMesh(type);
    mesh.position.set(x, 1, z);
    this.scene.add(mesh);
    const pk = { type, x, z, mesh, t: 0, temp: opts.life || 30, ammo: opts.ammo, cash: opts.cash };
    this.pickups.push(pk);
    return pk;
  }
  removePickup(pk) {
    this.scene.remove(pk.mesh);
    const i = this.pickups.indexOf(pk);
    if (i >= 0) this.pickups.splice(i, 1);
  }
  /** Loot rules: armed enemies drop their gun (30% of a pack) 70% of the time; civilians drop a little cash 25% of the time. */
  dropLoot(ped) {
    if (ped.noLoot || (this.interiors && this.interiors.active)) return;
    const x = ped.pos.x + rand(-0.6, 0.6), z = ped.pos.z + rand(-0.6, 0.6);
    const lw = ped.lootWeapon || ped.weapon, w = lw && WEAPONS[lw];
    if (w && (!w.melee || w.sword) && ped.kind !== 'civ') {
      if (ped.lootAlways || Math.random() < 0.7) this.spawnLoot(lw, x, z, { ammo: Math.max(1, Math.round((w.ammo || 20) * 0.3)) });
    } else if (ped.kind === 'civ' && Math.random() < 0.25) {
      this.spawnLoot('cash', x, z, { cash: Math.round(rand(20, 150) / 10) * 10 });
    }
    if (ped.kind !== 'civ' && !ped.isPlayer && Math.random() < 0.10) this.spawnLoot('grenade', x + 0.7, z + 0.4, { ammo: 2 });   // 10%: a pair of sticky grenades
  }
  buildPickups() {
    for (const p of this.city.locations.pickups) {
      const mesh = this.makePickupMesh(p.type);
      mesh.position.set(p.x, 1, p.z);
      this.scene.add(mesh);
      this.pickups.push({ type: p.type, x: p.x, z: p.z, mesh, t: 0 });
    }
  }
  buildMarkers() {
    this.marker = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.4, 18, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    this.marker.visible = false;
    this.scene.add(this.marker);
    const cone = new THREE.ConeGeometry(0.55, 1.5, 4);
    cone.rotateX(Math.PI / 2);
    this.arrow = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: '#ffe066' }));
    this.arrow.visible = false;
    this.scene.add(this.arrow);
  }

  spawnVehicle(type, x, z, yaw, opts = {}) {
    const v = new Vehicle(this, type, x, z, yaw, opts);
    this.scene.add(v.mesh);
    this.vehicles.push(v);
    return v;
  }
  removeVehicle(v) {
    if (v.removed) return;
    v.removed = true;
    this.scene.remove(v.mesh);
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (this.player.vehicle === v) { this.player.vehicle = null; this.player.ped.mesh.visible = true; }
  }
  spawnPed(kind, x, z, opts = {}) {
    const p = new Ped(this, kind, x, z, opts);
    this.scene.add(p.mesh);
    this.peds.push(p);
    if (this.cheats) this.cheats.onSpawnPed(p);
    return p;
  }
  removePed(p) {
    this.scene.remove(p.mesh);
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
  }

  // ---- lifecycle ----------------------------------------------------------
  /** True while any objective owner (campaign mission, job, activity) is running. */
  isBusy() {
    return !!((this.missions && this.missions.current) || (this.jobs && this.jobs.current) || (this.activities && this.activities.current));
  }
  /** Third-person camera preset (see src/data/camera.js). */
  get cam() { return getCameraPreset(this.cameraId); }
  cycleCamera() {
    const i = CAMERA_ORDER.indexOf(this.cameraId);
    this.cameraId = CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length];
    try { localStorage.setItem('port-harlow-camera', this.cameraId); } catch (e) { /* ignore */ }
    this.hud.toast('CAMERA: ' + this.cam.label, 2);
  }
  /** The playable character (see src/data/characters.js). */
  get hero() { return getCharacter(this.characterId); }
  /** Shop / dealer price multiplier: difficulty × character perk. */
  get priceMult() { return this.diff.prices * this.hero.priceMult; }
  setCharacter(id) {
    const next = getCharacter(id).id;
    const changed = next !== this.characterId;
    this.characterId = next;
    if (changed && this.player) this.player.ped.rebuildModel();
    const el = document.getElementById('pause-hero');
    if (el) el.textContent = 'PLAYING AS ' + this.hero.name;
  }
  /** Current difficulty tuning table (see src/data/difficulty.js). */
  get diff() { return getDifficulty(this.difficultyId); }
  /** Current collision provider: the room while inside a shop / showroom, else the city (same method names). */
  get world() { return this.interiors && this.interiors.active ? this.interiors.active.collision : this.city; }
  setDifficulty(id) { this.difficultyId = getDifficulty(id).id; this.hud.setTarget(TARGET_SCORE, this.diff.label); }
  /** Show a pager line and play its voice file if one exists (see VOICES.md). */
  say(id, text, who) { this.hud.pager(text, who); if (this.audio.voice) this.audio.voice(id); }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && Array.isArray(s.done)) { this.save = { done: s.done }; applyJobSave(this.save, s); this.score = s.score || 0; this.mult = s.mult || 1; this.setRespect(s.respect); this.setDifficulty(s.difficulty); this.setCharacter(s.character); this._pendingOwned = s.owned; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }
  saveGame() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ score: this.score, mult: this.mult, done: this.save.done, ...jobSaveFields(this.save), respect: this.respect, difficulty: this.difficultyId, character: this.characterId, owned: this.player ? this.ownedCarsState() : undefined })); } catch (e) { /* ignore */ }
  }
  /** Dealer-bought cars that are still alive, as plain save data [{type, color, x, z, yaw, hp}]. */
  ownedCarsState() {
    const out = [];
    for (const v of this.vehicles) {
      if (!v.owned || v.wrecked || v.removed) continue;
      out.push({ type: v.typeKey, color: '#' + v.bodyBase.getHexString(), x: +v.pos.x.toFixed(2), z: +v.pos.z.toFixed(2), yaw: +v.yaw.toFixed(3), hp: Math.round(v.hp) });
    }
    return out;
  }
  /** Remove every owned car, then respawn the saved ones (bad entries are skipped; blocked spots are nudged). Returns how many came back. */
  restoreOwnedCars(list) {
    for (const v of [...this.vehicles]) if (v.owned) this.removeVehicle(v);
    if (!Array.isArray(list)) return 0;
    const fin = (n) => typeof n === 'number' && isFinite(n);
    let count = 0;
    for (const o of list.slice(0, 60)) {
      const t = o && typeof o === 'object' ? VEHICLE_TYPES[o.type] : null;
      if (!t || !fin(o.x) || !fin(o.z)) continue;
      let x = o.x, z = o.z, ok = false;
      search: for (const r of [0, 3, 6, 10, 15, 22]) {
        for (let i = 0; i < (r ? 8 : 1); i++) {
          const a = (i / 8) * Math.PI * 2, px = o.x + Math.cos(a) * r, pz = o.z + Math.sin(a) * r;
          if (this.city.pointFree(px, pz, t.wid / 2 + 0.3)) { x = px; z = pz; ok = true; break search; }
        }
      }
      if (!ok) { const d = this.city.locations.dealers && this.city.locations.dealers[0]; if (!d) continue; x = d.bays[0].x; z = d.bays[0].z; }
      for (const v of [...this.vehicles]) { // a parked or traffic car already there makes way
        if (!v.owned && !v.mission && v !== this.player.vehicle && (v.controller === 'none' || v.controller === 'npc') && dist(v.pos.x, v.pos.z, x, z) < (v.type.len + t.len) / 2 + 0.3) this.removeVehicle(v);
      }
      const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : undefined;
      const v = this.spawnVehicle(o.type, x, z, fin(o.yaw) ? o.yaw : 0, { owned: true, color });
      v.hp = clamp(fin(o.hp) ? o.hp : t.hp, 1, t.hp);
      v.updateMesh();
      count++;
    }
    return count;
  }
  /** Fetch optional Kenney models / sound files (all fall back to procedural); the title shows LOADING meanwhile. */
  preloadAssets() {
    const panel = document.querySelector('#title .panel');
    let tag = null;
    if (panel) {
      panel.style.pointerEvents = 'none';
      tag = document.createElement('p');
      tag.className = 'hint';
      tag.textContent = 'LOADING...';
      panel.appendChild(tag);
    }
    return loadAssets().catch((e) => console.warn('assets: preload failed', e)).then(() => {
      this.assetsReady = true;
      if (panel) panel.style.pointerEvents = '';
      if (tag) tag.remove();
    });
  }
  start(newGame, difficultyId, characterId) {
    if (!this.assetsReady) return this.assetsPromise.then(() => this.start(newGame));
    this.audio.init();
    this.audio.resume();
    if (this.touch && document.documentElement.requestFullscreen) {
      try { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not available on this device */ }
    }
    this._pendingOwned = null;
    if (newGame || !this.loadSave()) { this.save = { done: [] }; this.score = 0; this.mult = 1; this.setRespect(null); this.setDifficulty(difficultyId || this.difficultyId); this.setCharacter(characterId || this.characterId); try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
    this.levelDone = this.score >= TARGET_SCORE;
    const L = this.city.locations.start;
    this.player = new Player(this, L.x, L.z);
    this.player.weapons.pistol = this.diff.startAmmo;
    if (newGame) { const h = this.hero; this.player.painkillers = Math.max(this.player.painkillers || 0, h.startPainkillers); this.player.armor = h.startArmor; this.player.armorTier = h.startArmor > 0 ? 1 : 0; this.score += h.startCash; }
    this.setCharacter(this.characterId);
    this.scene.add(this.player.ped.mesh);
    this.population.init();
    this.restoreOwnedCars(this._pendingOwned);   // CONTINUE: cars bought at the dealers
    this._pendingOwned = null;
    this.state = 'playing';
    this.paused = false;
    this.mode = 'foot';
    this.hud.setMode('foot');
    this.hud.setTarget(TARGET_SCORE, this.diff.label);
    this.footMode.enter();
    this.hud.toast(this.touch ? 'II PAUSE & SAVE  ·  MAP BUTTON' : 'ESC PAUSE & SAVE  ·  M MAP  ·  F5 QUICK SAVE', 7);
    const hello = this.save.done.length ? 'pager.welcome_back' : 'pager.welcome';
    this.say(hello, VOICE_LINES[hello].text, VOICE_LINES[hello].who);
    this.last = performance.now();
  }
  /** F5: autosave locally and write a "Quicksave" slot on the LAN save server when it is reachable. */
  async quickSave() {
    if (this.state !== 'playing' || this.paused || !this.player || this.player.dead) return;
    this.saveGame();
    try {
      const r = await fetch('/api/saves/Quicksave', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.getSaveState('Quicksave')) });
      if (!r.ok) throw new Error('bad status');
      this.hud.toast('SAVED: QUICKSAVE');
    } catch (e) { this.hud.toast('SAVED LOCALLY (NO SAVE SERVER)'); }
    this.audio.cash();
  }
  /** SAVE GAME from the map or HUD: pause and open the save dialog. */
  openSaveDialog() {
    if (this.state === 'map' && this.map) this.map.close();
    if (this.state !== 'playing' || !this.savesUI) return;
    this.pause();
    this.savesUI.open('save');
  }
  pause() {
    if (this.state !== 'playing' || this.paused) return;
    this.paused = true;
    this.input.exitLock();
    document.getElementById('pause').style.display = 'flex';
    this.audio.setEngine(false, 0);
    this.audio.setSiren(0);
    this.audio.heartbeat(false);
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    document.getElementById('pause').style.display = 'none';
    this.audio.resume();
    if (this.player && this.player.btActive) this.audio.heartbeat(true);
    if (this.mode === 'foot') this.input.requestLock();
    this.last = performance.now();
  }
  // ---- named saves (stored by server.js, shared on the LAN) ---------------------
  /** Plain JSON snapshot of the run. Infinity (fists) is stored as the string "inf". */
  getSaveState(name = '') {
    const p = this.player, room = this.interiors && this.interiors.active;
    const wp = room ? room.exitPoint : p.worldPos();   // inside a shop the save puts you back at its street door
    const weapons = {};
    for (const [id, n] of Object.entries(p.weapons)) weapons[id] = n === Infinity ? 'inf' : n;
    const s = {
      version: 1, name, time: Date.now(), score: this.score, mult: this.mult, done: [...this.save.done],
      weapons, weaponId: p.weaponId, hp: p.hp, armor: p.armor, armorTier: p.armorTier, pos: { x: wp.x, z: wp.z }, yaw: room ? room.exitYaw : p.yaw,
      stolenTypes: [...p.stolenTypes], difficulty: this.difficultyId, character: this.characterId, painkillers: p.painkillers,
      ...jobSaveFields(this.save), // jobsDone, frenzies, raceBest (systems/jobs.js)
      owned: this.ownedCarsState(),
    };
    if (this.respect) s.respect = { ...this.respect };
    return s;
  }
  /** Restore a snapshot onto the running game: on foot at the saved position, heat and mission reset. */
  applySaveState(s) {
    if (!s || typeof s !== 'object' || this.state !== 'playing') return false;
    if (this.interiors && this.interiors.active) this.interiors.exit(true); // back to the street before anything else is restored
    const p = this.player, ped = p.ped, num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    // leave the car / drive mode, drop the heat and any running mission
    if (p.vehicle) this.exitVehicle(true);
    else if (this.mode !== 'foot') this.switchMode('foot');
    this.missions.cleanup(true);
    this.missions.cooldown = 0;
    if (this.jobs) this.jobs.reset();
    if (this.activities) this.activities.cancel();
    this.wanted.clear();
    // revive if the pause happened on the WASTED / BUSTED screen
    p.dead = false; this.deadT = 0;
    ped.dead = false; ped.deadTime = 0; ped.mesh.rotation.x = 0; ped.mesh.position.y = 0; ped.mesh.visible = true;
    this.hud.el.big.className = ''; this.hud.bigT = 0;
    p.setBulletTime(false);
    p.dodge = null; ped.yOffset = 0; ped.tilt = 0; ped.aim = false;
    if (typeof ped.y === 'number') ped.y = 0;
    if (typeof ped.vy === 'number') ped.vy = 0;
    if (this.killCam) this.kc.end();
    p.bustProgress = 0; p.hurtT = 0; p.fireTimer = 0; p.invuln = 2; p.bt = 1; p.healT = 0; p.dodgeBT = false;
    // progress
    this.score = Math.max(0, num(s.score, 0));
    this.mult = Math.max(1, Math.floor(num(s.mult, 1)));
    this.save = { done: Array.isArray(s.done) ? s.done.slice() : [] };
    applyJobSave(this.save, s);
    this.setDifficulty(s.difficulty);
    this.setCharacter(s.character);
    this.levelDone = this.score >= TARGET_SCORE;
    // loadout
    const weapons = { fist: Infinity };
    if (s.weapons && typeof s.weapons === 'object') {
      for (const [id, n] of Object.entries(s.weapons)) {
        if (!WEAPONS[id]) continue;
        if (WEAPONS[id].ammoFrom) { if (n) weapons[id] = true; continue; } // dual pistols: ownership flag
        weapons[id] = n === 'inf' || n === null || n === Infinity ? Infinity : Math.max(0, num(n, 0));
      }
    }
    if (Object.keys(weapons).length === 1) weapons.pistol = 30;
    p.weapons = weapons;
    p.selectWeapon(weapons[s.weaponId] !== undefined ? s.weaponId : weapons.pistol !== undefined ? 'pistol' : 'fist');
    p.hp = clamp(num(s.hp, 100), 1, 100);
    p.armorTier = clamp(Math.floor(num(s.armorTier, 0)), 0, 2);
    p.armor = clamp(num(s.armor, 0), 0, p.armorTier >= 2 ? 150 : 100);
    p.painkillers = clamp(Math.floor(num(s.painkillers, 0)), 0, 9);
    p.stolenTypes = new Set(Array.isArray(s.stolenTypes) ? s.stolenTypes : []);
    if (this.respect) {
      const r = s.respect && typeof s.respect === 'object' ? s.respect : {};
      for (const k of Object.keys(this.respect)) this.respect[k] = clamp(num(r[k], 0), -100, 100);
    }
    // position (fall back to the nearest free spot, then to the start)
    let x = num(s.pos && s.pos.x, NaN), z = num(s.pos && s.pos.z, NaN);
    if (isNaN(x) || isNaN(z)) { const L = this.city.locations.start; x = L.x; z = L.z; }
    search: for (const r of [0, 2, 4, 6, 9, 14]) {
      for (let i = 0; i < (r ? 8 : 1); i++) {
        const a = (i / 8) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this.city.pointFree(px, pz, 0.4)) { x = px; z = pz; break search; }
      }
    }
    ped.pos.set(x, 0, z);
    ped.resolve();
    this.restoreOwnedCars(s.owned);   // old saves have none: owned cars are cleared either way
    p.yaw = num(s.yaw, p.yaw); p.pitch = 0.12; ped.yaw = p.yaw;
    this.camTransition = null;
    this.footMode.first = true;
    this.saveGame(); // keep the CONTINUE autosave in step
    this.syncHud();
    return true;
  }
  /** Fetch a named save from the server and load it (from the title screen this also starts the game). */
  async loadFromServer(name) {
    if (this._loadingSave) throw new Error('Already loading.');
    this._loadingSave = true;
    try {
      let s;
      try {
        const r = await fetch('/api/saves/' + encodeURIComponent(name), { cache: 'no-store' });
        if (r.status === 404) throw new Error('That save no longer exists.');
        if (!r.ok) throw new Error('Save server error (' + r.status + ').');
        s = await r.json();
      } catch (e) {
        throw e instanceof SyntaxError || e instanceof TypeError ? new Error('Save server not reachable.') : e;
      }
      if (this.state === 'title') {
        const t = document.getElementById('title');
        if (t) t.style.display = 'none';
        await this.start(true);
      }
      if (!this.applySaveState(s)) throw new Error('That save could not be applied.');
      if (this.paused) this.resume();
      return s;
    } finally { this._loadingSave = false; }
  }
  quitToTitle() {
    this.saveGame();
    window.location.reload();
  }

  onKey(code) {
    if (this.state === 'cheats') { if (code === 'Escape' || code === 'Backquote') this.cheats.show(false); return; }
    if (this.state === 'shop') { if (code === 'Escape') this.shop.close(); return; }
    if (this.state === 'dealer') { if (code === 'Escape') this.dealer.close(); return; }
    if (this.state === 'map') { if (code === 'Escape' || code === 'KeyM') this.map.close(); return; }
    if (this.state !== 'playing') return;
    if (code === 'Escape') { if (this.paused) this.resume(); else this.pause(); return; }
    if (this.paused) return;
    if (this.killCam) return;   // no map / interaction while the kill-cam runs
    if (code === 'KeyM') { this.map.open(); return; }
    if (code === 'F5') { this.quickSave(); return; }
    if (code === 'KeyV') { this.cycleCamera(); return; }
    if (code === 'KeyE' || code === 'KeyF') this.interact();
  }

  // ---- interaction --------------------------------------------------------
  interact() {
    const p = this.player;
    if (p.dead) return;
    if (this.interiors && this.interiors.active) { this.interiors.interact(); return; } // counter / door of the room
    if (p.vehicle) { if (this.jobs && this.jobs.tryAccept()) return; this.exitVehicle(); return; } // E again accepts a vehicle-job offer
    const pp = p.ped.pos;
    for (const ph of this.phones) {
      if (ph.ringing && !this.isBusy() && dist(ph.x, ph.z, pp.x, pp.z) < 3.2) { this.missions.answer(ph); return; }
    }
    if (this.jobs && this.jobs.tryTalk(pp.x, pp.z)) return; // street contact within 2.5 m
    const gs = this.nearGunShop(pp.x, pp.z);
    if (gs) { this.interiors.enter('gun', gs); return; }
    const dl = this.nearDealer(pp.x, pp.z);
    if (dl) { this.interiors.enter('dealer', dl); return; }
    const v = this.nearestVehicle(pp.x, pp.z, 3.2);
    if (v) this.enterVehicle(v);
  }
  /** Gun shop whose door is within 2.5 m, or null. */
  nearGunShop(x, z) {
    for (const s of this.city.locations.gunShops || []) if (dist(s.x, s.z, x, z) < 2.5) return s;
    return null;
  }
  /** Car dealer whose door is within 2.5 m, or null. */
  nearDealer(x, z) {
    for (const d of this.city.locations.dealers || []) if (dist(d.x, d.z, x, z) < 2.5) return d;
    return null;
  }
  nearestVehicle(x, z, maxD) {
    let best = null, bd = maxD;
    for (const v of this.vehicles) {
      if (v.wrecked) continue;
      for (const c of v.circles()) {
        const d = dist(c.x, c.z, x, z) - c.r;
        if (d < bd) { bd = d; best = v; }
      }
    }
    return best;
  }
  enterVehicle(v) {
    const p = this.player;
    if (v.wrecked || p.vehicle) return;
    const copNear = this.wanted.copNear(v.pos.x, v.pos.z, 45);
    if (v.hasDriver) {
      const wasCop = v.driverKind === 'cop';
      v.abandon();
      this.wanted.addHeat(wasCop ? 1.2 : copNear ? 0.6 : 0.3);
    } else if (copNear) this.wanted.addHeat(0.3);
    const i = this.wanted.cars.indexOf(v);
    if (i >= 0) this.wanted.cars.splice(i, 1);
    v.controller = 'player';
    v.driver = p; v.hasDriver = true; v.driverKind = 'player'; v.sirenOn = false;
    v.route = [];
    p.vehicle = v;
    p.ped.mesh.visible = false;
    p.dodge = null; p.ped.yOffset = 0; p.ped.tilt = 0;
    p.setBulletTime(false);
    if (!p.stolenTypes.has(v.typeKey)) { p.stolenTypes.add(v.typeKey); if (!v.owned) this.addScore(500 * this.mult, 'STOLEN: ' + v.type.name); }
    if (v.type.healOnEnter && p.hp < 100) { p.hp = 100; this.hud.toast('PATCHED UP'); }   // ambulance
    this.switchMode('drive');
    if (this.jobs) this.jobs.onEnterVehicle(v); // taxi / police / ambulance: offers a vehicle job (E again within 5 s)
  }
  exitVehicle(silent = false) {
    const p = this.player, v = p.vehicle;
    if (!v) return;
    const r = v.right;
    const side = -(v.type.wid / 2 + 1.0);
    p.ped.pos.set(v.pos.x + r.x * side, 0, v.pos.z + r.z * side);
    if (!this.city.pointFree(p.ped.pos.x, p.ped.pos.z, 0.4)) p.ped.pos.set(v.pos.x - r.x * side, 0, v.pos.z - r.z * side);
    p.ped.resolve();
    p.ped.mesh.visible = true;
    v.controller = 'none'; v.driver = null; v.hasDriver = false; v.driverKind = 'civ';
    p.vehicle = null;
    p.yaw = v.yaw; p.pitch = 0.12;
    p.ped.yaw = v.yaw;
    this.audio.setEngine(false, 0);
    if (!silent && v.speedAbs > 9) p.damage(v.speedAbs * 1.2, null);
    this.switchMode('foot');
  }
  switchMode(mode) {
    if (this.mode === mode) return;
    this.camTransition = { t: 0, dur: 0.75, fromPos: this.camera.position.clone(), fromQuat: this.camera.quaternion.clone() };
    (this.mode === 'drive' ? this.driveMode : this.footMode).exit();
    this.mode = mode;
    (mode === 'drive' ? this.driveMode : this.footMode).enter();
    this.hud.setMode(mode);
    if (this.touch) this.touch.setMode(mode);
    this.renderer.setPixelRatio(mode === 'drive' ? 0.55 : 0.7);
    this.resize();
  }

  // ---- events -------------------------------------------------------------
  addScore(n, label) {
    if (n > 0) n = Math.round(n * this.hero.cashMult);
    this.score += n;
    if (label) this.hud.toast(`${label}  ${fmtMoney(n)}`);
    this.audio.cash();
    if (!this.levelDone && this.score >= TARGET_SCORE) this.levelComplete();
  }
  levelComplete() {
    this.levelDone = true;
    this.hud.big('LEVEL COMPLETE', 'Port Harlow is yours. Free roam unlocked.', 7, 'pass');
    this.audio.missionPass();
    this.saveGame();
  }
  allMissionsDone() {
    this.say('pager.all_done', VOICE_LINES['pager.all_done'].text, 'Pager');
  }
  onPedDeath(ped, src, cause) {
    const byPlayer = src && (src === this.player.ped || src === this.player);
    if (this.activities) this.activities.onKill(ped, byPlayer); // kill-frenzy counter
    if (!ped.isPlayer) this.dropLoot(ped);
    for (const c of this.peds) {
      if (c.kind === 'civ' && !c.dead && dist(c.pos.x, c.pos.z, ped.pos.x, ped.pos.z) < 22) { c.panic = Math.max(c.panic, 5); c.threat = { x: ped.pos.x, z: ped.pos.z }; }
    }
    if (!byPlayer) return;
    if (ped.kind === 'gang' && GANGS[ped.gang]) this.onGangKill(ped);
    const copNear = this.wanted.copNear(ped.pos.x, ped.pos.z, 45);
    let base = 100, heat = 0.35;
    if (ped.kind === 'cop') { base = 300; heat = 1.0; }
    else if (ped.kind === 'gang') { base = ped.boss ? 2000 : 200; heat = 0.15; }
    if (copNear) heat *= 2;
    this.wanted.addHeat(heat);
    this.addScore(base * this.mult, ped.boss ? ped.name + ' ELIMINATED' : null);
    if (ped.miniBoss || ped.boss) this.addScore(5000 * this.mult, (ped.name || 'BOSS') + ' DOWN'); // T16 bounty
    this.player.onKill(ped);   // +15% hourglass (+30% mid shoot-dodge), see Player.onKill
    const pl = this.player;    // T17: kill while airborne (jump / dive) pays a style bonus
    if (ped.kind !== 'civ' && !pl.vehicle && ((!pl.ped.grounded && pl.ped.y > 0.2) || (pl.dodge && pl.dodge.phase === 'fly'))) this.addScore(100, 'AIR KILL');
  }
  /** Replace the respect table (missing/partial input resets to zero) and clamp to -100..100. */
  setRespect(r) {
    for (const id of GANG_IDS) this.respect[id] = clamp(r && Number.isFinite(r[id]) ? r[id] : 0, -100, 100);
  }
  addRespect(id, n) {
    if (!(id in this.respect)) return;
    this.respect[id] = clamp(this.respect[id] + n, -100, 100);
  }
  /** Player killed a gang member: -8 with that gang, +3 with the others; witnesses of the same crew turn hostile. */
  onGangKill(ped) {
    for (const id of GANG_IDS) this.addRespect(id, id === ped.gang ? -8 : 3);
    const k = this.missions.killedGangs;
    if (k && this.missions.current) k.add(ped.gang);
    for (const c of this.peds) {
      if (c.turf && !c.dead && c.gang === ped.gang && dist(c.pos.x, c.pos.z, ped.pos.x, ped.pos.z) < 35) c.alerted = true;
    }
  }
  /** Toast when the player crosses into a gang's territory (debounced 8 s). */
  updateTurf(raw) {
    if (this.turfToastT > 0) this.turfToastT -= raw;
    const pp = this.player.worldPos();
    const id = gangAtXZ(pp.x, pp.z);
    if (id === this.turfGang) return;
    this.turfGang = id;
    if (id && this.turfToastT <= 0) {
      this.turfToastT = 8;
      this.hud.toast(`ENTERING ${GANGS[id].zone.toUpperCase()} — ${GANGS[id].name.toUpperCase()} TURF`);
    }
  }
  /** Head shot by the player: small cash bonus and a touch of bullet time. */
  onHeadshot(ped) {
    if (ped.kind === 'civ') return;
    this.hud.toast('HEADSHOT', 1.2);
    this.addScore(50 * this.mult, null);
    this.player.addBullet(0.05);
  }
  onVehicleDestroyed(v) {
    this.addScore(500 * this.mult, 'DESTROYED: ' + v.type.name);
    this.wanted.addHeat(v.typeKey === 'police' ? 1.0 : this.wanted.copNear(v.pos.x, v.pos.z, 45) ? 0.5 : 0.2);
  }
  onVehicleBump(a, b) {
    const p = this.player;
    const other = a.driver === p ? b : b.driver === p ? a : null;
    if (other && other.typeKey === 'police' && other.controller === 'police') this.wanted.addHeat(0.25);
  }
  noise(x, z, r, owner) {
    const isPlayer = owner && owner.isPlayer;
    for (const p of this.peds) {
      if (p.dead) continue;
      const d = dist(p.pos.x, p.pos.z, x, z);
      if (p.kind === 'civ' && d < r) { p.panic = Math.max(p.panic, 4 + rand(0, 2)); p.threat = { x, z }; }
      else if (p.kind === 'gang' && isPlayer) {
        if (p.turf) { // turf members: friends ignore gunfire, neutrals only react to close shots
          const rs = this.respect[p.gang] || 0;
          if (rs < 25 && d < r * (rs > -25 ? 0.4 : 0.8)) p.alerted = true;
        } else if (d < r * 0.8) p.alerted = true;
      }
    }
    if (isPlayer && this.shotHeatT <= 0 && this.wanted.copNear(x, z, 35)) { this.shotHeatT = 2; this.wanted.addHeat(0.3); }
  }
  explode(x, y, z, r, dmg, src, ignore) {
    const pl = this.player;
    const pp = pl.worldPos();
    this.effects.explosion(x, y, z, r);
    this.audio.explosion(dist(pp.x, pp.z, x, z));
    this.shake = Math.max(this.shake, clamp(1 - dist(pp.x, pp.z, x, z) / 60, 0, 1) * 0.8);
    for (const p of this.peds) {
      if (p.dead) continue;
      const d = dist(p.pos.x, p.pos.z, x, z);
      if (d < r) p.damage(dmg * (1 - d / r) * 1.3, src, { x: (p.pos.x - x) * 3, z: (p.pos.z - z) * 3 });
    }
    const dp = dist(pp.x, pp.z, x, z);
    if (dp < r + 1) {
      if (pl.vehicle) { if (pl.vehicle !== ignore) pl.vehicle.damage(dmg * (1 - dp / (r + 1)), src); }
      else pl.damage(dmg * (1 - dp / (r + 1)) * 1.1, src);
    }
    for (const v of this.vehicles) {
      if (v === ignore || v.wrecked) continue;
      const d = dist(v.pos.x, v.pos.z, x, z);
      if (d < r + 2) {
        const k = 1 - d / (r + 2);
        v.vx += (v.pos.x - x) * k * 3; v.vz += (v.pos.z - z) * k * 3;
        v.damage(dmg * 1.3 * k, src);
      }
    }
    this.noise(x, z, 60, src);
  }
  onBulletTime(on) {
    this.canvas.classList.toggle('bt', on);
    this.audio.setBulletTime(on);
    this.audio.heartbeat(on);
    if (on) this.audio.btIn(); else this.audio.btOut();
    if (!on && this.killCam) this.canvas.classList.add('bt');   // the kill-cam keeps its look
  }
  wasted(src) {
    const p = this.player;
    if (p.dead) return;
    p.dead = true; p.hp = 0;
    p.setBulletTime(false);
    p.dodge = null; p.ped.yOffset = 0; p.ped.tilt = 0;
    if (p.vehicle) {
      const v = p.vehicle;
      p.ped.pos.copy(v.pos); p.ped.mesh.visible = true;
      v.controller = 'none'; v.driver = null; v.hasDriver = false; p.vehicle = null;
    }
    p.ped.dead = true; p.ped.deadTime = 0;
    this.applyDeathCost();
    this.hud.big('WASTED', '', 4, 'wasted');
    this.audio.wasted();
    this.audio.setEngine(false, 0);
    this.missions.onPlayerLost('You got wasted.');
    if (this.jobs) this.jobs.onPlayerLost('You got wasted.');
    if (this.activities) this.activities.onPlayerLost();
    this.respawnAt = 'hospital';
    this.deadT = 4;
    this.input.exitLock();
  }
  busted() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    p.setBulletTime(false);
    p.dodge = null; p.ped.yOffset = 0; p.ped.tilt = 0;
    p.ped.aim = false;
    this.applyDeathCost();
    this.hud.big('BUSTED', '', 4, 'busted');
    this.audio.busted();
    this.missions.onPlayerLost('You got busted.');
    if (this.jobs) this.jobs.onPlayerLost('You got busted.');
    if (this.activities) this.activities.onPlayerLost();
    this.respawnAt = 'police';
    this.deadT = 3.5;
    this.input.exitLock();
  }
  /** Hard mode: dying costs a slice of your cash. */
  applyDeathCost() {
    const f = this.diff.deathCost;
    if (!f || this.score <= 0) return;
    const lost = Math.floor(this.score * f);
    this.score -= lost;
    if (lost > 0) this.hud.toast(`LOST ${fmtMoney(lost)}`, 4);
  }
  respawn() {
    const p = this.player;
    if (this.interiors && this.interiors.active) this.interiors.exit(true); // died inside a shop: the hospital is outside
    const L = this.city.locations[this.respawnAt];
    p.ped.revive();
    p.ped.pos.set(L.x, 0, L.z);
    p.ped.mesh.visible = true;
    p.hp = 100; p.armor = 0; p.armorTier = 0; p.dead = false; p.invuln = 3; p.bustProgress = 0; p.bt = 1; p.healT = 0;
    p.resetWeapons();
    p.weapons.pistol = Math.min(p.weapons.pistol, this.diff.startAmmo);
    p.yaw = 0; p.pitch = 0.12;
    this.wanted.clear();
    if (this.mode !== 'foot') this.switchMode('foot');
    this.footMode.first = true;
    this.input.requestLock();
    this.hud.setClickToAim(true);
  }

  // ---- frame ----------------------------------------------------------------
  frame(now) {
    this.gamepad.update(Math.min(0.05, (now - this.last) / 1000));
    const raw = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'playing' && !this.paused) this.update(raw);
    this.hud.update(raw);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  update(raw) {
    const p = this.player;
    // time scales: world 0.2 / player 0.5 in bullet time, both 0.12 in the kill-cam (eased, so entering and leaving are not abrupt)
    const bt = p.btActive && !p.dead, kc = !!this.killCam;
    this.timeScale = easeScale(this.timeScale, kc ? KC_SCALE : bt ? BT_WORLD : 1, raw);
    this.playerScale = easeScale(this.playerScale, kc ? KC_SCALE : bt ? BT_PLAYER : 1, raw);
    let dt = raw * this.timeScale;
    const pdt = raw * this.playerScale;
    p.updateMeters(raw);
    this.cheats.update(raw);
    if (this.shotHeatT > 0) this.shotHeatT -= raw;
    this.interiors.tick(raw); // fade + shop clock; may swap the world at the black point

    if (p.dead) {
      this.deadT -= raw;
      if (this.deadT <= 0) this.respawn();
    } else if (this.mode === 'drive') this.driveMode.update(dt);
    else this.footMode.update(raw, pdt);
    if (!kc && this.killCam) dt = raw * this.timeScale;   // a kill-cam started by this frame's shot: its bullet moves at 0.12 straight away

    // inside a shop / showroom the city is frozen: only player, keeper, combat, effects, camera, HUD, audio run
    if (this.interiors.active) { this.interiors.step(raw, dt, pdt); return; }

    // vehicles
    for (const v of this.vehicles) v.update(dt);
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) collideVehicles(vs[i], vs[j]);
    if (p.vehicle) p.ped.pos.copy(p.vehicle.pos);
    // peds
    for (const pd of this.peds) pd.update(dt);
    p.ped.update(pdt);
    for (let i = this.peds.length - 1; i >= 0; i--) if (this.peds[i].remove) this.removePed(this.peds[i]);

    this.combat.update(dt);
    this.effects.update(dt);
    this.shouts.update(raw);
    this.kc.update(raw);
    this.wanted.update(dt);
    this.population.update(dt);
    this.missions.update(dt);
    this.jobs.update(dt);
    this.activities.update(dt);
    this.updatePickups(dt);
    this.updatePhones(dt);
    this.updateMarkers(raw);
    this.updateTurf(raw);

    // respray
    if (this.resprayT > 0) this.resprayT -= raw;
    if (p.vehicle && !p.dead) {
      const r = this.city.respray;
      if (dist(p.vehicle.pos.x, p.vehicle.pos.z, r.x, r.z) < r.r && this.resprayT <= 0) {
        this.resprayT = 6;
        this.wanted.clear();
        p.vehicle.hp = p.vehicle.type.hp;
        p.vehicle.bodyMat.color.set(p.vehicle.type.colors[Math.floor(rand(0, p.vehicle.type.colors.length))]);
        this.hud.toast('RESPRAYED. THE HEAT IS OFF.');
        this.audio.pickup();
      }
    }
    // busted
    if (!p.vehicle && !p.dead) {
      if (p.bustProgress > 1.0) this.busted();
      p.bustProgress = Math.max(0, p.bustProgress - raw * 0.7);
    }
    // camera + hud + audio
    this.updateCamera(raw);
    this.syncHud();
    this.syncAudio(raw);
  }

  updatePickups(dt) {
    const p = this.player;
    for (const pk of this.pickups) {
      pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = 1 + Math.sin(performance.now() * 0.004 + pk.x) * 0.15;
      if (pk.temp) { pk.temp -= dt; if (pk.temp <= 0) { this.removePickup(pk); continue; } if (pk.temp < 5) pk.mesh.visible = Math.floor(performance.now() / 150) % 2 === 0; }
      if (pk.t > 0) { pk.t -= dt; if (pk.t <= 0) pk.mesh.visible = true; continue; }
      if (p.vehicle || p.dead) continue;
      if (pk.type === 'health' && p.painkillers >= 9) continue;   // bottle stays until there is room
      if (dist(pk.x, pk.z, p.ped.pos.x, p.ped.pos.z) < 1.4) {
        pk.mesh.visible = false; pk.t = 90;
        this.audio.pickup();
        if (pk.temp) this.removePickup(pk);
        if (pk.type === 'cash') { this.addScore(pk.cash || 50, 'CASH'); }
        else if (WEAPONS[pk.type] && WEAPONS[pk.type].melee) { p.giveWeapon(pk.type, 0); this.hud.toast(WEAPONS[pk.type].name); }
        else if (pk.ammo && WEAPONS[pk.type]) { p.giveWeapon(pk.type, pk.ammo); this.hud.toast(`${WEAPONS[pk.type].name} +${pk.ammo}`); }
        else if (pk.type === 'health') { p.painkillers = Math.min(9, p.painkillers + 1); this.hud.toast('PAINKILLERS'); }
        else if (pk.type === 'armor') { p.giveArmor(1); this.hud.toast('ARMOR VEST'); }
        else { p.giveWeapon(pk.type, WEAPONS[pk.type].ammo); this.hud.toast(WEAPONS[pk.type].name); }
      }
    }
  }
  updatePhones(dt) {
    this.ringT -= dt;
    let rang = false;
    const pp = this.player.worldPos();
    for (const ph of this.phones) {
      ph.ringing = this.missions.isRinging(ph) && !this.isBusy(); // no ringing while a job / activity runs
      ph.ind.visible = ph.ringing;
      if (ph.ringing) {
        ph.ind.position.y = 3.6 + Math.abs(Math.sin(performance.now() * 0.012)) * 0.6;
        if (!rang && this.ringT <= 0 && dist(ph.x, ph.z, pp.x, pp.z) < 45) { this.audio.ring(); rang = true; }
      }
    }
    if (rang) this.ringT = 1.4;
  }
  updateMarkers(raw) {
    const p = this.player;
    let target = this.missions.markerPos();
    let showMarker = !!target && !(this.missions.markerTarget && this.missions.markerTarget.pos && this.missions.markerTarget.kind); // not for peds
    if (!target) {
      let best = null, bd = Infinity;
      const pp = p.worldPos();
      for (const ph of this.phones) if (ph.ringing) { const d = dist(ph.x, ph.z, pp.x, pp.z); if (d < bd) { bd = d; best = ph; } }
      if (best) { target = best; showMarker = false; }
    }
    if (!target || p.dead) { this.marker.visible = false; this.arrow.visible = false; return; }
    const pp = p.worldPos();
    const d = dist(target.x, target.z, pp.x, pp.z);
    this.marker.visible = showMarker;
    if (showMarker) {
      this.marker.position.set(target.x, 1.2, target.z);
      const s = 1 + Math.sin(performance.now() * 0.005) * 0.08;
      this.marker.scale.set(s, 1, s);
    }
    this.arrow.visible = d > 5;
    this.arrow.position.set(pp.x, p.vehicle ? 3.6 : 2.7, pp.z);
    this.arrow.rotation.y = Math.atan2(target.x - pp.x, target.z - pp.z);
  }
  updateCamera(raw) {
    const pos = this._cp, q = this._cq;
    if (this.killCam) this.kc.apply(raw, pos, q);   // the kill-cam replaces the mode camera
    else (this.mode === 'drive' ? this.driveMode : this.footMode).cameraTarget(raw, pos, q);
    // field of view: 55, tweened to 47 over 0.25 s in bullet time (and back)
    const baseFov = this.cam.fov;
    let wantFov = this.killCam ? FOV_KILLCAM : this.mode === 'foot' && this.player.btActive ? baseFov - (FOV_BASE - FOV_BT) : baseFov;
    if (!this.killCam && this.mode === 'foot' && this.footMode.extraFov) wantFov += Math.round(this.footMode.extraFov * 10) / 10; // T17: +3 deg airborne in bullet time
    if (this.fov !== wantFov) {
      const step = ((FOV_BASE - FOV_BT) / 0.25) * raw;
      this.fov = Math.abs(wantFov - this.fov) <= step ? wantFov : this.fov + Math.sign(wantFov - this.fov) * step;
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    const t = this.killCam ? null : this.camTransition;
    if (t) {
      t.t += raw;
      const k = Math.min(1, t.t / t.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(t.fromPos, pos, e);
      this.camera.quaternion.slerpQuaternions(t.fromQuat, q, e);
      if (k >= 1) this.camTransition = null;
    } else {
      this.camera.position.copy(pos);
      this.camera.quaternion.copy(q);
    }
    if (this.shake > 0 && !this.killCam) {
      this.camera.position.x += rand(-1, 1) * this.shake * 0.6;
      this.camera.position.y += rand(-1, 1) * this.shake * 0.6;
      this.shake = Math.max(0, this.shake - raw * 1.8);
    }
    if (this.interiors && this.interiors.active) this.interiors.fixCamera(this.camera); // stay inside the room
  }
  /** Boss bar: the nearest living boss / mini-boss within 60 m (T16); hidden otherwise or while inside a shop. */
  syncBossBar() {
    const pp = this.player.worldPos(), inside = this.interiors && this.interiors.active;
    let best = null, bd = 60 * 60;
    if (!inside) for (const q of this.peds) {
      if (q.dead || q.remove || !(q.boss || q.miniBoss)) continue;
      const d = (q.pos.x - pp.x) ** 2 + (q.pos.z - pp.z) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
    if (best) this.hud.setBoss(best.name || 'BOSS', best.hp / best.maxHp, best.boss ? 'boss' : 'mini');
    else this.hud.setBoss(null);
  }
  syncHud() {
    const p = this.player, h = this.hud;
    this.syncBossBar();
    h.setScore(this.score);
    h.setMult(this.mult);
    h.setWanted(this.wanted.level);
    h.setRespect(this.respect);
    if (p.vehicle && p.vehicle.type.cannon && !p.dead) h.setWeapon(p.vehicle.cannonT > 0 ? 'CANNON  RELOADING' : 'CANNON  READY', Infinity);
    else if (p.weapon.grenade) h.setWeapon(`${p.weapon.name} x${Math.ceil(p.ammo)}`, Infinity);
    else h.setWeapon(p.weapon.unit ? p.weapon.name + ' ' + p.weapon.unit : p.weaponId === 'dual' ? p.weapon.name + ' 2x' : p.weapon.name, p.ammo === Infinity ? p.ammo : Math.ceil(p.ammo));
    h.setHealth(p.hp, p.armor, p.armorMax);
    p.ped.setArmorVisual(p.armor > 0 ? p.armorTier : 0);
    h.setBT(p.bt, p.btActive, this.mode === 'foot', p.btActive || !!this.killCam);
    h.setPills(p.painkillers, p.healT > 0);
    const veh = p.vehicle;
    if (veh && !p.dead) h.setVehicle(vehicleLabel(veh.type), veh.hp / veh.type.hp, veh.hp, veh.type.hp);
    else h.setVehicle(null);
    this.minimap && this.minimap.update();
    let prompt = '';
    if (!p.dead) {
      if (this.interiors && this.interiors.active) prompt = this.interiors.prompt(); // E — BROWSE / E — LEAVE / CLOSED
      else if (p.vehicle) {
        if (Math.abs(p.vehicle.speed) < 2) prompt = 'E — GET OUT';
      } else {
        const pp = p.ped.pos;
        const ph = this.phones.find((x) => x.ringing && dist(x.x, x.z, pp.x, pp.z) < 3.2);
        if (ph) prompt = 'E — ANSWER PHONE';
        else if (this.nearGunShop(pp.x, pp.z)) prompt = 'E — SHOP';
        else if (this.nearDealer(pp.x, pp.z)) prompt = 'E — DEALER';
        else { const v = this.nearestVehicle(pp.x, pp.z, 3.2); if (v) prompt = 'E — ' + (v.hasDriver ? 'JACK ' : 'ENTER ') + v.type.name; }
      }
    }
    if (!p.dead && this.jobs && !this.interiors.active) { const jp = this.jobs.prompt(); if (jp) prompt = jp; } // "E — TALK TO ..." / "E — START TAXI FARES"
    h.setPrompt(prompt);
    if (this.touch) this.touch.setPrompt(prompt);
  }
  syncAudio(raw) {
    const pp = this.player.worldPos();
    let sir = 0;
    for (const v of this.vehicles) if (v.sirenOn && !v.wrecked) sir = Math.max(sir, clamp(1 - dist(v.pos.x, v.pos.z, pp.x, pp.z) / 140, 0, 1));
    this.audio.setSiren(sir);
    if (!this.player.vehicle) this.audio.setEngine(false, 0);
    this.audio.update(raw);
  }
}
