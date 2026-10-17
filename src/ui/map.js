import { HALF, BLOCK, SPECIAL, blockMin, roadCoord } from '../world/city.js';
import { GANGS } from '../data/gangs.js';
import { K, PAD, COL, LEGEND, drawIcon, drawWorldMarkers, collectPois } from './minimap.js';

const $ = (id) => document.getElementById(id);

/** Names for the SPECIAL blocks that get a text label (hospital / police / respray / gun shops are POIs and label themselves). */
const PLACE_NAMES = {
  park: 'PARK', station: 'STATION', bank: 'BANK', courthouse: 'COURTHOUSE', scrapyard: 'SCRAPYARD',
  marina: 'MARINA', garage: 'GARAGE', chapel: 'CHAPEL',
};
const EXTENT = 2 * HALF + 124;       // metres fitted into the view at zoom 1
const MIN_Z = 1, MAX_Z = 7;
const LEGEND_TIPS = {
  phone: 'Payphone. A pulsing ring means it is ringing: go and answer it.',
  mission: 'Pulsing yellow ring: your current objective.',
  gang: 'Gang members, in their gang colour.',
  job: 'Vehicle job pickup.',
  house: "Julpie's mansion in the north-east corner: the end of the campaign.",
  contact: 'Street contact with work for you.',
};

/**
 * Full-screen city map (mouse + touch). Opening sets game.state = 'map' (world frozen, still
 * rendered), releases the pointer lock and hides the touch layer; closing restores everything.
 * Shares its icons and static city layer with the minimap.
 */
export class MapOverlay {
  constructor(game) {
    this.game = game;
    this.root = $('map');
    this.view = $('map-view');
    this.canvas = $('map-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.isOpen = false;
    this.raf = 0;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.cx = 0; this.cz = 0; this.zoom = 1;
    this.pois = [];
    this.drag = null;
    this.moved = false;
    this.legendBuilt = false;
    if (!this.root || !this.ctx) return;

    $('map-close').addEventListener('click', () => this.close());
    $('map-zin').addEventListener('click', () => this.zoomBy(1.5));
    $('map-zout').addEventListener('click', () => this.zoomBy(1 / 1.5));
    $('map-me').addEventListener('click', () => this.focusPlayer());
    $('map-fit').addEventListener('click', () => this.fit());
    // tapping the dim backdrop (outside the frame) closes it, like the shop dialog
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });

