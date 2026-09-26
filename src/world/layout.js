// Island shape, named locations, roads, building plots, vehicle spawns and splat masks.
// Pure module (no three.js).
import { createNoise2D, fbm2, ridged2 } from "../core/noise.js";
import { smoothstep, lerp } from "./heightmap.js";

export const ISLAND_R = 860;
export const ROAD_HALF_WIDTH = 3.5;

// North is -z. u = east (+x), v = south (+z), both relative to ISLAND_R.
export const TOWNS = [
  { id: "oldtown", name: "Phố Cổ", kind: "oldtown", tier: 2, u: 0.0, v: 0.05, radius: 150 },
  { id: "port", name: "Cảng Hải Âu", kind: "port", tier: 2, u: 0.6, v: -0.56, radius: 150, coastal: true },
  {
    id: "fishing",
    name: "Làng Chài",
    kind: "fishing",
    tier: 1,
    u: -0.74,
    v: 0.26,
    radius: 110,
    coastal: true,
  },
  { id: "military", name: "Căn Cứ Quân Sự", kind: "military", tier: 3, u: 0.3, v: 0.72, radius: 150 },
  { id: "factory", name: "Nhà Máy Điện", kind: "factory", tier: 2, u: 0.72, v: 0.14, radius: 135 },
  { id: "radar", name: "Trạm Radar", kind: "radar", tier: 2, u: -0.44, v: -0.44, radius: 80, hilltop: true },
  { id: "farm", name: "Nông Trại", kind: "farm", tier: 1, u: -0.36, v: 0.6, radius: 120 },
  { id: "school", name: "Trường Học", kind: "school", tier: 2, u: 0.06, v: -0.6, radius: 110 },
];

const ISLETS = [
  [-0.22, -1.08, 75],
  [1.05, 0.5, 60],
  [-1.03, -0.6, 65],
];

// Footprint of each building type (local width along x, depth along z; front door faces local +z)
export const BUILDING_TYPES = {
  house_small: { w: 9, d: 8 },
  house_two: { w: 11, d: 10 },
  apartment: { w: 22, d: 12 },
  warehouse: { w: 20, d: 28 },
  containers: { w: 8, d: 13 },
  shed: { w: 5, d: 6 },
  barracks: { w: 10, d: 24 },
  school: { w: 36, d: 14 },
  tower: { w: 4, d: 4 },
  factory_hall: { w: 26, d: 40 },
  barn: { w: 12, d: 18 },
};

const RECIPES = {
  oldtown: [
    ["apartment", 3],
    ["house_two", 14],
    ["house_small", 13],
    ["shed", 4],
  ],
  port: [
    ["warehouse", 5],
    ["house_two", 2],
    ["containers", 14],
    ["shed", 3],
  ],
  fishing: [
    ["house_two", 3],
    ["house_small", 10],
    ["shed", 5],
  ],
  military: [
    ["barracks", 6],
    ["warehouse", 2],
    ["house_two", 2],
    ["containers", 5],
    ["tower", 5],
  ],
  factory: [
    ["factory_hall", 3],
    ["warehouse", 2],
    ["containers", 5],
    ["shed", 3],
  ],
  radar: [
    ["barracks", 1],
    ["house_two", 2],
    ["tower", 1],
    ["shed", 2],
  ],
  farm: [
    ["barn", 2],
    ["house_two", 2],
    ["house_small", 4],
    ["shed", 3],
  ],
  school: [
    ["school", 1],
    ["house_two", 3],
    ["house_small", 4],
    ["shed", 1],
  ],
};

// ---------------------------------------------------------------- base terrain

