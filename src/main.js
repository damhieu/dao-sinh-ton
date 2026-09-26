import * as THREE from "three";
import { createRenderer } from "./core/renderer.js";
import { loadAssets } from "./core/assets.js";
import { loadSettings } from "./core/settings.js";
import { Input } from "./core/input.js";
import { events } from "./core/events.js";
import { createWorld } from "./world/world.js";
import { renderMapImage } from "./world/mapimage.js";
import { RigRenderer, MAX_CHARS } from "./actors/rig.js";
import { HeldWeapons } from "./items/heldweapons.js";
import { Pickups } from "./items/pickups.js";
import { renderIcons } from "./items/icons.js";
import { FX } from "./fx/fx.js";
import { HUD } from "./ui/hud.js";
import { InventoryUI } from "./ui/inventoryui.js";
import { Maps } from "./ui/maps.js";
import { ResultScreen } from "./ui/result.js";
import { Match } from "./match/match.js";
import { ITEMS, WEAPONS } from "./items/itemdefs.js";
import { magSize } from "./items/loadout.js";
import { PLAYER_COUNT } from "./config.js";
import { installDebugApi } from "./debug/debugapi.js";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game");
const uiRoot = document.getElementById("ui");
const settings = loadSettings();
const ctx = createRenderer(canvas, settings);
const input = new Input(canvas);
input.captureKeys = true;

const status = document.createElement("div");
status.style.cssText =
  "position:fixed;left:16px;bottom:16px;font:600 14px var(--font-hud);letter-spacing:.06em;color:#fff;text-shadow:0 1px 3px #000";
uiRoot.appendChild(status);

const app = { ctx, settings, input, world: null, match: null, timeScale: 1 };
const fly = { on: false, pos: new THREE.Vector3(0, 320, 900), yaw: 0, pitch: -0.35 };
let fps = 60;
let simTime = 0;
let deathTimer = -1;
const _v = new THREE.Vector3();

