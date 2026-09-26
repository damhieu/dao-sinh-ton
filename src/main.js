import * as THREE from "three";
import { createRenderer } from "./core/renderer.js";
import { loadAssets } from "./core/assets.js";
import { loadSettings, loadStats, saveStats } from "./core/settings.js";
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
import { LoadingScreen, Menus } from "./ui/menu.js";
import { Match } from "./match/match.js";
import { ITEMS, WEAPONS } from "./items/itemdefs.js";
import { magSize } from "./items/loadout.js";
import { PLAYER_COUNT } from "./config.js";
import { installDebugApi } from "./debug/debugapi.js";
import { GameAudio } from "./audio/gameaudio.js";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game");
const uiRoot = document.getElementById("ui");
const settings = loadSettings();
const ctx = createRenderer(canvas, settings);
const input = new Input(canvas);
input.captureKeys = true;
const loading = new LoadingScreen(uiRoot);

const app = { ctx, settings, input, world: null, match: null, timeScale: 1, mode: "loading", paused: false };
const fly = { on: false, pos: new THREE.Vector3(0, 320, 900), yaw: 0, pitch: -0.35 };
let fps = 60;
let simTime = 0;
let deathTimer = -1;
let recorded = false;
const _v = new THREE.Vector3();

async function boot() {
  const report = (p, label) => loading.progress(p, label);
  const assets = await loadAssets(ctx.renderer, (p, l) => report(p * 0.55, l));
  app.world = await createWorld(ctx, assets, (p, l) => report(0.55 + p * 0.4, l));
  report(0.96, "Chuẩn bị trang bị");
  await new Promise((r) => setTimeout(r, 0));
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
  app.audio = new GameAudio(app);
  app.result = new ResultScreen(uiRoot, {
    restart: () => startMatch(),
    lobby: () => startLobby(),
    spectate: () => {
      app.result.hide();
      input.lock();
    },
  });
  app.menus = new Menus(uiRoot, app, {
    play: () => startMatch(),
    training: () => startTraining(),
    resume: () => resume(),
    quit: () => startLobby(),
    applySettings,
  });
  input.onLockChange = (locked) => {
    if (
      !locked &&
      (app.mode === "match" || app.mode === "training") &&
      !app.paused &&
      !overlayOpen() &&
      !app.result.visible
    )
      pause();
  };
  events.on("openCrate", (e) => e.ch.isPlayer && openInventory(e.crate));
  events.on("kill", (e) => {
    if (e.victim === app.match?.player && app.match.state !== "ended") {
      deathTimer = 2.5;
      recordStats(false, e.rank);
    }
  });
  events.on("matchEnd", (e) => {
    const m = app.match;
    if (e.winner === m.player) {
      recordStats(true, 1);
      setTimeout(() => showResult(true), 1500);
    }
  });
  loading.progress(1, "Sẵn sàng");
  if (params.has("sandbox")) startTraining();
  else if (params.has("play")) startMatch();
  else startLobby();
  loading.hide();
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

function overlayOpen() {
  return app.inventory.open || app.maps.open || app.menus.modal.classList.contains("on");
}

function applySettings(name) {
  const s = settings;
  if (name === "quality") {
    ctx.setQuality(s.quality);
    app.world.applyQuality(ctx.preset);
  }
  if (name === "dynamicRes") {
    ctx.dynamicRes = s.dynamicRes;
    if (!s.dynamicRes) {
      ctx.dynamicScale = 1;
      ctx.resize();
    }
  }
  if (name === "fov" && app.match) app.match.gcam.baseFov = s.fov;
  if (name === "masterVol" || name === "sfxVol") app.audio.applyVolume();
}

function recordStats(win, rank) {
  if (recorded || app.mode !== "match") return;
  recorded = true;
  const st = loadStats();
  st.matches++;
  if (win) st.wins++;
  st.kills += app.match.player.stats.kills;
  st.bestRank = st.bestRank ? Math.min(st.bestRank, rank) : rank;
  saveStats(st);
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
  app.menus.hidePause();
  app.menus.hideLobby();
  app.paused = false;
  deathTimer = -1;
  recorded = false;
}

function setHudVisible(on) {
  for (const e of [app.hud.root, app.maps.mini, app.maps.compass]) e.style.display = on ? "" : "none";
  // the lobby camera sits low on a slope: grass blades would fill the view
  for (const g of app.world.grass.meshes) g.visible = on;
}

function startLobby() {
  resetWorldState();
  app.mode = "lobby";
  const m = new Match({ ...app, seed: 7 });
  app.match = m;
  m.state = "lobby";
  const p = m.createPlayer(settings.name);
  // scenic hill looking over Phố Cổ toward the sea
  const town = app.world.data.towns.find((t) => t.id === "oldtown");
  const spot = findLobbySpot(town);
  p.setPosition(spot.x, app.world.hm.getHeight(spot.x, spot.z), spot.z);
  p.yaw = spot.yaw;
  p.ctrl.yaw = spot.yaw;
  m.giveItem(p, "m416", 1);
  m.giveItem(p, "helmet2", 1);
  m.giveItem(p, "vest2", 1);
  m.giveItem(p, "backpack2", 1);
  app.lobbySpot = spot;
  setHudVisible(false);
  input.unlock();
  app.menus.showLobby();
}

function nearTree(x, z, r) {
  const t = app.world.vegetation.trees;
  for (const list of [t.pine, t.broad])
    for (const tr of list) if (Math.abs(tr.x - x) < r && Math.abs(tr.z - z) < r) return true;
  return false;
}

// A flat spot on high ground with a big drop in one direction (a view over the island)
function findLobbySpot(town) {
  const hm = app.world.hm;
  let best = null;
  for (let x = -700; x <= 700; x += 24) {
    for (let z = -700; z <= 700; z += 24) {
      const h = hm.getHeight(x, z);
      if (h < 15 || hm.slopeAt(x, z) > 0.12) continue;
      if (app.match.buildingIndex.at(x, h, z, 8)) continue;
      if (nearTree(x, z, 11)) continue;
      for (let a = 0; a < 8; a++) {
        const dx = Math.cos((a / 8) * Math.PI * 2);
        const dz = Math.sin((a / 8) * Math.PI * 2);
        const drop = h - hm.getHeight(x + dx * 120, z + dz * 120);
        const drop2 = h - hm.getHeight(x + dx * 30, z + dz * 30);
        const toTown = Math.hypot(town.x - x, town.z - z);
        const score = drop + drop2 * 0.5 - toTown * 0.01;
        if (drop > 18 && drop2 > 2 && (!best || score > best.score)) best = { x, z, dx, dz, score };
      }
    }
  }
  if (!best) best = { x: town.x + 60, z: town.z + 60, dx: 1, dz: 0 };
  // character faces uphill (toward the camera); the view drops away behind them
  best.yaw = Math.atan2(best.dx, best.dz);
  return best;
}

function startMatch() {
  resetWorldState();
  app.mode = "match";
  const m = new Match({ ...app, seed: params.has("seed") ? +params.get("seed") : undefined });
  app.match = m;
  m.createPlayer(settings.name);
  m.gcam.baseFov = settings.fov;
  m.spawnLoot();
  const speed = settings.matchSpeed === "fast" ? 0.6 : 1;
  m.startMatch({ bots: +(params.get("bots") ?? PLAYER_COUNT - 1), speed });
  setHudVisible(true);
  input.lock();
}

function startTraining() {
  resetWorldState();
  app.mode = "training";
  const m = new Match(app);
  app.match = m;
  m.state = "sandbox";
  const p = m.createPlayer(settings.name);
  m.gcam.baseFov = settings.fov;
  const town = app.world.data.towns.find((t) => t.id === "military");
  p.setPosition(town.x, app.world.hm.getHeight(town.x, town.z) + 0.5, town.z);
  m.spawnLoot();
  const bots = m.createBots(10);
  const rng = m.rng.fork(5);
  bots.forEach((b, i) => {
    const t = app.world.data.towns[1 + (i % 6)];
    const bl = rng.pick(m.buildingIndex.near(t.x, t.z, 120));
    const e = bl.nav.nodes[bl.entrances[0] ?? 0] || { x: t.x + i * 3, z: t.z };
    b.ch.setPosition(e.x, app.world.hm.getHeight(e.x, e.z) + 0.5, e.z);
    b.lootUntil = 120;
  });
  setHudVisible(true);
  input.lock();
}

function pause() {
  app.paused = true;
  app.menus.showPause();
}

function resume() {
  app.paused = false;
  app.menus.hidePause();
  input.lock();
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
  app.match.controller.uiOpen = true;
  input.unlock();
}

function closeOverlays() {
  app.inventory.toggle(app.match, false);
  app.maps.toggle(false);
  app.match.controller.uiOpen = false;
  input.lock();
}

function lobbyCamera(dt) {
  const m = app.match;
  const p = m.player;
  const s = app.lobbySpot;
  const cam = ctx.camera;
  const t = simTime * 0.12;
  // camera uphill of the character, looking down past them over the landscape
  const sway = Math.sin(t) * 0.35;
  const ux = -s.dx;
  const uz = -s.dz;
  const rx = -uz;
  const rz = ux;
  const dist = 3.8;
  const cx = p.body.x + (ux * Math.cos(sway) - rx * Math.sin(sway)) * dist;
  const cz = p.body.z + (uz * Math.cos(sway) - rz * Math.sin(sway)) * dist;
  cam.position.set(cx, Math.max(p.body.y + 1.75, app.world.hm.getHeight(cx, cz) + 1.5), cz);
  // frame the character on the right third of the screen
  cam.lookAt(p.body.x + rx * 1.25 + s.dx * 2, p.body.y + 1.0, p.body.z + rz * 1.25 + s.dz * 2);
  if (cam.fov !== 55) {
    cam.fov = 55;
    cam.updateProjectionMatrix();
  }
  p.anim.hidden = false;
  app.rig.update(dt, cam);
  app.held.update(m.characters, null);
}

function tick(dt, render = true) {
  simTime += dt;
  const m = app.match;
  const p = m.player;
  if (app.mode === "lobby") {
    lobbyCamera(dt);
  } else {
    // UI toggles
    if (!app.paused) {
      if (input.pressed("Tab")) app.inventory.open ? closeOverlays() : openInventory();
      if (input.pressed("KeyM")) {
        if (app.maps.open) closeOverlays();
        else {
          app.maps.toggle(true);
          m.controller.uiOpen = true;
          input.unlock();
        }
      }
      if (input.pressed("Escape") && (app.inventory.open || app.maps.open)) closeOverlays();
      if (input.pressed("KeyP") && params.has("debug")) fly.on = !fly.on;
      if (input.pressed("KeyV")) m.gcam.mode = m.gcam.mode === "tpp" ? "fpp" : "tpp";
      if (!p.alive && !app.result.visible && input.btnPressed(1)) m.cycleSpectate();
    }
    if (fly.on) updateFly(dt);
    else if (!app.paused) m.update(dt);
    if (deathTimer > 0 && (deathTimer -= dt) <= 0) showResult(false);
    const spec = !p.alive && !app.result.visible && m.spectating;
    app.spectateLabel.classList.toggle("on", !!spec);
    if (spec) app.spectateLabel.textContent = `ĐANG THEO DÕI: ${m.spectating.name} · Click để đổi người`;
    app.hud.update(dt, m);
    app.inventory.update(m);
    app.maps.update(dt, m);
    updateScreenFx(dt, m);
  }
  if (!app.paused) {
    app.fx.update(dt, ctx.camera);
    app.audio.update(dt);
    app.world.update(dt, simTime, ctx.camera.position, ctx.camera.position);
  }
  app.menus.updateFps(Math.round(fps), settings.showFps);
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
  u.uFlash.value = Math.max(0, u.uFlash.value - dt * 1.5);
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
  if (
    (app.mode === "match" || app.mode === "training") &&
    !app.paused &&
    !app.result.visible &&
    !overlayOpen()
  )
    input.lock();
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
  startTraining,
  startLobby,
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
    settings.quality = q;
    applySettings("quality");
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
  loading.progress(0, "Lỗi: " + e.message);
});
