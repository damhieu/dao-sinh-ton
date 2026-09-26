// Third/first person camera with collision, ADS zoom, free look, recoil kick and shake.
import * as THREE from "three";
import { F_VISION } from "../world/collision.js";

const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: "", id: -1, mat: 0 };

export function zoomFov(baseFov, zoom) {
  if (zoom <= 1) return baseFov * 0.78;
  const t = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) / zoom;
  return THREE.MathUtils.radToDeg(Math.atan(t) * 2);
}

export class GameCamera {
  constructor(camera, world) {
    this.cam = camera;
    this.world = world;
    this.mode = "tpp"; // tpp | fpp
    this.yaw = 0;
    this.pitch = 0;
    this.baseFov = 80;
    this.fov = 80;
    this.adsBlend = 0;
    this.zoom = 1;
    this.pivot = new THREE.Vector3();
    this.pivotY = null;
    this.dist = 3.0;
    this.curDist = 3.0;
    this.shake = 0;
    this.kickPitch = 0;
    this.orbitDist = 6;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.aimPoint = new THREE.Vector3();
    this.time = 0;
  }

  // Direction for a given yaw/pitch (yaw 0 = -z)
  static dir(yaw, pitch, out) {
    const cp = Math.cos(pitch);
    out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    return out;
  }

  update(dt, ch, opts = {}) {
    this.time += dt;
    const cam = this.cam;
    const b = ch.body;
    const ads = opts.ads ? 1 : 0;
    this.adsBlend += (ads - this.adsBlend) * Math.min(1, dt * 14);
    const pitch = this.pitch + this.kickPitch;
    GameCamera.dir(this.yaw, pitch, this.forward);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.up.crossVectors(this.right, this.forward).normalize();

    // pivot at the head, smoothed vertically (stairs / stance changes)
    const eye = opts.eyeHeight ?? ch.eyeHeight();
    const targetY = b.y + eye;
    if (this.pivotY === null || Math.abs(targetY - this.pivotY) > 3) this.pivotY = targetY;
    this.pivotY += (targetY - this.pivotY) * Math.min(1, dt * 14);
    this.pivot.set(b.x, this.pivotY, b.z);
    // lean moves the view sideways
    const lean = ch.lean || 0;
    this.pivot.addScaledVector(this.right, lean * 0.42);
    this.pivot.y -= Math.abs(lean) * 0.08;

    const mode = opts.orbit ? "orbit" : this.adsBlend > 0.5 || this.mode === "fpp" ? "fpp" : "tpp";
    if (mode === "orbit") {
      // plane / freefall / parachute / vehicle: orbit further back
      const d = opts.orbitDist ?? this.orbitDist;
      cam.position.copy(this.pivot).addScaledVector(this.forward, -d);
      cam.position.y += opts.orbitUp ?? 1.2;
      this.collide(this.pivot, cam.position);
    } else if (mode === "fpp") {
      cam.position.copy(this.pivot).addScaledVector(this.forward, 0.12);
      cam.position.y += 0.02;
    } else {
      this.curDist += (this.dist - this.curDist) * Math.min(1, dt * 8);
      cam.position
        .copy(this.pivot)
        .addScaledVector(this.right, 0.55)
        .addScaledVector(this.up, 0.18)
        .addScaledVector(this.forward, -this.curDist);
      cam.position.y += 0.12;
      this.collide(this.pivot, cam.position);
    }

    // shake
    if (this.shake > 0) {
      const s = this.shake * 0.04;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.rotation.set(pitch, this.yaw, 0, "YXZ");

    // field of view
    const targetFov =
      this.adsBlend > 0.01
        ? THREE.MathUtils.lerp(this.baseFov, zoomFov(this.baseFov, this.zoom), this.adsBlend)
        : this.baseFov;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 18);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.kickPitch *= Math.exp(-dt * 6);
    this.mode3 = mode;
  }

  // pull the camera in front of obstacles between pivot and desired position
  collide(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    const col = this.world.collision;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    // approximate a sphere cast with 5 parallel rays so the camera cannot slip through windows
    let best = len + 0.3;
    const R = 0.28;
    const offs = [
      [0, 0],
      [R, 0],
      [-R, 0],
      [0, R],
      [0, -R],
    ];
    for (const [a, c] of offs) {
      const ox = from.x + this.right.x * a + this.up.x * c;
      const oy = from.y + this.right.y * a + this.up.y * c;
      const oz = from.z + this.right.z * a + this.up.z * c;
      if (col.raycast(ox, oy, oz, ux, uy, uz, best, F_VISION, _hit)) {
        // offset rays that start inside geometry (pivot hugging a wall) are ignored
        if (_hit.t > 0.05 || (a === 0 && c === 0)) best = Math.min(best, _hit.t);
      }
    }
    if (best < len + 0.3) {
      const t = Math.max(0.12, best - 0.3);
      to.set(from.x + ux * t, from.y + uy * t, from.z + uz * t);
    }
  }

  // World point under the crosshair (for aiming in third person)
  computeAimPoint(maxDist = 1000, ignoreChar = null, charTest = null) {
    const cam = this.cam;
    const d = this.forward;
    const col = this.world.collision;
    let t = maxDist;
    if (col.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, maxDist, F_VISION, _hit))
      t = _hit.t;
    if (charTest) {
      const tc = charTest(cam.position, d, t, ignoreChar);
      if (tc >= 0 && tc < t) t = tc;
    }
    // never aim at something between the camera and the character's head
    const minT = this.mode3 === "tpp" ? this.curDist + 0.5 : 0.5;
    t = Math.max(t, minT);
    this.aimPoint.copy(cam.position).addScaledVector(d, t);
    return this.aimPoint;
  }
}
