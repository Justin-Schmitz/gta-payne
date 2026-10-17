import * as THREE from 'three';
import { dist, rand, fmtMoney } from '../util.js';
import { FRENZIES, RACES, JOB_LINES, CONTACT_REPEAT } from '../data/jobs.js';
import { Beacon } from './jobs.js';

const SKULL_R = 1.7;          // on-foot trigger radius of a skull pickup
const RACE_START_R = 9;       // a vehicle this close to a start line begins the race
const CHECKPOINT_R = 10;

/**
 * Optional activities: six Kill Frenzy skulls (walk onto one, get a weapon, N kills in T seconds, paid
 * once, remembered in game.save.frenzies) and three time-trial races (drive through the start line, hit
 * every checkpoint before the par time; best times in game.save.raceBest). While one runs
 * `activities.current` is set, which makes game.isBusy() true.
 */
export class Activities {
  constructor(game) {
    this.g = game;
    this.current = null;          // {type:'frenzy'|'race', ...}
    this.hintT = 0;
    this.disarm = null;
    this.beacon = new Beacon(game.scene, '#46e6ff');
    this.beacon2 = new Beacon(game.scene, '#9fe9ff');
    this.skulls = FRENZIES.map((def) => this.makeSkull(def));
    this.flags = RACES.map((def) => this.makeFlag(def));
  }

