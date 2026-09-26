// Global constants and balancing values. Pure module (no three.js).

export const WORLD = {
  SIZE: 2048, // meters, world is [-HALF, HALF] on x and z
  HALF: 1024,
  RES: 513, // heightmap samples per side
  CELL: 4, // meters between heightmap samples
  SEA: 0, // sea level (y)
  MAP_SEED: 20260926,
  MASK_RES: 1024, // road/ground mask resolution (2 m per texel)
};

export const PHYS = {
  G: 15.7, // gameplay gravity for characters (m/s^2)
  BULLET_G: 9.81,
  STEP: 0.45, // max step-up height
  R: 0.35, // character radius
  H_STAND: 1.8,
  H_CROUCH: 1.25,
  H_PRONE: 0.55,
  SWIM_DEPTH: 1.3, // feet depth below sea level while swimming
};

export const SPEED = {
  walk: 1.8,
  jog: 4.7,
  sprint: 6.3,
  crouch: 2.8,
  prone: 1.2,
  ads: 2.5,
  swim: 2.5,
  jump: 4.5,
};

export const PLAYER_COUNT = 50;

export const PLANE = { ALT: 500, SPEED: 60 };

export const QUALITY_PRESETS = {
  low: { label: "Thấp", scale: 0.6, msaa: 0, shadowSize: 1024, shadowRange: 60, grass: 0, view: 650, bloom: false, treeDetail: 0.5 },
  medium: { label: "Trung bình", scale: 0.8, msaa: 2, shadowSize: 2048, shadowRange: 75, grass: 35, view: 900, bloom: false, treeDetail: 0.75 },
  high: { label: "Cao", scale: 1, msaa: 4, shadowSize: 2048, shadowRange: 90, grass: 60, view: 1200, bloom: false, treeDetail: 1 },
  // scale 2 = native devicePixelRatio (capped at 2)
  ultra: { label: "Ultra", scale: 2, msaa: 4, shadowSize: 4096, shadowRange: 120, grass: 80, view: 1500, bloom: true, treeDetail: 1 },
};
