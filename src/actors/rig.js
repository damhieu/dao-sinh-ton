// Procedural humanoid characters rendered with one InstancedMesh per body part (shared by all
// characters), animated procedurally (locomotion, stances, aiming IK, freefall, parachute, death).
import * as THREE from "three";
import { box, rbox, cyl, sphere, dome, limb, merge, place, prep } from "../core/geo.js";
import { solveTwoBone } from "./ik.js";
import { WEAPONS } from "../items/itemdefs.js";

export const MAX_CHARS = 64;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;
const THIGH = 0.45;
const SHIN = 0.44;

const SKIN_TONES = [0xe7c3a4, 0xd9a882, 0xc68c64, 0xa56d49, 0x7a4b2f, 0xf0cfb4];
const HAIR = [0x1b1612, 0x2e2119, 0x4a3322, 0x6b4a2b, 0x151515, 0x8a6a45];
const SHIRTS = [
  0x4f5a3c, 0x6d6450, 0x2f3338, 0x3d4a5c, 0x7a3b2e, 0x8c8474, 0x5b6b4a, 0x1f2a36, 0xa39a82, 0x49413a,
];
const PANTS = [0x2d3a4f, 0x3a3d33, 0x55503f, 0x23262b, 0x4b4f3b, 0x6b604b, 0x394552];
const CAPS = [0x2b3a55, 0x8b2a2a, 0x3d4a2e, 0x1d1d1d, 0xb59b6a];

export function makeLook(rng) {
  return {
    skin: rng.pick(SKIN_TONES),
    hair: rng.pick(HAIR),
    headwear: rng.chance(0.3) ? "cap" : "hair",
    capColor: rng.pick(CAPS),
    shirt: rng.pick(SHIRTS),
    pants: rng.pick(PANTS),
  };
}

// ---------------------------------------------------------------- part geometry

function buildHead() {
  const skin = 0xffffff; // tinted per instance
  return merge([
    sphere(0.105, skin, 0, 0.11, 0, 0.93, 1.12, 1.0, 16, 12),
    // jaw
    sphere(0.08, skin, 0, 0.05, -0.02, 1.0, 0.8, 1.0, 12, 8),
    // nose
    box(0.024, 0.04, 0.03, skin, 0, 0.1, -0.105, -0.2),
    // ears
    sphere(0.025, skin, -0.1, 0.11, 0.005, 0.5, 1.0, 0.8, 8, 6),
    sphere(0.025, skin, 0.1, 0.11, 0.005, 0.5, 1.0, 0.8, 8, 6),
    // eyes (dark)
    sphere(0.012, 0x222222, -0.035, 0.125, -0.092, 1, 0.7, 0.6, 6, 4),
    sphere(0.012, 0x222222, 0.035, 0.125, -0.092, 1, 0.7, 0.6, 6, 4),
  ]);
}

function buildHair() {
  return merge([dome(0.112, 0xffffff, Math.PI * 0.52, 0, 0.12, 0.01, 0.95, 1.1, 1.05)]);
}

function buildCap() {
  return merge([
    dome(0.115, 0xffffff, Math.PI * 0.5, 0, 0.14, 0.005, 0.96, 0.95, 1.04),
    cyl(0.09, 0.09, 0.012, 0xffffff, 0, 0.145, -0.1, 0, 0, 0, 16).scale(1, 1, 0.7),
  ]);
}

function buildHelmet(level) {
  if (level === 1) {
    // motorcycle-style open helmet
    return merge([
      dome(0.128, 0xb33a2a, Math.PI * 0.58, 0, 0.115, 0, 0.98, 1.05, 1.08),
      box(0.2, 0.025, 0.02, 0x222222, 0, 0.18, -0.13),
    ]);
  }
  if (level === 2) {
    // military helmet with rim
    return merge([
      dome(0.132, 0x4d5638, Math.PI * 0.55, 0, 0.12, 0, 1, 0.98, 1.08),
      cyl(0.14, 0.145, 0.018, 0x444b31, 0, 0.125, 0, 0, 0, 0, 18).scale(1, 1, 1.1),
      box(0.03, 0.05, 0.02, 0x2b2b2b, -0.11, 0.11, -0.03),
      box(0.03, 0.05, 0.02, 0x2b2b2b, 0.11, 0.11, -0.03),
    ]);
  }
  // spetsnaz-style heavy helmet with visor
  return merge([
    dome(0.14, 0x2f3431, Math.PI * 0.62, 0, 0.11, 0.005, 1, 1.02, 1.08),
    box(0.19, 0.075, 0.03, 0x14181a, 0, 0.12, -0.135, -0.15),
    box(0.04, 0.12, 0.2, 0x262a28, -0.13, 0.08, 0.01),
    box(0.04, 0.12, 0.2, 0x262a28, 0.13, 0.08, 0.01),
  ]);
}

