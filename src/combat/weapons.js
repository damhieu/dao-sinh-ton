// Per-character weapon handling: switching, reloading, consumables, firing, spread and recoil.
import { WEAPONS, ATTACHMENTS, ITEMS } from "../items/itemdefs.js";
import { magSize, SLOT_THROW, SLOT_MELEE } from "../items/loadout.js";
import { weaponModel } from "../items/models.js";
import { events } from "../core/events.js";

const DEG = Math.PI / 180;

function recoilMods(w) {
  let v = 1;
  let h = 1;
  const m = w.att.muzzle && ATTACHMENTS[w.att.muzzle];
  if (m && m.recoilMul) {
    v *= m.recoilMul;
    h *= m.recoilMul;
  }
  const g = w.att.grip && ATTACHMENTS[w.att.grip];
  if (g && g.vRecoilMul) v *= g.vRecoilMul;
  return [v, h];
}

export function isSuppressed(w) {
  return !!(w && w.att.muzzle && ATTACHMENTS[w.att.muzzle].suppressed);
}

// World-space muzzle position of the character's current weapon
export function muzzlePosition(ch, out) {
  const w = ch.loadout.current();
  const a = ch.anim;
  if (w && a && a.weaponVisible && ch.poseFrame >= 0) {
    const m = weaponModel(w.id).mounts.muzzle;
    const e = a.weaponMatrix.elements;
    out.x = e[0] * m[0] + e[4] * m[1] + e[8] * m[2] + e[12];
    out.y = e[1] * m[0] + e[5] * m[1] + e[9] * m[2] + e[13];
    out.z = e[2] * m[0] + e[6] * m[1] + e[10] * m[2] + e[14];
    return out;
  }
  const b = ch.body;
  out.x = b.x - Math.sin(ch.yaw) * 0.5;
  out.y = b.y + ch.eyeHeight() - 0.1;
  out.z = b.z - Math.cos(ch.yaw) * 0.5;
  return out;
}

export class WeaponSystem {
  constructor(game) {
    this.game = game;
  }

  state(ch) {
    if (!ch.ws) ch.ws = { cooldown: 0, bloom: 0, lastShot: -9, recoilP: 0, recoilY: 0, shotCount: 0 };
    return ch.ws;
  }

  // Start a weapon switch to `slot` (-1 = holster)
  switchTo(ch, slot) {
    const lo = ch.loadout;
    if (slot === lo.active) return;
    if (slot >= 0 && slot !== SLOT_THROW && !lo.slots[slot]) return;
    if (slot === SLOT_THROW && ch.inv.count("frag") + ch.inv.count("smoke") <= 0) return;
    if (ch.action && ch.action.type !== "use") ch.cancelAction();
    lo.active = slot;
    if (slot >= 0) ch.startAction("switch", 0.45);
    events.emit("switch", { ch, slot });
  }

  startReload(ch) {
    const w = ch.loadout.current();
    if (!w) return false;
    const def = WEAPONS[w.id];
    if (!def.ammo || w.mag >= magSize(w) || ch.inv.count(def.ammo) <= 0) return false;
    if (ch.action) return false;
    ch.startAction("reload", def.reload * (w.mag === 0 ? 1.12 : 1), { weapon: w });
    events.emit("reload", { ch, weapon: w, def });
    return true;
  }

  startUse(ch, id) {
    if (!ch.canUse(id)) return false;
    if (ch.action && ch.action.type === "use") return false;
    ch.cancelAction();
    ch.startAction("use", ITEMS[id].useTime, { item: id });
    events.emit("useStart", { ch, item: id });
    return true;
  }

  // Advance timed actions (reload, switch, use, bolt)
  updateAction(ch, dt) {
    const a = ch.action;
    if (!a) return;
    const c = ch.ctrl;
    if (a.type === "use" && (c.firePressed || c.jump || (ch.sprinting && ch.moveSpeed > 5) || !ch.alive)) {
      ch.cancelAction();
      events.emit("useCancel", { ch });
      return;
    }
    a.t += dt;
    if (a.t < a.dur) return;
    ch.action = null;
    if (a.type === "reload") {
      const w = a.weapon;
      if (w !== ch.loadout.current()) return;
      const def = WEAPONS[w.id];
      const need = magSize(w) - w.mag;
      const got = ch.inv.remove(def.ammo, need);
      w.mag += got;
      events.emit("reloaded", { ch, weapon: w });
    } else if (a.type === "use") {
      if (ch.inv.remove(a.item, 1) > 0) {
        ch.applyConsumable(a.item);
        events.emit("used", { ch, item: a.item });
      }
    }
  }

