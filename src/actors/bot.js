// Bot brain: utility-based goal selection + execution (drop, loot, engage, cover, heal, zone, roam).
import { steer, nearestNode, buildingPath } from "./navigation.js";
import { Perception } from "./perception.js";
import { WEAPONS, ITEMS, ATTACHMENTS, attachmentFits } from "../items/itemdefs.js";
import { magSize } from "../items/loadout.js";
import { dropAt } from "../combat/ballistics-core.js";
import { F_VISION } from "../world/collision.js";

const TAU = Math.PI * 2;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const approach = (a, b, max) => {
  const d = angDiff(a, b);
  return a + Math.max(-max, Math.min(max, d));
};
const CLASS_RANK = { AR: 100, DMR: 80, SMG: 85, SR: 78, SG: 70, PISTOL: 35, MELEE: 5 };

export class BotController {
  constructor(ch, match, rng, opts = {}) {
    this.ch = ch;
    this.m = match;
    this.rng = rng;
    this.skill = opts.skill ?? 0.5;
    this.aggr = opts.aggression ?? 0.5;
    this.perc = new Perception(this);
    this.goal = "idle";
    this.thinkT = rng.range(0, 0.4);
    this.lastThink = 0;
    this.nav = { side: 0 };
    this.route = null;
    this.routeTarget = null;
    this.routeT = 0;
    this.enemy = null;
    this.lootTarget = null;
    this.moveGoal = null;
    this.aimYaw = ch.yaw;
    this.aimPitch = 0;
    this.err = { x: 0, y: 0, z: 0 };
    this.errT = 0;
    this.trackT = 0;
    this.seenAt = -1;
    this.burst = 0;
    this.burstPause = 0;
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
    this.strafeT = 0;
    this.stuck = { t: 0, x: 0, z: 0, count: 0, lt: 0, lx: 0, lz: 0 };
    this.doorT = 0;
    this.lootUntil = 0;
    this.coverPoint = null;
    this.coverT = 0;
    this.zonePoint = null;
    this.zoneKey = "";
    this.roamPoint = null;
    this.headPref = this.skill > 0.7 && rng.chance(0.35);
    this.lastD = Infinity;
    this.moveDir = { x: 0, z: 0 };
    this.wantSprint = false;
    this.far = false;
  }

  // ------------------------------------------------------------------ events

  onDamaged(attacker) {
    if (attacker && attacker !== this.ch) this.perc.alert(attacker, this.m.time, 1.1);
    this.hurtAt = this.m.time;
  }

  onHeard(shooter, x, y, z, dist) {
    if (shooter === this.ch) return;
    this.perc.hear(shooter, x, y, z, this.m.time, dist);
  }

  // ------------------------------------------------------------------ helpers

  weaponScoreFor(w, dist) {
    const def = WEAPONS[w.id];
    const hasAmmo = w.mag > 0 || (def.ammo && this.ch.inv.count(def.ammo) > 0);
    if (!hasAmmo || def.cls === "MELEE") return -1;
    switch (def.cls) {
      case "SR":
        return dist > 90 ? 10 : dist > 40 ? 5 : 1;
      case "DMR":
        return dist > 60 ? 9 : 5;
      case "AR":
        return dist < 220 ? 8 : 6;
      case "SMG":
        return dist < 45 ? 9 : 4;
      case "SG":
        return dist < 14 ? 11 : 0.5;
      case "PISTOL":
        return 2;
      default:
        return 0;
    }
  }

  bestSlot(dist) {
    let best = -1;
    let bs = 0;
    for (let s = 0; s < 3; s++) {
      const w = this.ch.loadout.slots[s];
      if (!w) continue;
      const sc = this.weaponScoreFor(w, dist);
      if (sc > bs) {
        bs = sc;
        best = s;
      }
    }
    return best;
  }

  hasHeal() {
    const inv = this.ch.inv;
    return inv.count("bandage") + inv.count("firstaid") + inv.count("medkit") > 0;
  }

  // how much the bot wants an item id (0 = not at all)
  want(id) {
    const def = ITEMS[id];
    const ch = this.ch;
    const inv = ch.inv;
    const lo = ch.loadout;
    switch (def.cat) {
      case "weapon": {
        const w = WEAPONS[id];
        if (w.cls === "PISTOL") return !lo.slots[0] && !lo.slots[2] ? 55 : !lo.slots[2] ? 12 : 0;
        const p1 = lo.slots[0];
        const p2 = lo.slots[1];
        if (!p1) return CLASS_RANK[w.cls];
        if (!p2 && WEAPONS[p1.id].id !== id) return CLASS_RANK[w.cls] * 0.55;
        // upgrade the weaker primary
        const weakest = Math.min(CLASS_RANK[WEAPONS[p1.id].cls], p2 ? CLASS_RANK[WEAPONS[p2.id].cls] : 0);
        return CLASS_RANK[w.cls] > weakest + 8 ? 20 : 0;
      }
      case "melee":
        return lo.slots[3] ? 0 : 8;
      case "ammo": {
        const uses = lo.slots.some((w) => w && WEAPONS[w.id] && WEAPONS[w.id].ammo === id);
        if (!uses) return 0;
        const n = inv.count(id);
        return n < 60 ? 60 : n < 150 ? 30 : 0;
      }
      case "helmet":
        return !inv.helmet || inv.helmet.level < def.level ? 40 + def.level * 8 : 0;
      case "vest":
        return !inv.vest || inv.vest.level < def.level ? 42 + def.level * 8 : 0;
      case "backpack":
        return inv.backpack < def.level ? 35 + def.level * 5 : 0;
      case "heal":
        if (id === "bandage") return inv.count(id) < 10 ? 28 : 0;
        if (id === "firstaid") return inv.count(id) < 4 ? 34 : 0;
        return inv.count(id) < 2 ? 40 : 0;
      case "boost":
        return inv.count("energy") + inv.count("painkiller") < 4 ? 22 : 0;
      case "attachment": {
        const a = ATTACHMENTS[id];
        for (const w of lo.slots) {
          if (!w || !WEAPONS[w.id] || !attachmentFits(id, w.id)) continue;
          if (!w.att[a.slot]) return a.slot === "sight" ? (a.zoom >= 4 ? 40 : 30) : 25;
        }
        return 0;
      }
      case "throwable":
        return inv.count("frag") < 2 && id === "frag" ? 20 : 0;
      default:
        return 0;
    }
  }

