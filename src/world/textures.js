import * as THREE from 'three';

function make(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noise(g, w, h, base, amp, n) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * amp);
    g.fillStyle = `rgba(${v},${v},${v},0.22)`;
    g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 2);
  }
}

function facade(base, win, litChance) {
  return make(64, 64, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let fy = 0; fy < 2; fy++) {
      for (let fx = 0; fx < 4; fx++) {
        const lit = Math.random() < litChance;
        g.fillStyle = lit ? (Math.random() < 0.5 ? '#ffe8a3' : '#fff6d5') : win;
        g.fillRect(fx * 16 + 4, fy * 32 + 8, 8, 14);
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, 31, w, 1);
    g.fillRect(0, 63, w, 1);
  });
}

export const TEX = {};

export function buildTextures() {
  TEX.asphalt = make(64, 64, (g, w, h) => noise(g, w, h, '#3b3b40', 60, 300));
  TEX.sidewalk = make(64, 64, (g, w, h) => {
    g.fillStyle = '#a3a39b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 2;
    for (let i = 0; i <= w; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
    }
  });
  TEX.grass = make(64, 64, (g, w, h) => noise(g, w, h, '#4f8a3c', 80, 400));
  TEX.water = make(64, 64, (g, w, h) => noise(g, w, h, '#2a5f8f', 40, 200));
  TEX.roof = make(32, 32, (g, w, h) => noise(g, w, h, '#6a6a66', 40, 80));
  TEX.facades = [
    facade('#2b3a4f', '#8fc1e3', 0.5),  // 0 glass tower
    facade('#8a4b3b', '#2a2a2a', 0.3),  // 1 brick
    facade('#a39b86', '#30343a', 0.3),  // 2 concrete
    facade('#c7b58e', '#3b3b46', 0.35), // 3 beige
    facade('#6b7280', '#1f2937', 0.4),  // 4 slate
    facade('#b85c4a', '#2d2d2d', 0.3),  // 5 red brick
    facade('#d8c9a8', '#4a5a6a', 0.3),  // 6 cream
    facade('#3f5f7a', '#9bd0f0', 0.55), // 7 blue glass
  ];
  TEX.warehouse = make(64, 64, (g, w, h) => {
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = (y / 8) % 2 ? '#6b6d68' : '#8a8c86';
      g.fillRect(0, y, w, 8);
    }
    g.fillStyle = '#3a3c3a';
    g.fillRect(8, 40, 20, 24);
  });
  TEX.plain = make(16, 16, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
}
