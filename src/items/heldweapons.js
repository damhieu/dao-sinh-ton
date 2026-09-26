// Weapons in characters' hands and slung on their backs, rendered in a single BatchedMesh.
import * as THREE from "three";
import { WEAPONS } from "./itemdefs.js";
import { weaponModel, attachmentGeometry, mountOffset } from "./models.js";

const SLOTS = ["sight", "muzzle", "grip", "mag"];

export class HeldWeapons {
  constructor(scene, maxChars) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
    this.batch = new THREE.BatchedMesh(maxChars * 10, 300000, 0, mat);
    this.batch.castShadow = true;
    this.batch.receiveShadow = true;
    this.batch.perObjectFrustumCulled = false;
    // instances move every frame: the object-level bounding sphere would be stale
    this.batch.frustumCulled = false;
    scene.add(this.batch);
    this.geo = new Map();
    for (const id of Object.keys(WEAPONS)) this.geo.set(id, this.batch.addGeometry(weaponModel(id).geo));
    for (const att of ["reddot", "scope2x", "scope4x", "scope8x", "suppressor", "comp", "extmag", "vgrip"]) {
      this.geo.set(`att_${att}`, this.batch.addGeometry(attachmentGeometry(att)));
    }
    this.slots = new Map(); // character -> instance ids
  }

  ensure(ch) {
    let s = this.slots.get(ch);
    if (!s) {
      const any = this.geo.get("m416");
      s = { hand: [], back: [] };
      for (let k = 0; k < 5; k++) s.hand.push(this.batch.addInstance(any));
      for (let k = 0; k < 5; k++) s.back.push(this.batch.addInstance(any));
      for (const i of [...s.hand, ...s.back]) this.batch.setVisibleAt(i, false);
      this.slots.set(ch, s);
    }
    return s;
  }

  reset() {
    for (const s of this.slots.values()) for (const i of [...s.hand, ...s.back]) this.batch.deleteInstance(i);
    this.slots.clear();
  }

  // write the weapon + attachments at `base` (world matrix of the weapon origin)
  writeSet(ids, w, base) {
    if (!w) {
      for (const i of ids) this.batch.setVisibleAt(i, false);
      return;
    }
    this.batch.setGeometryIdAt(ids[0], this.geo.get(w.id));
    this.batch.setMatrixAt(ids[0], base);
    this.batch.setVisibleAt(ids[0], true);
    for (let k = 0; k < 4; k++) {
      const slot = SLOTS[k];
      const att = w.att[slot];
      const inst = ids[k + 1];
      if (!att) {
        this.batch.setVisibleAt(inst, false);
        continue;
      }
      this.batch.setGeometryIdAt(inst, this.geo.get(`att_${att}`));
      const o = mountOffset(w.id, att, slot);
      _t.makeTranslation(o[0], o[1], o[2]);
      _m.multiplyMatrices(base, _t);
      this.batch.setMatrixAt(inst, _m);
      this.batch.setVisibleAt(inst, true);
    }
  }

  update(characters, hideFor = null) {
    for (const ch of characters) {
      const s = this.ensure(ch);
      const a = ch.anim;
      const visible = a && !a.hidden && ch.poseFrame >= 0 && ch !== hideFor && a.poseVisible;
      const lo = ch.loadout;
      const cur = visible && a.weaponVisible ? lo.current() : null;
      this.writeSet(
        s.hand,
        cur && WEAPONS[cur.id].cls !== "MELEE" ? cur : cur && cur.id === "pan" ? cur : null,
        a.weaponMatrix,
      );
      // one other primary slung across the back
      let back = null;
      if (visible) {
        for (const slot of [0, 1]) {
          const w = lo.slots[slot];
          if (w && w !== cur) {
            back = w;
            break;
          }
        }
      }
      if (back && a.chestMatrix) {
        // sideways against the back, then tilted diagonally (muzzle over the left shoulder)
        _t.makeRotationFromEuler(_e.set(0.0, Math.PI / 2, -0.75, "ZYX"));
        _t.setPosition(0.02, 0.28, 0.2);
        _m.multiplyMatrices(a.chestMatrix, _t);
        this.writeSet(s.back, back, _m);
      } else this.writeSet(s.back, null);
    }
  }
}

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _e = new THREE.Euler();
