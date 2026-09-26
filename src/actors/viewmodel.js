// First-person weapon + arms (rendered in its own pass). Hip pose, aim-down-sights alignment,
// bob, sway, recoil kick, reload and sprint animations.
import * as THREE from "three";
import { weaponModel, buildWeaponMesh } from "../items/models.js";
import { WEAPONS, ATTACHMENTS } from "../items/itemdefs.js";
import { limb, rbox, merge } from "../core/geo.js";

// eye-line height of each optic above its mount
const OPTIC_H = { reddot: 0.03, scope2x: 0.036, scope4x: 0.038, scope8x: 0.042 };

export class Viewmodel {
  constructor(ctx, sunDir, envMap) {
    this.ctx = ctx;
    this.scene = ctx.vmScene;
    this.cam = ctx.vmCamera;
    this.root = new THREE.Group();
    this.cam.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x3a3428, 1.0));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
    sun.position.copy(sunDir).multiplyScalar(10);
    this.scene.add(sun);
    this.scene.environment = envMap;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.45 });
    this.armMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    this.key = "";
    this.gun = null;
    this.arms = new THREE.Group();
    this.root.add(this.arms);
    this.time = 0;
    this.pose = new THREE.Vector3(0.17, -0.2, -0.42);
    this.rot = new THREE.Euler(0, 0, 0);
    this.swayX = 0;
    this.swayY = 0;
    this.kick = 0;
    this.visible = false;
  }

  setLook(look) {
    this.arms.clear();
    const sleeve = look.shirt;
    const skin = look.skin;
    this.handR = new THREE.Mesh(
      merge([limb(0.048, 0.3, sleeve), rbox(0.075, 0.1, 0.04, 0.015, skin, 0, -0.36, 0)]),
      this.armMat,
    );
    this.handL = new THREE.Mesh(
      merge([limb(0.046, 0.32, sleeve), rbox(0.075, 0.1, 0.04, 0.015, skin, 0, -0.38, 0)]),
      this.armMat,
    );
    this.arms.add(this.handR, this.handL);
  }

  rebuild(w) {
    if (this.gun) {
      this.root.remove(this.gun);
      this.gun.traverse((o) => o.geometry && o.geometry !== weaponModel(w.id).geo && null);
    }
    this.gun = buildWeaponMesh(w, this.material);
    this.root.add(this.gun);
  }

  update(dt, ch, gc, lookDX, lookDY) {
    this.time += dt;
    const w = ch.loadout.current();
    const def = w ? WEAPONS[w.id] : null;
    const firstPerson = gc.mode === "fpp" || gc.adsBlend > 0.5;
    const scoped = w && w.att.sight && ATTACHMENTS[w.att.sight].zoom >= 4 && gc.adsBlend > 0.85;
    const show =
      firstPerson &&
      ch.alive &&
      ch.mode === "ground" &&
      !!def &&
      def.cls !== "MELEE" &&
      !scoped &&
      !(ch.action && ch.action.type === "use");
    this.ctx.vmActive = show;
    this.visible = show;
    if (!show) return;
    const key = `${w.id}|${w.att.sight}|${w.att.muzzle}|${w.att.grip}|${w.att.mag}`;
    if (key !== this.key) {
      this.key = key;
      this.rebuild(w);
    }
    const mounts = weaponModel(w.id).mounts;
    const sightH = w.att.sight ? mounts.sight[1] + OPTIC_H[w.att.sight] : mounts.sight[1] + 0.018;
    const ads = gc.adsBlend;
    // target pose
    const hip = [0.16, -0.19, -0.42];
    const aim = [0, -sightH, -0.3 - (w.att.sight === "scope2x" ? 0.04 : 0)];
    let px = hip[0] + (aim[0] - hip[0]) * ads;
    let py = hip[1] + (aim[1] - hip[1]) * ads;
    let pz = hip[2] + (aim[2] - hip[2]) * ads;
    let rx = 0;
    let ry = 0.04 * (1 - ads);
    let rz = 0;
    // sprint: lower and rotate
    const spr = ch.sprinting ? 1 : 0;
    this.spr = (this.spr || 0) + (spr - (this.spr || 0)) * Math.min(1, dt * 8);
    px += this.spr * 0.05;
    py -= this.spr * 0.08;
    ry += this.spr * 0.7;
    rx -= this.spr * 0.35;
    // reload: dip and tilt
    if (ch.action && ch.action.type === "reload") {
      const t = Math.sin(Math.min(1, ch.action.t / ch.action.dur) * Math.PI);
      py -= t * 0.08;
      rz += t * 0.5;
      rx += t * 0.25;
    }
    if (ch.action && ch.action.type === "switch") {
      const t = 1 - ch.action.t / ch.action.dur;
      py -= t * 0.3;
    }
    // bob while moving
    const sp = Math.min(1, ch.moveSpeed / 6);
    const bobK = (1 - ads * 0.85) * sp;
    px += Math.sin(this.time * 9) * 0.008 * bobK;
    py += Math.abs(Math.cos(this.time * 9)) * 0.01 * bobK;
    // sway from mouse movement
    this.swayX += (-lookDX * 0.00035 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (-lookDY * 0.00035 - this.swayY) * Math.min(1, dt * 10);
    ry += this.swayX * (1 - ads * 0.7);
    rx += this.swayY * (1 - ads * 0.7);
    // recoil kick
    const kick = ch.anim ? ch.anim.recoil : 0;
    pz += kick * 0.035;
    rx += kick * 0.045 * (def.cls === "SR" || def.cls === "SG" ? 2.5 : 1);
    this.root.position.set(px, py, pz);
    this.root.rotation.set(rx, ry, rz);
    // arms reach the grip and the handguard
    const grip = new THREE.Vector3(0, -0.03, 0.03);
    const guard = new THREE.Vector3(mounts.grip[0], mounts.grip[1] - 0.01, mounts.grip[2]);
    if (def.cls === "PISTOL") guard.set(-0.01, -0.06, 0.04);
    this.placeArm(this.handR, grip, new THREE.Vector3(0.22, -0.32, 0.22));
    this.placeArm(this.handL, guard, new THREE.Vector3(-0.28, -0.35, 0.0));
  }

  // orient an arm capsule (hanging along -Y from its origin) from shoulder -> hand
  placeArm(mesh, hand, shoulder) {
    const dir = hand.clone().sub(shoulder);
    const len = dir.length();
    mesh.position.copy(shoulder);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    mesh.scale.set(1, len / 0.36, 1);
  }
}
