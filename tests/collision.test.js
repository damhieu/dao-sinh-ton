import { test } from "node:test";
import assert from "node:assert/strict";
import { Heightmap } from "../src/world/heightmap.js";
import { CollisionWorld, F_ALL } from "../src/world/collision.js";

function flatWorld() {
  const hm = new Heightmap(256, 65); // flat at y = 0
  return new CollisionWorld(hm, 8, -100); // sea far below so no swimming
}

function body(x = 0, z = 0) {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, r: 0.35, h: 1.8, stepUp: 0.45, onGround: true, inWater: false };
}

function simulate(w, b, seconds, fn) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    if (fn) fn(b);
    w.moveBody(b, dt, 15.7);
  }
}

test("raycast hits a box with the right distance and normal", () => {
  const w = flatWorld();
  w.addBox(4, 0, -1, 5, 3, 1);
  const hit = {};
  assert.ok(w.raycast(0, 1, 0, 1, 0, 0, 100, F_ALL, hit));
  assert.ok(Math.abs(hit.t - 4) < 1e-4, `t=${hit.t}`);
  assert.equal(hit.kind, "box");
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [-1, 0, 0]);
});

test("raycast straight down hits flat terrain", () => {
  const w = flatWorld();
  const hit = {};
  assert.ok(w.raycast(0, 10, 0, 0, -1, 0, 100, F_ALL, hit));
  assert.equal(hit.kind, "terrain");
  assert.ok(Math.abs(hit.t - 10) < 0.01);
});

test("raycast hits a cylinder (tree trunk)", () => {
  const w = flatWorld();
  w.addCylinder(3, 0, 0.5, 0, 8);
  const hit = {};
  assert.ok(w.raycast(0, 1, 0, 1, 0, 0, 100, F_ALL, hit));
  assert.ok(Math.abs(hit.t - 2.5) < 1e-3, `t=${hit.t}`);
  assert.equal(hit.kind, "cyl");
});

test("body stops against a wall", () => {
  const w = flatWorld();
  w.addBox(4, 0, -5, 5, 3, 5);
  const b = body();
  simulate(w, b, 2, (b) => (b.vx = 5));
  assert.ok(Math.abs(b.x - 3.65) < 0.02, `x=${b.x}`);
});

test("body steps up a low step but is blocked by a high one", () => {
  const w = flatWorld();
  w.addBox(2, 0, -5, 3, 0.3, 5);
  const b = body();
  let maxY = 0;
  simulate(w, b, 1, (b) => {
    b.vx = 5;
    if (b.x > 2.4 && b.x < 2.6) maxY = Math.max(maxY, b.y);
  });
  assert.ok(b.x > 3, `passed the step, x=${b.x}`);
  assert.ok(Math.abs(maxY - 0.3) < 0.01, `stood on the step, y=${maxY}`);

  const w2 = flatWorld();
  w2.addBox(2, 0, -5, 3, 1.0, 5);
  const b2 = body();
  simulate(w2, b2, 1, (b) => (b.vx = 5));
  assert.ok(b2.x <= 1.66, `blocked, x=${b2.x}`);
});

test("ceiling stops a jump", () => {
  const w = flatWorld();
  w.addBox(-5, 2, -5, 5, 2.2, 5);
  const b = body();
  b.vy = 6;
  b.onGround = false;
  let top = 0;
  simulate(w, b, 1, (b) => (top = Math.max(top, b.y + b.h)));
  assert.ok(top <= 2.0 + 1e-6, `head reached ${top}`);
  assert.ok(b.onGround);
});

test("disabled collider (open door) lets the body pass", () => {
  const w = flatWorld();
  const id = w.addBox(4, 0, -5, 4.2, 3, 5);
  w.setEnabled(id, false);
  const b = body();
  simulate(w, b, 2, (b) => (b.vx = 5));
  assert.ok(b.x > 8, `x=${b.x}`);
});

test("sphere rocks can be stood on and block movement", () => {
  const w = flatWorld();
  w.addSphere(3, -0.5, 0, 1.2);
  const b = body();
  simulate(w, b, 1, (b) => (b.vx = 3));
  assert.ok(b.x < 3, `rock blocked at ${b.x}`);
  assert.ok(Math.abs(w.groundAt(3, 0, 0.3, 5) - 0.7) < 0.01);
});

test("performance: 10k raycasts over 20k boxes", () => {
  const hm = new Heightmap(2048, 513);
  const w = new CollisionWorld(hm, 8, -100);
  let s = 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 20000; i++) {
    const x = rnd() * 2000 - 1000;
    const z = rnd() * 2000 - 1000;
    w.addBox(x, 0, z, x + 0.3 + rnd() * 4, rnd() * 6, z + 0.3 + rnd() * 4);
  }
  const hit = {};
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    const a = rnd() * Math.PI * 2;
    w.raycast(rnd() * 1800 - 900, 1.5, rnd() * 1800 - 900, Math.cos(a), -0.01, Math.sin(a), 100, F_ALL, hit);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 150, `took ${ms.toFixed(1)} ms`);
});
