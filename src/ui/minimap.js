import { HALF, BLOCKS, BLOCK, ROAD, P, SPECIAL, blockMin, roadCoord } from '../world/city.js';
import { GANGS } from '../data/gangs.js';

/**
 * Circular north-up minimap. World x -> canvas x, world z -> canvas y (north is -z, i.e. up).
 *
 * The city is rendered ONCE into an offscreen canvas (2 px/m, with a water margin so the window
 * never leaves the bitmap) plus a 1 px/m mip of it. Each frame draws a window of that bitmap
 * centred on the player (VIEW metres across) inside a circular clip, then a few dozen markers.
 */
export const K = 2;                 // static layer px per metre
export const PAD = 180;             // metres of water margin around the city (> VIEW / 2)
const VIEW = 345;            // metres shown across the map diameter
export const COL = {
  water: '#1b3f5f', wall: '#8c8c84', road: '#3a3b40', lane: 'rgba(210,180,80,0.28)', block: '#5b5d62',
  park: '#3d7a3f', bld: '#8a8e97', bldTall: '#a9aeb9', hospital: '#f4f4f4', police: '#3b6fe0', respray: '#f1c40f',
  shop: '#ff8a1f', cop: '#4d8dff', phone: '#9a9a9a', ring: '#ffe066',
};


// ---------------------------------------------------------------------------------------------
// Shared icon library (minimap + full-screen map + legend). Every glyph is drawn at constant
// screen size with a dark outline so it reads against any ground. r = half-size in css px.
// ---------------------------------------------------------------------------------------------
const OUT = '#06070b';
const FONT = 'Arial, Helvetica, sans-serif';

/** Legend order: {kind, label}. Kinds match drawIcon(). */
export const LEGEND = [
  { kind: 'player', label: 'You' },
  { kind: 'phone', label: 'Payphone' },
  { kind: 'shop', label: 'Gun shop' },
  { kind: 'dealer', label: 'Car dealer' },
  { kind: 'respray', label: 'Respray' },
  { kind: 'hospital', label: 'Hospital' },
  { kind: 'police', label: 'Police HQ' },
  { kind: 'house', label: "Julpie's House" },
  { kind: 'mission', label: 'Mission' },
  { kind: 'contact', label: 'Street contact' },
  { kind: 'frenzy', label: 'Frenzy' },
  { kind: 'race', label: 'Race' },
  { kind: 'job', label: 'Vehicle job' },
  { kind: 'cop', label: 'Cop' },
  { kind: 'pcar', label: 'Police car' },
  { kind: 'gang', label: 'Gang member' },
];

/** Names for the fixed locations that have none in city.locations. */
export const POI_NAMES = { hospital: 'HARLOW GENERAL', police: 'POLICE HQ', respray: 'HARLOW RESPRAY', house: "JULPIE'S HOUSE" };

