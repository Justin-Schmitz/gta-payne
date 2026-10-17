import * as THREE from 'three';
import { choice, dist } from '../util.js';

const MAX = 3;          // shouts on screen at once
const LIFE = 1.5;       // seconds
const GAP = 0.3;        // minimum seconds between two shouts
const RANGE = 55;       // only shout when the player is this close

const LINES = {
  alert: { gang: ['THERE HE IS!', 'GET HIM!', 'OVER HERE!', 'HEY! YOU!'], cop: ['FREEZE!', 'STOP RIGHT THERE!', 'DROP IT!'] },
  hurt: { gang: ['AGH!', "I'M HIT!", 'ARGH!'], cop: ['AGH!', 'OFFICER DOWN!', 'ARGH!'] },
  buddy: { gang: ['THEY GOT HIM!', 'MAN DOWN!', 'NO!'], cop: ['OFFICER DOWN!', 'SHOTS FIRED!', 'NO!'] },
};

/** Small floating enemy shouts (pooled sprites, max 3, 1.5 s each). Cheap: a canvas redraw per shout. */
export class Shouts {
  constructor(game) {
    this.game = game;
    this.pool = [];
    this.gapT = 0;
    for (let i = 0; i < MAX; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(3.4, 0.85, 1);
      sprite.renderOrder = 20;
      sprite.visible = false;
      game.scene.add(sprite);
      this.pool.push({ sprite, canvas, ctx: canvas.getContext('2d'), tex, mat, ped: null, t: 0, text: '' });
    }
  }
  /** Number of shouts currently showing. */
  get active() { let n = 0; for (const s of this.pool) if (s.t > 0) n++; return n; }

  /** Show a shout above `ped` (kind: 'alert' | 'hurt' | 'buddy'). Returns false when skipped (pool full, too soon, too far). */
  say(ped, kind) {
    const g = this.game;
    if (this.gapT > 0 || ped.dead) return false;
    const pp = g.player.worldPos();
    if (dist(ped.pos.x, ped.pos.z, pp.x, pp.z) > RANGE) return false;
    const slot = this.pool.find((s) => s.t <= 0);
    if (!slot) return false;
    const set = LINES[kind] || LINES.alert;
    const text = choice(ped.kind === 'cop' ? set.cop : set.gang);
    this.gapT = GAP;
    slot.ped = ped; slot.t = LIFE; slot.text = text;
    const c = slot.ctx;
    c.clearRect(0, 0, 256, 64);
    c.font = '700 34px Oswald, "Arial Narrow", Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 7; c.strokeStyle = '#000'; c.lineJoin = 'round';
    c.strokeText(text, 128, 34);
    c.fillStyle = kind === 'hurt' ? '#ff9c8a' : ped.kind === 'cop' ? '#9fc5ff' : '#ffe066';
    c.fillText(text, 128, 34);
    slot.tex.needsUpdate = true;
    slot.mat.opacity = 1;
    slot.sprite.visible = true;
    this.place(slot);
    return true;
  }

  /** A hostile died: one living ally of the same kind nearby shouts. */
  onDeath(ped) {
    let best = null, bd = 18;
    for (const p of this.game.peds) {
      if (p === ped || p.dead || p.kind !== ped.kind || p.shoutCd > 0 || p.isPlayer) continue;
      const d = dist(p.pos.x, p.pos.z, ped.pos.x, ped.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) best.shout('buddy');
  }

  place(s) {
    const p = s.ped, age = LIFE - s.t;
    s.sprite.position.set(p.pos.x, (p.y || 0) + (p.knockT > 0 ? 1.2 : 2.35) + age * 0.35, p.pos.z);
  }

  update(raw) {
    if (this.gapT > 0) this.gapT -= raw;
    for (const s of this.pool) {
      if (s.t <= 0) continue;
      s.t -= raw;
      if (s.t <= 0 || !s.ped || s.ped.remove) { s.t = 0; s.sprite.visible = false; s.ped = null; continue; }
      s.mat.opacity = Math.min(1, s.t / 0.4);
      this.place(s);
    }
  }
}
