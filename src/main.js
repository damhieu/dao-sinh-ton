import * as THREE from "three";
import { createRenderer } from "./core/renderer.js";
import { loadAssets } from "./core/assets.js";
import { loadSettings } from "./core/settings.js";
import { Input } from "./core/input.js";
import { RNG } from "./core/rng.js";
import { createWorld } from "./world/world.js";
import { Character } from "./actors/character.js";
import { RigRenderer, makeLook } from "./actors/rig.js";
import { GameCamera } from "./actors/camera.js";
import { PlayerController } from "./actors/player.js";
import { installDebugApi } from "./debug/debugapi.js";

const canvas = document.getElementById("game");
const ui = document.getElementById("ui");
const settings = loadSettings();
const ctx = createRenderer(canvas, settings);
const input = new Input(canvas);

const status = document.createElement("div");
status.style.cssText =
  "position:fixed;left:16px;bottom:16px;font:600 14px var(--font-hud);letter-spacing:.06em;color:#fff;text-shadow:0 1px 3px #000";
ui.appendChild(status);

// Debug fly camera
const fly = { on: false, pos: new THREE.Vector3(0, 320, 900), yaw: 0, pitch: -0.35 };

let world = null;
let rig = null;
let player = null;
let controller = null;
let gcam = null;
let fps = 60;
let simTime = 0;
const _v = new THREE.Vector3();

async function boot() {
  const report = (p, label) => (status.textContent = `${label} ${Math.round(p * 100)}%`);
  const assets = await loadAssets(ctx.renderer, report);
  world = await createWorld(ctx, assets, report);
  rig = new RigRenderer(ctx.scene);
  const rng = new RNG(7);
  player = new Character({ id: 0, name: settings.name, isPlayer: true, look: makeLook(rng) });
  rig.add(player);
  const town = world.data.towns.find((t) => t.id === "oldtown");
  player.setPosition(town.x, world.hm.getHeight(town.x, town.z) + 1, town.z);
  gcam = new GameCamera(ctx.camera, world);
  gcam.baseFov = settings.fov;
  controller = new PlayerController(player, input, gcam, settings);
  // a few idle dummies to look at
  for (let k = 0; k < 4; k++) {
    const d = new Character({ id: k + 1, name: `Bot ${k}`, look: makeLook(rng) });
    rig.add(d);
    const x = town.x + 4 + k * 2.5;
    const z = town.z - 6;
    d.setPosition(x, world.hm.getHeight(x, z), z);
    d.stance = ["stand", "crouch", "prone", "stand"][k];
    if (k === 3) (d.inv.equipArmor("helmet", 2), d.inv.equipArmor("vest", 2), d.inv.equipBackpack(2));
    d.dummy = true;
  }
  status.textContent = "";
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    simTime += dt;
    update(dt, simTime);
    ctx.render(simTime);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
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
}

function update(dt, t) {
  if (input.pressed("KeyP")) fly.on = !fly.on;
  if (fly.on) {
    updateFly(dt);
  } else {
    controller.update(dt);
    if (input.pressed("KeyV")) gcam.mode = gcam.mode === "tpp" ? "fpp" : "tpp";
    player.ads = player.ctrl.ads;
    player.update(dt, world);
    gcam.update(dt, player, { ads: player.ads });
    // aim: character faces the point under the crosshair
    const ap = gcam.computeAimPoint(1000);
    const b = player.body;
    const sy = b.y + player.eyeHeight() - 0.15;
    player.ctrl.pitch = Math.atan2(ap.y - sy, Math.hypot(ap.x - b.x, ap.z - b.z));
  }
  rig.update(dt, ctx.camera);
  world.update(dt, t, fly.on ? ctx.camera.position : player.body);
}

canvas.addEventListener("click", () => input.lock());

installDebugApi({
  ctx,
  get world() {
    return world;
  },
  get player() {
    return player;
  },
  get rig() {
    return rig;
  },
  get cam() {
    return gcam;
  },
  get ready() {
    return !!world;
  },
  fly(x, y, z, yaw = fly.yaw, pitch = fly.pitch) {
    fly.on = true;
    fly.pos.set(x, y, z);
    fly.yaw = yaw;
    fly.pitch = pitch;
  },
  play() {
    fly.on = false;
  },
  teleport(x, z, y) {
    player.setPosition(x, y ?? world.hm.getHeight(x, z) + 0.5, z);
    player.body.vy = 0;
    fly.on = false;
  },
  look(yaw, pitch = 0) {
    controller.setView(yaw, pitch);
  },
  key(code, down = true) {
    input.setKey(code, down);
  },
  mouse(dx, dy) {
    input.locked = true;
    input.dx += dx;
    input.dy += dy;
  },
  stats() {
    return { fps: Math.round(fps), ...ctx.frameStats, pixelRatio: ctx.renderer.getPixelRatio() };
  },
  setQuality(q) {
    ctx.setQuality(q);
  },
  // Advance the game synchronously (works while the tab is hidden and rAF is paused)
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) {
      simTime += dt;
      update(dt, simTime);
      input.endFrame();
    }
    ctx.render(simTime);
  },
  // Median CPU+GPU time (ms) of one full render
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
