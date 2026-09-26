// Drivable vehicles (Jeep / Buggy): arcade raycast-wheel physics on the heightfield, collisions,
// damage/explosions, run-over damage, enter/exit. Rendered with instanced bodies + wheels.
import * as THREE from "three";
import { events } from "../core/events.js";
import { box, rbox, cyl, merge } from "../core/geo.js";
import { F_SOLID } from "../world/collision.js";

const TYPES = {
  jeep: {
    name: "Xe Jeep",
    maxSpeed: 31,
    accel: 9,
    mass: 1,
    grip: 7,
    wheelbase: 2.6,
    track: 1.6,
    halfL: 2.25,
    halfW: 1.05,
    height: 1.15,
    health: 700,
    wheelR: 0.42,
    seatY: 0.62,
    seat: [-0.42, -0.1],
  },
  buggy: {
    name: "Xe Buggy",
    maxSpeed: 36,
    accel: 12,
    mass: 0.7,
    grip: 6,
    wheelbase: 2.3,
    track: 1.5,
    halfL: 1.9,
    halfW: 0.95,
    height: 1.0,
    health: 420,
    wheelR: 0.45,
    seatY: 0.55,
    seat: [-0.3, 0.1],
  },
};

function jeepGeometry() {
  const body = 0x4b5a3a;
  const dark = 0x2a2e26;
  return merge([
    rbox(2.0, 0.7, 4.3, 0.12, body, 0, 0.75, 0),
    rbox(1.9, 0.55, 1.6, 0.1, body, 0, 1.3, 0.5),
    box(1.85, 0.06, 1.7, dark, 0, 1.62, 0.45),
    box(0.06, 0.5, 0.06, dark, -0.9, 1.35, -0.35),
    box(0.06, 0.5, 0.06, dark, 0.9, 1.35, -0.35),
    box(1.8, 0.45, 0.05, 0x6c7d86, 0, 1.3, -0.33, -0.25),
    rbox(1.7, 0.25, 0.3, 0.05, dark, 0, 0.55, -2.15),
    box(0.3, 0.14, 0.05, 0xfff3c0, -0.65, 0.85, -2.16),
    box(0.3, 0.14, 0.05, 0xfff3c0, 0.65, 0.85, -2.16),
    box(0.25, 0.1, 0.05, 0xb01010, -0.8, 0.85, 2.16),
    box(0.25, 0.1, 0.05, 0xb01010, 0.8, 0.85, 2.16),
    cyl(0.3, 0.3, 0.25, dark, 0, 1.0, 2.25, Math.PI / 2, 0, 0, 12),
    box(0.5, 0.35, 0.5, dark, -0.42, 0.95, -0.1),
    box(0.5, 0.35, 0.5, dark, 0.42, 0.95, -0.1),
  ]);
}

function buggyGeometry() {
  const frame = 0xc8a02a;
  const dark = 0x222222;
  const tube = (x0, y0, z0, x1, y1, z1) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const g = cyl(0.045, 0.045, len, frame, 0, 0, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize(),
    );
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
        q,
        new THREE.Vector3(1, 1, 1),
      ),
    );
    return g;
  };
  return merge([
    rbox(1.6, 0.25, 3.6, 0.08, dark, 0, 0.5, 0),
    box(1.2, 0.35, 0.9, 0x3a3a3a, 0, 0.75, 1.3),
    box(0.55, 0.5, 0.55, 0x1a1a1a, -0.3, 0.85, 0.1),
    box(0.55, 0.5, 0.55, 0x1a1a1a, 0.35, 0.85, 0.1),
    tube(-0.75, 0.6, -0.5, -0.6, 1.6, 0.0),
    tube(0.75, 0.6, -0.5, 0.6, 1.6, 0.0),
    tube(-0.75, 0.6, 0.9, -0.6, 1.6, 0.4),
    tube(0.75, 0.6, 0.9, 0.6, 1.6, 0.4),
    tube(-0.6, 1.6, 0.0, 0.6, 1.6, 0.0),
    tube(-0.6, 1.6, 0.4, 0.6, 1.6, 0.4),
    tube(-0.6, 1.6, 0.0, -0.6, 1.6, 0.4),
    tube(0.6, 1.6, 0.0, 0.6, 1.6, 0.4),
    tube(-0.7, 0.55, -1.8, 0.7, 0.55, -1.8),
    box(0.25, 0.12, 0.05, 0xfff3c0, -0.5, 0.7, -1.82),
    box(0.25, 0.12, 0.05, 0xfff3c0, 0.5, 0.7, -1.82),
    cyl(0.18, 0.18, 0.05, dark, -0.3, 1.2, -0.35, 1.1, 0, 0, 12),
  ]);
}

