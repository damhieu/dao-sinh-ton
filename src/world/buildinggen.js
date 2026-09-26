// Procedural buildings made of axis-aligned boxes (walls with openings, floors, stairs, roofs,
// furniture) plus doors, loot points and a small navigation graph. Pure module (no three.js).
// Local frame: origin at plot center, floor base at plot.y, front (main door) faces local +z.

export const FLOOR_H = 3.2;
export const WALL_T = 0.2;
export const BASE_H = 0.25; // ground floor top above the plot base
export const STEP_RISE = 0.2;
export const STEP_RUN = 0.28;
export const DOOR_W = 1.1;
export const DOOR_H = 2.2;
export const IN_SHADE = 0.66; // fake ambient occlusion for interior faces

const PALETTES = {
  house: [0xe8dcc2, 0xd9c7a6, 0xc9d3c1, 0xe3c9b8, 0xcfd7de, 0xf0e6d0, 0xd8b99a, 0xbfc9b0],
  apartment: [0xcfc6b8, 0xbdb6aa, 0xd6cfc2, 0xc4b59f],
  container: [0x9b3b2f, 0x2f5f8c, 0x3f6e3a, 0xc27a28, 0x7a2f5c, 0x5b5f63, 0xa8862a],
};

// ---------------------------------------------------------------- local -> world

function rotXZ(k, x, z) {
  switch (k & 3) {
    case 0:
      return [x, z];
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    default:
      return [-z, x];
  }
}

// local face normal label -> world face label after rotation
const FACE_ROT = [
  { px: "px", nx: "nx", pz: "pz", nz: "nz" },
  { px: "nz", nx: "pz", pz: "px", nz: "nx" },
  { px: "nx", nx: "px", pz: "nz", nz: "pz" },
  { px: "pz", nx: "nz", pz: "nx", nz: "px" },
];

class Builder {
  constructor(plot, rng) {
    this.p = plot;
    this.rng = rng;
    this.k = plot.rot & 3;
    this.boxes = [];
    this.prisms = [];
    this.doors = [];
    this.loot = [];
    this.nav = { nodes: [], edges: [] };
    this.rooms = [];
    this.lights = [];
  }

  toWorld(x, y, z) {
    const [wx, wz] = rotXZ(this.k, x, z);
    return [this.p.x + wx, this.p.y + y, this.p.z + wz];
  }

  // Add a box in local coordinates. faces: optional {px,nx,pz,nz,py,ny: mat} overrides (local labels)
  box(x0, y0, z0, x1, y1, z1, mat, opt = {}) {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return null;
    const a = this.toWorld(x0, y0, z0);
    const b = this.toWorld(x1, y1, z1);
    const bx = {
      min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
      mat,
      tint: opt.tint ?? 0xffffff,
      shade: opt.shade ?? (opt.interior ? IN_SHADE : 1),
      solid: opt.solid ?? true,
      cover: opt.cover ?? false,
    };
    // per-face overrides given with local face labels -> rotate to world labels
    const rot = (src) => {
      const f = {};
      for (const [lab, v] of Object.entries(src))
        f[lab === "py" || lab === "ny" ? lab : FACE_ROT[this.k][lab]] = v;
      return f;
    };
    if (opt.faces) bx.faces = rot(opt.faces);
    if (opt.faceTint) bx.faceTint = rot(opt.faceTint);
    if (opt.faceShade) bx.faceShade = rot(opt.faceShade);
    this.boxes.push(bx);
    return bx;
  }

  // Wall along local X at z (thickness centered), from x0..x1, vertical y0..y1, with openings [{a,b,lo,hi}]
  wallX(z, x0, x1, y0, y1, openings, mat, opt = {}) {
    const t = opt.t ?? WALL_T;
    this.wallGeneric(
      (a, b, lo, hi) => this.box(a, lo, z - t / 2, b, hi, z + t / 2, mat, opt),
      x0,
      x1,
      y0,
      y1,
      openings,
    );
  }

  wallZ(x, z0, z1, y0, y1, openings, mat, opt = {}) {
    const t = opt.t ?? WALL_T;
    this.wallGeneric(
      (a, b, lo, hi) => this.box(x - t / 2, lo, a, x + t / 2, hi, b, mat, opt),
      z0,
      z1,
      y0,
      y1,
      openings,
    );
  }

  wallGeneric(emit, s0, s1, y0, y1, openings) {
    // earlier openings win (doors are listed first); drop any later opening that overlaps
    const ops = [];
    for (const o of openings) {
      if (o.b <= s0 || o.a >= s1) continue;
      if (ops.some((q) => o.a < q.b + 0.15 && o.b > q.a - 0.15)) continue;
      ops.push(o);
    }
    ops.sort((p, q) => p.a - q.a);
    let cur = s0;
    for (const o of ops) {
      const a = Math.max(s0, o.a);
      const b = Math.min(s1, o.b);
      if (a > cur) emit(cur, a, y0, y1);
      // below and above the opening
      if (o.lo > y0) emit(a, b, y0, Math.min(y1, o.lo));
      if (o.hi < y1) emit(a, b, Math.max(y0, o.hi), y1);
      cur = Math.max(cur, b);
    }
    if (cur < s1) emit(cur, s1, y0, y1);
  }

