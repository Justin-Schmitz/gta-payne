/**
 * Gamepad support (standard layout, e.g. Xbox / PlayStation / Switch Pro over Bluetooth or USB).
 * Sticks and triggers are analog; buttons are translated to the same key / mouse presses the
 * keyboard uses, so every feature (interact, dodge, cheats console, dialogs) keeps working.
 *
 *  On foot:  LS move · RS look · RT fire · LT bullet time · A jump · B shoot-dodge · X use (E)
 *            Y painkiller (H) · LB/RB previous/next weapon · D-pad up camera (V) · D-pad down map (M)
 *            D-pad left aim assist (K) · RS click aim assist · Start pause · Back quick-save (F5)
 *  Driving:  LS steer · RT gas · LT brake/reverse · A handbrake · X get out · RT fires the tank cannon
 */
const DEAD = 0.18;
const LOOK_SPEED = 1000;   // px-equivalent per second at full deflection (mouse sensitivity applies after)

const BTN = {                // standard mapping indices -> key codes (edge-triggered press/release)
  0: 'Space',                // A: jump / handbrake
  1: 'Mouse2',               // B: shoot-dodge
  2: 'KeyE',                 // X: interact
  3: 'KeyH',                 // Y: painkiller
  4: 'KeyQ_prev',            // LB: previous weapon (handled specially)
  5: 'KeyQ',                 // RB: next weapon
  8: 'F5',                   // Back / Select: quick save
  9: 'Escape',               // Start: pause
  11: 'KeyK',                // RS click: aim assist level
  12: 'KeyV',                // D-pad up: camera
  13: 'KeyM',                // D-pad down: map
  14: 'KeyK',                // D-pad left: aim assist
  15: 'ShiftLeft',           // D-pad right: bullet time toggle (alternative to LT)
};

const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

export class GamepadInput {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.active = false;       // becomes true on the first real stick/button input
    this.down = {};            // button index -> held
    this.lt = 0; this.rt = 0;
    this.ltHeld = false;
    this.input.pad = this;
    window.addEventListener('gamepadconnected', (e) => {
      const name = (e.gamepad && e.gamepad.id) ? e.gamepad.id.replace(/\(.*$/, '').trim() : 'GAMEPAD';
      game.hud.toast('GAMEPAD CONNECTED: ' + name.toUpperCase().slice(0, 28), 4);
    });
    window.addEventListener('gamepaddisconnected', () => { this.active = false; this.releaseAll(); });
  }
  pick() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
  releaseAll() {
    for (const i of Object.keys(this.down)) { if (this.down[i]) this.release(Number(i)); }
    this.down = {};
    this.input.release('Mouse0');
    this.input.axis.x = 0; this.input.axis.y = 0;
    this.input.padDrive = null;
  }
  press(i) {
    const code = BTN[i];
    if (!code) return;
    if (code === 'KeyQ_prev') { if (this.game.player) this.game.player.cycleWeapon(-1); return; }
    this.input.press(code);
  }
  release(i) {
    const code = BTN[i];
    if (!code || code === 'KeyQ_prev') return;
    this.input.release(code);
  }

  /** Called once per frame before the game update. */
  update(raw) {
    const g = this.game, inp = this.input;
    const pad = this.pick();
    if (!pad) { if (this.active) { this.active = false; this.releaseAll(); } return; }
    const ax = pad.axes, bt = pad.buttons;
    const lx = dz(ax[0] || 0), ly = dz(ax[1] || 0), rx = dz(ax[2] || 0), ry = dz(ax[3] || 0);
    const lt = bt[6] ? (bt[6].value || (bt[6].pressed ? 1 : 0)) : 0;
    const rt = bt[7] ? (bt[7].value || (bt[7].pressed ? 1 : 0)) : 0;
    const anyButton = bt.some((b) => b && b.pressed);
    if (!this.active && (anyButton || Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) + lt + rt > 0.3)) {
      this.active = true;
      g.hud.toast('GAMEPAD ACTIVE', 2);
    }
    if (!this.active) return;
    const playing = g.state === 'playing' && !g.paused;

    // buttons: edge-triggered presses so interact / dodge / menus behave like key taps
    for (const i of Object.keys(BTN)) {
      const idx = Number(i), held = !!(bt[idx] && bt[idx].pressed);
      if (held && !this.down[idx]) { this.down[idx] = true; this.press(idx); }
      else if (!held && this.down[idx]) { this.down[idx] = false; this.release(idx); }
    }
    // triggers
    const fire = rt > 0.5;
    if (fire && !this.rtHeld) { this.rtHeld = true; inp.press('Mouse0'); }
    else if (!fire && this.rtHeld) { this.rtHeld = false; inp.release('Mouse0'); }
    const btHold = lt > 0.5;
    if (btHold && !this.ltHeld) { this.ltHeld = true; if (g.mode === 'foot') inp.press('ShiftLeft'); }
    else if (!btHold && this.ltHeld) { this.ltHeld = false; inp.release('ShiftLeft'); }
    this.lt = lt; this.rt = rt;

    if (!playing) return;
    if (g.mode === 'foot') {
      // left stick -> movement axis (shared with the touch joystick), right stick -> look
      inp.axis.x = lx; inp.axis.y = -ly;
      const curve = (v) => Math.sign(v) * v * v;
      inp.mouse.dx += curve(rx) * LOOK_SPEED * raw;
      inp.mouse.dy += curve(ry) * LOOK_SPEED * raw;
      inp.padDrive = null;
    } else {
      inp.axis.x = 0; inp.axis.y = 0;
      // analog driving: steer from the stick, gas / brake from the triggers (keyboard still works on top)
      inp.padDrive = { steer: -lx, throttle: rt - lt };
    }
  }
}
