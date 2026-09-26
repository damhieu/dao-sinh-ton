// The match: owns characters and gameplay systems, runs the per-frame update, applies combat rules.
import * as THREE from "three";
import { RNG } from "../core/rng.js";
import { events } from "../core/events.js";
import { Character } from "../actors/character.js";
import { makeLook } from "../actors/rig.js";
import { PlayerController } from "../actors/player.js";
import { GameCamera } from "../actors/camera.js";
import { Viewmodel } from "../actors/viewmodel.js";
import { WeaponSystem, muzzlePosition, isSuppressed } from "../combat/weapons.js";
import { Ballistics, hitCharacter } from "../combat/ballistics.js";
import { computeHit } from "../combat/damage.js";
import { rollLoot } from "../items/loot.js";
import { ITEMS, WEAPONS, ATTACHMENTS } from "../items/itemdefs.js";
import { magSize } from "../items/loadout.js";
import { MAT } from "../world/collision.js";
import { BotController } from "../actors/bot.js";
import { BuildingIndex } from "../actors/navigation.js";
import { makeNames } from "../actors/names.js";
import { Plane } from "./plane.js";
import { ZoneSchedule } from "./zone.js";
import { ZoneWall } from "./zonewall.js";
import { Grenades } from "../combat/grenades.js";
import { AirdropSystem } from "./airdrop.js";
import { Vehicles, VEHICLE_TYPES } from "./vehicles.js";

const _v = new THREE.Vector3();
const _o = { x: 0, y: 0, z: 0 };

export class Match {
  constructor(app) {
    this.app = app;
    this.ctx = app.ctx;
    this.world = app.world;
    this.settings = app.settings;
    this.input = app.input;
    this.rig = app.rig;
    this.held = app.held;
    this.pickups = app.pickups;
    this.fx = app.fx;
    this.seed = app.seed ?? (Math.random() * 1e9) >>> 0;
    this.rng = new RNG(this.seed);
    this.time = 0;
    this.characters = [];
    this.player = null;
    this.weapons = new WeaponSystem(this);
    this.ballistics = new Ballistics(this);
    this.gcam = new GameCamera(this.ctx.camera, this.world);
    this.gcam.baseFov = this.settings.fov;
    this.viewmodel = new Viewmodel(this.ctx, this.world.sky.sunDir, this.ctx.scene.environment);
    this.state = "playing";
    this.aliveCount = 0;
    this.bots = [];
    this.buildingIndex = new BuildingIndex(this.world.buildings);
    this.zone = null;
    this.plane = null;
    this.airdrops = [];
    this.visTimer = 0;
    this.grenades = new Grenades(this);
    this.smoke = this.grenades;
    this.vehicles = new Vehicles(this);
  }

  // Bots with a spread of skill: ~30% rookies, ~50% average, ~20% veterans
  createBots(n) {
    const rng = this.rng.fork(9);
    const names = makeNames(rng, n, this.player ? this.player.name : "");
    for (let i = 0; i < n; i++) {
      const ch = this.addCharacter({ name: names[i] });
      const r = rng.next();
      const skill = r < 0.3 ? rng.range(0.15, 0.38) : r < 0.8 ? rng.range(0.4, 0.66) : rng.range(0.7, 0.92);
      ch.bot = new BotController(ch, this, rng.fork(i + 1), { skill, aggression: rng.range(0.2, 0.95) });
      this.bots.push(ch.bot);
    }
    return this.bots;
  }

  // Autopilot: the player's character is driven by the bot AI (for automated full-match tests)
  setAutopilot(on) {
    const p = this.player;
    if (on && !p.bot) {
      p.bot = new BotController(p, this, this.rng.fork(999), { skill: 0.75, aggression: 0.6 });
      if (p.mode === "plane" || p.mode === "freefall" || p.mode === "chute") {
        const t = this.world.data.towns[Math.floor(this.rng.next() * this.world.data.towns.length)];
        p.bot.dropTarget = { x: t.x, z: t.z };
        p.bot.jumpDist = 420;
      }
      p.bot.lootUntil = this.time + 90;
      this.bots.push(p.bot);
    } else if (!on && p.bot) {
      this.bots.splice(this.bots.indexOf(p.bot), 1);
      p.bot = null;
    }
    this.controller.enabled = !on;
  }