async function boot() {
  const report = (p, label) => (status.textContent = `${label} ${Math.round(p * 100)}%`);
  const assets = await loadAssets(ctx.renderer, report);
  app.world = await createWorld(ctx, assets, report);
  app.rig = new RigRenderer(ctx.scene);
  app.held = new HeldWeapons(ctx.scene, MAX_CHARS);
  app.pickups = new Pickups(ctx.scene);
  app.fx = new FX(ctx.scene);
  app.icons = renderIcons(ctx.renderer);
  app.hud = new HUD(uiRoot, app.icons);
  app.maps = new Maps(uiRoot, renderMapImage(app.world), app.world);
  app.inventory = new InventoryUI(uiRoot, app.icons);
  app.spectateLabel = document.createElement("div");
  app.spectateLabel.className = "spectating";
  uiRoot.appendChild(app.spectateLabel);
  app.result = new ResultScreen(uiRoot, {
    restart: () => startMatch(),
    lobby: () => startMatch(),
    spectate: () => {
      app.result.hide();
      input.lock();
    },
  });
  events.on("openCrate", (e) => e.ch.isPlayer && openInventory(e.crate));
  events.on("kill", (e) => {
    if (e.victim === app.match?.player) deathTimer = 2.5;
  });
  events.on("matchEnd", (e) => {
    const m = app.match;
    if (e.winner === m.player) setTimeout(() => showResult(true), 1500);
  });
  if (params.has("sandbox")) startSandbox();
  else startMatch();
  status.textContent = "";
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    tick(dt * app.timeScale);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function resetWorldState() {
  if (app.match) app.match.dispose();
  app.rig.reset();
  app.held.reset();
  app.pickups.clear();
  app.world.doors.reset();
  app.fx.clear();
  app.result.hide();
  app.inventory.toggle(null, false);
  app.maps.toggle(false);
  app.maps.marker = null;
  deathTimer = -1;
}

function startMatch() {
  resetWorldState();
  const m = new Match({ ...app, seed: params.has("seed") ? +params.get("seed") : undefined });
  app.match = m;
  m.createPlayer(settings.name);
  m.spawnLoot();
  const speed = settings.matchSpeed === "fast" ? 0.6 : 1;
  m.startMatch({ bots: +(params.get("bots") ?? PLAYER_COUNT - 1), speed });
}

function startSandbox() {
  resetWorldState();
  const m = new Match(app);
  app.match = m;
  m.state = "sandbox";
  const p = m.createPlayer(settings.name);
  const town = app.world.data.towns.find((t) => t.id === "oldtown");
  p.setPosition(town.x + 3, app.world.hm.getHeight(town.x + 3, town.z) + 0.5, town.z);
  m.spawnLoot();
  const bots = m.createBots(12);
  const rng = m.rng.fork(5);
  bots.forEach((b, i) => {
    const bl = rng.pick(m.buildingIndex.near(town.x, town.z, 140));
    const e = bl.nav.nodes[bl.entrances[0] ?? 0] || { x: town.x + i * 3, z: town.z };
    b.ch.setPosition(e.x, app.world.hm.getHeight(e.x, e.z) + 0.5, e.z);
    b.lootUntil = 150;
  });
}

function showResult(win) {
  const m = app.match;
  const p = m.player;
  input.unlock();
  app.result.show({
    win,
    rank: win ? 1 : p.rank,
    total: m.characters.length,
    stats: p.stats,
    killer: p.killer ? p.killer.name : null,
    name: p.name,
    canSpectate: !win && m.characters.some((c) => c.alive),
  });
}

function openInventory(crate = null) {
  if (!app.match.player.alive) return;
  if (crate) app.inventory.openCrate(app.match, crate);
  else app.inventory.toggle(app.match, true);
  input.unlock();
  app.match.controller.uiOpen = true;
}

function closeOverlays() {
  app.inventory.toggle(app.match, false);
  app.maps.toggle(false);
  app.match.controller.uiOpen = false;
  input.lock();
}

function tick(dt, render = true) {
  simTime += dt;
  const m = app.match;
  const p = m.player;
  // UI toggles
  if (input.pressed("Tab")) app.inventory.open ? closeOverlays() : openInventory();
  if (input.pressed("KeyM")) {
    if (app.maps.open) closeOverlays();
    else {
      app.maps.toggle(true);
      input.unlock();
      m.controller.uiOpen = true;
    }
  }
  if (input.pressed("Escape") && (app.inventory.open || app.maps.open)) closeOverlays();
  if (input.pressed("KeyP") && params.has("debug")) fly.on = !fly.on;
  if (input.pressed("KeyV")) m.gcam.mode = m.gcam.mode === "tpp" ? "fpp" : "tpp";
  if (!p.alive && !app.result.visible && input.btnPressed(1)) m.cycleSpectate();
  if (fly.on) updateFly(dt);
  else m.update(dt);
  if (deathTimer > 0 && (deathTimer -= dt) <= 0) showResult(false);
  const spec = !p.alive && !app.result.visible && m.spectating;
  app.spectateLabel.classList.toggle("on", !!spec);
  if (spec) app.spectateLabel.textContent = `ĐANG THEO DÕI: ${m.spectating.name} · Click để đổi người`;
  app.fx.update(dt, ctx.camera);
  app.hud.update(dt, m);
  app.inventory.update(m);
  app.maps.update(dt, m);
  updateScreenFx(dt, m);
  app.world.update(dt, simTime, ctx.camera.position, ctx.camera.position);
  ctx.updateDynamicRes(dt);
  if (render) ctx.render(simTime);
  input.endFrame();
}

// Low health, damage flash, being outside the zone
let dmgFlash = 0;
events.on("damage", (e) => {
  if (e.target.isPlayer && e.kind !== "zone") dmgFlash = Math.min(1, dmgFlash + e.amount / 35);
});
function updateScreenFx(dt, m) {
  const u = ctx.screenFx.uniforms;
  const p = m.player;
  dmgFlash = Math.max(0, dmgFlash - dt * 2.2);
  u.uDamage.value = dmgFlash;
  u.uLowHealth.value = p.alive ? Math.max(0, (30 - p.health) / 30) : 0;
  const outside =
    p.alive && m.zone && m.zone.state !== "idle" && p.mode !== "plane" && m.zone.outside(p.body.x, p.body.z);
  u.uZone.value += ((outside ? 1 : 0) - u.uZone.value) * Math.min(1, dt * 4);
}

function updateFly(dt) {
  const sp = (input.down("ShiftLeft") ? 120 : 30) * dt;
  if (input.locked) {
    fly.yaw -= input.dx * 0.0022;
    fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch - input.dy * 0.0022));
  }
  const fwd = _v.set(-Math.sin(fly.yaw), 0, -Math.cos(fly.yaw));
  if (input.down("KeyW")) fly.pos.addScaledVector(fwd, sp);
  if (input.down("KeyS")) fly.pos.addScaledVector(fwd, -sp);
  const right = _v.set(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw));
  if (input.down("KeyD")) fly.pos.addScaledVector(right, sp);
  if (input.down("KeyA")) fly.pos.addScaledVector(right, -sp);
  if (input.down("KeyE")) fly.pos.y += sp;
  if (input.down("KeyQ")) fly.pos.y -= sp;
  ctx.camera.position.copy(fly.pos);
  ctx.camera.rotation.set(fly.pitch, fly.yaw, 0, "YXZ");
  app.rig.update(dt, ctx.camera);
}

