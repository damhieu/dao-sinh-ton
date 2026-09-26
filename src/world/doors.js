// Hinged doors: instanced leaves, animated swing, colliders that follow the open/closed state.
import * as THREE from "three";
import { F_ALL, MAT } from "./collision.js";

const THICK = 0.06;

function leafGeometry(w, h) {
  // hinge at local x = 0, leaf extends to +x
  const g = new THREE.BoxGeometry(w, h, THICK);
  g.translate(w / 2, h / 2, 0);
  // UVs in meters/2 so the wood texture keeps its scale
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + pos.getZ(i)) / 2, pos.getY(i) / 2);
  // door knob
  const knob = new THREE.SphereGeometry(0.035, 8, 6);
  knob.translate(w - 0.1, 1.0, THICK / 2 + 0.03);
  const knob2 = knob.clone().translate(0, 0, -THICK - 0.06);
  for (const k of [knob, knob2]) {
    const n = k.attributes.position.count;
    k.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  const merged = new THREE.BufferGeometry();
  // merge manually (same attributes: position, normal, uv)
  const parts = [g.toNonIndexed(), knob.toNonIndexed(), knob2.toNonIndexed()];
  for (const name of ["position", "normal", "uv"]) {
    const size = parts[0].attributes[name].itemSize;
    const total = parts.reduce((s, p) => s + p.attributes[name].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const p of parts) {
      arr.set(p.attributes[name].array, o);
      o += p.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return merged;
}

export class Doors {
  constructor(scene, collision, assets) {
    this.collision = collision;
    this.list = [];
    this.meshes = {};
    this.scene = scene;
    this.assets = assets;
  }

  build(buildings) {
    for (const b of buildings) for (const d of b.doors) this.list.push(this.prepare(d));
    const byMat = { wood: [], metal: [] };
    for (const d of this.list) byMat[d.mat === "metal" ? "metal" : "wood"].push(d);
    for (const [mat, list] of Object.entries(byMat)) {
      if (!list.length) continue;
      const t = this.assets.tex[mat === "metal" ? "metal" : "wood"];
      const material = new THREE.MeshStandardMaterial({
        map: t.map,
        normalMap: t.normalMap,
        roughnessMap: t.armMap,
        roughness: 1,
        metalness: mat === "metal" ? 0.6 : 0,
        color: mat === "metal" ? 0x9aa0a6 : 0xb8987a,
      });
      const mesh = new THREE.InstancedMesh(leafGeometry(1, 2.12), material, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      list.forEach((d, i) => {
        d.mesh = mesh;
        d.instance = i;
      });
      this.meshes[mat] = mesh;
      this.scene.add(mesh);
    }
    for (const d of this.list) {
      d.angle = d.open ? d.openAngle : 0;
      this.writeMatrix(d);
      d.colliderId = this.collision.addBox(
        0,
        0,
        0,
        0.01,
        0.01,
        0.01,
        F_ALL,
        d.mat === "metal" ? MAT.metal : MAT.wood,
      );
      this.updateCollider(d);
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
  }

  prepare(d) {
    // hinge at one end of the opening; the leaf spans along the wall axis when closed
    const half = d.w / 2;
    const along = d.axis === "x" ? [1, 0] : [0, 1];
    const hx = d.x - along[0] * half * d.hinge;
    const hz = d.z - along[1] * half * d.hinge;
    // closed yaw points the leaf from the hinge toward the other jamb
    const dirX = along[0] * d.hinge;
    const dirZ = along[1] * d.hinge;
    const closedYaw = Math.atan2(-dirZ, dirX);
    const swing = d.hinge; // swing side (+/- 90 degrees)
    return {
      ...d,
      hx,
      hz,
      closedYaw,
      openAngle: (swing * Math.PI) / 2,
      target: d.open ? 1 : 0,
      t: d.open ? 1 : 0,
    };
  }

  writeMatrix(d) {
    const m = _m.makeRotationY(d.closedYaw + d.t * d.openAngle);
    m.setPosition(d.hx, d.y, d.hz);
    // scale leaf length to the opening width
    _s.makeScale(d.w, d.h / 2.12, 1);
    m.multiply(_s);
    d.mesh.setMatrixAt(d.instance, m);
  }

  updateCollider(d) {
    const ang = d.closedYaw + d.target * d.openAngle;
    const ex = Math.cos(ang) * d.w;
    const ez = -Math.sin(ang) * d.w;
    const t = THICK / 2 + 0.03;
    const x0 = Math.min(d.hx, d.hx + ex) - (Math.abs(ez) > Math.abs(ex) ? t : 0);
    const x1 = Math.max(d.hx, d.hx + ex) + (Math.abs(ez) > Math.abs(ex) ? t : 0);
    const z0 = Math.min(d.hz, d.hz + ez) - (Math.abs(ex) >= Math.abs(ez) ? t : 0);
    const z1 = Math.max(d.hz, d.hz + ez) + (Math.abs(ex) >= Math.abs(ez) ? t : 0);
    this.collision.setBox(d.colliderId, x0, d.y, z0, x1, d.y + d.h, z1);
  }

  // nearest door within maxDist of (x, y, z); returns index or -1
  nearest(x, y, z, maxDist = 1.8) {
    let best = -1;
    let bd = maxDist * maxDist;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      if (Math.abs(d.y + 1 - y) > 2.2) continue;
      const dx = d.x - x;
      const dz = d.z - z;
      const q = dx * dx + dz * dz;
      if (q < bd) {
        bd = q;
        best = i;
      }
    }
    return best;
  }

  toggle(i) {
    const d = this.list[i];
    d.target = d.target > 0.5 ? 0 : 1;
    this.updateCollider(d);
    this.animating = true;
    return d;
  }

  update(dt) {
    if (!this.animating) return;
    let any = false;
    for (const d of this.list) {
      if (d.t === d.target) continue;
      d.t += Math.sign(d.target - d.t) * dt * 3.2;
      if ((d.target === 1 && d.t > 1) || (d.target === 0 && d.t < 0)) d.t = d.target;
      this.writeMatrix(d);
      d.mesh.instanceMatrix.needsUpdate = true;
      any = true;
    }
    this.animating = any;
  }
}

const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