  // smoke grenades block line of sight (set up by the grenade system)
  smokeBlocks(ax, ay, az, bx, by, bz) {
    return this.smoke ? this.smoke.blocks(ax, ay, az, bx, by, bz) : false;
  }

  updateVisibility(dt) {
    this.visTimer -= dt;
    if (this.visTimer > 0) return;
    this.visTimer = 0.4;
    const cam = this.ctx.camera;
    const cp = cam.position;
    const fx = -Math.sin(this.gcam.yaw);
    const fz = -Math.cos(this.gcam.yaw);
    for (const b of this.bots) {
      const ch = b.ch;
      const dx = ch.body.x - cp.x;
      const dz = ch.body.z - cp.z;
      const d = Math.hypot(dx, dz);
      const front = d > 1 ? (dx * fx + dz * fz) / d : 1;
      ch.visibleToPlayer = d < 60 || (front > 0.45 && d < 450);
      b.far = d > 350 && !ch.visibleToPlayer;
    }
  }

  // ------------------------------------------------------------------ setup

  addCharacter(opts) {
    const ch = new Character({
      id: this.characters.length,
      name: opts.name,
      isPlayer: !!opts.isPlayer,
      look: opts.look || makeLook(this.rng),
    });
    this.rig.add(ch);
    this.characters.push(ch);
    ch.aimOrigin = { x: 0, y: 0, z: 0 };
    ch.aimDir = { x: 0, y: 0, z: -1 };
    ch.onFallDamage = (d) => this.damage(ch, d, { kind: "fall" });
    return ch;
  }

  createPlayer(name) {
    this.player = this.addCharacter({ name, isPlayer: true });
    this.controller = new PlayerController(this.player, this.input, this.gcam, this.settings);
    this.viewmodel.setLook(this.player.look);
    return this.player;
  }

  spawnLoot() {
    const rng = this.rng.fork(77);
    let count = 0;
    for (const b of this.world.buildings) {
      const tier = b.plot.tier;
      for (const lp of b.loot) {
        const items = rollLoot(rng, tier);
        items.forEach((it, i) => {
          const a = rng.range(0, Math.PI * 2);
          const r = i === 0 ? 0 : 0.35;
          const extra = WEAPONS[it.id] ? { weapon: null } : {};
          this.pickups.spawn(it.id, it.n, lp.x + Math.cos(a) * r, lp.y, lp.z + Math.sin(a) * r, extra);
          count++;
        });
      }
    }
    return count;
  }

  // ------------------------------------------------------------------ items

  // Give a pickup (or part of a stack) to a character; returns true if anything was taken
  takePickup(ch, p, amount = null) {
    if (!this.pickups.list.has(p)) return false;
    if (p.crate) return false;
    const def = ITEMS[p.id];
    const ok = this.giveItem(ch, p.id, amount ?? p.n, p);
    if (ok.taken > 0) {
      const left = p.n - ok.taken;
      if (left <= 0) this.pickups.remove(p);
      else p.n = left;
      events.emit("pickup", { ch, id: p.id, n: ok.taken, def });
      return true;
    }
    if (ok.reason) events.emit("pickupFail", { ch, id: p.id, reason: ok.reason });
    return false;
  }

  // Give an item; `source` may carry weapon state / armor durability. Returns {taken, reason}
  giveItem(ch, id, n, source = {}) {
    const def = ITEMS[id];
    const inv = ch.inv;
    const lo = ch.loadout;
    const at = ch.body;
    if (def.cat === "weapon" || def.cat === "melee") {
      const st = source.weapon;
      const r = lo.addWeapon(id, st ? st.mag : 0, st ? st.att : null);
      if (st && st.mode) r.weapon.mode = st.mode;
      if (r.dropped) this.dropWeapon(ch, r.dropped);
      // put spare attachments from the backpack onto the new weapon
      for (const att of Object.keys(ATTACHMENTS)) {
        if (inv.count(att) > 0 && lo.autoAttach(att) >= 0) inv.remove(att, 1);
      }
      return { taken: 1 };
    }
    if (def.cat === "attachment") {
      if (lo.autoAttach(id) >= 0) return { taken: 1 };
      const k = inv.add(id, 1);
      return k ? { taken: 1 } : { taken: 0, reason: "full" };
    }
    if (def.cat === "helmet" || def.cat === "vest") {
      const old = inv.equipArmor(def.cat, def.level, source.durability);
      if (old)
        this.pickups.spawn(`${def.cat}${old.level}`, 1, at.x, at.y + 0.05, at.z, {
          durability: old.durability,
        });
      return { taken: 1 };
    }
    if (def.cat === "backpack") {
      const old = inv.equipBackpack(def.level);
      if (old < 0) return { taken: 0, reason: "heavy" };
      if (old > 0) this.pickups.spawn(`backpack${old}`, 1, at.x, at.y + 0.05, at.z);
      return { taken: 1 };
    }
    const k = inv.add(id, n);
    if (k <= 0) return { taken: 0, reason: "full" };
    if (def.cat === "throwable" && !lo.slots[4]) lo.slots[4] = { id, mag: 0, att: {}, mode: "single" };
    return { taken: k };
  }

