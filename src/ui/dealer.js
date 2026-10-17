import { fmtMoney } from '../util.js';
import { VEHICLE_TYPES } from '../entities/vehicle.js';
import { DEALERS, stockFor, quote, buy, mph } from '../data/dealers.js';

const $ = (id) => document.getElementById(id);

/**
 * Car dealership modal (mouse + touch), same look as the gun shop. Opening sets game.state = 'dealer'
 * (world frozen, still rendered), releases the pointer lock and hides the touch layer; Esc, CLOSE or a
 * tap on the dim backdrop leaves.
 */
export class Dealer {
  constructor(game) {
    this.game = game;
    this.root = $('dealer');
    this.list = $('dealer-list');
    this.cash = $('dealer-cash');
    this.title = $('dealer-title');
    this.blurb = $('dealer-blurb');
    this.msg = $('dealer-msg');
    this.rows = {};
    this.loc = null;
    this.isOpen = false;
    $('dealer-close').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
  }

  build() {
    this.list.textContent = '';
    this.rows = {};
    for (const key of stockFor(this.loc.id)) {
      const t = VEHICLE_TYPES[key];
      const row = document.createElement('div');
      row.className = 'shop-row dealer-row';
      row.id = 'dealer-row-' + key;
      const info = document.createElement('div');
      info.className = 'shop-info';
      const name = document.createElement('div');
      name.className = 'shop-name';
      name.textContent = t.name;
      const cls = document.createElement('span');
      cls.className = 'dealer-cls';
      cls.textContent = t.cls || '';
      name.appendChild(cls);
      if (t.shopOnly) {
        const tag = document.createElement('span');
        tag.className = 'dealer-tag';
        tag.textContent = 'SHOP ONLY';
        name.appendChild(tag);
      }
      const stats = document.createElement('div');
      stats.className = 'dealer-stats';
      const bar = (cl, label, frac) => {
        const s = document.createElement('span');
        s.className = 'dstat ' + cl;
        const i = document.createElement('i');
        i.style.width = Math.round(Math.max(0.06, Math.min(1, frac)) * 100) + '%';
        const b = document.createElement('b');
        b.textContent = label;
        s.append(i, b);
        return s;
      };
      stats.append(
        bar('spd', `TOP ${mph(t.maxSpeed)} MPH`, t.maxSpeed / 60),
        bar('hp', `TOUGHNESS ${t.hp}`, Math.sqrt(t.hp / 3000)),
      );
      info.append(name, stats);
      const btn = document.createElement('button');
      btn.id = 'dealer-buy-' + key;
      btn.type = 'button';
      btn.dataset.type = key;
      btn.addEventListener('click', () => this.buy(key));
      row.append(info, btn);
      this.list.appendChild(row);
      this.rows[key] = { key, row, btn };
    }
  }

  buy(key) {
    const v = buy(this.game, this.loc, key);
    if (v) {
      const t = VEHICLE_TYPES[key];
      this.msg.textContent = `${t.name} delivered to bay ${v.bay} outside.`;
      this.msg.className = 'ok';
    } else {
      this.msg.textContent = 'Purchase not possible.';
      this.msg.className = 'error';
    }
    this.refresh();
  }

  open(loc) {
    const g = this.game;
    if (this.isOpen || g.state !== 'playing' || g.paused || !loc) return;
    this.isOpen = true;
    this.loc = loc;
    g.state = 'dealer';
    const def = DEALERS[loc.id];
    this.title.textContent = loc.name || (def && def.name) || 'DEALER';
    this.blurb.textContent = def ? def.blurb : '';
    this.msg.textContent = '';
    this.msg.className = '';
    this.build();
    g.combat.stopFlame();
    g.hud.setPrompt('');
    g.hud.setCrosshair(false);
    g.hud.setClickToAim(false);
    g.input.exitLock();
    if (g.touch) { g.touch.setMode(g.mode); const t = $('touch'); if (t) t.style.display = 'none'; }
    this.root.style.display = 'flex';
    this.list.scrollTop = 0;
    this.refresh();
    g.audio.resume();
  }

  close() {
    const g = this.game;
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.style.display = 'none';
    g.state = 'playing';
    if (g.touch) { const t = $('touch'); if (t) t.style.display = 'block'; }
    g.hud.setCrosshair(g.mode === 'foot');
    g.saveGame();
    g.last = performance.now();
    g.input.requestLock();
  }

  refresh() {
    const g = this.game;
    this.cash.textContent = fmtMoney(g.score);
    for (const key in this.rows) {
      const r = this.rows[key];
      const q = quote(g, key);
      r.btn.textContent = `BUY  ${fmtMoney(q.price)}`;
      r.btn.disabled = !q.enabled;
      r.btn.title = q.enabled ? '' : q.reason;
      r.row.classList.toggle('poor', !q.enabled);
    }
  }
}