  // ---- world objects
  makeSkull(def) {
    const grp = new THREE.Group(), M = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); grp.add(m); return m; };
    M(0.8, 0.7, 0.7, '#f2efe4', 0, 0.2, 0);
    M(0.5, 0.25, 0.55, '#e4e0d2', 0, -0.3, 0.05);
    M(0.2, 0.2, 0.1, '#1a1a1a', -0.2, 0.25, 0.36);
    M(0.2, 0.2, 0.1, '#1a1a1a', 0.2, 0.25, 0.36);
    M(0.1, 0.12, 0.1, '#1a1a1a', 0, 0.0, 0.36);
    grp.position.set(def.at.x, 1.4, def.at.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.6, 20), new THREE.MeshBasicMaterial({ color: '#e5322d', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(def.at.x, 0.12, def.at.z);
    this.g.scene.add(grp); this.g.scene.add(ring);
    return { def, grp, ring };
  }
  makeFlag(def) {
    const s = def.pts[0], grp = new THREE.Group();
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 32;
    const c = cv.getContext('2d');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * 8, y * 8, 8, 8); }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 6), new THREE.MeshLambertMaterial({ color: '#cfcfcf' }));
    pole.position.set(0, 4.5, 0); grp.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 0.1), new THREE.MeshBasicMaterial({ map: tex }));
    flag.position.set(1.5, 8.1, 0); grp.add(flag);
    grp.position.set(s.x + 8.5, 0, s.z + 8.5);
    const ring = new THREE.Mesh(new THREE.RingGeometry(5, 7, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.1, s.z);
    this.g.scene.add(grp); this.g.scene.add(ring);
    return { def, grp, ring };
  }
  speak(id) { const l = JOB_LINES[id]; if (l) this.g.say(id, l.text, l.who); }

  // ---- state
  done(id) { const f = this.g.save.frenzies; return Array.isArray(f) && f.includes(id); }
  markers() {
    const out = [];
    for (const s of this.skulls) if (!this.done(s.def.id)) out.push({ x: s.def.at.x, z: s.def.at.z, kind: 'frenzy' });
    for (const f of this.flags) out.push({ x: f.def.pts[0].x, z: f.def.pts[0].z, kind: 'race' });
    const c = this.current;
    if (c && c.type === 'race' && c.i < c.pts.length) out.push({ x: c.pts[c.i].x, z: c.pts[c.i].z, kind: 'race' });
    return out;
  }
  /** Drop a running activity silently (save loaded, player died). */
  cancel(text = '') {
    const c = this.current;
    if (!c) return;
    if (text) this.g.hud.toast(text);
    this.end();
  }
  onPlayerLost() { this.cancel(this.current ? 'ACTIVITY FAILED' : ''); }
  end() {
    const g = this.g, c = this.current;
    this.current = null;
    const pw = g.player.worldPos();
    this.disarm = { x: pw.x, z: pw.z }; // don't restart while still standing on the skull / start line
    g.hud.setObjective(''); g.hud.setTimer(null);
    this.beacon.hide(); this.beacon2.hide();
    if (c && c.extras) for (const p of c.extras) if (!p.dead) p.remove = true;
  }
  fail(text) {
    const g = this.g, c = this.current;
    if (!c) return;
    g.hud.big(c.type === 'frenzy' ? 'FRENZY FAILED' : 'RACE FAILED', text, 4, 'fail');
    g.audio.missionFail();
    this.end();
  }

  // ---- kill frenzies
  startFrenzy(sk) {
    const g = this.g, p = g.player, d = sk.def;
    const target = Math.max(3, Math.round(d.kills * g.diff.enemyCount));
    this.current = { type: 'frenzy', def: d, kills: 0, target, timer: d.time * g.diff.timeLimit, extras: [], topT: 0 };
    p.giveWeapon(d.weapon, d.ammo);
    p.selectWeapon(d.weapon);
    g.hud.big(d.name, `${target} kills in ${Math.round(this.current.timer)} seconds`, 3);
    g.audio.pickup();
    this.speak('frenzy.' + d.id + '.start');
    this.frenzyObjective();
  }
  frenzyObjective() { const c = this.current; this.g.hud.setObjective(`KILL FRENZY: ${c.def.name}   ${c.kills}/${c.target}`); }
  /** game.onPedDeath hook (any ped death; counts the player's kills). */
  onKill(ped, byPlayer) {
    const c = this.current;
    if (!c || c.type !== 'frenzy' || !byPlayer || ped === this.g.player.ped) return;
    c.kills++;
    this.frenzyObjective();
    if (c.kills >= c.target) this.winFrenzy();
  }
  winFrenzy() {
    const g = this.g, c = this.current, amount = Math.round(c.def.reward * g.diff.reward);
    g.save.frenzies = Array.isArray(g.save.frenzies) ? g.save.frenzies : [];
    if (!g.save.frenzies.includes(c.def.id)) g.save.frenzies.push(c.def.id);
    g.addScore(amount, null);
    g.hud.big('KILL FRENZY COMPLETE', `${c.def.name}   ${fmtMoney(amount)}`, 4, 'pass');
    g.audio.missionPass();
    this.end();
    g.saveGame();
  }
  /** Keep a few victims within reach so the count is achievable. */
  topUp(c) {
    const g = this.g, pp = g.player.worldPos(), city = g.city;
    let near = 0;
    for (const p of g.peds) if (!p.dead && !p.isPlayer && p.kind !== 'cop' && dist(p.pos.x, p.pos.z, pp.x, pp.z) < 55) near++;
    for (let tries = 0; near < 10 && tries < 24; tries++) {
      const idx = Math.floor(rand(0, city.pedNodes.length)), n = city.pedNodes[idx], d = dist(n.x, n.z, pp.x, pp.z);
      if (d < 14 || d > 48) continue;
      const pd = g.spawnPed('civ', n.x + rand(-0.5, 0.5), n.z + rand(-0.5, 0.5));
      pd.node = idx; pd.pickNav();
      c.extras.push(pd); near++;
      if (tries > 12) break;
    }
  }

  // ---- races
  startRace(fl) {
    const g = this.g, d = fl.def, best = g.save.raceBest && g.save.raceBest[d.id];
    this.current = { type: 'race', def: d, pts: d.pts, i: 1, t: 0, left: 0, limit: d.target * g.diff.timeLimit };
    g.hud.big(d.name, `${d.pts.length - 1} checkpoints · par ${d.target * g.diff.timeLimit | 0}s${best ? ' · best ' + best.toFixed(1) + 's' : ''}`, 3);
    g.audio.pickup();
    this.speak('race.' + d.id + '.start');
    this.raceObjective();
  }
  raceObjective() { const c = this.current; this.g.hud.setObjective(`RACE: ${c.def.name}   checkpoint ${Math.min(c.i, c.pts.length - 1)}/${c.pts.length - 1}`); }
  winRace() {
    const g = this.g, c = this.current, d = c.def;
    const rb = (g.save.raceBest = g.save.raceBest || {}), jd = (g.save.jobsDone = g.save.jobsDone || {});
    const time = Math.round(c.t * 10) / 10, newBest = !(rb[d.id] > 0) || time < rb[d.id];
    if (newBest) rb[d.id] = time;
    const first = !jd['race.' + d.id];
    jd['race.' + d.id] = (jd['race.' + d.id] || 0) + 1;
    const amount = Math.round(d.reward * (first ? 1 : CONTACT_REPEAT) * g.diff.reward);
    g.addScore(amount, null);
    g.hud.big('RACE WON', `${d.name}   ${time.toFixed(1)}s${newBest ? ' · NEW BEST' : ''}   ${fmtMoney(amount)}`, 5, 'pass');
    g.audio.missionPass();
    this.end();
    g.saveGame();
  }

  // ---- per frame
  update(dt) {
    const g = this.g, p = g.player;
    const now = performance.now();
    // animate the world objects
    for (const s of this.skulls) {
      const done = this.done(s.def.id);
      s.grp.visible = s.ring.visible = !done;
      if (!done) { s.grp.rotation.y += dt * 2; s.grp.position.y = 1.4 + Math.sin(now * 0.004 + s.def.at.x) * 0.2; }
    }
    for (const f of this.flags) f.grp.children[1].rotation.y = Math.sin(now * 0.003) * 0.25;
    if (this.hintT > 0) this.hintT -= dt;
    if (p.dead) return;
    const c = this.current;
    if (!c) {
      if (g.isBusy()) return;
      if (this.disarm) {
        const q = p.worldPos();
        if (dist(q.x, q.z, this.disarm.x, this.disarm.z) > 14) this.disarm = null; else return;
      }
      if (!p.vehicle) {
        const pp = p.ped.pos;
        for (const s of this.skulls) if (!this.done(s.def.id) && dist(pp.x, pp.z, s.def.at.x, s.def.at.z) < SKULL_R) { this.startFrenzy(s); return; }
      }
      const pos = p.worldPos();
      for (const f of this.flags) {
        const s = f.def.pts[0], d = dist(pos.x, pos.z, s.x, s.z);
        if (p.vehicle && d < RACE_START_R) { this.startRace(f); return; }
        if (!p.vehicle && d < 5 && this.hintT <= 0) { this.hintT = 8; g.hud.toast('GET IN A CAR TO RACE: ' + f.def.name); }
      }
      return;
    }
    if (c.type === 'frenzy') {
      c.timer -= dt;
      g.hud.setTimer(c.timer);
      c.topT -= dt;
      if (c.topT <= 0) { c.topT = 2; this.topUp(c); }
      if (c.timer <= 0) this.fail(`${c.kills}/${c.target} kills. Out of time.`);
      return;
    }
    // race
    c.t += dt;
    const left = c.limit - c.t;
    g.hud.setTimer(left);
    if (left <= 0) { this.fail('Too slow. Par was ' + (c.limit | 0) + ' s.'); return; }
    const v = p.vehicle;
    c.left = v ? 0 : c.left + dt;
    if (c.left > 6) { this.fail('You left the car.'); return; }
    const cp = c.pts[c.i];
    if (v && dist(v.pos.x, v.pos.z, cp.x, cp.z) < CHECKPOINT_R) {
      c.i++;
      if (c.i >= c.pts.length) { this.winRace(); return; }
      g.audio.pickup();
      this.raceObjective();
    }
    const nxt = c.pts[c.i];
    this.beacon.show(g, nxt.x, nxt.z, { r: CHECKPOINT_R });
    const after = c.pts[c.i + 1];
    if (after) this.beacon2.show(g, after.x, after.z, { r: 6, arrow: false }); else this.beacon2.hide();
  }
}