  dropWeapon(ch, w) {
    const b = ch.body;
    this.pickups.spawn(
      w.id,
      1,
      b.x + Math.random() * 0.4 - 0.2,
      b.y + 0.05,
      b.z + Math.random() * 0.4 - 0.2,
      { weapon: w },
    );
  }

  dropItem(ch, id, n) {
    const got = ch.inv.remove(id, n);
    if (got > 0) {
      const b = ch.body;
      this.pickups.spawn(
        id,
        got,
        b.x + Math.random() * 0.4 - 0.2,
        b.y + 0.05,
        b.z + Math.random() * 0.4 - 0.2,
      );
      events.emit("drop", { ch, id, n: got });
    }
  }

  // Take one entry from a crate
  takeFromCrate(ch, crate, index) {
    const it = crate.items[index];
    if (!it) return false;
    const r = this.giveItem(ch, it.id, it.n, it);
    if (r.taken <= 0) {
      if (r.reason) events.emit("pickupFail", { ch, id: it.id, reason: r.reason });
      return false;
    }
    it.n -= r.taken;
    if (it.n <= 0 || ITEMS[it.id].cat === "weapon" || ITEMS[it.id].cat === "melee")
      crate.items.splice(index, 1);
    events.emit("pickup", { ch, id: it.id, n: r.taken, def: ITEMS[it.id] });
    return true;
  }

  // ------------------------------------------------------------------ interaction

  // What the character would interact with right now: {type:'pickup'|'door'|'crate', target, dist}
  interactionTarget(ch) {
    const b = ch.body;
    const fx = -Math.sin(ch.yaw);
    const fz = -Math.cos(ch.yaw);
    let best = null;
    let bestScore = Infinity;
    const list = this.pickups.near(b.x, b.y + 0.2, b.z, 2.4, this._near || (this._near = []));
    for (const p of list) {
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const d = Math.hypot(dx, dz);
      const facing = d > 0.3 ? (dx * fx + dz * fz) / d : 1;
      if (facing < -0.2 && d > 0.8) continue;
      const score = d - facing * 0.8 + (p.crate ? 0.2 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { type: p.crate ? "crate" : "pickup", target: p, dist: d, score };
      }
    }
    const veh = this.vehicles.nearest(ch);
    if (veh) {
      const vd = Math.hypot(veh.pos.x - b.x, veh.pos.z - b.z) - 1.2;
      if (!best || vd < best.dist) best = { type: "vehicle", target: veh, dist: vd };
    }
    const di = this.world.doors.nearest(b.x + fx * 0.6, b.y + 1, b.z + fz * 0.6, 1.6);
    if (di >= 0) {
      const d = this.world.doors.list[di];
      const dd = Math.hypot(d.x - b.x, d.z - b.z);
      // same facing preference as items: the thing you look at wins over a door beside you
      const facing = dd > 0.3 ? ((d.x - b.x) * fx + (d.z - b.z) * fz) / dd : 1;
      if (!best || dd - facing * 0.8 < (best.score ?? best.dist) - 0.3)
        best = { type: "door", target: di, dist: dd };
    }
    return best;
  }

