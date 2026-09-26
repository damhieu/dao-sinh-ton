// Deterministic seeded RNG (mulberry32) with gameplay helpers. Pure module (no three.js).

export function hashString(str) {
  // FNV-1a 32-bit
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashInts(a, b) {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x632be59b) >>> 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export class RNG {
  constructor(seed = 1) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(p) {
    return this.next() < p;
  }

  // entries: [[value, weight], ...]; zero/negative weights are never chosen
  weighted(entries) {
    let total = 0;
    for (const e of entries) if (e[1] > 0) total += e[1];
    if (total <= 0) return undefined;
    let r = this.next() * total;
    let last;
    for (const e of entries) {
      if (e[1] <= 0) continue;
      last = e[0];
      r -= e[1];
      if (r < 0) return e[0];
    }
    return last;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // Standard normal sample (Box-Muller)
  gauss() {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  fork(salt) {
    return new RNG(hashInts(this.state, salt >>> 0));
  }
}
