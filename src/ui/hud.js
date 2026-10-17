import { fmtMoney } from '../util.js';
import { GANGS, GANG_IDS } from '../data/gangs.js';

const $ = (id) => document.getElementById(id);

/** DOM overlay: score, multiplier, wanted heads, pager, objective text, status bars, messages. */
export class HUD {
  constructor() {
    this.el = {
      score: $('score'), mult: $('mult'), wanted: $('wanted'), pager: $('pager'), pagerText: $('pager-text'),
      objective: $('objective'), objectiveText: $('objective-text'), timer: $('timer'), weapon: $('weapon'),
      health: $('health'), armor: $('armor'), bt: $('btmeter'), btBox: $('bt-box'), crosshair: $('crosshair'),
      prompt: $('prompt'), toast: $('toast'), big: $('big'), bigSub: $('big-sub'), bigText: $('big-text'),
      vignette: $('bt-vignette'), grain: $('bt-grain'), btRow: $('bt-row'), sandTop: $('sand-top'), sandBot: $('sand-bot'), pills: $('pills'), pillCount: $('pill-count'), mode: $('mode-tag'), click: $('click-to-aim'), target: $('target'),
    };
    this.cache = {};
    this.toasts = [];
    this.toastT = 0;
    this.pagerQueue = [];
    this.pagerState = null;
    this.bigT = 0;
    this.wantedHeads = [];
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('span');
      s.className = 'head';
      this.el.wanted.appendChild(s);
      this.wantedHeads.push(s);
    }
    // respect bars (one per gang, centred zero) live in #respect
    this.respectBars = {};
    const rbox = $('respect');
    if (rbox) for (const id of GANG_IDS) {
      const row = document.createElement('div');
      row.className = 'rrow';
      row.innerHTML = '<span class="rname"></span><div class="rbar"><i class="rfill"></i></div>';
      row.querySelector('.rname').textContent = GANGS[id].name;
      row.style.setProperty('--gc', GANGS[id].color);
      rbox.appendChild(row);
      this.respectBars[id] = row.querySelector('.rfill');
    }
  }
  set(key, el, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }
  setScore(n) { this.set('score', this.el.score, fmtMoney(n)); }
  setMult(m) { this.set('mult', this.el.mult, 'x' + m); }
  setTarget(n, diffLabel) { this.set('target', this.el.target, 'TARGET ' + fmtMoney(n) + (diffLabel ? ' · ' + diffLabel : '')); }
  setWanted(level) {
    if (this.cache.wanted === level) return;
    this.cache.wanted = level;
    this.wantedHeads.forEach((h, i) => h.classList.toggle('on', i < level));
    this.el.wanted.classList.toggle('hot', level > 0);
    const strip = $('bounty'), lv = $('wanted-level');
    if (strip) strip.classList.toggle('hot', level > 0);
    if (lv) lv.textContent = level > 0 ? 'LEVEL ' + level : '';
  }
  /**
   * Vehicle health bar under the weapon line. setVehicle(name, frac[, hp, maxHp]) shows it
   * (frac 0..1, green -> yellow -> red); setVehicle(null) hides it (on foot).
   */
  setVehicle(name, frac, hp, maxHp) {
    { const row = document.getElementById('top-veh-row'); if (row) { row.style.display = name ? 'flex' : 'none'; if (name) { const f = document.getElementById('top-veh'); const n = document.getElementById('top-veh-n'); const l = document.getElementById('top-veh-l'); if (f) { f.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; f.style.background = `hsl(${Math.round(Math.max(0, Math.min(1, frac)) * 120)}, 80%, 45%)`; } if (n && hp != null) n.textContent = `${Math.max(0, Math.round(hp))}/${Math.round(maxHp || 0)}`; if (l) l.textContent = name; } } }
    const box = $('vehicle');
    if (!box) return;
    if (name == null) {
      if (this.cache.veh !== null) { this.cache.veh = null; box.style.display = 'none'; }
      return;
    }
    const f = Math.min(1, Math.max(0, frac));
    const txt = hp != null && maxHp != null ? `${Math.max(0, Math.ceil(hp))}/${Math.round(maxHp)}` : Math.round(f * 100) + '%';
    const key = name + '|' + Math.round(f * 200) + '|' + txt;
    if (this.cache.veh === key) return;
    if (this.cache.veh == null) box.style.display = 'block';
    this.cache.veh = key;
    $('veh-name').textContent = name;
    $('veh-hp').textContent = txt;
    const fill = $('veh-fill');
    fill.style.width = (f * 100).toFixed(1) + '%';
    fill.style.backgroundColor = `hsl(${Math.round(f * 120)}, 72%, 46%)`;
  }
  /** Respect per gang (-100..100): bar grows right from the centre when liked, left when hated. */
  setRespect(r) {
    for (const id in this.respectBars) {
      const v = Math.round(r[id] || 0);
      if (this.cache['r' + id] === v) continue;
      this.cache['r' + id] = v;
      const f = this.respectBars[id];
      f.style.left = (v >= 0 ? 50 : 50 + v / 2) + '%';
      f.style.width = Math.abs(v) / 2 + '%';
      f.classList.toggle('neg', v < 0);
    }
  }
  setObjective(text) {
    this.set('obj', this.el.objectiveText, text || '');
    this.el.objective.style.display = text ? 'block' : 'none';
  }
  setTimer(sec) {
    if (sec == null) { this.el.timer.style.display = 'none'; this.cache.timer = null; return; }
    this.el.timer.style.display = 'block';
    const v = Math.max(0, Math.ceil(sec));
    this.set('timer', this.el.timer, `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`);
    this.el.timer.classList.toggle('urgent', v <= 10);
  }
  setWeapon(name, ammo) { this.set('weapon', this.el.weapon, ammo === Infinity ? name : `${name}  ${ammo}`); }
  setHealth(hp, armor, armorMax = 100) {
    const h = Math.max(0, hp) + '%';
    if (this.cache.hp !== h) { this.cache.hp = h; this.el.health.style.width = h; const t = document.getElementById('top-health'); if (t) t.style.width = h; const n = document.getElementById('top-health-n'); if (n) n.textContent = Math.max(0, Math.round(hp)); }
    const a = Math.min(100, Math.max(0, armor) / armorMax * 100) + '%';
    if (this.cache.armor !== a) {
      this.cache.armor = a; this.el.armor.style.width = a;
      const t = document.getElementById('top-armor'); if (t) t.style.width = a;
      const n = document.getElementById('top-armor-n'); if (n) n.textContent = Math.max(0, Math.round(armor));
      const row = document.getElementById('top-armor-row'); if (row) row.classList.toggle('empty', armor <= 0);
    }
  }
  /** Hourglass bullet-time meter. `fx` (default: active) switches the sepia vignette + film grain (also used by the kill-cam). */
  setBT(frac, active, visible, fx = active) {
    const w = Math.round(frac * 100) + '%';
    if (this.cache.bt !== w) {
      this.cache.bt = w; this.el.bt.style.width = w;
      // the hourglass: sand left in the top bulb (clip rect y 2..13) and piled in the bottom bulb (clip rect y 13..24)
      const top = Math.round(frac * 11 * 10) / 10, bot = 11 - top;
      if (this.el.sandTop) { this.el.sandTop.setAttribute('y', 13 - top); this.el.sandTop.setAttribute('height', top); }
      if (this.el.sandBot) { this.el.sandBot.setAttribute('y', 24 - bot); this.el.sandBot.setAttribute('height', bot); }
    }
    this.el.btBox.classList.toggle('active', active);
    const box = this.el.btRow || this.el.btBox;
    box.classList.toggle('active', active);
    box.style.display = visible ? (this.el.btRow ? 'flex' : 'block') : 'none';
    this.el.vignette.classList.toggle('on', fx);
    if (this.el.grain) this.el.grain.classList.toggle('on', fx);
  }
  /** Painkiller bottle + count next to the health bar; `healing` pulses it while a pill works. */
  setPills(n, healing) {
    const k = n + (healing ? 'h' : '');
    if (this.cache.pills === k) return;
    this.cache.pills = k;
    if (this.el.pillCount) this.el.pillCount.textContent = 'x' + n;
    if (this.el.pills) { this.el.pills.classList.toggle('empty', n <= 0); this.el.pills.classList.toggle('healing', !!healing); }
  }
  /** Crosshair gap in px (set every frame by FootMode; cached to half-pixels). */
  setSpread(px) {
    const v = Math.round(px * 2) / 2;
    if (this.cache.spread === v) return;
    this.cache.spread = v;
    this.el.crosshair.style.setProperty('--gap', v + 'px');
  }
  setCrosshair(show) { this.el.crosshair.style.display = show ? 'block' : 'none'; }
  /** Crosshair state (FootMode, every frame): 'idle' white, 'target' red (aim-assist lock), 'blocked' grey (wall within 3 m). */
  setAimState(state) {
    if (this.cache.aimState === state) return;
    this.cache.aimState = state;
    this.el.crosshair.classList.toggle('target', state === 'target');
    this.el.crosshair.classList.toggle('blocked', state === 'blocked');
  }
  setClickToAim(show) { this.el.click.style.display = show ? 'flex' : 'none'; }
  /**
   * Boss bar under the top bars (T16). setBoss(name, frac[, kind]) shows it: name in the pixel font, frac 0..1 of the boss's hp,
   * kind 'boss' (bigger, gold name) or 'mini' (default). setBoss(null) hides it. Cheap: only touches the DOM when a value changes.
   */
  setBoss(name, frac = 1, kind = 'mini') {
    const box = $('bossbar');
    if (!box) return;
    if (name == null) {
      if (this.cache.boss !== null) { this.cache.boss = null; box.style.display = 'none'; document.body.classList.remove('boss-on'); }
      return;
    }
    const f = Math.max(0, Math.min(1, frac)), w = (f * 100).toFixed(1) + '%';
    const key = name + '|' + kind + '|' + w;
    if (this.cache.boss === key) return;
    if (this.cache.boss == null) { box.style.display = 'block'; document.body.classList.add('boss-on'); }
    this.cache.boss = key;
    $('bb-name').textContent = name.toUpperCase();
    $('bb-fill').style.width = w;
    box.className = kind === 'boss' ? 'boss' : 'mini';
  }
  setPrompt(text) { this.set('prompt', this.el.prompt, text || ''); this.el.prompt.style.display = text ? 'block' : 'none'; }
  setMode(mode) { this.set('mode', this.el.mode, mode === 'drive' ? 'TOP-DOWN · DRIVING' : 'THIRD-PERSON · ON FOOT'); }

  toast(text, dur = 3) { this.toasts.push({ text, dur }); }
  big(text, sub = '', dur = 3, cls = '') {
    this.el.bigText.textContent = text;
    this.el.bigSub.textContent = sub;
    this.el.big.className = 'show ' + cls;
    this.bigT = dur;
  }
  pager(text, who = '') { this.pagerQueue.push({ text: (who ? who.toUpperCase() + ': ' : '') + text }); }

  update(dt) {
    // toasts
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) { this.el.toast.classList.remove('show'); }
    } else if (this.toasts.length) {
      const t = this.toasts.shift();
      this.el.toast.textContent = t.text;
      this.el.toast.classList.add('show');
      this.toastT = t.dur;
    }
    // big message
    if (this.bigT > 0) {
      this.bigT -= dt;
      if (this.bigT <= 0) this.el.big.className = '';
    }
    // pager typewriter
    if (!this.pagerState && this.pagerQueue.length) {
      this.pagerState = { ...this.pagerQueue.shift(), n: 0, hold: 0 };
      this.el.pager.classList.add('show');
    }
    if (this.pagerState) {
      const s = this.pagerState;
      if (s.n < s.text.length) {
        s.n = Math.min(s.text.length, s.n + dt * 45);
        this.el.pagerText.textContent = s.text.slice(0, Math.floor(s.n)) + (Math.floor(s.n) < s.text.length ? '▮' : '');
      } else {
        s.hold += dt;
        if (s.hold > 2 + s.text.length * 0.03) {
          this.pagerState = null;
          if (!this.pagerQueue.length) this.el.pager.classList.remove('show');
        }
      }
    }
  }
}