  interact(ch) {
    const t = this.interactionTarget(ch);
    if (!t) return false;
    if (t.type === "door") {
      const d = this.world.doors.toggle(t.target);
      events.emit("door", { ch, door: d, open: d.target > 0.5 });
      return true;
    }
    if (t.type === "vehicle") return this.vehicles.enter(ch, t.target);
    if (t.type === "pickup") return this.takePickup(ch, t.target);
    if (t.type === "crate") {
      events.emit("openCrate", { ch, crate: t.target });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ combat callbacks

  onShot(ch, w, def) {
    const m = muzzlePosition(ch, _o);
    const suppressed = isSuppressed(w);
    events.emit("shot", { ch, def, weapon: w, x: m.x, y: m.y, z: m.z, suppressed });
    const range = suppressed ? 60 : def.cls === "SR" ? 400 : 260;
    for (const b of this.bots) {
      if (b.ch === ch || !b.ch.alive) continue;
      const d = Math.hypot(b.ch.body.x - m.x, b.ch.body.z - m.z);
      if (d < range) b.onHeard(ch, m.x, m.y, m.z, d);
    }
    const cam = this.ctx.camera.position;
    const far = (cam.x - m.x) ** 2 + (cam.z - m.z) ** 2 > 350 * 350;
    const fx = far ? null : this.fx;
    if (!suppressed && fx) {
      const d = ch.aimDir;
      fx.particles.emit("flash", m.x + d.x * 0.05, m.y + d.y * 0.05, m.z + d.z * 0.05, d.x, d.y, d.z, 3, 1);
      fx.particles.emit("smokeLight", m.x, m.y, m.z, d.x * 0.3, 0.5, d.z * 0.3, 2, 0.6);
      fx.muzzleLight(m.x, m.y, m.z, ch.isPlayer);
    }
    if (fx && def.cls !== "SG" && ch.visibleNear !== false) {
      const rx = Math.cos(ch.yaw);
      const rz = -Math.sin(ch.yaw);
      fx.particles.emit("shell", m.x - ch.aimDir.x * 0.4, m.y, m.z - ch.aimDir.z * 0.4, rx, 0.6, rz, 1, 1);
    }
    if (ch === this.player)
      this.gcam.shake = Math.max(this.gcam.shake, def.cls === "SR" || def.cls === "SG" ? 0.6 : 0.15);
  }

  onBulletHitCharacter(b, target, part, x, y, z, dx, dy, dz, dist) {
    // frying pan on the back stops bullets hitting the pelvis from behind
    if (part === "pelvis" && target.loadout.slots[3] && target.loadout.active !== 3) {
      const fx = -Math.sin(target.yaw);
      const fz = -Math.cos(target.yaw);
      if (dx * fx + dz * fz > 0.5) {
        events.emit("panBlock", { target, x, y, z });
        this.fx && this.fx.particles.emit("sparks", x, y, z, -dx, -dy, -dz, 10);
        return;
      }
    }
    const inv = target.inv;
    const r = computeHit({ weapon: b.def, part, distance: dist, helmet: inv.helmet, vest: inv.vest });
    let helmetBroke = false;
    if (r.helmetDmg) helmetBroke = inv.damageArmor("helmet", r.helmetDmg);
    if (r.vestDmg) inv.damageArmor("vest", r.vestDmg);
    if (this.fx)
      this.fx.particles.emit("blood", x, y, z, -dx * 0.5, 0.3, -dz * 0.5, 6, part === "head" ? 1.3 : 1);
    const headshot = part === "head";
    events.emit("hit", {
      target,
      attacker: b.shooter,
      part,
      damage: r.damage,
      x,
      y,
      z,
      headshot,
      helmet: r.helmetDmg > 0,
      helmetBroke,
    });
    this.damage(target, r.damage, {
      attacker: b.shooter,
      weapon: b.def,
      part,
      dirX: -dx,
      dirZ: -dz,
      headshot,
      x,
      y,
      z,
    });
  }

  onBulletImpact(b, x, y, z, nx, ny, nz, mat, kind) {
    const fx = this.fx;
    const inWater = kind === "terrain" && y < 0.1 && this.world.hm.getHeight(x, z) < -0.2;
    let type = "dust";
    if (inWater) type = "water";
    else if (mat === MAT.metal) type = "sparks";
    else if (mat === MAT.wood) type = "wood";
    else if (mat === MAT.concrete) type = "concrete";
    events.emit("impact", { x, y, z, mat, water: inWater, shooter: b.shooter });
    if (!fx) return;
    const cam = this.ctx.camera.position;
    const d2 = (cam.x - x) ** 2 + (cam.z - z) ** 2;
    if (d2 > 300 * 300) return;
    fx.particles.emit(type, x, y, z, nx, ny, nz, type === "sparks" ? 8 : 6);
    if (type !== "dust" && type !== "water") fx.particles.emit("dust", x, y, z, nx, ny, nz, 2, 0.5);
    if (kind !== "terrain" && d2 < 120 * 120)
      fx.decals.add(x, y, z, nx, ny, nz, b.def.cls === "SG" ? 0.07 : 0.11);
  }

  onBulletWhiz(b, x, y, z) {
    events.emit("whiz", { x, y, z, shooter: b.shooter });
  }

  onBulletHitVehicle(b, veh, x, y, z) {
    veh.damage(b.def.dmg * 0.6, b.shooter);
    if (this.fx) this.fx.particles.emit("sparks", x, y, z, 0, 1, 0, 6);
    events.emit("impact", { x, y, z, mat: MAT.metal, shooter: b.shooter });
  }

  melee(ch, def) {
    const ws = this.weapons.state(ch);
    ws.cooldown = 0.8;
    ch.swingT = 0.001;
    events.emit("melee", { ch });
    const b = ch.body;
    const fx = -Math.sin(ch.yaw);
    const fz = -Math.cos(ch.yaw);
    let best = null;
    for (const t of this.characters) {
      if (t === ch || !t.alive) continue;
      const dx = t.body.x - b.x;
      const dz = t.body.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > def.range + 0.4 || Math.abs(t.body.y - b.y) > 1.6) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.55) continue;
      if (!best || d < best.d) best = { t, d };
    }
    if (best) {
      const t = best.t;
      events.emit("meleeHit", { ch, target: t, x: t.body.x, y: t.body.y + 1.2, z: t.body.z });
      this.damage(t, def.dmg, { attacker: ch, weapon: def, part: "torso", dirX: -fx, dirZ: -fz });
    }
  }

