// Items lying in the world (loot, dropped items, death crates, airdrops) rendered in one BatchedMesh.
import * as THREE from "three";
import { ITEMS } from "./itemdefs.js";
import { groundGeometry, crateGeometry, airdropGeometry } from "./models.js";

const CELL = 8;
const MAX_INSTANCES = 7000;

export class Pickups {
  constructor(scene) {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
    this.batch = new THREE.BatchedMesh(MAX_INSTANCES, 600000, 0, this.material);
    this.batch.castShadow = true;
    this.batch.receiveShadow = true;
    this.batch.perObjectFrustumCulled = true;
    // items are added/removed over time; rely on per-instance culling only
    this.batch.frustumCulled = false;
    scene.add(this.batch);
    this.geoIds = new Map();
    this.grid = new Map();
    this.list = new Set();
    this.uid = 1;
    this.visTimer = 0;
  }

  geoId(key, build) {
    let id = this.geoIds.get(key);
    if (id === undefined) {
      id = this.batch.addGeometry(build());
      this.geoIds.set(key, id);
    }
    return id;
  }

  cellKey(x, z) {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  index(p, add) {
    const k = this.cellKey(p.x, p.z);
    let arr = this.grid.get(k);
    if (add) {
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(p);
    } else if (arr) {
      const i = arr.indexOf(p);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  place(p, geometryId, rotY, tiltZ = 0) {
    p.inst = this.batch.addInstance(geometryId);
    _e.set(0, rotY, tiltZ);
    _q.setFromEuler(_e);
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(1, 1, 1));
    this.batch.setMatrixAt(p.inst, _m);
    this.index(p, true);
    this.list.add(p);
    return p;
  }

  // A single item stack on the ground. extra.weapon keeps a dropped weapon's state (mag, attachments).
  spawn(id, n, x, y, z, extra = {}) {
    if (!ITEMS[id]) throw new Error(`Unknown item ${id}`);
    const p = { uid: this.uid++, id, n, x, y, z, ...extra };
    return this.place(
      p,
      this.geoId(id, () => groundGeometry(id)),
      extra.rot ?? Math.random() * Math.PI * 2,
    );
  }

  // Container with several items (death crate or airdrop)
  spawnCrate(x, y, z, items, kind = "death", owner = null) {
    const geo =
      kind === "airdrop" ? this.geoId("airdrop", airdropGeometry) : this.geoId("crate", crateGeometry);
    const p = { uid: this.uid++, id: kind, crate: true, kind, owner, items, x, y, z };
    return this.place(p, geo, Math.random() * Math.PI * 2);
  }

  move(p, x, y, z) {
    this.index(p, false);
    p.x = x;
    p.y = y;
    p.z = z;
    this.batch.getMatrixAt(p.inst, _m);
    _m.setPosition(x, y, z);
    this.batch.setMatrixAt(p.inst, _m);
    this.index(p, true);
  }

  remove(p) {
    if (!this.list.has(p)) return;
    this.batch.deleteInstance(p.inst);
    this.index(p, false);
    this.list.delete(p);
  }

  // Items within r meters (and roughly the same floor), nearest first
  near(x, y, z, r, out = []) {
    out.length = 0;
    const c0 = Math.floor((x - r) / CELL);
    const c1 = Math.floor((x + r) / CELL);
    const d0 = Math.floor((z - r) / CELL);
    const d1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const arr = this.grid.get(`${i},${j}`);
        if (!arr) continue;
        for (const p of arr) {
          const dy = p.y - y;
          if (dy > 1.9 || dy < -1.2) continue;
          const d = Math.hypot(p.x - x, p.z - z);
          if (d <= r) {
            p._d = d;
            out.push(p);
          }
        }
      }
    }
    out.sort((a, b) => a._d - b._d);
    return out;
  }

  // Hide far-away items (cheap distance culling on top of frustum culling)
  update(dt, camPos) {
    this.visTimer -= dt;
    if (this.visTimer > 0) return;
    this.visTimer = 0.4;
    const maxD2 = 170 * 170;
    for (const p of this.list) {
      const dx = p.x - camPos.x;
      const dz = p.z - camPos.z;
      const vis = p.crate || dx * dx + dz * dz < maxD2;
      if (vis !== p._vis) {
        this.batch.setVisibleAt(p.inst, vis);
        p._vis = vis;
      }
    }
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
