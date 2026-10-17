/**
 * Save / load dialog for named saves kept by server.js (shared by everybody on the LAN).
 *
 *   SavesUI(game).open('save' | 'load')
 *
 * Works with mouse, keyboard and touch. While it is open it swallows all key events (capture phase on
 * window) so the game never sees them; the game itself is already paused (pause menu) or not yet started
 * (title screen) whenever the dialog can be opened.
 */
const LAST_KEY = 'port-harlow-last-save-name';
const $ = (id) => document.getElementById(id);
const slugify = (n) => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
const fmtMoney = (n) => '$' + Math.floor(n).toLocaleString('en-US');

export class SavesUI {
  constructor(game) {
    this.game = game;
    this.el = {
      dlg: $('saves-dialog'), title: $('saves-title'), name: $('saves-name'), doSave: $('saves-do-save'), msg: $('saves-msg'),
      confirm: $('saves-confirm'), confirmText: $('saves-confirm-text'), yes: $('saves-yes'), no: $('saves-no'),
      list: $('saves-list'), close: $('saves-close'),
    };
    this.mode = null;       // 'save' | 'load'
    this.saves = [];
    this.pending = null;    // {action, name} awaiting YES / NO
    this.busy = false;
    this.token = 0;

    // keys: nothing reaches the game while the dialog is open
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      e.stopImmediatePropagation();
      if (e.code === 'Escape') { e.preventDefault(); this.pending ? this.clearConfirm() : this.close(); }
      else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.target === this.el.name) { e.preventDefault(); this.trySave(); }
    }, true);

    this.el.close.addEventListener('click', () => this.close());
    this.el.doSave.addEventListener('click', () => this.trySave());
    this.el.yes.addEventListener('click', () => this.runPending());
    this.el.no.addEventListener('click', () => this.clearConfirm());
    this.el.dlg.addEventListener('click', (e) => { if (e.target === this.el.dlg) this.close(); });
    // swallow stray touches so the touch-control layer underneath never sees them
    for (const t of ['touchstart', 'touchmove', 'touchend']) this.el.dlg.addEventListener(t, (e) => e.stopPropagation(), { passive: true });

    // entry points
    const bind = (id, mode) => { const b = $(id); if (b) b.addEventListener('click', () => this.open(mode)); };
    bind('btn-load-title', 'load');
    bind('btn-save', 'save');
    bind('btn-load', 'load');
  }

  get isOpen() { return this.el.dlg.classList.contains('open'); }

  open(mode) {
    this.mode = mode;
    this.clearConfirm();
    this.el.title.textContent = mode === 'save' ? 'SAVE GAME' : 'LOAD GAME';
    this.el.dlg.classList.toggle('save-mode', mode === 'save');
    this.el.dlg.classList.add('open');
    this.setMsg('');
    this.el.list.textContent = '';
    if (mode === 'save') {
      let last = '';
      try { last = localStorage.getItem(LAST_KEY) || ''; } catch (e) { /* ignore */ }
      this.el.name.value = last || 'Save 1';
      // do not auto-focus on touch devices: the on-screen keyboard would cover the list
      if (!this.game.touch) { this.el.name.focus(); this.el.name.select(); }
    }
    this.refresh();
  }
  close() {
    this.token++;
    this.el.dlg.classList.remove('open');
    this.clearConfirm();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  setMsg(text, cls = '') { this.el.msg.textContent = text; this.el.msg.className = cls; }
  clearConfirm() { this.pending = null; this.el.confirm.classList.remove('show'); }
  askConfirm(action, name, text) {
    this.pending = { action, name };
    this.el.confirmText.textContent = text;
    this.el.confirm.classList.add('show');
  }
  runPending() {
    const p = this.pending;
    this.clearConfirm();
    if (!p) return;
    if (p.action === 'overwrite') this.doSave(p.name);
    else if (p.action === 'delete') this.doDelete(p.name);
    else if (p.action === 'load') this.doLoad(p.name);
  }

  // ---- server ----------------------------------------------------------------------------------------
  async api(method, path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    let r, data = null;
    try {
      r = await fetch('/api/' + path, {
        method, cache: 'no-store', signal: ctl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = undefined; }
    } catch (e) {
      throw new Error('SAVE SERVER NOT REACHABLE. START THE GAME WITH "npm run dev" (or "npm run serve"), NOT PLAIN "vite".');
    } finally { clearTimeout(timer); }
    if (data === undefined) throw new Error('SAVE SERVER NOT REACHABLE. START THE GAME WITH "npm run dev" (or "npm run serve"), NOT PLAIN "vite".');
    if (!r.ok) throw new Error(((data && data.error) || 'server error ' + r.status).toUpperCase());
    return data;
  }

  async refresh() {
    const tok = ++this.token;
    this.setMsg('LOADING...');
    try {
      const list = await this.api('GET', 'saves');
      if (tok !== this.token) return;
      this.saves = Array.isArray(list) ? list : [];
      this.setMsg(this.saves.length ? '' : this.mode === 'load' ? 'NO SAVED GAMES YET.' : 'NO SAVED GAMES YET - PICK A NAME.');
    } catch (e) {
      if (tok !== this.token) return;
      this.saves = [];
      this.setMsg(e.message, 'error');
    }
    this.renderList();
  }

  renderList() {
    const list = this.el.list;
    list.textContent = '';
    for (const s of this.saves) {
      const row = document.createElement('div');
      row.className = 'save-row';
      const info = document.createElement('div');
      info.className = 'info';
      const nm = document.createElement('div');
      nm.className = 'nm'; nm.textContent = s.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${fmtMoney(s.score)}  ·  x${s.mult}  ·  ${s.missions} mission${s.missions === 1 ? '' : 's'}  ·  ${new Date(s.time).toLocaleString()}`;
      info.append(nm, meta);
      row.append(info);
      const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', fn); row.append(b); };
      if (this.mode === 'load') btn('LOAD', '', () => this.onLoad(s.name));
      else btn('USE NAME', '', () => { this.el.name.value = s.name; this.clearConfirm(); this.setMsg(''); });
      btn('DELETE', 'del', () => this.askConfirm('delete', s.name, `DELETE "${s.name}" FOR EVERYONE ON THE NETWORK?`));
      list.append(row);
    }
  }

  // ---- actions -------------------------------------------------------------------------------------
  trySave() {
    if (this.busy) return;
    const name = this.el.name.value.trim().replace(/\s+/g, ' ');
    if (!name) { this.setMsg('TYPE A NAME FIRST.', 'error'); this.el.name.focus(); return; }
    if (!slugify(name).replace(/-/g, '')) { this.setMsg('USE AT LEAST ONE LETTER OR NUMBER.', 'error'); return; }
    const clash = this.saves.find((s) => slugify(s.name) === slugify(name));
    if (clash) this.askConfirm('overwrite', name, `OVERWRITE "${clash.name}"?`);
    else this.doSave(name);
  }
  async doSave(name) {
    if (this.busy) return;
    this.busy = true;
    this.setMsg('SAVING...');
    try {
      if (!this.game.player || this.game.state !== 'playing') throw new Error('NO GAME IS RUNNING.');
      await this.api('PUT', 'saves/' + encodeURIComponent(name), this.game.getSaveState(name));
      try { localStorage.setItem(LAST_KEY, name); } catch (e) { /* ignore */ }
      this.game.hud.toast('SAVED: ' + name);
      this.close();
    } catch (e) {
      this.setMsg(e.message, 'error');
    } finally { this.busy = false; }
  }
  onLoad(name) {
    // loading over a running game throws the unsaved progress away: ask first
    if (this.game.state === 'playing') this.askConfirm('load', name, `LOAD "${name}"? UNSAVED PROGRESS IS LOST.`);
    else this.doLoad(name);
  }
  async doLoad(name) {
    if (this.busy) return;
    this.busy = true;
    this.setMsg('LOADING "' + name + '"...');
    try {
      await this.game.loadFromServer(name);
      try { localStorage.setItem(LAST_KEY, name); } catch (e) { /* ignore */ }
      this.close();
    } catch (e) {
      this.setMsg(String(e.message || e).toUpperCase(), 'error');
    } finally { this.busy = false; }
  }
  async doDelete(name) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.api('DELETE', 'saves/' + encodeURIComponent(name));
      this.busy = false;
      await this.refresh();
      this.setMsg('DELETED "' + name + '".', 'ok');
    } catch (e) {
      this.setMsg(e.message, 'error');
    } finally { this.busy = false; }
  }
}