  // ------------------------------------------------------------------ movement

  // plan waypoints to (x,y,z), using building nav graphs when entering/exiting buildings
  planRoute(x, y, z) {
    const m = this.m;
    const b = this.ch.body;
    const bi = m.buildingIndex;
    const here = bi.at(b.x, b.y, b.z);
    const there = bi.at(x, y, z);
    const exit = [];
    if (here && here !== there) {
      // exit via nearest entrance
      const n0 = nearestNode(here, b.x, b.y, b.z);
      let best = null;
      for (const e of here.entrances) {
        const p = buildingPath(here, n0, e);
        if (p && (!best || p.length < best.length)) best = p;
      }
      if (best) for (const i of best) exit.push(here.nav.nodes[i]);
    }
    const pts = [];
    if (there) {
      const entryFrom = here === there ? nearestNode(there, b.x, b.y, b.z) : null;
      const goalNode = nearestNode(there, x, y, z);
      let best = null;
      if (entryFrom !== null) best = buildingPath(there, entryFrom, goalNode);
      else {
        for (const e of there.entrances) {
          const p = buildingPath(there, e, goalNode);
          if (!p) continue;
          const ex = there.nav.nodes[e];
          const cost = p.length + Math.hypot(ex.x - b.x, ex.z - b.z) * 0.2;
          if (!best || cost < best.cost) best = Object.assign(p, { cost });
        }
      }
      if (best) for (const i of best) pts.push(there.nav.nodes[i]);
    }
    pts.push({ x, y, z });
    // long outdoor leg (building exit -> entrance/target): coarse grid route around obstacles
    let routeT = 6;
    let leg = [];
    if (!here || here !== there) {
      const from = exit.length ? exit[exit.length - 1] : b;
      const to = pts[0];
      if (Math.hypot(to.x - from.x, to.z - from.z) > 24) {
        leg = m.navPath(from, to);
        if (leg) routeT = 12;
        else {
          leg = [];
          routeT = 0.3; // search budget spent this frame: head straight for now, retry soon
        }
      }
    }
    this.route = [...exit, ...leg, ...pts];
    this.routeTarget = { x, y, z };
    this.routeT = routeT;
  }

  // Move toward a point; returns remaining horizontal distance
  moveTo(x, y, z, dt, sprint = false) {
    const b = this.ch.body;
    const rt = this.routeTarget;
    this.routeT -= dt;
    if (!rt || Math.hypot(rt.x - x, rt.z - z) > 1.5 || Math.abs(rt.y - y) > 2 || this.routeT <= 0)
      this.planRoute(x, y, z);
    let wp = this.route[0];
    while (
      wp &&
      this.route.length > 1 &&
      Math.hypot(wp.x - b.x, wp.z - b.z) < 0.7 &&
      Math.abs(wp.y - b.y) < 1.4
    ) {
      this.route.shift();
      wp = this.route[0];
    }
    const d = Math.hypot(x - b.x, z - b.z);
    if (!wp) return d;
    // walk straight when the line to the waypoint is clear, otherwise steer around obstacles
    const nearBuilding = this.m.buildingIndex.at(b.x, b.y, b.z, 0.3);
    const dir =
      this.escapeT > 0
        ? this.escapeDir
        : clearLine(this.m.world.collision, b, wp)
          ? direct(b, wp)
          : steer(this.ch, wp.x, wp.z, this.m.world, this.nav);
    if (this.escapeT > 0) this.escapeT -= dt;
    this.moveDir.x = dir.x;
    this.moveDir.z = dir.z;
    this.wantSprint = sprint && d > 8 && !nearBuilding;
    this.openDoorsAhead(dt);
    return d;
  }

  openDoorsAhead(dt) {
    this.doorT -= dt;
    if (this.doorT > 0) return;
    this.doorT = 0.3;
    const b = this.ch.body;
    const doors = this.m.world.doors;
    const di = doors.nearest(b.x + this.moveDir.x * 0.9, b.y + 1, b.z + this.moveDir.z * 0.9, 1.1);
    if (di >= 0 && doors.list[di].target === 0) {
      doors.toggle(di);
      this.m.onDoor && this.m.onDoor(this.ch, doors.list[di]);
    }
  }

