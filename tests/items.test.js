import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEMS, WEAPONS, attachmentFits } from "../src/items/itemdefs.js";
import { Inventory } from "../src/items/inventory.js";
import { Loadout, magSize } from "../src/items/loadout.js";
import { rollLoot } from "../src/items/loot.js";
import { RNG } from "../src/core/rng.js";

test("capacity: base, backpack and vest", () => {
  const inv = new Inventory();
  assert.equal(inv.capacity(), 50);
  inv.equipBackpack(2);
  inv.equipArmor("vest", 1);
  assert.equal(inv.capacity(), 300);
});

test("add respects weight capacity", () => {
  const inv = new Inventory();
  assert.equal(inv.add("ammo556", 200), 100);
  assert.equal(inv.count("ammo556"), 100);
  assert.equal(inv.add("bandage", 1), 0);
});

test("remove never goes negative", () => {
  const inv = new Inventory();
  inv.add("bandage", 3);
  assert.equal(inv.remove("bandage", 10), 3);
  assert.equal(inv.count("bandage"), 0);
  assert.ok(!inv.items.has("bandage"));
});

test("backpack downgrade refused when overloaded", () => {
  const inv = new Inventory();
  inv.equipBackpack(3);
  assert.equal(inv.add("medkit", 11), 11); // 220 weight, capacity 300
  assert.equal(inv.equipBackpack(1), -1);
  assert.equal(inv.backpack, 3);
  assert.equal(inv.equipBackpack(2), 3); // 250 capacity holds 220
});

test("armor durability breaks", () => {
  const inv = new Inventory();
  inv.equipArmor("helmet", 2);
  assert.equal(inv.helmet.durability, 150);
  assert.equal(inv.damageArmor("helmet", 100), false);
  assert.equal(inv.damageArmor("helmet", 60), true);
  assert.equal(inv.helmet, null);
});

test("loadout slot assignment", () => {
  const lo = new Loadout();
  assert.equal(lo.addWeapon("m416", 30).slot, 0);
  assert.equal(lo.active, 0);
  assert.equal(lo.addWeapon("akm").slot, 1);
  const r = lo.addWeapon("kar98k");
  assert.equal(r.slot, 0); // replaces the active primary
  assert.equal(r.dropped.id, "m416");
  assert.equal(lo.addWeapon("p92").slot, 2);
  assert.equal(lo.addWeapon("pan").slot, 3);
});

test("attachments: fit rules and auto attach", () => {
  const lo = new Loadout();
  lo.addWeapon("m416");
  assert.equal(lo.autoAttach("scope8x"), -1);
  assert.equal(lo.autoAttach("scope4x"), 0);
  assert.equal(lo.slots[0].att.sight, "scope4x");
  assert.equal(lo.autoAttach("reddot"), -1); // sight slot already used
  assert.equal(lo.autoAttach("extmag"), 0);
  assert.equal(magSize(lo.slots[0]), 40);
  assert.ok(!attachmentFits("vgrip", "akm"));
  assert.ok(attachmentFits("scope8x", "kar98k"));
});

test("loot tables produce valid items and scale with tier", () => {
  const rng = new RNG(99);
  let lv3Low = 0;
  let lv3High = 0;
  for (let i = 0; i < 4000; i++) {
    for (const it of rollLoot(rng, 1)) {
      assert.ok(ITEMS[it.id], `unknown ${it.id}`);
      assert.ok(it.n > 0);
      if (/3$/.test(it.id) && ITEMS[it.id].level === 3) lv3Low++;
    }
    for (const it of rollLoot(rng, 3)) {
      assert.ok(ITEMS[it.id], `unknown ${it.id}`);
      assert.ok(!WEAPONS[it.id]?.airdropOnly, "airdrop-only weapon in normal loot");
      if (/3$/.test(it.id) && ITEMS[it.id].level === 3) lv3High++;
    }
  }
  assert.ok(lv3High > lv3Low * 2, `lv3 tier3=${lv3High} tier1=${lv3Low}`);
});

test("airdrops always contain an AWM or level 3 armor", () => {
  const rng = new RNG(5);
  for (let i = 0; i < 300; i++) {
    const ids = rollLoot(rng, 4).map((x) => x.id);
    assert.ok(ids.includes("awm") || ids.includes("helmet3") || ids.includes("vest3"));
  }
});