function rr(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y); ctx.lineTo(x + w - rad, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad); ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y); ctx.closePath();
}
function glyph(ctx, ch, x, y, r, color) {
  ctx.font = `bold ${(r * 1.45).toFixed(1)}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(ch, x, y + r * 0.08);
}
function badge(ctx, x, y, r, fill, lw) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
}

/**
 * Draw one icon centred at (x, y). st = { t: ms, pulse: 0..1, ringing, color, yaw, edge }.
 * 'player' and 'pcar' are rotated by st.yaw (forward = (sin yaw, cos yaw); screen y grows with +z).
 */
export function drawIcon(ctx, kind, x, y, r, st = {}) {
  const lw = Math.max(1.4, r * 0.24);
  const pulse = st.pulse || 0;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  switch (kind) {
    case 'phone': {
      if (st.ringing) {
        ctx.strokeStyle = `rgba(255,224,102,${0.9 - pulse * 0.75})`; ctx.lineWidth = lw * 1.2;
        ctx.beginPath(); ctx.arc(x, y, r * 1.25 + pulse * r * 1.1, 0, Math.PI * 2); ctx.stroke();
      }
      rr(ctx, x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.3);
      ctx.fillStyle = st.ringing ? '#fff3a6' : '#ffd21f'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      glyph(ctx, 'P', x, y, r, '#1a1400');
      break;
    }
    case 'shop':
      badge(ctx, x, y, r, '#ff8a1f', lw); glyph(ctx, '$', x, y, r, '#1e0d00');
      break;
    case 'dealer': {
      badge(ctx, x, y, r, '#19c6e6', lw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(0.8, lw * 0.45);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.68, y + r * 0.34); ctx.lineTo(x - r * 0.68, y + r * 0.02); ctx.lineTo(x - r * 0.4, y - r * 0.08);
      ctx.lineTo(x - r * 0.22, y - r * 0.42); ctx.lineTo(x + r * 0.26, y - r * 0.42); ctx.lineTo(x + r * 0.46, y - r * 0.08);
      ctx.lineTo(x + r * 0.68, y + r * 0.02); ctx.lineTo(x + r * 0.68, y + r * 0.34); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = OUT;
      ctx.beginPath(); ctx.arc(x - r * 0.38, y + r * 0.36, r * 0.18, 0, Math.PI * 2); ctx.arc(x + r * 0.38, y + r * 0.36, r * 0.18, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'respray': {
      badge(ctx, x, y, r, '#e040c8', lw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(0.8, lw * 0.45);
      ctx.beginPath(); ctx.rect(x - r * 0.3, y - r * 0.12, r * 0.55, r * 0.72); ctx.fill(); ctx.stroke();
      ctx.fillStyle = OUT; ctx.fillRect(x - r * 0.22, y - r * 0.42, r * 0.4, r * 0.3);
      ctx.fillStyle = '#fff';
      for (const [dx, dy] of [[0.48, -0.36], [0.62, -0.18], [0.5, 0.0]]) { ctx.beginPath(); ctx.arc(x + r * dx, y + r * dy, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'hospital': {
      rr(ctx, x - r * 0.92, y - r * 0.92, r * 1.84, r * 1.84, r * 0.25);
      ctx.fillStyle = '#f7f7f7'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.fillStyle = '#e0302a';
      ctx.fillRect(x - r * 0.58, y - r * 0.2, r * 1.16, r * 0.4); ctx.fillRect(x - r * 0.2, y - r * 0.58, r * 0.4, r * 1.16);
      break;
    }
    case 'police': {
      ctx.beginPath();
      ctx.moveTo(x - r * 0.85, y - r * 0.9); ctx.lineTo(x + r * 0.85, y - r * 0.9); ctx.lineTo(x + r * 0.85, y + r * 0.1);
      ctx.quadraticCurveTo(x + r * 0.8, y + r * 0.7, x, y + r); ctx.quadraticCurveTo(x - r * 0.8, y + r * 0.7, x - r * 0.85, y + r * 0.1);
      ctx.closePath();
      ctx.fillStyle = '#2f6bff'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.2 : r * 0.46; ctx.lineTo(x + Math.cos(a) * rad, y - r * 0.06 + Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'house': { // Julpie's mansion: pink badge with a white house
      badge(ctx, x, y, r, '#ff4fa3', lw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(0.8, lw * 0.45);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.72, y - r * 0.04); ctx.lineTo(x, y - r * 0.68); ctx.lineTo(x + r * 0.72, y - r * 0.04); ctx.lineTo(x + r * 0.5, y - r * 0.04);
      ctx.lineTo(x + r * 0.5, y + r * 0.58); ctx.lineTo(x - r * 0.5, y + r * 0.58); ctx.lineTo(x - r * 0.5, y - r * 0.04); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff4fa3'; ctx.fillRect(x - r * 0.14, y + r * 0.14, r * 0.28, r * 0.44);
      break;
    }
    case 'mission': {
      const rad = (st.edge ? 0.8 : 1) * r * (0.95 + pulse * 0.3);
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.lineWidth = lw * 1.9 + 2; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.lineWidth = lw * 1.9; ctx.strokeStyle = '#ffe066'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = st.color || '#ffe066'; ctx.fill(); ctx.lineWidth = Math.max(1, lw * 0.5); ctx.strokeStyle = OUT; ctx.stroke();
      break;
    }
    case 'contact':
      badge(ctx, x, y, r, '#3ddc84', lw); glyph(ctx, '!', x, y, r, '#04200f');
      break;
    case 'frenzy': {
      badge(ctx, x, y, r, '#ff3b30', lw);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.4, r * 0.28);
      ctx.beginPath(); ctx.moveTo(x - r * 0.42, y - r * 0.42); ctx.lineTo(x + r * 0.42, y + r * 0.42); ctx.moveTo(x + r * 0.42, y - r * 0.42); ctx.lineTo(x - r * 0.42, y + r * 0.42); ctx.stroke();
      break;
    }
    case 'race': {
      const q = r * 0.62;
      ctx.save(); rr(ctx, x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.2); ctx.clip();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        ctx.fillRect(x - r * 0.93 + i * q, y - r * 0.93 + j * q, q + 0.5, q + 0.5);
      }
      ctx.restore();
      rr(ctx, x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.2); ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      break;
    }
    case 'job': {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      rr(ctx, -r * 0.72, -r * 0.72, r * 1.44, r * 1.44, r * 0.2);
      ctx.fillStyle = '#a6e22e'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.restore();
      ctx.fillStyle = OUT; ctx.beginPath();
      ctx.moveTo(x - r * 0.3, y - r * 0.38); ctx.lineTo(x + r * 0.42, y); ctx.lineTo(x - r * 0.3, y + r * 0.38); ctx.closePath(); ctx.fill();
      break;
    }
    case 'cop':
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.4, r * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = '#4d8dff'; ctx.fill(); ctx.lineWidth = Math.max(1, lw * 0.45); ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.stroke();
      break;
    case 'gang':
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.2, r * (st.boss ? 0.5 : 0.38)), 0, Math.PI * 2);
      ctx.fillStyle = st.color || '#bbb'; ctx.fill(); ctx.lineWidth = Math.max(1, lw * 0.45); ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.stroke();
      break;
    case 'pcar': {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI - (st.yaw || 0));
      const w = r * 0.42, h = r * 0.78;
      ctx.fillStyle = '#4d8dff'; ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, lw * 0.5);
      ctx.fillRect(-w, -h, w * 2, h * 2); ctx.strokeRect(-w, -h, w * 2, h * 2);
      ctx.fillStyle = ((st.t || 0) % 400 < 200) ? '#ff4a4a' : '#fff'; ctx.fillRect(-w * 0.6, -h * 0.25, w * 1.2, h * 0.5);
      ctx.restore();
      break;
    }
    case 'player': {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI - (st.yaw || 0));
      const k = r / 6.5;
      ctx.beginPath(); ctx.moveTo(0, -6.5 * k); ctx.lineTo(4.6 * k, 5 * k); ctx.lineTo(0, 2.6 * k); ctx.lineTo(-4.6 * k, 5 * k); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1.6, 1.6 * k); ctx.stroke(); ctx.fill();
      ctx.restore();
      break;
    }
    default: break;
  }
}

/** Static POIs (hospital, police, respray, gun shops, dealers) with display names. */
export function collectPois(game) {
  const L = (game.city && game.city.locations) || {};
  const out = [];
  if (L.hospital) out.push({ x: L.hospital.x, z: L.hospital.z, kind: 'hospital', name: POI_NAMES.hospital });
  if (L.police) out.push({ x: L.police.x, z: L.police.z, kind: 'police', name: POI_NAMES.police });
  if (L.respray) out.push({ x: L.respray.x, z: L.respray.z, kind: 'respray', name: POI_NAMES.respray });
  if (L.house) out.push({ x: L.house.x, z: L.house.z, kind: 'house', name: POI_NAMES.house });
  if (Array.isArray(L.gunShops)) for (const s of L.gunShops) out.push({ x: s.x, z: s.z, kind: 'shop', name: s.name });
  if (Array.isArray(L.dealers)) for (const d of L.dealers) out.push({ x: d.x, z: d.z, kind: 'dealer', name: d.name });
  return out;
}

/** Street contacts / frenzies / races / jobs from the optional T10 systems ([{x,z,kind}], read defensively). */
export function extraMarkers(game) {
  const out = [];
  for (const sys of [game.jobs, game.activities]) {
    if (!sys || typeof sys.markers !== 'function') continue;
    let list;
    try { list = sys.markers(); } catch (e) { continue; }
    if (!Array.isArray(list)) continue;
    for (const m of list) if (m && Number.isFinite(m.x) && Number.isFinite(m.z)) out.push(m);
  }
  return out;
}

/**
 * Draw every world marker except the player. tf = { sx(x), sy(z), near(x,z), clamp(px,py) -> [x,y,edge], u }
 * where u is the icon half-size in css px.
 */
export function drawWorldMarkers(ctx, game, pois, tf) {
  const now = performance.now();
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
  const r = tf.u;
  const st = { t: now, pulse };

  for (const p of pois) if (tf.near(p.x, p.z)) drawIcon(ctx, p.kind, tf.sx(p.x), tf.sy(p.z), r, st);

  for (const m of extraMarkers(game)) {
    if (!tf.near(m.x, m.z)) continue;
    const kind = m.kind === 'frenzy' || m.kind === 'race' || m.kind === 'job' ? m.kind : 'contact';
    drawIcon(ctx, kind, tf.sx(m.x), tf.sy(m.z), r, st);
  }

  // people: cops (blue) and gang members (their colour)
  const gcol = (id) => (GANGS[id] && GANGS[id].color) || '#bbb';
  const pl = game.player;
  for (const pd of game.peds) {
    if (pd.dead || pd.remove || (pl && pd === pl.ped)) continue;
    const kind = pd.kind;
    if (kind !== 'cop' && kind !== 'gang') continue;
    if (!tf.near(pd.pos.x, pd.pos.z)) continue;
    st.color = kind === 'gang' ? gcol(pd.gang) : null; st.boss = !!pd.boss;
    drawIcon(ctx, kind, tf.sx(pd.pos.x), tf.sy(pd.pos.z), r, st);
  }
  st.boss = false; st.color = null;

  for (const v of game.vehicles) {
    if (v.typeKey !== 'police' || v.wrecked || v.removed || !v.hasDriver) continue;
    if (!tf.near(v.pos.x, v.pos.z)) continue;
    st.yaw = v.yaw;
    drawIcon(ctx, 'pcar', tf.sx(v.pos.x), tf.sy(v.pos.z), r, st);
  }

  // payphones (ringing ones pulse and stick to the rim when off the map), drawn above people
  for (const ph of game.phones) {
    if (!ph.ringing) {
      if (!tf.near(ph.x, ph.z)) continue;
      drawIcon(ctx, 'phone', tf.sx(ph.x), tf.sy(ph.z), r, st);
      continue;
    }
    const [x, y, edge] = tf.clamp(tf.sx(ph.x), tf.sy(ph.z));
    st.ringing = true;
    drawIcon(ctx, 'phone', x, y, edge ? r * 0.85 : r, st);
    st.ringing = false;
  }

  // mission objective: pulsing yellow ring, kept on the rim when far away
  const mp = game.missions && game.missions.markerPos();
  if (mp && pl && !pl.dead) {
    const [x, y, edge] = tf.clamp(tf.sx(mp.x), tf.sy(mp.z));
    const mt = game.missions.markerTarget;
    st.edge = edge; st.color = mt && mt.kind ? '#e5322d' : '#ffe066';
    drawIcon(ctx, 'mission', x, y, r, st);
    st.edge = false; st.color = null;
  }
}

export class Minimap {
  /** @param game Game instance (needs city, player, phones, peds, vehicles, wanted, missions) */
  constructor(game, canvas = document.getElementById('minimap')) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.size = 190;
    this.dpr = 1;
    this.base = null;       // 2 px/m static layer
    this.mip = null;        // 1 px/m copy for the usual (downscaled) view
    this.pois = [];
    this.iconR = 6.5;
    this._dealerCount = 0;
    this.renderStatic();
    this.buildPois();
    this.resize();
  }

  /** World -> static-layer pixel (2 px/m). Exposed for tests. */
  worldToStatic(x, z) { return { x: (x + HALF + PAD) * K, y: (z + HALF + PAD) * K }; }

  /** Re-read the CSS size (190 desktop / 150 touch) and rebuild the backing store. Call on window resize. */
  resize() {
    if (!this.canvas) return;
    const css = this.canvas.clientWidth || (document.body.classList.contains('touch') ? 150 : 190);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (css === this.size && dpr === this.dpr && this.canvas.width === Math.round(css * dpr)) return;
    this.size = css; this.dpr = dpr;
    this.canvas.width = this.canvas.height = Math.round(css * dpr);
    this.iconR = Math.max(5, Math.min(7, 6.5 * css / 190));
  }

  /** Static points of interest drawn as glyphs at constant screen size (hospital, police, respray, gun shops, dealers). */
  buildPois() {
    this.pois = collectPois(this.game);
    const L = this.game.city.locations || {};
    this._dealerCount = Array.isArray(L.dealers) ? L.dealers.length : 0;
  }

  // ---- static layer ---------------------------------------------------------
  renderStatic() {
    const city = this.game.city;
    const S = Math.ceil((2 * HALF + 2 * PAD) * K);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const X = (x) => (x + HALF + PAD) * K;
    const rect = (x0, z0, x1, z1) => g.fillRect(X(x0), X(z0), (x1 - x0) * K, (z1 - z0) * K);

    g.fillStyle = COL.water; g.fillRect(0, 0, S, S);
    g.fillStyle = COL.wall; rect(-HALF - 1.2, -HALF - 1.2, HALF + 1.2, HALF + 1.2);
    g.fillStyle = COL.road; rect(-HALF, -HALF, HALF, HALF);

    // lane lines down the middle of every road
    g.strokeStyle = COL.lane; g.lineWidth = 1; g.setLineDash([6, 8]);
    g.beginPath();
    for (let i = 0; i <= BLOCKS; i++) {
      const v = X(roadCoord(i));
      g.moveTo(v, X(-HALF)); g.lineTo(v, X(HALF));
      g.moveTo(X(-HALF), v); g.lineTo(X(HALF), v);
    }
    g.stroke(); g.setLineDash([]);

    // blocks (sidewalk slabs), parks, special tints
    const special = (bx, bz) => SPECIAL[`${bx},${bz}`];
    const tint = { hospital: COL.hospital, police: COL.police, respray: COL.respray };
    for (let bx = 0; bx < BLOCKS; bx++) for (let bz = 0; bz < BLOCKS; bz++) {
      const sp = special(bx, bz);
      g.fillStyle = sp === 'park' ? COL.park : COL.block;
      rect(blockMin(bx), blockMin(bz), blockMin(bx) + BLOCK, blockMin(bz) + BLOCK);
    }

    // gang territories: translucent tint over blocks and the roads between them
    for (const id in GANGS) {
      const gg = GANGS[id];
      g.fillStyle = gg.color; g.globalAlpha = 0.18;
      for (const r of gg.blocks) {
        rect(blockMin(r.x0) - ROAD / 2, blockMin(r.z0) - ROAD / 2, blockMin(r.x1) + BLOCK + ROAD / 2, blockMin(r.z1) + BLOCK + ROAD / 2);
      }
      g.globalAlpha = 1;
    }

    // buildings: every static box tall enough to be a building (skips crates, trees, phone booths)
    for (const b of city.boxes) {
      if (b.h < 4) continue;
      const bx = Math.floor(((b.x0 + b.x1) / 2 + HALF - ROAD) / P), bz = Math.floor(((b.z0 + b.z1) / 2 + HALF - ROAD) / P);
      const sp = special(bx, bz);
      g.fillStyle = tint[sp] || (b.h > 28 ? COL.bldTall : COL.bld);
      rect(b.x0, b.z0, b.x1, b.z1);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
      g.strokeRect(X(b.x0) + 0.5, X(b.z0) + 0.5, (b.x1 - b.x0) * K - 1, (b.z1 - b.z0) * K - 1);
    }

    this.base = c;
    const m = document.createElement('canvas');
    m.width = m.height = S >> 1;
    const mg = m.getContext('2d');
    mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'high';
    mg.drawImage(c, 0, 0, m.width, m.height);
    this.mip = m;
  }

  // ---- per frame ------------------------------------------------------------
  update() {
    const ctx = this.ctx, game = this.game, pl = game.player;
    if (!ctx || !pl || !this.base) return;
    if (game.interiors && game.interiors.active) { game.interiors.drawMinimap(this); return; } // flat room outline instead of the city
    const size = this.size, dpr = this.dpr, c = size / 2, R = c - 1.5;
    const s = size / VIEW;                       // css px per metre
    const pp = pl.worldPos();
    const now = performance.now();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();

    // static window (mip when it is being downscaled anyway)
    const k = s * dpr > 1.05 ? K : 1;
    const layer = k === K ? this.base : this.mip;
    const half = VIEW / 2;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(layer, (pp.x + HALF + PAD - half) * k, (pp.z + HALF + PAD - half) * k, VIEW * k, VIEW * k, 0, 0, size, size);

    // world -> screen
    const sx = (x) => c + (x - pp.x) * s, sy = (z) => c + (z - pp.z) * s;
    const lim = (VIEW / 2) * 1.08;
    const near = (x, z) => Math.abs(x - pp.x) < lim && Math.abs(z - pp.z) < lim;
    const rim = R - 6;
    const clampRim = (px, py) => {      // pull a point back inside the rim ring
      const dx = px - c, dy = py - c, d = Math.hypot(dx, dy);
      return d > rim ? [c + dx / d * rim, c + dy / d * rim, true] : [px, py, false];
    };

    // glyphs: POIs, contacts/jobs, people, police cars, payphones, mission marker
    const L = game.city.locations || {};
    if ((Array.isArray(L.dealers) ? L.dealers.length : 0) !== this._dealerCount) this.buildPois();
    drawWorldMarkers(ctx, game, this.pois, { sx, sy, near, clamp: clampRim, u: this.iconR });

    // the player: white arrow pointing the way they face (car yaw when driving)
    drawIcon(ctx, 'player', c, c, this.iconR, { yaw: pl.vehicle ? pl.vehicle.yaw : pl.ped.yaw });

    ctx.restore(); // end clip

    // border (flashes red/blue while the cops are after you), then the N
    const hot = game.wanted && game.wanted.level > 0;
    ctx.lineWidth = 3; ctx.strokeStyle = hot ? ((now % 700 < 350) ? '#e5322d' : '#3b82f6') : '#0b0b0b';
    ctx.beginPath(); ctx.arc(c, c, c - 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,224,102,0.8)';
    ctx.beginPath(); ctx.arc(c, c, c - 3.5, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 10px Oswald, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('N', c, 12);
    ctx.fillStyle = '#fff'; ctx.fillText('N', c, 12);
  }
}
