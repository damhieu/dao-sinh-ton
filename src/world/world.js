// Builds the static world (terrain, water, sky, collision, and later buildings + vegetation) from map data.
import { WORLD, PHYS } from "../config.js";
import { generateTerrainData } from "./terraingen.js";
import { createSky } from "./sky.js";
import { createTerrain, createHeightTexture } from "./terrain.js";
import { createWater } from "./water.js";
import { CollisionWorld } from "./collision.js";

// setTimeout (not rAF) so loading also progresses while the tab is hidden
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export async function createWorld(ctx, assets, onProgress = () => {}) {
  onProgress(0.05, "Sinh địa hình");
  await nextFrame();
  const data = generateTerrainData();
  const collision = new CollisionWorld(data.hm, 8, WORLD.SEA, PHYS.SWIM_DEPTH);
  onProgress(0.3, "Bầu trời và ánh sáng");
  await nextFrame();
  const sky = createSky(ctx, assets);
  sky.setShadowQuality(ctx.preset.shadowSize, ctx.preset.shadowRange);
  onProgress(0.45, "Dựng địa hình");
  await nextFrame();
  const heightTex = createHeightTexture(data.hm);
  const terrain = createTerrain(data, assets, ctx);
  const water = createWater(data, terrain.noiseTex, heightTex, ctx);
  onProgress(1, "Xong");

  return {
    data,
    hm: data.hm,
    collision,
    sky,
    terrain,
    water,
    heightTex,
    isLand(x, z) {
      return data.hm.getHeight(x, z) > 1.5;
    },
    update(dt, time, focus) {
      sky.update(focus);
      water.update(time);
    },
  };
}
