// Hit damage with body-part multipliers, armor and distance falloff. Pure module (no three.js).

export const LIMB_MULT = 0.6;
export const ARMOR_REDUCTION = [0, 0.3, 0.4, 0.55];

export function falloffMult(weapon, distance) {
  const f = weapon.falloff;
  if (!f) return 1;
  const [d0, d1, min] = f;
  if (distance <= d0) return 1;
  if (distance >= d1) return min;
  return 1 + (min - 1) * ((distance - d0) / (d1 - d0));
}

// part: "head" | "torso" | "pelvis" | "limb"
// Returns { damage, helmetDmg, vestDmg } — armor durability loss equals the raw (pre-armor) damage.
export function computeHit({ weapon, part, distance = 0, helmet = null, vest = null }) {
  const base = weapon.dmg * falloffMult(weapon, distance);
  const mult = part === "head" ? weapon.headMult : part === "limb" ? LIMB_MULT : 1;
  const raw = base * mult;
  let damage = raw;
  let helmetDmg = 0;
  let vestDmg = 0;
  if (part === "head" && helmet && helmet.durability > 0) {
    damage = raw * (1 - ARMOR_REDUCTION[helmet.level]);
    helmetDmg = raw;
  } else if ((part === "torso" || part === "pelvis") && vest && vest.durability > 0) {
    damage = raw * (1 - ARMOR_REDUCTION[vest.level]);
    vestDmg = raw;
  }
  return { damage, helmetDmg, vestDmg };
}