  // door leaf in an opening of a wall along X (axis "x") or along Z (axis "z"), local coords
  door(axis, c, along, y, opt = {}) {
    // c: wall coordinate (z for axis x, x for axis z); along: center along the wall
    const [wx, wy, wz] = this.toWorld(axis === "x" ? along : c, y, axis === "x" ? c : along);
    // world axis of the wall after rotation
    const worldAxis = (axis === "x") === (this.k % 2 === 0) ? "x" : "z";
    this.doors.push({
      x: wx,
      y: wy,
      z: wz,
      axis: worldAxis,
      w: opt.w ?? DOOR_W - 0.1,
      h: opt.h ?? DOOR_H - 0.08,
      hinge: this.rng.chance(0.5) ? -1 : 1,
      open: opt.open ?? this.rng.chance(0.25),
      mat: opt.mat ?? "wood",
    });
  }

  node(x, y, z, room = -1) {
    const [wx, wy, wz] = this.toWorld(x, y, z);
    this.nav.nodes.push({ x: wx, y: wy, z: wz, room });
    return this.nav.nodes.length - 1;
  }

  edge(a, b) {
    if (a >= 0 && b >= 0 && a !== b) this.nav.edges.push([a, b]);
  }

  lootAt(x, y, z) {
    const [wx, wy, wz] = this.toWorld(x, y, z);
    this.loot.push({ x: wx, y: wy, z: wz });
  }

  // pitched roof: ridge along local X (or Z if alongZ), eaves at y, ridge height h
  prism(x0, z0, x1, z1, y, h, alongZ, mat, tint = 0xffffff, gableMat = "plaster", gableTint = 0xe6dccb) {
    const a = this.toWorld(x0, y, z0);
    const b = this.toWorld(x1, y, z1);
    const worldAlongZ = alongZ === (this.k % 2 === 0);
    this.prisms.push({
      min: [Math.min(a[0], b[0]), y + this.p.y, Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]), y + this.p.y + h, Math.max(a[2], b[2])],
      alongZ: worldAlongZ,
      mat,
      tint,
      gableMat,
      gableTint,
    });
  }
}

// ---------------------------------------------------------------- helpers

function windowOpenings(
  rng,
  s0,
  s1,
  floorY,
  avoid = [],
  spacing = 3.2,
  width = 1.2,
  sill = 0.95,
  height = 1.15,
) {
  const out = [];
  const len = s1 - s0;
  const n = Math.max(0, Math.floor((len - 1.2) / spacing));
  if (n === 0) return out;
  const step = len / (n + 1);
  for (let i = 1; i <= n; i++) {
    const c = s0 + step * i;
    const a = c - width / 2;
    const b = c + width / 2;
    if (avoid.some((v) => Math.abs(v - c) < width / 2 + 0.45)) continue;
    if (a < s0 + 0.6 || b > s1 - 0.6) continue;
    if (rng.chance(0.12)) continue;
    out.push({ a, b, lo: floorY + sill, hi: floorY + sill + height, win: true });
  }
  return out;
}

function furnish(b, room, y, kind) {
  const rng = b.rng;
  const { x0, z0, x1, z1 } = room;
  const w = x1 - x0;
  const d = z1 - z0;
  const pieces = [];
  const wood = 0x8a6a4a;
  // place along a random wall
  const tryPlace = (pw, pd, ph, mat, tint, surface = false) => {
    for (let t = 0; t < 8; t++) {
      const side = rng.int(0, 3);
      let cx;
      let cz;
      let sw = pw;
      let sd = pd;
      if (side >= 2) {
        sw = pd;
        sd = pw;
      }
      if (side === 0) {
        cx = rng.range(x0 + sw / 2 + 0.1, x1 - sw / 2 - 0.1);
        cz = z0 + sd / 2 + 0.05;
      } else if (side === 1) {
        cx = rng.range(x0 + sw / 2 + 0.1, x1 - sw / 2 - 0.1);
        cz = z1 - sd / 2 - 0.05;
      } else if (side === 2) {
        cx = x0 + sw / 2 + 0.05;
        cz = rng.range(z0 + sd / 2 + 0.1, z1 - sd / 2 - 0.1);
      } else {
        cx = x1 - sw / 2 - 0.05;
        cz = rng.range(z0 + sd / 2 + 0.1, z1 - sd / 2 - 0.1);
      }
      if (!isFinite(cx) || !isFinite(cz)) continue;
      const r = { x0: cx - sw / 2, x1: cx + sw / 2, z0: cz - sd / 2, z1: cz + sd / 2 };
      // keep doorways clear
      if (
        room.keepClear &&
        room.keepClear.some((k) => r.x0 < k.x1 && r.x1 > k.x0 && r.z0 < k.z1 && r.z1 > k.z0)
      )
        continue;
      if (
        pieces.some((q) => r.x0 < q.x1 + 0.3 && r.x1 > q.x0 - 0.3 && r.z0 < q.z1 + 0.3 && r.z1 > q.z0 - 0.3)
      )
        continue;
      pieces.push(r);
      b.box(r.x0, y, r.z0, r.x1, y + ph, r.z1, mat, { tint, interior: true, cover: true });
      if (surface) b.lootAt(cx, y + ph + 0.02, cz);
      return r;
    }
    return null;
  };
  if (kind === "home") {
    if (w * d > 9) tryPlace(2.0, 0.95, 0.55, "fabric", rng.pick([0x6b4f3f, 0x4f5a6b, 0x7a6a55]));
    tryPlace(1.2, 0.75, 0.76, "wood", wood, true);
    if (rng.chance(0.7)) tryPlace(0.9, 0.4, 1.9, "wood", 0x6e5238);
    if (rng.chance(0.5)) tryPlace(1.8, 0.8, 0.8, "fabric", rng.pick([0x5a3e3a, 0x3c4a3f, 0x6a6a72]));
  } else if (kind === "barracks") {
    for (let i = 0; i < 3; i++) tryPlace(2.0, 0.9, 1.1, "wood", 0x5a5a4a, i === 0);
    tryPlace(0.6, 0.5, 1.8, "metal", 0x55604a);
  } else if (kind === "office") {
    tryPlace(1.4, 0.7, 0.76, "wood", 0x7a6548, true);
    tryPlace(1.4, 0.7, 0.76, "wood", 0x7a6548, true);
    tryPlace(0.5, 0.45, 1.8, "metal", 0x6b6f73);
  } else if (kind === "class") {
    for (let i = 0; i < 4; i++) tryPlace(1.2, 0.6, 0.75, "wood", 0x8a6a4a, i < 2);
  }
  return pieces;
}

