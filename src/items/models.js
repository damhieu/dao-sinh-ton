// Procedural models for weapons, attachments and loot items (vertex-colored, merged geometries).
// Held orientation: barrel along -Z, up +Y, origin at the grip/trigger.
import * as THREE from "three";
import { box, rbox, cyl, sphere, merge, place, prep } from "../core/geo.js";
import { buildHelmet, buildVest, buildPack } from "../actors/rig.js";
import { ITEMS } from "./itemdefs.js";

const PI2 = Math.PI / 2;
const METAL = 0x2a2c2f;
const METAL2 = 0x3b3e43;
const POLY = 0x1d1e20;
const TAN = 0x9c8660;
const WOOD = 0x7a4a2a;
const WOOD2 = 0x5c3820;
const OLIVE = 0x505a3a;
const BRASS = 0xb8923a;

// cylinder along Z (length l) centered at z
const zcyl = (r, l, color, x, y, z, seg = 10) => cyl(r, r, l, color, x, y, z, PI2, 0, 0, seg);

function m416() {
  return {
    parts: [
      rbox(0.058, 0.075, 0.34, 0.008, METAL, 0, 0.02, -0.02),
      rbox(0.064, 0.07, 0.3, 0.01, METAL2, 0, 0.022, -0.34),
      box(0.022, 0.012, 0.64, METAL, 0, 0.064, -0.2),
      box(0.01, 0.012, 0.26, METAL, 0.034, 0.024, -0.34),
      box(0.01, 0.012, 0.26, METAL, -0.034, 0.024, -0.34),
      zcyl(0.011, 0.2, METAL, 0, 0.026, -0.58),
      zcyl(0.016, 0.05, METAL, 0, 0.026, -0.7),
      zcyl(0.017, 0.16, METAL, 0, 0.032, 0.22),
      rbox(0.045, 0.1, 0.17, 0.012, POLY, 0, 0.006, 0.35),
      rbox(0.032, 0.1, 0.045, 0.008, POLY, 0, -0.07, 0.07, -0.25),
      rbox(0.026, 0.16, 0.07, 0.006, TAN, 0, -0.1, -0.1, 0.12),
      box(0.012, 0.035, 0.012, METAL, 0, 0.087, -0.47),
      box(0.03, 0.022, 0.02, METAL, 0, 0.081, 0.1),
    ],
    mounts: {
      sight: [0, 0.07, -0.06],
      muzzle: [0, 0.026, -0.725],
      grip: [0, -0.013, -0.36],
      mag: [0, -0.1, -0.1],
    },
    len: 0.95,
  };
}

function scar() {
  const T = 0xb09a70;
  return {
    parts: [
      rbox(0.062, 0.085, 0.5, 0.01, T, 0, 0.025, -0.16),
      rbox(0.05, 0.05, 0.28, 0.008, POLY, 0, -0.035, -0.02),
      box(0.022, 0.012, 0.52, METAL, 0, 0.073, -0.16),
      zcyl(0.012, 0.2, METAL, 0, 0.03, -0.5),
      zcyl(0.017, 0.05, METAL, 0, 0.03, -0.62),
      rbox(0.05, 0.1, 0.22, 0.015, T, 0, 0.012, 0.28),
      rbox(0.032, 0.1, 0.045, 0.008, POLY, 0, -0.08, 0.06, -0.25),
      rbox(0.026, 0.155, 0.07, 0.006, POLY, 0, -0.105, -0.12, 0.1),
    ],
    mounts: {
      sight: [0, 0.079, -0.08],
      muzzle: [0, 0.03, -0.645],
      grip: [0, -0.01, -0.32],
      mag: [0, -0.105, -0.12],
    },
    len: 0.95,
  };
}

