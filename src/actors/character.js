// Shared character state + movement for the player and bots. Control comes from `ctrl`,
// filled each frame by PlayerController or BotController.
import { PHYS, SPEED, WORLD } from "../config.js";
import { Inventory } from "../items/inventory.js";
import { Loadout } from "../items/loadout.js";
import { ITEMS } from "../items/itemdefs.js";

export const STANCE_H = { stand: PHYS.H_STAND, crouch: PHYS.H_CROUCH, prone: PHYS.H_PRONE };

export function makeCtrl() {
  return {
    mx: 0, // strafe -1..1 (right +)
    mz: 0, // forward -1..1
    sprint: false,
    walk: false,
    jump: false,
    crouch: false, // edge: toggle crouch
    prone: false, // edge: toggle prone
    fire: false,
    firePressed: false,
    ads: false,
    reload: false,
    interact: false,
    leanL: false,
    leanR: false,
    yaw: 0,
    pitch: 0,
    select: -1, // weapon slot to switch to (edge)
    holster: false,
    fireMode: false,
    use: null, // consumable id to use (edge)
    cancel: false,
    dive: false, // freefall: W dives
    deploy: false, // open parachute (edge)
  };
}

export class Character {
  constructor({ id, name, isPlayer = false, look }) {
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.look = look;
    this.body = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      r: PHYS.R,
      h: PHYS.H_STAND,
      stepUp: PHYS.STEP,
      onGround: false,
      inWater: false,
      hitWall: false,
    };
    this.yaw = 0; // 0 = facing -z (north)
    this.pitch = 0; // aim pitch (+ up)
    this.stance = "stand";
    this.mode = "ground"; // plane | freefall | chute | ground | vehicle | dead
    this.health = 100;
    this.boost = 0;
    this.alive = true;
    this.inv = new Inventory();
    this.loadout = new Loadout();
    this.ctrl = makeCtrl();
    this.lean = 0;
    this.ads = false;
    this.sprinting = false;
    this.moveSpeed = 0;
    this.walked = 0; // meters walked (footsteps, animation phase)
    this.action = null; // { type, t, dur, item?, slot? }
    this.vehicle = null;
    this.deathTime = 0;
    this.killer = null;
    this.lastHit = { time: -99, dirX: 0, dirZ: 0, attacker: null };
    this.stats = { kills: 0, damage: 0, distance: 0, timeAlive: 0, headshots: 0 };
    this.fallSpeed = 0;
    this.boostTick = 0;
    this.chuteOpen = 0; // parachute canopy scale 0..1
    this.lastStep = 0;
    this.airTime = 0;
    this.visibleToPlayer = false;
  }

  get x() {
    return this.body.x;
  }
  get y() {
    return this.body.y;
  }
  get z() {
    return this.body.z;
  }

  setPosition(x, y, z) {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
  }

  forward(out) {
    out.x = -Math.sin(this.yaw);
    out.y = 0;
    out.z = -Math.cos(this.yaw);
    return out;
  }

  eyeHeight() {
    return this.stance === "prone" ? 0.35 : this.stance === "crouch" ? 1.1 : 1.62;
  }

  // Aim direction from yaw/pitch
  aimDir(out) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  canAct() {
    return this.alive && (this.mode === "ground" || this.mode === "vehicle");
  }

  startAction(type, dur, extra = {}) {
    this.action = { type, t: 0, dur, ...extra };
  }

  cancelAction() {
    this.action = null;
  }

  // Heal/boost effect of a consumable (applied when the use timer completes)
  applyConsumable(id) {
    const def = ITEMS[id];
    if (def.cat === "heal") {
      if (def.heal) this.health = Math.min(def.cap, this.health + def.heal);
      if (def.healTo) this.health = Math.max(this.health, def.healTo);
    } else if (def.cat === "boost") {
      this.boost = Math.min(100, this.boost + def.boost);
    }
  }

  canUse(id) {
    const def = ITEMS[id];
    if (!def || this.inv.count(id) <= 0) return false;
    if (def.cat === "heal") {
      if (def.heal) return this.health < def.cap;
      return this.health < def.healTo;
    }
    if (def.cat === "boost") return this.boost < 100;
    return false;
  }

  update(dt, world) {
    if (!this.alive) {
      this.updateDead(dt, world);
      return;
    }
    this.stats.timeAlive += dt;
    // boost: slow heal + decay
    if (this.boost > 0) {
      this.boostTick += dt;
      const interval = this.boost > 60 ? 2 : 3;
      if (this.boostTick >= interval) {
        this.boostTick = 0;
        this.health = Math.min(100, this.health + 1);
      }
      this.boost = Math.max(0, this.boost - dt / 2.5);
    }
    switch (this.mode) {
      case "ground":
        this.groundMove(dt, world);
        break;
      case "freefall":
        this.freefallMove(dt, world);
        break;
      case "chute":
        this.chuteMove(dt, world);
        break;
      default:
        break;
    }
  }

  groundMove(dt, world) {
    const c = this.ctrl;
    const b = this.body;
    // stance toggles
    if (c.crouch) this.setStance(this.stance === "crouch" ? "stand" : "crouch", world);
    if (c.prone) this.setStance(this.stance === "prone" ? "stand" : "prone", world);
    if (c.jump && this.stance !== "stand") {
      this.setStance("stand", world);
      c.jump = false;
    }
    this.yaw = c.yaw;
    this.pitch = c.pitch;

    const healing = this.action && this.action.type === "use";
    const fwdIntent = c.mz > 0.3 && Math.abs(c.mx) < 0.8;
    this.sprinting =
      c.sprint && fwdIntent && !this.ads && !b.inWater && this.stance !== "prone" && !healing && b.onGround;
    if (this.sprinting && this.stance === "crouch") this.setStance("stand", world);
    let speed = SPEED.jog;
    if (b.inWater) speed = SPEED.swim;
    else if (this.stance === "prone") speed = SPEED.prone;
    else if (this.stance === "crouch") speed = SPEED.crouch;
    else if (this.sprinting) speed = SPEED.sprint;
    else if (this.ads) speed = SPEED.ads;
    else if (c.walk) speed = SPEED.walk;
    if (this.ads && this.stance === "crouch") speed = Math.min(speed, 1.8);
    if (healing) speed = Math.min(speed, SPEED.walk);
    if (this.boost > 60) speed *= 1.05;
    if (c.mz < -0.1) speed *= 0.85; // backpedal slower

    const len = Math.hypot(c.mx, c.mz);
    let tvx = 0;
    let tvz = 0;
    if (len > 0.01) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const k = Math.min(1, len) / len;
      tvx = (rx * c.mx + fx * c.mz) * k * speed;
      tvz = (rz * c.mx + fz * c.mz) * k * speed;
    }
    // slope: slow down going up steep terrain
    if (b.onGround && !b.inWater) {
      const n = world.hm.getNormal(b.x, b.z, _n);
      if (n.y < 0.8) {
        const up = -(tvx * n.x + tvz * n.z); // positive when moving uphill
        if (up > 0) {
          const f = Math.max(0.15, (n.y - 0.55) / 0.25);
          tvx *= f;
          tvz *= f;
        }
      }
    }
    const accel = b.onGround || b.inWater ? 26 : 3;
    const a = Math.min(1, accel * dt);
    b.vx += (tvx - b.vx) * a;
    b.vz += (tvz - b.vz) * a;
    if (c.jump && b.onGround && this.stance === "stand" && !b.inWater && !healing) {
      b.vy = SPEED.jump;
      b.onGround = false;
    }
    c.jump = false;
    // lean (only standing/crouching, not while sprinting)
    const leanT = !this.sprinting && this.stance !== "prone" ? (c.leanR ? 1 : 0) - (c.leanL ? 1 : 0) : 0;
    this.lean += (leanT - this.lean) * Math.min(1, dt * 10);

    const wasOnGround = b.onGround;
    const vyBefore = b.vy;
    const px = b.x;
    const pz = b.z;
    b.h = STANCE_H[this.stance];
    world.collision.moveBody(b, dt, PHYS.G);
    // fall damage
    if (!wasOnGround && b.onGround && vyBefore < -11) {
      const dmg = (-vyBefore - 11) * 9;
      if (dmg > 0 && this.onFallDamage) this.onFallDamage(dmg);
    }
    if (!b.onGround) this.airTime += dt;
    else this.airTime = 0;
    const moved = Math.hypot(b.x - px, b.z - pz);
    this.moveSpeed = moved / Math.max(dt, 1e-4);
    this.walked += moved;
    this.stats.distance += moved;
    // keep inside the world
    const lim = WORLD.HALF - 2;
    b.x = Math.max(-lim, Math.min(lim, b.x));
    b.z = Math.max(-lim, Math.min(lim, b.z));
  }

  setStance(s, world) {
    if (s === this.stance) return;
    const b = this.body;
    if (b.inWater && s !== "stand") return;
    const newH = STANCE_H[s];
    if (newH > b.h) {
      // need headroom to stand up
      const ceil = world.collision.ceilingAt(b.x, b.z, b.r * 0.85, b.y + 0.2);
      if (b.y + newH > ceil) return;
    }
    this.stance = s;
  }

  freefallMove(dt, world) {
    const c = this.ctrl;
    const b = this.body;
    this.yaw = c.yaw;
    this.pitch = c.pitch;
    // W pitches into a dive: faster fall, slower forward speed at extreme dive
    const dive = c.mz > 0.1 ? c.mz : 0;
    const brake = c.mz < -0.1 ? -c.mz : 0;
    const targetDown = 45 + dive * 22 - brake * 8;
    const fwdSpeed = 12 + dive * 18 - brake * 10;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const tvx = fx * fwdSpeed + rx * c.mx * 10;
    const tvz = fz * fwdSpeed + rz * c.mx * 10;
    b.vx += (tvx - b.vx) * Math.min(1, dt * 1.2);
    b.vz += (tvz - b.vz) * Math.min(1, dt * 1.2);
    b.vy += (-targetDown - b.vy) * Math.min(1, dt * 0.9);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const ground = world.collision.groundAt(b.x, b.z, 0.5, b.y + 50);
    const agl = b.y - Math.max(ground, WORLD.SEA);
    this.freefallT = (this.freefallT || 0) + dt;
    if ((c.deploy && this.freefallT > 1) || agl < 150) this.openChute();
    if (agl <= 0.5) this.land(world);
  }

  openChute() {
    this.mode = "chute";
    this.chuteOpen = 0;
    if (this.onChuteOpen) this.onChuteOpen();
  }

  chuteMove(dt, world) {
    const c = this.ctrl;
    const b = this.body;
    this.chuteOpen = Math.min(1, this.chuteOpen + dt * 1.5);
    // steer: A/D turn, mouse also turns
    this.yaw = c.yaw;
    this.pitch = c.pitch;
    const push = c.mz > 0.1 ? c.mz : 0;
    const brake = c.mz < -0.1 ? -c.mz : 0;
    const fwdSpeed = 9 + push * 7 - brake * 5;
    const down = 5 + push * 2.5 - brake * 1;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const tvx = fx * fwdSpeed + rx * c.mx * 4;
    const tvz = fz * fwdSpeed + rz * c.mx * 4;
    const k = Math.min(1, dt * 1.5);
    b.vx += (tvx - b.vx) * k;
    b.vz += (tvz - b.vz) * k;
    b.vy += (-down - b.vy) * Math.min(1, dt * 2);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const lim = WORLD.HALF - 5;
    b.x = Math.max(-lim, Math.min(lim, b.x));
    b.z = Math.max(-lim, Math.min(lim, b.z));
    const ground = world.collision.groundAt(b.x, b.z, 0.4, b.y + 0.5);
    if (b.y <= Math.max(ground, WORLD.SEA - PHYS.SWIM_DEPTH) + 0.05) this.land(world);
  }

  land(world) {
    const b = this.body;
    this.mode = "ground";
    this.chuteOpen = 0;
    b.vy = 0;
    b.vx *= 0.3;
    b.vz *= 0.3;
    const ground = world.collision.groundAt(b.x, b.z, b.r, b.y + 1);
    if (b.y < ground) b.y = ground;
    b.onGround = true;
    if (this.onLand) this.onLand();
  }

  updateDead(dt, world) {
    this.deathTime += dt;
    const b = this.body;
    if (this.mode === "vehicle" || this.mode === "plane") return;
    if (!b.onGround) {
      b.vx *= 0.9;
      b.vz *= 0.9;
      world.collision.moveBody(b, dt, PHYS.G);
    }
  }
}

const _n = { x: 0, y: 1, z: 0 };
