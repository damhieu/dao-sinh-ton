import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBuilding, FLOOR_H } from "../src/world/buildinggen.js";
import { BUILDING_TYPES } from "../src/world/layout.js";
import { Heightmap } from "../src/world/heightmap.js";
import { CollisionWorld, F_ALL } from "../src/world/collision.js";
import { RNG } from "../src/core/rng.js";

const TYPES = Object.keys(BUILDING_TYPES);

function build(type, seed, rot = 0) {
  const base = BUILDING_TYPES[type];
  const plot = { x: 10, z: -20, w: base.w, d: base.d, rot, type, y: 3, tier: 2 };
  return generateBuilding(plot, new RNG(seed));
}

function worldFor(b) {
  const hm = new Heightmap(256, 65);
  hm.heights.fill(3); // flat ground at the plot base
  const w = new CollisionWorld(hm, 8, -100);
  for (const bx of b.boxes) if (bx.solid) w.addBox(...bx.min, ...bx.max, F_ALL);
  return w;
}

test("every building type generates valid boxes", () => {
  for (const type of TYPES) {
    for (let s = 1; s <= 10; s++) {
      const b = build(type, s, s % 4);
      assert.ok(b.boxes.length > 3, `${type} has boxes`);
      for (const bx of b.boxes) {
        for (let a = 0; a < 3; a++) assert.ok(bx.max[a] > bx.min[a], `${type} degenerate box`);
      }
    }
  }
});

test("door openings are passable", () => {
  for (const type of TYPES) {
    for (let s = 1; s <= 10; s++) {
      const b = build(type, s, s % 4);
      const w = worldFor(b);
      const hit = {};
      for (const d of b.doors) {
        const y = d.y + 1.0;
        const [ox, oz, dx, dz] = d.axis === "x" ? [d.x, d.z - 1, 0, 1] : [d.x - 1, d.z, 1, 0];
        const blocked = w.raycast(ox, y, oz, dx, 0, dz, 2, F_ALL, hit, true);
        assert.ok(!blocked, `${type} seed ${s}: door at ${d.x.toFixed(1)},${d.z.toFixed(1)} blocked`);
      }
    }
  }
});

test("loot points are reachable spots (not inside solids)", () => {
  for (const type of TYPES) {
    for (let s = 1; s <= 10; s++) {
      const b = build(type, s, s % 4);
      assert.ok(b.loot.length > 0, `${type} has loot points`);
      for (const p of b.loot) {
        for (const bx of b.boxes) {
          if (!bx.solid) continue;
          const inside =
            p.x > bx.min[0] + 0.01 &&
            p.x < bx.max[0] - 0.01 &&
            p.y > bx.min[1] + 0.01 &&
            p.y < bx.max[1] - 0.01 &&
            p.z > bx.min[2] + 0.01 &&
            p.z < bx.max[2] - 0.01;
          assert.ok(!inside, `${type} seed ${s}: loot inside a box`);
        }
      }
    }
  }
});

test("every navigation node is reachable from an entrance", () => {
  for (const type of TYPES) {
    for (let s = 1; s <= 10; s++) {
      const b = build(type, s, s % 4);
      const n = b.nav.nodes.length;
      if (n === 0) continue;
      assert.ok(b.entrances.length > 0, `${type} seed ${s}: no entrance`);
      const adj = Array.from({ length: n }, () => []);
      for (const [a, c] of b.nav.edges) {
        adj[a].push(c);
        adj[c].push(a);
      }
      const seen = new Set(b.entrances);
      const q = [...b.entrances];
      while (q.length) for (const m of adj[q.pop()]) if (!seen.has(m)) seen.add(m), q.push(m);
      assert.equal(seen.size, n, `${type} seed ${s}: ${n - seen.size} unreachable nav nodes`);
    }
  }
});

test("a character can walk up the stairs of a two-storey house", () => {
  for (let s = 1; s <= 8; s++) {
    const b = build("house_two", s, s % 4);
    const w = worldFor(b);
    // stair bottom/top are the only nav nodes one floor apart that are directly linked
    const N = b.nav.nodes;
    const e = b.nav.edges.find(([a, c]) => Math.abs(N[a].y - N[c].y) > FLOOR_H - 0.1);
    assert.ok(e, "stair edge exists");
    const [lo, hi] = N[e[0]].y < N[e[1]].y ? [N[e[0]], N[e[1]]] : [N[e[1]], N[e[0]]];
    const body = {
      x: lo.x,
      y: lo.y,
      z: lo.z,
      vx: 0,
      vy: 0,
      vz: 0,
      r: 0.35,
      h: 1.8,
      stepUp: 0.45,
      onGround: true,
      inWater: false,
    };
    for (let t = 0; t < 6; t += 1 / 60) {
      const dx = hi.x - body.x;
      const dz = hi.z - body.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      body.vx = (dx / d) * 3;
      body.vz = (dz / d) * 3;
      w.moveBody(body, 1 / 60, 15.7);
    }
    assert.ok(
      Math.abs(body.y - hi.y) < 0.15,
      `seed ${s}: reached y=${body.y.toFixed(2)}, want ${hi.y.toFixed(2)}`,
    );
  }
});
