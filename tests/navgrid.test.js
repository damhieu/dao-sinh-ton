import { test } from "node:test";
import assert from "node:assert/strict";
import { Heightmap } from "../src/world/heightmap.js";
import { CollisionWorld } from "../src/world/collision.js";
import { NavGrid } from "../src/world/navgrid.js";

function flatWorld() {
  const hm = new Heightmap(256, 65); // flat at y = 0
  return { hm, collision: new CollisionWorld(hm, 8, -100) };
}

// every step of the path must stay out of blocked cells
function pathIsWalkable(nav, path) {
  for (let k = 1; k < path.length; k++) {
    if (!nav.lineFree(path[k - 1].x, path[k - 1].z, path[k].x, path[k].z)) return false;
  }
  return true;
}

test("open ground: only straight segments", () => {
  const w = flatWorld();
  const nav = new NavGrid(w.hm, w.collision);
  const p = nav.findPath(-50, 0, 50, 10);
  assert.ok(p && p.length >= 1);
  const last = p[p.length - 1];
  assert.ok(Math.hypot(last.x - 50, last.z - 10) < 2.1);
  assert.ok(p.length <= 3, `expected straight 40 m segments, got ${p.length} points`);
});

test("routes around a U-shaped wall instead of into it", () => {
  const w = flatWorld();
  // U opening toward -x; the start sits inside the U, the goal is behind its closed side
  w.collision.addBox(-10, 0, -20, 10, 3, -19); // bottom arm
  w.collision.addBox(-10, 0, 19, 10, 3, 20); // top arm
  w.collision.addBox(10, 0, -20, 11, 3, 20); // closed side
  const nav = new NavGrid(w.hm, w.collision);
  const p = nav.findPath(0, 0, 60, 0);
  assert.ok(p, "no path found");
  assert.ok(pathIsWalkable(nav, [{ x: 0, z: 0 }, ...p]), "path crosses a wall");
  // it has to leave through the opening (x < -10) at some point
  assert.ok(
    p.some((q) => q.x < -9),
    `path never exits the U: ${JSON.stringify(p)}`,
  );
});

test("deep water blocks, shallow land does not", () => {
  const hm = new Heightmap(256, 65);
  // a channel of deep water across the map except for a land bridge at z in [40, 60]
  for (let j = 0; j < hm.res; j++) {
    for (let i = 0; i < hm.res; i++) {
      const x = hm.xOf(i);
      const z = hm.xOf(j);
      if (Math.abs(x) < 12 && !(z > 40 && z < 60)) hm.heights[j * hm.res + i] = -5;
    }
  }
  const w = { hm, collision: new CollisionWorld(hm, 8, 0) };
  const nav = new NavGrid(w.hm, w.collision);
  const p = nav.findPath(-60, 0, 60, 0);
  assert.ok(p, "no path found");
  assert.ok(pathIsWalkable(nav, [{ x: -60, z: 0 }, ...p]));
  assert.ok(
    p.some((q) => q.z > 36 && q.z < 64 && Math.abs(q.x) < 30),
    "path should use the land bridge",
  );
});

test("blocked start or goal snaps to the nearest free cell", () => {
  const w = flatWorld();
  w.collision.addBox(-3, 0, -3, 3, 3, 3);
  const nav = new NavGrid(w.hm, w.collision);
  const p = nav.findPath(0, 0, 40, 0);
  assert.ok(p && p.length >= 1);
});
