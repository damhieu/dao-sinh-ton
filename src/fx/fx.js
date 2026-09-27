// Effects hub: particles, tracers, decals and a muzzle-flash light for the local player.
import * as THREE from "three";
import { Particles } from "./particles.js";
import { Tracers } from "./tracers.js";
import { Decals } from "./decals.js";

export class FX {
  constructor(scene) {
    this.particles = new Particles(scene);
    this.tracers = new Tracers(scene);
    this.decals = new Decals(scene);
    this.light = new THREE.PointLight(0xffb866, 0, 9, 2);
    this.light.castShadow = false;
    scene.add(this.light);
    this.lightT = 0;
    this.lightDur = 1;
    this.lightPeak = 0;
  }

  // Short light pulse that fades out. Gunfire stays subtle: a strong on/off light on every shot
  // made the whole screen strobe during automatic fire. Explosions get a bigger, longer flash.
  muzzleLight(x, y, z, isPlayer, explosion = false) {
    if (!isPlayer) return;
    this.light.position.set(x, y, z);
    this.light.distance = explosion ? 22 : 5;
    this.lightPeak = explosion ? 60 : 2.5;
    this.lightDur = explosion ? 0.35 : 0.06;
    this.lightT = this.lightDur;
    this.light.intensity = this.lightPeak;
  }

  clear() {
    this.particles.normal.p.length = 0;
    this.particles.add.p.length = 0;
    this.tracers.list.length = 0;
    this.decals.mesh.count = 0;
    this.decals.next = 0;
  }

  update(dt, camera) {
    this.particles.update(dt);
    this.tracers.update(dt, camera);
    if (this.lightT > 0) {
      this.lightT = Math.max(0, this.lightT - dt);
      const k = this.lightT / this.lightDur;
      this.light.intensity = this.lightPeak * k * k;
    }
  }
}
