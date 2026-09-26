// Bot navigation: obstacle-aware steering outdoors and nav-graph paths inside buildings.
import { F_SOLID } from "../world/collision.js";

const DIRS = 16;
const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: "", id: -1, mat: 0 };

// Spatial lookup of buildings (32 m cells) + per-building adjacency lists
export class BuildingIndex {
  constructor(buildings) {
    this.buildings = buildings;
    this.grid = new Map();
    for (const b of buildings) {
      const [x0, , z0] = b.bounds.min;
      const [x1, , z1] = b.bounds.max;
      for (let i = Math.floor(x0 / 32); i <= Math.floor(x1 / 32); i++) {
        for (let j = Math.floor(z0 / 32); j <= Math.floor(z1 / 32); j++) {
          const k = `${i},${j}`;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(b);
        }
      }
      b.adj = b.nav.nodes.map(() => []);
      for (const [a, c] of b.nav.edges) {
        b.adj[a].push(c);
        b.adj[c].push(a);
      }
    }
  }

  // building whose footprint contains (x, z) at height y (roughly)
  at(x, y, z, margin = 0.2) {
    const list = this.grid.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
    if (!list) return null;
    for (const b of list) {
      const mn = b.bounds.min;
      const mx = b.bounds.max;
      if (
        x > mn[0] - margin &&
        x < mx[0] + margin &&
        z > mn[2] - margin &&
        z < mx[2] + margin &&
        y > mn[1] - 1.5 &&
        y < mx[1]
      )
        return b;
    }
    return null;
  }

  near(x, z, r) {
    const out = new Set();
    for (let i = Math.floor((x - r) / 32); i <= Math.floor((x + r) / 32); i++) {
      for (let j = Math.floor((z - r) / 32); j <= Math.floor((z + r) / 32); j++) {
        const list = this.grid.get(`${i},${j}`);
        if (list) for (const b of list) out.add(b);
      }
    }
    return [...out];
  }
}

// room of a building containing a point (same floor), or null
export function roomAt(b, x, y, z) {
  for (const r of b.rooms) {
    if (x >= r.minX - 0.1 && x <= r.maxX + 0.1 && z >= r.minZ - 0.1 && z <= r.maxZ + 0.1 && Math.abs(y - r.y) < 1.6) return r;
  }
  return null;
}

// nav node to start from / aim for: the room's node if the point is inside a room, else the nearest node
export function nearestNode(b, x, y, z) {
  const room = roomAt(b, x, y, z);
  if (room && room.node !== undefined) return room.node;
  let best = -1;
  let bd = Infinity;
  b.nav.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, (n.y - y) * 3, n.z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

// BFS path (list of node indices) inside a building graph
export function buildingPath(b, from, to) {
  if (from < 0 || to < 0) return null;
  const prev = new Int32Array(b.nav.nodes.length).fill(-2);
  prev[from] = -1;
  const q = [from];
  while (q.length) {
    const c = q.shift();
    if (c === to) break;
    for (const m of b.adj[c]) {
      if (prev[m] === -2) {
        prev[m] = c;
        q.push(m);
      }
    }
  }
  if (prev[to] === -2) return null;
  const path = [];
  for (let c = to; c !== -1; c = prev[c]) path.unshift(c);
  return path;
}

// Choose a movement direction toward (tx, tz) avoiding obstacles. Returns {x, z} normalized (or 0,0).
export function steer(ch, tx, tz, world, state) {
  const b = ch.body;
  let dx = tx - b.x;
  let dz = tz - b.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return { x: 0, z: 0 };
  dx /= dist;
  dz /= dist;
  const col = world.collision;
  const look = Math.min(3, dist);
  const yKnee = b.y + 0.55;
  const yChest = b.y + 1.25;
  let bestS = -Infinity;
  let bx = dx;
  let bz = dz;
  // fast path: straight line clear
  if (
    !col.raycast(b.x, yKnee, b.z, dx, 0, dz, look, F_SOLID, _hit, true) &&
    !col.raycast(b.x, yChest, b.z, dx, 0, dz, look, F_SOLID, _hit, true)
  ) {
    if (!deepWaterAhead(world, b.x + dx * 3, b.z + dz * 3, state)) return smooth(state, dx, dz);
  }
  for (let i = 0; i < DIRS; i++) {
    const a = (i / DIRS) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    let s = cx * dx + cz * dz;
    // keep turning consistently around obstacles
    if (state.side) s += (cx * -dz + cz * dx) * 0.25 * state.side;
    const h1 = col.raycast(b.x, yKnee, b.z, cx, 0, cz, 2.5, F_SOLID, _hit, true) ? _hit.t : 2.5;
    const h2 = col.raycast(b.x, yChest, b.z, cx, 0, cz, 2.5, F_SOLID, _hit, true) ? _hit.t : 2.5;
    const clear = Math.min(h1, h2);
    s -= (2.5 - clear) * 0.9;
    if (clear < 0.6) s -= 3;
    if (deepWaterAhead(world, b.x + cx * 3, b.z + cz * 3, state)) s -= 1.5;
    if (s > bestS) {
      bestS = s;
      bx = cx;
      bz = cz;
    }
  }
  if (!state.side) state.side = Math.random() < 0.5 ? 1 : -1;
  return smooth(state, bx, bz);
}

function deepWaterAhead(world, x, z, state) {
  if (state.allowWater) return false;
  return world.hm.getHeight(x, z) < -1.0;
}

function smooth(state, x, z) {
  const sx = (state.sx ?? x) * 0.55 + x * 0.45;
  const sz = (state.sz ?? z) * 0.55 + z * 0.45;
  const l = Math.hypot(sx, sz) || 1;
  state.sx = sx / l;
  state.sz = sz / l;
  return { x: state.sx, z: state.sz };
}
