// What a bot knows about other characters: gradual spotting (awareness), memory, hearing.
import { F_VISION } from "../world/collision.js";

const FOV_COS = Math.cos((72 * Math.PI) / 180);

export class Perception {
  constructor(bot) {
    this.bot = bot;
    this.known = new Map(); // Character -> {x,y,z,t,aware,visible,firstSeen}
  }

  entry(ch) {
    let e = this.known.get(ch);
    if (!e) {
      e = { x: ch.body.x, y: ch.body.y, z: ch.body.z, t: -99, aware: 0, visible: false, firstSeen: -1 };
      this.known.set(ch, e);
    }
    return e;
  }

  // Direct knowledge (e.g. took damage from this character)
  alert(ch, now, strength = 1) {
    const e = this.entry(ch);
    e.aware = Math.max(e.aware, strength);
    e.x = ch.body.x;
    e.y = ch.body.y;
    e.z = ch.body.z;
    e.t = now;
  }

  // Heard a gunshot from (x,y,z) fired by `ch`
  hear(ch, x, y, z, now, dist) {
    const e = this.entry(ch);
    const err = Math.min(25, dist * 0.08);
    e.x = x + (Math.random() - 0.5) * err;
    e.y = y;
    e.z = z + (Math.random() - 0.5) * err;
    e.t = now;
    e.heard = now;
    e.aware = Math.max(e.aware, Math.min(0.85, e.aware + 0.35));
  }

  update(dt, match, sightRange) {
    const me = this.bot.ch;
    const b = me.body;
    const eyeY = b.y + me.eyeHeight();
    const fx = -Math.sin(me.yaw);
    const fz = -Math.cos(me.yaw);
    const col = match.world.collision;
    const veg = match.world.vegetation;
    const now = match.time;
    for (const t of match.characters) {
      if (t === me || !t.alive || t.mode === "plane") continue;
      const tb = t.body;
      const dx = tb.x - b.x;
      const dz = tb.z - b.z;
      const d = Math.hypot(dx, dz);
      const e = this.known.get(t);
      if (d > sightRange && !e) continue;
      let vis = 0;
      if (d <= sightRange) {
        const cosA = d > 0.5 ? (dx * fx + dz * fz) / d : 1;
        const inFov = cosA > FOV_COS || d < 8;
        if (inFov) {
          const ty = tb.y + (t.stance === "prone" ? 0.3 : t.stance === "crouch" ? 0.9 : 1.35);
          if (
            col.visible(b.x, eyeY, b.z, tb.x, ty, tb.z, F_VISION) &&
            !match.smokeBlocks(b.x, eyeY, b.z, tb.x, ty, tb.z)
          ) {
            vis = 1;
            if (t.stance === "crouch") vis *= 0.72;
            if (t.stance === "prone") vis *= d > 60 ? 0.3 : 0.5;
            if (veg.inBush(tb.x, tb.y, tb.z)) vis *= 0.35;
            if (t.moveSpeed > 3) vis *= 1.35;
            if (t.firingTime > 0) vis *= 2.2;
            if (t.mode === "chute" || t.mode === "freefall") vis *= 1.5;
            vis *= Math.max(0.06, 1 - d / sightRange) ** 0.7;
            // peripheral vision is slower
            if (cosA < 0.6 && d > 8) vis *= 0.5;
          }
        }
      }
      const en = e || (vis > 0 ? this.entry(t) : null);
      if (!en) continue;
      if (vis > 0) {
        en.aware = Math.min(1.5, en.aware + vis * dt * 2.6);
        if (en.aware >= 1) {
          if (!en.visible) en.firstSeen = now;
          en.visible = true;
          en.x = tb.x;
          en.y = tb.y;
          en.z = tb.z;
          en.t = now;
          en.vx = tb.vx;
          en.vz = tb.vz;
        }
      } else {
        en.visible = false;
        en.aware = Math.max(0, en.aware - dt * 0.08);
        if (now - en.t > 30 && en.aware < 0.2) this.known.delete(t);
      }
    }
    // forget dead characters
    for (const t of this.known.keys()) if (!t.alive) this.known.delete(t);
  }

  // best currently visible target (closest, weighted by threat)
  bestVisible() {
    const me = this.bot.ch.body;
    let best = null;
    let bs = Infinity;
    for (const [t, e] of this.known) {
      if (!e.visible) continue;
      const d = Math.hypot(t.body.x - me.x, t.body.z - me.z);
      const s = d - (t.firingTime > 0 ? 30 : 0);
      if (s < bs) {
        bs = s;
        best = t;
      }
    }
    return best;
  }

  // most recent non-visible memory (to investigate / pre-aim)
  lastKnown(maxAge, now) {
    let best = null;
    let bt = -Infinity;
    for (const [t, e] of this.known) {
      if (e.visible || now - e.t > maxAge || e.aware < 0.3) continue;
      if (e.t > bt) {
        bt = e.t;
        best = t;
      }
    }
    return best;
  }
}