// loot points on the floor of a room, away from furniture
function roomLoot(b, room, y, n) {
  let placed = 0;
  for (let i = 0; i < n * 5 && placed < n; i++) {
    const x = b.rng.range(room.x0 + 0.5, room.x1 - 0.5);
    const z = b.rng.range(room.z0 + 0.5, room.z1 - 0.5);
    const inside = (q) => x > q.x0 - 0.2 && x < q.x1 + 0.2 && z > q.z0 - 0.2 && z < q.z1 + 0.2;
    if (room.pieces && room.pieces.some(inside)) continue;
    if (room.keepClear && room.keepClear.some(inside)) continue;
    b.lootAt(x, y + 0.02, z);
    placed++;
  }
}

// straight stair along +z from (x0..x1, zStart) rising from y0 by `rise` total
function stairs(b, x0, x1, zStart, y0, steps, mat = "wood", tint = 0x9a7a58) {
  for (let i = 0; i < steps; i++) {
    b.box(x0, y0, zStart + i * STEP_RUN, x1, y0 + (i + 1) * STEP_RISE, zStart + (i + 1) * STEP_RUN, mat, {
      tint,
      interior: true,
    });
  }
  return zStart + steps * STEP_RUN;
}

// ---------------------------------------------------------------- generic house

function genHouse(b, o) {
  const { W, D, floors } = o;
  const rng = b.rng;
  const hw = W / 2;
  const hd = D / 2;
  const T = WALL_T;
  const ext = o.ext ?? "plaster";
  const tint = o.tint ?? rng.pick(PALETTES.house);
  const inTint = 0xefe8dc;
  const floorMat = o.floorMat ?? "wood";
  const top = BASE_H + floors * FLOOR_H;

  // foundation / ground floor slab
  b.box(-hw, 0, -hd, hw, BASE_H, hd, floorMat, {
    faces: { px: "concrete", nx: "concrete", pz: "concrete", nz: "concrete" },
    faceTint: { px: 0x9a9690, nx: 0x9a9690, pz: 0x9a9690, nz: 0x9a9690 },
    interior: true,
    tint: 0xb0a58f,
  });

  // room grid: columns split x, rows split z
  const colSplit = W >= 8 ? [rng.range(-hw + 2.8, hw - 2.8)] : [];
  const rowSplit = D >= 8 && rng.chance(0.75) ? [rng.range(-hd + 2.8, hd - 2.8)] : [];
  const xs = [-hw + T / 2, ...colSplit, hw - T / 2];
  const zs = [-hd + T / 2, ...rowSplit, hd - T / 2];

  // stairs run along the left wall in the back-left cell
  const stairW = 1.1;
  const stairSteps = Math.round(FLOOR_H / STEP_RISE);
  const stairLen = stairSteps * STEP_RUN;
  const hasStairs = floors > 1;
  const sx0 = -hw + T / 2 + 0.02;
  const sx1 = sx0 + stairW;
  const sz0 = -hd + T / 2 + 0.6;
  const sz1 = sz0 + stairLen;
  if (hasStairs) {
    // make sure the first column is wide enough and the first row long enough for the stairs
    if (colSplit.length && colSplit[0] < sx1 + 1.2) xs[1] = sx1 + 1.2;
    if (rowSplit.length && rowSplit[0] < sz1 + 1.0) zs[1] = Math.min(hd - 2.5, sz1 + 1.0);
  }

  // doors must stay clear of partition junctions
  const clearOfParts = (x) => xs.slice(1, -1).every((px) => Math.abs(px - x) > DOOR_W / 2 + 0.45);
  const pickDoorX = (lo, hi) => {
    for (let t = 0; t < 20; t++) {
      const x = rng.range(lo, hi);
      if (clearOfParts(x)) return x;
    }
    return (lo + hi) / 2 + (clearOfParts((lo + hi) / 2) ? 0 : DOOR_W + 0.5);
  };
  const mainDoorX = hasStairs ? pickDoorX(sx1 + 0.8, hw - 1.4) : pickDoorX(-hw + 1.5, hw - 1.5);
  const backDoor = rng.chance(0.45);
  const backDoorX = pickDoorX(-hw + 1.6, hw - 1.6);

  for (let f = 0; f < floors; f++) {
    const y0 = BASE_H + f * FLOOR_H;
    const y1 = y0 + FLOOR_H;
    const fy = y0; // floor top
    const ceilingBottom = f < floors - 1 ? y1 - 0.25 : y1;
    // exterior walls
    // exterior material everywhere except the inward face (interior plaster, shaded)
    const INV = { pz: "nz", nz: "pz", px: "nx", nx: "px" };
    const extOpt = (outFace) => ({
      tint,
      faces: { [INV[outFace]]: "plasterIn" },
      faceTint: { [INV[outFace]]: inTint },
      faceShade: { [INV[outFace]]: IN_SHADE },
    });
    // exterior walls run the full storey height (no gaps at slabs); flat roofs sit on top of the walls
    const wallTop = f === floors - 1 && o.roof !== "pitched" ? y1 - 0.25 : y1;
    const front = [];
    const back = [];
    if (f === 0) {
      front.push({
        a: mainDoorX - DOOR_W / 2,
        b: mainDoorX + DOOR_W / 2,
        lo: fy,
        hi: fy + DOOR_H,
        door: true,
      });
      if (backDoor)
        back.push({
          a: backDoorX - DOOR_W / 2,
          b: backDoorX + DOOR_W / 2,
          lo: fy,
          hi: fy + DOOR_H,
          door: true,
        });
    }
    const partX = xs.slice(1, -1);
    const partZ = zs.slice(1, -1);
    front.push(...windowOpenings(rng, -hw, hw, fy, [...front.map((q) => (q.a + q.b) / 2), ...partX]));
    back.push(...windowOpenings(rng, -hw, hw, fy, [...back.map((q) => (q.a + q.b) / 2), ...partX]));
    const leftAvoid = hasStairs ? [sz0 + stairLen * 0.5, sz0 + 0.3, sz1 - 0.3] : [];
    const left = windowOpenings(rng, -hd, hd, fy, [...partZ, ...leftAvoid]);
    const right = windowOpenings(rng, -hd, hd, fy, partZ);
    b.wallX(hd - T / 2, -hw, hw, y0, wallTop, front, ext, extOpt("pz"));
    b.wallX(-hd + T / 2, -hw, hw, y0, wallTop, back, ext, extOpt("nz"));
    b.wallZ(-hw + T / 2, -hd + T, hd - T, y0, wallTop, left, ext, extOpt("nx"));
    b.wallZ(hw - T / 2, -hd + T, hd - T, y0, wallTop, right, ext, extOpt("px"));
    if (f === 0) {
      b.door("x", hd - T / 2, mainDoorX, fy);
      if (backDoor) b.door("x", -hd + T / 2, backDoorX, fy);
    }
    // window frames (thin trim) for the look
    for (const [list, axis, c] of [
      [front, "x", hd],
      [back, "x", -hd],
      [left, "z", -hw],
      [right, "z", hw],
    ]) {
      for (const w of list) {
        if (!w.win) continue;
        const sill =
          axis === "x"
            ? [w.a - 0.08, w.lo - 0.08, c - 0.14, w.b + 0.08, w.lo, c + 0.14]
            : [c - 0.14, w.lo - 0.08, w.a - 0.08, c + 0.14, w.lo, w.b + 0.08];
        b.box(
          Math.min(sill[0], sill[3]),
          sill[1],
          Math.min(sill[2], sill[5]),
          Math.max(sill[0], sill[3]),
          sill[4],
          Math.max(sill[2], sill[5]),
          "trim",
          { tint: 0xe8e4dc, solid: false },
        );
      }
    }

    // partitions with doors
    const doorsHere = [];
    for (const px of partX) {
      for (let r = 0; r < zs.length - 1; r++) {
        const za = zs[r] + T / 2;
        const zb = zs[r + 1] - T / 2;
        if (zb - za < 1.4) continue;
        let dz = rng.range(za + 0.7, zb - 0.7);
        const op = [{ a: dz - DOOR_W / 2, b: dz + DOOR_W / 2, lo: fy, hi: fy + DOOR_H }];
        b.wallZ(px, za, zb, y0, ceilingBottom, op, "plasterIn", { tint: inTint, interior: true, t: 0.14 });
        if (rng.chance(0.6)) b.door("z", px, dz, fy);
        doorsHere.push({ axis: "z", x: px, z: dz });
      }
    }
    for (const pz of partZ) {
      for (let c = 0; c < xs.length - 1; c++) {
        const xa = xs[c] + T / 2;
        const xb = xs[c + 1] - T / 2;
        if (xb - xa < 1.4) continue;
        let lo = xa + 0.7;
        if (hasStairs && c === 0) lo = Math.max(lo, sx1 + 0.7);
        if (lo > xb - 0.7) lo = xa + 0.7;
        const dx = rng.range(lo, xb - 0.7);
        const op = [{ a: dx - DOOR_W / 2, b: dx + DOOR_W / 2, lo: fy, hi: fy + DOOR_H }];
        b.wallX(pz, xa, xb, y0, ceilingBottom, op, "plasterIn", { tint: inTint, interior: true, t: 0.14 });
        if (rng.chance(0.6)) b.door("x", pz, dx, fy);
        doorsHere.push({ axis: "x", x: dx, z: pz });
      }
    }

    // rooms of this floor
    const roomIds = [];
    for (let c = 0; c < xs.length - 1; c++) {
      for (let r = 0; r < zs.length - 1; r++) {
        const room = {
          x0: xs[c] + T / 2,
          x1: xs[c + 1] - T / 2,
          z0: zs[r] + T / 2,
          z1: zs[r + 1] - T / 2,
          floor: f,
          keepClear: [],
        };
        // keep door swings and stairs clear
        for (const d of doorsHere)
          room.keepClear.push({ x0: d.x - 1.0, x1: d.x + 1.0, z0: d.z - 1.0, z1: d.z + 1.0 });
        room.keepClear.push({ x0: mainDoorX - 1, x1: mainDoorX + 1, z0: hd - 1.6, z1: hd });
        if (backDoor) room.keepClear.push({ x0: backDoorX - 1, x1: backDoorX + 1, z0: -hd, z1: -hd + 1.6 });
        if (hasStairs) room.keepClear.push({ x0: sx0 - 0.1, x1: sx1 + 0.9, z0: sz0 - 1.2, z1: sz1 + 1.2 });
        room.pieces = furnish(b, room, fy, o.furnish ?? "home");
        roomLoot(b, room, fy, o.lootPerRoom ?? 2);
        const id = b.node((room.x0 + room.x1) / 2, fy, (room.z0 + room.z1) / 2, b.rooms.length);
        room.node = id;
        room.y = fy;
        b.rooms.push(room);
        roomIds.push(room);
      }
    }
    // nav: doors between rooms of this floor
    const roomAt = (x, z) =>
      roomIds.find((rm) => x >= rm.x0 - 0.3 && x <= rm.x1 + 0.3 && z >= rm.z0 - 0.3 && z <= rm.z1 + 0.3);
    for (const d of doorsHere) {
      const off = 0.7;
      const pa = d.axis === "z" ? [d.x - off, d.z] : [d.x, d.z - off];
      const pb = d.axis === "z" ? [d.x + off, d.z] : [d.x, d.z + off];
      const ra = roomAt(pa[0], pa[1]);
      const rb = roomAt(pb[0], pb[1]);
      const na = b.node(pa[0], fy, pa[1]);
      const nb = b.node(pb[0], fy, pb[1]);
      b.edge(na, nb);
      if (ra) b.edge(na, ra.node);
      if (rb) b.edge(nb, rb.node);
    }
    if (f === 0) {
      const inside = roomAt(mainDoorX, hd - 1);
      const nOut = b.node(mainDoorX, 0.05, hd + 1.2);
      const nIn = b.node(mainDoorX, fy, hd - 0.9);
      b.edge(nOut, nIn);
      if (inside) b.edge(nIn, inside.node);
      b.entrances = [nOut];
      if (backDoor) {
        const inB = roomAt(backDoorX, -hd + 1);
        const bo = b.node(backDoorX, 0.05, -hd - 1.2);
        const bi = b.node(backDoorX, fy, -hd + 0.9);
        b.edge(bo, bi);
        if (inB) b.edge(bi, inB.node);
        b.entrances.push(bo);
      }
    }
    b.floorRooms = b.floorRooms || [];
    b.floorRooms[f] = roomIds;

    // slab above (ceiling / next floor) with a stairwell opening
    if (f < floors - 1) {
      const sy0 = y1 - 0.25;
      const holeX0 = sx0 - 0.05;
      const holeX1 = sx1 + 0.05;
      const holeZ0 = sz0 - 0.1;
      const holeZ1 = sz1 + 0.15;
      const slab = (x0, z0, x1, z1) =>
        b.box(x0, sy0, z0, x1, y1, z1, floorMat, {
          tint: 0xb0a58f,
          interior: true,
          faces: { ny: "plasterIn" },
          faceTint: { ny: 0xe6e0d4 },
        });
      slab(-hw + T, -hd + T, holeX0, hd - T);
      slab(holeX1, -hd + T, hw - T, hd - T);
      slab(holeX0, -hd + T, holeX1, holeZ0);
      slab(holeX0, holeZ1, holeX1, hd - T);
      // stairs from this floor to the next
      stairs(b, sx0, sx1, sz0, fy, stairSteps);
      // railing around the stairwell on the upper floor
      b.box(holeX1, y1, holeZ0, holeX1 + 0.06, y1 + 0.95, holeZ1 - 1.2, "trim", {
        tint: 0x6b5a48,
        interior: true,
      });
      // nav: stair bottom/top
      const lower = roomAt(sx1 + 0.4, sz0);
      const nBot = b.node((sx0 + sx1) / 2, fy, sz0 - 0.45);
      const nTop = b.node((sx0 + sx1) / 2, y1, sz1 + 0.45);
      b.edge(nBot, nTop);
      if (lower) b.edge(nBot, lower.node);
      b.stairTop = b.stairTop || [];
      b.stairTop[f + 1] = nTop;
    }
    if (f > 0 && b.stairTop && b.stairTop[f] !== undefined) {
      const upper = roomAt(sx1 + 0.4, sz1 + 0.3) || roomIds[0];
      b.edge(b.stairTop[f], upper.node);
    }
  }

  // roof
  if (o.roof === "pitched") {
    b.box(-hw, top, -hd, hw, top + 0.2, hd, "plasterIn", {
      tint: 0xe6e0d4,
      interior: true,
      faces: { py: "roof" },
    });
    const alongX = W >= D;
    b.prism(
      -hw - 0.35,
      -hd - 0.35,
      hw + 0.35,
      hd + 0.35,
      top + 0.2,
      Math.min(W, D) * 0.3,
      !alongX,
      "roof",
      o.roofTint ?? 0xd8b8a0,
      ext,
      tint,
    );
  } else {
    b.box(-hw, top - 0.25, -hd, hw, top, hd, "floorC", {
      tint: 0x9a968c,
      faces: { ny: "plasterIn", px: ext, nx: ext, pz: ext, nz: ext },
      faceTint: { ny: 0xe6e0d4, px: tint, nx: tint, pz: tint, nz: tint },
      faceShade: { ny: 0.55 },
    });
    // parapet
    const ph = 0.7;
    b.box(-hw, top, hd - 0.2, hw, top + ph, hd, ext, { tint });
    b.box(-hw, top, -hd, hw, top + ph, -hd + 0.2, ext, { tint });
    b.box(-hw, top, -hd + 0.2, -hw + 0.2, top + ph, hd - 0.2, ext, { tint });
    b.box(hw - 0.2, top, -hd + 0.2, hw, top + ph, hd - 0.2, ext, { tint });
  }
  // front step
  b.box(mainDoorX - 0.9, 0, hd, mainDoorX + 0.9, BASE_H * 0.5, hd + 0.45, "concrete", { tint: 0xa8a49c });
}

