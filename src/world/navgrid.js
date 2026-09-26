// Coarse walkability grid (2 m cells) + A*: long routes around walls, container yards and deep
// water, which the bots' short-range obstacle steering cannot escape on its own. Pure module.
import { F_SOLID } from "./collision.js";

const BODY_LO = 0.45; // colliders below this height above the ground can be stepped over
const BODY_HI = 1.7;
const MAX_SEG = 40; // longest straight segment kept by path smoothing (m)
const DIAG = Math.SQRT2;

export class NavGrid {
  constructor(hm, collision, cell = 2) {
    this.hm = hm;
    this.cell = cell;
    this.half = hm.half;
    const n = (this.n = Math.round(hm.size / cell));
    const blocked = (this.blocked = new Uint8Array(n * n));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) if (hm.getHeight(this.cx(i), this.cx(j)) < -1) blocked[j * n + i] = 1;
    }
    const ext = [0, 0, 0, 0];
    const yr = [0, 0];
    for (let id = 0; id < collision.count; id++) {
      if (!collision.on[id] || !(collision.flags[id] & F_SOLID)) continue;
      collision.extent(id, ext);
      collision.yRange(id, yr);
      const i0 = Math.max(0, Math.floor((ext[0] + this.half) / cell));
      const j0 = Math.max(0, Math.floor((ext[1] + this.half) / cell));
      const i1 = Math.min(n - 1, Math.floor((ext[2] + this.half) / cell));
      const j1 = Math.min(n - 1, Math.floor((ext[3] + this.half) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * n + i;
          if (blocked[k]) continue;
          const g = hm.getHeight(this.cx(i), this.cx(j));
          if (yr[1] > g + BODY_LO && yr[0] < g + BODY_HI) blocked[k] = 1;
        }
      }
    }
    // A* scratch (stamped so nothing needs clearing between searches)
    this.g = new Float32Array(n * n);
    this.parent = new Int32Array(n * n);
    this.seen = new Uint32Array(n * n);
    this.closed = new Uint32Array(n * n);
    this.stamp = 0;
    this.heapF = new Float32Array(4096);
    this.heapK = new Int32Array(4096);
    this.heapN = 0;
  }

  cx(i) {
    return (i + 0.5) * this.cell - this.half;
  }

  cellOf(x, z) {
    const n = this.n;
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  }

  free(x, z) {
    const k = this.cellOf(x, z);
    return k >= 0 && !this.blocked[k];
  }

  // segment clear of blocked cells, with a little side clearance for the body
  lineFree(x0, z0, x1, z1) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len));
    const px = len > 0 ? (-dz / len) * 0.4 : 0;
    const pz = len > 0 ? (dx / len) * 0.4 : 0;
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (dx * s) / steps;
      const z = z0 + (dz * s) / steps;
      if (!this.free(x, z) || !this.free(x + px, z + pz) || !this.free(x - px, z - pz)) return false;
    }
    return true;
  }

  // nearest free cell (spiral rings up to `maxR` cells), or -1
  nearestFree(k, maxR = 6) {
    if (k < 0) return -1;
    if (!this.blocked[k]) return k;
    const n = this.n;
    const i0 = k % n;
    const j0 = (k / n) | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bd = Infinity;
      for (let j = j0 - r; j <= j0 + r; j++) {
        for (let i = i0 - r; i <= i0 + r; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
          if (i < 0 || j < 0 || i >= n || j >= n || this.blocked[j * n + i]) continue;
          const d = (i - i0) ** 2 + (j - j0) ** 2;
          if (d < bd) {
            bd = d;
            best = j * n + i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  push(f, k) {
    if (this.heapN === this.heapF.length) {
      const F = new Float32Array(this.heapF.length * 2);
      const K = new Int32Array(this.heapK.length * 2);
      F.set(this.heapF);
      K.set(this.heapK);
      this.heapF = F;
      this.heapK = K;
    }
    const F = this.heapF;
    const K = this.heapK;
    let i = this.heapN++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= f) break;
      F[i] = F[p];
      K[i] = K[p];
      i = p;
    }
    F[i] = f;
    K[i] = k;
  }

  pop() {
    const F = this.heapF;
    const K = this.heapK;
    const top = K[0];
    const n = --this.heapN;
    const f = F[n];
    const k = K[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && F[c + 1] < F[c]) c++;
      if (F[c] >= f) break;
      F[i] = F[c];
      K[i] = K[c];
      i = c;
    }
    F[i] = f;
    K[i] = k;
    return top;
  }

  // Waypoints [{x, z}] from (x0, z0) toward (x1, z1), excluding the start. When the goal can't be
  // reached within the search budget the route ends at the explored cell closest to it.
  findPath(x0, z0, x1, z1, maxExpand = 60000) {
    const n = this.n;
    const start = this.nearestFree(this.cellOf(x0, z0));
    const exact = this.cellOf(x1, z1);
    const goal = this.nearestFree(exact);
    if (start < 0 || goal < 0) return null;
    const gi = goal % n;
    const gj = (goal / n) | 0;
    const h = (k) => {
      const di = Math.abs((k % n) - gi);
      const dj = Math.abs(((k / n) | 0) - gj);
      return (Math.max(di, dj) + (DIAG - 1) * Math.min(di, dj)) * 1.2;
    };
    const stamp = ++this.stamp;
    const { g, parent, seen, closed, blocked } = this;
    this.heapN = 0;
    g[start] = 0;
    parent[start] = -1;
    seen[start] = stamp;
    this.push(h(start), start);
    let best = start;
    let bestH = h(start);
    let expanded = 0;
    while (this.heapN > 0) {
      const cur = this.pop();
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      if (cur === goal) {
        best = cur;
        break;
      }
      const hc = h(cur);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      if (++expanded > maxExpand) break;
      const ci = cur % n;
      const cj = (cur / n) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const k = j * n + i;
          if (blocked[k] || closed[k] === stamp) continue;
          // no corner cutting past blocked cells
          if (di && dj && (blocked[cj * n + i] || blocked[j * n + ci])) continue;
          const ng = g[cur] + (di && dj ? DIAG : 1);
          if (seen[k] === stamp && ng >= g[k]) continue;
          seen[k] = stamp;
          g[k] = ng;
          parent[k] = cur;
          this.push(ng + h(k), k);
        }
      }
    }
    // cells back to the start, then string-pull into straight segments
    const cells = [];
    for (let k = best; k >= 0; k = parent[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => ({ x: this.cx(k % n), z: this.cx((k / n) | 0) }));
    pts[0] = { x: x0, z: z0 };
    if (best === goal && goal === exact) pts[pts.length - 1] = { x: x1, z: z1 };
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let j = a + 1;
      while (
        j + 1 < pts.length &&
        Math.hypot(pts[j + 1].x - pts[a].x, pts[j + 1].z - pts[a].z) < MAX_SEG &&
        this.lineFree(pts[a].x, pts[a].z, pts[j + 1].x, pts[j + 1].z)
      )
        j++;
      out.push(pts[j]);
      a = j;
    }
    return out;
  }
}
