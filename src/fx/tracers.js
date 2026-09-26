// Bullet tracers: camera-facing ribbons from tail to head, rebuilt each frame (small pool).
import * as THREE from "three";

const MAX = 96;

export class Tracers {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 4 * 3);
    this.col = new Float32Array(MAX * 4 * 4);
    const idx = [];
    for (let i = 0; i < MAX; i++) {
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.list = [];
  }

  // bullet: object with x,y,z,vx,vy,vz (live); the tracer follows it until it dies
  add(bullet, color = [1.0, 0.72, 0.35], intensity = 5) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({ b: bullet, color, intensity, age: 0 });
  }

  update(dt, camera) {
    const cam = camera.position;
    let n = 0;
    const keep = [];
    for (const t of this.list) {
      t.age += dt;
      const b = t.b;
      if (!b.alive && t.age > 0.02) continue;
      keep.push(t);
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const len = Math.min(18, sp * 0.028, b.dist + 0.2);
      const hx = b.x;
      const hy = b.y;
      const hz = b.z;
      const tx = hx - (b.vx / sp) * len;
      const ty = hy - (b.vy / sp) * len;
      const tz = hz - (b.vz / sp) * len;
      // side vector: perpendicular to the segment and the view direction
      const mx = (hx + tx) / 2 - cam.x;
      const my = (hy + ty) / 2 - cam.y;
      const mz = (hz + tz) / 2 - cam.z;
      const dx = hx - tx;
      const dy = hy - ty;
      const dz = hz - tz;
      let sx = dy * mz - dz * my;
      let sy = dz * mx - dx * mz;
      let sz = dx * my - dy * mx;
      const dist = Math.hypot(mx, my, mz);
      const w = Math.max(0.012, dist * 0.0022);
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx = (sx / sl) * w;
      sy = (sy / sl) * w;
      sz = (sz / sl) * w;
      const o = n * 12;
      const P = this.pos;
      P[o] = tx - sx;
      P[o + 1] = ty - sy;
      P[o + 2] = tz - sz;
      P[o + 3] = tx + sx;
      P[o + 4] = ty + sy;
      P[o + 5] = tz + sz;
      P[o + 6] = hx + sx;
      P[o + 7] = hy + sy;
      P[o + 8] = hz + sz;
      P[o + 9] = hx - sx;
      P[o + 10] = hy - sy;
      P[o + 11] = hz - sz;
      const c = n * 16;
      const [r, g, bl] = t.color;
      const I = t.intensity;
      for (let k = 0; k < 4; k++) {
        const head = k >= 2 ? 1 : 0.0;
        this.col[c + k * 4] = r * I * head;
        this.col[c + k * 4 + 1] = g * I * head;
        this.col[c + k * 4 + 2] = bl * I * head;
        this.col[c + k * 4 + 3] = 1;
      }
      n++;
    }
    this.list = keep;
    this.geo.setDrawRange(0, n * 6);
    if (n) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }
}
