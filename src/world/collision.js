// Static collision world: heightfield + axis-aligned boxes + vertical cylinders + spheres,
// indexed by a uniform XZ grid. Pure module (no three.js).

export const F_SOLID = 1; // blocks movement
export const F_BULLET = 2; // blocks bullets
export const F_VISION = 4; // blocks line of sight
export const F_ALL = 7;

export const MAT = { terrain: 0, wood: 1, metal: 2, concrete: 3, flesh: 4, foliage: 5, glass: 6, water: 7 };

const K_BOX = 0;
const K_CYL = 1;
const K_SPHERE = 2;
const STRIDE = 6;

export class CollisionWorld {
  constructor(hm, cellSize = 8, seaLevel = 0, swimDepth = 1.3) {
    this.hm = hm;
    this.cell = cellSize;
    this.half = hm.half;
    this.n = Math.ceil(hm.size / cellSize);
    this.grid = new Array(this.n * this.n).fill(null);
    this.cap = 0;
    this.count = 0;
    this.sea = seaLevel;
    this.swimDepth = swimDepth;
    this.grow(65536);
    this.stampId = 1;
    this.hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: "", id: -1, mat: 0 };
  }

  grow(cap) {
    const d = new Float32Array(cap * STRIDE);
    const kind = new Uint8Array(cap);
    const flags = new Uint8Array(cap);
    const mat = new Uint8Array(cap);
    const on = new Uint8Array(cap);
    const stamp = new Uint32Array(cap);
    if (this.cap) {
      d.set(this.data);
      kind.set(this.kind);
      flags.set(this.flags);
      mat.set(this.mat);
      on.set(this.on);
    }
    this.data = d;
    this.kind = kind;
    this.flags = flags;
    this.mat = mat;
    this.on = on;
    this.stamp = stamp;
    this.cap = cap;
  }

  // XZ extent of collider id
  extent(id, out) {
    const o = id * STRIDE;
    const D = this.data;
    const k = this.kind[id];
    if (k === K_BOX) {
      out[0] = D[o];
      out[1] = D[o + 2];
      out[2] = D[o + 3];
      out[3] = D[o + 5];
    } else if (k === K_CYL) {
      out[0] = D[o] - D[o + 2];
      out[1] = D[o + 1] - D[o + 2];
      out[2] = D[o] + D[o + 2];
      out[3] = D[o + 1] + D[o + 2];
    } else {
      out[0] = D[o] - D[o + 3];
      out[1] = D[o + 2] - D[o + 3];
      out[2] = D[o] + D[o + 3];
      out[3] = D[o + 2] + D[o + 3];
    }
    return out;
  }

  // vertical extent [minY, maxY] of collider id
  yRange(id, out) {
    const o = id * STRIDE;
    const D = this.data;
    const k = this.kind[id];
    if (k === K_BOX) {
      out[0] = D[o + 1];
      out[1] = D[o + 4];
    } else if (k === K_CYL) {
      out[0] = D[o + 3];
      out[1] = D[o + 4];
    } else {
      out[0] = D[o + 1] - D[o + 3];
      out[1] = D[o + 1] + D[o + 3];
    }
    return out;
  }

  cellRange(minX, minZ, maxX, maxZ, out) {
    const c = this.cell;
    const n = this.n - 1;
    out[0] = Math.max(0, Math.min(n, Math.floor((minX + this.half) / c)));
    out[1] = Math.max(0, Math.min(n, Math.floor((minZ + this.half) / c)));
    out[2] = Math.max(0, Math.min(n, Math.floor((maxX + this.half) / c)));
    out[3] = Math.max(0, Math.min(n, Math.floor((maxZ + this.half) / c)));
    return out;
  }

  register(id, add) {
    const e = this.extent(id, _ext);
    const r = this.cellRange(e[0], e[1], e[2], e[3], _rng);
    for (let j = r[1]; j <= r[3]; j++) {
      for (let i = r[0]; i <= r[2]; i++) {
        const k = j * this.n + i;
        if (add) {
          if (!this.grid[k]) this.grid[k] = [];
          this.grid[k].push(id);
        } else if (this.grid[k]) {
          const list = this.grid[k];
          const at = list.indexOf(id);
          if (at >= 0) list.splice(at, 1);
        }
      }
    }
  }

  alloc(kind, flags, mat) {
    if (this.count >= this.cap) this.grow(this.cap * 2);
    const id = this.count++;
    this.kind[id] = kind;
    this.flags[id] = flags;
    this.mat[id] = mat;
    this.on[id] = 1;
    return id;
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, flags = F_ALL, mat = MAT.concrete) {
    const id = this.alloc(K_BOX, flags, mat);
    const o = id * STRIDE;
    const D = this.data;
    D[o] = Math.min(minX, maxX);
    D[o + 1] = Math.min(minY, maxY);
    D[o + 2] = Math.min(minZ, maxZ);
    D[o + 3] = Math.max(minX, maxX);
    D[o + 4] = Math.max(minY, maxY);
    D[o + 5] = Math.max(minZ, maxZ);
    this.register(id, true);
    return id;
  }

  setBox(id, minX, minY, minZ, maxX, maxY, maxZ) {
    this.register(id, false);
    const o = id * STRIDE;
    const D = this.data;
    D[o] = Math.min(minX, maxX);
    D[o + 1] = Math.min(minY, maxY);
    D[o + 2] = Math.min(minZ, maxZ);
    D[o + 3] = Math.max(minX, maxX);
    D[o + 4] = Math.max(minY, maxY);
    D[o + 5] = Math.max(minZ, maxZ);
    this.register(id, true);
  }

  setEnabled(id, enabled) {
    this.on[id] = enabled ? 1 : 0;
  }

  addCylinder(x, z, r, y0, y1, flags = F_ALL, mat = MAT.wood) {
    const id = this.alloc(K_CYL, flags, mat);
    const o = id * STRIDE;
    const D = this.data;
    D[o] = x;
    D[o + 1] = z;
    D[o + 2] = r;
    D[o + 3] = y0;
    D[o + 4] = y1;
    this.register(id, true);
    return id;
  }

  addSphere(x, y, z, r, flags = F_ALL, mat = MAT.concrete) {
    const id = this.alloc(K_SPHERE, flags, mat);
    const o = id * STRIDE;
    const D = this.data;
    D[o] = x;
    D[o + 1] = y;
    D[o + 2] = z;
    D[o + 3] = r;
    this.register(id, true);
    return id;
  }

  // Calls fn(id) for each enabled collider (optionally filtered by flags) overlapping the XZ rectangle.
  query(minX, minZ, maxX, maxZ, mask, fn) {
    const r = this.cellRange(minX, minZ, maxX, maxZ, _rng2);
    const s = ++this.stampId;
    const st = this.stamp;
    for (let j = r[1]; j <= r[3]; j++) {
      for (let i = r[0]; i <= r[2]; i++) {
        const list = this.grid[j * this.n + i];
        if (!list) continue;
        for (let q = 0; q < list.length; q++) {
          const id = list[q];
          if (st[id] === s) continue;
          st[id] = s;
          if (!this.on[id] || !(this.flags[id] & mask)) continue;
          fn(id);
        }
      }
    }
  }

  // ------------------------------------------------------------------ raycast

  // Direction must be normalized. Returns true on hit and fills `hit` (nearest).
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask = F_BULLET, hit = this.hit, skipTerrain = false) {
    let best = maxDist;
    let found = false;
    if (!skipTerrain) {
      const tt = this.hm.raycast(ox, oy, oz, dx, dy, dz, maxDist);
      if (tt >= 0 && tt <= best) {
        best = tt;
        found = true;
        hit.kind = "terrain";
        hit.id = -1;
        hit.mat = MAT.terrain;
        const n = this.hm.getNormal(ox + dx * tt, oz + dz * tt, _n);
        hit.nx = n.x;
        hit.ny = n.y;
        hit.nz = n.z;
      }
    }
    // DDA over grid cells in XZ
    const c = this.cell;
    const N = this.n;
    let gx = (ox + this.half) / c;
    let gz = (oz + this.half) / c;
    let ix = Math.floor(gx);
    let iz = Math.floor(gz);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(c / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(c / dz) : Infinity;
    let tMaxX = stepX > 0 ? (ix + 1 - gx) * tDeltaX : stepX < 0 ? (gx - ix) * tDeltaX : Infinity;
    let tMaxZ = stepZ > 0 ? (iz + 1 - gz) * tDeltaZ : stepZ < 0 ? (gz - iz) * tDeltaZ : Infinity;
    const s = ++this.stampId;
    const st = this.stamp;
    let tCell = 0;
    for (let guard = 0; guard < 4096; guard++) {
      if (tCell > best) break;
      if (ix >= 0 && iz >= 0 && ix < N && iz < N) {
        const list = this.grid[iz * N + ix];
        if (list) {
          for (let q = 0; q < list.length; q++) {
            const id = list[q];
            if (st[id] === s) continue;
            st[id] = s;
            if (!this.on[id] || !(this.flags[id] & mask)) continue;
            const t = this.rayCollider(id, ox, oy, oz, dx, dy, dz, best);
            if (t >= 0 && t < best) {
              best = t;
              found = true;
              hit.kind = this.kind[id] === K_BOX ? "box" : this.kind[id] === K_CYL ? "cyl" : "sphere";
              hit.id = id;
              hit.mat = this.mat[id];
              hit.nx = _rn[0];
              hit.ny = _rn[1];
              hit.nz = _rn[2];
            }
          }
        }
      } else if (
        (stepX > 0 && ix >= N) ||
        (stepX < 0 && ix < 0) ||
        (stepZ > 0 && iz >= N) ||
        (stepZ < 0 && iz < 0)
      ) {
        break;
      }
      if (stepX === 0 && stepZ === 0) break;
      if (tMaxX < tMaxZ) {
        tCell = tMaxX;
        tMaxX += tDeltaX;
        ix += stepX;
      } else {
        tCell = tMaxZ;
        tMaxZ += tDeltaZ;
        iz += stepZ;
      }
    }
    if (found) {
      hit.t = best;
      hit.x = ox + dx * best;
      hit.y = oy + dy * best;
      hit.z = oz + dz * best;
    }
    return found;
  }

  // Line of sight between two points (true if nothing blocks)
  visible(ax, ay, az, bx, by, bz, mask = F_VISION) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, mask, _losHit);
  }

  // Returns hit distance along the ray or -1; writes the hit normal into _rn.
  rayCollider(id, ox, oy, oz, dx, dy, dz, maxT) {
    const o = id * STRIDE;
    const D = this.data;
    const k = this.kind[id];
    if (k === K_BOX) {
      // slab test without allocations
      let tmin = 0;
      let tmax = maxT;
      let axis = -1;
      let sign = 0;
      for (let a = 0; a < 3; a++) {
        const lo = D[o + a];
        const hi = D[o + 3 + a];
        const oa = a === 0 ? ox : a === 1 ? oy : oz;
        const da = a === 0 ? dx : a === 1 ? dy : dz;
        if (da > -1e-9 && da < 1e-9) {
          if (oa < lo || oa > hi) return -1;
          continue;
        }
        let t1 = (lo - oa) / da;
        let t2 = (hi - oa) / da;
        let sg = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          sg = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = a;
          sign = sg;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
      _rn[0] = _rn[1] = _rn[2] = 0;
      if (axis >= 0) _rn[axis] = sign;
      else _rn[1] = 1; // origin inside the box
      return tmin;
    }
    if (k === K_CYL) {
      const cx = D[o];
      const cz = D[o + 1];
      const r = D[o + 2];
      const y0 = D[o + 3];
      const y1 = D[o + 4];
      const fx = ox - cx;
      const fz = oz - cz;
      const a = dx * dx + dz * dz;
      let best = -1;
      if (a > 1e-9) {
        const b = fx * dx + fz * dz;
        const c = fx * fx + fz * fz - r * r;
        const disc = b * b - a * c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          let t = (-b - sq) / a;
          if (t < 0 && c < 0) t = 0; // inside
          if (t >= 0 && t <= maxT) {
            const y = oy + dy * t;
            if (y >= y0 && y <= y1) {
              best = t;
              const nx = fx + dx * t;
              const nz = fz + dz * t;
              const l = Math.hypot(nx, nz) || 1;
              _rn[0] = nx / l;
              _rn[1] = 0;
              _rn[2] = nz / l;
            }
          }
        }
      }
      // top cap
      if (dy < -1e-9) {
        const t = (y1 - oy) / dy;
        if (t >= 0 && t <= maxT && (best < 0 || t < best)) {
          const px = fx + dx * t;
          const pz = fz + dz * t;
          if (px * px + pz * pz <= r * r) {
            best = t;
            _rn[0] = 0;
            _rn[1] = 1;
            _rn[2] = 0;
          }
        }
      }
      return best;
    }
    // sphere
    const fx = ox - D[o];
    const fy = oy - D[o + 1];
    const fz = oz - D[o + 2];
    const r = D[o + 3];
    const b = fx * dx + fy * dy + fz * dz;
    const c = fx * fx + fy * fy + fz * fz - r * r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) {
      if (c < 0) t = 0;
      else return -1;
    }
    if (t > maxT) return -1;
    const px = fx + dx * t;
    const py = fy + dy * t;
    const pz = fz + dz * t;
    const l = Math.hypot(px, py, pz) || 1;
    _rn[0] = px / l;
    _rn[1] = py / l;
    _rn[2] = pz / l;
    return t;
  }

  // ------------------------------------------------------------------ support queries

  // Highest walkable surface under the circle whose top is <= maxY (terrain always counts).
  groundAt(x, z, r, maxY) {
    let g = this.hm.getHeight(x, z);
    const D = this.data;
    this.query(x - r, z - r, x + r, z + r, F_SOLID, (id) => {
      const o = id * STRIDE;
      const k = this.kind[id];
      if (k === K_BOX) {
        const top = D[o + 4];
        if (top > maxY || top <= g) return;
        if (x + r > D[o] && x - r < D[o + 3] && z + r > D[o + 2] && z - r < D[o + 5]) g = top;
      } else if (k === K_SPHERE) {
        const dx = x - D[o];
        const dz = z - D[o + 2];
        const rr = D[o + 3] * D[o + 3] - (dx * dx + dz * dz);
        if (rr <= 0) return;
        const top = D[o + 1] + Math.sqrt(rr);
        if (top <= maxY && top > g) g = top;
      } else {
        // cylinders (trunks/poles) are not walkable
      }
    });
    return g;
  }

  // Lowest box bottom above minY overlapping the circle (Infinity if none).
  ceilingAt(x, z, r, minY) {
    let c = Infinity;
    const D = this.data;
    this.query(x - r, z - r, x + r, z + r, F_SOLID, (id) => {
      if (this.kind[id] !== K_BOX) return;
      const o = id * STRIDE;
      const bottom = D[o + 1];
      if (bottom < minY || bottom >= c) return;
      if (x + r > D[o] && x - r < D[o + 3] && z + r > D[o + 2] && z - r < D[o + 5]) c = bottom;
    });
    return c;
  }

  // Push a vertical capsule (circle radius r, vertical span [y0, y1]) out of solid colliders in XZ.
  // Adjusts b.x/b.z and removes velocity into surfaces. Returns true if anything was hit.
  pushOut(b, y0, y1) {
    const r = b.r;
    const D = this.data;
    let hitAny = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(b.x - r, b.z - r, b.x + r, b.z + r, F_SOLID, (id) => {
        const o = id * STRIDE;
        const k = this.kind[id];
        let nx = 0;
        let nz = 0;
        let pen = 0;
        if (k === K_BOX) {
          if (D[o + 4] <= y0 || D[o + 1] >= y1) return;
          const cx = b.x < D[o] ? D[o] : b.x > D[o + 3] ? D[o + 3] : b.x;
          const cz = b.z < D[o + 2] ? D[o + 2] : b.z > D[o + 5] ? D[o + 5] : b.z;
          const dx = b.x - cx;
          const dz = b.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            pen = r - d;
          } else {
            // center inside the box: exit through the nearest side
            const l = b.x - D[o];
            const rr = D[o + 3] - b.x;
            const f = b.z - D[o + 2];
            const bk = D[o + 5] - b.z;
            const m = Math.min(l, rr, f, bk);
            if (m === l) ((nx = -1), (pen = l + r));
            else if (m === rr) ((nx = 1), (pen = rr + r));
            else if (m === f) ((nz = -1), (pen = f + r));
            else ((nz = 1), (pen = bk + r));
          }
        } else if (k === K_CYL) {
          if (D[o + 4] <= y0 || D[o + 3] >= y1) return;
          const dx = b.x - D[o];
          const dz = b.z - D[o + 1];
          const rr = r + D[o + 2];
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) return;
          const d = Math.sqrt(d2) || 1e-5;
          nx = dx / d;
          nz = dz / d;
          pen = rr - d;
        } else {
          // sphere: horizontal radius over the capsule's vertical span
          const sy = D[o + 1];
          const R = D[o + 3];
          const dy = sy < y0 ? y0 - sy : sy > y1 ? sy - y1 : 0;
          if (dy >= R) return;
          const hr = Math.sqrt(R * R - dy * dy);
          const dx = b.x - D[o];
          const dz = b.z - D[o + 2];
          const rr = r + hr;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) return;
          const d = Math.sqrt(d2) || 1e-5;
          nx = dx / d;
          nz = dz / d;
          pen = rr - d;
        }
        b.x += nx * pen;
        b.z += nz * pen;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= vn * nx;
          b.vz -= vn * nz;
        }
        moved = true;
        hitAny = true;
      });
      if (!moved) break;
    }
    return hitAny;
  }

  // Integrate a character body with gravity and collisions.
  // b = {x,y,z, vx,vy,vz, r, h, stepUp, onGround, inWater}; gravity applied when airborne.
  moveBody(b, dt, gravity) {
    const sp = Math.max(Math.abs(b.vx), Math.abs(b.vz), Math.abs(b.vy));
    const steps = Math.max(1, Math.min(10, Math.ceil((sp * dt) / (b.r * 0.5))));
    const h = dt / steps;
    const snap = 0.5;
    b.hitWall = false;
    for (let s = 0; s < steps; s++) {
      if (!b.onGround || b.vy > 0) b.vy -= gravity * h;
      if (b.inWater && b.vy < 0) b.vy = Math.max(b.vy, -2);
      b.x += b.vx * h;
      b.z += b.vz * h;
      if (this.pushOut(b, b.y + b.stepUp, b.y + b.h)) b.hitWall = true;
      const ground = this.groundAt(b.x, b.z, b.r * 0.85, b.y + b.stepUp);
      let ny = b.y + b.vy * h;
      if (b.vy <= 0 && ny <= ground + (b.onGround ? snap : 0)) {
        ny = ground;
        b.vy = 0;
        b.onGround = true;
      } else if (ny > ground + (b.onGround ? snap : 0.001)) {
        b.onGround = false;
      }
      b.y = ny;
      const ceil = this.ceilingAt(b.x, b.z, b.r * 0.85, b.y + 0.2);
      if (b.y + b.h > ceil) {
        b.y = Math.max(ground, ceil - b.h);
        if (b.vy > 0) b.vy = 0;
      }
      // water: float at the surface
      const swimY = this.sea - this.swimDepth;
      if (ground < swimY && b.y <= swimY + 0.05) {
        b.y = swimY;
        if (b.vy < 0) b.vy = 0;
        b.inWater = true;
        b.onGround = false;
      } else if (b.inWater && (ground >= swimY || b.y > swimY + 0.3)) {
        b.inWater = false;
      }
    }
    return b;
  }
}

const _ext = [0, 0, 0, 0];
const _rng = [0, 0, 0, 0];
const _rng2 = [0, 0, 0, 0];
const _rn = [0, 0, 0];
const _n = { x: 0, y: 1, z: 0 };
const _losHit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: "", id: -1, mat: 0 };
