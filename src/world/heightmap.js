// Regular-grid heightfield. Interpolation matches the rendered mesh triangulation exactly
// (each quad split along the (i, j+1)-(i+1, j) diagonal). Pure module (no three.js).

export class Heightmap {
  constructor(size, res) {
    this.size = size;
    this.res = res;
    this.cell = size / (res - 1);
    this.half = size / 2;
    this.heights = new Float32Array(res * res);
    this.maxHeight = 0;
    this.minHeight = 0;
  }

  get(i, j) {
    const r = this.res - 1;
    i = i < 0 ? 0 : i > r ? r : i;
    j = j < 0 ? 0 : j > r ? r : j;
    return this.heights[j * this.res + i];
  }

  // world x/z of sample (i, j)
  xOf(i) {
    return i * this.cell - this.half;
  }

  getHeight(x, z) {
    const res = this.res;
    let fx = (x + this.half) / this.cell;
    let fz = (z + this.half) / this.cell;
    const lim = res - 1.000001;
    fx = fx < 0 ? 0 : fx > lim ? lim : fx;
    fz = fz < 0 ? 0 : fz > lim ? lim : fz;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const H = this.heights;
    const k = j * res + i;
    const h10 = H[k + 1];
    const h01 = H[k + res];
    if (tx + tz <= 1) {
      const h00 = H[k];
      return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    }
    const h11 = H[k + res + 1];
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  // Smooth normal from central differences (bilinear-ish); out = {x, y, z}
  getNormal(x, z, out) {
    const e = this.cell;
    const hl = this.getHeight(x - e, z);
    const hr = this.getHeight(x + e, z);
    const hd = this.getHeight(x, z - e);
    const hu = this.getHeight(x, z + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const len = Math.hypot(nx, ny, nz);
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
    return out;
  }

  slopeAt(x, z) {
    const n = this.getNormal(x, z, _n);
    return 1 - n.y;
  }

  computeRange() {
    let mx = -Infinity;
    let mn = Infinity;
    const H = this.heights;
    for (let i = 0; i < H.length; i++) {
      if (H[i] > mx) mx = H[i];
      if (H[i] < mn) mn = H[i];
    }
    this.maxHeight = mx;
    this.minHeight = mn;
  }

  // Ray march against the terrain. Direction must be normalized. Returns distance or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let prevT = 0;
    let prevDiff = oy - this.getHeight(ox, oz);
    if (prevDiff <= 0) return 0;
    const step = this.cell * 0.5;
    let t = 0;
    while (t < maxDist) {
      t = Math.min(t + step, maxDist);
      const y = oy + dy * t;
      // Early out: above every possible terrain point and moving up
      if (dy >= 0 && y > this.maxHeight + 1) return -1;
      const diff = y - this.getHeight(ox + dx * t, oz + dz * t);
      if (diff <= 0) {
        // bisection refine between prevT and t
        let a = prevT;
        let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) * 0.5;
          const dm = oy + dy * m - this.getHeight(ox + dx * m, oz + dz * m);
          if (dm > 0) a = m;
          else b = m;
        }
        return (a + b) * 0.5;
      }
      prevT = t;
      prevDiff = diff;
    }
    return -1;
  }
}

const _n = { x: 0, y: 1, z: 0 };

export function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