    // drag to pan, wheel to zoom (pointer events cover mouse, pen and touch)
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      cv.classList.add('drag');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const s = this.scale();
      this.cx -= (e.clientX - this.drag.x) / s; this.cz -= (e.clientY - this.drag.y) / s;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.clampCenter();
    });
    const up = (e) => { if (this.drag && e.pointerId === this.drag.id) { this.drag = null; cv.classList.remove('drag'); } };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.isOpen) this.sizeCanvas(); });

    // the minimap itself is the other way in. mousedown is swallowed so the click does not also
    // re-grab the pointer lock (which would fight the exitLock in open()).
    const mm = game.minimap && game.minimap.canvas;
    if (mm) {
      mm.addEventListener('mousedown', (e) => e.stopPropagation());
      mm.addEventListener('click', (e) => { e.stopPropagation(); this.open(); });
    }
    // touch: #touch sits above the HUD, so catch taps that land on the minimap before the touch zone does
    document.addEventListener('touchstart', (e) => {
      if (this.isOpen || !mm || game.state !== 'playing' || game.paused) return;
      const r = mm.getBoundingClientRect();
      for (const t of e.changedTouches) {
        if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) {
          e.preventDefault(); e.stopPropagation();
          this.open();
          return;
        }
      }
    }, { capture: true, passive: false });
    // if the browser hands the pointer lock back while the map is up, drop it again
    document.addEventListener('pointerlockchange', () => { if (this.isOpen && document.pointerLockElement) game.input.exitLock(); });
  }

  // ---- open / close ---------------------------------------------------------
  bindSave() {
    const b = document.getElementById('map-save');
    if (b && !b._bound) { b._bound = true; b.addEventListener('click', () => this.game.openSaveDialog()); }
  }
  open() {
    this.bindSave();
    const g = this.game;
    if (this.isOpen || !this.ctx || g.state !== 'playing' || g.paused || !g.player || g.player.dead || (g.interiors && g.interiors.active)) return;
    this.isOpen = true;
    g.state = 'map';
    g.combat && g.combat.stopFlame();
    g.audio.setEngine(false, 0);
    g.audio.setSiren(0);
    g.hud.setPrompt('');
    g.hud.setCrosshair(false);
    g.hud.setClickToAim(false);
    g.input.exitLock();
    if (g.touch) { g.touch.setMode(g.mode); const t = $('touch'); if (t) t.style.display = 'none'; }
    this.pois = collectPois(g);
    if (!this.legendBuilt) this.buildLegend();
    this.root.style.display = 'flex';
    this.sizeCanvas();
    this.fit();
    this.refreshObjective();
    g.audio.resume();
    const loop = () => { if (!this.isOpen) return; this.draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    const g = this.game;
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
    this.drag = null;
    this.root.style.display = 'none';
    g.state = 'playing';
    if (g.touch) { const t = $('touch'); if (t) t.style.display = 'block'; }
    g.hud.setCrosshair(g.mode === 'foot');
    g.last = performance.now();
    if (g.mode === 'foot') g.input.requestLock();
  }

  // ---- view -----------------------------------------------------------------
  sizeCanvas() {
    const r = this.view.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(50, Math.round(r.width)); this.H = Math.max(50, Math.round(r.height));
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.clampCenter();
  }
  fitScale() { return Math.min(this.W, this.H) / EXTENT; }
  scale() { return this.fitScale() * this.zoom; }
  clampCenter() {
    const L = HALF + 30;
    this.cx = Math.max(-L, Math.min(L, this.cx));
    this.cz = Math.max(-L, Math.min(L, this.cz));
  }
  fit() { this.zoom = 1; this.cx = 0; this.cz = 0; }
  focusPlayer() {
    const pl = this.game.player; if (!pl) return;
    const p = pl.worldPos();
    this.zoom = Math.max(this.zoom, 3.2); this.cx = p.x; this.cz = p.z; this.clampCenter();
  }
  /** Zoom by factor f about a view point (default: the centre). */
  zoomBy(f, px = this.W / 2, py = this.H / 2) {
    const s0 = this.scale();
    const wx = this.cx + (px - this.W / 2) / s0, wz = this.cz + (py - this.H / 2) / s0;
    this.zoom = Math.max(MIN_Z, Math.min(MAX_Z, this.zoom * f));
    const s1 = this.scale();
    this.cx = wx - (px - this.W / 2) / s1; this.cz = wz - (py - this.H / 2) / s1;
    this.clampCenter();
  }
  /** World -> view pixel (css px). Exposed for tests. */
  worldToView(x, z) { const s = this.scale(); return { x: this.W / 2 + (x - this.cx) * s, y: this.H / 2 + (z - this.cz) * s }; }

  // ---- sidebar ----------------------------------------------------------------
  refreshObjective() {
    const g = this.game, el = $('map-obj-text');
    const txt = g.hud && g.hud.el && g.hud.el.objectiveText ? g.hud.el.objectiveText.textContent : '';
    const cur = g.missions && g.missions.current;
    const title = cur && (cur.title || cur.name);
    el.textContent = txt ? (title ? title + ': ' : '') + txt : 'No active objective. Answer a ringing payphone.';
    el.classList.toggle('none', !txt);
  }

  buildLegend() {
    this.legendBuilt = true;
    const list = $('map-legend');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const it of LEGEND) {
      const row = document.createElement('div');
      row.className = 'lg-row';
      if (LEGEND_TIPS[it.kind]) row.title = LEGEND_TIPS[it.kind];
      const c = document.createElement('canvas');
      const w = it.kind === 'gang' ? 40 : 26, h = 26;
      c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const st = { t: 0, pulse: 0.2, yaw: 0 };
      if (it.kind === 'gang') {
        let i = 0;
        for (const id in GANGS) { st.color = GANGS[id].color; drawIcon(g, 'gang', 7 + i * 13, 13, 7.5, st); i++; }
      } else if (it.kind === 'phone') {
        st.ringing = true; drawIcon(g, 'phone', 13, 13, 7.5, st);
      } else drawIcon(g, it.kind, 13, 13, it.kind === 'mission' ? 8 : 7.5, st);
      const t = document.createElement('span');
      t.textContent = it.label;
      row.append(c, t);
      list.appendChild(row);
    }
    const turf = $('map-turf');
    for (const id in GANGS) {
      const gg = GANGS[id];
      const row = document.createElement('div');
      row.className = 'turf-row';
      const sw = document.createElement('i'); sw.style.background = gg.color;
      const t = document.createElement('span'); t.textContent = `${gg.name} (${gg.zone})`;
      row.append(sw, t);
      turf.appendChild(row);
    }
  }

  // ---- drawing ----------------------------------------------------------------
  draw() {
    const ctx = this.ctx, g = this.game, mm = g.minimap, pl = g.player;
    if (!mm || !mm.base || !pl) return;
    const W = this.W, H = this.H, dpr = this.dpr, s = this.scale();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.water; ctx.fillRect(0, 0, W, H);

    // static city layer, clipped to the bitmap bounds
    const k = s * dpr > 1.05 ? K : 1;
    const layer = k === K ? mm.base : mm.mip;
    const wx0 = this.cx - W / 2 / s, wz0 = this.cz - H / 2 / s, ww = W / s, wh = H / s;
    const b0 = -HALF - PAD, b1 = HALF + PAD;
    const ix0 = Math.max(wx0, b0), ix1 = Math.min(wx0 + ww, b1), iz0 = Math.max(wz0, b0), iz1 = Math.min(wz0 + wh, b1);
    if (ix1 > ix0 && iz1 > iz0) {
      ctx.imageSmoothingEnabled = s * dpr < K; ctx.imageSmoothingQuality = 'high';   // crisp pixels when zoomed past the 2 px/m bitmap
      ctx.drawImage(layer, (ix0 - b0) * k, (iz0 - b0) * k, (ix1 - ix0) * k, (iz1 - iz0) * k,
        (ix0 - wx0) * s, (iz0 - wz0) * s, (ix1 - ix0) * s, (iz1 - iz0) * s);
    }
    const sx = (x) => W / 2 + (x - this.cx) * s, sy = (z) => H / 2 + (z - this.cz) * s;
    const m = 40;
    const near = (x, z) => { const px = sx(x), py = sy(z); return px > -m && px < W + m && py > -m && py < H + m; };

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const label = (txt, x, y, size, fill, alpha = 1) => {
      ctx.font = `bold ${size}px Oswald, Arial, sans-serif`;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(3, size * 0.28); ctx.strokeStyle = 'rgba(0,0,0,0.88)'; ctx.strokeText(txt, x, y);
      ctx.fillStyle = fill; ctx.fillText(txt, x, y);
      ctx.globalAlpha = 1;
    };

    // gang territory names, on the road along the top of each turf (keeps them off the buildings and icons)
    for (const id in GANGS) {
      const gg = GANGS[id], r = gg.blocks[0];
      const x = (blockMin(r.x0) + blockMin(r.x1) + BLOCK) / 2, z = roadCoord(r.z0);
      if (!near(x, z)) continue;
      label(gg.name.toUpperCase(), sx(x), sy(z), 15, gg.color, 0.97);
    }
    // named places
    for (const key in SPECIAL) {
      const name = PLACE_NAMES[SPECIAL[key]];
      if (!name) continue;
      const [bx, bz] = key.split(',').map(Number);
      const x = blockMin(bx) + BLOCK / 2, z = blockMin(bz) + BLOCK / 2;
      if (!near(x, z)) continue;
      label(name, sx(x), sy(z), 11, SPECIAL[key] === 'park' ? '#b8f0b0' : '#e8ebf2', 0.92);
    }

    // markers (same drawer as the minimap, larger glyphs, never clamped to an edge)
    const u = 9.5;
    drawWorldMarkers(ctx, g, this.pois, { sx, sy, near, clamp: (px, py) => [px, py, false], u });
    for (const p of this.pois) if (near(p.x, p.z) && p.name) label(p.name, sx(p.x), sy(p.z) + u + 8, 10.5, '#ffffff', 1);

    // the player, with a ring so the arrow is easy to find
    const pp = pl.worldPos(), px = sx(pp.x), py = sy(pp.z);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
    ctx.strokeStyle = `rgba(255,255,255,${0.75 - pulse * 0.55})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, u + 5 + pulse * 6, 0, Math.PI * 2); ctx.stroke();
    drawIcon(ctx, 'player', px, py, u + 1, { yaw: pl.vehicle ? pl.vehicle.yaw : pl.ped.yaw });

    // compass
    label('N', W - 22, 22, 15, '#ffe066');
  }
}