function buildTorso() {
  return merge([
    rbox(0.39, 0.3, 0.25, 0.08, 0xffffff, 0, 0.3, 0),
    rbox(0.35, 0.22, 0.23, 0.08, 0xffffff, 0, 0.12, 0),
    // shoulders
    sphere(0.07, 0xffffff, -0.17, 0.4, 0, 1.1, 0.9, 1.1),
    sphere(0.07, 0xffffff, 0.17, 0.4, 0, 1.1, 0.9, 1.1),
    // collar (slightly darker)
    cyl(0.07, 0.075, 0.04, 0xcccccc, 0, 0.455, 0),
  ]);
}

function buildVest(level) {
  const c = level === 1 ? 0x27324a : level === 2 ? 0x55603f : 0x1f2322;
  const p = level === 1 ? 0x1f283b : level === 2 ? 0x46502f : 0x161919;
  const parts = [rbox(0.4, 0.34, 0.27, 0.05, c, 0, 0.27, -0.002)];
  if (level >= 2) {
    for (let i = -1; i <= 1; i++) parts.push(rbox(0.09, 0.1, 0.05, 0.015, p, i * 0.1, 0.2, -0.15));
    parts.push(rbox(0.3, 0.05, 0.02, 0.01, p, 0, 0.36, -0.14));
  }
  if (level === 3) {
    parts.push(rbox(0.3, 0.07, 0.25, 0.03, c, 0, 0.44, 0.0));
    parts.push(rbox(0.12, 0.16, 0.05, 0.02, p, -0.14, 0.24, 0.14));
    parts.push(rbox(0.12, 0.16, 0.05, 0.02, p, 0.14, 0.24, 0.14));
  }
  return merge(parts);
}

function buildPack(level) {
  const c = level === 1 ? 0x5b5540 : level === 2 ? 0x4a5236 : 0x3b4030;
  const d = level === 1 ? 0x48432f : level === 2 ? 0x3a4129 : 0x2c3024;
  const w = 0.28 + level * 0.03;
  const h = 0.3 + level * 0.09;
  const dp = 0.12 + level * 0.03;
  const y = 0.3 - level * 0.02;
  const parts = [
    rbox(w, h, dp, 0.04, c, 0, y, 0.12 + dp / 2),
    rbox(w * 0.8, h * 0.35, 0.05, 0.02, d, 0, y - h * 0.18, 0.12 + dp + 0.02),
    box(0.04, h * 0.9, 0.02, d, -w * 0.3, y, 0.115),
    box(0.04, h * 0.9, 0.02, d, w * 0.3, y, 0.115),
  ];
  if (level === 3)
    parts.push(cyl(0.06, 0.06, w * 1.05, 0x6a5f45, 0, y + h / 2 + 0.05, 0.12 + dp / 2, 0, 0, Math.PI / 2));
  return merge(parts);
}

function buildBoot() {
  return merge([
    rbox(0.1, 0.11, 0.25, 0.03, 0x2a241d, 0, -0.035, -0.05),
    box(0.105, 0.025, 0.26, 0x16120f, 0, -0.085, -0.05),
  ]);
}

function buildHand() {
  return merge([
    rbox(0.07, 0.1, 0.035, 0.015, 0xffffff, 0, -0.05, 0),
    rbox(0.025, 0.06, 0.03, 0.01, 0xffffff, 0.04, -0.03, -0.01, 0, 0, 0.5),
  ]);
}

