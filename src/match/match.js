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
        best = { type: p.crate ? "crate" : "pickup", target: p, dist: d };
      }
    }
    const di = this.world.doors.nearest(b.x + fx * 0.6, b.y + 1, b.z + fz * 0.6, 1.6);
    if (di >= 0) {
      const d = this.world.doors.list[di];
      const dd = Math.hypot(d.x - b.x, d.z - b.z);
      if (!best || dd < best.dist - 0.3) best = { type: "door", target: di, dist: dd };
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
    const fx = this.fx;
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

  update(dt) {
    this.time += dt;
    const p = this.player;
    const c = this.controller;
    // player input
    c.update(dt);
    if (p.alive && p.mode === "ground" && p.ctrl.interact) this.interact(p);
    if (p.mode === "ground") this.updatePlayerAim();
    // weapons + movement for everyone
    for (const ch of this.characters) {
      if (ch.swingT > 0) ch.swingT = ch.swingT > 0.5 ? 0 : ch.swingT + dt;
      this.weapons.update(ch, dt);
      if (ch !== p && ch.dummy) {
        ch.ctrl.mx = ch.ctrl.mz = 0;
      }
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
    // camera & rendering state
    this.gcam.zoom = this.currentZoom();
    this.gcam.update(dt, p, { ads: p.ads });
    p.anim.hidden = this.gcam.mode3 === "fpp";
    this.rig.update(dt, this.ctx.camera);
    this.held.update(this.characters, p.anim.hidden ? p : null);
    this.viewmodel.update(dt, p, this.gcam, this.input.dx, this.input.dy);
    this.pickups.update(dt, this.ctx.camera.position);
    this.aliveCount = this.characters.filter((ch) => ch.alive).length;
  }

  currentZoom() {
    const w = this.player.loadout.current();
    if (!w || !w.att.sight) return 1;
    return ATTACHMENTS[w.att.sight].zoom;
  }
}

export { magSize };