function akm() {
  return {
    parts: [
      rbox(0.05, 0.07, 0.36, 0.008, METAL, 0, 0.012, -0.04),
      rbox(0.058, 0.06, 0.24, 0.012, WOOD, 0, 0.0, -0.33),
      zcyl(0.016, 0.22, METAL2, 0, 0.05, -0.34),
      zcyl(0.011, 0.23, METAL, 0, 0.015, -0.56),
      zcyl(0.014, 0.05, METAL, 0, 0.015, -0.69),
      box(0.012, 0.045, 0.014, METAL, 0, 0.045, -0.64),
      box(0.03, 0.02, 0.04, METAL, 0, 0.055, -0.15),
      rbox(0.042, 0.085, 0.26, 0.012, WOOD, 0, -0.03, 0.3, 0.15),
      rbox(0.03, 0.1, 0.045, 0.008, WOOD2, 0, -0.07, 0.07, -0.3),
      rbox(0.024, 0.17, 0.07, 0.006, 0x6b3a22, 0, -0.1, -0.1, 0.3),
    ],
    mounts: {
      sight: [0, 0.06, -0.08],
      muzzle: [0, 0.015, -0.715],
      grip: [0, -0.03, -0.33],
      mag: [0, -0.11, -0.12],
    },
    len: 0.93,
  };
}

function ump() {
  return {
    parts: [
      rbox(0.06, 0.1, 0.42, 0.012, POLY, 0, 0.0, -0.12),
      box(0.022, 0.012, 0.3, METAL, 0, 0.055, -0.1),
      zcyl(0.012, 0.08, METAL, 0, 0.02, -0.37),
      rbox(0.025, 0.07, 0.24, 0.008, POLY, 0, 0.0, 0.22),
      rbox(0.032, 0.09, 0.045, 0.008, POLY, 0, -0.08, 0.06, -0.2),
      rbox(0.028, 0.17, 0.05, 0.006, POLY, 0, -0.12, -0.12),
    ],
    mounts: {
      sight: [0, 0.062, -0.08],
      muzzle: [0, 0.02, -0.41],
      grip: [0, -0.05, -0.26],
      mag: [0, -0.12, -0.12],
    },
    len: 0.7,
  };
}

function uzi() {
  return {
    parts: [
      rbox(0.05, 0.08, 0.26, 0.01, METAL, 0, 0.01, -0.05),
      zcyl(0.01, 0.06, METAL, 0, 0.02, -0.21),
      rbox(0.036, 0.13, 0.05, 0.01, POLY, 0, -0.09, 0.02),
      rbox(0.022, 0.1, 0.03, 0.005, METAL2, 0, -0.18, 0.02),
      box(0.012, 0.012, 0.22, METAL2, 0, 0.0, 0.18),
    ],
    mounts: {
      sight: [0, 0.055, -0.05],
      muzzle: [0, 0.02, -0.24],
      grip: [0, -0.02, -0.14],
      mag: [0, -0.2, 0.02],
    },
    len: 0.45,
  };
}

function sks() {
  return {
    parts: [
      rbox(0.05, 0.07, 1.0, 0.015, WOOD, 0, -0.01, -0.1),
      rbox(0.045, 0.1, 0.24, 0.015, WOOD, 0, -0.04, 0.4, 0.14),
      rbox(0.036, 0.05, 0.3, 0.006, METAL, 0, 0.035, -0.02),
      zcyl(0.011, 0.36, METAL, 0, 0.035, -0.6),
      box(0.012, 0.04, 0.012, METAL, 0, 0.065, -0.74),
      rbox(0.03, 0.07, 0.08, 0.006, METAL, 0, -0.07, -0.08),
    ],
    mounts: {
      sight: [0, 0.065, -0.04],
      muzzle: [0, 0.035, -0.785],
      grip: [0, -0.045, -0.4],
      mag: [0, -0.07, -0.08],
    },
    len: 1.1,
  };
}

function kar98k() {
  return {
    parts: [
      rbox(0.048, 0.06, 0.95, 0.015, WOOD, 0, -0.012, -0.12),
      rbox(0.042, 0.11, 0.28, 0.015, WOOD, 0, -0.045, 0.42, 0.16),
      zcyl(0.017, 0.26, METAL, 0, 0.032, 0.0),
      zcyl(0.01, 0.46, METAL, 0, 0.032, -0.6),
      box(0.01, 0.035, 0.012, METAL, 0, 0.055, -0.8),
      // bolt handle
      cyl(0.007, 0.007, 0.07, METAL, 0.035, 0.03, 0.08, 0, 0, PI2),
      sphere(0.012, METAL, 0.07, 0.03, 0.08),
    ],
    mounts: {
      sight: [0, 0.058, -0.02],
      muzzle: [0, 0.032, -0.83],
      grip: [0, -0.04, -0.4],
      mag: [0, -0.05, -0.04],
    },
    len: 1.15,
  };
}