  damage(target, amount, info = {}) {
    if (!target.alive || amount <= 0) return;
    const before = target.health;
    target.health = Math.max(0, target.health - amount);
    const dealt = before - target.health;
    target.lastHit = {
      time: this.time,
      dirX: info.dirX || 0,
      dirZ: info.dirZ || 0,
      attacker: info.attacker || null,
    };
    if (info.attacker && info.attacker !== target) info.attacker.stats.damage += dealt;
    if (target.action && target.action.type === "use") target.cancelAction();
    if (target.bot) target.bot.onDamaged(info.attacker);
    events.emit("damage", { target, amount: dealt, ...info });
    if (target.health <= 0) this.kill(target, info);
  }

  kill(target, info = {}) {
    if (!target.alive) return;
    target.alive = false;
    target.health = 0;
    target.ads = false;
    target.action = null;
    target.deathTime = 0;
    target.killer = info.attacker || null;
    if (target.vehicle && this.vehicles) this.vehicles.exit(target, true);
    const killer = info.attacker;
    if (killer && killer !== target) {
      killer.stats.kills++;
      if (info.headshot) killer.stats.headshots++;
    }
    this.aliveCount = this.characters.filter((c) => c.alive).length;
    target.rank = this.aliveCount + 1;
    // everything goes into a death crate
    const items = [];
    for (const w of target.loadout.toList()) items.push({ id: w.id, n: 1, weapon: w.weapon });
    for (const it of target.inv.toList()) items.push(it);
    if (target.inv.helmet)
      items.push({ id: `helmet${target.inv.helmet.level}`, n: 1, durability: target.inv.helmet.durability });
    if (target.inv.vest)
      items.push({ id: `vest${target.inv.vest.level}`, n: 1, durability: target.inv.vest.durability });
    if (target.inv.backpack) items.push({ id: `backpack${target.inv.backpack}`, n: 1 });
    const b = target.body;
    const gy = this.world.collision.groundAt(b.x, b.z, 0.3, b.y + 1);
    if (items.length) {
      const fx = Math.cos(target.yaw) * 0.9;
      const fz = -Math.sin(target.yaw) * 0.9;
      target.crate = this.pickups.spawnCrate(b.x + fx, Math.max(gy, -1.2), b.z + fz, items, "death", target);
    }
    target.inv.items.clear();
    target.inv.helmet = null;
    target.inv.vest = null;
    target.inv.backpack = 0;
    target.loadout.slots = [null, null, null, null, null];
    target.loadout.active = -1;
    events.emit("kill", {
      victim: target,
      killer,
      weapon: info.weapon || null,
      headshot: !!info.headshot,
      kind: info.kind || (info.weapon ? "weapon" : "other"),
      rank: target.rank,
    });
  }