function wheelGeometry() {
  return merge([
    cyl(1, 1, 0.34, 0x1a1a1a, 0, 0, 0, 0, 0, Math.PI / 2, 16),
    cyl(0.55, 0.55, 0.36, 0x7a7a7a, 0, 0, 0, 0, 0, Math.PI / 2, 10),
  ]);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Vehicle {
  constructor(type, x, z, yaw, world) {
    this.type = type;
    this.def = TYPES[type];
    this.world = world;
    const y = world.collision.groundAt(x, z, 1, 200) + 0.6;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.health = this.def.health;
    this.driver = null;
    this.alive = true;
    this.wheelSpin = 0;
    this.airborne = false;
    this.throttle = 0;
    this.rpm = 0;
    this.crashCd = 0;
  }

  forward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  damage(amount, attacker) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastAttacker = attacker || this.lastAttacker;
    if (this.health <= 0) this.explodeFlag = true;
  }
}

export class Vehicles {
  constructor(match) {
    this.m = match;
    this.list = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
    this.wreckMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.9 });
    this.bodies = {
      jeep: new THREE.InstancedMesh(jeepGeometry(), mat, 32),
      buggy: new THREE.InstancedMesh(buggyGeometry(), mat, 32),
    };
    this.wheels = new THREE.InstancedMesh(wheelGeometry(), mat, 32 * 4);
    for (const im of [...Object.values(this.bodies), this.wheels]) {
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      match.ctx.scene.add(im);
    }
    for (const s of match.world.data.vehicleSpawns)
      this.list.push(new Vehicle(s.type, s.x, s.z, s.yaw, match.world));
  }

  nearest(ch, maxDist = 3.2) {
    let best = null;
    let bd = maxDist;
    for (const v of this.list) {
      if (!v.alive || v.driver) continue;
      const d = Math.hypot(v.pos.x - ch.body.x, v.pos.z - ch.body.z);
      if (d < bd && Math.abs(v.pos.y - ch.body.y) < 2.5) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  enter(ch, v) {
    if (v.driver || !v.alive) return false;
    v.driver = ch;
    ch.vehicle = v;
    ch.mode = "vehicle";
    ch.showInVehicle = true;
    ch.stance = "stand";
    ch.cancelAction();
    ch.loadout.active = -1;
    events.emit("vehicleEnter", { ch, vehicle: v });
    return true;
  }

  exit(ch, forced = false) {
    const v = ch.vehicle;
    if (!v) return;
    v.driver = null;
    ch.vehicle = null;
    ch.showInVehicle = false;
    if (ch.alive) ch.mode = "ground";
    // step out on the left side
    const lx = Math.cos(v.yaw + Math.PI);
    const lz = -Math.sin(v.yaw + Math.PI);
    const x = v.pos.x + lx * (v.def.halfW + 0.8);
    const z = v.pos.z + lz * (v.def.halfW + 0.8);
    const y = this.m.world.collision.groundAt(x, z, 0.35, v.pos.y + 2);
    ch.setPosition(x, y + 0.05, z);
    ch.body.vx = v.vel.x * 0.5;
    ch.body.vz = v.vel.z * 0.5;
    ch.body.vy = 0;
    ch.body.onGround = false;
    const speed = v.vel.length();
    if (!forced && speed > 12) this.m.damage(ch, (speed - 12) * 4, { kind: "fall" });
    events.emit("vehicleExit", { ch, vehicle: v });
  }

  // wheel positions (local): [x, z]
  wheelLocal(v) {
    const d = v.def;
    return [
      [-d.track / 2, -d.wheelbase / 2],
      [d.track / 2, -d.wheelbase / 2],
      [-d.track / 2, d.wheelbase / 2],
      [d.track / 2, d.wheelbase / 2],
    ];
  }

  updateVehicle(v, dt) {
    const d = v.def;
    const col = this.m.world.collision;
    const c = v.driver ? v.driver.ctrl : null;
    let throttle = 0;
    let steerIn = 0;
    let brake = false;
    let hand = false;
    if (c && v.driver.alive) {
      throttle = c.mz;
      steerIn = -c.mx;
      hand = c.jump || c.handbrake;
      brake = false;
    }
    const fx = -Math.sin(v.yaw);
    const fz = -Math.cos(v.yaw);
    const rx = Math.cos(v.yaw);
    const rz = -Math.sin(v.yaw);
    let vf = v.vel.x * fx + v.vel.z * fz;
    let vr = v.vel.x * rx + v.vel.z * rz;
    // ground under the wheels
    const wl = this.wheelLocal(v);
    const hs = wl.map(([lx, lz]) => {
      const wx = v.pos.x + rx * lx - fx * lz;
      const wz = v.pos.z + rz * lx - fz * lz;
      return Math.max(col.groundAt(wx, wz, 0.2, v.pos.y + 1.2), -1.3);
    });
    const groundY = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
    // positive pitch = nose up (front wheels higher)
    const targetPitch = Math.atan2((hs[0] + hs[1]) / 2 - (hs[2] + hs[3]) / 2, d.wheelbase);
    const targetRoll = Math.atan2((hs[1] + hs[3]) / 2 - (hs[0] + hs[2]) / 2, d.track);
    const rideY = groundY + d.wheelR;
    v.airborne = v.pos.y > rideY + 0.35;
    if (!v.airborne) {
      // drive
      if (throttle > 0.05) {
        if (vf < -0.5) vf += 18 * dt;
        else vf += d.accel * throttle * (1 - Math.max(0, vf) / d.maxSpeed) * (c && c.sprint ? 1.25 : 1) * dt;
      } else if (throttle < -0.05) {
        if (vf > 0.5) vf -= 18 * dt;
        else vf -= d.accel * 0.5 * (1 + vf / 10) * dt;
      } else vf *= Math.exp(-0.35 * dt);
      // slope gravity along heading (uphill slows down)
      vf -= Math.sin(targetPitch) * 9.81 * dt;
      // steering
      const steerMax = 0.55 / (1 + Math.abs(vf) / 14);
      v.steer += (steerIn * steerMax - v.steer) * Math.min(1, dt * 6);
      v.yawRate = (vf * Math.tan(v.steer)) / d.wheelbase;
      if (hand) {
        vf *= Math.exp(-1.2 * dt);
        v.yawRate *= 1.35;
      }
      v.yaw += v.yawRate * dt;
      // lateral grip (drift with handbrake)
      vr *= Math.exp(-(hand ? d.grip * 0.25 : d.grip) * dt);
      if (brake) vf *= Math.exp(-3 * dt);
      // water slows everything down
      if (groundY < -0.8) {
        vf *= Math.exp(-2.5 * dt);
        vr *= Math.exp(-2.5 * dt);
        v.damage(dt * 8);
      }
      const nfx = -Math.sin(v.yaw);
      const nfz = -Math.cos(v.yaw);
      const nrx = Math.cos(v.yaw);
      const nrz = -Math.sin(v.yaw);
      v.vel.x = nfx * vf + nrx * vr;
      v.vel.z = nfz * vf + nrz * vr;
      // suspension toward ride height
      const vy = (rideY - v.pos.y) * 12;
      v.vel.y = Math.max(v.vel.y - 9.81 * dt, Math.min(vy, 12));
      v.pitch += (targetPitch - v.pitch) * Math.min(1, dt * 8);
      v.roll += (targetRoll - v.roll) * Math.min(1, dt * 8);
    } else {
      v.vel.y -= 9.81 * dt;
      v.pitch *= 1 - Math.min(1, dt * 0.8);
    }
    v.pos.addScaledVector(v.vel, dt);
    if (v.pos.y < rideY - 0.05 && v.vel.y < 0) {
      if (v.vel.y < -9) v.damage((-v.vel.y - 9) * 12);
      v.pos.y = rideY;
      v.vel.y = 0;
    }
    // static collisions: 3 circles along the body
    let hitSpeed = 0;
    const r = d.halfW + 0.05;
    for (const k of [-1, 0, 1]) {
      const off = k * (d.halfL - r);
      const cb = { x: v.pos.x + fx * off, z: v.pos.z + fz * off, vx: v.vel.x, vz: v.vel.z, r };
      const bx = cb.x;
      const bz = cb.z;
      if (col.pushOut(cb, v.pos.y - 0.2, v.pos.y + d.height)) {
        const dxp = cb.x - bx;
        const dzp = cb.z - bz;
        v.pos.x += dxp;
        v.pos.z += dzp;
        const pl = Math.hypot(dxp, dzp) || 1;
        const nx = dxp / pl;
        const nz = dzp / pl;
        const vn = v.vel.x * nx + v.vel.z * nz;
        if (vn < 0) {
          hitSpeed = Math.max(hitSpeed, -vn);
          v.vel.x -= vn * nx * 1.35;
          v.vel.z -= vn * nz * 1.35;
          v.vel.multiplyScalar(0.8);
        }
      }
    }
    v.crashCd -= dt;
    if (hitSpeed > 6 && v.crashCd <= 0) {
      v.crashCd = 0.5;
      v.damage((hitSpeed - 6) * 10);
      if (v.driver) this.m.damage(v.driver, Math.max(0, hitSpeed - 12) * 3, { kind: "vehicle" });
      events.emit("vehicleCrash", { vehicle: v, speed: hitSpeed, x: v.pos.x, y: v.pos.y, z: v.pos.z });
    }
    // keep inside the map
    const lim = this.m.world.hm.half - 5;
    v.pos.x = Math.max(-lim, Math.min(lim, v.pos.x));
    v.pos.z = Math.max(-lim, Math.min(lim, v.pos.z));
    v.wheelSpin += (vf / d.wheelR) * dt;
    v.rpm = Math.min(1, Math.abs(vf) / d.maxSpeed);
    v.throttle = throttle;
  }

  runOver(v) {
    const speed = Math.hypot(v.vel.x, v.vel.z);
    if (speed < 4) return;
    const fx = -Math.sin(v.yaw);
    const fz = -Math.cos(v.yaw);
    for (const ch of this.m.characters) {
      if (!ch.alive || ch.vehicle || ch.mode !== "ground") continue;
      const dx = ch.body.x - v.pos.x;
      const dz = ch.body.z - v.pos.z;
      const along = dx * fx + dz * fz;
      const side = dx * -fz + dz * fx;
      if (
        Math.abs(along) > v.def.halfL + 0.3 ||
        Math.abs(side) > v.def.halfW + 0.35 ||
        Math.abs(ch.body.y - v.pos.y) > 2
      )
        continue;
      if ((ch.hitCd || 0) > this.m.time) continue;
      ch.hitCd = this.m.time + 0.6;
      this.m.damage(ch, (speed - 4) * 7, { attacker: v.driver, kind: "vehicle", dirX: -fx, dirZ: -fz });
      ch.body.vx += v.vel.x * 0.6;
      ch.body.vz += v.vel.z * 0.6;
      ch.body.vy = 3;
      ch.body.onGround = false;
    }
  }

  explode(v) {
    v.alive = false;
    v.health = 0;
    const m = this.m;
    events.emit("explosion", { x: v.pos.x, y: v.pos.y, z: v.pos.z, owner: v.lastAttacker });
    m.fx.particles.emit("explosion", v.pos.x, v.pos.y + 1, v.pos.z, 0, 1, 0, 20, 1.4);
    m.fx.particles.emit("blast", v.pos.x, v.pos.y + 1, v.pos.z, 0, 1, 0, 14, 1.5);
    if (v.driver) {
      const d = v.driver;
      this.exit(d, true);
      m.damage(d, 120, { attacker: v.lastAttacker, kind: "explosion", weapon: { name: "Nổ xe" } });
    }
    for (const ch of m.characters) {
      if (!ch.alive) continue;
      const dd = Math.hypot(ch.body.x - v.pos.x, ch.body.z - v.pos.z);
      if (dd < 6)
        m.damage(ch, 90 * (1 - dd / 6), {
          attacker: v.lastAttacker,
          kind: "explosion",
          weapon: { name: "Nổ xe" },
        });
    }
  }

  // bullets: ray vs vehicle body boxes (lower part only, so drivers can be shot through windows)
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    for (const v of this.list) {
      const d = v.def;
      const px = ox - v.pos.x;
      const py = oy - (v.pos.y + 0.2);
      const pz = oz - v.pos.z;
      const c = Math.cos(v.yaw);
      const s = Math.sin(v.yaw);
      // into vehicle local space (x right, z back)
      const lx = px * c - pz * s;
      const lz = px * s + pz * c;
      const ldx = dx * c - dz * s;
      const ldz = dx * s + dz * c;
      const t = slab(lx, py, lz, ldx, dy, ldz, d.halfW, d.height * 0.72, d.halfL, maxT);
      if (t >= 0 && (!best || t < best.t)) best = { t, vehicle: v };
    }
    return best;
  }

  blast(x, y, z, radius, dmg) {
    for (const v of this.list) {
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < radius) v.damage(dmg * (1 - d / radius));
    }
  }

  update(dt) {
    const counts = { jeep: 0, buggy: 0 };
    let w = 0;
    for (const v of this.list) {
      if (v.alive) {
        if (v.driver || v.vel.lengthSq() > 0.01 || v.airborne || !v.settled) {
          this.updateVehicle(v, dt);
          v.settled = !v.driver && v.vel.lengthSq() < 0.01 && !v.airborne;
        }
        if (v.driver) this.runOver(v);
        if (v.explodeFlag) this.explode(v);
      }
      // seat the driver
      if (v.driver) {
        const ch = v.driver;
        const s = v.def.seat;
        const fx = -Math.sin(v.yaw);
        const fz = -Math.cos(v.yaw);
        const rx = Math.cos(v.yaw);
        const rz = -Math.sin(v.yaw);
        ch.setPosition(
          v.pos.x + rx * s[0] - fx * s[1],
          v.pos.y + v.def.seatY - 0.52,
          v.pos.z + rz * s[0] - fz * s[1],
        );
        ch.yaw = v.yaw;
        ch.anim && (ch.anim.yawBody = v.yaw);
        ch.moveSpeed = 0;
        ch.stats.distance += Math.hypot(v.vel.x, v.vel.z) * dt;
      }
      // render
      _e.set(v.pitch, v.yaw, v.roll, "YXZ");
      _q.setFromEuler(_e);
      _m.compose(_p.copy(v.pos).setY(v.pos.y - v.def.wheelR + 0.05), _q, _s.set(1, 1, 1));
      const im = this.bodies[v.type];
      im.setMatrixAt(counts[v.type]++, _m);
      if (!v.alive) im.setColorAt(counts[v.type] - 1, _dark);
      else im.setColorAt(counts[v.type] - 1, _white);
      const wl = this.wheelLocal(v);
      for (let k = 0; k < 4; k++) {
        const [lx, lz] = wl[k];
        _p.set(lx, 0, lz);
        _m2.compose(
          _p.set(lx, v.def.wheelR - 0.05, lz),
          _q2.setFromEuler(_e2.set(v.alive ? v.wheelSpin : 0, k < 2 ? v.steer : 0, 0, "YXZ")),
          _s.setScalar(v.def.wheelR),
        );
        _m3.multiplyMatrices(_m, _m2);
        this.wheels.setMatrixAt(w++, _m3);
      }
    }
    for (const [k, im] of Object.entries(this.bodies)) {
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.wheels.count = w;
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const im of [...Object.values(this.bodies), this.wheels]) this.m.ctx.scene.remove(im);
  }
}

const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _q2 = new THREE.Quaternion();
const _e2 = new THREE.Euler();
const _white = new THREE.Color(1, 1, 1);
const _dark = new THREE.Color(0.15, 0.13, 0.12);

// ray vs axis-aligned box centered at origin with half extents (hx, hy from 0..2hy, hz)
function slab(ox, oy, oz, dx, dy, dz, hx, hy, hz, maxT) {
  let tmin = 0;
  let tmax = maxT;
  const lo = [-hx, 0, -hz];
  const hi = [hx, hy * 2, hz];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return -1;
      continue;
    }
    let t1 = (lo[a] - o[a]) / d[a];
    let t2 = (hi[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export { TYPES as VEHICLE_TYPES, F_SOLID };
