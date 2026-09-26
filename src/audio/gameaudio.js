// Connects gameplay events to the procedural audio engine and drives looping ambience / engines.
import { audio } from "./engine.js";
import { events } from "../core/events.js";
import { MAT } from "../world/collision.js";

const MAT_NAME = {
  [MAT.terrain]: "dirt",
  [MAT.wood]: "wood",
  [MAT.metal]: "metal",
  [MAT.concrete]: "concrete",
  [MAT.flesh]: "flesh",
  [MAT.glass]: "glass",
};
const HEAL_SOUND = {
  bandage: "bandage",
  firstaid: "bandage",
  medkit: "bandage",
  energy: "drink",
  painkiller: "pills",
};

export class GameAudio {
  constructor(app) {
    this.app = app;
    this.loops = {};
    this.vehicleLoops = new Map();
    this.smokeLoops = [];
    this.birdT = 5;
    this.started = false;
    const start = () => {
      if (this.started) {
        audio.resume();
        return;
      }
      this.started = true;
      audio.init().then(() => {
        this.applyVolume();
        this.loops.wind = audio.loop("wind_loop", { vol: 0.25 });
        this.loops.ocean = audio.loop("ocean_loop", { vol: 0 });
      });
    };
    addEventListener("pointerdown", start);
    addEventListener("keydown", start);
    this.bind();
  }

  applyVolume() {
    const s = this.app.settings;
    audio.setMasterVolume(s.masterVol);
    audio.setSfxVolume(s.sfxVol);
  }

  near(x, z, r) {
    const c = this.app.ctx.camera.position;
    return (c.x - x) ** 2 + (c.z - z) ** 2 < r * r;
  }