// ---------------------------------------------------------------- special types

function genHall(b, o) {
  // warehouse / factory hall / barn: one tall open space with big doors and cover
  const { W, D, H } = o;
  const rng = b.rng;
  const hw = W / 2;
  const hd = D / 2;
  const T = 0.25;
  const mat = o.mat;
  const tint = o.tint ?? 0xffffff;
  const bigW = Math.min(4.2, W * 0.35);
  const bigH = Math.min(4.5, H - 1);
  b.box(-hw, 0, -hd, hw, 0.15, hd, "floorC", { tint: 0xa19c92, interior: true });
  const INV = { pz: "nz", nz: "pz", px: "nx", nx: "px" };
  const wallOpt = (face) => ({ tint, faceShade: { [INV[face]]: IN_SHADE } });
  const frontOps = [{ a: -bigW / 2, b: bigW / 2, lo: 0.15, hi: 0.15 + bigH }];
  const backOps = [{ a: -bigW / 2 + (rng.range(-1, 1) * (W - bigW)) / 4, b: 0, lo: 0.15, hi: 0.15 + bigH }];
  backOps[0].b = backOps[0].a + bigW;
  const sideDoor = { a: rng.range(-hd + 2, hd - 3), b: 0, lo: 0.15, hi: 0.15 + DOOR_H };
  sideDoor.b = sideDoor.a + DOOR_W;
  const hiWin = (s0, s1) => windowOpenings(rng, s0, s1, H - 2.4, [], 4, 1.8, 0, 1.0);
  b.wallX(
    hd - T / 2,
    -hw,
    hw,
    0.15,
    H,
    [...frontOps, ...hiWin(-hw, hw).filter((w) => w.b < -bigW / 2 || w.a > bigW / 2)],
    mat,
    wallOpt("pz"),
  );
  b.wallX(
    -hd + T / 2,
    -hw,
    hw,
    0.15,
    H,
    [...backOps, ...hiWin(-hw, hw).filter((w) => w.b < backOps[0].a || w.a > backOps[0].b)],
    mat,
    wallOpt("nz"),
  );
  b.wallZ(-hw + T / 2, -hd + T, hd - T, 0.15, H, [sideDoor, ...hiWin(-hd, hd)], mat, wallOpt("nx"));
  b.wallZ(hw - T / 2, -hd + T, hd - T, 0.15, H, hiWin(-hd, hd), mat, wallOpt("px"));
  b.door("z", -hw + T / 2, (sideDoor.a + sideDoor.b) / 2, 0.15, { mat: "metal" });
  // roof
  if (o.pitched) {
    b.box(-hw, H, -hd, hw, H + 0.15, hd, mat, { tint, interior: true });
    b.prism(
      -hw - 0.3,
      -hd - 0.3,
      hw + 0.3,
      hd + 0.3,
      H + 0.15,
      W * 0.3,
      true,
      o.roofMat ?? mat,
      o.roofTint ?? tint,
      mat,
      tint,
    );
  } else {
    b.box(-hw, H, -hd, hw, H + 0.3, hd, o.roofMat ?? "metal", {
      tint: o.roofTint ?? 0xc8ccd0,
      interior: true,
      faces: { ny: mat },
    });
  }
  // cover inside: crate stacks / machinery
  const room = { x0: -hw + T + 0.4, x1: hw - T - 0.4, z0: -hd + T + 0.4, z1: hd - T - 0.4, floor: 0 };
  const placed = [];
  const count = Math.round((W * D) / 55);
  for (let i = 0; i < count; i++) {
    const s = rng.pick([1.2, 1.2, 1.5, 2.4]);
    const x = rng.range(room.x0 + s, room.x1 - s);
    const z = rng.range(room.z0 + s, room.z1 - s * 1.5);
    // keep the door lanes clear
    if (Math.abs(x) < bigW / 2 + 1 && z > hd - 5) continue;
    if (Math.abs(x - (backOps[0].a + backOps[0].b) / 2) < bigW / 2 + 1 && z < -hd + 5) continue;
    if (x < -hw + 4 && Math.abs(z - (sideDoor.a + sideDoor.b) / 2) < 2.5) continue;
    if (
      placed.some(
        (p) => Math.abs(p.x - x) < p.s / 2 + s / 2 + 1.1 && Math.abs(p.z - z) < p.s / 2 + s / 2 + 1.1,
      )
    )
      continue;
    placed.push({ x, z, s });
    const hgt = o.machines && rng.chance(0.4) ? rng.range(1.8, 3.2) : s * rng.int(1, 2);
    const m = o.machines && hgt > 1.7 && s > 1.4 ? "metal" : "crate";
    b.box(x - s / 2, 0.15, z - s / 2, x + s / 2, 0.15 + hgt, z + s / 2, m, {
      tint: m === "metal" ? 0x6f7a6a : 0xa8845a,
      interior: true,
      cover: true,
    });
    if (rng.chance(0.5)) b.lootAt(x, 0.15 + hgt + 0.02, z);
  }
  room.pieces = placed.map((p) => ({
    x0: p.x - p.s / 2,
    x1: p.x + p.s / 2,
    z0: p.z - p.s / 2,
    z1: p.z + p.s / 2,
  }));
  roomLoot(b, room, 0.15, Math.round((W * D) / 60));
  const center = b.node(0, 0.15, 0, 0);
  b.rooms.push({ ...room, node: center, y: 0.15 });
  const nOut = b.node(0, 0.05, hd + 1.5);
  const nIn = b.node(0, 0.15, hd - 1.5);
  b.edge(nOut, nIn);
  b.edge(nIn, center);
  const bx = (backOps[0].a + backOps[0].b) / 2;
  const bOut = b.node(bx, 0.05, -hd - 1.5);
  const bIn = b.node(bx, 0.15, -hd + 1.5);
  b.edge(bOut, bIn);
  b.edge(bIn, center);
  b.entrances = [nOut, bOut];
}

