// Transport plane: procedural model and a straight flight path across the island.
import * as THREE from "three";
import { box, rbox, cyl, sphere, merge, place } from "../core/geo.js";
import { PLANE } from "../config.js";
import { ISLAND_R } from "../world/layout.js";

function planeGeometry() {
  const body = 0x6f7a72;
  const dark = 0x3c423e;
  const parts = [
    // fuselage along -z (nose forward)
    cyl(2.1, 2.1, 22, body, 0, 0, 0, Math.PI / 2, 0, 0, 16),
    cyl(0.6, 2.1, 5, body, 0, 0.1, -13.5, Math.PI / 2, 0, 0, 16),
    sphere(0.65, dark, 0, 0.3, -16, 1, 0.9, 1.2),
    cyl(2.1, 0.7, 8, body, 0, 0.9, 14.8, -Math.PI / 2 + 0.12, 0, 0, 16),
    // wings
    rbox(40, 0.45, 4.2, 0.2, body, 0, 1.9, -2),
    // engines + props
    ...[-13, -7, 7, 13].flatMap((x) => [
      cyl(0.75, 0.9, 3.4, dark, x, 1.3, -3.6, Math.PI / 2, 0, 0, 10),
      cyl(0.35, 0.35, 0.3, 0x222222, x, 1.3, -5.4, Math.PI / 2, 0, 0, 8),
    ]),
    // tail
    rbox(14, 0.3, 3, 0.15, body, 0, 2.2, 17.2),
    rbox(0.35, 7, 4.2, 0.15, body, 0, 5.2, 17.4),
    // windows
    box(0.05, 0.4, 14, 0x1b2226, 2.08, 0.5, -1),
    box(0.05, 0.4, 14, 0x1b2226, -2.08, 0.5, -1),
  ];
  return merge(parts);
}

function propGeometry() {
  return merge([box(0.25, 3.6, 0.08, 0x151515), box(3.6, 0.25, 0.08, 0x151515)]);
}

export class Plane {
  constructor(scene, rng, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4 });
    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(planeGeometry(), mat));
    this.props = [];
    for (const x of [-13, -7, 7, 13]) {
      const p = new THREE.Mesh(propGeometry(), mat);
      p.position.set(x, 1.3, -5.6);
      this.group.add(p);
      this.props.push(p);
    }
    this.group.traverse((o) => (o.castShadow = true));
    scene.add(this.group);
    const a = rng.range(0, Math.PI * 2);
    this.dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const off = rng.range(-300, 300);
    const nx = -this.dir.z;
    const nz = this.dir.x;
    const half = opts.half ?? 1300;
    this.start = new THREE.Vector3(
      nx * off - this.dir.x * half,
      opts.alt ?? PLANE.ALT,
      nz * off - this.dir.z * half,
    );
    this.end = new THREE.Vector3(
      nx * off + this.dir.x * half,
      opts.alt ?? PLANE.ALT,
      nz * off + this.dir.z * half,
    );
    this.length = half * 2;
    this.speed = opts.speed ?? PLANE.SPEED;
    this.pos = this.start.clone();
    this.progress = 0;
    this.overIsland = false;
    this.done = false;
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(-this.dir.x, -this.dir.z);
  }

  update(dt) {
    if (this.done) return;
    this.progress = Math.min(1, this.progress + (this.speed * dt) / this.length);
    this.pos.lerpVectors(this.start, this.end, this.progress);
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(this.progress * 40) * 0.6;
    this.group.rotation.z = Math.sin(this.progress * 17) * 0.02;
    for (const p of this.props) p.rotation.z += dt * 40;
    this.overIsland = Math.hypot(this.pos.x, this.pos.z) < ISLAND_R + 60;
    if (this.progress >= 1) this.done = true;
  }

  // closest point of the flight path to (x, z)
  closestPoint(x, z) {
    const t = Math.max(
      0,
      Math.min(1, ((x - this.start.x) * this.dir.x + (z - this.start.z) * this.dir.z) / this.length),
    );
    return {
      x: this.start.x + this.dir.x * this.length * t,
      z: this.start.z + this.dir.z * this.length * t,
      t,
    };
  }

  remove(scene) {
    scene.remove(this.group);
  }
}