export function generateBaseTerrain(hm, seed) {
  const nWarp = createNoise2D(seed + 11);
  const nWarp2 = createNoise2D(seed + 12);
  const nHills = createNoise2D(seed + 13);
  const nRidge = createNoise2D(seed + 14);
  const nMount = createNoise2D(seed + 15);
  const nDetail = createNoise2D(seed + 16);
  const { res, heights } = hm;
  for (let j = 0; j < res; j++) {
    const z = hm.xOf(j);
    for (let i = 0; i < res; i++) {
      const x = hm.xOf(i);
      const warp =
        fbm2(nWarp, x * 0.0011, z * 0.0011, 4) * 0.3 + fbm2(nWarp2, x * 0.0045, z * 0.0045, 3) * 0.07;
      let land = smoothstep(1.02, 0.78, Math.hypot(x, z) / ISLAND_R + warp);
      for (const [u, v, rad] of ISLETS) {
        const di = Math.hypot(x - u * ISLAND_R, z - v * ISLAND_R) / rad + warp * 0.6;
        land = Math.max(land, smoothstep(1.0, 0.45, di) * 0.62);
      }
      let h;
      if (land < 0.3) {
        h = -18 * Math.pow(1 - land / 0.3, 1.4);
      } else {
        const hills = fbm2(nHills, x * 0.0021, z * 0.0021, 5) * 0.5 + 0.5;
        const mount = smoothstep(0.35, 0.75, fbm2(nMount, x * 0.0008 + 5.2, z * 0.0008 - 1.7, 3) * 0.5 + 0.5);
        const ridge = ridged2(nRidge, x * 0.0017 + 3.1, z * 0.0017 - 7.3, 5);
        const detail = fbm2(nDetail, x * 0.018, z * 0.018, 3);
        const hLand = 1.5 + hills * hills * 50 + Math.pow(ridge, 2.2) * 95 * mount + detail * 1.2;
        const s = smoothstep(0.3, 1.0, land);
        h = hLand * Math.pow(s, 1.25);
      }
      heights[j * res + i] = h;
    }
  }
  hm.computeRange();
}

// ---------------------------------------------------------------- helpers

function areaStats(hm, x, z, r) {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  let min = Infinity;
  for (let dz = -r; dz <= r; dz += 8) {
    for (let dx = -r; dx <= r; dx += 8) {
      if (dx * dx + dz * dz > r * r) continue;
      const h = hm.getHeight(x + dx, z + dz);
      sum += h;
      sum2 += h * h;
      n++;
      if (h < min) min = h;
    }
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), min };
}

function distanceToSea(hm, x, z, maxR) {
  for (let r = 16; r <= maxR; r += 16) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      if (hm.getHeight(x + Math.cos(ang) * r, z + Math.sin(ang) * r) < 0) return r;
    }
  }
  return -1;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + vx * t);
  const dz = pz - (az + vz * t);
  _seg.t = t;
  return Math.sqrt(dx * dx + dz * dz);
}
const _seg = { t: 0 };

// ---------------------------------------------------------------- towns

export function placeTowns(hm) {
  const towns = [];
  for (const def of TOWNS) {
    const px = def.u * ISLAND_R;
    const pz = def.v * ISLAND_R;
    const search = def.hilltop ? 220 : 160;
    let best = null;
    let bestScore = Infinity;
    for (let dz = -search; dz <= search; dz += 16) {
      for (let dx = -search; dx <= search; dx += 16) {
        if (dx * dx + dz * dz > search * search) continue;
        const x = px + dx;
        const z = pz + dz;
        if (hm.getHeight(x, z) < 2.5) continue;
        const st = areaStats(hm, x, z, def.radius * 0.7);
        if (st.min < 1.2) continue;
        let score = def.hilltop ? -st.mean + st.std * 2 : st.std * 3 + Math.hypot(dx, dz) * 0.01;
        if (def.coastal) {
          const sea = distanceToSea(hm, x, z, 280);
          score += sea < 0 ? 1000 : Math.abs(sea - def.radius * 1.05) * 0.06 + Math.max(0, st.mean - 7) * 0.6;
        }
        for (const t of towns) {
          if (Math.hypot(t.x - x, t.z - z) < t.radius + def.radius + 70) score += 1000;
        }
        if (score < bestScore) {
          bestScore = score;
          best = { x, z, mean: st.mean };
        }
      }
    }
    if (!best) best = { x: px, z: pz, mean: Math.max(3, hm.getHeight(px, pz)) };
    towns.push({ ...def, x: best.x, z: best.z, y: Math.max(best.mean, 2.5) });
  }
  return towns;
}

