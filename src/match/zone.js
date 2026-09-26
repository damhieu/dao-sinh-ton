// Shrinking play zone ("bo") schedule. Pure module (no three.js).

// wait: seconds the next circle is shown before shrinking; shrink: seconds to shrink; r: target radius
export const ZONE_PHASES = [
  { wait: 120, shrink: 120, r: 600, dps: 0.5 },
  { wait: 90, shrink: 90, r: 350, dps: 1 },
  { wait: 75, shrink: 60, r: 200, dps: 2 },
  { wait: 60, shrink: 45, r: 110, dps: 4 },
  { wait: 45, shrink: 35, r: 55, dps: 6 },
  { wait: 35, shrink: 30, r: 25, dps: 8 },
  { wait: 25, shrink: 25, r: 0, dps: 12 },
];

export class ZoneSchedule {
  constructor(rng, { center, r0, isLand = () => true, startDelay = 60, speed = 1 }) {
    this.rng = rng;
    this.isLand = isLand;
    this.circles = [{ x: center.x, z: center.z, r: r0 }];
    for (let i = 0; i < ZONE_PHASES.length; i++) {
      this.circles.push(this.pickNext(this.circles[i], ZONE_PHASES[i].r, i === 0));
    }
    this.timeline = [];
    let t = startDelay * speed;
    for (const p of ZONE_PHASES) {
      const tA = t;
      const tS = tA + p.wait * speed;
      const tE = tS + p.shrink * speed;
      this.timeline.push({ tA, tS, tE });
      t = tE;
    }
    this.cur = { ...this.circles[0] };
    this.next = { ...this.circles[0] };
    this.phase = -1;
    this.state = "idle";
    this.timeLeft = this.timeline[0].tA;
    this.dps = 0;
  }

  pickNext(prev, r, first) {
    const maxOff = Math.max(0, prev.r - r);
    // the first circle comes from the whole map: keep its center well inside the island
    const spread = first ? Math.min(maxOff, 420) : maxOff;
    let cand = { x: prev.x, z: prev.z, r };
    for (let tries = 0; tries < 40; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = Math.sqrt(this.rng.next()) * spread;
      cand = { x: prev.x + Math.cos(a) * d, z: prev.z + Math.sin(a) * d, r };
      if (this.isLand(cand.x, cand.z)) break;
    }
    return cand;
  }

  update(t) {
    const TL = this.timeline;
    if (t < TL[0].tA) {
      this.state = "idle";
      this.phase = -1;
      Object.assign(this.cur, this.circles[0]);
      Object.assign(this.next, this.circles[0]);
      this.timeLeft = TL[0].tA - t;
      this.dps = 0;
      return this;
    }
    const last = TL.length - 1;
    if (t >= TL[last].tE) {
      this.state = "done";
      this.phase = last;
      Object.assign(this.cur, this.circles[last + 1]);
      Object.assign(this.next, this.circles[last + 1]);
      this.timeLeft = 0;
      this.dps = ZONE_PHASES[last].dps;
      return this;
    }
    let i = 0;
    while (i < last && t >= TL[i].tE) i++;
    const a = this.circles[i];
    const b = this.circles[i + 1];
    this.phase = i;
    Object.assign(this.next, b);
    if (t < TL[i].tS) {
      this.state = "waiting";
      Object.assign(this.cur, a);
      this.timeLeft = TL[i].tS - t;
      this.dps = i > 0 ? ZONE_PHASES[i - 1].dps : ZONE_PHASES[0].dps;
    } else {
      this.state = "shrinking";
      const f = (t - TL[i].tS) / (TL[i].tE - TL[i].tS);
      this.cur.x = a.x + (b.x - a.x) * f;
      this.cur.z = a.z + (b.z - a.z) * f;
      this.cur.r = a.r + (b.r - a.r) * f;
      this.timeLeft = TL[i].tE - t;
      this.dps = ZONE_PHASES[i].dps;
    }
    return this;
  }

  distanceOutside(x, z) {
    return Math.hypot(x - this.cur.x, z - this.cur.z) - this.cur.r;
  }

  outside(x, z) {
    return this.distanceOutside(x, z) > 0;
  }
}