function buildChute() {
  // canopy: striped dome + suspension lines, attached at the pelvis
  const canopy = new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, Math.PI * 0.36);
  const g = prep(canopy, 0xffffff);
  const pos = g.attributes.position;
  const col = g.attributes.color;
  const a = new THREE.Color(0xd9661f);
  const b = new THREE.Color(0xf2efe6);
  for (let i = 0; i < pos.count; i++) {
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const stripe = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 10) % 2;
    const c = stripe ? a : b;
    col.setXYZ(i, c.r, c.g, c.b);
  }
  place(g, 0, 3.2, 0, 0, 0, 0, 3.4, 1.4, 2.4);
  const lines = [];
  const rimY = 3.2 + Math.cos(Math.PI * 0.36) * 1.4;
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const rx = Math.cos(ang) * Math.sin(Math.PI * 0.36) * 3.4;
    const rz = Math.sin(ang) * Math.sin(Math.PI * 0.36) * 2.4;
    const sx = Math.sign(rx) * 0.18;
    const from = new THREE.Vector3(sx, 0.55, 0);
    const to = new THREE.Vector3(rx, rimY, rz);
    const len = from.distanceTo(to);
    const line = prep(new THREE.CylinderGeometry(0.008, 0.008, len, 3), 0x333333);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    line.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    lines.push(line);
  }
  return merge([g, ...lines]);
}

// ---------------------------------------------------------------- renderer

const PARTS = [
  // name, geometry, material key, instances per character
  ["pelvis", () => rbox(0.36, 0.22, 0.24, 0.08, 0xffffff), "cloth", 1],
  ["torso", buildTorso, "cloth", 1],
  ["neck", () => cyl(0.05, 0.056, 0.12, 0xffffff, 0, 0.47, 0), "skin", 1],
  ["head", buildHead, "skin", 1],
  ["hair", buildHair, "cloth", 1],
  ["cap", buildCap, "cloth", 1],
  ["helmet1", () => buildHelmet(1), "gear", 1],
  ["helmet2", () => buildHelmet(2), "gear", 1],
  ["helmet3", () => buildHelmet(3), "gear", 1],
  ["uArm", () => limb(0.063, UPPER_ARM - 0.02, 0xffffff), "cloth", 2],
  ["fArm", () => limb(0.052, FOREARM - 0.02, 0xffffff), "cloth", 2],
  ["hand", buildHand, "skin", 2],
  ["thigh", () => limb(0.09, THIGH - 0.03, 0xffffff), "cloth", 2],
  ["shin", () => limb(0.07, SHIN - 0.03, 0xffffff), "cloth", 2],
  ["boot", buildBoot, "gear", 2],
  ["vest1", () => buildVest(1), "gear", 1],
  ["vest2", () => buildVest(2), "gear", 1],
  ["vest3", () => buildVest(3), "gear", 1],
  ["pack1", () => buildPack(1), "gear", 1],
  ["pack2", () => buildPack(2), "gear", 1],
  ["pack3", () => buildPack(3), "gear", 1],
  ["chute", buildChute, "chute", 1],
];

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// scratch
const mRoot = new THREE.Matrix4();
const mPelvis = new THREE.Matrix4();
const mChest = new THREE.Matrix4();
const mHead = new THREE.Matrix4();
const mTmp = new THREE.Matrix4();
const mTmp2 = new THREE.Matrix4();
const mSeg = new THREE.Matrix4();
const mWeapon = new THREE.Matrix4();
const mThigh = new THREE.Matrix4();
const mShin = new THREE.Matrix4();
const mFoot = new THREE.Matrix4();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const vX = new THREE.Vector3();
const vY = new THREE.Vector3();
const vZ = new THREE.Vector3();
const vHint = new THREE.Vector3();
const vShoulder = new THREE.Vector3();
const vTarget = new THREE.Vector3();
const vElbow = new THREE.Vector3();
const vWrist = new THREE.Vector3();
const vPole = new THREE.Vector3();
const eul = new THREE.Euler();
const quat = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);

// out = parent * T(x,y,z) * R(euler rx,ry,rz order)
function child(out, parent, x, y, z, rx, ry, rz, order = "XYZ") {
  eul.set(rx, ry, rz, order);
  quat.setFromEuler(eul);
  mTmp.compose(vA.set(x, y, z), quat, one);
  return out.multiplyMatrices(parent, mTmp);
}

