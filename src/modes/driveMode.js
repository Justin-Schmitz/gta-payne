import * as THREE from 'three';
import { damp, clamp } from '../util.js';

/** GTA1-style straight-down camera while in a vehicle. North is always up. */
export class DriveMode {
  constructor(game) {
    this.game = game;
    this.height = 32;
    this.camPos = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.first = true;
  }
  enter() {
    const g = this.game;
    g.input.exitLock();
    g.hud.setCrosshair(false);
    g.hud.setClickToAim(false);
    this.first = true;
  }
  exit() { this.showCannonButton(false); }
  /** Touch FIRE button for the tank cannon (only visible while driving a vehicle that has one). */
  showCannonButton(on) {
    if (this.cannonBtn === on) return;
    this.cannonBtn = on;
    const b = document.getElementById('tb-cannon');
    if (b) b.classList.toggle('avail', on);
  }

  update(dt) {
    const g = this.game, v = g.player.vehicle, inp = g.input;
    if (!v) return;
    const c = v.controls;
    let th = 0;
    if (inp.down('KeyW') || inp.down('ArrowUp')) th += 1;
    if (inp.down('KeyS') || inp.down('ArrowDown')) th -= 1;
    let st = 0;
    if (inp.down('KeyA') || inp.down('ArrowLeft')) st += 1;
    if (inp.down('KeyD') || inp.down('ArrowRight')) st -= 1;
    if (inp.padDrive) { // gamepad: analog steer / triggers, keyboard adds on top
      if (Math.abs(inp.padDrive.throttle) > 0.02) th = Math.max(-1, Math.min(1, th + inp.padDrive.throttle));
      if (Math.abs(inp.padDrive.steer) > 0.02) st = Math.max(-1, Math.min(1, st + inp.padDrive.steer));
    }
    c.throttle = th;
    c.steer = st;
    c.handbrake = inp.down('Space');
    // tank cannon: LMB (desktop) or the touch FIRE button; fires from the barrel along the hull heading
    const cannon = !!v.type.cannon;
    this.showCannonButton(cannon);
    if (cannon && (inp.mouseDown(0) || inp.down('Mouse0')) && !g.paused) v.fireCannon();
    c.brake = false; // S brakes while rolling forward, then reverses once stopped (see Vehicle.update)
    const rpm = clamp(Math.abs(v.speed) / v.type.maxSpeed, 0, 1);
    g.audio.setEngine(true, rpm * 0.8 + (th > 0 ? 0.2 : 0));
  }

  /** Writes target camera position/quaternion into out. */
  cameraTarget(dt, outPos, outQuat) {
    const g = this.game, v = g.player.vehicle;
    const p = v ? v.pos : g.player.ped.pos;
    const sp = v ? Math.abs(v.speed) : 0;
    const targetH = (30 + sp * 0.75) * g.cam.driveZoom;
    this.height = this.first ? targetH : damp(this.height, targetH, 2.5, dt);
    // lead the camera slightly in the direction of travel
    const lx = v ? v.vx * 0.35 : 0, lz = v ? v.vz * 0.35 : 0;
    const tx = p.x + lx, tz = p.z + lz;
    if (this.first) { this.lookAt.set(tx, 0, tz); this.first = false; }
    else { this.lookAt.x = damp(this.lookAt.x, tx, 6, dt); this.lookAt.z = damp(this.lookAt.z, tz, 6, dt); }
    outPos.set(this.lookAt.x, this.height, this.lookAt.z + 0.001);
    const m = new THREE.Matrix4();
    m.lookAt(outPos, this.lookAt, new THREE.Vector3(0, 0, -1));
    outQuat.setFromRotationMatrix(m);
  }
}