export function flattenTowns(hm, towns) {
  const { res, heights } = hm;
  for (const t of towns) {
    const reach = t.radius + 60;
    const i0 = Math.max(0, Math.floor((t.x - reach + hm.half) / hm.cell));
    const i1 = Math.min(res - 1, Math.ceil((t.x + reach + hm.half) / hm.cell));
    const j0 = Math.max(0, Math.floor((t.z - reach + hm.half) / hm.cell));
    const j1 = Math.min(res - 1, Math.ceil((t.z + reach + hm.half) / hm.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(hm.xOf(i) - t.x, hm.xOf(j) - t.z);
        const w = 1 - smoothstep(t.radius * 0.82, t.radius + 55, d);
        if (w <= 0) continue;
        const k = j * res + i;
        heights[k] = lerp(heights[k], t.y, w);
      }
    }
  }
  hm.computeRange();
}

// ---------------------------------------------------------------- roads

const G = 16; // A* grid cell (m)

class MinHeap {
  constructor() {
    this.items = [];
    this.keys = [];
  }
  push(item, key) {
    const a = this.items;
    const k = this.keys;
    a.push(item);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const k = this.keys;
    const top = a[0];
    const lastI = a.pop();
    const lastK = k.pop();
    if (a.length > 0) {
      a[0] = lastI;
      k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

function astarRoad(hm, ax, az, bx, bz, roadCells) {
  const N = Math.round(hm.size / G);
  const toCell = (v) => Math.max(0, Math.min(N - 1, Math.round((v + hm.half) / G)));
  const cx = (c) => c * G - hm.half;
  const start = toCell(az) * N + toCell(ax);
  const goal = toCell(bz) * N + toCell(bx);
  const gScore = new Float32Array(N * N).fill(Infinity);
  const came = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const heap = new MinHeap();
  const gx = goal % N;
  const gz = (goal / N) | 0;
  gScore[start] = 0;
  heap.push(start, 0);
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
    [2, 1],
    [1, 2],
    [-2, 1],
    [-1, 2],
    [2, -1],
    [1, -2],
    [-2, -1],
    [-1, -2],
  ];
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % N;
    const cj = (cur / N) | 0;
    const h0 = hm.getHeight(cx(ci), cx(cj));
    for (const [di, dj] of DIRS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni;
      if (closed[n]) continue;
      const h1 = hm.getHeight(cx(ni), cx(nj));
      if (h1 < 0.9 && n !== goal) continue;
      // midpoint must be land too (avoid hopping over water)
      if (hm.getHeight(cx(ci + di * 0.5), cx(cj + dj * 0.5)) < 0.9) continue;
      const dist = Math.hypot(di, dj) * G;
      const grade = Math.abs(h1 - h0) / dist;
      let cost = dist * (1 + (grade / 0.06) * (grade / 0.06) * 2);
      if (grade > 0.14) cost *= 6;
      if (roadCells[n]) cost *= 0.55;
      const g = gScore[cur] + cost;
      if (g < gScore[n]) {
        gScore[n] = g;
        came[n] = cur;
        heap.push(n, g + Math.hypot(ni - gx, nj - gz) * G);
      }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;
  const path = [];
  for (let c = goal; c >= 0; c = came[c]) {
    path.push({ x: cx(c % N), z: cx((c / N) | 0) });
    roadCells[c] = 1;
    if (c === start) break;
  }
  path.reverse();
  path[0] = { x: ax, z: az };
  path[path.length - 1] = { x: bx, z: bz };
  return path;
}

function chaikin(pts, iterations) {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function resample(pts, spacing) {
  const out = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = spacing - carry;
    while (d < len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      d += spacing;
    }
    carry = len - (d - spacing);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > spacing * 0.4) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  return out;
}

// Remove A* grid zig-zags: skip ahead while the straight segment stays on land with a gentle grade.
function segmentOk(hm, a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 8));
  let prev = hm.getHeight(a.x, a.z);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const h = hm.getHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (h < 0.9) return false;
    if (Math.abs(h - prev) / (len / n) > 0.12) return false;
    prev = h;
  }
  return true;
}

