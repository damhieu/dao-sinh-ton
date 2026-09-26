// Backpack contents, armor and capacity. Pure module (no three.js).
import { ITEMS } from "./itemdefs.js";

export const BASE_CAPACITY = 50;
export const BACKPACK_CAPACITY = [0, 150, 200, 250];
export const VEST_CAPACITY = 50;

export class Inventory {
  constructor() {
    this.items = new Map(); // id -> count
    this.helmet = null; // { level, durability, max }
    this.vest = null;
    this.backpack = 0;
  }

  capacity(backpack = this.backpack, vest = !!this.vest) {
    return BASE_CAPACITY + BACKPACK_CAPACITY[backpack] + (vest ? VEST_CAPACITY : 0);
  }

  weight() {
    let w = 0;
    for (const [id, n] of this.items) w += ITEMS[id].weight * n;
    return w;
  }

  count(id) {
    return this.items.get(id) || 0;
  }

  maxAddable(id) {
    const wt = ITEMS[id].weight;
    if (wt <= 0) return Infinity;
    return Math.max(0, Math.floor((this.capacity() - this.weight()) / wt + 1e-6));
  }

  add(id, n) {
    const k = Math.max(0, Math.min(n, this.maxAddable(id)));
    if (k > 0) this.items.set(id, this.count(id) + k);
    return k;
  }

  remove(id, n) {
    const have = this.count(id);
    const k = Math.min(have, Math.max(0, n));
    if (have - k <= 0) this.items.delete(id);
    else this.items.set(id, have - k);
    return k;
  }

  // Equip helmet/vest; returns the previous piece (or null)
  equipArmor(kind, level, durability) {
    const max = ITEMS[`${kind}${level}`].durability;
    const old = this[kind];
    this[kind] = { level, durability: durability ?? max, max };
    return old;
  }

  canRemoveVest() {
    return this.weight() <= this.capacity(this.backpack, false) + 1e-6;
  }

  // Swap backpack; refuses (returns -1) if the new capacity cannot hold the current load
  equipBackpack(level) {
    if (this.weight() > this.capacity(level) + 1e-6) return -1;
    const old = this.backpack;
    this.backpack = level;
    return old;
  }

  // Damage armor; returns true if it broke
  damageArmor(kind, amount) {
    const a = this[kind];
    if (!a) return false;
    a.durability -= amount;
    if (a.durability <= 0) {
      this[kind] = null;
      return true;
    }
    return false;
  }

  // All contents as a list of {id, n} (for death crates)
  toList() {
    const out = [];
    for (const [id, n] of this.items) out.push({ id, n });
    return out;
  }
}