  checkStuck(dt, wantsMove) {
    const s = this.stuck;
    const b = this.ch.body;
    // long window: catches back-and-forth oscillation that the 1 s check below misses
    if (s.lt === 0) {
      // window start (also the first frame on the ground after landing)
      s.lx = b.x;
      s.lz = b.z;
    }
    s.lt += dt;
    if (s.lt >= 6) {
      const net = Math.hypot(b.x - s.lx, b.z - s.lz);
      s.lt = 0;
      if (wantsMove && net < 3 && this.goal !== "engage" && this.goal !== "cover") {
        this.routeT = 0;
        this.nav.side = -(this.nav.side || 1);
        const a = this.rng.range(0, TAU);
        this.escapeDir = { x: Math.cos(a), z: Math.sin(a) };
        this.escapeT = 2;
      }
    }
    s.t += dt;
    if (s.t < 1) return;
    const moved = Math.hypot(b.x - s.x, b.z - s.z);
    s.t = 0;
    s.x = b.x;
    s.z = b.z;
    if (!wantsMove || moved > 0.45) {
      s.count = 0;
      return;
    }
    s.count++;
    const c = this.ch.ctrl;
    if (s.count === 1) c.jump = true;
    else if (s.count === 2) this.nav.side = -(this.nav.side || 1);
    else if (s.count === 3) {
      // give up on an unreachable loot target for a while
      if (this.lootTarget) {
        this.lootTarget.skipUntil = this.lootTarget.skipUntil || new Map();
        this.lootTarget.skipUntil.set(this.ch, this.m.time + 40);
        this.lootTarget.claimedBy = null;
        this.lootTarget = null;
      }
      this.routeT = 0;
      this.thinkT = 0;
    } else if (s.count >= 5 && this.ch.visibleToPlayer) {
      // wander off in a random direction for a moment
      const a = this.rng.range(0, TAU);
      this.escapeDir = { x: Math.cos(a), z: Math.sin(a) };
      this.escapeT = 1.5;
      this.routeT = 0;
    } else if (s.count >= 6 && !this.ch.visibleToPlayer) {
      // last resort: nudge toward the next waypoint
      const wp = this.route && this.route[0];
      if (wp) {
        const dx = wp.x - b.x;
        const dz = wp.z - b.z;
        const l = Math.hypot(dx, dz) || 1;
        const nx = b.x + (dx / l) * Math.min(2, l);
        const nz = b.z + (dz / l) * Math.min(2, l);
        b.x = nx;
        b.z = nz;
        b.y = Math.max(b.y, this.m.world.collision.groundAt(nx, nz, 0.3, b.y + 2));
      }
      s.count = 0;
    }
  }

  // ------------------------------------------------------------------ aiming