function genContainers(b) {
  const rng = b.rng;
  const CW = 2.44;
  const CH = 2.6;
  const CL = 6.06;
  const slots = [
    [-CW / 2 - 0.25, 0],
    [CW / 2 + 0.25, 0],
  ];
  const nodes = [];
  for (const [cx, cz] of slots) {
    const levels = rng.chance(0.4) ? 2 : 1;
    for (let lv = 0; lv < levels; lv++) {
      const tint = rng.pick(PALETTES.container);
      const y0 = lv * CH;
      const hw = CW / 2;
      const hl = CL / 2;
      const t = 0.08;
      const open = lv === 0 && rng.chance(0.7);
      const end = rng.chance(0.5) ? 1 : -1; // which end is open
      // inside faces are shaded dark
      const o = (inFace) => ({ tint, faceShade: { [inFace]: 0.5 } });
      b.box(cx - hw, y0, cz - hl, cx + hw, y0 + 0.12, cz + hl, "wood", { tint: 0x6e5a44, interior: true });
      b.box(cx - hw, y0 + CH - t, cz - hl, cx + hw, y0 + CH, cz + hl, "metal", o("ny"));
      b.box(cx - hw, y0, cz - hl, cx - hw + t, y0 + CH, cz + hl, "metal", o("px"));
      b.box(cx + hw - t, y0, cz - hl, cx + hw, y0 + CH, cz + hl, "metal", o("nx"));
      if (!open || end !== 1) b.box(cx - hw, y0, cz + hl - t, cx + hw, y0 + CH, cz + hl, "metal", o("nz"));
      if (!open || end !== -1) b.box(cx - hw, y0, cz - hl, cx + hw, y0 + CH, cz - hl + t, "metal", o("pz"));
      if (open) {
        b.lootAt(cx + rng.range(-0.6, 0.6), y0 + 0.14, cz + rng.range(-2, 2));
        if (rng.chance(0.6)) b.lootAt(cx + rng.range(-0.6, 0.6), y0 + 0.14, cz + rng.range(-2, 2));
        const inside = b.node(cx, y0 + 0.12, cz, b.rooms.length);
        b.rooms.push({
          x0: cx - hw + t,
          x1: cx + hw - t,
          z0: cz - hl + t,
          z1: cz + hl - t,
          floor: 0,
          node: inside,
          y: y0 + 0.12,
        });
        const out = b.node(cx, 0.05, cz + end * (hl + 1.2));
        b.edge(inside, out);
        nodes.push(out);
      }
    }
  }
  b.entrances = nodes;
}