function awm() {
  return {
    parts: [
      rbox(0.06, 0.08, 0.72, 0.015, OLIVE, 0, -0.005, 0.02),
      rbox(0.05, 0.12, 0.26, 0.02, OLIVE, 0, -0.03, 0.42, 0.1),
      zcyl(0.019, 0.26, METAL, 0, 0.035, 0.0),
      zcyl(0.014, 0.5, METAL, 0, 0.035, -0.55),
      rbox(0.04, 0.03, 0.08, 0.008, METAL, 0, 0.035, -0.83),
      rbox(0.032, 0.1, 0.045, 0.008, OLIVE, 0, -0.08, 0.1, -0.2),
      rbox(0.03, 0.08, 0.09, 0.006, METAL, 0, -0.08, -0.06),
      cyl(0.008, 0.008, 0.07, METAL, 0.04, 0.035, 0.1, 0, 0, PI2),
      sphere(0.014, METAL, 0.08, 0.035, 0.1),
    ],
    mounts: {
      sight: [0, 0.065, -0.02],
      muzzle: [0, 0.035, -0.87],
      grip: [0, -0.05, -0.3],
      mag: [0, -0.1, -0.06],
    },
    len: 1.25,
  };
}

function s1897() {
  return {
    parts: [
      rbox(0.05, 0.075, 0.2, 0.01, METAL, 0, 0.01, -0.02),
      zcyl(0.014, 0.52, METAL, 0, 0.035, -0.36),
      zcyl(0.012, 0.44, METAL2, 0, 0.0, -0.34),
      rbox(0.05, 0.05, 0.16, 0.015, WOOD, 0, -0.003, -0.34),
      rbox(0.045, 0.1, 0.3, 0.015, WOOD, 0, -0.035, 0.24, 0.16),
    ],
    mounts: {
      sight: [0, 0.06, -0.05],
      muzzle: [0, 0.035, -0.62],
      grip: [0, -0.02, -0.34],
      mag: [0, -0.02, -0.02],
    },
    len: 1.0,
  };
}

function p92() {
  return {
    parts: [
      rbox(0.03, 0.035, 0.2, 0.006, METAL, 0, 0.03, -0.06),
      rbox(0.03, 0.12, 0.05, 0.008, POLY, 0, -0.045, 0.02, -0.2),
      zcyl(0.007, 0.02, METAL, 0, 0.03, -0.165),
      box(0.006, 0.01, 0.006, METAL, 0, 0.052, -0.14),
    ],
    mounts: { sight: [0, 0.05, -0.05], muzzle: [0, 0.03, -0.17], grip: [0, 0.0, -0.1], mag: [0, -0.1, 0.02] },
    len: 0.22,
  };
}

function pan() {
  return {
    parts: [
      cyl(0.15, 0.13, 0.04, 0x2d2d2d, 0, 0, -0.2, PI2, 0, 0, 20),
      cyl(0.125, 0.125, 0.005, 0x3c3c3c, 0, 0, -0.178, PI2, 0, 0, 20),
      rbox(0.03, 0.02, 0.2, 0.006, 0x3a2a1e, 0, 0, 0.0),
    ],
    mounts: { sight: [0, 0, 0], muzzle: [0, 0, -0.35], grip: [0, 0, 0], mag: [0, 0, 0] },
    len: 0.5,
  };
}

const WEAPON_BUILDERS = { m416, scar, akm, ump, uzi, sks, kar98k, awm, s1897, p92, pan };

