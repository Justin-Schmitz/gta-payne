import { rand, dist, choice } from '../util.js';

/** GTA1-style wanted "heads": heat accumulates from crimes, cops respond by level. */
export class Wanted {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.level = 0;
    this.forced = 0;
    this.cops = [];      // peds
    this.cars = [];      // vehicles with police controller
    this.carT = 0;
    this.footT = 0;
    this.shotHeatT = 0;
  }
  addHeat(n, witnessed = true) {
    if (!witnessed) return;
    this.heat = Math.min(this.heat + n * this.game.diff.heatGain, 4.99);
    this.level = Math.floor(this.heat);
  }
  set(level) { this.heat = level <= 0 ? 0 : Math.min(4.99, level + 0.6); this.level = Math.floor(this.heat); }
  force(level) { this.forced = level; if (level > 0) this.set(Math.max(this.heat, level)); }
  clear() {
    this.heat = 0; this.level = 0; this.forced = 0;
    for (const v of this.cars) if (!v.wrecked && v.controller === 'police') v.becomeTraffic();
    this.cars.length = 0;
    for (const c of this.cops) { c.angry = false; }
    this.cops.length = 0;
  }
  copNear(x, z, r) {
    for (const c of this.cops) if (!c.dead && dist(c.pos.x, c.pos.z, x, z) < r) return true;
    for (const v of this.cars) if (!v.wrecked && dist(v.pos.x, v.pos.z, x, z) < r) return true;
    for (const v of this.game.vehicles) if (v.typeKey === 'police' && !v.wrecked && v.hasDriver && dist(v.pos.x, v.pos.z, x, z) < r) return true;
    return false;
  }
  update(dt) {
    const g = this.game, pl = g.player;
    if (g.cheats && g.cheats.on.neverwanted) { if (this.level > 0 || this.heat > 0 || this.cars.length || this.cops.length) { this.forced = 0; this.clear(); } return; }
    this.cops = this.cops.filter((c) => !c.remove);
    this.cars = this.cars.filter((v) => !v.removed);
    if (this.forced > 0 && this.heat < this.forced) this.heat = this.forced;
    const p = pl.worldPos();
    if (this.level > 0 && !this.copNear(p.x, p.z, 55) && this.forced === 0) {
      this.heat = Math.max(0, this.heat - 0.045 * this.game.diff.heatDecay * dt);
      if (this.heat < 1) this.heat = 0;
    }
    this.level = Math.floor(this.heat);
    if (this.level === 0 && this.forced === 0) {
      if (this.cars.length || this.cops.length) this.clear();
      return;
    }
    if (pl.dead) return;
    // police cars
    this.carT -= dt;
    const activeCars = this.cars.filter((v) => !v.wrecked && v.controller === 'police').length;
    if (activeCars < Math.min(5, Math.max(1, Math.round(this.level * g.diff.copCars))) && this.carT <= 0) {
      this.carT = Math.max(2.5, 9 - this.level * 1.5);
      this.spawnCar();
    }
    // cops on foot
    this.footT -= dt;
    const activeCops = this.cops.filter((c) => !c.dead).length;
    const want = pl.vehicle ? 0 : (this.level >= 2 ? Math.round(this.level * 2 * g.diff.copFoot) : 1);
    if (activeCops < want && this.footT <= 0) {
      this.footT = Math.max(2, 7 - this.level);
      this.spawnCop();
    }
    // despawn far cops
    for (const c of this.cops) if (!c.dead && dist(c.pos.x, c.pos.z, p.x, p.z) > 230) { c.remove = true; }
    for (const v of this.cars) if (!v.wrecked && v.controller === 'police' && dist(v.pos.x, v.pos.z, p.x, p.z) > 320) { g.removeVehicle(v); }
  }
  spawnCar() {
    const g = this.game, city = g.city, p = g.player.worldPos();
    for (let tries = 0; tries < 12; tries++) {
      const [a, b] = city.randomEdge();
      const s = city.laneStart(a, b);
      const d = dist(s.x, s.z, p.x, p.z);
      if (d < 70 || d > 180) continue;
      if (g.vehicles.some((v) => dist(v.pos.x, v.pos.z, s.x, s.z) < 8)) continue;
      const v = g.spawnVehicle('police', s.x, s.z, 0, { hasDriver: true, driverKind: 'cop' });
      v.initTraffic(a, b, 0.1);
      v.controller = 'police';
      this.cars.push(v);
      return v;
    }
    return null;
  }
  spawnCop() {
    const g = this.game, city = g.city, p = g.player.worldPos();
    for (let tries = 0; tries < 12; tries++) {
      const n = choice(city.pedNodes);
      const d = dist(n.x, n.z, p.x, p.z);
      if (d < 30 || d > 70) continue;
      const c = g.spawnPed('cop', n.x + rand(-1, 1), n.z + rand(-1, 1), { angry: true });
      this.cops.push(c);
      return c;
    }
    return null;
  }
}