function genTower(b) {
  // watchtower: platform at 4 m on posts, external stair along +x side
  const rng = b.rng;
  const P = 4.0; // platform height
  const hw = 1.9;
  const zc = -2.2; // platform center (local z)
  const post = (x, z) =>
    b.box(x - 0.12, 0, z - 0.12, x + 0.12, P + 2.6, z + 0.12, "wood", { tint: 0x7a6248 });
  post(-hw, zc - hw);
  post(hw, zc - hw);
  post(-hw, zc + hw);
  post(hw, zc + hw);
  b.box(-hw - 0.1, P - 0.2, zc - hw - 0.1, hw + 0.1, P, zc + hw + 0.1, "wood", {
    tint: 0x8a7050,
    interior: true,
  });
  // railings with a gap for the stairs
  b.box(-hw, P, zc - hw, hw, P + 1.0, zc - hw + 0.08, "wood", { tint: 0x7a6248 });
  b.box(-hw, P, zc - hw, -hw + 0.08, P + 1.0, zc + hw, "wood", { tint: 0x7a6248 });
  b.box(hw - 0.08, P, zc - hw, hw, P + 1.0, zc + hw, "wood", { tint: 0x7a6248 });
  b.box(-hw, P, zc + hw - 0.08, hw - 1.2, P + 1.0, zc + hw, "wood", { tint: 0x7a6248 });
  // roof
  b.box(-hw - 0.4, P + 2.6, zc - hw - 0.4, hw + 0.4, P + 2.8, zc + hw + 0.4, "metal", { tint: 0x5d6356 });
  // stairs: from ground up to the platform edge (rising toward -z)
  const steps = Math.round(P / STEP_RISE);
  const x0 = hw - 1.15;
  const x1 = hw - 0.1;
  const zTop = zc + hw;
  for (let i = 0; i < steps; i++) {
    const zA = zTop + (steps - 1 - i) * STEP_RUN;
    b.box(x0, 0, zA, x1, (i + 1) * STEP_RISE, zA + STEP_RUN, "wood", { tint: 0x8a7050 });
  }
  b.lootAt(rng.range(-1, 1), P + 0.02, zc + rng.range(-1, 0.5));
  b.lootAt(rng.range(-1, 1), P + 0.02, zc + rng.range(-1, 0.5));
  b.lootAt(0, 0.05, zc);
  const bottom = b.node((x0 + x1) / 2, 0.05, zTop + steps * STEP_RUN + 0.6);
  const top = b.node((x0 + x1) / 2, P, zTop - 0.5, 0);
  const center = b.node(0, P, zc, 0);
  b.rooms.push({
    x0: -hw + 0.2,
    x1: hw - 0.2,
    z0: zc - hw + 0.2,
    z1: zc + hw - 0.2,
    floor: 1,
    node: center,
    y: P,
  });
  b.edge(bottom, top);
  b.edge(top, center);
  b.entrances = [bottom];
}

