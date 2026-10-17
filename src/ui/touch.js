/**
 * Touch layer for tablets/phones. Feeds the same Input object the keyboard uses:
 *  - on foot: floating joystick (left half) moves, dragging the right half looks,
 *    buttons for fire / jump / dodge / bullet time / weapon / use
 *  - driving: steer buttons on the left, gas / brake / handbrake / get-out on the right
 */
export const isTouchDevice = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const LOOK_SENS = 2.4;   // multiplier on raw finger movement (px) before the mouse sensitivity
const STICK_R = 60;      // px radius of the joystick

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.input.enableTouch();
    this.root = document.getElementById('touch');
    this.root.style.display = 'block';
    document.body.classList.add('touch');
    this.stick = document.getElementById('stick');
    this.knob = document.getElementById('stick-knob');
    this.footEl = document.getElementById('touch-foot');
    this.driveEl = document.getElementById('touch-drive');
    this.stickId = null;
    this.lookId = null;
    this.lookX = 0; this.lookY = 0;
    this.stickCx = 0; this.stickCy = 0;
    this.mode = 'foot';

    // hold-buttons: data-key is pressed while touched
    for (const b of this.root.querySelectorAll('[data-key]')) {
      const code = b.dataset.key;
      const tap = b.dataset.tap === '1';
      const start = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); this.input.press(code); if (tap) this.input.release(code); };
      const end = (e) => { e.preventDefault(); b.classList.remove('on'); if (!tap) this.input.release(code); };
      b.addEventListener('touchstart', start, { passive: false });
      b.addEventListener('touchend', end, { passive: false });
      b.addEventListener('touchcancel', end, { passive: false });
    }
    document.getElementById('touch-pause').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); game.pause(); }, { passive: false });

    // free-area gestures: joystick on the left, look on the right (foot mode only)
    const zone = document.getElementById('touch-zone');
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.mode !== 'foot') return;
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && this.stickId === null) {
          this.stickId = t.identifier; this.stickCx = t.clientX; this.stickCy = t.clientY;
          this.stick.style.display = 'block';
          this.stick.style.left = (t.clientX - STICK_R) + 'px';
          this.stick.style.top = (t.clientY - STICK_R) + 'px';
          this.knob.style.transform = 'translate(0px,0px)';
        } else if (this.lookId === null) {
          this.lookId = t.identifier; this.lookX = t.clientX; this.lookY = t.clientY;
        }
      }
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) {
          let dx = t.clientX - this.stickCx, dy = t.clientY - this.stickCy;
          const l = Math.hypot(dx, dy);
          if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
          this.knob.style.transform = `translate(${dx}px,${dy}px)`;
          this.input.axis.x = dx / STICK_R;
          this.input.axis.y = -dy / STICK_R;
        } else if (t.identifier === this.lookId) {
          this.input.mouse.dx += (t.clientX - this.lookX) * LOOK_SENS;
          this.input.mouse.dy += (t.clientY - this.lookY) * LOOK_SENS;
          this.lookX = t.clientX; this.lookY = t.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) { this.stickId = null; this.input.axis.x = 0; this.input.axis.y = 0; this.stick.style.display = 'none'; }
        else if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    zone.addEventListener('touchend', end, { passive: false });
    zone.addEventListener('touchcancel', end, { passive: false });
    // stop iOS rubber-banding / zoom gestures anywhere
    document.addEventListener('touchmove', (e) => { if (e.target.closest && e.target.closest('.panel, .map-side')) return; e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    this.setMode('foot');
  }
  setMode(mode) {
    this.mode = mode;
    this.footEl.style.display = mode === 'foot' ? 'block' : 'none';
    this.driveEl.style.display = mode === 'drive' ? 'block' : 'none';
    this.stick.style.display = 'none';
    this.stickId = null; this.lookId = null;
    this.input.axis.x = 0; this.input.axis.y = 0;
    for (const b of this.root.querySelectorAll('[data-key].on')) { b.classList.remove('on'); this.input.release(b.dataset.key); }
  }
  /** Label on the USE button mirrors the HUD prompt. */
  setPrompt(text) {
    const b = document.getElementById('tb-use');
    if (!b) return;
    const label = text ? text.replace(/^E — /, '') : 'USE';
    if (b.textContent !== label) b.textContent = label;
    b.classList.toggle('hot', !!text);
    // driving: the GET OUT button doubles as "accept the vehicle job" while one is offered
    const x = document.querySelector('#touch-drive .exit');
    if (x) {
      const l = text && /^E — START/.test(text) ? label : 'GET OUT';
      if (x.dataset.label !== l) { x.dataset.label = l; x.textContent = l; }
    }
  }
}
