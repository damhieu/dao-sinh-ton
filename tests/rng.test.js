import { test } from "node:test";
import assert from "node:assert/strict";
import { RNG, hashString } from "../src/core/rng.js";

test("deterministic per seed", () => {
  const a = new RNG(42);
  const b = new RNG(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test("range/int bounds", () => {
  const r = new RNG(7);
  for (let i = 0; i < 2000; i++) {
    const f = r.range(-2, 3);
    assert.ok(f >= -2 && f < 3);
    const n = r.int(1, 6);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 6);
  }
});

test("int covers both ends", () => {
  const r = new RNG(3);
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test("weighted never returns zero-weight entries", () => {
  const r = new RNG(1);
  for (let i = 0; i < 500; i++) assert.equal(r.weighted([["a", 1], ["b", 0]]), "a");
});

test("fork differs from parent but is deterministic", () => {
  assert.equal(new RNG(5).fork(1).next(), new RNG(5).fork(1).next());
  assert.notEqual(new RNG(5).fork(1).next(), new RNG(5).fork(2).next());
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
});