  // ------------------------------------------------------------------ aiming

  // player's shot origin/direction from the camera (third person: muzzle -> crosshair point)
  updatePlayerAim() {
    const p = this.player;
    const gc = this.gcam;
    const ap = gc.computeAimPoint(1200, p, (o, d, maxT) => this.rayCharacters(o, d, maxT, p));
    const firstPerson = gc.adsBlend > 0.5 || gc.mode === "fpp";
    const o = firstPerson ? this.ctx.camera.position : muzzlePosition(p, _o);
    p.aimOrigin.x = o.x;
    p.aimOrigin.y = o.y;
    p.aimOrigin.z = o.z;
    _v.set(ap.x - o.x, ap.y - o.y, ap.z - o.z).normalize();
    // if the muzzle is behind cover in TPP, shots hit the cover (like PUBG)
    p.aimDir.x = _v.x;
    p.aimDir.y = _v.y;
    p.aimDir.z = _v.z;
    const b = p.body;
    const sy = b.y + p.eyeHeight() - 0.15;
    p.ctrl.pitch = Math.atan2(ap.y - sy, Math.max(0.5, Math.hypot(ap.x - b.x, ap.z - b.z)));
  }

  // Long outdoor route for bots via the coarse nav grid; a couple of searches per frame at most,
  // null when this frame's budget is spent (the caller retries shortly).
  navPath(from, to) {
    if (this.navBudget <= 0) return null;
    this.navBudget--;
    const hm = this.world.hm;
    const pts = this.world.navGrid.findPath(from.x, from.z, to.x, to.z);
    if (!pts) return [];
    for (const p of pts) p.y = hm.getHeight(p.x, p.z);
    return pts;
  }

  // nearest character hit along a ray (for crosshair aim point)
  rayCharacters(o, d, maxT, ignore) {
    let best = -1;
    for (const ch of this.characters) {
      if (ch === ignore || ch.mode === "plane" || !ch.anim || !ch.anim.poseVisible) continue;
      const h = hitCharacter(ch, this.rig, o.x, o.y, o.z, d.x, d.y, d.z, best >= 0 ? best : maxT);
      if (h) best = h.t;
    }
    return best;
  }

  // ------------------------------------------------------------------ frame

  // ------------------------------------------------------------------ match flow

  // Full battle royale: everyone boards the plane; zone + drops follow.
  startMatch({ bots = 49, speed = 1 } = {}) {
    const rng = this.rng;
    this.speed = speed;
    this.plane = new Plane(this.ctx.scene, rng.fork(11));
    this.zone = new ZoneSchedule(rng.fork(12), {
      center: { x: 0, z: 0 },
      r0: 1350,
      isLand: (x, z) => this.world.isLand(x, z) && this.world.hm.getHeight(x, z) < 70,
      startDelay: 60,
      speed,
    });
    this.zoneWall = new ZoneWall(this.ctx.scene);
    this.airdropSystem = new AirdropSystem(this);
    this.createBots(bots);
    const towns = this.world.data.towns;
    const weight = {
      military: 3,
      port: 2.4,
      oldtown: 3,
      school: 1.6,
      factory: 1.8,
      radar: 1.2,
      fishing: 1,
      farm: 1,
    };
    const brng = rng.fork(13);
    for (const b of this.bots) {
      // pick a town (or occasionally a random building) to drop on
      let tx;
      let tz;
      if (brng.chance(0.65)) {
        const t = brng.weighted(towns.map((t) => [t, weight[t.kind] ?? 1]));
        const a = brng.range(0, Math.PI * 2);
        const r = Math.sqrt(brng.next()) * t.radius * 0.8;
        tx = t.x + Math.cos(a) * r;
        tz = t.z + Math.sin(a) * r;
      } else {
        const bl = brng.pick(this.world.buildings);
        tx = bl.plot.x;
        tz = bl.plot.z;
      }
      b.dropTarget = { x: tx, z: tz };
      b.jumpDist = brng.range(330, 520);
    }
    for (const ch of this.characters) {
      ch.mode = "plane";
      ch.setPosition(this.plane.pos.x, this.plane.pos.y, this.plane.pos.z);
      ch.onLand = () => this.onLand(ch);
      ch.onChuteOpen = () => events.emit("chute", { ch });
    }
    this.state = "plane";
    this.controller.setView(Math.atan2(-this.plane.dir.x, -this.plane.dir.z), -0.25);
    events.emit("matchStart", { match: this });
  }

