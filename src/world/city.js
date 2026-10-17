import * as THREE from 'three';
import { TEX } from './textures.js';
import { rand, choice, clamp, segAABB, circleAABB } from '../util.js';

// ---- Grid layout --------------------------------------------------------
export const BLOCKS = 10, BLOCK = 36, ROAD = 14, P = BLOCK + ROAD;
export const HALF = (BLOCKS * P + ROAD) / 2; // 257
export const LANE = 3.8, SIDEWALK = 3, PARK_OFF = 1.3;
export const roadCoord = (i) => -HALF + ROAD / 2 + i * P;
export const blockMin = (i) => -HALF + ROAD + i * P;
export const blockMax = (i) => blockMin(i) + BLOCK;
export const blockCenter = (i) => blockMin(i) + BLOCK / 2;
export const cellIndex = (v) => clamp(Math.floor((v + HALF) / P), 0, BLOCKS);

/** Point on the sidewalk, 1.5m inside a block edge. side: n|s|e|w, t: 0..1 along the edge */
export const curb = (bx, bz, side, t = 0.5) => {
  const x0 = blockMin(bx), x1 = blockMax(bx), z0 = blockMin(bz), z1 = blockMax(bz), i = 1.5;
  if (side === 'n') return { x: x0 + t * BLOCK, z: z0 + i };
  if (side === 's') return { x: x0 + t * BLOCK, z: z1 - i };
  if (side === 'w') return { x: x0 + i, z: z0 + t * BLOCK };
  return { x: x1 - i, z: z0 + t * BLOCK };
};
/** Parking spot in the road beside a block edge, with the yaw a parked car should have (right-hand traffic). */
export const park = (bx, bz, side, t = 0.5) => {
  const x0 = blockMin(bx), x1 = blockMax(bx), z0 = blockMin(bz), z1 = blockMax(bz), o = PARK_OFF;
  if (side === 'n') return { x: x0 + t * BLOCK, z: z0 - o, yaw: Math.PI / 2 };
  if (side === 's') return { x: x0 + t * BLOCK, z: z1 + o, yaw: -Math.PI / 2 };
  if (side === 'w') return { x: x0 - o, z: z0 + t * BLOCK, yaw: Math.PI };
  return { x: x1 + o, z: z0 + t * BLOCK, yaw: 0 };
};
export const center = (bx, bz, dx = 0, dz = 0) => ({ x: blockCenter(bx) + dx, z: blockCenter(bz) + dz });
export const inter = (i, j) => ({ x: roadCoord(i), z: roadCoord(j) });
/**
 * JULPIE'S HOUSE (T16) key points, block (9,0): interior bounds ix0..ix1 x iz0..iz1, the street-side gate, the front courtyard, the
 * east side passage round the house and the walled back garden. Used by buildMansion, the map POI and the finale in data/missions.js.
 */
export const MANSION = (() => {
  const ix0 = blockMin(9) + SIDEWALK, ix1 = blockMax(9) - SIDEWALK, iz0 = blockMin(0) + SIDEWALK, iz1 = blockMax(0) - SIDEWALK, cx = (ix0 + ix1) / 2;
  const zHouse0 = iz1 - 9, zHouse1 = iz1 - 19.5;
  return {
    ix0, ix1, iz0, iz1, cx,
    gate: { x: cx, z: iz1 + 1.5 }, courtyard: { x: cx, z: iz1 - 5.2 },
    side: { x: cx + 11.6, z: (zHouse0 + zHouse1) / 2 }, garden: { x: cx, z: (zHouse1 + iz0 + 0.8) / 2 },
  };
})();

const DISTRICT = (bx, bz) =>
  bz === 9 ? 'industrial'
    : (bx >= 3 && bx <= 6 && bz >= 2 && bz <= 6) ? 'downtown'
      : bx >= 7 ? 'east' : bx <= 2 ? 'west' : 'residential';

export const SPECIAL = {
  '2,7': 'hospital', '7,7': 'police', '4,4': 'respray',
  '1,1': 'park', '8,8': 'park', '6,1': 'park', '0,5': 'park',
  '5,2': 'station', '5,4': 'bank', '3,6': 'courthouse',
  '2,5': 'courtyard', '4,2': 'courtyard', '8,9': 'courtyard', '7,3': 'courtyard',
  '9,9': 'scrapyard', '0,8': 'marina', '8,6': 'garage', '1,3': 'chapel',
  '8,2': 'gunshop', '1,6': 'gunshop',
  '6,4': 'dealer', '3,9': 'dealer',
  '9,0': 'mansion',   // JULPIE'S HOUSE (T16): walled mansion in the north-east corner, finale of the campaign
};
/** Car dealerships by block (T8): id keys into data/dealers.js. Door = south curb, delivery bays = parking spots in the south road. */
export const DEALER_LOTS = { '6,4': { id: 'harlow', name: 'HARLOW MOTORS' }, '3,9': { id: 'ironclad', name: 'IRONCLAD DEPOT' } };
/** Position of the three delivery bays along the south edge (left, right, centre: the centre one faces the door). */
export const DEALER_BAYS = [0.17, 0.83, 0.5];
/** Gun-shop blocks: shop name by block. Door point = south curb of the block (locations.gunShops). */
export const GUN_SHOPS = { '8,2': 'HARLOW ARMS', '1,6': 'PAWN & AMMO' };

export class City {
  constructor() {
    this.group = new THREE.Group();
    this.boxes = [];
    this.grid = new Map();
    this.pedNodes = [];
    this.parkingSpots = [];
    this.phoneSpots = [];
    this.respray = { x: blockCenter(4), z: blockCenter(4), r: 5 };
    this.locations = {};
  }

