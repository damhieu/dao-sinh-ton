// Builds the static world (terrain, water, sky, and later buildings + vegetation) from generated map data.
import { generateTerrainData } from "./terraingen.js";
import { createSky } from "./sky.js";
import { createTerrain, createHeightTexture } from "./terrain.js";
import { createWater } from "./water.js";

// setTimeout (not rAF) so loading also progresses while the tab is hidden
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export async function createWorld(ctx, assets, onProgress = () => {}) {
  onProgress(0.05, "Sinh địa hình");
  await nextFrame();
  const data = generateTerrainData();
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
    sky,
    terrain,
    water,
    heightTex,
    update(dt, time, focus) {
      sky.update(focus);
      water.update(time);
    },
  };
}