  update(ch, dt) {
    const ws = this.state(ch);
    ws.cooldown -= dt;
    ws.bloom = Math.max(0, ws.bloom - dt * 3);
    ch.firingTime = Math.max(0, (ch.firingTime || 0) - dt);
    if (!ch.alive) return;
    const c = ch.ctrl;
    const lo = ch.loadout;
    // selection
    if (c.select >= 0) this.switchTo(ch, c.select === lo.active && c.select !== SLOT_THROW ? -1 : c.select);
    else if (c.selectCycle) {
      const order = [0, 1, 2, 3].filter((s) => lo.slots[s]);
      if (order.length) {
        const i = order.indexOf(lo.active);
        const n = order[(i + c.selectCycle + order.length) % order.length];
        this.switchTo(ch, n);
      }
    }
    if (c.holster) this.switchTo(ch, -1);
    if (c.use) this.startUse(ch, c.use);
    this.updateAction(ch, dt);
    if (ch.mode !== "ground") return;
    if (lo.active === SLOT_THROW) {
      // grenades are handled by the grenade system
      ch.ads = false;
      return;
    }
    const w = lo.current();
    if (!w) {
      ch.ads = false;
      return;
    }
    const def = WEAPONS[w.id];
    if (c.fireMode && def.modes.length > 1) {
      w.mode = def.modes[(def.modes.indexOf(w.mode) + 1) % def.modes.length];
      events.emit("fireMode", { ch, weapon: w });
    }
    if (c.reload) this.startReload(ch);
    // ADS allowed when not sprinting and not busy with a switch
    ch.ads = c.ads && def.cls !== "MELEE" && !ch.sprinting && !(ch.action && ch.action.type === "switch");
    if (def.cls === "MELEE") {
      if (c.firePressed && ws.cooldown <= 0 && !ch.action) this.game.melee(ch, def);
      return;
    }
    const wantFire = w.mode === "auto" ? c.fire : c.firePressed;
    if (!wantFire) return;
    if (ch.action && ch.action.type !== "use") return;
    if (ws.cooldown > 0) return;
    if (w.mag <= 0) {
      if (c.firePressed) {
        events.emit("dryfire", { ch });
        if (!this.startReload(ch)) ws.cooldown = 0.25;
      }
      return;
    }
    this.fire(ch, w, def, ws);
  }

  fire(ch, w, def, ws) {
    w.mag--;
    ws.cooldown = 60 / def.rpm;
    if (def.bolt) ws.cooldown = def.bolt;
    ch.firingTime = 0.6;
    ch.sprinting = false;
    if (ch.action && ch.action.type === "use") ch.cancelAction();
    // spread (degrees)
    let spread = ch.ads ? def.spread.ads : def.spread.hip;
    if (ch.stance === "crouch") spread *= 0.82;
    if (ch.stance === "prone") spread *= 0.65;
    spread *= 1 + ch.moveSpeed * (ch.ads ? 0.07 : 0.22);
    if (!ch.body.onGround) spread *= 2.5;
    spread += ws.bloom * (ch.ads ? 0.35 : 1);
    ws.bloom = Math.min(3, ws.bloom + (ch.ads ? 0.18 : 0.5) * (def.cls === "SMG" ? 0.6 : 1));
    const o = ch.aimOrigin;
    const d = ch.aimDir;
    const pellets = def.pellets || 1;
    const hasTracer = ch.isPlayer ? ws.shotCount % 3 === 0 : Math.random() < 0.35;
    ws.shotCount = (ws.shotCount || 0) + 1;
    for (let p = 0; p < pellets; p++) {
      const ang = Math.random() * Math.PI * 2;
      const r = spread * DEG * Math.sqrt(Math.random());
      // perturb direction inside a cone
      const ux = Math.abs(d.y) < 0.99 ? 0 : 1;
      const uy = Math.abs(d.y) < 0.99 ? 1 : 0;
      let ax = uy * d.z - 0 * d.y;
      let ay = 0 * d.x - ux * d.z;
      let az = ux * d.y - uy * d.x;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al;
      ay /= al;
      az /= al;
      const bx = d.y * az - d.z * ay;
      const by = d.z * ax - d.x * az;
      const bz = d.x * ay - d.y * ax;
      const ca = Math.cos(ang) * Math.tan(r);
      const sa = Math.sin(ang) * Math.tan(r);
      let dx = d.x + ax * ca + bx * sa;
      let dy = d.y + ay * ca + by * sa;
      let dz = d.z + az * ca + bz * sa;
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      const b = this.game.ballistics.fire(ch, o.x, o.y, o.z, dx, dy, dz, def, { pellet: pellets > 1 });
      if (hasTracer && p === 0) this.game.fx.tracers.add(b, [1.0, 0.7, 0.32], ch.isPlayer ? 3 : 5);
    }
    // recoil (degrees -> radians), consumed by the controller
    const [mv, mh] = recoilMods(w);
    let k = 1;
    if (ch.stance === "crouch") k *= 0.85;
    if (ch.stance === "prone") k *= 0.7;
    if (!ch.ads) k *= 1.15;
    ws.recoilP += def.recoil.v * mv * k * DEG * (0.85 + Math.random() * 0.3);
    ws.recoilY += (Math.random() - 0.45) * 2 * def.recoil.h * mh * k * DEG;
    ws.lastShot = this.game.time;
    if (ch.anim) ch.anim.recoil = 1;
    this.game.onShot(ch, w, def);
  }

  // Controller pulls pending recoil each frame
  takeRecoil(ch) {
    const ws = this.state(ch);
    const p = ws.recoilP;
    const y = ws.recoilY;
    ws.recoilP = 0;
    ws.recoilY = 0;
    return [p, y];
  }
}

export { SLOT_MELEE };
