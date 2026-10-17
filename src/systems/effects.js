import * as THREE from 'three';
import { rand } from '../util.js';

const MAX = 2500;

/** Pooled cube particles (instanced), ground decals and short-lived flash lights. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.ps = [];
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.lights = [];
    this.decalGeo = new THREE.CircleGeometry(1, 8);
    this.decalMat = new THREE.MeshBasicMaterial({ color: '#4a0808', transparent: true, opacity: 0.8, depthWrite: false });
    this.decals = [];
    this.decalMax = 90;
    this.decalIdx = 0;
    this.colorCache = new Map();
    // air ripples (bullet whiz): a few transparent rings that expand quickly, facing along the bullet's path
    this.rippleGeo = new THREE.RingGeometry(0.82, 1, 20);
    this.ripples = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.rippleGeo, new THREE.MeshBasicMaterial({ color: '#dfe9ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.ripples.push({ m, t: 0, life: 0.35 });
    }
    this.rippleIdx = 0;
    // sword slash: one flat 110 degree arc that sweeps and fades in 0.2 s; gibs: a few severed heads flung by sword kills (max 6)
    const ag = new THREE.RingGeometry(1.0, 2.2, 28, 1, -55 * Math.PI / 180, 110 * Math.PI / 180);
    ag.rotateX(-Math.PI / 2);
    this.arc = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: '#e8f4ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.arc.visible = false; this.arcT = 0; this.arcYaw = 0; this.arcSide = 0;
    scene.add(this.arc);
    this.gibs = [];
    this.gibGeo = new THREE.SphereGeometry(0.13, 8, 6);
  }
  /** Sword swing visual: a bright arc in front of (x,z) facing `yaw`, sweeping towards the side the blade travels. */
  slashArc(x, y, z, yaw, side) {
    this.arc.position.set(x, y, z);
    this.arcT = 0.2; this.arcYaw = yaw; this.arcSide = side ? -1 : 1;
    this.arc.visible = true;
  }
  /** A severed head (skin coloured ball) that tumbles away leaving blood drops. */
  gib(x, y, z, vx, vz, color = '#e0ac69') {
    if (this.gibs.length >= 6) { const o = this.gibs.shift(); this.scene.remove(o.m); o.m.material.dispose(); }
    const m = new THREE.Mesh(this.gibGeo, new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.gibs.push({ m, vx, vy: 4.5, vz, t: 7, drip: 0 });
  }
  /** Tiny expanding ring at (x,y,z), facing along (dx,dy,dz); recycles the oldest of 8. */
  ripple(x, y, z, dx, dy, dz) {
    const r = this.ripples[this.rippleIdx++ % this.ripples.length];
    r.t = r.life; r.m.visible = true;
    r.m.position.set(x, y, z);
    this._p.set(x + dx, y + dy, z + dz);
    r.m.lookAt(this._p);
    r.m.scale.setScalar(0.1);
    r.m.material.opacity = 0.55;
  }

  spawn(x, y, z, vx, vy, vz, life, color, size, grav = 20, drag = 1) {
    if (this.ps.length >= MAX) this.ps.shift();
    this.ps.push({ x, y, z, vx, vy, vz, life, t: life, color, size, grav, drag });
  }
  burst(x, y, z, n, speed, color, life, size, o = {}) {
    const minUp = o.minUp ?? -0.3, maxUp = o.maxUp ?? 1;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), e = rand(minUp, maxUp), s = speed * rand(0.3, 1);
      const h = 1 - Math.abs(e) * 0.5;
      this.spawn(x, y, z, Math.cos(a) * s * h, e * s, Math.sin(a) * s * h, life * rand(0.5, 1.2), color, size * rand(0.6, 1.4), o.grav ?? 20, o.drag ?? 1);
    }
  }
  explosion(x, y, z, r = 6) {
    this.burst(x, y, z, 60, r * 2.4, '#ff8c1a', 0.9, 0.7, { grav: 6 });
    this.burst(x, y, z, 35, r * 1.6, '#ffe066', 0.5, 0.5, { grav: 4 });
    this.burst(x, y, z, 45, r, '#2b2b2b', 3.2, 1.3, { grav: -2.5, drag: 0.7, minUp: 0.2 });
    this.burst(x, y, z, 25, r * 3, '#555', 1.5, 0.3, { grav: 25 });
    this.flash(x, y, z, '#ffb060', 40, 0.3);
  }
  blood(x, y, z) {
    this.burst(x, y, z, 12, 4, '#b3121b', 0.6, 0.16, { grav: 18 });
    this.decal(x, z, rand(0.5, 1.2));
  }
  spark(x, y, z) { this.burst(x, y, z, 6, 6, '#ffd166', 0.3, 0.08, { grav: 20 }); }
  dust(x, y, z) { this.burst(x, y, z, 5, 2, '#8a8a80', 0.5, 0.2, { grav: 4, minUp: 0.2 }); }
  smoke(x, y, z, dark = false) {
    this.spawn(x + rand(-0.3, 0.3), y, z + rand(-0.3, 0.3), rand(-0.5, 0.5), rand(1.5, 2.5), rand(-0.5, 0.5), rand(1.2, 2.2), dark ? '#222' : '#777', rand(0.4, 0.9), -1, 0.8);
  }
  muzzle(x, y, z) {
    this.burst(x, y, z, 5, 4, '#fff2a0', 0.07, 0.14, { grav: 0 });
    this.flash(x, y, z, '#ffd27a', 8, 0.06);
  }
  flash(x, y, z, color, intensity, t) {
    if (this.lights.length > 6) { const o = this.lights.shift(); this.scene.remove(o.l); }
    const l = new THREE.PointLight(color, intensity, 50, 1.6);
    l.position.set(x, y + 1.5, z);
    this.scene.add(l);
    this.lights.push({ l, t, t0: t });
  }
  decal(x, z, s) {
    let d;
    if (this.decals.length < this.decalMax) {
      d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.rotation.x = -Math.PI / 2;
      this.scene.add(d);
      this.decals.push(d);
    } else d = this.decals[this.decalIdx++ % this.decalMax];
    d.position.set(x, 0.035 + Math.random() * 0.01, z);
    d.scale.setScalar(s);
    d.rotation.z = rand(0, 6.28);
  }
  color(c) {
    let v = this.colorCache.get(c);
    if (!v) { v = new THREE.Color(c); this.colorCache.set(c, v); }
    return v;
  }
  update(dt) {
    if (this.arcT > 0) {
      this.arcT -= dt;
      if (this.arcT <= 0) this.arc.visible = false;
      else {
        const k = 1 - this.arcT / 0.2;
        this.arc.rotation.y = this.arcYaw - Math.PI / 2 + this.arcSide * 0.9 * (0.5 - k);
        this.arc.material.opacity = 0.75 * (1 - k);
        this.arc.scale.setScalar(0.85 + 0.25 * k);
      }
    }
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const o = this.gibs[i], m = o.m;
      o.t -= dt;
      if (o.t <= 0) { this.scene.remove(m); m.material.dispose(); this.gibs.splice(i, 1); continue; }
      if (m.position.y > 0.14 || o.vy > 0) {
        o.vy -= 22 * dt;
        m.position.x += o.vx * dt; m.position.y += o.vy * dt; m.position.z += o.vz * dt;
        o.drip -= dt;
        if (o.drip <= 0) { o.drip = 0.06; this.spawn(m.position.x, m.position.y, m.position.z, 0, 0, 0, 0.5, '#b3121b', 0.1, 18, 1); }
        if (m.position.y <= 0.13) { m.position.y = 0.13; if (o.vy < -2) { o.vy *= -0.3; o.vx *= 0.5; o.vz *= 0.5; this.decal(m.position.x, m.position.z, rand(0.4, 0.8)); } else { o.vy = 0; o.vx = o.vz = 0; } }
      }
    }
    for (const r of this.ripples) {
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.t / r.life;
      r.m.scale.setScalar(0.1 + 0.9 * (1 - (1 - k) * (1 - k)));
      r.m.material.opacity = 0.55 * (1 - k);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const o = this.lights[i];
      o.t -= dt;
      o.l.intensity = Math.max(0, o.t / o.t0) * o.l.intensity;
      if (o.t <= 0) { this.scene.remove(o.l); this.lights.splice(i, 1); }
    }
    const ps = this.ps;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t -= dt;
      if (p.t <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); i--; continue; }
      p.vy -= p.grav * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const s = p.size * Math.min(1, p.t / p.life + 0.2);
      this._p.set(p.x, p.y, p.z); this._s.set(s, s, s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n, this.color(p.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
