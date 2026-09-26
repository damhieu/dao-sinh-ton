import { test } from "node:test";
import assert from "node:assert/strict";
import { createNoise2D, fbm2, ridged2 } from "../src/core/noise.js";

test("same seed gives same values", () => {
  const a = createNoise2D(9);
  const b = createNoise2D(9);
  for (let i = 0; i < 50; i++) assert.equal(a(i * 0.37, i * 0.91), b(i * 0.37, i * 0.91));
});

test("noise stays within [-1, 1] and is not constant", () => {
  const n = createNoise2D(1);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 10000; i++) {
    const v = n(i * 0.173 - 400, i * 0.0917 + 25);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(min >= -1 && max <= 1, `range ${min}..${max}`);
  assert.ok(max - min > 1, "noise should vary");
});

test("noise is continuous", () => {
  const n = createNoise2D(2);
  for (let i = 0; i < 1000; i++) {
    const x = i * 0.61;
    const y = i * 0.29;
    assert.ok(Math.abs(n(x, y) - n(x + 0.001, y)) < 0.01);
  }
});

test("fbm in [-1,1], ridged in [0,1]", () => {
  const n = createNoise2D(3);
  for (let i = 0; i < 3000; i++) {
    const f = fbm2(n, i * 0.13, i * 0.07);
    const r = ridged2(n, i * 0.13, i * 0.07);
    assert.ok(f >= -1 && f <= 1);
    assert.ok(r >= 0 && r <= 1);
  }
});