canvas.addEventListener("click", () => {
  if (!app.result.visible && !app.inventory.open && !app.maps.open) input.lock();
});

installDebugApi({
  app,
  ctx,
  get world() {
    return app.world;
  },
  get match() {
    return app.match;
  },
  get player() {
    return app.match && app.match.player;
  },
  get rig() {
    return app.rig;
  },
  get ready() {
    return !!app.match;
  },
  startMatch,
  startSandbox,
  fly(x, y, z, yaw = fly.yaw, pitch = fly.pitch) {
    fly.on = true;
    fly.pos.set(x, y, z);
    fly.yaw = yaw;
    fly.pitch = pitch;
  },
  lookAt(x, y, z) {
    const d = new THREE.Vector3(x, y, z).sub(fly.pos);
    fly.yaw = Math.atan2(-d.x, -d.z);
    fly.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  },
  play() {
    fly.on = false;
  },
  teleport(x, z, y) {
    const p = app.match.player;
    if (p.mode !== "ground") {
      p.mode = "ground";
      p.chuteOpen = 0;
    }
    p.setPosition(x, y ?? app.world.hm.getHeight(x, z) + 0.5, z);
    p.body.vy = 0;
    fly.on = false;
  },
  look(yaw, pitch = 0) {
    app.match.controller.setView(yaw, pitch);
  },
  key(code, down = true) {
    input.setKey(code, down);
  },
  button(bit, down = true) {
    input.setButton(bit === 1 ? 0 : bit === 4 ? 2 : 1, down);
  },
  mouse(dx, dy) {
    input.locked = true;
    input.dx += dx;
    input.dy += dy;
  },
  give(id, n = 1) {
    const m = app.match;
    const p = m.player;
    const r = m.giveItem(p, id, n);
    if (WEAPONS[id]) {
      const w = p.loadout.slots.find((s) => s && s.id === id);
      if (w) w.mag = magSize(w);
      const ammo = WEAPONS[id].ammo;
      if (ammo) p.inv.add(ammo, ITEMS[ammo].stack * 4);
    }
    return r;
  },
  timescale(s) {
    app.timeScale = s;
  },
  autopilot(on = true) {
    app.match.setAutopilot(on);
  },
  stats() {
    return { fps: Math.round(fps), ...ctx.frameStats, pixelRatio: ctx.renderer.getPixelRatio() };
  },
  setQuality(q) {
    ctx.setQuality(q);
    app.world.applyQuality(ctx.preset);
  },
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) tick(dt, i === n - 1);
  },
  // run game logic for `seconds` without rendering (fast-forward), render the last frame
  simulate(seconds, dt = 1 / 30) {
    const n = Math.round(seconds / dt);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) tick(dt, i === n - 1);
    return +(performance.now() - t0).toFixed(0);
  },
  measure(n = 12) {
    const gl = ctx.renderer.getContext();
    const px = new Uint8Array(4);
    const times = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      ctx.render(simTime);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return +times[n >> 1].toFixed(2);
  },
});

boot().catch((e) => {
  console.error(e);
  status.textContent = "Lỗi: " + e.message;
});
