// Stylised top-down map image rendered from the heightmap, masks, trees and buildings.
import { createNoise2D } from "../core/noise.js";

export function renderMapImage(world, size = 1024) {
  const { hm, masks, maskRes, plots } = world.data;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const D = img.data;
  const px = hm.size / size;
  const noise = createNoise2D(4242);
  const n = { x: 0, y: 1, z: 0 };
  const texel = hm.size / maskRes;
  for (let j = 0; j < size; j++) {
    const z = (j + 0.5) * px - hm.half;
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * px - hm.half;
      const h = hm.getHeight(x, z);
      let r;
      let gg;
      let b;
      if (h < 0) {
        const d = Math.min(1, -h / 16);
        r = 52 - 24 * d;
        gg = 128 - 50 * d;
        b = 158 - 35 * d;
      } else {
        hm.getNormal(x, z, n);
        const slope = 1 - n.y;
        const v = noise(x * 0.01, z * 0.01) * 0.5 + 0.5;
        r = 104 + v * 18;
        gg = 136 + v * 14;
        b = 72 + v * 8;
        if (h < 2.4) {
          const t = Math.min(1, (2.4 - h) / 1.2);
          r = r + (214 - r) * t;
          gg = gg + (200 - gg) * t;
          b = b + (152 - b) * t;
        }
        if (slope > 0.28) {
          const t = Math.min(1, (slope - 0.28) / 0.12);
          r = r + (132 - r) * t;
          gg = gg + (128 - gg) * t;
          b = b + (116 - b) * t;
        }
        const mi = Math.min(maskRes - 1, Math.floor((x + hm.half) / texel));
        const mj = Math.min(maskRes - 1, Math.floor((z + hm.half) / texel));
        const road = masks.road[mj * maskRes + mi] / 255;
        const ground = masks.ground[mj * maskRes + mi] / 255;
        r = r + (168 - r) * ground * 0.5;
        gg = gg + (150 - gg) * ground * 0.5;
        b = b + (112 - b) * ground * 0.5;
        r = r + (206 - r) * road;
        gg = gg + (196 - gg) * road;
        b = b + (170 - b) * road;
        // hillshade (light from the north-west)
        const shade = 0.78 + (-n.x * 0.55 - n.z * 0.55 + n.y * 0.6) * 0.42;
        r *= shade;
        gg *= shade;
        b *= shade;
      }
      const k = (j * size + i) * 4;
      D[k] = r;
      D[k + 1] = gg;
      D[k + 2] = b;
      D[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const toPx = (v) => (v + hm.half) / px;
  // forests: darker dots under trees
  g.fillStyle = "rgba(38, 72, 30, 0.45)";
  for (const list of [world.vegetation.trees.pine, world.vegetation.trees.broad]) {
    for (const t of list) {
      g.beginPath();
      g.arc(toPx(t.x), toPx(t.z), 2.2 * t.s, 0, Math.PI * 2);
      g.fill();
    }
  }
  // buildings
  for (const b of world.buildings) {
    const [x0, , z0] = b.bounds.min;
    const [x1, , z1] = b.bounds.max;
    g.fillStyle = "rgba(60, 58, 55, 0.95)";
    g.fillRect(toPx(x0), toPx(z0), Math.max(1.5, (x1 - x0) / px), Math.max(1.5, (z1 - z0) / px));
    g.strokeStyle = "rgba(30, 28, 26, 0.9)";
    g.lineWidth = 0.6;
    g.strokeRect(toPx(x0), toPx(z0), Math.max(1.5, (x1 - x0) / px), Math.max(1.5, (z1 - z0) / px));
  }
  return c;
}
