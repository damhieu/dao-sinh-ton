// Procedurally painted foliage textures (canvas) for tree/bush cards.
import * as THREE from "three";

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function finish(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

// A pine branch seen from above: stem along +y (texture v), needles fanning out
export function needleTexture(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = rng(11);
  g.clearRect(0, 0, size, size);
  const stems = 5;
  for (let s = 0; s < stems; s++) {
    const x0 = size * (0.2 + 0.6 * (s / (stems - 1))) + (r() - 0.5) * 10;
    const tilt = (s - (stems - 1) / 2) * 0.12;
    const len = size * (0.75 + r() * 0.2);
    for (let i = 0; i < 70; i++) {
      const t = i / 70;
      const sx = x0 + Math.sin(tilt) * len * t;
      const sy = size - len * t - 4;
      const nl = size * 0.11 * (1 - t * 0.6) * (0.7 + r() * 0.5);
      for (const side of [-1, 1]) {
        const a = side * (0.9 + r() * 0.5) - tilt;
        const shade = 60 + r() * 60;
        g.strokeStyle = `rgb(${(shade * 0.35) | 0},${(shade * 0.85 + 25) | 0},${(shade * 0.3) | 0})`;
        g.lineWidth = 1.6 + r();
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + Math.sin(a) * nl, sy - Math.cos(a) * nl * 0.55);
        g.stroke();
      }
    }
    g.strokeStyle = "rgb(58,42,26)";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x0, size - 2);
    g.lineTo(x0 + Math.sin(tilt) * len, size - len - 4);
    g.stroke();
  }
  return finish(c);
}

// Cluster of broad leaves (round silhouette)
export function leafTexture(size = 256, hue = 0) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = rng(29 + hue);
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  for (let i = 0; i < 260; i++) {
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * size * 0.42;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    const l = size * (0.045 + r() * 0.035);
    const w = l * 0.55;
    const light = 0.55 + r() * 0.45 - (rad / size) * 0.4;
    const gr = (100 + 80 * light) | 0;
    g.fillStyle = `rgb(${(gr * (0.42 + hue * 0.1)) | 0},${gr},${(gr * 0.28) | 0})`;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.beginPath();
    g.ellipse(0, 0, l, w, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // twigs
  g.strokeStyle = "rgba(70,50,30,0.8)";
  for (let i = 0; i < 6; i++) {
    const ang = r() * Math.PI * 2;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(ang) * size * 0.3, cy + Math.sin(ang) * size * 0.3);
    g.stroke();
  }
  return finish(c);
}

// Low bush / fern-like blades
export function bushTexture(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = rng(77);
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x0 = size * (0.1 + 0.8 * r());
    const h = size * (0.35 + r() * 0.6);
    const bend = (r() - 0.5) * size * 0.4;
    const shade = 90 + r() * 90;
    g.strokeStyle = `rgb(${(shade * 0.45) | 0},${shade | 0},${(shade * 0.3) | 0})`;
    g.lineWidth = 3 + r() * 4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x0, size);
    g.quadraticCurveTo(x0 + bend * 0.3, size - h * 0.6, x0 + bend, size - h);
    g.stroke();
  }
  return finish(c);
}
