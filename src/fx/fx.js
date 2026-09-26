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
  }

  muzzleLight(x, y, z, isPlayer) {
    if (!isPlayer) return;
    this.light.position.set(x, y, z);
    this.light.intensity = 26;
    this.lightT = 0.05;
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
      this.lightT -= dt;
      if (this.lightT <= 0) this.light.intensity = 0;
    }
  }
}
