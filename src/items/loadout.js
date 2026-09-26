// Weapon slots (2 primaries, pistol, melee, throwable) and attachments. Pure module (no three.js).
import { WEAPONS, ATTACHMENTS, attachmentFits } from "./itemdefs.js";

export const SLOT_P1 = 0;
export const SLOT_P2 = 1;
export const SLOT_PISTOL = 2;
export const SLOT_MELEE = 3;
export const SLOT_THROW = 4;

export function makeWeapon(id, mag = 0) {
  const def = WEAPONS[id];
  return {
    id,
    mag,
    att: { sight: null, muzzle: null, mag: null, grip: null },
    mode: def.modes[0],
  };
}

export function magSize(w) {
  const def = WEAPONS[w.id];
  return w.att.mag === "extmag" ? def.extMag : def.mag;
}

export function sightZoom(w) {
  if (!w || !w.att.sight) return 1;
  return ATTACHMENTS[w.att.sight].zoom;
}

export class Loadout {
  constructor() {
    this.slots = [null, null, null, null, null];
    this.active = -1; // -1 = unarmed
  }

  current() {
    return this.active >= 0 ? this.slots[this.active] : null;
  }

  // Put a weapon in the appropriate slot. Returns { slot, dropped } where dropped is the replaced weapon.
  addWeapon(id, mag = 0, att = null) {
    const def = WEAPONS[id];
    const w = makeWeapon(id, mag);
    if (att) Object.assign(w.att, att);
    let slot;
    if (def.cls === "MELEE") slot = SLOT_MELEE;
    else if (def.cls === "PISTOL") slot = SLOT_PISTOL;
    else if (!this.slots[SLOT_P1]) slot = SLOT_P1;
    else if (!this.slots[SLOT_P2]) slot = SLOT_P2;
    else slot = this.active === SLOT_P2 ? SLOT_P2 : SLOT_P1;
    const dropped = this.slots[slot];
    this.slots[slot] = w;
    if (this.active === -1 && slot !== SLOT_THROW) this.active = slot;
    return { slot, dropped, weapon: w };
  }

  // Attach to the best weapon with a free compatible slot. Returns the weapon slot index or -1.
  autoAttach(attId) {
    const a = ATTACHMENTS[attId];
    const order = [this.active, SLOT_P1, SLOT_P2, SLOT_PISTOL].filter(
      (s, i, arr) => s >= 0 && arr.indexOf(s) === i,
    );
    for (const s of order) {
      const w = this.slots[s];
      if (!w || !attachmentFits(attId, w.id)) continue;
      if (w.att[a.slot]) continue;
      w.att[a.slot] = attId;
      return s;
    }
    return -1;
  }

  detach(slot, attSlot) {
    const w = this.slots[slot];
    if (!w || !w.att[attSlot]) return null;
    const id = w.att[attSlot];
    w.att[attSlot] = null;
    if (attSlot === "mag") w.mag = Math.min(w.mag, magSize(w));
    return id;
  }

  removeSlot(slot) {
    const w = this.slots[slot];
    this.slots[slot] = null;
    if (this.active === slot) this.active = -1;
    return w;
  }

  // Weapons + attachments as a flat list (for death crates)
  toList() {
    const out = [];
    for (let s = 0; s < 4; s++) {
      const w = this.slots[s];
      if (w) out.push({ id: w.id, n: 1, weapon: w });
    }
    return out;
  }
}