// Frame at A whose -Y axis points to B (limb segment), with X derived from a hint direction
function segment(out, A, B, hint) {
  vY.subVectors(A, B).normalize();
  vX.crossVectors(hint, vY);
  if (vX.lengthSq() < 1e-6) vX.set(1, 0, 0).cross(vY);
  vX.normalize();
  vZ.crossVectors(vX, vY);
  out.makeBasis(vX, vY, vZ);
  out.setPosition(A);
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

export class RigRenderer {
  constructor(scene) {
    this.scene = scene;
    this.chars = [];
    this.meshes = {};
    this.frame = 0;
    const mats = {
      skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
      cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
      gear: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 }),
      chute: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    };
    for (const [name, build, matKey, per] of PARTS) {
      const mesh = new THREE.InstancedMesh(build(), mats[matKey], MAX_CHARS * per);
      mesh.name = `rig_${name}`;
      mesh.castShadow = name !== "chute" || true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      for (let i = 0; i < MAX_CHARS * per; i++) {
        mesh.setMatrixAt(i, ZERO);
        mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      }
      mesh.userData.per = per;
      this.meshes[name] = mesh;
      scene.add(mesh);
    }
  }

  add(ch) {
    const slot = this.chars.length;
    if (slot >= MAX_CHARS) throw new Error("Too many characters");
    this.chars.push(ch);
    ch.rigSlot = slot;
    ch.hitboxes = new Float32Array(11 * 7);
    ch.poseFrame = -1;
    ch.anim = {
      crouch: 0,
      prone: 0,
      dead: 0,
      deadSide: Math.random() < 0.5 ? 1 : -1,
      freefall: 0,
      chute: 0,
      sit: 0,
      aim: 0,
      sprint: 0,
      phase: 0,
      speed: 0,
      yawBody: ch.yaw,
      lastWalked: ch.walked,
      moveAngle: 0,
      weaponMatrix: new THREE.Matrix4(),
      weaponVisible: false,
      recoil: 0,
      hidden: false,
    };
    const L = ch.look;
    const setC = (name, color, k = 0) => {
      const m = this.meshes[name];
      m.setColorAt(slot * m.userData.per + k, _col.set(color));
      m.instanceColor.needsUpdate = true;
    };
    setC("pelvis", L.pants);
    setC("thigh", L.pants, 0);
    setC("thigh", L.pants, 1);
    setC("shin", L.pants, 0);
    setC("shin", L.pants, 1);
    setC("torso", L.shirt);
    setC("uArm", L.shirt, 0);
    setC("uArm", L.shirt, 1);
    setC("fArm", L.shirt, 0);
    setC("fArm", L.shirt, 1);
    setC("neck", L.skin);
    setC("head", L.skin);
    setC("hand", L.skin, 0);
    setC("hand", L.skin, 1);
    setC("hair", L.hair);
    setC("cap", L.capColor);
    for (const name of Object.keys(this.meshes)) {
      const m = this.meshes[name];
      m.count = Math.max(m.count, (slot + 1) * m.userData.per);
    }
    return slot;
  }

  // Smoothly track gameplay state for animation
  updateAnim(ch, dt) {
    const a = ch.anim;
    const k = Math.min(1, dt * 9);
    a.crouch += ((ch.stance === "crouch" ? 1 : 0) - a.crouch) * k;
    a.prone += ((ch.stance === "prone" ? 1 : 0) - a.prone) * Math.min(1, dt * 5);
    a.freefall += ((ch.mode === "freefall" ? 1 : 0) - a.freefall) * Math.min(1, dt * 4);
    a.chute += ((ch.mode === "chute" ? 1 : 0) - a.chute) * Math.min(1, dt * 4);
    a.sit += ((ch.mode === "vehicle" ? 1 : 0) - a.sit) * Math.min(1, dt * 8);
    if (!ch.alive) a.dead = Math.min(1, a.dead + dt * 1.8);
    else a.dead = 0;
    const aiming = ch.ads || ch.firingTime > 0;
    a.aim += ((aiming ? 1 : 0) - a.aim) * Math.min(1, dt * 12);
    a.sprint += ((ch.sprinting ? 1 : 0) - a.sprint) * Math.min(1, dt * 7);
    const dWalk = ch.walked - a.lastWalked;
    a.lastWalked = ch.walked;
    const stride = lerp(lerp(1.55, 2.25, a.sprint), 1.05, Math.max(a.crouch, a.prone));
    a.phase = (a.phase + (dWalk / stride) * Math.PI * 2) % (Math.PI * 200);
    a.speed += (Math.min(ch.moveSpeed, 7) - a.speed) * Math.min(1, dt * 8);
    // body yaw follows aim yaw
    let dy = ch.yaw - a.yawBody;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    a.yawBody += dy * Math.min(1, dt * 14);
    // local move direction (for strafing legs)
    const b = ch.body;
    const lx = b.vx * Math.cos(a.yawBody) - b.vz * Math.sin(a.yawBody);
    const lz = -(b.vx * Math.sin(a.yawBody) + b.vz * Math.cos(a.yawBody));
    if (Math.hypot(lx, lz) > 0.3) {
      let target = Math.atan2(lx, lz);
      // walking backwards: swing legs backwards rather than rotating 180 degrees
      if (Math.abs(target) > Math.PI * 0.6) target = target > 0 ? target - Math.PI : target + Math.PI;
      a.moveAngle += (target - a.moveAngle) * Math.min(1, dt * 8);
      a.backwards = lz < -0.3 ? 1 : 0;
    }
    a.recoil = Math.max(0, a.recoil - dt * 8);
  }

  // Compute all joint transforms and write instance matrices for one character
  pose(ch, write) {
    const a = ch.anim;
    const b = ch.body;
    const slot = ch.rigSlot;
    const M = this.meshes;
    const speedN = Math.min(1, a.speed / 4.7);
    const upright = 1 - Math.max(a.prone, a.freefall, a.dead, a.sit);

    // ---- root & pelvis
    let hip = lerp(0.95, 0.53, a.crouch);
    hip = lerp(hip, 0.2, a.prone);
    hip += Math.abs(Math.sin(a.phase)) * 0.035 * speedN * upright * (1 - a.crouch * 0.5);
    let bodyPitch = (-Math.PI / 2) * a.prone;
    bodyPitch = lerp(bodyPitch, -1.3, a.freefall);
    bodyPitch = lerp(bodyPitch, 0.05, a.chute);
    hip = lerp(hip, 0.52, a.sit);
    bodyPitch = lerp(bodyPitch, 0.12, a.sit);
    if (a.dead > 0) {
      const t = a.dead * a.dead;
      bodyPitch = lerp(bodyPitch, (a.deadSide * Math.PI) / 2, t);
      hip = lerp(hip, 0.14, t);
    }
    child(mRoot, _identity, b.x, b.y, b.z, 0, a.yawBody, 0, "YXZ");
    child(mPelvis, mRoot, 0, hip, 0, bodyPitch, 0, 0);

    // ---- torso & head
    const aimPitch = ch.alive ? ch.pitch : 0;
    let spinePitch = aimPitch * 0.4 * upright - 0.2 * a.sprint + a.prone * (0.25 + aimPitch * 0.3);
    spinePitch += Math.sin(a.phase * 2) * 0.02 * speedN * upright;
    const leanRoll = -ch.lean * 0.3 * upright;
    child(mChest, mPelvis, 0, 0.1, 0, spinePitch, 0, leanRoll, "ZXY");
    const headPitch = aimPitch * 0.5 * upright + a.prone * 1.15 + a.freefall * 0.9 - a.dead * 0.2;
    child(mHead, mChest, 0, 0.48, 0, headPitch, 0, 0);

    if (write) {
      M.pelvis.setMatrixAt(slot, mPelvis);
      M.torso.setMatrixAt(slot, mChest);
      M.neck.setMatrixAt(slot, mChest);
      M.head.setMatrixAt(slot, mHead);
      const inv = ch.inv;
      const hw = inv.helmet ? `helmet${inv.helmet.level}` : ch.look.headwear;
      for (const n of ["hair", "cap", "helmet1", "helmet2", "helmet3"])
        M[n].setMatrixAt(slot, n === hw ? mHead : ZERO);
      const vest = inv.vest ? `vest${inv.vest.level}` : "";
      for (const n of ["vest1", "vest2", "vest3"]) M[n].setMatrixAt(slot, n === vest ? mChest : ZERO);
      const pack = inv.backpack ? `pack${inv.backpack}` : "";
      for (const n of ["pack1", "pack2", "pack3"]) M[n].setMatrixAt(slot, n === pack ? mChest : ZERO);
      if (ch.mode === "chute" && ch.chuteOpen > 0.02) {
        const s = ch.chuteOpen;
        mTmp2.makeScale(s, s, s);
        mSeg.multiplyMatrices(mPelvis, mTmp2);
        M.chute.setMatrixAt(slot, mSeg);
      } else M.chute.setMatrixAt(slot, ZERO);
    }

    // ---- legs
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? -1 : 1;
      const ph = a.phase + (side === 0 ? Math.PI : 0);
      const sw = Math.sin(ph);
      const ampT = lerp(0.42, 0.62, a.sprint) * speedN * upright * (1 - a.crouch * 0.4);
      let swing = sw * ampT;
      if (a.backwards) swing = -swing;
      let thighPitch = swing * Math.cos(a.moveAngle);
      let thighRoll = -swing * Math.sin(a.moveAngle) * 0.6 + s * 0.04;
      // knee bends while the leg swings forward (cos > 0), a little at push-off
      let knee = (Math.max(0, Math.cos(ph)) * lerp(0.95, 1.7, a.sprint) * speedN + Math.max(0, -sw) * 0.25 * speedN + 0.06) * upright;
      thighPitch += 1.35 * a.crouch * upright + sw * 0.18 * a.crouch * speedN;
      knee += 2.05 * a.crouch * upright;
      // prone crawl: small alternating kicks
      thighPitch += Math.sin(ph) * 0.15 * a.prone * speedN;
      thighRoll += s * 0.12 * a.prone;
      knee += Math.max(0, Math.sin(ph)) * 0.5 * a.prone * speedN;
      // freefall spread / parachute dangle / sitting / dead
      thighPitch = lerp(thighPitch, 0.35, a.freefall);
      thighRoll = lerp(thighRoll, s * 0.35, a.freefall);
      knee = lerp(knee, 0.7, a.freefall);
      thighPitch = lerp(thighPitch, 0.25 + Math.sin(ph * 0.3) * 0.05, a.chute);
      knee = lerp(knee, 0.3, a.chute);
      thighPitch = lerp(thighPitch, 1.45, a.sit);
      knee = lerp(knee, 1.5, a.sit);
      thighRoll = lerp(thighRoll, s * 0.1, a.sit);
      thighPitch = lerp(thighPitch, side ? 0.15 : -0.05, a.dead);
      thighRoll = lerp(thighRoll, s * 0.2, a.dead);
      knee = lerp(knee, side ? 0.35 : 0.1, a.dead);
      child(mThigh, mPelvis, s * 0.1, -0.05, 0, thighPitch, 0, thighRoll);
      child(mShin, mThigh, 0, -THIGH, 0, -knee, 0, 0);
      const footPitch = (knee - thighPitch) * 0.6 * (1 - a.prone) + a.prone * 0.9;
      child(mFoot, mShin, 0, -SHIN, 0, footPitch, 0, 0);
      if (write) {
        M.thigh.setMatrixAt(slot * 2 + side, mThigh);
        M.shin.setMatrixAt(slot * 2 + side, mShin);
        M.boot.setMatrixAt(slot * 2 + side, mFoot);
      }
      // hitboxes: thigh & shin
      this.hitSeg(ch, 7 + side * 2, mThigh, 0, 0, 0, 0, -THIGH, 0, 0.09);
      this.hitSeg(ch, 8 + side * 2, mShin, 0, 0, 0, 0, -SHIN, 0, 0.075);
    }

    // ---- weapon frame (world): follows the aim direction
    const w = ch.loadout.current();
    const def = w ? WEAPONS[w.id] : null;
    const armed = !!def && ch.alive && ch.mode === "ground" && !(ch.action && ch.action.type === "use");
    a.weaponVisible = armed;
    const isPistol = def && def.cls === "PISTOL";
    const isMelee = def && def.cls === "MELEE";
    if (armed) {
      const aim = a.aim;
      const low = (1 - aim) * (1 - a.sprint);
      const ox = lerp(lerp(0.15, 0.06, aim), 0.02, a.sprint);
      const oy = lerp(lerp(0.3, 0.41, aim), 0.24, a.sprint) - a.recoil * 0.01;
      const oz = lerp(lerp(-0.18, -0.26, aim), -0.2, a.sprint) + a.recoil * 0.03;
      child(mTmp2, mChest, ox, oy, oz, 0, 0, 0);
      vB.setFromMatrixPosition(mTmp2);
      const pitch = aimPitch - low * 0.45 - a.sprint * 0.55 + a.recoil * 0.05;
      const yawOff = a.sprint * 0.9 + low * 0.25;
      const roll = a.sprint * 0.4;
      eul.set(pitch, a.yawBody + yawOff, roll, "YXZ");
      quat.setFromEuler(eul);
      mWeapon.compose(vB, quat, one);
      if (isMelee) {
        // pan held low in the right hand
        eul.set(-0.9 + (ch.swingT || 0) * 2.2, a.yawBody + 0.3, 0, "YXZ");
        quat.setFromEuler(eul);
        child(mTmp2, mChest, 0.22, 0.12, -0.2, 0, 0, 0);
        vB.setFromMatrixPosition(mTmp2);
        mWeapon.compose(vB, quat, one);
      }
      a.weaponMatrix.copy(mWeapon);
    }

    // ---- arms
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? -1 : 1;
      child(mTmp2, mChest, s * 0.19, 0.4, 0.0, 0, 0, 0);
      vShoulder.setFromMatrixPosition(mTmp2);
      let useIK = false;
      if (armed) {
        useIK = true;
        if (isMelee) {
          if (side === 1) vTarget.set(0, 0, 0).applyMatrix4(mWeapon);
          else useIK = false;
        } else if (isPistol) {
          vTarget.set(side === 1 ? 0.0 : -0.03, -0.07, side === 1 ? 0.03 : 0.05).applyMatrix4(mWeapon);
        } else {
          // left hand slides to the magazine while reloading
          let lz = -0.28;
          let ly = -0.05;
          if (side === 0 && ch.action && ch.action.type === "reload") {
            const t = ch.action.t / ch.action.dur;
            const k = Math.sin(Math.min(1, t) * Math.PI);
            lz = lerp(-0.28, -0.08, k);
            ly = lerp(-0.05, -0.2, k);
          }
          vTarget.set(0, side === 1 ? -0.06 : ly, side === 1 ? 0.04 : lz).applyMatrix4(mWeapon);
        }
      } else if (a.chute > 0.5) {
        useIK = true;
        child(mTmp2, mChest, s * 0.26, 0.95, -0.05, 0, 0, 0);
        vTarget.setFromMatrixPosition(mTmp2);
      } else if (a.sit > 0.5) {
        useIK = true;
        child(mTmp2, mChest, s * 0.18, 0.28, -0.42, 0, 0, 0);
        vTarget.setFromMatrixPosition(mTmp2);
      } else if (ch.action && ch.action.type === "use" && ch.alive) {
        useIK = true;
        const t = ch.action.t;
        child(mTmp2, mChest, s * 0.06 + Math.sin(t * 9 + side) * 0.03, 0.22, -0.28, 0, 0, 0);
        vTarget.setFromMatrixPosition(mTmp2);
      }
      if (useIK) {
        // elbows point down/out
        vPole.set(s * 0.7, -0.8, 0.25).transformDirection(mChest);
        solveTwoBone(vShoulder, vTarget, UPPER_ARM, FOREARM, vPole, vElbow, vWrist);
        vHint.set(0, 0, -1).transformDirection(mChest);
        segment(mSeg, vShoulder, vElbow, vHint);
        if (write) M.uArm.setMatrixAt(slot * 2 + side, mSeg);
        this.hitSeg(ch, 3 + side * 2, mSeg, 0, 0, 0, 0, -UPPER_ARM, 0, 0.07);
        segment(mSeg, vElbow, vWrist, vHint);
        if (write) M.fArm.setMatrixAt(slot * 2 + side, mSeg);
        this.hitSeg(ch, 4 + side * 2, mSeg, 0, 0, 0, 0, -FOREARM, 0, 0.06);
        vC.subVectors(vWrist, vElbow).normalize();
        vA.copy(vWrist).addScaledVector(vC, 0.1);
        segment(mSeg, vWrist, vA, vHint);
        if (write) M.hand.setMatrixAt(slot * 2 + side, mSeg);
      } else {
        // FK: free arm swing / freefall spread / dead
        const ph = a.phase + (side === 0 ? 0 : Math.PI);
        let pitchA = Math.sin(ph) * lerp(0.45, 0.85, a.sprint) * speedN * upright;
        let rollA = s * 0.12;
        let elbow = 0.2 + speedN * lerp(0.35, 1.3, a.sprint);
        pitchA = lerp(pitchA, 0.2, a.freefall);
        rollA = lerp(rollA, s * 1.35, a.freefall);
        elbow = lerp(elbow, 0.5, a.freefall);
        pitchA = lerp(pitchA, side ? 0.4 : -0.2, a.dead);
        rollA = lerp(rollA, s * 0.9, a.dead);
        elbow = lerp(elbow, 0.3, a.dead);
        child(mSeg, mChest, s * 0.19, 0.4, 0, pitchA, 0, rollA);
        if (write) M.uArm.setMatrixAt(slot * 2 + side, mSeg);
        this.hitSeg(ch, 3 + side * 2, mSeg, 0, 0, 0, 0, -UPPER_ARM, 0, 0.07);
        child(mTmp2, mSeg, 0, -UPPER_ARM, 0, elbow, 0, 0);
        if (write) M.fArm.setMatrixAt(slot * 2 + side, mTmp2);
        this.hitSeg(ch, 4 + side * 2, mTmp2, 0, 0, 0, 0, -FOREARM, 0, 0.06);
        child(mSeg, mTmp2, 0, -FOREARM, 0, 0.1, 0, 0);
        if (write) M.hand.setMatrixAt(slot * 2 + side, mSeg);
      }
    }

    // ---- hitboxes: head, torso, pelvis
    this.hitSeg(ch, 0, mHead, 0, 0.1, -0.01, 0, 0.12, -0.01, 0.125);
    this.hitSeg(ch, 1, mChest, 0, 0.08, 0, 0, 0.4, 0, 0.19);
    this.hitSeg(ch, 2, mPelvis, -0.08, 0, 0, 0.08, 0, 0, 0.16);
    ch.poseFrame = this.frame;
  }

  // store capsule k (local endpoints transformed by m) in ch.hitboxes
  hitSeg(ch, k, m, ax, ay, az, bx, by, bz, r) {
    const hb = ch.hitboxes;
    const o = k * 7;
    vA.set(ax, ay, az).applyMatrix4(m);
    vB.set(bx, by, bz).applyMatrix4(m);
    hb[o] = vA.x;
    hb[o + 1] = vA.y;
    hb[o + 2] = vA.z;
    hb[o + 3] = vB.x;
    hb[o + 4] = vB.y;
    hb[o + 5] = vB.z;
    hb[o + 6] = r;
  }

  hide(ch) {
    const slot = ch.rigSlot;
    for (const name of Object.keys(this.meshes)) {
      const m = this.meshes[name];
      for (let k = 0; k < m.userData.per; k++) m.setMatrixAt(slot * m.userData.per + k, ZERO);
    }
  }

  // Make sure hitboxes are current (for bullets hitting characters that weren't posed this frame)
  ensurePose(ch) {
    if (ch.poseFrame !== this.frame) this.pose(ch, false);
  }

  update(dt, camera, maxDist = 700) {
    this.frame++;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const ch of this.chars) {
      const d = Math.hypot(ch.body.x - cx, ch.body.z - cz);
      const hidden =
        ch.anim.hidden || d > maxDist || ch.mode === "plane" || (ch.mode === "vehicle" && !ch.showInVehicle);
      this.updateAnim(ch, dt);
      if (hidden) {
        this.hide(ch);
        a_weaponOff(ch);
        continue;
      }
      this.pose(ch, true);
    }
    for (const name of Object.keys(this.meshes)) this.meshes[name].instanceMatrix.needsUpdate = true;
  }
}

function a_weaponOff(ch) {
  ch.anim.weaponVisible = false;
}

const _identity = new THREE.Matrix4();
const _col = new THREE.Color();

export const HITBOX_PARTS = [
  "head",
  "torso",
  "pelvis",
  "limb",
  "limb",
  "limb",
  "limb",
  "limb",
  "limb",
  "limb",
  "limb",
];