function genShed(b) {
  genHouse(b, {
    W: 5,
    D: 6,
    floors: 1,
    roof: "flat",
    ext: "rust",
    tint: 0xc9b9a6,
    floorMat: "floorC",
    furnish: "none",
    lootPerRoom: 2,
  });
}

// ---------------------------------------------------------------- entry

export function generateBuilding(plot, rng) {
  const b = new Builder(plot, rng);
  const t = plot.type;
  switch (t) {
    case "house_small":
      genHouse(b, {
        W: plot.w,
        D: plot.d,
        floors: 1,
        roof: "pitched",
        roofTint: rng.pick([0xd8b8a0, 0xc09080, 0x9a8078, 0x8c8c94, 0xb0a090]),
      });
      break;
    case "house_two":
      genHouse(b, {
        W: plot.w,
        D: plot.d,
        floors: 2,
        roof: rng.chance(0.5) ? "pitched" : "flat",
        ext: rng.chance(0.35) ? "brick" : "plaster",
        roofTint: rng.pick([0xd8b8a0, 0xc09080, 0x8c8c94]),
      });
      break;
    case "apartment":
      genHouse(b, {
        W: plot.w,
        D: plot.d,
        floors: 3,
        roof: "flat",
        ext: rng.chance(0.5) ? "concrete" : "plaster",
        tint: rng.pick(PALETTES.apartment),
        lootPerRoom: 2,
      });
      break;
    case "barracks":
      genHouse(b, {
        W: plot.w,
        D: plot.d,
        floors: 1,
        roof: "flat",
        ext: "concrete",
        tint: 0xb5b0a0,
        furnish: "barracks",
        floorMat: "floorC",
        lootPerRoom: 3,
      });
      break;
    case "school":
      genHouse(b, {
        W: plot.w,
        D: plot.d,
        floors: 2,
        roof: "flat",
        ext: "brick",
        tint: 0xffffff,
        furnish: "class",
        floorMat: "floorC",
        lootPerRoom: 2,
      });
      break;
    case "warehouse":
      genHall(b, {
        W: plot.w,
        D: plot.d,
        H: 7,
        mat: rng.chance(0.5) ? "rust" : "metal",
        tint: rng.pick([0xffffff, 0xd8d0c0, 0xa8b8c8]),
      });
      break;
    case "factory_hall":
      genHall(b, {
        W: plot.w,
        D: plot.d,
        H: 9,
        mat: "concrete",
        tint: 0xcfc8ba,
        roofMat: "metal",
        machines: true,
      });
      break;
    case "barn":
      genHall(b, {
        W: plot.w,
        D: plot.d,
        H: 5,
        mat: "wood",
        tint: 0xa0584a,
        pitched: true,
        roofMat: "rust",
        roofTint: 0xffffff,
      });
      break;
    case "containers":
      genContainers(b);
      break;
    case "tower":
      genTower(b);
      break;
    case "shed":
    default:
      genShed(b);
      break;
  }
  if (!b.entrances) b.entrances = [];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const bx of b.boxes) {
    for (let a = 0; a < 3; a++) {
      bounds.min[a] = Math.min(bounds.min[a], bx.min[a]);
      bounds.max[a] = Math.max(bounds.max[a], bx.max[a]);
    }
  }
  return {
    plot,
    boxes: b.boxes,
    prisms: b.prisms,
    doors: b.doors,
    loot: b.loot,
    nav: b.nav,
    rooms: b.rooms.map((r) => {
      const [x0, , z0] = b.toWorld(r.x0, 0, r.z0);
      const [x1, , z1] = b.toWorld(r.x1, 0, r.z1);
      return {
        minX: Math.min(x0, x1),
        maxX: Math.max(x0, x1),
        minZ: Math.min(z0, z1),
        maxZ: Math.max(z0, z1),
        y: plot.y + r.y,
        node: r.node,
      };
    }),
    entrances: b.entrances,
    bounds,
  };
}
