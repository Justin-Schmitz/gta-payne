import { fmtMoney } from '../util.js';
import { SHOP_ITEMS, itemName, quote, buy } from '../data/shops.js';

const $ = (id) => document.getElementById(id);

/**
 * Gun-shop modal (mouse + touch). Opening sets game.state = 'shop' (world frozen, still rendered),
 * releases the pointer lock and hides the touch layer; closing restores everything.
 */
export class Shop {
  constructor(game) {
    this.game = game;
    this.root = $('shop');
    this.list = $('shop-list');
    this.cash = $('shop-cash');
    this.title = $('shop-title');
    this.rows = {};
    this.isOpen = false;
    for (const it of SHOP_ITEMS) {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.id = 'shop-row-' + it.id;
      const info = document.createElement('div');
      info.className = 'shop-info';
      const name = document.createElement('div'); name.className = 'shop-name'; name.textContent = itemName(it);
      const sub = document.createElement('div'); sub.className = 'shop-sub';
      info.append(name, sub);
      const btn = document.createElement('button');
      btn.id = 'shop-buy-' + it.id;
      btn.type = 'button';
      btn.dataset.item = it.id;
      btn.addEventListener('click', () => { if (buy(this.game, it.id)) this.refresh(); });
      row.append(info, btn);
      this.list.appendChild(row);
      this.rows[it.id] = { it, sub, btn };
    }
    $('shop-close').addEventListener('click', () => this.close());
    // tapping the dim backdrop (outside the panel) closes it as well
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
  }

  open(shop) {
    const g = this.game;
    if (this.isOpen || g.state !== 'playing' || g.paused) return;
    this.isOpen = true;
    g.state = 'shop';
    this.title.textContent = shop && shop.name ? shop.name : 'GUN SHOP';
    g.combat.stopFlame();
    g.hud.setPrompt('');
    g.hud.setCrosshair(false);
    g.hud.setClickToAim(false);
    g.input.exitLock();
    if (g.touch) { g.touch.setMode(g.mode); const t = $('touch'); if (t) t.style.display = 'none'; }
    this.root.style.display = 'flex';
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
    for (const id in this.rows) {
      const r = this.rows[id];
      const q = quote(g, r.it);
      r.sub.textContent = q.sub;
      r.btn.textContent = `${q.label}  ${fmtMoney(q.price)}`;
      r.btn.disabled = !q.enabled;
      r.btn.title = q.enabled ? '' : (g.score < q.price ? 'Not enough cash' : 'Not needed');
    }
  }
}