  get canJump() {
    return this.player.mode === "plane" && this.plane && this.plane.progress > 0.12;
  }

  jump(ch) {
    if (ch.mode !== "plane" || !this.plane) return false;
    const pl = this.plane;
    const b = ch.body;
    const side = (Math.random() - 0.5) * 6;
    b.x = pl.pos.x - pl.dir.x * 14 + -pl.dir.z * side;
    b.y = pl.pos.y - 3;
    b.z = pl.pos.z - pl.dir.z * 14 + pl.dir.x * side;
    b.vx = pl.dir.x * 22;
    b.vz = pl.dir.z * 22;
    b.vy = 0;
    ch.mode = "freefall";
    ch.freefallT = 0;
    ch.ctrl.deploy = false;
    ch.yaw = Math.atan2(-pl.dir.x, -pl.dir.z);
    ch.ctrl.yaw = ch.yaw;
    if (ch.bot) ch.bot.aimYaw = ch.yaw;
    events.emit("jump", { ch });
    return true;
  }

  onLand(ch) {
    events.emit("land", { ch });
    if (ch.bot) {
      ch.bot.lootUntil = this.time + ch.bot.rng.range(70, 150) / (this.speed < 1 ? 1.4 : 1);
      ch.bot.aimYaw = ch.yaw;
    }
  }

  updateZone(dt) {
    const z = this.zone;
    if (!z) return;
    const prevPhase = z.phase;
    const prevState = z.state;
    z.update(this.time);
    if (z.state !== prevState || z.phase !== prevPhase)
      events.emit("zone", { zone: z, state: z.state, phase: z.phase });
    this.zoneWall.update(this.time, z);
    // no zone damage once the match is decided (the winner must not die on the result screen)
    if (z.state === "idle" || this.state === "ended") return;
    this.zoneTick = (this.zoneTick || 0) + dt;
    if (this.zoneTick < 0.5) return;
    const tick = this.zoneTick;
    this.zoneTick = 0;
    for (const ch of this.characters) {
      if (!ch.alive || ch.mode === "plane") continue;
      if (z.outside(ch.body.x, ch.body.z)) this.damage(ch, z.dps * tick, { kind: "zone" });
    }
  }

  checkEnd() {
    if (this.state === "ended") return;
    const alive = this.characters.filter((c) => c.alive);
    this.aliveCount = alive.length;
    if (alive.length <= 1 && this.state !== "sandbox") {
      this.state = "ended";
      this.winner = alive[0] || null;
      if (this.winner) this.winner.rank = 1;
      events.emit("matchEnd", { winner: this.winner, playerRank: this.player.alive ? 1 : this.player.rank });
    }
  }

  // camera target while dead: the killer, else any living character
  spectateTarget() {
    const p = this.player;
    if (this.spectating && this.spectating.alive) return this.spectating;
    const k = p.killer && p.killer.alive ? p.killer : this.characters.find((c) => c.alive && c !== p);
    this.spectating = k || null;
    return this.spectating;
  }

  cycleSpectate() {
    const alive = this.characters.filter((c) => c.alive && c !== this.player);
    if (!alive.length) return;
    const i = alive.indexOf(this.spectating);
    this.spectating = alive[(i + 1) % alive.length];
  }

