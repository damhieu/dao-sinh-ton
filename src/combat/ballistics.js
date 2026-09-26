// Projectile simulation: bullets fly with gravity; each frame the travelled segment is tested against
// the static world (collision grid + terrain) and character hitboxes (capsules from the posed rig).
import { stepBullet } from "./ballistics-core.js";
import { F_BULLET } from "../world/collision.js";
import { HITBOX_PARTS } from "../actors/rig.js";

// Ray vs capsule (Inigo Quilez). Direction normalized. Returns t or -1.
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const oax = ox - ax;
  const oay = oy - ay;
  const oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-8) {
    // sphere
    const b = oax * dx + oay * dy + oaz * dz;
    const c = oax * oax + oay * oay + oaz * oaz - r * r;
    const h = b * b - c;
    if (h < 0) return -1;
    return -b - Math.sqrt(h);
  }
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    const ocx = y <= 0 ? oax : ox - bx;
    const ocy = y <= 0 ? oay : oy - by;
    const ocz = y <= 0 ? oaz : oz - bz;
    b = dx * ocx + dy * ocy + dz * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = b * b - c;
    if (h > 0) return -b - Math.sqrt(h);
  }
  return -1;
}

// Nearest hitbox of `ch` along the segment; returns {t, part} or null
export function hitCharacter(ch, rig, ox, oy, oz, dx, dy, dz, maxT) {
  rig.ensurePose(ch);
  const hb = ch.hitboxes;
  let best = maxT;
  let part = -1;
  for (let k = 0; k < 11; k++) {
    const o = k * 7;
    const t = rayCapsule(
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      hb[o],
      hb[o + 1],
      hb[o + 2],
      hb[o + 3],
      hb[o + 4],
      hb[o + 5],
      hb[o + 6],
    );
    if (t >= 0 && t < best) {
      best = t;
      part = k;
    }
  }
  return part >= 0 ? { t: best, part: HITBOX_PARTS[part], k: part } : null;
}

const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: "", id: -1, mat: 0 };

export class Ballistics {
  constructor(game) {
    this.game = game;
    this.bullets = [];
  }

  fire(shooter, ox, oy, oz, dx, dy, dz, def, opts = {}) {
    const sp = def.speed;
    const b = {
      alive: true,
      x: ox,
      y: oy,
      z: oz,
      vx: dx * sp,
      vy: dy * sp,
      vz: dz * sp,
      shooter,
      def,
      dist: 0,
      life: 0,
      whizzed: false,
      pellet: !!opts.pellet,
    };
    this.bullets.push(b);
    return b;
  }

  update(dt) {
    const game = this.game;
    const col = game.world.collision;
    const chars = game.characters;
    const player = game.player;
    const out = [];
    for (const b of this.bullets) {
      if (!b.alive) continue;
      const x0 = b.x;
      const y0 = b.y;
      const z0 = b.z;
      stepBullet(b, dt);
      let dx = b.x - x0;
      let dy = b.y - y0;
      let dz = b.z - z0;
      const len = Math.hypot(dx, dy, dz);
      dx /= len;
      dy /= len;
      dz /= len;
      let tW = Infinity;
      if (col.raycast(x0, y0, z0, dx, dy, dz, len, F_BULLET, _hit)) tW = _hit.t;
      // characters near the segment
      let hitCh = null;
      let hitInfo = null;
      const maxT = Math.min(len, tW);
      for (const ch of chars) {
        if (!ch.alive || ch === b.shooter || ch.mode === "plane") continue;
        const cx = ch.body.x - x0;
        const cy = ch.body.y + 0.9 - y0;
        const cz = ch.body.z - z0;
        const along = cx * dx + cy * dy + cz * dz;
        if (along < -2 || along > maxT + 2) continue;
        const px = cx - dx * along;
        const py = cy - dy * along;
        const pz = cz - dz * along;
        if (px * px + py * py + pz * pz > 4) continue;
        const h = hitCharacter(ch, game.rig, x0, y0, z0, dx, dy, dz, hitInfo ? hitInfo.t : maxT);
        if (h) {
          hitCh = ch;
          hitInfo = h;
        }
      }
      // vehicles
      let hitVeh = null;
      let tV = Infinity;
      if (game.vehicles) {
        const r = game.vehicles.raycast(x0, y0, z0, dx, dy, dz, Math.min(maxT, hitInfo ? hitInfo.t : maxT));
        if (r) {
          hitVeh = r.vehicle;
          tV = r.t;
        }
      }
      if (hitCh && hitInfo.t <= tV) {
        const t = hitInfo.t;
        b.alive = false;
        game.onBulletHitCharacter(
          b,
          hitCh,
          hitInfo.part,
          x0 + dx * t,
          y0 + dy * t,
          z0 + dz * t,
          dx,
          dy,
          dz,
          b.dist + t,
        );
      } else if (hitVeh) {
        b.alive = false;
        game.onBulletHitVehicle(b, hitVeh, x0 + dx * tV, y0 + dy * tV, z0 + dz * tV);
      } else if (tW < Infinity) {
        b.alive = false;
        b.x = x0 + dx * tW;
        b.y = y0 + dy * tW;
        b.z = z0 + dz * tW;
        game.onBulletImpact(b, b.x, b.y, b.z, _hit.nx, _hit.ny, _hit.nz, _hit.mat, _hit.kind);
      }
      // near miss (supersonic crack) for the local player
      if (!b.whizzed && player && player.alive && b.shooter !== player) {
        const hx = player.body.x - x0;
        const hy = player.body.y + 1.5 - y0;
        const hz = player.body.z - z0;
        const along = hx * dx + hy * dy + hz * dz;
        if (along > 0 && along < len) {
          const d2 = hx * hx + hy * hy + hz * hz - along * along;
          if (d2 < 6) {
            b.whizzed = true;
            game.onBulletWhiz(b, x0 + dx * along, y0 + dy * along, z0 + dz * along);
          }
        }
      }
      b.dist += len;
      b.life += dt;
      if (b.dist > 1500 || b.life > 4 || b.y < -30) b.alive = false;
      if (b.alive) out.push(b);
    }
    this.bullets = out;
  }
}
