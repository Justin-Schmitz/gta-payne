import { clamp } from '../util.js';
import { ASSETS, assetUrl } from '../world/assets.js';

/**
 * Sound: if public/assets/sfx has a file for an event (see manifest.sfx) it is played, otherwise the
 * Web Audio synthesised version is used. Every file is optional.
 */
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.pitch = 1;      // 0.5 during bullet time
    this.sirT = 0;
    this.hbOn = false; this.hbT = 0; this.hbL = null;   // heartbeat loop state
    this.buffers = {};   // event -> AudioBuffer (only for events that have a file)
    this.engFile = false;
    this.sirFile = false;
  }
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const c = this.ctx = new C();
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(c.destination);
    const sr = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, sr * 2, sr);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // engine
    this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 70;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 500;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    this.eng.connect(this.engF).connect(this.engG).connect(this.master); this.eng.start();
    // siren
    this.sir = c.createOscillator(); this.sir.type = 'square';
    this.sirG = c.createGain(); this.sirG.gain.value = 0;
    this.sir.connect(this.sirG).connect(this.master); this.sir.start();
    // bullet-time drone
    this.drone = c.createOscillator(); this.drone.type = 'sine'; this.drone.frequency.value = 55;
    this.droneG = c.createGain(); this.droneG.gain.value = 0;
    this.drone.connect(this.droneG).connect(this.master); this.drone.start();
    this.loadSfx();
  }

  /** Decode every sound file in the manifest. Never throws; events without a usable file stay synthesised. */
  async loadSfx() {
    const sfx = (ASSETS.manifest && ASSETS.manifest.sfx) || {};
    const c = this.ctx;
    if (!c) return;
    const decode = (ab) => new Promise((res, rej) => { const p = c.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
    await Promise.all(Object.keys(sfx).map(async (ev) => {
      for (const path of [].concat(sfx[ev])) {   // alternatives (e.g. .ogg then .mp3): first that decodes wins
        try {
          const r = await fetch(assetUrl(path));
          if (!r.ok) continue;
          this.buffers[ev] = await decode(await r.arrayBuffer());
          return;
        } catch (e) { /* unsupported or broken file: try the next one, else synth */ }
      }
    }));
    this.startFileLoops();
  }

  /** Looping engine / siren from files, driven by setEngine / setSiren. */
  startFileLoops() {
    const c = this.ctx;
    const loop = (ev) => {
      const b = this.buffers[ev];
      if (!b) return null;
      const src = c.createBufferSource(); src.buffer = b; src.loop = true;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(g).connect(this.master); src.start();
      return { src, g };
    };
    const e = loop('engine');
    if (e) { this.engL = e; this.engFile = true; this.engG.gain.value = 0; }
    const s = loop('siren');
    if (s) { this.sirL = s; this.sirFile = true; this.sirG.gain.value = 0; }
  }

  /** Play a voice line by id (public/assets/voice/<id>.mp3, see VOICES.md). Lazily decoded; a new line cuts the previous one. */
  async voice(id) {
    const files = ASSETS.manifest && ASSETS.manifest.voice;
    if (!this.ctx || !files || !files[id]) return false;
    this.voiceBuf = this.voiceBuf || {};
    if (!this.voiceBuf[id]) {
      try {
        const r = await fetch('/' + files[id]);
        if (!r.ok) return false;
        const ab = await r.arrayBuffer();
        this.voiceBuf[id] = await new Promise((res, rej) => { const p = this.ctx.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
      } catch (e) { this.voiceBuf[id] = null; return false; }
    }
    const b = this.voiceBuf[id];
    if (!b) return false;
    if (this.voiceSrc) { try { this.voiceSrc.stop(); } catch (e) { /* already ended */ } }
    const src = this.ctx.createBufferSource(); src.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = 0.9;
    src.connect(g).connect(this.master); src.start();
    this.voiceSrc = src;
    return true;
  }
  /** Play a decoded one-shot. Returns true when a file exists for the event (even if inaudible). */
  play(ev, { vol = 1, rate = 1, jitter = 0.03 } = {}) {
    const b = this.buffers[ev];
    if (!b || !this.ctx) return !!b;
    if (vol < 0.01) return true;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = b;
    src.playbackRate.value = this.pitch * rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = c.createGain(); g.gain.value = clamp(vol, 0, 1.5);
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  noise(dur, { f = 1000, q = 1, g = 0.5, type = 'lowpass', fEnd = null, att = 0.005 } = {}) {
    if (!this.ctx || g < 0.001) return;
    const c = this.ctx, t = c.currentTime, p = this.pitch;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = p;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f * p; fl.Q.value = q;
    if (fEnd) fl.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd * p), t + dur / p);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(g, t + att);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / p);
    s.connect(fl).connect(gn).connect(this.master);
    s.start(t); s.stop(t + dur / p + 0.05);
  }
  tone(f, dur, { type = 'sine', g = 0.3, fEnd = null, att = 0.005 } = {}) {
    if (!this.ctx || g < 0.001) return;
    const c = this.ctx, t = c.currentTime, p = this.pitch;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f * p, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd * p), t + dur / p);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(g, t + att);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / p);
    o.connect(gn).connect(this.master);
    o.start(t); o.stop(t + dur / p + 0.05);
  }
  vol(d) { return clamp(1 - d / 90, 0, 1); }

  gunshot(kind, d = 0) {
    const v = this.vol(d);
    if (v <= 0) return;
    if (kind !== 'fist' && kind !== 'flame' && this.play(kind, { vol: v })) return;
    switch (kind) {
      case 'pistol': this.noise(0.16, { f: 1500, g: 0.6 * v, fEnd: 200 }); this.tone(150, 0.08, { type: 'square', g: 0.2 * v, fEnd: 60 }); break;
      case 'uzi': this.noise(0.09, { f: 1800, g: 0.4 * v, fEnd: 300 }); break;
      case 'shotgun': this.noise(0.38, { f: 900, g: 0.9 * v, fEnd: 120 }); this.tone(90, 0.2, { g: 0.4 * v, fEnd: 40 }); break;
      case 'rocket': this.noise(0.7, { f: 300, g: 0.6 * v, fEnd: 2500, type: 'bandpass', q: 2 }); break;
      case 'fist': this.noise(0.07, { f: 500, g: 0.3 * v }); break;
      case 'throw': this.noise(0.18, { f: 700, fEnd: 2200, g: 0.22 * v, type: 'bandpass', q: 1.2, att: 0.03 }); break;
    }
  }
  /** Sword swing: a fast bandpass whoosh with a faint metallic ring (file `slash` first). */
  slash(d = 0) {
    const v = this.vol(d);
    if (v <= 0 || this.play('slash', { vol: v, jitter: 0.08 })) return;
    this.noise(0.22, { f: 900, fEnd: 4200, g: 0.45 * v, type: 'bandpass', q: 1.6, att: 0.03 });
    this.tone(2400, 0.16, { type: 'triangle', g: 0.05 * v, fEnd: 1500, att: 0.02 });
  }
  /** Sticky grenade fuse beep (file `beep` first). */
  beep(d = 0) {
    const v = this.vol(d);
    if (v <= 0 || this.play('beep', { vol: v, jitter: 0 })) return;
    this.tone(1900, 0.08, { type: 'square', g: 0.14 * v });
  }
  explosion(d = 0) {
    const v = clamp(1 - d / 160, 0.1, 1);
    if (this.play('explosion', { vol: v, jitter: 0.05 })) return;
    this.noise(1.5, { f: 700, g: 1.0 * v, fEnd: 50 });
    this.tone(60, 0.9, { g: 0.6 * v, fEnd: 22 });
  }
  carHit(speed, d = 0) { if (this.play('carhit', { vol: clamp(speed / 18, 0.15, 1) * this.vol(d) })) return; this.noise(0.25, { f: 500, g: clamp(speed / 18, 0.1, 0.8) * this.vol(d), fEnd: 100 }); }
  thud(d = 0) { if (this.play('thud', { vol: this.vol(d) })) return; this.noise(0.12, { f: 250, g: 0.5 * this.vol(d), fEnd: 60 }); }
  hurt() { if (this.play('hurt', { vol: 0.8 })) return; this.noise(0.12, { f: 400, g: 0.4, type: 'bandpass', q: 3, fEnd: 150 }); }
  pickup() { if (this.play('pickup', { vol: 0.7, jitter: 0 })) return; this.tone(880, 0.1, { g: 0.2, type: 'square' }); setTimeout(() => this.tone(1320, 0.15, { g: 0.2, type: 'square' }), 80); }
  ring() { if (this.play('ring', { vol: 0.5, jitter: 0 })) return; this.tone(1100, 0.12, { type: 'square', g: 0.07 }); setTimeout(() => this.tone(1400, 0.12, { type: 'square', g: 0.07 }), 160); }
  btIn() { if (this.play('bt_in', { vol: 0.7, jitter: 0 })) return; this.tone(700, 0.7, { type: 'triangle', g: 0.25, fEnd: 70 }); }
  btOut() { if (this.play('bt_out', { vol: 0.7, jitter: 0 })) return; this.tone(110, 0.4, { type: 'triangle', g: 0.2, fEnd: 900 }); }
  missionPass() { if (this.play('mission_pass', { jitter: 0 })) return; [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, { type: 'square', g: 0.15 }), i * 130)); }
  missionFail() { if (this.play('mission_fail', { jitter: 0 })) return; [440, 370, 311, 220].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, { type: 'sawtooth', g: 0.12 }), i * 180)); }
  wasted() { if (this.play('wasted', { jitter: 0 })) return; this.tone(220, 2.5, { type: 'sawtooth', g: 0.25, fEnd: 40 }); }
  busted() { if (this.play('busted', { jitter: 0 })) return; [330, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, { type: 'square', g: 0.15 }), i * 250)); }
  cash() { if (this.play('cash', { vol: 0.7, jitter: 0 })) return; this.tone(1760, 0.08, { type: 'square', g: 0.12 }); }
  buy() {
    if (this.play('buy', { jitter: 0 })) return;
    this.tone(1320, 0.08, { type: 'square', g: 0.12 });
    setTimeout(() => this.tone(1760, 0.12, { type: 'square', g: 0.12 }), 70);
  }
  jump() { if (this.play('jump', { vol: 0.7 })) return; this.noise(0.14, { f: 500, g: 0.12, fEnd: 900 }); }
  land() { if (this.play('land', { vol: 0.7 })) return; this.noise(0.12, { f: 250, g: 0.35, fEnd: 60 }); }
  /** Flamethrower loop: call flame(true) when the trigger goes down and flame(false) when it is released. */
  flame(on) {
    if (!this.ctx) return;
    if (!this.flameL) {
      if (!on) return;
      const c = this.ctx, fl = this.buffers.flame;
      const src = c.createBufferSource(); src.loop = true;
      const g = c.createGain(); g.gain.value = 0;
      if (fl) { src.buffer = fl; src.connect(g).connect(this.master); }
      else {
        src.buffer = this.noiseBuf;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
        src.connect(f).connect(g).connect(this.master);
      }
      src.start();
      this.flameL = { src, g, file: !!fl };
    }
    const L = this.flameL;
    L.src.playbackRate.setTargetAtTime(this.pitch, this.ctx.currentTime, 0.05);
    L.g.gain.setTargetAtTime(on ? (L.file ? 0.8 : 0.22) : 0, this.ctx.currentTime, on ? 0.04 : 0.12);
  }

  setEngine(on, rpm) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.engFile) {
      this.engL.g.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.1);
      this.engL.src.playbackRate.setTargetAtTime((0.55 + rpm * 1.1) * this.pitch, t, 0.06);
      return;
    }
    this.engG.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.1);
    this.eng.frequency.setTargetAtTime((55 + rpm * 180) * this.pitch, t, 0.06);
  }
  setSiren(v) {
    if (!this.ctx) return;
    if (this.sirFile) { this.sirL.g.gain.setTargetAtTime(v * 0.4, this.ctx.currentTime, 0.2); return; }
    this.sirG.gain.setTargetAtTime(v * 0.05, this.ctx.currentTime, 0.2);
  }
  /** Bullet-time heartbeat loop: two soft 55 Hz thumps per 1.1 s (or a looping `heartbeat` file). Not slowed by the bullet-time pitch. */
  heartbeat(on) {
    this.hbOn = !!on;
    if (!this.ctx) return;
    const b = this.buffers.heartbeat, t = this.ctx.currentTime;
    if (b) {
      if (on && !this.hbL) {
        const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
        const g = this.ctx.createGain(); g.gain.value = 0;
        src.connect(g).connect(this.master); src.start();
        this.hbL = { src, g };
      }
      if (this.hbL) this.hbL.g.gain.setTargetAtTime(on ? 0.6 : 0, t, 0.08);
      return;
    }
    this.hbT = 0;   // first synthesised beat on the next update()
  }
  /** One synthesised thump (sine 55 Hz dropping to 40 Hz, gain 0.05) `delay` seconds from now. */
  thump(delay, gain) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.16);
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(110, t);   // a little click so small speakers show it
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const g2 = c.createGain(); g2.gain.value = 0.35;
    o.connect(gn); o2.connect(g2).connect(gn); gn.connect(this.master);
    o.start(t); o2.start(t); o.stop(t + 0.25); o2.stop(t + 0.25);
  }
  /** A bullet passed close to the player's head: a short filtered noise sweep. */
  whiz() {
    if (this.play('whiz', { vol: 0.8 })) return;
    this.noise(0.16, { f: 4800, fEnd: 900, g: 0.3, type: 'bandpass', q: 2.5, att: 0.012 });
  }
  /** Empty-gun click (also the refusal when bullet time is entered with less than 10% in the meter). */
  dryfire() {
    if (this.play('dryfire', { vol: 0.7 })) return;
    this.noise(0.03, { f: 5200, g: 0.2, type: 'highpass' });
    this.tone(1800, 0.03, { type: 'square', g: 0.06, fEnd: 900 });
  }
  setBulletTime(on) {
    this.pitch = on ? 0.5 : 1;
    if (!this.ctx) return;
    this.droneG.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.15);
  }
  update(dt) {
    if (!this.ctx) return;
    this.sirT += dt;
    if (this.hbOn && !this.buffers.heartbeat) {
      this.hbT -= dt;
      if (this.hbT <= 0) { this.hbT += 1.1; this.thump(0, 0.05); this.thump(0.22, 0.04); }
    }
    if (this.sirFile) return;
    this.sir.frequency.value = (620 + 260 * Math.sin(this.sirT * 7)) * this.pitch;
  }
}
