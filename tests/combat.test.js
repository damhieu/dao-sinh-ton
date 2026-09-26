import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHit } from "../src/combat/damage.js";
import { dropAt, stepBullet } from "../src/combat/ballistics-core.js";
import { WEAPONS } from "../src/items/itemdefs.js";

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const W = WEAPONS;

test("body shot without armor deals base damage", () => {
  assert.equal(computeHit({ weapon: W.m416, part: "torso", distance: 50 }).damage, 40);
});

test("headshot multiplier", () => {
  assert.ok(near(computeHit({ weapon: W.m416, part: "head", distance: 50 }).damage, 92));
});

test("helmet reduces head damage and takes durability", () => {
  const r = computeHit({ weapon: W.m416, part: "head", distance: 50, helmet: { level: 2, durability: 150 } });
  assert.ok(near(r.damage, 55.2), `damage ${r.damage}`);
  assert.ok(near(r.helmetDmg, 92));
});

test("AWM one-shots a level 2 helmet; Kar98k does not one-shot level 3", () => {
  const awm = computeHit({
    weapon: W.awm,
    part: "head",
    distance: 200,
    helmet: { level: 2, durability: 150 },
  });
  assert.ok(awm.damage >= 150, `awm ${awm.damage}`);
  const kar = computeHit({
    weapon: W.kar98k,
    part: "head",
    distance: 200,
    helmet: { level: 3, durability: 230 },
  });
  assert.ok(near(kar.damage, 88.875, 0.01) && kar.damage < 100, `kar ${kar.damage}`);
});

test("vest does not protect limbs", () => {
  const r = computeHit({ weapon: W.akm, part: "limb", distance: 20, vest: { level: 3, durability: 250 } });
  assert.ok(near(r.damage, 28.2), `limb ${r.damage}`);
  assert.equal(r.vestDmg, 0);
});

test("SMG damage falls off with distance", () => {
  const r = computeHit({ weapon: W.ump, part: "torso", distance: 200 });
  assert.ok(r.damage < 39 * 0.8, `ump@200 ${r.damage}`);
  assert.equal(computeHit({ weapon: W.ump, part: "torso", distance: 20 }).damage, 39);
});

test("bullet drop matches kinematics", () => {
  assert.ok(Math.abs(dropAt(880, 100) - 0.0633) / 0.0633 < 0.02, `drop100 ${dropAt(880, 100)}`);
  assert.ok(Math.abs(dropAt(880, 300) - 0.57) / 0.57 < 0.02, `drop300 ${dropAt(880, 300)}`);
});

test("numerical bullet integration stays close to the analytic path", () => {
  const b = { x: 0, y: 0, z: 0, vx: 880, vy: 0, vz: 0 };
  const dt = 1 / 60;
  while (b.x < 300) stepBullet(b, dt);
  // interpolate back to x = 300
  const over = (b.x - 300) / b.vx;
  const y300 = b.y - b.vy * over;
  assert.ok(Math.abs(-y300 - dropAt(880, 300)) < 0.03, `y300 ${y300}`);
});
