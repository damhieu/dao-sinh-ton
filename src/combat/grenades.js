// Frag and smoke grenades: aiming arc, bouncing physics, explosions and smoke volumes (block vision).
import * as THREE from "three";
import { events } from "../core/events.js";
import { groundGeometry } from "../items/models.js";
import { F_BULLET, F_VISION } from "../world/collision.js";

const G = 9.81;
const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: "", id: -1, mat: 0 };

export class Grenades {
  constructor(match) {
    this.m = match;
    this.list = [];
    this.smokes = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
    this.meshes = {
      frag: new THREE.InstancedMesh(groundGeometry("frag"), mat, 24),
      smoke: new THREE.InstancedMesh(groundGeometry("smoke"), mat, 24),
    };
    for (const im of Object.values(this.meshes)) {
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      match.ctx.scene.add(im);
    }
    // trajectory preview (dotted line)
    const pts = new Float32Array(60 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    this.arc = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 4,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
      }),
    );
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.arc.renderOrder = 10;
    match.ctx.scene.add(this.arc);
  }

  // which throwable the character holds (frag preferred)
  typeFor(ch) {
    const w = ch.loadout.slots[4];
    const want = w && w.id;
    if (want && ch.inv.count(want) > 0) return want;
    if (ch.inv.count("frag") > 0) return "frag";
    if (ch.inv.count("smoke") > 0) return "smoke";
    return null;
  }

  initialVelocity(ch, under) {
    const d = ch.aimDir;
    const speed = under ? 9 : 19;
    const up = under ? 0.25 : 0.12;
    const vx = d.x * speed;
    const vy = (d.y + up) * speed;
    const vz = d.z * speed;
    return [vx, vy, vz];
  }

  throw(ch, under = false) {
    const type = this.typeFor(ch);
    if (!type || ch.inv.remove(type, 1) <= 0) return false;
    const b = ch.body;
    const [vx, vy, vz] = this.initialVelocity(ch, under);
    const o = ch.aimOrigin;
    this.list.push({
      type,
      x: o.x,
      y: o.y - 0.1,
      z: o.z,
      vx,
      vy,
      vz,
      t: 0,
      fuse: type === "frag" ? 4.5 : 2.2,
      owner: ch,
      rest: false,
    });
    if (ch.inv.count(type) <= 0) {
      const other = type === "frag" ? "smoke" : "frag";
      if (ch.inv.count(other) > 0) ch.loadout.slots[4] = { id: other, mag: 0, att: {}, mode: "single" };
      else {
        ch.loadout.slots[4] = null;
        ch.loadout.active = ch.loadout.slots[0] ? 0 : ch.loadout.slots[1] ? 1 : ch.loadout.slots[2] ? 2 : -1;
      }
    }
    events.emit("throw", { ch, type, x: b.x, y: b.y + 1.5, z: b.z });
    return true;
  }

  // per-character input when holding a throwable (player & bots use ctrl.fire)
  control(ch, dt) {
    if (ch.loadout.active !== 4 || !ch.alive || ch.mode !== "ground") {
      if (ch.isPlayer) this.arc.visible = false;
      ch.grenadeHold = false;
      return;
    }
    const c = ch.ctrl;
    if (c.fire) {
      ch.grenadeHold = true;
      ch.grenadeUnder = c.ads;
      if (ch.isPlayer) this.previewArc(ch, ch.grenadeUnder);
    } else if (ch.grenadeHold) {
      ch.grenadeHold = false;
      if (ch.isPlayer) this.arc.visible = false;
      this.throw(ch, ch.grenadeUnder);
    }
  }

  previewArc(ch, under) {
    const [vx0, vy0, vz0] = this.initialVelocity(ch, under);
    const pos = this.arc.geometry.attributes.position.array;
    const o = ch.aimOrigin;
    let x = o.x;
    let y = o.y - 0.1;
    let z = o.z;
    let vx = vx0;
    let vy = vy0;
    let vz = vz0;
    const col = this.m.world.collision;
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const dt = 0.05;
      const nx = x + vx * dt;
      const ny = y + vy * dt - 0.5 * G * dt * dt;
      const nz = z + vz * dt;
      vy -= G * dt;
      const dx = nx - x;
      const dy = ny - y;
      const dz = nz - z;
      const len = Math.hypot(dx, dy, dz);
      pos[n * 3] = x;
      pos[n * 3 + 1] = y;
      pos[n * 3 + 2] = z;
      n++;
      if (col.raycast(x, y, z, dx / len, dy / len, dz / len, len, F_BULLET, _hit)) {
        pos[n * 3] = _hit.x;
        pos[n * 3 + 1] = _hit.y;
        pos[n * 3 + 2] = _hit.z;
        n++;
        break;
      }
      x = nx;
      y = ny;
      z = nz;
    }
    this.arc.geometry.setDrawRange(0, n);
    this.arc.geometry.attributes.position.needsUpdate = true;
    this.arc.visible = true;
  }

  update(dt) {
    const col = this.m.world.collision;
    const keep = [];
    for (const g of this.list) {
      g.t += dt;
      if (!g.rest) {
        const steps = 3;
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
          const nx = g.x + g.vx * h;
          const ny = g.y + g.vy * h - 0.5 * G * h * h;
          const nz = g.z + g.vz * h;
          g.vy -= G * h;
          const dx = nx - g.x;
          const dy = ny - g.y;
          const dz = nz - g.z;
          const len = Math.hypot(dx, dy, dz);
          if (
            len > 1e-5 &&
            col.raycast(g.x, g.y, g.z, dx / len, dy / len, dz / len, len + 0.05, F_BULLET, _hit)
          ) {
            // bounce: reflect and damp
            const vn = g.vx * _hit.nx + g.vy * _hit.ny + g.vz * _hit.nz;
            g.vx = (g.vx - 2 * vn * _hit.nx) * 0.45;
            g.vy = (g.vy - 2 * vn * _hit.ny) * 0.35;
            g.vz = (g.vz - 2 * vn * _hit.nz) * 0.45;
            g.x = _hit.x + _hit.nx * 0.05;
            g.y = _hit.y + _hit.ny * 0.05;
            g.z = _hit.z + _hit.nz * 0.05;
            if (Math.abs(vn) > 2) events.emit("bounce", { x: g.x, y: g.y, z: g.z });
            if (Math.hypot(g.vx, g.vy, g.vz) < 0.6 && _hit.ny > 0.6) g.rest = true;
          } else {
            g.x = nx;
            g.y = ny;
            g.z = nz;
          }
        }
        if (g.y < -2) g.rest = true;
      }
      if (g.t >= g.fuse) {
        if (g.type === "frag") this.explode(g);
        else this.startSmoke(g);
        continue;
      }
      keep.push(g);
    }
    this.list = keep;
    // smoke volumes
    this.smokes = this.smokes.filter((s) => (s.t += dt) < s.life);
    for (const s of this.smokes) {
      s.r = Math.min(7.5, 2 + s.t * 2.2);
      s.emitT -= dt;
      if (s.emitT <= 0 && s.t < s.life - 6) {
        s.emitT = 0.18;
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * s.r * 0.6;
        this.m.fx.particles.emit(
          "smoke",
          s.x + Math.cos(a) * rr,
          s.y + 0.5 + Math.random() * 2,
          s.z + Math.sin(a) * rr,
          0,
          0.2,
          0,
          2,
          1,
        );
      }
    }
    // render
    const counts = { frag: 0, smoke: 0 };
    for (const g of this.list) {
      const im = this.meshes[g.type];
      _m.makeRotationY(g.t * 6);
      _m.setPosition(g.x, g.y - 0.04, g.z);
      im.setMatrixAt(counts[g.type]++, _m);
    }
    for (const [k, im] of Object.entries(this.meshes)) {
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
    }
    // player input
    this.control(this.m.player, dt);
    for (const b of this.m.bots) if (b.ch !== this.m.player) this.control(b.ch, dt);
  }

  explode(g) {
    const m = this.m;
    const col = m.world.collision;
    events.emit("explosion", { x: g.x, y: g.y, z: g.z, owner: g.owner });
    m.fx.particles.emit("explosion", g.x, g.y + 0.3, g.z, 0, 1, 0, 14, 1);
    m.fx.particles.emit("blast", g.x, g.y + 0.3, g.z, 0, 0.6, 0, 10, 1);
    m.fx.particles.emit("dust", g.x, g.y + 0.1, g.z, 0, 1, 0, 14, 2.5);
    m.fx.particles.emit("sparks", g.x, g.y + 0.3, g.z, 0, 1, 0, 20, 1.5);
    m.fx.muzzleLight(g.x, g.y + 1, g.z, true);
    m.fx.light.intensity = 160;
    m.fx.light.distance = 25;
    m.fx.lightT = 0.12;
    for (const ch of m.characters) {
      if (!ch.alive || ch.mode === "plane") continue;
      const b = ch.body;
      const d = Math.hypot(b.x - g.x, b.y + 0.9 - g.y, b.z - g.z);
      if (d > 8) continue;
      let dmg = 100 * Math.pow(1 - d / 8, 1.3);
      if (!col.visible(g.x, g.y + 0.3, g.z, b.x, b.y + 1.0, b.z, F_BULLET)) dmg *= 0.25;
      if (ch.inv.vest) dmg *= 0.85;
      m.damage(ch, dmg, {
        attacker: g.owner,
        kind: "explosion",
        dirX: g.x - b.x,
        dirZ: g.z - b.z,
        weapon: { name: "Lựu đạn" },
      });
    }
    const p = m.player;
    const dp = Math.hypot(p.body.x - g.x, p.body.z - g.z);
    if (dp < 30) m.gcam.shake = Math.max(m.gcam.shake, 1.5 * (1 - dp / 30));
    if (dp < 10) m.ctx.screenFx.uniforms.uFlash.value = 0.6 * (1 - dp / 10);
    if (m.vehicles) m.vehicles.blast(g.x, g.y, g.z, 8, 300);
  }

  startSmoke(g) {
    events.emit("smoke", { x: g.x, y: g.y, z: g.z });
    this.smokes.push({ x: g.x, y: g.y, z: g.z, r: 1, t: 0, life: 26, emitT: 0 });
  }

  // true if the segment passes through an active smoke cloud
  blocks(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      if (s.t > s.life - 3) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const l2 = dx * dx + dy * dy + dz * dz;
      let t = l2 > 0 ? ((s.x - ax) * dx + (s.y + 1.5 - ay) * dy + (s.z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - s.x;
      const py = ay + dy * t - (s.y + 1.5);
      const pz = az + dz * t - s.z;
      if (px * px + py * py * 0.5 + pz * pz < s.r * s.r) return true;
    }
    return false;
  }

  dispose() {
    for (const im of Object.values(this.meshes)) this.m.ctx.scene.remove(im);
    this.m.ctx.scene.remove(this.arc);
  }
}

const _m = new THREE.Matrix4();
