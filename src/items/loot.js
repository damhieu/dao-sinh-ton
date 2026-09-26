// Weighted loot tables per location tier (1 rural .. 3 military, 4 = airdrop). Pure module (no three.js).
import { WEAPONS, ITEMS } from "./itemdefs.js";

export const LOOT_TABLES = {
  1: {
    empty: 26,
    cats: { weapon: 17, ammo: 20, heal: 15, boost: 6, armor: 12, backpack: 6, attachment: 12, throwable: 7 },
    weapon: {
      ump: 3,
      uzi: 3,
      s1897: 3,
      p92: 4,
      akm: 1.4,
      m416: 1.4,
      scar: 1,
      sks: 0.5,
      kar98k: 0.4,
      pan: 1.2,
    },
    armorLv: [0.7, 0.27, 0.03],
  },
  2: {
    empty: 20,
    cats: { weapon: 20, ammo: 20, heal: 14, boost: 7, armor: 12, backpack: 6, attachment: 14, throwable: 8 },
    weapon: {
      m416: 3,
      akm: 3,
      scar: 2.5,
      ump: 2.5,
      uzi: 1.5,
      s1897: 2,
      p92: 2,
      sks: 1.5,
      kar98k: 1,
      pan: 0.6,
    },
    armorLv: [0.5, 0.4, 0.1],
  },
  3: {
    empty: 14,
    cats: { weapon: 24, ammo: 20, heal: 12, boost: 7, armor: 14, backpack: 6, attachment: 16, throwable: 9 },
    weapon: { m416: 4, akm: 3.5, scar: 3.5, sks: 2.5, kar98k: 2, ump: 1.5, s1897: 1, p92: 1 },
    armorLv: [0.28, 0.46, 0.26],
  },
};

const ATTACH_W = {
  reddot: 3,
  scope2x: 2,
  scope4x: 1.2,
  scope8x: 0.35,
  comp: 2,
  suppressor: 1,
  extmag: 2.5,
  vgrip: 2,
};
const HEAL_W = { bandage: 5, firstaid: 2.5, medkit: 0.45 };
const BOOST_W = { energy: 3, painkiller: 1.5 };
const THROW_W = { frag: 2, smoke: 1.4 };
const AMMO_W = { ammo556: 3, ammo762: 3, ammo45: 2, ammo9: 2, ammo12: 1.4 };

const entries = (o) => Object.entries(o);

function armorLevel(rng, dist) {
  const r = rng.next();
  return r < dist[0] ? 1 : r < dist[0] + dist[1] ? 2 : 3;
}

// One loot spawn point -> list of {id, n}
export function rollLoot(rng, tier) {
  if (tier === 4) return rollAirdrop(rng);
  const T = LOOT_TABLES[tier] || LOOT_TABLES[1];
  if (rng.next() * 100 < T.empty) return [];
  const cat = rng.weighted(entries(T.cats));
  switch (cat) {
    case "weapon": {
      const id = rng.weighted(entries(T.weapon));
      const w = WEAPONS[id];
      const out = [{ id, n: 1 }];
      if (w.ammo) {
        const stack = ITEMS[w.ammo].stack;
        out.push({ id: w.ammo, n: stack });
        if (rng.chance(0.5)) out.push({ id: w.ammo, n: stack });
      }
      return out;
    }
    case "ammo": {
      const id = rng.weighted(entries(AMMO_W));
      return [{ id, n: ITEMS[id].stack }];
    }
    case "heal": {
      const id = rng.weighted(entries(HEAL_W));
      return [{ id, n: ITEMS[id].stack }];
    }
    case "boost":
      return [{ id: rng.weighted(entries(BOOST_W)), n: 1 }];
    case "throwable":
      return [{ id: rng.weighted(entries(THROW_W)), n: 1 }];
    case "attachment": {
      const w = { ...ATTACH_W };
      if (tier === 3) {
        w.scope4x *= 1.6;
        w.scope8x *= 2.2;
      }
      return [{ id: rng.weighted(entries(w)), n: 1 }];
    }
    case "armor": {
      const kind = rng.chance(0.5) ? "helmet" : "vest";
      return [{ id: `${kind}${armorLevel(rng, T.armorLv)}`, n: 1 }];
    }
    case "backpack":
      return [{ id: `backpack${armorLevel(rng, T.armorLv)}`, n: 1 }];
    default:
      return [];
  }
}

// Care package: always strong gear
export function rollAirdrop(rng) {
  const out = [];
  if (rng.chance(0.65)) {
    out.push({ id: "awm", n: 1 }, { id: "ammo300", n: 10 }, { id: "ammo300", n: 10 });
  } else {
    out.push(
      { id: rng.pick(["m416", "scar", "akm"]), n: 1 },
      { id: "ammo556", n: 60 },
      { id: "ammo762", n: 60 },
    );
  }
  out.push({ id: rng.chance(0.6) ? "helmet3" : "vest3", n: 1 });
  if (rng.chance(0.5)) out.push({ id: rng.chance(0.5) ? "vest3" : "helmet3", n: 1 });
  out.push({ id: rng.chance(0.6) ? "scope8x" : "scope4x", n: 1 });
  out.push({ id: "medkit", n: 1 });
  if (rng.chance(0.6)) out.push({ id: "suppressor", n: 1 });
  if (rng.chance(0.5)) out.push({ id: "painkiller", n: 1 });
  return out;
}
