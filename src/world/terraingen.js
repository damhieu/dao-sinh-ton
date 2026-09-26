// Deterministic generation of all static map data (heights, towns, roads, plots, masks).
// Pure module (no three.js) so it can be unit tested and run anywhere.
import { WORLD } from "../config.js";
import { RNG } from "../core/rng.js";
import { Heightmap } from "./heightmap.js";
import {
  generateBaseTerrain,
  placeTowns,
  flattenTowns,
  buildRoads,
  flattenRoads,
  planPlots,
  flattenPlots,
  planVehicles,
  rasterizeMasks,
} from "./layout.js";

export function generateTerrainData(seed = WORLD.MAP_SEED) {
  const rng = new RNG(seed);
  const hm = new Heightmap(WORLD.SIZE, WORLD.RES);
  generateBaseTerrain(hm, seed);
  const towns = placeTowns(hm);
  flattenTowns(hm, towns);
  const roads = buildRoads(hm, towns);
  flattenRoads(hm, roads);
  const plots = planPlots(hm, towns, roads, rng.fork(3));
  flattenPlots(hm, plots);
  const vehicleSpawns = planVehicles(hm, towns, roads, plots, rng.fork(4));
  const masks = rasterizeMasks(hm, towns, roads, plots, WORLD.MASK_RES);
  return { seed, hm, towns, roads, plots, vehicleSpawns, masks, maskRes: WORLD.MASK_RES };
}