  bind() {
    events.on("shot", (e) => {
      const kind = e.def.sound === "pan" ? null : e.def.sound;
      if (!kind) return;
      audio.gunshot(kind, e.x, e.y, e.z, {
        suppressed: e.suppressed,
        local: e.ch.isPlayer && this.app.match?.gcam.mode3 !== "orbit",
      });
      if ((e.def.cls === "SR" || e.def.cls === "SG") && this.near(e.x, e.z, 40)) {
        audio.play(e.def.cls === "SR" ? "bolt" : "pump", { x: e.x, y: e.y, z: e.z, delay: 0.45, vol: 0.7 });
      }
    });
    events.on("impact", (e) => {
      if (!this.near(e.x, e.z, 120)) return;
      audio.impact(e.water ? "water" : MAT_NAME[e.mat] || "dirt", e.x, e.y, e.z);
    });
    events.on("hit", (e) => {
      if (!this.near(e.x, e.z, 150)) return;
      if (e.helmet) audio.play("helmet_ding", { x: e.x, y: e.y, z: e.z, vol: 0.9 });
      audio.impact("flesh", e.x, e.y, e.z);
      if (e.attacker && e.attacker.isPlayer) audio.ui(e.headshot ? "alert" : "click");
    });
    events.on("whiz", (e) => audio.whiz(e.x, e.y, e.z));
    events.on("reload", (e) => this.chSound(e.ch, "reload_out", 30));
    events.on("reloaded", (e) => this.chSound(e.ch, "reload_in", 30));
    events.on("dryfire", (e) => this.chSound(e.ch, "dry", 15));
    events.on("fireMode", (e) => this.chSound(e.ch, "switch_mode", 10));
    events.on("switch", (e) => this.chSound(e.ch, "equip", 15));
    events.on("pickup", (e) => e.ch.isPlayer && audio.ui("pickup"));
    events.on("door", (e) => {
      const d = e.door;
      if (this.near(d.x, d.z, 40))
        audio.play(e.open ? "door_open" : "door_close", { x: d.x, y: d.y + 1, z: d.z });
    });
    events.on("useStart", (e) => this.chSound(e.ch, HEAL_SOUND[e.item] || "bandage", 20));
    events.on("used", (e) => e.ch.isPlayer && audio.play("heal_done"));
    events.on("jump", (e) => {
      if (!e.ch.isPlayer) return;
      this.loops.freefall = audio.loop("freefall_loop", { vol: 0.8 });
    });
    events.on("chute", (e) => {
      if (!e.ch.isPlayer) return;
      audio.play("chute_open");
      this.stopLoop("freefall");
      this.loops.chute = audio.loop("chute_loop", { vol: 0.5 });
    });
    events.on("land", (e) => {
      if (!e.ch.isPlayer) return;
      this.stopLoop("freefall");
      this.stopLoop("chute");
      audio.play("land");
    });
    events.on("explosion", (e) => audio.explosion(e.x, e.y, e.z));
    events.on("bounce", (e) => this.near(e.x, e.z, 40) && audio.play("bounce", { x: e.x, y: e.y, z: e.z }));
    events.on("throw", (e) => this.near(e.x, e.z, 30) && audio.play("pin", { x: e.x, y: e.y, z: e.z }));
    events.on("smoke", (e) => {
      const h = audio.loop("smoke_hiss", { x: e.x, y: e.y + 0.5, z: e.z, vol: 0.6 });
      this.smokeLoops.push({ h, t: 18 });
    });
    events.on("kill", (e) => {
      if (e.killer && e.killer.isPlayer && !e.victim.isPlayer) audio.play("kill_confirm", { delay: 0.05 });
      if (e.victim.isPlayer) audio.play("death");
    });
    events.on("matchEnd", (e) => {
      if (e.winner && e.winner.isPlayer) audio.play("victory", { delay: 0.8 });
    });
    events.on("zone", (e) => e.state === "shrinking" && audio.play("zone_alarm"));
    events.on("airdropIncoming", () => audio.ui("alert"));
    events.on("vehicleEnter", (e) => this.chSound(e.ch, "car_door", 30));
    events.on("vehicleExit", (e) => this.chSound(e.ch, "car_door", 30));
    events.on(
      "vehicleCrash",
      (e) => this.near(e.x, e.z, 80) && audio.play("car_crash", { x: e.x, y: e.y, z: e.z }),
    );
    events.on("melee", (e) => this.chSound(e.ch, "pan_swing", 20));
    events.on("meleeHit", (e) => audio.play("pan_hit", { x: e.x, y: e.y, z: e.z }));
    events.on("panBlock", (e) => audio.play("pan_hit", { x: e.x, y: e.y, z: e.z, vol: 1.2 }));
    events.on("matchStart", () => this.stopAll());
  }

  chSound(ch, name, range) {
    const b = ch.body;
    if (!this.near(b.x, b.z, range)) return;
    if (ch.isPlayer) audio.play(name);
    else audio.play(name, { x: b.x, y: b.y + 1.2, z: b.z });
  }

  stopLoop(key, fade = 0.4) {
    if (this.loops[key]) {
      this.loops[key].stop(fade);
      this.loops[key] = null;
    }
  }

  stopAll() {
    for (const k of ["freefall", "chute", "plane", "zone"]) this.stopLoop(k, 0.1);
    for (const h of this.vehicleLoops.values()) h.stop(0.1);
    this.vehicleLoops.clear();
  }

  surfaceAt(ch) {
    const m = this.app.match;
    const b = ch.body;
    if (b.inWater) return "water";
    const w = m.world;
    if (m.buildingIndex.at(b.x, b.y, b.z)) return "wood";
    const h = w.hm.getHeight(b.x, b.z);
    if (b.y > h + 0.15) return "hard";
    const mi = Math.floor(((b.x + w.hm.half) / w.hm.size) * w.data.maskRes);
    const mj = Math.floor(((b.z + w.hm.half) / w.hm.size) * w.data.maskRes);
    const road = w.data.masks.road[mj * w.data.maskRes + mi];
    if (road > 100) return "hard";
    if (h < 2.4) return "sand";
    return "grass";
  }

