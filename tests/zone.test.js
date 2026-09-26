import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoneSchedule, ZONE_PHASES } from "../src/match/zone.js";
import { RNG } from "../src/core/rng.js";

const make = (seed = 1, speed = 1) =>
  new ZoneSchedule(new RNG(seed), {
    center: { x: 0, z: 0 },
    r0: 1500,
    isLand: () => true,
    startDelay: 60,
    speed,
  });

test("idle before the first announcement", () => {
  const z = make();
  z.update(30);
  assert.equal(z.state, "idle");
  assert.equal(z.cur.r, 1500);
});

test("waiting phase shows the next circle inside the current one", () => {
  const z = make();
  z.update(60 + 60);
  assert.equal(z.state, "waiting");
  assert.equal(z.phase, 0);
  assert.equal(z.next.r, 600);
  assert.ok(Math.hypot(z.cur.x - z.next.x, z.cur.z - z.next.z) + z.next.r <= z.cur.r + 1e-6);
});

test("radius shrinks during the shrink stage", () => {
  const z = make();
  z.update(60 + 120 + 60);
  assert.equal(z.state, "shrinking");
  assert.ok(z.cur.r < 1500 && z.cur.r > 600, `r=${z.cur.r}`);
  assert.equal(z.dps, ZONE_PHASES[0].dps);
});

test("the zone closes completely at the end", () => {
  const z = make();
  z.update(100000);
  assert.equal(z.state, "done");
  assert.ok(z.cur.r < 0.01);
});

test("every next circle is nested (20 seeds)", () => {
  for (let s = 1; s <= 20; s++) {
    const z = make(s);
    for (let t = 0; t < 2000; t += 5) {
      z.update(t);
      if (z.state === "waiting") {
        const d = Math.hypot(z.cur.x - z.next.x, z.cur.z - z.next.z);
        assert.ok(d + z.next.r <= z.cur.r + 1e-3, `seed ${s} t ${t}`);
      }
    }
  }
});

test("speed multiplier scales the timeline", () => {
  const z = make(1, 0.6);
  z.update((60 + 120 + 60) * 0.6);
  assert.equal(z.state, "shrinking");
});

test("outside test", () => {
  const z = make();
  z.update(0);
  assert.ok(!z.outside(0, 0));
  assert.ok(z.outside(1600, 0));
});
