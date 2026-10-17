export const DOUBLE_TAP_MS = 250;   // two presses of the same move key within this = double-tap (shoot-dodge)
const TAP_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Keyboard / mouse state with pointer-lock support. */
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = {};
    this.pressed = {};
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0 };
    this.locked = false;
    this.touch = false;
    this.axis = { x: 0, y: 0 };
    this.keyHandlers = [];
    this.clickHandlers = [];
    this.lastTap = {};   // code -> time (ms) of the last fresh press, for double-tap detection
    this.taps = {};      // codes double-tapped this frame (two presses within DOUBLE_TAP_MS), see doubleTap()

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F5'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.pressed[e.code] = true;
      this.tap(e.code);
      for (const h of this.keyHandlers) if (h(e.code, e) === true) break; // a handler returning true swallows the key
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.buttons = 0; this.lastTap = {}; });
    this.lockFailed = false; // pointer lock unavailable (embedded browser): fall back to raw mouse deltas
    document.addEventListener('mousemove', (e) => {
      if (this.locked || this.lockFailed) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    document.addEventListener('mousedown', (e) => {
      this.mouse.buttons |= (1 << e.button);
      this.pressed['Mouse' + e.button] = true;
      for (const h of this.clickHandlers) h(e.button, e);
    });
    document.addEventListener('mouseup', (e) => { this.mouse.buttons &= ~(1 << e.button); });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
  }
  /** Virtual input from the touch layer. */
  enableTouch() { this.touch = true; this.axis = { x: 0, y: 0 }; }
  /** Record a fresh press; a second press of the same key within 0.25 s flags a double-tap for this frame. */
  tap(code) {
    if (!TAP_KEYS.has(code)) return;
    const now = performance.now(), last = this.lastTap[code];
    if (last !== undefined && now - last <= DOUBLE_TAP_MS) { this.taps[code] = true; delete this.lastTap[code]; } // a third tap starts a new pair
    else this.lastTap[code] = now;
  }
  /** True in the frame a key was double-tapped (cleared by endFrame). */
  doubleTap(code) { return !!this.taps[code]; }
  press(code) {
    if (!this.keys[code]) this.tap(code);
    this.keys[code] = true;
    this.pressed[code] = true;
    if (code === 'Mouse0') this.mouse.buttons |= 1;
    for (const h of this.keyHandlers) h(code, null);
  }
  release(code) {
    this.keys[code] = false;
    if (code === 'Mouse0') this.mouse.buttons &= ~1;
  }
  down(code) { return !!this.keys[code]; }
  wasPressed(code) { return !!this.pressed[code]; }
  mouseDown(b) { return (this.mouse.buttons & (1 << b)) !== 0; }
  endFrame() { this.pressed = {}; this.taps = {}; this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; }
  onKey(h) { this.keyHandlers.push(h); }
  onKeyFirst(h) { this.keyHandlers.unshift(h); }
  onClick(h) { this.clickHandlers.push(h); }
  get aiming() { return this.locked || this.lockFailed || this.touch || !!(this.pad && this.pad.active); }
  requestLock() {
    if (this.locked || this.lockFailed || this.touch) return;
    const fail = (err) => {
      // The host cannot lock the pointer at all (embedded webviews): use raw mouse deltas instead.
      if (err && /root document|not valid for pointer lock|NotSupported|WrongDocument/i.test(err.name + ' ' + err.message)) this.lockFailed = true;
    };
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotSupportedError') { try { const p2 = this.el.requestPointerLock(); if (p2 && p2.catch) p2.catch(fail); } catch (e) { fail(e); } } else fail(err); });
    } catch (e) { fail(e); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
}