function simplifyPath(hm, pts) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 12);
    while (j > i + 1 && !segmentOk(hm, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

export function buildRoads(hm, towns) {
  // Minimum spanning tree (Prim) over towns + two extra short links
  const n = towns.length;
  const inTree = [0];
  const edges = [];
  const used = new Set();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const dist = (a, b) => Math.hypot(towns[a].x - towns[b].x, towns[a].z - towns[b].z);
  while (inTree.length < n) {
    let best = null;
    for (const a of inTree) {
      for (let b = 0; b < n; b++) {
        if (inTree.includes(b)) continue;
        const d = dist(a, b);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    inTree.push(best.b);
    edges.push([best.a, best.b]);
    used.add(key(best.a, best.b));
  }
  const extra = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) if (!used.has(key(a, b))) extra.push({ a, b, d: dist(a, b) });
  }
  extra.sort((p, q) => p.d - q.d);
  for (const e of extra.slice(0, 2)) edges.push([e.a, e.b]);

  const N = Math.round(hm.size / G);
  const roadCells = new Uint8Array(N * N);
  const roads = [];
  for (const [a, b] of edges) {
    const A = towns[a];
    const B = towns[b];
    const raw = astarRoad(hm, A.x, A.z, B.x, B.z, roadCells);
    if (!raw) continue;
    const pts = resample(chaikin(simplifyPath(hm, raw), 3), 8);
    // height profile: moving average then grade limit
    const ys = pts.map((p) => Math.max(hm.getHeight(p.x, p.z), 0.9));
    const sm = ys.map((_, i) => {
      let s = 0;
      let c = 0;
      for (let k = -5; k <= 5; k++) {
        const q = ys[i + k];
        if (q !== undefined) {
          s += q;
          c++;
        }
      }
      return s / c;
    });
    sm[0] = A.y;
    sm[sm.length - 1] = B.y;
    const maxGrade = 0.14;
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < sm.length; i++) {
        const ds = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        sm[i] = Math.min(Math.max(sm[i], sm[i - 1] - maxGrade * ds), sm[i - 1] + maxGrade * ds);
      }
      for (let i = sm.length - 2; i >= 0; i--) {
        const ds = Math.hypot(pts[i].x - pts[i + 1].x, pts[i].z - pts[i + 1].z);
        sm[i] = Math.min(Math.max(sm[i], sm[i + 1] - maxGrade * ds), sm[i + 1] + maxGrade * ds);
      }
    }
    roads.push({
      from: A.id,
      to: B.id,
      width: ROAD_HALF_WIDTH * 2,
      points: pts.map((p, i) => ({ x: p.x, y: Math.max(sm[i], 0.9), z: p.z })),
    });
  }
  return roads;
}

// For every heightmap vertex, find the nearest road sample and blend the terrain toward the road surface.
export function flattenRoads(hm, roads) {
  const { res, heights } = hm;
  const bestD = new Float32Array(res * res).fill(Infinity);
  const bestH = new Float32Array(res * res);
  const reach = ROAD_HALF_WIDTH + 8;
  for (const road of roads) {
    const P = road.points;
    for (let s = 0; s < P.length - 1; s++) {
      const a = P[s];
      const b = P[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + hm.half) / hm.cell));
      const i1 = Math.min(res - 1, Math.ceil((Math.max(a.x, b.x) + reach + hm.half) / hm.cell));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach + hm.half) / hm.cell));
      const j1 = Math.min(res - 1, Math.ceil((Math.max(a.z, b.z) + reach + hm.half) / hm.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = distToSegment(hm.xOf(i), hm.xOf(j), a.x, a.z, b.x, b.z);
          const k = j * res + i;
          if (d < bestD[k]) {
            bestD[k] = d;
            bestH[k] = a.y + (b.y - a.y) * _seg.t;
          }
        }
      }
    }
  }
  for (let k = 0; k < heights.length; k++) {
    const d = bestD[k];
    if (d === Infinity) continue;
    const w = 1 - smoothstep(ROAD_HALF_WIDTH + 1, ROAD_HALF_WIDTH + 8, d);
    if (w > 0) heights[k] = lerp(heights[k], bestH[k] - 0.04, w);
  }
  hm.computeRange();
}

