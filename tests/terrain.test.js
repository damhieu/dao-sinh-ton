import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTerrainData } from "../src/world/terraingen.js";
import { plotBounds } from "../src/world/layout.js";

const T = generateTerrainData(20260926);
const { hm } = T;

function checksum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i += 7) s = (s + arr[i] * ((i % 13) + 1)) % 1e9;
  return s;
}

test("generation is deterministic", () => {
  const T2 = generateTerrainData(20260926);
  assert.equal(checksum(T2.hm.heights), checksum(hm.heights));
  assert.equal(T2.plots.length, T.plots.length);
});

test("island: corners are sea, reasonable land fraction", () => {
  for (const [x, z] of [
    [-1000, -1000],
    [1000, -1000],
    [-1000, 1000],
    [1000, 1000],
  ]) {
    assert.ok(hm.getHeight(x, z) < -5, `corner ${x},${z} = ${hm.getHeight(x, z)}`);
  }
  let land = 0;
  for (let i = 0; i < hm.heights.length; i++) if (hm.heights[i] > 2) land++;
  const frac = land / hm.heights.length;
  assert.ok(frac > 0.25 && frac < 0.6, `land fraction ${frac}`);
});

test("towns are on flat land", () => {
  assert.equal(T.towns.length, 8);
  for (const t of T.towns) {
    assert.ok(hm.getHeight(t.x, t.z) > 1.5, `${t.id} height`);
    let s = 0;
    let s2 = 0;
    let n = 0;
    const r = t.radius * 0.6;
    for (let dz = -r; dz <= r; dz += 6) {
      for (let dx = -r; dx <= r; dx += 6) {
        if (dx * dx + dz * dz > r * r) continue;
        const h = hm.getHeight(t.x + dx, t.z + dz);
        s += h;
        s2 += h * h;
        n++;
      }
    }
    const std = Math.sqrt(s2 / n - (s / n) ** 2);
    assert.ok(std < 1.2, `${t.id} std ${std}`);
  }
});

test("roads connect towns, stay on land, and have gentle grades", () => {
  assert.ok(T.roads.length >= 7);
  for (const r of T.roads) {
    const P = r.points;
    const near = (p) => T.towns.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < t.radius + 20);
    assert.ok(near(P[0]) && near(P[P.length - 1]), `road ${r.from}-${r.to} endpoints`);
    for (let i = 0; i < P.length; i++) {
      assert.ok(P[i].y > 0.3, `road point below sea ${P[i].y}`);
      if (i > 0) {
        const ds = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
        const g = Math.abs(P[i].y - P[i - 1].y) / Math.max(ds, 0.01);
        assert.ok(g < 0.18, `grade ${g.toFixed(3)} on ${r.from}-${r.to}`);
      }
    }
  }
});

test("plots do not overlap and sit on land", () => {
  const P = T.plots;
  assert.ok(P.length >= 150 && P.length <= 260, `plot count ${P.length}`);
  for (let a = 0; a < P.length; a++) {
    assert.ok(P[a].y > 1, `plot ${a} base ${P[a].y}`);
    const A = plotBounds(P[a], 1);
    for (let b = a + 1; b < P.length; b++) {
      const B = plotBounds(P[b], 1);
      const hit = A.minX < B.maxX && A.maxX > B.minX && A.minZ < B.maxZ && A.maxZ > B.minZ;
      assert.ok(!hit, `plots ${a} (${P[a].type}) and ${b} (${P[b].type}) overlap`);
    }
  }
});

test("terrain raycast straight down matches height", () => {
  const t = hm.raycast(0, 500, 0, 0, -1, 0, 1000);
  assert.ok(Math.abs(t - (500 - hm.getHeight(0, 0))) < 0.05);
});

test("masks have expected size and content", () => {
  assert.equal(T.masks.road.length, T.maskRes * T.maskRes);
  let roadTexels = 0;
  for (const v of T.masks.road) if (v > 128) roadTexels++;
  assert.ok(roadTexels > 2000, `road texels ${roadTexels}`);
  assert.ok(T.vehicleSpawns.length >= 12, `vehicles ${T.vehicleSpawns.length}`);
});
