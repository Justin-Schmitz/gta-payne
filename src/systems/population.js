import { rand, dist, choice } from '../util.js';
import { TRAFFIC_TYPES } from '../entities/vehicle.js';
import { GANGS, gangAt, gangAtXZ } from '../data/gangs.js';

const TRAFFIC_TARGET = 24, PED_TARGET = 38, TURF_TARGET = 6;

/** Keeps the streets alive: traffic, pedestrians, parked cars. */
export class Population {
  constructor(game) {
    this.game = game;
    this.t = 0;
  }
  init() {
    const g = this.game, city = g.city;
    // parked cars
    for (const s of city.parkingSpots) {
      if (Math.random() < 0.7) {
        const type = choice(['compact', 'sedan', 'sedan', 'coupe', 'sports', 'taxi', 'van', 'pickup', 'suv', 'boxtruck', 'flatbed']);
        if (g.vehicles.some((v) => dist(v.pos.x, v.pos.z, s.x, s.z) < 7)) continue;
        g.spawnVehicle(type, s.x, s.z, s.yaw, {});
      }
    }
    for (let i = 0; i < TRAFFIC_TARGET; i++) this.spawnTraffic(0, 600);
    for (let i = 0; i < PED_TARGET; i++) this.spawnPed(5, 150);
  }
  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const g = this.game, p = g.player.worldPos();
    let traffic = 0, peds = 0;
    for (const v of g.vehicles) {
      const d = dist(v.pos.x, v.pos.z, p.x, p.z);
      if (v.controller === 'npc') {
        traffic++;
        if (d > 280) g.removeVehicle(v);
      } else if (v.wrecked && v.wreckTime > 30 && d > 80 && !v.mission) g.removeVehicle(v);
      else if (v.controller === 'none' && !v.mission && !v.owned && d > 420 && !g.city.parkingSpots.some((s) => dist(s.x, s.z, v.pos.x, v.pos.z) < 1)) g.removeVehicle(v);
    }
    for (const pd of g.peds) {
      if (pd.kind !== 'civ') continue;
      if (pd.dead) continue;
      const d = dist(pd.pos.x, pd.pos.z, p.x, p.z);
      if (d > 190) pd.remove = true; else peds++;
    }
    if (traffic < TRAFFIC_TARGET) this.spawnTraffic(90, 220);
    if (peds < PED_TARGET) this.spawnPed(60, 130);
    this.updateTurf(p);
  }
  /** Keeps ~6 members of the local gang strolling the sidewalks (in pairs) while the player is inside its territory. */
  updateTurf(p) {
    const g = this.game, here = gangAtXZ(p.x, p.z);
    let have = 0;
    for (const pd of g.peds) {
      if (!pd.turf || pd.dead || pd.remove) continue;
      const d = dist(pd.pos.x, pd.pos.z, p.x, p.z);
      // despawn like civilians: far away, or off-turf and out of the player's immediate surroundings
      if (d > 190 || (pd.gang !== here && d > 80 && !pd.alerted)) { pd.remove = true; continue; }
      if (pd.gang === here) have++;
    }
    if (here && have < TURF_TARGET) this.spawnTurfPair(here, 28, 85);
  }
  spawnTurfPair(gang, minD, maxD) {
    const g = this.game, city = g.city, p = g.player.worldPos(), def = GANGS[gang];
    for (let tries = 0; tries < 14; tries++) {
      const idx = Math.floor(rand(0, city.pedNodes.length));
      const n = city.pedNodes[idx];
      if (gangAt(n.bx, n.bz) !== gang) continue;
      const d = dist(n.x, n.z, p.x, p.z);
      if (d < minD || d > maxD) continue;
      const mk = () => {
        const pd = g.spawnPed('gang', n.x + rand(-0.6, 0.6), n.z + rand(-0.6, 0.6), { gang, weapon: choice(def.weapons), alertRange: 30 });
        pd.turf = true; pd.node = idx; pd.pickNav();
        return pd;
      };
      const a = mk(), b = mk();
      a.buddy = b; b.buddy = a; b.follow = true;
      return [a, b];
    }
    return null;
  }
  spawnTraffic(minD, maxD) {
    const g = this.game, city = g.city, p = g.player.worldPos();
    for (let tries = 0; tries < 10; tries++) {
      const [a, b] = city.randomEdge();
      const t = rand(0.1, 0.9);
      const s = city.laneStart(a, b), e = city.laneEnd(a, b);
      const x = s.x + (e.x - s.x) * t, z = s.z + (e.z - s.z) * t;
      const d = dist(x, z, p.x, p.z);
      if (d < minD || d > maxD) continue;
      if (g.vehicles.some((v) => dist(v.pos.x, v.pos.z, x, z) < 12)) continue;
      const v = g.spawnVehicle(choice(TRAFFIC_TYPES), x, z, 0, { hasDriver: true });
      v.initTraffic(a, b, t);
      return v;
    }
    return null;
  }
  spawnPed(minD, maxD) {
    const g = this.game, city = g.city, p = g.player.worldPos();
    for (let tries = 0; tries < 10; tries++) {
      const idx = Math.floor(rand(0, city.pedNodes.length));
      const n = city.pedNodes[idx];
      const d = dist(n.x, n.z, p.x, p.z);
      if (d < minD || d > maxD) continue;
      const pd = g.spawnPed('civ', n.x + rand(-0.5, 0.5), n.z + rand(-0.5, 0.5));
      pd.node = idx; pd.pickNav();
      return pd;
    }
    return null;
  }
}