  // ---- collision helpers -------------------------------------------------
  addBox(b) {
    this.boxes.push(b);
    const cx0 = cellIndex(b.x0), cx1 = cellIndex(b.x1), cz0 = cellIndex(b.z0), cz1 = cellIndex(b.z1);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = cx * 100 + cz;
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(b);
    }
  }
  queryRect(x0, z0, x1, z1) {
    const out = [];
    const cx0 = cellIndex(x0), cx1 = cellIndex(x1), cz0 = cellIndex(z0), cz1 = cellIndex(z1);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const a = this.grid.get(cx * 100 + cz);
      if (!a) continue;
      for (const b of a) if (!b._m) { b._m = true; out.push(b); }
    }
    for (const b of out) b._m = false;
    return out;
  }
  query(x, z, r = 0) { return this.queryRect(x - r, z - r, x + r, z + r); }
  /** Push a circle out of all static geometry. Mutates and returns pos {x,z}. Returns the hit box count. */
  resolveCircle(pos, r, clearY = -Infinity) {
    let hits = 0;
    const boxes = this.query(pos.x, pos.z, r + 1);
    for (let iter = 0; iter < 2; iter++) {
      for (const b of boxes) {
        if (b.h <= clearY) continue; // low box the caller's feet are above (crate, low wall)
        const p = circleAABB(pos.x, pos.z, r, b);
        if (p) { pos.x += p.px; pos.z += p.pz; hits++; }
      }
    }
    // world bounds
    const lim = HALF - r;
    if (pos.x < -lim) { pos.x = -lim; hits++; } else if (pos.x > lim) { pos.x = lim; hits++; }
    if (pos.z < -lim) { pos.z = -lim; hits++; } else if (pos.z > lim) { pos.z = lim; hits++; }
    return hits;
  }
  /** Walkable surface height at (x,z): top of the tallest low box (h <= maxH, default 2.6) containing the point, else 0. */
  groundHeight(x, z, maxH = 2.6) {
    let g = 0;
    for (const b of this.query(x, z, 0)) {
      if (b.h > g && b.h <= maxH && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) g = b.h;
    }
    return g;
  }
  lineOfSight(ax, az, bx, bz, minH = 1.2) {
    const boxes = this.queryRect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    for (const b of boxes) {
      if (b.h < minH) continue;
      if (segAABB(ax, az, bx, bz, b) !== null) return false;
    }
    return true;
  }
  /** Nearest hit t along the segment against boxes taller than minH, or null. */
  raycast(ax, az, bx, bz, minH = 0) {
    const boxes = this.queryRect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    let best = null;
    for (const b of boxes) {
      if (b.h < minH) continue;
      const t = segAABB(ax, az, bx, bz, b);
      if (t !== null && (best === null || t < best)) best = t;
    }
    return best;
  }
  pointFree(x, z, r = 0.6) {
    if (Math.abs(x) > HALF - r || Math.abs(z) > HALF - r) return false;
    for (const b of this.query(x, z, r)) if (circleAABB(x, z, r, b)) return false;
    return true;
  }

  // ---- lane graph for traffic -------------------------------------------
  neighbors(i, j) {
    const out = [];
    if (i > 0) out.push([i - 1, j]);
    if (i < BLOCKS) out.push([i + 1, j]);
    if (j > 0) out.push([i, j - 1]);
    if (j < BLOCKS) out.push([i, j + 1]);
    return out;
  }
  laneStart(a, b) {
    const A = inter(a[0], a[1]), B = inter(b[0], b[1]);
    const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
    const rx = -dz, rz = dx;
    return { x: A.x + dx * (ROAD / 2 + 2) + rx * LANE, z: A.z + dz * (ROAD / 2 + 2) + rz * LANE };
  }
  laneEnd(a, b) {
    const A = inter(a[0], a[1]), B = inter(b[0], b[1]);
    const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
    const rx = -dz, rz = dx;
    return { x: B.x - dx * (ROAD / 2 + 2) + rx * LANE, z: B.z - dz * (ROAD / 2 + 2) + rz * LANE };
  }
  /** Nearest intersection indices to a point. */
  nearestInter(x, z) {
    return [clamp(Math.round((x + HALF - ROAD / 2) / P), 0, BLOCKS), clamp(Math.round((z + HALF - ROAD / 2) / P), 0, BLOCKS)];
  }
  randomEdge() {
    const i = Math.floor(rand(0, BLOCKS + 1)), j = Math.floor(rand(0, BLOCKS + 1));
    const nb = choice(this.neighbors(i, j));
    return [[i, j], nb];
  }

  // ---- ped graph ---------------------------------------------------------
  nodeIndex(bx, bz, k) { return (bx * BLOCKS + bz) * 4 + k; }
  nearestPedNode(x, z) {
    let best = 0, bd = Infinity;
    const bx = clamp(Math.floor((x + HALF - ROAD) / P), 0, BLOCKS - 1), bz = clamp(Math.floor((z + HALF - ROAD) / P), 0, BLOCKS - 1);
    for (let i = Math.max(0, bx - 1); i <= Math.min(BLOCKS - 1, bx + 1); i++) for (let j = Math.max(0, bz - 1); j <= Math.min(BLOCKS - 1, bz + 1); j++) for (let k = 0; k < 4; k++) {
      const n = this.pedNodes[this.nodeIndex(i, j, k)];
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = this.nodeIndex(i, j, k); }
    }
    return best;
  }

  // ---- building ----------------------------------------------------------
  build(scene) {
    const g = this.group;
    // water
    TEX.water.repeat.set(180, 180);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshLambertMaterial({ map: TEX.water }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.6; g.add(water);
    // ground / asphalt
    TEX.asphalt.repeat.set(HALF / 2, HALF / 2);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), new THREE.MeshLambertMaterial({ map: TEX.asphalt }));
    ground.rotation.x = -Math.PI / 2; g.add(ground);
    // seawall
    const wallMat = new THREE.MeshLambertMaterial({ color: '#8c8c84' });
    for (const [x, z, w, d] of [[0, -HALF - 0.6, 2 * HALF + 2, 1.2], [0, HALF + 0.6, 2 * HALF + 2, 1.2], [-HALF - 0.6, 0, 1.2, 2 * HALF + 2], [HALF + 0.6, 0, 1.2, 2 * HALF + 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), wallMat);
      m.position.set(x, 0.5, z); g.add(m);
    }
    TEX.sidewalk.repeat.set(18, 18);
    TEX.grass.repeat.set(9, 9);
    this.slabMat = new THREE.MeshLambertMaterial({ map: TEX.sidewalk });
    this.grassMat = new THREE.MeshLambertMaterial({ map: TEX.grass });

    for (let bx = 0; bx < BLOCKS; bx++) for (let bz = 0; bz < BLOCKS; bz++) this.addPedNodes(bx, bz);
    this.linkPedNodes();
    for (let bx = 0; bx < BLOCKS; bx++) for (let bz = 0; bz < BLOCKS; bz++) this.buildBlock(bx, bz);
    this.buildRoadMarkings();
    this.buildLamps();
    this.defineLocations();
    scene.add(g);
  }

  addPedNodes(bx, bz) {
    const x0 = blockMin(bx), x1 = blockMax(bx), z0 = blockMin(bz), z1 = blockMax(bz), i = 1.6;
    const base = this.pedNodes.length;
    const pts = [[x0 + i, z0 + i], [x1 - i, z0 + i], [x1 - i, z1 - i], [x0 + i, z1 - i]];
    for (let k = 0; k < 4; k++) this.pedNodes.push({ x: pts[k][0], z: pts[k][1], n: [base + (k + 1) % 4, base + (k + 3) % 4], bx, bz, k });
  }
  linkPedNodes() {
    const link = (a, b) => { this.pedNodes[a].n.push(b); this.pedNodes[b].n.push(a); };
    for (let bx = 0; bx < BLOCKS; bx++) for (let bz = 0; bz < BLOCKS; bz++) {
      if (bx < BLOCKS - 1) { link(this.nodeIndex(bx, bz, 1), this.nodeIndex(bx + 1, bz, 0)); link(this.nodeIndex(bx, bz, 2), this.nodeIndex(bx + 1, bz, 3)); }
      if (bz < BLOCKS - 1) { link(this.nodeIndex(bx, bz, 3), this.nodeIndex(bx, bz + 1, 0)); link(this.nodeIndex(bx, bz, 2), this.nodeIndex(bx, bz + 1, 1)); }
    }
  }

  buildBlock(bx, bz) {
    const x0 = blockMin(bx), z0 = blockMin(bz), x1 = blockMax(bx), z1 = blockMax(bz);
    const cx = blockCenter(bx), cz = blockCenter(bz);
    const sp = SPECIAL[`${bx},${bz}`];
    const district = DISTRICT(bx, bz);
    const isPark = sp === 'park';
    const slab = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.2, BLOCK), isPark ? this.grassMat : this.slabMat);
    slab.position.set(cx, 0.1, cz);
    this.group.add(slab);

    for (const side of ['n', 's', 'e', 'w']) for (const t of [0.3, 0.5, 0.7]) {
      if (Math.random() < 0.16) this.parkingSpots.push(park(bx, bz, side, t));
    }

    const ix0 = x0 + SIDEWALK, iz0 = z0 + SIDEWALK, ix1 = x1 - SIDEWALK, iz1 = z1 - SIDEWALK;
    switch (sp) {
      case 'park': this.buildPark(ix0, iz0, ix1, iz1); break;
      case 'hospital': this.building(ix0 + 1, iz0 + 3, ix1 - 1, iz1 - 3, 16, 'plain', '#f2f2f0', { sign: '#e0302a', signText: 'H' }); break;
      case 'police': this.building(ix0 + 1, iz0 + 3, ix1 - 1, iz1 - 3, 14, 4, '#9fb4c8', { sign: '#2255dd', signText: 'HPD' }); break;
      case 'respray': this.buildRespray(ix0, iz0, ix1, iz1); break;
      case 'station': this.building(ix0, iz0 + 2, ix1, iz1 - 2, 18, 3, '#e0d2b0', { sign: '#2c3e50' }); break;
      case 'bank': this.building(ix0 + 2, iz0 + 6, ix1 - 2, iz1 - 2, 30, 2, '#d8d4c8', { sign: '#1f6f3f' }); break;
      case 'courthouse': this.building(ix0 + 2, iz0 + 4, ix1 - 2, iz1 - 4, 22, 6, '#e6e0d0'); break;
      case 'chapel': this.building(ix0 + 6, iz0 + 4, ix1 - 6, iz1 - 4, 12, 2, '#cfc5b0', { sign: '#9a3b3b' }); this.building(ix0 + 12, iz0 + 4, ix1 - 12, iz0 + 10, 26, 2, '#cfc5b0'); break;
      case 'garage': this.building(ix0, iz0 + 4, ix1, iz1, 8, 'w', '#8a7f6a', { sign: '#7c4dff' }); break;
      case 'scrapyard': this.buildScrapyard(ix0, iz0, ix1, iz1); break;
      case 'marina': this.building(ix0 + 4, iz0 + 4, ix1 - 4, iz1 - 4, 7, 6, '#d0d8e0', { sign: '#1aa3c9' }); break;
      case 'courtyard': this.buildCourtyard(ix0, iz0, ix1, iz1, district); break;
      case 'gunshop': this.buildGunShop(ix0, iz0, ix1, iz1, GUN_SHOPS[`${bx},${bz}`]); break;
      case 'dealer': this.buildDealer(ix0, iz0, ix1, iz1, DEALER_LOTS[`${bx},${bz}`]); break;
      case 'mansion': this.buildMansion(ix0, iz0, ix1, iz1); break;
      default: this.buildLots(ix0, iz0, ix1, iz1, district);
    }
  }

  /**
   * JULPIE'S HOUSE (T16), block (9,0) in the north-east corner. Layout (block interior ix0..ix1 x iz0..iz1, 30 x 30 m, z grows south):
   *  - 2.5 m garden wall all round (collision boxes), gate opening in the south wall (centre, 6.4 m) with pillars, an arch sign and open gate leaves
   *  - front courtyard (8 m deep): driveway, fountain, hedges and topiary for cover
   *  - the 2-storey house (18 x 10.5 m, 9.5 m tall) with porch, windows, roof and a balcony ("roof terrace") jutting over the garden
   *  - 5 m side passages left and right of the house lead to the walled back garden: pool, loungers, statues, trees
   */
  buildMansion(ix0, iz0, ix1, iz1) {
    const g = this.group, cx = (ix0 + ix1) / 2, T = 0.8, WH = 2.5, GATE = 3.2;
    const mat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
    const mesh = (geo, c, x, y, z, o) => { const m = new THREE.Mesh(geo, mat(c, o)); m.position.set(x, y, z); g.add(m); return m; };
    const slab = (x0, z0, x1, z1, y0, y1, c, solid = false) => {
      mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), c, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      if (solid) this.addBox({ x0, z0, x1, z1, h: y1 });
    };
    const WALL = '#eadfce';
    // ground: gravel courtyard + driveway, lawn behind the house
    const zFront = iz1 - T, zHouse0 = iz1 - 9, zHouse1 = iz1 - 19.5;
    slab(ix0 + T, zHouse0, ix1 - T, zFront, 0.2, 0.235, '#b9ad9a');
    slab(cx - GATE, zHouse0, cx + GATE, iz1 + 0.5, 0.2, 0.25, '#d6cbb8');
    slab(ix0 + T, iz0 + T, ix1 - T, zHouse1, 0.2, 0.235, '#3f8f3a');
    slab(ix0 + T, zHouse1, ix0 + 6, zHouse0, 0.2, 0.235, '#3f8f3a');
    slab(ix1 - 6, zHouse1, ix1 - T, zHouse0, 0.2, 0.235, '#3f8f3a');
    // perimeter wall with the gate gap in the south side
    slab(ix0, iz0, ix1, iz0 + T, 0, WH, WALL, true);
    slab(ix0, iz0, ix0 + T, iz1, 0, WH, WALL, true);
    slab(ix1 - T, iz0, ix1, iz1, 0, WH, WALL, true);
    slab(ix0, iz1 - T, cx - GATE, iz1, 0, WH, WALL, true);
    slab(cx + GATE, iz1 - T, ix1, iz1, 0, WH, WALL, true);
    for (const sx of [-1, 1]) { // gate pillars with caps, and the open iron leaves
      const px = cx + sx * (GATE - 0.1);
      slab(px - 0.75, iz1 - 1.15, px + 0.75, iz1 + 0.1, 0, 3.7, '#f4ece0', true);
      slab(px - 0.95, iz1 - 1.35, px + 0.95, iz1 + 0.3, 3.7, 3.95, '#c9b99f');
      mesh(new THREE.SphereGeometry(0.4, 8, 6), '#ff4fa3', px, 4.4, iz1 - 0.5, { emissive: '#7a1d4c' });
      slab(cx + sx * (GATE - 1.0) - 0.06, iz1 - 4.0, cx + sx * (GATE - 1.0) + 0.06, iz1 - T, 0.05, 2.4, '#1c1c22');
    }
    slab(cx - GATE, iz1 - 0.9, cx + GATE, iz1 - 0.3, 3.55, 3.95, '#3a2a30'); // arch beam
    { // name plate on the arch, facing the street
      const cv = document.createElement('canvas');
      cv.width = 768; cv.height = 112;
      const c = cv.getContext('2d');
      c.fillStyle = '#2a1020'; c.fillRect(0, 0, 768, 112);
      c.strokeStyle = '#ff4fa3'; c.lineWidth = 8; c.strokeRect(6, 6, 756, 100);
      c.fillStyle = '#ffd0e8'; c.font = 'bold 62px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText("JULPIE'S HOUSE", 384, 60);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 0.9), new THREE.MeshBasicMaterial({ map: tex }));
      plate.position.set(cx, 3.75, iz1 - 0.26); g.add(plate);
    }
    // front courtyard: fountain + hedges + topiary
    const fz = iz1 - 5.2;
    mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.9, 20), '#cfc6b6', cx, 0.65, fz);
    mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.05, 20), '#4fb7e8', cx, 1.12, fz, { emissive: '#12506e' });
    mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.8, 10), '#cfc6b6', cx, 1.5, fz);
    mesh(new THREE.SphereGeometry(0.5, 10, 8), '#ff4fa3', cx, 2.6, fz, { emissive: '#7a1d4c' });
    this.addBox({ x0: cx - 2.5, z0: fz - 2.5, x1: cx + 2.5, z1: fz + 2.5, h: 1.1 });
    const hedge = (x0, z0, x1, z1) => { slab(x0, z0, x1, z1, 0.2, 1.3, '#2f7a2f', true); };
    hedge(cx - 13, iz1 - 3.6, cx - 6.5, iz1 - 2.6); hedge(cx + 6.5, iz1 - 3.6, cx + 13, iz1 - 2.6);
    hedge(cx - 13, zHouse0 + 0.9, cx - 7, zHouse0 + 1.9); hedge(cx + 7, zHouse0 + 0.9, cx + 13, zHouse0 + 1.9);
    for (const [tx, tz] of [[cx - 5.5, zHouse0 + 1.2], [cx + 5.5, zHouse0 + 1.2], [cx - 11, fz], [cx + 11, fz]]) {
      mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.7, 8), '#8c5a3a', tx, 0.55, tz);
      mesh(new THREE.ConeGeometry(0.85, 2.3, 8), '#2f7a2f', tx, 2.0, tz, { flatShading: true });
      this.addBox({ x0: tx - 0.5, z0: tz - 0.5, x1: tx + 0.5, z1: tz + 0.5, h: 2.4 });
    }
    // the house
    const hx0 = cx - 9, hx1 = cx + 9, H = 9.5;
    this.building(hx0, zHouse1, hx1, zHouse0, H, 'plain', '#efe6d4', { roof: '#8a3b30' });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 3.2, 4), mat('#8a3b30', { flatShading: true }));
    roof.rotation.y = Math.PI / 4; roof.scale.set(((hx1 - hx0) / Math.SQRT2) * 1.04, 1, ((zHouse0 - zHouse1) / Math.SQRT2) * 1.04);
    roof.position.set(cx, H + 1.6, (zHouse0 + zHouse1) / 2); g.add(roof);
    const winMat = mat('#2a4a78', { emissive: '#1a3050' });
    const win = (x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), winMat); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); };
    for (const y of [2.4, 7.0]) {
      for (const dx of [-7, -4, 4, 7]) win(cx + dx, y, zHouse0 + 0.03, 0);
      for (const dx of [-7, -3.5, 3.5, 7]) win(cx + dx, y, zHouse1 - 0.03, Math.PI);
    }
    win(cx - 1.9, 7.0, zHouse0 + 0.03, 0); win(cx + 1.9, 7.0, zHouse0 + 0.03, 0);
    mesh(new THREE.BoxGeometry(2.4, 3.2, 0.2), '#4a2a18', cx, 1.8, zHouse0 + 0.1); // front door
    slab(cx - 3.5, zHouse0, cx + 3.5, zHouse0 + 2.4, 3.9, 4.15, '#d8ccb6');        // porch roof
    for (const sx of [-3.1, 3.1]) mesh(new THREE.CylinderGeometry(0.3, 0.34, 3.9, 10), '#f4ece0', cx + sx, 1.95, zHouse0 + 2.0);
    slab(cx - 3.5, zHouse0, cx + 3.5, zHouse0 + 2.4, 0.2, 0.4, '#d8ccb6');           // porch floor (decor: 0.2 high, walked over)
    // back balcony ("roof terrace"): a slab at second-floor height jutting 3 m over the garden, on two pillars
    const bz0 = zHouse1 - 3;
    slab(cx - 4.5, bz0, cx + 4.5, zHouse1, 4.6, 4.9, '#d8ccb6');
    slab(cx - 4.5, bz0, cx + 4.5, bz0 + 0.12, 4.9, 5.9, '#b79f7a');
    for (const sx of [-4.2, 4.2]) { mesh(new THREE.CylinderGeometry(0.28, 0.32, 4.6, 8), '#f4ece0', cx + sx, 2.3, bz0 + 0.35); this.addBox({ x0: cx + sx - 0.3, z0: bz0 + 0.05, x1: cx + sx + 0.3, z1: bz0 + 0.65, h: 4.6 }); }
    // back garden: pool, loungers, statues, trees
    const gz = (zHouse1 + iz0 + T) / 2;
    slab(cx - 5, gz - 2.4, cx + 5, gz + 2.4, 0.2, 0.26, '#e4dccb');
    mesh(new THREE.BoxGeometry(9, 0.04, 3.8), '#35b6e8', cx, 0.27, gz, { emissive: '#0e4660' });
    for (const sx of [-1, 1]) {
      slab(cx + sx * 7.2 - 0.5, gz - 1.3, cx + sx * 7.2 + 0.5, gz + 1.3, 0.2, 0.55, '#f4f0e8', true);
      const sxx = cx + sx * 11.5;
      slab(sxx - 0.5, gz - 0.5, sxx + 0.5, gz + 0.5, 0.2, 1.4, '#cfc6b6', true);
      mesh(new THREE.SphereGeometry(0.42, 8, 6), '#e8e0d0', sxx, 1.7, gz);
    }
    const trunk = mat('#5b3a1e'), leaf = mat('#2f7a2f', { flatShading: true });
    for (const [tx, tz] of [[ix0 + 2.2, iz0 + 2.2], [ix1 - 2.2, iz0 + 2.2], [ix0 + 2.2, zHouse1 + 2], [ix1 - 2.2, zHouse1 + 2], [cx - 9, iz0 + 2.4], [cx + 9, iz0 + 2.4]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.6, 6), trunk); t.position.set(tx, 1.3, tz); g.add(t);
      const l = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 0), leaf); l.position.set(tx, 3.5, tz); g.add(l);
      this.addBox({ x0: tx - 0.4, z0: tz - 0.4, x1: tx + 0.4, z1: tz + 0.4, h: 2.4 });
    }
    this.mansion = MANSION;
  }

  buildLots(ix0, iz0, ix1, iz1, district) {
    const layout = choice(['one', 'two', 'four', 'four', 'three', 'two']);
    const hRange = district === 'downtown' ? [22, 70] : district === 'industrial' ? [6, 11] : district === 'east' ? [9, 24] : district === 'west' ? [8, 20] : [8, 16];
    const texPool = district === 'downtown' ? [0, 2, 4, 7] : district === 'industrial' ? ['w'] : district === 'east' ? [1, 5, 2] : [1, 3, 6, 5];
    const mk = (ax, az, bx, bz) => {
      const s = rand(0, 1.5);
      this.building(ax + s, az + s, bx - s, bz - s, rand(hRange[0], hRange[1]), choice(texPool));
    };
    if (layout === 'one') mk(ix0, iz0, ix1, iz1);
    else if (layout === 'two') {
      if (Math.random() < 0.5) { mk(ix0, iz0, ix0 + 14, iz1); mk(ix1 - 14, iz0, ix1, iz1); }
      else { mk(ix0, iz0, ix1, iz0 + 14); mk(ix0, iz1 - 14, ix1, iz1); }
    } else if (layout === 'three') { mk(ix0, iz0, ix0 + 14, iz0 + 14); mk(ix1 - 14, iz0, ix1, iz0 + 14); mk(ix0, iz1 - 14, ix1, iz1); }
    else for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) mk(ix0 + a * 16, iz0 + b * 16, ix0 + a * 16 + 14, iz0 + b * 16 + 14);
  }

  /** Low shop with a bright sign, a door and a name plate on the south face (the door point is on the south curb). */
  buildGunShop(ix0, iz0, ix1, iz1, name) {
    const x0 = ix0 + 4, x1 = ix1 - 4, z0 = iz0 + 2, z1 = iz1, h = 7, cx = (x0 + x1) / 2;
    this.building(x0, z0, x1, z1, h, 3, '#d9c3a3', { sign: '#ff8a1a', roof: '#6d6d68' });
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.2), new THREE.MeshLambertMaterial({ color: '#2a1d14' }));
    door.position.set(cx, 1.3, z1 + 0.08); this.group.add(door);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 1.4), new THREE.MeshLambertMaterial({ color: '#c0392b' }));
    awning.position.set(cx, 3.2, z1 + 0.7); this.group.add(awning);
    // name plate
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 96;
    const c = cv.getContext('2d');
    c.fillStyle = '#16181c'; c.fillRect(0, 0, 512, 96);
    c.strokeStyle = '#ff8a1a'; c.lineWidth = 6; c.strokeRect(5, 5, 502, 86);
    c.fillStyle = '#ffe066'; c.font = 'bold 54px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(name, 256, 50);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), new THREE.MeshBasicMaterial({ map: tex }));
    plate.position.set(cx, 4.6, z1 + 0.05); this.group.add(plate);
  }

  /** Car dealership: a long glass-front showroom on the south edge (door on the south curb), display podiums on a forecourt behind it. */
  buildDealer(ix0, iz0, ix1, iz1, lot) {
    const iron = lot.id === 'ironclad';
    const wall = iron ? '#8b9096' : '#eef2f4', accent = iron ? '#ff8a1a' : '#1aa3c9', dark = iron ? '#2b2e33' : '#124a5c';
    const x0 = ix0 + 1, x1 = ix1 - 1, z1 = iz1, z0 = iz1 - 11, h = iron ? 8 : 6, cx = (x0 + x1) / 2;
    this.building(x0, z0, x1, z1, h, 'plain', wall, { sign: accent, roof: '#55585e' });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 4, 2.6, 0.12), new THREE.MeshLambertMaterial({ color: '#4a8fb0', emissive: '#14384a' }));
    glass.position.set(cx, 2.1, z1 + 0.07); this.group.add(glass);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.7, 0.16), new THREE.MeshLambertMaterial({ color: dark }));
    door.position.set(cx, 1.35, z1 + 0.13); this.group.add(door);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 1.6), new THREE.MeshLambertMaterial({ color: accent }));
    awning.position.set(cx, 3.4, z1 + 0.8); this.group.add(awning);
    // name plate
    const cv = document.createElement('canvas');
    cv.width = 640; cv.height = 112;
    const c = cv.getContext('2d');
    c.fillStyle = dark; c.fillRect(0, 0, 640, 112);
    c.strokeStyle = accent; c.lineWidth = 7; c.strokeRect(5, 5, 630, 102);
    c.fillStyle = '#ffffff'; c.font = 'bold 60px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(lot.name, 320, 58);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.575), new THREE.MeshBasicMaterial({ map: tex }));
    plate.position.set(cx, 4.9, z1 + 0.05); this.group.add(plate);
    // forecourt behind the showroom: painted lot, display podiums, pennants
    const lotW = x1 - x0, lotD = z0 - iz0 - 1;
    const pave = new THREE.Mesh(new THREE.BoxGeometry(lotW, 0.06, lotD), new THREE.MeshLambertMaterial({ color: iron ? '#4a4d52' : '#6a6e75' }));
    pave.position.set(cx, 0.23, iz0 + lotD / 2); this.group.add(pave);
    const podMat = new THREE.MeshLambertMaterial({ color: accent });
    for (const dx of [-lotW * 0.3, 0, lotW * 0.3]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3, 0.35, 16), podMat);
      pod.position.set(cx + dx, 0.4, iz0 + lotD * 0.55); this.group.add(pod);
    }
    const poleMat = new THREE.MeshLambertMaterial({ color: '#cfcfcf' });
    for (const sx of [x0 + 1.2, x1 - 1.2]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 6), poleMat);
      pole.position.set(sx, h + 2, z0 + 1.5); this.group.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.05), podMat);
      flag.position.set(sx + 0.85, h + 3.4, z0 + 1.5); this.group.add(flag);
    }
    if (iron) {
      // stacked containers and crates along the back fence
      for (let i = 0; i < 4; i++) this.crate(x0 + 3 + i * 6.5, iz0 + 2.5, 2.4, choice(['#7f8c8d', '#c0392b', '#2c3e50', '#d35400']));
    } else {
      const trunk = new THREE.MeshLambertMaterial({ color: '#5b3a1e' }), leaf = new THREE.MeshLambertMaterial({ color: '#2f7a2f', flatShading: true });
      for (const tx of [x0 + 2, x1 - 2]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.6, 6), trunk);
        t.position.set(tx, 1.3, iz0 + 2.5); this.group.add(t);
        const l = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 0), leaf);
        l.position.set(tx, 3.6, iz0 + 2.5); this.group.add(l);
        this.addBox({ x0: tx - 0.4, z0: iz0 + 2.1, x1: tx + 0.4, z1: iz0 + 2.9, h: 2.4 });
      }
    }
  }

  buildCourtyard(ix0, iz0, ix1, iz1, district) {
    const tex = district === 'industrial' ? 'w' : choice([1, 5, 2]);
    const s = 11;
    this.building(ix0, iz0, ix0 + s, iz0 + s, rand(9, 14), tex);
    this.building(ix1 - s, iz0, ix1, iz0 + s, rand(9, 14), tex);
    this.building(ix0, iz1 - s, ix0 + s, iz1, rand(9, 14), tex);
    this.building(ix1 - s, iz1 - s, ix1, iz1, rand(9, 14), tex);
    // crates for cover
    const cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2;
    for (let i = 0; i < 6; i++) {
      const x = cx + rand(-9, 9), z = cz + rand(-9, 9);
      if (Math.abs(x - cx) < 3 && Math.abs(z - cz) < 3) continue;
      this.crate(x, z, rand(1.2, 2));
    }
  }

  buildPark(ix0, iz0, ix1, iz1) {
    const trunk = new THREE.MeshLambertMaterial({ color: '#5b3a1e' });
    const leaf = new THREE.MeshLambertMaterial({ color: '#2f7a2f', flatShading: true });
    for (let i = 0; i < 9; i++) {
      const x = rand(ix0 + 2, ix1 - 2), z = rand(iz0 + 2, iz1 - 2);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.6, 6), trunk);
      t.position.set(x, 1.3, z); this.group.add(t);
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.6, 2.4), 0), leaf);
      c.position.set(x, 3.6, z); this.group.add(c);
      this.addBox({ x0: x - 0.4, z0: z - 0.4, x1: x + 0.4, z1: z + 0.4, h: 2.4 });
    }
  }

  buildRespray(ix0, iz0, ix1, iz1) {
    const cz = (iz0 + iz1) / 2;
    this.building(ix0, iz0 + 2, ix1, cz - 4, 6, 'w', '#8a8a80');
    this.building(ix0, cz + 4, ix1, iz1 - 2, 6, 'w', '#8a8a80');
    const roof = new THREE.Mesh(new THREE.BoxGeometry(ix1 - ix0, 0.5, 8), new THREE.MeshLambertMaterial({ color: '#c0392b' }));
    roof.position.set((ix0 + ix1) / 2, 5.5, cz); this.group.add(roof);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 1), new THREE.MeshLambertMaterial({ color: '#f1c40f' }));
    sign.position.set((ix0 + ix1) / 2, 7.2, cz); this.group.add(sign);
  }

  buildScrapyard(ix0, iz0, ix1, iz1) {
    this.building(ix0, iz0, ix0 + 12, iz0 + 12, 7, 'w', '#7a6a55', { sign: '#e67e22' });
    for (let i = 0; i < 10; i++) this.crate(rand(ix0 + 14, ix1 - 2), rand(iz0 + 2, iz1 - 2), rand(1, 2.2), choice(['#7f8c8d', '#6c5b3e', '#5d4037']));
  }

  crate(x, z, s, color = '#8d6e3f') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, s / 2, z); m.rotation.y = rand(0, 0.5);
    this.group.add(m);
    this.addBox({ x0: x - s / 2, z0: z - s / 2, x1: x + s / 2, z1: z + s / 2, h: s });
  }

  building(x0, z0, x1, z1, h, tex, color = '#ffffff', opts = {}) {
    const w = x1 - x0, d = z1 - z0;
    const geo = new THREE.BoxGeometry(w, h, d);
    let side;
    if (tex === 'plain') side = TEX.plain;
    else if (tex === 'w') side = TEX.warehouse.clone();
    else side = TEX.facades[tex].clone();
    if (tex !== 'plain') { side.repeat.set(Math.max(1, Math.round((w + d) / 2 / 16)), Math.max(1, Math.round(h / 7))); side.needsUpdate = true; }
    const mSide = new THREE.MeshLambertMaterial({ map: side, color });
    const mRoof = new THREE.MeshLambertMaterial({ map: TEX.roof, color: opts.roof || '#9a9a94' });
    const mesh = new THREE.Mesh(geo, [mSide, mSide, mRoof, mRoof, mSide, mSide]);
    mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    this.group.add(mesh);
    if (opts.sign) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.6, 10), 1.6, 1), new THREE.MeshLambertMaterial({ color: opts.sign }));
      s.position.set((x0 + x1) / 2, h + 1, (z0 + z1) / 2 + d / 2 - 0.5);
      this.group.add(s);
    }
    this.addBox({ x0, z0, x1, z1, h });
    return mesh;
  }

  buildRoadMarkings() {
    const inBand = (v) => { for (let j = 0; j <= BLOCKS; j++) if (Math.abs(v - roadCoord(j)) < ROAD / 2 + 1) return true; return false; };
    const items = [];
    for (let i = 0; i <= BLOCKS; i++) {
      const c = roadCoord(i);
      for (let v = -HALF + ROAD; v < HALF - ROAD; v += 4.5) {
        if (inBand(v)) continue;
        items.push([c, v, 0]);
        items.push([v, c, Math.PI / 2]);
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 2.2), new THREE.MeshBasicMaterial({ color: '#d9b64a' }), items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    items.forEach(([x, z, ry], idx) => {
      e.set(-Math.PI / 2, 0, ry, 'YXZ'); q.setFromEuler(e); p.set(x, 0.02, z);
      m.compose(p, q, s); mesh.setMatrixAt(idx, m);
    });
    this.group.add(mesh);
  }

  buildLamps() {
    const pts = [];
    for (let bx = 0; bx < BLOCKS; bx++) for (let bz = 0; bz < BLOCKS; bz++) {
      const x0 = blockMin(bx) + 0.7, x1 = blockMax(bx) - 0.7, z0 = blockMin(bz) + 0.7, z1 = blockMax(bz) - 0.7;
      const xa = blockMin(bx) + BLOCK * 0.2, xb = blockMin(bx) + BLOCK * 0.8, za = blockMin(bz) + BLOCK * 0.2, zb = blockMin(bz) + BLOCK * 0.8;
      pts.push([x0, z0], [x1, z0], [x0, z1], [x1, z1], [xa, z0], [xb, z0], [xa, z1], [xb, z1], [x0, za], [x0, zb], [x1, za], [x1, zb]);
    }
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 5), new THREE.MeshLambertMaterial({ color: '#555' }), pts.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: '#ffe9a0' }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z], i) => {
      m.makeTranslation(x, 2.5, z); post.setMatrixAt(i, m);
      m.makeTranslation(x, 5.05, z); head.setMatrixAt(i, m);
    });
    this.group.add(post); this.group.add(head);
  }

  defineLocations() {
    const L = this.locations;
    L.start = curb(3, 2, 's', 0.5);
    L.hospital = curb(2, 7, 's', 0.5);
    L.police = curb(7, 7, 's', 0.5);
    L.respray = { x: this.respray.x, z: this.respray.z };
    L.house = this.mansion ? { ...this.mansion.gate } : curb(9, 0, 's', 0.5); // JULPIE'S HOUSE: the gate, on the street side (map POI)
    L.houseParts = this.mansion || null;
    L.gunShops = Object.entries(GUN_SHOPS).map(([k, name]) => { const [bx, bz] = k.split(',').map(Number); return { name, ...curb(bx, bz, 's', 0.5) }; });
    // car dealers: door on the south curb, three delivery bays in the road in front (see data/dealers.js)
    L.dealers = Object.entries(DEALER_LOTS).map(([k, lot]) => { const [bx, bz] = k.split(',').map(Number); return { id: lot.id, name: lot.name, ...curb(bx, bz, 's', 0.5), bays: DEALER_BAYS.map((t) => park(bx, bz, 's', t)) }; });
    // keep random street parking out of the delivery bays
    this.parkingSpots = this.parkingSpots.filter((sp) => !L.dealers.some((d) => d.bays.some((b) => Math.hypot(b.x - sp.x, b.z - sp.z) < 9)));
    this.phoneSpots = [
      { boss: 'cinelli', ...curb(4, 3, 'w', 0.5) }, { boss: 'cinelli', ...curb(3, 5, 'n', 0.5) },
      { boss: 'crows', ...curb(8, 4, 's', 0.3) }, { boss: 'crows', ...curb(7, 6, 'e', 0.5) },
      { boss: 'mal', ...curb(1, 3, 'e', 0.5) }, { boss: 'mal', ...curb(2, 1, 's', 0.5) },
    ];
    L.pickups = [
      { type: 'pistol', ...curb(3, 2, 's', 0.7) }, { type: 'uzi', ...center(1, 1, 8, -8) }, { type: 'shotgun', ...curb(6, 6, 'n', 0.5) },
      { type: 'rocket', ...center(8, 8, -8, 8) }, { type: 'rocket', ...center(0, 5, 6, 6) }, { type: 'health', ...curb(2, 7, 's', 0.3) },
      { type: 'armor', ...curb(7, 7, 's', 0.7) }, { type: 'uzi', ...curb(8, 2, 'w', 0.5) }, { type: 'shotgun', ...curb(1, 8, 'e', 0.5) },
      { type: 'health', ...curb(5, 5, 'e', 0.5) }, { type: 'armor', ...center(6, 1, 0, 0) }, { type: 'pistol', ...curb(8, 5, 'n', 0.5) },
      { type: 'uzi', ...center(4, 2, 0, 0) }, { type: 'health', ...curb(2, 5, 'w', 0.5) }, { type: 'shotgun', ...center(8, 9, 0, 0) },
      { type: 'sword', ...curb(7, 3, 's', 0.5) }, { type: 'grenade', ...curb(4, 7, 'n', 0.5) }, { type: 'grenade', ...curb(1, 3, 'e', 0.5) },
    ];
  }
}
