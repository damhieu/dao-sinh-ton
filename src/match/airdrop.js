// Care packages: a plane crosses the safe zone and drops a crate under a parachute; red smoke marks it.
import * as THREE from "three";
import { events } from "../core/events.js";
import { Plane } from "./plane.js";
import { airdropGeometry } from "../items/models.js";
import { rollLoot } from "../items/loot.js";

export class AirdropSystem {
  constructor(match) {
    this.m = match;
    this.rng = match.rng.fork(31);
    this.next = 200 + this.rng.range(20, 80);
    this.count = 0;
    this.active = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    this.crateGeo = airdropGeometry();
    this.mat = mat;
    this.chuteMat = new THREE.MeshStandardMaterial({
      color: 0x3b6bd6,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
  }

  pickTarget() {
    const z = this.m.zone;
    for (let i = 0; i < 40; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * z.next.r * 0.8;
      const x = z.next.x + Math.cos(a) * r;
      const zz = z.next.z + Math.sin(a) * r;
      if (
        this.m.world.isLand(x, zz) &&
        this.m.world.hm.slopeAt(x, zz) < 0.3 &&
        !this.m.buildingIndex.at(x, 5, zz, 3)
      )
        return { x, z: zz };
    }
    return { x: z.next.x, z: z.next.z };
  }

  update(dt) {
    const m = this.m;
    if (m.zone && m.zone.state !== "idle" && m.time > this.next && this.count < 3) {
      this.count++;
      this.next = m.time + this.rng.range(140, 200);
      const target = this.pickTarget();
      const plane = new Plane(m.ctx.scene, this.rng.fork(this.count), { alt: 320, speed: 85, half: 1500 });
      // re-aim the flight path so it passes over the target
      const dir = plane.dir;
      plane.start.set(target.x - dir.x * 1500, 320, target.z - dir.z * 1500);
      plane.end.set(target.x + dir.x * 1500, 320, target.z + dir.z * 1500);
      plane.group.scale.setScalar(0.7);
      const drop = {
        plane,
        target,
        dropped: false,
        landed: false,
        crate: null,
        mesh: null,
        x: target.x,
        z: target.z,
        smokeT: 0,
      };
      this.active.push(drop);
      m.airdrops.push(drop);
      events.emit("airdropIncoming", { x: target.x, z: target.z });
    }
    for (const d of this.active) {
      if (d.plane) {
        d.plane.update(dt);
        if (!d.dropped && d.plane.progress >= 0.5) this.release(d);
        if (d.plane.done) {
          d.plane.remove(m.ctx.scene);
          d.plane = null;
        }
      }
      if (d.dropped && !d.landed) {
        d.y -= 8 * dt;
        d.mesh.position.set(d.x, d.y, d.z);
        d.mesh.rotation.y += dt * 0.3;
        const ground = m.world.collision.groundAt(d.x, d.z, 0.8, d.y + 1);
        if (d.y <= ground) this.land(d, ground);
      }
      if (d.landed && d.smokeT > 0) {
        d.smokeT -= dt;
        d.emit = (d.emit || 0) - dt;
        if (d.emit <= 0) {
          d.emit = 0.12;
          m.fx.particles.emit("smokeRed", d.x + 0.9, d.y + 0.6, d.z, 0, 1, 0, 1, 1);
        }
      }
    }
  }

  release(d) {
    d.dropped = true;
    d.y = d.plane.pos.y - 6;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.crateGeo, this.mat));
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.4),
      this.chuteMat,
    );
    canopy.position.y = 7;
    canopy.scale.set(1, 0.55, 1);
    g.add(canopy);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const line = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 7.5, 3),
        new THREE.MeshBasicMaterial({ color: 0x222222 }),
      );
      line.position.set(Math.cos(a) * 1.4, 4.2, Math.sin(a) * 1.4);
      line.rotation.z = Math.cos(a) * 0.35;
      line.rotation.x = -Math.sin(a) * 0.35;
      g.add(line);
    }
    g.traverse((o) => (o.castShadow = true));
    d.mesh = g;
    d.canopy = canopy;
    this.m.ctx.scene.add(g);
    events.emit("airdropDropped", { x: d.x, z: d.z });
  }

  land(d, ground) {
    const m = this.m;
    d.landed = true;
    d.y = ground;
    m.ctx.scene.remove(d.mesh);
    d.mesh = null;
    const items = rollLoot(this.rng, 4);
    d.crate = m.pickups.spawnCrate(d.x, ground, d.z, items, "airdrop");
    d.smokeT = 60;
    events.emit("airdropLanded", { x: d.x, y: ground, z: d.z });
  }

  dispose() {
    for (const d of this.active) {
      if (d.plane) d.plane.remove(this.m.ctx.scene);
      if (d.mesh) this.m.ctx.scene.remove(d.mesh);
    }
  }
}