const ATTACH_BUILDERS = {
  reddot: () => [
    box(0.028, 0.012, 0.05, METAL, 0, 0.006, 0),
    zcyl(0.017, 0.038, POLY, 0, 0.03, 0),
    zcyl(0.012, 0.04, 0x2a1414, 0, 0.03, 0.001),
  ],
  scope2x: () => [
    box(0.028, 0.014, 0.06, METAL, 0, 0.007, 0),
    zcyl(0.02, 0.11, POLY, 0, 0.036, 0),
    zcyl(0.024, 0.02, POLY, 0, 0.036, -0.06),
  ],
  scope4x: () => [
    box(0.03, 0.016, 0.07, METAL, 0, 0.008, 0),
    rbox(0.04, 0.035, 0.12, 0.008, POLY, 0, 0.035, 0),
    zcyl(0.022, 0.03, POLY, 0, 0.038, -0.07),
    box(0.008, 0.008, 0.07, 0x7a8a3a, 0, 0.058, 0.005),
  ],
  scope8x: () => [
    box(0.03, 0.016, 0.1, METAL, 0, 0.008, 0),
    zcyl(0.02, 0.26, POLY, 0, 0.042, 0),
    cyl(0.032, 0.022, 0.07, POLY, 0, 0.042, -0.15, PI2, 0, 0, 12),
    zcyl(0.024, 0.04, POLY, 0, 0.042, 0.14),
    cyl(0.009, 0.009, 0.03, POLY, 0, 0.068, 0.0),
  ],
  suppressor: () => [zcyl(0.022, 0.2, 0x202124, 0, 0, -0.1)],
  comp: () => [zcyl(0.019, 0.07, METAL2, 0, 0, -0.035), box(0.03, 0.01, 0.03, METAL, 0, 0.014, -0.04)],
  extmag: () => [rbox(0.028, 0.07, 0.066, 0.006, POLY, 0, -0.03, 0)],
  vgrip: () => [cyl(0.015, 0.017, 0.09, POLY, 0, -0.045, 0)],
};

const cache = new Map();

export function weaponModel(id) {
  if (!cache.has(id)) {
    const b = WEAPON_BUILDERS[id]();
    cache.set(id, { geo: merge(b.parts), mounts: b.mounts, len: b.len });
  }
  return cache.get(id);
}

export function attachmentGeometry(id) {
  const key = `att_${id}`;
  if (!cache.has(key)) cache.set(key, { geo: merge(ATTACH_BUILDERS[id]()) });
  return cache.get(key).geo;
}

// Offset of an attachment relative to the weapon origin (held space)
export function mountOffset(weaponId, attId, slot) {
  const m = weaponModel(weaponId).mounts;
  if (slot === "mag") return [m.mag[0], m.mag[1] - 0.075, m.mag[2]];
  return m[slot];
}

function crossGeo(color, bg, w, h, d) {
  return [
    rbox(w, h, d, 0.01, bg, 0, h / 2, 0),
    box(w * 0.18, 0.004, d * 0.55, color, 0, h + 0.002, 0),
    box(w * 0.55, 0.004, d * 0.18, color, 0, h + 0.002, 0),
  ];
}