  update(dt) {
    if (!audio.ready) return;
    const m = this.app.match;
    const cam = this.app.ctx.camera;
    const e = cam.matrixWorld.elements;
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, -e[8], -e[9], -e[10], e[4], e[5], e[6]);
    if (!m) return;
    const p = m.player;
    const cp = cam.position;
    // ambience: wind stronger with altitude, ocean near the coast
    if (this.loops.wind) this.loops.wind.setVol(0.18 + Math.min(0.5, Math.max(0, cp.y - 30) / 400));
    if (this.loops.ocean) {
      const hm = m.world.hm;
      let sea = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (hm.getHeight(cp.x + Math.cos(a) * 60, cp.z + Math.sin(a) * 60) < 0) sea++;
      }
      this.loops.ocean.setVol(cp.y < 60 ? (sea / 8) * 0.6 : 0);
    }
    // plane
    if (m.plane && !m.plane.done) {
      if (!this.loops.plane)
        this.loops.plane = audio.loop("plane_loop", {
          x: m.plane.pos.x,
          y: m.plane.pos.y,
          z: m.plane.pos.z,
          vol: 1,
          refDistance: 60,
        });
      this.loops.plane.setPos(m.plane.pos.x, m.plane.pos.y, m.plane.pos.z);
    } else this.stopLoop("plane", 2);
    // outside zone buzz
    const outside =
      p.alive &&
      m.zone &&
      m.zone.state !== "idle" &&
      p.mode === "ground" &&
      m.zone.outside(p.body.x, p.body.z);
    if (outside && !this.loops.zone) this.loops.zone = audio.loop("zone_tick", { vol: 0.35 });
    if (!outside) this.stopLoop("zone", 0.3);
    // vehicle engines (nearby / driven)
    if (m.vehicles) {
      for (const v of m.vehicles.list) {
        const active = v.alive && (v.driver || v.vel.lengthSq() > 1) && this.near(v.pos.x, v.pos.z, 150);
        let h = this.vehicleLoops.get(v);
        if (active && !h) {
          h = audio.loop("engine_loop", { x: v.pos.x, y: v.pos.y, z: v.pos.z, vol: 0.8 });
          this.vehicleLoops.set(v, h);
        } else if (!active && h) {
          h.stop(0.5);
          this.vehicleLoops.delete(v);
          continue;
        }
        if (h) {
          h.setPos(v.pos.x, v.pos.y + 0.8, v.pos.z);
          h.setRate(0.6 + v.rpm * 1.3 + Math.max(0, v.throttle) * 0.15);
        }
      }
    }
    for (const s of this.smokeLoops) if ((s.t -= dt) <= 0) s.h.stop(2);
    this.smokeLoops = this.smokeLoops.filter((s) => s.t > 0);
    // footsteps near the listener
    for (const ch of m.characters) {
      if (!ch.alive || ch.mode !== "ground" || (!ch.body.onGround && !ch.body.inWater)) continue;
      const b = ch.body;
      if (!this.near(b.x, b.z, ch.isPlayer ? 5 : 45)) continue;
      const stride = ch.sprinting ? 1.05 : ch.stance === "crouch" ? 0.7 : ch.stance === "prone" ? 1.2 : 0.8;
      ch.stepAcc = (ch.stepAcc || 0) + ch.moveSpeed * dt;
      if (ch.stepAcc >= stride) {
        ch.stepAcc = 0;
        const vol =
          (ch.stance === "crouch" ? 0.4 : ch.ctrl.walk ? 0.3 : ch.sprinting ? 1 : 0.7) *
          (ch.isPlayer ? 0.55 : 1);
        audio.footstep(this.surfaceAt(ch), b.x, b.y, b.z, vol);
      }
    }
    // birds in the countryside
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 4 + Math.random() * 9;
      if (cp.y < 80 && p.mode === "ground") {
        const a = Math.random() * Math.PI * 2;
        audio.play("bird", { x: cp.x + Math.cos(a) * 30, y: cp.y + 8, z: cp.z + Math.sin(a) * 30, vol: 0.5 });
      }
    }
  }
}