  update(dt) {
    this.time += dt;
    this.navBudget = 2;
    const p = this.player;
    const c = this.controller;
    // plane
    if (this.plane) {
      this.plane.update(dt);
      const pl = this.plane.pos;
      for (const ch of this.characters) if (ch.mode === "plane") ch.setPosition(pl.x, pl.y, pl.z);
      if (this.plane.progress > 0.975)
        for (const ch of this.characters) if (ch.mode === "plane") this.jump(ch);
      if (this.plane.done) {
        this.plane.remove(this.ctx.scene);
        this.plane = null;
        if (this.state === "plane") this.state = "playing";
      }
    }
    // player input (or autopilot)
    c.update(dt);
    if (p.bot) {
      c.viewYaw = p.bot.aimYaw;
      c.viewPitch = p.bot.aimPitch;
      this.gcam.yaw = c.viewYaw;
      this.gcam.pitch = c.viewPitch;
    }
    if (p.alive && !p.bot) {
      if (p.mode === "plane" && p.ctrl.interact && this.canJump) this.jump(p);
      else if (p.mode === "ground" && p.ctrl.interact) this.interact(p);
      else if (p.mode === "vehicle" && p.ctrl.interact) this.vehicles.exit(p);
      if (p.mode === "ground") this.updatePlayerAim();
      else {
        p.ctrl.pitch = c.viewPitch;
      }
    }
    this.updateVisibility(dt);
    for (const b of this.bots) b.update(dt);
    // weapons + movement for everyone
    for (const ch of this.characters) {
      if (ch.swingT > 0) ch.swingT = ch.swingT > 0.5 ? 0 : ch.swingT + dt;
      this.weapons.update(ch, dt);
      if (ch.dummy) ch.ctrl.mx = ch.ctrl.mz = 0;
      ch.update(dt, this.world);
    }
    // recoil into the player's view
    const [rp, ry] = this.weapons.takeRecoil(p);
    if (rp || ry) {
      c.viewPitch = Math.min(1.45, c.viewPitch + rp);
      c.viewYaw += ry;
      this.gcam.kickPitch += rp * 0.35;
    }
    this.ballistics.update(dt);
    this.updateZone(dt);
    if (this.vehicles) this.vehicles.update(dt);
    if (this.grenades) this.grenades.update(dt);
    if (this.airdropSystem) this.airdropSystem.update(dt);
    this.checkEnd();
    // camera
    this.gcam.zoom = this.currentZoom();
    let camChar = p;
    let opts = { ads: p.ads };
    if (!p.alive) {
      const t = this.spectateTarget();
      if (t) camChar = t;
      opts = { orbit: true, orbitDist: 4.5, orbitUp: 0.6 };
    } else if (p.mode === "plane") opts = { orbit: true, orbitDist: 42, orbitUp: 8, eyeHeight: 1 };
    else if (p.mode === "freefall") opts = { orbit: true, orbitDist: 6.5, orbitUp: 1.2, eyeHeight: 0.9 };
    else if (p.mode === "chute") opts = { orbit: true, orbitDist: 7.5, orbitUp: 1.5, eyeHeight: 1.2 };
    else if (p.mode === "vehicle" && p.vehicle)
      opts = { orbit: true, orbitDist: 8.5, orbitUp: 1.8, eyeHeight: 1.6 };
    this.gcam.update(dt, camChar, opts);
    p.anim.hidden = p.alive && this.gcam.mode3 === "fpp";
    this.rig.update(dt, this.ctx.camera);
    this.held.update(this.characters, p.anim.hidden ? p : null);
    this.viewmodel.update(dt, p, this.gcam, this.input.dx, this.input.dy);
    this.pickups.update(dt, this.ctx.camera.position);
  }

  dispose() {
    if (this.plane) this.plane.remove(this.ctx.scene);
    if (this.zoneWall) this.ctx.scene.remove(this.zoneWall.mesh);
    if (this.vehicles) this.vehicles.dispose();
    if (this.grenades) this.grenades.dispose();
    if (this.airdropSystem) this.airdropSystem.dispose();
    this.ctx.vmActive = false;
    this.ctx.screenFx.uniforms.uZone.value = 0;
    this.ctx.screenFx.uniforms.uDamage.value = 0;
    this.ctx.screenFx.uniforms.uLowHealth.value = 0;
  }

  currentZoom() {
    const w = this.player.loadout.current();
    if (!w || !w.att.sight) return 1;
    return ATTACHMENTS[w.att.sight].zoom;
  }
}

export { magSize };
