import * as THREE from "three";
import { createRenderer } from "./core/renderer.js";
import { loadAssets } from "./core/assets.js";
import { loadSettings } from "./core/settings.js";
import { Input } from "./core/input.js";
import { createWorld } from "./world/world.js";
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

// Debug fly camera (temporary until the player controller exists)
const fly = { pos: new THREE.Vector3(0, 320, 900), yaw: 0, pitch: -0.35 };

let world = null;
let fps = 60;

async function boot() {
  const assets = await loadAssets(
    ctx.renderer,
    (p, label) => (status.textContent = `${label} ${Math.round(p * 100)}%`),
  );
  world = await createWorld(
    ctx,
    assets,
    (p, label) => (status.textContent = `${label} ${Math.round(p * 100)}%`),
  );
  status.textContent = "";
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    update(dt, now / 1000);
    ctx.render(now / 1000);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function update(dt, t) {
  const sp = (input.down("ShiftLeft") ? 120 : 30) * dt;
  if (input.locked) {
    fly.yaw -= input.dx * 0.0022;
    fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch - input.dy * 0.0022));
  }
  const fwd = new THREE.Vector3(-Math.sin(fly.yaw), 0, -Math.cos(fly.yaw));
  const right = new THREE.Vector3(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw));
  if (input.down("KeyW")) fly.pos.addScaledVector(fwd, sp);
  if (input.down("KeyS")) fly.pos.addScaledVector(fwd, -sp);
  if (input.down("KeyD")) fly.pos.addScaledVector(right, sp);
  if (input.down("KeyA")) fly.pos.addScaledVector(right, -sp);
  if (input.down("KeyE")) fly.pos.y += sp;
  if (input.down("KeyQ")) fly.pos.y -= sp;
  const cam = ctx.camera;
  cam.position.copy(fly.pos);
  cam.rotation.set(fly.pitch, fly.yaw, 0, "YXZ");
  world.update(dt, t, cam.position);
}

canvas.addEventListener("click", () => input.lock());

installDebugApi({
  ctx,
  get world() {
    return world;
  },
  fly(x, y, z, yaw = fly.yaw, pitch = fly.pitch) {
    fly.pos.set(x, y, z);
    fly.yaw = yaw;
    fly.pitch = pitch;
  },
  lookAt(x, y, z) {
    const d = new THREE.Vector3(x, y, z).sub(fly.pos);
    fly.yaw = Math.atan2(-d.x, -d.z);
    fly.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
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
      const t = performance.now();
      ctx.render(simTime);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return +times[n >> 1].toFixed(2);
  },
  get ready() {
    return !!world;
  },
});
let simTime = 0;

boot().catch((e) => {
  console.error(e);
  status.textContent = "Lỗi: " + e.message;
});