  aimAt(t, dt, e) {
    const ch = this.ch;
    const b = ch.body;
    const w = ch.loadout.current();
    const def = w ? WEAPONS[w.id] : WEAPONS.p92;
    const tb = t.body;
    const visible = e && e.visible;
    const tx = visible ? tb.x : e.x;
    const tz = visible ? tb.z : e.z;
    const ty =
      (visible ? tb.y : e.y) +
      (t.stance === "prone" ? 0.25 : t.stance === "crouch" ? 0.9 : this.headPref ? 1.62 : 1.3);
    const ox = b.x;
    const oy = b.y + ch.eyeHeight();
    const oz = b.z;
    const dist = Math.hypot(tx - ox, tz - oz);
    let ax = tx;
    let ay = ty;
    let az = tz;
    if (visible) {
      const tf = dist / def.speed;
      const lead = 0.3 + this.skill * 0.7;
      ax += (tb.vx || 0) * tf * lead;
      az += (tb.vz || 0) * tf * lead;
      ay += dropAt(def.speed, dist) * (0.4 + this.skill * 0.6);
    }
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = 0.3 + this.rng.next() * 0.35;
      const track = 1 + 1.3 * Math.max(0, 1 - this.trackT / 1.7);
      const tSpeed = Math.hypot(tb.vx || 0, tb.vz || 0);
      const mag =
        (0.12 + (1 - this.skill) * 0.8) *
        (dist / 28 + 0.25) *
        track *
        (1 + tSpeed / 5) *
        (ch.ads ? 0.8 : 1.3);
      this.err.x = (this.rng.next() * 2 - 1) * mag;
      this.err.y = (this.rng.next() * 2 - 1) * mag * 0.5;
      this.err.z = (this.rng.next() * 2 - 1) * mag;
    }
    ax += this.err.x;
    ay += this.err.y;
    az += this.err.z;
    const dYaw = Math.atan2(-(ax - ox), -(az - oz));
    const dPitch = Math.atan2(ay - oy, Math.max(0.3, Math.hypot(ax - ox, az - oz)));
    const turn = (1.8 + this.skill * 5.5) * dt;
    this.aimYaw = approach(this.aimYaw, dYaw, turn);
    this.aimPitch += Math.max(-turn, Math.min(turn, dPitch - this.aimPitch));
    const c = ch.ctrl;
    c.yaw = this.aimYaw;
    c.pitch = this.aimPitch;
    ch.aimOrigin.x = ox;
    ch.aimOrigin.y = oy;
    ch.aimOrigin.z = oz;
    const cp = Math.cos(this.aimPitch);
    ch.aimDir.x = -Math.sin(this.aimYaw) * cp;
    ch.aimDir.y = Math.sin(this.aimPitch);
    ch.aimDir.z = -Math.cos(this.aimYaw) * cp;
    return { dist, err: Math.abs(angDiff(this.aimYaw, dYaw)) + Math.abs(dPitch - this.aimPitch) };
  }

  faceMove(dt) {
    const c = this.ch.ctrl;
    if (Math.hypot(this.moveDir.x, this.moveDir.z) > 0.1) {
      const yaw = Math.atan2(-this.moveDir.x, -this.moveDir.z);
      this.aimYaw = approach(this.aimYaw, yaw, 6 * dt);
    }
    this.aimPitch *= 0.9;
    c.yaw = this.aimYaw;
    c.pitch = this.aimPitch;
  }

  // ------------------------------------------------------------------ plane & drop

  planeUpdate(dt) {
    const m = this.m;
    const t = this.dropTarget;
    if (!t || !m.plane) return;
    const p = m.plane.pos;
    const d = Math.hypot(p.x - t.x, p.z - t.z);
    if (m.plane.overIsland && (d < this.jumpDist || (d > this.lastD + 0.5 && this.lastD < 750)))
      m.jump(this.ch);
    this.lastD = d;
  }

  dropUpdate(dt) {
    const ch = this.ch;
    const c = ch.ctrl;
    const b = ch.body;
    const t = this.dropTarget || { x: b.x, z: b.z };
    const dx = t.x - b.x;
    const dz = t.z - b.z;
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    this.aimYaw = approach(this.aimYaw, yaw, 1.8 * dt);
    c.yaw = this.aimYaw;
    c.pitch = -0.4;
    c.mx = 0;
    const agl = b.y - Math.max(0, this.m.world.hm.getHeight(b.x, b.z));
    if (ch.mode === "freefall") {
      // glide toward the target, open the chute early if it is far away
      c.mz = d > 60 ? 1 : 0;
      c.deploy = d > agl * 2.2 && agl < 420;
    } else {
      c.mz = d > 25 ? 1 : d < 8 ? -1 : 0;
      c.deploy = false;
    }
  }

  // ------------------------------------------------------------------ thinking

  think() {
    const m = this.m;
    const ch = this.ch;
    const now = m.time;
    const dt = Math.min(1, now - this.lastThink);
    this.lastThink = now;
    const cur = ch.loadout.current();
    const zoomNow = cur && cur.att.sight ? ATTACHMENTS[cur.att.sight].zoom : 1;
    const sight = 190 + (zoomNow >= 4 ? 170 : zoomNow >= 2 ? 70 : 0) + this.skill * 40;
    this.perc.update(dt, m, sight);
    const enemy = this.perc.bestVisible();
    if (enemy !== this.enemy) {
      this.trackT = 0;
      this.seenAt = now;
      this.burst = 0;
    }
    this.enemy = enemy;
    const b = ch.body;
    const armed = this.bestSlot(enemy ? Math.hypot(enemy.body.x - b.x, enemy.body.z - b.z) : 50) >= 0;
    const zone = m.zone;
    const scores = [];
    const lootWindow = now < this.lootUntil;
    // engage / flee
    if (enemy) {
      const d = Math.hypot(enemy.body.x - b.x, enemy.body.z - b.z);
      if (armed) {
        // picking fights at range is for the bold (fresh looters keep quiet unless close);
        // anyone shot at recently answers back
        if (d < (lootWindow ? 30 : 60) || this.aggr > 0.7 || now - (this.hurtAt ?? -99) < 8)
          scores.push(["engage", 100 + this.aggr * 10]);
      } else if (ch.loadout.slots[3] && d < 8) scores.push(["engage", 95]);
      else {
        // unarmed: grab nearby gear rather than run, unless the enemy is closer than it
        const t = this.findLoot(18);
        if (t && Math.hypot(t.p.x - b.x, t.p.z - b.z) < d) scores.push(["loot", 99]);
        scores.push(["flee", 98]);
      }
      if (armed && ch.health < 35 && this.hasHeal()) scores.push(["cover", 104]);
    } else if (ch.health < 70 && this.hasHeal() && now - (this.hurtAt ?? -99) > 2.5) {
      scores.push(["heal", 80 + (70 - ch.health) * 0.5]);
    } else if (
      ch.boost < 40 &&
      ch.health < 95 &&
      ch.inv.count("energy") + ch.inv.count("painkiller") > 0 &&
      now - (this.hurtAt ?? -99) > 6
    ) {
      scores.push(["heal", 40]);
    }
    // zone
    if (zone && zone.state !== "idle") {
      const out = zone.distanceOutside(b.x, b.z);
      const nextOut = Math.hypot(b.x - zone.next.x, b.z - zone.next.z) - zone.next.r * 0.85;
      if (out > 0) scores.push(["zone", 118 + Math.min(20, out * 0.1)]);
      else if (nextOut > 0) {
        // time until the moving edge reaches us (most of the shrink still counts while waiting)
        const tl = zone.timeline[zone.phase];
        const left = zone.timeLeft + (zone.state === "waiting" ? (tl.tE - tl.tS) * 0.7 : 0);
        const urgency = nextOut / 5.5 / Math.max(1, left);
        if (urgency > 0.35) scores.push(["zone", Math.min(115, 40 + (urgency - 0.35) * 160)]);
      }
    }
    // loot
    const needGear = !armed || !ch.inv.vest || !ch.inv.helmet || !this.hasHeal();
    if (lootWindow || needGear) {
      // without a usable gun, search much further (grid routes make distant loot reachable)
      const t = this.findLoot(lootWindow ? 38 : armed ? 26 : 70);
      if (t) scores.push(["loot", (lootWindow ? 60 : armed ? 45 : 70) + t.score * 0.25]);
      else this.lootTarget = null;
    }
    // investigate sounds / last known enemies
    const lk = this.perc.lastKnown(25, now);
    if (lk && armed) scores.push(["investigate", 35 + this.aggr * 30]);
    // airdrop
    if (m.airdrops) {
      for (const a of m.airdrops) {
        if (!a.landed || !a.crate || !m.pickups.list.has(a.crate)) continue;
        const d = Math.hypot(a.crate.x - b.x, a.crate.z - b.z);
        if (d < 260 && this.aggr > 0.35) scores.push(["airdrop", 55 + this.aggr * 20 - d * 0.05]);
      }
    }
    if (this.goal === "grenade" && this.grenadeT < 2.5) scores.push(["grenade", 200]);
    scores.push(["roam", 20]);
    scores.sort((a, c) => c[1] - a[1]);
    const g = scores[0][0];
    if (g !== this.goal) {
      this.goal = g;
      this.coverPoint = null;
    }
    this.lastKnownEnemy = lk;
  }

  findLoot(radius) {
    const m = this.m;
    const b = this.ch.body;
    const near = m.pickups.near(b.x, b.y, b.z, radius, this._near || (this._near = []));
    // near() filters by height; also consider items on other floors of the building we're in
    let best = null;
    for (const p of near) this.scoreLoot(p, best, (s) => (best = s));
    const bld = m.buildingIndex.at(b.x, b.y, b.z);
    if (bld && !best) {
      for (const p of m.pickups.near(b.x, b.y + 3.2, b.z, radius, []))
        this.scoreLoot(p, best, (s) => (best = s));
      for (const p of m.pickups.near(b.x, b.y - 3.2, b.z, radius, []))
        this.scoreLoot(p, best, (s) => (best = s));
    }
    this.lootTarget = best ? best.p : null;
    this.lootIndex = best ? best.index : -1;
    return best;
  }

  scoreLoot(p, best, set) {
    if (p.claimedBy && p.claimedBy !== this.ch && p.claimedBy.alive) return;
    if (p.skipUntil && (p.skipUntil.get(this.ch) ?? 0) > this.m.time) return;
    let w = 0;
    let index = -1;
    if (p.crate) {
      p.items.forEach((it, i) => {
        const s = this.want(it.id);
        if (s > w) {
          w = s;
          index = i;
        }
      });
    } else w = this.want(p.id);
    if (w <= 0) return;
    const d = Math.hypot(p.x - this.ch.body.x, p.z - this.ch.body.z) + Math.abs(p.y - this.ch.body.y) * 3;
    const s = w - d * 0.9;
    if (!best || s > best.score) set({ p, score: s, index });
  }

  // ------------------------------------------------------------------ per-frame

  update(dt) {
    const ch = this.ch;
    const c = ch.ctrl;
    c.jump = c.crouch = c.prone = c.reload = c.interact = c.firePressed = c.fireMode = c.holster = false;
    c.select = -1;
    c.selectCycle = 0;
    c.use = null;
    c.fire = false;
    c.deploy = false;
    if (!ch.alive) return;
    const [rp, ry] = this.m.weapons.takeRecoil(ch);
    this.aimPitch += rp * (1 - this.skill * 0.6);
    this.aimYaw += ry;
    if (ch.mode === "plane") return this.planeUpdate(dt);
    if (ch.mode === "freefall" || ch.mode === "chute") return this.dropUpdate(dt);
    if (ch.mode !== "ground") return;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.far ? 0.45 : 0.18 + this.rng.next() * 0.06;
      this.think();
    }
    this.moveDir.x = 0;
    this.moveDir.z = 0;
    this.wantSprint = false;
    c.ads = false;
    let wantsMove = false;
    switch (this.goal) {
      case "engage":
        wantsMove = this.doEngage(dt);
        break;
      case "cover":
        wantsMove = this.doCover(dt);
        break;
      case "flee":
        wantsMove = this.doFlee(dt);
        break;
      case "heal":
        wantsMove = this.doHeal(dt);
        break;
      case "zone":
        wantsMove = this.doZone(dt);
        break;
      case "loot":
        wantsMove = this.doLoot(dt);
        break;
      case "investigate":
        wantsMove = this.doInvestigate(dt);
        break;
      case "airdrop":
        wantsMove = this.doAirdrop(dt);
        break;
      case "grenade":
        wantsMove = this.doGrenade(dt);
        break;
      default:
        wantsMove = this.doRoam(dt);
    }
    if (this.goal !== "engage" && this.goal !== "cover" && this.goal !== "grenade") this.faceMove(dt);
    // convert the world move direction to local controls
    const yaw = c.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    c.mz = this.moveDir.x * fx + this.moveDir.z * fz;
    c.mx = this.moveDir.x * rx + this.moveDir.z * rz;
    c.sprint = this.wantSprint;
    this.checkStuck(dt, wantsMove);
    // keep a loaded weapon when idle
    const w = ch.loadout.current();
    if (!this.enemy && w && WEAPONS[w.id] && WEAPONS[w.id].ammo && w.mag < magSize(w) * 0.5 && !ch.action)
      c.reload = true;
    if (!w && !ch.action) {
      const s = this.bestSlot(60);
      if (s >= 0) c.select = s;
    }
  }

  doEngage(dt) {
    const ch = this.ch;
    const c = ch.ctrl;
    const t = this.enemy;
    if (!t || !t.alive) return false;
    const e = this.perc.known.get(t);
    if (!e) return false;
    this.trackT += dt;
    const b = ch.body;
    const dist = Math.hypot(t.body.x - b.x, t.body.z - b.z);
    // weapon for the range
    const slot = this.bestSlot(dist);
    if (slot >= 0 && slot !== ch.loadout.active) c.select = slot;
    else if (slot < 0 && ch.loadout.slots[3] && ch.loadout.active !== 3) c.select = 3;
    const w = ch.loadout.current();
    const def = w ? WEAPONS[w.id] : null;
    const aim = this.aimAt(t, dt, e);
    c.ads = dist > 22 && def && def.cls !== "SG" && def.cls !== "MELEE";
    // shooting
    const reaction = 0.22 + (1 - this.skill) * 0.55;
    const canShoot = e.visible && this.m.time - this.seenAt > reaction && def && !ch.action;
    if (w && def && def.ammo && w.mag === 0 && !ch.action) c.reload = true;
    if (canShoot && w && (w.mag > 0 || def.cls === "MELEE")) {
      const tol = Math.max(0.012, 0.9 / Math.max(8, aim.dist)) * (1.6 - this.skill * 0.6);
      if (aim.err < tol * 3) {
        if (w.mode === "auto" && def.cls !== "SR") {
          if (this.burstPause > 0) this.burstPause -= dt;
          else {
            c.fire = true;
            this.burst += dt;
            const burstLen =
              aim.dist < 25 ? 1.2 : aim.dist < 70 ? 0.35 + this.skill * 0.3 : 0.18 + this.skill * 0.15;
            if (this.burst > burstLen) {
              this.burst = 0;
              this.burstPause = 0.15 + (1 - this.skill) * 0.45 + aim.dist * 0.003;
            }
          }
        } else {
          const ws = this.m.weapons.state(ch);
          if (ws.cooldown <= 0 && aim.err < tol) c.firePressed = true;
        }
      }
    }
    // movement: approach, keep distance, strafe
    if (def && def.cls === "MELEE") {
      this.moveTo(t.body.x, t.body.y, t.body.z, dt, true);
      return true;
    }
    const idealMax = def
      ? def.cls === "SR" || def.cls === "DMR"
        ? 400
        : def.cls === "SMG"
          ? 45
          : def.cls === "SG"
            ? 12
            : def.cls === "PISTOL"
              ? 30
              : 130
      : 50;
    const idealMin = def && (def.cls === "SR" || def.cls === "DMR") ? 60 : 0;
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.7 + this.rng.next() * 1.6;
      this.strafeDir = this.rng.chance(0.55) ? -this.strafeDir : this.strafeDir;
      // stance choice while fighting
      const stanceRoll = this.rng.next();
      const want =
        dist > 120 && this.skill > 0.4 && stanceRoll < 0.5
          ? "prone"
          : dist > 35 && stanceRoll < 0.35 + this.skill * 0.25
            ? "crouch"
            : "stand";
      this.wantStance = want;
    }
    this.applyStance(this.wantStance || "stand");
    if (
      !e.visible &&
      ch.inv.count("frag") > 0 &&
      this.m.time - (this.lastThrow ?? -99) > 14 &&
      this.skill > 0.3
    ) {
      const gd = Math.hypot(e.x - b.x, e.z - b.z);
      if (gd > 10 && gd < 32) {
        this.goal = "grenade";
        this.grenadeTarget = { x: e.x, y: e.y, z: e.z };
        this.grenadeT = 0;
        return true;
      }
    }
    if (!e.visible) {
      // push to last known position carefully
      this.moveTo(e.x, e.y, e.z, dt, false);
      return true;
    }
    const dx = t.body.x - b.x;
    const dz = t.body.z - b.z;
    const l = Math.hypot(dx, dz) || 1;
    if (dist > idealMax) {
      this.moveTo(t.body.x, t.body.y, t.body.z, dt, false);
    } else if (dist < idealMin) {
      this.moveDir.x = -dx / l;
      this.moveDir.z = -dz / l;
    } else if (ch.stance !== "prone") {
      const k = this.skill > 0.3 ? 1 : 0.4;
      this.moveDir.x = (-dz / l) * this.strafeDir * k;
      this.moveDir.z = (dx / l) * this.strafeDir * k;
      // don't strafe into walls
      const col = this.m.world.collision;
      if (col.raycast(b.x, b.y + 0.8, b.z, this.moveDir.x, 0, this.moveDir.z, 1.5, 1, _hit, true))
        this.strafeDir *= -1;
    }
    return true;
  }

  applyStance(want) {
    const ch = this.ch;
    const c = ch.ctrl;
    if (ch.stance === want) return;
    if (want === "stand") {
      if (ch.stance === "crouch") c.crouch = true;
      else c.prone = true;
    } else if (want === "crouch") c.crouch = true;
    else c.prone = true;
  }

  doCover(dt) {
    const ch = this.ch;
    const b = ch.body;
    const threat = this.enemy || this.lastKnownEnemy;
    if (!threat) {
      this.goal = "heal";
      return false;
    }
    this.coverT -= dt;
    if (!this.coverPoint || this.coverT <= 0) {
      this.coverPoint = this.findCover(threat);
      this.coverT = 4;
    }
    const cp = this.coverPoint;
    if (cp) {
      const d = this.moveTo(cp.x, cp.y, cp.z, dt, true);
      if (d < 1) {
        this.applyStance("crouch");
        if (this.hasHeal() && !ch.action) this.useBestHeal();
      }
    }
    if (this.enemy) {
      const e = this.perc.known.get(this.enemy);
      if (e) this.aimAt(this.enemy, dt, e);
    } else this.faceMove(dt);
    return !!cp;
  }

  findCover(threat) {
    const b = this.ch.body;
    const col = this.m.world.collision;
    const tx = threat.body.x;
    const ty = threat.body.y + 1.5;
    const tz = threat.body.z;
    let best = null;
    let bs = Infinity;
    for (const r of [3, 6, 10, 15]) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const x = b.x + Math.cos(a) * r;
        const z = b.z + Math.sin(a) * r;
        const y = col.groundAt(x, z, 0.3, b.y + 1.5);
        if (Math.abs(y - b.y) > 2) continue;
        if (col.visible(tx, ty, tz, x, y + 1.0, z, F_VISION)) continue;
        const away = Math.hypot(x - tx, z - tz) - Math.hypot(b.x - tx, b.z - tz);
        const s = r - away * 0.3;
        if (s < bs) {
          bs = s;
          best = { x, y, z };
        }
      }
      if (best) break;
    }
    return best;
  }

  doFlee(dt) {
    const b = this.ch.body;
    const t = this.enemy;
    if (!t) return false;
    // run away, preferring buildings / cover
    const dx = b.x - t.body.x;
    const dz = b.z - t.body.z;
    const l = Math.hypot(dx, dz) || 1;
    this.moveTo(b.x + (dx / l) * 30, b.y, b.z + (dz / l) * 30, dt, true);
    return true;
  }

  useBestHeal() {
    const ch = this.ch;
    const inv = ch.inv;
    const c = ch.ctrl;
    if (ch.health < 55 && inv.count("firstaid") > 0) c.use = "firstaid";
    else if (ch.health < 45 && inv.count("medkit") > 0) c.use = "medkit";
    else if (ch.health < 75 && inv.count("bandage") > 0) c.use = "bandage";
    else if (ch.health < 75 && inv.count("firstaid") > 0) c.use = "firstaid";
    else if (ch.boost < 60 && inv.count("painkiller") > 0) c.use = "painkiller";
    else if (ch.boost < 60 && inv.count("energy") > 0) c.use = "energy";
  }

  doHeal(dt) {
    const ch = this.ch;
    this.applyStance("crouch");
    if (!ch.action) this.useBestHeal();
    return false;
  }

  doZone(dt) {
    const m = this.m;
    const z = m.zone;
    const b = this.ch.body;
    const key = `${z.next.x.toFixed(0)},${z.next.z.toFixed(0)},${z.next.r.toFixed(0)}`;
    if (!this.zonePoint || key !== this.zoneKey) {
      this.zoneKey = key;
      // aim for a random point inside the next circle, biased toward our side
      const dx = b.x - z.next.x;
      const dz = b.z - z.next.z;
      const a = Math.atan2(dz, dx) + (this.rng.next() - 0.5) * 1.2;
      const r = z.next.r * (0.3 + this.rng.next() * 0.45);
      let x = z.next.x + Math.cos(a) * r;
      let zz = z.next.z + Math.sin(a) * r;
      if (!m.world.isLand(x, zz)) {
        x = z.next.x;
        zz = z.next.z;
      }
      this.zonePoint = { x, z: zz, y: m.world.hm.getHeight(x, zz) };
    }
    this.applyStance("stand");
    const d = this.moveTo(this.zonePoint.x, this.zonePoint.y, this.zonePoint.z, dt, true);
    return d > 2;
  }

  doLoot(dt) {
    const ch = this.ch;
    const p = this.lootTarget;
    const m = this.m;
    if (!p || !m.pickups.list.has(p)) {
      this.lootTarget = null;
      this.thinkT = 0;
      return false;
    }
    p.claimedBy = ch;
    this.applyStance("stand");
    const b = ch.body;
    const d = this.moveTo(p.x, p.y, p.z, dt, false);
    if (d < 1.3 && Math.abs(p.y - b.y) < 1.6) {
      if (p.crate) {
        let taken = 0;
        for (let i = p.items.length - 1; i >= 0 && taken < 4; i--) {
          if (this.want(p.items[i].id) > 0 && m.takeFromCrate(ch, p, i)) taken++;
        }
        if (!p.items.length) m.pickups.remove(p);
        p.claimedBy = null;
        p.botDone = p.botDone || new Set();
        p.botDone.add(ch);
      } else m.takePickup(ch, p);
      this.lootTarget = null;
      this.thinkT = 0;
    }
    return true;
  }

  doInvestigate(dt) {
    const t = this.lastKnownEnemy;
    if (!t) return this.doRoam(dt);
    const e = this.perc.known.get(t);
    if (!e) return false;
    this.applyStance(this.skill > 0.5 ? "crouch" : "stand");
    const d = this.moveTo(e.x, e.y, e.z, dt, false);
    if (d < 4) e.aware *= 0.5;
    return true;
  }

  doGrenade(dt) {
    const ch = this.ch;
    const c = ch.ctrl;
    const b = ch.body;
    const t = this.grenadeTarget;
    this.grenadeT += dt;
    if (!t || this.grenadeT > 2.5 || ch.inv.count("frag") <= 0) {
      this.lastThrow = this.m.time;
      this.goal = "engage";
      this.thinkT = 0;
      return false;
    }
    if (ch.loadout.active !== 4) {
      if (!ch.action) c.select = 4;
      return false;
    }
    // aim: yaw toward the target, pitch from the low ballistic arc (launch speed ~19 m/s)
    const dx = t.x - b.x;
    const dz = t.z - b.z;
    const d = Math.hypot(dx, dz);
    const dy = t.y - (b.y + ch.eyeHeight());
    const v = 19;
    const g = 9.81;
    const disc = v ** 4 - g * (g * d * d + 2 * dy * v * v);
    const theta = disc > 0 ? Math.atan((v * v - Math.sqrt(disc)) / (g * d)) : Math.PI / 4;
    this.aimYaw = approach(this.aimYaw, Math.atan2(-dx, -dz), 6 * dt);
    this.aimPitch += (theta - 0.12 - this.aimPitch) * Math.min(1, dt * 8);
    c.yaw = this.aimYaw;
    c.pitch = this.aimPitch;
    ch.aimOrigin.x = b.x;
    ch.aimOrigin.y = b.y + ch.eyeHeight();
    ch.aimOrigin.z = b.z;
    const cp = Math.cos(this.aimPitch);
    ch.aimDir.x = -Math.sin(this.aimYaw) * cp;
    ch.aimDir.y = Math.sin(this.aimPitch);
    ch.aimDir.z = -Math.cos(this.aimYaw) * cp;
    // hold, then release to throw
    if (this.grenadeT < 1.1) c.fire = true;
    else {
      c.fire = false;
      if (!ch.grenadeHold) {
        this.lastThrow = this.m.time;
        this.goal = "engage";
        this.thinkT = 0;
      }
    }
    return false;
  }

  doAirdrop(dt) {
    const m = this.m;
    const a = m.airdrops.find((x) => x.landed && x.crate && m.pickups.list.has(x.crate));
    if (!a) return this.doRoam(dt);
    const p = a.crate;
    const d = this.moveTo(p.x, p.y, p.z, dt, true);
    if (d < 1.5) {
      this.lootTarget = p;
      this.doLoot(dt);
    }
    return true;
  }

  doRoam(dt) {
    const m = this.m;
    const b = this.ch.body;
    const z = m.zone;
    if (
      !this.roamPoint ||
      Math.hypot(this.roamPoint.x - b.x, this.roamPoint.z - b.z) < 3 ||
      this.roamPoint.until < m.time
    ) {
      // wander toward buildings / cover inside the safe area
      const cx = z && z.state !== "idle" ? z.next.x : b.x;
      const cz = z && z.state !== "idle" ? z.next.z : b.z;
      const r = z && z.state !== "idle" ? z.next.r * 0.6 : 120;
      const near = m.buildingIndex.near(cx, cz, Math.max(40, r));
      let x;
      let zz;
      if (near.length && this.rng.chance(0.6)) {
        const bl = this.rng.pick(near);
        const e = bl.nav.nodes[bl.entrances[0] ?? 0];
        x = e ? e.x : (bl.bounds.min[0] + bl.bounds.max[0]) / 2;
        zz = e ? e.z : (bl.bounds.min[2] + bl.bounds.max[2]) / 2;
      } else {
        const a = this.rng.range(0, TAU);
        const rr = Math.sqrt(this.rng.next()) * r;
        x = cx + Math.cos(a) * rr;
        zz = cz + Math.sin(a) * rr;
      }
      if (!m.world.isLand(x, zz)) {
        x = cx;
        zz = cz;
      }
      this.roamPoint = { x, z: zz, y: m.world.hm.getHeight(x, zz), until: m.time + 40 };
      // late game: hold positions more often
      if (z && z.phase >= 3 && this.rng.chance(0.5)) this.holdUntil = m.time + this.rng.range(6, 15);
    }
    if (this.holdUntil && this.holdUntil > m.time) {
      this.applyStance(this.skill > 0.4 ? "crouch" : "stand");
      // scan around
      this.aimYaw += Math.sin(m.time * 0.7 + this.ch.id) * dt * 0.8;
      return false;
    }
    this.applyStance("stand");
    this.moveTo(this.roamPoint.x, this.roamPoint.y, this.roamPoint.z, dt, false);
    return true;
  }
}

const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: "", id: -1, mat: 0 };

// straight walkable line from the body to a waypoint (knee + chest height)
function clearLine(col, b, wp) {
  const dx = wp.x - b.x;
  const dz = wp.z - b.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return true;
  const ux = dx / len;
  const uz = dz / len;
  if (col.raycast(b.x, b.y + 0.55, b.z, ux, 0, uz, len, 1, _hit, true)) return false;
  if (col.raycast(b.x, b.y + 1.3, b.z, ux, 0, uz, len, 1, _hit, true)) return false;
  return true;
}

function direct(b, wp) {
  const dx = wp.x - b.x;
  const dz = wp.z - b.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}