// Geometry for an item lying on the ground (origin at ground contact)
export function groundGeometry(id) {
  const key = `g_${id}`;
  if (cache.has(key)) return cache.get(key);
  const def = ITEMS[id];
  let g;
  if (def.cat === "weapon" || def.cat === "melee") {
    g = weaponModel(id).geo.clone();
    place(g, 0, 0.035, 0, 0, 0, PI2); // lying on its side
    if (id === "pan") g = place(weaponModel(id).geo.clone(), 0, 0.03, 0, PI2, 0, 0);
  } else if (def.cat === "attachment") {
    g = place(attachmentGeometry(id).clone(), 0, 0.03, 0, 0, 0, 0, 1.4, 1.4, 1.4);
  } else if (def.cat === "ammo") {
    g = merge([
      rbox(0.2, 0.1, 0.13, 0.01, 0x3d4430, 0, 0.05, 0),
      box(0.202, 0.03, 0.132, def.color, 0, 0.065, 0),
    ]);
  } else if (id === "bandage") {
    g = merge([
      cyl(0.05, 0.05, 0.07, 0xeeeae0, 0, 0.035, 0, 0, 0, 0, 14),
      cyl(0.051, 0.051, 0.012, 0xb03030, 0, 0.035, 0, 0, 0, 0, 14),
    ]);
  } else if (id === "firstaid") {
    g = merge(crossGeo(0xc0282a, 0xeeeeee, 0.22, 0.08, 0.16));
  } else if (id === "medkit") {
    g = merge(crossGeo(0xffffff, 0xb02428, 0.34, 0.14, 0.24));
  } else if (id === "energy") {
    g = merge([
      cyl(0.032, 0.032, 0.12, 0x2a6ad0, 0, 0.06, 0, 0, 0, 0, 14),
      cyl(0.028, 0.032, 0.012, 0xcfd3d6, 0, 0.126, 0, 0, 0, 0, 14),
    ]);
  } else if (id === "painkiller") {
    g = merge([
      cyl(0.03, 0.03, 0.08, 0xeeeeee, 0, 0.04, 0, 0, 0, 0, 12),
      cyl(0.032, 0.032, 0.025, 0xe07020, 0, 0.09, 0, 0, 0, 0, 12),
    ]);
  } else if (id === "frag") {
    g = merge([
      sphere(0.045, 0x4a5530, 0, 0.045, 0, 1, 1.15, 1),
      cyl(0.012, 0.012, 0.03, 0x777777, 0, 0.1, 0),
      box(0.012, 0.05, 0.01, 0x777777, 0.018, 0.08, 0),
    ]);
  } else if (id === "smoke") {
    g = merge([
      cyl(0.032, 0.032, 0.13, 0x5a6a5a, 0, 0.065, 0, 0, 0, 0, 12),
      cyl(0.033, 0.033, 0.02, 0xdddddd, 0, 0.1, 0, 0, 0, 0, 12),
    ]);
  } else if (def.cat === "helmet") {
    g = place(buildHelmet(def.level).clone(), 0, -0.05, 0);
  } else if (def.cat === "vest") {
    g = place(buildVest(def.level).clone(), 0, 0.12, -0.26, -PI2, 0, 0);
  } else if (def.cat === "backpack") {
    g = place(buildPack(def.level).clone(), 0, -0.02, -0.12, 0, 0, 0);
  } else {
    g = merge([box(0.2, 0.2, 0.2, 0xff00ff, 0, 0.1, 0)]);
  }
  cache.set(key, g);
  return g;
}

// Standalone mesh of a weapon with attachments (for the first-person viewmodel)
export function buildWeaponMesh(w, material) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(weaponModel(w.id).geo, material));
  for (const slot of ["sight", "muzzle", "grip", "mag"]) {
    const att = w.att[slot];
    if (!att) continue;
    const m = new THREE.Mesh(attachmentGeometry(att), material);
    m.position.fromArray(mountOffset(w.id, att, slot));
    group.add(m);
  }
  return group;
}

export function crateGeometry() {
  if (cache.has("crate")) return cache.get("crate");
  const g = merge([
    rbox(0.9, 0.55, 0.6, 0.02, 0x8a6a42, 0, 0.275, 0),
    box(0.92, 0.06, 0.62, 0x5e4630, 0, 0.5, 0),
    box(0.06, 0.56, 0.62, 0x5e4630, -0.36, 0.28, 0),
    box(0.06, 0.56, 0.62, 0x5e4630, 0.36, 0.28, 0),
  ]);
  cache.set("crate", g);
  return g;
}

export function airdropGeometry() {
  if (cache.has("airdrop")) return cache.get("airdrop");
  const g = merge([
    rbox(1.4, 1.0, 1.4, 0.04, 0x2f5f9a, 0, 0.5, 0),
    box(1.42, 0.12, 1.42, 0xc23b2b, 0, 0.5, 0),
    box(0.12, 1.02, 1.42, 0xc23b2b, 0, 0.5, 0),
    box(1.2, 0.08, 1.2, 0x333333, 0, 0.04, 0),
  ]);
  cache.set("airdrop", g);
  return g;
}

export { prep };