export function distanceToRoads(roads, x, z, maxD = Infinity) {
  let best = maxD;
  for (const road of roads) {
    const P = road.points;
    for (let s = 0; s < P.length - 1; s++) {
      const a = P[s];
      const b = P[s + 1];
      // cheap reject
      if (Math.min(a.x, b.x) - best > x || Math.max(a.x, b.x) + best < x) continue;
      if (Math.min(a.z, b.z) - best > z || Math.max(a.z, b.z) + best < z) continue;
      const d = distToSegment(x, z, a.x, a.z, b.x, b.z);
      if (d < best) best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- plots

export function plotBounds(p, margin = 0) {
  const odd = p.rot % 2 === 1;
  const hw = (odd ? p.d : p.w) / 2 + margin;
  const hd = (odd ? p.w : p.d) / 2 + margin;
  return { minX: p.x - hw, maxX: p.x + hw, minZ: p.z - hd, maxZ: p.z + hd };
}

function overlaps(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

// Front (door) faces local +z. rot k rotates local +z to one of: +z, +x, -z, -x (k = 0..3).
const FRONT = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

function facingRot(dx, dz) {
  let best = 0;
  let bestDot = -Infinity;
  for (let k = 0; k < 4; k++) {
    const dot = FRONT[k][0] * dx + FRONT[k][1] * dz;
    if (dot > bestDot) {
      bestDot = dot;
      best = k;
    }
  }
  return best;
}

function nearestRoadPoint(roads, x, z) {
  let best = null;
  let bd = Infinity;
  for (const road of roads) {
    for (const p of road.points) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
  }
  return best;
}

function plotFits(hm, roads, plots, p, gap) {
  const b = plotBounds(p);
  const bm = plotBounds(p, gap / 2);
  for (const q of plots) if (overlaps(bm, plotBounds(q, gap / 2))) return false;
  // clear of roads
  const cx = p.x;
  const cz = p.z;
  const halfDiag = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const dRoad = distanceToRoads(roads, cx, cz, halfDiag + ROAD_HALF_WIDTH + 4);
  if (dRoad < halfDiag + ROAD_HALF_WIDTH + 4) {
    // precise test: sample footprint edge points
    for (let t = 0; t <= 1; t += 0.25) {
      const pts = [
        [lerp(b.minX, b.maxX, t), b.minZ],
        [lerp(b.minX, b.maxX, t), b.maxZ],
        [b.minX, lerp(b.minZ, b.maxZ, t)],
        [b.maxX, lerp(b.minZ, b.maxZ, t)],
      ];
      for (const [x, z] of pts)
        if (distanceToRoads(roads, x, z, ROAD_HALF_WIDTH + 2) < ROAD_HALF_WIDTH + 2) return false;
    }
    if (distanceToRoads(roads, cx, cz, ROAD_HALF_WIDTH + 2) < ROAD_HALF_WIDTH + 2) return false;
  }
  // on land with limited height variation
  let mn = Infinity;
  let mx = -Infinity;
  for (let t = 0; t <= 1; t += 0.5) {
    for (let s = 0; s <= 1; s += 0.5) {
      const h = hm.getHeight(lerp(b.minX, b.maxX, t), lerp(b.minZ, b.maxZ, s));
      mn = Math.min(mn, h);
      mx = Math.max(mx, h);
    }
  }
  if (mn < 1.6) return false;
  if (mx - mn > (p.townId ? 4 : 7)) return false;
  if (Math.abs(p.x) > 990 || Math.abs(p.z) > 990) return false;
  return true;
}

export function planPlots(hm, towns, roads, rng) {
  const plots = [];
  for (const town of towns) {
    const recipe = RECIPES[town.kind];
    const items = [];
    for (const [type, count] of recipe) for (let i = 0; i < count; i++) items.push(type);
    const step = town.kind === "port" || town.kind === "factory" ? 18 : 14;
    const slots = [];
    for (let dz = -town.radius; dz <= town.radius; dz += step) {
      for (let dx = -town.radius; dx <= town.radius; dx += step) {
        const d = Math.hypot(dx, dz);
        if (d > town.radius * 0.95) continue;
        const sx = town.x + dx;
        const sz = town.z + dz;
        const dr = distanceToRoads(roads, sx, sz, 80);
        slots.push({ x: sx, z: sz, key: d * 0.45 + Math.abs(dr - 16) * 0.8 + rng.range(0, step * 1.5) });
      }
    }
    slots.sort((a, b) => a.key - b.key);
    for (const type of items) {
      const base = BUILDING_TYPES[type];
      for (const s of slots) {
        if (s.used) continue;
        const toward = nearestRoadPoint(roads, s.x, s.z) || town;
        let dx = toward.x - s.x;
        let dz = toward.z - s.z;
        if (Math.hypot(dx, dz) < 1) {
          dx = town.x - s.x;
          dz = town.z - s.z;
        }
        const p = {
          x: s.x + rng.range(-2, 2),
          z: s.z + rng.range(-2, 2),
          w: base.w,
          d: base.d,
          rot: facingRot(dx, dz),
          type,
          townId: town.id,
          tier: town.tier,
        };
        p.x = Math.round(p.x * 2) / 2;
        p.z = Math.round(p.z * 2) / 2;
        if (plotFits(hm, roads, plots, p, type === "containers" || type === "tower" ? 2.5 : 4)) {
          s.used = true;
          plots.push(p);
          break;
        }
      }
    }
  }
  // Rural houses along roads
  const ruralTypes = [
    ["house_small", 5],
    ["house_two", 3],
    ["shed", 2],
    ["barn", 1],
  ];
  let rural = 0;
  for (const road of roads) {
    const P = road.points;
    let next = rng.range(60, 140);
    let acc = 0;
    for (let i = 1; i < P.length && rural < 48; i++) {
      acc += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
      if (acc < next) continue;
      acc = 0;
      next = rng.range(90, 170);
      const inTown = towns.some((t) => Math.hypot(t.x - P[i].x, t.z - P[i].z) < t.radius + 30);
      if (inTown) continue;
      const tx = P[i].x - P[i - 1].x;
      const tz = P[i].z - P[i - 1].z;
      const tl = Math.hypot(tx, tz) || 1;
      const side = rng.chance(0.5) ? 1 : -1;
      const nx = (-tz / tl) * side;
      const nz = (tx / tl) * side;
      const cluster = rng.int(1, 2);
      for (let c = 0; c < cluster; c++) {
        const type = rng.weighted(ruralTypes);
        const base = BUILDING_TYPES[type];
        const off = ROAD_HALF_WIDTH + 5 + Math.max(base.w, base.d) / 2 + rng.range(0, 6);
        const along = (c - (cluster - 1) / 2) * 16;
        const p = {
          x: Math.round((P[i].x + nx * off + (tx / tl) * along) * 2) / 2,
          z: Math.round((P[i].z + nz * off + (tz / tl) * along) * 2) / 2,
          w: base.w,
          d: base.d,
          rot: facingRot(-nx, -nz),
          type,
          townId: null,
          tier: 1,
        };
        if (plotFits(hm, roads, plots, p, 5)) {
          plots.push(p);
          rural++;
        }
      }
    }
  }
  return plots;
}

// Flatten the ground under every plot to a single base height (blended edges)
export function flattenPlots(hm, plots) {
  const { res, heights } = hm;
  for (const p of plots) {
    const b = plotBounds(p);
    let sum = 0;
    let n = 0;
    for (let x = b.minX; x <= b.maxX; x += 2) {
      for (let z = b.minZ; z <= b.maxZ; z += 2) {
        sum += hm.getHeight(x, z);
        n++;
      }
    }
    const base = Math.max(sum / n, 1.2);
    p.y = base;
    const blend = 6;
    const i0 = Math.max(0, Math.floor((b.minX - blend + hm.half) / hm.cell));
    const i1 = Math.min(res - 1, Math.ceil((b.maxX + blend + hm.half) / hm.cell));
    const j0 = Math.max(0, Math.floor((b.minZ - blend + hm.half) / hm.cell));
    const j1 = Math.min(res - 1, Math.ceil((b.maxZ + blend + hm.half) / hm.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = hm.xOf(i);
        const z = hm.xOf(j);
        const dx = Math.max(b.minX - x, 0, x - b.maxX);
        const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
        const d = Math.hypot(dx, dz);
        const w = 1 - smoothstep(1.5, blend, d);
        if (w <= 0) continue;
        const k = j * res + i;
        // keep terrain slightly below the floor slab so it never pokes through
        heights[k] = lerp(heights[k], base - 0.05, w);
      }
    }
  }
  hm.computeRange();
}

// ---------------------------------------------------------------- vehicles

export function planVehicles(hm, towns, roads, plots, rng) {
  const spawns = [];
  const blocked = (x, z) => {
    for (const p of plots) {
      const b = plotBounds(p, 3);
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
    for (const s of spawns) if (Math.hypot(s.x - x, s.z - z) < 60) return true;
    return hm.getHeight(x, z) < 1;
  };
  for (const road of roads) {
    const P = road.points;
    let acc = rng.range(80, 200);
    for (let i = 1; i < P.length && spawns.length < 24; i++) {
      acc -= Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
      if (acc > 0) continue;
      acc = rng.range(260, 380);
      const tx = P[i].x - P[i - 1].x;
      const tz = P[i].z - P[i - 1].z;
      const tl = Math.hypot(tx, tz) || 1;
      const side = rng.chance(0.5) ? 1 : -1;
      const x = P[i].x + (-tz / tl) * side * (ROAD_HALF_WIDTH + 2.5);
      const z = P[i].z + (tx / tl) * side * (ROAD_HALF_WIDTH + 2.5);
      if (blocked(x, z)) continue;
      spawns.push({
        x,
        z,
        yaw: Math.atan2(tx, tz) + (rng.chance(0.5) ? Math.PI : 0),
        type: rng.chance(0.6) ? "jeep" : "buggy",
      });
    }
  }
  return spawns;
}

// ---------------------------------------------------------------- masks

// road: asphalt coverage 0..255; ground: bare dirt/gravel yards 0..255
export function rasterizeMasks(hm, towns, roads, plots, maskRes) {
  const texel = hm.size / maskRes;
  const road = new Uint8Array(maskRes * maskRes);
  const ground = new Uint8Array(maskRes * maskRes);
  const toI = (x) => Math.floor((x + hm.half) / texel);
  const cx = (i) => (i + 0.5) * texel - hm.half;
  const put = (arr, i, j, v) => {
    if (i < 0 || j < 0 || i >= maskRes || j >= maskRes) return;
    const k = j * maskRes + i;
    if (v > arr[k]) arr[k] = v;
  };
  // roads
  const reach = ROAD_HALF_WIDTH + 2;
  for (const r of roads) {
    const P = r.points;
    for (let s = 0; s < P.length - 1; s++) {
      const a = P[s];
      const b = P[s + 1];
      const i0 = toI(Math.min(a.x, b.x) - reach);
      const i1 = toI(Math.max(a.x, b.x) + reach);
      const j0 = toI(Math.min(a.z, b.z) - reach);
      const j1 = toI(Math.max(a.z, b.z) + reach);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = distToSegment(cx(i), cx(j), a.x, a.z, b.x, b.z);
          const v = 1 - smoothstep(ROAD_HALF_WIDTH - 0.6, ROAD_HALF_WIDTH + 0.9, d);
          if (v > 0) put(road, i, j, Math.round(v * 255));
          const g = 1 - smoothstep(ROAD_HALF_WIDTH + 0.5, ROAD_HALF_WIDTH + 2, d);
          if (g > 0) put(ground, i, j, Math.round(g * 150));
        }
      }
    }
  }
  const paved = new Set(["port", "factory", "military"]);
  const townById = Object.fromEntries(towns.map((t) => [t.id, t]));
  for (const p of plots) {
    const town = p.townId ? townById[p.townId] : null;
    const isPaved = town && paved.has(town.kind);
    const m = isPaved ? 6 : 3;
    const b = plotBounds(p, m);
    for (let j = toI(b.minZ - 2); j <= toI(b.maxZ + 2); j++) {
      for (let i = toI(b.minX - 2); i <= toI(b.maxX + 2); i++) {
        const x = cx(i);
        const z = cx(j);
        const dx = Math.max(b.minX - x, 0, x - b.maxX);
        const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
        const v = 1 - smoothstep(0, 2, Math.hypot(dx, dz));
        if (v <= 0) continue;
        if (isPaved) put(road, i, j, Math.round(v * 235));
        else put(ground, i, j, Math.round(v * 255));
      }
    }
  }
  // town centers: worn ground
  for (const t of towns) {
    const r = t.radius;
    for (let j = toI(t.z - r); j <= toI(t.z + r); j++) {
      for (let i = toI(t.x - r); i <= toI(t.x + r); i++) {
        const d = Math.hypot(cx(i) - t.x, cx(j) - t.z);
        const v = 1 - smoothstep(r * 0.35, r * 0.9, d);
        if (v > 0) put(ground, i, j, Math.round(v * 110));
      }
    }
  }
  return { road, ground };
}
